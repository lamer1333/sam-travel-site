-- ============================================================================
-- SAM TRAVEL — напоминания о вылетах  (миграция 090, этап 9)
-- ============================================================================
-- Запускать ПОСЛЕ 070_whatsapp.sql. Повторный запуск безопасен.
-- ТЗ: §0 п.23 и §4.12.
--
-- Сообщение клиенту отправляет человек со своего телефона; система только готовит
-- список и текст. WhatsApp Cloud API и рассыльщики здесь НЕ подключены.
--
--   • leads.depart_on / return_on / wa_opt_in — даты поездки и согласие на сообщения
--   • wa_reminders       — что и в какой день написать: накануне вылета («хорошего
--                          полёта»), на следующий день после возвращения («с возвращением»)
--   • триггер на leads   — создаёт, переносит при смене даты, снимает при возврате
--   • wa_templates.kind  — тексты двух напоминаний на EN / RU / HY, правятся в панели
--   • reminders_today()  — владельцу и менеджеру: кому писать сегодня + вылеты на 7 дней
--   • reminder_done(id)  — отметить «отправлено» (или снять отметку)
--   • письмо             — раз в день, в час из настроек, одно письмо на почту агентства
--                          со ссылками wa.me; идёт через notify_log и функцию lead-mail
--   • send_reminder(id)  — единственная точка будущей автоотправки; сейчас ничего не шлёт
--
-- Сутки — по Еревану. Те же правила — в js/admin/reminders.js для демо-режима;
-- supabase/test/90-reminders.test.mjs сверяет их с этой миграцией.
-- ============================================================================

-- ============================================================================
-- продажа: даты поездки и согласие
-- ============================================================================
alter table public.leads add column if not exists depart_on date;
alter table public.leads add column if not exists return_on date;
-- Согласие клиента получать сообщения в WhatsApp. Сейчас ни на что не влияет: копится
-- на будущее, без него автоматическая отправка запрещена правилами WhatsApp.
alter table public.leads add column if not exists wa_opt_in boolean not null default false;
create index if not exists leads_depart_idx on public.leads (depart_on) where depart_on is not null;

create or replace function public.leads_trip_guard()
returns trigger language plpgsql as $$
begin
  if new.depart_on is not null and new.return_on is not null and new.return_on < new.depart_on
     and (tg_op = 'INSERT' or new.depart_on is distinct from old.depart_on or new.return_on is distinct from old.return_on) then
    raise exception 'return_before_depart';
  end if;
  return new;
end; $$;
drop trigger if exists leads_trip_guard on public.leads;
create trigger leads_trip_guard before insert or update on public.leads
  for each row execute function public.leads_trip_guard();

-- ============================================================================
-- настройки: site_settings.whatsapp
-- ============================================================================
-- enabled     напоминания включены (выключено — нет ни письма, ни блока в панели)
-- mail_hour   час письма по Еревану, 0–23
-- review_url  ссылка для отзыва, дописывается в «с возвращением»
-- mode        'remind' — пишет человек (единственный рабочий режим);
--             'auto'   — место под отправку через WhatsApp Business Platform, пока закрыто
-- Ключ не входит в список public_site(): на сайт настройки не уходят.
insert into public.site_settings (key, value) values
  ('whatsapp', jsonb_build_object('enabled', true, 'mail_hour', 11, 'review_url', '', 'mode', 'remind'))
on conflict (key) do nothing;

create or replace function public.wa_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', true, 'mail_hour', 11, 'review_url', '', 'mode', 'remind')
         || coalesce((select value from public.site_settings where key = 'whatsapp'), '{}'::jsonb);
$$;

