// Этап 7: всё через WhatsApp (ТЗ §0 п.20–22, §4.11). Миграция 070_whatsapp.sql.
// Запуск: npm test  (или node supabase/test/run.mjs 70)
//
// Что проверяется:
//   1) тексты сообщений на трёх языках (js/wa.js) — слово в слово по таблице из ТЗ;
//   2) номер обращения: 5 знаков без похожих символов, производная от sid (js/track.js),
//      уходит в событии wa_click вместе с туром и местом нажатия;
//   3) база: track принимает ref, wa_ref(code) — только владельцу и менеджеру,
//      submit_lead у гостей отозвана;
//   4) продажа с номером обращения получает метки рекламы, тур, язык, устройство и промокод
//      с баннера, у кампании появляется +1 продажа;
//   5) на 1500 записях журнала цифры stats_sales / stats_traffic совпадают с прямым SQL,
//      с формулами демо-режима (js/admin/metrics.js) и с CSV-выгрузкой.
import fs from 'node:fs';
import vm from 'node:vm';
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const src = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const dataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
// модули панели написаны для браузера; так они грузятся одинаково в Node 20 и новее
const METRICS_URL = dataUrl(src('js/admin/metrics.js'));
const M = await import(METRICS_URL);
const D = await import(dataUrl(src('js/admin/demo.js').replace("'./metrics.js'", JSON.stringify(METRICS_URL)).replace("'./demo-seed.js'", JSON.stringify(dataUrl(src('js/admin/demo-seed.js'))))));

const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const val = async (sql, params) => Object.values(await one(sql, params))[0];
const near = (a, b, eps = 0.011) => (a == null || b == null ? a == null && b == null : Math.abs(Number(a) - Number(b)) <= eps);
const iso = (t) => new Date(t).toISOString();
const DAY = 86400e3;

// ================================================================ 1) тексты сообщений
{
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src('js/wa.js'), ctx);
  const W = ctx.SAM_WA;
  const want = [
    ['tour', 'ru', { tour: 'Шарм-эль-Шейх' }, 'Здравствуйте! Хочу спросить про тур «Шарм-эль-Шейх».'],
    ['tour', 'en', { tour: 'Sharm El Sheikh' }, "Hello! I'd like to ask about the Sharm El Sheikh tour."],
    ['tour', 'hy', { tour: 'Շարմ էլ Շեյխ' }, 'Բարև ձեզ։ Հետաքրքրում է «Շարմ էլ Շեյխ» տուրը։'],
    ['general', 'ru', {}, 'Здравствуйте! Хочу спросить про тур.'],
    ['general', 'en', {}, "Hello! I'd like to ask about a tour."],
    ['general', 'hy', {}, 'Բարև ձեզ։ Ուզում եմ հարցնել տուրի մասին։'],
    ['service', 'ru', { topic: 'visa' }, 'Здравствуйте! Хочу спросить про: визовая поддержка.'],
    ['service', 'en', { topic: 'insurance' }, "Hello! I'd like to ask about: travel insurance."],
    ['service', 'hy', { topic: 'corporate' }, 'Բարև ձեզ։ Հետաքրքրում է՝ կորպորատիվ ուղևորություններ։'],
    ['promo', 'ru', { coupon: 'AUTUMN7' }, 'Здравствуйте! Хочу спросить про тур.\nПромокод: AUTUMN7'],
    ['promo', 'en', { coupon: 'AUTUMN7' }, "Hello! I'd like to ask about a tour.\nPromo code: AUTUMN7"],
    ['promo', 'hy', { coupon: 'AUTUMN7' }, 'Բարև ձեզ։ Ուզում եմ հարցնել տուրի մասին։\nՊրոմոկոդ՝ AUTUMN7'],
  ];
  const wrong = want.filter(([k, l, o, t]) => W.text(k, l, o) !== t).map(([k, l, o]) => `${k}/${l}: ${W.text(k, l, o)}`);
  check(!wrong.length, `тексты WhatsApp: тур, общая кнопка, услуга и баннер с промокодом на RU / EN / HY (${want.length} фраз)`, wrong);
  check(W.text('tour', 'ru', { tour: 'Дубай', ref: 'K7M2X' }) === 'Здравствуйте! Хочу спросить про тур «Дубай».\n№ K7M2X', 'номер обращения — последней строкой сообщения');
  check(W.text('tour', 'ru', { tour: 'Дубай', coupon: 'NY2027', ref: 'K7M2X' }).endsWith('Промокод: NY2027\n№ K7M2X'), 'взятый с баннера промокод едет и в сообщении про тур');
  check(W.text('tour', 'ru', {}) === W.text('general', 'ru', {}) && W.text('general', 'xx', {}) === W.text('general', 'en', {}), 'нет названия тура → общий текст; неизвестный язык → английский');
  check(W.label('ru', 'Дубай') === 'Написать про Дубай' && W.label('en', 'Dubai') === 'Write about Dubai' && W.label('hy', 'Դուբայ') === 'Գրել «Դուբայ» տուրի մասին', 'кнопка в описании тура: «Написать про {тур}» на трёх языках');
  check(W.text('custom', 'ru', { body: 'Подбор тура\nКуда: Дубай', ref: 'K7M2X' }) === 'Подбор тура\nКуда: Дубай\n№ K7M2X', 'подбор тура: свой текст + номер обращения');
}

