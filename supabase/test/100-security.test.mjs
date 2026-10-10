// Этап 10: безопасность по итогам аудита (AUDIT.md, разделы S и D). Миграция 100_security.sql.
// Запуск: npm test  (или node supabase/test/run.mjs 100)
//
// На каждую находку с пометкой «Подтв.» здесь есть проверка, которая до исправления падала:
// S1, S2, D1–D7. Остальные пункты S и D проверены тем же способом, где это возможно без
// живого сервиса.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const src = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const dataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const METRICS_URL = dataUrl(src('js/admin/metrics.js'));
const M = await import(METRICS_URL);
const D = await import(dataUrl(src('js/admin/demo.js').replace("'./metrics.js'", JSON.stringify(METRICS_URL)).replace("'./demo-seed.js'", JSON.stringify(dataUrl(src('js/admin/demo-seed.js'))))));
const CSV = await import(dataUrl(src('js/admin/csv.js')));
// api.js imports ./metrics.js (stage 11): a data: module has no folder, so the import is inlined the same way
const API = await import(dataUrl(src('js/admin/api.js').replace("'./metrics.js'", JSON.stringify(dataUrl(src('js/admin/metrics.js'))))));

const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const val = async (sql, params) => Object.values(await one(sql, params))[0];
const rejects = async (who, sql, params, code, label) => {
  try { await as(who, sql, params); bad(label + ' — должно быть отклонено'); }
  catch (e) { (String(e.message).includes(code) ? ok : bad)(label + ' → ' + String(e.message).slice(0, 70)); }
};
const headers = (h) => db.query(`select set_config('request.headers', $1, false)`, [h ? JSON.stringify(h) : '']);
const fromIp = (ip) => headers({ 'cf-connecting-ip': ip });
const track = (events, who = 'anon') => as(who, `select track($1)`, [JSON.stringify(events)]);
const calm = async () => { await db.exec(`update events set ts = ts - interval '1 hour'; delete from rate_hits;`); await headers(null); };
const MEDIA = 'https://x.supabase.co/storage/v1/object/public/media/';

// роль «Контент»
U.smm = (await db.query(`insert into auth.users(email, raw_user_meta_data) values ('smm@t.am', '{}') returning id`)).rows[0].id;
await as('owner', `select set_role($1, 'content')`, [U.smm]);

// ================================================================ S1: «Что включено» — текст, не разметка
console.log('  S — сайт, панель, функции');
{
  // Функция из js/app.js запускается на подменённом документе: что бы ни пришло из панели,
  // на страницу попадают только <li>, <svg>, <use> и текст.
  const fn = /function fillInc\(ul, inc\) \{[\s\S]*?\n  \}/.exec(src('js/app.js'));
  check(!!fn && !/#sheet-inc'\)\.innerHTML/.test(src('js/app.js')), 'S1: список «Что включено» больше не собирается через innerHTML');
  if (fn) {
    const made = [];
    const el = (tag) => ({ tag, kids: [], attrs: {}, text: null, appendChild(k) { this.kids.push(k); return k; }, setAttribute(k, v) { this.attrs[k] = v; },
      set textContent(v) { this.kids = []; this.text = v; }, set innerHTML(v) { this.html = v; } });
    const document = { createElement: (t) => { const e = el(t); made.push(e); return e; }, createElementNS: (ns, t) => { const e = el(t); made.push(e); return e; }, createTextNode: (t) => ({ tag: '#text', text: String(t) }) };
    const ctx = { document, Array }; vm.createContext(ctx);
    vm.runInContext(fn[0] + '; this.fillInc = fillInc;', ctx);
    const evil = '<img src=x onerror=alert(document.domain)>', ul = el('ul');
    ctx.fillInc(ul, ['Перелёт', evil, 7, null, { a: 1 }]);
    const texts = ul.kids.map((li) => li.kids.find((k) => k.tag === '#text').text);
    check(ul.kids.length === 2 && texts[1] === evil && made.every((e) => ['li', 'svg', 'use'].includes(e.tag) && e.html === undefined) && ul.html === undefined,
      'S1: строка с <img onerror> остаётся текстом; не-строки отброшены', [ul.kids.length, made.map((e) => e.tag)]);
    let threw = false;
    try { for (const junk of ['<b>x</b>', { length: 1, 0: '<i>' }, null, undefined, 5]) { const u = el('ul'); ctx.fillInc(u, junk); if (u.kids.length) threw = true; } } catch (e) { threw = true; }
    check(!threw, 'S1: не-список вместо списка не роняет страницу и ничего не рисует');
  }
  // второй замок — в базе
  const tid = await val(`select id from tours where slug = 'dubai'`);
  await rejects('smm', `update tours set i18n = jsonb_set(i18n, '{ru,inc}', '"<img src=x onerror=alert(1)>"') where id = $1`, [tid], 'tours_inc_ok', 'S1: inc строкой вместо списка база не принимает');
  await rejects('smm', `update tours set i18n = jsonb_set(i18n, '{ru,inc}', '[{"html":"<b>"}]') where id = $1`, [tid], 'tours_inc_ok', 'S1: inc с объектом внутри отклонён');
  await rejects('mkt', `update tours set i18n = jsonb_set(i18n, '{ru,inc}', to_jsonb(array[repeat('я', 201)])) where id = $1`, [tid], 'tours_inc_ok', 'S1: строка длиннее 200 знаков отклонена');
  await as('smm', `update tours set i18n = jsonb_set(i18n, '{ru,inc}', to_jsonb(array['Перелёт', repeat('я', 200)])) where id = $1`, [tid]);
  ok('S1: обычный список строк сохраняется');
  check(D.incOk({ ru: { inc: ['a'] }, hy: {} }) && !D.incOk({ ru: { inc: '<b>' } }) && !D.incOk({ ru: { inc: [1] } }) && !D.incOk({ ru: { inc: ['я'.repeat(201)] } }), 'S1: демо-режим проверяет список так же');
}

// ================================================================ S2: формулы в CSV
{
  const rows = [{ name: '=HYPERLINK("http://evil.example";"Открыть")', phone: '+374 91 123456', utm: '@SUM(1+1)', tour: '-2+3', tab: '\tx', cr: '\rx', sp: '  =1+1', sum: -150.5, ok: 'Анна Гаспарян', q: 'a "b", c' }];
  const text = CSV.csvText(rows, Object.keys(rows[0]).map((k) => [k, (r) => r[k]]));
  const cells = text.split('\n')[1];
  check(cells.startsWith(`"'=HYPERLINK(""http://evil.example"";""Открыть"")","'+374 91 123456","'@SUM(1+1)","'-2+3","'\tx","'\rx","'  =1+1",`),
    'S2: ячейка, начинающаяся с = + - @, табуляции или CR, получает апостроф и кавычки', cells);
  check(cells.endsWith(`,-150.5,Анна Гаспарян,"a ""b"", c"`), 'S2: числа панели и обычный текст остаются как были', cells);
  check(/csvText\(rows, columns\)/.test(src('js/admin/ui.js')), 'S2: выгрузки панели идут через эту функцию (js/admin/ui.js → csv())');
}

// ================================================================ S3: входа через Mail.ru на сайте нет
// Мост Mail.ru снят (10.10.2026): функции и кнопки нет. auth_user_by_email из миграции 100 в базе
// осталась — она по-прежнему закрыта для всех ролей API.
{
  check(!fs.existsSync(new URL('../../supabase/functions/mailru-auth', import.meta.url)), 'S3: функции mailru-auth в репозитории нет');
  check(!/mailru/i.test(src('index.html') + src('js/app.js') + src('cabinet.html') + src('js/auth.js')), 'S3: на сайте нет ни кнопки, ни перехода на вход через Mail.ru');
  for (const w of ['anon', 'cli', 'mgr', 'owner']) await expectErr(w, `select public.auth_user_by_email('owner@t.am')`, [], 'S3: auth_user_by_email закрыта для ' + w);
}

// ================================================================ S4: supabase-js со своего сайта
{
  const file = 'js/vendor/supabase-js-2.117.2.js';
  const sha = crypto.createHash('sha256').update(fs.readFileSync(new URL('../../' + file, import.meta.url))).digest('hex');
  check(src('js/vendor/README.md').includes(sha) && src('build.mjs').includes(sha) && src('js/vendor/README.md').includes('2.117.2'), 'S4: контрольная сумма файла совпадает с записанной в js/vendor/README.md и в build.mjs', sha);
  for (const page of ['index.html', 'cabinet.html', 'admin.html']) {
    const html = src(page), csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    check(!html.includes('jsdelivr') && html.includes(`<script src="${file}"></script>`) && /script-src 'self'/.test(csp), `S4: ${page} — библиотека своя, cdn.jsdelivr.net нет ни в теге, ни в script-src`);
    const ext = [...html.matchAll(/<script[^>]+src="(https:[^"]+)"[^>]*>/g)].filter((m) => !/integrity="sha(256|384|512)-/.test(m[0]) && !/instagram\.com\/embed\.js/.test(m[1]));
    check(ext.length === 0, `S4: ${page} — у каждого чужого скрипта есть integrity`, ext.map((m) => m[1]));
  }
  check(!/cdnjs/.test(src('cabinet.html')), 'S4: в кабинете cdnjs нет совсем — qrcode ему не нужен');
}

