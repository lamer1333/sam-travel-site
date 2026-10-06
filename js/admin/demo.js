// ---------------------------------------------------------------------------
// Demo mode (admin.html?demo): a believable agency, generated in the browser.
// Same interface as LiveApi. Nothing leaves the browser: edits persist in
// localStorage, and the public part is mirrored to 'sam-cms-demo' so the site
// opened with ?cms=demo renders what the panel shows.
// Visits are generated first; leads come out of those visits, so campaign →
// lead → sale attribution in the reports is internally consistent.
// ---------------------------------------------------------------------------
import { TOURS } from './demo-seed.js';
import { channelOf, cohortStats, marginOf, salesStats, couponStats, inWorkingSet } from './metrics.js';

const STORE_KEY = 'sam-admin-demo-v1';
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
  if (n.status === 'won' && (statusCh || valueCh) && !(v > 0)) fail('sale_needs_value');
  if (valueCh || profitCh || (statusCh && n.status === 'won')) {
    if (v != null && v < 0) fail('value_negative');
    if (p != null && (p < 0 || v == null || p > v)) fail('profit_out_of_range');
  }
  n.currency = ins || valueCh ? currency : old.currency;
  if (n.status === 'lost' && (statusCh || (n.lost_reason || null) !== (old.lost_reason || null)) && !String(n.lost_reason || '').trim()) fail('lost_reason_required');
  return n;
}
/** used_count of a promo code = sold leads with it, always recounted (leads_coupon_recount) */
const couponUsed = (leads, code) => leads.filter((l) => l.status === 'won' && l.coupon_code && l.coupon_code.toUpperCase() === String(code).toUpperCase()).length;

