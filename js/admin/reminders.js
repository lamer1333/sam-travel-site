// ---------------------------------------------------------------------------
// Flight reminders (TZ-BACKEND.md §4.12) in JavaScript — a mirror of
// supabase/migrations/090_reminders.sql. The live panel reads ready lists and texts from
// the database (reminders_today); this file is what the demo mode works with, plus the
// template preview in «Шаблоны ответов». No DOM here: supabase/test/90-reminders.test.mjs
// imports it and compares it with SQL — a difference between the two is a bug.
//
// Days are plain 'YYYY-MM-DD' strings in Asia/Yerevan.
// ---------------------------------------------------------------------------

export const KINDS = ['bon_voyage', 'welcome_back'];
export const KIND_NAME = { bon_voyage: 'Накануне вылета', welcome_back: 'После возвращения' };
export const KIND_SHORT = { bon_voyage: 'Хорошего полёта', welcome_back: 'С возвращением' };
export const WA_DEFAULTS = { enabled: true, mail_hour: 11, review_url: '', mode: 'remind' };
const LANGS = ['en', 'ru', 'hy'];
const fail = (code) => { throw new Error(code); };

// reminder_default(): the texts the templates are seeded with and the fallback when one is deleted
const DEFAULT_TEXT = {
  'bon_voyage:ru': 'Здравствуйте, {name}! Завтра ваш вылет[ в {tour}]. Желаем хорошего полёта и отличного отдыха! SAM TRAVEL',
  'bon_voyage:en': 'Hello, {name}! Your flight[ to {tour}] is tomorrow. Have a great flight and a wonderful holiday! SAM TRAVEL',
  'bon_voyage:hy': 'Բարև ձեզ, {name}։ Վաղը ձեր թռիչքն է[՝ {tour}]։ Մաղթում ենք բարի թռիչք և հիանալի հանգիստ։ SAM TRAVEL',
  'welcome_back:ru': 'С возвращением, {name}![ Надеемся, {tour} понравился.] Будем рады вашему отзыву[: {review}]',
  'welcome_back:en': 'Welcome back, {name}![ We hope you enjoyed {tour}.] We would be glad to hear your feedback[: {review}]',
  'welcome_back:hy': 'Բարի վերադարձ, {name}։[ Հուսով ենք՝ {tour} ուղևորությունը ձեզ դուր եկավ։] Ուրախ կլինենք ստանալ ձեր կարծիքը[՝ {review}]',
};
export const reminderDefault = (kind, lang) => DEFAULT_TEXT[kind + ':' + lang] || null;
export const reminderLang = (lang) => (LANGS.includes(lang) ? lang : 'ru');

/** reminder_body(): the owner's template for this kind and language, else the default text */
export function reminderBody(templates, kind, lang) {
  const l = reminderLang(lang);
  const t = (templates || []).filter((x) => x.kind === kind && x.lang === l && String(x.body || '').trim())
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created_at).localeCompare(String(b.created_at)))[0];
  return t ? t.body : reminderDefault(kind, l);
}

/** reminder_fill(): {name} — first word of the name, {tour}, {review}; a [bracketed piece] drops out when its placeholder is empty */
export function reminderFill(body, name, tour, review) {
  let v = String(body == null ? '' : body);
  const vals = { name: String(name || '').trim().split(' ')[0], tour: String(tour || '').trim(), review: String(review || '').trim() };
  for (const k of Object.keys(vals)) if (!vals[k]) v = v.replace(new RegExp('\\[[^\\[\\]]*\\{' + k + '\\}[^\\[\\]]*\\]', 'g'), '');
  v = v.split('[').join('').split(']').join('');
  for (const k of Object.keys(vals)) v = v.split('{' + k + '}').join(vals[k]);
  return v.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '');
}

export const digitsOf = (phone) => String(phone || '').replace(/\D/g, '');
export const waUrl = (digits, text) => 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

// ------------------------------------------------------------------ settings (wa_settings, wa_settings_guard)
export const waSettings = (settings) => ({ ...WA_DEFAULTS, ...(((settings || {}).whatsapp) || {}) });
/** what the database does to site_settings.whatsapp on save: the value to store, or an error code */
export function guardWaSettings(value) {
  const v = { ...WA_DEFAULTS, ...(value || {}) };
  if (typeof v.enabled !== 'boolean') fail('bad_wa_enabled');
  if (typeof v.mail_hour !== 'number' || !Number.isInteger(v.mail_hour) || v.mail_hour < 0 || v.mail_hour > 23) fail('bad_mail_hour');
  v.review_url = String(v.review_url == null ? '' : v.review_url).trim();
  if (v.review_url && (!/^https?:\/\/\S+$/.test(v.review_url) || v.review_url.length > 300)) fail('bad_review_url');
  if (v.mode === 'auto') fail('wa_auto_unavailable');
  if (v.mode !== 'remind') fail('bad_wa_mode');
  return v;
}

