// ---------------------------------------------------------------------------
// Small DOM toolkit for the panels: element builder, icons, formatting,
// toasts, modal / drawer / confirm, form controls, tables, CSV.
// ---------------------------------------------------------------------------

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/** h('div.card#id', {onclick, style, dataset, html}, ...children) */
export function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) m[2].replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
  if (attrs && (attrs.nodeType || typeof attrs !== 'object' || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
/** like el.append(), but skips null/false (native append would print "null") */
export function add(el, ...kids) { append(el, kids); return el; }
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); append(el, kids); return el; }

// ---------- icons (24×24 stroke paths) ----------
const P = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  layout: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M9 21V9',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  message: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  trash: 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  calendar: 'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 12h18M3 6h18M3 18h18',
  wa: 'M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1-.5-2.5-2-3-3l1-1-1-2z',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  kanban: 'M4 3h4v14H4zM10 3h4v9h-4zM16 3h4v18h-4z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
  image: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  play: 'M5 3l14 9-14 9z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i ' + cls); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || P.spark);
  s.appendChild(p); return s;
}

// ---------- formatting ----------
const LOC = 'ru-RU';
export const fmt = {
  num: (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString(LOC, { maximumFractionDigits: 0 }),
  dec: (n, d = 1) => (n == null || isNaN(n) || !isFinite(n)) ? '—' : Number(n).toLocaleString(LOC, { maximumFractionDigits: d }),
  compact: (n) => (n == null || isNaN(n)) ? '—' : Math.abs(n) >= 10000 ? Number(n).toLocaleString(LOC, { notation: 'compact', maximumFractionDigits: 1 }) : fmt.num(n),
  money: (n, cur = 'USD') => (n == null || isNaN(n) || !isFinite(n)) ? '—' : Number(n).toLocaleString(LOC, { style: 'currency', currency: cur, maximumFractionDigits: 0 }),
  pct: (x, d = 1) => (x == null || isNaN(x) || !isFinite(x)) ? '—' : (x * 100).toLocaleString(LOC, { maximumFractionDigits: d }) + '%',
  date: (d) => d ? new Date(d).toLocaleDateString(LOC, { day: 'numeric', month: 'short', year: 'numeric' }) : '—',
  day: (d) => d ? new Date(d).toLocaleDateString(LOC, { day: 'numeric', month: 'short' }) : '—',
  dt: (d) => d ? new Date(d).toLocaleString(LOC, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
  time: (d) => d ? new Date(d).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }) : '—',
  dur(min) {
    if (min == null || isNaN(min)) return '—';
    if (min < 1) return '< 1 мин';
    if (min < 60) return Math.round(min) + ' мин';
    if (min < 60 * 24) return Math.floor(min / 60) + ' ч ' + (Math.round(min % 60) ? Math.round(min % 60) + ' мин' : '');
    return Math.round(min / 60 / 24) + ' дн';
  },
  ago(d) {
    if (!d) return '—';
    const s = (Date.now() - new Date(d)) / 1000;
    if (s < 60) return 'только что';
    if (s < 3600) return Math.floor(s / 60) + ' мин назад';
    if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' дн назад';
    return fmt.date(d);
  },
  phone: (p) => p || '—',
};
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many;
}
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const slug = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[а-яё]/g, (c) => ({ а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya' }[c] || ''))
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
export const initials = (s) => String(s || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export function copyText(t, msg = 'Скопировано') {
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(msg), () => {
    const ta = h('textarea', { value: t, style: { position: 'fixed', opacity: 0 } }); document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg); } catch (e) { toast('Не удалось скопировать', 'bad'); } ta.remove();
  });
}

// ---------- toasts ----------
let toastBox;
export function toast(msg, kind = '', opts = {}) {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
  const t = h('div.toast' + (kind ? '.toast--' + kind : ''), opts.icon ? icon(opts.icon) : null, h('span', msg),
    opts.action ? h('button', { onclick: (e) => { e.stopPropagation(); opts.action.run(); t.remove(); } }, opts.action.label) : null);
  if (opts.onclick) t.addEventListener('click', () => { opts.onclick(); t.remove(); });
  toastBox.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, opts.ms || 3200);
  return t;
}

