// Promos: a top announcement bar and a popup, trilingual, scheduled, targeted
// by language / device / ad campaign, with live preview and CTR per promo.
import { h, $$, mount, clear, icon, fmt, toast, drawer, confirmDlg, field, input, select, toggle, chipsPick, i18nEditor, langDots, pageHead, seg, LANGS, pickLang } from '../ui.js';

const THEMES = [['brand', 'Фирменный'], ['dark', 'Тёмный'], ['sunset', 'Закат'], ['sea', 'Море']];
const LINKS = [['#hot', 'Горящие туры'], ['#plan', 'Подбор тура'], ['#contacts', 'Форма заявки'], ['#checklist', 'Чек-лист'], ['wa', 'WhatsApp менеджеру'], ['custom', 'Своя ссылка…']];
const FIELDS = {
  bar: [{ key: 'text', label: 'Текст', max: 90 }, { key: 'cta', label: 'Кнопка', max: 24, optional: true }],
  popup: [{ key: 'title', label: 'Заголовок', max: 40 }, { key: 'text', label: 'Текст', type: 'textarea', max: 180 }, { key: 'cta', label: 'Кнопка', max: 24 }],
};
export function promoState(p) {
  const now = Date.now();
  if (!p.active) return ['off', 'Выключен'];
  if (p.starts_at && new Date(p.starts_at) > now) return ['warn', 'Запланирован'];
  if (p.ends_at && new Date(p.ends_at) <= now) return ['off', 'Завершён'];
  return ['ok', 'Показывается'];
}
export function promoPreview(p, lang) {
  const t = pickLang(p.i18n, lang);
  const code = p.coupon_code ? h('code', p.coupon_code) : null;
  const box = h('div.pv', h('div.pv__site'));
  if (p.kind === 'bar') box.prepend(h('div.pbar.th-' + p.theme, h('span', t.text || 'Текст баннера'), code, t.cta ? h('a', t.cta + ' →') : null, h('span', { style: { marginLeft: 'auto', opacity: .7 } }, '✕')));
  else box.append(h('div.ppop.th-' + p.theme, h('h4', t.title || 'Заголовок'), h('p', t.text || 'Текст поп-апа'), code ? h('p', 'Промокод: ', code) : null, h('span.cta', t.cta || 'Кнопка')));
  return box;
}

