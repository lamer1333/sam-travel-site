-- ============================================================================
-- SAM TRAVEL — всё через WhatsApp  (миграция 070, этап 7)
-- ============================================================================
-- Запускать ПОСЛЕ 050_notify.sql.
-- Только весь набор по порядку: после повторного запуска этого файла отдельно нужно снова
-- накатить все следующие — сам по себе он возвращает то, что они закрыли (AUDIT.md, D6).
-- ТЗ: §0 п.20–22 и §4.11 (заменяет §4.2, §4.3 и часть §4.9).
--
-- Формы заявки на сайте нет: клиент пишет в WhatsApp сам, в панель попадают только
-- продажи, внесённые вручную. Что меняется в базе:
--   • events.ref        — номер обращения у события wa_click (5 знаков, производная от
--                         sid визита; сайт дописывает его в конец сообщения WhatsApp)
--   • track()           — принимает ref
--   • wa_ref(code)      — владельцу и менеджеру: что сайт знает о визите с таким номером
--   • leads.ref         — номер обращения у продажи; по нему база сама подставляет
--                         рекламные метки, тур, язык, устройство и промокод с баннера
--   • lead_channel()    — продажа с номером обращения относится к каналу визита
--   • submit_lead()     — отозвана у гостей (функция и лимиты остаются в базе)
--   • письмо о заявке   — расписание повтора снято; вебхук не создаётся (этап 6)
--   • stats_sales(), stats_traffic() — новые цифры: посещения → обращения → продажи
--
-- Слова (§4.11, правки к §5): все сутки — по Еревану;
--   обращение = событие wa_click или tel_click
--   продажа   = запись журнала в статусе won с суммой > 0, по дате продажи (closed_at)
--   возврат   = запись журнала в статусе lost, по дате возврата (closed_at)
--   конверсия в продажу = продажи ÷ обращения за период
-- Те же формулы — в js/admin/metrics.js для демо-режима; расхождение = ошибка
-- (supabase/test/70-whatsapp.test.mjs сверяет их).
-- ============================================================================

-- ============================================================================
-- номер обращения
-- ============================================================================
-- Алфавит без похожих знаков: нет 0 и O, 1, I и L. Тот же — в js/track.js (refOf).
alter table public.events add column if not exists ref text;
create index if not exists events_ref_idx on public.events (ref, ts desc) where ref is not null;

-- Номер переписывают из чата руками: регистр, «№», пробелы и русская раскладка
-- (К7М2Х вместо K7M2X) не должны мешать.
create or replace function public.ref_norm(p_code text)
returns text language sql immutable as $$
  select nullif(regexp_replace(translate(upper(coalesce(p_code, '')), 'АВЕКМНРСТУХ', 'ABEKMHPCTYX'), '[^0-9A-Z]', '', 'g'), '');
$$;

create or replace function public.ref_ok(p_code text)
returns boolean language sql immutable as $$
  select coalesce(p_code ~ '^[2-9A-HJKMNP-Z]{5}$', false);
$$;

-- ============================================================================
-- track: + ref у wa_click
-- ============================================================================
-- Та же функция, что в 020_limits.sql (формат sid, 200 событий на sid, 600 в минуту),
-- плюс поле ref. Номер принимается только у wa_click и только правильного вида.
create or replace function public.track(p_events jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_room integer;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 30 then return; end if;

  select 600 - count(*) into v_room from public.events where ts > now() - interval '1 minute';
  if v_room <= 0 then return; end if;

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
                             utm_source, utm_medium, utm_campaign, utm_content, ref)
  select e ->> 'sid', e ->> 'name',
         nullif(left(e ->> 'section', 40), ''), nullif(left(e ->> 'tour', 40), ''),
         case when (e ->> 'promo_id') ~ '^[0-9a-f-]{36}$' then (e ->> 'promo_id')::uuid end,
         nullif(left(e ->> 'label', 80), ''), nullif(left(e ->> 'lang', 5), ''), nullif(left(e ->> 'device', 10), ''),
         nullif(left(e ->> 'ref_host', 100), ''),
         nullif(left(e ->> 'utm_source', 100), ''), nullif(left(e ->> 'utm_medium', 100), ''),
         nullif(left(e ->> 'utm_campaign', 100), ''), nullif(left(e ->> 'utm_content', 100), ''),
         case when e ->> 'name' = 'wa_click' and public.ref_ok(e ->> 'ref') then e ->> 'ref' end
  from fits
  where pos <= v_room
  order by pos;