create or replace function public.wa_settings_guard()
returns trigger language plpgsql as $$
declare v jsonb := coalesce(new.value, '{}'::jsonb);
begin
  if new.key <> 'whatsapp' then return new; end if;
  v := jsonb_build_object('enabled', true, 'mail_hour', 11, 'review_url', '', 'mode', 'remind') || v;
  if jsonb_typeof(v -> 'enabled') <> 'boolean' then raise exception 'bad_wa_enabled'; end if;
  if jsonb_typeof(v -> 'mail_hour') <> 'number' or (v ->> 'mail_hour') !~ '^\d{1,2}$' or (v ->> 'mail_hour')::int > 23 then
    raise exception 'bad_mail_hour';
  end if;
  v := jsonb_set(v, '{review_url}', to_jsonb(btrim(coalesce(v ->> 'review_url', ''))));
  if (v ->> 'review_url') <> '' and ((v ->> 'review_url') !~ '^https?://[^\s]+$' or length(v ->> 'review_url') > 300) then
    raise exception 'bad_review_url';
  end if;
  -- автоотправка появится вместе с WhatsApp Business Platform; до тех пор режим один
  if (v ->> 'mode') = 'auto' then raise exception 'wa_auto_unavailable'; end if;
  if (v ->> 'mode') is distinct from 'remind' then raise exception 'bad_wa_mode'; end if;
  new.value := v;
  return new;
end; $$;
drop trigger if exists wa_settings_guard on public.site_settings;
create trigger wa_settings_guard before insert or update on public.site_settings
  for each row execute function public.wa_settings_guard();

-- ============================================================================
-- тексты: wa_templates.kind
-- ============================================================================
-- kind = null — обычный шаблон ответа; 'bon_voyage' | 'welcome_back' — текст напоминания,
-- один на язык. Подстановки: {name} — первое слово имени, {tour} — направление на языке
-- клиента, {review} — ссылка для отзыва. Кусок в [квадратных скобках] выпадает целиком,
-- если подстановка внутри него пуста: у продажи может не быть направления, а ссылка для
-- отзыва может быть не задана.
alter table public.wa_templates add column if not exists kind text;
alter table public.wa_templates drop constraint if exists wa_templates_kind_check;
alter table public.wa_templates add constraint wa_templates_kind_check check (kind in ('bon_voyage', 'welcome_back'));
create unique index if not exists wa_templates_kind_lang_idx on public.wa_templates (kind, lang) where kind is not null;

-- Тексты по умолчанию: ими засеваются шаблоны, ими же система пишет, если шаблон удалён
-- или пуст. Армянский и английский нужно вычитать носителю.
create or replace function public.reminder_default(p_kind text, p_lang text)
returns text language sql immutable as $$
  select case p_kind || ':' || p_lang
    when 'bon_voyage:ru'   then 'Здравствуйте, {name}! Завтра ваш вылет[ в {tour}]. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL'
    when 'bon_voyage:en'   then 'Hello, {name}! Your flight[ to {tour}] is tomorrow. Have a great flight and a wonderful holiday! SAM TRAVEL'
    when 'bon_voyage:hy'   then 'Բարև ձեզ, {name}։ Վաղը ձեր թռիչքն է[՝ {tour}]։ Մաղթում ենք բարի թռիչք և հիանալի հանգիստ։ SAM TRAVEL'
    when 'welcome_back:ru' then 'С возвращением, {name}![ Надеемся, {tour} понравился.] Будем рады вашему отзыву[: {review}]'
    when 'welcome_back:en' then 'Welcome back, {name}![ We hope you enjoyed {tour}.] We would be glad to hear your feedback[: {review}]'
    when 'welcome_back:hy' then 'Բարի վերադարձ, {name}։[ Հուսով ենք՝ {tour} ուղևորությունը ձեզ դուր եկավ։] Ուրախ կլինենք ստանալ ձեր կարծիքը[՝ {review}]'
  end;
$$;

insert into public.wa_templates (title, lang, body, sort, kind)
select case k when 'bon_voyage' then 'Накануне вылета' else 'После возвращения' end, l,
       public.reminder_default(k, l), 100 + ord, k
from (values ('bon_voyage', 'ru', 0), ('bon_voyage', 'hy', 1), ('bon_voyage', 'en', 2),
             ('welcome_back', 'ru', 3), ('welcome_back', 'hy', 4), ('welcome_back', 'en', 5)) v(k, l, ord)