// ------------------------------------------------------------------ generate
function generate() {
  const R = rng(20260929);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const wpick = (pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let x = R() * tot; for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; } return pairs[pairs.length - 1][0]; };
  const now = Date.now();
  const u = (id, email, full_name, role, lang, extra = {}) => ({ id, email, full_name, role, lang, phone: null, marketing_consent: false, created_at: iso(now - 400 * DAY), last_sign_in_at: iso(now - R() * 3 * DAY), provider: 'email', email_confirmed: true, birth_date: null, ...extra });
  const OWNER = uuid(), M1 = uuid(), M2 = uuid(), MK = uuid();
  const users = [
    u(OWNER, 'owner@samtravel.am', 'Самвел', 'admin', 'ru'),
    u(M1, 'anna@samtravel.am', 'Анна Гаспарян', 'manager', 'ru'),
    u(M2, 'davit@samtravel.am', 'Давит Арутюнян', 'manager', 'hy'),
    u(MK, 'lilit@samtravel.am', 'Лилит Саргсян', 'marketer', 'ru'),
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
        provider: wpick([['email', 5], ['google', 4], ['mailru', 1]]), last_sign_in_at: iso(created + R() * (now - created)),
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
    { name: 'Лето 2026 — ранее бронирование', kind: 'popup', theme: 'sea', active: false, starts_at: iso(now - 150 * DAY), ends_at: iso(now - 60 * DAY), link: '#contacts', coupon_code: null,
      i18n: { ru: { title: 'Лето уже скоро', text: 'Бронируйте Анталию до мая — лучшие отели ещё свободны.', cta: 'Оставить заявку' }, en: { title: 'Summer is close', text: 'Book Antalya before May — the best hotels are still free.', cta: 'Leave a request' } },
      audience: { frequency: 'once', delay_s: 12 } },
  ].map((p) => ({ id: uuid(), created_at: iso(now - 40 * DAY), updated_at: iso(now - 3 * DAY), ...p }));

  const organic = [['direct', 34], ['google.com', 22], ['instagram.com', 12], ['facebook.com', 5], ['yandex.ru', 3], ['tripadvisor.com', 1]];
  const tourW = TOURS.filter((t) => t.published).map((t) => [t.slug, t.slug === 'sharm' ? 3 : t.slug === 'dubai' ? 3 : 2]);
  const visits = [];
  const managers = [M1, M1, M2, M2, OWNER];
  const leads = [];
  const msgs = {
    sharm: ['Шарм на 7 ночей, 2 взрослых + ребёнок 6 лет, конец октября', 'Хотим в Шарм, всё включено, бюджет до 2000$', 'Sharm, 2 adults, Oct 20–27, reef hotel please'],
    dubai: ['Дубай в ноябре на 5 ночей, отель на пляже', 'Дубай + сафари, 3 человека', 'Dubai for 4 nights, early November, city hotel'],
    maldives: ['Медовый месяц на Мальдивах, водная вилла', 'Мальдивы в декабре, 2 взрослых, полупансион'],
    georgia: ['Гудаури на выходные, 4 человека, нужен инструктор', 'Лыжи в январе, семья с 2 детьми'],
    phuket: ['Пхукет в феврале на 10 ночей', 'Таиланд, тихий пляж, 2 взрослых'],
    null: ['Куда можно поехать в ноябре с детьми недорого?', 'Нужна шенгенская виза и тур в Париж', 'Групповая поездка на 12 человек, корпоратив', 'Հետաքրքրում է Դուբայը նոյեմբերին', 'Подскажите по визе в ОАЭ', ''],
  };
  let dayIdx = 0;
  for (let d = 120; d >= 0; d--) {
    const dayStart = new Date(yv(now - d * DAY).toISOString().slice(0, 10) + 'T00:00:00+04:00').getTime();
    const dow = yv(dayStart).getUTCDay();
    let base = (62 + dayIdx * 0.35) * (dow === 0 || dow === 6 ? 0.78 : 1) * (0.85 + R() * 0.3);
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
      const ts = dayStart + hour * 3600e3 + R() * 3600e3;
      if (ts > now) continue;
      const v = { ts, sid: Math.random().toString(36).slice(2, 12),
        device: wpick([['mobile', 68], ['desktop', 27], ['tablet', 5]]), lang: wpick([['ru', 45], ['hy', 35], ['en', 20]]),
        ref_host: null, utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, ev: {} };
      if (c) Object.assign(v, { utm_source: c.utm_source, utm_medium: c.utm_medium, utm_campaign: c.utm_campaign, utm_content: c.utm_content || null });
      else { const o = wpick(organic); v.ref_host = o === 'direct' ? null : o; }
      const q = c ? (c.channel === 'email' ? 1.35 : c.channel === 'offline' ? 1.5 : c.channel === 'google' ? 1.15 : 0.9) : (v.ref_host === 'google.com' ? 1.1 : v.ref_host ? 0.85 : 1.15);
      let depth = 0; while (depth < SECTIONS.length && R() < (depth < 2 ? 0.93 : 0.8) * Math.min(1.05, q)) depth++;
      v.sections = SECTIONS.slice(0, depth);
      if (R() < 0.24 * q) v.ev.tour_open = (c && c.tour && R() < 0.6) ? c.tour : wpick(tourW);
      if (c && c.landing === '#plan' && R() < 0.4) v.ev.plan_open = 1;
      if (c && c.landing === '#checklist' && R() < 0.6) v.ev.checklist_open = 1;
      if (R() < 0.08 * q) v.ev.plan_open = 1;
      if (R() < 0.05) v.ev.checklist_open = 1;
      if (R() < 0.065 * q * (c && c.channel === 'instagram' ? 1.5 : 1)) v.ev.wa_click = 1;
      if (R() < 0.014 * q) v.ev.tel_click = 1;
      if (R() < 0.012) v.ev.lang_switch = 1;
      if (v.ev.plan_open && R() < 0.35) v.ev.plan_send = 1;
      if (depth >= 7 && R() < 0.08 * q) v.ev.form_start = 1;
      promoLive.forEach((p) => {
        if (p.kind === 'bar' || R() < 0.7) { v.ev['promo_view:' + p.id] = 1; if (R() < 0.07) v.ev['promo_click:' + p.id] = 1; else if (R() < 0.3) v.ev['promo_close:' + p.id] = 1; }
      });
      visits.push(v);
      // conversions: the form, the Plan page, or WhatsApp that a manager logs by hand
      let src2 = null;
      if (v.ev.form_start && R() < 0.38) src2 = 'form';
      else if (v.ev.plan_send && R() < 0.3) src2 = 'plan';
      else if (v.ev.wa_click && R() < 0.16) src2 = 'manual';
      if (src2) leads.push(makeLead(ts + (2 + R() * 10) * MIN, v, src2));
    }
  }
  // offline leads: calls, walk-ins, Instagram DMs
  for (let d = 120; d >= 0; d--) if (R() < 0.55) {
    const ts = now - d * DAY + (R() - 0.5) * DAY; if (ts > now) continue;
    leads.push(makeLead(ts, { device: null, lang: 'ru', ev: {}, utm_source: null }, wpick([['phone', 3], ['walk_in', 1], ['instagram', 2]])));
  }
  function makeLead(ts, v, source) {
    const tour = v.ev.tour_open || (R() < 0.25 ? wpick(tourW) : null);
    const age = (now - ts) / DAY;
    let status;
    if (age < 0.05) status = 'new';
    else if (age < 1.2) status = wpick([['new', 0.25], ['contacted', 3], ['quoted', 1]]);
    else if (age < 6) status = wpick([['contacted', 2], ['quoted', 3], ['won', 1.1], ['lost', 1.6], ['spam', 0.15]]);
    else status = wpick([['won', 1.5], ['lost', 3.6], ['quoted', 0.3], ['contacted', 0.2], ['spam', 0.25]]);
    const q = v.utm_campaign === 'winter_mail' || source === 'walk_in' ? 1.6 : v.utm_medium === 'cpc' ? 1.1 : 1;
    if (status === 'lost' && R() < 0.12 * q) status = 'won';
    const manual = MANUAL.includes(source);
    if (manual && status === 'new') status = 'contacted';
    const yh = yv(ts).getUTCHours(), inHours = yh >= 10 && yh < 19;
    const resp = status === 'new' ? null : Math.max(1, Math.round((inHours ? 8 : 60) * Math.exp(R() * 2.4)));
    const nm = name();
    const value = status === 'won' ? Math.round((600 + R() * 4200) / 10) * 10 : status === 'quoted' ? Math.round((800 + R() * 3000) / 10) * 10 : null;
    return {
      id: uuid(), created_at: iso(ts), updated_at: iso(Math.min(now, ts + (resp || 0) * MIN + R() * DAY)),
      name: nm, phone: phone(), email: R() < 0.2 ? slugMail(nm) + '@gmail.com' : null,
      message: source === 'phone' ? 'Звонок в офис' : source === 'walk_in' ? 'Пришли в офис' : pick(msgs[tour] || msgs.null),
      source, tour, details: source === 'plan' ? { people: 1 + Math.floor(R() * 4), from: iso(ts + 20 * DAY).slice(0, 10), to: iso(ts + 27 * DAY).slice(0, 10), meals: ['breakfast'] } : {},
      lang: v.lang, device: v.device, page: v.utm_campaign ? '/?utm_campaign=' + v.utm_campaign : '/', referrer: v.ref_host ? 'https://' + v.ref_host + '/' : null,
      utm_source: v.utm_source || null, utm_medium: v.utm_medium || null, utm_campaign: v.utm_campaign || null, utm_content: v.utm_content || null, utm_term: null,
      coupon_code: v.utm_campaign === 'sharm_oct' && R() < 0.4 ? 'AUTUMN7' : R() < 0.05 ? 'WELCOME5' : null,
      status, lost_reason: status === 'lost' ? pick(['Дорого', 'Выбрали другое агентство', 'Перенесли поездку', 'Не отвечает', 'Не подошли даты']) : null,
      value, profit: status === 'won' && R() < 0.75 ? Math.round(value * (0.08 + R() * 0.08) / 5) * 5 : null, currency: 'USD', assigned_to: status === 'new' && R() < 0.7 ? null : pick(managers),
      tags: R() < 0.15 ? [pick(['семья', 'vip', 'повторный', 'группа', 'медовый месяц'])] : [],
      follow_up_at: (status === 'quoted' || status === 'contacted') && R() < 0.6 ? iso(now + (R() * 4 - 1.5) * DAY) : null,
      first_response_at: manual ? iso(ts) : resp ? iso(ts + resp * MIN) : null,
      closed_at: ['won', 'lost', 'spam'].includes(status) ? iso(Math.min(now, ts + (1 + R() * 6) * DAY)) : null, user_id: null,
    };
  }
  // one fresh, unanswered lead so "needs attention" has something in it
  leads.push({ ...makeLead(now - 95 * MIN, { device: 'mobile', lang: 'ru', ev: { tour_open: 'maldives' }, utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'sharm_oct' }, 'form'), status: 'new', assigned_to: null, first_response_at: null, closed_at: null, value: null, lost_reason: null, name: 'Мариам Акопян', message: 'Мальдивы на медовый месяц, декабрь, 8–10 ночей' });
  leads.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const coupons = [
    { code: 'AUTUMN7', description: 'Осенняя акция, баннер на сайте', discount_pct: 7, discount_amt: null, valid_from: iso(now - 10 * DAY), valid_until: iso(now + 12 * DAY), max_uses: 200, used_count: 0, active: true },
    { code: 'WELCOME5', description: 'Приветственная скидка для подписчиков', discount_pct: 5, discount_amt: null, valid_from: iso(now - 200 * DAY), valid_until: null, max_uses: null, used_count: 41, active: true },
    { code: 'NY2027', description: 'Новогодний поп-ап', discount_pct: 5, discount_amt: null, valid_from: iso(now + 20 * DAY), valid_until: iso(now + 60 * DAY), max_uses: 100, used_count: 0, active: true },
    { code: 'VIP-8K2Q', description: 'Персональный код постоянному клиенту', discount_pct: null, discount_amt: 150, valid_from: iso(now - 5 * DAY), valid_until: iso(now + 90 * DAY), max_uses: 1, used_count: 0, active: true },
    { code: 'SUMMER10', description: 'Лето 2026', discount_pct: 10, discount_amt: null, valid_from: iso(now - 150 * DAY), valid_until: iso(now - 60 * DAY), max_uses: 300, used_count: 118, active: false },
  ].map((c) => ({ id: uuid(), created_at: c.valid_from, ...c }));
  coupons.forEach((c) => { c.used_count = couponUsed(leads, c.code); });
  // leads that came through the site form carry the server's verdict on their promo code
  leads.forEach((l) => { if (l.coupon_code && ['form', 'plan', 'tour', 'promo'].includes(l.source)) l.details = { ...l.details, coupon_valid: couponState(coupons, l.coupon_code) }; });

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

  const tours = TOURS.map((t) => ({ id: uuid(), photo_url: null, hot_until: null, price_from: null, currency: 'USD', created_at: iso(now - 100 * DAY), updated_at: iso(now - 8 * DAY), updated_by: MK, ...t }));
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
  };
  const reels = [{ id: uuid(), url: 'https://www.instagram.com/reel/DceFC3aCMGX/', published: true, sort: 0, created_at: iso(now - 30 * DAY) }];
  const wa_templates = [
    ['Первый ответ', 'ru', 'Здравствуйте, {name}! Это {manager} из SAM TRAVEL. Получили вашу заявку{tour}. Уточните, пожалуйста, даты и сколько вас будет?'],
    ['Предложение готово', 'ru', '{name}, подобрали варианты{tour} — отправляю подборку. Цены держатся 24 часа, если что-то приглянулось — скажите, забронируем.'],
    ['Не дозвонились', 'ru', '{name}, добрый день! Не смогли до вас дозвониться по заявке{tour}. Когда вам удобно поговорить?'],
    ['First reply', 'en', 'Hi {name}! This is {manager} from SAM TRAVEL. We got your request{tour}. Could you confirm the dates and how many travellers?'],
    ['Առաջին պատասխան', 'hy', 'Բարև, {name}։ {manager}-ն է, SAM TRAVEL-ից։ Ստացանք ձեր հայտը{tour}։ Կճշտե՞ք ամսաթվերը և քանի հոգի եք։'],
  ].map(([title, lang, body], i) => ({ id: uuid(), title, lang, body, sort: i, created_at: iso(now - 50 * DAY) }));
  const clients = users.filter((x) => x.role === 'client');
  // Stage 4 (ТЗ §4.9): date of birth, e-mail confirmation, and which requests came from a
  // signed-in client. A separate generator, so the rest of the demo data stays as it was.
  const R4 = rng(4040);
  users.forEach((x) => {
    x.birth_date = iso(now - (18 + R4() * 50) * 365.25 * DAY).slice(0, 10);
    // social logins are confirmed by the provider; a few e-mail sign-ups never opened the letter
    x.email_confirmed = x.role !== 'client' || x.provider !== 'email' || R4() > 0.12;
  });
  leads.forEach((l) => { if (['form', 'plan', 'tour', 'promo'].includes(l.source) && R4() < 0.3) l.user_id = clients[Math.floor(R4() * clients.length)].id; });
  const audit = [];
  const aud = (d, actor, table_name, action, before, after) => audit.push({ id: audit.length + 1, at: iso(now - d * DAY), actor, table_name, row_id: (after || before).id || (after || before).key, action, before, after });
  aud(0.2, MK, 'promos', 'update', { ...promos[0], active: false }, promos[0]);
  aud(1.1, MK, 'tours', 'update', { ...tours[0], price_from: null }, tours[0]);
  aud(2.4, OWNER, 'site_settings', 'update', { key: 'hours', value: { ...settings.hours, to: '18:00' } }, { key: 'hours', value: settings.hours });
  aud(3, MK, 'campaigns', 'insert', null, campaigns[1]);
  aud(4.5, OWNER, 'reviews', 'update', { ...reviews[1], published: false }, reviews[1]);
  aud(6, OWNER, 'profiles', 'update', { id: MK, role: 'client', full_name: 'Лилит Саргсян' }, { id: MK, role: 'marketer', full_name: 'Лилит Саргсян' });
  aud(8, MK, 'coupons', 'insert', null, coupons[0]);
  aud(12, OWNER, 'team', 'update', { ...team[0], i18n: { ...team[0].i18n, en: { name: 'Anna G.', role: 'Beach · 8 years' } } }, team[0]);
  audit.reverse();

  return { v: 6, generated: now, me: OWNER, role: 'admin', users, campaigns, promos, visits, leads, activity: {}, coupons, reviews, team, tours, settings, reels, wa_templates, audit };
}

