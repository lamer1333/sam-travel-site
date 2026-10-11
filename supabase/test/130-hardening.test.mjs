// Миграция 130_hardening.sql: замечания встроенной проверки Supabase. И страница 404.
// Запуск: npm test  (или node supabase/test/run.mjs 130)
//
// Что проверяется (у каждого пункта — то, что до миграции падало бы):
//   путь     у каждой своей функции схемы public закреплён search_path;
//   триггеры ни одну триггерную функцию не может вызвать гость или вошедший, а сами
//            триггеры при этом работают — запись от их имени проходит, журнал пишется;
//   CHECK    функции-проверки по-прежнему доступны тем, от чьего имени идёт запись;
//   404      страница есть в сборке, пути от корня, политика CSP не разрешает чужого.
import fs from 'node:fs';
import { db, as, ok, bad } from './_db.mjs';

const src = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const check = (cond, msg, got) => (cond ? ok(msg) : bad(msg + (got === undefined ? '' : ' — получено ' + JSON.stringify(got))));
const rows = async (sql) => (await db.query(sql)).rows;
const OWN = `p.pronamespace = 'public'::regnamespace and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

// ================================================================ search_path
const loose = (await rows(`select p.proname from pg_proc p where ${OWN} and p.prokind = 'f'
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1`)).map((r) => r.proname);
check(loose.length === 0, 'у каждой функции схемы public закреплён search_path', loose);
const kept = (await rows(`select p.proconfig from pg_proc p where p.oid = 'public.media_alive(text)'::regprocedure`))[0].proconfig;
check(kept.some((c) => /^search_path=public, storage$/.test(c)), 'путь, заданный раньше, не переписан (media_alive: public, storage)', kept);

// ================================================================ триггерные функции
const open = (await rows(`select p.proname from pg_proc p where ${OWN} and p.prorettype = 'trigger'::regtype
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) order by 1`)).map((r) => r.proname);
check(open.length === 0, 'триггерные функции не вызвать ни гостю, ни вошедшему', open);

// Право вызова снято — триггеры обязаны работать как раньше: запись менеджера проходит
// через leads_guard, leads_phone_norm, leads_log_insert и остальные.
const id = (await as('mgr', `insert into leads(name, phone, source, status, value, lang, tour)
  values ('Анна Саркисян', '091 22 33 44', 'manual', 'won', 900, 'ru', 'sharm') returning id`)).rows[0].id;
const lead = (await rows(`select phone from leads where id = '${id}'`))[0];
check(lead.phone === '+374 91 223344', 'триггер нормализации телефона сработал от имени менеджера', lead.phone);
const logged = async () => (await rows(`select count(*)::int n from lead_activity where lead_id = '${id}'`))[0].n;
const before = await logged();
await as('mgr', `update leads set value = 950 where id = $1`, [id]);
const after = await logged();
check(before > 0 && after > before, 'история продажи пишется триггерами и после отзыва прав', { before, after });

// ================================================================ функции-проверки
// CHECK вызывает функцию от имени пишущего: отзывать у них право нельзя.
const needed = await rows(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') auth from pg_proc p
  where ${OWN} and p.proname in ('consent_source_ok', 'media_url_ok', 'tours_inc_ok', 'birth_date_ok', 'ref_ok') order by 1`);
check(needed.length === 5 && needed.every((r) => r.auth), 'функции из CHECK доступны вошедшему', needed);
const site = (await as('anon', `select public.public_site() s`)).rows[0].s;
check(site && typeof site === 'object', 'гость по-прежнему читает сайт через public_site()');

// ================================================================ страница 404
{
  const html = src('404.html'), build = src('build.mjs');
  check(/'404\.html'/.test(build), '404.html в списке публикации build.mjs');
  const rel = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('/'));
  check(rel.length === 0, '404: все пути от корня — страницу отдают на любой глубине', rel);
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  check(/script-src 'self'(;|$)/.test(csp) && !/https?:/.test(csp), '404: политика CSP — только свой сайт', csp);
  check(/<meta name="robots" content="noindex">/.test(html), '404: страница закрыта от поисковиков');
  const js = src('js/notfound.js');
  const keys = [...html.matchAll(/data-t="(\w+)"/g)].map((m) => m[1]);
  check(keys.length === 3 && ['ru', 'hy'].every((l) => keys.every((k) => new RegExp(l + ':[\\s\\S]*?' + k + ':').test(js))), '404: у каждой подписи есть русский и армянский перевод', keys);
}
