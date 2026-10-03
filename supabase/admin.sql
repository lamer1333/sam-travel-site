-- ============================================================================
-- SAM TRAVEL — backend for the owner / marketing panels  (migration #2)
-- ============================================================================
-- Run AFTER schema.sql, once, in Supabase → SQL Editor. Safe to re-run.
--
-- What it adds:
--   • role "marketer" + role helpers (is_owner / is_marketing / is_team)
--   • leads + lead_activity   — every site request lands here (mini-CRM)
--   • tours, reviews, team, reels, site_settings — the site's editable content
--   • promos, campaigns, wa_templates — marketing tools
--   • events                  — first-party, cookieless site analytics
--   • audit_log               — who changed what in the panels
--   • storage bucket "media"  — photos uploaded from the panels
--   • RPCs the site and panels call (public_site, submit_lead, track, stats…)
--   • security fixes for two leaks in schema.sql (see "fixes" below)
--
-- Roles after this migration:
--   admin    = owner: everything
--   manager  = works leads and bookings, reads content
--   marketer = content, promos, campaigns, coupons, SEO, audience, analytics —
--              sees lead NUMBERS by source/campaign, never lead phone numbers
--   client   = site visitor with an account (cabinet only)
-- ============================================================================

-- ---------- role: marketer --------------------------------------------------
-- A new enum value cannot be USED in the same transaction that adds it, so every
-- check below compares role::text rather than the enum literal.
alter type public.user_role add value if not exists 'marketer';

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role::text from public.profiles where id = auth.uid();
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false);
$$;

create or replace function public.is_marketing()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'marketer'), false);
$$;

create or replace function public.is_team()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'manager', 'marketer'), false);
$$;

-- ============================================================================
-- fixes for schema.sql
-- ============================================================================
-- 1) The view marketing_audience joins auth.users and runs with its creator's
--    rights, and Supabase grants SELECT on public views to anon/authenticated by
--    default — so ANY visitor could read every subscriber's email through the REST
--    API. Lock it; the panels use audience_list() below, which checks the role.
revoke all on public.marketing_audience from anon, authenticated;

-- 2) "coupons: read active" let anyone (even signed-out) list every live coupon
--    code. Codes are now checked one at a time via check_coupon().
drop policy if exists "coupons: read active" on public.coupons;
drop policy if exists "coupons: marketing all" on public.coupons;
create policy "coupons: marketing all" on public.coupons for all
  using (public.is_marketing()) with check (public.is_marketing());

-- ============================================================================
-- content
-- ============================================================================
-- Every visible string is stored per language: i18n = {"en": {...}, "ru": {...}, "hy": {...}}.
-- The site falls back to English for a missing language.

