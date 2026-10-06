// Этап 1 — права и правила продажи: миграция 010_guards (ТЗ §2, §4.3, §4.4, §4.5; приёмка §9 п.1 и п.5).
// Запуск: npm test  (или node supabase/test/run.mjs 10)
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено: ' + JSON.stringify(got))));
/** запрос обязан упасть именно с этой ошибкой */
async function rejects(who, sql, params, code, label) {
  try { await as(who, sql, params); bad(label + ' — запрос прошёл'); }
  catch (e) { e.message.includes(code) ? ok(label + ' → ' + code) : bad(label + ' — другая ошибка: ' + e.message.slice(0, 80)); }
}
const lead = async (id) => one(`select * from leads where id = $1`, [id]);
const acts = async (id, kind) => (await db.query(`select * from lead_activity where lead_id = $1 and kind = $2 order by created_at, id`, [id, kind])).rows;
const DAY = 86400e3;
const near = (a, b, ms = 5000) => Math.abs(new Date(a) - new Date(b)) < ms;

// ---------------------------------------------------------------- §2 роли
console.log('  роли');
await rejects('mgr', `update profiles set role = 'admin' where id = $1`, [U.mgr], 'role_change_forbidden', 'менеджер не делает себя владельцем');
await rejects('cli', `update profiles set role = 'manager' where id = $1`, [U.cli], 'role_change_forbidden', 'клиент не делает себя менеджером');
await rejects('owner', `update profiles set role = 'manager' where id = $1`, [U.cli], 'role_change_forbidden', 'даже владелец меняет роль только через set_role');
check((await as('mgr', `update profiles set full_name = 'x' where id = $1`, [U.cli])).affectedRows === 0, 'менеджер не правит чужой профиль');
check((await as('mgr', `update profiles set role = 'admin' where id = $1`, [U.cli])).affectedRows === 0, 'менеджер не меняет чужую роль');
check((await as('anon', `update profiles set role = 'admin'`)).affectedRows === 0, 'гость не трогает профили');
check((await one(`select count(*)::int n from profiles where role = 'admin'`)).n === 1, 'владелец по-прежнему один');

await as('cli', `update profiles set full_name = 'Клиент', phone = '+374 91 1', lang = 'ru', marketing_consent = false, consent_at = null, consent_source = 'cabinet', onboarded = true where id = $1`, [U.cli]);
const cp = await one(`select full_name, lang, marketing_consent, onboarded from profiles where id = $1`, [U.cli]);
check(cp.full_name === 'Клиент' && cp.lang === 'ru' && cp.marketing_consent === false && cp.onboarded === true, 'клиент меняет имя, телефон, язык и согласие', cp);
await rejects('cli', `update profiles set created_at = now() - interval '9 years' where id = $1`, [U.cli], 'profile_field_forbidden', 'клиент не меняет остальные поля своей строки');
await as('mgr', `update profiles set full_name = 'Менеджер' where id = $1`, [U.mgr]);
check((await one(`select full_name from profiles where id = $1`, [U.mgr])).full_name === 'Менеджер', 'сотрудник правит своё имя');
await as('owner', `update profiles set full_name = 'Клиент 2' where id = $1`, [U.cli]);
check((await one(`select full_name from profiles where id = $1`, [U.cli])).full_name === 'Клиент 2', 'владелец правит чужой профиль (не роль)');

