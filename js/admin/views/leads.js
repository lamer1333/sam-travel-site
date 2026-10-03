// Leads — mini-CRM: kanban with drag & drop, table with bulk actions,
// a lead card with WhatsApp templates, timeline, SLA, duplicates.
import { h, $, $$, add, mount, clear, icon, fmt, toast, modal, drawer, confirmDlg, field, input, textarea, select, tagsInput, table, csv, copyText, debounce, pageHead, plural } from '../ui.js';
import { STATUS, STATUS_NAME, SOURCE_NAME } from '../main.js';
import { slaBadge, waLink, fillTemplate, loadTours, tourName, minutesBetween, inWorkingHours, ymd } from './common.js';

const COLS = ['new', 'contacted', 'quoted', 'won', 'lost'];
const state = { view: localStorage.getItem('sam-leads-view') || 'kanban', q: '', quick: 'all', source: '', manager: '', tour: '', days: '', spam: false };

export default async function leadsView(root, ctx, params) {
  const [leads, settings] = await Promise.all([ctx.leads(), ctx.settings(), ctx.users().catch(() => []), loadTours(ctx)]);
  const sla = (settings.hours && settings.hours.sla_min) || 60;
  const body = h('div');
  const headSub = h('span');
  root.append(
    pageHead('Заявки', null,
      h('div.seg', { role: 'group', 'aria-label': 'Вид' },
        [['kanban', 'Канбан', 'kanban'], ['table', 'Таблица', 'list']].map(([v, l, ic]) => h('button', { type: 'button', 'aria-pressed': String(state.view === v), onclick: (e) => {
          state.view = v; localStorage.setItem('sam-leads-view', v); $$('button', e.currentTarget.parentNode).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paint();
        } }, icon(ic), ' ', l))),
      h('button.btn', { onclick: () => exportCsv(filtered()) }, icon('download'), 'CSV'),
      h('button.btn.btn--primary', { onclick: () => createLead(ctx, paint) }, icon('plus'), 'Заявка')),
  );
  $('.page-head p', root) || $('.page-head > div', root).appendChild(h('p', headSub));

  // quick filters + toolbar
  const me = ctx.me.id;
  const QUICK = [
    ['all', 'Все', () => true],
    ['mine', 'Мои', (l) => l.assigned_to === me],
    ['unassigned', 'Без ответственного', (l) => !l.assigned_to && !['won', 'lost', 'spam'].includes(l.status)],
    ['overdue', 'Ждут дольше ' + sla + ' мин', (l) => l.status === 'new' && minutesBetween(l.created_at, Date.now()) > sla],
    ['followup', 'Перезвонить сегодня', (l) => l.follow_up_at && ymd(l.follow_up_at) <= ymd(Date.now()) && !['won', 'lost', 'spam'].includes(l.status)],
  ];
  const quickRow = h('div.chips', { style: { marginBottom: '12px' } });
  function paintQuick() {
    clear(quickRow);
    QUICK.forEach(([k, label, fn]) => {
      const n = k === 'all' ? null : leads.filter(fn).length;
      quickRow.appendChild(h('button.chip', { type: 'button', 'aria-pressed': String(state.quick === k), onclick: () => { state.quick = k; paintQuick(); paint(); } }, label, n != null ? h('b', { style: { marginLeft: '4px', color: k === 'overdue' && n ? 'var(--bad)' : '' } }, String(n)) : null));
    });
  }
  const sources = Array.from(new Set(leads.map((l) => l.source))).map((s) => [s, SOURCE_NAME[s] || s]);
  const tours = Array.from(new Set(leads.map((l) => l.tour).filter(Boolean))).map((t) => [t, tourName(ctx, t)]);
  const search = input(state.q, { placeholder: 'Имя, телефон, текст…', attrs: { type: 'search', 'aria-label': 'Поиск' } });
  search.addEventListener('input', debounce(() => { state.q = search.value.trim().toLowerCase(); paint(); }, 150));
  const toolbar = h('div.toolbar',
    h('div', { style: { position: 'relative', flex: '1 1 220px', maxWidth: '340px' } }, search),
    select([['', 'Все источники'], ...sources], state.source, (v) => { state.source = v; paint(); }),
    select([['', 'Все менеджеры'], ['none', 'Без ответственного'], ...ctx.team().map((u) => [u.id, u.full_name || u.email])], state.manager, (v) => { state.manager = v; paint(); }),
    select([['', 'Все направления'], ...tours], state.tour, (v) => { state.tour = v; paint(); }),
    select([['', 'За всё время'], ['1', 'Сегодня'], ['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней']], state.days, (v) => { state.days = v; paint(); }),
    h('label.switch', h('input', { type: 'checkbox', checked: state.spam, onchange: (e) => { state.spam = e.target.checked; paint(); } }), h('i'), h('span', 'Спам')));
  root.append(quickRow, toolbar, body);

  function filtered() {
    const q = state.q, qd = q.replace(/\D/g, '');
    const quick = QUICK.find((x) => x[0] === state.quick)[2];
    const since = state.days ? (state.days === '1' ? new Date(ymd(Date.now()) + 'T00:00:00+04:00').getTime() : Date.now() - state.days * 86400e3) : 0;
    return leads.filter((l) => (state.spam || l.status !== 'spam') && quick(l)
      && (!state.source || l.source === state.source)
      && (!state.manager || (state.manager === 'none' ? !l.assigned_to : l.assigned_to === state.manager))
      && (!state.tour || l.tour === state.tour)
      && (!since || new Date(l.created_at).getTime() >= since)
      && (!q || (l.name || '').toLowerCase().includes(q) || (l.message || '').toLowerCase().includes(q) || (qd.length >= 3 && (l.phone || '').replace(/\D/g, '').includes(qd)) || (l.tags || []).some((t) => t.includes(q))));
  }
  function paint() {
    const rows = filtered();
    const nNew = leads.filter((l) => l.status === 'new').length, nLate = leads.filter((l) => l.status === 'new' && minutesBetween(l.created_at, Date.now()) > sla).length;
    headSub.textContent = `${fmt.num(rows.length)} ${plural(rows.length, 'заявка', 'заявки', 'заявок')} в выборке · ${nNew} новых` + (nLate ? ` · ${nLate} ждут дольше ${sla} мин` : '');
    ctx.setBadge(nNew);
    paintQuick();
    mount(body, state.view === 'kanban' ? kanban(rows) : tableView(rows));
  }

  // ---------- kanban ----------
  function kanban(rows) {
    const cols = state.spam ? COLS.concat('spam') : COLS;
    const wrap = h('div.kanban', { style: { gridTemplateColumns: `repeat(${cols.length}, minmax(230px, 1fr))` } });
    cols.forEach((st) => {
      const items = rows.filter((l) => l.status === st);
      const val = items.reduce((a, l) => a + (+l.value || 0), 0);
      const col = h('div.kcol', { dataset: { status: st } },
        h('div.kcol__h', h('span', h('span.badge.badge--' + st, STATUS_NAME[st]), ' ', h('small', String(items.length))), val ? h('small', fmt.money(val)) : null));
      items.slice(0, 60).forEach((l) => col.appendChild(leadCard(l)));
      if (items.length > 60) col.appendChild(h('button.btn.btn--ghost.btn--sm', { onclick: () => { state.view = 'table'; paint(); } }, 'Ещё ' + (items.length - 60) + ' — в таблице'));
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('is-over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('is-over'); });
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('is-over');
        const id = e.dataTransfer.getData('text/lead'); const l = leads.find((x) => x.id === id);
        if (l && l.status !== st) { await changeStatus(ctx, l, st); paint(); }
      });
      wrap.appendChild(col);
    });
    return wrap;
  }
  function leadCard(l) {
    const c = h('article.lcard', { draggable: 'true', tabindex: '0', onclick: () => openLead(ctx, l.id, paint), onkeydown: (e) => { if (e.key === 'Enter') openLead(ctx, l.id, paint); } },
      h('div.row.row--between', h('b', l.name), slaBadge(l, sla)),
      h('div.lcard__meta', h('span.tag', SOURCE_NAME[l.source] || l.source), l.tour ? h('span.tag', tourName(ctx, l.tour)) : null, (l.tags || []).map((t) => h('span.tag', '#' + t))),
      l.message ? h('div.lcard__msg', l.message) : null,
      h('div.lcard__foot', h('span.muted', fmt.ago(l.created_at) + (l.assigned_to ? ' · ' + ctx.staffName(l.assigned_to).split(' ')[0] : '')), l.value ? h('b', fmt.money(l.value, l.currency)) : null));
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/lead', l.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('is-dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('is-dragging'));
    return c;
  }

  // ---------- table ----------
  const selected = new Set();
  function tableView(rows) {
    const bulk = h('div.toolbar', { hidden: !selected.size, style: { background: 'var(--accent-soft)', padding: '8px 12px', borderRadius: '12px' } });
    const paintBulk = () => {
      bulk.hidden = !selected.size; clear(bulk);
      add(bulk, h('b', 'Выбрано: ' + selected.size),
        select([['', 'Сменить статус…'], ...STATUS], '', async (v) => { if (!v) return; await bulkDo({ status: v }); }),
        select([['', 'Назначить…'], ...ctx.team().map((u) => [u.id, u.full_name || u.email])], '', async (v) => { if (!v) return; await bulkDo({ assigned_to: v }); }),
        h('button.btn.btn--sm', { onclick: () => exportCsv(leads.filter((l) => selected.has(l.id))) }, icon('download'), 'CSV'),
        ctx.can('owner') ? h('button.btn.btn--sm.btn--danger', { onclick: async () => {
          if (!(await confirmDlg('Удалить ' + selected.size + ' ' + plural(selected.size, 'заявку', 'заявки', 'заявок') + '?', { sub: 'Это нельзя отменить. Для мусора лучше статус «Спам».' }))) return;
          try {
            for (const id of selected) await ctx.api.deleteLead(id);
            for (let i = leads.length - 1; i >= 0; i--) if (selected.has(leads[i].id)) leads.splice(i, 1);
            selected.clear(); toast('Удалено'); paint();
          } catch (e) { ctx.err(e); }
        } }, icon('trash'), 'Удалить') : null,
        h('button.btn.btn--sm.btn--ghost', { onclick: () => { selected.clear(); paint(); } }, 'Снять выделение'));
    };
    async function bulkDo(patch) {
      try {
        await ctx.api.updateLeads(Array.from(selected), patch);
        leads.forEach((l) => { if (selected.has(l.id)) Object.assign(l, patch); });
        toast('Обновлено: ' + selected.size); selected.clear(); paint();
      } catch (e) { ctx.err(e); }
    }
    paintBulk();
    const t = table({
      rows, selectable: true, selected, onSelect: paintBulk, onRow: (l) => openLead(ctx, l.id, paint), initialSort: ['created_at', -1],
      empty: 'Под фильтр ничего не попало',
      columns: [
        { key: 'name', label: 'Клиент', sort: true, render: (l) => h('div.cell-main', h('b', l.name), h('small', l.phone)) },
        { key: 'status', label: 'Статус', sort: true, render: (l) => h('span.badge.badge--' + l.status, STATUS_NAME[l.status]) },
        { key: 'sla', label: 'Ответ', sort: (l) => l.first_response_at ? minutesBetween(l.created_at, l.first_response_at) : 1e9, render: (l) => slaBadge(l, sla) },
        { key: 'tour', label: 'Направление', sort: true, render: (l) => tourName(ctx, l.tour) },
        { key: 'source', label: 'Источник', sort: true, render: (l) => h('div.cell-main', h('b', SOURCE_NAME[l.source] || l.source), l.utm_campaign ? h('small', l.utm_campaign) : null) },
        { key: 'assigned_to', label: 'Менеджер', sort: (l) => ctx.staffName(l.assigned_to), render: (l) => l.assigned_to ? ctx.staffName(l.assigned_to) : h('span.muted', '—') },
        { key: 'value', label: 'Сумма', align: 'r', sort: (l) => +l.value || 0, render: (l) => l.value ? fmt.money(l.value, l.currency) : '' },
        { key: 'created_at', label: 'Создана', sort: true, render: (l) => h('span', { title: fmt.dt(l.created_at) }, fmt.ago(l.created_at)) },
      ],
    });
    return h('div', bulk, h('div.card.card--flush', t));
  }

  paint();
  const onLive = () => paint();
  document.addEventListener('sam:lead', onLive);
  new MutationObserver((_, o) => { if (!root.isConnected || !root.contains(body)) { document.removeEventListener('sam:lead', onLive); o.disconnect(); } }).observe(root, { childList: true });

  if (params[0] === 'new') createLead(ctx, paint);
  else if (params[0]) openLead(ctx, params[0], paint);
}

