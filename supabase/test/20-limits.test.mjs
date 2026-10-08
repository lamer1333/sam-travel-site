// Этап 2: лимиты track и submit_lead, проверка промокода, свёртка и срок хранения событий.
// Миграция 020_limits.sql. Запуск: npm test  (или node supabase/test/run.mjs 20)
import { db, U, as, ok, bad, expectErr, formBack } from './_db.mjs';

await formBack();   // форма заявки снята этапом 7; здесь проверяется то, что осталось в базе на случай её возврата

const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const num = async (sql, params) => Number(Object.values(await one(sql, params))[0]);

// «Прошло время»: сдвигает строки в прошлое. Триггеры на время сдвига выключены, чтобы
// сторожа других этапов не мешали готовить данные.
async function age(table, col, interval) {
  await db.exec(`set session_replication_role = replica; update public.${table} set ${col} = ${col} - interval '${interval}'; set session_replication_role = origin;`);
}
// Заголовки запроса, как их кладёт PostgREST; null — запрос без адреса.
const headers = (h) => db.query(`select set_config('request.headers', $1, false)`, [h ? JSON.stringify(h) : '']);
const fromIp = (ip) => headers({ 'cf-connecting-ip': ip });

let phoneSeq = 0;
const lead = (extra = {}) => JSON.stringify({ name: 'Test', phone: '+374 91 ' + String(100000 + phoneSeq++), ...extra });
const submit = async (who, extra) => (await as(who, `select submit_lead($1) id`, [lead(extra)])).rows[0].id;
const ev = (sid, n, extra = {}) => JSON.stringify(Array.from({ length: n }, () => ({ sid, name: 'section_view', ...extra })));
const track = (events) => as('anon', `select track($1)`, [events]);
const evCount = (sid) => num(`select count(*) from events where sid = $1`, [sid]);