await as('owner', `select set_role($1, 'manager')`, [U.mkt]);
check((await one(`select role::text r from profiles where id = $1`, [U.mkt])).r === 'manager', 'set_role работает для владельца');
await as('owner', `select set_role($1, 'marketer')`, [U.mkt]);
await rejects('mgr', `select set_role($1, 'admin')`, [U.mgr], 'forbidden', 'менеджер не вызывает set_role');
await rejects('owner', `select set_role($1, 'client')`, [U.owner], 'cannot_change_own_role', 'владелец не разжалует сам себя');
// последний владелец: мимо set_role, от имени базы — сторож всё равно не даёт
try { await db.query(`update profiles set role = 'client' where id = $1`, [U.owner]); bad('последний владелец разжалован'); }
catch (e) { check(e.message.includes('last_owner'), 'последнего владельца разжаловать нельзя → last_owner', e.message); }
// второй владелец появился — первого можно разжаловать, второго после этого уже нет
await as('owner', `select set_role($1, 'admin')`, [U.mgr]);
await as('mgr', `select set_role($1, 'manager')`, [U.owner]);
check((await one(`select role::text r from profiles where id = $1`, [U.owner])).r === 'manager', 'при двух владельцах одного разжаловать можно');
try { await db.query(`update profiles set role = 'manager' where id = $1`, [U.mgr]); bad('остались без владельца'); }
catch (e) { check(e.message.includes('last_owner'), 'оставшийся владелец защищён', e.message); }
await as('mgr', `select set_role($1, 'admin')`, [U.owner]);
await as('owner', `select set_role($1, 'manager')`, [U.mgr]);
check((await one(`select string_agg(role::text, ',' order by role::text) r from profiles`)).r === 'admin,client,manager,marketer', 'роли возвращены на место');

// ---------------------------------------------------------------- §4.3 работа с заявкой
console.log('  заявка');
await db.query(`update site_settings set value = value || '{"currency":"AMD"}' where key = 'company'`);
const siteId = (await as('anon', `select submit_lead($1) id`, [JSON.stringify({ name: 'Сайт', phone: '+374 91 100200', coupon_code: 'guard10' })])).rows[0].id;
let s = await lead(siteId);
check(s.status === 'new' && s.first_response_at === null && s.closed_at === null, 'заявка с формы: «новая», без ответа', s.status);
check(s.currency === 'AMD', 'валюта заявки с сайта — из «Контакты и реквизиты»', s.currency);

for (const src of ['phone', 'walk_in', 'instagram', 'manual']) {
  const r = (await as('mgr', `insert into leads(name, phone, source) values ('Ручная', '+374 91 300400', $1) returning *`, [src])).rows[0];
  check(r.status === 'contacted' && r.first_response_at && near(r.first_response_at, r.created_at, 1), `ручной источник ${src}: сразу «на связи», first_response_at = created_at`, r.status);
}
const man = (await as('mgr', `insert into leads(name, phone, source, status, currency, first_response_at) values ('Ручная', '+374 91 300401', 'phone', 'new', 'RUB', now() + interval '1 hour') returning *`)).rows[0];
check(man.status === 'contacted' && near(man.first_response_at, man.created_at, 1) && man.currency === 'AMD', 'присланные «new», чужая валюта и время ответа у ручной заявки игнорируются', man);
await as('mgr', `update leads set status = 'new' where id = $1`, [man.id]);
check((await lead(man.id)).status === 'contacted', 'ручную заявку нельзя вернуть в «новые»');
await as('mgr', `update leads set currency = 'EUR', tags = '{vip}' where id = $1`, [man.id]);
check((await lead(man.id)).currency === 'AMD', 'валюту нельзя поменять правкой');

await as('mgr', `update leads set status = 'contacted' where id = $1`, [siteId]);
s = await lead(siteId);
const fr = s.first_response_at;
check(fr && near(fr, Date.now()), 'уход из «новой» ставит first_response_at');
await as('mgr', `update leads set status = 'quoted', value = 1500 where id = $1`, [siteId]);
check(String((await lead(siteId)).first_response_at) === String(fr), 'first_response_at ставится один раз');
const st = (await acts(siteId, 'status')).map((a) => a.meta.from + '>' + a.meta.to + ':' + (a.actor === U.mgr)).join(' ');
check(st === 'new>contacted:true contacted>quoted:true', 'смена статуса в истории: кто и что', st);

