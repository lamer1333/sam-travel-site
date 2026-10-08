// Sales — the journal of what was sold (TZ-BACKEND.md §4.11, §0 п.21).
// The site has no request form: clients write on WhatsApp, and a chat gets into the panel
// only when it became a sale — the owner types it in here. One button, «Продажа»; its first
// field is the reference number from the end of the client's message («№ K7M2X»): by it the
// database fills in the tour and the advert the client came from. A refund turns the row
// into «Возврат» and takes it out of the revenue.
// Flight reminders (§4.12): the form also takes the flight and return dates and the client's
// language; from them the database makes the «написать сегодня» list of the dashboard.
// The journal is read from the server page by page — a list asked for in one request would
// silently stop at the first thousand rows.
import { h, add, mount, icon, fmt, toast, modal, drawer, confirmDlg, field, input, textarea, select, toggle, tagsInput, table, csv, copyText, debounce, pageHead, plural, currency } from '../ui.js';
import { STATUS_NAME, SOURCE_NAME } from '../main.js';
import { waLink, fillTemplate, loadTours, tourName, ymd, saleIso, srcName, tripDay, couponWarning, WA_PLACE, LANG_NAME, DEVICE_NAME } from './common.js';
import { addDays } from '../reminders.js';
import { saleCsvColumns, leadChannel, marginOf, refNorm, refOk, isSale, phoneNorm, phoneProblem } from '../metrics.js';

const REFUND_REASONS = ['Возврат', 'Клиент передумал', 'Отказ в визе', 'Отмена рейса или отеля', 'Перенос поездки', 'Другое'];
const SOURCES = [['manual', 'WhatsApp'], ['phone', 'Звонок'], ['walk_in', 'Пришли в офис'], ['instagram', 'Instagram Direct']];
// the language the reminder is written in — one of the three the templates exist in
const CLIENT_LANGS = [['ru', 'Русский'], ['hy', 'Армянский'], ['en', 'Английский']];
const OPT_IN = 'Клиент согласен получать сообщения в WhatsApp';
const OPT_IN_HINT = 'Сейчас ни на что не влияет — понадобится, когда сообщения сможет отправлять система';
const state = { q: '', days: '90', status: '', noProfit: false, depart: '' };
// the «Промокоды» list, to warn about a code that does not exist or no longer works (null — could not be read)
let couponsP = null;
const loadCoupons = (ctx) => couponsP || (couponsP = ctx.api.list('coupons', 'created_at').catch(() => null));
const warnBox = (text) => (text ? h('div.note.note--warn', { style: { marginTop: '8px' } }, icon('alert'), h('span', text)) : null);

