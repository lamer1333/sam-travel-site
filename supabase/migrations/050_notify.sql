-- ============================================================================
-- Этап 5 (ТЗ §4.2 п.4): письмо о заявке на почту агентства.
-- ----------------------------------------------------------------------------
-- Кто что делает:
--   • триггер на leads кладёт в notify_log строку «ждёт отправки» для каждой заявки
--     с сайта; заявки, внесённые вручную, строк не получают — писем о них нет;
--   • Edge Function lead-mail (supabase/functions/lead-mail) по вебхуку на вставку в
--     leads забирает задание через notify_claim(), шлёт письмо и отчитывается через
--     notify_done();
--   • неудачные повторяются раз в 5 минут, не больше 5 попыток: pg_cron вызывает
--     notify_kick(), тот дёргает ту же функцию в режиме «повтор».
-- Правила (кому слать, сколько раз, когда повторять) живут здесь, функция только
-- отправляет. Посетителю и сотрудникам notify_claim / notify_done недоступны —
-- их вызывает только service_role.
-- Только весь набор по порядку: после повторного запуска этого файла отдельно нужно снова
-- накатить все следующие — сам по себе он возвращает то, что они закрыли (AUDIT.md, D6).
-- ============================================================================

create table if not exists public.notify_log (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads (id) on delete cascade,
  channel      text not null default 'email' check (channel in ('email')),
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts     int  not null default 0 check (attempts between 0 and 5),
  to_addr      text,                              -- куда ушло (или пыталось уйти) в последний раз
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  next_try_at  timestamptz not null default now(), -- раньше этого времени попытку не делать
  sent_at      timestamptz,
  unique (lead_id, channel)
);
create index if not exists notify_log_due_idx  on public.notify_log (next_try_at) where status = 'pending';
create index if not exists notify_log_sent_idx on public.notify_log (sent_at desc) where status = 'sent';

alter table public.notify_log enable row level security;
-- читает только владелец («Готовность сайта»); пишут только функции ниже
drop policy if exists "notify_log: owner read" on public.notify_log;
create policy "notify_log: owner read" on public.notify_log for select using (public.is_owner());
revoke insert, update, delete on public.notify_log from anon, authenticated;

-- Источники, которые вносит сотрудник: о своей же записи письмо не нужно.
create or replace function public.lead_is_manual(p_source text)
returns boolean language sql immutable as $$
  select coalesce(p_source, '') in ('manual', 'phone', 'walk_in', 'instagram');
$$;

-- Заявка с сайта → задание на письмо.
create or replace function public.leads_notify_ai()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.lead_is_manual(new.source) and new.status <> 'spam' then
    insert into public.notify_log (lead_id) values (new.id) on conflict (lead_id, channel) do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists leads_notify_ai on public.leads;
create trigger leads_notify_ai after insert on public.leads for each row execute function public.leads_notify_ai();

-- Забрать задания на отправку. p_lead — одна заявка (вебхук), без него — все, чьё время
-- пришло (повтор). Взятое задание сразу получает +1 попытку и откладывается на 5 минут:
-- второй одновременный вызов его не возьмёт, а если функция упадёт посреди отправки,
-- задание повторится само. Возвращает всё, что нужно для письма.
create or replace function public.notify_claim(p_lead uuid default null, p_limit int default 10)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_to   text := nullif(btrim((select value ->> 'email' from public.site_settings where key = 'contacts')), '');
  v_out  jsonb;
begin
  with due as (
    select n.id from public.notify_log n
     where n.status = 'pending' and n.attempts < 5 and n.next_try_at <= now()
       and (p_lead is null or n.lead_id = p_lead)
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  ), upd as (
    update public.notify_log n
       set attempts = n.attempts + 1, next_try_at = now() + interval '5 minutes', updated_at = now(), to_addr = v_to
      from due where n.id = due.id
    returning n.id, n.lead_id, n.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'attempt', u.attempts, 'to', v_to,
           'lead', jsonb_build_object(
             'id', l.id, 'created_at', l.created_at, 'name', l.name, 'phone', l.phone, 'phone_digits', l.phone_digits,
             'tour', l.tour, 'tour_title', coalesce(t.i18n -> 'ru' ->> 'title', t.i18n -> 'en' ->> 'title'),
             'message', l.message, 'coupon_code', l.coupon_code, 'source', l.source, 'lang', l.lang,
             'utm_source', l.utm_source, 'utm_campaign', l.utm_campaign))), '[]'::jsonb)
    into v_out
    from upd u
    join public.leads l on l.id = u.lead_id
    left join public.tours t on t.slug = l.tour;
  return v_out;
end; $$;

-- Итог попытки. Удалось — «отправлено». Не удалось — ждёт следующей попытки через
-- 5 минут; после пятой неудачи — «не доставлено», больше не трогаем.
create or replace function public.notify_done(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  update public.notify_log
     set status     = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
         sent_at    = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 500) end,
         updated_at = now()
   where id = p_id and status = 'pending';
end; $$;

-- Для «Готовности сайта»: когда доставлено последнее письмо и нет ли застрявших.
create or replace function public.notify_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  return (select jsonb_build_object(
    'last_sent_at', max(sent_at),
    'pending',      count(*) filter (where status = 'pending'),
    'failed_7d',    count(*) filter (where status = 'failed' and updated_at > now() - interval '7 days'),
    'last_error',   (select last_error from public.notify_log where last_error is not null order by updated_at desc limit 1),
    'last_error_at',(select updated_at from public.notify_log where last_error is not null order by updated_at desc limit 1))
    from public.notify_log);
end; $$;

-- Повтор неудачных: вызвать функцию lead-mail в режиме «повтор». Адрес функции и секрет
-- вебхука лежат в Supabase Vault под именами lead_mail_url и lead_mail_secret (этап 6).
-- Нет расширений, секретов или нечего повторять — тихо ничего не делает.
create or replace function public.notify_kick()
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.notify_log where status = 'pending' and attempts < 5 and next_try_at <= now()) then
    return false;
  end if;
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then return false; end if;
  execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'lead_mail_url' $q$ into v_url;
  execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'lead_mail_secret' $q$ into v_secret;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then return false; end if;
  execute $q$ select net.http_post(url := $1, body := '{"type":"retry"}'::jsonb,
                 headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', $2)) $q$
    using v_url, v_secret;
  return true;
end; $$;

-- Права: задания раздаёт и закрывает только service_role (Edge Function).
revoke all on function public.notify_claim(uuid, int)          from public, anon, authenticated;
revoke all on function public.notify_done(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.notify_kick()                    from public, anon, authenticated;
revoke all on function public.leads_notify_ai()                from public, anon, authenticated;
revoke all on function public.notify_status()                  from public, anon;
grant execute on function public.notify_status() to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.notify_claim(uuid, int)          to service_role;
    grant execute on function public.notify_done(uuid, boolean, text) to service_role;
    grant select on public.notify_log to service_role;
  end if;
end $$;

-- Расписание повтора: раз в 5 минут (там, где есть pg_cron; в тестах его нет).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lead-mail-retry';
    perform cron.schedule('lead-mail-retry', '*/5 * * * *', 'select public.notify_kick()');
  end if;
end $$;
