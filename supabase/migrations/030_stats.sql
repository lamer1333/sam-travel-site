-- ============================================================================
-- SAM TRAVEL — the panel's numbers are counted by the database  (migration 030, этап 3)
-- ============================================================================
-- Run AFTER 020_limits.sql. Safe to re-run. ТЗ: §5 (словарь метрик), §6, §4.6.
--
-- What it adds:
--   • lead_channel()   — THE definition of a lead's channel, for every report:
--                        hand-entered source → utm_source → referrer domain (own
--                        domain = direct) → direct
--   • work_minutes()   — minutes between two moments counted only inside the working
--                        hours from site_settings.hours; lead_response_minutes()
--   • stats_sales()    — every number of the owner's dashboard (§5)
--   • stats_traffic()  — now on lead_channel(), with the agency income ready
--                        (profit_total + estimated), old days read from events_daily
--   • stats_coupons()  — leads and sales per promo code, no names, no phones
--   • campaigns.currency — written by the server (the currency the spend was entered in)
--
-- The same formulas live in js/admin/metrics.js for the demo mode; a difference between
-- the two is a bug (supabase/test/30-stats.test.mjs compares them on 1500 leads).
--
-- Words (§5): all days are Yerevan days; spam takes part in nothing;
--   sale    = a lead in «won» with value > 0
--   owner   counts money by the SALE date (closed_at)      — «по дате продажи»
--   marketer counts it by the date the lead CAME (created_at) — «по заявкам периода»
-- ============================================================================

-- ============================================================================
-- channel
-- ============================================================================
-- "https://www.Google.com/search?q=…" → "google.com"; anything that is not a URL → null
create or replace function public.ref_host(p_url text)
returns text language sql immutable as $$
  select nullif(regexp_replace(lower(substring(coalesce(p_url, '') from '^https?://([^/?#:]+)')), '^www\.', ''), '');
$$;

-- the site's own address: a visitor who came from our own page came directly
create or replace function public.own_host(p_host text)
returns boolean language sql immutable as $$
  select coalesce(lower(p_host) ~ '^(([a-z0-9-]+\.)*samtravel\.am|localhost|127\.0\.0\.1)$', false);
$$;

-- One rule for leads and for site events (an event has no hand-entered source).
--   manual:phone | manual:walk_in | manual:instagram | manual:manual (= WhatsApp)
--   <utm_source>            as it came in the link
--   <referrer domain>       google.com, instagram.com …
--   direct
create or replace function public.channel_of(p_source text, p_utm_source text, p_host text)
returns text language sql immutable as $$
  select case
    when p_source in ('phone', 'walk_in', 'instagram', 'manual') then 'manual:' || p_source
    when nullif(p_utm_source, '') is not null then p_utm_source
    when nullif(p_host, '') is not null and not public.own_host(p_host)
      then regexp_replace(lower(p_host), '^www\.', '')
    else 'direct'
  end;
$$;

-- Takes the row, so the panel can also ask for it as a column: select=*,lead_channel
create or replace function public.lead_channel(l public.leads)
returns text language sql immutable as $$
  select public.channel_of(l.source, l.utm_source, public.ref_host(l.referrer));
$$;

-- ============================================================================
-- working hours
-- ============================================================================
-- site_settings.hours = {"days": [1..7, 7 = Sunday], "from": "10:00", "to": "19:00", "sla_min": 60}
-- A missing key falls back to Mon–Sat 10:00–19:00, 60 minutes. Hours that cannot be read
-- come back as null days — work_minutes() then counts plain clock minutes.
create or replace function public.site_hours(out days int[], out opens time, out closes time, out sla_min numeric)
language plpgsql stable security definer set search_path = public as $$
declare h jsonb;
begin
  select value into h from public.site_settings where key = 'hours';
  h := coalesce(h, '{}'::jsonb);
  sla_min := case when (h ->> 'sla_min') ~ '^\d+(\.\d+)?$' and (h ->> 'sla_min')::numeric > 0
                  then (h ->> 'sla_min')::numeric else 60 end;
  begin
    days := case when h ? 'days'
                 then array(select jsonb_array_elements_text(h -> 'days')::int)
                 else array[1, 2, 3, 4, 5, 6] end;
    opens  := coalesce(nullif(h ->> 'from', ''), '10:00')::time;
    closes := coalesce(nullif(h ->> 'to', ''), '19:00')::time;
  exception when others then
    days := null; opens := null; closes := null;
  end;