// ================================================================ S5: адрес фото
{
  const fn = /function mediaUrl\(u\) \{[\s\S]*?\n  \}\n  function cssUrl\(u\) \{[^\n]*\}/.exec(src('js/cms.js'));
  check(!!fn, 'S5: в js/cms.js адрес фото проходит через mediaUrl()');
  const run = (demo) => { const ctx = { window: { SAM_SUPABASE: { url: 'https://x.supabase.co' } }, DEMO: demo, String }; vm.createContext(ctx); vm.runInContext(fn[0] + '; this.mediaUrl = mediaUrl; this.cssUrl = cssUrl;', ctx); return ctx; };
  const site = run(false), demo = run(true);
  const good = MEDIA + 'content/k3x-ab12cd.webp';
  const evil = ['https://evil.example/a.jpg', MEDIA + 'a.jpg") , url("https://evil.example/x', MEDIA + 'a.jpg\\', MEDIA + "a.jpg');}", 'https://y.supabase.co/storage/v1/object/public/media/a.jpg',
    'https://x.supabase.co.evil.example/storage/v1/object/public/media/a.jpg', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA', MEDIA, null, undefined, 5, {}];
  check(site.mediaUrl(good) === good && site.cssUrl(good) === `url("${good}") center / cover no-repeat` && evil.every((u) => site.mediaUrl(u) === '' && site.cssUrl(u) === ''),
    'S5: сайт принимает только файл бакета media своего проекта; чужой хост, кавычки и скобки — «фото нет»', evil.filter((u) => site.mediaUrl(u) !== ''));
  check(demo.mediaUrl('data:image/webp;base64,UklGRg==') !== '' && demo.mediaUrl('data:image/svg+xml;base64,PHN2Zz4=') === '' && demo.mediaUrl('data:image/png;base64,AA"A') === '', 'S5: data:image — только в демо и только растровый');
  check(API.mediaUrlOk(good, 'https://x.supabase.co/') && evil.every((u) => !API.mediaUrlOk(u, 'https://x.supabase.co')) && !API.mediaUrlOk(good, '') && !API.mediaUrlOk(good, 'http://x.supabase.co'), 'S5: панель проверяет адрес так же (LiveApi.src)');
  check(/src\(url\) \{ return mediaUrlOk\(url/.test(src('js/admin/api.js')), 'S5: в CSS панели адрес попадает только после этой проверки');
  // CHECK в базе. Адрес своего проекта база не знает, поэтому чужой проект Supabase она
  // пропустит — его отсекают сайт и панель (выше); знаки, ломающие CSS, не проходят нигде.
  const OTHER_PROJECT = 'https://y.supabase.co/storage/v1/object/public/media/a.jpg';
  const tid = await val(`select id from tours where slug = 'dubai'`);
  for (const [col, table] of [['photo_url', 'tours'], ['photo_hero_url', 'tours'], ['photo_url', 'reviews'], ['photo_url', 'team']]) {
    const id = table === 'tours' ? tid : await val(table === 'reviews' ? `insert into reviews(author) values ('S5') returning id` : `insert into team(i18n) values ('{"ru":{"name":"S5"}}') returning id`);
    let leaked = 0;
    for (const u of evil.filter((x) => typeof x === 'string' && x !== OTHER_PROJECT)) { try { await as('owner', `update ${table} set ${col} = $2 where id = $1`, [id, u]); leaked++; } catch (e) { if (!/_url_ok/.test(e.message)) leaked++; } }
    await as('owner', `update ${table} set ${col} = $2 where id = $1`, [id, good]);
    check(leaked === 0, `S5: ${table}.${col} — в базу попадает только адрес файла бакета media`, leaked);
  }
  await db.query(`update tours set photo_url = null, photo_hero_url = null where id = $1`, [tid]);
}

// ================================================================ S6–S9
{
  const hd = src('_headers');
  check(/\n\/admin\n\s+X-Robots-Tag: noindex, nofollow\n\s+Cache-Control:/.test(hd) && /\n\/cabinet\n\s+X-Robots-Tag: noindex, nofollow\n\s+Cache-Control:/.test(hd), 'S6: в _headers есть правила для /admin и /cabinet (без .html)');
  check(/GitHub Pages `_headers` не читает/.test(src('DEPLOY.md')), 'S6: в DEPLOY.md записано, что GitHub Pages _headers не читает');
  const app = src('js/app.js');
  check(/hasOwnProperty\.call\(I18N, qlang\)/.test(app) && !/qlang && I18N\[qlang\]/.test(app) && /own\(P\.CDATA, parts\[1\]\)/.test(app) && !/!P\.CDATA\[parts\[1\]\]/.test(app),
    'S7: ?lang= и #checklist/ проверяются по собственным ключам — «constructor» не проходит');
  check(/pass\.length < \(isSignup \? 10 : 1\)/.test(app) && !/pass\.length < 6/.test(app), 'S8: новый пароль на сайте — не короче 10 знаков');
  const tid = await val(`select id from tours where slug = 'dubai'`);
  await rejects('smm', `update tours set photo_class = 'p-sea.is-open#root' where id = $1`, [tid], 'tours_photo_class_known', 'S9: фон тура не из списка отклонён');
  await as('smm', `update tours set photo_class = 'p-city' where id = $1`, [tid]);
  check(/if \(DEMO\) window\.__samPanel = ctx/.test(src('js/admin/main.js')) && !/^window\.__samPanel/m.test(src('js/admin/main.js')), 'S9: window.__samPanel есть только в демо');
  check(!/'\.' \+ [td]\.photo_class/.test(src('js/admin/views/content.js')), 'S9: в селектор панели попадает только встроенный фон');
}

// ================================================================ D1: промокоды
console.log('  D — база');
{
  await as('mkt', `insert into coupons(code, discount_pct) values ('D1CODE', 10)`);
  await expectErr('mgr', `insert into coupons(code, discount_pct) values ('MGRFREE', 100)`, [], 'D1: менеджер не создаёт промокод');
  check((await as('mgr', `update coupons set discount_pct = 100, max_uses = null where code = 'D1CODE'`)).affectedRows === 0, 'D1: менеджер не меняет промокод');
  check((await as('mgr', `delete from coupons where code = 'D1CODE'`)).affectedRows === 0, 'D1: менеджер не удаляет промокод');
  check((await as('mgr', `select count(*)::int n from coupons where code = 'D1CODE'`)).rows[0].n === 1, 'D1: менеджер промокоды читает');
  check((await as('smm', `select count(*)::int n from coupons`)).rows[0].n === 0 && (await as('cli', `select count(*)::int n from coupons`)).rows[0].n === 0 && (await as('anon', `select count(*)::int n from coupons`)).rows[0].n === 0,
    'D1: «Контент», клиент и гость промокодов не видят');
  check((await as('mkt', `update coupons set discount_pct = 15 where code = 'D1CODE'`)).affectedRows === 1 && (await as('owner', `update coupons set discount_pct = 20 where code = 'D1CODE'`)).affectedRows === 1, 'D1: маркетолог и владелец пишут как раньше');
  check(await val(`select count(*)::int from pg_policies where tablename = 'coupons' and policyname = 'coupons: staff all'`) === 0, 'D1: политики "coupons: staff all" больше нет');
}

// ================================================================ D2: submit_lead и письмо о заявке
{
  const lead = JSON.stringify({ name: 'Клиент', phone: '+374 91 222333', message: 'от вошедшего' });
  for (const w of ['cli', 'anon', 'mgr', 'owner']) await rejects(w, `select submit_lead($1)`, [lead], 'permission denied', 'D2: submit_lead закрыта для ' + w);
  check(await val(`select count(*)::int from leads where phone = '+374 91 222333'`) === 0, 'D2: заявка не создана');
  check(await val(`select count(*)::int from pg_trigger where tgname = 'leads_notify_ai'`) === 0, 'D2: триггера, который ставил письмо о заявке, нет');
  // даже если строка «письмо о заявке» появится, notify_claim её не отдаёт
  const lid = await val(`insert into leads(name, phone, source) values ('Старая', '+374 91 222334', 'form') returning id`);
  check(await val(`select count(*)::int from notify_log where lead_id = $1`, [lid]) === 0, 'D2: запись с источником «form» задания на письмо не получает');
  await db.query(`insert into notify_log(lead_id, kind) values ($1, 'lead')`, [lid]);
  check((await val(`select public.notify_claim()`)).length === 0 && (await val(`select public.notify_claim($1)`, [lid])).length === 0, 'D2: notify_claim не отдаёт kind = lead');
  // миграция при накате убирает уже висящие
  const m = /delete from public\.notify_log where kind = 'lead' and status = 'pending';/.exec(src('supabase/migrations/100_security.sql'));
  await db.exec(m[0]);
  check(await val(`select count(*)::int from notify_log where kind = 'lead'`) === 0, 'D2: висящие письма о заявках миграция удаляет');
  for (const w of ['anon', 'cli', 'mgr', 'owner']) await expectErr(w, `select notify_claim()`, [], 'D2: notify_claim закрыта для ' + w);
}

// ================================================================ D3: track
{
  await calm();
  // пример из аудита: один отправитель шлёт 20 пачек по 30 событий с новыми sid
  await fromIp('203.0.113.50');
  for (let b = 0; b < 20; b++) await track(Array.from({ length: 30 }, (_, i) => ({ sid: 'flood' + String(b * 30 + i).padStart(5, '0'), name: 'page_view' })));
  const flood = await val(`select count(*)::int from events where sid like 'flood%'`);
  check(flood === 120, 'D3: от одного отправителя за минуту принято 120 событий из 600', flood);
  await fromIp('198.51.100.77');
  await track([{ sid: 'realvisit001', name: 'page_view' }, { sid: 'realvisit001', name: 'wa_click', label: 'topbar' }]);
  check(await val(`select count(*)::int from events where sid = 'realvisit001'`) === 2, 'D3: настоящий посетитель в ту же минуту — и просмотр, и клик в WhatsApp сохранены');
  await fromIp('203.0.113.50');
  await track([{ sid: 'floodagain01', name: 'wa_click' }]);
  check(await val(`select count(*)::int from events where sid = 'floodagain01'`) === 0, 'D3: тот, кто исчерпал свой лимит, не пишет и клики в WhatsApp');
  await db.exec(`update rate_hits set ts = ts - interval '61 seconds'`);
  await track([{ sid: 'floodagain02', name: 'page_view' }]);
  check(await val(`select count(*)::int from events where sid = 'floodagain02'`) === 1, 'D3: через минуту лимит отправителя снова свободен');

  // общий потолок и отдельный запас wa_click (запросы без адреса: лимита отправителя нет)
  await calm();
  for (let b = 0; b < 20; b++) await track(Array.from({ length: 30 }, (_, i) => ({ sid: 'nohdr' + String(b * 30 + i).padStart(5, '0'), name: 'page_view' })));
  await track([{ sid: 'realvisit002', name: 'page_view' }, { sid: 'realvisit002', name: 'wa_click' }]);
  check(await val(`select count(*)::int from events where sid like 'nohdr%'`) === 600 && await val(`select count(*)::int from events where sid = 'realvisit002'`) === 2,
    'D3: 600 событий за минуту больше не закрывают аналитику — общий потолок 3000');
  await db.exec(`insert into events (sid, name) select 'filler' || lpad(g::text, 6, '0'), 'page_view' from generate_series(1, 2400) g`);
  await track([{ sid: 'realvisit003', name: 'page_view' }, { sid: 'realvisit003', name: 'wa_click', label: 'sheet' }, { sid: 'realvisit003', name: 'tel_click' }]);
  const over = (await db.query(`select name from events where sid = 'realvisit003'`)).rows.map((x) => x.name);
  check(over.join() === 'wa_click', 'D3: общий потолок выбран — просмотр отброшен, а клик в WhatsApp принят из своего запаса', over);
  await db.exec(`insert into events (sid, name) select 'wafill' || lpad(g::text, 6, '0'), 'wa_click' from generate_series(1, 299) g`);
  await track([{ sid: 'realvisit004', name: 'wa_click' }]);
  check(await val(`select count(*)::int from events where sid = 'realvisit004'`) === 0, 'D3: у запаса wa_click тоже есть предел — 300 в минуту');

  // метки и promo_id
  await calm();
  const dashes = '-'.repeat(36), uuid = '0f9c1a52-6b1e-4d43-9a57-1c2d3e4f5a6b';
  await track([
    { sid: 'tagsvisit001', name: 'page_view', utm_source: 'insta gram', utm_medium: '=cmd|calc', utm_campaign: '<script>', utm_content: 'x'.repeat(61), ref_host: 'evil.example/"><b>' },
    { sid: 'tagsvisit001', name: 'promo_view', promo_id: dashes },
    { sid: 'tagsvisit001', name: 'promo_click', promo_id: uuid.toUpperCase(), utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'sharm_oct-2026.v2~a', utm_content: 'x'.repeat(60), ref_host: 'm.facebook.com' },
    { sid: 'tagsvisit001', name: 'form_start' },
    'не объект', null, 7,
  ]);
  const tg = (await db.query(`select * from events where sid = 'tagsvisit001' order by id`)).rows;
  check(tg.length === 3, 'D3: 36 дефисов в promo_id больше не роняют пачку; form_start и мусор отброшены', tg.map((x) => x.name));
  check(tg[0] && ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref_host'].every((k) => tg[0][k] === null), 'D3: метки с пробелом, знаком формулы, разметкой или длиннее 60 знаков записаны как «нет метки»', tg[0]);
  check(tg[1] && tg[1].promo_id === null && tg[2].promo_id === uuid, 'D3: promo_id — только настоящий uuid', [tg[1] && tg[1].promo_id, tg[2] && tg[2].promo_id]);
  check(tg[2] && tg[2].utm_source === 'instagram' && tg[2].utm_campaign === 'sharm_oct-2026.v2~a' && tg[2].utm_content.length === 60 && tg[2].ref_host === 'm.facebook.com', 'D3: обычные метки [A-Za-z0-9._~-]{1,60} проходят как были');
  for (const w of ['anon', 'cli']) await expectErr(w, `select public.rate_take('track', 'x', 1, 1)`, [], 'D3: rate_take закрыта для ' + w);
  check((await as('owner', `select count(*)::int n from rate_hits`).catch(() => ({ rows: [{ n: 'denied' }] }))).rows[0].n === 'denied', 'D3: таблицу счётчика через API не читает даже владелец');
}

// ================================================================ D7: номер обращения привязан к визиту
{
  await calm();
  const sids = Array.from({ length: 400 }, (_, i) => (Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4) + i.toString(36)).slice(0, 8 + (i % 30)));
  const got = (await db.query(`select s, public.ref_of(s) r from unnest($1::text[]) s`, [sids])).rows;
  const diff = got.filter((x) => x.r !== M.refOf(x.s));
  check(got.length === 400 && diff.length === 0 && got.every((x) => /^[2-9A-HJKMNP-Z]{5}$/.test(x.r)), 'D7: ref_of() в базе считает номер так же, как refOf() на сайте и в панели (400 случайных sid)', diff.slice(0, 3));

  const promo = await val(`insert into promos (kind, name, coupon_code, active) values ('bar', 'D7', 'D7BANNER', true) returning id`);
  await db.query(`insert into coupons (code, discount_pct, active) values ('D7BANNER', 5, true), ('D7EVIL', 90, true)`);
  const evilPromo = await val(`insert into promos (kind, name, coupon_code, active) values ('bar', 'D7 чужой', 'D7EVIL', true) returning id`);
  const victim = { sid: 'victimvisit01', utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'sharm_oct', lang: 'hy', device: 'mobile' };
  const REF = M.refOf(victim.sid);
  await track([{ ...victim, name: 'page_view' }, { ...victim, name: 'wa_click', tour: 'sharm', label: 'sheet', promo_id: promo, ref: 'ZZZZZ' }, { ...victim, name: 'wa_click', label: 'topbar' }]);
  check(await val(`select count(*)::int from events where sid = $1 and name = 'wa_click' and ref = $2`, [victim.sid, REF]) === 2 && await val(`select count(*)::int from events where ref = 'ZZZZZ'`) === 0,
    'D7: присланный номер не читается — у клика номер его визита');
  // чужой визит присылает номер жертвы, свои метки, свой тур и свой промокод
  const thief = { sid: 'thiefvisit001', utm_source: 'thief', utm_campaign: 'stolen', lang: 'en', device: 'desktop' };
  await track([{ ...thief, name: 'wa_click', ref: REF, tour: 'dubai', label: 'sheet', promo_id: evilPromo }]);
  check(await val(`select ref from events where sid = $1`, [thief.sid]) === M.refOf(thief.sid) && M.refOf(thief.sid) !== REF, 'D7: чужой клик с номером жертвы записан под своим номером');
  // и даже если строка с чужим номером в таблице есть (записана до этой миграции)
  await db.query(`insert into events (ts, sid, name, ref, tour, promo_id, utm_campaign) values (now() - interval '5 minutes', 'oldforged0001', 'wa_click', $1, 'dubai', $2, 'stolen')`, [REF, evilPromo]);
  const r = (await as('owner', `select public.wa_ref($1) r`, [REF])).rows[0].r;
  check(r.utm_campaign === 'sharm_oct' && r.tour === 'sharm' && r.coupon_code === 'D7BANNER' && r.clicks === 2 && r.label === 'topbar',
    'D7: wa_ref — метки, тур и промокод только из визита последнего клика; чужая строка с тем же номером ничего не подмешивает', r);
  const evRows = (await db.query(`select * from events order by id`)).rows, promos = (await db.query(`select * from promos`)).rows;
  const js = D.waRefLookup(evRows, promos, REF);
  check(['utm_campaign', 'tour', 'coupon_code', 'clicks', 'label', 'lang', 'device'].every((k) => (js[k] ?? null) === (r[k] ?? null)), 'D7: демо-режим находит визит так же', js);

  const used0 = await val(`select used_count from coupons where code = 'D7BANNER'`);
  const s = (await as('mgr', `insert into leads (name, phone, source, status, value, ref) values ('D7', '+374 91 700001', 'phone', 'won', 1000, $1) returning *`, [REF])).rows[0];
  check(s.coupon_code === null && s.tour === 'sharm' && s.utm_campaign === 'sharm_oct' && await val(`select used_count from coupons where code = 'D7BANNER'`) === used0,
    'D7: промокод с баннера в продажу не подставляется и использованным не считается; тур и метки — как раньше', [s.coupon_code, s.tour]);
  const jl = D.attributeLead(null, { name: 'D7', source: 'phone', ref: REF, details: {} }, (ref) => D.waRefLookup(evRows, promos, ref));
  check((jl.coupon_code ?? null) === null && jl.tour === 'sharm' && jl.utm_campaign === 'sharm_oct', 'D7: демо-режим промокод тоже не подставляет', jl.coupon_code);
  const sales = src('js/admin/views/sales.js');
  check(!/d\.coupon_code = e\.coupon_code; couponIn\.value = e\.coupon_code; \}\s*\n\s*\} catch/.test(sales) && /Подставить/.test(sales) && /couponHint/.test(sales), 'D7: форма продажи показывает промокод визита подсказкой с кнопкой «Подставить»');
}

// ================================================================ D4: сумма закрытой продажи
{
  const acts = async (id) => (await db.query(`select kind, meta from lead_activity where lead_id = $1 and kind = 'money' order by created_at, id`, [id])).rows.map((a) => a.meta);
  const id = (await as('mgr', `insert into leads (name, phone, source, status, value, profit) values ('D4', '+374 91 400400', 'phone', 'won', 5000, 600) returning id`)).rows[0].id;
  // пример из аудита: из «продано» в «предложение» с новой суммой, затем обратно
  await as('mgr', `update leads set status = 'quoted', value = 100, profit = 10 where id = $1`, [id]);
  await as('mgr', `update leads set status = 'won' where id = $1`, [id]);
  let m = await acts(id);
  check(m.length === 1 && Number(m[0].value.from) === 5000 && Number(m[0].value.to) === 100 && Number(m[0].profit.from) === 600 && Number(m[0].profit.to) === 10,
    'D4: сумма и доход, изменённые на выходе из «продано», оставили запись «было → стало»', m);
  // второй путь: вывести без правки, поменять сумму, пока запись «в работе», вернуть
  await as('mgr', `update leads set status = 'quoted' where id = $1`, [id]);
  await as('mgr', `update leads set value = 70 where id = $1`, [id]);
  await as('mgr', `update leads set status = 'won', profit = 1 where id = $1`, [id]);
  m = await acts(id);
  check(m.length === 3 && Number(m[1].value.from) === 100 && Number(m[1].value.to) === 70 && Number(m[2].profit.to) === 1, 'D4: правка суммы, пока продажа «в работе», и правка дохода при возврате в «продано» — тоже в истории', m);
  // демо-режим считает так же
  const steps = [[{ status: 'won', value: 5000, profit: 600 }, { status: 'quoted', value: 100, profit: 10 }], [{ status: 'quoted', value: 100, profit: 10 }, { status: 'won', value: 100, profit: 10 }],
    [{ status: 'quoted', value: 100, profit: 10 }, { status: 'quoted', value: 7, profit: 10 }], [{ status: 'new', value: null, profit: null }, { status: 'won', value: 2000, profit: 240 }],
    [{ status: 'quoted', value: 1500, profit: null }, { status: 'won', value: 2000, profit: null }], [{ status: 'won', value: 10, profit: null }, { status: 'won', value: 10, profit: 3 }]];
  const want = [true, false, true, false, true, true];
  check(steps.every(([o, n], i) => !!D.moneyEdit(o, n) === want[i]), 'D4: демо-режим пишет денежную запись в тех же случаях', steps.map(([o, n]) => !!D.moneyEdit(o, n)));
}

// ================================================================ D5: NaN
{
  await rejects('mgr', `insert into leads (name, phone, source, status, value) values ('NaN', '+374 91 500500', 'phone', 'won', 'NaN')`, [], 'leads_money_not_nan', 'D5: продажа с суммой NaN отклонена');
  const id = (await as('mgr', `insert into leads (name, phone, source, status, value) values ('D5', '+374 91 500501', 'phone', 'won', 100) returning id`)).rows[0].id;
  await rejects('mgr', `update leads set value = 'NaN' where id = $1`, [id], 'leads_money_not_nan', 'D5: сумму нельзя исправить на NaN');
  await rejects('mgr', `update leads set profit = 'NaN' where id = $1`, [id], 'profit_out_of_range', 'D5: доход NaN при обычной сумме отклоняет сторож продаж');
  await rejects('mgr', `update leads set value = 'NaN', profit = 'NaN' where id = $1`, [id], 'leads_money_not_nan', 'D5: сумма и доход NaN вместе (сторож их пропускал) отклонены');
  await rejects('mkt', `insert into campaigns (name, utm_source, utm_medium, utm_campaign, spend) values ('NaN', 'a', 'b', 'd5_nan', 'NaN')`, [], 'campaigns_spend_ok', 'D5: расход кампании NaN отклонён');
  await rejects('mkt', `insert into campaigns (name, utm_source, utm_medium, utm_campaign, spend) values ('Минус', 'a', 'b', 'd5_minus', -5)`, [], 'campaigns_spend_ok', 'D5: отрицательный расход отклонён');
  const to = new Date(Date.now() + 86400e3).toISOString(), from = new Date(Date.now() - 30 * 86400e3).toISOString();
  const k = (await as('owner', `select public.stats_sales($1, $2) s`, [from, to])).rows[0].s.kpi;
  check(Number.isFinite(Number(k.revenue)) && Number.isFinite(Number(k.profit)) && !JSON.stringify(k).includes('NaN'), 'D5: в сводке нет «NaN»', k.revenue);
  let demoErr = '';
  try { D.guardLead(null, { name: 'Клиент', phone: '+374 91 123456', status: 'won', source: 'phone', value: 'abc', created_at: new Date().toISOString() }, 'USD'); } catch (e) { demoErr = e.message; }
  check(demoErr === 'leads_money_not_nan', 'D5: демо-режим тоже не принимает «не число»', demoErr);
}

// ================================================================ D6: тексты о повторном запуске
{
  const files = fs.readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => /^0\d\d_.*\.sql$/.test(f));
  const head = (f) => src('supabase/migrations/' + f).split('\n').slice(0, 30).join('\n');
  const stale = files.filter((f) => /safe to re-run|повторный запуск безопасен|безопасна при повторном запуске/i.test(head(f)));
  const told = files.filter((f) => /AUDIT\.md, D6/.test(head(f)));
  check(files.length === 10 && stale.length === 0 && told.length === 10, 'D6: в заголовках 001–090 вместо «повторный запуск безопасен» — «только весь набор по порядку»', { stale, missing: files.filter((f) => !told.includes(f)) });
  check(!/повторный\s+запуск безопасен/.test(src('SETUP-ADMIN.md')) && /Только весь набор по порядку/.test(src('SETUP-ADMIN.md')), 'D6: то же в SETUP-ADMIN.md');
}

