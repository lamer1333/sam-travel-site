// Этап 9: напоминания о вылетах (ТЗ §0 п.23, §4.12). Миграция 090_reminders.sql.
// Запуск: npm test  (или node supabase/test/run.mjs 90)
//
// Что проверяется:
//   1) напоминание создаётся, не дублируется, переносится при смене даты, снимается при
//      возврате и возвращается при его отмене;
//   2) язык и текст берутся из продажи; ссылка wa.me несёт уже набранный текст;
//   3) «просрочено» и срок, сколько запись висит в списке;
//   4) reminders_today / reminder_done — только владельцу и менеджеру;
//   5) настройки: час письма, ссылка для отзыва, закрытый режим автоотправки;
//   6) письмо дня: сбор вызывается напрямую, функция почты идёт в поддельный почтовый
//      сервис — настоящих писем и сообщений в WhatsApp тест не отправляет;
//   7) правила демо-режима (js/admin/reminders.js) дают то же, что база.
import fs from 'node:fs';
import { db, U, as, ok, bad, expectErr } from './_db.mjs';
import { handle, buildDigestMail } from '../functions/lead-mail/handler.mjs';

const src = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
// модуль панели написан для браузера; так он грузится одинаково в Node 20 и новее
const R = await import('data:text/javascript;base64,' + Buffer.from(src('js/admin/reminders.js')).toString('base64'));

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

let phoneN = 100;
async function sale(extra = {}, who = 'mgr') {
  const row = { name: 'Мариам Петросян', phone: '+374 91 500' + (phoneN++), source: 'manual', status: 'won', value: 1500, lang: 'ru', tour: 'sharm', ...extra };
  const keys = Object.keys(row);
  return (await as(who, `insert into leads(${keys.join(', ')}) values (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, keys.map((k) => row[k]))).rows[0].id;
}
const upd = (id, patch, who = 'mgr') => {
  const keys = Object.keys(patch);
  return as(who, `update leads set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((k) => patch[k])]);
};
const rems = async (id) => (await db.query(`select id, kind, due_on::text as due_on, status, done_by, done_at from wa_reminders where lead_id = $1 order by kind`, [id])).rows;
const brief = (rows) => rows.map((r) => r.kind + ' ' + r.due_on + ' ' + r.status).join(' | ');
const list = (d = today) => val(`select public.reminders_list($1::date)`, [d]);
const item = async (leadId, kind, d = today) => (await list(d)).find((x) => x.lead_id === leadId && x.kind === kind);

// ================================================================ 1) создать, перенести, снять
const A = await sale({ depart_on: day(1), return_on: day(8), lang: 'hy' });
let r = await rems(A);
check(brief(r) === `bon_voyage ${today} due | welcome_back ${day(9)} due`, 'продажа с датами → два напоминания: накануне вылета и на следующий день после возвращения', brief(r));
const bonId = r[0].id;

await upd(A, { message: 'Отель у рифа' });
await upd(A, { depart_on: day(1), return_on: day(8) });
await upd(A, { value: 1700 });
r = await rems(A);
check(r.length === 2 && r[0].id === bonId, 'правки продажи напоминания не дублируют', brief(r));
await rejects('mgr', `insert into wa_reminders(lead_id, kind, due_on) values ($1, 'bon_voyage', $2)`, [A, today], 'permission denied', 'менеджер не пишет в wa_reminders напрямую');
try { await db.query(`insert into wa_reminders(lead_id, kind, due_on) values ($1, 'bon_voyage', $2)`, [A, today]); bad('второе напоминание того же вида'); }
catch (e) { ok('второе напоминание того же вида на продажу база не пускает'); }

await upd(A, { depart_on: day(3) });
r = await rems(A);
check(r[0].id === bonId && r[0].due_on === day(2) && r[0].status === 'due', 'перенос вылета переносит напоминание (та же запись)', brief(r));
check(!(await item(A, 'bon_voyage')), 'перенесённое на послезавтра сегодня не показывается');
await upd(A, { return_on: day(10) });
check((await rems(A))[1].due_on === day(11), 'перенос возвращения переносит «с возвращением»');
await upd(A, { depart_on: day(1) });

await upd(A, { status: 'lost', lost_reason: 'Возврат' });
r = await rems(A);
check(r.every((x) => x.status === 'skipped'), 'возврат продажи снимает напоминания', brief(r));
check(!(await item(A, 'bon_voyage')), 'снятое напоминание в список не попадает');
await upd(A, { status: 'won', lost_reason: null, value: 1700 });
r = await rems(A);
check(r.every((x) => x.status === 'due') && r[0].id === bonId, 'отмена возврата возвращает напоминания', brief(r));