await rejects('mgr', `update leads set status = 'lost' where id = $1`, [siteId], 'lost_reason_required', 'отказ без причины');
await rejects('mgr', `update leads set status = 'lost', lost_reason = '  ' where id = $1`, [siteId], 'lost_reason_required', 'отказ с пустой причиной');
await rejects('mgr', `insert into leads(name, phone, source, status) values ('X', '+374 91 300402', 'phone', 'lost')`, [], 'lost_reason_required', 'отказ без причины одной формой');
await as('mgr', `update leads set status = 'lost', lost_reason = 'Дорого' where id = $1`, [siteId]);
s = await lead(siteId);
check(s.status === 'lost' && near(s.closed_at, Date.now()), 'отказ с причиной: closed_at = сейчас');
await rejects('mgr', `update leads set lost_reason = null where id = $1`, [siteId], 'lost_reason_required', 'причину отказа нельзя стереть');
await as('mgr', `update leads set status = 'quoted' where id = $1`, [siteId]);
check((await lead(siteId)).closed_at === null, 'выход из закрытого статуса очищает closed_at');
await as('mgr', `update leads set closed_at = now() - interval '1 day' where id = $1`, [siteId]);
check((await lead(siteId)).closed_at === null, 'у открытой заявки closed_at не бывает');
await as('mgr', `update leads set status = 'spam' where id = $1`, [siteId]);
check(near((await lead(siteId)).closed_at, Date.now()), 'спам: closed_at = сейчас');
await as('mgr', `update leads set status = 'quoted' where id = $1`, [siteId]);

// ---------------------------------------------------------------- §4.4 продажа
console.log('  продажа');
await rejects('mgr', `update leads set status = 'won', value = null where id = $1`, [siteId], 'sale_needs_value', 'продажа без суммы');
await rejects('mgr', `update leads set status = 'won', value = 0 where id = $1`, [siteId], 'sale_needs_value', 'продажа с нулевой суммой');
await rejects('mgr', `update leads set status = 'won', value = 1500, profit = 5000 where id = $1`, [siteId], 'profit_out_of_range', 'доход больше суммы');
await rejects('mgr', `update leads set status = 'won', value = 1500, profit = -1 where id = $1`, [siteId], 'profit_out_of_range', 'отрицательный доход');
await rejects('mgr', `update leads set status = 'won', value = 1500, closed_at = now() + interval '30 days' where id = $1`, [siteId], 'sale_date_in_future', 'продажа с датой через месяц');
await rejects('mgr', `insert into leads(name, phone, source, status) values ('X', '+374 91 300403', 'walk_in', 'won')`, [], 'sale_needs_value', 'продажа одной формой без суммы');
await rejects('mgr', `insert into leads(name, phone, source, status, value, profit, closed_at) values ('X', '+374 91 300404', 'walk_in', 'won', 100, 5000, now() + interval '30 days')`, [], 'sale_date_in_future', 'пример из ТЗ: доход 5000 и дата через месяц');
await rejects('mgr', `insert into leads(name, phone, source, status, value, profit) values ('X', '+374 91 300405', 'walk_in', 'won', 100, 5000)`, [], 'profit_out_of_range', 'продажа одной формой с доходом больше суммы');
await rejects('mgr', `update leads set value = -5 where id = $1`, [siteId], 'value_negative', 'отрицательная сумма предложения');
await rejects('mgr', `update leads set profit = 10, value = null where id = $1`, [siteId], 'profit_out_of_range', 'доход без суммы');
check((await lead(siteId)).status === 'quoted', 'после отклонённых попыток заявка не изменилась');

// сквозной кусок §9 п.2: «Продажа» вчерашней датой
const yesterday = new Date(Date.now() - DAY).toISOString();
await db.query(`insert into coupons(code, discount_pct) values ('GUARD10', 10)`);
const used = async (code = 'GUARD10') => (await one(`select used_count from coupons where code = $1`, [code])).used_count;
await db.query(`update site_settings set value = value || '{"currency":"USD"}' where key = 'company'`);
await as('mgr', `update leads set status = 'won', value = 2000, profit = 240, currency = 'RUB', closed_at = $2 where id = $1`, [siteId, yesterday]);
s = await lead(siteId);
check(s.status === 'won' && near(s.closed_at, yesterday, 1), 'присланная дата продажи сохраняется одним запросом', s.closed_at);
check(s.currency === 'USD', 'валюта продажи — серверная, присланная отброшена', s.currency);
check(Number(s.value) === 2000 && Number(s.profit) === 240, 'сумма и доход записаны');
check((await used()) === 1, 'промокод: использован 1');
check((await acts(siteId, 'money')).length === 0, 'сама продажа — запись о статусе, не денежная правка');

