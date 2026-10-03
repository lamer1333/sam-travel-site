// ---------------------------------------------------------------------------
// SAM TRAVEL panels — shell: sign-in, roles, two workspaces (owner / marketing),
// hash router, period picker, command palette, live lead notifications.
// ---------------------------------------------------------------------------
import { h, $, $$, mount, clear, icon, toast, fmt, initials, input, field, debounce } from './ui.js';
import { LiveApi, errText } from './api.js';
import { DemoApi } from './demo.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const app = $('#app');

export const ROLE_NAMES = { admin: 'Владелец', manager: 'Менеджер', marketer: 'Маркетолог', client: 'Клиент' };
export const STATUS = [
  ['new', 'Новая'], ['contacted', 'На связи'], ['quoted', 'Предложение'], ['won', 'Продажа'], ['lost', 'Отказ'], ['spam', 'Спам'],
];
export const STATUS_NAME = Object.fromEntries(STATUS);
export const SOURCE_NAME = { form: 'Форма на сайте', plan: 'Подбор тура', tour: 'Карточка тура', promo: 'Промо', manual: 'WhatsApp', phone: 'Звонок', walk_in: 'Пришли в офис', instagram: 'Instagram Direct' };

// ---------- navigation ----------
const NAV = {
  owner: [
    ['Работа', [
      ['dashboard', 'Сводка', 'dashboard', ['admin', 'manager']],
      ['leads', 'Заявки', 'inbox', ['admin', 'manager']],
      ['people', 'Клиенты и команда', 'users', ['admin', 'manager']],
    ]],
    ['Сайт', [
      ['content', 'Контент сайта', 'layout', ['admin']],
      ['contacts', 'Контакты и реквизиты', 'phone', ['admin']],
      ['templates', 'Шаблоны ответов', 'message', ['admin']],
    ]],
    ['Контроль', [
      ['health', 'Готовность сайта', 'heart', ['admin']],
      ['audit', 'Журнал изменений', 'history', ['admin']],
    ]],
  ],
  mkt: [
    ['Аналитика', [
      ['m/overview', 'Трафик и конверсии', 'chart', ['admin', 'marketer']],
      ['m/campaigns', 'Кампании и UTM', 'target', ['admin', 'marketer']],
    ]],
    ['Продвижение', [
      ['m/promos', 'Баннеры и поп-апы', 'megaphone', ['admin', 'marketer']],
      ['m/coupons', 'Промокоды', 'tag', ['admin', 'marketer']],
      ['m/audience', 'Подписчики', 'mail', ['admin', 'marketer']],
    ]],
    ['Сайт', [
      ['m/content', 'Туры и отзывы', 'layout', ['admin', 'marketer']],
      ['m/seo', 'SEO и пиксели', 'globe', ['admin', 'marketer']],
    ]],
  ],
};
const VIEWS = {
  dashboard: () => import('./views/dashboard.js'), leads: () => import('./views/leads.js'), people: () => import('./views/people.js'),
  content: () => import('./views/content.js'), contacts: () => import('./views/contacts.js'), templates: () => import('./views/templates.js'),
  health: () => import('./views/health.js'), audit: () => import('./views/audit.js'),
  'm/overview': () => import('./views/m-overview.js'), 'm/campaigns': () => import('./views/campaigns.js'), 'm/promos': () => import('./views/promos.js'),
  'm/coupons': () => import('./views/coupons.js'), 'm/audience': () => import('./views/audience.js'), 'm/content': () => import('./views/content.js'), 'm/seo': () => import('./views/seo.js'),
};
const PERIOD_VIEWS = ['dashboard', 'm/overview', 'm/promos'];
function wsOf(route) { return route.startsWith('m/') ? 'mkt' : 'owner'; }
function allowed(route, role) { for (const ws of Object.values(NAV)) for (const [, items] of ws) for (const it of items) if (it[0] === route) return it[3].includes(role); return false; }
function home(role) { return role === 'marketer' ? 'm/overview' : 'dashboard'; }
function titleOf(route) { for (const ws of Object.values(NAV)) for (const [, items] of ws) for (const it of items) if (it[0] === route) return it[1]; return ''; }