await upd(A, { depart_on: null });
check((await rems(A))[0].status === 'skipped', 'стёртая дата вылета снимает напоминание');
await upd(A, { depart_on: day(1) });
check((await rems(A))[0].status === 'due', 'дата вернулась — напоминание снова ждёт');

await rejects('mgr', `update leads set return_on = $2 where id = $1`, [A, day(0)], 'return_before_depart', 'возвращение раньше вылета');
await rejects('mgr', `insert into leads(name, phone, source, status, value, depart_on, return_on) values ('X', '+374 91 500001', 'phone', 'won', 100, $1, $2)`, [day(5), day(4)], 'return_before_depart', 'продажа с возвращением раньше вылета');

const noDates = await sale();
check((await rems(noDates)).length === 0, 'продажа без дат — без напоминаний');
const shortPhone = await sale({ phone: '12345', depart_on: day(1) });
check((await rems(shortPhone)).length === 0, 'без пригодного телефона напоминания нет');
await upd(shortPhone, { phone: '+374 91 500002' });
check(brief(await rems(shortPhone)) === `bon_voyage ${today} due`, 'телефон вписали — напоминание появилось');
const refunded = await sale({ status: 'lost', lost_reason: 'Возврат', depart_on: day(1), return_on: day(5) });
check((await rems(refunded)).length === 0, 'запись, внесённая сразу как возврат, — без напоминаний');
const optIn = await sale({ wa_opt_in: true });
check(await val(`select wa_opt_in from leads where id = $1`, [optIn]) === true && await val(`select wa_opt_in from leads where id = $1`, [noDates]) === false,
  'согласие на сообщения в WhatsApp хранится в продаже, по умолчанию его нет');

// ================================================================ 2) язык и текст — из продажи
const RU = await sale({ depart_on: day(1), lang: 'ru' });
const EN = await sale({ depart_on: day(1), lang: 'en', name: 'Mariam Petrosyan' });
const HY = await sale({ depart_on: day(1), lang: 'hy', name: 'Մարիամ Պետրոսյան' });
const NOTOUR = await sale({ depart_on: day(1), lang: 'ru', tour: null, name: 'Анна' });
const want = [
  [RU, 'ru', 'Здравствуйте, Мариам! Завтра ваш вылет в Шарм-эль-Шейх. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL'],
  [EN, 'en', 'Hello, Mariam! Your flight to Sharm El Sheikh is tomorrow. Have a great flight and a wonderful holiday! SAM TRAVEL'],
  [HY, 'hy', 'Բարև ձեզ, Մարիամ։ Վաղը ձեր թռիչքն է՝ Շարմ էլ Շեյխ։ Մաղթում ենք բարի թռիչք և հիանալի հանգիստ։ SAM TRAVEL'],
  [NOTOUR, 'ru', 'Здравствуйте, Анна! Завтра ваш вылет. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL'],
];
for (const [id, lang, text] of want) {
  const it = await item(id, 'bon_voyage');
  check(it && it.lang === lang && it.text === text, `«хорошего полёта», ${lang}${id === NOTOUR ? ', без направления' : ''}: ${text.slice(0, 40)}…`, it && it.text);
  check(it && it.wa_url === 'https://wa.me/' + it.phone_digits + '?text=' + encodeURIComponent(text) && /^\d{8,}$/.test(it.phone_digits),
    `ссылка wa.me с набранным текстом (${lang})`, it && it.wa_url);
}
check((await item(RU, 'bon_voyage')).tour_name === 'Шарм-эль-Шейх' && (await item(EN, 'bon_voyage')).tour_name === 'Шарм-эль-Шейх', 'направление для владельца — по-русски, на каком бы языке ни был клиент');

await upd(EN, { lang: 'ru' });
check((await item(EN, 'bon_voyage')).text.startsWith('Здравствуйте, Mariam!'), 'сменили язык в продаже — текст на новом языке');
const odd = await sale({ depart_on: day(1), lang: null });
check((await item(odd, 'bon_voyage')).lang === 'ru', 'язык не указан → русский');