export default async function salesView(root, ctx, params) {
  await Promise.all([ctx.settings(), ctx.users().catch(() => []), loadTours(ctx)]);
  const cur = currency();
  const body = h('div'), moreBox = h('div'), headSub = h('span');
  // `gen` numbers the filter the rows belong to: an answer for an older filter is dropped, even
  // when the filter text has come back to the same value (30 → 90 → 30 days). `loading` is the
  // page on its way — whoever needs the rows waits for it instead of asking again.
  let rows = [], total = 0, busy = false, key = '', gen = 0, loading = null;

  root.append(
    pageHead('Продажи', null,
      h('button.btn', { title: 'Все записи под текущий фильтр, а не только показанные на экране', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await pullAll(); exportCsv(ctx, rows); } finally { b.disabled = false; } } }, icon('download'), 'CSV'),
      h('button.btn.btn--primary', { onclick: () => createSale(ctx, reload) }, icon('plus'), 'Продажа')));
  root.querySelector('.page-head > div').appendChild(h('p', headSub));

  const search = input(state.q, { placeholder: 'Имя, телефон, номер обращения…', attrs: { type: 'search', 'aria-label': 'Поиск' } });
  search.addEventListener('input', debounce(() => { state.q = search.value.trim(); reload(); }, 300));
  root.append(h('div.toolbar',
    h('div', { style: { position: 'relative', flex: '1 1 220px', maxWidth: '340px' } }, search),
    select([['30', 'За 30 дней'], ['90', 'За 90 дней'], ['365', 'За год'], ['all', 'За всё время']], state.days, (v) => { state.days = v; reload(); }),
    select([['', 'Продажи и возвраты'], ['won', 'Только продажи'], ['lost', 'Только возвраты']], state.status, (v) => { state.status = v; reload(); }),
    select([['', 'Вылет: любой'], ['7', 'Вылет в ближайшие 7 дней'], ['30', 'Вылет в ближайшие 30 дней'], ['none', 'Без даты вылета']], state.depart, (v) => { state.depart = v; reload(); }),
    h('label.switch', { title: 'Продажи, где не вписана комиссия агентства: отчёты оценивают её по марже' }, h('input', { type: 'checkbox', checked: state.noProfit, onchange: (e) => { state.noProfit = e.target.checked; reload(); } }), h('i'), h('span', 'Без дохода агентства'))),
    body, moreBox);

  // by sale date; a search looks through the whole journal, and so does «вылет в ближайшие дни»:
  // a trip that starts tomorrow may have been sold half a year ago
  const soon = () => +state.depart > 0;
  const filter = () => ({ q: state.q, status: state.noProfit ? 'won' : state.status, noProfit: state.noProfit,
    depart: state.depart === 'none' ? { none: true } : soon() ? { from: ymd(Date.now()), to: addDays(ymd(Date.now()), +state.depart) } : null,
    since: state.q || soon() || state.days === 'all' ? null : new Date(Date.now() - state.days * 86400e3).toISOString() });
  function pull(more) {
    const f = filter(), k = JSON.stringify(f);
    if (k !== key) { key = k; rows = []; total = 0; gen++; }
    else if (loading || !more) return loading || Promise.resolve();
    const my = gen;
    busy = true; paintMore();
    const p = loading = (async () => {
      try {
        const r = await ctx.api.journal({ ...f, offset: rows.length });
        if (my !== gen) return;   // the filter changed while the page was on its way
        rows = rows.concat(r.rows); total = r.rows.length ? r.total : rows.length;
      } catch (e) { if (my === gen) { ctx.err(e); total = rows.length; } }
      finally { if (my === gen) { busy = false; loading = null; paint(); } }
    })();
    return p;
  }
  /** every row under the filter as it is right now — for the CSV */
  async function pullAll() {
    state.q = search.value.trim();   // typed a moment ago, the search has not fired yet
    for (;;) {
      if (JSON.stringify(filter()) !== key) await pull();
      else if (loading) await loading;
      else if (rows.length < total) await pull(true);
      else return;
    }
  }
  function reload() { key = ''; return pull(); }
  function paintMore() {
    const left = total - rows.length;
    mount(moreBox, busy ? h('p.muted', { style: { textAlign: 'center', margin: '14px 0' } }, 'Загружаем…')
      : left > 0 ? h('div', { style: { textAlign: 'center', margin: '14px 0' } }, h('button.btn', { onclick: () => pull(true) }, 'Показать ещё ' + Math.min(left, 500) + ' из ' + left))
      : null);
  }
  function paint() {
    const sales = rows.filter(isSale), refunds = rows.filter((l) => l.status === 'lost'), left = total - rows.length;
    headSub.textContent = `${fmt.num(sales.length)} ${plural(sales.length, 'продажа', 'продажи', 'продаж')} на ${fmt.money(sales.reduce((a, l) => a + (+l.value || 0), 0), cur)}`
      + (refunds.length ? ` · ${refunds.length} ${plural(refunds.length, 'возврат', 'возврата', 'возвратов')}` : '')
      + (left > 0 ? ` · ещё ${fmt.num(left)} ${plural(left, 'запись', 'записи', 'записей')} не загружено` : '')
      + '. Сюда попадает только то, что вы внесли сами: сайт заявок не собирает.';
    mount(body, h('div.card.card--flush', table({
      rows, onRow: (l) => openSale(ctx, l.id, reload), initialSort: soon() ? ['depart_on', 1] : ['closed_at', -1],
      empty: state.q || state.noProfit || state.status || state.depart ? 'Под фильтр ничего не попало' : 'Продаж за это время нет. Клиент купил тур — нажмите «Продажа».',
      columns: [
        { key: 'closed_at', label: 'Дата', sort: true, render: (l) => h('span', { title: fmt.dt(l.closed_at) }, fmt.date(l.closed_at)) },
        { key: 'name', label: 'Клиент', primary: true, sort: true, render: (l) => h('div.cell-main', h('b', l.name), h('small', l.phone)) },
        { key: 'tour', label: 'Направление', sort: (l) => tourName(ctx, l.tour) || '', render: (l) => tourName(ctx, l.tour) || h('span.muted', '—') },
        { key: 'depart_on', label: 'Вылет', sort: (l) => l.depart_on || '9999', render: (l) => (l.depart_on ? h('div.cell-main', h('b', tripDay(l.depart_on)), l.return_on ? h('small', 'обратно ' + tripDay(l.return_on)) : null) : h('span.muted', '—')) },
        { key: 'source', label: 'Откуда', sort: (l) => srcName(leadChannel(l)), render: (l) => h('div.cell-main', h('b', srcName(leadChannel(l))), l.ref ? h('small', '№ ' + l.ref + (l.utm_campaign ? ' · ' + l.utm_campaign : '')) : null) },
        { key: 'value', label: 'Сумма', align: 'r', sort: (l) => +l.value || 0, render: (l) => (l.value ? fmt.money(l.value) : '') },
        { key: 'profit', label: 'Доход агентства', align: 'r', sort: (l) => +l.profit || 0, render: (l) => (l.profit != null ? fmt.money(l.profit) : l.status === 'won' ? h('span.muted', { title: 'Комиссия не вписана — отчёты оценивают её по марже' }, '≈ по марже') : '') },
        { key: 'status', label: 'Запись', sort: true, render: (l) => h('span.badge.badge--' + l.status, STATUS_NAME[l.status] || l.status) },
        { key: 'assigned_to', label: 'Кто внёс', sort: (l) => ctx.staffName(l.assigned_to), render: (l) => (l.assigned_to ? ctx.staffName(l.assigned_to) : h('span.muted', '—')) },
      ],
    })));
    paintMore();
  }

  await pull();
  if (params[0] === 'new' || params[0] === 'sale') createSale(ctx, reload);
  else if (params[0]) openSale(ctx, params[0], reload);
}