// ================================================================ D8: бакет media
{
  await db.exec(`grant select, insert, update, delete on storage.objects to anon, authenticated`);   // как в Supabase: доступ решают политики
  await expectErr('mgr', `insert into storage.objects(bucket_id, name) values ('media', 'content/by-mgr.webp')`, [], 'D8: менеджер в бакет не загружает');
  for (const w of ['owner', 'mkt', 'smm']) await as(w, `insert into storage.objects(bucket_id, name) values ('media', $1)`, ['content/by-' + w + '.webp']);
  ok('D8: владелец, маркетолог и «Контент» загружают');
  check((await as('mgr', `update storage.objects set name = 'content/hijacked.webp' where bucket_id = 'media'`)).affectedRows === 0, 'D8: менеджер не перезаписывает чужие файлы');
  check((await as('mkt', `update storage.objects set name = 'content/by-mkt-2.webp' where name = 'content/by-mkt.webp'`)).affectedRows === 1, 'D8: маркетолог перезаписывает');
  await expectErr('smm', `update storage.objects set bucket_id = 'private' where name = 'content/by-smm.webp'`, [], 'D8: файл нельзя перенести в чужой бакет');
  await db.query(`update storage.buckets set public = false, file_size_limit = 999999999, allowed_mime_types = array['text/html'] where id = 'media'`);
  await db.exec(/insert into storage\.buckets[\s\S]*?excluded\.allowed_mime_types;/.exec(src('supabase/migrations/100_security.sql'))[0]);
  const bk = await one(`select * from storage.buckets where id = 'media'`);
  check(bk.public === true && Number(bk.file_size_limit) === 5242880 && bk.allowed_mime_types.join() === 'image/jpeg,image/png,image/webp,image/avif', 'D8: лимиты бакета восстанавливаются миграцией, даже если бакет уже был', bk);
}

