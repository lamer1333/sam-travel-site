// ---------------------------------------------------------------------------
// Demo mode (admin.html?demo): a believable agency, generated in the browser.
// Same interface as LiveApi. Nothing leaves the browser: edits persist in
// localStorage, and the public part is mirrored to 'sam-cms-demo' so the site
// opened with ?cms=demo renders what the panel shows.
// The site has no request form (TZ-BACKEND.md §4.11): visitors write on WhatsApp and
// the journal holds only the sales the owner typed in. So site events are generated
// first; a part of the WhatsApp clicks becomes a sale carrying the click's reference
// number — campaign → click → sale attribution in the reports is internally consistent.
// ---------------------------------------------------------------------------
import { TOURS } from './demo-seed.js';
import { salesStats, trafficStats, couponStats, refOf, refNorm, refOk, eventChannel, ymd, phoneNorm } from './metrics.js';
// Flight reminders (§4.12): the rules live in ./reminders.js, a mirror of 090_reminders.sql.
// main.js hands that module to DemoApi — this file keeps its two imports, so the tests can
// load it on its own.

const STORE_KEY = 'sam-admin-demo-v1';
const WA_KEY = 'sam-demo-wa';   // WhatsApp clicks made on the site opened with ?cms=demo (js/track.js)
// The demo's «bucket»: uploaded photos live here once, rows and the audit log hold only a short
// address 'demo-media:<id>'. The site opened with ?cms=demo reads the same store (js/cms.js).
const MEDIA_KEY = 'sam-demo-media', MEDIA_REF = 'demo-media:';
const DAY = 86400e3, MIN = 60e3;
const SECTIONS = ['band-prices', 'hot', 'how', 'services', 'about', 'reviews', 'blog', 'contacts'];

function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
const iso = (t) => new Date(t).toISOString();
const yv = (t) => new Date(new Date(t).getTime() + 4 * 3600e3);   // Asia/Yerevan, UTC+4 all year

// ------------------------------------------------------------------ rules of a sale
// The same rules as the database keeps in supabase/migrations/010_guards.sql (leads_guard):
// a difference between the two is a bug. `old` is null for a new lead; returns the row to
// store or throws the error code errText() in api.js translates.
const MANUAL = ['phone', 'walk_in', 'instagram', 'manual'], CLOSED = ['won', 'lost', 'spam'];
const fail = (code) => { throw new Error(code); };
const num = (x) => (x == null || x === '' ? null : Number(x));
const sameTime = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
export function guardLead(old, row, currency, now = Date.now()) {
  const n = { ...row }, ins = !old;
  // the length checks of the leads table (002_admin.sql)
  const len = (x) => String(x == null ? '' : x).length;
  if (len(n.name) < 1 || len(n.name) > 120) fail('violates check constraint "leads_name_check"');
  if (len(n.phone) < 5 || len(n.phone) > 40) fail('violates check constraint "leads_phone_check"');
  if (len(n.message) > 2000) fail('violates check constraint "leads_message_check"');
  if (!ins) n.updated_at = iso(now);
  // typed in by a manager = the client is already being talked to
  if (MANUAL.includes(n.source)) {
    if (n.status === 'new') n.status = 'contacted';
    if (ins || !n.first_response_at) n.first_response_at = n.created_at;
  }
  const statusCh = ins || n.status !== old.status;
  const valueCh = ins || num(n.value) !== num(old.value);
  const profitCh = ins || num(n.profit) !== num(old.profit);
  if (!ins && !n.first_response_at && old.status === 'new' && n.status !== 'new') n.first_response_at = iso(now);
  // closed_at = the day of the sale / refusal: the date that was sent, else now
  if (!CLOSED.includes(n.status)) n.closed_at = null;
  else {
    if (statusCh) n.closed_at = n.closed_at && (ins || !sameTime(n.closed_at, old.closed_at)) ? n.closed_at : iso(now);
    else if (!n.closed_at) n.closed_at = old.closed_at;
    if (ins || !sameTime(n.closed_at, old.closed_at)) {
      const t = new Date(n.closed_at).getTime();
      if (t > now + 5 * MIN) fail('sale_date_in_future');
      if (t > now) n.closed_at = iso(now);
    }
  }
  const v = num(n.value), p = num(n.profit);
  // «не число» — не сумма (the check leads_money_not_nan in 100_security.sql)
  if (Number.isNaN(v) || Number.isNaN(p)) fail('leads_money_not_nan');
  if (n.status === 'won' && (statusCh || valueCh) && !(v > 0)) fail('sale_needs_value');
  if (valueCh || profitCh || (statusCh && n.status === 'won')) {
    if (v != null && v < 0) fail('value_negative');
    if (p != null && (p < 0 || v == null || p > v)) fail('profit_out_of_range');
  }
  n.currency = ins || valueCh ? currency : old.currency;
  if (n.status === 'lost' && (statusCh || (n.lost_reason || null) !== (old.lost_reason || null)) && !String(n.lost_reason || '').trim()) fail('lost_reason_required');
  return n;
}
// ------------------------------------------------------------------ reference number of a sale
// The same rules as wa_ref_lookup() and the leads_attribution trigger (070_whatsapp.sql as
// 100_security.sql left them): the last click with the number names the visit, and the tags,
// the tour and the banner's promo code come from the clicks of THAT visit (its sid) only.
/** the last wa_click with this number in 90 days → what the site knows about that visit, or null */
export function waRefLookup(events, promos, code, now = Date.now()) {
  const ref = refNorm(code);
  if (!refOk(ref)) return null;
  const since = now - 90 * DAY, t = (e) => new Date(e.ts).getTime();
  // newest first; clicks of one moment — in the order they were written, the last one wins
  const newest = (rows) => rows.sort((a, b) => t(b[0]) - t(a[0]) || b[1] - a[1]).map((x) => x[0]);
  const clicks = events.map((e, i) => [e, i]).filter(([e]) => e.name === 'wa_click' && t(e) > since);
  const last = newest(clicks.filter(([e]) => e.ref === ref))[0];
  if (!last) return null;
  const c = newest(clicks.filter(([e]) => e.sid === last.sid));
  const e = c[0], withTour = c.find((x) => x.tour);
  const coupon = c.map((x) => x.promo_id && (promos.find((p) => p.id === x.promo_id) || {}).coupon_code).find(Boolean);
  return { ref, ts: iso(t(e)), label: e.label || null, lang: e.lang || null, device: e.device || null,
    utm_source: e.utm_source || null, utm_medium: e.utm_medium || null, utm_campaign: e.utm_campaign || null, utm_content: e.utm_content || null,
    ref_host: e.ref_host || null, channel: eventChannel(e), tour: withTour ? withTour.tour : null, coupon_code: coupon || null, clicks: c.length };
}
/** what the database does to a sale when its reference number is set, changed or removed */
export function attributeLead(old, row, lookup) {
  const n = { ...row, ref: refNorm(row.ref) };
  if (old && (n.ref || null) === (old.ref || null)) return n;
  if (!n.ref) {
    if (old) { Object.assign(n, { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null, referrer: null }); const { ref_at, ref_label, ...d } = n.details || {}; n.details = d; }
    return n;
  }
  if (!refOk(n.ref)) fail('ref_invalid');
  const e = lookup(n.ref);
  if (!e) fail('ref_not_found');
  return { ...n, source: 'manual', utm_source: e.utm_source, utm_medium: e.utm_medium, utm_campaign: e.utm_campaign, utm_content: e.utm_content, utm_term: null,
    referrer: e.ref_host ? 'https://' + e.ref_host + '/' : null, lang: e.lang || n.lang, device: e.device,
    // the banner's promo code is NOT filled in: the form shows it as a hint, a person types it
    tour: String(n.tour || '').trim() || e.tour,
    details: { ...(n.details || {}), ref_at: e.ts, ref_label: e.label } };
}

/**
 * The «money» line of the history — the same rule as leads_log() in 100_security.sql: an edit
 * of the amount or the income leaves «было → стало» when the row was closed OR already had a
 * value (so it cannot be changed quietly while the sale is taken out of «продано» for a
 * minute); the first amount of the first sale is not an edit. Returns the meta, or null.
 */
export function moneyEdit(old, next) {
  const closed = CLOSED.includes(old.status), m = {};
  if (num(next.value) !== num(old.value) && (closed || num(old.value) != null)) m.value = { from: num(old.value), to: num(next.value) };
  if (num(next.profit) !== num(old.profit) && (closed || num(old.profit) != null)) m.profit = { from: num(old.profit), to: num(next.profit) };
  if (closed && next.status === old.status && !sameTime(next.closed_at, old.closed_at)) m.closed_at = { from: old.closed_at, to: next.closed_at };
  return Object.keys(m).length ? m : null;
}

