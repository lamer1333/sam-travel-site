// Этап 11: ошибки по итогам аудита (AUDIT.md, раздел B). Миграция 110_fixes.sql.
// Запуск: npm test  (или node supabase/test/run.mjs 110)
//
// Что проверяется (у каждого пункта — то, что до исправления падало бы):
//   хвост  событие form_start больше не принимается;
//   B4     телефон «091 22 33 44» становится «+374 91 223344», ссылка wa.me — рабочая;
//   B3     в день вылета напоминание говорит «Сегодня», накануне — «Завтра», на трёх языках;
//   B23    письмо дня встаёт в очередь и после своего часа, одно в день; зависшее задание
//          закрывается; notify_status() рассказывает о письме дня — только владельцу;
//   B1     маркетолог сохраняет SEO: панель делает update, а не upsert;
//   B20    «$» в названии тура не портит сообщение WhatsApp;
//   B2/B11 пустая дата кампании и предупреждение о промокоде — правила панели без DOM;
//   демо   js/admin/metrics.js и js/admin/reminders.js дают то же, что база.
// Настоящих писем и сообщений тест не отправляет.
import fs from 'node:fs';
import { db, U, as, ok, bad } from './_db.mjs';
import { buildDigestMail } from '../functions/lead-mail/handler.mjs';

const src = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const load = (p, fix = (s) => s) => import('data:text/javascript;base64,' + Buffer.from(fix(src(p))).toString('base64'));
const R = await load('js/admin/reminders.js');
const M = await load('js/admin/metrics.js');
await load('js/wa.js');                       // кладёт SAM_WA в globalThis
const WA = globalThis.SAM_WA;

