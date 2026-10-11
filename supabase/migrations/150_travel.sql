-- ============================================================================
-- SAM TRAVEL — этап 15: поездка клиента в кабинете
-- ============================================================================
-- Накатывается после 140_mail_to.sql.
--
-- На сайте две страницы, которыми человек пользуется до разговора с менеджером:
-- «Список документов» (#checklist) и «Спланируйте поездку» (#plan). Обе помнили
-- отмеченное только в браузере. Теперь у вошедшего клиента это лежит в аккаунте:
-- кабинет показывает поездку и готовность документов, а отметки не теряются при
-- смене телефона.
--
-- Что добавляет:
--   • client_travel — одна строка на человека: список документов и план поездки
--   • my_travel()                 своя строка (null, пока ничего не сохранено)
--   • save_travel(checklist, plan) сохранить; чужую строку не тронуть никак
--
-- Что лежит в jsonb, решает сайт (js/travel.js): страна и тип визы, отмеченные
-- пункты, направление, даты, число людей, питание. База проверяет только вид и
-- размер — это черновик человека, а не заявка: менеджер его не видит, в отчёты
-- он не попадает. Паспортных данных и файлов здесь нет.
-- ============================================================================

create table if not exists public.client_travel (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  checklist  jsonb not null default '{}'::jsonb,
  plan       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint client_travel_shape check (
    jsonb_typeof(checklist) = 'object' and jsonb_typeof(plan) = 'object'
    and octet_length(checklist::text) <= 8000 and octet_length(plan::text) <= 2000)
);

-- Напрямую таблицу не читает и не пишет никто: только две функции ниже.
alter table public.client_travel enable row level security;
revoke all on public.client_travel from public, anon, authenticated;

create or replace function public.my_travel()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('checklist', t.checklist, 'plan', t.plan, 'updated_at', t.updated_at)
  from public.client_travel t
  where t.user_id = auth.uid();
$$;

create or replace function public.save_travel(p_checklist jsonb, p_plan jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_checklist jsonb := coalesce(p_checklist, '{}'::jsonb);
  v_plan      jsonb := coalesce(p_plan, '{}'::jsonb);
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if jsonb_typeof(v_checklist) <> 'object' or jsonb_typeof(v_plan) <> 'object'
     or octet_length(v_checklist::text) > 8000 or octet_length(v_plan::text) > 2000 then
    raise exception 'travel_invalid';
  end if;
  insert into public.client_travel as t (user_id, checklist, plan, updated_at)
  values (auth.uid(), v_checklist, v_plan, now())
  on conflict (user_id) do update
    set checklist = excluded.checklist, plan = excluded.plan, updated_at = now();
  return public.my_travel();
end; $$;

revoke all on function public.my_travel() from public, anon;
revoke all on function public.save_travel(jsonb, jsonb) from public, anon;
grant execute on function public.my_travel() to authenticated;
grant execute on function public.save_travel(jsonb, jsonb) to authenticated;