create table if not exists public.site_settings (
  key         text primary key,           -- contacts | company | stats | hours | seo | analytics
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table if not exists public.tours (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  sort        integer not null default 0,
  published   boolean not null default false,   -- shown in the "Hot tours" carousel
  hot_until   date,                            -- auto-hidden the day after
  photo_url   text,                            -- uploaded photo; else the gradient below
  photo_class text not null default 'p-sea',   -- p-sea | p-desert | p-lagoon | p-snow | p-island | p-jungle | p-ocean | p-city
  tags        text[] not null default '{}',
  price_from  numeric(12,2),
  currency    text not null default 'USD',
  i18n        jsonb not null default '{}'::jsonb,
  -- per language: card_title, card_text, season, dates, meta, title, text, inc[]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  author      text not null,
  trip        text,                            -- "Sharm El Sheikh · Oct 2025"
  rating      smallint not null default 5 check (rating between 1 and 5),
  body        jsonb not null default '{}'::jsonb,   -- {"en": "...", "ru": "..."}
  photo_url   text,
  source      text not null default 'direct',  -- direct | google | instagram | facebook
  published   boolean not null default false,
  featured    boolean not null default false,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table if not exists public.team (
  id          uuid primary key default gen_random_uuid(),
  i18n        jsonb not null default '{}'::jsonb,   -- {"en": {"name": "...", "role": "..."}}
  photo_url   text,
  whatsapp    text,
  published   boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table if not exists public.reels (
  id          uuid primary key default gen_random_uuid(),
  url         text not null check (url ~ '^https://(www\.)?instagram\.com/(reel|p)/[A-Za-z0-9_-]+/?'),
  published   boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

-- ============================================================================
-- marketing
-- ============================================================================
create table if not exists public.promos (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'bar' check (kind in ('bar', 'popup')),
  name        text not null,                   -- internal name
  i18n        jsonb not null default '{}'::jsonb,   -- {"en": {"title","text","cta"}}
  link        text,                            -- '#plan', '#hot', 'https://wa.me/…'
  coupon_code text,
  theme       text not null default 'brand' check (theme in ('brand', 'dark', 'sunset', 'sea')),
  active      boolean not null default false,
  starts_at   timestamptz,
  ends_at     timestamptz,
  -- targeting: {"langs": ["ru"], "devices": ["mobile"], "utm_campaign": "…", "delay_s": 8, "frequency": "session"}
  audience    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  channel      text not null default 'instagram',  -- instagram | facebook | google | tiktok | telegram | email | offline | other
  utm_source   text not null,
  utm_medium   text not null,
  utm_campaign text not null unique,
  utm_content  text,
  landing      text not null default '',        -- '', '#hot', '#plan' …
  spend        numeric(12,2) not null default 0,  -- actual spend so far
  currency     text not null default 'AMD',
  starts_on    date,
  ends_on      date,
  notes        text,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null
);

create table if not exists public.wa_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  lang        text not null default 'ru' check (lang in ('en', 'ru', 'hy')),
  body        text not null,                   -- placeholders: {name} {tour} {manager}
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- leads (mini-CRM)
-- ============================================================================
create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  name              text not null check (char_length(name) between 1 and 120),
  phone             text not null check (char_length(phone) between 5 and 40),
  phone_digits      text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  email             text,
  message           text check (char_length(message) <= 2000),
  source            text not null default 'form',  -- form | plan | tour | manual | phone | walk_in | instagram
  tour              text,                           -- tour slug of interest
  details           jsonb not null default '{}'::jsonb,
  lang              text,
  device            text,
  page              text,
  referrer          text,
  utm_source        text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  coupon_code       text,
  status            text not null default 'new'
                    check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam')),
  lost_reason       text,
  value             numeric(12,2),
  currency          text not null default 'USD',
  assigned_to       uuid references public.profiles (id) on delete set null,
  tags              text[] not null default '{}',
  follow_up_at      timestamptz,
  first_response_at timestamptz,                    -- SLA: first time someone touched it
  closed_at         timestamptz,
  user_id           uuid references public.profiles (id) on delete set null
);
create index if not exists leads_created_idx  on public.leads (created_at desc);
create index if not exists leads_status_idx   on public.leads (status);
create index if not exists leads_phone_idx    on public.leads (phone_digits);
create index if not exists leads_campaign_idx on public.leads (utm_campaign);

create table if not exists public.lead_activity (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  created_at  timestamptz not null default now(),
  actor       uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('note', 'status', 'assign', 'call', 'whatsapp', 'email', 'system')),
  body        text,
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id, created_at);

-- SLA + history, kept by the database so every client records it the same way.
create or replace function public.leads_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.first_response_at is null and old.status = 'new' and new.status <> 'new' then
    new.first_response_at = now();
  end if;
  if new.status in ('won', 'lost', 'spam') and old.status not in ('won', 'lost', 'spam') then
    new.closed_at = now();
  elsif new.status not in ('won', 'lost', 'spam') then
    new.closed_at = null;
  end if;
  return new;
end; $$;

create or replace function public.leads_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (new.id, auth.uid(), 'status', new.status, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (new.id, auth.uid(), 'assign', null, jsonb_build_object('to', new.assigned_to));
  end if;
  return null;
end; $$;

drop trigger if exists leads_bu on public.leads;
create trigger leads_bu before update on public.leads for each row execute function public.leads_before_update();
drop trigger if exists leads_au on public.leads;
create trigger leads_au after update on public.leads for each row execute function public.leads_after_update();

-- Any logged activity (a call, a WhatsApp message) also counts as the first response.
create or replace function public.lead_activity_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('call', 'whatsapp', 'email', 'note') then
    update public.leads set first_response_at = now()
    where id = new.lead_id and first_response_at is null;
  end if;
  return null;
end; $$;
drop trigger if exists lead_activity_ai on public.lead_activity;
create trigger lead_activity_ai after insert on public.lead_activity for each row execute function public.lead_activity_after_insert();

-- ============================================================================
-- events — first-party analytics without cookies
-- ============================================================================
-- No cookie, no localStorage, no IP, no user id. `sid` is a random id that lives
-- in memory for one page load only, so a "session" = one visit to the page.
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  sid          text not null,
  name         text not null,
  section      text,
  tour         text,
  promo_id     uuid,
  label        text,
  lang         text,
  device       text,
  ref_host     text,
  utm_source   text, utm_medium text, utm_campaign text, utm_content text
);
create index if not exists events_ts_idx   on public.events (ts);
create index if not exists events_name_idx on public.events (name, ts);

-- ============================================================================
-- audit log
-- ============================================================================
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  table_name  text not null,
  row_id      text,
  action      text not null,          -- insert | update | delete
  before      jsonb,
  after       jsonb
);
create index if not exists audit_at_idx on public.audit_log (at desc);

create or replace function public.audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  -- profiles: only role changes are worth a line
  -- (nested ifs: new.role only exists on profiles, and plpgsql doesn't short-circuit)
  if tg_table_name = 'profiles' then
    if tg_op <> 'UPDATE' then return null; end if;
    if to_jsonb(new) ->> 'role' is not distinct from to_jsonb(old) ->> 'role' then return null; end if;
  end if;
  rid := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id',
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'key');
  insert into public.audit_log (actor, table_name, row_id, action, before, after)
  values (auth.uid(), tg_table_name, rid, lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end; $$;

create or replace function public.stamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end; $$;

do $$
declare t text;
begin
  foreach t in array array['site_settings','tours','reviews','team','reels','promos','campaigns','coupons','wa_templates','profiles'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit()', t, t);
  end loop;
  foreach t in array array['site_settings','tours','reviews','team','reels','promos','campaigns'] loop
    execute format('drop trigger if exists %I_stamp on public.%I', t, t);
    execute format('create trigger %I_stamp before insert or update on public.%I for each row execute function public.stamp()', t, t);
  end loop;
end $$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.site_settings enable row level security;
alter table public.tours         enable row level security;
alter table public.reviews       enable row level security;
alter table public.team          enable row level security;
alter table public.reels         enable row level security;
alter table public.promos        enable row level security;
alter table public.campaigns     enable row level security;
alter table public.wa_templates  enable row level security;
alter table public.leads         enable row level security;
alter table public.lead_activity enable row level security;
alter table public.events        enable row level security;
alter table public.audit_log     enable row level security;

-- The public site never reads these tables directly: it calls public_site(),
-- which returns only published rows. Tables are readable by the team only.
do $$
declare t text;
begin
  foreach t in array array['tours','reviews','reels','promos','campaigns'] loop
    execute format('drop policy if exists "%s: team read" on public.%I', t, t);
    execute format('drop policy if exists "%s: marketing write" on public.%I', t, t);
    execute format('create policy "%s: team read" on public.%I for select using (public.is_team())', t, t);
    execute format('create policy "%s: marketing write" on public.%I for all using (public.is_marketing()) with check (public.is_marketing())', t, t);
  end loop;
end $$;

drop policy if exists "team: team read"   on public.team;
drop policy if exists "team: owner write" on public.team;
create policy "team: team read"   on public.team for select using (public.is_team());
create policy "team: owner write" on public.team for all using (public.is_owner()) with check (public.is_owner());

-- settings: owner edits everything; the marketer edits SEO, analytics IDs and the stats strip
drop policy if exists "settings: team read"       on public.site_settings;
drop policy if exists "settings: owner write"     on public.site_settings;
drop policy if exists "settings: marketing write" on public.site_settings;
create policy "settings: team read"   on public.site_settings for select using (public.is_team());
create policy "settings: owner write" on public.site_settings for all using (public.is_owner()) with check (public.is_owner());
create policy "settings: marketing write" on public.site_settings for update
  using (public.is_marketing() and key in ('seo', 'analytics', 'stats'))
  with check (public.is_marketing() and key in ('seo', 'analytics', 'stats'));

-- leads: people with phone numbers — owner and managers only
drop policy if exists "leads: staff all"    on public.leads;
drop policy if exists "leads: owner delete" on public.leads;
drop policy if exists "leads: staff read"   on public.leads;
drop policy if exists "leads: staff insert" on public.leads;
drop policy if exists "leads: staff update" on public.leads;
create policy "leads: staff read"   on public.leads for select using (public.is_staff());
create policy "leads: staff insert" on public.leads for insert with check (public.is_staff());
create policy "leads: staff update" on public.leads for update using (public.is_staff()) with check (public.is_staff());
create policy "leads: owner delete" on public.leads for delete using (public.is_owner());

drop policy if exists "activity: staff read"   on public.lead_activity;
drop policy if exists "activity: staff insert" on public.lead_activity;
create policy "activity: staff read"   on public.lead_activity for select using (public.is_staff());
create policy "activity: staff insert" on public.lead_activity for insert with check (public.is_staff() and actor = auth.uid());

drop policy if exists "templates: staff read"  on public.wa_templates;
drop policy if exists "templates: owner write" on public.wa_templates;
create policy "templates: staff read"  on public.wa_templates for select using (public.is_staff());
create policy "templates: owner write" on public.wa_templates for all using (public.is_owner()) with check (public.is_owner());

-- events: written only through track(); raw rows readable by the owner
drop policy if exists "events: owner read" on public.events;
create policy "events: owner read" on public.events for select using (public.is_owner());

drop policy if exists "audit: owner read" on public.audit_log;
create policy "audit: owner read" on public.audit_log for select using (public.is_owner());

-- ============================================================================
-- storage: bucket "media" (public read, team write)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

drop policy if exists "media: team insert" on storage.objects;
drop policy if exists "media: team update" on storage.objects;
drop policy if exists "media: team delete" on storage.objects;
create policy "media: team insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_team());
create policy "media: team update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_team());
create policy "media: team delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_marketing());

-- realtime: the owner panel pings on every new lead
do $$ begin
  alter publication supabase_realtime add table public.leads;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ============================================================================
-- RPC: what the public site calls
-- ============================================================================

-- Everything the landing page needs in one round trip. Published rows only.
create or replace function public.public_site()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- company: only what the page prints (licence, insurance, name) — never the margin
    'settings', coalesce((select jsonb_object_agg(key, case when key = 'company' then value - 'margin_pct' - 'currency' else value end)
                          from public.site_settings
                          where key in ('contacts', 'company', 'stats', 'hours', 'seo', 'analytics')), '{}'::jsonb),
    'tours',   coalesce((select jsonb_agg(jsonb_build_object(
                  'slug', slug, 'photo_url', photo_url, 'photo_class', photo_class, 'tags', tags,
                  'price_from', price_from, 'currency', currency, 'i18n', i18n) order by sort)
                from public.tours where published and (hot_until is null or hot_until >= (now() at time zone 'Asia/Yerevan')::date)), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
                  'author', author, 'trip', trip, 'rating', rating, 'body', body, 'photo_url', photo_url, 'source', source)
                  order by featured desc, sort, created_at desc)
                from public.reviews where published), '[]'::jsonb),
    'team',    coalesce((select jsonb_agg(jsonb_build_object('i18n', i18n, 'photo_url', photo_url) order by sort)
                from public.team where published), '[]'::jsonb),
    'reels',   coalesce((select jsonb_agg(url order by sort) from public.reels where published), '[]'::jsonb),
    'promos',  coalesce((select jsonb_agg(jsonb_build_object(
                  'id', id, 'kind', kind, 'i18n', i18n, 'link', link, 'coupon_code', coupon_code,
                  'theme', theme, 'audience', audience) order by created_at desc)
                from public.promos
                where active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())), '[]'::jsonb)
  );
