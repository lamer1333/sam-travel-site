-- ============================================================================
-- SAM TRAVEL — limits for the public RPCs and event retention  (migration 020)
-- ============================================================================
-- Stage 2 of TZ-STAGES.md (TZ-BACKEND.md §4.1, §4.2, §8). Safe to re-run.
--
-- What it adds:
--   • track()        — sid format check, max 200 events per sid, max 600 events a minute
--   • submit_lead()  — per-sender limit (5 per 10 min, by a salted hash of the IP — the
--                      IP itself is never stored), site-wide cap raised to 60 per 10 min,
--                      promo code checked against coupons → details.coupon_valid
--   • events_daily   — one row per day × event × source × campaign × tour × device × lang
--   • events_maintain() — nightly: rolls finished days up, deletes raw events older than
--                      13 months, forgets yesterday's salts and sender hashes (pg_cron)
--   • indexes from §8
-- ============================================================================

-- ---------- indexes (§8) ----------------------------------------------------
create index if not exists leads_closed_idx    on public.leads (closed_at);
create index if not exists leads_assigned_idx  on public.leads (assigned_to);
create index if not exists leads_user_idx      on public.leads (user_id);
create index if not exists events_campaign_idx on public.events (utm_campaign, ts);
-- the per-sid limit in track() counts by sid on every call
create index if not exists events_sid_idx      on public.events (sid);

-- ============================================================================
-- who is sending: a hash of the IP with a salt that lives one day
-- ============================================================================
-- The salt is random, kept for one Yerevan day and then deleted, so yesterday's hashes
-- cannot be tied to an address — or to today's hashes of the same address.
create table if not exists public.rate_salt (
  day   date primary key,
  salt  text not null
);

-- One row per accepted site lead: when, and the sender hash. No lead id, no IP.
create table if not exists public.submit_log (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  sender  text not null
);
create index if not exists submit_log_sender_idx on public.submit_log (sender, ts);

-- No policies: only the SECURITY DEFINER functions below touch these two.
alter table public.rate_salt  enable row level security;
alter table public.submit_log enable row level security;
revoke all on public.rate_salt, public.submit_log from anon, authenticated;

-- Hash of the caller's address, or null when the request carries none (then only the
-- site-wide cap applies). PostgREST puts the request headers into request.headers;
-- cf-connecting-ip is set by the proxy in front of Supabase and cannot be forged by the
-- visitor, x-forwarded-for is the fallback. IPv6 is cut to /64 — one subscriber.
create or replace function public.sender_hash()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_h    jsonb;
  v_ip   text;
  v_day  date := (now() at time zone 'Asia/Yerevan')::date;
  v_salt text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then return null;
  end;
  v_ip := left(btrim(coalesce(nullif(v_h ->> 'cf-connecting-ip', ''),
                              split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1))), 64);
  if v_ip is null or v_ip = '' then return null; end if;
  begin
    if family(v_ip::inet) = 6 then v_ip := host(network(set_masklen(v_ip::inet, 64))); end if;
  exception when others then null;   -- not an address: hash the text as it came
  end;
  insert into public.rate_salt (day, salt)
  values (v_day, gen_random_uuid()::text || gen_random_uuid()::text)
  on conflict (day) do nothing;
  select salt into v_salt from public.rate_salt where day = v_day;
  return encode(sha256(convert_to(v_salt || '|' || v_ip, 'UTF8')), 'hex');
end; $$;

-- ============================================================================
-- promo code in a lead: yes | expired | no
-- ============================================================================
--   yes      the code can be applied right now (what check_coupon() calls valid)
--   expired  the code exists but cannot be applied: past its date, switched off,
--            used up, or not started yet
--   no       there is no such code
create or replace function public.coupon_state(p_code text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when usable then 'yes' else 'expired' end
    from (select (active and valid_from <= now() and (valid_until is null or valid_until > now())
                  and (max_uses is null or used_count < max_uses)) as usable
          from public.coupons where upper(code) = upper(btrim(p_code))) c
    order by usable desc limit 1), 'no');
$$;