// ---------- overlay stack (modal / drawer) ----------
const stack = [];
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); } });
function layer(panel, onClose) {
  const ov = h('div.overlay');
  const prevFocus = document.activeElement;
  // each new layer sits above the previous one (a template modal over a lead drawer)
  ov.style.zIndex = String(80 + stack.length * 20); panel.style.zIndex = String(90 + stack.length * 20);
  document.body.append(ov, panel);
  requestAnimationFrame(() => { ov.classList.add('is-open'); panel.classList.add('is-open'); });
  const api = {
    closed: false,
    close() {
      if (api.closed) return; api.closed = true;
      stack.splice(stack.indexOf(api), 1);
      ov.classList.remove('is-open'); panel.classList.remove('is-open');
      setTimeout(() => { ov.remove(); panel.remove(); }, 230);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      onClose && onClose();
    },
  };
  ov.addEventListener('click', () => api.close());
  stack.push(api);
  setTimeout(() => { const f = panel.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select'); if (f) f.focus(); }, 60);
  return api;
}

export function modal({ title, sub, body, actions = [], wide, onClose }) {
  const b = h('div.modal__b'), f = h('div.modal__f');
  const el = h('div.modal' + (wide ? '.modal--wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal__h', h('h3', title), sub ? h('p', sub) : null), b, f);
  const api = layer(el, onClose);
  if (body) append(b, [typeof body === 'function' ? body(api) : body]);
  actions.forEach((a) => f.appendChild(h('button.btn' + (a.kind ? '.btn--' + a.kind : ''), {
    type: 'button', onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { const r = a.onClick ? await a.onClick(api) : null; if (r !== false) api.close(); } finally { btn.disabled = false; } },
  }, a.label)));
  api.el = el; api.body = b;
  return api;
}

export function confirmDlg(text, { ok = 'Удалить', danger = true, sub } = {}) {
  return new Promise((res) => {
    let answered = false;
    modal({ title: text, sub, onClose: () => { if (!answered) res(false); },
      actions: [{ label: 'Отмена', onClick: () => { answered = true; res(false); } },
                { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; res(true); } }] });
  });
}

