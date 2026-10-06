// Этап 3: цифры панели считает база. Миграция 030_stats.sql.
// Запуск: npm test  (или node supabase/test/run.mjs 30)
//
// Этап 7 (070_whatsapp.sql) заменил stats_sales и stats_traffic: заявок с сайта больше нет,
// считаются посещения → обращения → продажи. Сверка новых цифр с прямым SQL, с формулами
// демо-режима и с CSV на 1500 записях переехала в 70-whatsapp.test.mjs; отсюда убраны
// проверки того, чего в отчётах больше нет (заявки периода, первый ответ, прогноз,
// выручка «по заявкам периода»). Здесь остаётся то, что этап 3 добавил и что работает
// по-прежнему: канал, рабочие часы, промокоды, валюта кампании, права, свёртка, скорость.
import fs from 'node:fs';
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

// js/admin/metrics.js — модуль для браузера; так он грузится одинаково в Node 20 и новее
const M = await import('data:text/javascript;base64,' + fs.readFileSync(new URL('../../js/admin/metrics.js', import.meta.url)).toString('base64'));

const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const val = async (sql, params) => Object.values(await one(sql, params))[0];
const near = (a, b, eps = 0.011) => (a == null || b == null ? a == null && b == null : Math.abs(Number(a) - Number(b)) <= eps);
const TZ = 'Asia/Yerevan';
const iso = (t) => new Date(t).toISOString();
const DAY = 86400e3, MIN = 60e3;

// ================================================================ lead_channel
{
  const ch = (source, utm, ref) => val(`select public.channel_of($1, $2, public.ref_host($3)) c`, [source, utm, ref]);
  const cases = [
    ['phone', 'instagram', 'https://google.com/', 'manual:phone', 'звонок остаётся звонком, даже с меткой'],
    ['walk_in', null, null, 'manual:walk_in', 'визит в офис'],
    ['instagram', null, null, 'manual:instagram', 'Instagram Direct — не реклама в Instagram'],
    ['manual', null, null, 'manual:manual', 'WhatsApp, внесённый руками'],
    ['form', 'instagram', 'https://www.google.com/search', 'instagram', 'utm_source важнее домена перехода'],
    ['form', null, 'https://www.Google.com/search?q=x', 'google.com', 'домен перехода без www и в нижнем регистре'],
    ['form', null, 'https://samtravel.am/cabinet.html', 'direct', 'свой домен = прямой заход'],
    ['plan', null, 'https://www.samtravel.am/', 'direct', 'свой домен с www = прямой заход'],
    ['form', null, null, 'direct', 'ничего нет = прямой заход'],
    ['form', '', 'мусор', 'direct', 'пустая метка и не-ссылка = прямой заход'],
  ];
  for (const [s, u, r, want, label] of cases) {
    const got = await ch(s, u, r);
    check(got === want, `канал: ${label} → ${want}`, got);
    const js = M.channelOf(s, u, M.hostOf(r));
    check(js === want, `  то же в metrics.js`, js);
  }
}