// ================================================================ 2) номер обращения на сайте (js/track.js)
function site(search) {
  const store = {}, handlers = {}, sent = [];
  const ctx = {
    Math, Date, JSON, URL, URLSearchParams, encodeURIComponent, console,
    location: { search, host: 'samtravel.am', pathname: '/' }, screen: { width: 390 }, innerWidth: 390, navigator: { userAgent: 'iPhone' },
    document: { referrer: 'https://www.google.com/search', documentElement: { lang: 'ru' }, readyState: 'complete', visibilityState: 'visible',
      addEventListener: (name, fn) => { handlers[name] = fn; }, getElementById: () => null },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    setInterval: () => 0, addEventListener: () => {},
    fetch: (url, o) => { sent.push(...JSON.parse(o.body).p_events); return Promise.resolve(); },
    SAM_SUPABASE: { url: 'http://db.test', anonKey: 'k' }, SAM_LANG: () => 'hy',
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src('js/track.js'), ctx);
  const click = (attrs, where) => {
    const a = { getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: () => (where ? { id: where } : null) };
    handlers.click({ target: { closest: () => a } });
  };
  return { ctx, click, sent, store };
}
{
  const s = site('?utm_source=instagram&utm_campaign=sharm_oct');
  const sid = s.ctx.SAM_TRACK_CTX().sid, ref = s.ctx.SAM_REF;
  check(/^[2-9A-HJKMNP-Z]{5}$/.test(ref) && ref === M.refOf(sid), `номер обращения: 5 знаков без 0/O и 1/I/L, производная от sid (${sid} → ${ref}); в панели считается так же`, ref);
  s.click({ href: 'https://wa.me/37455957585?text=x', 'data-wa-tour': 'sharm' }, 'carou-stage');
  s.click({ href: 'https://wa.me/37455957585?text=x' }, 'topbar');
  s.click({ href: 'tel:+37455957585' }, 'contacts');
  s.ctx.SAM_TRACK_ENABLE();
  const wa = s.sent.filter((e) => e.name === 'wa_click'), tel = s.sent.filter((e) => e.name === 'tel_click');
  check(wa.length === 2 && wa[0].ref === ref && wa[0].tour === 'sharm' && wa[0].label === 'carou-stage' && wa[0].utm_campaign === 'sharm_oct' && wa[0].lang === 'hy' && wa[0].device === 'mobile',
    'нажатие WhatsApp на карточке тура → wa_click с номером, туром, местом, меткой рекламы, языком и устройством', wa[0]);
  check(wa[1].ref === ref && !wa[1].tour && tel.length === 1 && !tel[0].ref, 'общая кнопка — тот же номер без тура; у звонка номера нет');
  const set = new Set(); for (let i = 0; i < 300; i++) set.add(site('').ctx.SAM_REF);
  check(set.size >= 299, 'у разных визитов разные номера', set.size);
  // демо-сайт: ничего не отправляет, клик остаётся в браузере для демо-панели
  const d = site('?cms=demo');
  d.click({ href: 'https://wa.me/37455957585?text=x', 'data-wa-tour': 'dubai' }, 'sheet');
  d.ctx.SAM_TRACK_ENABLE();
  const kept = JSON.parse(d.store['sam-demo-wa'] || '[]');
  check(d.sent.length === 0 && kept.length === 1 && kept[0].ref === d.ctx.SAM_REF && kept[0].tour === 'dubai', '?cms=demo: событие не уходит в базу, клик с номером остаётся в браузере для демо-панели', kept);
  const found = D.waRefLookup(kept, [], kept[0].ref.toLowerCase());
  check(found && found.tour === 'dubai' && found.channel === 'google.com' && found.lang === 'hy', 'демо-панель находит этот клик по номеру', found);
}