export function drawer({ title, sub, head, body, footer, wide, onClose }) {
  const b = h('div.drawer__b'), f = h('div.drawer__f');
  const closeBtn = h('button.btn.btn--ghost.btn--icon', { type: 'button', 'aria-label': 'Закрыть' }, icon('x'));
  const hd = h('div.drawer__h', h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', title), sub ? h('p', sub) : null, head || null), closeBtn);
  const el = h('div.drawer' + (wide ? '.drawer--wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, hd, b, f);
  const api = layer(el, onClose);
  closeBtn.addEventListener('click', () => api.close());
  api.el = el; api.body = b; api.foot = f; api.head = hd;
  if (body) append(b, [typeof body === 'function' ? body(api) : body]);
  if (footer) append(f, [typeof footer === 'function' ? footer(api) : footer]); else f.remove();
  return api;
}

// ---------- form controls ----------
export function field(label, control, hint, extra) {
  return h('label.field', h('span', label, extra || null), control, hint ? h('small', hint) : null);
}
export function input(value, opts = {}) {
  const el = h('input.input', { type: opts.type || 'text', value: value == null ? '' : value, placeholder: opts.placeholder || '', ...opts.attrs });
  if (opts.oninput) el.addEventListener('input', () => opts.oninput(el.value, el));
  if (opts.onchange) el.addEventListener('change', () => opts.onchange(el.value, el));
  return el;
}
export function textarea(value, opts = {}) {
  const el = h('textarea.textarea', { placeholder: opts.placeholder || '', rows: opts.rows || 3 });
  el.value = value || '';
  if (opts.oninput) el.addEventListener('input', () => opts.oninput(el.value, el));
  return el;
}
export function select(options, value, onchange, cls = '') {
  const el = h('select.select' + cls, ...options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value ?? '') }, l);
  }));
  if (onchange) el.addEventListener('change', () => onchange(el.value, el));
  return el;
}
export function toggle(checked, label, onchange) {
  const inp = h('input', { type: 'checkbox', checked: !!checked });
  if (onchange) inp.addEventListener('change', () => onchange(inp.checked, inp));
  return h('label.switch', inp, h('i'), label ? h('span', label) : null);
}
export function seg(options, value, onchange) {
  const el = h('div.seg', { role: 'group' });
  options.forEach(([v, l]) => el.appendChild(h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: (e) => {
    const me = e.currentTarget;
    $$('button', el).forEach((b) => b.setAttribute('aria-pressed', String(b === me))); onchange(v);
  } }, l)));
  return el;
}
export function chipsPick(options, selected, onchange, multi = true) {
  const set = new Set(selected || []);
  const el = h('div.chips');
  options.forEach(([v, l]) => {
    const b = h('button.chip', { type: 'button', 'aria-pressed': String(set.has(v)), onclick: () => {
      if (multi) { set.has(v) ? set.delete(v) : set.add(v); } else { set.clear(); set.add(v); }
      $$('.chip', el).forEach((c, i) => c.setAttribute('aria-pressed', String(set.has(options[i][0]))));
      onchange(Array.from(set));
    } }, l);
    el.appendChild(b);
  });
  return el;
}
export function tagsInput(tags, onchange, placeholder = 'Добавить тег…') {
  let list = (tags || []).slice();
  const wrap = h('div.row', { style: { gap: '6px' } });
  const inp = h('input.input', { placeholder, style: { width: '160px', minHeight: '30px', padding: '4px 9px' } });
  function paint() {
    clear(wrap);
    list.forEach((t) => wrap.appendChild(h('span.tag', t, h('button', { type: 'button', 'aria-label': 'Убрать', onclick: () => { list = list.filter((x) => x !== t); paint(); onchange(list); } }, '×'))));
    wrap.appendChild(inp);
  }
  inp.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) {
      e.preventDefault(); const v = inp.value.trim().toLowerCase();
      if (!list.includes(v)) { list.push(v); onchange(list); }
      inp.value = ''; paint(); inp.focus();
    }
  });
  paint(); return wrap;
}
export function stars(n) { return h('span.stars', { 'aria-label': n + ' из 5' }, '★'.repeat(n) + '☆'.repeat(5 - n)); }
export function starsPick(value, onchange) {
  const el = h('div.stars--pick', { role: 'radiogroup', 'aria-label': 'Оценка' });
  const paint = () => $$('button', el).forEach((b, i) => b.classList.toggle('on', i < value));
  for (let i = 1; i <= 5; i++) el.appendChild(h('button', { type: 'button', 'aria-label': i + ' из 5', onclick: () => { value = i; paint(); onchange(i); } }, '★'));
  paint(); return el;
}

