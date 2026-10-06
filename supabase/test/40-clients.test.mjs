// Этап 4 — клиенты (ТЗ §4.9): миграция 040_clients.sql.
// Дата рождения, кабинет (my_profile / finish_onboarding / set_birth_date / my_requests),
// именинники, списки клиентов и подписчиков, заморозка bookings.
// Запуск: npm test  (или node supabase/test/run.mjs 40)
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const check = (cond, msg, detail = '') => (cond ? ok(msg) : bad(msg + (detail ? ' — ' + detail : '')));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const day = async (expr) => (await one(`select (${expr})::date::text d`)).d;

// Новый пользователь так, как его создаёт Supabase Auth: строка в auth.users,
// профиль появляется триггером. confirmed = false — почта ещё не подтверждена.
async function signUp(key, meta = {}, { confirmed = true, provider = 'email' } = {}) {
  const r = await db.query(
    `insert into auth.users(email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
     values ($1, $2, $3, case when $4 then now() end) returning id`,
    [key + '@t.am', JSON.stringify(meta), JSON.stringify({ provider }), confirmed]);
  U[key] = r.rows[0].id;
  return U[key];
}
async function signUpFails(key, meta, label) {
  try { await signUp(key, meta); bad(label + ' — регистрация прошла'); delete U[key]; }
  catch (e) { ok(label + ' → ' + e.message.slice(0, 40)); }
}

// ---------------------------------------------------------------- дата рождения
const d30 = await day(`yerevan_today() - interval '30 years'`);
const d16 = await day(`yerevan_today() - interval '16 years'`);
const d16minus = await day(`yerevan_today() - interval '16 years' + interval '1 day'`);
const d120 = await day(`yerevan_today() - interval '121 years' + interval '1 day'`);
const d121 = await day(`yerevan_today() - interval '121 years'`);
const tomorrow = await day(`yerevan_today() + 1`);

await signUp('ann', { full_name: 'Ann', lang: 'ru', marketing_consent: true, consent_source: 'signup_form', birth_date: d30 });
const ann = await one(`select birth_date::text b, onboarded, marketing_consent from profiles where id = $1`, [U.ann]);
check(ann.b === d30 && ann.onboarded && ann.marketing_consent, 'регистрация по почте: дата рождения из формы сохранена', JSON.stringify(ann));

await signUp('edge16', { consent_source: 'signup_form', birth_date: d16 });
check((await one(`select birth_date::text b from profiles where id = $1`, [U.edge16])).b === d16, 'ровно 16 лет сегодня — принято');
await signUp('edge120', { consent_source: 'signup_form', birth_date: d120 });
ok('120 полных лет — принято');
await signUpFails('kid', { consent_source: 'signup_form', birth_date: d16minus }, '16 лет без одного дня — регистрация отклонена');
await signUpFails('old', { consent_source: 'signup_form', birth_date: d121 }, '121 год — регистрация отклонена');
await signUpFails('future', { consent_source: 'signup_form', birth_date: tomorrow }, 'дата в будущем — регистрация отклонена');
await signUpFails('junk', { consent_source: 'signup_form', birth_date: 'not-a-date' }, 'мусор вместо даты — регистрация отклонена');
check((await one(`select count(*)::int n from auth.users where email in ('kid@t.am','old@t.am','future@t.am','junk@t.am')`)).n === 0, 'отклонённые регистрации не оставили аккаунтов');

// ---------------------------------------------------------------- первый вход (Google / Mail.ru)
await signUp('soc', { full_name: 'Social', provider: 'mailru' });
let me = (await as('soc', `select my_profile() p`)).rows[0].p;
check(me.birth_date === null && me.onboarded === false && me.email === 'soc@t.am', 'вход через соцсеть: профиль без даты, экран первого входа ещё не пройден');
await expectErr('soc', `select finish_onboarding(null, true)`, [], 'первый вход без даты рождения не завершается');
await expectErr('soc', `select finish_onboarding($1, true)`, [d16minus], 'первый вход: младше 16 отклонён');
me = (await as('soc', `select finish_onboarding($1, true) p`, [d30])).rows[0].p;
const soc = await one(`select birth_date::text b, onboarded, marketing_consent, consent_source, consent_at from profiles where id = $1`, [U.soc]);
check(me.onboarded && me.birth_date === d30 && soc.marketing_consent && soc.consent_source === 'onboarding_social' && soc.consent_at,
  'первый вход: дата и согласие сохранены, источник onboarding_social', JSON.stringify(soc));