// ================================================================ 3) база: ref_norm, track, wa_ref, submit_lead
{
  const cases = [['k7m2x', 'K7M2X'], [' № K7M2X ', 'K7M2X'], ['К7М2Х', 'K7M2X'], ['k7-m2 x', 'K7M2X'], ['', null], [null, null]];
  const out = [];
  for (const [inp, want] of cases) { const sql = await val(`select public.ref_norm($1) r`, [inp]); if (sql !== want || M.refNorm(inp) !== want) out.push([inp, sql, M.refNorm(inp)]); }
  check(!out.length, 'номер из чата: регистр, «№», пробелы и русская раскладка не мешают (в базе и в панели одинаково)', out);
  const oks = [['K7M2X', true], ['K7M2', false], ['K7M2XX', false], ['K7M0X', false], ['K7MIX', false], ['K7MLX', false], ['k7m2x', false]];
  const bads = [];
  for (const [inp, want] of oks) { const sql = await val(`select public.ref_ok($1) r`, [inp]); if (sql !== want || M.refOk(inp) !== want) bads.push(inp); }
  check(!bads.length, 'ref_ok: ровно 5 знаков алфавита без 0, O, 1, I, L', bads);
}
const promoId = (await one(`insert into promos (kind, name, coupon_code, active) values ('bar', 'Осень', 'AUTUMN7', true) returning id`)).id;
await db.query(`insert into coupons (code, discount_pct, active) values ('AUTUMN7', 7, true)`);
await db.query(`insert into campaigns (name, channel, utm_source, utm_medium, utm_campaign, spend) values ('Шарм', 'instagram', 'instagram', 'paid_social', 'sharm_oct', 450)`);
const visit = { sid: 'visitaaaa001', lang: 'hy', device: 'mobile', utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'sharm_oct', utm_content: 'reels_v2' };
const REF = M.refOf(visit.sid);
{
  await as('anon', `select track($1)`, [JSON.stringify([
    { ...visit, name: 'page_view' }, { ...visit, name: 'tour_open', tour: 'sharm' },
    { ...visit, name: 'wa_click', tour: 'sharm', label: 'sheet', ref: REF, promo_id: promoId },
    { ...visit, name: 'wa_click', label: 'topbar', ref: REF },
    { ...visit, name: 'tel_click', label: 'contacts', ref: REF },              // номер — только у wa_click
    { sid: 'visitbbbb002', name: 'wa_click', ref: 'k7m2x' }, { sid: 'visitbbbb002', name: 'wa_click', ref: 'K7M0X' }, { sid: 'visitbbbb002', name: 'wa_click', ref: 'K7M2XZZ' },
  ])]);
  const rows = (await db.query(`select name, ref, tour, label from events order by id`)).rows;
  check(rows.filter((r) => r.ref === REF).length === 2 && rows.filter((r) => r.name === 'tel_click')[0].ref === null, 'track: номер обращения записан у обоих wa_click, у tel_click — нет', rows);
  // Этап 10 (100_security.sql, AUDIT D7): номер считает база из sid визита, присланный не читается —
  // поэтому у чужого визита свой номер, какой бы он ни прислал.
  const other = rows.filter((r) => r.ref !== null && r.ref !== REF);
  check(rows.filter((r) => r.name === 'wa_click').length === 5 && other.length === 3 && other.every((r) => r.ref === M.refOf('visitbbbb002')), 'track: присланный номер не читается — у клика номер его собственного визита', other);

  const r = (await as('owner', `select public.wa_ref($1) r`, [REF])).rows[0].r;
  check(r && r.ref === REF && r.utm_source === 'instagram' && r.utm_campaign === 'sharm_oct' && r.utm_medium === 'paid_social' && r.utm_content === 'reels_v2'
    && r.channel === 'instagram' && r.lang === 'hy' && r.device === 'mobile' && r.clicks === 2,
    'wa_ref: метки рекламы, канал, язык, устройство, число кликов', r);
  check(r.label === 'topbar' && r.tour === 'sharm' && r.coupon_code === 'AUTUMN7', 'wa_ref: время и место — последнего клика; тур и промокод с баннера — из клика, где они были', r);
  const viaMgr = (await as('mgr', `select public.wa_ref($1) r`, [' № ' + REF.toLowerCase()])).rows[0].r;
  check(viaMgr && viaMgr.ref === REF, 'wa_ref: менеджер находит номер, набранный строчными и с «№»');
  check((await as('owner', `select public.wa_ref('ZZZZZ') r`)).rows[0].r === null && (await as('owner', `select public.wa_ref('мусор') r`)).rows[0].r === null, 'wa_ref: нет такого номера → null, а не ошибка');
  for (const who of ['anon', 'cli', 'mkt']) await expectErr(who, `select public.wa_ref($1)`, [REF], `${who}: wa_ref закрыт`);
  for (const who of ['anon', 'cli', 'mkt', 'mgr', 'owner']) await expectErr(who, `select public.wa_ref_lookup($1)`, [REF], `${who}: wa_ref_lookup — только изнутри базы`);
  // то же правило в демо-режиме
  const evRows = (await db.query(`select * from events order by id`)).rows, promos = (await db.query(`select * from promos`)).rows;
  const js = D.waRefLookup(evRows, promos, REF);
  const same = ['ref', 'label', 'lang', 'device', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref_host', 'channel', 'tour', 'coupon_code', 'clicks'].filter((k) => (js[k] ?? null) !== (r[k] ?? null));
  check(!same.length, 'демо-режим отвечает на wa_ref так же, как база', same);

  // старше 90 дней — не находится
  await db.query(`insert into events (ts, sid, name, ref, utm_campaign) values (now() - interval '91 days', 'visitcccc003', 'wa_click', $1, 'old')`, [M.refOf('visitcccc003')]);
  check((await as('owner', `select public.wa_ref($1) r`, [M.refOf('visitcccc003')])).rows[0].r === null, 'wa_ref: клик старше 90 дней не находится');
  check(D.waRefLookup((await db.query(`select * from events`)).rows, promos, M.refOf('visitcccc003')) === null, '  в демо-режиме так же');

  await expectErr('anon', `select public.submit_lead($1)`, [JSON.stringify({ name: 'Гость', phone: '+374 91 000111' })], 'гость: submit_lead отозвана — формы на сайте нет');
  check(Number(await val(`select count(*) from leads`)) === 0 && (await val(`select to_regprocedure('public.submit_lead(jsonb)') is not null x`)) === true, 'заявок нет; сама функция осталась в базе на случай возврата формы');
  await as('anon', `select public.track('[]')`); ok('track гостю по-прежнему доступна');
}

// ================================================================ 4) продажа с номером обращения
const range = [iso(Date.now() - 30 * DAY), iso(Date.now() + 60e3)];
const campaign = async () => (await as('mkt', `select public.stats_traffic($1, $2) s`, range)).rows[0].s.campaigns.find((c) => c.campaign === 'sharm_oct');
{
  const before = await campaign();
  check(before.visits === 1 && before.contacts === 3 && before.won === 0, 'кампания до продажи: 1 посещение, 3 обращения (2 WhatsApp + звонок), 0 продаж', before);
  const used0 = Number(await val(`select used_count from coupons where code = 'AUTUMN7'`));
  // владелец вписывает номер так, как видит в чате; источник выбирает неверно — база поправит.
  // Этап 10 (AUDIT D7): промокод с баннера база в продажу больше не подставляет — форма показывает
  // его подсказкой, и вписывает его человек (что без него код не появляется, проверяет 100-security).
  const s = (await as('owner', `insert into leads (name, phone, source, status, value, profit, ref, coupon_code) values ('Гаяне', '+374 91 555001', 'phone', 'won', 2000, 250, $1, 'AUTUMN7') returning *`, [' № ' + REF.toLowerCase()])).rows[0];
  check(s.ref === REF && s.source === 'manual' && s.utm_source === 'instagram' && s.utm_medium === 'paid_social' && s.utm_campaign === 'sharm_oct' && s.utm_content === 'reels_v2',
    'продажа с номером обращения: источник WhatsApp, метки рекламы — из визита', [s.ref, s.source, s.utm_campaign]);
  check(s.tour === 'sharm' && s.lang === 'hy' && s.device === 'mobile' && s.coupon_code === 'AUTUMN7' && s.details.ref_label === 'topbar' && !!s.details.ref_at, 'тур, язык и устройство подставлены, вписанный промокод сохранён; в карточке — когда и где нажали', [s.tour, s.lang, s.device, s.coupon_code, s.details]);
  check((await val(`select public.lead_channel(l) c from leads l where id = $1`, [s.id])) === 'instagram' && M.leadChannel(s) === 'instagram', 'канал продажи с номером — канал визита (в базе и в панели)');
  check(Number(await val(`select used_count from coupons where code = 'AUTUMN7'`)) === used0 + 1, 'вписанный промокод засчитан как использованный');
  const after = await campaign();
  check(after.won === before.won + 1 && near(after.revenue, 2000) && near(after.profit_total, 250) && after.estimated === false, 'у кампании +1 продажа, выручка и доход', after);
  const k = (await as('owner', `select public.stats_sales($1, $2) s`, range)).rows[0].s;
  check(k.kpi.sales === 1 && k.kpi.sales_ref === 1 && k.kpi.contacts === 5 + 1 && near(k.kpi.conversion, 1 / 6, 1e-9) && k.channels.find((c) => c.channel === 'instagram').sales === 1
    && k.tours.find((t) => t.tour === 'sharm').opens === 1 && k.tours.find((t) => t.tour === 'sharm').contacts === 1 && k.tours.find((t) => t.tour === 'sharm').sales === 1,
    'сводка: продажа в канале рекламы, конверсия = продажи ÷ обращения, тур: открыли → написали → купили', k.kpi);

  // то же в демо-режиме
  const evRows = (await db.query(`select * from events order by id`)).rows, promos = (await db.query(`select * from promos`)).rows;
  const lookup = (ref) => D.waRefLookup(evRows, promos, ref);
  const js = D.attributeLead(null, { name: 'Гаяне', source: 'phone', ref: ' № ' + REF.toLowerCase(), coupon_code: 'AUTUMN7', details: {} }, lookup);
  check(['ref', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'tour', 'lang', 'device', 'coupon_code', 'referrer'].every((f) => (js[f] ?? null) === (s[f] ?? null)), 'демо-режим подставляет в продажу то же самое', js);

  // тур и промокод, вписанные руками, важнее
  const own = (await as('mgr', `insert into leads (name, phone, source, status, value, tour, coupon_code, ref) values ('Свой тур', '+374 91 555002', 'manual', 'won', 900, 'dubai', 'VIP', $1) returning *`, [REF])).rows[0];
  check(own.tour === 'dubai' && own.coupon_code === 'VIP' && own.utm_campaign === 'sharm_oct', 'тур и промокод, вписанные руками, не заменяются');
  // без номера — источник выбирает владелец
  const call = (await as('owner', `insert into leads (name, phone, source, status, value) values ('Звонок', '+374 91 555003', 'phone', 'won', 700) returning *`)).rows[0];
  check(call.ref === null && call.source === 'phone' && call.utm_campaign === null && (await val(`select public.lead_channel(l) c from leads l where id = $1`, [call.id])) === 'manual:phone', 'продажа без номера: источник — какой выбрали, свой канал «Звонок»');
  check((await campaign()).won === 2, 'продажа без номера кампании не засчитывается');

  await expectErr('owner', `insert into leads (name, phone, source, status, value, ref) values ('Нет', '+374 91 555004', 'manual', 'won', 500, 'ZZZZZ')`, [], 'номер, которого нет, → ref_not_found');
  await expectErr('owner', `insert into leads (name, phone, source, status, value, ref) values ('Нет', '+374 91 555004', 'manual', 'won', 500, 'K7M')`, [], 'номер не из 5 знаков → ref_invalid');
  for (const [ref, code] of [['ZZZZZ', 'ref_not_found'], ['K7M', 'ref_invalid']]) {
    let m = ''; try { D.attributeLead(null, { ref, details: {} }, lookup); } catch (e) { m = e.message; }
    check(m === code, `  демо-режим: ${code}`, m);
  }

  // номер дописали позже — метки появились; стёрли — снялись
  await as('owner', `update leads set ref = $2 where id = $1`, [call.id, REF]);
  let c = await one(`select * from leads where id = $1`, [call.id]);
  check(c.utm_campaign === 'sharm_oct' && c.source === 'manual' && (await campaign()).won === 3, 'номер дописали в карточке → продажа перешла к кампании');
  await as('owner', `update leads set ref = null where id = $1`, [call.id]);
  c = await one(`select * from leads where id = $1`, [call.id]);
  check(c.ref === null && c.utm_campaign === null && c.utm_source === null && !('ref_at' in c.details) && (await campaign()).won === 2, 'номер стёрли → метки сняты, у кампании продажа ушла');
  const jsOff = D.attributeLead({ ...own }, { ...own, ref: null }, lookup);
  check(jsOff.utm_campaign === null && jsOff.referrer === null && !('ref_at' in jsOff.details), '  в демо-режиме так же');
  // правка другой колонки метки не трогает, даже когда события уже нет
  await db.query(`delete from events where ref = $1`, [REF]);
  await as('owner', `update leads set value = 2100 where id = $1`, [s.id]);
  check((await val(`select utm_campaign from leads where id = $1`, [s.id])) === 'sharm_oct', 'правка суммы не трогает записанные метки, даже когда событие уже не найти');

  // возврат убирает продажу у кампании и освобождает промокод
  const usedSold = Number(await val(`select used_count from coupons where code = 'AUTUMN7'`));
  await as('owner', `update leads set status = 'lost', lost_reason = 'Возврат' where id = $1`, [s.id]);
  const back = (await as('owner', `select public.stats_sales($1, $2) s`, range)).rows[0].s;
  check((await campaign()).won === 1 && back.kpi.refunds === 1 && back.refund_reasons[0].reason === 'Возврат' && Number(await val(`select used_count from coupons where code = 'AUTUMN7'`)) === usedSold - 1,
    'возврат: продажа ушла из кампании и выручки, причина — в причинах возвратов, промокод свободен');
  await db.exec(`delete from leads; delete from events;`);
}

// ================================================================ 5) 1500 записей журнала
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20261007);
const pick = (a) => a[Math.floor(R() * a.length)];
const now = Date.now(), N = 1500, SPAN = 420;
const CAMPAIGNS = [['instagram', 'sharm_oct'], ['facebook', 'dubai_nov'], ['google', 'search_yvn'], ['newsletter', 'winter_mail']];
const HOSTS = [null, null, 'google.com', 'instagram.com', 'samtravel.am'];
const REASONS = ['Возврат', 'Клиент передумал', 'Отказ в визе', ''];
const TOURS = ['dubai', 'sharm', 'maldives'];
await db.query(`insert into coupons (code, discount_pct, active) values ('WINTER10', 10, true)`);
const clicks = [];   // визиты с кликом в WhatsApp: из них получаются продажи с номером
{
  const ev = [];
  for (let i = 0; i < 6000; i++) {
    const camp = R() < 0.35 ? pick(CAMPAIGNS) : null;
    const t = now - R() * 60 * DAY, sid = 's' + String(1e7 + i) + 'abc';
    const base = { ts: iso(t), sid, device: pick(['mobile', 'mobile', 'desktop', null]), lang: pick(['ru', 'hy', 'en']), utm_source: camp ? camp[0] : R() < 0.03 ? 'flyer' : null, utm_campaign: camp ? camp[1] : null, ref_host: camp ? null : pick(HOSTS) };
    ev.push({ ...base, name: 'page_view' });
    if (R() < 0.7) ev.push({ ...base, name: 'section_view', section: 'band-prices' });
    if (R() < 0.5) ev.push({ ...base, name: 'section_view', section: 'hot' });
    const tour = R() < 0.25 ? pick(TOURS) : null;
    if (tour) ev.push({ ...base, name: 'tour_open', tour });
    if (R() < 0.05) ev.push({ ...base, name: 'plan_open' });
    if (R() < 0.3) { ev.push({ ...base, name: 'promo_view', promo_id: promoId }); if (R() < 0.1) ev.push({ ...base, name: 'promo_click', promo_id: promoId }); else if (R() < 0.2) ev.push({ ...base, name: 'promo_close', promo_id: promoId }); }
    if (R() < 0.02) ev.push({ ...base, name: 'tel_click', label: 'contacts' });
    if (R() < 0.1) {
      const about = tour && R() < 0.7 ? tour : null;
      ev.push({ ...base, name: 'wa_click', tour: about, label: about ? 'sheet' : 'topbar', ref: M.refOf(sid), promo_id: R() < 0.1 ? promoId : null });
      clicks.push({ ...base, t, tour: about, ref: M.refOf(sid) });
    }
  }
  await db.query(`insert into events (ts, sid, name, section, tour, promo_id, label, device, lang, utm_source, utm_campaign, ref_host, ref)
    select * from jsonb_to_recordset($1::jsonb) as x(ts timestamptz, sid text, name text, section text, tour text, promo_id uuid, label text, device text, lang text, utm_source text, utm_campaign text, ref_host text, ref text)`, [JSON.stringify(ev)]);
}
{
  const rows = [];
  for (let i = 0; i < N; i++) {
    const c = R() < 0.45 ? pick(clicks) : null;              // с номером обращения
    const sold = c ? Math.min(now, c.t + R() * 20 * DAY) : now - R() * SPAN * DAY;
    const refund = R() < 0.12;
    const value = Math.round(500 + R() * 4000);
    rows.push({
      created_at: iso(sold), name: 'ZZNAME ' + i, phone: '+374 77 ' + String(500000 + i), message: 'ZZWHAT ' + i,
      source: c ? 'manual' : pick(['phone', 'walk_in', 'instagram', 'manual']), ref: c ? c.ref : null,
      tour: c && c.tour ? c.tour : R() < 0.4 ? pick(TOURS) : null,
      referrer: c && c.ref_host ? 'https://' + c.ref_host + '/' : null, utm_source: c ? c.utm_source : null, utm_campaign: c ? c.utm_campaign : null,
      coupon_code: R() < 0.1 ? pick(['WINTER10', 'autumn7', 'TYPO']) : null,
      status: refund ? 'lost' : 'won', lost_reason: refund ? pick(REASONS) : null,
      value, profit: R() < 0.7 ? Math.round(value * (0.06 + R() * 0.1) * 100) / 100 : null,
      assigned_to: pick([U.owner, U.owner, U.mgr, null]),
      closed_at: iso(refund ? Math.min(now, sold + R() * 10 * DAY) : sold),
    });
  }
  // Готовые данные кладём мимо сторожей (иначе не задать прошлые даты и номера старше 90 дней).
  await db.exec(`set session_replication_role = replica`);
  await db.query(`insert into leads (created_at, name, phone, message, source, ref, tour, referrer, utm_source, utm_campaign, coupon_code, status, lost_reason, value, profit, assigned_to, closed_at)
    select * from jsonb_to_recordset($1::jsonb) as x(created_at timestamptz, name text, phone text, message text, source text, ref text, tour text, referrer text, utm_source text, utm_campaign text,
      coupon_code text, status text, lost_reason text, value numeric, profit numeric, assigned_to uuid, closed_at timestamptz)`, [JSON.stringify(rows)]);
  await db.exec(`set session_replication_role = origin`);
  check(Number(await val(`select count(*) from leads`)) === N, `в журнале ${N} записей, из них с номером обращения ${rows.filter((r) => r.ref).length}`);
}
const settings = Object.fromEntries((await db.query(`select key, value from site_settings`)).rows.map((r) => [r.key, r.value]));
const users = (await db.query(`select p.id, p.full_name, u.email from profiles p join auth.users u on u.id = p.id`)).rows;
const leadRows = (await as('mgr', `select * from leads`)).rows;       // то, что получает панель
const eventRows = (await db.query(`select * from events`)).rows;
const yMidnight = (t) => new Date(new Date(new Date(t).getTime() + 4 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+04:00').getTime();
const first = new Date(await val(`select min(closed_at) from leads`)).getTime();
const WINDOWS = [
  ['всё время', yMidnight(first), yMidnight(now) + DAY],
  ['30 дней по суткам', yMidnight(now) - 29 * DAY, yMidnight(now) + DAY],
  ['90 дней от этой минуты', now - 90 * DAY, now],
  ['прошлый период', now - 60 * DAY, now - 30 * DAY],
];
const csvCols = M.saleCsvColumns({ channelName: (s) => s, tourName: (s) => s, staffName: (id) => id, currency: 'USD' });
const csv = leadRows.map((l) => Object.fromEntries(csvCols.map(([name, fn]) => [name, fn(l)])));
const byKey = (xs, key) => Object.fromEntries(xs.map((x) => [typeof key === 'function' ? key(x) : x[key], x]));
function differ() {
  const diff = [];
  const cmp = (path, a, b) => {
    if (a != null && b != null && typeof a === 'object' && typeof b === 'object') {
      if (Array.isArray(a) !== Array.isArray(b) || (Array.isArray(a) && a.length !== b.length)) return diff.push(path + ': длина ' + (a.length ?? '?') + ' ≠ ' + (b.length ?? '?'));
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) cmp(path + '.' + key, a[key], b[key]);
    } else if (typeof a === 'number' || typeof b === 'number') { if (!near(a, b, 0.011)) diff.push(`${path}: ${a} ≠ ${b}`); }
    else if ((a ?? null) !== (b ?? null)) diff.push(`${path}: ${a} ≠ ${b}`);
  };
  return { diff, cmp };
}

for (const [label, f, t] of WINDOWS) {
  const P = [iso(f), iso(t)];
  const s = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s, k = s.kpi;

  // ---- прямой SQL, без функций отчёта ----
  const q = await one(`
    select (select count(*) from leads where status = 'won' and value > 0 and closed_at >= $1 and closed_at < $2) as sales,
           (select count(*) from leads where status = 'won' and value > 0 and ref is not null and closed_at >= $1 and closed_at < $2) as sales_ref,
           (select count(*) from leads where status = 'lost' and closed_at >= $1 and closed_at < $2) as refunds,
           (select coalesce(sum(value), 0) from leads where status = 'won' and value > 0 and closed_at >= $1 and closed_at < $2) as revenue,
           (select coalesce(sum(coalesce(profit, value * 12 / 100)), 0) from leads where status = 'won' and value > 0 and closed_at >= $1 and closed_at < $2) as profit,
           (select count(*) from leads where status = 'won' and value > 0 and profit is null and closed_at >= $1 and closed_at < $2) as est,
           (select count(*) from events where name = 'page_view' and ts >= $1 and ts < $2) as visits,
           (select count(*) from events where name = 'wa_click' and ts >= $1 and ts < $2) as wa,
           (select count(*) from events where name = 'tel_click' and ts >= $1 and ts < $2) as tel`, P);
  const contacts = Number(q.wa) + Number(q.tel);
  const sqlOk = Number(q.sales) === k.sales && Number(q.sales_ref) === k.sales_ref && Number(q.refunds) === k.refunds && near(q.revenue, k.revenue) && near(q.profit, k.profit)
    && Number(q.est) === k.sales_estimated && Number(q.visits) === k.visits && contacts === k.contacts && Number(q.wa) === k.wa_clicks && Number(q.tel) === k.tel_clicks
    && near(k.conversion, contacts ? Number(q.sales) / contacts : null, 1e-9) && near(k.visit_to_contact, Number(q.visits) ? contacts / Number(q.visits) : null, 1e-9)
    && near(k.avg_check, Number(q.sales) ? Number(q.revenue) / Number(q.sales) : null);
  check(sqlOk, `${label}: сводка = прямой SQL (посещений ${k.visits}, обращений ${k.contacts}, продаж ${k.sales}, из них с номером ${k.sales_ref}, выручка ${k.revenue}, доход ${k.profit}${k.estimated ? ' ≈' : ''})`, { sql: q, kpi: k });

  // ---- формулы демо-режима: stats_sales ----
  const js = M.salesStats({ leads: leadRows, events: eventRows, users, settings, from: f, to: t });
  let d = differ();
  d.cmp('kpi', s.kpi, js.kpi); d.cmp('daily', s.daily, js.daily);
  d.cmp('managers', byKey(s.managers, 'id'), byKey(js.managers, 'id'));
  d.cmp('refund_reasons', byKey(s.refund_reasons, 'reason'), byKey(js.refund_reasons, 'reason'));
  d.cmp('channels', byKey(s.channels, 'channel'), byKey(js.channels, 'channel'));
  d.cmp('tours', byKey(s.tours, 'tour'), byKey(js.tours, 'tour'));
  d.cmp('contact_heat', byKey(s.contact_heat, (c) => c.dow + ':' + c.h), byKey(js.contact_heat, (c) => c.dow + ':' + c.h));
  d.cmp('head', [s.currency, s.margin_pct], [js.currency, js.margin_pct]);
  check(!d.diff.length, `${label}: stats_sales = формулы демо-режима (дни: ${s.daily.length}, каналы: ${s.channels.length}, туры: ${s.tours.length})`, d.diff.slice(0, 6));

  const sumBy = (xs, key) => xs.reduce((a, x) => a + Number(x[key]), 0);
  check(sumBy(s.daily, 'sales') === k.sales && near(sumBy(s.daily, 'revenue'), k.revenue) && near(sumBy(s.daily, 'profit'), k.profit, 0.01 * s.daily.length) && sumBy(s.daily, 'contacts') === k.contacts
    && sumBy(s.daily, 'visits') === k.visits && sumBy(s.channels, 'sales') === k.sales && sumBy(s.channels, 'contacts') === k.contacts && sumBy(s.refund_reasons, 'n') === k.refunds,
    `${label}: дни, каналы и причины возвратов в сумме дают итог`);

  // ---- формулы демо-режима: stats_traffic ----
  const tr = (await as('mkt', `select public.stats_traffic($1, $2) s`, P)).rows[0].s;
  const jt = M.trafficStats({ leads: leadRows, events: eventRows, settings, from: f, to: t });
  d = differ();
  d.cmp('daily', tr.daily, jt.daily);
  d.cmp('sources', byKey(tr.sources, 'src'), byKey(jt.sources, 'src'));
  d.cmp('campaigns', byKey(tr.campaigns, 'campaign'), byKey(jt.campaigns, 'campaign'));
  d.cmp('tours', byKey(tr.tours, 'tour'), byKey(jt.tours, 'tour'));
  d.cmp('heat', byKey(tr.heat, (c) => c.dow + ':' + c.h), byKey(jt.heat, (c) => c.dow + ':' + c.h));
  d.cmp('contact_heat', byKey(tr.contact_heat, (c) => c.dow + ':' + c.h), byKey(jt.contact_heat, (c) => c.dow + ':' + c.h));
  d.cmp('promos', byKey(tr.promos, 'id'), byKey(jt.promos, 'id'));
  for (const key of ['devices', 'langs', 'sections', 'ctas', 'funnel']) d.cmp(key, tr[key], jt[key]);
  d.cmp('head', [tr.margin_pct, tr.raw_from], [jt.margin_pct, jt.raw_from]);
  check(!d.diff.length && tr.funnel.won === k.sales && tr.funnel.won_ref === k.sales_ref && Number(tr.funnel.visits) === k.visits,
    `${label}: stats_traffic = формулы демо-режима; продаж и посещений столько же, сколько в сводке (каналы: ${tr.sources.length}, кампании: ${tr.campaigns.length})`, d.diff.slice(0, 6));

  // кампании: продажи и доход по номеру обращения — прямой SQL
  const cq = (await db.query(`
    select utm_campaign k, count(*) won, coalesce(sum(value), 0) revenue, coalesce(sum(coalesce(profit, value * 12 / 100)), 0) profit_total, count(*) filter (where profit is null) > 0 estimated
    from leads where status = 'won' and value > 0 and utm_campaign is not null and closed_at >= $1 and closed_at < $2 group by 1`, P)).rows;
  const eq = (await db.query(`select utm_campaign k, count(*) filter (where name = 'page_view') visits, count(*) filter (where name in ('wa_click', 'tel_click')) contacts
    from events where utm_campaign is not null and ts >= $1 and ts < $2 group by 1`, P)).rows;
  check(cq.every((c) => { const x = tr.campaigns.find((y) => y.campaign === c.k); return x && Number(c.won) === x.won && near(c.revenue, x.revenue) && near(c.profit_total, x.profit_total) && c.estimated === x.estimated; })
    && eq.every((c) => { const x = tr.campaigns.find((y) => y.campaign === c.k); return x && Number(c.visits) === x.visits && Number(c.contacts) === x.contacts; }),
    `${label}: кампании — посещения, обращения, продажи и доход = прямой SQL (${tr.campaigns.length} кампаний)`);

  // ---- CSV-выгрузка (только для окон по границам суток: в файле даты, а не минуты) ----
  if (label === 'всё время' || label === '30 дней по суткам') {
    const d1 = M.ymd(f), d2 = M.ymd(t - 1), inDays = (x) => x !== '' && x >= d1 && x <= d2;
    const sales = csv.filter((r) => r['Продажа'] === 'да' && inDays(r['Дата продажи']));
    const cRev = sales.reduce((a, r) => a + Number(r['Сумма']), 0);
    const cProfit = sales.reduce((a, r) => a + (r['Доход агентства'] == null ? Number(r['Сумма']) * 12 / 100 : Number(r['Доход агентства'])), 0);
    const cRef = csv.filter((r) => inDays(r['Дата возврата'])).length;
    check(sales.length === k.sales && near(cRev, k.revenue) && near(cProfit, k.profit) && cRef === k.refunds && sales.filter((r) => r['Номер обращения']).length === k.sales_ref,
      `${label}: CSV-выгрузка даёт те же цифры (продаж ${sales.length}, выручка ${cRev}, возвратов ${cRef})`, { n: sales.length, cRev, cProfit, cRef });
  }
  if (label === 'всё время') {
    const man = tr.sources.filter((x) => x.src.startsWith('manual:'));
    check(man.length === 4 && man.every((x) => x.visits === 0 && x.contacts === 0 && x.won > 0), 'продажи без номера — четыре своих канала (WhatsApp, звонок, визит, Instagram) без посещений');
    const direct = tr.sources.find((x) => x.src === 'direct');
    const dq = Number(await val(`select count(*) from leads where status = 'won' and ref is not null and utm_source is null and (referrer is null or referrer like 'https://samtravel.am/%')`));
    check(direct.won === dq && dq > 0, `«прямые заходы»: только продажи с номером обращения без метки и чужого домена (${dq})`, [direct.won, dq]);
    check(tr.margin_pct === 12 && tr.raw_from === null && !('leads' in tr.funnel) && !('lead_heat' in tr) && !tr.sources.some((x) => 'leads' in x), 'слова «заявки» в ответе stats_traffic больше нет');
    check(!('leads' in k) && !('resp_median_min' in k) && !('within_sla' in k) && !('forecast' in k) && !('open' in k) && !('sla_min' in s), 'в сводке нет первого ответа, норматива, прогноза и открытых заявок');
  }
}

// ================================================================ маржа не задана → оценка по 10 %
{
  await db.query(`update site_settings set value = value - 'margin_pct' where key = 'company'`);
  const P = [iso(now - 30 * DAY), iso(now)];
  const s = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s;
  const want = await val(`select coalesce(sum(coalesce(profit, value * 10 / 100)), 0) from leads where status = 'won' and value > 0 and closed_at >= $1 and closed_at < $2`, P);
  const js = M.salesStats({ leads: leadRows, events: eventRows, users, settings: { ...settings, company: { ...settings.company, margin_pct: undefined } }, from: now - 30 * DAY, to: now });
  check(s.margin_pct === 10 && near(s.kpi.profit, want) && near(js.kpi.profit, want) && s.kpi.estimated === true, 'маржа не задана → продажи без дохода оцениваются по 10 %, пометка «оценка» остаётся; в демо-формулах так же', [s.kpi.profit, want, js.kpi.profit]);
  await db.query(`update site_settings set value = value || '{"margin_pct": 12}' where key = 'company'`);
}

// ================================================================ права и персональные данные
{
  const P = [iso(now - 60 * DAY), iso(now)];
  for (const who of ['owner', 'mgr', 'mkt']) {
    const s = JSON.stringify((await as(who, `select public.stats_sales($1, $2) a, public.stats_traffic($1, $2) b`, P)).rows[0]);
    check(!s.includes('ZZNAME') && !s.includes('ZZWHAT') && !/77\s?5\d{5}/.test(s) && !s.includes('+374'), `${who}: в stats_* нет имён, телефонов и текста продаж`);
  }
  for (const who of ['anon', 'cli']) {
    await expectErr(who, `select public.stats_sales($1, $2)`, P, `${who}: stats_sales закрыт`);
    await expectErr(who, `select public.stats_traffic($1, $2)`, P, `${who}: stats_traffic закрыт`);
    await expectErr(who, `select * from public.stats_events($1, $2)`, P, `${who}: stats_events закрыт`);
  }
  await expectErr('mkt', `select * from public.stats_events($1, $2)`, P, 'stats_events — только изнутри базы');
  check((await as('mkt', `select count(*)::int n from leads`)).rows[0].n === 0, 'маркетолог по-прежнему не читает журнал продаж');
  check((await as('anon', `select count(*)::int n from events`)).rows[0].n === 0, 'гость не читает события (и чужие номера обращений)');
}

// ================================================================ скорость (ТЗ §8: stats_* ≤ 1 с)
{
  const P = [iso(yMidnight(first)), iso(now)];
  const t0 = performance.now();
  await as('owner', `select public.stats_sales($1, $2)`, P);
  const t1 = performance.now();
  await as('owner', `select public.stats_traffic($1, $2)`, P);
  const t2 = performance.now();
  check(t1 - t0 < 3000 && t2 - t1 < 3000, `«всё время» на ${N} записях и ${eventRows.length} событиях: stats_sales ${Math.round(t1 - t0)} мс, stats_traffic ${Math.round(t2 - t1)} мс (база в памяти, без запаса не сравнивать с боевой)`);
}
