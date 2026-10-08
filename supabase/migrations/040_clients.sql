-- ============================================================================
-- SAM TRAVEL — этап 4: клиенты (ТЗ §4.9)
-- ============================================================================
-- Накатывается после 002_admin.sql.
-- Только весь набор по порядку: после повторного запуска этого файла отдельно нужно снова
-- накатить все следующие — сам по себе он возвращает то, что они закрыли (AUDIT.md, D6).
--
-- Что добавляет:
--   • profiles.birth_date — дата рождения, возраст 16–120 лет, после заполнения
--     не очищается; менять может только сам человек
--   • my_profile(), finish_onboarding(), set_birth_date() — кабинет клиента
--   • my_requests() — заявки вошедшего клиента: дата, тур, статус словами;
--     без суммы, дохода и заметок
--   • birthdays(month) — именинники месяца для владельца и маркетолога
--   • users_list / audience_list — дата рождения только владельцу и маркетологу,
--     счётчики «заявок / покупок» вместо бронирований, в подписчиках только
--     подтверждённые адреса
--   • bookings и coupon_redemptions заморожены (запись снята)
--
-- Подтверждение почты включается в настройках Supabase Auth («Confirm email»),
-- текст письма — supabase/templates/confirm-signup.html.
-- ============================================================================

-- ---------- дата рождения ----------------------------------------------------
alter table public.profiles add column if not exists birth_date date;

-- Сегодня по Еревану: возраст считаем по местной дате, а не по UTC.
create or replace function public.yerevan_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Yerevan')::date;
$$;

-- Полных лет от 16 до 120. Дата в будущем даёт отрицательный возраст и не проходит.
create or replace function public.birth_date_ok(p_date date)
returns boolean language sql stable as $$
  select p_date is not null
     and extract(year from age(public.yerevan_today(), p_date)) between 16 and 120;
$$;

-- Сторож: проверяет дату при любом пути записи (RPC, прямой update, регистрация).
create or replace function public.profiles_birth_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.birth_date is not null and not public.birth_date_ok(new.birth_date) then
      raise exception 'birth_date_invalid';
    end if;
    return new;
  end if;
  if new.birth_date is not distinct from old.birth_date then return new; end if;
  -- чужую дату не меняет никто, даже сотрудник; SQL без пользователя (сервис) — можно
  if auth.uid() is not null and auth.uid() <> new.id then raise exception 'forbidden'; end if;
  if new.birth_date is null then raise exception 'birth_date_required'; end if;
  if not public.birth_date_ok(new.birth_date) then raise exception 'birth_date_invalid'; end if;
  return new;
end; $$;

drop trigger if exists profiles_birth_guard on public.profiles;
create trigger profiles_birth_guard before insert or update on public.profiles
  for each row execute function public.profiles_birth_guard();

-- Регистрация: форма на сайте передаёт birth_date в метаданных. Плохая дата
-- отклоняет регистрацию целиком. Вход через Google / Mail.ru даты не несёт —
-- строка создаётся без неё, и кабинет спросит дату на экране первого входа.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_birth date;
begin
  if coalesce(new.raw_user_meta_data ->> 'birth_date', '') <> '' then
    begin
      v_birth := (new.raw_user_meta_data ->> 'birth_date')::date;
    exception when others then
      raise exception 'birth_date_invalid';
    end;
  end if;

  insert into public.profiles (id, full_name, lang, marketing_consent, consent_at, consent_source, onboarded, birth_date)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'lang', 'en'),
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false),
    case when (new.raw_user_meta_data ->> 'marketing_consent')::boolean
         then now() else null end,
    new.raw_user_meta_data ->> 'consent_source',
    (new.raw_user_meta_data ->> 'consent_source') is not null,
    v_birth
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- дату рождения не отдаёт прямое чтение таблицы ---------------------
-- Политика «profiles: staff read» показывает менеджеру все строки profiles, а дату
-- рождения менеджер видеть не должен. RLS режет строки, а не колонки, поэтому
-- чтение всей таблицы заменяем чтением перечисленных колонок — всех, кроме
-- birth_date. Свою дату человек получает через my_profile(), владелец и
-- маркетолог — через users_list() / audience_list() / birthdays().
-- Список колонок собирается из каталога: колонки, добавленные другими миграциями
-- до этой, попадут в него при повторном накате. Миграция, которая добавит колонку
-- в profiles позже, должна сама выдать на неё `grant select (колонка)`.
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
    from pg_attribute
   where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
     and attname <> 'birth_date';
  revoke select on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to authenticated', v_cols);