/** used_count of a promo code = sold leads with it, always recounted (leads_coupon_recount) */
const couponUsed = (leads, code) => leads.filter((l) => l.status === 'won' && l.coupon_code && l.coupon_code.toUpperCase() === String(code).toUpperCase()).length;

// ------------------------------------------------------------------ generate
function generate(REM) {
  const R = rng(20260929);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const wpick = (pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let x = R() * tot; for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; } return pairs[pairs.length - 1][0]; };
  const now = Date.now();
  const u = (id, email, full_name, role, lang, extra = {}) => ({ id, email, full_name, role, lang, phone: null, marketing_consent: false, created_at: iso(now - 400 * DAY), last_sign_in_at: iso(now - R() * 3 * DAY), provider: 'email', email_confirmed: true, birth_date: null, ...extra });
  const OWNER = uuid(), M1 = uuid(), M2 = uuid(), MK = uuid(), SMM = uuid();
  const users = [
    u(OWNER, 'owner@samtravel.am', 'Самвел', 'admin', 'ru'),
    u(M1, 'anna@samtravel.am', 'Анна Гаспарян', 'manager', 'ru'),
    u(M2, 'davit@samtravel.am', 'Давит Арутюнян', 'manager', 'hy'),
    u(MK, 'lilit@samtravel.am', 'Лилит Саргсян', 'marketer', 'ru'),
    u(SMM, 'sona@samtravel.am', 'Сона Мкртчян', 'content', 'ru'),
  ];
  const first = ['Анна', 'Гаяне', 'Тигран', 'Карен', 'Мариам', 'Арман', 'Лусине', 'Нарек', 'Ани', 'Ваге', 'Сона', 'Эдгар', 'Ирина', 'Сергей', 'Ольга', 'Артур', 'Нане', 'Грант', 'Елена', 'Давид', 'Kristine', 'Hayk', 'Mane', 'Alex', 'Лиана', 'Рубен', 'Кристина', 'Мхитар'];
  const last = ['Петросян', 'Саакян', 'Аветисян', 'Геворгян', 'Акопян', 'Карапетян', 'Мартиросян', 'Оганесян', 'Григорян', 'Варданян', 'Смирнова', 'Иванов', 'Sargsyan', 'Hovhannisyan', 'Мелконян', 'Хачатрян'];
  const name = () => pick(first) + ' ' + pick(last);
  const phone = () => '+374 ' + pick(['91', '93', '94', '95', '96', '98', '99', '55', '77', '41']) + ' ' + String(100 + Math.floor(R() * 900)) + ' ' + String(100 + Math.floor(R() * 900));
  for (let i = 0; i < 146; i++) {
    const created = now - R() * 300 * DAY, consent = R() < 0.56;
    const nm = name();
    users.push(u(uuid(), (i === 0 ? 'demo' : slugMail(nm) + (i % 7 ? '' : i)) + '@' + (i === 0 ? 'samtravel.am' : pick(['gmail.com', 'mail.ru', 'yandex.ru', 'gmail.com', 'icloud.com'])),
      i === 0 ? 'Demo User' : nm, 'client', wpick([['ru', 5], ['hy', 4], ['en', 1]]), {
        created_at: iso(created), marketing_consent: consent, consent_at: consent ? iso(created + R() * 3 * DAY) : null,
        consent_source: consent ? wpick([['signup_form', 3], ['onboarding_social', 2]]) : null,
        provider: wpick([['email', 5], ['google', 5]]), last_sign_in_at: iso(created + R() * (now - created)),
      }));
  }
  function slugMail(n) { const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',ы:'y',э:'e',ю:'yu',я:'ya' }; return n.toLowerCase().replace(/[а-я]/g, (c) => map[c] || '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, ''); }

  const campaigns = [
    { name: 'Горящий Шарм — октябрь', channel: 'instagram', utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'sharm_oct', utm_content: 'reels_v2', landing: '#hot', spend: 450, s: -35, e: 10, w: 1.4, tour: 'sharm' },
    { name: 'Дубай в ноябре — Facebook', channel: 'facebook', utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'dubai_nov', utm_content: 'carousel', landing: '#hot', spend: 380, s: -20, e: 25, w: 1.0, tour: 'dubai' },
    { name: 'Google Ads — туры из Еревана', channel: 'google', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'search_tours_yvn', utm_content: '', landing: '', spend: 620, s: -60, e: null, w: 0.9, tour: null },
    { name: 'Флаеры в офисе (QR)', channel: 'offline', utm_source: 'flyer', utm_medium: 'qr', utm_campaign: 'office_qr', utm_content: '', landing: '#checklist', spend: 60, s: -90, e: null, w: 0.15, tour: null },
    { name: 'Рассылка — зимние направления', channel: 'email', utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'winter_mail', utm_content: 'hero_button', landing: '#hot', spend: 0, s: -12, e: -9, w: 2.2, tour: 'georgia' },
  ].map((c) => ({ id: uuid(), ...c, currency: 'USD', starts_on: iso(now + c.s * DAY).slice(0, 10), ends_on: c.e == null ? null : iso(now + c.e * DAY).slice(0, 10), notes: '', archived: false, created_at: iso(now + c.s * DAY - DAY), updated_at: iso(now - 2 * DAY) }));

  const promos = [
    { name: 'Осенние горящие туры', kind: 'bar', theme: 'sunset', active: false, starts_at: iso(now - 10 * DAY), ends_at: iso(now + 12 * DAY), link: '#hot', coupon_code: 'AUTUMN7',
      i18n: { ru: { text: 'Горящие туры октября — минус 7% по промокоду', cta: 'Смотреть туры' }, en: { text: 'October hot tours — 7% off with the code', cta: 'See tours' }, hy: { text: 'Հոկտեմբերի թեժ տուրեր՝ 7% զեղչ պրոմոկոդով', cta: 'Դիտել տուրերը' } },
      audience: { langs: [], devices: [], frequency: 'always' } },
    { name: 'Новый год у моря', kind: 'popup', theme: 'brand', active: true, starts_at: iso(now + 20 * DAY), ends_at: iso(now + 60 * DAY), link: '#plan', coupon_code: 'NY2027',
      i18n: { ru: { title: 'Новый год у моря', text: 'Мальдивы, Дубай, Шарм — соберём тур под ваши даты. Скидка 5% до 1 декабря.', cta: 'Подобрать тур' }, en: { title: 'New Year by the sea', text: 'Maldives, Dubai, Sharm — a trip for your dates. 5% off until December 1.', cta: 'Plan my trip' }, hy: { title: 'Նոր տարին ծովափին', text: '', cta: '' } },
      audience: { langs: ['ru', 'hy'], devices: [], delay_s: 8, frequency: 'session' } },
    { name: 'Лето 2026 — ранее бронирование', kind: 'popup', theme: 'sea', active: false, starts_at: iso(now - 150 * DAY), ends_at: iso(now - 60 * DAY), link: 'wa', coupon_code: null,
      i18n: { ru: { title: 'Лето уже скоро', text: 'Бронируйте Анталию до мая — лучшие отели ещё свободны.', cta: 'Написать в WhatsApp' }, en: { title: 'Summer is close', text: 'Book Antalya before May — the best hotels are still free.', cta: 'Write on WhatsApp' } },
      audience: { frequency: 'once', delay_s: 12 } },
  ].map((p) => ({ id: uuid(), created_at: iso(now - 40 * DAY), updated_at: iso(now - 3 * DAY), ...p }));

  const organic = [['direct', 34], ['google.com', 22], ['instagram.com', 12], ['facebook.com', 5], ['yandex.ru', 3], ['tripadvisor.com', 1]];
  const tourW = TOURS.filter((t) => t.published).map((t) => [t.slug, t.slug === 'sharm' ? 3 : t.slug === 'dubai' ? 3 : 2]);
  const events = [];
  const managers = [OWNER, OWNER, OWNER, M1, M2];
  const leads = [];
  const bought = {
    sharm: ['Шарм, 7 ночей, всё включено, 2 взрослых + ребёнок', 'Шарм-эль-Шейх, отель у рифа, 2 взрослых'],
    dubai: ['Дубай, 5 ночей, отель на пляже + сафари', 'Дубай на 4 ночи, городской отель, 3 человека'],
    maldives: ['Мальдивы, водная вилла, полупансион, 7 ночей', 'Мальдивы, медовый месяц, 9 ночей'],
    georgia: ['Гудаури, 4 ночи, ски-пассы, семья с 2 детьми', 'Гудаури на выходные, 4 человека + инструктор'],
    phuket: ['Пхукет, 10 ночей, два пляжа', 'Пхукет, тихий пляж, 2 взрослых'],
    null: ['Шенгенская виза + Париж на 5 ночей', 'Групповая поездка, 12 человек', 'Анталия, всё включено, 7 ночей', 'Страховка и авиабилеты'],
  };
  const sidOf = () => { let x = ''; for (let i = 0; i < 12; i++) x += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(R() * 36)]; return x; };
  let dayIdx = 0;
  for (let d = 120; d >= 0; d--) {
    const dayStart = new Date(yv(now - d * DAY).toISOString().slice(0, 10) + 'T00:00:00+04:00').getTime();
    const dow = yv(dayStart).getUTCDay();
    const base = (62 + dayIdx * 0.35) * (dow === 0 || dow === 6 ? 0.78 : 1) * (0.85 + R() * 0.3);
    dayIdx++;
    const live = campaigns.filter((c) => now + c.s * DAY <= dayStart + DAY && (c.e == null || now + c.e * DAY >= dayStart));
    const promoLive = promos.filter((p) => p.active && new Date(p.starts_at) <= dayStart + DAY && new Date(p.ends_at) >= dayStart);
    const campaignVisits = live.map((c) => [c, Math.round(base * 0.22 * c.w * (0.7 + R() * 0.6))]);
    const total = Math.round(base) + campaignVisits.reduce((a, x) => a + x[1], 0);
    const src = [];
    campaignVisits.forEach(([c, n]) => { for (let i = 0; i < n; i++) src.push(c); });
    while (src.length < total) src.push(null);
    for (const c of src) {
      const hour = wpick([[0, 1], [1, .5], [2, .3], [7, .6], [8, 1.2], [9, 2], [10, 3], [11, 3.5], [12, 4.5], [13, 4.8], [14, 4], [15, 3.4], [16, 3], [17, 3], [18, 3.5], [19, 4.2], [20, 5], [21, 5.5], [22, 4.8], [23, 2.6]]);
      const ts = dayStart + hour * 3600e3 + R() * 3600e3, sid = sidOf();
      if (ts > now) continue;
      const v = { ts: iso(ts), sid, device: wpick([['mobile', 68], ['desktop', 27], ['tablet', 5]]), lang: wpick([['ru', 45], ['hy', 35], ['en', 20]]),
        ref_host: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null };
      if (c) Object.assign(v, { utm_source: c.utm_source, utm_medium: c.utm_medium, utm_campaign: c.utm_campaign, utm_content: c.utm_content || null });
      else { const o = wpick(organic); v.ref_host = o === 'direct' ? null : o; }
      const ev = (name, more) => events.push({ ...v, name, section: null, tour: null, promo_id: null, label: null, ref: null, ...more });
      const q = c ? (c.channel === 'email' ? 1.35 : c.channel === 'offline' ? 1.5 : c.channel === 'google' ? 1.15 : 0.9) : (v.ref_host === 'google.com' ? 1.1 : v.ref_host ? 0.85 : 1.15);
      ev('page_view');
      let depth = 0; while (depth < SECTIONS.length && R() < (depth < 2 ? 0.93 : 0.8) * Math.min(1.05, q)) depth++;
      SECTIONS.slice(0, depth).forEach((section) => ev('section_view', { section }));
      const opened = R() < 0.24 * q ? ((c && c.tour && R() < 0.6) ? c.tour : wpick(tourW)) : null;
      if (opened) ev('tour_open', { tour: opened });
      let plan = (c && c.landing === '#plan' && R() < 0.4);
      if (c && c.landing === '#checklist' && R() < 0.6) ev('checklist_open');
      if (R() < 0.08 * q) plan = true;
      if (plan) ev('plan_open');
      if (R() < 0.05) ev('checklist_open');
      if (R() < 0.012) ev('lang_switch');
      promoLive.forEach((p) => {
        if (p.kind === 'bar' || R() < 0.7) { ev('promo_view', { promo_id: p.id }); if (R() < 0.07) ev('promo_click', { promo_id: p.id }); else if (R() < 0.3) ev('promo_close', { promo_id: p.id }); }
      });
      if (R() < 0.014 * q) ev('tel_click', { label: 'contacts' });
      // a WhatsApp click: from the tour (card or description) when one was opened, else a general button
      const wrote = R() < (opened ? 0.17 : 0.03) * q * (c && c.channel === 'instagram' ? 1.4 : 1);
      if (plan && R() < 0.35) { ev('plan_send'); ev('wa_click', { label: 'plan', ref: refOf(sid) }); }
      if (!wrote) continue;
      const about = opened && R() < 0.8 ? opened : null;
      ev('wa_click', { tour: about, label: about ? pick(['sheet', 'carou-stage']) : pick(['topbar', 'contacts_cta', 'services', 'top']), ref: refOf(sid) });
      // the chat became a sale: the owner types it in with the number from the message
      const days = 0.2 + R() * 6, qq = v.utm_campaign === 'winter_mail' ? 1.6 : v.utm_medium === 'cpc' ? 1.1 : 1;
      if (R() < 0.075 * qq && ts + days * DAY < now) leads.push(makeSale(ts + days * DAY, 'manual', { ...v, ref: refOf(sid), tour: about || (R() < 0.3 ? wpick(tourW) : null), ts }));
    }
  }
  // sales that did not start on the site: a call, a visit to the office, Instagram Direct, a WhatsApp chat without a number
  for (let d = 120; d >= 0; d--) if (R() < 0.18) {
    const ts = now - d * DAY - R() * 0.5 * DAY;
    leads.push(makeSale(ts, wpick([['phone', 3], ['walk_in', 2], ['instagram', 2], ['manual', 2]]), { lang: 'ru', device: null, tour: R() < 0.6 ? wpick(tourW) : null }));
  }
  function makeSale(ts, source, v) {
    const nm = name(), value = Math.round((600 + R() * 4200) / 10) * 10;
    const refunded = (now - ts) / DAY > 3 && R() < 0.07;
    return {
      id: uuid(), created_at: iso(ts), updated_at: iso(ts),
      name: nm, phone: phone(), email: null, message: pick(bought[v.tour] || bought.null),
      source, tour: v.tour || null, details: v.ref ? { ref_at: iso(v.ts), ref_label: null } : {},
      lang: v.lang || 'ru', device: v.device || null, page: null, referrer: v.ref_host ? 'https://' + v.ref_host + '/' : null,
      utm_source: v.utm_source || null, utm_medium: v.utm_medium || null, utm_campaign: v.utm_campaign || null, utm_content: v.utm_content || null, utm_term: null,
      coupon_code: v.utm_campaign === 'sharm_oct' && R() < 0.4 ? 'AUTUMN7' : R() < 0.05 ? 'WELCOME5' : null,
      status: refunded ? 'lost' : 'won', lost_reason: refunded ? pick(['Возврат', 'Клиент передумал', 'Отказ в визе', 'Перенос поездки']) : null,
      value, profit: R() < 0.75 ? Math.round(value * (0.08 + R() * 0.08) / 5) * 5 : null, currency: 'USD', assigned_to: pick(managers),
      tags: R() < 0.15 ? [pick(['семья', 'vip', 'повторный', 'группа', 'медовый месяц'])] : [],
      follow_up_at: null, first_response_at: iso(ts), closed_at: iso(refunded ? Math.min(now, ts + (2 + R() * 9) * DAY) : ts), user_id: null, ref: v.ref || null,
    };
  }
  leads.sort((a, b) => b.closed_at.localeCompare(a.closed_at));

  const coupons = [
    { code: 'AUTUMN7', description: 'Осенняя акция, баннер на сайте', discount_pct: 7, discount_amt: null, valid_from: iso(now - 10 * DAY), valid_until: iso(now + 12 * DAY), max_uses: 200, used_count: 0, active: true },
    { code: 'WELCOME5', description: 'Приветственная скидка для подписчиков', discount_pct: 5, discount_amt: null, valid_from: iso(now - 200 * DAY), valid_until: null, max_uses: null, used_count: 41, active: true },
    { code: 'NY2027', description: 'Новогодний поп-ап', discount_pct: 5, discount_amt: null, valid_from: iso(now + 20 * DAY), valid_until: iso(now + 60 * DAY), max_uses: 100, used_count: 0, active: true },
    { code: 'VIP-8K2Q', description: 'Персональный код постоянному клиенту', discount_pct: null, discount_amt: 150, valid_from: iso(now - 5 * DAY), valid_until: iso(now + 90 * DAY), max_uses: 1, used_count: 0, active: true },
    { code: 'SUMMER10', description: 'Лето 2026', discount_pct: 10, discount_amt: null, valid_from: iso(now - 150 * DAY), valid_until: iso(now - 60 * DAY), max_uses: 300, used_count: 118, active: false },
  ].map((c) => ({ id: uuid(), created_at: c.valid_from, ...c }));
  coupons.forEach((c) => { c.used_count = couponUsed(leads, c.code); });
  const reviews = [
    { author: 'Гаяне и Тигран', trip: 'Шарм-эль-Шейх · окт 2025', rating: 5, source: 'google', published: true, featured: true, body: { ru: 'Анна подобрала отель у рифа ровно под наш бюджет и была на связи всю неделю — даже когда задержали обратный рейс. Поедем снова только через SAM TRAVEL.', en: 'Anna found a reef hotel right in our budget and stayed in touch all week — even when the return flight was delayed.' } },
    { author: 'Нарек Оганесян', trip: 'Дубай · ноя 2025', rating: 5, source: 'instagram', published: true, featured: false, body: { ru: 'Визу сделали за два дня, трансфер ждал у выхода. Сафари — лучшее, что было в поездке.', hy: 'Վիզան պատրաստեցին երկու օրում, տրանսֆերը սպասում էր ելքի մոտ։' } },
    { author: 'Ирина С.', trip: 'Гудаури · янв 2026', rating: 4, source: 'direct', published: true, featured: false, body: { ru: 'Отель у склона, ски-пассы и инструктор для детей — всё было готово к приезду. Минус звезда только за погоду :)' } },
    { author: 'Мане Карапетян', trip: 'Мальдивы · фев 2026', rating: 5, source: 'google', published: false, featured: false, body: { ru: 'Медовый месяц мечты. Давит объяснил разницу между виллами так, что мы не пожалели ни об одном долларе.' } },
    { author: 'Alex P.', trip: 'Paris · Mar 2026', rating: 5, source: 'facebook', published: false, featured: false, body: { en: 'Schengen visa sorted with zero stress, and the hotel was in the perfect arrondissement.' } },
  ].map((r, i) => ({ id: uuid(), photo_url: null, sort: i, created_at: iso(now - (60 - i * 9) * DAY), updated_at: iso(now - (30 - i * 5) * DAY), ...r }));

  const team = [
    { i18n: { en: { name: 'Anna Gasparyan', role: 'Beach & islands · 8 years' }, ru: { name: 'Анна Гаспарян', role: 'Пляжи и острова · 8 лет' }, hy: { name: 'Աննա Գասպարյան', role: 'Լողափեր և կղզիներ · 8 տարի' } }, whatsapp: '37455957585' },
    { i18n: { en: { name: 'Davit Harutyunyan', role: 'Europe & city breaks · 6 years' }, ru: { name: 'Давит Арутюнян', role: 'Европа и города · 6 лет' }, hy: { name: '', role: '' } }, whatsapp: '' },
  ].map((t, i) => ({ id: uuid(), photo_url: null, published: true, sort: i, created_at: iso(now - 90 * DAY), updated_at: iso(now - 20 * DAY), ...t }));

  const tours = TOURS.map((t) => ({ id: uuid(), photo_url: null, photo_hero_url: null, hot_until: null, price_from: null, currency: 'USD', created_at: iso(now - 100 * DAY), updated_at: iso(now - 8 * DAY), updated_by: MK, ...t }));
  tours.find((t) => t.slug === 'sharm').price_from = 890;
  tours.find((t) => t.slug === 'sharm').hot_until = iso(now + 25 * DAY).slice(0, 10);
  tours.find((t) => t.slug === 'dubai').price_from = 1150;

  const settings = {
    contacts: { phone: '+374 55 957585', whatsapp: '37455957585', email: 'outgoingsamtravel@gmail.com', address: { en: 'Komitas 51, Yerevan', ru: 'Комитас 51, Ереван', hy: 'Կոմիտաս 51, Երևան' }, instagram: 'https://www.instagram.com/samtravel.arm', facebook: 'https://www.facebook.com/samtravel', telegram: '' },
    company: { licence: '23-1057-2023', insurance: 'TRV-2026-0412', legal_name: 'SAM TRAVEL', currency: 'USD', margin_pct: 12 },
    stats: { years: '3+', trips: '500+', destinations: '25+', travellers: '3 000+' },
    hours: { days: [1, 2, 3, 4, 5, 6], from: '10:00', to: '19:00', sla_min: 60 },
    seo: { en: { title: 'SAM TRAVEL — Travel agency in Yerevan | Beach, city & group tours', description: 'Travel agency in Yerevan. Beach, city and group trips arranged by a real manager — flights, hotels, visa support and insurance, confirmed in one message on WhatsApp.' },
           ru: { title: 'SAM TRAVEL — турагентство в Ереване | пляжные, городские и групповые туры', description: '' }, hy: { title: '', description: '' } },
    analytics: { ga4: '', pixel: '' },
    whatsapp: { enabled: true, mail_hour: 11, review_url: 'https://g.page/r/samtravel/review', mode: 'remind' },
  };
  const reels = [{ id: uuid(), url: 'https://www.instagram.com/reel/DceFC3aCMGX/', published: true, sort: 0, created_at: iso(now - 30 * DAY) }];
  const wa_templates = [
    ['Документы готовы', 'ru', 'Здравствуйте, {name}! Это {manager} из SAM TRAVEL. Документы по вашей поездке{tour} готовы — отправляю ваучер и билеты. Проверьте, пожалуйста, имена и даты.'],
    ['Перед вылетом', 'ru', '{name}, добрый день! До вылета{tour} осталось несколько дней. Напоминаю про паспорт и страховку; если есть вопросы — я на связи.'],
    ['После поездки', 'ru', '{name}, с возвращением! Как прошла поездка{tour}? Будем благодарны за короткий отзыв — он помогает другим путешественникам.'],
    ['Documents are ready', 'en', 'Hi {name}! This is {manager} from SAM TRAVEL. The documents for your trip{tour} are ready — sending the voucher and tickets. Please check the names and dates.'],
    ['Փաստաթղթերը պատրաստ են', 'hy', 'Բարև, {name}։ {manager}-ն է, SAM TRAVEL-ից։ Ձեր ուղևորության փաստաթղթերը{tour} պատրաստ են՝ ուղարկում եմ վաուչերը և տոմսերը։'],
  ].map(([title, lang, body], i) => ({ id: uuid(), title, lang, body, sort: i, kind: null, created_at: iso(now - 50 * DAY) }));
  // Stage 9 (ТЗ §4.12): the two reminder texts in three languages, trip dates of the sales and
  // the reminders they produce. A separate generator, so the rest of the demo data stays as it was.
  const reminders = [];
  if (REM) {
    REM.KINDS.forEach((kind, k) => ['ru', 'hy', 'en'].forEach((lang, i) => wa_templates.push({ id: uuid(), title: REM.KIND_NAME[kind], lang, body: REM.reminderDefault(kind, lang), sort: 100 + k * 3 + i, kind, variant: null, created_at: iso(now - 2 * DAY) })));
    // the third text: on the day of the flight (110_fixes.sql)
    ['ru', 'hy', 'en'].forEach((lang, i) => wa_templates.push({ id: uuid(), title: REM.VARIANT_NAME.today, lang, body: REM.reminderDefault('bon_voyage_today', lang), sort: 106 + i, kind: 'bon_voyage', variant: 'today', created_at: iso(now - 2 * DAY) }));
    const R9 = rng(9090), today = ymd(now);
    leads.forEach((l) => {
      l.wa_opt_in = R9() < 0.6; l.depart_on = null; l.return_on = null;
      if (R9() < 0.55) { l.depart_on = REM.addDays(ymd(l.closed_at), 9 + Math.floor(R9() * 30)); l.return_on = REM.addDays(l.depart_on, 4 + Math.floor(R9() * 8)); }
      REM.syncReminders(reminders, null, l, today, uuid);
    });
    // what was due before today has long been written
    reminders.forEach((r) => { if (r.due_on < today) Object.assign(r, { status: 'sent', done_at: r.due_on + 'T07:30:00.000Z' }); });
  }
  // Stage 4 (ТЗ §4.9): date of birth and e-mail confirmation. A separate generator, so the
  // rest of the demo data stays as it was.
  const R4 = rng(4040);
  users.forEach((x) => {
    x.birth_date = iso(now - (18 + R4() * 50) * 365.25 * DAY).slice(0, 10);
    // social logins are confirmed by the provider; a few e-mail sign-ups never opened the letter
    x.email_confirmed = x.role !== 'client' || x.provider !== 'email' || R4() > 0.12;
  });
  const audit = [];
  const aud = (d, actor, table_name, action, before, after) => audit.push({ id: audit.length + 1, at: iso(now - d * DAY), actor, table_name, row_id: (after || before).id || (after || before).key, action, before, after });
  aud(0.2, MK, 'promos', 'update', { ...promos[0], active: false }, promos[0]);
  aud(1.1, MK, 'tours', 'update', { ...tours[0], price_from: null }, tours[0]);
  aud(5.2, SMM, 'tours', 'update', { ...tours[0], price_from: null, tags: ['city'] }, { ...tours[0], price_from: null });
  aud(2.4, OWNER, 'site_settings', 'update', { key: 'hours', value: { ...settings.hours, to: '18:00' } }, { key: 'hours', value: settings.hours });
  aud(3, MK, 'campaigns', 'insert', null, campaigns[1]);
  aud(4.5, OWNER, 'reviews', 'update', { ...reviews[1], published: false }, reviews[1]);
  aud(6, OWNER, 'profiles', 'update', { id: MK, role: 'client', full_name: 'Лилит Саргсян' }, { id: MK, role: 'marketer', full_name: 'Лилит Саргсян' });
  aud(8, MK, 'coupons', 'insert', null, coupons[0]);
  aud(12, OWNER, 'team', 'update', { ...team[0], i18n: { ...team[0].i18n, en: { name: 'Anna G.', role: 'Beach · 8 years' } } }, team[0]);
  audit.reverse();

  return { v: 10, generated: now, me: OWNER, role: 'admin', users, campaigns, promos, events, leads, activity: {}, coupons, reviews, team, tours, settings, reels, wa_templates, reminders, audit };
}