// язык из номера обращения: клиент писал с английской версии сайта
await db.query(`insert into events (ts, sid, name, ref, lang) values (now(), 'visitrem0001', 'wa_click', 'K7M2X', 'en')`);
const byRef = await sale({ depart_on: day(1), lang: 'ru', ref: 'K7M2X', tour: 'dubai', name: 'Alex Stone' });
const it9 = await item(byRef, 'bon_voyage');
check(it9.lang === 'en' && it9.text.startsWith('Hello, Alex! Your flight to Dubai is tomorrow.'), 'продажа с номером обращения: язык — тот, на котором клиент смотрел сайт', it9.text);

// «с возвращением» и ссылка для отзыва
const BACK = await sale({ depart_on: day(-8), return_on: day(-1), lang: 'ru' });
let wb = await item(BACK, 'welcome_back');
check(wb && wb.text === 'С возвращением, Мариам! Надеемся, Шарм-эль-Шейх понравился. Будем рады вашему отзыву' && !wb.overdue, '«с возвращением» на следующий день после возвращения, без ссылки', wb && wb.text);
const REVIEW = 'https://g.page/r/samtravel/review?x=1&y=2';
await as('owner', `update site_settings set value = value || $1 where key = 'whatsapp'`, [JSON.stringify({ review_url: REVIEW })]);
wb = await item(BACK, 'welcome_back');
check(wb.text === 'С возвращением, Мариам! Надеемся, Шарм-эль-Шейх понравился. Будем рады вашему отзыву: ' + REVIEW, 'ссылка для отзыва из настроек дописывается в «с возвращением»', wb.text);
check(wb.wa_url.endsWith(encodeURIComponent(': ' + REVIEW)) && !wb.wa_url.slice(20).includes('&'), 'ссылка внутри текста закодирована и не ломает адрес wa.me', wb.wa_url);
check(!(await item(RU, 'bon_voyage')).text.includes('http'), 'в «хорошего полёта» ссылка для отзыва не попадает');

// шаблоны правит владелец в «Шаблоны ответов»
const tpl = (await db.query(`select kind, lang, body from wa_templates where kind is not null order by kind, lang`)).rows;
check(tpl.length === 6 && tpl.every((t) => t.body === R.reminderDefault(t.kind, t.lang)), 'в wa_templates два напоминания на EN / RU / HY', tpl.map((t) => t.kind + ':' + t.lang));
await rejects('owner', `insert into wa_templates(title, lang, body, kind) values ('Ещё один', 'ru', 'x', 'bon_voyage')`, [], 'duplicate key', 'второй шаблон того же вида и языка');
await rejects('owner', `insert into wa_templates(title, lang, body, kind) values ('Не тот вид', 'ru', 'x', 'birthday')`, [], 'check constraint', 'шаблон неизвестного вида');
await as('mgr', `update wa_templates set body = 'взлом' where kind = 'bon_voyage' and lang = 'ru'`);
check((await item(RU, 'bon_voyage')).text === want[0][2], 'менеджер тексты напоминаний не меняет');
await as('owner', `update wa_templates set body = $1 where kind = 'bon_voyage' and lang = 'ru'`, ['Добрый день, {name}! Завтра летим[ — {tour}]. Ваш SAM TRAVEL']);
check((await item(RU, 'bon_voyage')).text === 'Добрый день, Мариам! Завтра летим — Шарм-эль-Шейх. Ваш SAM TRAVEL', 'владелец поправил шаблон — текст напоминания новый');
check((await item(NOTOUR, 'bon_voyage')).text === 'Добрый день, Анна! Завтра летим. Ваш SAM TRAVEL', 'кусок в квадратных скобках выпадает, когда направления нет');
check((await item(HY, 'bon_voyage')).text === want[2][2], 'шаблон другого языка не затронут');

// ================================================================ 3) «просрочено» и срок показа
const LATE = await sale({ depart_on: today, return_on: day(7), name: 'Опоздавший Клиент' });
let late = await item(LATE, 'bon_voyage');
check(late && late.overdue === true && late.due_on === day(-1), 'не написали вчера → сегодня висит с пометкой «просрочено»', late);
check(!(await item(LATE, 'bon_voyage', day(1))), 'день вылета прошёл — «хорошего полёта» из списка уходит');
check((await item(RU, 'bon_voyage')).overdue === false, 'сегодняшнее напоминание не просрочено');
check(!(await item(RU, 'bon_voyage', day(-1))), 'раньше своего дня напоминание не показывается');
check((await item(RU, 'bon_voyage', day(1))).overdue === true, 'назавтра (в день вылета) оно ещё в списке, уже «просрочено»');
check((await item(BACK, 'welcome_back', day(7))).overdue === true && !(await item(BACK, 'welcome_back', day(8))), '«с возвращением» висит неделю, потом уходит');
const gone = await sale({ depart_on: day(-2), return_on: day(-1) });
check(!(await item(gone, 'bon_voyage')), 'продажа внесена, когда вылет уже прошёл, — «хорошего полёта» не показывается');