await signUp('soc2', { full_name: 'No Consent' }, { provider: 'google' });
await as('soc2', `select finish_onboarding($1, false)`, [d30]);
const soc2 = await one(`select onboarded, marketing_consent, consent_at from profiles where id = $1`, [U.soc2]);
check(soc2.onboarded && !soc2.marketing_consent && soc2.consent_at === null, 'первый вход без галочки: согласия нет');
await expectErr('anon', `select finish_onboarding($1, true)`, [d30], 'гость не вызывает finish_onboarding');
await expectErr('anon', `select my_profile()`, [], 'гость не вызывает my_profile');

// ---------------------------------------------------------------- смена даты
const d25 = await day(`yerevan_today() - interval '25 years' - interval '1 month'`);   // другой месяц, чем d30
me = (await as('ann', `select set_birth_date($1) p`, [d25])).rows[0].p;
check(me.birth_date === d25, 'клиент меняет свою дату рождения в кабинете');
await expectErr('ann', `select set_birth_date($1)`, [d16minus], 'смена даты: младше 16 отклонено');
await expectErr('ann', `select set_birth_date($1)`, [tomorrow], 'смена даты: будущее отклонено');
await expectErr('ann', `select set_birth_date(null)`, [], 'смена даты: пусто отклонено');
await expectErr('ann', `update profiles set birth_date = null where id = $1`, [U.ann], 'дату нельзя очистить прямым запросом');
await expectErr('ann', `update profiles set birth_date = $2 where id = $1`, [U.ann, d16minus], 'прямой запрос тоже проверяет возраст');
await expectErr('mgr', `update profiles set birth_date = $2 where id = $1`, [U.ann, d30], 'менеджер не меняет чужую дату рождения');
check((await one(`select birth_date::text b from profiles where id = $1`, [U.ann])).b === d25, 'после отклонённых попыток дата прежняя');

// ---------------------------------------------------------------- кто видит дату рождения
await expectErr('mgr', `select birth_date from profiles`, [], 'менеджер: прямое чтение profiles.birth_date закрыто');
await expectErr('mgr', `select * from profiles`, [], 'менеджер: select * из profiles закрыт');
await expectErr('cli', `select birth_date from profiles where id = $1`, [U.cli], 'клиент читает свою дату только через my_profile()');
const mgrRows = (await as('mgr', `select id, full_name, role from profiles`)).rows;
check(mgrRows.length >= 4, 'менеджер по-прежнему читает остальные колонки profiles');
// as() оставляет за собой request.uid последнего пользователя — служебная правка идёт без него
await db.exec(`select set_config('request.uid', '', false)`);
await db.query(`update profiles set birth_date = $1 where id = any($2)`, [d30, [U.mgr, U.owner]]);

const asOwner = (await as('owner', `select * from users_list()`)).rows;
const oAnn = asOwner.find((u) => u.id === U.ann);
check(oAnn && oAnn.birth_date && oAnn.email === 'ann@t.am', 'владелец: users_list отдаёт дату рождения клиента');
check(!('bookings' in asOwner[0]) && 'requests' in asOwner[0] && 'purchases' in asOwner[0], 'users_list: счётчики заявок и покупок вместо бронирований');
const asMgr = (await as('mgr', `select * from users_list()`)).rows;
check(asMgr.length > 0 && asMgr.every((u) => u.birth_date === null), 'менеджер: users_list не отдаёт дату рождения ни у кого');
check(asMgr.every((u) => u.role !== 'client'), 'менеджер: в users_list только команда');
const asMkt = (await as('mkt', `select * from users_list()`)).rows;
check(asMkt.find((u) => u.id === U.mgr)?.birth_date != null, 'маркетолог: users_list отдаёт дату рождения');
await expectErr('cli', `select * from users_list()`, [], 'клиент не вызывает users_list');
await expectErr('anon', `select * from users_list()`, [], 'гость не вызывает users_list');