function exportCsv(rows) {
  const ctx = window.__samPanel;
  csv('leads-' + new Date().toISOString().slice(0, 10) + '.csv', rows, [
    ['Дата', (l) => fmt.dt(l.created_at)], ['Имя', (l) => l.name], ['Телефон', (l) => l.phone], ['Email', (l) => l.email],
    ['Статус', (l) => STATUS_NAME[l.status]], ['Направление', (l) => tourName(ctx, l.tour)], ['Сообщение', (l) => l.message],
    ['Источник', (l) => SOURCE_NAME[l.source] || l.source], ['utm_source', (l) => l.utm_source], ['utm_campaign', (l) => l.utm_campaign],
    ['Менеджер', (l) => l.assigned_to ? ctx.staffName(l.assigned_to) : ''], ['Сумма', (l) => l.value], ['Причина отказа', (l) => l.lost_reason],
    ['Первый ответ, мин', (l) => l.first_response_at ? Math.round(minutesBetween(l.created_at, l.first_response_at)) : ''], ['Промокод', (l) => l.coupon_code], ['Теги', (l) => (l.tags || []).join(' ')],
  ]);
}

// ---------- status change with the questions each status needs ----------
const LOST_REASONS = ['Дорого', 'Выбрали другое агентство', 'Перенесли поездку', 'Не отвечает', 'Не подошли даты', 'Нет мест / визы', 'Другое'];
export async function changeStatus(ctx, l, st) {
  let patch = { status: st };
  if (st === 'won') {
    const v = await ask('Сумма продажи', 'Для выручки и среднего чека в отчётах. Можно оставить пустым.', input(l.value || '', { type: 'number', placeholder: '1500', attrs: { min: 0, step: 10 } }));
    if (v === null) return false;
    if (v !== '') patch.value = Number(v);
  }
  if (st === 'lost') {
    const v = await ask('Причина отказа', 'Помогает понять, где теряются клиенты.', select(LOST_REASONS, l.lost_reason || LOST_REASONS[0]));
    if (v === null) return false;
    patch.lost_reason = v;
  }
  if (!l.assigned_to && st !== 'spam') patch.assigned_to = ctx.me.id;
  try {
    const upd = await ctx.api.updateLead(l.id, patch);
    Object.assign(l, upd || patch);
    toast(l.name + ': ' + STATUS_NAME[st], '', { icon: 'check' });
    return true;
  } catch (e) { ctx.err(e); return false; }
}
function ask(title, sub, ctrl) {
  return new Promise((res) => {
    let done = false;
    modal({ title, sub, body: field(title, ctrl), onClose: () => { if (!done) res(null); },
      actions: [{ label: 'Отмена', onClick: () => { done = true; res(null); } }, { label: 'Сохранить', kind: 'primary', onClick: () => { done = true; res(ctrl.value); } }] });
  });
}

