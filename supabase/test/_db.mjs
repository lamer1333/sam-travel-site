// Общая обвязка тестов базы: настоящий Postgres в памяти (PGlite, в том же процессе).
// Подменяет то из Supabase, чего касается SQL: auth.users, auth.uid(), storage, realtime.
// Накатывает все файлы supabase/migrations/ по порядку номеров, весь набор дважды —
// так каждый прогон проверяет, что миграции безопасны при повторном запуске.
//
// Каждый файл *.test.mjs импортирует это и получает свою чистую базу
// (run.mjs запускает файлы отдельными процессами):
//
//   import { db, U, as, ok, bad, expectErr } from './_db.mjs';
//
//   db                          PGlite от имени суперпользователя — в обход RLS, для сверки
//   U                           id четырёх пользователей: U.owner, U.mkt, U.mgr, U.cli
//   as(who, sql, params)        запрос от имени 'anon' | 'owner' | 'mkt' | 'mgr' | 'cli'
//   ok(msg) / bad(msg)          отметить проверку; bad делает код выхода 1
//   expectErr(who, sql, params, label)   запрос обязан упасть
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

let passed = 0, failed = 0;
export const ok = (m) => { passed++; console.log('  ✓', m); };
export const bad = (m) => { failed++; console.log('  ✗', m); process.exitCode = 1; };
process.on('exit', () => console.log(`  — ${passed} прошло, ${failed} упало`));

export const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true),'')::uuid $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`);

export const migrations = fs.readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
for (const pass of [1, 2]) {
  for (const f of migrations) {
    try { await db.exec(fs.readFileSync(new URL(f, MIGRATIONS), 'utf8')); }
    catch (e) { console.log(`  ✗ ${f}, проход ${pass}: ${e.message}`); process.exit(1); }
  }
}
ok(`миграции накатились дважды: ${migrations.join(', ')}`);

export const U = {};
for (const [k, role] of [['owner', 'admin'], ['mkt', 'marketer'], ['mgr', 'manager'], ['cli', 'client']]) {
  const r = await db.query(`insert into auth.users(email, raw_user_meta_data) values ($1, $2) returning id`, [k + '@t.am', JSON.stringify({ full_name: k, marketing_consent: k === 'cli', consent_source: 'signup_form' })]);
  U[k] = r.rows[0].id;
  await db.query(`update public.profiles set role = $1::user_role where id = $2`, [role, U[k]]);
}

export async function as(who, sql, params) {
  if (who !== 'anon' && !U[who]) throw new Error('as(): неизвестный пользователь ' + who);
  await db.exec(who === 'anon' ? `set role anon; select set_config('request.uid','',false);` : `set role authenticated; select set_config('request.uid','${U[who]}',false);`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role;`); }
}

export async function expectErr(who, sql, params, label) {
  try { await as(who, sql, params); bad(label + ' — should fail'); } catch (e) { ok(label + ' → ' + e.message.slice(0, 60)); }
}
