-- ============================================================================
-- SAM TRAVEL — права и правила продажи  (migration 010, этап 1)
-- ============================================================================
-- Run AFTER 002_admin.sql. ТЗ: §2, §4.3, §4.4, §4.5.
-- Only as part of the whole set, in order: after re-running this file alone, re-run every
-- later migration too — on its own it brings back what the later files closed (AUDIT.md, D6).
--
-- What it changes:
--   • profiles      — a manager can no longer promote themselves: `role` changes only
--                     inside set_role(); the last owner cannot be demoted; a person
--                     edits only the contact / consent fields of their own row
--   • leads         — one guard trigger keeps the sale rules the panel used to keep
--                     alone: amount, agency income, sale date, lost reason, currency,
--                     hand-entered leads are «на связи» from the first second
--   • lead_activity — new kind 'money': who changed the amount / income / sale date
--                     of a closed lead, from what to what
--   • audit_log     — a deleted lead leaves a line
--   • coupons       — used_count is always recounted (= sold leads with the code) on
--                     insert, update and delete of a lead; nobody can type it in
--
-- Errors the panel translates (js/admin/api.js → errText):
--   role_change_forbidden, last_owner, profile_field_forbidden,
--   sale_needs_value, value_negative, profit_out_of_range, sale_date_in_future,
--   lost_reason_required
-- ============================================================================

-- ============================================================================
-- profiles: no privilege escalation
-- ============================================================================
-- 001 let any manager update any profile, role included. Now: the owner edits other
-- people's rows, everyone edits their own, and the trigger below decides which fields.
drop policy if exists "profiles: staff update" on public.profiles;
drop policy if exists "profiles: owner update" on public.profiles;
create policy "profiles: owner update" on public.profiles for update
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "profiles: self update" on public.profiles;
create policy "profiles: self update" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- NOT security definer on purpose: current_user is then the role that issued the
-- statement. Requests from the site and the panels arrive as anon / authenticated;
-- inside set_role() (security definer) and in the SQL Editor it is the database owner.
-- That is how "role changes only through set_role()" is told apart from a direct update.
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  api  boolean := current_user in ('anon', 'authenticated');
  -- what a person may change in their own row (birth_date arrives with migration 040)
  free text[]  := array['full_name', 'phone', 'lang', 'marketing_consent', 'consent_at',
                        'consent_source', 'onboarded', 'birth_date', 'updated_at'];
begin
  if new.role is distinct from old.role then
    if api then raise exception 'role_change_forbidden'; end if;
    if old.role::text = 'admin' then
      -- two owners demoting each other at the same moment must not leave the panel ownerless
      perform pg_advisory_xact_lock(hashtext('sam_travel.owners'));
      if not exists (select 1 from public.profiles where role::text = 'admin' and id <> old.id) then
        raise exception 'last_owner';
      end if;
    end if;
  end if;
  if api and not public.is_owner()
     and (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
    raise exception 'profile_field_forbidden';
  end if;
  return new;
end; $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ============================================================================
-- leads: the guard
-- ============================================================================
-- The panel counts money in one currency; a visitor or a manager never sends it.
create or replace function public.company_currency()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(value ->> 'currency'), '')
                   from public.site_settings where key = 'company'), 'USD');
$$;
revoke all on function public.company_currency() from public, anon, authenticated;

-- Replaces leads_before_update() from 002. Every check fires only when the status or
-- the money fields change, so old sales without an amount stay editable and keep
-- showing up in «Продажи без дохода агентства».
create or replace function public.leads_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ins            boolean := tg_op = 'INSERT';
  status_changed boolean;
  value_changed  boolean;
  profit_changed boolean;
  sent           timestamptz;
begin
  if not ins then new.updated_at := now(); end if;

  -- typed in by a manager = the client is already being talked to
  if new.source in ('phone', 'walk_in', 'instagram', 'manual') then
    if new.status = 'new' then new.status := 'contacted'; end if;
    if ins then new.first_response_at := new.created_at;
    elsif new.first_response_at is null then new.first_response_at := new.created_at;
    end if;
  end if;

  status_changed := ins or new.status is distinct from old.status;
  value_changed  := ins or new.value  is distinct from old.value;
  profit_changed := ins or new.profit is distinct from old.profit;

  -- SLA: the first move out of «new», once
  if not ins and new.first_response_at is null and old.status = 'new' and new.status <> 'new' then
    new.first_response_at := now();
  end if;

  -- closed_at = the day of the sale / refusal
  if new.status not in ('won', 'lost', 'spam') then
    new.closed_at := null;
  else
    if status_changed then
      -- entering a closed status: the date the client sent, else now
      sent := case when ins or new.closed_at is distinct from old.closed_at then new.closed_at end;
      new.closed_at := coalesce(sent, now());
    elsif new.closed_at is null then
      new.closed_at := old.closed_at;
    end if;
    if ins or new.closed_at is distinct from old.closed_at then
      -- a browser clock may run a little ahead: that is «now», not the future
      if new.closed_at > now() + interval '5 minutes' then raise exception 'sale_date_in_future'; end if;
      if new.closed_at > now() then new.closed_at := now(); end if;
    end if;
  end if;

  -- money
  if new.status = 'won' and (status_changed or value_changed) and not coalesce(new.value > 0, false) then
    raise exception 'sale_needs_value';
  end if;
  if value_changed or profit_changed or (status_changed and new.status = 'won') then
    if new.value < 0 then raise exception 'value_negative'; end if;
    if new.profit is not null and (new.profit < 0 or new.value is null or new.profit > new.value) then
      raise exception 'profit_out_of_range';
    end if;
  end if;
  if ins or value_changed then new.currency := public.company_currency();
  else new.currency := old.currency;
  end if;

  -- a refusal without a reason teaches nobody anything
  if new.status = 'lost' and (status_changed or new.lost_reason is distinct from old.lost_reason)
     and coalesce(btrim(new.lost_reason), '') = '' then
    raise exception 'lost_reason_required';
  end if;

  return new;
