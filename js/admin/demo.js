// ---------------------------------------------------------------------------
// Demo mode (admin.html?demo): a believable agency, generated in the browser.
// Same interface as LiveApi. Nothing leaves the browser: edits persist in
// localStorage, and the public part is mirrored to 'sam-cms-demo' so the site
// opened with ?cms=demo renders what the panel shows.
// Visits are generated first; leads come out of those visits, so campaign →
// lead → sale attribution in the reports is internally consistent.
// ---------------------------------------------------------------------------
import { TOURS } from './demo-seed.js';

const STORE_KEY = 'sam-admin-demo-v1';
const DAY = 86400e3, MIN = 60e3;
const SECTIONS = ['band-prices', 'hot', 'how', 'services', 'about', 'reviews', 'blog', 'contacts'];

function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
const iso = (t) => new Date(t).toISOString();
const yv = (t) => new Date(new Date(t).getTime() + 4 * 3600e3);   // Asia/Yerevan, UTC+4 all year

// ------------------------------------------------------------------ generate
function generate() {
  const R = rng(20260929);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const wpick = (pairs) => { const tot = pairs.reduce((a, p) => a + p[1], 0); let x = R() * tot; for (const p of pairs) { x -= p[1]; if (x <= 0) return p[0]; } return pairs[pairs.length - 1][0]; };
  const now = Date.now();
  const u = (id, email, full_name, role, lang, extra = {}) => ({ id, email, full_name, role, lang, phone: null, marketing_consent: false, created_at: iso(now - 400 * DAY), last_sign_in_at: iso(now - R() * 3 * DAY), provider: 'email', bookings: 0, ...extra });
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
    { name: 'Telegram — канал Travel Armenia', channel: 'telegram', utm_source: 'telegram', utm_medium: 'referral', utm_campaign: 'tg_travel_am', utm_content: 'post_1', landing: '#plan', spend: 150, s: -45, e: -30, w: 1.2, tour: null },
    { name: 'Флаеры в офисе (QR)', channel: 'offline', utm_source: 'flyer', utm_medium: 'qr', utm_campaign: 'office_qr', utm_content: '', landing: '#checklist', spend: 60, s: -90, e: null, w: 0.15, tour: null },
    { name: 'Рассылка — зимние направления', channel: 'email', utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'winter_mail', utm_content: 'hero_button', landing: '#hot', spend: 0, s: -12, e: -9, w: 2.2, tour: 'georgia' },
  ].map((c) => ({ id: uuid(), ...c, currency: 'USD', starts_on: iso(now + c.s * DAY).slice(0, 10), ends_on: c.e == null ? null : iso(now + c.e * DAY).slice(0, 10), notes: '', archived: false, created_at: iso(now + c.s * DAY - DAY), updated_at: iso(now - 2 * DAY) }));

  const promos = [
    { name: 'Осенние горящие туры', kind: 'bar', theme: 'sunset', active: true, starts_at: iso(now - 10 * DAY), ends_at: iso(now + 12 * DAY), link: '#hot', coupon_code: 'AUTUMN7',
      i18n: { ru: { text: 'Горящие туры октября — минус 7% по промокоду', cta: 'Смотреть туры' }, en: { text: 'October hot tours — 7% off with the code', cta: 'See tours' }, hy: { text: 'Հոկտեմբերի թեժ տուրեր՝ 7% զեղչ պրոմոկոդով', cta: 'Դիտել տուրերը' } },
      audience: { langs: [], devices: [], frequency: 'always' } },
    { name: 'Новый год у моря', kind: 'popup', theme: 'brand', active: true, starts_at: iso(now + 20 * DAY), ends_at: iso(now + 60 * DAY), link: '#plan', coupon_code: 'NY2027',
      i18n: { ru: { title: 'Новый год у моря', text: 'Мальдивы, Дубай, Шарм — соберём тур под ваши даты. Скидка 5% до 1 декабря.', cta: 'Подобрать тур' }, en: { title: 'New Year by the sea', text: 'Maldives, Dubai, Sharm — a trip for your dates. 5% off until December 1.', cta: 'Plan my trip' }, hy: { title: 'Նոր տարին ծովափին', text: '', cta: '' } },
      audience: { langs: ['ru', 'hy'], devices: [], delay_s: 8, frequency: 'session' } },
    { name: 'Лето 2026 — ранее бронирование', kind: 'popup', theme: 'sea', active: false, starts_at: iso(now - 150 * DAY), ends_at: iso(now - 60 * DAY), link: '#contacts', coupon_code: null,
      i18n: { ru: { title: 'Лето уже скоро', text: 'Бронируйте Анталию до мая — лучшие отели ещё свободны.', cta: 'Оставить заявку' }, en: { title: 'Summer is close', text: 'Book Antalya before May — the best hotels are still free.', cta: 'Leave a request' } },
      audience: { frequency: 'once', delay_s: 12 } },
  ].map((p) => ({ id: uuid(), created_at: iso(now - 40 * DAY), updated_at: iso(now - 3 * DAY), ...p }));

  const organic = [['direct', 34], ['google.com', 22], ['instagram.com', 12], ['facebook.com', 5], ['yandex.ru', 3], ['t.me', 3], ['tripadvisor.com', 1]];
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
      first_response_at: resp ? iso(ts + resp * MIN) : null,
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
  coupons[0].used_count = leads.filter((l) => l.coupon_code === 'AUTUMN7').length;

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

  return { v: 3, generated: now, me: OWNER, role: 'admin', users, campaigns, promos, visits, leads, activity: {}, coupons, reviews, team, tours, settings, reels, wa_templates, audit };
}