// ---------- create (phone call, walk-in, Instagram DM) ----------
export function createLead(ctx, after) {
  const d = { name: '', phone: '', message: '', source: 'phone', tour: '', assigned_to: ctx.me.id, email: '' };
  const tours = (ctx.cache.tours || []).map((t) => [t.slug, tourName(ctx, t.slug)]);
  modal({
    title: 'Новая заявка', sub: 'Звонок, визит в офис или сообщение в Instagram — чтобы всё было в одной воронке.',
    body: h('div.stack',
      h('div.grid2', field('Имя', input('', { oninput: (v) => (d.name = v), attrs: { autofocus: true } })), field('Телефон', input('', { type: 'tel', placeholder: '+374 …', oninput: (v) => (d.phone = v) }))),
      h('div.grid2',
        field('Откуда', select([['phone', 'Звонок'], ['walk_in', 'Пришли в офис'], ['instagram', 'Instagram Direct'], ['manual', 'WhatsApp']], d.source, (v) => (d.source = v))),
        field('Направление', select([['', '—'], ...tours], '', (v) => (d.tour = v)))),
      field('Что хотят', textarea('', { oninput: (v) => (d.message = v), placeholder: 'Даты, сколько человек, бюджет…' })),
      h('div.grid2', field('Email', input('', { type: 'email', oninput: (v) => (d.email = v) })),
        field('Ответственный', select(ctx.team().map((u) => [u.id, u.full_name || u.email]), d.assigned_to, (v) => (d.assigned_to = v))))),
    actions: [{ label: 'Отмена' }, { label: 'Создать', kind: 'primary', onClick: async () => {
      if (!d.name.trim() || d.phone.replace(/\D/g, '').length < 6) { toast('Нужны имя и телефон', 'bad'); return false; }
      try {
        const l = await ctx.api.createLead({ ...d, tour: d.tour || null, email: d.email || null, lang: 'ru' });
        (ctx.cache.leads = ctx.cache.leads || []).unshift(l);
        toast('Заявка создана'); after && after(); openLead(ctx, l.id, after);
      } catch (e) { ctx.err(e); return false; }
    } }],
  });
}

