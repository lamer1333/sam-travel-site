// Этап 15 — поездка клиента в кабинете: миграция 150_travel.sql.
// Список документов и план поездки вошедшего клиента: my_travel / save_travel.
// Запуск: npm test  (или node supabase/test/run.mjs 150)
import { db, U, as, ok, bad, expectErr } from './_db.mjs';

const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const val = async (who, sql, params) => Object.values((await as(who, sql, params)).rows[0])[0];

const CL = { dest: 'europe', type: 'tourist', checked: { 'europe-tourist-0': true, 'europe-tourist-3': true } };
const PLAN = { dest: 'greece', people: 2, from: '2026-12-01', to: '2026-12-10', meals: ['breakfast'] };

check((await val('cli', `select my_travel() t`)) === null, 'пока ничего не сохранено — my_travel() пуст');

let t = await val('cli', `select save_travel($1, $2) t`, [CL, PLAN]);
check(t.checklist.dest === 'europe' && t.checklist.checked['europe-tourist-3'] === true && t.plan.dest === 'greece' && t.updated_at,
  'клиент сохраняет список документов и план поездки', t);
t = await val('cli', `select my_travel() t`);
check(t.plan.people === 2 && t.plan.meals[0] === 'breakfast', 'и получает их обратно', t);

t = await val('cli', `select save_travel($1, $2) t`, [{ dest: 'japan', type: 'tourist', checked: {} }, {}]);
check(t.checklist.dest === 'japan' && JSON.stringify(t.plan) === '{}', 'повторное сохранение заменяет прежнее', t);
check((await db.query(`select count(*)::int n from client_travel where user_id = $1`, [U.cli])).rows[0].n === 1, 'строка у человека одна');

t = await val('cli', `select save_travel(null, null) t`);
check(JSON.stringify(t.checklist) === '{}' && JSON.stringify(t.plan) === '{}', 'пустое сохранение очищает оба поля', t);

// чужого не видно
await as('mgr', `select save_travel($1, $2)`, [{ dest: 'usa' }, { dest: 'uae' }]);
t = await val('cli', `select my_travel() t`);
check(t.checklist.dest === undefined, 'клиент не видит то, что сохранил другой человек', t);
check((await val('owner', `select my_travel() t`)) === null, 'владелец через my_travel() видит только своё — у него пусто');

// вид и размер
await expectErr('cli', `select save_travel($1::jsonb, '{}'::jsonb)`, ['[1,2]'], 'массив вместо объекта отклонён');
await expectErr('cli', `select save_travel($1::jsonb, '{}'::jsonb)`, [JSON.stringify({ x: 'я'.repeat(5000) })], 'слишком большой список отклонён');
await expectErr('cli', `select save_travel('{}'::jsonb, $1::jsonb)`, [JSON.stringify({ x: 'a'.repeat(2100) })], 'слишком большой план отклонён');

// доступ
await expectErr('anon', `select my_travel()`, [], 'гость не вызывает my_travel');
await expectErr('anon', `select save_travel('{}'::jsonb, '{}'::jsonb)`, [], 'гость не вызывает save_travel');
await expectErr('cli', `select * from client_travel`, [], 'таблицу напрямую не читает даже вошедший');
await expectErr('mgr', `update client_travel set plan = '{}'`, [], 'и не пишет сотрудник');

// аккаунт удалён — строка уходит вместе с профилем
await db.query(`delete from profiles where id = $1`, [U.mgr]);
check((await db.query(`select count(*)::int n from client_travel where user_id = $1`, [U.mgr])).rows[0].n === 0, 'после удаления профиля его поездка удалена');