where not exists (select 1 from public.wa_templates t where t.kind = v.k and t.lang = v.l);

create or replace function public.reminder_lang(p_lang text)
returns text language sql immutable as $$
  select case when p_lang in ('en', 'ru', 'hy') then p_lang else 'ru' end;
$$;

create or replace function public.reminder_body(p_kind text, p_lang text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.body from public.wa_templates t
      where t.kind = p_kind and t.lang = public.reminder_lang(p_lang) and btrim(t.body) <> ''
      order by t.sort, t.created_at limit 1),
    public.reminder_default(p_kind, public.reminder_lang(p_lang)));
$$;

create or replace function public.reminder_fill(p_body text, p_name text, p_tour text, p_review text)
returns text language plpgsql immutable as $$
declare
  v  text := coalesce(p_body, '');
  n  text := split_part(btrim(coalesce(p_name, '')), ' ', 1);
  t  text := btrim(coalesce(p_tour, ''));
  rv text := btrim(coalesce(p_review, ''));
begin
  if n  = '' then v := regexp_replace(v, '\[[^\[\]]*\{name\}[^\[\]]*\]',   '', 'g'); end if;
  if t  = '' then v := regexp_replace(v, '\[[^\[\]]*\{tour\}[^\[\]]*\]',   '', 'g'); end if;
  if rv = '' then v := regexp_replace(v, '\[[^\[\]]*\{review\}[^\[\]]*\]', '', 'g'); end if;
  v := replace(replace(v, '[', ''), ']', '');
  v := replace(replace(replace(v, '{name}', n), '{tour}', t), '{review}', rv);
  return btrim(regexp_replace(v, '[ \t]{2,}', ' ', 'g'), E' \t\n\r');
end; $$;

-- как encodeURIComponent в браузере: буквы, цифры и - _ . ! ~ * ' ( ) остаются как есть
create or replace function public.url_encode(p text)
returns text language plpgsql immutable as $$
declare
  b bytea := convert_to(coalesce(p, ''), 'UTF8');
  o text := '';
  c int;
begin
  for i in 0 .. length(b) - 1 loop
    c := get_byte(b, i);
    if (c between 48 and 57) or (c between 65 and 90) or (c between 97 and 122) or c in (45, 95, 46, 33, 126, 42, 39, 40, 41) then
      o := o || chr(c);
    else
      o := o || '%' || upper(lpad(to_hex(c), 2, '0'));
    end if;
  end loop;
  return o;
end; $$;

-- ============================================================================
-- wa_reminders
-- ============================================================================
create table if not exists public.wa_reminders (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references public.leads (id) on delete cascade,
  kind              text not null check (kind in ('bon_voyage', 'welcome_back')),
  due_on            date not null,                 -- в какой день писать
  status            text not null default 'due' check (status in ('due', 'sent', 'skipped', 'auto_sent')),
  done_by           uuid references public.profiles (id) on delete set null,   -- кто отметил «отправлено»
  done_at           timestamptz,
  -- место под автоотправку (режим auto, §4.12); сейчас не используется
  attempts          int not null default 0,
  provider_response jsonb,
  auto_sent_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (lead_id, kind)
);
create index if not exists wa_reminders_due_idx on public.wa_reminders (due_on) where status = 'due';

alter table public.wa_reminders enable row level security;
drop policy if exists "reminders: staff read" on public.wa_reminders;
create policy "reminders: staff read" on public.wa_reminders for select using (public.is_staff());
-- пишут только триггер и функции ниже
revoke insert, update, delete on public.wa_reminders from anon, authenticated;

