// ---------------------------------------------------------------------------
// The formulas of TZ-BACKEND.md §5 in JavaScript — a mirror of
// supabase/migrations/030_stats.sql. The live panel reads ready numbers from the
// database (stats_sales, stats_traffic, stats_coupons); this file is what the demo
// mode counts with, plus the few per-lead rules the screens need (channel, answer time
// in working hours). No DOM here: supabase/test/30-stats.test.mjs imports it and compares
// it with SQL on 1500 leads — a difference between the two is a bug.
// ---------------------------------------------------------------------------

const DAY = 86400e3, MIN = 60e3, TZ = 4 * 3600e3;                 // Asia/Yerevan = UTC+4 all year
export const MANUAL = ['phone', 'walk_in', 'instagram', 'manual'];   // typed in by a manager
export const OPEN = ['new', 'contacted', 'quoted'];
const ms = (d) => (d instanceof Date ? d.getTime() : typeof d === 'number' ? d : new Date(d).getTime());

export const yv = (d) => new Date(ms(d) + TZ);
export const ymd = (d) => yv(d).toISOString().slice(0, 10);
export const num = (x) => (x == null || x === '' ? null : Number(x));
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
export function median(arr) { const a = arr.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }

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
export const leadChannel = (l) => channelOf(l.source, l.utm_source, hostOf(l.referrer));

// ------------------------------------------------------------------ working hours (site_hours / work_minutes)
/** {days, open, close} in minutes of the day, or days = null when the setting cannot be read */
export function parseHours(hours) {
  const h = hours || {};
  const sla = Number(h.sla_min) > 0 ? Number(h.sla_min) : 60;
  const hm = (s, def) => { const m = /^(\d{1,2}):(\d{2})/.exec(s == null || s === '' ? def : String(s)); return m ? +m[1] * 60 + +m[2] : null; };
  const days = h.days === undefined ? [1, 2, 3, 4, 5, 6] : Array.isArray(h.days) ? h.days.map(Number) : null;
  const open = hm(h.from, '10:00'), close = hm(h.to, '19:00');
  if (!days || days.some(isNaN) || open == null || close == null) return { days: null, open: null, close: null, sla };
  return { days, open, close, sla };
}
export const slaOf = (hours) => parseHours(hours).sla;
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
/** first answer of a lead in working minutes; only requests from the site have one */
export const responseMinutes = (l, hours) => (MANUAL.includes(l.source) || !l.first_response_at ? null : workMinutes(l.created_at, l.first_response_at, hours));
/** how long a new lead has been waiting, in working minutes */
export const waitMinutes = (l, hours, now = Date.now()) => workMinutes(l.created_at, now, hours);

// ------------------------------------------------------------------ money
/** Продажа = заявка в won с суммой (§5) */
export const isSale = (l) => l.status === 'won' && num(l.value) > 0;
export const DEFAULT_MARGIN = 10;   // % — when the owner has not set one, same as company_margin() in SQL
export const marginOf = (settings) => { const m = ((settings || {}).company || {}).margin_pct; return m != null && /^\d+(\.\d+)?$/.test(String(m)) ? Number(m) : DEFAULT_MARGIN; };
/** income of one sale: what the manager entered, else value × margin */
export const gainOf = (l, margin) => (num(l.profit) != null ? num(l.profit) : margin != null ? num(l.value) * margin / 100 : 0);

// ------------------------------------------------------------------ which leads the panel keeps in memory
/** all open leads + the ones closed (or created) since `since`; the rest come by search and pages */
export const inWorkingSet = (l, since) => OPEN.includes(l.status) || (l.closed_at && ms(l.closed_at) >= ms(since)) || ms(l.created_at) >= ms(since);

// ------------------------------------------------------------------ stats_sales
/**
 * Same result as public.stats_sales(from, to).
 * leads — every lead; users — [{id, full_name, email}]; visits — page views in [from, to).
 */