$$;

-- A request from the site form. Anyone may call it; it validates, de-duplicates
-- and rate-limits, so no direct INSERT on leads is granted to visitors.
create or replace function public.submit_lead(p jsonb)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_name  text := left(btrim(coalesce(p ->> 'name', '')), 120);
  v_phone text := left(btrim(coalesce(p ->> 'phone', '')), 40);
  v_digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_id uuid;
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

  -- flood guard for the whole site
  if (select count(*) from public.leads where created_at > now() - interval '10 minutes'
        and source not in ('manual', 'phone', 'walk_in')) > 40 then
    raise exception 'rate_limited';
  end if;

  insert into public.leads (name, phone, email, message, source, tour, details, lang, device, page, referrer,
                            utm_source, utm_medium, utm_campaign, utm_content, utm_term, coupon_code, user_id)
  values (v_name, v_phone,
          nullif(left(p ->> 'email', 200), ''),
          nullif(left(p ->> 'message', 2000), ''),
          case when p ->> 'source' in ('form', 'plan', 'tour', 'promo') then p ->> 'source' else 'form' end,
          nullif(left(p ->> 'tour', 40), ''),
          case when jsonb_typeof(p -> 'details') = 'object' then p -> 'details' else '{}'::jsonb end,
          nullif(left(p ->> 'lang', 5), ''),
          nullif(left(p ->> 'device', 10), ''),
          nullif(left(p ->> 'page', 300), ''),
          nullif(left(p ->> 'referrer', 300), ''),
          nullif(left(p ->> 'utm_source', 100), ''), nullif(left(p ->> 'utm_medium', 100), ''),
          nullif(left(p ->> 'utm_campaign', 100), ''), nullif(left(p ->> 'utm_content', 100), ''),
          nullif(left(p ->> 'utm_term', 100), ''),
          nullif(upper(left(p ->> 'coupon_code', 40)), ''),
          auth.uid())
  returning id into v_id;

  insert into public.lead_activity (lead_id, kind, body)
  values (v_id, 'system', 'Created from the site (' || coalesce(p ->> 'source', 'form') || ')');

  -- the conversion itself, so the funnel never depends on the browser also reporting it
  if coalesce(p ->> 'sid', '') <> '' then
    insert into public.events (sid, name, tour, lang, device, utm_source, utm_medium, utm_campaign, utm_content)
    values (left(p ->> 'sid', 40), 'lead_submit', nullif(left(p ->> 'tour', 40), ''), left(p ->> 'lang', 5), left(p ->> 'device', 10),
            nullif(left(p ->> 'utm_source', 100), ''), nullif(left(p ->> 'utm_medium', 100), ''),
            nullif(left(p ->> 'utm_campaign', 100), ''), nullif(left(p ->> 'utm_content', 100), ''));
  end if;
  return v_id;
