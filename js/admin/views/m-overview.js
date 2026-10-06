// Marketing overview: traffic, funnel, channels, engagement, timing.
// Everything comes aggregated from stats_traffic() — no phone numbers here. The site has no
// request form: an «обращение» is a click on a WhatsApp or phone link, and a sale belongs to
// a channel or a campaign by the reference number the owner typed in with it (§4.11).
import { h, icon, fmt, table, csv, plural } from '../ui.js';
import { kpi, timeChart, barList, funnel, heatmap, heatPeak, stackBar } from '../charts.js';
import { srcName, SECTION_NAME, CTA_NAME, DEVICE_NAME, LANG_NAME, loadTours, tourName, sum } from './common.js';

export default async function overview(root, ctx) {
  const rg = ctx.range();
  const [s, p, campaigns] = await Promise.all([ctx.api.stats(rg.from, rg.to), ctx.api.stats(rg.prevFrom, rg.prevTo), ctx.api.list('campaigns').catch(() => []), loadTours(ctx)]);
  const f = s.funnel, pf = p.funnel;
  // days older than 13 months keep only daily totals: the steps that need single visits
  // (engagement, sections, hours) are counted over the days that still have them
  const fv = s.raw_from ? f.visits_detailed : f.visits, pfv = p.raw_from ? pf.visits_detailed : pf.visits;
  const spend = sum(campaigns.filter((c) => overlaps(c, rg)), (c) => c.spend * share(c, rg));
  const paidContacts = sum(s.campaigns.filter((c) => campaigns.some((k) => k.utm_campaign === c.campaign)), (c) => c.contacts);
  const contacts = (s.ctas.wa_click || 0) + (s.ctas.tel_click || 0), pContacts = (p.ctas.wa_click || 0) + (p.ctas.tel_click || 0);
  const cr = f.visits ? contacts / f.visits : null, pcr = pf.visits ? pContacts / pf.visits : null;

  root.append(h('div.page-head', h('div', h('h2', 'Трафик и конверсии'),
    h('p', 'Собственная аналитика сайта: без cookie и без персональных данных, поэтому видит всех посетителей, а не только тех, кто принял баннер. «Посещение» — одно открытие страницы.')),
    h('div.btns', h('button.btn', { onclick: () => exportDaily(s.daily) }, icon('download'), 'CSV по дням'))));

  root.append(h('div.kpis',
    kpi({ label: 'Посещения', value: fmt.num(f.visits), cur: f.visits, prev: pf.visits, spark: s.daily.map((d) => d.visits) }),
    kpi({ label: 'Вовлечённость', value: fmt.pct(fv ? f.engaged / fv : null, 0), cur: fv ? f.engaged / fv : null, prev: pfv ? pf.engaged / pfv : null, hint: 'Доля посещений, где листали дальше первого экрана' }),
    kpi({ label: 'Обращения', value: fmt.num(contacts), cur: contacts, prev: pContacts, spark: s.daily.map((d) => d.contacts), hint: `Клики в WhatsApp — ${fmt.num(s.ctas.wa_click || 0)}, по телефону — ${fmt.num(s.ctas.tel_click || 0)}` }),
    kpi({ label: 'Конверсия сайта', value: fmt.pct(cr, 1), cur: cr, prev: pcr, hint: 'Обращения ÷ посещения' }),
    kpi({ label: 'Продажи с сайта', value: fmt.num(f.won_ref), cur: f.won_ref, prev: pf.won_ref, hint: `Продажи с номером обращения, по дате продажи. Всего продаж за период: ${f.won}` }),
    kpi({ label: 'Цена обращения с рекламы', value: paidContacts ? fmt.money(spend / paidContacts) : '—', hint: `Расход ${fmt.money(spend)} ÷ ${paidContacts} обращений с кампаний (расход делится пропорционально дням периода)` }),
  ));

  if (s.raw_from) root.append(h('div.note', { style: { marginBottom: '14px' } }, icon('spark'),
    h('span', 'Период захватывает дни старше 13 месяцев: по ним хранятся только итоги по дням. Посещения, контакты, каналы и кампании посчитаны за весь период; воронка, блоки страницы, часы и баннеры — с ' + fmt.date(s.raw_from) + '.')));

  const g = h('div.dash'); root.append(g);
  g.append(h('section.card.c8', h('div.card__h', h('div', h('h3', 'Посещения по дням'), h('p', 'Обращения — в отдельном графике ниже: у них другой масштаб'))),
    timeChart({ labels: s.daily.map((d) => d.d), series: [{ name: 'Посещения', type: 'area', color: 'var(--s1)', values: s.daily.map((d) => d.visits) }] }),
    h('div', { style: { marginTop: '14px' } }, h('div.muted', { style: { fontSize: '12.5px', fontWeight: 600, margin: '0 0 4px' } }, 'Обращения (WhatsApp + телефон)'),
      timeChart({ height: 120, labels: s.daily.map((d) => d.d), series: [{ name: 'Обращения', type: 'bar', color: 'var(--s3)', values: s.daily.map((d) => d.contacts) }] }))));

  g.append(h('section.card.c4', h('div.card__h', h('div', h('h3', 'Воронка'), h('p', 'Где отваливаются посетители'))),
    funnel([
      { label: 'Посещения', value: fv },
      { label: 'Листали дальше', value: f.engaged, hint: 'Прокрутили за первый экран' },
      { label: 'Проявили интерес', value: f.intent, hint: 'Открыли тур, подбор или чек-лист, нажали WhatsApp или телефон' },
      { label: 'Обратились', value: f.contact, hint: 'Посещения, в которых нажали WhatsApp или телефон' },
      { label: 'Продажи с сайта', value: f.won_ref, hint: 'Продажи с номером обращения' },
    ]),
    h('p.muted', { style: { margin: '10px 0 0', fontSize: '12.5px' } }, 'Продажи — по дате продажи; к сайту относятся те, что внесены с номером обращения.'),
    tip({ ...f, visits: fv })));

  // channels
  const rows = s.sources.map((x) => ({ ...x, id: x.src, cr: x.visits ? x.contacts / x.visits : null }));
  g.append(h('section.card.c12.card--flush', h('div.card__pad', { style: { paddingBottom: 0 } }, h('div.card__h', h('div', h('h3', 'Каналы'), h('p', 'Откуда пришли посетители, сколько из них написали или позвонили и сколько купили. Продажа относится к каналу по номеру обращения; продажи без номера (звонок, визит, Instagram, WhatsApp) — отдельные каналы без посещений. Продажи, выручка и доход — по дате продажи')),
    h('button.btn.btn--sm', { onclick: () => csv('channels.csv', rows, [['Канал', (r) => srcName(r.src)], ['Посещения', (r) => r.visits], ['Обращения', (r) => r.contacts], ['Конверсия в обращение', (r) => r.cr ? (r.cr * 100).toFixed(2) + '%' : ''], ['Продажи', (r) => r.won], ['Выручка', (r) => r.revenue], ['Доход агентства', (r) => r.profit_total], ['Доход — оценка по марже', (r) => (r.estimated ? 'да' : '')]]) }, icon('download'), 'CSV'))),
    table({ rows, initialSort: ['visits', -1], columns: [
      { key: 'src', label: 'Канал', sort: (r) => srcName(r.src), render: (r) => h('div.cell-main', h('b', srcName(r.src)), r.src !== srcName(r.src) ? h('small', r.src) : null) },
      { key: 'visits', label: 'Посещения', align: 'r', sort: true, render: (r) => fmt.num(r.visits) },
      { key: 'share', label: 'Доля', align: 'r', sort: (r) => r.visits, render: (r) => fmt.pct(r.visits / (f.visits || 1), 0) },
      { key: 'contacts', label: 'Обращения', align: 'r', sort: true, render: (r) => fmt.num(r.contacts) },
      { key: 'cr', label: 'Конверсия', align: 'r', sort: (r) => r.cr || 0, render: (r) => crCell(r.cr, cr || 0) },
      { key: 'won', label: 'Продажи', align: 'r', sort: true },
      { key: 'revenue', label: 'Выручка', align: 'r', sort: true, render: (r) => r.revenue ? fmt.money(r.revenue) : '—' },
      { key: 'profit_total', label: 'Доход', align: 'r', sort: true, render: (r) => r.won ? h('span', { title: r.estimated ? 'Часть дохода оценена по марже ' + s.margin_pct + '%' : 'Комиссии, указанные в продажах' }, (r.estimated ? '≈ ' : '') + fmt.money(r.profit_total)) : '—' },
    ] })));

  // engagement: sections reach
  const secs = Object.keys(SECTION_NAME).map((k) => ({ label: SECTION_NAME[k], value: s.sections[k] || 0 }));
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'До куда дочитывают'), h('p', 'Доля посещений, в которых блок появился на экране'))),
    barList(secs.map((x) => ({ ...x, note: fmt.pct(x.value / (fv || 1), 0) })), { limit: 10 })));

  const ctas = Object.entries(s.ctas).filter(([k]) => !k.startsWith('promo_')).map(([k, v]) => ({ label: CTA_NAME[k] || k, value: v })).sort((a, b) => b.value - a.value);
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Действия на сайте'), h('p', 'Что нажимают посетители'))), barList(ctas, { color: 'var(--s3)', limit: 10 })));

  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Какие туры смотрят'), h('p', 'Открыли описание и написали в WhatsApp про этот тур — где интерес не превращается в сообщение, стоит поправить описание или цену'))),
    barList(s.tours.map((t) => ({ label: tourName(ctx, t.tour), value: t.opens, value2: t.contacts, note: fmt.num(t.opens) + ' / ' + fmt.num(t.contacts) + (t.sales ? ' · продаж ' + t.sales : '') })), { label1: 'Открыли описание', label2: 'Написали в WhatsApp' })));

  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Устройства и языки'))),
    h('div.stack',
      stackBar(Object.entries(s.devices).map(([k, v], i) => ({ label: DEVICE_NAME[k] || k, value: v, color: ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'][i % 4] }))),
      stackBar(Object.entries(s.langs).map(([k, v], i) => ({ label: LANG_NAME[k] || k, value: v, color: ['var(--s7)', 'var(--s5)', 'var(--s6)', 'var(--s4)'][i % 4] }))),
      h('p.muted', { style: { margin: 0, fontSize: '12.5px' } }, (s.devices.mobile || 0) / (f.visits || 1) > 0.6 ? 'Больше половины заходят с телефона — проверяйте баннеры и рекламу сначала на мобильном.' : ''))));

  const cells = s.heat.map((c) => ({ dow: c.dow, h: c.h, v: c.visits }));
  g.append(h('section.card.c12', h('div.card__h', h('div', h('h3', 'Когда люди на сайте'), h('p', (heatPeak(cells) || '') + '. Запускайте рекламу и посты за час до пика.'))), heatmap(cells, { unit: 'посещений' })));
}

function crCell(cr, avg) {
  if (cr == null) return '—';
  const good = cr > avg * 1.2, bad = cr < avg * 0.6;
  return h('span', { style: { color: good ? 'var(--ok)' : bad ? 'var(--bad)' : '', fontWeight: good || bad ? 700 : 400 }, title: 'В среднем по сайту: ' + fmt.pct(avg, 1) }, fmt.pct(cr, 1));
}
function tip(f) {
  const steps = [['Листали дальше', f.engaged / (f.visits || 1), 'Первый экран не цепляет — проверьте заголовок и скорость загрузки на телефоне.'],
    ['Проявили интерес', f.intent / (f.engaged || 1), 'Листают, но не открывают туры — добавьте цены «от» и фото в карточки.'],
    ['Обратились', f.contact / (f.intent || 1), 'Смотрят, но не пишут — поднимите кнопку WhatsApp и добавьте срочность (даты, «осталось мест»).']];
  const worst = steps.slice().sort((a, b) => a[1] - b[1])[0];
  return h('div.note', { style: { marginTop: '14px' } }, icon('spark'), h('span', h('b', 'Слабое место: ' + worst[0].toLowerCase() + ' (' + fmt.pct(worst[1], 0) + '). '), worst[2]));
}
function exportDaily(daily) { csv('traffic-daily.csv', daily, [['Дата', (d) => d.d], ['Посещения', (d) => d.visits], ['Обращения', (d) => d.contacts]]); }

// campaign spend attributed to the period by overlapping days
export function overlaps(c, rg) {
  const s = c.starts_on ? new Date(c.starts_on) : new Date(c.created_at), e = c.ends_on ? new Date(c.ends_on + 'T23:59:59') : new Date();
  return s < rg.to && e > rg.from;
}
export function share(c, rg) {
  const s = c.starts_on ? new Date(c.starts_on) : new Date(c.created_at), e = c.ends_on ? new Date(c.ends_on + 'T23:59:59') : new Date();
  const total = Math.max(1, (Math.min(e, new Date()) - s) / 86400e3);
  const inter = Math.max(0, (Math.min(e, rg.to, new Date()) - Math.max(s, rg.from)) / 86400e3);
  return Math.min(1, inter / total);
}