// The columns live in metrics.js: «Продажа» and «Дата продажи» follow the same rules as the
// dashboard, so the file adds up to the same totals.
function exportCsv(ctx, rows) {
  csv('sales-' + ymd(Date.now()) + '.csv', rows, saleCsvColumns({
    channelName: srcName, tourName: (t) => tourName(ctx, t), staffName: (id) => ctx.staffName(id), currency: currency(),
  }));
}

// ---------- the money of a sale ----------
// A sale without an amount would silently drop out of revenue, the average check and ROMI,
// so the amount is required. The agency's own income is optional: until it is entered the
// reports estimate it from the margin and say so. The date is the day the client paid —
// a sale is often typed in the next morning.
function saleFields(ctx, l = {}) {
  const cur = currency(), today = ymd(Date.now());
  const marginPct = marginOf(ctx.cache.settings);   // the same margin the reports estimate with
  const v = input(l.value || '', { type: 'number', placeholder: '1500', attrs: { min: 1, step: 10, inputmode: 'decimal' } });
  const p = input(l.profit ?? '', { type: 'number', placeholder: marginPct ? 'по марже ' + marginPct + '%' : '0', attrs: { min: 0, step: 10, inputmode: 'decimal' } });
  const d = input(today, { type: 'date', attrs: { max: today } });
  const est = h('span');
  const hint = () => { est.textContent = p.value !== '' || !marginPct || !(+v.value > 0) ? '' : ' Сейчас в отчётах: ≈ ' + fmt.money(+v.value * marginPct / 100) + '.'; };
  v.addEventListener('input', hint); p.addEventListener('input', hint); hint();
  return {
    el: h('div.stack',
      h('div.grid2', field('Сумма продажи, ' + cur, v, 'Сколько заплатил клиент за тур'),
        field('Доход агентства, ' + cur, p, h('span', 'Ваша комиссия с этой продажи. Можно заполнить позже в карточке.', est))),
      field('Дата продажи', d, 'Вносите задним числом — поставьте день, когда клиент оплатил')),
    read() {
      if (!(+v.value > 0)) { toast('Укажите сумму продажи — без неё продажа не попадёт в выручку', 'bad'); v.focus(); return null; }
      if (p.value !== '' && +p.value < 0) { toast('Доход агентства не может быть отрицательным', 'bad'); p.focus(); return null; }
      if (p.value !== '' && +p.value > +v.value) { toast('Доход агентства не может быть больше суммы продажи', 'bad'); p.focus(); return null; }
      if (!d.value || d.value > today) { toast('Дата продажи не может быть в будущем', 'bad'); d.focus(); return null; }
      return { value: Number(v.value), profit: p.value === '' ? null : Number(p.value), closed_at: saleIso(d.value) };
    },
  };
}
function ask(title, sub, label, ctrl) {
  return new Promise((res) => {
    let done = false;
    modal({ title, sub, body: field(label, ctrl), onClose: () => { if (!done) res(null); },
      actions: [{ label: 'Отмена', onClick: () => { done = true; res(null); } }, { label: 'Сохранить', kind: 'primary', onClick: () => { done = true; res(ctrl.value); } }] });
  });
}

// ---------- what the site knows about a reference number ----------
/** a line for people: when, from which advert, about which tour */
function refSummary(ctx, e) {
  const ad = e.utm_campaign ? srcName(e.channel) + ' · кампания ' + e.utm_campaign : srcName(e.channel);
  return [fmt.dt(e.ts), ad, e.tour ? 'тур «' + tourName(ctx, e.tour) + '»' : (WA_PLACE[e.label] || null),
    [LANG_NAME[e.lang], DEVICE_NAME[e.device]].filter(Boolean).join(', ').toLowerCase() || null,
    e.coupon_code ? 'промокод ' + e.coupon_code : null].filter(Boolean).join(' · ');
}