// ================================================================ D9: «Контент» и команда
{
  const member = (await as('owner', `insert into team(i18n, whatsapp, published) values ('{"ru":{"name":"Анна","role":"Пляжи"}}', '37455000000', true) returning id`)).rows[0].id;
  const photo = MEDIA + 'content/anna.webp';
  check((await as('smm', `update team set photo_url = $2 where id = $1`, [member, photo])).affectedRows === 1 && await val(`select photo_url from team where id = $1`, [member]) === photo, 'D9: роль «Контент» меняет фото сотрудника');
  for (const [set, what] of [[`i18n = '{"ru":{"name":"Взлом"}}'`, 'имя и должность'], [`whatsapp = '37400000000'`, 'WhatsApp'], [`published = false`, '«Показывать на сайте»'], [`sort = 99`, 'порядок']]) {
    await rejects('smm', `update team set ${set} where id = $1`, [member], 'team_photo_only', 'D9: «Контент» не меняет ' + what);
  }
  await rejects('smm', `update team set photo_url = null, whatsapp = '1' where id = $1`, [member], 'team_photo_only', 'D9: …и вместе с фото тоже');
  await expectErr('smm', `insert into team(i18n) values ('{"ru":{"name":"Свой"}}')`, [], 'D9: «Контент» не добавляет сотрудника');
  check((await as('smm', `delete from team where id = $1`, [member])).affectedRows === 0 && await val(`select count(*)::int from team where id = $1`, [member]) === 1, 'D9: «Контент» не удаляет сотрудника');
  check((await as('owner', `update team set whatsapp = '37455111111', sort = 3 where id = $1`, [member])).affectedRows === 1, 'D9: владелец правит всё как раньше');
  // возврат версии под ролью «Контент»: только если отличается одним фото
  const hist = (await as('smm', `select * from row_history('team', $1)`, [member])).rows;
  await rejects('smm', `select restore_version($1)`, [hist[hist.length - 1].id], 'team_photo_only', 'D9: «Контент» не возвращает версию сотрудника с другими полями');
  // подпись автора — без e-mail
  await db.query(`update profiles set full_name = null where id = $1`, [U.smm]);
  await db.query(`update profiles set full_name = '  ' where id = $1`, [U.owner]);
  const h2 = (await as('smm', `select * from row_history('team', $1)`, [member])).rows;
  check(h2.length >= 3 && h2.every((v) => !/@/.test(v.actor_name || '')) && h2.some((v) => v.actor_name === 'Владелец') && h2.some((v) => v.actor_name === 'Контент'), 'D9: история не отдаёт e-mail как имя автора — подпись роли', h2.map((v) => v.actor_name));
  await db.query(`update profiles set full_name = 'owner' where id = $1`, [U.owner]);
  // демо-режим: та же черта
  const store = {}; globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  const REM = await import(dataUrl(src('js/admin/reminders.js')));
  const demo = new D.DemoApi(REM); demo.wait = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
  demo.switchRole('content');
  const tm = (await demo.list('team'))[0];
  const tryIt = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return e.message; } };
  check((await tryIt(() => demo.saveTeamPhoto(tm.id, 'demo-media:abc123'))) === 'ok' && (await demo.list('team'))[0].photo_url === 'demo-media:abc123', 'D9 демо: «Контент» меняет фото');
  check((await tryIt(() => demo.save('team', { ...tm, whatsapp: '1' }))) === 'team_photo_only' && /security/.test(await tryIt(() => demo.save('team', { i18n: {} }))) && /security/.test(await tryIt(() => demo.remove('team', tm.id))) && (await tryIt(() => demo.reorder('team', [tm.id]))) === 'team_photo_only',
    'D9 демо: «Контент» не правит остальное, не добавляет, не удаляет, не переставляет');
  check((await demo.history('team', tm.id)).every((v) => !/@/.test(v.actor_name || '')), 'D9 демо: в истории нет e-mail');
  // остальные правила этапа в демо
  demo.switchRole('manager');
  check(/security/.test(await tryIt(() => demo.addActivity(demo.st.leads[0].id, 'system', 'подделка'))) && (await tryIt(() => demo.addActivity(demo.st.leads[0].id, 'note', 'заметка'))) === 'ok', 'D11 демо: строку «system» руками не вписать, заметку — можно');
  check(/permission denied/.test(await tryIt(() => demo.upload(new Blob(['x'])))) && /permission denied/.test(await tryIt(() => demo.save('coupons', { code: 'X', discount_pct: 5 }))) && (await demo.list('coupons')).length > 0, 'D1, D8 демо: менеджер промокоды читает, но не пишет; в «бакет» не загружает');
  demo.switchRole('marketer');
  const t0 = (await demo.list('tours'))[0];
  check(/tours_photo_url_ok/.test(await tryIt(() => demo.save('tours', { ...t0, photo_url: 'https://evil.example/a.jpg' }))) && /tours_photo_class_known/.test(await tryIt(() => demo.save('tours', { ...t0, photo_class: 'p-sea.x' })))
    && /tours_inc_ok/.test(await tryIt(() => demo.save('tours', { ...t0, i18n: { ru: { inc: '<b>' } } }))) && /reels_url_check/.test(await tryIt(() => demo.save('reels', { url: 'https://www.instagram.com/reel/abc/"><script>' })))
    && /campaigns_spend_ok/.test(await tryIt(() => demo.save('campaigns', { name: 'x', utm_campaign: 'demo_nan', spend: 'abc' }))), 'S1, S5, S9, D5, D14 демо: те же проверки при сохранении');
  const snap = D.publicSnapshot({ ...demo.st, settings: { ...demo.st.settings, company: { ...demo.st.settings.company, bank_account: 'AM00', margin_pct: 12 } } });
  check(Object.keys(snap.settings.company).sort().join() === 'insurance,legal_name,licence', 'D15 демо: на сайт из реквизитов уходит только перечисленное', Object.keys(snap.settings.company));
}