// ================================================================ 4) панель: reminders_today / reminder_done
for (const w of ['anon', 'cli', 'mkt']) {
  await expectErr(w, `select reminders_today()`, [], w + ': reminders_today закрыт');
  await expectErr(w, `select reminder_done($1)`, [bonId], w + ': reminder_done закрыт');
  const c = (await as(w, `select count(*)::int c from wa_reminders`)).rows[0].c;
  check(c === 0, w + ' не видит wa_reminders', c);
}
for (const w of ['anon', 'cli', 'mkt', 'mgr', 'owner']) {
  for (const f of ['reminders_list(current_date)', 'reminders_digest()', 'reminders_mail_queue()', 'reminders_tick()', `send_reminder('${bonId}')`, `reminder_body('bon_voyage', 'ru')`, 'wa_settings()']) {
    await expectErr(w, `select ${f}`, [], `${w}: ${f.split('(')[0]} закрыт`);
  }
}
await rejects('mgr', `update wa_reminders set status = 'sent'`, [], 'permission denied', 'менеджер не правит wa_reminders в обход reminder_done');
await rejects('owner', `delete from wa_reminders`, [], 'permission denied', 'владелец не удаляет напоминания напрямую');

for (const w of ['mgr', 'owner']) {
  const t = (await as(w, `select reminders_today() t`)).rows[0].t;
  check(t.today === today && t.enabled === true && same(t.items, await list()) && t.items.length > 5, `${w}: reminders_today отдаёт сегодняшний список`, t.items.length);
}
let T = (await as('mgr', `select reminders_today() t`)).rows[0].t;
const up = T.upcoming.find((x) => x.id === RU);
check(up && up.depart_on === day(1) && up.reminder === 'due' && T.upcoming.every((x) => x.depart_on >= today && x.depart_on <= day(7)), '«Ближайшие вылеты»: продажи с вылетом в 7 дней');
const far = await sale({ depart_on: day(8) });
T = (await as('mgr', `select reminders_today() t`)).rows[0].t;
check(!T.upcoming.some((x) => x.id === far) && !T.upcoming.some((x) => x.id === refunded) && !T.upcoming.some((x) => x.id === gone), 'вылет через 8 дней, возврат и прошедший вылет в «Ближайшие» не попадают');
check(T.upcoming.map((x) => x.depart_on).join() === T.upcoming.map((x) => x.depart_on).sort().join(), '«Ближайшие вылеты» — по дате вылета');

const ruRem = (await rems(RU))[0].id;
const before = T.items.length;
let d1 = (await as('mgr', `select reminder_done($1) r`, [ruRem])).rows[0].r;
check(d1.status === 'sent' && d1.done_by === U.mgr && d1.done_at, 'reminder_done: отправлено, кто и когда');
T = (await as('mgr', `select reminders_today() t`)).rows[0].t;
check(T.items.length === before - 1 && !T.items.some((x) => x.id === ruRem), 'отмеченная запись уходит из «Написать сегодня», счётчик −1');
check(T.upcoming.find((x) => x.id === RU).reminder === 'sent', 'в «Ближайших вылетах» видно, что клиенту уже написали');
const act = (await db.query(`select actor, kind, body, meta from lead_activity where lead_id = $1 and kind = 'whatsapp'`, [RU])).rows;
check(act.length === 1 && act[0].actor === U.mgr && act[0].meta.reminder === 'bon_voyage', 'в истории продажи — кто отправил напоминание', act);
await as('owner', `select reminder_done($1)`, [ruRem]);
check((await db.query(`select 1 from lead_activity where lead_id = $1 and kind = 'whatsapp'`, [RU])).rows.length === 1 && (await rems(RU))[0].done_by === U.mgr, 'повторная отметка ничего не меняет');
d1 = (await as('mgr', `select reminder_done($1, false) r`, [ruRem])).rows[0].r;
check(d1.status === 'due' && d1.done_by === null && (await item(RU, 'bon_voyage')), 'отметку можно снять — запись снова в списке');
await as('mgr', `select reminder_done($1)`, [ruRem]);
await rejects('mgr', `select reminder_done(gen_random_uuid())`, [], 'reminder_not_found', 'reminder_done по несуществующей записи');