// ---------- the lead card ----------
const ACT_ICON = { note: 'edit', status: 'refresh', assign: 'users', call: 'phone', whatsapp: 'wa', email: 'mail', system: 'zap' };
export async function openLead(ctx, id, after) {
  const leads = await ctx.leads();
  const l = leads.find((x) => x.id === id);
  if (!l) { toast('Заявка не найдена', 'bad'); return; }
  if (location.hash !== '#/leads/' + id) history.replaceState(null, '', '#/leads/' + id);
  const sla = ((ctx.cache.settings || {}).hours || {}).sla_min || 60;
  const dups = leads.filter((x) => x.id !== l.id && x.phone && (x.phone || '').replace(/\D/g, '').slice(-8) === l.phone.replace(/\D/g, '').slice(-8));
  const tl = h('div.tl');
  let templates = [];
  ctx.api.list('wa_templates').then((t) => { templates = t; }).catch(() => {});

  const dr = drawer({
    title: l.name,
    sub: 'Заявка от ' + fmt.dt(l.created_at) + ' · ' + (SOURCE_NAME[l.source] || l.source),
    head: h('div.row', { style: { marginTop: '10px' } }, h('span.badge.badge--' + l.status, STATUS_NAME[l.status]), slaBadge(l, sla),
      !inWorkingHours(l.created_at, (ctx.cache.settings || {}).hours) ? h('span.badge.badge--plain', 'вне рабочего времени') : null,
      dups.length ? h('span.badge.badge--warn', 'повторное обращение ×' + (dups.length + 1)) : null),
    onClose: () => { if (location.hash.startsWith('#/leads/')) history.replaceState(null, '', '#/leads'); after && after(); },
    body: () => {
      const b = h('div');
      // contact actions
      add(b, h('div.btns', { style: { marginBottom: '18px' } },
        h('button.btn.btn--wa', { onclick: () => pickTemplate() }, icon('wa'), 'Написать в WhatsApp'),
        h('a.btn', { href: 'tel:' + l.phone.replace(/[^\d+]/g, ''), onclick: () => log('call', 'Звонок клиенту') }, icon('phone'), 'Позвонить'),
        h('button.btn', { onclick: () => copyText(l.phone, 'Телефон скопирован') }, icon('copy'), l.phone),
        l.email ? h('a.btn', { href: 'mailto:' + l.email, onclick: () => log('email', 'Письмо на ' + l.email) }, icon('mail'), 'Email') : null));
      // editable fields
      const statusSel = select(STATUS, l.status, async (v) => { const ok = await changeStatus(ctx, l, v); if (!ok) statusSel.value = l.status; else refreshTl(); });
      const valueIn = input(l.value || '', { type: 'number', placeholder: '0', attrs: { min: 0, step: 10 } });
      valueIn.addEventListener('change', () => save({ value: valueIn.value === '' ? null : Number(valueIn.value) }));
      const fu = input(l.follow_up_at ? toLocalInput(l.follow_up_at) : '', { type: 'datetime-local' });
      fu.addEventListener('change', () => save({ follow_up_at: fu.value ? new Date(fu.value).toISOString() : null }));
      add(b, h('div.section-t', 'Работа с заявкой'),
        h('div.grid2',
          field('Статус', statusSel),
          field('Ответственный', select([['', '— не назначен —'], ...ctx.team().map((u) => [u.id, u.full_name || u.email])], l.assigned_to || '', (v) => save({ assigned_to: v || null }).then(refreshTl))),
          field('Сумма сделки, ' + (l.currency || 'USD'), valueIn),
          field('Перезвонить', fu, 'Появится в «Перезвонить сегодня»')),
        l.status === 'lost' ? h('div', { style: { marginTop: '12px' } }, field('Причина отказа', select(LOST_REASONS, l.lost_reason || '', (v) => save({ lost_reason: v })))) : null,
        h('div', { style: { marginTop: '12px' } }, field('Теги', tagsInput(l.tags, (t) => save({ tags: t })))));
      // request details
      const det = l.details || {};
      add(b, h('div.section-t', 'Запрос'),
        l.message ? h('p', { style: { whiteSpace: 'pre-wrap', margin: '0 0 12px', background: 'var(--surface-2)', padding: '10px 12px', borderRadius: '10px' } }, l.message) : null,
        h('dl.kv',
          l.tour ? [h('dt', 'Направление'), h('dd', tourName(ctx, l.tour))] : null,
          det.people ? [h('dt', 'Путешественников'), h('dd', String(det.people))] : null,
          det.from ? [h('dt', 'Даты'), h('dd', fmt.date(det.from) + (det.to ? ' — ' + fmt.date(det.to) : ''))] : null,
          det.meals && det.meals.length ? [h('dt', 'Питание'), h('dd', det.meals.join(', '))] : null,
          l.coupon_code ? [h('dt', 'Промокод'), h('dd', h('span.tag', l.coupon_code))] : null,
          [h('dt', 'Язык сайта'), h('dd', (l.lang || '—').toUpperCase() + (l.device ? ' · ' + l.device : ''))],
          [h('dt', 'Реклама'), h('dd', l.utm_source ? [l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content].filter(Boolean).join(' / ') : (l.referrer ? 'Переход с ' + l.referrer : 'Прямой заход / офлайн'))]));
      if (dups.length) add(b, h('div.section-t', 'Прошлые обращения с этого номера'),
        h('div.list', dups.slice(0, 5).map((x) => h('div.item', { style: { cursor: 'pointer' }, onclick: () => { dr.close(); setTimeout(() => openLead(ctx, x.id, after), 250); } },
          h('div.item__main', h('b', fmt.date(x.created_at) + ' · ' + (tourName(ctx, x.tour) || 'без направления')), h('small', x.message || '')),
          h('span.badge.badge--' + x.status, STATUS_NAME[x.status])))));
      // timeline + note
      const note = textarea('', { rows: 2, placeholder: 'Заметка: о чём договорились, что отправили…' });
      add(b, h('div.section-t', 'История'),
        h('div.row', { style: { alignItems: 'flex-start', flexWrap: 'nowrap', marginBottom: '16px' } }, note,
          h('button.btn', { onclick: async () => { if (!note.value.trim()) return; await log('note', note.value.trim()); note.value = ''; } }, 'Добавить')),
        tl);
      return b;
    },
    footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
      h('div.btns',
        l.status !== 'spam' ? h('button.btn.btn--ghost', { onclick: async () => { if (await changeStatus(ctx, l, 'spam')) api.close(); } }, 'Это спам') : null,
        ctx.can('owner') ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => {
          if (!(await confirmDlg('Удалить заявку «' + l.name + '»?', { sub: 'Вместе с историей. Отменить нельзя.' }))) return;
          try { await ctx.api.deleteLead(l.id); ctx.cache.leads.splice(ctx.cache.leads.indexOf(l), 1); toast('Удалено'); api.close(); } catch (e) { ctx.err(e); }
        } }, icon('trash'), 'Удалить') : null),
      h('button.btn.btn--primary', { onclick: () => api.close() }, 'Готово')),
  });

  async function save(patch) {
    try { const u = await ctx.api.updateLead(l.id, patch); Object.assign(l, u || patch); toast('Сохранено', '', { icon: 'check', ms: 1400 }); }
    catch (e) { ctx.err(e); }
  }
  async function log(kind, body, meta) {
    try { await ctx.api.addActivity(l.id, kind, body, meta); if (!l.first_response_at && kind !== 'system') l.first_response_at = new Date().toISOString(); refreshTl(); }
    catch (e) { ctx.err(e); }
  }
  async function refreshTl() {
    try {
      const acts = await ctx.api.leadActivity(l.id);
      mount(tl, acts.length ? acts.slice().reverse().map((a) => h('div.tl__i', h('span.tl__dot', icon(ACT_ICON[a.kind] || 'spark')),
        h('div.tl__b', actText(ctx, a), h('small', fmt.dt(a.created_at) + (a.actor ? ' · ' + ctx.staffName(a.actor) : '')),
          a.kind === 'note' ? h('p', a.body) : null))) : h('div.muted', 'Пока пусто'));
    } catch (e) { mount(tl, h('div.muted', 'История недоступна')); }
  }
  function pickTemplate() {
    const lang = l.lang || 'ru';
    const list = templates.slice().sort((a, b) => (a.lang === lang ? -1 : 0) - (b.lang === lang ? -1 : 0));
    const tn = tourName(ctx, l.tour);
    const vars = { name: l.name, tour: tn, manager: ctx.me.full_name };
    let text = list[0] ? fillTemplate(list[0].body, vars) : '';
    const ta = textarea(text, { rows: 5 });
    modal({
      title: 'Сообщение в WhatsApp', sub: 'Шаблон подставит имя, направление и ваше имя — поправьте и отправьте.',
      body: h('div.stack',
        list.length ? h('div.chips', list.map((t) => h('button.chip', { type: 'button', onclick: () => { ta.value = fillTemplate(t.body, vars); } }, t.title + ' · ' + t.lang.toUpperCase()))) : h('div.muted', 'Шаблонов пока нет — владелец добавляет их в «Шаблоны ответов».'),
        ta),
      actions: [{ label: 'Отмена' }, { label: 'Открыть WhatsApp', kind: 'primary', onClick: () => {
        window.open(waLink(l.phone, ta.value), '_blank', 'noopener');
        log('whatsapp', ta.value ? 'Сообщение: ' + ta.value.slice(0, 140) : 'Открыт чат WhatsApp');
        if (l.status === 'new') changeStatus(ctx, l, 'contacted').then(refreshTl);
      } }],
    });
  }
  refreshTl();
}
function actText(ctx, a) {
  if (a.kind === 'status') return h('span', 'Статус: ', a.meta && a.meta.from ? h('span.muted', (STATUS_NAME[a.meta.from] || a.meta.from) + ' → ') : null, h('b', STATUS_NAME[a.body] || a.body));
  if (a.kind === 'assign') return h('span', 'Ответственный: ', h('b', a.meta && a.meta.to ? ctx.staffName(a.meta.to) : 'снят'));
  if (a.kind === 'note') return h('span', 'Заметка');
  return h('span', a.body || a.kind);
}
function toLocalInput(d) { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); }