-- Напоминание положено продаже, если она не возвращена, у неё есть телефон и нужная дата:
--   bon_voyage   — накануне вылета;  welcome_back — на следующий день после возвращения.
-- Перенос даты переносит напоминание (уже отправленное снова становится «написать», если
-- новый день ещё не прошёл: клиенту нужно сообщение накануне настоящего вылета).
-- Возврат продажи или стёртая дата снимают неотправленное; отмена возврата его возвращает.
create or replace function public.leads_reminders()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Yerevan')::date;
  v_ok    boolean := new.status = 'won' and length(coalesce(new.phone_digits, '')) >= 8;
  k       text;
  want    date;
  r       public.wa_reminders;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.phone is not distinct from old.phone
     and new.depart_on is not distinct from old.depart_on and new.return_on is not distinct from old.return_on then
    return null;
  end if;
  foreach k in array array['bon_voyage', 'welcome_back'] loop
    want := case when not v_ok then null when k = 'bon_voyage' then new.depart_on - 1 else new.return_on + 1 end;
    select * into r from public.wa_reminders where lead_id = new.id and kind = k;
    if not found then
      if want is not null then
        insert into public.wa_reminders (lead_id, kind, due_on) values (new.id, k, want);
      end if;
    elsif want is null then
      update public.wa_reminders set status = 'skipped', updated_at = now() where id = r.id and status = 'due';
    elsif r.due_on <> want then
      if r.status in ('sent', 'auto_sent') and want < v_today then
        update public.wa_reminders set due_on = want, updated_at = now() where id = r.id;
      else
        update public.wa_reminders set due_on = want, status = 'due', done_by = null, done_at = null, updated_at = now() where id = r.id;
      end if;
    elsif r.status = 'skipped' then
      update public.wa_reminders set status = 'due', updated_at = now() where id = r.id;
    end if;
  end loop;
  return null;
end; $$;
drop trigger if exists leads_reminders on public.leads;
create trigger leads_reminders after insert or update on public.leads
  for each row execute function public.leads_reminders();

-- продажи, внесённые до этой миграции с уже заполненными датами (повторный накат)
insert into public.wa_reminders (lead_id, kind, due_on)
select l.id, v.k, case v.k when 'bon_voyage' then l.depart_on - 1 else l.return_on + 1 end
from public.leads l cross join (values ('bon_voyage'), ('welcome_back')) v(k)
where l.status = 'won' and length(coalesce(l.phone_digits, '')) >= 8
  and case v.k when 'bon_voyage' then l.depart_on else l.return_on end is not null
on conflict (lead_id, kind) do nothing;

-- ============================================================================
-- кому писать в этот день
-- ============================================================================
-- Одно определение — для панели и для письма. В день p_day показываются неотправленные:
--   «хорошего полёта»  — с кануна вылета и до самого дня вылета;
--   «с возвращением»   — со следующего дня после возвращения и ещё 7 дней.
-- Всё, что должно было уйти раньше p_day, помечено overdue («просрочено»).
-- Текст собран на языке клиента (leads.lang), ссылка wa.me — с уже набранным текстом.
create or replace function public.reminders_list(p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select public.wa_settings() ->> 'review_url' as review)
  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_on, x.name, x.id), '[]'::jsonb)
  from (
    select r.id, r.lead_id, r.kind, r.due_on, (r.due_on < p_day) as overdue,
           l.name, l.phone, l.phone_digits, l.tour,
           coalesce(nullif(btrim(t.i18n -> 'ru' ->> 'title'), ''), nullif(btrim(t.i18n -> 'en' ->> 'title'), ''), l.tour) as tour_name,
           public.reminder_lang(l.lang) as lang, l.depart_on, l.return_on, l.wa_opt_in,
           m.body as text,
           'https://wa.me/' || l.phone_digits || '?text=' || public.url_encode(m.body) as wa_url
    from public.wa_reminders r
    join public.leads l on l.id = r.lead_id
    left join public.tours t on t.slug = l.tour
    cross join s
    cross join lateral (select public.reminder_fill(
        public.reminder_body(r.kind, l.lang), l.name,
        coalesce(nullif(btrim(t.i18n -> public.reminder_lang(l.lang) ->> 'title'), ''), nullif(btrim(t.i18n -> 'en' ->> 'title'), '')),
        case when r.kind = 'welcome_back' then s.review end) as body) m
    where r.status = 'due' and l.status = 'won'
      and r.due_on <= p_day
      and p_day <= case r.kind when 'bon_voyage' then l.depart_on else r.due_on + 7 end
  ) x;