const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const val = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
const rejects = async (who, sql, params, code, label) => {
  try { await as(who, sql, params); bad(label + ' — должно упасть с ' + code); }
  catch (e) { e.message.includes(code) ? ok(label + ' → ' + code) : bad(label + ' — ждали ' + code + ', получили ' + e.message); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const today = await val(`select ((now() at time zone 'Asia/Yerevan')::date)::text`);
const day = (n) => R.addDays(today, n);

async function sale(extra = {}, who = 'mgr') {
  const row = { name: 'Мариам Петросян', phone: '+374 91 700100', source: 'manual', status: 'won', value: 1500, lang: 'ru', tour: 'sharm', ...extra };
  const keys = Object.keys(row);
  return (await as(who, `insert into leads(${keys.join(', ')}) values (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, keys.map((k) => row[k]))).rows[0].id;
}
const lead = async (id) => (await db.query(`select * from leads where id = $1`, [id])).rows[0];
const list = (d = today) => val(`select public.reminders_list($1::date)`, [d]);
const item = async (id, kind, d = today) => (await list(d)).find((x) => x.lead_id === id && x.kind === kind);

// ================================================================ хвост: form_start
await as('anon', `select track($1::jsonb)`, [JSON.stringify([{ sid: 'fixes11aaaa1', name: 'form_start' }, { sid: 'fixes11aaaa1', name: 'page_view' }, { sid: 'fixes11aaaa1', name: 'wa_click', ref: 'K7M2X' }])]);
const names = (await db.query(`select name from events where sid = 'fixes11aaaa1' order by name`)).rows.map((r) => r.name);
check(same(names, ['page_view', 'wa_click']), 'track: form_start отброшен, остальные события пачки записаны', names);
check(!(await val(`select pg_get_functiondef('public.track(jsonb)'::regprocedure)`)).includes('form_start'), 'в действующем тексте track() имени form_start нет');

// ================================================================ B4: телефон
const P1 = await sale({ phone: '091 22 33 44', depart_on: day(1) });
let l = await lead(P1);
check(l.phone === '+374 91 223344' && l.phone_digits === '37491223344', 'продажа с «091 22 33 44» → «+374 91 223344»', [l.phone, l.phone_digits]);
check((await item(P1, 'bon_voyage')).wa_url.startsWith('https://wa.me/37491223344?text='), 'ссылка напоминания ведёт на номер с кодом страны');
await as('mgr', `update leads set phone = '(055) 95-75-85' where id = $1`, [P1]);
check((await lead(P1)).phone === '+374 55 957585', 'исправленный в карточке телефон нормализуется так же', (await lead(P1)).phone);
await as('mgr', `update leads set name = 'Мариам П.', phone = '+374 55 111222' where id = $1`, [P1]);
l = await lead(P1);
check(l.name === 'Мариам П.' && l.phone === '+374 55 111222', 'B5: имя и телефон продажи менеджер исправляет', [l.name, l.phone]);
const phones = ['091 22 33 44', '091223344', '(055) 95-75-85', '+374 91 223344', '37491223344', '91223344', '+7 916 123-45-67', '8 916 123 45 67', '0912233445', '+091223344', '', '12345', ' 077 12 34 56 '];
let pd = 0;
for (const p of phones) if (await val(`select public.phone_norm($1)`, [p]) !== M.phoneNorm(p)) { pd++; console.log('    phone', JSON.stringify(p), await val(`select public.phone_norm($1)`, [p]), M.phoneNorm(p)); }
check(pd === 0 && await val(`select public.phone_norm(null)`) === null && M.phoneNorm(null) === null, 'phone_norm = phoneNorm демо-режима на ' + phones.length + ' номерах', pd);
check(M.phoneNorm('+7 916 123-45-67') === '+7 916 123-45-67' && M.phoneNorm('91223344') === '91223344', 'чужие и неполные номера не переписываются');
check(M.phoneProblem('12345').block === true && M.phoneProblem('91223344').block === false && M.phoneProblem('91223344').text.includes('кода страны')
  && M.phoneProblem('091 22 33 44') === null && M.phoneProblem('+7 916 123-45-67') === null && M.phoneProblem('37491223344') === null,
  'форма: меньше 8 цифр — не пускает, без кода страны — предупреждает, нормальный номер — молчит');

// ================================================================ B3: «Сегодня ваш вылет»
const tpl = (await db.query(`select lang, body, variant from wa_templates where kind = 'bon_voyage' and variant = 'today' order by lang`)).rows;
check(tpl.length === 3 && tpl.every((t) => t.body === R.reminderDefault('bon_voyage_today', t.lang)) && tpl.every((t) => /Сегодня|today|Այսօր/.test(t.body)), 'в wa_templates третий текст — «в день вылета» на EN / RU / HY', tpl.map((t) => t.lang));
check(await val(`select count(*)::int from wa_templates where kind is not null`) === 9, 'всего девять текстов напоминаний: повторный накат набора их не удвоил');
await rejects('owner', `insert into wa_templates(title, lang, body, kind, variant) values ('Ещё', 'ru', 'x', 'bon_voyage', 'today')`, [], 'duplicate key', 'второй текст «в день вылета» на том же языке');
await rejects('owner', `insert into wa_templates(title, lang, body, kind, variant) values ('Не то', 'ru', 'x', 'welcome_back', 'today')`, [], 'check constraint', 'вариант «в день вылета» бывает только у «хорошего полёта»');
const want = {
  ru: ['Здравствуйте, Мариам! Завтра ваш вылет в Шарм-эль-Шейх. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL', 'Здравствуйте, Мариам! Сегодня ваш вылет в Шарм-эль-Шейх. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL'],
  en: ['Hello, Mariam! Your flight to Sharm El Sheikh is tomorrow. Have a great flight and a wonderful holiday! SAM TRAVEL', 'Hello, Mariam! Your flight to Sharm El Sheikh is today. Have a great flight and a wonderful holiday! SAM TRAVEL'],
  hy: ['Բարև ձեզ, Մարիամ։ Վաղը ձեր թռիչքն է՝ Շարմ էլ Շեյխ։ Մաղթում ենք բարի թռիչք և հիանալի հանգիստ։ SAM TRAVEL', 'Բարև ձեզ, Մարիամ։ Այսօր ձեր թռիչքն է՝ Շարմ էլ Շեյխ։ Մաղթում ենք բարի թռիչք և հիանալի հանգիստ։ SAM TRAVEL'],
};
const NAME = { ru: 'Мариам Петросян', en: 'Mariam Petrosyan', hy: 'Մարիամ Պետրոսյան' };
const F = {};
let n = 200;
for (const lang of ['ru', 'en', 'hy']) {
  F[lang] = await sale({ name: NAME[lang], lang, phone: '+374 91 700' + (n++), depart_on: day(1) });
  const eve = await item(F[lang], 'bon_voyage', today), dep = await item(F[lang], 'bon_voyage', day(1));
  check(eve.text === want[lang][0], `${lang}: накануне вылета — «завтра»`, eve.text);
  check(dep.text === want[lang][1] && dep.overdue === true, `${lang}: в день вылета — «сегодня»`, dep && dep.text);
  check(dep.wa_url === 'https://wa.me/' + dep.phone_digits + '?text=' + encodeURIComponent(want[lang][1]), `${lang}: ссылка wa.me несёт текст дня вылета`);
}
const sameDay = await sale({ name: 'Анна Срочная', phone: '+374 91 700300', depart_on: today, tour: null });
check((await item(sameDay, 'bon_voyage')).text === 'Здравствуйте, Анна! Сегодня ваш вылет. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL', 'продажа внесена в день вылета — сразу «сегодня», без направления кусок выпадает');
await as('owner', `update wa_templates set body = $1 where kind = 'bon_voyage' and variant = 'today' and lang = 'ru'`, ['{name}, сегодня летим[ — {tour}]!']);
check((await item(F.ru, 'bon_voyage', day(1))).text === 'Мариам, сегодня летим — Шарм-эль-Шейх!' && (await item(F.ru, 'bon_voyage', today)).text === want.ru[0], 'владелец правит текст дня вылета — текст кануна не меняется');
await db.query(`delete from wa_templates where kind = 'bon_voyage' and variant = 'today' and lang = 'en'`);
check((await item(F.en, 'bon_voyage', day(1))).text === want.en[1], 'шаблон дня вылета удалён → текст по умолчанию');
check(await val(`select public.reminder_body('bon_voyage', 'ru')`) === R.reminderDefault('bon_voyage', 'ru'), 'обычный текст вида вариант «в день вылета» не подхватывает');

// демо-режим: тот же список и те же тексты
const rows = async (t) => (await db.query(`select * from ${t}`)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date && ['depart_on', 'return_on', 'due_on'].includes(k) ? v.toISOString().slice(0, 10) : v])));
const days = async (t, cols) => (await db.query(`select *, ${cols.map((c) => c + '::text as ' + c + '_t').join(', ')} from ${t}`)).rows.map((r) => { cols.forEach((c) => { r[c] = r[c + '_t']; delete r[c + '_t']; }); return r; });
const st = { leads: await days('leads', ['depart_on', 'return_on']), reminders: await days('wa_reminders', ['due_on']), tours: await rows('tours'), templates: await rows('wa_templates'),
  settings: { whatsapp: await val(`select value from site_settings where key = 'whatsapp'`) } };
const byId = (a) => a.map(sortKeys).sort((x, y) => x.id.localeCompare(y.id));
let diff = 0, seen = 0;
for (let i = -1; i <= 3; i++) {
  const sql = await list(day(i)), js = R.remindersList({ ...st, day: day(i) });
  seen += sql.length;
  if (!same(byId(sql), byId(js))) { diff++; if (diff === 1) console.log('    день', day(i), '\n    SQL', JSON.stringify(byId(sql).map((x) => x.text)), '\n    JS ', JSON.stringify(byId(js).map((x) => x.text))); }
}
check(diff === 0 && seen >= 8, `js/admin/reminders.js = reminders_list, включая день вылета (${seen} записей)`, diff);

// письмо: в день вылета — «Вылет сегодня»
const mail = buildDigestMail(await val(`select public.reminders_digest($1::date)`, [day(1)]), { SITE_URL: 'https://samtravel.am' });
check(mail.text.includes('Вылет сегодня — хорошего полёта') && !mail.text.includes('Вылет завтра'), 'письмо дня: у тех, кто летит сегодня, подпись «Вылет сегодня»');
const mail0 = buildDigestMail(await val(`select public.reminders_digest($1::date)`, [today]), { SITE_URL: 'https://samtravel.am' });
check(mail0.text.includes('Вылет завтра — хорошего полёта') && mail0.text.includes('Вылет сегодня — хорошего полёта'), 'письмо дня: «завтра» и «сегодня» — каждому своё');
const md = src('supabase/templates/whatsapp.md');
check(['flight_tomorrow', 'flight_today', 'welcome_back'].every((s) => md.includes(s)) && md.includes('Сегодня ваш вылет') && md.includes('is today') && md.includes('Այսօր ձեր թռիչքն է'), 'файл шаблонов для Meta: третий шаблон на трёх языках');

// ================================================================ B23: письмо дня
const at = (d, hm) => val(`select (($1::text || ' ' || $2::text)::timestamp at time zone 'Asia/Yerevan')`, [d, hm]);
const queue = async (d, hm) => val(`select public.reminders_mail_queue($1)`, [await at(d, hm)]);
const mails = () => val(`select count(*)::int from notify_log where kind = 'reminders'`);
check(await queue(today, '10:59') === false && await mails() === 0, 'до своего часа письмо в очередь не встаёт');
check(await queue(today, '14:20') === true && await mails() === 1, 'час письма пропущен (база или расписание стояли) → письмо встаёт в очередь позже в тот же день');
check(await queue(today, '14:25') === false && await queue(today, '23:55') === false && await mails() === 1, 'по-прежнему одно письмо в день');
check(await queue(day(1), '00:10') === false && await queue(day(1), '11:00') === true && await mails() === 2, 'на следующий день — своё письмо, не раньше своего часа');

// задание, которое взяли в пятый раз и не закрыли
const job = (await db.query(`select id from notify_log where kind = 'reminders' and day = $1`, [today])).rows[0].id;
await db.query(`update notify_log set attempts = 5, next_try_at = now() - interval '1 minute' where id = $1`, [job]);
check((await val(`select public.notify_claim()`)).every((j) => j.id !== job), 'взятое пять раз задание больше не раздаётся');
await db.query(`select public.reminders_tick()`);
const stuck = (await db.query(`select status, last_error from notify_log where id = $1`, [job])).rows[0];
check(stuck.status === 'failed' && !!stuck.last_error, 'зависшее после пятой попытки задание закрывается как «не доставлено»', stuck);
const young = (await db.query(`select id from notify_log where kind = 'reminders' and day = $1`, [day(1)])).rows[0].id;
await db.query(`update notify_log set status = 'pending', attempts = 5, next_try_at = now() + interval '4 minutes' where id = $1`, [young]);
await db.query(`select public.notify_sweep()`);
check(await val(`select status from notify_log where id = $1`, [young]) === 'pending', 'пятая попытка, которая ещё идёт, не трогается');
await db.query(`update notify_log set status = 'sent', sent_at = now(), attempts = 1 where id = $1`, [young]);

// «Готовность сайта»
const ns = (await as('owner', `select notify_status() s`)).rows[0].s;
check(ns.reminders && ns.reminders.enabled === true && ns.reminders.mail_hour === 11 && ns.reminders.mail_to === true && ns.reminders.failed_7d === 1 && ns.reminders.pending === 0
  && !!ns.reminders.last_sent_at && ns.reminders.last_day === day(1) && !!ns.reminders.last_error, 'notify_status: письмо дня — включено, час, адрес, последнее письмо, недоставленные', ns.reminders);
check(ns.reminders.schedule === false && ns.reminders.secrets === false, 'notify_status честно говорит: расписания и секретов в тестовой базе нет');
check('pending' in ns && 'failed_7d' in ns && 'last_sent_at' in ns, 'прежние поля notify_status на месте');
for (const who of ['mgr', 'mkt', 'cli', 'anon']) await rejects(who, `select notify_status()`, [], who === 'anon' ? 'permission denied' : 'forbidden', `notify_status закрыта: ${who}`);
for (const f of ['notify_sweep()', `reminder_text('bon_voyage', 'ru', 'today')`, `phone_norm('091223344')`])
  for (const who of ['anon', 'cli', 'mgr']) await rejects(who, `select public.${f}`, [], 'permission denied', `служебная ${f.split('(')[0]} закрыта: ${who}`);

// ================================================================ B1: настройки маркетолога
await as('mkt', `update site_settings set value = $1 where key = 'seo'`, [JSON.stringify({ ru: { title: 'SAM', description: 'd' } })]);
check((await val(`select value from site_settings where key = 'seo'`)).ru.title === 'SAM', 'маркетолог меняет SEO запросом update');
await rejects('mkt', `insert into site_settings(key, value) values ('seo', '{}') on conflict (key) do update set value = excluded.value`, [], 'row-level security', 'а upsert ему база не даёт — так панель и не сохраняла');
// LiveApi.saveSetting: update, и insert только когда строки не было
const api = await load('js/admin/api.js', (s) => s.replace(/^import .*$/m, 'const refNorm = (x) => x;'));
const calls = [];
const fake = (found) => ({ from: () => ({
  update: (v) => ({ eq: (k, key) => ({ select: async () => { calls.push(['update', key, v]); return { data: found ? [{ key }] : [], error: null }; } }) }),
  insert: async (v) => { calls.push(['insert', v.key]); return { data: null, error: null }; },
  upsert: async () => { calls.push(['upsert']); return { data: null, error: null }; },
}) });
await new api.LiveApi(fake(true)).saveSetting('seo', { a: 1 });
check(same(calls, [['update', 'seo', { value: { a: 1 } }]]), 'панель сохраняет настройку одним update', calls);
calls.length = 0;
await new api.LiveApi(fake(false)).saveSetting('new_key', 1);
check(same(calls.map((c) => c[0]), ['update', 'insert']), 'строки не было → update, затем insert', calls);
check(api.errText(new Error('new row violates check constraint "leads_name_check"')).includes('120') && api.errText(new Error('violates check constraint "leads_message_check"')).includes('2000'), 'B30: ошибки длины имени и текста — человеческим языком');

// ================================================================ B14: согласие на рассылку в кабинете
const prof = async () => (await db.query(`select marketing_consent, consent_at, consent_source from profiles where id = $1`, [U.cli])).rows[0];
let pr = (await as('cli', `select set_consent(false) p`)).rows[0].p;
check(pr.marketing_consent === false && (await prof()).consent_at === null, 'клиент выключает рассылку в кабинете — согласие и его дата сняты', await prof());
check(await val(`select count(*)::int from audience_list() where email = 'cli@t.am'`).catch(() => null) !== 1 && (await as('mkt', `select count(*)::int n from audience_list() where email = 'cli@t.am'`)).rows[0].n === 0, 'отписавшийся уходит из списка подписчиков маркетолога');
pr = (await as('cli', `select set_consent(true) p`)).rows[0].p;
let pf = await prof();
check(pr.marketing_consent === true && pf.consent_at !== null && pf.consent_source === 'cabinet', 'включает обратно — дата согласия новая, источник «кабинет»', pf);
const at1 = pf.consent_at;
await as('cli', `select set_consent(true)`);
check(String((await prof()).consent_at) === String(at1), 'повторное «да» дату согласия не двигает');
check((await as('mkt', `select count(*)::int n from audience_list() where email = 'cli@t.am'`)).rows[0].n === 1, 'подписавшийся снова в списке');
await rejects('anon', `select set_consent(true)`, [], 'permission denied', 'гость set_consent не вызывает');

// ================================================================ B20: «$» в названии тура
check(WA.text('tour', 'ru', { tour: 'Дубай за $& и $1', ref: 'K7M2X' }) === 'Здравствуйте! Хочу спросить про тур «Дубай за $& и $1».\n№ K7M2X', 'wa.js: «$&» и «$1» в названии тура остаются как есть');
check(WA.label('en', 'Maldives $$ deal') === 'Write about Maldives $$ deal' && WA.text('general', 'hy', { coupon: 'A$$B' }).endsWith('Պրոմոկոդ՝ A$$B'), 'wa.js: то же в подписи кнопки и в промокоде');

// ================================================================ B28: «скрыт с» и сутки по Еревану
check(M.ymd('2026-10-08T21:30:00Z') === '2026-10-09' && M.ymd('2026-10-08T19:59:00Z') === '2026-10-08', 'сутки панели — ереванские: 21:30 UTC уже завтра');
check(R.addDays('2026-10-31', 1) === '2026-11-01', 'тур «показывать до 31-го» скрыт с 1-го числа');
