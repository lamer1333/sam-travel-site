// ---------------------------------------------------------------------------
// The formulas of TZ-BACKEND.md §5 (as amended by §4.11) in JavaScript — a mirror of
// supabase/migrations/070_whatsapp.sql. The live panel reads ready numbers from the
// database (stats_sales, stats_traffic, stats_coupons); this file is what the demo
// mode counts with, plus the few per-row rules the screens need (channel, reference
// number). No DOM here: supabase/test/70-whatsapp.test.mjs imports it and compares it
// with SQL — a difference between the two is a bug.
//
// Words: обращение = a wa_click or tel_click event; продажа = a journal row in «won»
// with an amount, counted by its sale date; возврат = a journal row in «lost».
// ---------------------------------------------------------------------------

const DAY = 86400e3, MIN = 60e3, TZ = 4 * 3600e3;                 // Asia/Yerevan = UTC+4 all year
export const MANUAL = ['phone', 'walk_in', 'instagram', 'manual'];   // the source the owner picks for a sale without a reference number
const ms = (d) => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : new Date(d).getTime());

export const yv = (d) => new Date(ms(d) + TZ);
export const ymd = (d) => yv(d).toISOString().slice(0, 10);
export const num = (x) => (x == null || x === '' ? null : Number(x));
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export function median(arr) { const a = arr.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

// ------------------------------------------------------------------ reference number (ref_norm / ref_ok, js/track.js)
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // no 0/O, no 1/I/L
/** the 5-character number of a visit, derived from its sid — the same function as in js/track.js */
export function refOf(sid) {
  let h = 2166136261;
  for (let i = 0; i < sid.length; i++) { h ^= sid.charCodeAt(i); h = Math.imul(h, 16777619); }
  h >>>= 0;
  let s = '';
  for (let i = 0; i < 5; i++) { s += REF_ALPHABET[h % 31]; h = Math.floor(h / 31); }
  return s;
}
const CYR = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
/** what a person typed from the chat → the number: case, «№», spaces and the Russian keyboard do not matter */
export const refNorm = (s) => String(s == null ? '' : s).toUpperCase().replace(/[АВЕКМНРСТУХ]/g, (c) => CYR[c]).replace(/[^0-9A-Z]/g, '') || null;
export const refOk = (s) => /^[2-9A-HJKMNP-Z]{5}$/.test(s || '');

// ------------------------------------------------------------------ channel (channel_of / lead_channel)
export function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase().replace(/^www\./, '') : null;
}
export const ownHost = (h) => /^(([a-z0-9-]+\.)*samtravel\.am|localhost|127\.0\.0\.1)$/.test(String(h || '').toLowerCase());
/** hand-entered source → utm_source → referrer domain (own domain = direct) → direct */
export function channelOf(source, utmSource, host) {
  if (MANUAL.includes(source)) return 'manual:' + source;
  if (utmSource) return utmSource;
  if (host && !ownHost(host)) return String(host).toLowerCase().replace(/^www\./, '');
  return 'direct';
}
/** a sale with a reference number belongs to the channel of the visit; without one — to the source the owner picked */
export const leadChannel = (l) => channelOf(l.ref ? null : l.source, l.utm_source, hostOf(l.referrer));
export const eventChannel = (e) => channelOf(null, e.utm_source, e.ref_host);

// ------------------------------------------------------------------ working hours (site_hours / work_minutes)
/** {days, open, close} in minutes of the day, or days = null when the setting cannot be read */
export function parseHours(hours) {
  const h = hours || {};
  const hm = (s, def) => { const m = /^(\d{1,2}):(\d{2})/.exec(s == null || s === '' ? def : String(s)); return m ? +m[1] * 60 + +m[2] : null; };
  const days = h.days === undefined ? [1, 2, 3, 4, 5, 6] : Array.isArray(h.days) ? h.days.map(Number) : null;
  const open = hm(h.from, '10:00'), close = hm(h.to, '19:00');
  if (!days || days.some(isNaN) || open == null || close == null) return { days: null, open: null, close: null };
  return { days, open, close };
}
/** minutes of working time between two moments: 23:00 → 10:05 with a 10:00 opening is 5 */
export function workMinutes(a, b, hours) {
  if (a == null || b == null) return null;
  const A = ms(a) + TZ, B = ms(b) + TZ;          // Yerevan wall clock on the UTC scale
  if (B <= A) return 0;
  const { days, open, close } = parseHours(hours);
  if (!days || !days.length || close <= open) return (B - A) / MIN;
  let total = 0;
  for (let d = Math.floor(A / DAY) * DAY; d <= B; d += DAY) {
    if (!days.includes(new Date(d).getUTCDay() || 7)) continue;
    const from = Math.max(A, d + open * MIN), to = Math.min(B, d + close * MIN);
    if (to > from) total += to - from;
  }
  return total / MIN;
}