end; $$;

-- Batched analytics events from the site (max 30 per call, whitelisted names).
create or replace function public.track(p_events jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 30 then return; end if;
  insert into public.events (sid, name, section, tour, promo_id, label, lang, device, ref_host,
                             utm_source, utm_medium, utm_campaign, utm_content)
  select left(e ->> 'sid', 40), e ->> 'name',
         nullif(left(e ->> 'section', 40), ''), nullif(left(e ->> 'tour', 40), ''),
         case when (e ->> 'promo_id') ~ '^[0-9a-f-]{36}$' then (e ->> 'promo_id')::uuid end,
         nullif(left(e ->> 'label', 80), ''), nullif(left(e ->> 'lang', 5), ''), nullif(left(e ->> 'device', 10), ''),
         nullif(left(e ->> 'ref_host', 100), ''),
         nullif(left(e ->> 'utm_source', 100), ''), nullif(left(e ->> 'utm_medium', 100), ''),
         nullif(left(e ->> 'utm_campaign', 100), ''), nullif(left(e ->> 'utm_content', 100), '')
  from jsonb_array_elements(p_events) e
  where coalesce(e ->> 'sid', '') <> ''
    and e ->> 'name' in ('page_view', 'section_view', 'tour_open', 'plan_open', 'checklist_open', 'wa_click',
                         'tel_click', 'mail_click', 'promo_view', 'promo_click', 'promo_close', 'lang_switch',
                         'auth_open', 'plan_send', 'form_start');
end; $$;

-- Is this code usable right now? Answers yes/no + the discount, never the list.
create or replace function public.check_coupon(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('valid', true, 'code', code, 'discount_pct', discount_pct,
                              'discount_amt', discount_amt, 'valid_until', valid_until)
    from public.coupons
    where upper(code) = upper(btrim(p_code)) and active
      and valid_from <= now() and (valid_until is null or valid_until > now())
      and (max_uses is null or used_count < max_uses)
  ), jsonb_build_object('valid', false));
$$;

-- ============================================================================
-- RPC: panels
-- ============================================================================