// ---------- context shared with views ----------
export const ctx = {
  api: null, me: null, role: null, demo: DEMO,
  period: { days: 30 },
  cache: {},
  go(route) { location.hash = '#/' + route; },
  async leads(force) { if (force || !ctx.cache.leads) ctx.cache.leads = await ctx.api.leads(); return ctx.cache.leads; },
  async users(force) { if (force || !ctx.cache.users) ctx.cache.users = await ctx.api.users(); return ctx.cache.users; },
  async settings(force) { if (force || !ctx.cache.settings) ctx.cache.settings = await ctx.api.settings(); return ctx.cache.settings; },
  staffName(id) { const u = (ctx.cache.users || []).find((x) => x.id === id); return u ? (u.full_name || u.email) : '—'; },
  team() { return (ctx.cache.users || []).filter((u) => u.role === 'admin' || u.role === 'manager'); },
  range(days = ctx.period.days) {
    const to = new Date(); const from = new Date(to.getTime() - days * 86400e3);
    return { from, to, prevFrom: new Date(from.getTime() - days * 86400e3), prevTo: from };
  },
  can(what) {
    const r = ctx.role;
    return ({ leads: ['admin', 'manager'], owner: ['admin'], marketing: ['admin', 'marketer'], team: ['admin'] }[what] || []).includes(r);
  },
  err(e) { console.error(e); toast(errText(e), 'bad'); },
  setBadge,
  rerender: () => route(),
};
window.__samPanel = ctx;   // handy in the console

// ---------- boot ----------
async function boot() {
  if (DEMO) {
    ctx.api = new DemoApi();
    return start();
  }
  if (!window.sb) { mount(app, loginView('Не загрузилась библиотека Supabase — проверьте интернет.')); return; }
  ctx.api = new LiveApi(window.sb);
  const s = await ctx.api.session().catch(() => null);
  if (!s) { mount(app, loginView()); return; }
  start();
}

async function start() {
  try {
    ctx.me = await ctx.api.whoami();
  } catch (e) { mount(app, loginView(errText(e))); return; }
  if (!ctx.me || !['admin', 'manager', 'marketer'].includes(ctx.me.role)) { mount(app, noAccess()); return; }
  ctx.role = ctx.me.role;
  ctx.cache = {};
  renderShell();
  window.addEventListener('hashchange', route);
  route();
  startLive();
  ctx.users().catch(() => {});
}

// ---------- login ----------
function loginView(msg) {
  const email = input('', { type: 'email', placeholder: 'you@samtravel.am', attrs: { autocomplete: 'username', required: true } });
  const pass = input('', { type: 'password', placeholder: '••••••••', attrs: { autocomplete: 'current-password', required: true } });
  const err = h('p', { style: { color: 'var(--bad)', margin: 0, minHeight: '1em', fontSize: '13px' } }, msg || '');
  const btn = h('button.btn.btn--primary', { type: 'submit' }, 'Войти');
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await ctx.api.signIn(email.value.trim(), pass.value); start(); }
    catch (x) { err.textContent = errText(x); } finally { btn.disabled = false; }
  } }, field('Email', email), field('Пароль', pass), err, btn);
  return h('div.login', h('div.login__card',
    h('div.login__brand', h('img', { src: 'sam-logo.png', alt: '' }), h('b', 'SAM TRAVEL')),
    h('h1', 'Панель управления'),
    h('p', 'Для владельца, менеджеров и маркетолога. Вход — тем же аккаунтом, что и на сайте; роль назначает владелец.'),
    form,
    h('div.login__demo', 'Нет доступа или хочется посмотреть? ', h('a', { href: 'admin.html?demo' }, 'Открыть демо-панель'), ' — данные сгенерированы, ничего не сохраняется на сервере.')));
}
function noAccess() {
  return h('div.login', h('div.login__card',
    h('h1', 'Нет доступа'),
    h('p', 'Этот аккаунт — клиентский. Попросите владельца назначить вам роль «Менеджер» или «Маркетолог» в разделе «Клиенты и команда».'),
    h('div.btns', h('a.btn', { href: 'cabinet.html' }, 'В личный кабинет'), h('button.btn', { onclick: async () => { await ctx.api.signOut(); location.reload(); } }, 'Выйти'))));
}