await as('mgr', `update leads set closed_at = now() + interval '2 minutes' where id = $1`, [siteId]);
s = await lead(siteId);
check(new Date(s.closed_at) <= new Date() && near(s.closed_at, Date.now()), 'часы браузера чуть спешат — это «сейчас», а не ошибка');
await rejects('mgr', `update leads set closed_at = now() + interval '1 day' where id = $1`, [siteId], 'sale_date_in_future', 'дату проданной заявки нельзя увести в будущее');
await as('mgr', `update leads set closed_at = $2 where id = $1`, [siteId, yesterday]);
await rejects('mgr', `update leads set value = 0 where id = $1`, [siteId], 'sale_needs_value', 'у продажи нельзя обнулить сумму');
await rejects('mgr', `update leads set value = 100 where id = $1`, [siteId], 'profit_out_of_range', 'сумму нельзя опустить ниже дохода');

// история денежных правок
await db.query(`delete from lead_activity where lead_id = $1 and kind = 'money'`, [siteId]);
await as('mgr', `update leads set value = 2200 where id = $1`, [siteId]);
await as('owner', `update leads set profit = 300, closed_at = $2 where id = $1`, [siteId, new Date(Date.now() - 2 * DAY).toISOString()]);
await as('mgr', `update leads set tags = '{vip}' where id = $1`, [siteId]);
const money = await acts(siteId, 'money');
check(money.length === 2, 'две денежные правки — две записи, правка тегов не в счёт', money.length);
check(money[0].actor === U.mgr && Number(money[0].meta.value.from) === 2000 && Number(money[0].meta.value.to) === 2200 && !money[0].meta.profit, 'сумма: кто, было → стало', money[0].meta);
check(money[1].actor === U.owner && Number(money[1].meta.profit.from) === 240 && Number(money[1].meta.profit.to) === 300 && near(money[1].meta.closed_at.from, yesterday, 1), 'доход и дата продажи: кто, было → стало', money[1].meta);
await rejects('mgr', `insert into lead_activity(lead_id, actor, kind, meta) values ($1, $2, 'money', '{}')`, [siteId, U.mgr], 'row-level security', 'денежную запись нельзя вписать руками');
await rejects('mgr', `insert into lead_activity(lead_id, actor, kind, body) values ($1, $2, 'status', 'won')`, [siteId, U.mgr], 'row-level security', 'запись о статусе нельзя вписать руками');
await as('mgr', `insert into lead_activity(lead_id, actor, kind, body) values ($1, $2, 'note', 'заметка')`, [siteId, U.mgr]);
ok('заметку менеджер добавляет как раньше');

// старые продажи без суммы не блокируются
await db.exec(`alter table leads disable trigger leads_guard`);
const old = (await db.query(`insert into leads(name, phone, source, status, closed_at) values ('Старая', '+374 91 300406', 'form', 'won', now() - interval '40 days') returning id`)).rows[0].id;
await db.exec(`alter table leads enable trigger leads_guard`);
await as('mgr', `update leads set tags = '{старая}', assigned_to = $2 where id = $1`, [old, U.mgr]);
s = await lead(old);
check(s.tags[0] === 'старая' && s.value === null && Date.now() - new Date(s.closed_at) > 39 * DAY, 'старая продажа без суммы правится, дата не сдвигается', s);
await rejects('mgr', `update leads set profit = 50 where id = $1`, [old], 'profit_out_of_range', 'но доход без суммы ей не вписать');
await as('mgr', `update leads set value = 900 where id = $1`, [old]);
check(Number((await lead(old)).value) === 900, 'сумму старой продаже дописать можно');

// ---------------------------------------------------------------- §4.5 промокод, §9 п.5 переоткрытие и возврат
console.log('  промокод');
const direct = (await as('mgr', `insert into leads(name, phone, source, status, value, profit, coupon_code, closed_at) values ('Пришёл и купил', '+374 91 300407', 'walk_in', 'won', 1800, 200, 'guard10', $1) returning *`, [yesterday])).rows[0];
check(direct.status === 'won' && near(direct.closed_at, yesterday, 1) && near(direct.first_response_at, direct.created_at, 1), 'продажа одной формой задним числом');
check((await used()) === 2, 'продажа одной формой увеличивает счётчик', await used());