// ------------------------------------------------------------------ money
/** Продажа = запись в won с суммой (§5) */
export const isSale = (l) => l.status === 'won' && num(l.value) > 0;
export const isRefund = (l) => l.status === 'lost';
export const DEFAULT_MARGIN = 10;   // % — when the owner has not set one, same as company_margin() in SQL
export const marginOf = (settings) => { const m = ((settings || {}).company || {}).margin_pct; return m != null && /^\d+(\.\d+)?$/.test(String(m)) ? Number(m) : DEFAULT_MARGIN; };
/** income of one sale: what was entered, else value × margin */
export const gainOf = (l, margin) => (num(l.profit) != null ? num(l.profit) : margin != null ? num(l.value) * margin / 100 : 0);

// ------------------------------------------------------------------ shared pieces
const CONTACT = ['wa_click', 'tel_click'];
const days = (f, t) => {
  const out = [];
  for (let d = new Date(ymd(f) + 'T00:00:00Z').getTime(); d <= new Date(ymd(t - 1000) + 'T00:00:00Z').getTime(); d += DAY) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
};
const dowHour = (ts) => { const y = yv(ts); return (y.getUTCDay() || 7) + ':' + y.getUTCHours(); };
const cells = (o, key) => Object.entries(o).map(([k, n]) => { const [dow, h] = k.split(':').map(Number); return { dow, h, [key]: n }; });
const closedIn = (l, f, t) => l.closed_at != null && ms(l.closed_at) >= f && ms(l.closed_at) < t;
/** tours: описание открыли → нажали WhatsApp по туру → купили */
function tourRows(evs, sales) {
  const o = {};
  const T = (k) => o[k] || (o[k] = { tour: k, opens: 0, contacts: 0, sales: 0 });
  evs.forEach((e) => { if (!e.tour) return; if (e.name === 'tour_open') T(e.tour).opens++; else if (e.name === 'wa_click') T(e.tour).contacts++; });
  sales.forEach((l) => { if (l.tour) T(l.tour).sales++; });
  return Object.values(o).sort((a, b) => b.opens - a.opens || b.contacts - a.contacts || b.sales - a.sales || (a.tour < b.tour ? -1 : 1));
}

// ------------------------------------------------------------------ stats_sales
/**
 * Same result as public.stats_sales(from, to).
 * leads — every journal row; events — site events [{ts, sid, name, tour, utm_source, ref_host, …}];
 * users — [{id, full_name, email}].
 */