// ------------------------------------------------------------------ public snapshot (same shape as public_site)
export function publicSnapshot(st) {
  const now = Date.now(), today = yv(now).toISOString().slice(0, 10);
  return {
    // company: only what the page prints — the keys are listed, as in public_site() (100_security.sql)
    settings: { ...st.settings, company: (({ licence, insurance, legal_name }) => JSON.parse(JSON.stringify({ licence, insurance, legal_name })))(st.settings.company || {}) },
    tours: st.tours.filter((t) => t.published && (!t.hot_until || t.hot_until >= today)).sort((a, b) => a.sort - b.sort)
      .map(({ slug, photo_url, photo_hero_url, photo_class, tags, price_from, currency, i18n }) => ({ slug, photo_url, photo_hero_url: photo_hero_url || null, photo_class, tags, price_from, currency, i18n })),
    reviews: st.reviews.filter((r) => r.published).sort((a, b) => (b.featured - a.featured) || (a.sort - b.sort))
      .map(({ author, trip, rating, body, photo_url, source }) => ({ author, trip, rating, body, photo_url, source })),
    team: st.team.filter((t) => t.published).sort((a, b) => a.sort - b.sort).map(({ i18n, photo_url }) => ({ i18n, photo_url })),
    reels: st.reels.filter((r) => r.published).sort((a, b) => a.sort - b.sort).map((r) => r.url),
    promos: st.promos.filter((p) => p.active && (!p.starts_at || new Date(p.starts_at) <= now) && (!p.ends_at || new Date(p.ends_at) > now))
      .map(({ id, kind, i18n, link, coupon_code, theme, audience }) => ({ id, kind, i18n, link, coupon_code, theme, audience })),
  };
}