export default async function promosView(root, ctx, params) {
  const rg = ctx.range();
  let [rows, stats, campaigns, coupons] = await Promise.all([ctx.api.list('promos', 'created_at'), ctx.api.stats(rg.from, rg.to).catch(() => null), ctx.api.list('campaigns').catch(() => []), ctx.api.list('coupons', 'created_at').catch(() => [])]);
  const st = Object.fromEntries(((stats && stats.promos) || []).map((x) => [x.id, x]));
  const listBox = h('div.list');
  root.append(pageHead('Баннеры и поп-апы', 'Полоса над сайтом или окно с предложением. Можно показать только русскоязычным, только с телефона или только тем, кто пришёл с конкретной рекламы. Статистика — за выбранный период.',
    h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Новое промо')), listBox);

  function paint() {
    clear(listBox);
    const live = rows.filter((p) => promoState(p)[0] === 'ok');
    ['bar', 'popup'].forEach((k) => { const n = live.filter((p) => p.kind === k).length; if (n > 1) listBox.appendChild(h('div.note.note--warn', icon('alert'), h('span', `Одновременно включено ${n} ${k === 'bar' ? 'баннера' : 'поп-апа'} — посетитель увидит только первый подходящий по таргетингу.`))); });
    if (!rows.length) listBox.appendChild(h('div.card', h('div.empty', h('b', 'Промо пока нет'), 'Сделайте полосу с акцией — это 2 минуты')));
    rows.slice().sort((a, b) => promoState(a)[0] === 'ok' ? -1 : promoState(b)[0] === 'ok' ? 1 : 0).forEach((p) => {
      const [k, label] = promoState(p), s = st[p.id] || { views: 0, clicks: 0, closes: 0 };
      const a = p.audience || {};
      listBox.appendChild(h('div.item', { style: { cursor: 'pointer', alignItems: 'flex-start' }, onclick: (e) => { if (!e.target.closest('label,button')) edit(p); } },
        h('div.item__thumb.th-' + p.theme, { style: { display: 'grid', placeItems: 'center' } }, icon(p.kind === 'bar' ? 'menu' : 'megaphone')),
        h('div.item__main',
          h('div.row', h('b', p.name), h('span.badge.badge--' + k, label), h('span.tag', p.kind === 'bar' ? 'Полоса' : 'Поп-ап'), langDots(p.i18n, FIELDS[p.kind])),
          h('small', [
            (p.starts_at ? fmt.dt(p.starts_at) : 'сразу') + ' → ' + (p.ends_at ? fmt.dt(p.ends_at) : 'без срока'),
            a.langs && a.langs.length ? 'язык: ' + a.langs.join(', ').toUpperCase() : null,
            a.devices && a.devices.length ? a.devices.map((d) => ({ mobile: 'телефоны', desktop: 'компьютеры', tablet: 'планшеты' }[d])).join(', ') : null,
            a.utm_campaign ? 'только кампания ' + a.utm_campaign : null,
            p.coupon_code ? 'код ' + p.coupon_code : null,
          ].filter(Boolean).join(' · '))),
        h('div', { style: { textAlign: 'right', minWidth: '150px' } },
          h('div.num', h('b', fmt.num(s.views)), h('span.muted', ' показов · '), h('b', fmt.num(s.clicks)), h('span.muted', ' кликов')),
          h('div.muted.num', { style: { fontSize: '12.5px' } }, 'CTR ' + fmt.pct(s.views ? s.clicks / s.views : null, 1) + (s.closes ? ' · закрыли ' + fmt.pct(s.closes / s.views, 0) : ''))),
        toggle(p.active, null, async (on, el) => { try { const u = await ctx.api.save('promos', { ...p, active: on }); Object.assign(p, u); toast(on ? 'Включено' : 'Выключено'); paint(); } catch (e) { el.checked = !on; ctx.err(e); } })));
    });
  }

  function edit(p) {
    const d = { kind: 'bar', theme: 'brand', name: '', i18n: {}, link: '#hot', coupon_code: null, active: false, starts_at: null, ends_at: null, audience: { langs: [], devices: [], frequency: 'session', delay_s: 6, trigger: 'delay' }, ...JSON.parse(JSON.stringify(p)) };
    d.audience = { langs: [], devices: [], frequency: 'session', delay_s: 6, trigger: 'delay', ...d.audience };
    let pvLang = 'ru';
    const pv = h('div'), editorBox = h('div'), popupOpts = h('div.stack');
    const paintPv = () => { mount(pv, h('div.langtabs', LANGS.map(([l, lab]) => h('button', { type: 'button', 'aria-pressed': String(l === pvLang), onclick: () => { pvLang = l; paintPv(); } }, lab))), promoPreview(d, pvLang)); };
    const paintEditor = () => mount(editorBox, i18nEditor(d.i18n, FIELDS[d.kind], (v) => { d.i18n = v; paintPv(); }));
    const paintPopup = () => { popupOpts.hidden = d.kind !== 'popup'; };
    const customUrl = input(LINKS.some((l) => l[0] === d.link) || d.link === 'wa' ? '' : d.link, { placeholder: 'https://…', oninput: (v) => { d.link = v; } });
    const linkSel = select(LINKS, LINKS.some((l) => l[0] === d.link) ? d.link : (d.link && d.link.includes('wa.me') ? 'wa' : 'custom'), (v) => { customUrl.hidden = v !== 'custom'; d.link = v === 'custom' ? customUrl.value : v; });
    customUrl.hidden = linkSel.value !== 'custom';
    const dt = (v) => { if (!v) return ''; const x = new Date(v); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
    const swatches = h('div.swatches', THEMES.map(([k, l]) => h('button.swatch.th-' + k, { type: 'button', title: l, 'aria-label': l, 'aria-pressed': String(d.theme === k), onclick: (e) => { d.theme = k; $$('.swatch', swatches).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paintPv(); } })));
    drawer({
      title: p.id ? d.name : 'Новое промо', wide: true,
      body: () => h('div.grid2', { style: { alignItems: 'start', gap: '22px' } },
        h('div.stack',
          field('Название для себя', input(d.name, { placeholder: 'Осенние горящие туры', oninput: (v) => { d.name = v; } })),
          h('div.field', h('span', 'Формат'), seg([['bar', 'Полоса сверху'], ['popup', 'Поп-ап']], d.kind, (v) => { d.kind = v; paintEditor(); paintPv(); paintPopup(); })),
          h('div.field', h('span', 'Оформление'), swatches),
          editorBox,
          h('div.grid2', field('Кнопка ведёт', linkSel), field('Промокод', select([['', '— без кода —'], ...coupons.filter((c) => c.active).map((c) => [c.code, c.code + (c.discount_pct ? ' · −' + c.discount_pct + '%' : c.discount_amt ? ' · −$' + c.discount_amt : '')])], d.coupon_code || '', (v) => { d.coupon_code = v || null; paintPv(); }))),
          customUrl,
          h('div.section-t', 'Когда'),
          h('div.grid2', field('Начать', input(dt(d.starts_at), { type: 'datetime-local', oninput: (v) => { d.starts_at = v ? new Date(v).toISOString() : null; } }), 'Пусто — сразу'),
            field('Закончить', input(dt(d.ends_at), { type: 'datetime-local', oninput: (v) => { d.ends_at = v ? new Date(v).toISOString() : null; } }), 'Пусто — пока не выключите')),
          h('div.section-t', 'Кому показывать'),
          h('div.field', h('span', 'Язык сайта (пусто — всем)'), chipsPick(LANGS, d.audience.langs, (v) => { d.audience.langs = v; })),
          h('div.field', h('span', 'Устройство (пусто — всем)'), chipsPick([['mobile', 'Телефон'], ['tablet', 'Планшет'], ['desktop', 'Компьютер']], d.audience.devices, (v) => { d.audience.devices = v; })),
          field('Только пришедшим с кампании', select([['', 'Всем посетителям'], ...campaigns.map((c) => [c.utm_campaign, c.name + ' (' + c.utm_campaign + ')'])], d.audience.utm_campaign || '', (v) => { d.audience.utm_campaign = v || null; }), 'Лендинг под рекламу без отдельного сайта'),
          (paintPopup(), mount(popupOpts,
            h('div.grid2',
              field('Когда показать', select([['delay', 'Через N секунд'], ['scroll', 'После половины страницы'], ['exit', 'При попытке уйти (компьютер)']], d.audience.trigger, (v) => { d.audience.trigger = v; })),
              field('Задержка, сек', input(d.audience.delay_s, { type: 'number', attrs: { min: 0, max: 120 }, oninput: (v) => { d.audience.delay_s = Number(v) || 0; } }))),
            field('Как часто', select([['once', 'Один раз навсегда'], ['session', 'Раз за визит'], ['always', 'При каждом заходе']], d.audience.frequency, (v) => { d.audience.frequency = v; })))),
          toggle(d.active, 'Включено', (v) => { d.active = v; })),
        h('div.stack', { style: { position: 'sticky', top: 0 } }, h('div.section-t', 'Предпросмотр'), pv,
          h('button.btn', { onclick: () => {
            try { localStorage.setItem('sam-promo-preview', JSON.stringify({ ...d, id: d.id || 'preview' })); } catch (e) {}
            window.open('index.html?promo_preview=1' + (ctx.demo ? '&cms=demo' : '') + '&lang=' + pvLang, '_blank', 'noopener');
          } }, icon('eye'), 'Посмотреть на сайте'),
          h('small.muted', 'Откроется ваш сайт с этим промо — видите только вы, посетители его не увидят, пока оно не включено.'))),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        p.id ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить промо «' + d.name + '»?'))) return; try { await ctx.api.remove('promos', p.id); rows = rows.filter((x) => x.id !== p.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'), 'Удалить') : h('span'),
        h('div.btns', h('button.btn', { onclick: () => api.close() }, 'Отмена'), h('button.btn.btn--primary', { onclick: async () => {
          if (!d.name.trim()) { toast('Дайте промо название', 'bad'); return; }
          const t = pickLang(d.i18n, 'en'); if (!(t.text || t.title)) { toast('Заполните текст хотя бы на одном языке', 'bad'); return; }
          if (d.link === 'custom') d.link = customUrl.value;
          try { const u = await ctx.api.save('promos', d); if (p.id) Object.assign(p, u); else rows.unshift(u); toast('Сохранено'); api.close(); paint(); } catch (e) { ctx.err(e); }
        } }, 'Сохранить'))),
    });
    paintEditor(); paintPv();
  }
  paint();
  if (params[0] === 'new') edit({});
}
