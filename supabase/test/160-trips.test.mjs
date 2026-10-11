// Этап 16 — поездки клиентов в панели: миграция 160_trips.sql.
// client_trips(): владелец и менеджер видят, что клиент выбрал в кабинете.
// Запуск: npm test  (или node supabase/test/run.mjs 160)
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const rows = async (who) => (await as(who, `select * from client_trips()`)).rows;

// второй клиент — с пустым кабинетом; у роли «Контент» своя учётная запись
for (const [k, role] of [['cli2', 'client'], ['smm', 'content']]) {
  const r = await db.query(`insert into auth.users(email, raw_user_meta_data) values ($1, $2) returning id`, [k + '@t.am', JSON.stringify({ full_name: k, consent_source: 'signup_form' })]);
  U[k] = r.rows[0].id;
  await db.query(`update public.profiles set role = $1::user_role where id = $2`, [role, U[k]]);
}

check((await rows('owner')).length === 0, 'пока никто ничего не сохранил — список пуст');

await as('cli', `select save_travel($1, $2)`, [{ dest: 'europe', type: 'tourist', checked: { 'europe-tourist-0': true } }, { dest: 'greece', people: 2, from: '2026-12-01', to: '2026-12-10', meals: ['breakfast'] }]);
await as('cli2', `select save_travel('{}'::jsonb, '{}'::jsonb)`);
await as('mgr', `select save_travel($1, $2)`, [{ dest: 'usa' }, { dest: 'uae' }]);

const o = await rows('owner');
check(o.length === 1 && o[0].id === U.cli && o[0].email === 'cli@t.am' && o[0].plan.dest === 'greece' && o[0].checklist.checked['europe-tourist-0'] === true && o[0].updated_at,
  'владелец видит поездку клиента: кто, куда, когда, какие документы отмечены', o);
check(!('birth_date' in o[0]), 'даты рождения в ответе нет');
const m = await rows('mgr');
check(m.length === 1 && m[0].id === U.cli && m[0].plan.people === 2, 'менеджер видит то же самое', m);
check(!o.some((r) => r.id === U.cli2), 'клиент с пустым кабинетом в список не попадает');
check(!o.some((r) => r.id === U.mgr), 'черновик сотрудника в список не попадает');

await as('cli2', `select save_travel($1, '{}'::jsonb)`, [{ dest: 'japan', type: 'tourist', checked: {} }]);
const o2 = await rows('owner');
check(o2.length === 2 && o2[0].id === U.cli2, 'выбрал только страну для документов — уже виден; свежие сверху', o2.map((r) => r.id));

// менеджеру по-прежнему закрыт остальной список клиентов
check((await as('mgr', `select * from users_list()`)).rows.every((u) => u.role !== 'client'), 'users_list менеджеру клиентов по-прежнему не отдаёт');

await expectErr('mkt', `select * from client_trips()`, [], 'маркетолог client_trips не вызывает');
await expectErr('smm', `select * from client_trips()`, [], 'роль «Контент» client_trips не вызывает');
await expectErr('cli', `select * from client_trips()`, [], 'клиент client_trips не вызывает');
await expectErr('anon', `select * from client_trips()`, [], 'гость client_trips не вызывает');

// ---------------------------------------------------------------- как панель это показывает
// js/admin/trips.js — без DOM; js/pages.js кладёт SAM_PAGES в window
import fs from 'node:fs';
const src = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const T = await import('data:text/javascript;base64,' + Buffer.from(src('js/admin/trips.js')).toString('base64'));
const win = {}; new Function('window', src('js/pages.js'))(win);
const today = new Date(2026, 10, 20);
let v = T.tripView(o[0], win.SAM_PAGES, today);
check(v.dest === 'Греция' && v.dates === '1 дек 2026 — 10 дек 2026' && v.days === 11 && v.people === 2 && v.meals === 'завтрак',
  'поездка словами: направление, даты, сколько дней до вылета, люди, питание', v);
check(v.docs.label === 'Европа (Шенген) · Туристическая' && v.docs.done === 1 && v.docs.total === 14, 'документы: страна, тип визы, собрано 1 из 14', v.docs);
v = T.tripView({ plan: {}, checklist: { dest: 'europe', type: 'business', checked: { 'europe-tourist-0': true, 'europe-business-1': true, 'europe-business-99': true, 'usa-tourist-0': true } } }, win.SAM_PAGES, today);
check(v.dest === '' && v.dates === '' && v.days === null && v.docs.done === 1, 'считаются отметки только выбранного сейчас списка', v);
v = T.tripView({ plan: { dest: 'atlantis', from: '2026-11-20' }, checklist: { dest: 'mars' } }, win.SAM_PAGES, today);
check(v.dest === 'atlantis' && v.days === 0 && v.docs.label === 'mars' && v.docs.total === 0, 'незнакомые ключи показываются как есть, без ошибки', v);
