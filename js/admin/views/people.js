// People: the team and their roles, registered clients.
import { h, $$, mount, icon, fmt, toast, confirmDlg, input, select, table, csv, debounce, pageHead, initials, plural } from '../ui.js';
import { ROLE_NAMES } from '../main.js';

const ROLE_HINT = {
  admin: 'Всё: заявки, контент, роли, реквизиты, журнал',
  manager: 'Заявки и клиенты',
  marketer: 'Аналитика, кампании, промо, промокоды, подписчики, туры и отзывы. Без телефонов клиентов',
  client: 'Только свой личный кабинет',
};
export default async function peopleView(root, ctx, params) {
  const owner = ctx.can('owner');
  const TABS = [['team', 'Команда'], owner ? ['clients', 'Клиенты'] : null].filter(Boolean);
  const tab = TABS.some((t) => t[0] === params[0]) ? params[0] : 'team';
  root.append(pageHead('Клиенты и команда', owner ? 'Чтобы добавить сотрудника: он регистрируется на сайте обычным способом, а вы назначаете ему роль здесь.' : null),
    h('div.tabs', { role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => ctx.go('people/' + k) }, l))));
  const box = h('div'); root.append(box);
  const users = await ctx.users(true);

  if (tab === 'team') {
    const staff = users.filter((u) => u.role !== 'client');
    root.append();
    box.append(h('div.kpis', Object.keys(ROLE_HINT).filter((r) => r !== 'client').map((r) => h('div.kpi', h('span.kpi__label', ROLE_NAMES[r]), h('span.kpi__value', String(staff.filter((u) => u.role === r).length)), h('small.muted', ROLE_HINT[r])))));
    if (owner) {
      const q = input('', { placeholder: 'Email зарегистрированного человека', attrs: { type: 'email' } });
      const role = select([['manager', 'Менеджер'], ['marketer', 'Маркетолог'], ['admin', 'Владелец']], 'manager');
      box.append(h('div.card', { style: { marginBottom: '16px' } }, h('div.card__h', h('div', h('h3', 'Добавить в команду'), h('p', 'Человек должен сначала зарегистрироваться на сайте (меню → Войти).'))),
        h('div.row', q, role, h('button.btn.btn--primary', { onclick: async () => {
          const u = users.find((x) => (x.email || '').toLowerCase() === q.value.trim().toLowerCase());
          if (!u) { toast('Такой email не зарегистрирован. Пусть зарегистрируется на сайте.', 'bad'); return; }
          await setRole(u, role.value);
        } }, 'Назначить'))));
    }
    box.append(h('div.card.card--flush', table({ rows: staff, empty: 'В команде никого', columns: [
      { key: 'full_name', label: 'Сотрудник', render: (u) => h('div.row', { style: { flexWrap: 'nowrap' } }, h('span.avatar', initials(u.full_name || u.email)), h('div.cell-main', h('b', u.full_name || '—', u.id === ctx.me.id ? h('span.muted', ' (вы)') : null), h('small', u.email))) },
      { key: 'role', label: 'Роль', render: (u) => owner && u.id !== ctx.me.id
        ? select([['admin', 'Владелец'], ['manager', 'Менеджер'], ['marketer', 'Маркетолог'], ['client', 'Убрать из команды']], u.role, (v, el) => setRole(u, v).then((ok) => { if (!ok) el.value = u.role; }))
        : h('span.badge.badge--plain', ROLE_NAMES[u.role]) },
      { key: 'last_sign_in_at', label: 'Был в сети', render: (u) => fmt.ago(u.last_sign_in_at) },
    ] })));
  }

  if (tab === 'clients') {
    const clients = users.filter((u) => u.role === 'client');
    const f = { q: '', consent: '' };
    const list = h('div');
    const s = input('', { placeholder: 'Имя, email, телефон', attrs: { type: 'search' } });
    s.addEventListener('input', debounce(() => { f.q = s.value.trim().toLowerCase(); paint(); }, 150));
    const data = () => clients.filter((u) => (!f.q || [u.full_name, u.email, u.phone].some((x) => (x || '').toLowerCase().includes(f.q))) && (!f.consent || String(u.marketing_consent) === f.consent));
    box.append(h('div.toolbar', s, select([['', 'Все'], ['true', 'Подписаны на акции'], ['false', 'Не подписаны']], '', (v) => { f.consent = v; paint(); }),
      h('span', { style: { flex: 1 } }), h('button.btn', { onclick: () => csv('clients.csv', data(), [['Имя', (u) => u.full_name], ['Email', (u) => u.email], ['Телефон', (u) => u.phone], ['Язык', (u) => u.lang], ['Вход через', (u) => u.provider], ['Согласие на рассылку', (u) => u.marketing_consent ? 'да' : 'нет'], ['Регистрация', (u) => fmt.date(u.created_at)]]) }, icon('download'), 'CSV')), list);
    function paint() {
      const rows = data();
      mount(list, h('div.muted', { style: { margin: '0 0 8px', fontSize: '12.5px' } }, fmt.num(rows.length) + ' ' + plural(rows.length, 'клиент', 'клиента', 'клиентов')),
        h('div.card.card--flush', table({ rows: rows.slice(0, 400), initialSort: ['created_at', -1], columns: [
          { key: 'full_name', label: 'Клиент', sort: (u) => u.full_name || '', render: (u) => h('div.cell-main', h('b', u.full_name || '—'), h('small', u.email)) },
          { key: 'provider', label: 'Вход', sort: true, render: (u) => ({ email: 'Email', google: 'Google', mailru: 'Mail.ru' }[u.provider] || u.provider) },
          { key: 'lang', label: 'Язык', sort: true, render: (u) => (u.lang || '').toUpperCase() },
          { key: 'marketing_consent', label: 'Акции', sort: (u) => +u.marketing_consent, render: (u) => u.marketing_consent ? h('span.badge.badge--ok', 'да') : h('span.badge.badge--off', 'нет') },
          { key: 'created_at', label: 'Регистрация', sort: true, render: (u) => fmt.date(u.created_at) },
          { key: 'last_sign_in_at', label: 'Последний вход', sort: true, render: (u) => fmt.ago(u.last_sign_in_at) },
          { key: 'act', label: '', render: (u) => h('button.btn.btn--ghost.btn--sm', { title: 'Сделать сотрудником', onclick: () => setRole(u, 'manager') }, 'В команду') },
        ] })));
    }
    paint();
  }

  async function setRole(u, role) {
    if (u.role === role) return true;
    const ok = await confirmDlg(`${u.full_name || u.email}: ${ROLE_NAMES[u.role]} → ${role === 'client' ? 'убрать из команды' : ROLE_NAMES[role]}?`, { ok: 'Назначить', danger: role === 'admin' || role === 'client', sub: ROLE_HINT[role] });
    if (!ok) return false;
    try { await ctx.api.setRole(u.id, role); u.role = role; ctx.cache.users = null; toast('Роль изменена'); ctx.rerender(); return true; } catch (e) { ctx.err(e); return false; }
  }
}
