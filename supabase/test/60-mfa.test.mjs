// Двухфакторный вход (миграция 060): пока сотрудник его не включил — пароля достаточно;
// включил — без кода сессия не несёт роли, даже если запрос идёт мимо панели.
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const check = (cond, label) => (cond ? ok(label) : bad(label));
const aal = (level) => db.exec(`select set_config('request.aal', '${level}', false)`);
const n = async (who, sql) => (await as(who, sql)).rows[0].n;

await as('mgr', `insert into leads (name, phone, source, status, first_response_at) values ('Клиент', '+374 91 111222', 'phone', 'contacted', now())`);

// ---- никто ничего не включал: всё как раньше
await aal('aal1');
check(await n('mgr', `select count(*)::int n from leads`) === 1, 'без двухфакторного входа менеджер видит заявки по паролю');
check((await as('owner', `select is_owner() v`)).rows[0].v === true, 'владелец остаётся владельцем');

// ---- фактор добавлен, но не подтверждён кодом — ещё не считается
await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')`, [U.mgr]);
check(await n('mgr', `select count(*)::int n from leads`) === 1, 'неподтверждённый фактор вход не закрывает');

// ---- менеджер включил: пароль без кода больше ничего не даёт
await db.query(`update auth.mfa_factors set status = 'verified' where user_id = $1`, [U.mgr]);
check(await n('mgr', `select count(*)::int n from leads`) === 0, 'включил → по одному паролю заявок не видно');
check((await as('mgr', `select my_role() r`)).rows[0].r === null, 'включил → роли у сессии без кода нет');
await expectErr('mgr', `insert into leads (name, phone, source) values ('X', '+374 91 000000', 'phone')`, [], 'включил → без кода заявку не создать');
await expectErr('mgr', `select stats_traffic(now() - interval '1 day', now())`, [], 'включил → без кода отчёты закрыты');
check((await as('mgr', `select count(*)::int n from profiles where id = $1`, [U.mgr])).rows[0].n === 1, 'свой профиль виден и без кода (кабинет работает)');

// ---- чужая настройка никого не касается
check((await as('owner', `select count(*)::int n from leads`)).rows[0].n === 1, 'владелец без двухфакторного входа работает как раньше');

// ---- код введён
await aal('aal2');
check(await n('mgr', `select count(*)::int n from leads`) === 1, 'код введён → заявки снова видны');
check((await as('mgr', `select my_role() r`)).rows[0].r === 'manager', 'код введён → роль на месте');

// ---- владелец включил у себя: без кода роли не раздаёт
await aal('aal1');
await db.query(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [U.owner]);
await expectErr('owner', `select set_role($1, 'manager')`, [U.cli], 'владелец включил → без кода роли не назначает');
await aal('aal2');
await as('owner', `select set_role($1, 'manager')`, [U.cli]);
ok('владелец с кодом назначает роли');
await as('owner', `select set_role($1, 'client')`, [U.cli]);

// ---- выключил: снова достаточно пароля
await aal('aal1');
await db.query(`delete from auth.mfa_factors where user_id = $1`, [U.mgr]);
check(await n('mgr', `select count(*)::int n from leads`) === 1, 'выключил → пароля снова достаточно');

// ---- посетителя сайта это не трогает
await as('anon', `select public_site()`);
ok('сайт для гостя работает');
