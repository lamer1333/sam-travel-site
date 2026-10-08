// Логика функции lead-mail без привязки к среде: только fetch / Request / Response,
// поэтому тот же файл работает в Deno (index.ts) и в тестах на Node
// (supabase/test/50-notify.test.mjs). Все настройки приходят в `env`, ключей в коде нет.

const MANUAL = ['manual', 'phone', 'walk_in', 'instagram'];
const SECRET_HEADER = 'x-webhook-secret';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** сравнение без утечки по времени: секрет нельзя подобрать по скорости ответа */
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

/** Письмо о заявке: тема, текст и HTML. Экспортируется для тестов. */
export function buildMail(lead, env) {
  const site = (env.SITE_URL || '').replace(/\/+$/, '');
  const digits = String(lead.phone_digits || lead.phone || '').replace(/\D/g, '');
  const wa = digits.length >= 8 ? 'https://wa.me/' + digits : '';
  const panel = site ? site + '/admin.html#/sales/' + lead.id : '';
  const tour = lead.tour_title || lead.tour || '';
  const from = [lead.utm_source, lead.utm_campaign].filter(Boolean).join(' / ');
  const rows = [
    ['Имя', lead.name], ['Телефон', lead.phone], ['Тур', tour], ['Сообщение', lead.message],
    ['Промокод', lead.coupon_code], ['Откуда', from],
  ].filter(([, v]) => v);
  const subject = 'Новая заявка: ' + lead.name + (tour ? ' · ' + tour : '');
  const text = rows.map(([k, v]) => k + ': ' + v).join('\n')
    + (wa ? '\n\nНаписать в WhatsApp: ' + wa : '') + (panel ? '\nОткрыть в панели: ' + panel : '');
  const btn = (href, label, bg, fg) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:10px;background:${bg};color:${fg};font-weight:600;text-decoration:none">${label}</a>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0B0D12;max-width:560px">
<h2 style="margin:0 0 14px;font-size:19px">Новая заявка с сайта</h2>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px">
${rows.map(([k, v]) => `<tr><td style="padding:5px 16px 5px 0;color:#667085;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:5px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('\n')}
</table>
${wa ? btn(wa, 'Написать в WhatsApp', '#1FA855', '#ffffff') : ''}${panel ? btn(panel, 'Открыть в панели', '#EEF1F5', '#0B0D12') : ''}
</div>`;
  return { subject, text, html };
}

const KIND_LABEL = { bon_voyage: 'Вылет завтра — хорошего полёта', bon_voyage_today: 'Вылет сегодня — хорошего полёта', welcome_back: 'Вернулись — с возвращением' };
const dayRu = (d) => { const [y, m, dd] = String(d || '').split('-'); return dd ? dd + '.' + m + '.' + y : ''; };
const clients = (n) => { const a = n % 10, b = n % 100; return n + ' ' + (a === 1 && b !== 11 ? 'клиент' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'клиента' : 'клиентов'); };

/**
 * Письмо «Сегодня написать: N клиентов» (напоминания о вылетах, 090_reminders.sql).
 * Кому писать, текст на языке клиента и ссылку wa.me собрала база (reminders_digest):
 * здесь только вёрстка. Сообщение клиенту отправляет человек — кнопка открывает чат
 * с уже набранным текстом. Экспортируется для тестов.
 */
export function buildDigestMail(digest, env) {
  const site = (env.SITE_URL || '').replace(/\/+$/, '');
  const panel = site ? site + '/admin.html#/dashboard' : '';
  const items = digest.items || [];
  // «хорошего полёта» висит в списке и в день вылета — тогда вылет уже не «завтра»
  const kindOf = (it) => (it.kind === 'bon_voyage' && it.depart_on && digest.day && it.depart_on <= digest.day ? 'bon_voyage_today' : it.kind);
  const what = (it) => (KIND_LABEL[kindOf(it)] || it.kind) + (it.overdue ? ' (просрочено)' : '');
  const when = (it) => (it.kind === 'bon_voyage' ? 'вылет ' + dayRu(it.depart_on) : 'вернулись ' + dayRu(it.return_on));
  const subject = 'Сегодня написать: ' + clients(items.length);
  const text = items.map((it) => [it.name + (it.tour_name ? ' · ' + it.tour_name : '') + ' · ' + when(it), what(it), it.text, 'Отправить в WhatsApp: ' + it.wa_url].join('\n')).join('\n\n')
    + (panel ? '\n\nОтметить отправленные в панели: ' + panel : '');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0B0D12;max-width:560px">
<h2 style="margin:0 0 6px;font-size:19px">${esc(subject)}</h2>
<p style="margin:0 0 16px;color:#667085">Кнопка открывает чат с клиентом, текст уже набран на его языке — остаётся нажать «отправить».</p>
${items.map((it) => `<div style="border:1px solid #E4E7EC;border-radius:12px;padding:14px 16px;margin:0 0 12px">
<div style="font-weight:700">${esc(it.name)}${it.tour_name ? ' · ' + esc(it.tour_name) : ''}</div>
<div style="color:#667085;font-size:13px;margin:2px 0 8px">${esc(what(it))} · ${esc(when(it))} · ${esc(it.phone)}</div>
<div style="background:#F5F6F8;border-radius:8px;padding:9px 11px;margin:0 0 10px;white-space:pre-wrap">${esc(it.text)}</div>
<a href="${esc(it.wa_url)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1FA855;color:#ffffff;font-weight:600;text-decoration:none">Отправить в WhatsApp</a>
</div>`).join('\n')}
${panel ? `<p style="margin:14px 0 0"><a href="${esc(panel)}" style="color:#667085">Отметить отправленные в панели</a></p>` : ''}
</div>`;
  return { subject, text, html };
}

/** Отправка через почтовый сервис из переменных окружения. Бросает ошибку с причиной. */
async function sendMail(mail, to, key, env, fetchImpl) {
  const provider = (env.MAIL_PROVIDER || 'resend').toLowerCase();
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) throw new Error('mail_not_configured');
  let url, headers, body;
  if (provider === 'resend') {
    url = env.MAIL_API_URL || 'https://api.resend.com/emails';
    headers = { Authorization: 'Bearer ' + env.MAIL_API_KEY, 'Idempotency-Key': key };
    body = { from: env.MAIL_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text };
  } else if (provider === 'brevo') {
    url = env.MAIL_API_URL || 'https://api.brevo.com/v3/smtp/email';
    headers = { 'api-key': env.MAIL_API_KEY };
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(env.MAIL_FROM);
    body = { sender: m ? { name: m[1], email: m[2] } : { email: env.MAIL_FROM.trim() }, to: [{ email: to }], subject: mail.subject, htmlContent: mail.html, textContent: mail.text };
  } else {
    throw new Error('unknown MAIL_PROVIDER: ' + provider);
  }
  const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('mail ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 300));
}

async function rpc(name, args, env, fetchImpl) {
  const res = await fetchImpl(env.SB_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.SB_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SB_SERVICE_ROLE_KEY },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('db ' + name + ' ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 300));
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

/**
 * Принимает:
 *   • вебхук базы на вставку в leads  { type: 'INSERT', table: 'leads', record: {...} }
 *   • повтор неудачных (pg_cron)      { type: 'retry' }
 * Оба — только с заголовком x-webhook-secret. Что и кому слать, решает база
 * (notify_claim): из тела вебхука берётся только id заявки. В режиме «повтор» база
 * отдаёт и письмо дня с напоминаниями о вылетах (job.kind === 'reminders').
 */
export async function handle(req, env, fetchImpl = fetch) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env.WEBHOOK_SECRET || !env.SB_URL || !env.SB_SERVICE_ROLE_KEY) return json({ error: 'not_configured' }, 500);
  if (!(await sameSecret(req.headers.get(SECRET_HEADER) || '', env.WEBHOOK_SECRET))) return json({ error: 'forbidden' }, 401);

  let p;
  try { p = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  let leadId = null;
  if (p && p.type === 'retry') {
    leadId = null;
  } else if (p && p.type === 'INSERT' && p.table === 'leads' && (p.schema || 'public') === 'public' && p.record && /^[0-9a-f-]{36}$/i.test(p.record.id || '')) {
    if (MANUAL.includes(p.record.source)) return json({ sent: 0, failed: 0, skipped: 'manual' });
    leadId = p.record.id;
  } else {
    return json({ sent: 0, failed: 0, skipped: 'not_a_lead_insert' });
  }

  let jobs;
  try { jobs = await rpc('notify_claim', leadId ? { p_lead: leadId } : {}, env, fetchImpl); }
  catch (e) { console.error('lead-mail:', e.message); return json({ error: 'db_unavailable' }, 502); }

  let sent = 0, failed = 0;
  for (const job of jobs || []) {
    let err = null;
    try {
      if (!job.to) throw new Error('no agency email in site_settings.contacts');
      const mail = job.kind === 'reminders' ? buildDigestMail(job.digest, env) : buildMail(job.lead, env);
      await sendMail(mail, job.to, 'lead-mail/' + job.id, env, fetchImpl);
    } catch (e) { err = String(e && e.message || e); }
    if (err) { failed++; console.error('lead-mail: ' + (job.kind === 'reminders' ? 'reminders ' + job.digest.day : 'lead ' + job.lead.id) + ', attempt ' + job.attempt + ': ' + err); } else sent++;
    try { await rpc('notify_done', { p_id: job.id, p_ok: !err, p_error: err }, env, fetchImpl); }
    catch (e) { console.error('lead-mail:', e.message); }
  }
  return json({ sent, failed });
}