// ---------------------------------------------------------------- подписчики: только подтверждённые
await signUp('pending', { full_name: 'Pending', marketing_consent: true, consent_source: 'signup_form', birth_date: d30 }, { confirmed: false });
let aud = (await as('mkt', `select * from audience_list()`)).rows;
check(aud.some((a) => a.email === 'ann@t.am') && !aud.some((a) => a.email === 'pending@t.am'), 'audience_list: неподтверждённого адреса нет');
check(!aud.some((a) => a.email === 'soc2@t.am'), 'audience_list: без согласия не попадает');
check('birth_date' in aud[0] && 'requests' in aud[0] && !('bookings' in aud[0]), 'audience_list: дата рождения и счётчики вместо бронирований');
check((await one(`select count(*)::int n from marketing_audience where email = 'pending@t.am'`)).n === 0, 'вид marketing_audience: неподтверждённого адреса нет');
check(asOwner.length > 0 && (await as('owner', `select * from users_list()`)).rows.find((u) => u.id === U.pending)?.email_confirmed === false, 'users_list показывает, что почта не подтверждена');
await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [U.pending]);
aud = (await as('owner', `select * from audience_list()`)).rows;
check(aud.some((a) => a.email === 'pending@t.am'), 'audience_list: после подтверждения адрес появился');
await expectErr('mgr', `select * from audience_list()`, [], 'менеджер не вызывает audience_list');

// ---------------------------------------------------------------- именинники месяца
const month = Number(d30.slice(5, 7)), other = Number(d25.slice(5, 7));
await signUp('unconf', { full_name: 'Unconfirmed', marketing_consent: true, consent_source: 'signup_form', birth_date: d30 }, { confirmed: false });
let bd = (await as('mkt', `select * from birthdays($1)`, [month])).rows;
const names = bd.map((b) => b.email).sort().join(',');
check(names === 'pending@t.am,soc@t.am', 'birthdays: клиенты с согласием и подтверждённой почтой', names);
check(Object.keys(bd[0]).sort().join(',') === 'birth_date,email,full_name,id,lang', 'birthdays: имя, почта, дата, язык — ничего лишнего');
check(!bd.some((b) => ['unconf@t.am', 'soc2@t.am', 'mgr@t.am', 'owner@t.am'].includes(b.email)), 'birthdays: без неподтверждённых, без несогласных, без команды');
const bdOther = (await as('owner', `select * from birthdays($1)`, [other])).rows;
check(bdOther.length === 1 && bdOther[0].email === 'ann@t.am' && String(bdOther[0].birth_date).length > 0, 'birthdays: другой месяц — другие люди', bdOther.map((b) => b.email).join());
check((await as('owner', `select * from birthdays()`)).rows.length === bd.length, 'birthdays() без аргумента — текущий месяц');
await expectErr('mgr', `select * from birthdays($1)`, [month], 'менеджер не получает именинников');
await expectErr('cli', `select * from birthdays($1)`, [month], 'клиент не получает именинников');
await expectErr('anon', `select * from birthdays($1)`, [month], 'гость не получает именинников');
await expectErr('mkt', `select * from birthdays(13)`, [], 'birthdays: месяц 13 отклонён');

// ---------------------------------------------------------------- мои заявки
const lead = async (who, p) => (await as(who, `select submit_lead($1) id`, [JSON.stringify(p)])).rows[0].id;
const annLead = await lead('ann', { name: 'Ann', phone: '+374 91 400-001', tour: 'dubai', message: 'секрет Анны' });
const annLead2 = await lead('ann', { name: 'Ann', phone: '+374 91 400-002' });
const socLead = await lead('soc', { name: 'Social', phone: '+374 91 400-003', tour: 'sharm' });
await lead('anon', { name: 'Guest', phone: '+374 91 400-004' });