// ================================================================ рабочие часы
{
  // 2026-10-05 — понедельник. Часы из миграции 002: пн–сб 10:00–19:00.
  const hours = (await one(`select value from site_settings where key = 'hours'`)).value;
  const y = (s) => `${s}+04:00`;
  const cases = [
    [y('2026-10-05T23:00'), y('2026-10-06T10:05'), 5, 'заявка в 23:00, ответ в 10:05 = 5 минут'],
    [y('2026-10-05T11:00'), y('2026-10-05T11:40'), 40, 'внутри рабочего дня'],
    [y('2026-10-05T18:50'), y('2026-10-06T10:10'), 20, 'через ночь: 10 минут вечером + 10 утром'],
    [y('2026-10-03T18:30'), y('2026-10-05T10:30'), 60, 'через воскресенье: 30 минут в субботу + 30 в понедельник'],
    [y('2026-10-04T12:00'), y('2026-10-04T15:00'), 0, 'заявка и ответ в выходной = 0'],
    [y('2026-10-05T23:00'), y('2026-10-05T23:30'), 0, 'ответ ночью, до открытия = 0'],
    [y('2026-10-05T09:00'), y('2026-10-05T20:00'), 540, 'весь день = 9 рабочих часов'],
    [y('2026-10-05T12:00'), y('2026-10-05T11:00'), 0, 'ответ раньше заявки = 0'],
  ];
  for (const [a, b, want, label] of cases) {
    const got = Number(await val(`select public.work_minutes($1::timestamptz, $2::timestamptz) m`, [a, b]));
    check(near(got, want, 0.001), `рабочие минуты: ${label}`, got);
    const js = M.workMinutes(a, b, hours);
    check(near(js, want, 0.001), `  то же в metrics.js`, js);
  }
  // считает по настройке, а не по зашитым часам
  await db.query(`update site_settings set value = value || '{"from":"09:00","days":[1,2,3,4,5,6,7]}' where key = 'hours'`);
  const got = Number(await val(`select public.work_minutes($1::timestamptz, $2::timestamptz) m`, [y('2026-10-03T18:30'), y('2026-10-05T10:30')]));
  check(near(got, 30 + 600 + 90, 0.001), 'смена часов в настройках меняет расчёт (с 9:00 и без выходных)', got);
  // нечитаемые часы → обычные минуты, а не ноль
  await db.query(`update site_settings set value = value || '{"from":"19:00","to":"10:00"}' where key = 'hours'`);
  const plain = Number(await val(`select public.work_minutes($1::timestamptz, $2::timestamptz) m`, [y('2026-10-05T23:00'), y('2026-10-06T10:05')]));
  check(near(plain, 665, 0.001), 'часы «с 19 до 10» прочитать нельзя → считаются обычные минуты', plain);
  check(near(M.workMinutes(y('2026-10-05T23:00'), y('2026-10-06T10:05'), { from: '19:00', to: '10:00' }), 665, 0.001), '  то же в metrics.js');
  await db.query(`update site_settings set value = $1 where key = 'hours'`, [JSON.stringify(hours)]);
}

// ================================================================ 1500 заявок
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = rng(20261006);
const pick = (a) => a[Math.floor(R() * a.length)];
const now = Date.now();
const N = 1500, SPAN = 420;   // дней
const CAMPAIGNS = [['instagram', 'sharm_oct'], ['facebook', 'dubai_nov'], ['google', 'search_yvn'], ['newsletter', 'winter_mail']];
const REFS = [null, null, null, 'https://www.google.com/search?q=tours', 'https://instagram.com/samtravel.arm', 'https://samtravel.am/cabinet.html', 'https://yandex.ru/'];
const REASONS = ['Дорого', 'Не отвечает', 'Возврат', 'Перенесли поездку', ''];
const COUPONS = ['WINTER10', 'AUTUMN7', 'VIP-1', 'OFF'];
await db.query(`insert into coupons (code, discount_pct, active) values ('WINTER10', 10, true), ('AUTUMN7', 7, true), ('VIP-1', 5, true), ('OFF', 5, false), ('NOBODY', 5, true)`);
await db.query(`insert into campaigns (name, channel, utm_source, utm_medium, utm_campaign, spend) values
  ('Шарм', 'instagram', 'instagram', 'paid_social', 'sharm_oct', 450), ('Дубай', 'facebook', 'facebook', 'cpc', 'dubai_nov', 380)`);