-- Traffic + conversion aggregates. Lead counts per source/campaign, but no PII,
-- so the marketer can see what converts without seeing who.
create or replace function public.stats_traffic(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_team() then raise exception 'forbidden'; end if;
  with ev as (
    select *, (ts at time zone 'Asia/Yerevan') as lt,
           coalesce(utm_source, ref_host, 'direct') as src
    from public.events where ts >= p_from and ts < p_to
  ), ld as (
    select *, (created_at at time zone 'Asia/Yerevan') as lt,
           coalesce(utm_source,
                    nullif(regexp_replace(coalesce(referrer, ''), '^https?://(www\.)?([^/]+).*$', '\2'), ''),
                    'direct') as src
    from public.leads where created_at >= p_from and created_at < p_to and status <> 'spam'
  )
  select jsonb_build_object(
    'daily', coalesce((select jsonb_agg(x order by x.d) from (
        select g.d::date as d, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts, coalesce(l.leads, 0) as leads
        from generate_series((p_from at time zone 'Asia/Yerevan')::date,
                             ((p_to at time zone 'Asia/Yerevan') - interval '1 second')::date, interval '1 day') g(d)
        left join (select lt::date as d, count(*) filter (where name = 'page_view') as visits,
                          count(*) filter (where name in ('wa_click', 'tel_click')) as contacts
                   from ev group by 1) v on v.d = g.d::date
        left join (select lt::date as d, count(*) as leads from ld group by 1) l on l.d = g.d::date
      ) x), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(x order by x.visits desc) from (
        select s.src, coalesce(v.visits, 0) as visits, coalesce(l.leads, 0) as leads, coalesce(l.won, 0) as won, coalesce(l.revenue, 0) as revenue
        from (select src from ev where name = 'page_view' union select src from ld) s
        left join (select src, count(*) visits from ev where name = 'page_view' group by src) v using (src)
        left join (select src, count(*) leads, count(*) filter (where status = 'won') won,
                          sum(value) filter (where status = 'won') revenue from ld group by src) l using (src)
      ) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x) from (
        select c.k as campaign, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts,
               coalesce(l.leads, 0) as leads, coalesce(l.won, 0) as won, coalesce(l.revenue, 0) as revenue
        from (select utm_campaign k from ev where utm_campaign is not null union select utm_campaign from ld where utm_campaign is not null) c
        left join (select utm_campaign k, count(*) filter (where name = 'page_view') visits,
                          count(*) filter (where name in ('wa_click', 'tel_click')) contacts from ev group by 1) v using (k)
        left join (select utm_campaign k, count(*) leads, count(*) filter (where status = 'won') won,
                          sum(value) filter (where status = 'won') revenue from ld group by 1) l using (k)
      ) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_object_agg(k, n) from (select coalesce(device, '?') k, count(*) n from ev where name = 'page_view' group by 1) x), '{}'::jsonb),
    'langs',   coalesce((select jsonb_object_agg(k, n) from (select coalesce(lang, '?') k, count(*) n from ev where name = 'page_view' group by 1) x), '{}'::jsonb),
    'sections', coalesce((select jsonb_object_agg(section, n) from (select section, count(distinct sid) n from ev where name = 'section_view' and section is not null group by 1) x), '{}'::jsonb),
    'ctas',    coalesce((select jsonb_object_agg(name, n) from (select name, count(*) n from ev where name not in ('page_view', 'section_view') group by 1) x), '{}'::jsonb),
    'tours',   coalesce((select jsonb_agg(x order by x.opens desc) from (
        select t.tour, coalesce(o.opens, 0) opens, coalesce(l.leads, 0) leads
        from (select tour from ev where tour is not null union select tour from ld where tour is not null) t
        left join (select tour, count(*) opens from ev where name = 'tour_open' group by 1) o using (tour)
        left join (select tour, count(*) leads from ld group by 1) l using (tour)
      ) x), '[]'::jsonb),
    'heat', coalesce((select jsonb_agg(x) from (
        select extract(isodow from lt)::int as dow, extract(hour from lt)::int as h, count(*) as visits
        from ev where name = 'page_view' group by 1, 2) x), '[]'::jsonb),
    'lead_heat', coalesce((select jsonb_agg(x) from (
        select extract(isodow from lt)::int as dow, extract(hour from lt)::int as h, count(*) as leads
        from ld group by 1, 2) x), '[]'::jsonb),
    'promos', coalesce((select jsonb_agg(x) from (
        select promo_id as id, count(*) filter (where name = 'promo_view') views,
               count(*) filter (where name = 'promo_click') clicks,
               count(*) filter (where name = 'promo_close') closes
        from ev where promo_id is not null group by 1) x), '[]'::jsonb),
    'funnel', jsonb_build_object(
        'visits',  (select count(distinct sid) from ev where name = 'page_view'),
        'engaged', (select count(distinct sid) from ev where name = 'section_view' and section not in ('band-prices')),
        'intent',  (select count(distinct sid) from ev where name in ('tour_open', 'plan_open', 'checklist_open', 'form_start', 'wa_click', 'tel_click')),
        'contact', (select count(distinct sid) from ev where name in ('wa_click', 'tel_click', 'plan_send', 'lead_submit')),
        'leads',   (select count(*) from ld),
        'won',     (select count(*) from ld where status = 'won'))
  ) into r;
  return r;
end; $$;