// ------------------------------------------------------------------ stats (same shape as stats_traffic)
export function computeStats(visits, leads, from, to) {
  const f = from.getTime(), t = to.getTime();
  const vs = visits.filter((v) => v.ts >= f && v.ts < t);
  const ls = leads.filter((l) => { const x = new Date(l.created_at).getTime(); return x >= f && x < t && l.status !== 'spam'; });
  const day = (x) => yv(x).toISOString().slice(0, 10);
  const srcOfV = (v) => v.utm_source || v.ref_host || 'direct';
  const srcOfL = (l) => l.utm_source || (l.referrer ? l.referrer.replace(/^https?:\/\/(www\.)?([^/]+).*$/, '$2') : 'direct');
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const daily = {};
  for (let d = new Date(day(f) + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= day(t - 1000); d = new Date(d.getTime() + DAY)) daily[d.toISOString().slice(0, 10)] = { d: d.toISOString().slice(0, 10), visits: 0, contacts: 0, leads: 0 };
  const sources = {}, camps = {}, devices = {}, langs = {}, sections = {}, ctas = {}, tours = {}, heat = {}, lheat = {}, promos = {};
  const S = (k) => sources[k] || (sources[k] = { src: k, visits: 0, leads: 0, won: 0, revenue: 0 });
  const C = (k) => camps[k] || (camps[k] = { campaign: k, visits: 0, contacts: 0, leads: 0, won: 0, revenue: 0, profit: 0, revenue_est: 0 });
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
    const s = S(srcOfL(l)); s.leads++; if (l.status === 'won') { s.won++; s.revenue += +l.value || 0; }
    if (l.utm_campaign) { const c = C(l.utm_campaign); c.leads++; if (l.status === 'won') { c.won++; c.revenue += +l.value || 0; if (l.profit != null) c.profit = (c.profit || 0) + +l.profit; else c.revenue_est = (c.revenue_est || 0) + (+l.value || 0); } }
    if (l.tour) T(l.tour).leads++;
    const y = yv(l.created_at); inc(lheat, (y.getUTCDay() || 7) + ':' + y.getUTCHours());
    if (['form', 'plan'].includes(l.source)) contact++;
  }
  const cells = (o, key) => Object.entries(o).map(([k, n]) => { const [dow, h] = k.split(':').map(Number); return { dow, h, [key]: n }; });
  return {
    daily: Object.values(daily),
    sources: Object.values(sources).sort((a, b) => b.visits - a.visits),
    campaigns: Object.values(camps), devices, langs, sections, ctas,
    tours: Object.values(tours).sort((a, b) => b.opens - a.opens),
    heat: cells(heat, 'visits'), lead_heat: cells(lheat, 'leads'), promos: Object.values(promos),
    funnel: { visits: vs.length, engaged, intent, contact: Math.min(contact, intent + ls.length), leads: ls.length, won: ls.filter((l) => l.status === 'won').length },
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

  async leads() { this.guard('leads'); return this.wait(this.st.leads, 180); }
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
  async updateLead(id, patch) {
    this.guard('leads');
    const l = this.st.leads.find((x) => x.id === id);
    await this.leadActivity(id);
    if (patch.status && patch.status !== l.status) {
      this.logAct(id, 'status', patch.status, { from: l.status, to: patch.status });
      if (l.status === 'new' && !l.first_response_at) l.first_response_at = iso(Date.now());
      l.closed_at = ['won', 'lost', 'spam'].includes(patch.status) ? iso(Date.now()) : null;
    }
    if ('assigned_to' in patch && patch.assigned_to !== l.assigned_to) this.logAct(id, 'assign', null, { to: patch.assigned_to });
    Object.assign(l, patch, { updated_at: iso(Date.now()) });
    this.persist(); return this.wait(l, 60);
  }
  async updateLeads(ids, patch) { for (const id of ids) await this.updateLead(id, patch); }
  async createLead(row) {
    this.guard('leads');
    const l = { id: uuid(), created_at: iso(Date.now()), updated_at: iso(Date.now()), status: 'new', tags: [], details: {}, currency: 'USD', ...row };
    this.st.leads.unshift(l); this.st.activity[l.id] = [{ id: uuid(), lead_id: l.id, created_at: l.created_at, actor: this.st.me, kind: 'system', body: 'Добавлена вручную', meta: {} }];
    this.persist(); return this.wait(l, 60);
  }
  async deleteLead(id) { this.guard('write_owner'); this.st.leads = this.st.leads.filter((l) => l.id !== id); this.persist(); }
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
      const l = { id: uuid(), created_at: iso(Date.now()), updated_at: iso(Date.now()), name: names[i++], phone: '+374 9' + (1 + i) + ' 555 01' + i, message: 'Заявка с сайта: ' + tour + ', даты гибкие', source: 'form', tour, lang: 'ru', device: 'mobile', status: 'new', tags: [], details: {}, currency: 'USD', utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: 'sharm_oct', assigned_to: null };
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

  async users() {
    this.guard('users');
    const rows = this.st.role === 'admin' ? this.st.users : this.st.users.filter((u) => u.role !== 'client');
    return this.wait(rows, 120);
  }
  async setRole(id, role) {
    this.guard('write_owner');
    if (id === this.st.me) throw new Error('cannot_change_own_role');
    const u = this.st.users.find((x) => x.id === id);
    this.st.audit.unshift({ id: Date.now(), at: iso(Date.now()), actor: this.st.me, table_name: 'profiles', row_id: id, action: 'update', before: { id, role: u.role, full_name: u.full_name }, after: { id, role, full_name: u.full_name } });
    u.role = role; this.persist();
  }
  async audience() {
    this.guard('audience');
    return this.wait(this.st.users.filter((u) => u.marketing_consent).map(({ id, email, full_name, lang, consent_at, consent_source, created_at, bookings }) => ({ id, email, full_name, lang, consent_at, consent_source, created_at, bookings })));
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
    if (table === 'coupons' && list.some((x) => x.code.toUpperCase() === String(row.code).toUpperCase() && x.id !== row.id)) throw new Error('duplicate key code');
    if (table === 'tours' && list.some((x) => x.slug === row.slug && x.id !== row.id)) throw new Error('duplicate key slug');
    const now = iso(Date.now());
    if (row.id) {
      const cur = list.find((x) => x.id === row.id);
      const before = JSON.parse(JSON.stringify(cur));
      Object.assign(cur, row, { updated_at: now, updated_by: this.st.me });
      this.audit_(table, 'update', before, cur); this.persist(); return this.wait(cur, 80);
    }
    const n = { ...row, id: uuid(), created_at: now, updated_at: now, updated_by: this.st.me };
    if ('sort' in (list[0] || {}) && n.sort == null) n.sort = list.length;
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

  async stats(from, to) { this.guard('stats'); return this.wait(computeStats(this.st.visits, this.st.leads, from, to), 220); }
  async audit() { this.guard('audit'); return this.wait(this.st.audit, 100); }
  async upload(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
}
