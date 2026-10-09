-- ============================================================================
-- SAM TRAVEL — ошибки по итогам аудита  (миграция 110, этап 11)
-- ============================================================================
-- Накатывать только вместе со всем набором, по порядку номеров (после 090; если в
-- наборе есть 100_security.sql — после неё). Повторный накат всего набора безопасен.
-- Задание: AUDIT.md, раздел B.
--
--   B4   телефон продажи «091 22 33 44» → «+374 91 223344»: иначе ссылка wa.me ведёт в никуда
--   B3   в день вылета напоминание говорит «Сегодня ваш вылет», а не «Завтра»:
--        третий текст на EN / RU / HY (wa_templates.variant = 'today')
--   B23  письмо дня встаёт в очередь в свой час И ПОЗЖЕ (раньше — только пока шёл этот час),
--        по-прежнему одно в день; задание, зависшее после пятой попытки, закрывается;
--        notify_status() отвечает на вопрос «письмо с напоминаниями настроено и уходит?»
--   B14  set_consent() — клиент включает и выключает рассылку в кабинете
--   хвост: событие form_start (форма заявки снята этапом 7) больше не принимается
--
-- Политики RLS и права на функции старых миграций здесь не меняются — это этап 10.
-- Те же правила для демо-режима — js/admin/metrics.js (phoneNorm) и js/admin/reminders.js;
-- supabase/test/110-fixes.test.mjs сверяет их с этой миграцией.
-- ============================================================================