end; $$;

-- Minutes of working time between two moments. A request at 23:00 answered at 10:05
-- with the office opening at 10:00 is 5 minutes. Yerevan has no summer time, so the
-- arithmetic on local timestamps is exact.
create or replace function public.work_minutes(p_from timestamptz, p_to timestamptz,
                                               p_days int[], p_open time, p_close time)
returns numeric language sql stable as $$
  select case
    when p_from is null or p_to is null then null
    when p_to <= p_from then 0
    when p_days is null or cardinality(p_days) = 0 or p_open is null or p_close is null or p_close <= p_open
      then extract(epoch from (p_to - p_from)) / 60
    else (
      select coalesce(sum(extract(epoch from (least(x.b, g.d + p_close) - greatest(x.a, g.d + p_open)))), 0) / 60
      from (select p_from at time zone 'Asia/Yerevan' as a, p_to at time zone 'Asia/Yerevan' as b) x
      cross join lateral (select s::date as d
                          from generate_series(x.a::date::timestamp, x.b::date::timestamp, interval '1 day') s) g
      where extract(isodow from g.d)::int = any (p_days)
        and least(x.b, g.d + p_close) > greatest(x.a, g.d + p_open))
  end;
$$;

create or replace function public.work_minutes(p_from timestamptz, p_to timestamptz)
returns numeric language sql stable set search_path = public as $$
  select public.work_minutes(p_from, p_to, h.days, h.opens, h.closes) from public.site_hours() h;
$$;

-- First answer of a lead, in working minutes. Only requests from the site have one:
-- a call or a visit the manager typed in was answered on the spot (решение 19).
create or replace function public.lead_response_minutes(l public.leads)
returns numeric language sql stable set search_path = public as $$
  select case when l.source not in ('phone', 'walk_in', 'instagram', 'manual') and l.first_response_at is not null
              then public.work_minutes(l.created_at, l.first_response_at) end;
$$;

-- ============================================================================
-- money helpers
-- ============================================================================
-- the margin from «Контакты и реквизиты», or null when the owner has not set one —
-- then a sale without an entered income adds nothing to the estimate (no made-up 12 %)
create or replace function public.company_margin()
returns numeric language sql stable security definer set search_path = public as $$
  select case when (value ->> 'margin_pct') ~ '^\d+(\.\d+)?$' then (value ->> 'margin_pct')::numeric end
  from public.site_settings where key = 'company';
$$;

-- §4.6: spend and revenue must be in one currency. The server writes the currency of a
-- campaign itself: the company currency of the moment the spend was typed in. If the owner
-- later changes the panel currency, old spends are NOT converted — the panel shows a warning
-- for every campaign whose currency differs, until its spend is entered again.
create or replace function public.campaigns_currency()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.spend is distinct from old.spend then
    new.currency := public.company_currency();
  else
    new.currency := old.currency;
  end if;
  return new;
end; $$;

drop trigger if exists campaigns_currency on public.campaigns;
create trigger campaigns_currency before insert or update on public.campaigns
  for each row execute function public.campaigns_currency();

create index if not exists leads_coupon_idx on public.leads (upper(coupon_code)) where coupon_code is not null;