end $$;

-- ---------- кабинет ----------------------------------------------------------
create or replace function public.my_profile()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'email', u.email, 'full_name', p.full_name, 'phone', p.phone,
    'role', p.role::text, 'lang', p.lang, 'marketing_consent', p.marketing_consent,
    'onboarded', p.onboarded, 'birth_date', p.birth_date)
  from public.profiles p join auth.users u on u.id = p.id
  where p.id = auth.uid();
$$;

-- Экран первого входа: дата рождения и ответ про рассылку одним вызовом.
-- Без даты (своей прежней или присланной) не завершается.
create or replace function public.finish_onboarding(p_birth_date date, p_consent boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_consent boolean := coalesce(p_consent, false);
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_birth_date is null and (select birth_date from public.profiles where id = auth.uid()) is null then
    raise exception 'birth_date_required';
  end if;
  update public.profiles p set
    birth_date        = coalesce(p_birth_date, p.birth_date),
    onboarded         = true,
    consent_at        = case when not v_consent then null
                             when p.marketing_consent then p.consent_at else now() end,
    consent_source    = case when v_consent and not p.marketing_consent then 'onboarding_social'
                             else p.consent_source end,
    marketing_consent = v_consent
  where p.id = auth.uid();
  return public.my_profile();
end; $$;

create or replace function public.set_birth_date(p_date date)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  if p_date is null then raise exception 'birth_date_required'; end if;
  update public.profiles set birth_date = p_date where id = auth.uid();
  return public.my_profile();
end; $$;

-- Заявки вошедшего клиента. Статус — код для клиента, слова подставляет кабинет:
--   received «получили» · in_touch «на связи» · offer «предложение отправлено» ·
--   done «оформлено» · closed «закрыто» (отказ и спам клиенту выглядят одинаково).
create or replace function public.my_requests()
returns table (id uuid, created_at timestamptz, tour text, tour_title jsonb, status text)
language sql stable security definer set search_path = public as $$
  select l.id, l.created_at, l.tour,
         (select jsonb_build_object('en', t.i18n -> 'en' ->> 'title',
                                    'ru', t.i18n -> 'ru' ->> 'title',
                                    'hy', t.i18n -> 'hy' ->> 'title')
            from public.tours t where t.slug = l.tour),
         case l.status when 'new' then 'received' when 'contacted' then 'in_touch'
                       when 'quoted' then 'offer' when 'won' then 'done' else 'closed' end
  from public.leads l
  where l.user_id = auth.uid()
  order by l.created_at desc
  limit 200;
$$;

create index if not exists leads_user_id_idx on public.leads (user_id);

-- ---------- панель -----------------------------------------------------------
-- Именинники месяца (1–12; без аргумента — текущий месяц по Еревану): клиенты с
-- согласием на рассылку и подтверждённой почтой. Владелец и маркетолог.
create or replace function public.birthdays(p_month int default null)
returns table (id uuid, full_name text, email text, birth_date date, lang text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_month int := coalesce(p_month, extract(month from public.yerevan_today())::int);
begin
  if not public.is_marketing() then raise exception 'forbidden'; end if;
  if v_month not between 1 and 12 then raise exception 'bad_month'; end if;
  return query
    select p.id, p.full_name, u.email::text, p.birth_date, p.lang
    from public.profiles p join auth.users u on u.id = p.id
    where p.role::text = 'client' and p.marketing_consent and u.email_confirmed_at is not null
      and extract(month from p.birth_date) = v_month
    order by extract(day from p.birth_date), p.full_name;
end; $$;

-- users_list / audience_list меняют набор колонок. Postgres не даёт сменить тип
-- результата через create or replace, а 002_admin.sql при повторном накате заново
-- создаёт прежние функции без аргументов. Поэтому прежние удаляем, а новые
-- получают необязательный аргумент p_ver: вызов users_list() без аргументов
-- работает как раньше, повторный накат 002 → 040 не спотыкается.
drop function if exists public.users_list();
drop function if exists public.audience_list();

-- «Заявок» — заявки человека, кроме спама; «покупок» — проданные с суммой (§5).
create or replace function public.audience_list(p_ver int default 2)
returns table (id uuid, email text, full_name text, lang text, consent_at timestamptz,
               consent_source text, created_at timestamptz, birth_date date,
               requests bigint, purchases bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing() then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.lang, p.consent_at, p.consent_source, p.created_at,
           p.birth_date,
           (select count(*) from public.leads l where l.user_id = p.id and l.status <> 'spam'),
           (select count(*) from public.leads l where l.user_id = p.id and l.status = 'won' and coalesce(l.value, 0) > 0)
    from public.profiles p join auth.users u on u.id = p.id
    where p.marketing_consent and u.email_confirmed_at is not null
    order by p.consent_at desc nulls last;
end; $$;

-- Владелец видит всех, остальная команда — только команду. Дату рождения
-- получают владелец и маркетолог, менеджеру приходит null.
create or replace function public.users_list(p_ver int default 2)
returns table (id uuid, email text, full_name text, phone text, role text, lang text,
               marketing_consent boolean, created_at timestamptz, last_sign_in_at timestamptz,
               provider text, email_confirmed boolean, birth_date date,
               requests bigint, purchases bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.role::text, p.lang, p.marketing_consent,
           p.created_at, u.last_sign_in_at, coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
           u.email_confirmed_at is not null,
           case when public.is_marketing() then p.birth_date end,
           (select count(*) from public.leads l where l.user_id = p.id and l.status <> 'spam'),
           (select count(*) from public.leads l where l.user_id = p.id and l.status = 'won' and coalesce(l.value, 0) > 0)
    from public.profiles p join auth.users u on u.id = p.id
    where public.is_owner() or p.role::text <> 'client'
    order by p.created_at desc;
end; $$;

-- Вид для сервиса рассылок: тоже только подтверждённые адреса.
create or replace view public.marketing_audience as
  select p.id, u.email, p.full_name, p.lang, p.consent_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.marketing_consent = true and u.email_confirmed_at is not null;
revoke all on public.marketing_audience from anon, authenticated;

-- ---------- заморозка bookings и coupon_redemptions ---------------------------
-- Таблицы никто не заполняет; кабинет читает my_requests(). Запись снята и
-- политиками, и правами. Чтение оставлено, удаление таблиц — после запуска.
drop policy if exists "bookings: self insert"    on public.bookings;
drop policy if exists "bookings: staff all"      on public.bookings;
drop policy if exists "redemptions: self insert" on public.coupon_redemptions;
drop policy if exists "redemptions: staff all"   on public.coupon_redemptions;
revoke insert, update, delete, truncate on public.bookings, public.coupon_redemptions from anon, authenticated;

-- ---------- права на функции -------------------------------------------------
revoke all on function public.my_profile()                      from public, anon;
revoke all on function public.finish_onboarding(date, boolean)  from public, anon;
revoke all on function public.set_birth_date(date)              from public, anon;
revoke all on function public.my_requests()                     from public, anon;
revoke all on function public.birthdays(int)                    from public, anon;
revoke all on function public.users_list(int)                   from public, anon;
revoke all on function public.audience_list(int)                from public, anon;
grant execute on function public.my_profile()                     to authenticated;
grant execute on function public.finish_onboarding(date, boolean) to authenticated;
grant execute on function public.set_birth_date(date)             to authenticated;
grant execute on function public.my_requests()                    to authenticated;
grant execute on function public.birthdays(int)                   to authenticated;
grant execute on function public.users_list(int)                  to authenticated;
grant execute on function public.audience_list(int)               to authenticated;