// ---------------------------------------------------------------- индексы из §8
const idx = (await db.query(`select indexdef from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.indexdef);
for (const [t, cols] of [['leads', '(closed_at)'], ['leads', '(assigned_to)'], ['leads', '(user_id)'], ['events', '(utm_campaign, ts)'], ['events', '(sid)']]) {
  check(idx.some((d) => d.includes(`ON public.${t} `) && d.endsWith(cols)), `индекс ${t}${cols}`);
}

// ---------------------------------------------------------------- track: формат sid
await track(JSON.stringify([
  { sid: 'abc', name: 'page_view' },                 // короче 8
  { sid: 'ABCDEFGH12', name: 'page_view' },          // заглавные
  { sid: 'abcd-efgh-12', name: 'page_view' },        // посторонний знак
  { sid: 'a'.repeat(41), name: 'page_view' },        // длиннее 40
  { sid: '', name: 'page_view' }, { name: 'page_view' }, 'мусор', null,
  { sid: 'goodsid001', name: 'page_view' },
  { sid: 'a'.repeat(40), name: 'page_view' },
  { sid: 'goodsid001', name: 'evil' },               // имя не из списка
]));
check(await num(`select count(*) from events`) === 2, 'track: sid не из [a-z0-9]{8,40} отброшен, верные приняты', await num(`select count(*) from events`));

// ---------------------------------------------------------------- track: 200 событий на sid
for (let i = 0; i < 6; i++) await track(ev('sidlimit01', 30));
await track(ev('sidlimit01', 20));
check(await evCount('sidlimit01') === 200, 'track: 200 событий одного sid приняты', await evCount('sidlimit01'));
await track(ev('sidlimit01', 1));
check(await evCount('sidlimit01') === 200, 'track: 201-е событие одного sid отброшено', await evCount('sidlimit01'));
await track(ev('sidlimit02', 30));
check(await evCount('sidlimit02') === 30, 'track: другой sid при этом принимается');
// пачка, которая пересекает границу: принято ровно столько, сколько помещается
await age('events', 'ts', '1 hour');
for (let i = 0; i < 6; i++) await track(ev('sidlimit03', 30));
await track(ev('sidlimit03', 15));
await track(JSON.stringify([...JSON.parse(ev('sidlimit03', 10)), ...JSON.parse(ev('sidlimit04', 3))]));
check(await evCount('sidlimit03') === 200 && await evCount('sidlimit04') === 3, 'track: из пачки через границу принято 5 из 10, чужой sid в той же пачке цел', [await evCount('sidlimit03'), await evCount('sidlimit04')]);
// lead_submit от сервера тоже строка этого sid, поэтому счёт идёт по всем строкам
await age('events', 'ts', '1 hour');

// ---------------------------------------------------------------- track: 3000 событий в минуту
// Этап 10 (100_security.sql, AUDIT D3) поднял общий потолок с 600 до 3000: первым теперь
// срабатывает лимит на отправителя, его проверяет 100-security.test.mjs.
await db.exec(`insert into events (sid, name) select 'filler' || lpad(g::text, 6, '0'), 'page_view' from generate_series(1, 2990) g`);
await track(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ sid: 'minute' + String(i).padStart(4, '0'), name: 'page_view' }))));
check(await num(`select count(*) from events where sid like 'minute%'`) === 10, 'track: до потолка 3000 в минуту дошли 10 событий из 30', await num(`select count(*) from events where sid like 'minute%'`));
check(await evCount('minute0009') === 1 && await evCount('minute0010') === 0, 'track: приняты первые по порядку');
await track(ev('overflow01', 5));
check(await evCount('overflow01') === 0, 'track: сверх потолка в минуту отброшено всё');
await age('events', 'ts', '2 minutes');
await track(ev('overflow01', 5));
check(await evCount('overflow01') === 5, 'track: через минуту приём возобновился');
await age('events', 'ts', '1 hour');

// ---------------------------------------------------------------- submit_lead: лимит на отправителя
await fromIp('203.0.113.7');
for (let i = 0; i < 5; i++) await submit('anon');
check(await num(`select count(*) from leads`) === 5, 'submit_lead: 5 заявок с одного адреса приняты');
await expectErr('anon', `select submit_lead($1)`, [lead()], '6-я заявка с того же адреса за 10 минут отклонена');
await expectErr('cli', `select submit_lead($1)`, [lead()], 'вход в аккаунт лимит не снимает');
await fromIp('203.0.113.8');
check(!!(await submit('anon')), 'submit_lead: другой адрес в это же время проходит');

// дубль по телефону отправителю не засчитывается
const before = await num(`select count(*) from submit_log`);
const a1 = (await as('anon', `select submit_lead($1) id`, [JSON.stringify({ name: 'Dup', phone: '+374 55 777 001' })])).rows[0].id;
const a2 = (await as('anon', `select submit_lead($1) id`, [JSON.stringify({ name: 'Dup', phone: '37455777001' })])).rows[0].id;
check(a1 === a2 && await num(`select count(*) from submit_log`) === before + 1, 'submit_lead: повтор того же номера — не новая заявка и не новая попытка');

// IP нигде не хранится
const log = (await db.query(`select sender from submit_log`)).rows.map((r) => r.sender);
check(log.length === 7 && log.every((s) => /^[0-9a-f]{64}$/.test(s)) && new Set(log).size === 2, 'submit_log: только хеши sha-256, по одному на адрес', log.length);
const dump = JSON.stringify([
  (await db.query(`select * from leads`)).rows, (await db.query(`select * from submit_log`)).rows,
  (await db.query(`select * from rate_salt`)).rows, (await db.query(`select * from lead_activity`)).rows, (await db.query(`select * from events`)).rows]);
check(!dump.includes('203.0.113'), 'сам IP не записан ни в одну таблицу');
for (const t of ['submit_log', 'rate_salt']) await expectErr('cli', `select * from ${t}`, [], `клиент не читает ${t}`);
await expectErr('anon', `select sender_hash()`, [], 'sender_hash снаружи не вызывается');

// запасной заголовок и IPv6
await headers({ 'x-forwarded-for': '198.51.100.20, 10.0.0.1' });
for (let i = 0; i < 5; i++) await submit('anon');
await expectErr('anon', `select submit_lead($1)`, [lead()], 'x-forwarded-for: лимит считается по первому адресу');
await fromIp('2001:db8:1:2:aaaa:bbbb:cccc:1');
for (let i = 0; i < 5; i++) await submit('anon');
await fromIp('2001:db8:1:2::ffff');
await expectErr('anon', `select submit_lead($1)`, [lead()], 'IPv6: адреса одной сети /64 — один отправитель');
await fromIp('2001:db8:1:3::ffff');
check(!!(await submit('anon')), 'IPv6: соседняя сеть /64 — другой отправитель');

// окно 10 минут
await fromIp('203.0.113.7');
await age('submit_log', 'ts', '11 minutes');
check(!!(await submit('anon')), 'submit_lead: через 10 минут тот же адрес снова проходит');

// суточная соль: назавтра тот же адрес даёт другой хеш
const h1 = (await one(`select sender_hash() h`)).h;
check(h1 === (await one(`select sender_hash() h`)).h, 'соль: в течение суток хеш адреса один и тот же');
await db.exec(`update rate_salt set day = day - 1`);
const h2 = (await one(`select sender_hash() h`)).h;
check(h1 !== h2 && await num(`select count(*) from rate_salt`) === 2, 'соль: на следующие сутки новая, хеш того же адреса другой');

// без адреса в запросе лимит отправителя не действует (остаётся общий потолок)
await headers(null);
check((await one(`select sender_hash() h`)).h === null, 'запрос без адреса: хеша нет');
const logN = await num(`select count(*) from submit_log`);
for (let i = 0; i < 6; i++) await submit('anon');
check(await num(`select count(*) from submit_log`) === logN, 'запрос без адреса: 6 заявок прошли, в журнал отправителей ничего не попало');

// ---------------------------------------------------------------- submit_lead: общий потолок 60
await age('leads', 'created_at', '1 hour');
for (let i = 0; i < 60; i++) await submit('anon');
check(await num(`select count(*) from leads where created_at > now() - interval '10 minutes'`) === 60, 'submit_lead: 60 заявок за 10 минут приняты (было 40)');
await expectErr('anon', `select submit_lead($1)`, [lead()], '61-я заявка за 10 минут отклонена');
await as('mgr', `insert into leads (name, phone, source, status, first_response_at) values ('Звонок', '+374 10 555 000', 'phone', 'contacted', now())`);
ok('общий потолок не мешает менеджеру вносить заявки вручную');
await age('leads', 'created_at', '1 hour');
await as('mgr', `insert into leads (name, phone, source, status, first_response_at) select 'Офис', '+374 10 556 ' || g, 'walk_in', 'contacted', now() from generate_series(100, 170) g`);
check(!!(await submit('anon')), 'ручные заявки в общий потолок не входят');
await age('leads', 'created_at', '1 hour');

// ---------------------------------------------------------------- промокод → details.coupon_valid
await as('mkt', `insert into coupons (code, discount_pct, valid_from, valid_until, max_uses, used_count, active) values
  ('GOOD10', 10, now() - interval '1 day', now() + interval '30 days', null, 0, true),
  ('OLD5',    5, now() - interval '60 days', now() - interval '1 day', null, 0, true),
  ('OFF5',    5, now() - interval '1 day', null, null, 0, false),
  ('FULL5',   5, now() - interval '1 day', null, 1, 1, true),
  ('SOON5',   5, now() + interval '5 days', null, null, 0, true)`);
// used_count is recounted by the database (migration 010): a code is used up by a real sale, not by the number typed in
await as('mgr', `insert into leads (name, phone, source, status, value, coupon_code, first_response_at, closed_at) values ('Купил', '+374 10 557 001', 'walk_in', 'won', 500, 'FULL5', now(), now())`);
const coupon = async (extra) => one(`select coupon_code, details from leads where id = $1`, [await submit('anon', extra)]);
for (const [code, want] of [['GOOD10', 'yes'], ['OLD5', 'expired'], ['OFF5', 'expired'], ['FULL5', 'expired'], ['SOON5', 'expired'], ['NOSUCH', 'no']]) {
  const r = await coupon({ coupon_code: code });
  check(r.details.coupon_valid === want, `промокод ${code} → coupon_valid = ${want}`, r.details);
}
let r = await coupon({ coupon_code: '  good10 ' });
check(r.coupon_code === 'GOOD10' && r.details.coupon_valid === 'yes', 'промокод сверяется без учёта регистра и пробелов', r);
r = await coupon({ coupon_code: 'NOSUCH', details: { coupon_valid: 'yes', people: 2 } });
check(r.details.coupon_valid === 'no' && r.details.people === 2, 'присланный браузером coupon_valid заменён ответом сервера, остальное в details цело', r.details);
r = await coupon({ details: { coupon_valid: 'yes', people: 3 } });
check(!('coupon_valid' in r.details) && r.coupon_code === null && r.details.people === 3, 'без промокода поля coupon_valid нет, даже если его прислали', r.details);
await expectErr('anon', `select coupon_state('OFF5')`, [], 'coupon_state снаружи не вызывается');
const cc = (await as('anon', `select check_coupon('OFF5') c`)).rows[0].c;
check(cc.valid === false && Object.keys(cc).length === 1, 'check_coupon по-прежнему не выдаёт, что выключенный код существует');
await age('leads', 'created_at', '1 hour');

// lead_submit пишется только с правильным sid
await db.exec(`delete from events`);
await submit('anon', { sid: 'bad sid!' });
await submit('anon', { sid: 'leadsid00001', utm_campaign: 'c1' });
const ls = (await db.query(`select sid, name, utm_campaign from events`)).rows;
check(ls.length === 1 && ls[0].sid === 'leadsid00001' && ls[0].name === 'lead_submit' && ls[0].utm_campaign === 'c1', 'submit_lead: событие lead_submit только при sid верного формата', ls);

// ---------------------------------------------------------------- свёртка дня
await db.exec(`delete from events`);
// d(n, 'HH:MM') — момент n суток назад по Еревану
const at = (daysAgo, hm) => `(((now() at time zone 'Asia/Yerevan')::date - ${daysAgo})::timestamp + interval '${hm}') at time zone 'Asia/Yerevan'`;
await db.exec(`
insert into events (ts, sid, name, utm_source, utm_campaign, ref_host, tour, device, lang) values
  (${at(3, '00:00')}, 'visitor001', 'page_view',  'instagram', 'sharm_oct', null,         null,    'mobile',  'ru'),
  (${at(3, '00:01')}, 'visitor001', 'tour_open',  'instagram', 'sharm_oct', null,         'sharm', 'mobile',  'ru'),
  (${at(3, '00:02')}, 'visitor001', 'wa_click',   'instagram', 'sharm_oct', null,         'sharm', 'mobile',  'ru'),
  (${at(3, '09:00')}, 'visitor002', 'page_view',  'instagram', 'sharm_oct', null,         null,    'mobile',  'ru'),
  (${at(3, '09:05')}, 'visitor002', 'page_view',  'instagram', 'sharm_oct', null,         null,    'mobile',  'ru'),
  (${at(3, '12:00')}, 'visitor003', 'page_view',  null,        null,        'google.com', null,    'desktop', 'en'),
  (${at(3, '12:01')}, 'visitor003', 'tel_click',  null,        null,        'google.com', null,    'desktop', 'en'),
  (${at(3, '15:00')}, 'visitor004', 'page_view',  null,        null,        null,         null,    null,      null),
  (${at(3, '23:59:59')}, 'visitor005', 'page_view', null,      null,        null,         null,    'mobile',  'hy'),
  (${at(2, '00:00')}, 'visitor006', 'page_view',  'facebook',  'dubai_nov', null,         null,    'mobile',  'ru'),
  (${at(2, '10:00')}, 'visitor007', 'page_view',  'facebook',  'dubai_nov', null,         null,    'tablet',  'ru'),
  (${at(0, '00:00')}, 'visitor008', 'page_view',  null,        null,        null,         null,    'mobile',  'ru')`);
const dayOf = (n) => `(now() at time zone 'Asia/Yerevan')::date - ${n}`;
const rawSql = (n) => `
  select name, coalesce(utm_source, ref_host, 'direct') source, utm_campaign campaign, tour, device, lang,
         count(*)::int events, count(distinct sid)::int sessions
  from events where (ts at time zone 'Asia/Yerevan')::date = ${dayOf(n)}
  group by 1, 2, 3, 4, 5, 6 order by 1, 2, 3, 4, 5, 6`;
const dailySql = (n) => `
  select name, source, campaign, tour, device, lang, events::int events, sessions::int sessions
  from events_daily where day = ${dayOf(n)} order by 1, 2, 3, 4, 5, 6`;
const same = async (n) => JSON.stringify((await db.query(rawSql(n))).rows) === JSON.stringify((await db.query(dailySql(n))).rows);

check(await num(`select events_rollup_day(${dayOf(3)})`) === 7, 'свёртка: день свернулся в 7 строк');
check(await same(3), 'свёртка за день даёт те же числа, что запрос по сырым событиям');
check(await num(`select sum(events) from events_daily where day = ${dayOf(3)}`) === 9, 'свёртка: границы суток по Еревану — 00:00 и 23:59:59 вошли, соседний день нет');
// те же цифры, что считает stats_traffic: посещения и контакты по кампании и по источнику
const viaDaily = await one(`select
  coalesce(sum(events) filter (where name = 'page_view' and campaign = 'sharm_oct'), 0)::int visits,
  coalesce(sum(events) filter (where name in ('wa_click', 'tel_click') and campaign = 'sharm_oct'), 0)::int contacts,
  coalesce(sum(events) filter (where name = 'page_view' and source = 'google.com'), 0)::int google,
  coalesce(sum(events) filter (where name = 'page_view' and source = 'direct'), 0)::int direct
  from events_daily where day = ${dayOf(3)}`);
check(JSON.stringify(viaDaily) === JSON.stringify({ visits: 3, contacts: 1, google: 1, direct: 2 }), 'свёртка: посещения и контакты кампании, источники — как по сырым', viaDaily);
const two = await one(`select events::int events, sessions::int sessions from events_daily where day = ${dayOf(3)} and name = 'page_view' and campaign = 'sharm_oct'`);
check(two.events === 3 && two.sessions === 2, 'свёртка: события и разные sid считаются отдельно (3 посещения, 2 сеанса)', two);
await db.query(`select events_rollup_day(${dayOf(3)})`);
check(await same(3) && await num(`select count(*) from events_daily where day = ${dayOf(3)}`) === 7, 'свёртка: повторный запуск за тот же день ничего не удваивает');
check(await num(`select events_rollup_day(${dayOf(0)})`) === 0 && await num(`select count(*) from events_daily where day = ${dayOf(0)}`) === 0, 'свёртка: незаконченный сегодняшний день не сворачивается');

// ---------------------------------------------------------------- ежесуточная работа
await db.exec(`
insert into events (ts, sid, name, utm_campaign, device) values
  (now() - interval '14 months', 'ancient0001', 'page_view', 'old_camp', 'mobile'),
  (now() - interval '14 months', 'ancient0001', 'wa_click',  'old_camp', 'mobile'),
  (now() - interval '14 months', 'ancient0002', 'page_view', 'old_camp', 'mobile'),
  (now() - interval '12 months', 'lastyear001', 'page_view', null, 'desktop');
insert into submit_log (ts, sender) values (now() - interval '2 days', 'old'), (now() - interval '1 hour', 'fresh')`);
const oldDay = `((now() - interval '14 months') at time zone 'Asia/Yerevan')::date`;
const res = (await one(`select events_maintain() r`)).r;
check(res.days_rolled === 3 && res.events_deleted === 3, 'events_maintain: свернул 3 несвёрнутых дня (в т. ч. пропущенный позавчерашний), удалил 3 события', res);
check(await same(2) && await num(`select count(*) from events_daily where day = ${dayOf(2)}`) === 2, 'events_maintain: день, который не сворачивали вручную, свёрнут и сходится с сырыми');
check(await num(`select count(*) from events where ts < now() - interval '13 months 2 days'`) === 0, 'сырые события старше 13 месяцев удалены');
check(await evCount('lastyear001') === 1 && await evCount('visitor001') === 3, 'события младше 13 месяцев на месте');
const old = (await db.query(`select name, campaign, events::int events, sessions::int sessions from events_daily where day = ${oldDay} order by name`)).rows;
check(JSON.stringify(old) === JSON.stringify([{ name: 'page_view', campaign: 'old_camp', events: 2, sessions: 2 }, { name: 'wa_click', campaign: 'old_camp', events: 1, sessions: 1 }]), 'перед удалением старый день свёрнут — цифры остались', old);
check(await num(`select count(*) from events_daily where day = ${dayOf(0)}`) === 0, 'events_maintain: сегодняшний день не тронут');
check((await db.query(`select sender from submit_log where sender in ('old', 'fresh')`)).rows.map((x) => x.sender).join() === 'fresh', 'events_maintain: хеши отправителей старше суток удалены');
check(await num(`select count(*) from rate_salt where day < (now() at time zone 'Asia/Yerevan')::date`) === 0, 'events_maintain: вчерашняя соль удалена — старые хеши ни с чем не сопоставить');
const totals = await num(`select sum(events) from events_daily`);
const res2 = (await one(`select events_maintain() r`)).r;
check(res2.days_rolled === 0 && res2.events_deleted === 0 && await num(`select sum(events) from events_daily`) === totals, 'events_maintain: повторный запуск ничего не меняет, свёртка удалённого дня цела', res2);
await db.query(`select events_rollup_day(${oldDay})`);
check(await num(`select count(*) from events_daily where day = ${oldDay}`) === 2, 'свёртка дня без сырых событий не стирает уже сохранённое');

// ---------------------------------------------------------------- доступ к свёртке
check((await as('mkt', `select count(*)::int n from events_daily`)).rows[0].n > 0, 'маркетолог читает events_daily');
check((await as('mgr', `select count(*)::int n from events_daily`)).rows[0].n > 0, 'менеджер читает events_daily');
for (const w of ['anon', 'cli']) check((await as(w, `select count(*)::int n from events_daily`)).rows[0].n === 0, `${w} не видит events_daily`);
await expectErr('owner', `insert into events_daily (day, name, source, events, sessions) values (current_date, 'page_view', 'direct', 999, 999)`, [], 'в events_daily руками не пишет даже владелец');
await expectErr('owner', `select events_maintain()`, [], 'events_maintain снаружи не вызывается');
await expectErr('anon', `select events_rollup_day(current_date - 1)`, [], 'events_rollup_day снаружи не вызывается');
