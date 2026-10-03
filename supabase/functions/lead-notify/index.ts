// ============================================================================
// New lead → Telegram message to the owner / managers  (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Wiring (Supabase dashboard):
//   Database → Webhooks → Create: table public.leads, event INSERT,
//   type "Supabase Edge Functions" → lead-notify, HTTP header
//   x-webhook-secret: <the same value as WEBHOOK_SECRET below>
//
// Secrets (Edge Functions → Secrets), never in the browser:
//   TELEGRAM_BOT_TOKEN   token from @BotFather
//   TELEGRAM_CHAT_ID     chat or group id (add the bot to the group, then
//                        open https://api.telegram.org/bot<TOKEN>/getUpdates)
//   WEBHOOK_SECRET       any long random string
//   PANEL_URL            https://samtravel.am/admin.html   (for the "open" link)
//
// Deploy:  supabase functions deploy lead-notify --no-verify-jwt
// ============================================================================

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const CHAT = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';
const PANEL = Deno.env.get('PANEL_URL') ?? 'https://samtravel.am/admin.html';

const SOURCE: Record<string, string> = {
  form: 'Форма на сайте', plan: 'Подбор тура', tour: 'Карточка тура', promo: 'Промо',
  manual: 'WhatsApp', phone: 'Звонок', walk_in: 'Визит в офис', instagram: 'Instagram Direct',
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!SECRET || req.headers.get('x-webhook-secret') !== SECRET) return new Response('forbidden', { status: 403 });
  if (!TOKEN || !CHAT) return new Response('telegram not configured', { status: 500 });

  const body = await req.json().catch(() => null);
  const l = body?.record;
  if (!l || body?.type !== 'INSERT') return new Response('ignored');
  // manual leads are typed in by the team itself — no need to ping them
  if (['manual', 'phone', 'walk_in', 'instagram'].includes(l.source)) return new Response('skipped');

  const digits = String(l.phone ?? '').replace(/\D/g, '');
  const lines = [
    `🆕 <b>Новая заявка</b> — ${esc(SOURCE[l.source] ?? l.source)}`,
    `👤 ${esc(l.name)}`,
    `📞 ${esc(l.phone)}`,
    l.tour ? `🧭 ${esc(l.tour)}` : '',
    l.message ? `💬 ${esc(String(l.message).slice(0, 500))}` : '',
    l.coupon_code ? `🏷 Промокод: <code>${esc(l.coupon_code)}</code>` : '',
    l.utm_campaign ? `📣 Реклама: ${esc([l.utm_source, l.utm_campaign].filter(Boolean).join(' / '))}` : '',
  ].filter(Boolean).join('\n');

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT, text: lines, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[
        { text: 'Написать в WhatsApp', url: `https://wa.me/${digits}` },
        { text: 'Открыть в панели', url: `${PANEL}#/leads/${l.id}` },
      ]] },
    }),
  });
  return new Response(res.ok ? 'sent' : 'telegram error ' + res.status, { status: res.ok ? 200 : 502 });
});
