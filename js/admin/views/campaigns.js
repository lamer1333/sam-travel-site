// Campaigns: UTM link builder with QR, and each campaign's spend → visits →
// leads → sales → ROMI, over the campaign's whole life.
import { h, $, mount, clear, icon, fmt, toast, drawer, confirmDlg, field, input, textarea, select, table, copyText, slug, pageHead, card, csv } from '../ui.js';
import { CHANNELS } from './common.js';

const PRESETS = [
  ['instagram_ads', 'Instagram — реклама', 'instagram', 'instagram', 'paid_social'],
  ['instagram_bio', 'Instagram — ссылка в профиле', 'instagram', 'instagram', 'bio'],
  ['instagram_stories', 'Instagram — сторис', 'instagram', 'instagram', 'stories'],
  ['facebook_ads', 'Facebook — реклама', 'facebook', 'facebook', 'paid_social'],
  ['google_ads', 'Google Ads', 'google', 'google', 'cpc'],
  ['tiktok', 'TikTok — реклама', 'tiktok', 'tiktok', 'paid_social'],
  ['telegram', 'Telegram — пост / посев', 'telegram', 'telegram', 'referral'],
  ['email', 'Email-рассылка', 'email', 'newsletter', 'email'],
  ['influencer', 'Блогер', 'influencer', 'blogger', 'influencer'],
  ['offline_qr', 'Флаер / плакат с QR', 'offline', 'flyer', 'qr'],
];
const LANDINGS = [['', 'Главная'], ['#hot', 'Горящие туры'], ['#plan', 'Подбор тура'], ['#checklist', 'Чек-лист документов'], ['#services', 'Услуги'], ['#b2b', 'Корпоративным'], ['#contacts', 'Форма заявки']];
const BASE = 'https://samtravel.am/';

export function buildUrl(c, lang) {
  const p = new URLSearchParams();
  if (lang) p.set('lang', lang);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach((k) => { if (c[k]) p.set(k, c[k]); });
  return (c.base || BASE) + (p.toString() ? '?' + p.toString() : '') + (c.landing || '');
}
function status(c) {
  const today = new Date().toISOString().slice(0, 10);
  if (c.archived) return ['off', 'В архиве'];
  if (c.starts_on && c.starts_on > today) return ['warn', 'Запланирована'];
  if (c.ends_on && c.ends_on < today) return ['off', 'Завершена'];
  return ['ok', 'Идёт'];
}