// отправленное и перенос даты
await upd(RU, { depart_on: day(4) });
check(brief(await rems(RU)) === `bon_voyage ${day(3)} due`, 'вылет перенесли после отправки → напоминание снова ждёт, на новый день', brief(await rems(RU)));
await as('mgr', `select reminder_done($1)`, [ruRem]);
await upd(RU, { depart_on: day(-3) });
check(brief(await rems(RU)) === `bon_voyage ${day(-4)} sent`, 'дату поправили на прошедшую → отправленное остаётся отправленным', brief(await rems(RU)));
await upd(RU, { status: 'lost', lost_reason: 'Возврат' });
check((await rems(RU))[0].status === 'sent', 'возврат отправленное не трогает');

// ================================================================ 5) настройки
const ws = () => val(`select value from site_settings where key = 'whatsapp'`);
check(same(sortKeys(await ws()), sortKeys({ enabled: true, mail_hour: 11, review_url: REVIEW, mode: 'remind' })), 'настройки: включено, письмо в 11:00, режим «пишет человек»', await ws());
check(await val(`select not (public_site() -> 'settings' ? 'whatsapp')`), 'на публичный сайт настройки напоминаний не уходят');
const setWa = (who, patch) => as(who, `update site_settings set value = value || $1 where key = 'whatsapp'`, [JSON.stringify(patch)]);
await rejects('owner', `update site_settings set value = value || $1 where key = 'whatsapp'`, [JSON.stringify({ mode: 'auto' })], 'wa_auto_unavailable', 'автоотправку включить нельзя');
for (const [patch, code] of [[{ mode: 'robot' }, 'bad_wa_mode'], [{ mail_hour: 24 }, 'bad_mail_hour'], [{ mail_hour: 11.5 }, 'bad_mail_hour'], [{ mail_hour: '11' }, 'bad_mail_hour'],
  [{ review_url: 'javascript:alert(1)' }, 'bad_review_url'], [{ review_url: 'https://a b' }, 'bad_review_url'], [{ enabled: 'yes' }, 'bad_wa_enabled']]) {
  await rejects('owner', `update site_settings set value = value || $1 where key = 'whatsapp'`, [JSON.stringify(patch)], code, 'настройка ' + JSON.stringify(patch));
  let js = null; try { R.guardWaSettings({ ...(await ws()), ...patch }); } catch (e) { js = e.message; }
  check(js === code, 'демо-режим отклоняет её так же', js);
}
await setWa('mgr', { mail_hour: 3 });
await setWa('mkt', { enabled: false });
check((await ws()).mail_hour === 11 && (await ws()).enabled === true, 'менеджер и маркетолог настройки напоминаний не меняют');
await setWa('owner', { enabled: false });
T = (await as('mgr', `select reminders_today() t`)).rows[0].t;
check(T.enabled === false && T.items.length === 0 && T.upcoming.length > 0, 'напоминания выключены → «Написать сегодня» пуст, вылеты видны');
const at = (d, hm) => val(`select (($1::text || ' ' || $2::text)::timestamp at time zone 'Asia/Yerevan')`, [d, hm]);
const queue = async (d, hm) => val(`select public.reminders_mail_queue($1)`, [await at(d, hm)]);
const mails = () => val(`select count(*)::int from notify_log where kind = 'reminders'`);
check(await queue(today, '11:00') === false && await mails() === 0, 'напоминания выключены → письма нет');
await setWa('owner', { enabled: true });

// ================================================================ 6) письмо дня
check(await val(`select public.reminders_digest($1::date)`, [day(400)]) === null, 'сбор письма за день, когда писать некому, → пусто');
check(await queue(day(400), '11:00') === false && await mails() === 0, 'пустой день — без письма');
const dg = await val(`select public.reminders_digest($1::date)`, [today]);
check(dg.day === today && dg.count === dg.items.length && same(dg.items, await list()) && dg.count > 5, 'сбор письма: тот же список, что в панели', dg.count);
check(dg.items.some((x) => x.overdue) && dg.items.some((x) => x.kind === 'welcome_back') && ['ru', 'en', 'hy'].every((l) => dg.items.some((x) => x.lang === l)), 'в письме есть просроченные, «с возвращением» и клиенты на трёх языках');

