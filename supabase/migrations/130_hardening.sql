-- ============================================================================
-- SAM TRAVEL — замечания встроенной проверки Supabase  (миграция 130)
-- ============================================================================
-- Накатывать только весь набор по порядку; после повторного запуска этого файла —
-- все следующие.
--
-- Дыр здесь нет — данные и раньше держали RLS и проверки ролей внутри функций. Миграция
-- убирает то, на что указывает Security Advisor, чтобы настоящие замечания не тонули
-- в привычных:
--   1. у 28 функций не был закреплён search_path;
--   2. триггерные функции числились вызываемыми через API (/rest/v1/rpc/…);
--   3. расширение pg_net стояло в схеме public.
--
-- Что в отчёте останется и почему это правильно:
--   • «SECURITY DEFINER доступна гостю / вошедшему» для track, check_coupon, public_site,
--     whoami, my_role, is_*, can_edit_content и остальных RPC панели и кабинета — их зовут
--     сайт и панель, роль каждая проверяет сама (этап 10);
--   • «RLS без политик» у rate_hits, rate_salt, submit_log — таблицы только для функций;
--   • проверка паролей по базе утечек — включается в настройках входа, тариф Pro.
-- ============================================================================

-- ---------------------------------------------------------------- 1. search_path
-- Всем своим функциям схемы public, у кого путь поиска не задан, — тот же, что у
-- остальных: public. Функции расширений не трогаем. Цикл, а не список: функция, которую
-- добавит следующая миграция и забудет про путь, получит его при повторном накате.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- 2. триггерные функции
-- Триггер срабатывает независимо от права вызова у того, кто пишет строку: право
-- проверяется один раз, при создании триггера. Поэтому гостю и вошедшему оно не нужно,
-- а без него функция перестаёт быть видна как RPC.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- 3. pg_net
-- Миграция 120 включила расширение без указания схемы, и оно записалось в public. Свои
-- функции pg_net всё равно держит в схеме net (notify_kick зовёт net.http_post), так что
-- меняется только место регистрации. Перенести расширение командой нельзя — только
-- пересоздать; очередь запросов pg_net при этом сбрасывается, письма дня она не хранит
-- (те лежат в notify_log и уйдут следующим запуском). Вне Supabase схемы extensions нет —
-- шаг пропускается.
do $$ begin
  if exists (select 1 from pg_extension e where e.extname = 'pg_net' and e.extnamespace = 'public'::regnamespace)
     and exists (select 1 from pg_namespace where nspname = 'extensions') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