-- Subscribers who opted in — for the ESP export. Marketing roles only.
create or replace function public.audience_list()
returns table (id uuid, email text, full_name text, lang text, consent_at timestamptz,
               consent_source text, created_at timestamptz, bookings bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_marketing() then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.lang, p.consent_at, p.consent_source, p.created_at,
           (select count(*) from public.bookings b where b.user_id = p.id)
    from public.profiles p join auth.users u on u.id = p.id
    where p.marketing_consent
    order by p.consent_at desc nulls last;
end; $$;

-- Every account with its e-mail (owner) or just the team (anyone on the team).
create or replace function public.users_list()
returns table (id uuid, email text, full_name text, phone text, role text, lang text,
               marketing_consent boolean, created_at timestamptz, last_sign_in_at timestamptz,
               provider text, bookings bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'forbidden'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.role::text, p.lang, p.marketing_consent,
           p.created_at, u.last_sign_in_at, coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
           (select count(*) from public.bookings b where b.user_id = p.id)
    from public.profiles p join auth.users u on u.id = p.id
    where public.is_owner() or p.role::text <> 'client'
    order by p.created_at desc;
end; $$;

create or replace function public.set_role(p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot_change_own_role'; end if;
  if p_role not in ('client', 'manager', 'marketer', 'admin') then raise exception 'bad_role'; end if;
  update public.profiles set role = p_role::public.user_role where id = p_user;
end; $$;

-- Who am I, for the panel's first paint.
create or replace function public.whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'email', u.email, 'full_name', p.full_name, 'role', p.role::text, 'lang', p.lang)
  from public.profiles p join auth.users u on u.id = p.id where p.id = auth.uid();
$$;

-- ---------- grants ----------------------------------------------------------
revoke all on function public.stats_traffic(timestamptz, timestamptz) from anon;
revoke all on function public.audience_list() from anon;
revoke all on function public.users_list()    from anon;
revoke all on function public.set_role(uuid, text) from anon;
grant execute on function public.public_site()          to anon, authenticated;
grant execute on function public.submit_lead(jsonb)     to anon, authenticated;
grant execute on function public.track(jsonb)           to anon, authenticated;
grant execute on function public.check_coupon(text)     to anon, authenticated;

-- ============================================================================
-- seed: today's site content, so switching the site to the database changes nothing
-- ============================================================================
insert into public.site_settings (key, value) values
  ('contacts', jsonb_build_object(
      'phone', '+374 55 957585', 'whatsapp', '37455957585', 'email', 'outgoingsamtravel@gmail.com',
      'address', jsonb_build_object('en', 'Komitas 51, Yerevan', 'ru', 'Комитас 51, Ереван', 'hy', 'Կոմիտաս 51, Երևան'),
      'instagram', 'https://www.instagram.com/samtravel.arm', 'facebook', 'https://www.facebook.com/samtravel', 'telegram', '')),
  ('company',  jsonb_build_object('licence', '23-1057-2023', 'insurance', 'TRV-2026-0412', 'legal_name', 'SAM TRAVEL', 'currency', 'USD', 'margin_pct', 12)),
  ('stats',    jsonb_build_object('years', '3+', 'trips', '500+', 'destinations', '25+', 'travellers', '3 000+')),
  ('hours',    jsonb_build_object('days', jsonb_build_array(1, 2, 3, 4, 5, 6), 'from', '10:00', 'to', '19:00', 'sla_min', 60)),
  ('seo',      jsonb_build_object(
      'en', jsonb_build_object('title', 'SAM TRAVEL — Travel agency in Yerevan | Beach, city & group tours',
                               'description', 'Travel agency in Yerevan. Beach, city and group trips arranged by a real manager — flights, hotels, visa support and insurance, confirmed in one message on WhatsApp.'),
      'ru', jsonb_build_object('title', '', 'description', ''),
      'hy', jsonb_build_object('title', '', 'description', ''))),
  ('analytics', jsonb_build_object('ga4', '', 'pixel', ''))
on conflict (key) do nothing;

insert into public.reels (url, sort)
select 'https://www.instagram.com/reel/DceFC3aCMGX/', 0
where not exists (select 1 from public.reels);

insert into public.wa_templates (title, lang, body, sort)
select * from (values
  ('Первый ответ', 'ru', 'Здравствуйте, {name}! Это {manager} из SAM TRAVEL. Получили вашу заявку{tour}. Уточните, пожалуйста, даты и сколько вас будет?', 0),
  ('Предложение готово', 'ru', '{name}, подобрали варианты{tour} — отправляю подборку. Цены держатся 24 часа, если что-то приглянулось — скажите, забронируем.', 1),
  ('Не дозвонились', 'ru', '{name}, добрый день! Не смогли до вас дозвониться по заявке{tour}. Когда вам удобно поговорить?', 2),
  ('First reply', 'en', 'Hi {name}! This is {manager} from SAM TRAVEL. We got your request{tour}. Could you confirm the dates and how many travellers?', 3),
  ('Առաջին պատասխան', 'hy', 'Բարև, {name}։ {manager}-ն է, SAM TRAVEL-ից։ Ստացանք ձեր հայտը{tour}։ Կճշտե՞ք ամսաթվերը և քանի հոգի եք։', 4)
) v(title, lang, body, sort)
where not exists (select 1 from public.wa_templates);

-- tours: generated from the current index.html / js/app.js / js/i18n.js
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('dubai', 1, true, 'p-desert', '{city,beach}', '{"en":{"meta":"UAE · year-round","title":"Dubai","text":"Four hours from Yerevan, visa on arrival, and a city that works as well in January as in October. Beach mornings, mall afternoons, desert at sunset.","inc":["Direct flight from Yerevan","Hotel on the beach or in the city — we shortlist three","Desert safari and Burj Khalifa tickets on request","Manager on the line during the trip"],"card_title":"Dubai · 5 nights","card_text":"City + desert safari, breakfast included, 4h flight.","season":"November","dates":"3 – 8 Nov"},"ru":{"meta":"ОАЭ · круглый год","title":"Дубай","text":"Четыре часа из Еревана, виза по прибытии и город, который одинаково хорош в январе и в октябре. Утром пляж, днём моллы, на закате — пустыня.","inc":["Прямой рейс из Еревана","Отель на пляже или в городе — подберём три варианта","Сафари в пустыне и билеты на Бурдж-Халифа по запросу","Менеджер на связи всю поездку"],"card_title":"Дубай · 5 ночей","card_text":"Город + сафари в пустыне, завтраки, 4 часа полёта.","season":"Ноябрь","dates":"3 – 8 ноя"},"hy":{"meta":"ԱՄԷ · ամբողջ տարին","title":"Դուբայ","text":"Չորս ժամ Երևանից, վիզա ժամանման պահին և քաղաք, որը հունվարին նույնքան լավն է, որքան հոկտեմբերին։ Առավոտյան՝ լողափ, ցերեկը՝ առևտրի կենտրոններ, մայրամուտին՝ անապատ։","inc":["Ուղիղ չվերթ Երևանից","Հյուրանոց լողափին կամ քաղաքում՝ կառաջարկենք երեք տարբերակ","Անապատային սաֆարի և Բուրջ Խալիֆայի տոմսեր ըստ պահանջի","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"],"card_title":"Դուբայ · 5 գիշեր","card_text":"Քաղաք + անապատային սաֆարի, նախաճաշ ներառված, 4 ժամ թռիչք։","season":"Նոյեմբեր","dates":"3 – 8 նոյ"}}'::jsonb) on conflict (slug) do nothing;
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('sharm', 0, true, 'p-sea', '{beach,family}', '{"en":{"meta":"Egypt · Oct–May","title":"Sharm El Sheikh","text":"Warm sea all winter, the best reef diving four hours from home, and hotels where nothing has to be decided after breakfast.","inc":["Direct flight from Yerevan","All-inclusive hotel by your budget","Transfer, insurance, visa on arrival","Manager on the line during the trip"],"card_title":"Sharm El Sheikh · 7 nights","card_text":"All-inclusive, reef hotel, direct flight from Yerevan.","season":"October","dates":"12 – 19 Oct"},"ru":{"meta":"Египет · окт–май","title":"Шарм-эль-Шейх","text":"Тёплое море всю зиму, лучший дайвинг на рифах в четырёх часах от дома и отели, где после завтрака ничего не нужно решать.","inc":["Прямой рейс из Еревана","Отель «всё включено» под ваш бюджет","Трансфер, страховка, виза по прибытии","Менеджер на связи всю поездку"],"card_title":"Шарм-эль-Шейх · 7 ночей","card_text":"Всё включено, отель у рифа, прямой рейс из Еревана.","season":"Октябрь","dates":"12 – 19 окт"},"hy":{"meta":"Եգիպտոս · հոկ–մայ","title":"Շարմ էլ Շեյխ","text":"Տաք ծով ամբողջ ձմեռ, լավագույն սուզումը խութերի մոտ՝ տնից չորս ժամ հեռու, և հյուրանոցներ, որտեղ նախաճաշից հետո ոչինչ որոշել պետք չէ։","inc":["Ուղիղ չվերթ Երևանից","«Ամեն ինչ ներառված» հյուրանոց ձեր բյուջեով","Տրանսֆեր, ապահովագրություն, վիզա ժամանման պահին","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"],"card_title":"Շարմ էլ Շեյխ · 7 գիշեր","card_text":"Ամեն ինչ ներառված, հյուրանոց խութի մոտ, ուղիղ չվերթ Երևանից։","season":"Հոկտեմբեր","dates":"12 – 19 հոկ"}}'::jsonb) on conflict (slug) do nothing;
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('maldives', 2, true, 'p-lagoon', '{beach}', '{"en":{"meta":"Islands · Nov–Apr","title":"Maldives","text":"One island, one hotel, one lagoon. We pick the island by what you want: house reef, quiet, kids club, or none of the above.","inc":["Flights with one comfortable connection","Water or beach villa — we explain the real difference","Seaplane or speedboat transfer","Manager on the line during the trip"],"card_title":"Maldives · 7 nights","card_text":"Water villa, half board, seaplane transfer.","season":"December","dates":"2 – 9 Dec"},"ru":{"meta":"Острова · ноя–апр","title":"Мальдивы","text":"Один остров, один отель, одна лагуна. Остров выбираем по тому, что вам нужно: домашний риф, тишина, детский клуб — или ничего из этого.","inc":["Перелёт с одной удобной пересадкой","Водная или пляжная вилла — объясним настоящую разницу","Трансфер гидросамолётом или катером","Менеджер на связи всю поездку"],"card_title":"Мальдивы · 7 ночей","card_text":"Водная вилла, полупансион, трансфер гидросамолётом.","season":"Декабрь","dates":"2 – 9 дек"},"hy":{"meta":"Կղզիներ · նոյ–ապր","title":"Մալդիվներ","text":"Մեկ կղզի, մեկ հյուրանոց, մեկ լագուն։ Կղզին ընտրում ենք ըստ ձեր ցանկության՝ տնային խութ, լռություն, մանկական ակումբ, կամ դրանցից ոչ մեկը։","inc":["Չվերթ մեկ հարմար փոխանցումով","Ջրային կամ լողափնյա վիլլա՝ կբացատրենք իրական տարբերությունը","Տրանսֆեր հիդրոինքնաթիռով կամ նավակով","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"],"card_title":"Մալդիվներ · 7 գիշեր","card_text":"Ջրային վիլլա, կիսապանսիոն, տրանսֆեր հիդրոինքնաթիռով։","season":"Դեկտեմբեր","dates":"2 – 9 դեկ"}}'::jsonb) on conflict (slug) do nothing;
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('bali', 100, false, 'p-jungle', '{nature,beach}', '{"en":{"meta":"Indonesia · Apr–Oct","title":"Bali","text":"Rice terraces, temples, surf and the calmest sea for kids on the south coast. We split the stay between two areas so you see both Balis.","inc":["Flights via Doha or Dubai","Two-area itinerary: Ubud + coast","Driver-guide for temple days","Manager on the line during the trip"]},"ru":{"meta":"Индонезия · апр–окт","title":"Бали","text":"Рисовые террасы, храмы, сёрфинг и самое спокойное море для детей на южном побережье. Делим отдых между двумя районами, чтобы увидеть оба Бали.","inc":["Перелёт через Доху или Дубай","Маршрут из двух частей: Убуд + побережье","Водитель-гид для дней с храмами","Менеджер на связи всю поездку"]},"hy":{"meta":"Ինդոնեզիա · ապր–հոկ","title":"Բալի","text":"Բրնձի դաշտեր, տաճարներ, սերֆինգ և երեխաների համար ամենահանգիստ ծովը հարավային ափին։ Հանգիստը բաժանում ենք երկու շրջանի միջև, որ երկու Բալին էլ տեսնեք։","inc":["Չվերթ Դոհայով կամ Դուբայով","Երկու շրջանի երթուղի՝ Ուբուդ + ափ","Վարորդ-ուղեկցող տաճարների օրերի համար","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"]}}'::jsonb) on conflict (slug) do nothing;
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('antalya', 101, false, 'p-ocean', '{beach,family}', '{"en":{"meta":"Türkiye · May–Oct","title":"Antalya","text":"The family default for a reason: short flight, all-inclusive done properly, and a coastline that fits any budget.","inc":["Direct charter from Yerevan","All-inclusive hotel with kids club","Transfer and insurance included","Manager on the line during the trip"]},"ru":{"meta":"Турция · май–окт","title":"Анталия","text":"Семейный выбор по умолчанию — не зря: короткий перелёт, правильное «всё включено» и побережье под любой бюджет.","inc":["Прямой чартер из Еревана","Отель «всё включено» с детским клубом","Трансфер и страховка включены","Менеджер на связи всю поездку"]},"hy":{"meta":"Թուրքիա · մայ–հոկ","title":"Անթալիա","text":"Ընտանեկան ընտրություն՝ ոչ պատահաբար. կարճ թռիչք, ճիշտ «ամեն ինչ ներառված» և ափ՝ ցանկացած բյուջեի համար։","inc":["Ուղիղ չարտեր Երևանից","«Ամեն ինչ ներառված» հյուրանոց մանկական ակումբով","Տրանսֆեր և ապահովագրություն ներառված","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"]}}'::jsonb) on conflict (slug) do nothing;
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('paris', 102, false, 'p-city', '{city}', '{"en":{"meta":"France · all seasons","title":"Paris","text":"A city break with the visa handled. We book the flights, a hotel in the right arrondissement, and tell you which museum to skip.","inc":["Schengen visa support","Flights and central hotel","Museum passes and day trips on request","Manager on the line during the trip"]},"ru":{"meta":"Франция · круглый год","title":"Париж","text":"Городская поездка с решённой визой. Бронируем перелёт, отель в правильном округе и подсказываем, какой музей пропустить.","inc":["Поддержка по шенгенской визе","Перелёт и отель в центре","Музейные абонементы и поездки на день по запросу","Менеджер на связи всю поездку"]},"hy":{"meta":"Ֆրանսիա · ամբողջ տարին","title":"Փարիզ","text":"Քաղաքային ուղևորություն՝ վիզան արդեն լուծված։ Ամրագրում ենք չվերթը, հյուրանոց ճիշտ թաղամասում և ասում, թե որ թանգարանը բաց թողնել։","inc":["Շենգենյան վիզայի աջակցություն","Չվերթ և հյուրանոց կենտրոնում","Թանգարանային տոմսեր և մեկօրյա ուղևորություններ ըստ պահանջի","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"]}}'::jsonb) on conflict (slug) do nothing;
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('phuket', 4, true, 'p-island', '{beach}', '{"en":{"meta":"Thailand · Nov–Apr","title":"Phuket","text":"Big island, many beaches. We match the beach to the traveller — lively Patong, quiet Kata, or a villa away from both.","inc":["Flights with one connection","Beach hotel or villa","Island day-trips by longtail or speedboat","Manager on the line during the trip"],"card_title":"Phuket · 9 nights","card_text":"Two beaches, island day-trip, breakfast.","season":"February","dates":"10 – 19 Feb"},"ru":{"meta":"Таиланд · ноя–апр","title":"Пхукет","text":"Большой остров, много пляжей. Подбираем пляж под путешественника: оживлённый Патонг, тихий Ката или вилла вдали от обоих.","inc":["Перелёт с одной пересадкой","Пляжный отель или вилла","Поездки на острова на лонгтейле или катере","Менеджер на связи всю поездку"],"card_title":"Пхукет · 9 ночей","card_text":"Два пляжа, поездка на острова, завтраки.","season":"Февраль","dates":"10 – 19 фев"},"hy":{"meta":"Թաիլանդ · նոյ–ապր","title":"Պուկետ","text":"Մեծ կղզի, շատ լողափեր։ Լողափն ընտրում ենք ըստ ճամփորդի՝ աշխույժ Պատոնգ, հանգիստ Կատա կամ վիլլա երկուսից էլ հեռու։","inc":["Չվերթ մեկ փոխանցումով","Լողափնյա հյուրանոց կամ վիլլա","Մեկօրյա ուղևորություններ կղզիներ նավակով","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"],"card_title":"Պուկետ · 9 գիշեր","card_text":"Երկու լողափ, մեկօրյա ուղևորություն կղզիներ, նախաճաշ։","season":"Փետրվար","dates":"10 – 19 փետ"}}'::jsonb) on conflict (slug) do nothing;
insert into public.tours (slug, sort, published, photo_class, tags, i18n) values ('georgia', 3, true, 'p-snow', '{nature,family}', '{"en":{"meta":"Georgia · Dec–Mar","title":"Gudauri","text":"Skiing five hours from Yerevan by car. Ski-in hotels, lift passes, instructors for first-timers, and khachapuri after.","inc":["Car transfer from Yerevan","Ski-in hotel and lift pass","Instructor and gear rental on request","Manager on the line during the trip"],"card_title":"Gudauri · 4 nights","card_text":"Ski-in hotel, lift pass, transfer from Yerevan by car.","season":"January","dates":"8 – 12 Jan"},"ru":{"meta":"Грузия · дек–мар","title":"Гудаури","text":"Лыжи в пяти часах от Еревана на машине. Отели у склона, ски-пассы, инструкторы для новичков и хачапури после.","inc":["Трансфер из Еревана на машине","Отель у склона и ски-пасс","Инструктор и прокат снаряжения по запросу","Менеджер на связи всю поездку"],"card_title":"Гудаури · 4 ночи","card_text":"Отель у склона, ски-пасс, трансфер из Еревана на машине.","season":"Январь","dates":"8 – 12 янв"},"hy":{"meta":"Վրաստան · դեկ–մար","title":"Գուդաուրի","text":"Դահուկներ՝ Երևանից հինգ ժամ մեքենայով։ Հյուրանոցներ լանջի մոտ, սքի-պասներ, հրահանգիչներ սկսնակների համար և խաչապուրի՝ հետո։","inc":["Տրանսֆեր Երևանից մեքենայով","Հյուրանոց լանջի մոտ և սքի-պաս","Հրահանգիչ և սարքավորումների վարձույթ ըստ պահանջի","Մենեջերը կապի մեջ է ամբողջ ուղևորության ընթացքում"],"card_title":"Գուդաուրի · 4 գիշեր","card_text":"Հյուրանոց լանջի մոտ, սքի-պաս, տրանսֆեր Երևանից մեքենայով։","season":"Հունվար","dates":"8 – 12 հուն"}}'::jsonb) on conflict (slug) do nothing;