-- ============================================================================
-- хвост: form_start
-- ============================================================================
-- track() переопределяли три миграции, и этап 10 (100_security.sql) переписывает её ещё
-- раз. Чтобы не затереть чужую версию своей копией, из действующего текста функции
-- убирается одно имя события — что бы ни стояло вокруг него.
do $$
declare d text;
begin
  select pg_get_functiondef('public.track(jsonb)'::regprocedure) into d;
  if d like '%''form_start''%' then
    d := regexp_replace(d, ',\s*''form_start''', '', 'g');
    d := regexp_replace(d, '''form_start''\s*,\s*', '', 'g');
    execute d;
  end if;
end $$;

-- ============================================================================
-- B4: телефон продажи
-- ============================================================================
-- Армянский номер, записанный по-домашнему — с нулём и без кода страны («091 22 33 44»), —
-- переписывается в международный вид. Всё остальное остаётся как введено: номер другой
-- страны без кода система угадать не может, о нём предупреждает форма продажи.
create or replace function public.phone_norm(p_phone text)
returns text language sql immutable as $$
  select case
    when btrim(coalesce(p_phone, '')) !~ '^\+' and regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') ~ '^0\d{8}$'
      then '+374 ' || substr(regexp_replace(p_phone, '\D', '', 'g'), 2, 2) || ' ' || substr(regexp_replace(p_phone, '\D', '', 'g'), 4)
    else p_phone
  end;
$$;

create or replace function public.leads_phone_norm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    new.phone := public.phone_norm(new.phone);
  end if;
  return new;
end; $$;
drop trigger if exists leads_phone_norm on public.leads;
create trigger leads_phone_norm before insert or update on public.leads
  for each row execute function public.leads_phone_norm();

revoke all on function public.phone_norm(text)     from public, anon, authenticated;   -- зовёт только триггер
revoke all on function public.leads_phone_norm()   from public, anon, authenticated;

-- записи, внесённые до этой миграции
update public.leads set phone = public.phone_norm(phone) where phone is distinct from public.phone_norm(phone);

-- ============================================================================
-- B3: «Сегодня ваш вылет»
-- ============================================================================
-- Напоминание «хорошего полёта» висит в списке с кануна вылета по день вылета
-- включительно. В сам день вылета текст «Завтра ваш вылет» — неправда, поэтому у вида
-- bon_voyage два текста на язык: обычный (variant is null) и «в день вылета»
-- (variant = 'today'). Отдельным видом (kind) его сделать нельзя: проверку списка видов
-- ставит 090 и при повторном накате набора она отвергла бы новые строки.
alter table public.wa_templates add column if not exists variant text;
alter table public.wa_templates drop constraint if exists wa_templates_variant_check;
alter table public.wa_templates add constraint wa_templates_variant_check
  check (variant is null or (variant = 'today' and kind = 'bon_voyage'));
-- один текст на (вид, язык, вариант); имя индекса прежнее — 090 при повторном накате его не трогает
drop index if exists public.wa_templates_kind_lang_idx;
create unique index wa_templates_kind_lang_idx on public.wa_templates (kind, lang, coalesce(variant, '')) where kind is not null;

-- Тексты по умолчанию; «в день вылета» — под ключом bon_voyage_today.
-- Армянский и английский нужно вычитать носителю.
create or replace function public.reminder_default(p_kind text, p_lang text)
returns text language sql immutable as $$
  select case p_kind || ':' || p_lang
    when 'bon_voyage:ru'   then 'Здравствуйте, {name}! Завтра ваш вылет[ в {tour}]. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL'
    when 'bon_voyage:en'   then 'Hello, {name}! Your flight[ to {tour}] is tomorrow. Have a great flight and a wonderful holiday! SAM TRAVEL'
    when 'bon_voyage:hy'   then 'Բարև ձեզ, {name}։ Վաղը ձեր թռիչքն է[՝ {tour}]։ Մաղթում ենք բարի թռիչք և հիանալի հանգիստ։ SAM TRAVEL'
    when 'bon_voyage_today:ru' then 'Здравствуйте, {name}! Сегодня ваш вылет[ в {tour}]. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL'
    when 'bon_voyage_today:en' then 'Hello, {name}! Your flight[ to {tour}] is today. Have a great flight and a wonderful holiday! SAM TRAVEL'
    when 'bon_voyage_today:hy' then 'Բարև ձեզ, {name}։ Այսօր ձեր թռիչքն է[՝ {tour}]։ Մաղթում ենք բարի թռիչք և հիանալի հանգիստ։ SAM TRAVEL'
    when 'welcome_back:ru' then 'С возвращением, {name}![ Надеемся, {tour} понравился.] Будем рады вашему отзыву[: {review}]'
    when 'welcome_back:en' then 'Welcome back, {name}![ We hope you enjoyed {tour}.] We would be glad to hear your feedback[: {review}]'
    when 'welcome_back:hy' then 'Բարի վերադարձ, {name}։[ Հուսով ենք՝ {tour} ուղևորությունը ձեզ դուր եկավ։] Ուրախ կլինենք ստանալ ձեր կարծիքը[՝ {review}]'
  end;
$$;

insert into public.wa_templates (title, lang, body, sort, kind, variant)
select 'В день вылета', v.l, public.reminder_default('bon_voyage_today', v.l), 106 + v.ord, 'bon_voyage', 'today'
from (values ('ru', 0), ('hy', 1), ('en', 2)) v(l, ord)
where not exists (select 1 from public.wa_templates t where t.kind = 'bon_voyage' and t.variant = 'today' and t.lang = v.l);

-- обычный текст вида: вариант «в день вылета» сюда попадать не должен
create or replace function public.reminder_body(p_kind text, p_lang text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.body from public.wa_templates t
      where t.kind = p_kind and t.variant is null and t.lang = public.reminder_lang(p_lang) and btrim(t.body) <> ''
      order by t.sort, t.created_at limit 1),
    public.reminder_default(p_kind, public.reminder_lang(p_lang)));
$$;

-- текст с вариантом: шаблон владельца, иначе текст по умолчанию
create or replace function public.reminder_text(p_kind text, p_lang text, p_variant text)
returns text language sql stable security definer set search_path = public as $$
  select case when p_variant is null then public.reminder_body(p_kind, p_lang) else coalesce(
    (select t.body from public.wa_templates t
      where t.kind = p_kind and t.variant = p_variant and t.lang = public.reminder_lang(p_lang) and btrim(t.body) <> ''
      order by t.sort, t.created_at limit 1),
    public.reminder_default(p_kind || '_' || p_variant, public.reminder_lang(p_lang)),
    public.reminder_body(p_kind, p_lang)) end;
$$;
revoke all on function public.reminder_text(text, text, text) from public, anon, authenticated;

-- reminders_list из 090 + вариант текста: bon_voyage в день вылета → 'today'
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
        public.reminder_text(r.kind, l.lang, case when r.kind = 'bon_voyage' and p_day >= l.depart_on then 'today' end), l.name,
        coalesce(nullif(btrim(t.i18n -> public.reminder_lang(l.lang) ->> 'title'), ''), nullif(btrim(t.i18n -> 'en' ->> 'title'), '')),
        case when r.kind = 'welcome_back' then s.review end) as body) m
    where r.status = 'due' and l.status = 'won'
      and r.due_on <= p_day
      and p_day <= case r.kind when 'bon_voyage' then l.depart_on else r.due_on + 7 end
  ) x;
$$;

-- ============================================================================
-- B23: письмо дня
-- ============================================================================
-- Раньше письмо вставало в очередь, только пока шёл час из настроек: расписание или база
-- простояли этот час — письма за день не было. Теперь — в свой час и в любой момент после
-- него до конца суток; «одно в день» держит уникальный индекс по дню.
create or replace function public.reminders_mail_queue(p_now timestamptz default now())
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  s  jsonb := public.wa_settings();
  d  date  := (p_now at time zone 'Asia/Yerevan')::date;
  dg jsonb;
begin
  if not (s ->> 'enabled')::boolean then return false; end if;
  if extract(hour from (p_now at time zone 'Asia/Yerevan'))::int < (s ->> 'mail_hour')::int then return false; end if;
  if exists (select 1 from public.notify_log where kind = 'reminders' and day = d) then return false; end if;
  dg := public.reminders_digest(d);
  if dg is null then return false; end if;
  insert into public.notify_log (kind, day, payload) values ('reminders', d, dg) on conflict do nothing;
  return found;
end; $$;

-- Задание берут не больше пяти раз. Если функция почты взяла его в пятый раз и не
-- отчиталась (упала посреди отправки), строка навсегда оставалась «ждёт отправки»:
-- брать её больше нельзя, а «не доставлено» ей никто не поставил.
create or replace function public.notify_sweep()
returns integer language plpgsql volatile security definer set search_path = public as $$
declare n integer;
begin
  update public.notify_log
     set status = 'failed', last_error = coalesce(last_error, 'no answer after the 5th attempt'), updated_at = now()
   where status = 'pending' and attempts >= 5 and next_try_at <= now();
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.notify_sweep() from public, anon, authenticated;

create or replace function public.reminders_tick()
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.notify_sweep();
  perform public.reminders_mail_queue();
  perform public.notify_kick();
end; $$;

-- «Готовность сайта»: к прежнему ответу добавлен блок reminders — настроено ли письмо дня
-- и уходит ли оно. Владельцу, как и раньше.
--   enabled      напоминания включены
--   mail_hour    час письма по Еревану
--   mail_to      на почту агентства есть куда слать («Контакты» → Email)
--   schedule     расписание reminders-mail стоит (pg_cron)
--   secrets      адрес функции почты и секрет лежат в Vault (lead_mail_url, lead_mail_secret)
--   last_sent_at когда ушло последнее письмо дня;  last_day — за какой день
--   pending      ждут отправки;  failed_7d — не доставлено за 7 дней;  last_error — причина
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
    'mail_to',      coalesce(btrim((select value ->> 'email' from public.site_settings where key = 'contacts')), '') <> '',
    'schedule',     v_schedule,
    'secrets',      v_secrets,
    'last_sent_at', max(n.sent_at),
    'last_day',     max(n.day) filter (where n.status = 'sent'),
    'pending',      count(*) filter (where n.status = 'pending'),
    'failed_7d',    count(*) filter (where n.status = 'failed' and n.updated_at > now() - interval '7 days'),
    'last_error',   (select x.last_error from public.notify_log x where x.kind = 'reminders' and x.status <> 'sent' and x.last_error is not null order by x.updated_at desc limit 1))
    from public.notify_log n where n.kind = 'reminders'));
end; $$;

-- ============================================================================
-- B14: согласие на рассылку из кабинета
-- ============================================================================
-- До сих пор о рассылке спрашивали один раз — при регистрации или на экране первого входа;
-- передумать было негде. Источник согласия, данного в кабинете, — 'cabinet'. Если список
-- допустимых источников (его вводит этап 10) такого значения не знает, записывается
-- 'onboarding_social': согласие важнее подписи к нему.
create or replace function public.set_consent(p_consent boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v boolean := coalesce(p_consent, false);
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  begin
    update public.profiles p set
      consent_at        = case when not v then null when p.marketing_consent then p.consent_at else now() end,
      consent_source    = case when v and not p.marketing_consent then 'cabinet' else p.consent_source end,
      marketing_consent = v
    where p.id = auth.uid();
  exception when check_violation then
    update public.profiles p set
      consent_at        = case when not v then null when p.marketing_consent then p.consent_at else now() end,
      consent_source    = case when v and not p.marketing_consent then 'onboarding_social' else p.consent_source end,
      marketing_consent = v
    where p.id = auth.uid();
  end;
  return public.my_profile();
end; $$;
revoke all on function public.set_consent(boolean) from public, anon;
grant execute on function public.set_consent(boolean) to authenticated;
