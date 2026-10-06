// Owner dashboard: money and the path visits → WhatsApp and phone clicks → sales.
// Every number comes ready from the database — stats_sales(), 070_whatsapp.sql
// (TZ-BACKEND.md §4.11, §5). The panel does not recount anything.
// The site has no request form: an «обращение» is a click on a WhatsApp or phone link,
// a sale is what the owner typed in. Money is «по дате продажи».
import { h, icon, fmt, table, plural, currency } from '../ui.js';
import { kpi, timeChart, barList, funnel, heatmap, heatPeak } from '../charts.js';
import { loadTours, tourName, srcName } from './common.js';

export default async function dashboard(root, ctx) {
  const rg = ctx.range();
  const [s, p] = await Promise.all([
    ctx.api.sales(rg.from, rg.to), ctx.api.sales(rg.prevFrom, rg.prevTo).catch(() => null), ctx.users().catch(() => []), loadTours(ctx),
  ]);
  const k = s.kpi, pk = p ? p.kpi : {}, days = s.daily, cur = currency();

  root.append(h('div.page-head', h('div',
    h('h2', greeting() + ((ctx.me.full_name || '').trim() ? ', ' + ctx.me.full_name.trim().split(' ')[0] : '') + '!'),
    h('p', `За ${ctx.period.days} ${plural(ctx.period.days, 'день', 'дня', 'дней')}: ${fmt.num(k.contacts)} ${plural(k.contacts, 'обращение', 'обращения', 'обращений')} с сайта, ${fmt.num(k.sales)} ${plural(k.sales, 'продажа', 'продажи', 'продаж')} на ${fmt.money(k.revenue, cur)}.`
      + (k.refunds ? ` Возвратов: ${k.refunds}.` : ''))),
    ctx.can('sales') ? h('div.btns', h('button.btn', { onclick: () => ctx.go('sales') }, icon('inbox'), 'К продажам'), h('button.btn.btn--primary', { onclick: () => ctx.go('sales/new') }, icon('plus'), 'Продажа')) : null));

  const BY_SALE = 'По дате продажи: продажи, записанные в этом периоде';
  root.append(h('div.kpis',
    kpi({ label: 'Выручка', value: fmt.money(k.revenue, cur), cur: k.revenue, prev: pk.revenue, spark: days.map((d) => d.revenue), hint: 'Сумма продаж. ' + BY_SALE }),
    kpi({ label: k.estimated ? 'Доход агентства ≈' : 'Доход агентства', value: k.sales ? fmt.money(k.profit, cur) : '—', cur: k.profit, prev: pk.profit, spark: days.map((d) => d.profit),
      hint: !k.sales ? 'Появится после первой продажи: комиссию вы указываете, когда вносите продажу'
        : k.estimated ? `Комиссия указана в ${k.sales - k.sales_estimated} из ${k.sales} продаж; остальные оценены по марже ${s.margin_pct}%`
        : 'Сумма комиссий, указанных в продажах' }),
    kpi({ label: 'Продажи', value: fmt.num(k.sales), cur: k.sales, prev: pk.sales, spark: days.map((d) => d.sales), hint: `${BY_SALE}. Из них с номером обращения (клиент писал с сайта): ${k.sales_ref}` }),
    kpi({ label: 'Средний чек', value: fmt.money(k.avg_check, cur), cur: k.avg_check, prev: pk.avg_check, hint: 'Выручка ÷ число продаж' }),
    kpi({ label: 'Обращения', value: fmt.num(k.contacts), cur: k.contacts, prev: pk.contacts, spark: days.map((d) => d.contacts), hint: `Клики с сайта: в WhatsApp — ${fmt.num(k.wa_clicks)}, по телефону — ${fmt.num(k.tel_clicks)}` }),
    kpi({ label: 'Конверсия в продажу', value: fmt.pct(k.conversion, 1), cur: k.conversion, prev: pk.conversion, hint: 'Продажи ÷ обращения за период' }),
    kpi({ label: 'Посещения → обращение', value: k.visits ? fmt.pct(k.visit_to_contact, 1) : '—', cur: k.visit_to_contact, prev: pk.visit_to_contact, hint: k.visits ? fmt.num(k.visits) + ' посещений сайта' : 'Аналитика сайта ещё не накопилась' }),
  ));

  // Money in this panel is typed in by people, not measured — say so when it is missing.
  if (!k.sales_ever) root.append(h('div.note', { style: { marginBottom: '14px' } }, icon('spark'),
    h('span', 'Продаж пока нет, поэтому выручка, средний чек и доход пустые. Сайт сам ничего не продаёт и заявок не собирает: клиент пишет вам в WhatsApp, а когда он купил тур — внесите это кнопкой «Продажа». В конце его сообщения есть номер обращения («№ K7M2X») — впишите его, и панель покажет, с какой рекламы пришёл клиент.')));

  const grid = h('div.dash');
  root.append(grid);

  // the funnel of the period
  grid.append(h('section.card.c4', h('div.card__h', h('div', h('h3', 'Воронка'), h('p', 'Посещения → обращения → продажи за период'))),
    funnel([
      { label: 'Посещения', value: k.visits },
      { label: 'Обращения', value: k.contacts, hint: 'Клики в WhatsApp и по телефону' },
      { label: 'Продажи', value: k.sales, hint: 'Внесённые вами, по дате продажи' },
    ]),
    h('p.muted', { style: { margin: '10px 0 0', fontSize: '12.5px' } }, 'Обращение — это нажатие на сайте; продажа могла начаться и со звонка или визита в офис, поэтому её канал виден ниже.')));

  // sales per day
  grid.append(h('section.card.c8', h('div.card__h', h('div', h('h3', 'Выручка и обращения по дням'), h('p', 'Выручка — по дате продажи; обращения — клики в WhatsApp и по телефону'))),
    days.length ? timeChart({ labels: days.map((d) => d.d), fmtTip: (v) => fmt.money(v, cur), series: [{ name: 'Выручка', type: 'bar', color: 'var(--s3)', values: days.map((d) => d.revenue) }] }) : h('div.empty', 'Нет данных'),
    h('div', { style: { marginTop: '14px' } }, h('div.muted', { style: { fontSize: '12.5px', fontWeight: 600, margin: '0 0 4px' } }, 'Обращения'),
      timeChart({ height: 120, labels: days.map((d) => d.d), series: [{ name: 'Обращения', type: 'bar', color: 'var(--s1)', values: days.map((d) => d.contacts) }] }))));

  // channels: the same lead_channel() the marketer's reports use
  grid.append(h('section.card.c6.card--flush', h('div.card__pad', { style: { paddingBottom: 0 } }, h('div.card__h', h('div', h('h3', 'Откуда приходят клиенты'), h('p', 'Обращения с сайта и продажи по каналам. Продажа попадает в канал рекламы по номеру обращения; без номера — в тот источник, который вы выбрали')))),
    table({ rows: s.channels.map((c) => ({ ...c, id: c.channel })), initialSort: ['sales', -1], empty: 'Данных за период нет', columns: [
      { key: 'channel', label: 'Канал', sort: (r) => srcName(r.channel), render: (r) => srcName(r.channel) },
      { key: 'visits', label: 'Посещения', align: 'r', sort: true, render: (r) => fmt.num(r.visits) },
      { key: 'contacts', label: 'Обращения', align: 'r', sort: true, render: (r) => fmt.num(r.contacts) },
      { key: 'sales', label: 'Продажи', align: 'r', sort: true },
      { key: 'revenue', label: 'Выручка', align: 'r', sort: true, render: (r) => (r.revenue ? fmt.money(r.revenue, cur) : '—') },
    ] })));

  // destinations: описание открыли → нажали WhatsApp по туру → купили
  grid.append(h('section.card.c6.card--flush', h('div.card__pad', { style: { paddingBottom: 0 } }, h('div.card__h', h('div', h('h3', 'Интерес к турам'), h('p', 'Открыли описание → написали в WhatsApp про этот тур → купили')))),
    table({ rows: s.tours.map((t) => ({ ...t, id: t.tour })), initialSort: ['opens', -1], empty: 'Туры за период не открывали', columns: [
      { key: 'tour', label: 'Тур', sort: (r) => tourName(ctx, r.tour), render: (r) => tourName(ctx, r.tour) },
      { key: 'opens', label: 'Открыли описание', align: 'r', sort: true, render: (r) => fmt.num(r.opens) },
      { key: 'contacts', label: 'Написали в WhatsApp', align: 'r', sort: true, render: (r) => fmt.num(r.contacts) },
      { key: 'sales', label: 'Продажи', align: 'r', sort: true },
    ] })));

  // when clients write
  const cells = s.contact_heat.map((c) => ({ dow: c.dow, h: c.h, v: c.n }));
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Когда пишут клиенты'), h('p', (heatPeak(cells) || 'Мало данных') + ' — в эти часы стоит быть на связи в WhatsApp'))),
    heatmap(cells, { unit: 'обращений' })));

  // refunds
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Причины возвратов'), h('p', 'Возвраты за период, по дате возврата'))),
    barList(s.refund_reasons.map((r) => ({ label: r.reason || 'Не указана', value: r.n })), { color: 'var(--s2)', empty: 'Возвратов за период нет' })));

  // who typed the sales in — worth showing once there is more than one person
  if (s.managers.length > 1) grid.append(h('section.card.c12.card--flush', h('div.card__pad', { style: { paddingBottom: 0 } }, h('div.card__h', h('div', h('h3', 'Кто продал'), h('p', 'Продажи, выручка и доход — по дате продажи')))),
    table({ rows: s.managers, initialSort: ['revenue', -1], columns: [
      { key: 'name', label: 'Сотрудник', sort: true, render: (r) => r.name || ctx.staffName(r.id) },
      { key: 'sales', label: 'Продажи', align: 'r', sort: true },
      { key: 'refunds', label: 'Возвраты', align: 'r', sort: true },
      { key: 'revenue', label: 'Выручка', align: 'r', sort: true, render: (r) => fmt.money(r.revenue, cur) },
      { key: 'profit', label: 'Доход', align: 'r', sort: true, render: (r) => fmt.money(r.profit, cur) },
    ] })));
}

function greeting() { const hr = new Date().getHours(); return hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер'; }