-- ============================================================================
-- stats_sales: the owner's dashboard
-- ============================================================================
-- Everything from §5 that is about leads and money, for [p_from, p_to):
--   kpi           leads, sales, revenue, profit (+ how much of it is an estimate), average
--                 check, conversion, first answer, share inside the norm, visits → lead,
--                 the pipeline right now and the forecast
--   daily         per Yerevan day: leads that CAME that day by outcome, and the sales,
--                 revenue and income REGISTERED that day
--   managers      who took, sold and how fast they answer
--   lost_reasons  refusals closed in the period
--   channels      leads of the period by lead_channel() and how many of them bought
-- No names of clients, no phones: the marketer may call it too (§2).
create or replace function public.stats_sales(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  h        record;
  v_margin numeric;
  v_visits bigint;
  r        jsonb;
begin
  if not public.is_team() then raise exception 'forbidden'; end if;
  select * into h from public.site_hours();
  v_margin := public.company_margin();
  v_visits := public.stats_visits(p_from, p_to);

  with ld as materialized (
    select l.id, l.status, l.value, l.profit, l.assigned_to, l.lost_reason,
           (l.created_at at time zone 'Asia/Yerevan')::date as cd,
           (l.closed_at  at time zone 'Asia/Yerevan')::date as kd,
           (l.created_at >= p_from and l.created_at < p_to) as c_in,                               -- came in the period
           (l.status in ('won', 'lost') and l.closed_at >= p_from and l.closed_at < p_to) as k_in,  -- closed in the period
           (l.status = 'won' and coalesce(l.value > 0, false)) as sale,
           case when l.status = 'won' and l.value > 0 then coalesce(l.profit, l.value * v_margin / 100, 0) end as gain,
           public.lead_channel(l) as channel,
           case when l.created_at >= p_from and l.created_at < p_to
                 and l.source not in ('phone', 'walk_in', 'instagram', 'manual') and l.first_response_at is not null
                then public.work_minutes(l.created_at, l.first_response_at, h.days, h.opens, h.closes) end as resp
    from public.leads l
    where l.status <> 'spam'
      and ((l.created_at >= p_from and l.created_at < p_to)
        or (l.closed_at >= p_from and l.closed_at < p_to)
        or l.status in ('new', 'contacted', 'quoted'))
  ), k as (
    select count(*) filter (where c_in)                                   as leads,
           count(*) filter (where k_in and sale)                          as sales,
           count(*) filter (where k_in and status = 'lost')               as lost,
           count(*) filter (where k_in and status = 'won' and not sale)   as no_amount,
           coalesce(sum(value) filter (where k_in and sale), 0)           as revenue,
           coalesce(sum(gain)  filter (where k_in and sale), 0)           as gain_total,
           coalesce(sum(profit) filter (where k_in and sale), 0)          as gain_entered,
           count(*) filter (where k_in and sale and profit is null)       as est,
           percentile_cont(0.5) within group (order by resp)              as resp_median,
           count(resp)                                                    as resp_n,
           count(*) filter (where resp <= h.sla_min)                      as resp_ok,
           count(*) filter (where status = 'new')                         as n_new,
           count(*) filter (where status = 'contacted')                   as n_contacted,
           count(*) filter (where status = 'quoted')                      as n_quoted,
           coalesce(sum(value) filter (where status = 'quoted'), 0)       as quoted_value
    from ld
  )
  select jsonb_build_object(
    'currency',   public.company_currency(),
    'margin_pct', v_margin,
    'sla_min',    h.sla_min,
    'kpi', (select jsonb_build_object(
        'leads', k.leads,
        'sales', k.sales,
        'lost',  k.lost,
        'revenue', k.revenue,
        'profit',  round(k.gain_total, 2),
        'profit_entered', k.gain_entered,
        'sales_estimated', k.est,               -- sales whose income is value × margin
        'estimated', k.est > 0,
        'sales_no_amount', k.no_amount,         -- «won» without an amount: not a sale, not in revenue
        'no_amount_lead', (select id from ld where k_in and status = 'won' and not sale order by kd, id limit 1),
        'avg_check',  case when k.sales > 0 then round(k.revenue / k.sales, 2) end,
        'conversion', case when k.sales + k.lost > 0 then k.sales::numeric / (k.sales + k.lost) end,
        'visits', v_visits,
        'visit_to_lead', case when v_visits > 0 then k.leads::numeric / v_visits end,
        'resp_median_min', k.resp_median,
        'resp_n', k.resp_n,
        'within_sla', case when k.resp_n > 0 then k.resp_ok::numeric / k.resp_n end,
        'open', jsonb_build_object('new', k.n_new, 'contacted', k.n_contacted, 'quoted', k.n_quoted),
        'quoted_value', k.quoted_value,
        'forecast', case when k.sales + k.lost > 0 then round(k.quoted_value * k.sales / (k.sales + k.lost), 2) end,
        'sales_ever', exists (select 1 from public.leads where status = 'won' and value > 0))
      from k),
    'daily', coalesce((select jsonb_agg(x order by x.d) from (
        select g.d::date as d,
               coalesce(c.leads, 0) as leads, coalesce(c.won, 0) as won, coalesce(c.lost, 0) as lost, coalesce(c.in_work, 0) as in_work,
               coalesce(s.sales, 0) as sales, coalesce(s.revenue, 0) as revenue, coalesce(s.profit, 0) as profit
        from generate_series((p_from at time zone 'Asia/Yerevan')::date,
                             ((p_to at time zone 'Asia/Yerevan') - interval '1 second')::date, interval '1 day') g(d)
        left join (select cd as d, count(*) as leads, count(*) filter (where sale) as won,
                          count(*) filter (where status = 'lost') as lost,
                          count(*) filter (where not sale and status <> 'lost') as in_work
                   from ld where c_in group by 1) c on c.d = g.d::date
        left join (select kd as d, count(*) as sales, sum(value) as revenue, round(sum(gain), 2) as profit
                   from ld where k_in and sale group by 1) s on s.d = g.d::date
      ) x), '[]'::jsonb),
    'managers', coalesce((select jsonb_agg(x order by x.revenue desc, x.leads desc) from (
        select m.assigned_to as id,
               coalesce(nullif(btrim(p.full_name), ''), u.email::text) as name,
               count(*) filter (where m.c_in) as leads,
               count(*) filter (where m.k_in and m.sale) as sales,
               count(*) filter (where m.k_in and m.status = 'lost') as lost,
               case when count(*) filter (where m.k_in and (m.sale or m.status = 'lost')) > 0
                    then (count(*) filter (where m.k_in and m.sale))::numeric
                         / count(*) filter (where m.k_in and (m.sale or m.status = 'lost')) end as conversion,
               coalesce(sum(m.value) filter (where m.k_in and m.sale), 0) as revenue,
               round(coalesce(sum(m.gain) filter (where m.k_in and m.sale), 0), 2) as profit,
               percentile_cont(0.5) within group (order by m.resp) as resp_median_min
        from ld m
        left join public.profiles p on p.id = m.assigned_to
        left join auth.users u on u.id = m.assigned_to
        where m.assigned_to is not null and (m.c_in or m.k_in)
        group by 1, 2
      ) x), '[]'::jsonb),
    'lost_reasons', coalesce((select jsonb_agg(x order by x.n desc, x.reason) from (
        select coalesce(nullif(btrim(lost_reason), ''), '') as reason, count(*) as n
        from ld where k_in and status = 'lost' group by 1) x), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(x order by x.leads desc, x.channel) from (
        select channel, count(*) as leads, count(*) filter (where sale) as won,
               coalesce(sum(value) filter (where sale), 0) as revenue
        from ld where c_in group by 1) x), '[]'::jsonb)
  ) into r;
  return r;