// ---------- trilingual editor ----------
export const LANGS = [['en', 'EN'], ['ru', 'RU'], ['hy', 'HY']];
export function isFilled(obj, fields) {
  if (!obj) return false;
  return fields.every((f) => {
    const v = obj[f.key];
    if (f.optional) return true;
    return Array.isArray(v) ? v.filter(Boolean).length > 0 : !!(v && String(v).trim());
  });
}
/** fields: [{key, label, type: 'text'|'textarea'|'list', max, placeholder, optional}] */
export function i18nEditor(value, fields, onchange) {
  const data = JSON.parse(JSON.stringify(value || {}));
  LANGS.forEach(([l]) => { data[l] = data[l] || {}; });
  let cur = 'en';
  const tabs = h('div.langtabs'), body = h('div.stack');
  function paintTabs() {
    clear(tabs);
    LANGS.forEach(([l, label]) => tabs.appendChild(h('button', { type: 'button', 'aria-pressed': String(l === cur), onclick: () => { cur = l; paintTabs(); paintBody(); } },
      h('i', { class: isFilled(data[l], fields) ? '' : 'is-missing' }), label)));
    if (cur !== 'en') tabs.appendChild(h('button.btn.btn--ghost.btn--sm', { type: 'button', style: { marginLeft: 'auto' }, title: 'Заполнить пустые поля текстом из EN — дальше переведите',
      onclick: () => { fields.forEach((f) => { const v = data[cur][f.key]; if (!v || (Array.isArray(v) && !v.length)) data[cur][f.key] = JSON.parse(JSON.stringify(data.en[f.key] || (f.type === 'list' ? [] : ''))); }); emit(); paintBody(); paintTabs(); } }, icon('copy'), 'Скопировать из EN'));
  }
  function emit() { onchange(JSON.parse(JSON.stringify(data))); paintTabsLater(); }
  const paintTabsLater = debounce(paintTabs, 150);
  function paintBody() {
    clear(body);
    const d = data[cur];
    fields.forEach((f) => {
      if (f.type === 'list') {
        const items = (d[f.key] || []).slice();
        const list = h('div.stack', { style: { gap: '6px' } });
        const draw = () => {
          clear(list);
          items.forEach((it, i) => list.appendChild(h('div.row', { style: { flexWrap: 'nowrap' } },
            input(it, { oninput: (v) => { items[i] = v; d[f.key] = items; emit(); } }),
            h('button.btn.btn--ghost.btn--icon', { type: 'button', 'aria-label': 'Удалить пункт', onclick: () => { items.splice(i, 1); d[f.key] = items; emit(); draw(); } }, icon('x')))));
          list.appendChild(h('button.btn.btn--sm', { type: 'button', style: { justifySelf: 'start' }, onclick: () => { items.push(''); d[f.key] = items; draw(); $$('input', list).pop().focus(); } }, icon('plus'), 'Пункт'));
        };
        draw();
        body.appendChild(h('div.field', h('span', f.label), list));
        return;
      }
      const ctrl = f.type === 'textarea' ? textarea(d[f.key], { rows: f.rows || 3, placeholder: f.placeholder }) : input(d[f.key], { placeholder: f.placeholder });
      const cnt = f.max ? h('span.counter') : null;
      const upd = () => { if (cnt) { const n = ctrl.value.length; cnt.textContent = n + ' / ' + f.max; cnt.classList.toggle('is-over', n > f.max); } };
      ctrl.addEventListener('input', () => { d[f.key] = ctrl.value; upd(); emit(); });
      upd();
      body.appendChild(field(f.label + (f.optional ? ' (необязательно)' : ''), ctrl, f.hint, cnt));
    });
  }
  paintTabs(); paintBody();
  return h('div', tabs, body);
}
export function langDots(i18n, fields) {
  return h('span.langdots', LANGS.map(([l, label]) => h('span', { class: isFilled(i18n && i18n[l], fields) ? '' : 'is-missing', title: isFilled(i18n && i18n[l], fields) ? label + ': заполнено' : label + ': нет перевода' }, label)));
}
export const pickLang = (o, l = 'ru') => (o && (o[l] || o.en || o.ru || o.hy)) || {};