// ------------------------------------------------------------------ promo code in a lead (same as coupon_state() in SQL)
// yes — usable now; expired — exists but is not usable (past its date, off, used up, not started); no — no such code
export function couponState(coupons, code) {
  const now = Date.now(), want = String(code || '').trim().toUpperCase();
  const found = (coupons || []).filter((c) => String(c.code).toUpperCase() === want);
  if (!found.length) return 'no';
  const usable = (c) => c.active && new Date(c.valid_from) <= now && (!c.valid_until || new Date(c.valid_until) > now) && (c.max_uses == null || (c.used_count || 0) < c.max_uses);
  return found.some(usable) ? 'yes' : 'expired';
}

// ------------------------------------------------------------------ stats (same shape and formulas as stats_traffic, 030_stats.sql)
export function computeStats(visits, leads, from, to, settings) {
  const f = from.getTime(), t = to.getTime();
  const vs = visits.filter((v) => v.ts >= f && v.ts < t);
  const co = cohortStats(leads, from, to, settings), ls = co.leads;   // leads that came in the period, money «по заявкам периода»
  const day = (x) => yv(x).toISOString().slice(0, 10);
  const srcOfV = (v) => channelOf(null, v.utm_source, v.ref_host);   // one rule for visits and leads
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const daily = {};
  for (let d = new Date(day(f) + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= day(t - 1000); d = new Date(d.getTime() + DAY)) daily[d.toISOString().slice(0, 10)] = { d: d.toISOString().slice(0, 10), visits: 0, contacts: 0, leads: 0 };
  const sources = {}, camps = {}, devices = {}, langs = {}, sections = {}, ctas = {}, tours = {}, heat = {}, lheat = {}, promos = {};
  const S = (k) => sources[k] || (sources[k] = { src: k, visits: 0, leads: 0, won: 0, revenue: 0, profit_total: 0, estimated: false });
  const C = (k) => camps[k] || (camps[k] = { campaign: k, visits: 0, contacts: 0, leads: 0, won: 0, revenue: 0, profit: 0, revenue_est: 0, profit_total: 0, estimated: false });
  const T = (k) => tours[k] || (tours[k] = { tour: k, opens: 0, leads: 0 });
  let engaged = 0, intent = 0, contact = 0;
  for (const v of vs) {
    const dd = daily[day(v.ts)]; if (dd) dd.visits++;
    S(srcOfV(v)).visits++; if (v.utm_campaign) C(v.utm_campaign).visits++;
    inc(devices, v.device || '?'); inc(langs, v.lang || '?');
    v.sections.forEach((s) => inc(sections, s));
    const y = yv(v.ts), hk = (y.getUTCDay() || 7) + ':' + y.getUTCHours(); inc(heat, hk);
    if (v.sections.some((s) => s !== 'band-prices')) engaged++;
    const e = v.ev; let isContact = false, isIntent = false;
    for (const k in e) {
      if (k.startsWith('promo_')) { const [nm, id] = k.split(':'); const p = promos[id] || (promos[id] = { id, views: 0, clicks: 0, closes: 0 }); p[nm === 'promo_view' ? 'views' : nm === 'promo_click' ? 'clicks' : 'closes']++; inc(ctas, nm); continue; }
      inc(ctas, k);
      if (k === 'tour_open') T(e[k]).opens++;
      if (['tour_open', 'plan_open', 'checklist_open', 'form_start', 'wa_click', 'tel_click'].includes(k)) isIntent = true;
      if (['wa_click', 'tel_click', 'plan_send'].includes(k)) isContact = true;
      if ((k === 'wa_click' || k === 'tel_click') && dd) dd.contacts++;
      if ((k === 'wa_click' || k === 'tel_click') && v.utm_campaign) C(v.utm_campaign).contacts++;
    }
    if (isIntent) intent++; if (isContact) contact++;
  }
  for (const l of ls) {
    const dd = daily[day(l.created_at)]; if (dd) dd.leads++;
    if (l.tour) T(l.tour).leads++;
    const y = yv(l.created_at); inc(lheat, (y.getUTCDay() || 7) + ':' + y.getUTCHours());
    if (['form', 'plan'].includes(l.source)) contact++;
  }
  Object.entries(co.sources).forEach(([k, x]) => Object.assign(S(k), { leads: x.leads, won: x.won, revenue: x.revenue, profit_total: x.profit_total, estimated: x.estimated }));
  Object.entries(co.campaigns).forEach(([k, x]) => Object.assign(C(k), x));
  const cells = (o, key) => Object.entries(o).map(([k, n]) => { const [dow, h] = k.split(':').map(Number); return { dow, h, [key]: n }; });
  return {
    margin_pct: marginOf(settings), raw_from: null,   // the demo keeps every visit, nothing is rolled up
    daily: Object.values(daily),
    sources: Object.values(sources).sort((a, b) => b.visits - a.visits || b.leads - a.leads),
    campaigns: Object.values(camps), devices, langs, sections, ctas,
    tours: Object.values(tours).sort((a, b) => b.opens - a.opens),
    heat: cells(heat, 'visits'), lead_heat: cells(lheat, 'leads'), promos: Object.values(promos),
    funnel: { visits: vs.length, visits_detailed: vs.length, engaged, intent, contact: Math.min(contact, intent + ls.length), leads: ls.length, won: co.won },
  };
}

// ------------------------------------------------------------------ public snapshot (same shape as public_site)
export function publicSnapshot(st) {
  const now = Date.now(), today = yv(now).toISOString().slice(0, 10);
  return {
    settings: { ...st.settings, company: (({ margin_pct, currency, ...pub }) => pub)(st.settings.company || {}) },
    tours: st.tours.filter((t) => t.published && (!t.hot_until || t.hot_until >= today)).sort((a, b) => a.sort - b.sort)
      .map(({ slug, photo_url, photo_class, tags, price_from, currency, i18n }) => ({ slug, photo_url, photo_class, tags, price_from, currency, i18n })),
    reviews: st.reviews.filter((r) => r.published).sort((a, b) => (b.featured - a.featured) || (a.sort - b.sort))
      .map(({ author, trip, rating, body, photo_url, source }) => ({ author, trip, rating, body, photo_url, source })),
    team: st.team.filter((t) => t.published).sort((a, b) => a.sort - b.sort).map(({ i18n, photo_url }) => ({ i18n, photo_url })),
    reels: st.reels.filter((r) => r.published).sort((a, b) => a.sort - b.sort).map((r) => r.url),
    promos: st.promos.filter((p) => p.active && (!p.starts_at || new Date(p.starts_at) <= now) && (!p.ends_at || new Date(p.ends_at) > now))
      .map(({ id, kind, i18n, link, coupon_code, theme, audience }) => ({ id, kind, i18n, link, coupon_code, theme, audience })),
  };
}

// ------------------------------------------------------------------ the api
const ROLE_OK = {
  leads: ['admin', 'manager'], users: ['admin', 'manager', 'marketer'], audience: ['admin', 'marketer'],
  write_marketing: ['admin', 'marketer'], write_owner: ['admin'], audit: ['admin'], stats: ['admin', 'manager', 'marketer'],
};
const TABLE_WRITE = { tours: 'write_marketing', reviews: 'write_marketing', reels: 'write_marketing', promos: 'write_marketing', campaigns: 'write_marketing', coupons: 'write_marketing', team: 'write_owner', wa_templates: 'write_owner' };

export class DemoApi {
  constructor() {
    this.mode = 'demo';
    let st = null;
    try { st = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
    const fresh = generate();
    if (!st || st.v !== fresh.v) st = fresh;
    else st.visits = fresh.visits;   // visits are regenerated (deterministic), never stored
    this.st = st;
    this.listeners = [];
    this.persist();
  }
  persist() {
    const { visits, ...rest } = this.st;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rest)); } catch (e) {}
    this.publish();
  }
  publish() { try { localStorage.setItem('sam-cms-demo', JSON.stringify(publicSnapshot(this.st))); } catch (e) {} }
  reset() { localStorage.removeItem(STORE_KEY); localStorage.removeItem('sam-cms-demo'); }
  /** demo only: look at the panel as another role */
  switchRole(role) { this.st.role = role; const u = this.st.users.find((x) => x.role === role); this.st.me = u.id; this.persist(); }
  guard(what) { if (!ROLE_OK[what].includes(this.st.role)) { const e = new Error('permission denied (' + what + ')'); throw e; } }
  wait(v, ms = 120) { return new Promise((r) => setTimeout(() => r(typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))), ms)); }
  get me() { return this.st.users.find((u) => u.id === this.st.me); }

  async session() { return { user: { id: this.st.me, email: this.me.email } }; }
  async signIn() {}
  async signOut() {}
  async whoami() { const m = this.me; return this.wait({ id: m.id, email: m.email, full_name: m.full_name, role: this.st.role, lang: m.lang }, 60); }

  // The same loading rule as LiveApi: open leads + closed (or created) in the last `days`
  // stay in memory, the rest come by search and pages.
  async leads({ days = 90 } = {}) { this.guard('leads'); const since = Date.now() - days * DAY; return this.wait(this.st.leads.filter((l) => inWorkingSet(l, since)), 180); }
  async findLeads({ q, phone, source, manager, tour, spam, mine, noProfit, since, offset = 0, limit = 500 } = {}) {
    this.guard('leads');
    const text = String(q || '').toLowerCase(), qd = text.replace(/\D/g, ''), pd = String(phone || '').replace(/\D/g, '');
    const digits = (l) => String(l.phone || '').replace(/\D/g, '');
    const all = this.st.leads.filter((l) => (spam || l.status !== 'spam')
      && (!source || l.source === source) && (!manager || (manager === 'none' ? !l.assigned_to : l.assigned_to === manager))
      && (!mine || l.assigned_to === mine) && (!tour || l.tour === tour) && (!since || l.created_at >= since)
      && (!noProfit || (l.status === 'won' && (l.profit == null || !(+l.value > 0))))
      && (!pd || digits(l).includes(pd))
      && (!text || (l.name || '').toLowerCase().includes(text) || (l.message || '').toLowerCase().includes(text) || (qd.length >= 3 && digits(l).includes(qd)) || (l.tags || []).includes(text)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return this.wait({ rows: all.slice(offset, offset + limit), total: all.length }, 140);
  }
  async lead(id) { this.guard('leads'); return this.wait(this.st.leads.find((l) => l.id === id) || null, 60); }
  async leadActivity(id) {
    this.guard('leads');
    const l = this.st.leads.find((x) => x.id === id);
    if (!this.st.activity[id] && l) {
      const a = [{ id: uuid(), lead_id: id, created_at: l.created_at, actor: null, kind: 'system', body: 'Создана с сайта (' + l.source + ')', meta: {} }];
      if (l.first_response_at) {
        a.push({ id: uuid(), lead_id: id, created_at: l.first_response_at, actor: l.assigned_to, kind: 'whatsapp', body: 'Первый ответ в WhatsApp', meta: {} });
        if (l.status !== 'new') a.push({ id: uuid(), lead_id: id, created_at: l.first_response_at, actor: l.assigned_to, kind: 'status', body: 'contacted', meta: { from: 'new', to: 'contacted' } });
      }
      if (['quoted', 'won', 'lost'].includes(l.status)) a.push({ id: uuid(), lead_id: id, created_at: iso(new Date(l.first_response_at || l.created_at).getTime() + 5 * 3600e3), actor: l.assigned_to, kind: 'note', body: 'Отправил(а) 3 варианта отелей, ждём ответа до завтра.', meta: {} });
      if (['won', 'lost'].includes(l.status) && l.closed_at) a.push({ id: uuid(), lead_id: id, created_at: l.closed_at, actor: l.assigned_to, kind: 'status', body: l.status, meta: { from: 'quoted', to: l.status } });
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
  async updateLead(id, patch) {
    this.guard('leads');
    const l = this.st.leads.find((x) => x.id === id);
    await this.leadActivity(id);
    const old = { ...l }, next = guardLead(old, { ...l, ...patch }, this.currency);
    if (next.status !== old.status) this.logAct(id, 'status', next.status, { from: old.status, to: next.status });
    if ((next.assigned_to || null) !== (old.assigned_to || null)) this.logAct(id, 'assign', null, { to: next.assigned_to });
    // the lead was already closed and stays closed: every money edit leaves «было → стало»
    if (CLOSED.includes(old.status) && CLOSED.includes(next.status)) {
      const m = {};
      if (num(next.value) !== num(old.value)) m.value = { from: num(old.value), to: num(next.value) };
      if (num(next.profit) !== num(old.profit)) m.profit = { from: num(old.profit), to: num(next.profit) };
      if (next.status === old.status && !sameTime(next.closed_at, old.closed_at)) m.closed_at = { from: old.closed_at, to: next.closed_at };
      if (Object.keys(m).length) this.logAct(id, 'money', null, m);
    }
    Object.assign(l, next);
    this.recount(old.coupon_code, next.coupon_code);
    this.persist(); return this.wait(l, 60);
  }
  async updateLeads(ids, patch) { for (const id of ids) await this.updateLead(id, patch); }
  async createLead(row) {
    this.guard('leads');
    const l = guardLead(null, { id: uuid(), created_at: iso(Date.now()), updated_at: iso(Date.now()), status: 'new', tags: [], details: {}, ...row }, this.currency);
    this.st.leads.unshift(l); this.st.activity[l.id] = [{ id: uuid(), lead_id: l.id, created_at: l.created_at, actor: this.st.me, kind: 'system', body: 'Добавлена вручную', meta: {} }];
    this.recount(l.coupon_code);
    this.persist(); return this.wait(l, 60);
  }
  async deleteLead(id) {
    this.guard('write_owner');
    const cur = this.st.leads.find((l) => l.id === id);
    if (!cur) return;
    this.st.leads = this.st.leads.filter((l) => l.id !== id);
    delete this.st.activity[id];
    this.audit_('leads', 'delete', cur, null);   // a deleted lead leaves a line in the audit log
    this.recount(cur.coupon_code);
    this.persist();
  }
  async addActivity(lead_id, kind, body, meta) {
    this.guard('leads'); await this.leadActivity(lead_id);
    this.logAct(lead_id, kind, body, meta);
    const l = this.st.leads.find((x) => x.id === lead_id);
    if (l && !l.first_response_at && ['call', 'whatsapp', 'email', 'note'].includes(kind)) l.first_response_at = iso(Date.now());
    this.persist(); return this.wait(this.st.activity[lead_id].slice(-1)[0], 40);
  }
  /** a new lead "arrives" now and then, so the live toast can be seen */
  onLead(cb) {
    const names = ['Сона Григорян', 'Hayk Petrosyan', 'Эдгар Варданян', 'Кристина Мелконян'];
    let i = 0;
    const t = setInterval(() => {
      if (!ROLE_OK.leads.includes(this.st.role) || i >= names.length) return;
      const tour = ['dubai', 'sharm', 'maldives', 'phuket'][i];
      const l = { id: uuid(), created_at: iso(Date.now()), updated_at: iso(Date.now()), name: names[i++], phone: '+374 9' + (1 + i) + ' 555 01' + i, message: 'Заявка с сайта: ' + tour + ', даты гибкие', source: 'form', tour, lang: 'ru', device: 'mobile', status: 'new', tags: [], details: {}, currency: this.currency, utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'sharm_oct', assigned_to: null };
      this.st.leads.unshift(l); this.persist(); cb(l);
    }, 75000);
    // a lead sent from the site opened with ?cms=demo in another tab lands here
    const onStorage = (e) => {
      if (e.key !== STORE_KEY || !e.newValue || !ROLE_OK.leads.includes(this.st.role)) return;
      let theirs; try { theirs = JSON.parse(e.newValue).leads || []; } catch (x) { return; }
      const known = new Set(this.st.leads.map((l) => l.id));
      theirs.filter((l) => !known.has(l.id)).reverse().forEach((l) => { this.st.leads.unshift(l); cb(l); });
    };
    window.addEventListener('storage', onStorage);
    return () => { clearInterval(t); window.removeEventListener('storage', onStorage); };
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
    const rows = (this.st[table] || []).slice();
    if (rows.length && 'sort' in rows[0]) rows.sort((a, b) => a.sort - b.sort); else rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return this.wait(rows, 100);
  }
  audit_(table, action, before, after) {
    this.st.audit.unshift({ id: Date.now() + Math.random(), at: iso(Date.now()), actor: this.st.me, table_name: table, row_id: (after || before).id || (after || before).key, action, before, after });
  }
  async save(table, row) {
    if (TABLE_WRITE[table]) this.guard(TABLE_WRITE[table]);
    const list = this.st[table];
    if (table === 'campaigns' && list.some((x) => x.utm_campaign === row.utm_campaign && x.id !== row.id)) throw new Error('duplicate key utm_campaign');
    if (table === 'campaigns') row = { ...row, currency: this.campaignCurrency(row) };
    if (table === 'coupons' && list.some((x) => x.code.toUpperCase() === String(row.code).toUpperCase() && x.id !== row.id)) throw new Error('duplicate key code');
    if (table === 'tours' && list.some((x) => x.slug === row.slug && x.id !== row.id)) throw new Error('duplicate key slug');
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
  async remove(table, id) {
    if (TABLE_WRITE[table]) this.guard(TABLE_WRITE[table]);
    const cur = this.st[table].find((x) => x.id === id);
    this.st[table] = this.st[table].filter((x) => x.id !== id);
    this.audit_(table, 'delete', cur, null); this.persist();
  }
  async reorder(table, ids) { ids.forEach((id, i) => { const r = this.st[table].find((x) => x.id === id); if (r) r.sort = i; }); this.persist(); }

  async settings() { return this.wait(this.st.settings, 60); }
  async saveSetting(key, value) {
    if (!(this.st.role === 'admin' || (this.st.role === 'marketer' && ['seo', 'analytics', 'stats'].includes(key)))) throw new Error('permission denied');
    this.audit_('site_settings', 'update', { key, value: this.st.settings[key] }, { key, value });
    this.st.settings[key] = value; this.persist();
  }

  // the spend is counted in the currency of the day it was typed in (campaigns_currency, 030_stats.sql)
  campaignCurrency(row) {
    const cur = row.id && this.st.campaigns.find((x) => x.id === row.id);
    return !cur || Number(cur.spend) !== Number(row.spend) ? this.currency : cur.currency;
  }
  // The reports: the same formulas as the database, see metrics.js
  async stats(from, to) { this.guard('stats'); return this.wait(computeStats(this.st.visits, this.st.leads, from, to, this.st.settings), 220); }
  async sales(from, to) {
    this.guard('stats');
    const f = from.getTime(), t = to.getTime();
    return this.wait(salesStats({ leads: this.st.leads, users: this.st.users, settings: this.st.settings, from, to, visits: this.st.visits.filter((v) => v.ts >= f && v.ts < t).length }), 200);
  }
  async couponStats() { this.guard('stats'); return this.wait(couponStats(this.st.coupons, this.st.leads), 100); }
  async audit() { this.guard('audit'); return this.wait(this.st.audit, 100); }
  // Те же правила, что в 050_notify.sql: письмо — о каждой заявке с сайта, о ручных — нет;
  // читает только владелец. Почты в демо нет, поэтому письмо «доставлено» в момент заявки.
  async notifyStatus() {
    this.guard('audit');
    const sent = this.st.leads.filter((l) => !['manual', 'phone', 'walk_in', 'instagram'].includes(l.source) && l.status !== 'spam').map((l) => l.created_at).sort();
    return this.wait({ last_sent_at: sent.length ? sent[sent.length - 1] : null, pending: 0, failed_7d: 0, last_error: null, last_error_at: null }, 60);
  }
  async upload(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
}