// ------------------------------------------------------------------ the triggers on leads
/** leads_trip_guard: the client cannot come back before leaving */
export function tripGuard(old, row) {
  if (row.depart_on && row.return_on && row.return_on < row.depart_on
    && (!old || (row.depart_on || null) !== (old.depart_on || null) || (row.return_on || null) !== (old.return_on || null))) fail('return_before_depart');
  return row;
}
/**
 * leads_reminders: create, move and take off the reminders of one sale. `list` is the
 * wa_reminders table (changed in place), `old` is null for a new sale, `today` — the Yerevan day.
 */
export function syncReminders(list, old, lead, today, newId) {
  const same = (k) => (lead[k] || null) === (old[k] || null);
  if (old && same('status') && same('phone') && same('depart_on') && same('return_on')) return list;
  const ok = lead.status === 'won' && digitsOf(lead.phone).length >= 8;
  for (const kind of KINDS) {
    const base = kind === 'bon_voyage' ? lead.depart_on : lead.return_on;
    const want = ok && base ? addDays(base, kind === 'bon_voyage' ? -1 : 1) : null;
    const r = list.find((x) => x.lead_id === lead.id && x.kind === kind);
    if (!r) { if (want) list.push({ id: newId(), lead_id: lead.id, kind, due_on: want, status: 'due', done_by: null, done_at: null }); }
    else if (!want) { if (r.status === 'due') r.status = 'skipped'; }
    else if (r.due_on !== want) {
      // a moved flight: a message already sent for the old day is owed again, unless the new day has passed
      if (['sent', 'auto_sent'].includes(r.status) && want < today) r.due_on = want;
      else Object.assign(r, { due_on: want, status: 'due', done_by: null, done_at: null });
    } else if (r.status === 'skipped') r.status = 'due';
  }
  return list;
}

// ------------------------------------------------------------------ who to write to (reminders_list, reminders_today)
const titleOf = (t, lang) => { const x = t && t.i18n && t.i18n[lang] && String(t.i18n[lang].title || '').trim(); return x || null; };
/** reminders_list(day): unsent reminders shown on that day, each with the text in the client's language and a wa.me link */
export function remindersList({ leads, reminders, tours, templates, settings, day }) {
  const review = waSettings(settings).review_url;
  const out = [];
  for (const r of reminders) {
    if (r.status !== 'due' || r.due_on > day) continue;
    const l = leads.find((x) => x.id === r.lead_id);
    if (!l || l.status !== 'won') continue;
    if (day > (r.kind === 'bon_voyage' ? l.depart_on : addDays(r.due_on, 7))) continue;
    const t = (tours || []).find((x) => x.slug === l.tour), lang = reminderLang(l.lang), digits = digitsOf(l.phone);
    const text = reminderFill(reminderBody(templates, r.kind, lang), l.name, titleOf(t, lang) || titleOf(t, 'en'), r.kind === 'welcome_back' ? review : null);
    out.push({ id: r.id, lead_id: l.id, kind: r.kind, due_on: r.due_on, overdue: r.due_on < day, name: l.name, phone: l.phone, phone_digits: digits,
      tour: l.tour || null, tour_name: titleOf(t, 'ru') || titleOf(t, 'en') || l.tour || null, lang, depart_on: l.depart_on || null, return_on: l.return_on || null,
      wa_opt_in: !!l.wa_opt_in, text, wa_url: waUrl(digits, text) });
  }
  return out.sort((a, b) => a.due_on.localeCompare(b.due_on) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}
/** the «upcoming» part of reminders_today(): sales with a flight within 7 days */
export function upcomingList({ leads, reminders, day }) {
  const till = addDays(day, 7);
  return leads.filter((l) => l.status === 'won' && l.depart_on && l.depart_on >= day && l.depart_on <= till)
    .map((l) => ({ id: l.id, name: l.name, phone: l.phone, tour: l.tour || null, lang: l.lang || null, depart_on: l.depart_on, return_on: l.return_on || null,
      reminder: (reminders.find((r) => r.lead_id === l.id && r.kind === 'bon_voyage') || {}).status || null }))
    .sort((a, b) => a.depart_on.localeCompare(b.depart_on) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}
/** reminders_today() */
export function remindersToday(data, day) {
  const on = waSettings(data.settings).enabled;
  return { today: day, enabled: on, items: on ? remindersList({ ...data, day }) : [], upcoming: upcomingList({ ...data, day }) };
}
/** reminders_digest(day): what the daily letter is built from, or null when there is nobody to write to */
export function remindersDigest(data, day) {
  const items = remindersList({ ...data, day });
  return items.length ? { day, count: items.length, items } : null;
}