export function salesStats({ leads, events = [], users = [], settings = {}, from, to }) {
  const f = ms(from), t = ms(to), margin = marginOf(settings);
  const evs = events.filter((e) => ms(e.ts) >= f && ms(e.ts) < t && ['page_view', 'wa_click', 'tel_click', 'tour_open'].includes(e.name));
  const rows = leads.filter((l) => ['won', 'lost'].includes(l.status) && closedIn(l, f, t));
  const sales = rows.filter(isSale), refunds = rows.filter(isRefund);
  const sum = (xs, fn) => xs.reduce((a, x) => a + (fn(x) || 0), 0);
  const count = (name) => evs.filter((e) => e.name === name).length;
  const visits = count('page_view'), wa = count('wa_click'), tel = count('tel_click'), contacts = wa + tel;
  const revenue = sum(sales, (l) => num(l.value));
  const est = sales.filter((l) => num(l.profit) == null).length;

  const daily = Object.fromEntries(days(f, t).map((d) => [d, { d, visits: 0, contacts: 0, sales: 0, revenue: 0, profit: 0, refunds: 0 }]));
  evs.forEach((e) => { const d = daily[ymd(e.ts)]; if (!d) return; if (e.name === 'page_view') d.visits++; else if (CONTACT.includes(e.name)) d.contacts++; });
  sales.forEach((l) => { const d = daily[ymd(l.closed_at)]; if (!d) return; d.sales++; d.revenue += num(l.value); d.profit += gainOf(l, margin); });
  refunds.forEach((l) => { const d = daily[ymd(l.closed_at)]; if (d) d.refunds++; });
  Object.values(daily).forEach((d) => { d.profit = round2(d.profit); });

  const byMgr = {};
  rows.filter((l) => l.assigned_to).forEach((l) => { (byMgr[l.assigned_to] = byMgr[l.assigned_to] || []).push(l); });
  const managers = Object.entries(byMgr).map(([id, xs]) => {
    const u = users.find((p) => p.id === id) || {}, s = xs.filter(isSale);
    return { id, name: (u.full_name || '').trim() || u.email || null, sales: s.length, refunds: xs.filter(isRefund).length,
      revenue: sum(s, (l) => num(l.value)), profit: round2(sum(s, (l) => gainOf(l, margin))) };
  }).sort((a, b) => b.revenue - a.revenue || b.sales - a.sales || (a.id < b.id ? -1 : 1));

  const reasons = {};
  refunds.forEach((l) => { const r = String(l.lost_reason || '').trim(); reasons[r] = (reasons[r] || 0) + 1; });

  const channels = {};
  const C = (k) => channels[k] || (channels[k] = { channel: k, visits: 0, contacts: 0, sales: 0, revenue: 0 });
  evs.forEach((e) => { if (e.name === 'tour_open') return; const c = C(eventChannel(e)); if (e.name === 'page_view') c.visits++; else c.contacts++; });
  sales.forEach((l) => { const c = C(leadChannel(l)); c.sales++; c.revenue += num(l.value); });

  const heat = {};
  evs.forEach((e) => { if (CONTACT.includes(e.name)) heat[dowHour(e.ts)] = (heat[dowHour(e.ts)] || 0) + 1; });

  return {
    currency: (settings.company || {}).currency || 'USD', margin_pct: margin,
    kpi: {
      visits, contacts, wa_clicks: wa, tel_clicks: tel,
      sales: sales.length, sales_ref: sales.filter((l) => l.ref).length, refunds: refunds.length, revenue,
      profit: round2(sum(sales, (l) => gainOf(l, margin))), profit_entered: sum(sales, (l) => num(l.profit)),
      sales_estimated: est, estimated: est > 0,
      avg_check: sales.length ? round2(revenue / sales.length) : null,
      conversion: contacts > 0 ? sales.length / contacts : null,
      visit_to_contact: visits > 0 ? contacts / visits : null,
      sales_ever: leads.some(isSale),
    },
    daily: Object.values(daily), managers,
    refund_reasons: Object.entries(reasons).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)),
    channels: Object.values(channels).sort((a, b) => b.sales - a.sales || b.contacts - a.contacts || b.visits - a.visits || (a.channel < b.channel ? -1 : 1)),
    tours: tourRows(evs, sales),
    contact_heat: cells(heat, 'n'),
  };
}

// ------------------------------------------------------------------ stats_traffic
/**
 * Same result as public.stats_traffic(from, to) while raw events are kept (the demo keeps
 * every event, so raw_from is always null here).
 */