// ---------- «Продажа»: the one way a chat gets into the panel ----------
export function createSale(ctx, after) {
  const d = { ref: '', name: '', phone: '', message: '', source: 'manual', tour: '', coupon_code: '', assigned_to: ctx.me.id, lang: 'ru', wa_opt_in: false };
  const tours = (ctx.cache.tours || []).map((t) => [t.slug, tourName(ctx, t.slug)]);
  const team = ctx.team();
  const sf = saleFields(ctx);
  let found = null, checked = '', touched = { tour: false, coupon: false };
  // what the last reference number put into the form: taken back when the number changes
  const auto = { tour: '', coupon: '' };
  let coupons = null;
  const refNote = h('div'), couponNote = h('div'), phoneNote = h('div');
  const paintCoupon = () => mount(couponNote, warnBox(couponWarning(coupons, d.coupon_code)));
  loadCoupons(ctx).then((c) => { coupons = c; paintCoupon(); });
  const refIn = input('', { placeholder: 'K7M2X', attrs: { autofocus: true, autocomplete: 'off', autocapitalize: 'characters', maxlength: 12, style: 'text-transform:uppercase;letter-spacing:.08em;max-width:180px' } });
  const srcSel = select(SOURCES, d.source, (v) => { d.source = v; });
  const tourSel = select([['', '—'], ...tours], '', (v) => { d.tour = v; touched.tour = true; });
  const couponIn = input('', { placeholder: 'AUTUMN7', oninput: (v) => { d.coupon_code = v.trim().toUpperCase(); touched.coupon = true; paintCoupon(); }, attrs: { autocapitalize: 'characters' } });
  const phoneIn = input('', { type: 'tel', placeholder: '+374 …', oninput: (v) => { d.phone = v; const pr = v.trim() ? phoneProblem(v) : null; mount(phoneNote, pr && !pr.block ? warnBox(pr.text) : null); } });
  phoneIn.addEventListener('change', () => { phoneIn.value = d.phone = phoneNorm(phoneIn.value.trim()); });   // «091 22 33 44» → «+374 91 223344»
  // the trip: from these dates the database makes the reminders «хорошего полёта» and «с возвращением»
  const depIn = input('', { type: 'date' }), retIn = input('', { type: 'date' });
  depIn.addEventListener('change', () => { retIn.min = depIn.value; });
  const langSel = select(CLIENT_LANGS, d.lang, (v) => { d.lang = v; });
  const LANG_HINT = 'На этом языке будет текст напоминания', langHint = h('span', LANG_HINT);
  const note = (kind, text) => mount(refNote, text ? h('div.note' + (kind ? '.note--' + kind : ''), { style: { marginTop: '8px' } }, icon(kind === 'warn' ? 'alert' : 'check'), h('span', text)) : null);
  const check = debounce(async () => {
    const ref = refNorm(refIn.value) || '';
    d.ref = ref; found = null; srcSel.disabled = false; langSel.disabled = false; langHint.textContent = LANG_HINT;
    // the tour and the promo code of the previous number go away with it — unless the person has changed them since
    if (auto.tour && !touched.tour && d.tour === auto.tour) { d.tour = ''; tourSel.value = ''; }
    if (auto.coupon && !touched.coupon && d.coupon_code === auto.coupon) { d.coupon_code = ''; couponIn.value = ''; }
    auto.tour = auto.coupon = ''; paintCoupon();
    if (!ref) { checked = ''; note(); return; }
    if (!refOk(ref)) { checked = ''; note('warn', 'Номер — пять знаков после «№» в конце сообщения клиента, например K7M2X. Букв O, I, L и цифр 0, 1 в нём не бывает.'); return; }
    try {
      const e = await ctx.api.waRef(ref);
      if (refNorm(refIn.value) !== ref) return;   // the number was typed further
      checked = ref; found = e;
      if (!e) { note('warn', 'Обращения с таким номером за последние 90 дней нет. Проверьте номер — или сотрите его и выберите, откуда клиент.'); return; }
      note('', 'Клиент писал с сайта: ' + refSummary(ctx, e) + '. Источник и рекламная метка подставятся сами.');
      d.source = 'manual'; srcSel.value = 'manual'; srcSel.disabled = true;
      // the database takes the language of the visit, exactly as it takes the advert tags
      if (CLIENT_LANGS.some((x) => x[0] === e.lang)) { d.lang = e.lang; langSel.value = e.lang; langSel.disabled = true; langHint.textContent = 'По номеру обращения: на этом языке клиент смотрел сайт. Изменить можно в карточке продажи'; }
      if (e.tour && !touched.tour && tours.some((t) => t[0] === e.tour)) { d.tour = auto.tour = e.tour; tourSel.value = e.tour; }
      if (e.coupon_code && !touched.coupon) { d.coupon_code = auto.coupon = e.coupon_code; couponIn.value = e.coupon_code; paintCoupon(); }
    } catch (x) { ctx.err(x); }
  }, 300);
  refIn.addEventListener('input', check);

  modal({
    title: 'Новая продажа',
    sub: 'Клиент оплатил тур — продажа сразу попадёт в выручку и отчёты. Сайт сам ничего не продаёт и заявок не собирает: в панели есть только то, что внесено здесь.',
    body: h('div.stack',
      h('div.field', h('span', 'Номер обращения (если клиент писал с сайта)'), refIn,
        h('small', 'Пять знаков после «№» в конце первого сообщения клиента в WhatsApp. По нему подставятся тур и реклама, с которой он пришёл.'), refNote),
      h('div.grid2', field('Имя', input('', { oninput: (v) => (d.name = v), attrs: { maxlength: 120 } })), h('div', field('Телефон', phoneIn, 'С кодом страны — по нему открывается чат в WhatsApp'), phoneNote)),
      h('div.grid2', field('Откуда клиент', srcSel, 'Если номера обращения нет'), field('Направление', tourSel)),
      field('Что купили', textarea('', { oninput: (v) => (d.message = v), placeholder: 'Отель, даты, сколько человек…' })),
      sf.el,
      h('div.grid2', field('Дата вылета', depIn, 'Накануне панель напомнит пожелать хорошего полёта'), field('Дата возвращения', retIn, 'На следующий день — написать «с возвращением»')),
      h('div.grid2', field('Язык клиента', langSel, langHint), h('div.field', h('span', 'Согласие'), toggle(false, OPT_IN, (v) => { d.wa_opt_in = v; }), h('small', OPT_IN_HINT))),
      h('div.grid2', h('div', field('Промокод', couponIn, 'Если клиент назвал код'), couponNote),
        team.length > 1 ? field('Кто внёс', select(team.map((u) => [u.id, u.full_name || u.email]), d.assigned_to, (v) => (d.assigned_to = v))) : null)),
    actions: [{ label: 'Отмена' }, { label: 'Записать продажу', kind: 'primary', onClick: async () => {
      if (!d.name.trim()) { toast('Нужно имя клиента', 'bad'); return false; }
      const pr = phoneProblem(d.phone);
      if (pr && pr.block) { toast(pr.text, 'bad'); phoneIn.focus(); return false; }
      const ref = refNorm(refIn.value);
      if (ref && !refOk(ref)) { toast('Номер обращения — пять знаков. Исправьте или сотрите его', 'bad'); refIn.focus(); return false; }
      if (ref && checked === ref && !found) { toast('Обращения с таким номером нет. Исправьте номер или сотрите его', 'bad'); refIn.focus(); return false; }
      const s = sf.read(); if (!s) return false;
      if (depIn.value && retIn.value && retIn.value < depIn.value) { toast('Дата возвращения не может быть раньше даты вылета', 'bad'); retIn.focus(); return false; }
      const row = { name: d.name.trim(), phone: phoneNorm(d.phone.trim()), message: d.message.trim() || null, source: d.source, tour: d.tour || null,
        coupon_code: d.coupon_code || null, assigned_to: d.assigned_to, ref: ref || null, lang: d.lang, status: 'won', ...s,
        depart_on: depIn.value || null, return_on: retIn.value || null, wa_opt_in: d.wa_opt_in };
      try {
        const l = await ctx.api.createSale(row);
        ctx.reminders(true).catch(() => {});
        toast('Продажа записана: ' + fmt.money(l.value), '', { icon: 'check' });
        if (after) await after();
        openSale(ctx, l.id, after);
      } catch (e) { ctx.err(e); return false; }
    } }],
  });
}