// ================================================================ D10: профиль
{
  await rejects('cli', `update profiles set full_name = $2 where id = $1`, [U.cli, 'я'.repeat(121)], 'profiles_full_name_len', 'D10: имя длиннее 120 знаков отклонено');
  await rejects('cli', `update profiles set phone = $2 where id = $1`, [U.cli, '1'.repeat(41)], 'profiles_phone_len', 'D10: телефон длиннее 40 знаков отклонён');
  await rejects('cli', `update profiles set consent_source = $2 where id = $1`, [U.cli, '<script>'], 'profiles_consent_source_known', 'D10: источник согласия не из списка отклонён');
  await as('cli', `update profiles set full_name = $2, phone = $3, consent_source = 'cabinet' where id = $1`, [U.cli, 'я'.repeat(120), '1'.repeat(40)]);
  ok('D10: имя в 120 знаков, телефон в 40 и источник из списка сохраняются');
  const long = (await db.query(`insert into auth.users(email, raw_user_meta_data) values ('long@t.am', $1) returning id`, [JSON.stringify({ full_name: '  ' + 'Ж'.repeat(500), lang: 'xx', marketing_consent: true, consent_source: 'x'.repeat(5000) })])).rows[0].id;
  const p = await one(`select * from profiles where id = $1`, [long]);
  check(p.full_name.length === 120 && p.lang === 'en' && p.consent_source === null && p.marketing_consent === false && p.onboarded === false,
    'D10: регистрация с именем в 500 знаков и выдуманным источником — имя обрезано, согласие не записано, человек увидит экран первого входа', [p.full_name.length, p.consent_source, p.marketing_consent]);
  const fine = (await db.query(`insert into auth.users(email, raw_user_meta_data) values ('fine@t.am', $1) returning id`, [JSON.stringify({ full_name: 'Анна', lang: 'hy', marketing_consent: true, consent_source: 'signup_form', birth_date: '1990-05-05' })])).rows[0].id;
  const f = await one(`select * from profiles where id = $1`, [fine]);
  check(f.full_name === 'Анна' && f.lang === 'hy' && f.marketing_consent === true && f.consent_source === 'signup_form' && f.onboarded === true && !!f.consent_at && !!f.birth_date, 'D10: обычная регистрация с сайта — как раньше');
  const junk = (await db.query(`insert into auth.users(email, raw_user_meta_data) values ('junk@t.am', '{"marketing_consent":"да","consent_source":"signup_form"}') returning id`)).rows[0].id;
  check((await one(`select marketing_consent from profiles where id = $1`, [junk])).marketing_consent === false, 'D10: негодное значение согласия не роняет регистрацию');
}