export function salesStats({ leads, users = [], settings = {}, visits = 0, from, to }) {
  const f = ms(from), t = ms(to), margin = marginOf(settings), hours = settings.hours, sla = slaOf(hours);
  const within = (d) => d != null && ms(d) >= f && ms(d) < t;
  const ld = leads.filter((l) => l.status !== 'spam' && (within(l.created_at) || within(l.closed_at) || OPEN.includes(l.status))).map((l) => {
    const cIn = within(l.created_at), sale = isSale(l);
    return {
      l, cIn, sale, kIn: ['won', 'lost'].includes(l.status) && within(l.closed_at),
      gain: sale ? gainOf(l, margin) : null,
      resp: cIn ? responseMinutes(l, hours) : null,
    };
  });
  const sum = (xs, fn) => xs.reduce((a, x) => a + (fn(x) || 0), 0);
  const sold = (xs) => xs.filter((x) => x.kIn && x.sale), lostOf = (xs) => xs.filter((x) => x.kIn && x.l.status === 'lost');
  const came = ld.filter((x) => x.cIn), sales = sold(ld), lost = lostOf(ld);
  const noAmount = ld.filter((x) => x.kIn && x.l.status === 'won' && !x.sale).sort((a, b) => { const x = ymd(a.l.closed_at) + a.l.id, y = ymd(b.l.closed_at) + b.l.id; return x < y ? -1 : x > y ? 1 : 0; });
  const revenue = sum(sales, (x) => num(x.l.value));
  const resp = ld.map((x) => x.resp).filter((x) => x != null);
  const conv = sales.length + lost.length ? sales.length / (sales.length + lost.length) : null;
  const quoted = ld.filter((x) => x.l.status === 'quoted'), quotedValue = sum(quoted, (x) => num(x.l.value));
  const est = sales.filter((x) => num(x.l.profit) == null).length;

  const daily = {};
  for (let d = new Date(ymd(f) + 'T00:00:00Z').getTime(); d <= new Date(ymd(t - 1000) + 'T00:00:00Z').getTime(); d += DAY) {
    const k = new Date(d).toISOString().slice(0, 10);
    daily[k] = { d: k, leads: 0, won: 0, lost: 0, in_work: 0, sales: 0, revenue: 0, profit: 0 };
  }
  came.forEach((x) => { const d = daily[ymd(x.l.created_at)]; if (!d) return; d.leads++; if (x.sale) d.won++; else if (x.l.status === 'lost') d.lost++; else d.in_work++; });
  sales.forEach((x) => { const d = daily[ymd(x.l.closed_at)]; if (!d) return; d.sales++; d.revenue += num(x.l.value); d.profit += x.gain; });
  Object.values(daily).forEach((d) => { d.profit = round2(d.profit); });

  const byMgr = {};
  ld.filter((x) => x.l.assigned_to && (x.cIn || x.kIn)).forEach((x) => { (byMgr[x.l.assigned_to] = byMgr[x.l.assigned_to] || []).push(x); });
  const managers = Object.entries(byMgr).map(([id, xs]) => {
    const u = users.find((p) => p.id === id) || {}, s = sold(xs), lo = lostOf(xs);
    return {
      id, name: (u.full_name || '').trim() || u.email || null,
      leads: xs.filter((x) => x.cIn).length, sales: s.length, lost: lo.length,
      conversion: s.length + lo.length ? s.length / (s.length + lo.length) : null,
      revenue: sum(s, (x) => num(x.l.value)), profit: round2(sum(s, (x) => x.gain)),
      resp_median_min: median(xs.map((x) => x.resp)),
    };
  }).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);

  const reasons = {};
  lost.forEach((x) => { const r = String(x.l.lost_reason || '').trim(); reasons[r] = (reasons[r] || 0) + 1; });
  const channels = {};
  came.forEach((x) => { const k = leadChannel(x.l), c = channels[k] || (channels[k] = { channel: k, leads: 0, won: 0, revenue: 0 }); c.leads++; if (x.sale) { c.won++; c.revenue += num(x.l.value); } });

  return {
    currency: (settings.company || {}).currency || 'USD', margin_pct: margin, sla_min: sla,
    kpi: {
      leads: came.length, sales: sales.length, lost: lost.length, revenue,
      profit: round2(sum(sales, (x) => x.gain)), profit_entered: sum(sales, (x) => num(x.l.profit)),
      sales_estimated: est, estimated: est > 0,
      sales_no_amount: noAmount.length, no_amount_lead: noAmount.length ? noAmount[0].l.id : null,
      avg_check: sales.length ? round2(revenue / sales.length) : null,
      conversion: conv, visits, visit_to_lead: visits > 0 ? came.length / visits : null,
      resp_median_min: median(resp), resp_n: resp.length,
      within_sla: resp.length ? resp.filter((m) => m <= sla).length / resp.length : null,
      open: { new: ld.filter((x) => x.l.status === 'new').length, contacted: ld.filter((x) => x.l.status === 'contacted').length, quoted: quoted.length },
      quoted_value: quotedValue, forecast: conv == null ? null : round2(quotedValue * conv),
      sales_ever: leads.some(isSale),
    },
    daily: Object.values(daily), managers,
    lost_reasons: Object.entries(reasons).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)),
    channels: Object.values(channels).sort((a, b) => b.leads - a.leads || a.channel.localeCompare(b.channel)),
  };
}

