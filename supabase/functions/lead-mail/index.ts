// ============================================================================
// lead-mail — письмо агентству о новой заявке с сайта  (Supabase Edge Function, Deno)
// ----------------------------------------------------------------------------
//   Database Webhook на INSERT в public.leads → эта функция → почтовый сервис.
//   Адрес получателя — почта из «Контакты и реквизиты» (site_settings.contacts.email).
//   Заявки, внесённые вручную, писем не шлют. Результат пишется в notify_log;
//   неудачные повторяются раз в 5 минут, не больше 5 попыток
//   (pg_cron → notify_kick() → эта же функция с телом {"type":"retry"}).
//   Правила — в supabase/migrations/050_notify.sql, логика — в handler.mjs.
//
//   Этап 9: та же функция шлёт письмо дня «Сегодня написать: N клиентов» — напоминания
//   о вылетах со ссылками wa.me (090_reminders.sql). Его ставит в очередь pg_cron
//   (reminders_tick → notify_kick → эта функция с телом {"type":"retry"}); вебхук на
//   leads для этого не нужен. Клиентам функция ничего не отправляет.
//
// Вебхук (Supabase → Database → Webhooks): таблица leads, событие Insert, метод POST,
// адрес функции, HTTP-заголовок  x-webhook-secret: <WEBHOOK_SECRET>.
// «Verify JWT» у функции выключить — её защищает секрет вебхука.
//
// Секреты (Supabase → Edge Functions → Secrets), в коде и в браузере их нет:
//   WEBHOOK_SECRET        длинная случайная строка, та же, что в заголовке вебхука
//   SB_URL, SB_SERVICE_ROLE_KEY   не нужны: функция берёт SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY,
//                         которые Supabase даёт ей сам
//   SITE_URL              https://samtravel-dny.pages.dev ← для ссылки «Открыть в панели»
//   MAIL_PROVIDER         resend (по умолчанию) | brevo | mailjet
//   MAIL_API_KEY          ключ почтового сервиса (для mailjet — API Key)
//   MAIL_API_SECRET       только для mailjet: Secret Key
//   MAIL_FROM             SAM TRAVEL <leads@samtravel.am>   ← адрес на подтверждённом домене
//   MAIL_API_URL          необязательно: другой адрес API (проверка на стенде)
// ============================================================================
import { handle } from './handler.mjs';

// Supabase gives every function SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY by itself, so SB_URL and
// SB_SERVICE_ROLE_KEY need not be set by hand (they still win when they are — for a test stand).
Deno.serve((req) => {
  const env = Deno.env.toObject();
  return handle(req, { SB_URL: env.SUPABASE_URL, SB_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY, ...env });
});