await db.query(`insert into coupons(code, discount_pct) values ('OTHER5', 5)`);
await as('mgr', `update leads set coupon_code = 'OTHER5' where id = $1`, [direct.id]);
check((await used()) === 1 && (await used('OTHER5')) === 1, 'смена кода у проданной заявки пересчитывает оба кода');
await as('mgr', `update leads set coupon_code = null where id = $1`, [direct.id]);
check((await used('OTHER5')) === 0, 'снятый код освобождается');
await as('mgr', `update leads set coupon_code = 'Guard10' where id = $1`, [direct.id]);
check((await used()) === 2, 'регистр кода не важен');

check((await as('mgr', `delete from leads where id = $1`, [direct.id])).affectedRows === 0, 'менеджер заявку не удаляет');
await as('owner', `delete from leads where id = $1`, [direct.id]);
check((await used()) === 1, 'удаление проданной заявки уменьшает счётчик');
const del = await one(`select actor, action, before ->> 'name' as name, before ->> 'value' as value, after from audit_log where table_name = 'leads' and row_id = $1`, [direct.id]);
check(del && del.action === 'delete' && del.actor === U.owner && del.name === 'Пришёл и купил' && Number(del.value) === 1800 && del.after === null, 'удаление заявки в audit_log: кто и что было', del);
check((await as('mgr', `select count(*)::int n from audit_log`)).rows[0].n === 0, 'журнал по-прежнему читает только владелец');

await as('mkt', `update coupons set used_count = 99, description = 'x' where code = 'GUARD10'`);
check((await used()) === 1, 'used_count руками не меняется');
await as('mkt', `insert into coupons(code, discount_pct, used_count) values ('FRESH', 5, 40)`);
check((await used('FRESH')) === 0, 'новый код начинается с честного нуля');

// переоткрытие: из выручки ушла, промокод вернулся, запись осталась
const revenue = async () => Number((await one(`select coalesce(sum(value), 0) v from leads where status = 'won' and id = $1`, [siteId])).v);
check((await revenue()) === 2200, 'продажа в выручке');
await as('mgr', `update leads set status = 'quoted' where id = $1`, [siteId]);
s = await lead(siteId);
check((await revenue()) === 0 && s.closed_at === null, 'переоткрытие убирает продажу из выручки');
check((await used()) === 0, 'переоткрытие возвращает промокод');
const last = (await acts(siteId, 'status')).pop();
check(last.meta.from === 'won' && last.meta.to === 'quoted' && last.actor === U.mgr, 'переоткрытие осталось в истории', last.meta);

// возврат после продажи = «Отказ» с причиной «Возврат»
await as('mgr', `update leads set status = 'won', closed_at = $2 where id = $1`, [siteId, yesterday]);
check((await used()) === 1 && (await revenue()) === 2200, 'продана снова');
await rejects('mgr', `update leads set status = 'lost', lost_reason = null where id = $1`, [siteId], 'lost_reason_required', 'возврат без причины');
await as('owner', `update leads set status = 'lost', lost_reason = 'Возврат' where id = $1`, [siteId]);
s = await lead(siteId);
check(s.status === 'lost' && s.lost_reason === 'Возврат' && (await revenue()) === 0, 'возврат: продажа ушла из выручки');
check(Number(s.value) === 2200 && Number(s.profit) === 300, 'сумма и доход в строке сохранены для справки');
check(near(s.closed_at, Date.now()), 'дата отказа — день возврата');
check((await used()) === 0, 'возврат освобождает промокод');
const ret = (await acts(siteId, 'status')).pop();
check(ret.meta.from === 'won' && ret.meta.to === 'lost' && ret.actor === U.owner, 'в истории: кто и когда вернул', ret.meta);

// маркетолог и клиент мимо панели ничего из этого не делают
await rejects('mkt', `insert into leads(name, phone, source, status, value) values ('X', '+374 91 300408', 'walk_in', 'won', 10)`, [], 'row-level security', 'маркетолог продажу не вносит');
check((await as('cli', `update leads set value = 1 where id = $1`, [siteId])).affectedRows === 0, 'клиент заявку не правит');