// ---------- shell ----------
let els = {};
function renderShell() {
  const role = ctx.role;
  const side = h('aside.side', { 'aria-label': 'Навигация' });
  const title = h('h1.top__title');
  const periodSeg = h('div.seg.hide-sm', { role: 'group', 'aria-label': 'Период' },
    [[7, '7 дней'], [30, '30 дней'], [90, '90 дней']].map(([d, l]) => h('button', { type: 'button', 'aria-pressed': String(ctx.period.days === d), onclick: (e) => {
      ctx.period.days = d; $$('button', periodSeg).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); route();
    } }, l)));
  const top = h('header.top',
    h('button.btn.btn--ghost.btn--icon.top__burger', { 'aria-label': 'Меню', onclick: () => toggleSide(side) }, icon('menu')),
    title, h('div.top__spacer'), periodSeg,
    h('button.search', { type: 'button', onclick: openPalette, 'aria-label': 'Поиск и команды' }, icon('search'), h('span', 'Поиск и команды'), h('kbd', navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K')),
    h('a.btn.btn--ghost.btn--icon', { href: DEMO ? 'index.html?cms=demo' : 'index.html', target: '_blank', rel: 'noopener', title: 'Открыть сайт', 'aria-label': 'Открыть сайт' }, icon('external')),
    h('button.btn.btn--ghost.btn--icon', { title: 'Тема', 'aria-label': 'Сменить тему', onclick: toggleTheme }, icon(isDark() ? 'sun' : 'moon')));
  const page = h('main.page', { id: 'page', tabindex: '-1' });
  const demoBar = DEMO ? h('div.demo-bar', h('b', 'Демо-режим.'), h('span', 'Данные сгенерированы, изменения остаются в этом браузере.'),
    h('label', 'Смотреть как: ', h('select', { onchange: (e) => { ctx.api.switchRole(e.target.value); location.hash = ''; location.reload(); } },
      [['admin', 'Владелец'], ['manager', 'Менеджер'], ['marketer', 'Маркетолог']].map(([v, l]) => h('option', { value: v, selected: v === role }, l)))),
    h('button', { onclick: () => { ctx.api.reset(); location.reload(); } }, 'Сбросить демо')) : null;
  els = { side, title, page, periodSeg };
  mount(app, h('div.shell', side, h('div.main', demoBar, top, page)));
  paintSide();
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('.cmdk')) { e.preventDefault(); openPalette(); }
  });
}
function toggleSide(side, force) {
  const open = force != null ? force : !side.classList.contains('is-open');
  side.classList.toggle('is-open', open);
  let sc = $('.side-scrim');
  if (open && !sc) { sc = h('div.side-scrim', { onclick: () => toggleSide(side, false) }); document.body.appendChild(sc); }
  else if (!open && sc) sc.remove();
}
function curWs() { const r = currentRoute(); return wsOf(r); }
function paintSide() {
  const role = ctx.role, ws = curWs();
  document.documentElement.setAttribute('data-ws', ws);
  try { localStorage.setItem('sam-admin-ws', ws); } catch (e) {}
  const both = role === 'admin';
  mount(els.side,
    h('div.side__brand', h('img', { src: 'sam-logo.png', alt: '' }), h('div', h('b', 'SAM TRAVEL'), h('small', ws === 'mkt' ? 'Панель маркетолога' : 'Панель владельца'))),
    both ? h('div.ws', { role: 'group', 'aria-label': 'Рабочее пространство' },
      h('button', { type: 'button', 'aria-pressed': String(ws === 'owner'), onclick: () => ctx.go('dashboard') }, 'Владелец'),
      h('button', { type: 'button', 'aria-pressed': String(ws === 'mkt'), onclick: () => ctx.go('m/overview') }, 'Маркетинг')) : null,
    h('nav.nav', NAV[ws].map(([group, items]) => {
      const vis = items.filter((it) => it[3].includes(role));
      if (!vis.length) return null;
      return [h('div.nav__h', group), vis.map(([r, label, ic]) => h('a', { href: '#/' + r, dataset: { route: r }, onclick: () => toggleSide(els.side, false) }, icon(ic), label,
        r === 'leads' && badgeCount ? h('span.count', String(badgeCount)) : null))];
    })),
    h('div.side__foot',
      h('div.me', h('span.avatar', initials(ctx.me.full_name || ctx.me.email)), h('div', { style: { minWidth: 0 } }, h('b', ctx.me.full_name || ctx.me.email), h('small', ROLE_NAMES[role]))),
      h('button.btn.btn--ghost.btn--sm', { style: { justifyContent: 'flex-start' }, onclick: async () => { await ctx.api.signOut(); location.href = DEMO ? 'admin.html' : 'admin.html'; } }, icon('logout'), DEMO ? 'Выйти из демо' : 'Выйти')));
  markCurrent();
}
function markCurrent() { const r = currentRoute(); $$('.nav a', els.side).forEach((a) => a.setAttribute('aria-current', a.dataset.route === r ? 'page' : 'false')); }
function currentRoute() { const r = location.hash.replace(/^#\/?/, '').split('?')[0]; const base = Object.keys(VIEWS).find((k) => r === k || r.startsWith(k + '/')); return base || ''; }

// ---------- router ----------
let seq = 0;
async function route() {
  let r = currentRoute();
  const raw = location.hash.replace(/^#\/?/, '');
  if (!r || !allowed(r, ctx.role)) { location.replace('#/' + home(ctx.role)); if (!r) return; r = home(ctx.role); }
  const params = raw.slice(r.length).replace(/^\//, '').split('/').filter(Boolean);
  if (document.documentElement.getAttribute('data-ws') !== wsOf(r)) paintSide(); else markCurrent();
  els.title.textContent = titleOf(r);
  document.title = titleOf(r) + (badgeCount ? ' (' + badgeCount + ')' : '') + ' — SAM TRAVEL';
  els.periodSeg.hidden = !PERIOD_VIEWS.includes(r);
  const my = ++seq;
  mount(els.page, h('div.loading', h('div.spinner')));
  try {
    const mod = await VIEWS[r]();
    if (my !== seq) return;
    clear(els.page);
    await mod.default(els.page, ctx, params, r);
  } catch (e) {
    if (my !== seq) return;
    console.error(e);
    mount(els.page, h('div.card', h('div.empty', h('b', 'Не удалось открыть раздел'), h('div', errText(e)), h('div', { style: { marginTop: '12px' } }, h('button.btn', { onclick: route }, icon('refresh'), 'Повторить')))));
  }
}

// ---------- theme ----------
function isDark() { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function toggleTheme(e) {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('sam-admin-theme', next); } catch (x) {}
  const b = e.currentTarget; clear(b).appendChild(icon(next === 'dark' ? 'sun' : 'moon'));
  route();   // charts re-read colours
}

// ---------- live leads ----------
let badgeCount = 0;
function setBadge(n) { badgeCount = n; paintSide(); document.title = titleOf(currentRoute()) + (n ? ' (' + n + ')' : '') + ' — SAM TRAVEL'; }
async function startLive() {
  if (!ctx.can('leads')) return;
  try { const ls = await ctx.leads(); setBadge(ls.filter((l) => l.status === 'new').length); } catch (e) { return; }
  ctx.api.onLead((l) => {
    if (ctx.cache.leads && !ctx.cache.leads.some((x) => x.id === l.id)) ctx.cache.leads.unshift(l);
    setBadge(badgeCount + 1);
    beep();
    toast('Новая заявка: ' + l.name + (l.tour ? ' · ' + l.tour : ''), 'lead', { icon: 'inbox', ms: 9000, onclick: () => ctx.go('leads/' + l.id) });
    try { if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification('Новая заявка — SAM TRAVEL', { body: l.name + ' · ' + (l.phone || ''), icon: 'icon-192.png' }); } catch (e) {}
    document.dispatchEvent(new CustomEvent('sam:lead', { detail: l }));
  });
}
function beep() {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    const a = new A(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, a.currentTime); o.frequency.setValueAtTime(1320, a.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.12, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.36);
  } catch (e) {}
}

// ---------- command palette ----------
const ACTIONS = [
  ['Новая заявка (звонок, визит)', 'plus', 'leads', 'leads/new'],
  ['Новая кампания и UTM-ссылка', 'target', 'marketing', 'm/campaigns/new'],
  ['Новый баннер или поп-ап', 'megaphone', 'marketing', 'm/promos/new'],
  ['Сгенерировать промокоды', 'tag', 'marketing', 'm/coupons/new'],
  ['Новый горящий тур', 'layout', 'marketing', (ctx) => (ctx.role === 'marketer' ? 'm/content' : 'content') + '/tours/new'],
  ['Выгрузить подписчиков (CSV)', 'download', 'marketing', 'm/audience/export'],
];
function openPalette() {
  if ($('.cmdk')) return;
  const inp = h('input', { placeholder: 'Раздел, действие, имя или телефон клиента…', 'aria-label': 'Поиск', autocomplete: 'off' });
  const list = h('ul', { role: 'listbox' });
  const ov = h('div.overlay.is-open');
  const box = h('div.cmdk', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Поиск и команды' }, inp, list);
  let items = [], sel = 0;
  function close() { ov.remove(); box.remove(); document.removeEventListener('keydown', key, true); }
  function build() {
    const q = inp.value.trim().toLowerCase();
    items = [];
    for (const ws of Object.values(NAV)) for (const [grp, its] of ws) for (const [r, label, ic, roles] of its)
      if (roles.includes(ctx.role) && (!q || label.toLowerCase().includes(q))) items.push({ g: 'Разделы', label, ic, hint: grp, run: () => ctx.go(r) });
    ACTIONS.forEach(([label, ic, need, r]) => { if (ctx.can(need) && (!q || label.toLowerCase().includes(q))) items.push({ g: 'Действия', label, ic, run: () => ctx.go(typeof r === 'function' ? r(ctx) : r) }); });
    [['Сменить тему', 'moon', () => $('.top [aria-label="Сменить тему"]').click()], ['Открыть сайт', 'external', () => window.open(DEMO ? 'index.html?cms=demo' : 'index.html', '_blank')]]
      .forEach(([label, ic, run]) => { if (!q || label.toLowerCase().includes(q)) items.push({ g: 'Действия', label, ic, run }); });
    if (q.length >= 2 && ctx.cache.leads) {
      const digits = q.replace(/\D/g, '');
      ctx.cache.leads.filter((l) => (l.name || '').toLowerCase().includes(q) || (digits.length >= 3 && (l.phone || '').replace(/\D/g, '').includes(digits))).slice(0, 7)
        .forEach((l) => items.push({ g: 'Заявки', label: l.name + ' · ' + l.phone, ic: 'inbox', hint: STATUS_NAME[l.status] + ' · ' + fmt.day(l.created_at), run: () => ctx.go('leads/' + l.id) }));
    }
    sel = Math.min(sel, Math.max(0, items.length - 1));
    paint();
  }
  function paint() {
    clear(list); let g = null;
    if (!items.length) list.appendChild(h('li', { style: { color: 'var(--ink-3)', cursor: 'default' } }, 'Ничего не найдено'));
    items.forEach((it, i) => {
      if (it.g !== g) { g = it.g; list.appendChild(h('div.cmdk__group', g)); }
      list.appendChild(h('li', { role: 'option', 'aria-selected': String(i === sel), onmouseenter: (e) => { sel = i; $$('li', list).forEach((x) => x.setAttribute('aria-selected', 'false')); e.currentTarget.setAttribute('aria-selected', 'true'); }, onclick: () => { close(); it.run(); } },
        icon(it.ic), it.label, it.hint ? h('small', it.hint) : null));
    });
    const cur = $('[aria-selected="true"]', list); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { close(); it.run(); } }
  }
  ov.addEventListener('click', close);
  inp.addEventListener('input', debounce(() => { sel = 0; build(); }, 60));
  document.addEventListener('keydown', key, true);
  document.body.append(ov, box);
  if (ctx.can('leads') && !ctx.cache.leads) ctx.leads().then(build).catch(() => {});
  build(); inp.focus();
}

boot();
