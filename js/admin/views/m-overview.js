// Marketing overview: traffic, funnel, channels, engagement, timing.
// Lead numbers come aggregated from stats_traffic — no phone numbers here.
import { h, icon, fmt, table, csv, plural } from '../ui.js';
import { kpi, timeChart, barList, funnel, heatmap, heatPeak, stackBar } from '../charts.js';
import { srcName, SECTION_NAME, CTA_NAME, DEVICE_NAME, LANG_NAME, loadTours, tourName, sum } from './common.js';

export default async function overview(root, ctx) {
  const rg = ctx.range();
  const [s, p, campaigns] = await Promise.all([ctx.api.stats(rg.from, rg.to), ctx.api.stats(rg.prevFrom, rg.prevTo), ctx.api.list('campaigns').catch(() => []), loadTours(ctx)]);
  const f = s.funnel, pf = p.funnel;
  const spend = sum(campaigns.filter((c) => overlaps(c, rg)), (c) => c.spend * share(c, rg));
  const paidLeads = sum(s.campaigns.filter((c) => campaigns.some((k) => k.utm_campaign === c.campaign)), (c) => c.leads);
  const contacts = (s.ctas.wa_click || 0) + (s.ctas.tel_click || 0), pContacts = (p.ctas.wa_click || 0) + (p.ctas.tel_click || 0);

  root.append(h('div.page-head', h('div', h('h2', 'Трафик и конверсии'),
    h('p', 'Собственная аналитика сайта: без cookie и без персональных данных, поэтому видит всех посетителей, а не только тех, кто принял баннер. «Посещение» — одно открытие страницы.')),
    h('div.btns', h('button.btn', { onclick: () => exportDaily(s.daily) }, icon('download'), 'CSV по дням'))));

  root.append(h('div.kpis',
    kpi({ label: 'Посещения', value: fmt.num(f.visits), cur: f.visits, prev: pf.visits, spark: s.daily.map((d) => d.visits) }),
    kpi({ label: 'Вовлечённость', value: fmt.pct(f.visits ? f.engaged / f.visits : null, 0), cur: f.visits ? f.engaged / f.visits : null, prev: pf.visits ? pf.engaged / pf.visits : null, hint: 'Доля посещений, где листали дальше первого экрана' }),
    kpi({ label: 'Клики в WhatsApp и звонки', value: fmt.num(contacts), cur: contacts, prev: pContacts, spark: s.daily.map((d) => d.contacts) }),
    kpi({ label: 'Заявки', value: fmt.num(f.leads), cur: f.leads, prev: pf.leads, spark: s.daily.map((d) => d.leads) }),
    kpi({ label: 'Конверсия сайта', value: fmt.pct(f.visits ? (f.leads) / f.visits : null, 1), cur: f.visits ? f.leads / f.visits : null, prev: pf.visits ? pf.leads / pf.visits : null, hint: 'Заявки ÷ посещения' }),
    kpi({ label: 'Цена заявки с рекламы', value: paidLeads ? fmt.money(spend / paidLeads) : '—', hint: `Расход ${fmt.money(spend)} ÷ ${paidLeads} заявок с кампаний (расход делится пропорционально дням периода)` }),
  ));

  const g = h('div.dash'); root.append(g);
  g.append(h('section.card.c8', h('div.card__h', h('div', h('h3', 'Посещения по дням'), h('p', 'Заявки и контакты — в отдельных графиках ниже: у них другой масштаб'))),
    timeChart({ labels: s.daily.map((d) => d.d), series: [{ name: 'Посещения', type: 'area', color: 'var(--s1)', values: s.daily.map((d) => d.visits) }] }),
    h('div.grid2', { style: { marginTop: '14px' } },
      h('div', h('div.muted', { style: { fontSize: '12.5px', fontWeight: 600, margin: '0 0 4px' } }, 'Контакты (WhatsApp + телефон)'), timeChart({ height: 120, labels: s.daily.map((d) => d.d), series: [{ name: 'Контакты', type: 'bar', color: 'var(--s3)', values: s.daily.map((d) => d.contacts) }] })),
      h('div', h('div.muted', { style: { fontSize: '12.5px', fontWeight: 600, margin: '0 0 4px' } }, 'Заявки'), timeChart({ height: 120, labels: s.daily.map((d) => d.d), series: [{ name: 'Заявки', type: 'bar', color: 'var(--s7)', values: s.daily.map((d) => d.leads) }] })))));

  g.append(h('section.card.c4', h('div.card__h', h('div', h('h3', 'Воронка'), h('p', 'Где отваливаются посетители'))),
    funnel([
      { label: 'Посещения', value: f.visits },
      { label: 'Листали дальше', value: f.engaged, hint: 'Прокрутили за первый экран' },
      { label: 'Проявили интерес', value: f.intent, hint: 'Открыли тур, подбор, чек-лист или начали форму' },
      { label: 'Связались', value: f.contact, hint: 'WhatsApp, звонок, отправка подбора или формы' },
      { label: 'Заявки', value: f.leads },
      { label: 'Продажи', value: f.won },
    ]),
    tip(f)));

  // channels
  const rows = s.sources.map((x) => ({ ...x, id: x.src, cr: x.visits ? x.leads / x.visits : null }));
  g.append(h('section.card.c12.card--flush', h('div.card__pad', { style: { paddingBottom: 0 } }, h('div.card__h', h('div', h('h3', 'Каналы'), h('p', 'Откуда пришли посетители и сколько из них оставили заявку и купили')),
    h('button.btn.btn--sm', { onclick: () => csv('channels.csv', rows, [['Канал', (r) => srcName(r.src)], ['Посещения', (r) => r.visits], ['Заявки', (r) => r.leads], ['Конверсия', (r) => r.cr ? (r.cr * 100).toFixed(2) + '%' : ''], ['Продажи', (r) => r.won], ['Выручка', (r) => r.revenue]]) }, icon('download'), 'CSV'))),
    table({ rows, initialSort: ['visits', -1], columns: [
      { key: 'src', label: 'Канал', sort: (r) => srcName(r.src), render: (r) => h('div.cell-main', h('b', srcName(r.src)), r.src !== srcName(r.src) ? h('small', r.src) : null) },
      { key: 'visits', label: 'Посещения', align: 'r', sort: true, render: (r) => fmt.num(r.visits) },
      { key: 'share', label: 'Доля', align: 'r', sort: (r) => r.visits, render: (r) => fmt.pct(r.visits / (f.visits || 1), 0) },
      { key: 'leads', label: 'Заявки', align: 'r', sort: true },
      { key: 'cr', label: 'Конверсия', align: 'r', sort: (r) => r.cr || 0, render: (r) => crCell(r.cr, f.visits ? f.leads / f.visits : 0) },
      { key: 'won', label: 'Продажи', align: 'r', sort: true },
      { key: 'revenue', label: 'Выручка', align: 'r', sort: true, render: (r) => r.revenue ? fmt.money(r.revenue) : '—' },
    ] })));

  // engagement: sections reach
  const secs = Object.keys(SECTION_NAME).map((k) => ({ label: SECTION_NAME[k], value: s.sections[k] || 0 }));
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'До куда дочитывают'), h('p', 'Доля посещений, в которых блок появился на экране'))),
    barList(secs.map((x) => ({ ...x, note: fmt.pct(x.value / (f.visits || 1), 0) })), { limit: 10 })));

  const ctas = Object.entries(s.ctas).filter(([k]) => !k.startsWith('promo_')).map(([k, v]) => ({ label: CTA_NAME[k] || k, value: v })).sort((a, b) => b.value - a.value);
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Действия на сайте'), h('p', 'Что нажимают посетители'))), barList(ctas, { color: 'var(--s3)', limit: 10 })));

  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Какие туры смотрят'), h('p', 'Открытия карточек и заявки — где интерес не превращается в заявку, стоит поправить описание или цену'))),
    barList(s.tours.map((t) => ({ label: tourName(ctx, t.tour), value: t.opens, value2: t.leads })), { label1: 'Открыли', label2: 'Заявки' })));

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
    ['Связались', f.contact / (f.intent || 1), 'Смотрят, но не пишут — поднимите кнопку WhatsApp и добавьте срочность (даты, «осталось мест»).']];
  const worst = steps.slice().sort((a, b) => a[1] - b[1])[0];
  return h('div.note', { style: { marginTop: '14px' } }, icon('spark'), h('span', h('b', 'Слабое место: ' + worst[0].toLowerCase() + ' (' + fmt.pct(worst[1], 0) + '). '), worst[2]));
}
function exportDaily(daily) { csv('traffic-daily.csv', daily, [['Дата', (d) => d.d], ['Посещения', (d) => d.visits], ['Контакты', (d) => d.contacts], ['Заявки', (d) => d.leads]]); }

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
