// Owner dashboard: money, speed of answer, pipeline, who sells, where from.
import { h, icon, fmt, table, card, right, plural } from '../ui.js';
import { kpi, timeChart, barList, heatmap, heatPeak, stackBar } from '../charts.js';
import { STATUS_NAME, SOURCE_NAME } from '../main.js';
import { inRange, median, sum, minutesBetween, ymd, slaBadge, loadTours, tourName, srcName } from './common.js';

export default async function dashboard(root, ctx) {
  const rg = ctx.range();
  const [leads, settings, stats, prevStats] = await Promise.all([
    ctx.leads(), ctx.settings(), ctx.api.stats(rg.from, rg.to).catch(() => null), ctx.api.stats(rg.prevFrom, rg.prevTo).catch(() => null), ctx.users().catch(() => []), loadTours(ctx),
  ]);
  const sla = (settings.hours && settings.hours.sla_min) || 60;
  const real = leads.filter((l) => l.status !== 'spam');
  const inCur = real.filter((l) => inRange(l.created_at, rg.from, rg.to));
  const inPrev = real.filter((l) => inRange(l.created_at, rg.prevFrom, rg.prevTo));
  const closedIn = (from, to) => real.filter((l) => l.closed_at && ['won', 'lost'].includes(l.status) && inRange(l.closed_at, from, to));
  const cClosed = closedIn(rg.from, rg.to), pClosed = closedIn(rg.prevFrom, rg.prevTo);
  const won = (xs) => xs.filter((l) => l.status === 'won');
  const rev = (xs) => sum(won(xs), (l) => l.value);
  // Agency income: what managers entered on the sale; where they have not, value × margin.
  const marginPct = Number((settings.company || {}).margin_pct) || null;
  const hasProfit = (l) => l.profit != null && l.profit !== '';
  const profitOf = (l) => hasProfit(l) ? +l.profit : marginPct ? (+l.value || 0) * marginPct / 100 : 0;
  const profit = (xs) => sum(won(xs), profitOf);
  const estimated = (xs) => won(xs).filter((l) => !hasProfit(l) && +l.value > 0).length;
  const noAmount = (xs) => won(xs).filter((l) => !(+l.value > 0));
  const conv = (xs) => xs.length ? won(xs).length / xs.length : null;
  const avg = (xs) => won(xs).length ? rev(xs) / won(xs).length : null;
  const resp = (xs) => median(xs.filter((l) => l.first_response_at).map((l) => minutesBetween(l.created_at, l.first_response_at)));
  const within = (xs) => { const r = xs.filter((l) => l.first_response_at); return r.length ? r.filter((l) => minutesBetween(l.created_at, l.first_response_at) <= sla).length / r.length : null; };
  const days = (stats && stats.daily) || [];
  const perDay = (xs, key = 'created_at', f = () => 1) => { const m = {}; xs.forEach((l) => { const d = ymd(l[key]); m[d] = (m[d] || 0) + f(l); }); return days.map((d) => m[d.d] || 0); };
  const visits = stats ? stats.funnel.visits : null, pVisits = prevStats ? prevStats.funnel.visits : null;
  const cur = (ctx.cache.settings.company && ctx.cache.settings.company.currency) || 'USD';

  const nNew = real.filter((l) => l.status === 'new').length;
  root.append(h('div.page-head', h('div',
    h('h2', greeting() + ', ' + (ctx.me.full_name || '').split(' ')[0] + '!'),
    h('p', `За ${ctx.period.days} ${plural(ctx.period.days, 'день', 'дня', 'дней')}: ${fmt.num(inCur.length)} ${plural(inCur.length, 'заявка', 'заявки', 'заявок')}, ${fmt.num(won(cClosed).length)} ${plural(won(cClosed).length, 'продажа', 'продажи', 'продаж')} на ${fmt.money(rev(cClosed), cur)}.` + (nNew ? ` Сейчас ${nNew} ${plural(nNew, 'новая заявка ждёт', 'новые заявки ждут', 'новых заявок ждут')} ответа.` : ' Все новые заявки разобраны.'))),
    h('div.btns', h('button.btn', { onclick: () => ctx.go('leads') }, icon('inbox'), 'К заявкам'), h('button.btn.btn--primary', { onclick: () => ctx.go('leads/new') }, icon('plus'), 'Заявка'))));

  root.append(h('div.kpis',
    kpi({ label: 'Выручка', value: fmt.money(rev(cClosed), cur), cur: rev(cClosed), prev: rev(pClosed), spark: perDay(won(cClosed), 'closed_at', (l) => +l.value || 0), hint: 'Сумма закрытых продаж за период' }),
    kpi({ label: estimated(cClosed) ? 'Доход агентства ≈' : 'Доход агентства', value: won(cClosed).length ? fmt.money(profit(cClosed), cur) : '—', cur: profit(cClosed), prev: profit(pClosed), spark: perDay(won(cClosed), 'closed_at', profitOf),
      hint: !won(cClosed).length ? 'Появится после первой продажи: менеджер указывает комиссию при закрытии заявки'
        : estimated(cClosed) ? `Комиссия указана в ${won(cClosed).length - estimated(cClosed)} из ${won(cClosed).length} продаж; остальные оценены по марже ${marginPct || '—'}%`
        : 'Сумма комиссий, которые менеджеры указали в продажах' }),
    kpi({ label: 'Заявки', value: fmt.num(inCur.length), cur: inCur.length, prev: inPrev.length, spark: perDay(inCur), hint: 'Все обращения, кроме спама' }),
    kpi({ label: 'Конверсия в продажу', value: fmt.pct(conv(cClosed), 0), cur: conv(cClosed), prev: conv(pClosed), hint: 'Продажи ÷ закрытые заявки (продажа + отказ)' }),
    kpi({ label: 'Средний чек', value: fmt.money(avg(cClosed), cur), cur: avg(cClosed), prev: avg(pClosed) }),
    kpi({ label: 'Первый ответ (медиана)', value: fmt.dur(resp(inCur)), cur: resp(inCur), prev: resp(inPrev), goodUp: false, hint: `В пределах ${sla} мин: ${fmt.pct(within(inCur), 0)} заявок` }),
    kpi({ label: 'Посещения → заявка', value: visits ? fmt.pct(inCur.length / visits, 1) : '—', cur: visits ? inCur.length / visits : null, prev: pVisits ? inPrev.length / pVisits : null, hint: visits ? fmt.num(visits) + ' посещений сайта' : 'Аналитика сайта ещё не накопилась' }),
  ));

  // Money in this panel is typed in by people, not measured — say so when it is missing.
  const blank = noAmount(cClosed);
  if (blank.length) root.append(h('div.note.note--warn', { style: { marginBottom: '14px', cursor: 'pointer' }, onclick: () => ctx.go('leads/' + blank[0].id) }, icon('alert'),
    h('span', `${blank.length} ${plural(blank.length, 'продажа', 'продажи', 'продаж')} за период без суммы — в выручку и средний чек ${plural(blank.length, 'она не попала', 'они не попали', 'они не попали')}. Откройте заявку и впишите сумму.`)));
  else if (!real.some((l) => l.status === 'won')) root.append(h('div.note', { style: { marginBottom: '14px' } }, icon('spark'),
    h('span', 'Продаж пока нет, поэтому выручка, средний чек и доход пустые. Сайт сам ничего не продаёт: эти цифры появятся, когда менеджер переведёт заявку в «Продажа» и укажет сумму. Звонки и визиты в офис добавляются кнопкой «Заявка».')));

  const grid = h('div.dash');
  root.append(grid);

  // leads per day by outcome
  const outcome = (st) => st === 'won' ? 'won' : st === 'lost' ? 'lost' : 'open';
  grid.append(h('section.card.c8', h('div.card__h', h('div', h('h3', 'Заявки по дням'), h('p', 'По дате обращения; цвет — чем закончилось'))),
    days.length ? timeChart({ labels: days.map((d) => d.d), series: [
      { name: 'Продажа', type: 'bar', color: 'var(--s3)', values: perDay(inCur.filter((l) => outcome(l.status) === 'won')) },
      { name: 'В работе', type: 'bar', color: 'var(--s1)', values: perDay(inCur.filter((l) => outcome(l.status) === 'open')) },
      { name: 'Отказ', type: 'bar', color: 'var(--s2)', values: perDay(inCur.filter((l) => outcome(l.status) === 'lost')) },
    ] }) : h('div.empty', 'Нет данных')));

  // needs attention
  const late = real.filter((l) => l.status === 'new').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const today = ymd(Date.now());
  const fu = real.filter((l) => l.follow_up_at && ymd(l.follow_up_at) <= today && !['won', 'lost'].includes(l.status)).sort((a, b) => a.follow_up_at.localeCompare(b.follow_up_at));
  const att = [...late.map((l) => ({ l, why: slaBadge(l, sla) })), ...fu.map((l) => ({ l, why: h('span.sla.sla--' + (ymd(l.follow_up_at) < today ? 'bad' : 'warn'), (ymd(l.follow_up_at) < today ? 'просрочен звонок ' : 'перезвонить ') + fmt.dt(l.follow_up_at)) }))];
  grid.append(h('section.card.c4', h('div.card__h', h('div', h('h3', 'Требуют внимания'), h('p', 'Новые без ответа и звонки на сегодня')), h('span.badge' + (att.length ? '.badge--bad' : '.badge--ok'), String(att.length))),
    att.length ? h('div.list', att.slice(0, 7).map(({ l, why }) => h('div.item', { style: { cursor: 'pointer', padding: '8px 10px' }, onclick: () => ctx.go('leads/' + l.id) },
      h('div.item__main', h('b', l.name), h('small', (tourName(ctx, l.tour) || SOURCE_NAME[l.source] || '') + ' · ' + fmt.ago(l.created_at))), why)))
      : h('div.empty', h('b', 'Всё под контролем'), 'Никто не ждёт ответа'),
    att.length > 7 ? h('button.btn.btn--ghost.btn--sm', { style: { marginTop: '8px' }, onclick: () => ctx.go('leads') }, 'Ещё ' + (att.length - 7) + ' →') : null));

  // pipeline
  const open = real.filter((l) => ['new', 'contacted', 'quoted'].includes(l.status));
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Воронка продаж сейчас'), h('p', 'Открытые заявки по этапам и сумма в предложениях'))),
    stackBar([
      { label: STATUS_NAME.new, value: open.filter((l) => l.status === 'new').length, color: 'var(--s1)' },
      { label: STATUS_NAME.contacted, value: open.filter((l) => l.status === 'contacted').length, color: 'var(--s7)' },
      { label: STATUS_NAME.quoted, value: open.filter((l) => l.status === 'quoted').length, color: 'var(--s4)' },
    ]),
    h('div.kpis', { style: { marginTop: '16px', marginBottom: 0, gridTemplateColumns: 'repeat(3, 1fr)' } },
      miniStat('В работе', fmt.num(open.length)),
      miniStat('В предложениях', fmt.money(sum(open.filter((l) => l.status === 'quoted'), (l) => l.value), cur)),
      miniStat('Прогноз', conv(cClosed) ? fmt.money(sum(open.filter((l) => l.status === 'quoted'), (l) => l.value) * conv(cClosed), cur) : '—', conv(cClosed) ? 'Сумма предложений × конверсия за период' : 'Нужна хотя бы одна продажа за период, чтобы посчитать конверсию'))));

  // lost reasons
  const reasons = {};
  cClosed.filter((l) => l.status === 'lost').forEach((l) => { const r = l.lost_reason || 'Не указана'; reasons[r] = (reasons[r] || 0) + 1; });
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Почему отказываются'), h('p', 'Отказы за период по причинам'))),
    barList(Object.entries(reasons).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), { color: 'var(--s2)', empty: 'Отказов за период нет' })));

  // sources
  const bySrc = {};
  inCur.forEach((l) => {
    const k = l.utm_source ? srcName(l.utm_source) : (SOURCE_NAME[l.source] && !['form', 'plan', 'tour'].includes(l.source)) ? SOURCE_NAME[l.source] : l.referrer ? srcName(l.referrer.replace(/^https?:\/\/(www\.)?([^/]+).*$/, '$2')) : 'Прямые заходы';
    const x = bySrc[k] || (bySrc[k] = { label: k, value: 0, value2: 0 }); x.value++; if (l.status === 'won') x.value2++;
  });
  grid.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Откуда приходят клиенты'), h('p', 'Заявки за период и сколько из них купили'))),
    barList(Object.values(bySrc).sort((a, b) => b.value - a.value), { label1: 'Заявки', label2: 'Продажи' })));

  // managers leaderboard
  const team = ctx.team();
  const rows = team.map((u) => {
    const mine = inCur.filter((l) => l.assigned_to === u.id), mc = cClosed.filter((l) => l.assigned_to === u.id);
    return { id: u.id, name: u.full_name || u.email, leads: mine.length, won: won(mc).length, revenue: rev(mc), profit: profit(mc), conv: conv(mc), resp: resp(mine) };
  }).filter((r) => r.leads || r.won);
  grid.append(h('section.card.c6.card--flush', h('div.card__pad', { style: { paddingBottom: 0 } }, h('div.card__h', h('div', h('h3', 'Менеджеры'), h('p', 'Кто сколько взял, продал и как быстро отвечает')))),
    table({ rows, initialSort: ['revenue', -1], empty: 'Заявки ещё не распределены', columns: [
      { key: 'name', label: 'Менеджер', sort: true },
      { key: 'leads', label: 'Заявки', align: 'r', sort: true },
      { key: 'won', label: 'Продажи', align: 'r', sort: true },
      { key: 'conv', label: 'Конв.', align: 'r', sort: (r) => r.conv || 0, render: (r) => fmt.pct(r.conv, 0) },
      { key: 'revenue', label: 'Выручка', align: 'r', sort: true, render: (r) => fmt.money(r.revenue, cur) },
      { key: 'profit', label: 'Доход', align: 'r', sort: true, render: (r) => fmt.money(r.profit, cur) },
      { key: 'resp', label: 'Ответ', align: 'r', sort: (r) => r.resp || 1e9, render: (r) => h('span', { style: { color: r.resp > sla ? 'var(--bad)' : '' } }, fmt.dur(r.resp)) },
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
