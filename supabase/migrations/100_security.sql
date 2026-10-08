-- ============================================================================
-- SAM TRAVEL — безопасность по итогам аудита  (миграция 100, этап 10)
-- ============================================================================
-- Запускать ПОСЛЕ 090_reminders.sql. Только весь набор по порядку: после повторного
-- запуска любого файла 001–090 нужно снова накатить все следующие, включая этот, —
-- старые файлы заново создают то, что здесь закрыто (AUDIT.md, D6).
-- Задание: AUDIT.md, разделы S и D. Буква и номер в скобках — пункт аудита.
--
--   • rate_hits / rate_take()  — счётчик обращений одного отправителя за минуту
--   • track()                  — лимит на отправителя, общий потолок выше, свой запас у
--                                wa_click, метки рекламы только из безопасных знаков,
--                                строгий uuid у promo_id, номер обращения считает база (D3, D7)
--   • wa_ref_lookup(), leads_attribution() — метки, тур и промокод только из визита
--                                последнего клика; промокод в продажу не подставляется (D7)
--   • coupons                  — менеджер читает, пишет только маркетинг (D1)
--   • submit_lead()            — закрыта и для вошедших; письма о заявке больше нет (D2)
--   • leads_log()              — денежная правка с выходом из «продано» и обратно
--                                оставляет запись (D4)
--   • leads, campaigns         — NaN не проходит (D5)
--   • бакет media              — пишут владелец, маркетолог и «Контент» (D8)
--   • team                     — роль «Контент» меняет только фото (D9, решение заказчика 2)
--   • row_history()            — подпись автора без e-mail (D9)
--   • profiles                 — длины и список источников согласия (D10)
--   • lead_activity            — «system» пишет только база, время ставит база (D11)
--   • check_coupon()           — 10 попыток в минуту (D12)
--   • права на функции         — EXECUTE снят у PUBLIC и гостей (D13)
--   • reels.url                — шаблон до конца строки (D14)
--   • public_site()            — из company отдаётся только перечисленное (D15)
--   • tours, reviews, team     — адрес фото только из бакета media, фон тура из списка,
--                                «Что включено» — список строк до 200 знаков (S1, S5, S9)
--   • auth_user_by_email()     — для моста Mail.ru: подтверждён ли адрес (S3)
--
-- Коды ошибок для панели (errText в js/admin/api.js):
--   team_photo_only, rate_limited, leads_money_not_nan, campaigns_spend_ok,
--   tours_inc_ok, *_photo_url_ok, tours_photo_class_known, profiles_*_len
-- Те же правила — в js/admin/demo.js для демо-режима.
-- ============================================================================

-- ============================================================================
-- счётчик обращений одного отправителя
-- ============================================================================
-- Одна строка на принятое обращение: когда, что за обращение, хеш отправителя
-- (sender_hash() из 020: адрес с солью, которая живёт сутки; сам адрес не хранится) и
-- сколько единиц засчитано. Окно — последние 60 секунд.
create table if not exists public.rate_hits (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  kind    text not null,
  sender  text not null,
  n       integer not null
);
create index if not exists rate_hits_idx on public.rate_hits (kind, sender, ts);
create index if not exists rate_hits_ts_idx on public.rate_hits (ts);
alter table public.rate_hits enable row level security;   -- политик нет: только функции ниже
revoke all on public.rate_hits from anon, authenticated;

-- Сколько из p_want единиц помещается в лимит p_limit за минуту; принятое сразу
-- засчитывается. Отправитель неизвестен (запрос без адреса) — лимита нет, остаются общие.
create or replace function public.rate_take(p_kind text, p_sender text, p_want integer, p_limit integer)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_had  integer;
  v_take integer;
begin
  if coalesce(p_want, 0) <= 0 then return 0; end if;
  if p_sender is null then return p_want; end if;
  -- два запроса одного отправителя ждут друг друга, иначе оба увидят «ещё есть место»
  perform pg_advisory_xact_lock(hashtext('rate:' || p_kind || ':' || p_sender));
  select coalesce(sum(n), 0) into v_had from public.rate_hits
   where kind = p_kind and sender = p_sender and ts > now() - interval '1 minute';
  v_take := greatest(0, least(p_want, p_limit - v_had));
  if v_take > 0 then
    insert into public.rate_hits (kind, sender, n) values (p_kind, p_sender, v_take);
  end if;
  -- уборка: изредка и только старое, чтобы таблица не росла
  if random() < 0.02 then
    delete from public.rate_hits where ts < now() - interval '10 minutes';
  end if;
  return v_take;