// ------------------------------------------------------------------ the api
// The role `content` (the SMM specialist) — the same line as 080_content.sql draws: it reads
// and writes tours, reviews, reels and the team, and nothing else in the panel.
const ROLE_OK = {
  leads: ['admin', 'manager'], users: ['admin', 'manager', 'marketer'], audience: ['admin', 'marketer'],
  write_marketing: ['admin', 'marketer'], write_owner: ['admin'], audit: ['admin'], stats: ['admin', 'manager', 'marketer'],
  write_content: ['admin', 'marketer', 'content'], write_team: ['admin', 'content'],
};
const TABLE_WRITE = { tours: 'write_content', reviews: 'write_content', reels: 'write_content', promos: 'write_marketing', campaigns: 'write_marketing', coupons: 'write_marketing', team: 'write_team', wa_templates: 'write_owner' };
export const CONTENT_TABLES = ['tours', 'reviews', 'reels', 'team'];
export const TOUR_TAGS = ['beach', 'city', 'nature', 'family'];   // tours_tags_known
const REEL_RE = /^https:\/\/(www\.)?instagram\.com\/(reel|p)\/[A-Za-z0-9_-]+\/?$/;   // the check on reels.url
// 100_security.sql: what a tour, a review and a team card may hold
const PHOTO_CLASSES = ['p-sea', 'p-desert', 'p-lagoon', 'p-snow', 'p-island', 'p-jungle', 'p-ocean', 'p-city'];   // tours_photo_class_known
/** media_url_ok: a file of the bucket — in the demo, a photo of the demo «bucket» */
const photoOk = (u) => u == null || (typeof u === 'string' && /^demo-media:[a-z0-9]{1,40}$/.test(u));
/** tours_inc_ok: «Что входит» is a list of strings, each up to 200 characters */
export const incOk = (i18n) => !!i18n && typeof i18n === 'object' && !Array.isArray(i18n) && Object.values(i18n).every((l) => !l || typeof l !== 'object' || l.inc == null
  || (Array.isArray(l.inc) && l.inc.every((x) => typeof x === 'string' && x.length <= 200)));