// ------------------------------------------------------------------ the lead side of stats_traffic
/**
 * Leads that CAME in [from, to), by channel and by campaign — «по заявкам периода».
 * profit_total = entered income + value × margin for the sales without one; estimated says so.
 */
export function cohortStats(leads, from, to, settings) {
  const f = ms(from), t = ms(to), margin = marginOf(settings);
  const ls = leads.filter((l) => l.status !== 'spam' && ms(l.created_at) >= f && ms(l.created_at) < t);
  const row = () => ({ leads: 0, won: 0, revenue: 0, profit: 0, revenue_est: 0, profit_total: 0, estimated: false });
  const sources = {}, campaigns = {};
  const put = (o, k, l) => {
    const x = o[k] || (o[k] = row()); x.leads++;
    if (!isSale(l)) return;
    x.won++; x.revenue += num(l.value);
    if (num(l.profit) != null) x.profit += num(l.profit); else { x.revenue_est += num(l.value); x.estimated = true; }
  };
  ls.forEach((l) => { put(sources, leadChannel(l), l); if (l.utm_campaign) put(campaigns, l.utm_campaign, l); });
  [sources, campaigns].forEach((o) => Object.values(o).forEach((x) => { x.profit_total = round2(x.profit + x.revenue_est * (margin || 0) / 100); }));
  return { leads: ls, sources, campaigns, won: ls.filter(isSale).length };
}

// ------------------------------------------------------------------ stats_coupons
export function couponStats(coupons, leads) {
  const n = {};
  leads.forEach((l) => { if (!l.coupon_code || l.status === 'spam') return; const k = String(l.coupon_code).toUpperCase(), x = n[k] || (n[k] = { leads: 0, sales: 0 }); x.leads++; if (isSale(l)) x.sales++; });
  return coupons.map((c) => ({ code: c.code, leads: (n[String(c.code).toUpperCase()] || {}).leads || 0, sales: (n[String(c.code).toUpperCase()] || {}).sales || 0 }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

// ------------------------------------------------------------------ CSV of leads
/**
 * Columns of the leads export. The money columns are the raw fields the reports sum, and
 * «Продажа» / «Дата продажи» / «Первый ответ» follow the same rules as stats_sales — so the
 * file, the dashboard and a direct SQL query give the same totals.
 * x = { fmtDt, statusName, sourceName, channelName, tourName, staffName, currency, hours }
 */
export function leadCsvColumns(x) {
  return [
    ['Дата', (l) => x.fmtDt(l.created_at)], ['Дата (Ереван)', (l) => ymd(l.created_at)], ['Имя', (l) => l.name], ['Телефон', (l) => l.phone], ['Email', (l) => l.email],
    ['Статус', (l) => x.statusName(l.status)], ['Направление', (l) => x.tourName(l.tour)], ['Сообщение', (l) => l.message],
    ['Источник', (l) => x.sourceName(l.source)], ['Канал', (l) => x.channelName(leadChannel(l))], ['utm_source', (l) => l.utm_source], ['utm_campaign', (l) => l.utm_campaign],
    ['Менеджер', (l) => (l.assigned_to ? x.staffName(l.assigned_to) : '')], ['Сумма', (l) => l.value], ['Доход агентства', (l) => l.profit], ['Валюта', () => x.currency],
    ['Продажа', (l) => (isSale(l) ? 'да' : '')], ['Дата продажи', (l) => (l.status === 'won' && l.closed_at ? ymd(l.closed_at) : '')],
    ['Дата отказа', (l) => (l.status === 'lost' && l.closed_at ? ymd(l.closed_at) : '')], ['Причина отказа', (l) => l.lost_reason],
    ['Первый ответ, раб. мин', (l) => { const m = responseMinutes(l, x.hours); return m == null ? '' : Math.round(m); }], ['Промокод', (l) => l.coupon_code], ['Теги', (l) => (l.tags || []).join(' ')],
  ];
}
