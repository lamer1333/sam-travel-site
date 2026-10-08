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
//   formBack()                  вернуть форму заявки и письмо о ней — для тестов этапов 0–5 (см. ниже)
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
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', last_sign_in_at timestamptz, email_confirmed_at timestamptz default now());
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

// Этап 7 (070_whatsapp.sql) отозвал submit_lead у гостей: формы заявки на сайте нет. Сама
// функция, её лимиты и письмо о заявке остаются в базе «на случай возврата формы», и тесты
// этапов 0–5 продолжают их проверять. Для этого тест делает то же, что сделала бы миграция,
// возвращающая форму.
// Этап 10 (100_security.sql, AUDIT D2) закрыл остальное: право вызова у вошедших, триггер,
// который ставил письмо о заявке, и выдачу таких писем в notify_claim(). Возврат формы —
// это право гостям и вошедшим, триггер из 050 и notify_claim() из 090 (её текст берётся
// прямо из файла миграции, чтобы не держать вторую копию).
export const formBack = async () => {
  const sql090 = fs.readFileSync(new URL('090_reminders.sql', MIGRATIONS), 'utf8');
  const claim = /create or replace function public\.notify_claim\([\s\S]*?\nend; \$\$;/.exec(sql090);
  if (!claim) throw new Error('formBack(): в 090_reminders.sql не найдена notify_claim()');
  await db.exec(`
    grant execute on function public.submit_lead(jsonb) to anon, authenticated;
    drop trigger if exists leads_notify_ai on public.leads;
    create trigger leads_notify_ai after insert on public.leads for each row execute function public.leads_notify_ai();
    ${claim[0]}
    revoke all on function public.notify_claim(uuid, int) from public, anon, authenticated;
  `);
};