export function trafficStats({ leads, events = [], settings = {}, from, to }) {
  const f = ms(from), t = ms(to), margin = marginOf(settings);
  const evs = events.filter((e) => ms(e.ts) >= f && ms(e.ts) < t);
  const sales = leads.filter((l) => isSale(l) && closedIn(l, f, t));
  const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

  const daily = Object.fromEntries(days(f, t).map((d) => [d, { d, visits: 0, contacts: 0 }]));
  const sources = {}, camps = {}, devices = {}, langs = {}, ctas = {}, heat = {}, cheat = {}, promos = {};
  const money = () => ({ won: 0, revenue: 0, profit: 0, revenue_est: 0, profit_total: 0, estimated: false });
  const S = (k) => sources[k] || (sources[k] = { src: k, visits: 0, contacts: 0, ...money() });
  const C = (k) => camps[k] || (camps[k] = { campaign: k, visits: 0, contacts: 0, ...money() });
  const sectionSids = {}, engaged = new Set(), intent = new Set(), contact = new Set();
  let visits = 0;
  for (const e of evs) {
    const d = daily[ymd(e.ts)], isContact = CONTACT.includes(e.name);
    if (e.name === 'page_view') {
      visits++; if (d) d.visits++;
      S(eventChannel(e)).visits++; inc(devices, e.device || '?'); inc(langs, e.lang || '?'); inc(heat, dowHour(e.ts));
    } else if (e.name === 'section_view') {
      if (e.section) (sectionSids[e.section] = sectionSids[e.section] || new Set()).add(e.sid);
      if (e.section && e.section !== 'band-prices') engaged.add(e.sid);
    } else inc(ctas, e.name);
    if (isContact) { if (d) d.contacts++; S(eventChannel(e)).contacts++; inc(cheat, dowHour(e.ts)); contact.add(e.sid); }
    if (e.utm_campaign) { const c = C(e.utm_campaign); if (e.name === 'page_view') c.visits++; else if (isContact) c.contacts++; }
    if (['tour_open', 'plan_open', 'checklist_open', 'wa_click', 'tel_click'].includes(e.name)) intent.add(e.sid);
    if (e.promo_id && e.name.startsWith('promo_')) {
      const p = promos[e.promo_id] || (promos[e.promo_id] = { id: e.promo_id, views: 0, clicks: 0, closes: 0 });
      p[e.name === 'promo_view' ? 'views' : e.name === 'promo_click' ? 'clicks' : 'closes']++;
    }
  }
  const put = (x, l) => { x.won++; x.revenue += num(l.value); if (num(l.profit) != null) x.profit += num(l.profit); else { x.revenue_est += num(l.value); x.estimated = true; } };
  sales.forEach((l) => { put(S(leadChannel(l)), l); if (l.utm_campaign) put(C(l.utm_campaign), l); });
  [sources, camps].forEach((o) => Object.values(o).forEach((x) => { x.profit_total = round2(x.profit + x.revenue_est * (margin || 0) / 100); }));

  return {
    margin_pct: margin, raw_from: null,
    daily: Object.values(daily),
    sources: Object.values(sources).map(({ profit, revenue_est, ...x }) => x).sort((a, b) => b.visits - a.visits || b.contacts - a.contacts || b.won - a.won || (a.src < b.src ? -1 : 1)),
    campaigns: Object.values(camps).sort((a, b) => (a.campaign < b.campaign ? -1 : 1)),
    devices, langs,
    sections: Object.fromEntries(Object.entries(sectionSids).map(([k, s]) => [k, s.size])),
    ctas,
    tours: tourRows(evs, sales),
    heat: cells(heat, 'visits'), contact_heat: cells(cheat, 'n'), promos: Object.values(promos),
    funnel: { visits, visits_detailed: visits, engaged: engaged.size, intent: intent.size, contact: contact.size, won: sales.length, won_ref: sales.filter((l) => l.ref).length },
  };
}

// ------------------------------------------------------------------ stats_coupons
export function couponStats(coupons, leads) {
  const n = {};
  leads.forEach((l) => { if (!l.coupon_code || l.status === 'spam') return; const k = String(l.coupon_code).toUpperCase(), x = n[k] || (n[k] = { leads: 0, sales: 0 }); x.leads++; if (isSale(l)) x.sales++; });
  return coupons.map((c) => ({ code: c.code, leads: (n[String(c.code).toUpperCase()] || {}).leads || 0, sales: (n[String(c.code).toUpperCase()] || {}).sales || 0 }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

// ------------------------------------------------------------------ CSV of the sales journal
/**
 * Columns of the journal export. The money columns are the raw fields the reports sum, and
 * «Продажа» / «Дата продажи» follow the same rules as stats_sales — so the file, the
 * dashboard and a direct SQL query give the same totals.
 * x = { channelName, tourName, staffName, currency }
 */
export function saleCsvColumns(x) {
  return [
    ['Запись', (l) => (isSale(l) ? 'Продажа' : isRefund(l) ? 'Возврат' : l.status)],
    ['Продажа', (l) => (isSale(l) ? 'да' : '')], ['Дата продажи', (l) => (l.status === 'won' && l.closed_at ? ymd(l.closed_at) : '')],
    ['Дата возврата', (l) => (isRefund(l) && l.closed_at ? ymd(l.closed_at) : '')], ['Причина возврата', (l) => (isRefund(l) ? l.lost_reason : '')],
    ['Имя', (l) => l.name], ['Телефон', (l) => l.phone], ['Направление', (l) => x.tourName(l.tour)], ['Что купили', (l) => l.message],
    ['Вылет', (l) => l.depart_on], ['Возвращение', (l) => l.return_on], ['Язык клиента', (l) => l.lang],
    ['Номер обращения', (l) => l.ref], ['Канал', (l) => x.channelName(leadChannel(l))], ['utm_source', (l) => l.utm_source], ['utm_campaign', (l) => l.utm_campaign],
    ['Сумма', (l) => l.value], ['Доход агентства', (l) => l.profit], ['Валюта', () => x.currency],
    ['Кто внёс', (l) => (l.assigned_to ? x.staffName(l.assigned_to) : '')], ['Промокод', (l) => l.coupon_code], ['Теги', (l) => (l.tags || []).join(' ')],
  ];
}