// ================================================================ D11: история продажи
{
  const id = (await as('mgr', `insert into leads (name, phone, source, status, value) values ('D11', '+374 91 110011', 'walk_in', 'won', 300) returning id`)).rows[0].id;
  const first = (await db.query(`select kind, body, actor from lead_activity where lead_id = $1`, [id])).rows;
  check(first.length === 1 && first[0].kind === 'system' && first[0].body === 'Продажа внесена' && first[0].actor === U.mgr, 'D11: строку «Продажа внесена» пишет база, от имени того, кто внёс', first);
  await rejects('mgr', `insert into lead_activity(lead_id, actor, kind, body, created_at) values ($1, $2, 'system', 'Сумма согласована с владельцем', now() - interval '30 days')`, [id, U.mgr], 'row-level security', 'D11: менеджер не вставляет строку «system»');
  await as('mgr', `insert into lead_activity(lead_id, actor, kind, body, created_at) values ($1, $2, 'note', 'задним числом', now() - interval '30 days')`, [id, U.mgr]);
  const age = await val(`select extract(epoch from now() - created_at) from lead_activity where lead_id = $1 and kind = 'note'`, [id]);
  check(Number(age) < 60, 'D11: время записи ставит база — задним числом заметку не вписать', age);
  check(!/addActivity\(l\.id, 'system'/.test(src('js/admin/api.js')), 'D11: панель больше не пишет «system» сама');
}

// ================================================================ D12: check_coupon
{
  await calm(); await fromIp('203.0.113.99');
  let okN = 0, err = '';
  for (let i = 0; i < 12; i++) { try { await as('anon', `select check_coupon($1)`, ['GUESS' + i]); okN++; } catch (e) { err = e.message; } }
  check(okN === 10 && /rate_limited/.test(err), 'D12: check_coupon — 10 попыток в минуту с одного адреса, дальше rate_limited', [okN, err]);
  await fromIp('203.0.113.100');
  check((await as('anon', `select check_coupon('D1CODE') c`)).rows[0].c.valid === true, 'D12: другой посетитель в ту же минуту код проверяет');
  await headers(null);
  okN = 0; for (let i = 0; i < 12; i++) { try { await as('cli', `select check_coupon($1)`, ['GUESS' + i]); okN++; } catch (e) { /* лимит */ } }
  check(okN === 10, 'D12: у запроса без адреса счётчик — по пользователю', okN);
  await calm();
}

// ================================================================ D13: права на функции
{
  const can = async (role, sig) => val(`select has_function_privilege($1, $2, 'execute')`, [role, sig]);
  const closed = ['set_role(uuid, text)', 'row_history(text, uuid)', 'restore_version(bigint)', 'media_alive(text)', 'work_minutes(timestamptz, timestamptz)',
    'work_minutes(timestamptz, timestamptz, int[], time, time)', 'url_encode(text)', 'reminder_fill(text, text, text, text)', 'reminder_default(text, text)',
    'submit_lead(jsonb)', 'rate_take(text, text, integer, integer)', 'auth_user_by_email(text)', 'notify_claim(uuid, int)', 'wa_ref_lookup(text)', 'sender_hash()'];
  const open = [];
  for (const f of closed) if (await can('anon', 'public.' + f) || await can('public', 'public.' + f)) open.push(f);
  check(open.length === 0, 'D13: у гостя и у PUBLIC нет права вызова служебных функций', open);
  for (const f of ['set_role(uuid, text)', 'row_history(text, uuid)', 'restore_version(bigint)', 'check_coupon(text)', 'track(jsonb)', 'public_site()']) if (!(await can('authenticated', 'public.' + f))) bad('D13: вошедший потерял ' + f);
  check(await can('anon', 'public.track(jsonb)') && await can('anon', 'public.public_site()') && await can('anon', 'public.check_coupon(text)'), 'D13: сайту оставлено то, что он вызывает: public_site, track, check_coupon');
  await expectErr('anon', `select public.url_encode('x')`, [], 'D13: гость не вызывает url_encode');
  await expectErr('anon', `select public.reminder_default('bon_voyage', 'ru')`, [], 'D13: гость не вызывает reminder_default');
  // новая функция больше не получает право у PUBLIC сама
  await db.exec(`create function public.d13_probe() returns int language sql as 'select 1'`);
  check(!(await can('public', 'public.d13_probe()')), 'D13: у новой функции PUBLIC права вызова не получает (default privileges)');
  await db.exec(`drop function public.d13_probe()`);
}

// ================================================================ D14: ссылка на рилс
{
  await rejects('smm', `insert into reels(url) values ('https://www.instagram.com/reel/Cabc123/"><script>alert(1)</script>')`, [], 'reels_url_check', 'D14: хвост после правильного начала ссылки отклонён');
  await rejects('mkt', `insert into reels(url) values ('https://www.instagram.com/reel/Cabc123/?igsh=xyz')`, [], 'reels_url_check', 'D14: ссылка с параметрами отклонена (панель сохраняет чистую)');
  await as('smm', `insert into reels(url) values ('https://www.instagram.com/reel/Cabc123_-x/'), ('https://instagram.com/p/Cabc123')`);
  ok('D14: чистая ссылка на рилс и на публикацию сохраняется');
}

// ================================================================ D15: public_site
{
  await db.query(`update site_settings set value = value || '{"bank_account":"AM00 1234","director_phone":"+374 00","margin_pct":12,"currency":"USD"}' where key = 'company'`);
  const co = (await as('anon', `select public_site() s`)).rows[0].s.settings.company;
  check(Object.keys(co).sort().join() === 'insurance,legal_name,licence', 'D15: из реквизитов на сайт уходят только лицензия, страховка и название — новый ключ сам не утекает', Object.keys(co));
  const st = (await as('anon', `select public_site() s`)).rows[0].s;
  check(!('whatsapp' in st.settings) && Array.isArray(st.tours) && st.tours.length > 0 && 'contacts' in st.settings, 'D15: остальное public_site отдаёт как раньше');
}

await calm();