// ---------- the card of a sale ----------
const ACT_ICON = { note: 'edit', status: 'refresh', assign: 'users', call: 'phone', whatsapp: 'wa', email: 'mail', system: 'zap', money: 'tag' };
export async function openSale(ctx, id, after) {
  const l = await ctx.api.sale(id).catch(() => null);
  if (!l) { toast('Запись не найдена', 'bad'); return; }
  if (location.hash !== '#/sales/' + id) history.replaceState(null, '', '#/sales/' + id);
  const cur = currency(), today = ymd(Date.now());
  const tl = h('div.tl'), headRow = h('div.row', { style: { marginTop: '10px' } }), work = h('div'), origin = h('div'), foot = h('div.btns');
  const contact = h('div.btns', { style: { marginBottom: '18px' } });
  let templates = [], changed = false, coupons = null;
  loadCoupons(ctx).then((c) => { coupons = c; paintWork(); });
  const paintContact = () => mount(contact,
    h('button.btn.btn--wa', { onclick: () => pickTemplate() }, icon('wa'), 'Написать в WhatsApp'),
    h('a.btn', { href: 'tel:' + String(l.phone || '').replace(/[^\d+]/g, ''), onclick: () => log('call', 'Звонок клиенту') }, icon('phone'), 'Позвонить'),
    h('button.btn', { onclick: () => copyText(l.phone, 'Телефон скопирован') }, icon('copy'), l.phone));
  ctx.api.list('wa_templates').then((t) => { templates = t; }).catch(() => {});
  const paintHead = () => mount(headRow, h('span.badge.badge--' + l.status, STATUS_NAME[l.status] || l.status),
    l.ref ? h('span.badge.badge--plain', { title: 'Номер обращения: клиент писал с сайта' }, '№ ' + l.ref) : null,
    l.value ? h('b', fmt.money(l.value)) : null);

  const dr = drawer({
    title: l.name,
    sub: (l.status === 'lost' ? 'Возврат от ' : 'Продажа от ') + fmt.date(l.closed_at),
    head: headRow,
    onClose: () => { if (location.hash.startsWith('#/sales/')) history.replaceState(null, '', '#/sales'); if (changed && after) after(); },
    body: () => {
      const b = h('div');
      paintContact(); add(b, contact);
      paintWork(); paintOrigin();
      const note = textarea('', { rows: 2, placeholder: 'Заметка: что отправили, о чём договорились…' });
      add(b, work, origin, h('div.section-t', 'История'),
        h('div.row', { style: { alignItems: 'flex-start', flexWrap: 'nowrap', marginBottom: '16px' } }, note,
          h('button.btn', { onclick: async () => { if (!note.value.trim()) return; await log('note', note.value.trim()); note.value = ''; } }, 'Добавить')),
        tl);
      return b;
    },
    footer: (api) => { paintFoot(api); return h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } }, foot, h('button.btn.btn--primary', { onclick: () => api.close() }, 'Готово')); },
  });

  function paintFoot(api) {
    mount(foot,
      l.status === 'won' ? h('button.btn.btn--ghost', { title: 'Клиент отказался после оплаты: продажа уйдёт из выручки, промокод освободится', onclick: refund }, 'Оформить возврат')
        : h('button.btn.btn--ghost', { title: 'Клиент всё-таки едет: вернуть запись в продажи', onclick: unrefund }, 'Отменить возврат'),
      ctx.can('owner') ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => {
        if (!(await confirmDlg('Удалить запись «' + l.name + '»?', { sub: 'Вместе с историей. Останется строка в журнале изменений. Для возврата денег клиенту есть «Оформить возврат».' }))) return;
        try { await ctx.api.deleteSale(l.id); changed = true; ctx.reminders(true).catch(() => {}); toast('Удалено'); (api || dr).close(); } catch (e) { ctx.err(e); }
      } }, icon('trash'), 'Удалить') : null);
  }
  async function refund() {
    const r = await ask('Возврат', 'Продажа уйдёт из выручки того дня, которым была записана; сумма останется в карточке для справки.', 'Причина возврата', select(REFUND_REASONS, REFUND_REASONS[0]));
    if (r === null) return;
    if (await save({ status: 'lost', lost_reason: r }, 'Возврат оформлен')) repaint();
  }
  async function unrefund() {
    const f = saleFields(ctx, l);
    const r = await new Promise((res) => {
      let done = false;
      modal({ title: 'Вернуть в продажи', sub: 'Запись снова попадёт в выручку — той датой, которую вы укажете.', body: f.el, onClose: () => { if (!done) res(null); },
        actions: [{ label: 'Отмена', onClick: () => { done = true; res(null); } }, { label: 'Сохранить', kind: 'primary', onClick: () => { const x = f.read(); if (!x) return false; done = true; res(x); } }] });
    });
    if (r === null) return;
    if (await save({ status: 'won', lost_reason: null, ...r }, 'Запись снова в продажах')) repaint();
  }
  function repaint() { paintHead(); paintWork(); paintOrigin(); paintFoot(); refreshTl(); }

  function paintWork() {
    const won = l.status === 'won';
    const num = (el) => (el.value === '' ? null : Number(el.value));
    const valueIn = input(l.value ?? '', { type: 'number', placeholder: '0', attrs: { min: 0, step: 10, inputmode: 'decimal' } });
    valueIn.addEventListener('change', async () => {
      const v = num(valueIn);
      const why = won && !(v > 0) ? 'У продажи должна быть сумма — без неё она выпадет из выручки'
        : v != null && v < 0 ? 'Сумма не может быть отрицательной'
        : v != null && l.profit != null && +l.profit > v ? 'Сумма меньше дохода агентства — сначала поправьте доход' : '';
      if (why) { toast(why, 'bad'); valueIn.value = l.value ?? ''; return; }
      if (await save({ value: v })) { paintHead(); refreshTl(); }
    });
    const profitIn = input(l.profit ?? '', { type: 'number', placeholder: 'по марже ' + marginOf(ctx.cache.settings) + '%', attrs: { min: 0, step: 10, inputmode: 'decimal' } });
    profitIn.addEventListener('change', async () => {
      const p = num(profitIn);
      const why = p != null && p < 0 ? 'Доход агентства не может быть отрицательным'
        : p != null && !(+l.value > 0) ? 'Сначала укажите сумму'
        : p != null && p > +l.value ? 'Доход агентства не может быть больше суммы' : '';
      if (why) { toast(why, 'bad'); profitIn.value = l.profit ?? ''; return; }
      if (await save({ profit: p })) refreshTl();
    });
    const soldIn = input(ymd(l.closed_at || Date.now()), { type: 'date', attrs: { max: today } });
    soldIn.addEventListener('change', async () => {
      if (!soldIn.value || soldIn.value > today) { toast('Дата не может быть в будущем', 'bad'); soldIn.value = ymd(l.closed_at || Date.now()); return; }
      if (await save({ closed_at: saleIso(soldIn.value) })) refreshTl();
    });
    const what = textarea(l.message || '', { rows: 2, placeholder: 'Отель, даты, сколько человек…' });
    what.addEventListener('change', () => save({ message: what.value.trim() || null }));
    const tours = (ctx.cache.tours || []).map((t) => [t.slug, tourName(ctx, t.slug)]);
    if (l.tour && !tours.some((t) => t[0] === l.tour)) tours.push([l.tour, l.tour]);
    const couponIn = input(l.coupon_code || '', { placeholder: '—', attrs: { autocapitalize: 'characters' } });
    const couponNote = h('div', warnBox(couponWarning(coupons, l.coupon_code)));
    couponIn.addEventListener('change', async () => { await save({ coupon_code: couponIn.value.trim().toUpperCase() || null }); mount(couponNote, warnBox(couponWarning(coupons, l.coupon_code))); });
    // the client: a name typed with a mistake or a phone with a wrong digit is corrected here
    const nameIn = input(l.name || '', { attrs: { maxlength: 120, autocomplete: 'off' } });
    nameIn.addEventListener('change', async () => {
      const v = nameIn.value.trim();
      if (!v) { toast('У продажи должно быть имя клиента', 'bad'); nameIn.value = l.name || ''; return; }
      if (v !== l.name && await save({ name: v })) { const t = dr && dr.el.querySelector('.drawer__h h3'); if (t) t.textContent = l.name; }
      nameIn.value = l.name || '';
    });
    const phoneIn = input(l.phone || '', { type: 'tel', attrs: { autocomplete: 'off' } });
    const phoneNote = h('div');
    const phoneWarn = () => { const pr = phoneProblem(l.phone); mount(phoneNote, pr ? warnBox(pr.text) : null); };
    phoneIn.addEventListener('change', async () => {
      const v = phoneNorm(phoneIn.value.trim()), pr = phoneProblem(v);
      if (pr && pr.block) { toast(pr.text, 'bad'); phoneIn.value = l.phone || ''; return; }
      if (v !== l.phone && await save({ phone: v })) paintContact();
      phoneIn.value = l.phone || ''; phoneWarn();
    });
    phoneWarn();
    // the trip: a changed date moves the reminder, a refund takes it off — the database does both
    const depIn = input(l.depart_on || '', { type: 'date' }), retIn = input(l.return_on || '', { type: 'date' });
    depIn.addEventListener('change', async () => { if (!(await save({ depart_on: depIn.value || null }))) depIn.value = l.depart_on || ''; });
    retIn.addEventListener('change', async () => { if (!(await save({ return_on: retIn.value || null }))) retIn.value = l.return_on || ''; });
    const langs = CLIENT_LANGS.some((x) => x[0] === l.lang) ? CLIENT_LANGS : [[l.lang || '', l.lang || '—'], ...CLIENT_LANGS];
    const trip = h('div', { style: { marginTop: '12px' } }, h('div.section-t', 'Поездка'),
      h('div.grid2',
        field('Дата вылета', depIn, won ? 'Накануне панель напомнит написать клиенту' : 'После возврата напоминаний нет'),
        field('Дата возвращения', retIn),
        field('Язык клиента', select(langs, l.lang || '', (v) => save({ lang: v })), 'На нём будет текст напоминания'),
        h('div.field', h('span', 'Согласие'), toggle(l.wa_opt_in, OPT_IN, (v) => save({ wa_opt_in: v })), h('small', OPT_IN_HINT))));
    mount(work, h('div.section-t', 'Клиент'),
      h('div.grid2', field('Имя', nameIn), h('div', field('Телефон', phoneIn, 'С кодом страны — по нему открывается чат в WhatsApp'), phoneNote)),
      h('div.section-t', won ? 'Продажа' : 'Возврат'),
      h('div.grid2',
        field((won ? 'Сумма продажи, ' : 'Сумма, ') + cur, valueIn, won ? 'Сколько заплатил клиент' : 'Для справки: в выручку не входит'),
        field('Доход агентства, ' + cur, profitIn, 'Комиссия с продажи. Пусто — отчёты считают по марже'),
        field(won ? 'Дата продажи' : 'Дата возврата', soldIn, won ? 'По ней продажа попадает в выручку периода' : null),
        field('Направление', select([['', '—'], ...tours], l.tour || '', (v) => save({ tour: v || null }))),
        won ? null : field('Причина возврата', select(REFUND_REASONS.includes(l.lost_reason) ? REFUND_REASONS : [l.lost_reason, ...REFUND_REASONS].filter(Boolean), l.lost_reason || '', (v) => save({ lost_reason: v }))),
        h('div', field('Промокод', couponIn), couponNote),
        ctx.team().length > 1 ? field('Кто внёс', select([['', '—'], ...ctx.team().map((u) => [u.id, u.full_name || u.email])], l.assigned_to || '', (v) => save({ assigned_to: v || null }).then(refreshTl))) : null),
      trip,
      h('div', { style: { marginTop: '12px' } }, field('Что купили', what)),
      h('div', { style: { marginTop: '12px' } }, field('Теги', tagsInput(l.tags, (t) => save({ tags: t })))));
  }

  // where the client came from: by the reference number — the visit; without it — what the owner picked
  function paintOrigin() {
    const det = l.details || {};
    const refIn = input(l.ref || '', { placeholder: 'K7M2X', attrs: { autocomplete: 'off', autocapitalize: 'characters', maxlength: 12, style: 'text-transform:uppercase;letter-spacing:.08em' } });
    refIn.addEventListener('change', async () => {
      const ref = refNorm(refIn.value);
      if (ref && !refOk(ref)) { toast('Номер обращения — пять знаков, например K7M2X', 'bad'); refIn.value = l.ref || ''; return; }
      if (await save({ ref: ref || null })) { paintHead(); paintWork(); paintOrigin(); } else refIn.value = l.ref || '';
    });
    const srcSel = select(SOURCES, SOURCES.some((x) => x[0] === l.source) ? l.source : 'manual', (v) => save({ source: v }).then(paintOrigin));
    srcSel.disabled = !!l.ref;
    mount(origin, h('div.section-t', 'Откуда клиент'),
      h('div.grid2',
        field('Номер обращения', refIn, l.ref ? 'Клиент писал с сайта. Сотрите номер, чтобы выбрать источник вручную' : 'Пять знаков после «№» в сообщении клиента — подставит рекламу и тур'),
        field('Источник', srcSel, l.ref ? 'С номером обращения — всегда WhatsApp' : null)),
      h('dl.kv', { style: { marginTop: '12px' } },
        [h('dt', 'Канал в отчётах'), h('dd', srcName(leadChannel(l)))],
        l.ref ? [h('dt', 'Реклама'), h('dd', l.utm_source ? [l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content].filter(Boolean).join(' / ') : (l.referrer ? 'Переход с ' + l.referrer : 'Прямой заход'))] : null,
        det.ref_at ? [h('dt', 'Написал(а) с сайта'), h('dd', fmt.dt(det.ref_at) + (WA_PLACE[det.ref_label] ? ' · ' + WA_PLACE[det.ref_label] : ''))] : null,
        l.ref ? [h('dt', 'Язык сайта'), h('dd', (LANG_NAME[l.lang] || l.lang || '—') + (l.device ? ' · ' + (DEVICE_NAME[l.device] || l.device).toLowerCase() : ''))] : null));
  }

  /** true when the database took the change */
  async function save(patch, okText) {
    try {
      const u = await ctx.api.updateSale(l.id, patch); Object.assign(l, u || patch); changed = true;
      if (['depart_on', 'return_on', 'status', 'phone', 'lang', 'tour'].some((k) => k in patch)) ctx.reminders(true).catch(() => {});
      toast(okText || 'Сохранено', '', { icon: 'check', ms: 1400 });
      return true;
    } catch (e) { ctx.err(e); return false; }
  }
  async function log(kind, body, meta) {
    try { await ctx.api.addActivity(l.id, kind, body, meta); refreshTl(); } catch (e) { ctx.err(e); }
  }
  async function refreshTl() {
    try {
      const acts = await ctx.api.saleActivity(l.id);
      mount(tl, acts.length ? acts.slice().reverse().map((a) => h('div.tl__i', h('span.tl__dot', icon(ACT_ICON[a.kind] || 'spark')),
        h('div.tl__b', actText(ctx, a), h('small', fmt.dt(a.created_at) + (a.actor ? ' · ' + ctx.staffName(a.actor) : '')),
          a.kind === 'note' ? h('p', a.body) : null))) : h('div.muted', 'Пока пусто'));
    } catch (e) { mount(tl, h('div.muted', 'История недоступна')); }
  }
  function pickTemplate() {
    const lang = l.lang || 'ru';
    // the texts of the flight reminders (kind) are filled in by the database, not picked here
    const list = templates.filter((t) => !t.kind).sort((a, b) => (a.lang === lang ? -1 : 0) - (b.lang === lang ? -1 : 0));
    const vars = { name: l.name, tour: tourName(ctx, l.tour), manager: ctx.me.full_name };
    const ta = textarea(list[0] ? fillTemplate(list[0].body, vars) : '', { rows: 5 });
    modal({
      title: 'Сообщение в WhatsApp', sub: 'Шаблон подставит имя, направление и ваше имя — поправьте и отправьте.',
      body: h('div.stack',
        list.length ? h('div.chips', list.map((t) => h('button.chip', { type: 'button', onclick: () => { ta.value = fillTemplate(t.body, vars); } }, t.title + ' · ' + t.lang.toUpperCase()))) : h('div.muted', 'Шаблонов пока нет — владелец добавляет их в «Шаблоны ответов».'),
        ta),
      actions: [{ label: 'Отмена' }, { label: 'Открыть WhatsApp', kind: 'primary', onClick: () => {
        window.open(waLink(l.phone, ta.value), '_blank', 'noopener');
        log('whatsapp', ta.value ? 'Сообщение: ' + ta.value.slice(0, 140) : 'Открыт чат WhatsApp');
      } }],
    });
  }
  paintHead();
  refreshTl();
}
function actText(ctx, a) {
  if (a.kind === 'status') return h('span', a.meta && a.meta.from ? h('span.muted', (STATUS_NAME[a.meta.from] || a.meta.from) + ' → ') : null, h('b', STATUS_NAME[a.body] || a.body));
  if (a.kind === 'assign') return h('span', 'Кто внёс: ', h('b', a.meta && a.meta.to ? ctx.staffName(a.meta.to) : 'не указан'));
  if (a.kind === 'note') return h('span', 'Заметка');
  if (a.kind === 'money') {   // written by the database when the money of a row is edited
    const m = a.meta || {}, was = (x, f) => f(x.from) + ' → ' + f(x.to);
    return h('span', [m.value && 'Сумма: ' + was(m.value, (v) => fmt.money(v)), m.profit && 'Доход агентства: ' + was(m.profit, (v) => fmt.money(v)),
      m.closed_at && 'Дата: ' + was(m.closed_at, (v) => fmt.date(v))].filter(Boolean).join(' · ') || 'Правка суммы');
  }
  return h('span', a.body || a.kind);
}