const rows = [];
for (let i = 0; i < N; i++) {
  const created = now - R() * SPAN * DAY;
  const age = (now - created) / DAY;
  const source = R() < 0.72 ? pick(['form', 'form', 'plan', 'tour', 'promo']) : pick(['phone', 'walk_in', 'instagram', 'manual']);
  const manual = ['phone', 'walk_in', 'instagram', 'manual'].includes(source);
  const camp = !manual && R() < 0.4 ? pick(CAMPAIGNS) : null;
  let status = age < 0.2 ? 'new' : pick(['new', 'contacted', 'quoted', 'won', 'won', 'lost', 'lost', 'lost', 'spam']);
  if (age > 20 && R() < 0.8) status = pick(['won', 'lost', 'lost', 'spam']);
  if (manual && status === 'new') status = 'contacted';
  const closed = ['won', 'lost', 'spam'].includes(status);
  const won = status === 'won';
  // 3 % продаж — «старые», без суммы: сторож их не трогает, в выручку они не идут
  const value = won ? (R() < 0.03 ? (R() < 0.5 ? null : 0) : Math.round(500 + R() * 4000)) : status === 'quoted' || (status === 'lost' && R() < 0.3) ? Math.round(700 + R() * 3000) : null;
  const profit = value > 0 && (won || status === 'lost') && R() < 0.7 ? Math.round(value * (0.06 + R() * 0.1) * 100) / 100 : null;
  const answered = manual || status !== 'new' || R() < 0.2;
  const first = !answered ? null : manual ? created : created + Math.round(Math.exp(2 + R() * 8)) * MIN;   // от нескольких минут до двух недель
  rows.push({
    created_at: iso(created), name: 'ZZNAME ' + i, phone: '+374 77 ' + String(500000 + i), source,
    tour: R() < 0.5 ? pick(['dubai', 'sharm', 'maldives']) : null,
    referrer: camp ? null : pick(REFS), utm_source: camp ? camp[0] : R() < 0.05 ? 'flyer' : null, utm_campaign: camp ? camp[1] : null,
    coupon_code: R() < 0.12 ? pick(COUPONS).toLowerCase() : R() < 0.02 ? 'TYPO' : null,
    status, lost_reason: status === 'lost' ? pick(REASONS) : null, value, profit,
    assigned_to: status === 'new' && R() < 0.6 ? null : pick([U.owner, U.mgr, U.mgr, null]),
    first_response_at: first && first <= now ? iso(first) : answered ? iso(Math.min(now, created + MIN)) : null,
    // продажу часто оформляют задним числом — бывает, что и раньше самой записи
    closed_at: closed ? iso(Math.min(now, created + (R() < 0.05 ? -0.4 : R() * 12) * DAY)) : null,
  });
}
// Готовые данные кладём мимо сторожей (иначе не задать прошлые даты), потом сверяем счётчики.
await db.exec(`set session_replication_role = replica`);
const COLS = `created_at timestamptz, name text, phone text, source text, tour text, referrer text, utm_source text, utm_campaign text,
  coupon_code text, status text, lost_reason text, value numeric, profit numeric, assigned_to uuid, first_response_at timestamptz, closed_at timestamptz`;
await db.query(`insert into leads (created_at, name, phone, source, tour, referrer, utm_source, utm_campaign, coupon_code, status, lost_reason, value, profit, assigned_to, first_response_at, closed_at)
  select * from jsonb_to_recordset($1::jsonb) as x(${COLS})`, [JSON.stringify(rows)]);
await db.exec(`set session_replication_role = origin`);
check(Number(await val(`select count(*) from leads`)) === N, `в базе ${N} заявок`);