const ROLE_LABEL = { admin: 'Владелец', manager: 'Менеджер', marketer: 'Маркетолог', content: 'Контент', client: 'Клиент' };   // role_label()
const TEAM_FREE = ['photo_url', 'updated_at', 'updated_by'];   // team_content_guard: what the content role may change in `team`
// what «Вернуть эту версию» never touches: see restore_version()
const RESTORE_KEEPS = ['id', 'created_at', 'updated_at', 'updated_by', 'sort', 'published'];

export class DemoApi {
  /** REM — the module ./reminders.js (the rules of flight reminders) */
  constructor(REM) {
    this.mode = 'demo';
    this.REM = REM;
    let st = null;
    try { st = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
    const fresh = generate(REM);
    if (!st || st.v !== fresh.v) st = fresh;
    else st.events = fresh.events;   // site events are regenerated (deterministic), never stored
    this.st = st;
    this.media = {};
    try { this.media = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}') || {}; } catch (e) {}
    this.removed = [];   // addresses of the photos deleted from the «bucket» — to look at in the console
    this.demoTrips();
    this.persist();
  }
  get today() { return ymd(Date.now()); }
  /**
   * Demo only: whatever day the demo is opened on, there is somebody to write to today.
   * A few recent sales are re-dated once a day: flights tomorrow in three languages, one
   * yesterday's reminder nobody sent, two clients who are back, flights later this week.
   */
  demoTrips() {
    const R = this.REM, st = this.st, today = this.today;
    if (!R || st.trip_day === today) return;
    const plan = [
      { dep: 1, nights: 7, lang: 'ru', tour: 'sharm', name: 'Мариам Петросян' }, { dep: 1, nights: 5, lang: 'hy', tour: 'dubai', name: 'Արմեն Սարգսյան' },
      { dep: 1, nights: 9, lang: 'en', tour: 'maldives', name: 'Kristine Hovhannisyan' }, { dep: 0, nights: 6, lang: 'ru', tour: 'georgia', name: 'Тигран Аветисян' },
      { dep: -8, nights: 7, lang: 'ru', tour: 'dubai', name: 'Гаяне Саакян' }, { dep: -13, nights: 10, lang: 'hy', tour: 'phuket', name: 'Անի Գրիգորյան' },
      { dep: 3, nights: 7, lang: 'ru', tour: 'sharm', name: 'Нарек Оганесян' }, { dep: 5, nights: 4, lang: 'ru', tour: null, name: 'Ирина Смирнова' },
    ];
    let pool = st.leads.filter((l) => (l.details || {}).demo_trip != null);
    if (pool.length < plan.length) {
      pool = st.leads.filter((l) => l.status === 'won' && !l.ref).slice(0, plan.length);
      pool.forEach((l, i) => { l.details = { ...(l.details || {}), demo_trip: i }; });
    }
    pool.forEach((l) => {
      const p = plan[l.details.demo_trip]; if (!p) return;
      Object.assign(l, { name: p.name, lang: p.lang, tour: p.tour, depart_on: R.addDays(today, p.dep), return_on: R.addDays(today, p.dep + p.nights), wa_opt_in: true });
      st.reminders = st.reminders.filter((r) => r.lead_id !== l.id);
      if (l.status === 'won') R.syncReminders(st.reminders, null, l, today, uuid);
    });
    st.trip_day = today;
  }
  persist() {
    const { events, ...rest } = this.st;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rest)); } catch (e) { console.warn('Демо: в хранилище браузера не осталось места — последние правки не сохранятся после перезагрузки', e); }
    this.publish();
  }
  publish() { try { localStorage.setItem('sam-cms-demo', JSON.stringify(publicSnapshot(this.st))); } catch (e) { console.warn('Демо: сайт ?cms=demo не получил правки — в хранилище браузера не осталось места', e); } }
  reset() { localStorage.removeItem(STORE_KEY); localStorage.removeItem('sam-cms-demo'); localStorage.removeItem(WA_KEY); localStorage.removeItem(MEDIA_KEY); }
  /** demo only: look at the panel as another role */
  switchRole(role) { this.st.role = role; const u = this.st.users.find((x) => x.role === role); this.st.me = u.id; this.persist(); }
  guard(what) { if (!ROLE_OK[what].includes(this.st.role)) { const e = new Error('permission denied (' + what + ')'); throw e; } }
  wait(v, ms = 120) { return new Promise((r) => setTimeout(() => r(typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))), ms)); }
  get me() { return this.st.users.find((u) => u.id === this.st.me); }

  async session() { return { user: { id: this.st.me, email: this.me.email } }; }
  async signIn() {}
  async signOut() {}
  async whoami() { const m = this.me; return this.wait({ id: m.id, email: m.email, full_name: m.full_name, role: this.st.role, lang: m.lang }, 60); }

  /** generated events + the WhatsApp clicks made on the site opened with ?cms=demo in this browser */
  events_() {
    let mine = [];
    try { mine = JSON.parse(localStorage.getItem(WA_KEY) || '[]'); } catch (e) {}
    // the number is counted from the visit id, as track() does — what the click itself says is not read
    return mine.length ? this.st.events.concat(mine.filter((e) => e && e.name === 'wa_click' && /^[a-z0-9]{8,40}$/.test(e.sid || '')).map((e) => ({ ...e, ref: refOf(e.sid) }))) : this.st.events;
  }
  /** wa_ref(code): what the site knows about the visit with this reference number — owner and manager */
  async waRef(code) { this.guard('leads'); return this.wait(waRefLookup(this.events_(), this.st.promos, code), 120); }

  // The sales journal: sales and refunds, newest first, page by page — the same as LiveApi.
  async journal({ q, status, noProfit, since, depart, offset = 0, limit = 500 } = {}) {
    this.guard('leads');
    const text = String(q || '').trim().toLowerCase(), qd = text.replace(/\D/g, ''), qr = refNorm(text);
    const digits = (l) => String(l.phone || '').replace(/\D/g, '');
    const all = this.st.leads.filter((l) => (status ? l.status === status : ['won', 'lost'].includes(l.status))
      && (!since || (l.closed_at && l.closed_at >= since))
      && (!noProfit || (l.status === 'won' && l.profit == null))
      && (!depart || (depart.none ? !l.depart_on : !!l.depart_on && l.depart_on >= depart.from && l.depart_on <= depart.to))
      && (!text || (l.name || '').toLowerCase().includes(text) || (l.message || '').toLowerCase().includes(text) || (qd.length >= 3 && digits(l).includes(qd)) || (l.ref && l.ref === qr) || (l.tags || []).includes(text)))
      .sort((a, b) => (depart && !depart.none && a.depart_on !== b.depart_on ? (a.depart_on < b.depart_on ? -1 : 1) : a.closed_at < b.closed_at ? 1 : -1));
    return this.wait({ rows: all.slice(offset, offset + limit), total: all.length }, 140);
  }
  async sale(id) { this.guard('leads'); return this.wait(this.st.leads.find((l) => l.id === id) || null, 60); }
  async saleActivity(id) {
    this.guard('leads');
    const l = this.st.leads.find((x) => x.id === id);
    if (!this.st.activity[id] && l) {
      const a = [{ id: uuid(), lead_id: id, created_at: l.created_at, actor: l.assigned_to, kind: 'system', body: 'Продажа внесена', meta: {} }];
      if (l.status === 'lost') a.push({ id: uuid(), lead_id: id, created_at: l.closed_at, actor: l.assigned_to, kind: 'status', body: 'lost', meta: { from: 'won', to: 'lost' } });
      this.st.activity[id] = a;
    }
    return this.wait(this.st.activity[id] || [], 80);
  }
  logAct(lead_id, kind, body, meta = {}) {
    (this.st.activity[lead_id] = this.st.activity[lead_id] || []).push({ id: uuid(), lead_id, created_at: iso(Date.now()), actor: this.st.me, kind, body, meta });
  }
  get currency() { return (this.st.settings.company || {}).currency || 'USD'; }
  recount(...codes) {
    codes.filter(Boolean).forEach((code) => {
      const c = this.st.coupons.find((x) => x.code.toUpperCase() === code.toUpperCase());
      if (c) c.used_count = couponUsed(this.st.leads, code);
    });
  }
  lookup_() { return (ref) => waRefLookup(this.events_(), this.st.promos, ref); }
  async updateSale(id, patch) {
    this.guard('leads');
    const l = this.st.leads.find((x) => x.id === id);
    await this.saleActivity(id);
    if ('phone' in patch) patch = { ...patch, phone: phoneNorm(patch.phone) };   // leads_phone_norm
    const old = { ...l }, next = guardLead(old, attributeLead(old, this.REM.tripGuard(old, { ...l, ...patch }), this.lookup_()), this.currency);
    if (next.status !== old.status) this.logAct(id, 'status', next.status, { from: old.status, to: next.status });
    if ((next.assigned_to || null) !== (old.assigned_to || null)) this.logAct(id, 'assign', null, { to: next.assigned_to });
    const m = moneyEdit(old, next);
    if (m) this.logAct(id, 'money', null, m);
    Object.assign(l, next);
    this.REM.syncReminders(this.st.reminders, old, l, this.today, uuid);
    this.recount(old.coupon_code, next.coupon_code);
    this.persist(); return this.wait(l, 60);
  }
  async createSale(row) {
    this.guard('leads');
    const base = { id: uuid(), created_at: iso(Date.now()), updated_at: iso(Date.now()), status: 'new', tags: [], details: {}, depart_on: null, return_on: null, wa_opt_in: false, ...row, phone: phoneNorm(row.phone) };
    const l = guardLead(null, attributeLead(null, this.REM.tripGuard(null, base), this.lookup_()), this.currency);
    this.st.leads.unshift(l); this.REM.syncReminders(this.st.reminders, null, l, this.today, uuid); this.st.activity[l.id] = [{ id: uuid(), lead_id: l.id, created_at: l.created_at, actor: this.st.me, kind: 'system', body: 'Продажа внесена', meta: {} }];
    this.recount(l.coupon_code);
    this.persist(); return this.wait(l, 60);
  }
  async deleteSale(id) {
    this.guard('write_owner');
    const cur = this.st.leads.find((l) => l.id === id);
    if (!cur) return;
    this.st.leads = this.st.leads.filter((l) => l.id !== id);
    this.st.reminders = this.st.reminders.filter((r) => r.lead_id !== id);
    delete this.st.activity[id];
    this.audit_('leads', 'delete', cur, null);   // a deleted sale leaves a line in the audit log
    this.recount(cur.coupon_code);
    this.persist();
  }
  async addActivity(lead_id, kind, body, meta) {
    this.guard('leads'); await this.saleActivity(lead_id);
    // «system», «status», «assign» and «money» are written by the rules above, never by hand (the policy on lead_activity)
    if (!['note', 'call', 'whatsapp', 'email'].includes(kind)) throw new Error('row-level security: lead_activity');
    this.logAct(lead_id, kind, body, meta);
    this.persist(); return this.wait(this.st.activity[lead_id].slice(-1)[0], 40);
  }

  // ---- flight reminders: reminders_today() and reminder_done() of 090_reminders.sql ----
  async reminders() {
    this.guard('leads');
    const st = this.st;
    return this.wait(this.REM.remindersToday({ leads: st.leads, reminders: st.reminders, tours: st.tours, templates: st.wa_templates, settings: st.settings }, this.today), 120);
  }
  async reminderDone(id, done = true) {
    this.guard('leads');
    const r = this.st.reminders.find((x) => x.id === id);
    if (!r) throw new Error('reminder_not_found');
    if (done && r.status === 'due') {
      Object.assign(r, { status: 'sent', done_by: this.st.me, done_at: iso(Date.now()) });
      await this.saleActivity(r.lead_id);
      this.logAct(r.lead_id, 'whatsapp', r.kind === 'bon_voyage' ? 'Напоминание накануне вылета отправлено' : 'Сообщение «с возвращением» отправлено', { reminder: r.kind });
    } else if (!done && r.status === 'sent') Object.assign(r, { status: 'due', done_by: null, done_at: null });
    this.persist(); return this.wait(r, 60);
  }

  // «заявок» — без спама, «покупок» — проданные с суммой: как users_list / audience_list в 040_clients.sql
  counts_(id) {
    const mine = this.st.leads.filter((l) => l.user_id === id);
    return { requests: mine.filter((l) => l.status !== 'spam').length, purchases: mine.filter((l) => l.status === 'won' && l.value > 0).length };
  }
  async users() {
    this.guard('users');
    const rows = this.st.role === 'admin' ? this.st.users : this.st.users.filter((u) => u.role !== 'client');
    // the date of birth goes to the owner and the marketer only; a manager gets null
    const seesBirth = ROLE_OK.audience.includes(this.st.role);
    return this.wait(rows.map((u) => ({ ...u, birth_date: seesBirth ? u.birth_date : null, ...this.counts_(u.id) })), 120);
  }
  // «Поездки»: as client_trips() in 160_trips.sql — owner and manager, clients only. The demo
  // makes them up from the first clients of the list, the same every time.
  async trips() {
    this.guard('leads');
    const at = (d) => { const x = new Date(Date.now() + d * 86400e3); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const ticks = (key, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [key + '-' + i, true]));
    const SAMPLES = [
      [{ dest: 'greece', people: 2, from: at(12), to: at(21), meals: ['breakfast'] }, { dest: 'europe', type: 'tourist', checked: ticks('europe-tourist', 9) }, 0.1],
      [{ dest: 'uae', people: 4, from: at(34), to: at(41), meals: ['breakfast', 'dinner'] }, {}, 0.6],
      [{}, { dest: 'usa', type: 'tourist', checked: ticks('usa-tourist', 8) }, 1.5],
      [{ dest: 'maldives', people: 2, from: at(70), to: at(79), meals: [] }, { dest: 'england', type: 'tourist', checked: ticks('england-tourist', 2) }, 3],
      [{ dest: 'egypt', people: 3, from: '', to: '', meals: ['breakfast', 'lunch', 'dinner'] }, {}, 6],
      [{ dest: 'georgia', people: 1, from: at(5), to: at(9), meals: [] }, { dest: 'japan', type: 'tourist', checked: {} }, 9],
    ];
    const clients = this.st.users.filter((u) => u.role === 'client');
    return this.wait(SAMPLES.map(([plan, checklist, ago], i) => clients[i * 5 + 1] && ({
      id: clients[i * 5 + 1].id, email: clients[i * 5 + 1].email, full_name: clients[i * 5 + 1].full_name, phone: clients[i * 5 + 1].phone, lang: clients[i * 5 + 1].lang,
      plan, checklist, updated_at: new Date(Date.now() - ago * 86400e3).toISOString(),
    })).filter(Boolean), 120);
  }
  async setRole(id, role) {
    this.guard('write_owner');
    if (id === this.st.me) throw new Error('cannot_change_own_role');
    const u = this.st.users.find((x) => x.id === id);
    if (u.role === 'admin' && role !== 'admin' && !this.st.users.some((x) => x.role === 'admin' && x.id !== id)) throw new Error('last_owner');
    this.st.audit.unshift({ id: Date.now(), at: iso(Date.now()), actor: this.st.me, table_name: 'profiles', row_id: id, action: 'update', before: { id, role: u.role, full_name: u.full_name }, after: { id, role, full_name: u.full_name } });
    u.role = role; this.persist();
  }
  async audience() {
    this.guard('audience');
    // only confirmed addresses reach the mailing list
    return this.wait(this.st.users.filter((u) => u.marketing_consent && u.email_confirmed).map(({ id, email, full_name, lang, consent_at, consent_source, created_at, birth_date }) => ({ id, email, full_name, lang, consent_at, consent_source, created_at, birth_date, ...this.counts_(id) })));
  }
  /** birthdays(month): clients with consent and a confirmed address, born in that month (1–12) */
  async birthdays(month) {
    this.guard('audience');
    const m = Number(month);
    if (!(m >= 1 && m <= 12)) throw new Error('bad_month');
    return this.wait(this.st.users.filter((u) => u.role === 'client' && u.marketing_consent && u.email_confirmed && u.birth_date && Number(u.birth_date.slice(5, 7)) === m)
      .sort((a, b) => a.birth_date.slice(8).localeCompare(b.birth_date.slice(8)) || (a.full_name || '').localeCompare(b.full_name || ''))
      .map(({ id, full_name, email, birth_date, lang }) => ({ id, full_name, email, birth_date, lang })));
  }

  async list(table) {
    if (['leads'].includes(table)) this.guard('leads');
    // RLS gives the content role no rows of any other table
    if (this.st.role === 'content' && !CONTENT_TABLES.includes(table)) return this.wait([], 60);
    const rows = (this.st[table] || []).slice();
    if (rows.length && 'sort' in rows[0]) rows.sort((a, b) => a.sort - b.sort); else rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return this.wait(rows, 100);
  }
  audit_(table, action, before, after) {
    // copies: the log keeps the row as it was at that moment, not a link to the live one
    const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
    this.st.audit.unshift({ id: Date.now() + Math.random(), at: iso(Date.now()), actor: this.st.me, table_name: table, row_id: (after || before).id || (after || before).key, action, before: copy(before), after: copy(after) });
  }
  async save(table, row) {
    if (TABLE_WRITE[table]) this.guard(TABLE_WRITE[table]);
    const list = this.st[table];
    if (table === 'campaigns' && list.some((x) => x.utm_campaign === row.utm_campaign && x.id !== row.id)) throw new Error('duplicate key utm_campaign');
    if (table === 'campaigns') row = { ...row, currency: this.campaignCurrency(row) };
    if (table === 'coupons' && list.some((x) => x.code.toUpperCase() === String(row.code).toUpperCase() && x.id !== row.id)) throw new Error('duplicate key code');
    if (table === 'tours' && list.some((x) => x.slug === row.slug && x.id !== row.id)) throw new Error('duplicate key slug');
    if (table === 'tours' && (row.tags || []).some((t) => !TOUR_TAGS.includes(t))) throw new Error('violates check constraint "tours_tags_known"');
    if (table === 'tours' && !incOk(row.i18n || {})) throw new Error('violates check constraint "tours_inc_ok"');
    if (table === 'tours' && row.photo_class != null && !PHOTO_CLASSES.includes(row.photo_class)) throw new Error('violates check constraint "tours_photo_class_known"');
    if (['tours', 'reviews', 'team'].includes(table) && !(photoOk(row.photo_url) && photoOk(row.photo_hero_url))) throw new Error('violates check constraint "' + table + '_photo_url_ok"');
    if (table === 'campaigns' && !(Number(row.spend || 0) >= 0)) throw new Error('violates check constraint "campaigns_spend_ok"');
    // the content role changes only the photo of a team member (team_content_guard)
    if (table === 'team' && this.st.role === 'content') {
      const cur = row.id && list.find((x) => x.id === row.id);
      if (!cur) throw new Error('row-level security: team');
      const rest = (o) => JSON.stringify(Object.keys({ ...cur, ...row }).filter((k) => !TEAM_FREE.includes(k)).sort().map((k) => [k, o[k] ?? null]));
      if (rest({ ...cur, ...row }) !== rest(cur)) throw new Error('team_photo_only');
    }
    if (table === 'reels' && !REEL_RE.test(row.url || '')) throw new Error('violates check constraint "reels_url_check"');
    if (table === 'wa_templates' && row.kind && list.some((x) => x.kind === row.kind && x.lang === row.lang && (x.variant || null) === (row.variant || null) && x.id !== row.id)) throw new Error('duplicate key wa_templates_kind_lang_idx');
    const now = iso(Date.now());
    if (row.id) {
      const cur = list.find((x) => x.id === row.id);
      const before = JSON.parse(JSON.stringify(cur));
      Object.assign(cur, row, { updated_at: now, updated_by: this.st.me });
      if (table === 'coupons') cur.used_count = couponUsed(this.st.leads, cur.code);   // never typed in
      this.audit_(table, 'update', before, cur); this.persist(); return this.wait(cur, 80);
    }
    const n = { ...row, id: uuid(), created_at: now, updated_at: now, updated_by: this.st.me };
    if ('sort' in (list[0] || {}) && n.sort == null) n.sort = list.length;
    if (table === 'coupons') n.used_count = couponUsed(this.st.leads, n.code);
    list.push(n); this.audit_(table, 'insert', null, n); this.persist(); return this.wait(n, 80);
  }
  /** the content role's only write to `team` — see LiveApi.saveTeamPhoto */
  async saveTeamPhoto(id, url) { return this.save('team', { id, photo_url: url || null }); }
  async remove(table, id) {
    if (TABLE_WRITE[table]) this.guard(TABLE_WRITE[table]);
    if (table === 'team' && this.st.role === 'content') throw new Error('row-level security: team');
    const cur = this.st[table].find((x) => x.id === id);
    this.st[table] = this.st[table].filter((x) => x.id !== id);
    this.audit_(table, 'delete', cur, null); this.persist();
  }
  async reorder(table, ids) { if (TABLE_WRITE[table]) this.guard(TABLE_WRITE[table]); if (table === 'team' && this.st.role === 'content') throw new Error('team_photo_only'); ids.forEach((id, i) => { const r = this.st[table].find((x) => x.id === id); if (r) r.sort = i; }); this.persist(); }

  async settings() { return this.wait(this.st.role === 'content' ? {} : this.st.settings, 60); }

  // ---- history of a content row and «Вернуть эту версию» — row_history() / restore_version() ----
  contentGuard_(table) {
    if (!CONTENT_TABLES.includes(table)) throw new Error('not_content_table');
    this.guard(TABLE_WRITE[table]);
  }
  async history(table, id) {
    this.contentGuard_(table);
    // the author's name, else the role — never the e-mail (row_history in 100_security.sql)
    const name = (a) => { const u = this.st.users.find((x) => x.id === a); return u ? (String(u.full_name || '').trim() || ROLE_LABEL[u.role] || null) : null; };
    return this.wait(this.st.audit.filter((a) => a.table_name === table && a.row_id === id && a.action !== 'delete')
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 100).map((a) => ({ id: a.id, at: a.at, action: a.action, actor: a.actor, actor_name: name(a.actor), version: a.after })), 120);
  }
  async restore(auditId) {
    const a = this.st.audit.find((x) => x.id === auditId);
    if (!a) throw new Error('version_not_found');
    this.contentGuard_(a.table_name);
    const snap = JSON.parse(JSON.stringify(a.after || a.before)), list = this.st[a.table_name], now = iso(Date.now());
    let cur = list.find((x) => x.id === a.row_id);
    // a photo of that version is no longer in the «bucket» → the present one stays (media_alive)
    let kept = false;
    ['photo_url', 'photo_hero_url'].forEach((k) => { if (k in snap && !this.mediaAlive_(snap[k])) { snap[k] = cur ? cur[k] || null : null; kept = true; } });
    if (!cur) {
      this.guard('write_owner');   // a deleted record comes back only from the owner's hands
      cur = { ...snap, updated_at: now, updated_by: this.st.me };
      list.push(cur); this.audit_(a.table_name, 'insert', null, cur);
    } else {
      const before = JSON.parse(JSON.stringify(cur));
      RESTORE_KEEPS.forEach((k) => delete snap[k]);
      if (a.table_name === 'team' && this.st.role === 'content' && Object.keys(snap).some((k) => !TEAM_FREE.includes(k) && JSON.stringify(snap[k] ?? null) !== JSON.stringify(cur[k] ?? null))) throw new Error('team_photo_only');
      Object.assign(cur, snap, { updated_at: now, updated_by: this.st.me });
      this.audit_(a.table_name, 'update', before, cur);
    }
    this.persist();
    return this.wait({ row: cur, photo_kept: kept }, 120);
  }

  // ---- the demo «bucket» ----
  saveMedia_() { try { localStorage.setItem(MEDIA_KEY, JSON.stringify(this.media)); return true; } catch (e) { return false; } }
  mediaAlive_(url) { return !url || !String(url).startsWith(MEDIA_REF) || !!this.media[String(url).slice(MEDIA_REF.length)]; }
  /** the address to put into <img> / background-image: LiveApi gives the address back as it is */
  src(url) { return url && String(url).startsWith(MEDIA_REF) ? this.media[String(url).slice(MEDIA_REF.length)] || '' : url || ''; }
  async removeFiles(urls) {
    (urls || []).forEach((u) => { if (u && String(u).startsWith(MEDIA_REF) && this.media[u.slice(MEDIA_REF.length)]) { delete this.media[u.slice(MEDIA_REF.length)]; this.removed.push(u); } });
    this.saveMedia_(); this.publish();
  }
  async saveSetting(key, value) {
    if (!(this.st.role === 'admin' || (this.st.role === 'marketer' && ['seo', 'analytics', 'stats'].includes(key)))) throw new Error('permission denied');
    if (key === 'whatsapp') value = this.REM.guardWaSettings(value);   // wa_settings_guard
    this.audit_('site_settings', 'update', { key, value: this.st.settings[key] }, { key, value });
    this.st.settings[key] = value; this.persist();
  }

  // the spend is counted in the currency of the day it was typed in (campaigns_currency, 030_stats.sql)
  campaignCurrency(row) {
    const cur = row.id && this.st.campaigns.find((x) => x.id === row.id);
    return !cur || Number(cur.spend) !== Number(row.spend) ? this.currency : cur.currency;
  }
  // The reports: the same formulas as the database, see metrics.js
  async stats(from, to) { this.guard('stats'); return this.wait(trafficStats({ leads: this.st.leads, events: this.events_(), settings: this.st.settings, from, to }), 220); }
  async sales(from, to) { this.guard('stats'); return this.wait(salesStats({ leads: this.st.leads, events: this.events_(), users: this.st.users, settings: this.st.settings, from, to }), 200); }
  async couponStats() { this.guard('stats'); return this.wait(couponStats(this.st.coupons, this.st.leads), 100); }
  async audit() { this.guard('audit'); return this.wait(this.st.audit, 100); }
  /** notify_status(): the demo sends no letters — it answers as a set-up project whose last letter left this morning */
  async notifyStatus() {
    this.guard('write_owner');
    const w = this.REM.waSettings(this.st.settings), mail = w.mail_to || String((this.st.settings.contacts || {}).email || '').trim();
    return this.wait({ last_sent_at: null, pending: 0, failed_7d: 0, last_error: null, last_error_at: null,
      reminders: { enabled: w.enabled, mail_hour: w.mail_hour, mail_to: !!mail, to: mail || null, schedule: true, secrets: true, last_sent_at: iso(Date.now() - 3 * 3600e3), last_day: this.today, pending: 0, failed_7d: 0, last_error: null } }, 60);
  }
  /** the demo sends nothing: it answers as the function does when the letter has left */
  async mailTest() {
    this.guard('write_owner');
    const mail = this.REM.waSettings(this.st.settings).mail_to || String((this.st.settings.contacts || {}).email || '').trim();
    return this.wait(mail ? { ok: true, to: mail } : { ok: false, error: 'no_agency_email' }, 400);
  }
  async upload(file) {
    // the bucket is written by the owner, the marketer and the content role — not by a manager (100_security.sql)
    if (!['admin', 'marketer', 'content'].includes(this.st.role)) throw new Error('permission denied (media)');
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const id = uuid().replace(/-/g, '').slice(0, 12);
    this.media[id] = data;
    if (!this.saveMedia_()) { delete this.media[id]; throw new Error('demo_storage_full'); }
    return MEDIA_REF + id;
  }
}