export default async function campaignsView(root, ctx, params) {
  let [rows, settings] = await Promise.all([ctx.api.list('campaigns'), ctx.settings()]);
  // ROMI is counted on the agency's gross profit, not the tour price: a $2,000 tour
  // earns the agency its margin, and that is what the ad spend has to pay back.
  const marginPct = Number((settings.company || {}).margin_pct) || 12, margin = marginPct / 100;
  const earliest = rows.reduce((m, c) => Math.min(m, new Date(c.starts_on || c.created_at).getTime()), Date.now() - 30 * 86400e3);
  const stats = await ctx.api.stats(new Date(earliest), new Date(Date.now() + 60e3));
  const byC = Object.fromEntries(stats.campaigns.map((x) => [x.campaign, x]));
  let showArchived = false;
  const tableBox = h('div');

  root.append(pageHead('Кампании и UTM', 'Каждой рекламе — своя ссылка. Сайт запоминает метки при заходе и передаёт их в заявку, поэтому видно, какая реклама приводит клиентов и окупается. Цифры — за всю жизнь кампании.',
    h('button.btn', { onclick: () => exportAll() }, icon('download'), 'CSV'),
    h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Новая кампания')));

  // untracked tags: traffic with a utm_campaign nobody registered
  const orphan = stats.campaigns.filter((x) => !rows.some((c) => c.utm_campaign === x.campaign) && x.visits >= 5);
  if (orphan.length) root.append(h('div.note.note--warn', { style: { marginBottom: '14px' } }, icon('alert'),
    h('span', 'Есть трафик с метками, для которых нет кампании: ', orphan.map((o, i) => [i ? ', ' : '', h('b', o.campaign), ' (' + o.visits + ' пос.)']), '. Создайте кампанию с таким utm_campaign, чтобы учесть расход.')));

  root.append(h('div.row', { style: { marginBottom: '12px' } }, h('span.muted', { style: { fontSize: '12.5px', marginRight: 'auto' } }, 'ROMI считается от дохода агентства: комиссия, которую менеджер указал в продаже; где не указал — выручка × маржа ' + marginPct + '%' + (ctx.can('owner') ? ' (меняется в «Контакты и реквизиты»)' : ' (задаёт владелец)') + '.'), h('label.switch', h('input', { type: 'checkbox', onchange: (e) => { showArchived = e.target.checked; paint(); } }), h('i'), h('span', 'Показать архив'))), tableBox);

  function metrics(c) {
    const s = byC[c.utm_campaign] || { visits: 0, contacts: 0, leads: 0, won: 0, revenue: 0 };
    // entered commissions are used as they are; sales without one are estimated by the margin
    const profit = s.revenue_est == null ? s.revenue * margin : (+s.profit || 0) + (+s.revenue_est || 0) * margin;
    return { ...c, ...s, cpl: s.leads ? c.spend / s.leads : null, cpa: s.won ? c.spend / s.won : null, profit, romi: c.spend ? (profit - c.spend) / c.spend : null, cr: s.visits ? s.leads / s.visits : null };
  }
  function paint() {
    const data = rows.filter((c) => showArchived || !c.archived).map(metrics);
    const tot = data.reduce((a, r) => ({ spend: a.spend + (+r.spend || 0), visits: a.visits + r.visits, leads: a.leads + r.leads, won: a.won + r.won, revenue: a.revenue + r.revenue, contacts: a.contacts + r.contacts }), { spend: 0, visits: 0, leads: 0, won: 0, revenue: 0, contacts: 0 });
    mount(tableBox, h('div.card.card--flush', table({
      rows: data, onRow: (r) => edit(rows.find((c) => c.id === r.id)), initialSort: ['leads', -1], empty: 'Кампаний пока нет — создайте первую, и ссылка будет готова через минуту',
      columns: [
        { key: 'name', label: 'Кампания', sort: true, cls: 'col-wide', render: (r) => h('div.cell-main', h('b', r.name), h('small', (CHANNELS[r.channel] || r.channel) + ' · ' + r.utm_campaign)) },
        { key: 'st', label: 'Статус', render: (r) => { const [k, l] = status(r); return h('span.badge.badge--' + k, l); } },
        { key: 'spend', label: 'Расход', align: 'r', sort: true, render: (r) => spendCell(r) },
        { key: 'visits', label: 'Посещ.', align: 'r', sort: true, render: (r) => fmt.num(r.visits) },
        { key: 'leads', label: 'Заявки', align: 'r', sort: true },
        { key: 'cr', label: 'Конв.', align: 'r', sort: (r) => r.cr || 0, render: (r) => fmt.pct(r.cr, 1) },
        { key: 'won', label: 'Продажи', align: 'r', sort: true },
        { key: 'revenue', label: 'Выручка', align: 'r', sort: true, render: (r) => r.revenue ? fmt.money(r.revenue) : '—' },
        { key: 'cpl', label: 'Цена заявки', align: 'r', sort: (r) => r.cpl ?? 1e9, render: (r) => fmt.money(r.cpl) },
        { key: 'romi', label: 'ROMI', align: 'r', sort: (r) => r.romi ?? -1e9, render: (r) => r.romi == null ? '—' : h('b', { style: { color: r.romi >= 0 ? 'var(--ok)' : 'var(--bad)' }, title: '(доход агентства − расход) ÷ расход. Доход: ' + fmt.money(r.profit) }, (r.romi > 0 ? '+' : '') + fmt.pct(r.romi, 0)) },
        { key: 'link', label: '', render: (r) => h('button.btn.btn--ghost.btn--sm', { title: 'Скопировать ссылку', onclick: () => copyText(buildUrl(r), 'Ссылка скопирована') }, icon('link')) },
      ],
      foot: () => h('tr', h('td', 'Итого'), h('td'), h('td.r.num', fmt.money(tot.spend)), h('td.r.num', fmt.num(tot.visits)), h('td.r.num', fmt.num(tot.leads)), h('td.r.num', fmt.pct(tot.visits ? tot.leads / tot.visits : null, 1)),
        h('td.r.num', fmt.num(tot.won)), h('td.r.num', fmt.money(tot.revenue)), h('td.r.num', fmt.money(tot.leads ? tot.spend / tot.leads : null)),
        h('td.r.num', tot.spend ? (tot.revenue * margin >= tot.spend ? '+' : '') + fmt.pct((tot.revenue * margin - tot.spend) / tot.spend, 0) : '—'), h('td')),
    })));
  }
  function spendCell(r) {
    const inp = h('input.input', { type: 'number', value: r.spend, min: 0, step: 10, style: { width: '96px', textAlign: 'right', minHeight: '30px', padding: '3px 8px' }, 'aria-label': 'Расход' });
    inp.addEventListener('change', async () => {
      try { const c = rows.find((x) => x.id === r.id); const u = await ctx.api.save('campaigns', { ...c, spend: Number(inp.value) || 0 }); Object.assign(c, u); toast('Расход обновлён'); paint(); } catch (e) { ctx.err(e); }
    });
    return inp;
  }
  function exportAll() {
    csv('campaigns.csv', rows.map(metrics), [['Кампания', (r) => r.name], ['Канал', (r) => CHANNELS[r.channel] || r.channel], ['utm_source', (r) => r.utm_source], ['utm_medium', (r) => r.utm_medium], ['utm_campaign', (r) => r.utm_campaign],
      ['Начало', (r) => r.starts_on], ['Конец', (r) => r.ends_on], ['Расход', (r) => r.spend], ['Посещения', (r) => r.visits], ['Заявки', (r) => r.leads], ['Продажи', (r) => r.won], ['Выручка', (r) => r.revenue],
      ['Цена заявки', (r) => r.cpl ? r.cpl.toFixed(2) : ''], ['ROMI %', (r) => r.romi != null ? (r.romi * 100).toFixed(0) : ''], ['Ссылка', (r) => buildUrl(r)]]);
  }

  // ---------- builder / editor ----------
  function edit(c) {
    const d = { channel: 'instagram', utm_source: 'instagram', utm_medium: 'paid_social', utm_campaign: '', utm_content: '', landing: '#hot', spend: 0, currency: 'USD', name: '', starts_on: new Date().toISOString().slice(0, 10), ends_on: '', notes: '', archived: false, ...c };
    let lang = '', campTouched = !!c.id;
    const out = h('div.utm-out'), qr = h('div.qr'), note = h('small.muted');
    const camp = input(d.utm_campaign, { placeholder: 'dubai_nov', oninput: (v) => { campTouched = true; d.utm_campaign = slug(v); upd(); } });
    const src = input(d.utm_source, { oninput: (v) => { d.utm_source = slug(v); upd(); } });
    const med = input(d.utm_medium, { oninput: (v) => { d.utm_medium = slug(v); upd(); } });
    function upd() {
      if (camp.value !== d.utm_campaign && document.activeElement !== camp) camp.value = d.utm_campaign;
      const url = buildUrl(d, lang);
      out.textContent = url;
      note.textContent = url.length > 120 ? 'Длинная ссылка — для печати и сторис лучше QR-код.' : '';
      clear(qr);
      if (window.QRCode) { try { new QRCode(qr, { text: url, width: 144, height: 144, colorDark: '#0b0d12', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch (e) {} }
      else qr.textContent = 'QR недоступен';
    }
    const presetSel = select([['', 'Выбрать шаблон…'], ...PRESETS.map((p) => [p[0], p[1]])], '', (v) => {
      const p = PRESETS.find((x) => x[0] === v); if (!p) return;
      d.channel = p[2]; d.utm_source = p[3]; d.utm_medium = p[4]; src.value = p[3]; med.value = p[4]; chSel.value = p[2];
      if (p[2] === 'offline') { d.landing = '#checklist'; landSel.value = d.landing; }
      upd();
    });
    const chSel = select(Object.entries(CHANNELS), d.channel, (v) => { d.channel = v; });
    const landSel = select(LANDINGS, d.landing, (v) => { d.landing = v; upd(); });
    const s = stats && byC[d.utm_campaign];
    drawer({
      title: c.id ? d.name : 'Новая кампания', sub: c.id ? 'utm_campaign: ' + d.utm_campaign : 'Заполните — ссылка и QR-код соберутся сами', wide: true,
      body: () => h('div.grid2', { style: { alignItems: 'start', gap: '22px' } },
        h('div.stack',
          field('Шаблон канала', presetSel, 'Подставит правильные utm_source и utm_medium'),
          field('Название кампании', input(d.name, { placeholder: 'Дубай в ноябре — Instagram', oninput: (v) => { d.name = v; if (!campTouched) { d.utm_campaign = slug(v); upd(); } } })),
          h('div.grid2', field('Канал', chSel), field('Куда ведёт', landSel)),
          h('div.grid2', field('utm_source', src), field('utm_medium', med)),
          h('div.grid2', field('utm_campaign', camp, 'Латиница, без пробелов'), field('utm_content', input(d.utm_content, { placeholder: 'reels_v1', oninput: (v) => { d.utm_content = slug(v); upd(); } }), 'Чтобы сравнить креативы')),
          h('div.grid3', field('Бюджет / расход, $', input(d.spend, { type: 'number', oninput: (v) => { d.spend = Number(v) || 0; } })),
            field('Начало', input(d.starts_on, { type: 'date', oninput: (v) => { d.starts_on = v || null; } })),
            field('Конец', input(d.ends_on || '', { type: 'date', oninput: (v) => { d.ends_on = v || null; } }))),
          field('Заметки', textarea(d.notes, { rows: 2, placeholder: 'Аудитория, креативы, что тестируем', oninput: (v) => { d.notes = v; } }))),
        h('div.stack',
          h('div.field', h('span', 'Ссылка для рекламы', select([['', 'язык по умолчанию'], ['ru', 'RU'], ['hy', 'HY'], ['en', 'EN']], '', (v) => { lang = v; upd(); })), out, note),
          h('div.btns', h('button.btn.btn--primary', { onclick: () => copyText(buildUrl(d, lang), 'Ссылка скопирована') }, icon('copy'), 'Скопировать'),
            h('button.btn', { onclick: () => { const cv = $('canvas', qr), img = $('img', qr); const src2 = cv ? cv.toDataURL('image/png') : img && img.src; if (!src2) return; const a = h('a', { href: src2, download: 'qr-' + (d.utm_campaign || 'sam') + '.png' }); document.body.appendChild(a); a.click(); a.remove(); } }, icon('download'), 'QR в PNG')),
          qr,
          s ? card('Результат кампании', null, h('dl.kv', h('dt', 'Посещения'), h('dd', fmt.num(s.visits)), h('dt', 'Контакты'), h('dd', fmt.num(s.contacts)), h('dt', 'Заявки'), h('dd', fmt.num(s.leads)), h('dt', 'Продажи'), h('dd', fmt.num(s.won)), h('dt', 'Выручка'), h('dd', fmt.money(s.revenue)))) : null,
          h('div.note', icon('spark'), h('span', 'Для Instagram-профиля используйте отдельную ссылку с utm_medium=bio — так видно, сколько клиентов приносит сам профиль, а не реклама.')))),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        h('div.btns', c.id ? h('button.btn.btn--ghost', { onclick: async () => { try { const u = await ctx.api.save('campaigns', { ...c, archived: !c.archived }); Object.assign(c, u); toast(c.archived ? 'В архиве' : 'Возвращена'); api.close(); paint(); } catch (e) { ctx.err(e); } } }, c.archived ? 'Вернуть из архива' : 'В архив') : null,
          c.id ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить кампанию?', { sub: 'Трафик и заявки с её метками останутся в отчётах.' }))) return; try { await ctx.api.remove('campaigns', c.id); rows = rows.filter((x) => x.id !== c.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash')) : null),
        h('div.btns', h('button.btn', { onclick: () => api.close() }, 'Отмена'), h('button.btn.btn--primary', { onclick: async () => {
          if (!d.name.trim() || !d.utm_campaign || !d.utm_source || !d.utm_medium) { toast('Нужны название, utm_source, utm_medium и utm_campaign', 'bad'); return; }
          try {
            const { base, ...row } = d;
            const u = await ctx.api.save('campaigns', row);
            if (c.id) Object.assign(c, u); else rows.push(u);
            toast('Кампания сохранена'); api.close(); paint();
          } catch (e) { ctx.err(e); }
        } }, 'Сохранить'))),
    });
    upd();
  }
  paint();
  if (params[0] === 'new') edit({});
}