// события сайта за последние 40 дней
{
  const ev = [];
  for (let i = 0; i < 4000; i++) {
    const camp = R() < 0.35 ? pick(CAMPAIGNS) : null;
    const ts = iso(now - R() * 40 * DAY), sid = 's' + String(1e7 + i);
    const base = { ts, sid, device: pick(['mobile', 'mobile', 'desktop']), lang: pick(['ru', 'hy', 'en']), utm_source: camp ? camp[0] : null, utm_campaign: camp ? camp[1] : null, ref_host: camp ? null : pick([null, null, 'google.com', 'instagram.com']) };
    ev.push({ ...base, name: 'page_view' });
    if (R() < 0.6) ev.push({ ...base, name: 'section_view', section: 'hot' });
    if (R() < 0.2) ev.push({ ...base, name: 'tour_open', tour: pick(['dubai', 'sharm']) });
    if (R() < 0.08) ev.push({ ...base, name: pick(['wa_click', 'tel_click']) });
  }
  await db.query(`insert into events (ts, sid, name, section, tour, device, lang, utm_source, utm_campaign, ref_host)
    select * from jsonb_to_recordset($1::jsonb) as x(ts timestamptz, sid text, name text, section text, tour text, device text, lang text, utm_source text, utm_campaign text, ref_host text)`, [JSON.stringify(ev)]);
}

const settingsRows = (await db.query(`select key, value from site_settings`)).rows;
const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
const users = (await db.query(`select p.id, p.full_name, u.email from profiles p join auth.users u on u.id = p.id`)).rows;
// то, что получает панель: строки таблицы leads от имени менеджера
const leadRows = (await as('mgr', `select * from leads`)).rows;
check(leadRows.length === N, 'менеджер читает все заявки');