end; $$;

-- ============================================================================
-- visits: raw events while they are kept, the daily roll-up for older days
-- ============================================================================
-- Raw events live 13 months (020_limits.sql); a day whose raw events are gone is read
-- from events_daily. events_raw_from() = the first moment still covered by raw events: the
-- deletion is aligned to Yerevan days, so everything from that midnight on is complete.
create or replace function public.events_raw_from()
returns timestamptz language sql stable security definer set search_path = public as $$
  select (date_trunc('day', min(ts) at time zone 'Asia/Yerevan')) at time zone 'Asia/Yerevan' from public.events;
$$;

-- Посещение = событие page_view (§5)
create or replace function public.stats_visits(p_from timestamptz, p_to timestamptz)
returns bigint language sql stable security definer set search_path = public as $$
  with b as (select coalesce(public.events_raw_from(), 'infinity') as raw_from)
  select (select count(*) from public.events, b
          where name = 'page_view' and ts >= greatest(p_from, b.raw_from) and ts < p_to)
       + (select coalesce(sum(d.events), 0)::bigint from public.events_daily d, b
          where d.name = 'page_view'
            and d.day >= (p_from at time zone 'Asia/Yerevan')::date
            and d.day <  (b.raw_from at time zone 'Asia/Yerevan')::date
            and d.day <= ((p_to - interval '1 microsecond') at time zone 'Asia/Yerevan')::date);
$$;