check(await queue(today, '10:59') === false && await queue(today, '12:00') === false && await mails() === 0, 'до и после своего часа письмо в очередь не встаёт');
check(await queue(today, '11:05') === true && await mails() === 1, 'в 11:05 по Еревану письмо дня встаёт в очередь');
check(await queue(today, '11:10') === false && await queue(today, '11:55') === false && await mails() === 1, 'одно письмо в день');
const lateSale = await sale({ depart_on: day(1), name: 'Поздняя Продажа' });
let nl = (await db.query(`select * from notify_log where kind = 'reminders'`)).rows[0];
check(!nl.payload.items.some((x) => x.lead_id === lateSale) && (await item(lateSale, 'bon_voyage')), 'продажа, внесённая после письма, в письмо не попадает, а в панели видна сразу');
check(nl.status === 'pending' && nl.lead_id === null && nl.attempts === 0, 'письмо ждёт отправки в notify_log');

// функция почты целиком: её обращения к базе идут в тестовую базу, почтовый сервис подменён
const ENV = {
  WEBHOOK_SECRET: 'test-secret-0123456789', SB_URL: 'http://db.test', SB_SERVICE_ROLE_KEY: 'service-key',
  SITE_URL: 'https://samtravel.am/', MAIL_API_URL: 'http://mail.test/send', MAIL_API_KEY: 'mail-key', MAIL_FROM: 'SAM TRAVEL <leads@samtravel.am>',
};
console.error = () => {};
const outbox = [], hosts = new Set();
let mailDown = false;
async function fakeFetch(url, init) {
  const u = new URL(url), body = JSON.parse(init.body);
  hosts.add(u.host);
  if (u.host === 'db.test') {
    const fn = u.pathname.split('/').pop(), keys = Object.keys(body);
    const q = await db.query(`select public.${fn}(${keys.map((k, i) => `${k} := $${i + 1}`).join(', ')}) as v`, keys.map((k) => body[k]));
    return new Response(JSON.stringify(q.rows[0].v ?? null), { status: 200 });
  }
  if (u.host === 'mail.test') {
    if (mailDown) return new Response('{"message":"provider is down"}', { status: 503 });
    outbox.push(body);
    return new Response('{"id":"m1"}', { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
}
const retry = () => handle(new Request('http://fn.test/lead-mail', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': ENV.WEBHOOK_SECRET }, body: '{"type":"retry"}' }), ENV, fakeFetch).then((x) => x.json());
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

mailDown = true;
let out = await retry();
nl = (await db.query(`select * from notify_log where kind = 'reminders'`)).rows[0];
check(out.failed === 1 && outbox.length === 0 && nl.status === 'pending' && nl.attempts === 1 && /503/.test(nl.last_error), 'почтовый сервис лежит → письмо ждёт повтора');
mailDown = false;
out = await retry();
check(out.sent === 0 && outbox.length === 0, 'повтор раньше чем через 5 минут — не шлёт');
await db.query(`update notify_log set next_try_at = now() - interval '1 second' where kind = 'reminders'`);
out = await retry();
check(out.sent === 1 && outbox.length === 1, 'повтор → одно письмо', out);
const m = outbox[0];
const agency = await val(`select value ->> 'email' from site_settings where key = 'contacts'`);
check(m.to.length === 1 && m.to[0] === agency, 'получатель — почта агентства: ' + agency, m.to);
const n = nl.payload.count;
check(m.subject === 'Сегодня написать: ' + n + ' клиентов' || /^Сегодня написать: \d+ клиент(а|ов)?$/.test(m.subject), 'тема: ' + m.subject);
check(nl.payload.items.every((x) => m.text.includes(x.wa_url) && m.html.includes('href="' + esc(x.wa_url) + '"')), 'в письме у каждого клиента верная ссылка wa.me с текстом на его языке');
check(nl.payload.items.every((x) => m.html.includes(esc(x.name)) && m.html.includes(esc(x.text))) && m.html.includes('Шарм-эль-Шейх'), 'в письме имя, направление и текст сообщения');
check((m.html.match(/Отправить в WhatsApp/g) || []).length === n && m.html.includes('просрочено'), 'кнопка «Отправить в WhatsApp» у каждого, просроченные помечены');
check(m.html.includes('https://samtravel.am/admin.html#/dashboard'), 'ссылка в панель — отметить отправленные');
nl = (await db.query(`select * from notify_log where kind = 'reminders'`)).rows[0];
check(nl.status === 'sent' && nl.sent_at && nl.to_addr === agency, 'notify_log: письмо доставлено');
out = await retry();
check(out.sent === 0 && outbox.length === 1 && await queue(today, '11:30') === false, 'второго письма за день нет');
check(same([...hosts].sort(), ['db.test', 'mail.test']), 'функция ходит только в базу и в почтовый сервис — в WhatsApp ничего не уходит', [...hosts]);
check((await db.query(`select 1 from wa_reminders where status = 'auto_sent' or attempts > 0 or auto_sent_at is not null`)).rows.length === 0, 'система сама ни одного сообщения не отправила');

const one = buildDigestMail({ day: today, count: 1, items: [nl.payload.items[0]] }, ENV);
check(one.subject === 'Сегодня написать: 1 клиент' && buildDigestMail({ items: nl.payload.items.slice(0, 3) }, ENV).subject === 'Сегодня написать: 3 клиента', 'тема склоняется: 1 клиент, 3 клиента');

// час письма из настроек
await db.query(`delete from notify_log where kind = 'reminders'`);
await setWa('owner', { mail_hour: 9 });
check(await queue(today, '11:05') === false && await queue(today, '09:10') === true, 'час письма берётся из настроек: 9 → уходит в 09:10, а не в 11');
await setWa('owner', { mail_hour: 11 });

// Этап 10 (100_security.sql, AUDIT D2): письма о заявке больше нет — запись с источником «form»
// задания не получает, и notify_claim такие письма не отдаёт (раньше здесь проверялось обратное).
await db.query(`delete from notify_log`);
await db.query(`insert into leads(name, phone, source) values ('С сайта', '+374 91 777000', 'form')`);
const jobs = await val(`select public.notify_claim()`);
check(jobs.length === 0 && await val(`select count(*)::int from notify_log`) === 0, 'notify_claim: письма о заявке с сайта больше нет');

// единственная точка будущей автоотправки сейчас ничего не шлёт
const sr = await val(`select public.send_reminder($1)`, [bonId]);
check(sr.sent === false && sr.reason === 'manual_mode' && (await rems(A))[0].status === 'due', 'send_reminder ничего не отправляет и оставляет запись человеку', sr);
const code = src('supabase/migrations/090_reminders.sql') + src('supabase/functions/lead-mail/handler.mjs') + src('js/admin/reminders.js');
check(!/graph\.facebook\.com|api\.whatsapp\.com|net\.http_post/.test(code), 'в коде этапа нет вызовов WhatsApp API и своих сетевых запросов');
const md = src('supabase/templates/whatsapp.md');
check(['flight_tomorrow', 'welcome_back', '{{1}}', '{{2}}', '| `ru` |', '| `en` |', '| `hy` |'].every((s) => md.includes(s)), 'файл шаблонов для Meta: два шаблона, три языка, {{1}} и {{2}}');

// ================================================================ 7) демо-режим считает так же
await db.query(`delete from wa_templates where kind = 'welcome_back' and lang = 'hy'`);   // шаблон удалён → текст по умолчанию
await sale({ depart_on: day(-9), return_on: day(-2), lang: 'hy', name: 'Արմեն', tour: 'dubai' });
async function state() {
  const rows = async (t) => (await db.query(`select to_jsonb(x) j from ${t} x`)).rows.map((x) => x.j);
  return { leads: await rows('leads'), reminders: await rows('wa_reminders'), tours: await rows('tours'), templates: await rows('wa_templates'), settings: { whatsapp: await ws() } };
}
const byId = (a) => a.map(sortKeys).sort((x, y) => x.id.localeCompare(y.id));
const st = await state();
let diff = 0, seen = 0;
for (let i = -3; i <= 12; i++) {
  const sql = await list(day(i)), js = R.remindersList({ ...st, day: day(i) });
  seen += sql.length;
  if (!same(byId(sql), byId(js))) { diff++; if (diff === 1) console.log('    день', day(i), '\n    SQL', JSON.stringify(byId(sql)[0]), '\n    JS ', JSON.stringify(byId(js)[0])); }
}
check(diff === 0 && seen > 40, `список и тексты за 16 дней: js/admin/reminders.js = reminders_list (${seen} записей)`, diff);
const tSql = (await as('owner', `select reminders_today() t`)).rows[0].t, tJs = R.remindersToday(st, today);
check(same(byId(tSql.items), byId(tJs.items)) && same(byId(tSql.upcoming), byId(tJs.upcoming)) && tJs.enabled === tSql.enabled, 'reminders_today в демо-режиме — то же самое');
check(same(byId((await val(`select public.reminders_digest($1::date)`, [today])).items), byId(R.remindersDigest(st, today).items)) && R.remindersDigest(st, day(400)) === null, 'сбор письма в демо-режиме — то же самое');

// подстановки и кодирование ссылки
const fills = [
  ['{name}, привет[ — {tour}][ ({review})]!', 'Анна Петросян', 'Дубай', 'https://x.am/r'], ['{name}, привет[ — {tour}][ ({review})]!', '  Анна  ', '', ''],
  ['[{name}, ][в {tour} ]летим!  Скоро', '', null, null], ['Без подстановок', 'A', 'B', 'C'], ['{tour}{tour} [x {review} y] [z]', 'N', 'T', ''],
  ['  {name}:\n{tour}  ', "O'Brien (Jr.)", 'São Tomé & Príncipe', null], [null, 'A', 'B', 'C'],
];
let bf = 0;
for (const [b, nm, tr, rv] of fills) if (await val(`select public.reminder_fill($1, $2, $3, $4)`, [b, nm, tr, rv]) !== R.reminderFill(b, nm, tr, rv)) { bf++; console.log('    fill', JSON.stringify([b, nm, tr, rv])); }
check(bf === 0, 'reminder_fill: подстановки и необязательные куски совпадают с демо-режимом', bf);
const strs = ['Здравствуйте, Мариам! Завтра ваш вылет.', "Hello (it's) *me*~ a_b-c.d!", 'Բարև ձեզ։ 100% & «да» + ?=#/\\', 'emoji ✈️🌴\nnew line\ttab'];
let be = 0;
for (const s of strs) if (await val(`select public.url_encode($1)`, [s]) !== encodeURIComponent(s)) be++;
check(be === 0, 'url_encode кодирует так же, как encodeURIComponent в браузере', be);

// триггер: та же последовательность правок в базе и в демо-режиме
{
  const lead = { id: null, status: 'won', phone: '+374 91 600100', depart_on: day(5), return_on: day(12) };
  lead.id = await sale({ phone: lead.phone, depart_on: lead.depart_on, return_on: lead.return_on });
  let n9 = 0; const mem = R.syncReminders([], null, lead, today, () => 'js' + (++n9));
  const cmp = async (label) => {
    const a = brief(await rems(lead.id)), b = brief(mem.slice().sort((x, y) => x.kind.localeCompare(y.kind)));
    check(a === b, 'демо = база: ' + label, { sql: a, js: b });
  };
  const step = async (label, patch) => {
    const old = { ...lead }; Object.assign(lead, patch);
    await upd(lead.id, patch); R.syncReminders(mem, old, lead, today, () => 'js' + (++n9));
    await cmp(label);
  };
  const mark = async (kind) => {
    await as('mgr', `select reminder_done((select id from wa_reminders where lead_id = $1 and kind = $2))`, [lead.id, kind]);
    mem.find((x) => x.kind === kind).status = 'sent';
  };
  await cmp('новая продажа');
  await step('перенос вылета', { depart_on: day(6) });
  await mark('bon_voyage');
  await step('перенос вылета после отправки', { depart_on: day(8) });
  await mark('bon_voyage');
  await step('дата исправлена на прошедшую', { depart_on: day(-3) });
  await step('возврат', { status: 'lost', lost_reason: 'Возврат' });
  await step('отмена возврата', { status: 'won', lost_reason: null });
  await step('стёрли дату возвращения', { return_on: null });
  await step('вписали дату возвращения', { return_on: day(14) });
  await step('телефон стал непригодным', { phone: '12345' });
  await step('телефон исправили', { phone: '+374 91 600100' });
  await step('правка без дат', { message: 'x' });
  let js = null; try { R.tripGuard({ ...lead }, { ...lead, return_on: day(-9) }); } catch (e) { js = e.message; }
  check(js === 'return_before_depart', 'демо-режим тоже не пускает возвращение раньше вылета', js);
}

// расписание в тестовой базе не создаётся (pg_cron нет), сам шаг расписания работает и ничего не шлёт
await db.query(`select public.reminders_tick()`);
ok('reminders_tick без pg_net: письмо только ставится в очередь, наружу ничего не уходит');
