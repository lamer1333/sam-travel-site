// Coupons: generator (one code or a batch), limits, validity, usage in leads.
import { h, mount, icon, fmt, toast, modal, confirmDlg, field, input, select, toggle, table, csv, copyText, pageHead, plural } from '../ui.js';

function stateOf(c) {
  const now = Date.now();
  if (!c.active) return ['off', 'Выключен'];
  if (c.valid_from && new Date(c.valid_from) > now) return ['warn', 'Ещё не начался'];
  if (c.valid_until && new Date(c.valid_until) <= now) return ['off', 'Истёк'];
  if (c.max_uses != null && c.used_count >= c.max_uses) return ['off', 'Исчерпан'];
  return ['ok', 'Действует'];
}
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I — codes get read out over the phone
const rand = (n) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => ALPH[x % ALPH.length]).join('');

export default async function couponsView(root, ctx, params) {
  let [rows, leads] = await Promise.all([ctx.api.list('coupons', 'created_at'), ctx.can('leads') ? ctx.leads().catch(() => []) : Promise.resolve(null)]);
  const inLeads = {};
  (leads || []).forEach((l) => { if (l.coupon_code) { const k = l.coupon_code.toUpperCase(); const x = inLeads[k] || (inLeads[k] = { n: 0, won: 0 }); x.n++; if (l.status === 'won') x.won++; } });
  const box = h('div');
  root.append(pageHead('Промокоды', 'Коды для рекламы, рассылок и постоянных клиентов. Посетитель вводит код в форме или получает его из баннера — код приходит вместе с заявкой.',
    h('button.btn', { onclick: () => csv('coupons.csv', rows, [['Код', (c) => c.code], ['Описание', (c) => c.description], ['Скидка %', (c) => c.discount_pct], ['Скидка $', (c) => c.discount_amt], ['С', (c) => fmt.date(c.valid_from)], ['До', (c) => c.valid_until ? fmt.date(c.valid_until) : ''], ['Лимит', (c) => c.max_uses ?? ''], ['Использован', (c) => c.used_count], ['Статус', (c) => stateOf(c)[1]]]) }, icon('download'), 'CSV'),
    h('button.btn.btn--primary', { onclick: () => gen() }, icon('plus'), 'Создать коды')), box);

  function paint() {
    mount(box, h('div.card.card--flush', table({
      rows, initialSort: ['created_at', -1], empty: 'Кодов пока нет',
      columns: [
        { key: 'code', label: 'Код', sort: true, render: (c) => h('div.row', { style: { flexWrap: 'nowrap' } }, h('b.mono', { style: { fontSize: '13px' } }, c.code), h('button.btn.btn--ghost.btn--sm', { title: 'Скопировать', onclick: () => copyText(c.code, c.code + ' скопирован') }, icon('copy'))) },
        { key: 'description', label: 'Для чего', render: (c) => h('span.dim', c.description || '—') },
        { key: 'disc', label: 'Скидка', align: 'r', sort: (c) => c.discount_pct || c.discount_amt || 0, render: (c) => c.discount_pct ? '−' + c.discount_pct + '%' : c.discount_amt ? '−' + fmt.money(c.discount_amt) : '—' },
        { key: 'valid_until', label: 'Срок', sort: (c) => c.valid_until || '9999', render: (c) => (c.valid_from && new Date(c.valid_from) > Date.now() ? 'с ' + fmt.date(c.valid_from) + ' ' : '') + (c.valid_until ? 'до ' + fmt.date(c.valid_until) : 'бессрочно') },
        { key: 'used_count', label: 'Использован', align: 'r', sort: true, render: (c) => h('span', { title: 'Отметка «использован» при бронировании' }, fmt.num(c.used_count) + (c.max_uses != null ? ' / ' + c.max_uses : '')) },
        { key: 'leads', label: 'В заявках', align: 'r', sort: (c) => (inLeads[c.code.toUpperCase()] || {}).n || 0, render: (c) => { const x = inLeads[c.code.toUpperCase()]; return leads ? (x ? h('span', x.n + ' ', h('span.muted', '(' + x.won + ' прод.)')) : '0') : h('span.muted', { title: 'Видно владельцу и менеджерам' }, '—'); } },
        { key: 'st', label: 'Статус', render: (c) => { const [k, l] = stateOf(c); return h('span.badge.badge--' + k, l); } },
        { key: 'active', label: '', render: (c) => h('div.row', { style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } },
          toggle(c.active, null, async (on, el) => { try { const u = await ctx.api.save('coupons', { ...c, active: on }); Object.assign(c, u); paint(); } catch (e) { el.checked = !on; ctx.err(e); } }),
          h('button.btn.btn--ghost.btn--sm', { 'aria-label': 'Удалить', onclick: async () => { if (!(await confirmDlg('Удалить код ' + c.code + '?', { sub: 'В старых заявках он останется текстом.' }))) return; try { await ctx.api.remove('coupons', c.id); rows = rows.filter((x) => x.id !== c.id); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'))) },
      ],
    })));
  }

  function gen() {
    let maxIn;
    const d = { mode: 'one', code: '', prefix: 'SAM', count: 20, len: 5, type: 'pct', pct: 5, amt: 50, description: '', valid_from: new Date().toISOString().slice(0, 10), valid_until: '', max_uses: '' };
    const preview = h('div.utm-out');
    const paintPv = () => { preview.textContent = d.mode === 'one' ? (d.code || 'SAM-AB3K9').toUpperCase() : Array.from({ length: Math.min(4, d.count) }, () => (d.prefix ? d.prefix.toUpperCase() + '-' : '') + rand(d.len)).join('  ') + (d.count > 4 ? '  … ещё ' + (d.count - 4) : ''); };
    const oneBox = h('div', field('Код', input('', { placeholder: 'WINTER10', oninput: (v) => { d.code = v.replace(/[^A-Za-z0-9-]/g, '').toUpperCase(); paintPv(); } }), 'Латиница и цифры. Короткий и понятный — для рекламы и баннера'));
    const bulkBox = h('div.grid3', { hidden: true },
      field('Префикс', input(d.prefix, { oninput: (v) => { d.prefix = v.replace(/[^A-Za-z0-9]/g, ''); paintPv(); } })),
      field('Сколько кодов', input(d.count, { type: 'number', attrs: { min: 1, max: 200 }, oninput: (v) => { d.count = Math.max(1, Math.min(200, Number(v) || 1)); paintPv(); } })),
      field('Длина случайной части', input(d.len, { type: 'number', attrs: { min: 4, max: 10 }, oninput: (v) => { d.len = Math.max(4, Math.min(10, Number(v) || 5)); paintPv(); } })));
    const pctIn = input(d.pct, { type: 'number', attrs: { min: 1, max: 100 }, oninput: (v) => { d.pct = Number(v); } });
    const amtIn = input(d.amt, { type: 'number', attrs: { min: 1 }, oninput: (v) => { d.amt = Number(v); } }); amtIn.hidden = true;
    modal({
      title: 'Новые промокоды', wide: true,
      body: h('div.stack',
        h('div.seg', [['one', 'Один код'], ['bulk', 'Пачка персональных']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === d.mode), onclick: (e) => { d.mode = v; e.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); oneBox.hidden = v !== 'one'; bulkBox.hidden = v === 'one'; if (v === 'bulk' && !d.max_uses) { d.max_uses = 1; maxIn.value = 1; } paintPv(); } }, l))),
        oneBox, bulkBox, preview,
        h('div.grid3',
          field('Тип скидки', select([['pct', 'Процент'], ['amt', 'Сумма, $']], 'pct', (v) => { d.type = v; pctIn.hidden = v !== 'pct'; amtIn.hidden = v !== 'amt'; })),
          h('div.field', h('span', 'Размер'), pctIn, amtIn),
          field('Лимит использований', (maxIn = input('', { type: 'number', placeholder: 'без лимита', attrs: { min: 1 }, oninput: (v) => { d.max_uses = v; } })))),
        h('div.grid2', field('Действует с', input(d.valid_from, { type: 'date', oninput: (v) => { d.valid_from = v; } })), field('по', input('', { type: 'date', oninput: (v) => { d.valid_until = v; } }), 'Пусто — бессрочно')),
        field('Для чего (видно только команде)', input('', { placeholder: 'Рассылка подписчикам, октябрь', oninput: (v) => { d.description = v; } }))),
      actions: [{ label: 'Отмена' }, { label: 'Создать', kind: 'primary', onClick: async () => {
        const codes = d.mode === 'one' ? [d.code] : Array.from({ length: d.count }, () => (d.prefix ? d.prefix.toUpperCase() + '-' : '') + rand(d.len));
        if (!codes[0] || codes[0].length < 3) { toast('Код слишком короткий', 'bad'); return false; }
        const base = { description: d.description || null, discount_pct: d.type === 'pct' ? d.pct : null, discount_amt: d.type === 'amt' ? d.amt : null,
          valid_from: new Date(d.valid_from || Date.now()).toISOString(), valid_until: d.valid_until ? new Date(d.valid_until + 'T23:59:59').toISOString() : null,
          max_uses: d.max_uses === '' || d.max_uses == null ? null : Number(d.max_uses), used_count: 0, active: true };
        try {
          const made = [];
          for (const code of codes) made.push(await ctx.api.save('coupons', { ...base, code }));
          rows = made.concat(rows); paint();
          if (made.length > 1) { csv('coupons-' + (d.prefix || 'batch') + '.csv', made, [['Код', (c) => c.code], ['Скидка', (c) => c.discount_pct ? c.discount_pct + '%' : '$' + c.discount_amt], ['До', (c) => c.valid_until ? fmt.date(c.valid_until) : '']]); }
          toast('Создано ' + made.length + ' ' + plural(made.length, 'код', 'кода', 'кодов'));
        } catch (e) { ctx.err(e); return false; }
      } }],
    });
    paintPv();
  }
  paint();
  if (params[0] === 'new') gen();
}