-- ============================================================================
-- submit_lead: + per-sender limit, cap 60, promo code check
-- ============================================================================
create or replace function public.submit_lead(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_name    text := left(btrim(coalesce(p ->> 'name', '')), 120);
  v_phone   text := left(btrim(coalesce(p ->> 'phone', '')), 40);
  v_digits  text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_code    text := nullif(upper(btrim(left(p ->> 'coupon_code', 40))), '');
  -- coupon_valid is the server's word: whatever the browser sent under that key is dropped
  v_details jsonb := case when jsonb_typeof(p -> 'details') = 'object' then (p -> 'details') - 'coupon_valid' else '{}'::jsonb end;
  v_sender  text;
  v_id      uuid;
begin
  -- honeypot: bots fill the hidden "website" field; pretend success
  if coalesce(p ->> 'website', '') <> '' then return null; end if;
  if char_length(v_name) < 1 then raise exception 'name_required'; end if;
  if char_length(v_digits) < 6 then raise exception 'phone_invalid'; end if;

  -- same phone within 3 minutes = a double click, not a new lead
  select id into v_id from public.leads
   where phone_digits = v_digits and created_at > now() - interval '3 minutes'
   order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  -- one sender: 5 leads in 10 minutes. Checked first, so one flooder runs into this
  -- wall and never gets to close the form for everybody else.
  v_sender := public.sender_hash();
  if v_sender is not null and (select count(*) from public.submit_log
        where sender = v_sender and ts > now() - interval '10 minutes') >= 5 then
    raise exception 'rate_limited';
  end if;

  -- the last line of defence, for the whole site: 60 leads in 10 minutes
  if (select count(*) from public.leads where created_at > now() - interval '10 minutes'
        and source in ('form', 'plan', 'tour', 'promo')) >= 60 then
    raise exception 'rate_limited';
  end if;

  if v_code is not null then
    v_details := v_details || jsonb_build_object('coupon_valid', public.coupon_state(v_code));
  end if;

  insert into public.leads (name, phone, email, message, source, tour, details, lang, device, page, referrer,
                            utm_source, utm_medium, utm_campaign, utm_content, utm_term, coupon_code, user_id)
  values (v_name, v_phone,
          nullif(left(p ->> 'email', 200), ''),
          nullif(left(p ->> 'message', 2000), ''),
          case when p ->> 'source' in ('form', 'plan', 'tour', 'promo') then p ->> 'source' else 'form' end,
          nullif(left(p ->> 'tour', 40), ''),
          v_details,
          nullif(left(p ->> 'lang', 5), ''),
          nullif(left(p ->> 'device', 10), ''),
          nullif(left(p ->> 'page', 300), ''),
          nullif(left(p ->> 'referrer', 300), ''),
          nullif(left(p ->> 'utm_source', 100), ''), nullif(left(p ->> 'utm_medium', 100), ''),
          nullif(left(p ->> 'utm_campaign', 100), ''), nullif(left(p ->> 'utm_content', 100), ''),
          nullif(left(p ->> 'utm_term', 100), ''),
          v_code,
          auth.uid())
  returning id into v_id;

  if v_sender is not null then
    insert into public.submit_log (sender) values (v_sender);
  end if;

  insert into public.lead_activity (lead_id, kind, body)
  values (v_id, 'system', 'Created from the site (' || coalesce(p ->> 'source', 'form') || ')');

  -- the conversion itself, so the funnel never depends on the browser also reporting it
  if (p ->> 'sid') ~ '^[a-z0-9]{8,40}$' then
    insert into public.events (sid, name, tour, lang, device, utm_source, utm_medium, utm_campaign, utm_content)
    values (p ->> 'sid', 'lead_submit', nullif(left(p ->> 'tour', 40), ''), left(p ->> 'lang', 5), left(p ->> 'device', 10),
            nullif(left(p ->> 'utm_source', 100), ''), nullif(left(p ->> 'utm_medium', 100), ''),
            nullif(left(p ->> 'utm_campaign', 100), ''), nullif(left(p ->> 'utm_content', 100), ''));
  end if;
  return v_id;
end; $$;

-- ============================================================================
-- track: + sid format, 200 events per sid, 600 events a minute
-- ============================================================================
-- Batched analytics events from the site (max 30 per call, whitelisted names). Whatever
-- does not fit a limit is dropped silently: the visitor's page must never see an error.
create or replace function public.track(p_events jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_room integer;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 30 then return; end if;

  -- site-wide ceiling: 600 events in any 60 seconds
  select 600 - count(*) into v_room from public.events where ts > now() - interval '1 minute';
  if v_room <= 0 then return; end if;

  -- two batches of one sid wait for each other, so the 200 is not overshot in a race
  perform pg_advisory_xact_lock(hashtext('track:' || s.sid))
  from (select distinct e ->> 'sid' as sid from jsonb_array_elements(p_events) e
        where (e ->> 'sid') ~ '^[a-z0-9]{8,40}$' order by 1) s;

  with good as (
    select e, ord, e ->> 'sid' as sid,
           row_number() over (partition by e ->> 'sid' order by ord) as k
    from jsonb_array_elements(p_events) with ordinality t(e, ord)
    where (e ->> 'sid') ~ '^[a-z0-9]{8,40}$'
      and e ->> 'name' in ('page_view', 'section_view', 'tour_open', 'plan_open', 'checklist_open', 'wa_click',
                           'tel_click', 'mail_click', 'promo_view', 'promo_click', 'promo_close', 'lang_switch',
                           'auth_open', 'plan_send', 'form_start')
  ), have as (
    select s.sid, (select count(*) from public.events ev where ev.sid = s.sid) as n
    from (select distinct sid from good) s
  ), fits as (
    select g.e, row_number() over (order by g.ord) as pos
    from good g join have h using (sid)
    where h.n + g.k <= 200
  )
  insert into public.events (sid, name, section, tour, promo_id, label, lang, device, ref_host,
                             utm_source, utm_medium, utm_campaign, utm_content)
  select e ->> 'sid', e ->> 'name',
         nullif(left(e ->> 'section', 40), ''), nullif(left(e ->> 'tour', 40), ''),
         case when (e ->> 'promo_id') ~ '^[0-9a-f-]{36}$' then (e ->> 'promo_id')::uuid end,
         nullif(left(e ->> 'label', 80), ''), nullif(left(e ->> 'lang', 5), ''), nullif(left(e ->> 'device', 10), ''),
         nullif(left(e ->> 'ref_host', 100), ''),
         nullif(left(e ->> 'utm_source', 100), ''), nullif(left(e ->> 'utm_medium', 100), ''),
         nullif(left(e ->> 'utm_campaign', 100), ''), nullif(left(e ->> 'utm_content', 100), '')
  from fits
  where pos <= v_room
  order by pos;
end; $$;

-- ============================================================================
-- events_daily: what is left of a day once its raw events are gone
-- ============================================================================
-- day      — the Yerevan date
-- source   — coalesce(utm_source, ref_host, 'direct'), the same rule stats_traffic uses
-- events   — rows; adds up across any grouping
-- sessions — distinct sid inside this one row; does NOT add up across rows
create table if not exists public.events_daily (
  day       date not null,
  name      text not null,
  source    text not null,
  campaign  text,
  tour      text,
  device    text,
  lang      text,
  events    bigint not null,
  sessions  bigint not null,
  constraint events_daily_uniq unique nulls not distinct (day, name, source, campaign, tour, device, lang)
);

-- Counts only, nobody's data: the whole team may read; nobody writes except the roll-up.
alter table public.events_daily enable row level security;
drop policy if exists "events_daily: team read" on public.events_daily;
create policy "events_daily: team read" on public.events_daily for select using (public.is_team());

-- Roll one finished Yerevan day up. Re-running replaces the day. Returns the number of
-- rows written; 0 when the day is not over yet or has no raw events (an existing roll-up
-- of a day whose raw events were already deleted is left alone).
create or replace function public.events_rollup_day(p_day date)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_from timestamptz := p_day::timestamp at time zone 'Asia/Yerevan';
  v_to   timestamptz := (p_day + 1)::timestamp at time zone 'Asia/Yerevan';
  v_n    integer;
begin
  if p_day >= (now() at time zone 'Asia/Yerevan')::date then return 0; end if;
  if not exists (select 1 from public.events where ts >= v_from and ts < v_to) then return 0; end if;
  delete from public.events_daily where day = p_day;
  insert into public.events_daily (day, name, source, campaign, tour, device, lang, events, sessions)
  select p_day, name, coalesce(utm_source, ref_host, 'direct'), utm_campaign, tour, device, lang,
         count(*), count(distinct sid)
  from public.events
  where ts >= v_from and ts < v_to
  group by 2, 3, 4, 5, 6, 7;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- The nightly job. Rolls up every finished day that has raw events and no roll-up yet
-- (so a missed night is caught up), then deletes raw events older than 13 months — by
-- then their days are rolled up — and forgets salts and sender hashes no longer needed.
create or replace function public.events_maintain()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_today   date := (now() at time zone 'Asia/Yerevan')::date;
  v_cut     timestamptz := (v_today - interval '13 months')::date::timestamp at time zone 'Asia/Yerevan';
  v_from    date;
  v_day     date;
  v_days    integer := 0;
  v_deleted bigint;
begin
  select (min(ts) at time zone 'Asia/Yerevan')::date into v_from from public.events;
  if v_from is not null then
    for v_day in select generate_series(v_from, v_today - 1, interval '1 day')::date loop
      if not exists (select 1 from public.events_daily where day = v_day)
         and public.events_rollup_day(v_day) > 0 then
        v_days := v_days + 1;
      end if;
    end loop;
  end if;

  delete from public.events where ts < v_cut;
  get diagnostics v_deleted = row_count;

  delete from public.submit_log where ts < now() - interval '1 day';
  delete from public.rate_salt  where day < v_today;

  return jsonb_build_object('days_rolled', v_days, 'events_deleted', v_deleted);
end; $$;

-- ---------- grants ----------------------------------------------------------
-- Internal helpers: not callable through the API. coupon_state() would otherwise tell a
-- visitor that a switched-off code exists.
revoke all on function public.sender_hash()            from public, anon, authenticated;
revoke all on function public.coupon_state(text)       from public, anon, authenticated;
revoke all on function public.events_rollup_day(date)  from public, anon, authenticated;
revoke all on function public.events_maintain()        from public, anon, authenticated;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;
grant execute on function public.track(jsonb)       to anon, authenticated;

-- ---------- schedule --------------------------------------------------------
-- Every night at 00:10 Yerevan (pg_cron runs on UTC; Yerevan is UTC+4 all year).
-- cron.schedule() with a job name replaces the job, so re-running is safe. Where
-- pg_cron is not installed (the in-memory test database) the schedule is skipped and
-- the tests call events_maintain() themselves.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    execute $q$ select cron.schedule('events-maintain', '10 20 * * *', 'select public.events_maintain()') $q$;
  else
    raise notice 'pg_cron is not available: events_maintain() is not scheduled';
  end if;
end $$;
