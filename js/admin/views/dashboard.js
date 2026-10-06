// Owner dashboard: money, speed of answer, pipeline, who sells, where from.
// Every number comes ready from the database — stats_sales(), 030_stats.sql (ТЗ §5).
// The panel does not recount anything: it would lose leads past the first thousand rows.
// Money here is «по дате продажи»: what was sold in the period, whenever the lead came.
import { h, icon, fmt, table, plural, currency } from '../ui.js';
import { kpi, timeChart, barList, heatmap, heatPeak, stackBar } from '../charts.js';
import { STATUS_NAME, SOURCE_NAME } from '../main.js';
import { ymd, slaBadge, loadTours, tourName, srcName } from './common.js';

export default async function dashboard(root, ctx) {
  const rg = ctx.range();
  const [s, p, leads, settings, stats] = await Promise.all([
    ctx.api.sales(rg.from, rg.to), ctx.api.sales(rg.prevFrom, rg.prevTo).catch(() => null),
    ctx.leads(), ctx.settings(), ctx.api.stats(rg.from, rg.to).catch(() => null), ctx.users().catch(() => []), loadTours(ctx),
  ]);
  const k = s.kpi, pk = p ? p.kpi : {}, sla = s.sla_min, days = s.daily, cur = currency();
  const real = leads.filter((l) => l.status !== 'spam');   // open leads are all in memory: the lists below need names

  root.append(h('div.page-head', h('div',
    h('h2', greeting() + ((ctx.me.full_name || '').trim() ? ', ' + ctx.me.full_name.trim().split(' ')[0] : '') + '!'),
    h('p', `За ${ctx.period.days} ${plural(ctx.period.days, 'день', 'дня', 'дней')}: ${fmt.num(k.leads)} ${plural(k.leads, 'заявка', 'заявки', 'заявок')}, ${fmt.num(k.sales)} ${plural(k.sales, 'продажа', 'продажи', 'продаж')} на ${fmt.money(k.revenue, cur)} (по дате продажи).` + (k.open.new ? ` Сейчас ${k.open.new} ${plural(k.open.new, 'новая заявка ждёт', 'новые заявки ждут', 'новых заявок ждут')} ответа.` : ' Все новые заявки разобраны.'))),
    h('div.btns', h('button.btn', { onclick: () => ctx.go('leads') }, icon('inbox'), 'К заявкам'), h('button.btn.btn--primary', { onclick: () => ctx.go('leads/new') }, icon('plus'), 'Заявка'))));

  const BY_SALE = 'По дате продажи: продажи, записанные в этом периоде, когда бы ни пришла заявка';
  root.append(h('div.kpis',
    kpi({ label: 'Выручка · по дате продажи', value: fmt.money(k.revenue, cur), cur: k.revenue, prev: pk.revenue, spark: days.map((d) => d.revenue), hint: 'Сумма продаж. ' + BY_SALE }),
    kpi({ label: (k.estimated ? 'Доход агентства ≈' : 'Доход агентства') + ' · по дате продажи', value: k.sales ? fmt.money(k.profit, cur) : '—', cur: k.profit, prev: pk.profit, spark: days.map((d) => d.profit),
      hint: !k.sales ? 'Появится после первой продажи: менеджер указывает комиссию при закрытии заявки'
        : k.estimated ? `Комиссия указана в ${k.sales - k.sales_estimated} из ${k.sales} продаж; ` + `остальные оценены по марже ${s.margin_pct}%`
        : 'Сумма комиссий, которые менеджеры указали в продажах' }),
    kpi({ label: 'Заявки', value: fmt.num(k.leads), cur: k.leads, prev: pk.leads, spark: days.map((d) => d.leads), hint: 'Все обращения, кроме спама, по дате обращения' }),
    kpi({ label: 'Конверсия в продажу', value: fmt.pct(k.conversion, 0), cur: k.conversion, prev: pk.conversion, hint: 'Продажи ÷ (продажи + отказы), закрытые в периоде' }),
    kpi({ label: 'Средний чек', value: fmt.money(k.avg_check, cur), cur: k.avg_check, prev: pk.avg_check, hint: 'Выручка ÷ число продаж. ' + BY_SALE }),
    kpi({ label: 'Первый ответ (медиана)', value: fmt.dur(k.resp_median_min), cur: k.resp_median_min, prev: pk.resp_median_min, goodUp: false, hint: `Заявки с сайта, считается только рабочее время. В пределах ${sla} мин: ${fmt.pct(k.within_sla, 0)}` }),
    kpi({ label: 'Посещения → заявка', value: k.visits ? fmt.pct(k.visit_to_lead, 1) : '—', cur: k.visit_to_lead, prev: pk.visit_to_lead, hint: k.visits ? fmt.num(k.visits) + ' посещений сайта' : 'Аналитика сайта ещё не накопилась' }),
  ));

  // Money in this panel is typed in by people, not measured — say so when it is missing.
  if (k.sales_no_amount) root.append(h('div.note.note--warn', { style: { marginBottom: '14px', cursor: 'pointer' }, onclick: () => ctx.go('leads/' + k.no_amount_lead) }, icon('alert'),
    h('span', `${k.sales_no_amount} ${plural(k.sales_no_amount, 'продажа', 'продажи', 'продаж')} за период без суммы — в продажи, выручку и средний чек ${plural(k.sales_no_amount, 'она не попала', 'они не попали', 'они не попали')}. Откройте заявку и впишите сумму.`)));
  else if (!k.sales_ever) root.append(h('div.note', { style: { marginBottom: '14px' } }, icon('spark'),
    h('span', 'Продаж пока нет, поэтому выручка, средний чек и доход пустые. Сайт сам ничего не продаёт: эти цифры появятся, когда менеджер переведёт заявку в «Продажа» и укажет сумму. Звонки и визиты в офис добавляются кнопкой «Заявка».')));

  const grid = h('div.dash');
  root.append(grid);

  // leads per day by outcome
  grid.append(h('section.card.c8', h('div.card__h', h('div', h('h3', 'Заявки по дням'), h('p', 'По дате обращения; цвет — чем закончилось'))),
    days.length ? timeChart({ labels: days.map((d) => d.d), series: [
      { name: 'Продажа', type: 'bar', color: 'var(--s3)', values: days.map((d) => d.won) },
      { name: 'В работе', type: 'bar', color: 'var(--s1)', values: days.map((d) => d.in_work) },
      { name: 'Отказ', type: 'bar', color: 'var(--s2)', values: days.map((d) => d.lost) },
    ] }) : h('div.empty', 'Нет данных')));

  // needs attention
  const late = real.filter((l) => l.status === 'new').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const today = ymd(Date.now());
  const fu = real.filter((l) => l.follow_up_at && ymd(l.follow_up_at) <= today && !['won', 'lost'].includes(l.status)).sort((a, b) => a.follow_up_at.localeCompare(b.follow_up_at));
  const att = [...late.map((l) => ({ l, why: slaBadge(l, settings.hours) })), ...fu.map((l) => ({ l, why: h('span.sla.sla--' + (ymd(l.follow_up_at) < today ? 'bad' : 'warn'), (ymd(l.follow_up_at) < today ? 'просрочен звонок ' : 'перезвонить ') + fmt.dt(l.follow_up_at)) }))];
  grid.append(h('section.card.c4', h('div.card__h', h('div', h('h3', 'Требуют внимания'), h('p', 'Новые без ответа и звонки на сегодня')), h('span.badge' + (att.length ? '.badge--bad' : '.badge--ok'), String(att.length))),
    att.length ? h('div.list', att.slice(0, 7).map(({ l, why }) => h('div.item', { style: { cursor: 'pointer', padding: '8px 10px' }, onclick: () => ctx.go('leads/' + l.id) },
      h('div.item__main', h('b', l.name), h('small', (tourName(ctx, l.tour) || SOURCE_NAME[l.source] || '') + ' · ' + fmt.ago(l.created_at))), why)))
      : h('div.empty', h('b', 'Всё под контролем'), 'Никто не ждёт ответа'),
    att.length > 7 ? h('button.btn.btn--ghost.btn--sm', { style: { marginTop: '8px' }, onclick: () => ctx.go('leads') }, 'Ещё ' + (att.length - 7) + ' →') : null));

  // pipeline
  const nOpen = k.open.new + k.open.contacted + k.open.quoted;
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Воронка продаж сейчас'), h('p', 'Открытые заявки по этапам и сумма в предложениях'))),
    stackBar([
      { label: STATUS_NAME.new, value: k.open.new, color: 'var(--s1)' },
      { label: STATUS_NAME.contacted, value: k.open.contacted, color: 'var(--s7)' },
      { label: STATUS_NAME.quoted, value: k.open.quoted, color: 'var(--s4)' },
    ]),
    h('div.kpis', { style: { marginTop: '16px', marginBottom: 0, gridTemplateColumns: 'repeat(3, 1fr)' } },
      miniStat('В работе', fmt.num(nOpen)),
      miniStat('В предложениях', fmt.money(k.quoted_value, cur)),
      miniStat('Прогноз', k.forecast != null ? fmt.money(k.forecast, cur) : '—', k.forecast != null ? 'Сумма предложений × конверсия за период' : 'Нужна хотя бы одна закрытая заявка за период, чтобы посчитать конверсию'))));

  // lost reasons
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Почему отказываются'), h('p', 'Отказы за период по причинам, по дате отказа'))),
    barList(s.lost_reasons.map((r) => ({ label: r.reason || 'Не указана', value: r.n })), { color: 'var(--s2)', empty: 'Отказов за период нет' })));

  // channels: the same lead_channel() the marketer's reports use
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Откуда приходят клиенты'), h('p', 'Заявки за период и сколько из них купили (по заявкам периода)'))),
    barList(s.channels.map((c) => ({ label: srcName(c.channel), value: c.leads, value2: c.won })), { label1: 'Заявки', label2: 'Продажи' })));

  // managers leaderboard
  grid.append(h('section.card.c6.card--flush', h('div.card__pad', { style: { paddingBottom: 0 } }, h('div.card__h', h('div', h('h3', 'Менеджеры'), h('p', 'Заявки — взятые за период; продажи, выручка и доход — по дате продажи')))),
    table({ rows: s.managers, initialSort: ['revenue', -1], empty: 'Заявки ещё не распределены', columns: [
      { key: 'name', label: 'Менеджер', sort: true, render: (r) => r.name || ctx.staffName(r.id) },
      { key: 'leads', label: 'Заявки', align: 'r', sort: true },
      { key: 'sales', label: 'Продажи', align: 'r', sort: true },
      { key: 'conversion', label: 'Конв.', align: 'r', sort: (r) => r.conversion || 0, render: (r) => fmt.pct(r.conversion, 0) },
      { key: 'revenue', label: 'Выручка', align: 'r', sort: true, render: (r) => fmt.money(r.revenue, cur) },
      { key: 'profit', label: 'Доход', align: 'r', sort: true, render: (r) => fmt.money(r.profit, cur) },
      { key: 'resp', label: 'Ответ', align: 'r', sort: (r) => r.resp_median_min ?? 1e9, render: (r) => h('span', { style: { color: r.resp_median_min > sla ? 'var(--bad)' : '' } }, fmt.dur(r.resp_median_min)) },
    ] })));

  // destinations: interest vs requests
  if (stats) {
    const tours = stats.tours.map((t) => ({ label: tourName(ctx, t.tour), value: t.opens, value2: t.leads }));
    grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Интерес к направлениям'), h('p', 'Открытия карточки тура на сайте и заявки по нему'))),
      barList(tours, { label1: 'Открыли карточку', label2: 'Заявки' })));
    const cells = stats.lead_heat.map((c) => ({ dow: c.dow, h: c.h, v: c.leads }));
    grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Когда пишут клиенты'), h('p', (heatPeak(cells) || 'Мало данных') + ' — держите менеджера на связи'))),
      heatmap(cells, { unit: 'заявок' })));
  }
}

function miniStat(label, value, hint) {
  return h('div', { title: hint || '', style: { background: 'var(--surface-2)', borderRadius: '11px', padding: '10px 12px' } }, h('div.muted', { style: { fontSize: '12px' } }, label), h('div', { style: { fontSize: '18px', fontWeight: 700 } }, value));
}
function greeting() { const hr = new Date().getHours(); return hr < 5 ? 'Доброй ночи' : hr < 12 ? 'Доброе утро' : hr < 18 ? 'Добрый день' : 'Добрый вечер'; }