end; $$;

drop trigger if exists leads_bu    on public.leads;   -- 002: before update only
drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before insert or update on public.leads
  for each row execute function public.leads_guard();

-- ============================================================================
-- lead history: + money edits of a closed lead
-- ============================================================================
alter table public.lead_activity drop constraint if exists lead_activity_kind_check;
alter table public.lead_activity add constraint lead_activity_kind_check
  check (kind in ('note', 'status', 'assign', 'call', 'whatsapp', 'email', 'system', 'money'));

-- 'status', 'assign' and 'money' are written by the trigger below and by nobody else,
-- otherwise the trail it leaves could be typed in by hand.
drop policy if exists "activity: staff insert" on public.lead_activity;
create policy "activity: staff insert" on public.lead_activity for insert
  with check (public.is_staff() and actor = auth.uid()
              and kind in ('note', 'call', 'whatsapp', 'email', 'system'));

-- Replaces leads_after_update() from 002 (its promo-code arithmetic moved to
-- leads_coupon_recount below).
create or replace function public.leads_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare m jsonb := '{}'::jsonb;
begin
  if new.status is distinct from old.status then
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (new.id, auth.uid(), 'status', new.status, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (new.id, auth.uid(), 'assign', null, jsonb_build_object('to', new.assigned_to));
  end if;
  -- the lead was already closed and stays closed: every money edit leaves «было → стало»
  if old.status in ('won', 'lost', 'spam') and new.status in ('won', 'lost', 'spam') then
    if new.value is distinct from old.value then
      m := m || jsonb_build_object('value', jsonb_build_object('from', old.value, 'to', new.value));
    end if;
    if new.profit is distinct from old.profit then
      m := m || jsonb_build_object('profit', jsonb_build_object('from', old.profit, 'to', new.profit));
    end if;
    -- a status change stamps its own date, and the status line above already says when
    if new.closed_at is distinct from old.closed_at and new.status = old.status then
      m := m || jsonb_build_object('closed_at', jsonb_build_object('from', old.closed_at, 'to', new.closed_at));
    end if;
    if m <> '{}'::jsonb then
      insert into public.lead_activity (lead_id, actor, kind, body, meta)
      values (new.id, auth.uid(), 'money', null, m);
    end if;
  end if;
  return null;
end; $$;

drop trigger if exists leads_au  on public.leads;     -- 002
drop trigger if exists leads_log on public.leads;
create trigger leads_log after update on public.leads
  for each row execute function public.leads_log();

-- a deleted lead (owner only, see RLS) leaves the whole row in the audit log
drop trigger if exists leads_audit on public.leads;
create trigger leads_audit after delete on public.leads
  for each row execute function public.audit();

-- ============================================================================
-- promo codes: used_count = number of sold leads with the code, always recounted
-- ============================================================================
create index if not exists leads_coupon_won_idx on public.leads (upper(coupon_code))
  where status = 'won' and coupon_code is not null;

create or replace function public.coupon_used(p_code text)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.leads
  where status = 'won' and coupon_code is not null and upper(coupon_code) = upper(p_code);
$$;
revoke all on function public.coupon_used(text) from public, anon, authenticated;

-- whatever the panel sends in used_count, the stored number is the real one
create or replace function public.coupons_used_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.used_count := public.coupon_used(new.code);
  return new;
end; $$;

drop trigger if exists coupons_used_count on public.coupons;
create trigger coupons_used_count before insert or update on public.coupons
  for each row execute function public.coupons_used_count();

-- A sale typed in by one form, a sale reopened or refunded, a deleted sale, a code
-- changed on a sold lead — one recount covers them all.
create or replace function public.leads_coupon_recount()
returns trigger language plpgsql security definer set search_path = public as $$
declare codes text[] := '{}';
begin
  if tg_op <> 'INSERT' and old.coupon_code is not null then codes := codes || upper(old.coupon_code); end if;
  if tg_op <> 'DELETE' and new.coupon_code is not null then codes := codes || upper(new.coupon_code); end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.coupon_code is not distinct from old.coupon_code then
    return null;
  end if;
  if codes <> '{}' then
    update public.coupons set used_count = public.coupon_used(code)
     where upper(code) = any (codes) and used_count is distinct from public.coupon_used(code);
  end if;
  return null;
end; $$;

drop trigger if exists leads_coupon on public.leads;
create trigger leads_coupon after insert or update or delete on public.leads
  for each row execute function public.leads_coupon_recount();

-- bring the counters in line once (and on every re-run)
update public.coupons set used_count = public.coupon_used(code)
 where used_count is distinct from public.coupon_used(code);