const yMidnight = (t) => new Date(new Date(new Date(t).getTime() + 4 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+04:00').getTime();
const first = new Date(await val(`select min(created_at) from leads`)).getTime();

// ================================================================ промокоды
{
  const sc = (await as('mkt', `select public.stats_coupons() s`)).rows[0].s;
  const direct = (await db.query(`
    select c.code, (select count(*) from leads l where upper(l.coupon_code) = upper(c.code) and l.status <> 'spam') leads,
           (select count(*) from leads l where upper(l.coupon_code) = upper(c.code) and l.status = 'won' and l.value > 0) sales
    from coupons c order by c.code`)).rows;
  const js = M.couponStats(direct.map((c) => ({ code: c.code })), leadRows);
  check(sc.length === direct.length && direct.every((c) => { const x = sc.find((y) => y.code === c.code), j = js.find((y) => y.code === c.code); return x && x.leads === Number(c.leads) && x.sales === Number(c.sales) && j.leads === x.leads && j.sales === x.sales; }),
    `stats_coupons = прямой SQL = формулы демо-режима (${sc.map((c) => `${c.code}: ${c.leads}/${c.sales}`).join(', ')})`, sc);
  check(sc.find((c) => c.code === 'NOBODY').leads === 0 && !sc.some((c) => c.code === 'TYPO'), 'код без заявок отдаётся нулём; чужой текст в поле промокода не показывается');
  check(sc.some((c) => c.leads > 0 && c.sales > 0), 'маркетолог видит записи журнала и продажи по коду');
}

// ================================================================ валюта расхода кампании — от сервера (§4.6)
{
  const cur = (id) => val(`select currency from campaigns where id = $1`, [id]);
  const id = (await as('mkt', `insert into campaigns (name, utm_source, utm_medium, utm_campaign, spend, currency) values ('Валюта', 'x', 'y', 'cur_test', 100, 'AMD') returning id`)).rows[0].id;
  check((await cur(id)) === 'USD', 'новая кампания получает валюту панели, а не присланную', await cur(id));
  await db.query(`update site_settings set value = value || '{"currency": "EUR"}' where key = 'company'`);
  await as('mkt', `update campaigns set name = 'Валюта 2', currency = 'EUR' where id = $1`, [id]);
  check((await cur(id)) === 'USD', 'смена валюты панели старый расход не пересчитывает и валюту кампании не трогает', await cur(id));
  await as('mkt', `update campaigns set spend = 120 where id = $1`, [id]);
  check((await cur(id)) === 'EUR', 'расход ввели заново — валюта кампании стала текущей', await cur(id));
  await db.query(`update site_settings set value = value || '{"currency": "USD"}' where key = 'company'`);
  await db.query(`delete from campaigns where id = $1`, [id]);
}

// ================================================================ права и персональные данные
{
  const P = [iso(now - 30 * DAY), iso(now)];
  const digits = /77\s?5\d{5}/;
  for (const who of ['owner', 'mgr', 'mkt']) {
    const s = JSON.stringify((await as(who, `select public.stats_sales($1, $2) a, public.stats_traffic($1, $2) b, public.stats_coupons() c`, P)).rows[0]);
    check(!s.includes('ZZNAME') && !digits.test(s) && !s.includes('+374'), `${who}: в stats_* нет имён и телефонов клиентов`);
  }
  const a = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s, b = (await as('mkt', `select public.stats_sales($1, $2) s`, P)).rows[0].s;
  check(JSON.stringify(a.kpi) === JSON.stringify(b.kpi), 'владелец и маркетолог получают одни и те же цифры');
  for (const who of ['anon', 'cli']) {
    await expectErr(who, `select public.stats_sales($1, $2)`, P, `${who}: stats_sales закрыт`);
    await expectErr(who, `select public.stats_traffic($1, $2)`, P, `${who}: stats_traffic закрыт`);
    await expectErr(who, `select public.stats_coupons()`, [], `${who}: stats_coupons закрыт`);
  }
  check((await as('mkt', `select count(*)::int n from leads`)).rows[0].n === 0, 'маркетолог по-прежнему не читает таблицу leads');
  // канал и время ответа — столбцами к заявке, для менеджера
  const col = (await as('mgr', `select public.lead_channel(l) ch, public.lead_response_minutes(l) m from leads l where source = 'phone' limit 1`)).rows[0];
  check(col.ch === 'manual:phone' && col.m === null, 'lead_channel() и lead_response_minutes() доступны менеджеру как столбцы заявки');
}

// ================================================================ действие менеджера сразу видно в сводке
{
  const day0 = yMidnight(now) - DAY, P = [iso(day0), iso(day0 + DAY)];
  const before = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s.kpi;
  const id = (await as('mgr', `insert into leads (name, phone, source, coupon_code) values ('Сквозной', '+374 91 700700', 'phone', 'vip-1') returning id`)).rows[0].id;
  await as('mgr', `update leads set status = 'won', value = 2000, profit = 300, closed_at = $2 where id = $1`, [id, iso(day0 + 12 * 3600e3)]);
  const after = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s.kpi;
  check(after.sales === before.sales + 1 && near(after.revenue, before.revenue + 2000) && near(after.profit, before.profit + 300), 'продажа вчерашней датой попала в выручку и доход вчерашнего дня', [before.revenue, after.revenue]);
  const c1 = (await as('mkt', `select public.stats_coupons() s`)).rows[0].s.find((c) => c.code === 'VIP-1');
  await as('mgr', `update leads set status = 'lost', lost_reason = 'Возврат' where id = $1`, [id]);
  const back = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s.kpi;
  const c2 = (await as('mkt', `select public.stats_coupons() s`)).rows[0].s.find((c) => c.code === 'VIP-1');
  check(back.sales === before.sales && near(back.revenue, before.revenue) && near(back.profit, before.profit) && c2.sales === c1.sales - 1 && c2.leads === c1.leads,
    'возврат убирает продажу из выручки того дня и из продаж по промокоду', [back.revenue, c1, c2]);
}

// ================================================================ старые периоды читаются из свёртки
{
  // 500 посещений 14–15 месяцев назад: сначала считаем по сырым событиям, потом сворачиваем и удаляем их
  const old = [];
  for (let i = 0; i < 500; i++) {
    const camp = R() < 0.5 ? pick(CAMPAIGNS) : null;
    const base = { ts: iso(now - (430 + R() * 20) * DAY), sid: 'o' + String(1e7 + i), device: pick(['mobile', 'desktop']), lang: pick(['ru', 'hy']), utm_source: camp ? camp[0] : null, utm_campaign: camp ? camp[1] : null, ref_host: camp ? null : pick([null, 'google.com']) };
    old.push({ ...base, name: 'page_view' });
    if (R() < 0.3) old.push({ ...base, name: 'tour_open', tour: 'dubai' });
    if (R() < 0.2) old.push({ ...base, name: 'wa_click' });
  }
  await db.query(`insert into events (ts, sid, name, tour, device, lang, utm_source, utm_campaign, ref_host)
    select * from jsonb_to_recordset($1::jsonb) as x(ts timestamptz, sid text, name text, tour text, device text, lang text, utm_source text, utm_campaign text, ref_host text)`, [JSON.stringify(old)]);
  const P = [iso(yMidnight(now) - 460 * DAY), iso(now)];
  const get = async () => (await as('mkt', `select public.stats_traffic($1, $2) s`, P)).rows[0].s;
  const pickNums = (s) => JSON.stringify({
    daily: s.daily, devices: Object.entries(s.devices).sort(), langs: Object.entries(s.langs).sort(), ctas: Object.entries(s.ctas).sort(),
    sources: s.sources.map((x) => [x.src, Number(x.visits), Number(x.contacts), x.won]).sort(), campaigns: s.campaigns.map((x) => [x.campaign, Number(x.visits), Number(x.contacts), x.won]).sort(),
    tours: s.tours.map((x) => [x.tour, Number(x.opens), Number(x.contacts), x.sales]).sort(), visits: Number(s.funnel.visits),
  });
  const raw = await get();
  const rawSales = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s.kpi.visits;
  check(raw.raw_from === null && Number(raw.funnel.visits) === Number(raw.funnel.visits_detailed), 'пока сырые события на месте, свёртка не читается');
  const m = await val(`select public.events_maintain() m`);
  check(m.days_rolled > 0 && Number(m.events_deleted) === old.length, `ночная свёртка: дней ${m.days_rolled}, удалено сырых событий ${m.events_deleted}`, m);
  const rolled = await get();
  check(pickNums(raw) === pickNums(rolled), 'после свёртки посещения, обращения, каналы, кампании, туры, устройства и языки — те же числа', { visits: [raw.funnel.visits, rolled.funnel.visits] });
  check(rolled.raw_from !== null && Number(rolled.funnel.visits_detailed) === Number(rolled.funnel.visits) - 500, `панель знает, что подробности (воронка, блоки, часы) есть только с ${rolled.raw_from}`, rolled.raw_from);
  const rolledSales = (await as('owner', `select public.stats_sales($1, $2) s`, P)).rows[0].s.kpi.visits;
  check(rawSales === rolledSales && rolledSales === Number(rolled.funnel.visits), 'посещения в сводке владельца тоже читают свёртку');
  // окно целиком в прошлом, где сырых событий уже нет
  const Pold = [iso(yMidnight(now) - 460 * DAY), iso(yMidnight(now) - 420 * DAY)];
  const oldOnly = (await as('mkt', `select public.stats_traffic($1, $2) s`, Pold)).rows[0].s;
  check(Number(oldOnly.funnel.visits) === 500 && oldOnly.funnel.visits_detailed === 0, 'период старше 13 месяцев целиком отдаётся из свёртки', oldOnly.funnel);
}

// ================================================================ скорость (ТЗ §8: stats_* ≤ 1 с)
{
  const P = [iso(yMidnight(first)), iso(now)];
  const t0 = performance.now();
  await as('owner', `select public.stats_sales($1, $2)`, P);
  const t1 = performance.now();
  await as('owner', `select public.stats_traffic($1, $2)`, P);
  const t2 = performance.now();
  check(t1 - t0 < 3000 && t2 - t1 < 3000, `«всё время» на ${N} заявках: stats_sales ${Math.round(t1 - t0)} мс, stats_traffic ${Math.round(t2 - t1)} мс (база в памяти, без запаса не сравнивать с боевой)`);
}