// ---------- tables ----------
/** columns: [{key, label, render(row), sort: fn|true, align:'r', cls}] */
export function table({ columns, rows, onRow, selectable, selected, onSelect, empty = 'Пусто', foot, initialSort }) {
  let sortKey = initialSort ? initialSort[0] : null, dir = initialSort ? initialSort[1] : -1;
  const sel = selected || new Set();
  const wrap = h('div.tbl-wrap');
  function val(c, r) { return typeof c.sort === 'function' ? c.sort(r) : r[c.key]; }
  function paint() {
    let data = rows.slice();
    if (sortKey) { const c = columns.find((x) => x.key === sortKey) || { key: sortKey }; data.sort((a, b) => { const x = val(c, a), y = val(c, b); return (x > y ? 1 : x < y ? -1 : 0) * dir; }); }
    const all = selectable ? h('input', { type: 'checkbox', 'aria-label': 'Выбрать все', checked: data.length && data.every((r) => sel.has(r.id)), onchange: (e) => { data.forEach((r) => e.target.checked ? sel.add(r.id) : sel.delete(r.id)); onSelect && onSelect(sel); paint(); } }) : null;
    const head = h('tr', selectable ? h('th', { style: { width: '34px' } }, all) : null, columns.map((c) => h('th', {
      class: (c.align === 'r' ? 'r ' : '') + (sortKey === c.key ? 'is-sorted' : ''), dataset: c.sort ? { sort: c.key } : undefined,
      onclick: c.sort ? () => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = -1; } paint(); } : null,
    }, c.label, sortKey === c.key ? (dir > 0 ? ' ↑' : ' ↓') : '')));
    const body = data.length ? data.map((r) => h('tr', { class: (onRow ? 'is-click ' : '') + (sel.has(r.id) ? 'is-selected' : ''), onclick: onRow ? (e) => { if (!e.target.closest('input,button,a,select,label')) onRow(r); } : null },
      selectable ? h('td', h('input', { type: 'checkbox', 'aria-label': 'Выбрать', checked: sel.has(r.id), onchange: (e) => { e.target.checked ? sel.add(r.id) : sel.delete(r.id); onSelect && onSelect(sel); paint(); } })) : null,
      columns.map((c) => { const v = c.render ? c.render(r) : r[c.key]; return h('td', { class: (c.align === 'r' ? 'r num ' : '') + (c.cls || '') }, v == null ? '—' : v); })))
      : [h('tr', h('td', { colspan: columns.length + (selectable ? 1 : 0) }, h('div.empty', empty)))];
    mount(wrap, h('table.tbl', h('thead', head), h('tbody', body), foot && data.length ? h('tfoot', foot(data)) : null));
  }
  paint();
  wrap.refresh = (newRows) => { if (newRows) rows = newRows; paint(); };
  return wrap;
}

// ---------- files ----------
export function download(name, content, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = h('a', { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** columns: [[header, row => value]] — UTF-8 BOM so Excel opens Cyrillic/Armenian correctly */
export function csv(name, rows, columns) {
  const q = (v) => { const s = v == null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const out = [columns.map((c) => q(c[0])).join(',')].concat(rows.map((r) => columns.map((c) => q(c[1](r))).join(','))).join('\n');
  download(name, '﻿' + out, 'text/csv;charset=utf-8');
  toast('Выгружено: ' + rows.length + ' ' + plural(rows.length, 'строка', 'строки', 'строк'));
}

// ---------- drag to reorder (.item children) ----------
export function sortable(listEl, onReorder) {
  let dragEl = null;
  listEl.addEventListener('dragstart', (e) => { const it = e.target.closest('[draggable]'); if (!it) return; dragEl = it; it.classList.add('is-drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.dataset.id || ''); });
  listEl.addEventListener('dragend', () => { if (dragEl) dragEl.classList.remove('is-drag'); $$('.is-over', listEl).forEach((x) => x.classList.remove('is-over')); dragEl = null; });
  listEl.addEventListener('dragover', (e) => {
    if (!dragEl) return; e.preventDefault();
    const over = e.target.closest('[draggable]'); if (!over || over === dragEl) return;
    const r = over.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
    over.parentNode.insertBefore(dragEl, after ? over.nextSibling : over);
  });
  listEl.addEventListener('drop', (e) => { if (!dragEl) return; e.preventDefault(); onReorder($$('[draggable]', listEl).map((x) => x.dataset.id)); });
}

export function loading() { return h('div.loading', h('div.spinner')); }
export function emptyState(title, text, action) { return h('div.empty', h('b', title), text ? h('div', text) : null, action ? h('div', { style: { marginTop: '12px' } }, action) : null); }
export function pageHead(title, text, ...actions) { return h('div.page-head', h('div', h('h2', title), text ? h('p', text) : null), h('div.btns', actions)); }
export function card(title, sub, ...kids) {
  const right = kids.length && kids[0] && kids[0].__right ? kids.shift() : null;
  return h('section.card', title ? h('div.card__h', h('div', h('h3', title), sub ? h('p', sub) : null), right) : null, kids);
}
export function right(el) { el.__right = true; return el; }