end; $$;

-- ============================================================================
-- wa_ref: что сайт знает о визите с таким номером
-- ============================================================================
-- Последнее за 90 дней событие wa_click с этим номером: метки рекламы, язык, устройство,
-- время, где нажали. Тур и промокод с баннера — из последнего клика, где они были: человек
-- мог нажать «Написать про Дубай», а потом ещё и общую кнопку. Нет такого номера → null.
create or replace function public.wa_ref_lookup(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (
    select e.* from public.events e
    where e.ref = public.ref_norm(p_code) and e.name = 'wa_click' and e.ts > now() - interval '90 days'
  )
  select jsonb_build_object(
    'ref', e.ref, 'ts', e.ts, 'label', e.label, 'lang', e.lang, 'device', e.device,
    'utm_source', e.utm_source, 'utm_medium', e.utm_medium, 'utm_campaign', e.utm_campaign, 'utm_content', e.utm_content,
    'ref_host', e.ref_host,
    'channel', public.channel_of(null, e.utm_source, e.ref_host),
    'tour', (select c.tour from c where c.tour is not null order by c.ts desc, c.id desc limit 1),
    'coupon_code', (select p.coupon_code from c join public.promos p on p.id = c.promo_id
                    where p.coupon_code is not null order by c.ts desc, c.id desc limit 1),
    'clicks', (select count(*) from c))
  from c e order by e.ts desc, e.id desc limit 1;
$$;

create or replace function public.wa_ref(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if not public.ref_ok(public.ref_norm(p_code)) then return null; end if;
  return public.wa_ref_lookup(p_code);
end; $$;

-- ============================================================================
-- продажа с номером обращения
-- ============================================================================
alter table public.leads add column if not exists ref text;
create index if not exists leads_ref_idx on public.leads (ref) where ref is not null;

-- Правило живёт в базе: откуда пришла продажа с номером, решает не тот, кто её вносит,
-- а событие wa_click. Срабатывает на вставку и на смену номера; пока номер не трогают,
-- записанные метки остаются как есть (и через 90 дней, когда события уже не найти).
--   номер найден    → источник WhatsApp, метки рекламы, язык и устройство — из визита;
--                     тур и промокод — из визита, если их не вписали руками
--   номер не найден → ошибка ref_not_found: продажу без номера вносят с источником
--   номер убрали    → метки визита снимаются
create or replace function public.leads_attribution()
returns trigger language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  new.ref := public.ref_norm(new.ref);
  if tg_op = 'UPDATE' and new.ref is not distinct from old.ref then return new; end if;
  if new.ref is null then
    if tg_op = 'UPDATE' then
      new.utm_source := null; new.utm_medium := null; new.utm_campaign := null; new.utm_content := null; new.utm_term := null;
      new.referrer := null;
      new.details := coalesce(new.details, '{}'::jsonb) - 'ref_at' - 'ref_label';
    end if;
    return new;
  end if;
  if not public.ref_ok(new.ref) then raise exception 'ref_invalid'; end if;
  e := public.wa_ref_lookup(new.ref);
  if e is null then raise exception 'ref_not_found'; end if;
  new.source       := 'manual';                       -- клиент написал в WhatsApp
  new.utm_source   := e ->> 'utm_source';
  new.utm_medium   := e ->> 'utm_medium';
  new.utm_campaign := e ->> 'utm_campaign';
  new.utm_content  := e ->> 'utm_content';
  new.utm_term     := null;
  new.referrer     := case when e ->> 'ref_host' is not null then 'https://' || (e ->> 'ref_host') || '/' end;
  new.lang         := coalesce(e ->> 'lang', new.lang);
  new.device       := e ->> 'device';
  new.tour         := coalesce(nullif(btrim(new.tour), ''), e ->> 'tour');
  new.coupon_code  := coalesce(nullif(btrim(new.coupon_code), ''), e ->> 'coupon_code');
  new.details      := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('ref_at', e -> 'ts', 'ref_label', e ->> 'label');
  return new;
end; $$;

-- имя раньше leads_guard по алфавиту: сторож продаж видит уже подставленный источник
drop trigger if exists leads_attribution on public.leads;
create trigger leads_attribution before insert or update on public.leads
  for each row execute function public.leads_attribution();

-- Канал продажи. С номером обращения — канал визита (метка → домен перехода → прямой
-- заход); без номера — то, что выбрал владелец: WhatsApp, звонок, визит, Instagram.
create or replace function public.lead_channel(l public.leads)
returns text language sql immutable as $$
  select public.channel_of(case when l.ref is null then l.source end, l.utm_source, public.ref_host(l.referrer));
$$;

-- ============================================================================
-- формы нет: submit_lead закрыта для гостей, письмо о заявке выключено
-- ============================================================================
-- Функция, лимиты и notify_log остаются на случай возврата формы — вернуть её можно
-- одной строкой `grant execute … to anon`.
revoke all on function public.submit_lead(jsonb) from public, anon;

-- Повтор писем (050_notify.sql) больше не нужен: заявок с сайта нет. Вебхук на leads
-- в этапе 6 не создаётся.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lead-mail-retry';
  end if;
end $$;

-- ============================================================================
-- события периода: сырые, пока хранятся, и свёртка для старых дней
-- ============================================================================
-- Счётчики, которые переживают свёртку: день × событие × канал × кампания × тур ×
-- устройство × язык. Этим пользуются обе функции отчётов ниже.
create or replace function public.stats_events(p_from timestamptz, p_to timestamptz)
returns table (name text, d date, src text, campaign text, tour text, device text, lang text, n bigint)
language sql stable security definer set search_path = public as $$
  with b as (select coalesce(public.events_raw_from(), 'infinity'::timestamptz) as raw_from)
  select e.name, (e.ts at time zone 'Asia/Yerevan')::date, public.channel_of(null, e.utm_source, e.ref_host),
         e.utm_campaign, e.tour, e.device, e.lang, count(*)
  from public.events e, b
  where e.ts >= greatest(p_from, b.raw_from) and e.ts < p_to
  group by 1, 2, 3, 4, 5, 6, 7
  union all
  select x.name, x.day, public.channel_of(null, null, x.source), x.campaign, x.tour, x.device, x.lang, x.events
  from public.events_daily x, b
  where x.day >= (p_from at time zone 'Asia/Yerevan')::date
    and x.day <  (b.raw_from at time zone 'Asia/Yerevan')::date
    and x.day <= ((p_to - interval '1 microsecond') at time zone 'Asia/Yerevan')::date;
$$;

-- ============================================================================
-- stats_sales: сводка владельца
-- ============================================================================
-- Заменяет функцию из 030. За период [p_from, p_to):
--   kpi            посещения, обращения (WhatsApp + телефон), продажи, возвраты, выручка,
--                  доход (+ сколько в нём оценки по марже), средний чек, конверсия
--   daily          по суткам Еревана: посещения, обращения, продажи, выручка, доход, возвраты
--   managers       кто продал
--   refund_reasons причины возвратов
--   channels       посещения, обращения и продажи по каналам
--   tours          открытия описания → клики в WhatsApp по туру → продажи по туру
--   contact_heat   в какие часы пишут и звонят (пока хранятся сырые события)
-- Без имён и телефонов: маркетолог тоже может её вызвать (§2).
create or replace function public.stats_sales(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_margin numeric := public.company_margin();
  r        jsonb;
begin
  if not public.is_team() then raise exception 'forbidden'; end if;

  with ev as materialized (
    select * from public.stats_events(p_from, p_to) where name in ('page_view', 'wa_click', 'tel_click', 'tour_open')
  ), sl as materialized (
    select l.id, l.status, l.value, l.profit, l.assigned_to, l.lost_reason, l.tour, l.ref,
           (l.closed_at at time zone 'Asia/Yerevan')::date as kd,
           (l.status = 'won' and coalesce(l.value > 0, false)) as sale,
           case when l.status = 'won' and l.value > 0 then coalesce(l.profit, l.value * v_margin / 100, 0) end as gain,
           public.lead_channel(l) as channel
    from public.leads l
    where l.status in ('won', 'lost') and l.closed_at >= p_from and l.closed_at < p_to
  ), k as (
    select count(*) filter (where sale)                           as sales,
           count(*) filter (where status = 'lost')                as refunds,
           coalesce(sum(value)  filter (where sale), 0)           as revenue,
           coalesce(sum(gain)   filter (where sale), 0)           as gain_total,
           coalesce(sum(profit) filter (where sale), 0)           as gain_entered,
           count(*) filter (where sale and profit is null)        as est,
           count(*) filter (where sale and ref is not null)       as sales_ref
    from sl
  ), e as (
    select coalesce(sum(n) filter (where name = 'page_view'), 0)::bigint as visits,
           coalesce(sum(n) filter (where name = 'wa_click'), 0)::bigint  as wa,
           coalesce(sum(n) filter (where name = 'tel_click'), 0)::bigint as tel
    from ev
  )
  select jsonb_build_object(
    'currency',   public.company_currency(),
    'margin_pct', v_margin,
    'kpi', (select jsonb_build_object(
        'visits', e.visits,
        'contacts', e.wa + e.tel,
        'wa_clicks', e.wa,
        'tel_clicks', e.tel,
        'sales', k.sales,
        'sales_ref', k.sales_ref,                -- из них с номером обращения
        'refunds', k.refunds,
        'revenue', k.revenue,
        'profit',  round(k.gain_total, 2),
        'profit_entered', k.gain_entered,
        'sales_estimated', k.est,                -- продажи, у которых доход = сумма × маржа
        'estimated', k.est > 0,
        'avg_check',  case when k.sales > 0 then round(k.revenue / k.sales, 2) end,
        'conversion', case when e.wa + e.tel > 0 then k.sales::numeric / (e.wa + e.tel) end,
        'visit_to_contact', case when e.visits > 0 then (e.wa + e.tel)::numeric / e.visits end,
        'sales_ever', exists (select 1 from public.leads where status = 'won' and value > 0))
      from k, e),
    'daily', coalesce((select jsonb_agg(x order by x.d) from (
        select g.d::date as d,
               coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts,
               coalesce(s.sales, 0) as sales, coalesce(s.revenue, 0) as revenue, coalesce(s.profit, 0) as profit,
               coalesce(s.refunds, 0) as refunds
        from generate_series((p_from at time zone 'Asia/Yerevan')::date,
                             ((p_to at time zone 'Asia/Yerevan') - interval '1 second')::date, interval '1 day') g(d)
        left join (select d, coalesce(sum(n) filter (where name = 'page_view'), 0)::bigint as visits,
                          coalesce(sum(n) filter (where name in ('wa_click', 'tel_click')), 0)::bigint as contacts
                   from ev group by 1) v on v.d = g.d::date
        left join (select kd as d, count(*) filter (where sale) as sales,
                          coalesce(sum(value) filter (where sale), 0) as revenue,
                          round(coalesce(sum(gain) filter (where sale), 0), 2) as profit,
                          count(*) filter (where status = 'lost') as refunds
                   from sl group by 1) s on s.d = g.d::date
      ) x), '[]'::jsonb),
    'managers', coalesce((select jsonb_agg(x order by x.revenue desc, x.sales desc, x.id) from (
        select m.assigned_to as id,
               coalesce(nullif(btrim(p.full_name), ''), u.email::text) as name,
               count(*) filter (where m.sale) as sales,
               count(*) filter (where m.status = 'lost') as refunds,
               coalesce(sum(m.value) filter (where m.sale), 0) as revenue,
               round(coalesce(sum(m.gain) filter (where m.sale), 0), 2) as profit
        from sl m
        left join public.profiles p on p.id = m.assigned_to
        left join auth.users u on u.id = m.assigned_to
        where m.assigned_to is not null
        group by 1, 2
      ) x), '[]'::jsonb),
    'refund_reasons', coalesce((select jsonb_agg(x order by x.n desc, x.reason) from (
        select coalesce(nullif(btrim(lost_reason), ''), '') as reason, count(*) as n
        from sl where status = 'lost' group by 1) x), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(x order by x.sales desc, x.contacts desc, x.visits desc, x.channel) from (
        select c.channel, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts,
               coalesce(s.sales, 0) as sales, coalesce(s.revenue, 0) as revenue
        from (select src as channel from ev where name <> 'tour_open' union select channel from sl where sale) c
        left join (select src as channel, coalesce(sum(n) filter (where name = 'page_view'), 0)::bigint as visits,
                          coalesce(sum(n) filter (where name in ('wa_click', 'tel_click')), 0)::bigint as contacts
                   from ev group by 1) v using (channel)
        left join (select channel, count(*) as sales, sum(value) as revenue from sl where sale group by 1) s using (channel)
      ) x), '[]'::jsonb),
    'tours', coalesce((select jsonb_agg(x order by x.opens desc, x.contacts desc, x.sales desc, x.tour) from (
        select t.tour, coalesce(o.opens, 0) as opens, coalesce(o.contacts, 0) as contacts, coalesce(s.sales, 0) as sales
        from (select tour from ev where tour is not null and name in ('tour_open', 'wa_click')
              union select tour from sl where sale and tour is not null) t
        left join (select tour, coalesce(sum(n) filter (where name = 'tour_open'), 0)::bigint as opens,
                          coalesce(sum(n) filter (where name = 'wa_click'), 0)::bigint as contacts
                   from ev where tour is not null group by 1) o using (tour)
        left join (select tour, count(*) as sales from sl where sale and tour is not null group by 1) s using (tour)
      ) x), '[]'::jsonb),
    'contact_heat', coalesce((select jsonb_agg(x) from (
        select extract(isodow from (ts at time zone 'Asia/Yerevan'))::int as dow,
               extract(hour from (ts at time zone 'Asia/Yerevan'))::int as h, count(*) as n
        from public.events where name in ('wa_click', 'tel_click') and ts >= p_from and ts < p_to group by 1, 2) x), '[]'::jsonb)
  ) into r;
  return r;
end; $$;

-- ============================================================================
-- stats_traffic: цифры маркетолога
-- ============================================================================
-- Заменяет функцию из 030. Что изменилось:
--   • «заявок» больше нет: рядом с посещениями стоят обращения (клики в WhatsApp и по телефону)
--   • продажи, выручка и доход канала и кампании — по продажам с номером обращения
--     (метки в продажу подставляет leads_attribution), по дате продажи;
--     продажи без номера — отдельные каналы manual:… без посещений
--   • tours: открытия описания → клики в WhatsApp по туру → продажи по туру
--   • lead_heat → contact_heat: в какие часы пишут и звонят
create or replace function public.stats_traffic(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r        jsonb;
  v_margin numeric := public.company_margin();
  v_raw    timestamptz;     -- сырые события читаются отсюда
  v_d1     date;            -- дни свёртки: [v_d1, v_d2)
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
    select name, sid, section, promo_id, (ts at time zone 'Asia/Yerevan') as lt
    from public.events where ts >= v_raw and ts < p_to
  ), cnt as materialized (
    select * from public.stats_events(p_from, p_to)
  ), sl as materialized (
    select l.tour, l.utm_campaign, l.value, l.profit, l.ref, public.lead_channel(l) as src
    from public.leads l
    where l.status = 'won' and l.value > 0 and l.closed_at >= p_from and l.closed_at < p_to
  ), money as (
    -- по каналу и по кампании одним проходом; g = 's' | 'c'
    select 's' as g, src as k, count(*) as won,
           coalesce(sum(value), 0) as revenue,
           coalesce(sum(profit), 0) as profit,
           coalesce(sum(value) filter (where profit is null), 0) as revenue_est,
           count(*) filter (where profit is null) > 0 as estimated
    from sl group by src
    union all
    select 'c', utm_campaign, count(*), coalesce(sum(value), 0), coalesce(sum(profit), 0),
           coalesce(sum(value) filter (where profit is null), 0), count(*) filter (where profit is null) > 0
    from sl where utm_campaign is not null group by utm_campaign
  )
  select jsonb_build_object(
    'margin_pct', v_margin,
    'raw_from', case when exists (select 1 from public.events_daily where day >= v_d1 and day < v_d2) then v_d2 end,
    'daily', coalesce((select jsonb_agg(x order by x.d) from (
        select g.d::date as d, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts
        from generate_series((p_from at time zone 'Asia/Yerevan')::date,
                             ((p_to at time zone 'Asia/Yerevan') - interval '1 second')::date, interval '1 day') g(d)
        left join (select d, coalesce(sum(n) filter (where name = 'page_view'), 0)::bigint as visits,
                          coalesce(sum(n) filter (where name in ('wa_click', 'tel_click')), 0)::bigint as contacts
                   from cnt group by 1) v on v.d = g.d::date
      ) x), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(x order by x.visits desc, x.contacts desc, x.won desc, x.src) from (
        select s.src, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts,
               coalesce(m.won, 0) as won, coalesce(m.revenue, 0) as revenue,
               round(coalesce(m.profit + m.revenue_est * coalesce(v_margin, 0) / 100, 0), 2) as profit_total,
               coalesce(m.estimated, false) as estimated
        from (select src from cnt where name in ('page_view', 'wa_click', 'tel_click') union select src from sl) s
        left join (select src, coalesce(sum(n) filter (where name = 'page_view'), 0)::bigint as visits,
                          coalesce(sum(n) filter (where name in ('wa_click', 'tel_click')), 0)::bigint as contacts
                   from cnt group by 1) v using (src)
        left join money m on m.g = 's' and m.k = s.src
      ) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by x.campaign) from (
        select c.k as campaign, coalesce(v.visits, 0) as visits, coalesce(v.contacts, 0) as contacts,
               coalesce(m.won, 0) as won, coalesce(m.revenue, 0) as revenue,
               coalesce(m.profit, 0) as profit,                 -- вписано руками
               coalesce(m.revenue_est, 0) as revenue_est,       -- выручка продаж без вписанного дохода
               round(coalesce(m.profit + m.revenue_est * coalesce(v_margin, 0) / 100, 0), 2) as profit_total,
               coalesce(m.estimated, false) as estimated
        from (select campaign as k from cnt where campaign is not null
              union select utm_campaign from sl where utm_campaign is not null) c
        left join (select campaign as k, coalesce(sum(n) filter (where name = 'page_view'), 0)::bigint as visits,
                          coalesce(sum(n) filter (where name in ('wa_click', 'tel_click')), 0)::bigint as contacts
                   from cnt group by 1) v using (k)
        left join money m on m.g = 'c' and m.k = c.k
      ) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_object_agg(k, n) from (select coalesce(device, '?') k, sum(n) n from cnt where name = 'page_view' group by 1) x), '{}'::jsonb),
    'langs',   coalesce((select jsonb_object_agg(k, n) from (select coalesce(lang, '?') k, sum(n) n from cnt where name = 'page_view' group by 1) x), '{}'::jsonb),
    'sections', coalesce((select jsonb_object_agg(section, n) from (select section, count(distinct sid) n from ev where name = 'section_view' and section is not null group by 1) x), '{}'::jsonb),
    'ctas',    coalesce((select jsonb_object_agg(name, n) from (select name, sum(n) n from cnt where name not in ('page_view', 'section_view') group by 1) x), '{}'::jsonb),
    'tours',   coalesce((select jsonb_agg(x order by x.opens desc, x.contacts desc, x.sales desc, x.tour) from (
        select t.tour, coalesce(o.opens, 0) as opens, coalesce(o.contacts, 0) as contacts, coalesce(s.sales, 0) as sales
        from (select tour from cnt where tour is not null and name in ('tour_open', 'wa_click')
              union select tour from sl where tour is not null) t
        left join (select tour, coalesce(sum(n) filter (where name = 'tour_open'), 0)::bigint as opens,
                          coalesce(sum(n) filter (where name = 'wa_click'), 0)::bigint as contacts
                   from cnt where tour is not null group by 1) o using (tour)
        left join (select tour, count(*) as sales from sl where tour is not null group by 1) s using (tour)
      ) x), '[]'::jsonb),
    'heat', coalesce((select jsonb_agg(x) from (
        select extract(isodow from lt)::int as dow, extract(hour from lt)::int as h, count(*) as visits
        from ev where name = 'page_view' group by 1, 2) x), '[]'::jsonb),
    'contact_heat', coalesce((select jsonb_agg(x) from (
        select extract(isodow from lt)::int as dow, extract(hour from lt)::int as h, count(*) as n
        from ev where name in ('wa_click', 'tel_click') group by 1, 2) x), '[]'::jsonb),
    'promos', coalesce((select jsonb_agg(x) from (
        select promo_id as id, count(*) filter (where name = 'promo_view') views,
               count(*) filter (where name = 'promo_click') clicks,
               count(*) filter (where name = 'promo_close') closes
        from ev where promo_id is not null and name like 'promo\_%' group by 1) x), '[]'::jsonb),
    'funnel', jsonb_build_object(
        'visits',  (select coalesce(sum(n), 0)::bigint from cnt where name = 'page_view'),
        -- следующим трём нужны отдельные визиты, поэтому они есть, только пока хранятся сырые события
        'visits_detailed', (select count(*) from ev where name = 'page_view'),
        'engaged', (select count(distinct sid) from ev where name = 'section_view' and section not in ('band-prices')),
        'intent',  (select count(distinct sid) from ev where name in ('tour_open', 'plan_open', 'checklist_open', 'wa_click', 'tel_click')),
        'contact', (select count(distinct sid) from ev where name in ('wa_click', 'tel_click')),
        'won',     (select count(*) from sl),
        'won_ref', (select count(*) from sl where ref is not null))
  ) into r;
  return r;
end; $$;

-- ---------- права -----------------------------------------------------------
revoke all on function public.wa_ref(text)                            from public, anon;
grant execute on function public.wa_ref(text) to authenticated;       -- роль проверяет сама
revoke all on function public.wa_ref_lookup(text)                     from public, anon, authenticated;
revoke all on function public.leads_attribution()                     from public, anon, authenticated;
revoke all on function public.stats_events(timestamptz, timestamptz)  from public, anon, authenticated;
revoke all on function public.stats_sales(timestamptz, timestamptz)   from public, anon;
revoke all on function public.stats_traffic(timestamptz, timestamptz) from public, anon;
grant execute on function public.stats_sales(timestamptz, timestamptz)   to authenticated;
grant execute on function public.stats_traffic(timestamptz, timestamptz) to authenticated;
grant execute on function public.track(jsonb) to anon, authenticated;
