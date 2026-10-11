-- ============================================================================
-- SAM TRAVEL — отдельный адрес для письма с напоминаниями  (миграция 140)
-- ============================================================================
-- Накатывать только весь набор по порядку; после повторного запуска этого файла —
-- все следующие.
--
-- До сих пор письмо «Сегодня написать: …» шло на почту агентства из «Контактов» — ту же,
-- что видят посетители сайта. Теперь у напоминаний есть своё поле:
--   site_settings.whatsapp.mail_to — куда слать письмо; пусто — как раньше, на почту
--   агентства. На сайт этот адрес не уходит: ключа whatsapp нет в public_site().
-- ============================================================================

-- ---------------------------------------------------------------- 1. настройки
create or replace function public.wa_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', true, 'mail_hour', 11, 'review_url', '', 'mode', 'remind', 'mail_to', '')
         || coalesce((select value from public.site_settings where key = 'whatsapp'), '{}'::jsonb);
$$;

create or replace function public.wa_settings_guard()
returns trigger language plpgsql set search_path = public as $$
declare v jsonb := coalesce(new.value, '{}'::jsonb);
begin
  if new.key <> 'whatsapp' then return new; end if;
  v := jsonb_build_object('enabled', true, 'mail_hour', 11, 'review_url', '', 'mode', 'remind', 'mail_to', '') || v;
  if jsonb_typeof(v -> 'enabled') <> 'boolean' then raise exception 'bad_wa_enabled'; end if;
  if jsonb_typeof(v -> 'mail_hour') <> 'number' or (v ->> 'mail_hour') !~ '^\d{1,2}$' or (v ->> 'mail_hour')::int > 23 then
    raise exception 'bad_mail_hour';
  end if;
  v := jsonb_set(v, '{review_url}', to_jsonb(btrim(coalesce(v ->> 'review_url', ''))));
  if (v ->> 'review_url') <> '' and ((v ->> 'review_url') !~ '^https?://[^\s]+$' or length(v ->> 'review_url') > 300) then
    raise exception 'bad_review_url';
  end if;
  v := jsonb_set(v, '{mail_to}', to_jsonb(btrim(coalesce(v ->> 'mail_to', ''))));
  if (v ->> 'mail_to') <> '' and ((v ->> 'mail_to') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v ->> 'mail_to') > 254) then
    raise exception 'bad_mail_to';
  end if;
  -- автоотправка появится вместе с WhatsApp Business Platform; до тех пор режим один
  if (v ->> 'mode') = 'auto' then raise exception 'wa_auto_unavailable'; end if;
  if (v ->> 'mode') is distinct from 'remind' then raise exception 'bad_wa_mode'; end if;
  new.value := v;
  return new;
end; $$;
revoke all on function public.wa_settings_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. получатель
-- Куда идёт письмо с напоминаниями: свой адрес из настроек, а если он пуст — почта агентства.
create or replace function public.mail_to()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(public.wa_settings() ->> 'mail_to'), ''),
                  nullif(btrim((select value ->> 'email' from public.site_settings where key = 'contacts')), ''));
$$;
revoke all on function public.mail_to() from public, anon, authenticated;

-- notify_claim из 100, получатель — mail_to()
create or replace function public.notify_claim(p_lead uuid default null, p_limit int default 10)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_to   text := public.mail_to();
  v_out  jsonb;
begin
  with due as (
    select n.id from public.notify_log n
     where n.kind = 'reminders' and n.status = 'pending' and n.attempts < 5 and n.next_try_at <= now()
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  ), upd as (
    update public.notify_log n
       set attempts = n.attempts + 1, next_try_at = now() + interval '5 minutes', updated_at = now(), to_addr = v_to
      from due where n.id = due.id
    returning n.id, n.attempts, n.kind, n.payload
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'attempt', u.attempts, 'to', v_to, 'kind', u.kind, 'digest', u.payload)), '[]'::jsonb)
    into v_out from upd u;
  return v_out;
end; $$;
revoke all on function public.notify_claim(uuid, int) from public, anon, authenticated;

-- notify_status из 110: «есть куда слать» считается по mail_to(), и сам адрес ('to') виден
-- владельцу — по нему же уходит пробное письмо из «Готовности сайта».
create or replace function public.notify_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out      jsonb;
  s          jsonb := public.wa_settings();
  v_schedule boolean := false;
  v_secrets  boolean := false;
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'last_sent_at', max(sent_at),
    'pending',      count(*) filter (where status = 'pending'),
    'failed_7d',    count(*) filter (where status = 'failed' and updated_at > now() - interval '7 days'),
    'last_error',   (select last_error from public.notify_log where last_error is not null order by updated_at desc limit 1),
    'last_error_at',(select updated_at from public.notify_log where last_error is not null order by updated_at desc limit 1))
    into v_out from public.notify_log;
  if to_regclass('cron.job') is not null then
    execute $q$ select exists (select 1 from cron.job where jobname = 'reminders-mail') $q$ into v_schedule;
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$ select count(*) = 2 from vault.decrypted_secrets
                 where name in ('lead_mail_url', 'lead_mail_secret') and coalesce(decrypted_secret, '') <> '' $q$ into v_secrets;
  end if;
  return v_out || jsonb_build_object('reminders', (select jsonb_build_object(
    'enabled',      (s ->> 'enabled')::boolean,
    'mail_hour',    (s ->> 'mail_hour')::int,
    'mail_to',      public.mail_to() is not null,
    'to',           public.mail_to(),
    'schedule',     v_schedule,
    'secrets',      v_secrets,
    'last_sent_at', max(n.sent_at),
    'last_day',     max(n.day) filter (where n.status = 'sent'),
    'pending',      count(*) filter (where n.status = 'pending'),
    'failed_7d',    count(*) filter (where n.status = 'failed' and n.updated_at > now() - interval '7 days'),
    'last_error',   (select x.last_error from public.notify_log x where x.kind = 'reminders' and x.status <> 'sent' and x.last_error is not null order by x.updated_at desc limit 1))
    from public.notify_log n where n.kind = 'reminders'));
end; $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.notify_claim(uuid, int) to service_role;
  end if;
end $$;