let mine = (await as('ann', `select * from my_requests()`)).rows;
check(mine.length === 2 && mine.every((r) => [annLead, annLead2].includes(r.id)), 'клиент видит только свои заявки', 'строк: ' + mine.length);
check(Object.keys(mine[0]).sort().join(',') === 'created_at,id,status,tour,tour_title', 'my_requests: без суммы, дохода, телефона и заметок');
const dubai = mine.find((r) => r.id === annLead);
check(dubai.tour === 'dubai' && dubai.tour_title.ru === 'Дубай' && dubai.tour_title.en === 'Dubai' && dubai.tour_title.hy, 'my_requests: название тура на трёх языках');
check(dubai.status === 'received', 'новая заявка — «получили»');
check((await as('soc', `select * from my_requests()`)).rows.map((r) => r.id).join() === socLead, 'второй клиент видит только свою');
check((await as('cli', `select * from my_requests()`)).rows.length === 0, 'клиент без заявок видит пустой список');
check((await as('ann', `select count(*)::int n from leads`)).rows[0].n === 0, 'таблица leads клиенту по-прежнему закрыта');
await expectErr('anon', `select * from my_requests()`, [], 'гость не вызывает my_requests');

const statusOf = async () => (await as('ann', `select status from my_requests() where id = $1`, [annLead])).rows[0].status;
await as('mgr', `update leads set status = 'contacted' where id = $1`, [annLead]);
check((await statusOf()) === 'in_touch', 'contacted — «на связи»');
await as('mgr', `update leads set status = 'quoted', value = 1500 where id = $1`, [annLead]);
check((await statusOf()) === 'offer', 'quoted — «предложение отправлено»');
await as('mgr', `update leads set status = 'won', value = 1500, profit = 150 where id = $1`, [annLead]);
check((await statusOf()) === 'done', 'won — «оформлено»');
await as('mgr', `insert into lead_activity(lead_id, actor, kind, body) values ($1, $2, 'note', 'внутренняя заметка')`, [annLead, U.mgr]);
const raw = JSON.stringify((await as('ann', `select * from my_requests()`)).rows);
check(!/1500|150\b|заметка|секрет|400-001/.test(raw), 'в ответе my_requests нет суммы, дохода, заметки, сообщения и телефона');
await as('mgr', `update leads set status = 'lost', lost_reason = 'Передумал' where id = $1`, [annLead2]);
check((await as('ann', `select status from my_requests() where id = $1`, [annLead2])).rows[0].status === 'closed', 'lost — «закрыто»');
await as('mgr', `update leads set status = 'spam' where id = $1`, [socLead]);
check((await as('soc', `select status from my_requests()`)).rows[0].status === 'closed', 'spam клиенту показывается как «закрыто»');

// счётчики в списках панели
const cnt = (await as('owner', `select * from users_list()`)).rows;
const cAnn = cnt.find((u) => u.id === U.ann), cSoc = cnt.find((u) => u.id === U.soc);
check(Number(cAnn.requests) === 2 && Number(cAnn.purchases) === 1, 'users_list: у клиента 2 заявки, 1 покупка', `${cAnn.requests}/${cAnn.purchases}`);
check(Number(cSoc.requests) === 0 && Number(cSoc.purchases) === 0, 'users_list: спам в счётчик заявок не идёт');
const aAnn = (await as('mkt', `select * from audience_list()`)).rows.find((a) => a.id === U.ann);
check(Number(aAnn.requests) === 2 && Number(aAnn.purchases) === 1, 'audience_list: те же счётчики');

// ---------------------------------------------------------------- bookings и coupon_redemptions заморожены
await expectErr('cli', `insert into bookings(user_id, tour) values ($1, 'dubai')`, [U.cli], 'клиент не создаёт бронирование');
await expectErr('mgr', `insert into bookings(user_id, tour) values ($1, 'dubai')`, [U.cli], 'менеджер не создаёт бронирование');
await expectErr('owner', `update bookings set tour = 'x'`, [], 'владелец не правит bookings');
await expectErr('owner', `delete from bookings`, [], 'владелец не удаляет из bookings');
const cid = (await one(`insert into coupons(code, discount_pct) values ('FROZEN5', 5) returning id`)).id;
await expectErr('cli', `insert into coupon_redemptions(coupon_id, user_id) values ($1, $2)`, [cid, U.cli], 'клиент не пишет в coupon_redemptions');
await expectErr('mgr', `insert into coupon_redemptions(coupon_id, user_id) values ($1, $2)`, [cid, U.cli], 'менеджер не пишет в coupon_redemptions');
check((await as('cli', `select count(*)::int n from bookings`)).rows[0].n === 0, 'чтение bookings осталось (пусто)');