end; $$;
revoke all on function public.rate_take(text, text, integer, integer) from public, anon, authenticated;

-- ============================================================================
-- D7: номер обращения считает база
-- ============================================================================
-- Та же функция, что refOf() в js/track.js и js/admin/metrics.js: FNV-1a (32 бита) от sid
-- визита, пять знаков алфавита без похожих символов. Сайт дописывает этот номер в
-- сообщение WhatsApp; то, что браузер прислал в поле ref, больше не читается — иначе
-- любой мог бы записать чужой номер на свои рекламные метки.
create or replace function public.ref_of(p_sid text)
returns text language plpgsql immutable as $$
declare
  h bigint := 2166136261;
  o text := '';
begin
  if p_sid is null then return null; end if;
  for i in 1 .. char_length(p_sid) loop
    h := ((h # ascii(substr(p_sid, i, 1))::bigint) * 16777619) & 4294967295;
  end loop;
  for i in 1 .. 5 loop
    o := o || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (h % 31)::integer + 1, 1);
    h := h / 31;
  end loop;
  return o;
end; $$;

-- D3: рекламная метка и домен перехода — только знаки, которым нечего ломать в отчёте,
-- выгрузке и ссылке; всё остальное записывается как «метки нет».
create or replace function public.tag_ok(p text)
returns text language sql immutable as $$
  select case when p ~ '^[A-Za-z0-9._~-]{1,60}$' then p end;
$$;

-- ============================================================================
-- D3, D7: track
-- ============================================================================
-- Пачка событий с сайта (не больше 30 за вызов, имена из списка). Что не помещается в
-- лимит, молча отбрасывается: страница посетителя не должна видеть ошибку.
--   1. один отправитель — 120 событий в минуту. Проверяется первым: тот, кто заливает
--      события, упирается в свою стену и не закрывает аналитику остальным;
--   2. весь сайт — 3000 событий в минуту (было 600), без учёта wa_click;
--   3. у wa_click свой запас — 300 в минуту: клик в WhatsApp — единственное событие, по
--      которому продажа находит свою рекламу, общий потолок его не отбрасывает;
--   4. один визит (sid) — 200 событий, как раньше.
-- form_start из списка убран: формы заявки на сайте нет (этап 7).
create or replace function public.track(p_events jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  c_sender constant integer := 120;
  c_all    constant integer := 3000;
  c_wa     constant integer := 300;
  v_n       integer;
  v_take    integer;      -- сколько событий пачки принимается от этого отправителя
  v_room    integer;      -- запас сайта на эту минуту
  v_room_wa integer;      -- запас кликов в WhatsApp
begin
  if jsonb_typeof(p_events) <> 'array' then return; end if;
  v_n := jsonb_array_length(p_events);
  if v_n = 0 or v_n > 30 then return; end if;

  v_take := public.rate_take('track', public.sender_hash(), v_n, c_sender);
  if v_take <= 0 then return; end if;

  select c_all - count(*) filter (where name <> 'wa_click'), c_wa - count(*) filter (where name = 'wa_click')
    into v_room, v_room_wa
    from public.events where ts > now() - interval '1 minute';
  if v_room <= 0 and v_room_wa <= 0 then return; end if;

  -- две пачки одного sid ждут друг друга, чтобы 200 не перескочить в гонке
  perform pg_advisory_xact_lock(hashtext('track:' || s.sid))
  from (select distinct e ->> 'sid' as sid from jsonb_array_elements(p_events) with ordinality t(e, ord)
        where ord <= v_take and jsonb_typeof(e) = 'object' and (e ->> 'sid') ~ '^[a-z0-9]{8,40}$' order by 1) s;

  with good as (
    select e, ord, e ->> 'sid' as sid, (e ->> 'name' = 'wa_click') as wa,
           row_number() over (partition by e ->> 'sid' order by ord) as k
    from jsonb_array_elements(p_events) with ordinality t(e, ord)
    where ord <= v_take and jsonb_typeof(e) = 'object'
      and (e ->> 'sid') ~ '^[a-z0-9]{8,40}$'
      and e ->> 'name' in ('page_view', 'section_view', 'tour_open', 'plan_open', 'checklist_open', 'wa_click',
                           'tel_click', 'mail_click', 'promo_view', 'promo_click', 'promo_close', 'lang_switch',
                           'auth_open', 'plan_send')
  ), have as (
    select s.sid, (select count(*) from public.events ev where ev.sid = s.sid) as n
    from (select distinct sid from good) s
  ), fits as (
    select g.e, g.ord, g.wa, row_number() over (partition by g.wa order by g.ord) as pos
    from good g join have h using (sid)
    where h.n + g.k <= 200
  )
  insert into public.events (sid, name, section, tour, promo_id, label, lang, device, ref_host,
                             utm_source, utm_medium, utm_campaign, utm_content, ref)
  select e ->> 'sid', e ->> 'name',
         nullif(left(e ->> 'section', 40), ''), nullif(left(e ->> 'tour', 40), ''),
         case when (e ->> 'promo_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e ->> 'promo_id')::uuid end,
         nullif(left(e ->> 'label', 80), ''), nullif(left(e ->> 'lang', 5), ''), nullif(left(e ->> 'device', 10), ''),
         public.tag_ok(e ->> 'ref_host'),
         public.tag_ok(e ->> 'utm_source'), public.tag_ok(e ->> 'utm_medium'),
         public.tag_ok(e ->> 'utm_campaign'), public.tag_ok(e ->> 'utm_content'),
         case when wa then public.ref_of(e ->> 'sid') end
  from fits
  where pos <= case when wa then v_room_wa else v_room end
  order by ord;
end; $$;
revoke all on function public.track(jsonb) from public;
grant execute on function public.track(jsonb) to anon, authenticated;

-- ============================================================================
-- D7: что сайт знает о визите с таким номером
-- ============================================================================
-- Последний за 90 дней клик wa_click с этим номером решает, о каком визите речь; метки
-- рекламы, тур и промокод с баннера берутся только из кликов ЭТОГО визита (его sid).
-- Раньше тур и промокод искались по всем событиям с таким номером, а номер присылал
-- браузер — чужой клик мог подмешать свой тур и свой промокод.
create or replace function public.wa_ref_lookup(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  with last as (
    select e.* from public.events e
    where e.ref = public.ref_norm(p_code) and e.name = 'wa_click' and e.ts > now() - interval '90 days'
    order by e.ts desc, e.id desc limit 1
  ), c as (
    select e.* from public.events e, last
    where e.sid = last.sid and e.name = 'wa_click' and e.ts > now() - interval '90 days'
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
  from last e;
$$;

-- Как в 070, кроме одного: промокод с баннера в продажу больше не подставляется. Его
-- по-прежнему отдаёт wa_ref() — форма продажи показывает его подсказкой, и вписывает его
-- человек (счётчик использований кода не должен расти от чужого клика по баннеру).
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
  new.details      := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('ref_at', e -> 'ts', 'ref_label', e ->> 'label');
  return new;
end; $$;

-- ============================================================================
-- D1: промокоды — менеджер читает, пишет маркетинг
-- ============================================================================
-- Политика "coupons: staff all" из 001 давала менеджеру полную запись (002 добавила
-- политику маркетинга, но старую не сняла).
drop policy if exists "coupons: staff all" on public.coupons;
drop policy if exists "coupons: team read" on public.coupons;
create policy "coupons: team read" on public.coupons for select using (public.is_team());
drop policy if exists "coupons: marketing all" on public.coupons;
create policy "coupons: marketing all" on public.coupons for all
  using (public.is_marketing()) with check (public.is_marketing());

-- ============================================================================
-- D2: формы нет — submit_lead закрыта всем, письма о заявке нет
-- ============================================================================
-- 070 сняла право у гостей, но вошедший клиент по-прежнему мог создать заявку, и на неё
-- ставилось письмо агентству. Функция и её лимиты остаются в базе; вернуть форму —
-- это вернуть право, триггер leads_notify_ai и прежнюю notify_claim() из 090.
revoke all on function public.submit_lead(jsonb) from public, anon, authenticated;

drop trigger if exists leads_notify_ai on public.leads;
delete from public.notify_log where kind = 'lead' and status = 'pending';

-- notify_claim из 090 без писем о заявке: отдаёт только письма дня с напоминаниями.
create or replace function public.notify_claim(p_lead uuid default null, p_limit int default 10)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_to   text := nullif(btrim((select value ->> 'email' from public.site_settings where key = 'contacts')), '');
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

-- ============================================================================
-- D4: денежная правка закрытой продажи всегда оставляет запись
-- ============================================================================
-- 010 писала строку «money», только когда запись была закрыта и осталась закрытой.
-- Продажу можно было вернуть в работу с новой суммой и закрыть снова — сумма менялась
-- без следа. Теперь правка суммы или дохода записывается, если запись была закрыта ИЛИ
-- у неё уже стояло прежнее значение (значит, его меняют и в те минуты, пока продажа
-- «в работе»). Первая сумма при первой продаже — не правка: о ней говорит строка «status».
-- Дата продажи — как раньше, только при неизменном статусе.
create or replace function public.leads_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m      jsonb := '{}'::jsonb;
  closed boolean := old.status in ('won', 'lost', 'spam');
begin
  if new.status is distinct from old.status then
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (new.id, auth.uid(), 'status', new.status, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (new.id, auth.uid(), 'assign', null, jsonb_build_object('to', new.assigned_to));
  end if;
  if new.value is distinct from old.value and (closed or old.value is not null) then
    m := m || jsonb_build_object('value', jsonb_build_object('from', old.value, 'to', new.value));
  end if;
  if new.profit is distinct from old.profit and (closed or old.profit is not null) then
    m := m || jsonb_build_object('profit', jsonb_build_object('from', old.profit, 'to', new.profit));
  end if;
  if new.closed_at is distinct from old.closed_at and closed and new.status = old.status then
    m := m || jsonb_build_object('closed_at', jsonb_build_object('from', old.closed_at, 'to', new.closed_at));
  end if;
  if m <> '{}'::jsonb then
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (new.id, auth.uid(), 'money', null, m);
  end if;
  return null;
end; $$;

-- ============================================================================
-- D5: NaN — не число
-- ============================================================================
-- Для numeric 'NaN' больше любого числа: проверки «сумма > 0» и «доход ≤ суммы» его
-- пропускали, а отчёты после этого показывали «NaN». CHECK срабатывает на любом пути
-- записи, поэтому сторож leads_guard отдельно не повторяет проверку.
-- NOT VALID: строки, записанные раньше, не трогаются; каждая новая и изменённая проверяется.
alter table public.leads drop constraint if exists leads_money_not_nan;
alter table public.leads add constraint leads_money_not_nan
  check (value <> 'NaN'::numeric and profit <> 'NaN'::numeric) not valid;
alter table public.campaigns drop constraint if exists campaigns_spend_ok;
alter table public.campaigns add constraint campaigns_spend_ok
  check (spend >= 0 and spend <> 'NaN'::numeric) not valid;

-- ============================================================================
-- D8: бакет media
-- ============================================================================
-- 002 пускала загружать и перезаписывать любой файл всю команду, включая менеджера,
-- которому в контенте делать нечего. Пишут: владелец, маркетолог и роль «Контент»
-- (её политики — в 080).
drop policy if exists "media: team insert" on storage.objects;
drop policy if exists "media: team update" on storage.objects;
drop policy if exists "media: marketing insert" on storage.objects;
drop policy if exists "media: marketing update" on storage.objects;
create policy "media: marketing insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_marketing());
create policy "media: marketing update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_marketing())
  with check (bucket_id = 'media' and public.is_marketing());
drop policy if exists "media: content update" on storage.objects;
create policy "media: content update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_content())
  with check (bucket_id = 'media' and public.is_content());

-- Лимиты бакета ставятся и там, где бакет уже был создан руками с другими настройками.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================================
-- D9: роль «Контент» в таблице team меняет только фото (решение заказчика 2)
-- ============================================================================
-- 080 дала роли полную запись в team. Теперь: читать — да, менять — только photo_url;
-- добавлять и удалять сотрудников, править имя, должность, WhatsApp, порядок и
-- «Показывать на сайте» — нет.
drop policy if exists "team: content write"  on public.team;
drop policy if exists "team: content update" on public.team;
create policy "team: content update" on public.team for update
  using (public.is_content()) with check (public.is_content());

-- Сторож видит, кто делает запрос (auth.uid()), поэтому действует и внутри
-- restore_version(): роль вернёт версию сотрудника, только если она отличается одним фото.
create or replace function public.team_content_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  free text[] := array['photo_url', 'updated_at', 'updated_by'];
begin
  if public.is_content() and (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
    raise exception 'team_photo_only';
  end if;
  return new;
end; $$;
drop trigger if exists team_content_guard on public.team;
create trigger team_content_guard before update on public.team
  for each row execute function public.team_content_guard();

-- История записи: имя автора, а если имени нет — его роль. Раньше подставлялся e-mail,
-- и роль «Контент» видела адреса владельца и маркетолога.
create or replace function public.role_label(p_role text)
returns text language sql immutable as $$
  select case p_role when 'admin' then 'Владелец' when 'manager' then 'Менеджер' when 'marketer' then 'Маркетолог'
                     when 'content' then 'Контент' when 'client' then 'Клиент' end;
$$;

create or replace function public.row_history(p_table text, p_id uuid)
returns table (id bigint, at timestamptz, action text, actor uuid, actor_name text, version jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_table not in ('tours', 'reviews', 'reels', 'team') then raise exception 'not_content_table'; end if;
  if not public.can_edit_content(p_table) then raise exception 'forbidden'; end if;
  return query
    select a.id, a.at, a.action, a.actor,
           coalesce(nullif(btrim(left(p.full_name, 120)), ''), public.role_label(p.role::text)), a.after
    from public.audit_log a
    left join public.profiles p on p.id = a.actor
    where a.table_name = p_table and a.row_id = p_id::text and a.action in ('insert', 'update')
    order by a.at desc, a.id desc
    limit 100;
end; $$;

-- ============================================================================
-- D10: профиль клиента — длины и источник согласия
-- ============================================================================
-- Имя и источник согласия приходят из метаданных регистрации, которые пишет браузер.
alter table public.profiles drop constraint if exists profiles_full_name_len;
alter table public.profiles add constraint profiles_full_name_len
  check (full_name is null or char_length(full_name) <= 120) not valid;
alter table public.profiles drop constraint if exists profiles_phone_len;
alter table public.profiles add constraint profiles_phone_len
  check (phone is null or char_length(phone) <= 40) not valid;
-- signup_form — галочка в форме регистрации; onboarding_* — экран первого входа;
-- cabinet — переключатель в кабинете.
create or replace function public.consent_source_ok(p text)
returns boolean language sql immutable as $$
  select p is null or p in ('signup_form', 'onboarding_social', 'onboarding_google', 'onboarding_mailru', 'cabinet');
$$;
alter table public.profiles drop constraint if exists profiles_consent_source_known;
alter table public.profiles add constraint profiles_consent_source_known
  check (public.consent_source_ok(consent_source)) not valid;

-- handle_new_user из 040: имя обрезается до 120 знаков, неизвестный источник согласия
-- не записывается (и согласие без известного источника согласием не считается —
-- человек увидит экран первого входа и ответит сам).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_birth  date;
  v_source text := new.raw_user_meta_data ->> 'consent_source';
  v_yes    boolean := false;
begin
  if coalesce(new.raw_user_meta_data ->> 'birth_date', '') <> '' then
    begin
      v_birth := (new.raw_user_meta_data ->> 'birth_date')::date;
    exception when others then
      raise exception 'birth_date_invalid';
    end;
  end if;
  if v_source is null or not public.consent_source_ok(v_source) then v_source := null; end if;
  if v_source is not null then
    begin
      v_yes := coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false);
    exception when others then
      v_yes := false;
    end;
  end if;

  insert into public.profiles (id, full_name, lang, marketing_consent, consent_at, consent_source, onboarded, birth_date)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 120), ''),
    case when new.raw_user_meta_data ->> 'lang' in ('en', 'ru', 'hy') then new.raw_user_meta_data ->> 'lang' else 'en' end,
    v_yes,
    case when v_yes then now() end,
    v_source,
    v_source is not null,
    v_birth
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ============================================================================
-- D11: история продажи — «system» пишет только база, время ставит база
-- ============================================================================
-- Менеджер мог вставить строку «system» с любой датой — так подделывается история.
drop policy if exists "activity: staff insert" on public.lead_activity;
create policy "activity: staff insert" on public.lead_activity for insert
  with check (public.is_staff() and actor = auth.uid()
              and kind in ('note', 'call', 'whatsapp', 'email'));

-- Не security definer намеренно: current_user — роль, от имени которой пришёл запрос
-- (см. profiles_guard в 010). Запись через API получает время сервера; функции базы и
-- SQL Editor могут ставить своё.
create or replace function public.lead_activity_stamp()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then new.created_at := now(); end if;
  return new;
end; $$;
drop trigger if exists lead_activity_stamp on public.lead_activity;
create trigger lead_activity_stamp before insert on public.lead_activity
  for each row execute function public.lead_activity_stamp();

-- Первую строку истории («Продажа внесена») раньше вставляла панель как «system».
-- Теперь её пишет база — для записей, которые внёс сотрудник.
create or replace function public.leads_log_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.lead_is_manual(new.source) then
    insert into public.lead_activity (lead_id, actor, kind, body)
    values (new.id, auth.uid(), 'system', case when new.status = 'won' then 'Продажа внесена' else 'Запись внесена' end);
  end if;
  return null;
end; $$;
drop trigger if exists leads_log_insert on public.leads;
create trigger leads_log_insert after insert on public.leads
  for each row execute function public.leads_log_insert();

-- ============================================================================
-- D12: check_coupon — 10 попыток в минуту
-- ============================================================================
-- Код проверяется по одному, но перебирать их можно было без счёта. Счётчик — по
-- отправителю (sender_hash); у запроса без адреса — по пользователю, иначе общий.
-- Сайт функцию сейчас не вызывает; гостям она оставлена, как записано в ТЗ §2.
create or replace function public.check_coupon(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if public.rate_take('coupon', coalesce(public.sender_hash(), auth.uid()::text, '-'), 1, 10) < 1 then
    raise exception 'rate_limited';
  end if;
  return coalesce((
    select jsonb_build_object('valid', true, 'code', code, 'discount_pct', discount_pct,
                              'discount_amt', discount_amt, 'valid_until', valid_until)
    from public.coupons
    where upper(code) = upper(btrim(p_code)) and active
      and valid_from <= now() and (valid_until is null or valid_until > now())
      and (max_uses is null or used_count < max_uses)
    limit 1
  ), jsonb_build_object('valid', false));
end; $$;
revoke all on function public.check_coupon(text) from public;
grant execute on function public.check_coupon(text) to anon, authenticated;

-- ============================================================================
-- D14: ссылка на рилс — шаблон до конца строки
-- ============================================================================
-- Без «$» в конце после правильного начала проходил любой хвост.
alter table public.reels drop constraint if exists reels_url_check;
alter table public.reels add constraint reels_url_check
  check (url ~ '^https://(www\.)?instagram\.com/(reel|p)/[A-Za-z0-9_-]+/?$') not valid;

-- ============================================================================
-- S1, S5, S9: что роль «Контент» может положить в тур, отзыв и карточку сотрудника
-- ============================================================================
-- S5: адрес фото — только файл бакета media (хранилище Supabase) и только из знаков,
-- которым нечего ломать в CSS и HTML. Сайт и панель проверяют ещё строже — по адресу
-- своего проекта (js/cms.js, js/admin/api.js). Если проекту дадут свой домен хранилища,
-- шаблон нужно поправить здесь и там.
create or replace function public.media_url_ok(p text)
returns boolean language sql immutable as $$
  select p is null
      or p ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/[A-Za-z0-9._/-]{1,200}$';
$$;
do $$
declare t text;
begin
  foreach t in array array['tours', 'reviews', 'team'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_photo_url_ok');
    execute format('alter table public.%I add constraint %I check (public.media_url_ok(photo_url)) not valid', t, t || '_photo_url_ok');
  end loop;
end $$;
alter table public.tours drop constraint if exists tours_photo_hero_url_ok;
alter table public.tours add constraint tours_photo_hero_url_ok check (public.media_url_ok(photo_hero_url)) not valid;

-- S9: фон тура без фото — один из восьми встроенных (в панели значение попадает в
-- селектор класса).
alter table public.tours drop constraint if exists tours_photo_class_known;
alter table public.tours add constraint tours_photo_class_known
  check (photo_class in ('p-sea', 'p-desert', 'p-lagoon', 'p-snow', 'p-island', 'p-jungle', 'p-ocean', 'p-city')) not valid;

-- S1: «Что включено» — список строк, каждая до 200 знаков. Разметку из них сайт не
-- собирает (js/app.js пишет текст через textContent); проверка в базе — второй замок:
-- не строка и не список сюда не попадут.
create or replace function public.tours_inc_ok(p_i18n jsonb)
returns boolean language plpgsql immutable as $$
declare
  l record;
  x jsonb;
begin
  if p_i18n is null or jsonb_typeof(p_i18n) <> 'object' then return false; end if;
  for l in select value from jsonb_each(p_i18n) loop
    if jsonb_typeof(l.value) = 'object' and l.value ? 'inc' and jsonb_typeof(l.value -> 'inc') <> 'null' then
      if jsonb_typeof(l.value -> 'inc') <> 'array' then return false; end if;
      for x in select jsonb_array_elements(l.value -> 'inc') loop
        if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 200 then return false; end if;
      end loop;
    end if;
  end loop;
  return true;
end; $$;
alter table public.tours drop constraint if exists tours_inc_ok;
alter table public.tours add constraint tours_inc_ok check (public.tours_inc_ok(i18n)) not valid;

-- ============================================================================
-- D15: public_site — из реквизитов отдаётся только перечисленное
-- ============================================================================
-- Как в 080, кроме company: раньше из неё вычитались два закрытых ключа (маржа и
-- валюта), и любой новый ключ уходил бы на сайт сам. Теперь наоборот — перечислено то,
-- что страница печатает: лицензия, страховка, название.
create or replace function public.public_site()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'settings', coalesce((select jsonb_object_agg(key, case when key = 'company'
                            then coalesce((select jsonb_object_agg(c.key, c.value) from jsonb_each(value) c
                                           where c.key in ('licence', 'insurance', 'legal_name')), '{}'::jsonb)
                            else value end)
                          from public.site_settings
                          where key in ('contacts', 'company', 'stats', 'hours', 'seo', 'analytics')), '{}'::jsonb),
    'tours',   coalesce((select jsonb_agg(jsonb_build_object(
                  'slug', slug, 'photo_url', photo_url, 'photo_hero_url', photo_hero_url, 'photo_class', photo_class, 'tags', tags,
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
revoke all on function public.public_site() from public;
grant execute on function public.public_site() to anon, authenticated;

-- ============================================================================
-- S3: мост Mail.ru — что известно об адресе
-- ============================================================================
-- Функция mailru-auth спрашивает до входа: есть ли такой пользователь и подтверждён ли
-- его адрес. Неподтверждённую учётную запись мог завести кто угодно, зная чужой адрес;
-- мост сбрасывает у неё пароль, прежде чем впустить настоящего владельца ящика.
-- Вызывает только service_role.
create or replace function public.auth_user_by_email(p_email text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', u.id, 'confirmed', u.email_confirmed_at is not null)
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  order by u.email_confirmed_at nulls last
  limit 1;
$$;
revoke all on function public.auth_user_by_email(text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.auth_user_by_email(text) to service_role;
    grant execute on function public.notify_claim(uuid, int)  to service_role;
  end if;
end $$;

-- ============================================================================
-- D13: права на функции
-- ============================================================================
-- У функции, созданной без оговорок, право вызова есть у PUBLIC — то есть у гостя.
-- Прежние миграции отзывали его у роли anon, а PUBLIC оставался, и отзыв ничего не менял.
-- Здесь право снято у PUBLIC и гостей; кому функция нужна, получает его явно.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('set_role', 'row_history', 'restore_version', 'media_alive', 'work_minutes',
                        'url_encode', 'reminder_fill', 'reminder_default',
                        -- добавлены этим этапом
                        'ref_of', 'tag_ok', 'role_label', 'consent_source_ok', 'media_url_ok', 'tours_inc_ok')
  loop
    execute format('revoke all on function %s from public, anon', f);
  end loop;
end $$;
grant execute on function public.set_role(uuid, text)    to authenticated;   -- роль проверяют сами
grant execute on function public.row_history(text, uuid) to authenticated;
grant execute on function public.restore_version(bigint) to authenticated;
-- вызываются из проверок CHECK и триггеров при записи от имени вошедшего
grant execute on function public.consent_source_ok(text), public.media_url_ok(text), public.tours_inc_ok(jsonb) to authenticated;

-- Новые функции больше не получают право вызова у PUBLIC сами (для роли, которая
-- накатывает миграции). В Supabase гостю и вошедшему право на новую функцию схемы public
-- всё равно выдаётся настройками проекта — поэтому каждая следующая миграция обязана
-- сама отозвать его у anon там, где функция не для гостей.
alter default privileges revoke execute on functions from public;