$$;

-- Панель: блок «Написать сегодня» (и счётчик в меню) + «Ближайшие вылеты» на 7 дней.
create or replace function public.reminders_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d    date := (now() at time zone 'Asia/Yerevan')::date;
  v_on boolean := (public.wa_settings() ->> 'enabled')::boolean;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'today', d,
    'enabled', v_on,
    'items', case when v_on then public.reminders_list(d) else '[]'::jsonb end,
    'upcoming', coalesce((select jsonb_agg(to_jsonb(x) order by x.depart_on, x.name, x.id) from (
        select l.id, l.name, l.phone, l.tour, l.lang, l.depart_on, l.return_on,
               (select r.status from public.wa_reminders r where r.lead_id = l.id and r.kind = 'bon_voyage') as reminder
        from public.leads l
        where l.status = 'won' and l.depart_on between d and d + 7) x), '[]'::jsonb));
end; $$;

-- Отметить «отправлено» (кнопка «Отправить в WhatsApp» или вручную); p_done = false —
-- снять отметку. В историю продажи ложится запись, кто и что отправил.
create or replace function public.reminder_done(p_id uuid, p_done boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r public.wa_reminders;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select * into r from public.wa_reminders where id = p_id for update;
  if not found then raise exception 'reminder_not_found'; end if;
  if coalesce(p_done, true) and r.status = 'due' then
    update public.wa_reminders set status = 'sent', done_by = auth.uid(), done_at = now(), updated_at = now()
     where id = p_id returning * into r;
    insert into public.lead_activity (lead_id, actor, kind, body, meta)
    values (r.lead_id, auth.uid(), 'whatsapp',
            case r.kind when 'bon_voyage' then 'Напоминание накануне вылета отправлено' else 'Сообщение «с возвращением» отправлено' end,
            jsonb_build_object('reminder', r.kind));
  elsif not coalesce(p_done, true) and r.status = 'sent' then
    update public.wa_reminders set status = 'due', done_by = null, done_at = null, updated_at = now()
     where id = p_id returning * into r;
  end if;
  return to_jsonb(r);
end; $$;

-- Единственная точка, через которую сообщение уходит клиенту от имени системы.
-- Сейчас она ничего не отправляет и оставляет запись человеку. Когда появится разрешение
-- Meta, вызов WhatsApp Cloud API дописывается сюда (и в режиме auto её зовёт reminders_tick);
-- статус auto_sent и поля attempts / provider_response / auto_sent_at уже есть.
create or replace function public.send_reminder(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from public.wa_reminders where id = p_id) then raise exception 'reminder_not_found'; end if;
  return jsonb_build_object('sent', false, 'reason', 'manual_mode');
end; $$;

-- ============================================================================
-- письмо на почту агентства
-- ============================================================================
-- Идёт тем же путём, что письмо о заявке (050_notify.sql): строка в notify_log →
-- функция lead-mail забирает её через notify_claim() и отчитывается через notify_done().
alter table public.notify_log add column if not exists kind text not null default 'lead';
alter table public.notify_log add column if not exists day date;
alter table public.notify_log add column if not exists payload jsonb;
alter table public.notify_log alter column lead_id drop not null;
alter table public.notify_log drop constraint if exists notify_log_kind_check;
alter table public.notify_log add constraint notify_log_kind_check check (
  (kind = 'lead' and lead_id is not null) or (kind = 'reminders' and day is not null and payload is not null));
create unique index if not exists notify_log_reminders_day_idx on public.notify_log (day) where kind = 'reminders';

-- Сбор письма за день: кому писать, с текстами и ссылками. Некому — null, письма нет.
create or replace function public.reminders_digest(p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d     date := coalesce(p_day, (now() at time zone 'Asia/Yerevan')::date);
  items jsonb := public.reminders_list(d);
begin
  if jsonb_array_length(items) = 0 then return null; end if;
  return jsonb_build_object('day', d, 'count', jsonb_array_length(items), 'items', items);
end; $$;

-- Раз в день, в час из настроек (по Еревану): есть кому писать — одно письмо в очередь.
-- Продажа, внесённая позже этого часа, в письмо уже не попадает — она сразу видна в панели.
create or replace function public.reminders_mail_queue(p_now timestamptz default now())
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  s  jsonb := public.wa_settings();
  d  date  := (p_now at time zone 'Asia/Yerevan')::date;
  dg jsonb;
begin
  if not (s ->> 'enabled')::boolean then return false; end if;
  if extract(hour from (p_now at time zone 'Asia/Yerevan'))::int <> (s ->> 'mail_hour')::int then return false; end if;
  if exists (select 1 from public.notify_log where kind = 'reminders' and day = d) then return false; end if;
  dg := public.reminders_digest(d);
  if dg is null then return false; end if;
  insert into public.notify_log (kind, day, payload) values ('reminders', d, dg) on conflict do nothing;
  return found;
end; $$;

-- Каждые 5 минут (pg_cron): поставить письмо дня в очередь, когда пришёл его час, и
-- подтолкнуть функцию почты, если в очереди что-то ждёт (в том числе повтор неудачного).
create or replace function public.reminders_tick()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.reminders_mail_queue();
  perform public.notify_kick();
end; $$;

-- notify_claim из 050 + письма-напоминания: у них нет заявки, зато есть kind и digest.
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
    returning n.id, n.lead_id, n.attempts, n.kind, n.payload
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('id', u.id, 'attempt', u.attempts, 'to', v_to, 'kind', u.kind)
           || case when u.kind = 'reminders' then jsonb_build_object('digest', u.payload)
              else jsonb_build_object('lead', jsonb_build_object(
                'id', l.id, 'created_at', l.created_at, 'name', l.name, 'phone', l.phone, 'phone_digits', l.phone_digits,
                'tour', l.tour, 'tour_title', coalesce(t.i18n -> 'ru' ->> 'title', t.i18n -> 'en' ->> 'title'),
                'message', l.message, 'coupon_code', l.coupon_code, 'source', l.source, 'lang', l.lang,
                'utm_source', l.utm_source, 'utm_campaign', l.utm_campaign)) end), '[]'::jsonb)
    into v_out
    from upd u
    left join public.leads l on l.id = u.lead_id
    left join public.tours t on t.slug = l.tour
   where u.kind = 'reminders' or l.id is not null;
  return v_out;