-- ============================================================================
-- stats_traffic: the marketer's numbers
-- ============================================================================
-- Replaces the function from 002. What changed:
--   • leads AND events get their channel from channel_of(), so a phone call no longer
--     lands in «direct» and inflates its conversion
--   • a sale = «won» with an amount; revenue is by the leads that CAME in the period
--   • sources and campaigns carry profit_total (entered income + value × margin for the
--     sales without one) and estimated (true when a part of it is such an estimate)
--   • days whose raw events are gone are read from events_daily; raw_from tells the
--     panel from which day the details (funnel, sections, hours, promos) exist
create or replace function public.stats_traffic(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r        jsonb;
  v_margin numeric := public.company_margin();
  v_raw    timestamptz;     -- raw events are read from here
  v_d1     date;            -- roll-up days: [v_d1, v_d2)
  v_d2     date;
begin
  if not public.is_team() then raise exception 'forbidden'; end if;
  v_raw := coalesce(public.events_raw_from(), 'infinity');
  v_d1  := (p_from at time zone 'Asia/Yerevan')::date;
  v_d2  := least((v_raw at time zone 'Asia/Yerevan')::date,
                 ((p_to - interval '1 microsecond') at time zone 'Asia/Yerevan')::date + 1);
  if v_d2 < v_d1 then v_d2 := v_d1; end if;
  v_raw := greatest(v_raw, p_from);

  with ev as materialized (
    select name, sid, section, tour, promo_id, device, lang, utm_campaign,
           (ts at time zone 'Asia/Yerevan') as lt,
           public.channel_of(null, utm_source, ref_host) as src
    from public.events where ts >= v_raw and ts < p_to
  ), cnt as materialized (
    -- counts that survive the roll-up: by day, event, channel, campaign, tour, device, language
    select name, lt::date as d, src, utm_campaign, tour, device, lang, 1::bigint as n from ev
    union all
    select name, day, public.channel_of(null, null, source), campaign, tour, device, lang, events
    from public.events_daily where day >= v_d1 and day < v_d2
  ), ld as materialized (
    select l.tour, l.utm_campaign, l.value, l.profit,
           (l.created_at at time zone 'Asia/Yerevan') as lt,
           public.lead_channel(l) as src,
           (l.status = 'won' and coalesce(l.value > 0, false)) as sale
    from public.leads l where l.created_at >= p_from and l.created_at < p_to and l.status <> 'spam'
  ), money as (
    -- by channel and by campaign in one pass; g = 's' | 'c'
    select 's' as g, src as k, count(*) as leads, count(*) filter (where sale) as won,
           coalesce(sum(value) filter (where sale), 0) as revenue,
           coalesce(sum(profit) filter (where sale), 0) as profit,
           coalesce(sum(value) filter (where sale and profit is null), 0) as revenue_est,
           count(*) filter (where sale and profit is null) > 0 as estimated
    from ld group by src
    union all
    select 'c', utm_campaign, count(*), count(*) filter (where sale),
           coalesce(sum(value) filter (where sale), 0),
           coalesce(sum(profit) filter (where sale), 0),
           coalesce(sum(value) filter (where sale and profit is null), 0),
           count(*) filter (where sale and profit is null) > 0
    from ld where utm_campaign is not null group by utm_campaign
  )
  select jsonb_build_object(
    'margin_pct', v_margin,
    'raw_from', case when exists (select 1 from public.events_daily where day >= v_d1 and day < v_d2) then v_d2 end,
    'daily', coalesce((select jsonb_agg(x order by x.d) from (
        select g.d::date as d, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts, coalesce(l.leads, 0) as leads
        from generate_series((p_from at time zone 'Asia/Yerevan')::date,
                             ((p_to at time zone 'Asia/Yerevan') - interval '1 second')::date, interval '1 day') g(d)
        left join (select d, coalesce(sum(n) filter (where name = 'page_view'), 0) as visits,
                          coalesce(sum(n) filter (where name in ('wa_click', 'tel_click')), 0) as contacts
                   from cnt group by 1) v on v.d = g.d::date
        left join (select lt::date as d, count(*) as leads from ld group by 1) l on l.d = g.d::date
      ) x), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(x order by x.visits desc, x.leads desc, x.src) from (
        select s.src, coalesce(v.visits, 0) as visits, coalesce(m.leads, 0) as leads, coalesce(m.won, 0) as won,
               coalesce(m.revenue, 0) as revenue,
               round(coalesce(m.profit + m.revenue_est * coalesce(v_margin, 0) / 100, 0), 2) as profit_total,
               coalesce(m.estimated, false) as estimated
        from (select src from cnt where name = 'page_view' union select src from ld) s
        left join (select src, sum(n) as visits from cnt where name = 'page_view' group by src) v using (src)
        left join money m on m.g = 's' and m.k = s.src
      ) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by x.campaign) from (
        select c.k as campaign, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts,
               coalesce(m.leads, 0) as leads, coalesce(m.won, 0) as won, coalesce(m.revenue, 0) as revenue,
               coalesce(m.profit, 0) as profit,                 -- entered by managers
               coalesce(m.revenue_est, 0) as revenue_est,       -- revenue of the sales without an entered income
               round(coalesce(m.profit + m.revenue_est * coalesce(v_margin, 0) / 100, 0), 2) as profit_total,
               coalesce(m.estimated, false) as estimated
        from (select utm_campaign as k from cnt where utm_campaign is not null
              union select utm_campaign from ld where utm_campaign is not null) c
        left join (select utm_campaign as k, coalesce(sum(n) filter (where name = 'page_view'), 0) as visits,
                          coalesce(sum(n) filter (where name in ('wa_click', 'tel_click')), 0) as contacts
                   from cnt group by 1) v using (k)
        left join money m on m.g = 'c' and m.k = c.k
      ) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_object_agg(k, n) from (select coalesce(device, '?') k, sum(n) n from cnt where name = 'page_view' group by 1) x), '{}'::jsonb),
    'langs',   coalesce((select jsonb_object_agg(k, n) from (select coalesce(lang, '?') k, sum(n) n from cnt where name = 'page_view' group by 1) x), '{}'::jsonb),
    'sections', coalesce((select jsonb_object_agg(section, n) from (select section, count(distinct sid) n from ev where name = 'section_view' and section is not null group by 1) x), '{}'::jsonb),
    'ctas',    coalesce((select jsonb_object_agg(name, n) from (select name, sum(n) n from cnt where name not in ('page_view', 'section_view') group by 1) x), '{}'::jsonb),
    'tours',   coalesce((select jsonb_agg(x order by x.opens desc, x.tour) from (
        select t.tour, coalesce(o.opens, 0) opens, coalesce(l.leads, 0) leads
        from (select tour from cnt where tour is not null union select tour from ld where tour is not null) t
        left join (select tour, sum(n) opens from cnt where name = 'tour_open' group by 1) o using (tour)
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
        'visits',  (select coalesce(sum(n), 0) from cnt where name = 'page_view'),
        -- the next three need single visits, so they exist only while raw events do
        'visits_detailed', (select count(*) from ev where name = 'page_view'),
        'engaged', (select count(distinct sid) from ev where name = 'section_view' and section not in ('band-prices')),
        'intent',  (select count(distinct sid) from ev where name in ('tour_open', 'plan_open', 'checklist_open', 'form_start', 'wa_click', 'tel_click')),
        'contact', (select count(distinct sid) from ev where name in ('wa_click', 'tel_click', 'plan_send', 'lead_submit')),
        'leads',   (select count(*) from ld),
        'won',     (select count(*) from ld where sale))
  ) into r;
  return r;
end; $$;

-- ============================================================================
-- stats_coupons: «В заявках» for the marketer
-- ============================================================================
-- Per promo code: how many leads came with it and how many of them bought. Numbers
-- only — the marketer has no access to leads (§4.5).
create or replace function public.stats_coupons()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', c.code, 'leads', coalesce(n.leads, 0), 'sales', coalesce(n.sales, 0)) order by c.code)
    from public.coupons c
    left join (select upper(coupon_code) as code, count(*) as leads,
                      count(*) filter (where status = 'won' and value > 0) as sales
               from public.leads where coupon_code is not null and status <> 'spam' group by 1) n
      on n.code = upper(c.code)), '[]'::jsonb);
end; $$;

-- ---------- grants ----------------------------------------------------------
-- The stats_* check the role themselves; a visitor cannot even call them.
revoke all on function public.stats_sales(timestamptz, timestamptz)   from public, anon;
revoke all on function public.stats_traffic(timestamptz, timestamptz) from public, anon;
revoke all on function public.stats_coupons()                         from public, anon;
grant execute on function public.stats_sales(timestamptz, timestamptz)   to authenticated;
grant execute on function public.stats_traffic(timestamptz, timestamptz) to authenticated;
grant execute on function public.stats_coupons()                         to authenticated;
-- internal: they read settings and event tables past RLS
revoke all on function public.company_margin()                       from public, anon, authenticated;
revoke all on function public.events_raw_from()                      from public, anon, authenticated;
revoke all on function public.stats_visits(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.site_hours()                           from public, anon;
grant execute on function public.site_hours() to authenticated;   -- lead_response_minutes() as a column for staff
