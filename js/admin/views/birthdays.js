// Birthdays of the month: clients who agreed to mailings and confirmed their address,
// for a greeting with a discount. Owner and marketer only — birthdays(month) checks the role.
import { h, mount, icon, fmt, select, table, csv, copyText, pageHead, plural } from '../ui.js';
import { kpi } from '../charts.js';
import { yv, birthDate } from './common.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayOf = (r) => Number(r.birth_date.slice(8, 10));
const dayMonth = (r) => dayOf(r) + ' ' + MONTHS_GEN[Number(r.birth_date.slice(5, 7)) - 1];

export default async function birthdaysView(root, ctx, params) {
  const today = yv(Date.now());                                   // the month and the day in Yerevan
  const thisMonth = today.getUTCMonth() + 1, thisDay = today.getUTCDate(), thisYear = today.getUTCFullYear();
  let month = thisMonth, rows = [];
  const turns = (r) => thisYear - Number(r.birth_date.slice(0, 4));   // the age reached this calendar year

  const picker = select(MONTHS.map((m, i) => [String(i + 1), m]), String(month), (v) => { month = Number(v); load(); });
  root.append(pageHead('Именинники месяца', 'Клиенты, которые согласились получать акции и подтвердили почту. Поздравьте скидкой — выгрузите список в сервис рассылок.',
    picker, h('button.btn.btn--primary', { onclick: () => exportCsv() }, icon('download'), 'CSV')));
  const box = h('div'); root.append(box);

  function exportCsv() {
    csv('birthdays-' + String(month).padStart(2, '0') + '.csv', rows, [['Имя', (r) => r.full_name], ['Email', (r) => r.email],
      ['Дата рождения', (r) => r.birth_date], ['День', dayOf], ['Исполняется', turns], ['Язык', (r) => r.lang]]);
  }
  function paint() {
    const left = month === thisMonth ? rows.filter((r) => dayOf(r) >= thisDay) : [];
    const todays = left.filter((r) => dayOf(r) === thisDay);
    mount(box,
      h('div.kpis',
        kpi({ label: 'Именинников в месяце', value: fmt.num(rows.length) }),
        month === thisMonth ? kpi({ label: 'Сегодня', value: fmt.num(todays.length), hint: todays.map((r) => r.full_name || r.email).join(', ') || 'Никого' }) : null,
        month === thisMonth ? kpi({ label: 'Ещё впереди в этом месяце', value: fmt.num(left.length) }) : null),
      h('div.toolbar', h('span.muted', { style: { fontSize: '12.5px' } }, fmt.num(rows.length) + ' ' + plural(rows.length, 'человек', 'человека', 'человек')),
        h('span', { style: { flex: 1 } }),
        h('button.btn.btn--sm', { onclick: () => copyText(rows.map((r) => r.email).join(', '), 'Адреса скопированы') }, icon('copy'), 'Скопировать адреса')),
      h('div.card.card--flush', table({ rows, empty: 'В этом месяце именинников нет', initialSort: ['day', 1], columns: [
        { key: 'day', label: 'День', sort: dayOf, render: (r) => h('b', dayMonth(r), month === thisMonth && dayOf(r) === thisDay ? h('span.badge.badge--ok', { style: { marginLeft: '8px' } }, 'сегодня') : null) },
        { key: 'full_name', label: 'Клиент', sort: (r) => r.full_name || '', render: (r) => h('div.cell-main', h('b', r.full_name || '—'), h('small', r.email)) },
        { key: 'birth_date', label: 'Дата рождения', sort: true, render: (r) => birthDate(r.birth_date) },
        { key: 'turns', label: 'Исполняется', sort: turns, render: (r) => String(turns(r)) },
        { key: 'lang', label: 'Язык', sort: true, render: (r) => (r.lang || '').toUpperCase() },
      ] })));
  }
  async function load() {
    try { rows = await ctx.api.birthdays(month); } catch (e) { rows = []; ctx.err(e); }
    paint();
  }
  await load();
  if (params[0] === 'export') exportCsv();
}
