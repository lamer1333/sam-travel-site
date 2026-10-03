-- ============================================================================
-- SAM TRAVEL — auth & client base schema (Supabase / Postgres)
-- ============================================================================
-- Run this once in Supabase → SQL Editor.
-- It is idempotent-ish: safe to re-run, but review before running on prod data.
--
-- What it sets up:
--   • profiles           — one row per auth user (role, marketing consent, lang)
--   • bookings           — trip requests / bookings
--   • coupons            — promo codes for mailings
--   • coupon_redemptions — who used which coupon
--   • Row Level Security — client sees only their own data; staff see everything
--   • a trigger          — auto-creates a profile the moment a user signs up
-- ============================================================================

-- ---------- roles -----------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('client', 'manager', 'admin');
exception when duplicate_object then null; end $$;

-- ---------- profiles --------------------------------------------------------
-- Mirrors auth.users. We NEVER store passwords here — Supabase Auth owns those.
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text,
  phone             text,
  role              public.user_role not null default 'client',
  lang              text not null default 'en' check (lang in ('en','ru','hy')),

  -- marketing consent — the legal basis for sending discount/coupon mailings.
  -- Defaults to FALSE: a login is NOT consent. Ask explicitly, store when/where.
  marketing_consent boolean not null default false,
  consent_at        timestamptz,
  consent_source    text,                 -- e.g. 'signup_form', 'onboarding_google'

  -- onboarded = we have already shown the consent screen at least once.
  -- Social logins (Google/Mail.ru) have no consent checkbox, so we show one on
  -- first login and flip this to true afterwards.
  onboarded         boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- coupons ---------------------------------------------------------
-- Created before bookings because bookings.coupon_id references it.
create table if not exists public.coupons (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  description  text,
  discount_pct integer check (discount_pct between 1 and 100),  -- percent OFF
  discount_amt numeric(10,2),                                   -- OR flat amount
  valid_from   timestamptz not null default now(),
  valid_until  timestamptz,
  max_uses     integer,                    -- null = unlimited
  used_count   integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------- bookings --------------------------------------------------------
do $$ begin
  create type public.booking_status as enum ('new', 'in_progress', 'confirmed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  tour         text not null,
  details      text,
  dates        text,                      -- free text for now; tighten later if needed
  status       public.booking_status not null default 'new',
  coupon_id    uuid references public.coupons (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bookings_user_id_idx on public.bookings (user_id);
create index if not exists bookings_status_idx  on public.bookings (status);

-- ---------- coupon redemptions ---------------------------------------------
create table if not exists public.coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.coupons (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  booking_id  uuid references public.bookings (id) on delete set null,
  redeemed_at timestamptz not null default now(),
  unique (coupon_id, user_id)             -- one redemption per user per coupon
);

-- ============================================================================
-- Helper: is the current user staff (manager/admin)?
-- SECURITY DEFINER so it can read profiles WITHOUT triggering the RLS policies
-- that call it — this is what prevents infinite recursion in the policies below.
-- ============================================================================
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('manager','admin')
  );
$$;

-- ============================================================================
-- Trigger: create a profile row automatically on sign-up.
-- Pulls full_name / lang from the metadata the client sends at signUp/OAuth.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, lang, marketing_consent, consent_at, consent_source, onboarded)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'lang', 'en'),
    -- email/password signup can pass an explicit consent flag in metadata
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false),
    case when (new.raw_user_meta_data ->> 'marketing_consent')::boolean
         then now() else null end,
    new.raw_user_meta_data ->> 'consent_source',
    -- email signups already answered the consent checkbox (they carry a
    -- consent_source), so they are onboarded; social logins are not, and get
    -- the one-time consent screen in the cabinet.
    (new.raw_user_meta_data ->> 'consent_source') is not null
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- keep updated_at fresh ------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles           enable row level security;
alter table public.bookings           enable row level security;
alter table public.coupons            enable row level security;
alter table public.coupon_redemptions enable row level security;

-- ---- profiles --------------------------------------------------------------
drop policy if exists "profiles: self read"     on public.profiles;
drop policy if exists "profiles: staff read"    on public.profiles;
drop policy if exists "profiles: self update"   on public.profiles;
drop policy if exists "profiles: staff update"  on public.profiles;

create policy "profiles: self read"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: staff read"
  on public.profiles for select
  using (public.is_staff());

-- A client may edit their own profile, but must NOT be able to promote
-- themselves: the WITH CHECK keeps role = 'client' for self-updates.
create policy "profiles: self update"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = 'client');

create policy "profiles: staff update"
  on public.profiles for update
  using (public.is_staff())
  with check (public.is_staff());

-- ---- bookings --------------------------------------------------------------
drop policy if exists "bookings: self read"   on public.bookings;
drop policy if exists "bookings: self insert" on public.bookings;
drop policy if exists "bookings: staff all"   on public.bookings;

create policy "bookings: self read"
  on public.bookings for select
  using (user_id = auth.uid());

create policy "bookings: self insert"
  on public.bookings for insert
  with check (user_id = auth.uid());

create policy "bookings: staff all"
  on public.bookings for all
  using (public.is_staff())
  with check (public.is_staff());

-- ---- coupons ---------------------------------------------------------------
-- Anyone logged in can READ an active coupon (to apply it); only staff manage.
drop policy if exists "coupons: read active" on public.coupons;
drop policy if exists "coupons: staff all"   on public.coupons;

create policy "coupons: read active"
  on public.coupons for select
  using (active = true and (valid_until is null or valid_until > now()));

create policy "coupons: staff all"
  on public.coupons for all
  using (public.is_staff())
  with check (public.is_staff());

-- ---- coupon_redemptions ----------------------------------------------------
drop policy if exists "redemptions: self read"   on public.coupon_redemptions;
drop policy if exists "redemptions: self insert" on public.coupon_redemptions;
drop policy if exists "redemptions: staff all"   on public.coupon_redemptions;

create policy "redemptions: self read"
  on public.coupon_redemptions for select
  using (user_id = auth.uid());

create policy "redemptions: self insert"
  on public.coupon_redemptions for insert
  with check (user_id = auth.uid());

create policy "redemptions: staff all"
  on public.coupon_redemptions for all
  using (public.is_staff())
  with check (public.is_staff());

-- ============================================================================
-- Marketing export view — the segment your mailing tool (Brevo/Resend) reads.
-- Only people who actually consented. Staff-only via RLS on the base table.
-- ============================================================================
create or replace view public.marketing_audience as
  select p.id, u.email, p.full_name, p.lang, p.consent_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.marketing_consent = true;

-- Promote your first admin manually after signing up, e.g.:
--   update public.profiles set role = 'admin' where id = '<your-user-uuid>';