end; $$;

-- ---------- права -----------------------------------------------------------
revoke all on function public.reminders_today()               from public, anon;
revoke all on function public.reminder_done(uuid, boolean)    from public, anon;
grant execute on function public.reminders_today()            to authenticated;   -- роль проверяют сами
grant execute on function public.reminder_done(uuid, boolean) to authenticated;
revoke all on function public.reminders_list(date)                from public, anon, authenticated;
revoke all on function public.reminders_digest(date)              from public, anon, authenticated;
revoke all on function public.reminders_mail_queue(timestamptz)   from public, anon, authenticated;
revoke all on function public.reminders_tick()                    from public, anon, authenticated;
revoke all on function public.send_reminder(uuid)                 from public, anon, authenticated;
revoke all on function public.reminder_body(text, text)           from public, anon, authenticated;
revoke all on function public.wa_settings()                       from public, anon, authenticated;
revoke all on function public.leads_reminders()                   from public, anon, authenticated;
revoke all on function public.notify_claim(uuid, int)             from public, anon, authenticated;

-- Расписание: там, где есть pg_cron (в тестах его нет — они зовут сбор письма напрямую).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'reminders-mail';
    perform cron.schedule('reminders-mail', '*/5 * * * *', 'select public.reminders_tick()');
  end if;
end $$;
