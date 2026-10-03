// Site content: hot tours, reviews, team, reels, the numbers strip.
// Everything trilingual; the site falls back to its built-in copy for any
// block that has no published rows, so an empty table never blanks the page.
import { h, $$, mount, clear, icon, fmt, toast, drawer, confirmDlg, field, input, select, toggle, chipsPick, i18nEditor, langDots, sortable, stars, starsPick, pageHead, LANGS, pickLang, isFilled } from '../ui.js';
import { shrinkImage } from './common.js';

const TOUR_FIELDS = [
  { key: 'card_title', label: 'Заголовок карточки', max: 40, placeholder: 'Дубай · 5 ночей' },
  { key: 'card_text', label: 'Короткое описание', max: 90, type: 'textarea', rows: 2 },
  { key: 'season', label: 'Бейдж на фото', max: 18, placeholder: 'Ноябрь' },
  { key: 'dates', label: 'Даты', max: 24, placeholder: '3 – 8 ноя' },
  { key: 'title', label: 'Заголовок в подробностях', max: 40 },
  { key: 'meta', label: 'Подзаголовок', max: 40, placeholder: 'ОАЭ · круглый год' },
  { key: 'text', label: 'Рассказ о направлении', type: 'textarea', rows: 4, max: 320 },
  { key: 'inc', label: 'Что входит', type: 'list' },
];
const GRADIENTS = ['p-sea', 'p-desert', 'p-lagoon', 'p-snow', 'p-island', 'p-jungle', 'p-ocean', 'p-city'];
const TAGS = [['beach', 'Пляж'], ['city', 'Город'], ['nature', 'Природа'], ['family', 'Семейный']];

export default async function contentView(root, ctx, params, route) {
  const base = route;   // 'content' or 'm/content'
  const TABS = [['tours', 'Горящие туры'], ['reviews', 'Отзывы'], ctx.can('owner') ? ['team', 'Команда'] : null, ['reels', 'Рилсы'], ['numbers', 'Цифры']].filter(Boolean);
  const tab = TABS.some((t) => t[0] === params[0]) ? params[0] : 'tours';
  root.append(pageHead('Контент сайта', 'Изменения появляются на сайте сразу после сохранения. Если в блоке нет ни одной опубликованной записи — сайт показывает свой исходный текст.',
    h('a.btn', { href: ctx.demo ? 'index.html?cms=demo' : 'index.html', target: '_blank', rel: 'noopener' }, icon('external'), 'Открыть сайт')));
  root.append(h('div.tabs', { role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => ctx.go(base + '/' + k) }, l))));
  const box = h('div'); root.append(box);
  await ({ tours, reviews, team, reels, numbers }[tab])(box, ctx, params[1] === 'new');
}

// ---------- photo picker ----------
function photoPicker(ctx, url, gradient, onchange) {
  const wrap = h('div.stack', { style: { gap: '8px' } });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  function paint() {
    clear(wrap);
    wrap.append(h('div.item__thumb' + (url ? '' : '.' + (gradient || 'p-sea')), { style: { width: '100%', height: '120px', borderRadius: '12px', backgroundImage: url ? `url("${url}")` : '' } }),
      h('div.btns', h('button.btn.btn--sm', { type: 'button', onclick: () => file.click() }, icon('upload'), url ? 'Заменить фото' : 'Загрузить фото'),
        url ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { url = null; onchange(null); paint(); } }, 'Убрать') : null), file);
  }
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 15e6) { toast('Файл больше 15 МБ', 'bad'); return; }
    const t = toast('Загружаем…', '', { ms: 20000 });
    try { url = await ctx.api.upload(await shrinkImage(f), 'content'); onchange(url); paint(); t.remove(); toast('Фото загружено'); }
    catch (e) { t.remove(); ctx.err(e); }
  });
  paint(); return wrap;
}

// ---------- tours ----------
async function tours(box, ctx, isNew) {
  let rows = await ctx.api.list('tours');
  const list = h('div.list');
  const today = new Date().toISOString().slice(0, 10);
  box.append(h('div.toolbar', h('span.muted', 'Порядок карточек в карусели — перетаскиванием. Выключенные туры — черновики.'), h('span', { style: { flex: 1 } }),
    h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Новый тур')), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('tours', ids); ids.forEach((id, i) => { rows.find((r) => r.id === id).sort = i; }); toast('Порядок сохранён'); } catch (e) { ctx.err(e); } });
  function paint() {
    clear(list);
    rows.slice().sort((a, b) => a.sort - b.sort).forEach((t) => {
      const ru = pickLang(t.i18n, 'ru'), expired = t.hot_until && t.hot_until < today;
      list.appendChild(h('div.item', { draggable: 'true', dataset: { id: t.id } },
        h('span.item__grip', { title: 'Перетащите' }, icon('grip')),
        h('div.item__thumb' + (t.photo_url ? '' : '.' + t.photo_class), { style: { backgroundImage: t.photo_url ? `url("${t.photo_url}")` : '' } }),
        h('div.item__main', { style: { cursor: 'pointer' }, onclick: () => edit(t) },
          h('b', ru.card_title || ru.title || t.slug),
          h('small', [ru.dates, ru.meta, t.price_from ? 'от ' + fmt.money(t.price_from, t.currency) : null].filter(Boolean).join(' · '))),
        expired ? h('span.badge.badge--off', 'скрыт с ' + fmt.date(t.hot_until)) : t.hot_until ? h('span.badge.badge--warn', 'до ' + fmt.day(t.hot_until)) : null,
        langDots(t.i18n, TOUR_FIELDS.slice(0, 4)),
        toggle(t.published, null, async (on, el) => { try { const u = await ctx.api.save('tours', { ...t, published: on }); Object.assign(t, u); toast(on ? 'Тур на сайте' : 'Тур скрыт'); paint(); } catch (e) { el.checked = !on; ctx.err(e); } })));
    });
    if (!rows.length) list.appendChild(h('div.card', h('div.empty', h('b', 'Туров нет'), 'Сайт показывает свои исходные карточки')));
  }
  function edit(t) {
    const d = { slug: '', published: false, photo_url: null, photo_class: 'p-sea', tags: [], price_from: null, currency: 'USD', hot_until: null, i18n: {}, ...JSON.parse(JSON.stringify(t)) };
    let lang = 'ru';
    const pv = h('div');
    function paintPv() {
      const c = pickLang(d.i18n, lang);
      mount(pv, h('div.langtabs', LANGS.map(([l, lab]) => h('button', { type: 'button', 'aria-pressed': String(l === lang), onclick: () => { lang = l; paintPv(); } }, lab))),
        h('div.tprev', h('div.tprev__ph' + (d.photo_url ? '' : '.' + d.photo_class), { style: { backgroundImage: d.photo_url ? `url("${d.photo_url}")` : '' } }, c.season ? h('span.tprev__season', c.season) : null),
          h('div.tprev__b', h('h4', c.card_title || 'Заголовок карточки'), h('p', c.card_text || 'Короткое описание'),
            h('div.tprev__f', h('span', c.dates || ''), h('b', d.price_from ? 'от ' + fmt.money(d.price_from, d.currency) : ({ ru: 'Узнать цену →', hy: 'Իմանալ գինը →', en: 'Ask for price →' }[lang]))))),
        h('div.card', { style: { marginTop: '14px' } }, h('small.muted', c.meta || ''), h('h3', { style: { margin: '2px 0 6px' } }, c.title || ''), h('p.dim', { style: { margin: '0 0 8px', fontSize: '13px' } }, c.text || ''),
          h('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '13px' } }, (c.inc || []).filter(Boolean).map((x) => h('li', x)))));
    }
    const grads = h('div.swatches', GRADIENTS.map((g) => h('button.swatch.' + g, { type: 'button', 'aria-label': g, 'aria-pressed': String(d.photo_class === g), onclick: (e) => { d.photo_class = g; $$('.swatch', grads).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paintPv(); } })));
    drawer({
      title: t.id ? (pickLang(t.i18n, 'ru').card_title || t.slug) : 'Новый тур', sub: 'Карточка в «Горящих турах» и окно с подробностями', wide: true,
      body: () => h('div.grid2', { style: { alignItems: 'start', gap: '22px' } },
        h('div.stack',
          h('div.grid2', field('Адрес (slug)', input(d.slug, { placeholder: 'dubai', oninput: (v) => { d.slug = v.toLowerCase().replace(/[^a-z0-9-]/g, ''); } }), 'Латиница, для аналитики и ссылок'),
            field('Цена «от», $', input(d.price_from ?? '', { type: 'number', placeholder: 'не показывать', oninput: (v) => { d.price_from = v === '' ? null : Number(v); paintPv(); } }))),
          h('div.grid2', field('Показывать до', input(d.hot_until || '', { type: 'date', oninput: (v) => { d.hot_until = v || null; } }), 'На следующий день тур сам уйдёт с сайта'),
            h('div.field', h('span', 'Опубликован'), toggle(d.published, 'Виден на сайте', (v) => { d.published = v; }))),
          h('div.field', h('span', 'Фото'), photoPicker(ctx, d.photo_url, d.photo_class, (u) => { d.photo_url = u; paintPv(); })),
          h('div.field', h('span', 'Фон, пока нет фото'), grads),
          h('div.field', h('span', 'Фильтры'), chipsPick(TAGS, d.tags, (v) => { d.tags = v; })),
          i18nEditor(d.i18n, TOUR_FIELDS, (v) => { d.i18n = v; paintPv(); })),
        h('div', { style: { position: 'sticky', top: 0 } }, h('div.section-t', 'Как это выглядит'), pv)),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        t.id ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить тур?', { sub: 'Можно просто выключить — он останется черновиком.' }))) return; try { await ctx.api.remove('tours', t.id); rows = rows.filter((x) => x.id !== t.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'), 'Удалить') : h('span'),
        h('div.btns', h('button.btn', { onclick: () => api.close() }, 'Отмена'), h('button.btn.btn--primary', { onclick: async () => {
          if (!/^[a-z0-9-]{2,40}$/.test(d.slug)) { toast('Адрес: 2–40 латинских букв, цифр или дефисов', 'bad'); return; }
          if (!isFilled(d.i18n.en, TOUR_FIELDS.slice(0, 1)) && !isFilled(d.i18n.ru, TOUR_FIELDS.slice(0, 1))) { toast('Заполните заголовок карточки', 'bad'); return; }
          const miss = LANGS.filter(([l]) => !isFilled(d.i18n[l], TOUR_FIELDS.slice(0, 4))).map(([, lab]) => lab);
          try {
            const u = await ctx.api.save('tours', { ...d, sort: d.sort ?? rows.length });
            if (t.id) Object.assign(t, u); else rows.push(u);
            toast(miss.length ? 'Сохранено. Не переведено: ' + miss.join(', ') + ' — там будет английский' : 'Сохранено'); api.close(); paint();
          } catch (e) { ctx.err(e); }
        } }, 'Сохранить'))),
    });
    paintPv();
  }
  paint();
  if (isNew) edit({});
}

// ---------- reviews ----------
const SRC = { direct: 'Напрямую', google: 'Google', instagram: 'Instagram', facebook: 'Facebook' };
async function reviews(box, ctx, isNew) {
  let rows = await ctx.api.list('reviews');
  const list = h('div.list');
  let filter = 'all';
  box.append(h('div.toolbar',
    h('div.seg', [['all', 'Все'], ['pending', 'На модерации'], ['live', 'На сайте']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === filter), onclick: (e) => { filter = k; $$('button', e.currentTarget.parentNode).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paint(); } }, l))),
    h('span', { style: { flex: 1 } }), h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Добавить отзыв')), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('reviews', ids); toast('Порядок сохранён'); } catch (e) { ctx.err(e); } });
  function paint() {
    clear(list);
    const data = rows.filter((r) => filter === 'all' || (filter === 'live' ? r.published : !r.published)).sort((a, b) => a.sort - b.sort);
    data.forEach((r) => {
      const text = pickLang(Object.fromEntries(Object.entries(r.body || {}).map(([k, v]) => [k, { t: v }])), 'ru').t || '';
      list.appendChild(h('div.item', { draggable: 'true', dataset: { id: r.id }, style: { alignItems: 'flex-start' } },
        h('span.item__grip', icon('grip')),
        h('div.item__main', { style: { cursor: 'pointer' }, onclick: () => edit(r) },
          h('div.row', h('b', r.author), stars(r.rating), h('span.tag', SRC[r.source] || r.source), r.featured ? h('span.badge.badge--warn.badge--plain', '★ первым') : null, langDots(Object.fromEntries(Object.entries(r.body || {}).map(([k, v]) => [k, { t: v }])), [{ key: 't' }])),
          h('small', r.trip || ''), h('div.dim', { style: { fontSize: '13px', marginTop: '4px', whiteSpace: 'normal' } }, text.length > 180 ? text.slice(0, 180) + '…' : text)),
        h('div.stack', { style: { gap: '6px', justifyItems: 'end' } },
          toggle(r.published, r.published ? 'На сайте' : 'Скрыт', async (on, el) => { try { const u = await ctx.api.save('reviews', { ...r, published: on }); Object.assign(r, u); paint(); } catch (e) { el.checked = !on; ctx.err(e); } }))));
    });
    if (!data.length) list.appendChild(h('div.card', h('div.empty', h('b', filter === 'pending' ? 'Модерировать нечего' : 'Отзывов нет'), rows.length ? '' : 'Пока нет ни одного опубликованного — сайт показывает шаблонные образцы. Добавьте настоящие отзывы клиентов.')));
  }
  function edit(r) {
    const d = { author: '', trip: '', rating: 5, source: 'direct', published: false, featured: false, photo_url: null, body: {}, ...JSON.parse(JSON.stringify(r)) };
    const asObj = Object.fromEntries(LANGS.map(([l]) => [l, { text: (d.body || {})[l] || '' }]));
    drawer({
      title: r.id ? r.author : 'Новый отзыв', sub: 'Копируйте из Google, Instagram или со слов клиента — с его разрешения',
      body: () => h('div.stack',
        h('div.grid2', field('Имя клиента', input(d.author, { placeholder: 'Гаяне и Тигран', oninput: (v) => { d.author = v; } })), field('Поездка', input(d.trip, { placeholder: 'Шарм-эль-Шейх · окт 2025', oninput: (v) => { d.trip = v; } }))),
        h('div.grid2', h('div.field', h('span', 'Оценка'), starsPick(d.rating, (v) => { d.rating = v; })), field('Откуда', select(Object.entries(SRC), d.source, (v) => { d.source = v; }))),
        i18nEditor(asObj, [{ key: 'text', label: 'Текст отзыва', type: 'textarea', rows: 5, max: 400 }], (v) => { d.body = Object.fromEntries(Object.entries(v).filter(([, x]) => x.text && x.text.trim()).map(([k, x]) => [k, x.text])); }),
        h('div.field', h('span', 'Фото клиента (по желанию)'), photoPicker(ctx, d.photo_url, 'p-city', (u) => { d.photo_url = u; })),
        h('div.row', toggle(d.published, 'Показывать на сайте', (v) => { d.published = v; }), toggle(d.featured, 'Показывать первым', (v) => { d.featured = v; }))),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        r.id ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить отзыв?'))) return; try { await ctx.api.remove('reviews', r.id); rows = rows.filter((x) => x.id !== r.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'), 'Удалить') : h('span'),
        h('div.btns', h('button.btn', { onclick: () => api.close() }, 'Отмена'), h('button.btn.btn--primary', { onclick: async () => {
          if (!d.author.trim() || !Object.keys(d.body).length) { toast('Нужны имя и текст', 'bad'); return; }
          try { const u = await ctx.api.save('reviews', d); if (r.id) Object.assign(r, u); else rows.push(u); toast('Сохранено'); api.close(); paint(); } catch (e) { ctx.err(e); }
        } }, 'Сохранить'))),
    });
  }
  paint();
  if (isNew) edit({});
}

// ---------- team ----------
async function team(box, ctx) {
  let rows = await ctx.api.list('team');
  const F = [{ key: 'name', label: 'Имя', max: 40 }, { key: 'role', label: 'Специализация и стаж', max: 50, placeholder: 'Пляжи и острова · 8 лет' }];
  const list = h('div.list');
  box.append(h('div.toolbar', h('span.muted', 'Менеджеры в блоке «О нас». Фото с лицом повышают доверие сильнее любых слов.'), h('span', { style: { flex: 1 } }), h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Добавить')), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('team', ids); toast('Порядок сохранён'); } catch (e) { ctx.err(e); } });
  function paint() {
    clear(list);
    rows.slice().sort((a, b) => a.sort - b.sort).forEach((m) => {
      const ru = pickLang(m.i18n, 'ru');
      list.appendChild(h('div.item', { draggable: 'true', dataset: { id: m.id } }, h('span.item__grip', icon('grip')),
        h('div.item__thumb' + (m.photo_url ? '' : '.p-city'), { style: { width: '44px', borderRadius: '50%', backgroundImage: m.photo_url ? `url("${m.photo_url}")` : '' } }),
        h('div.item__main', { style: { cursor: 'pointer' }, onclick: () => edit(m) }, h('b', ru.name || '—'), h('small', ru.role || '')),
        !m.photo_url ? h('span.badge.badge--warn', 'нет фото') : null, langDots(m.i18n, F),
        toggle(m.published, null, async (on, el) => { try { const u = await ctx.api.save('team', { ...m, published: on }); Object.assign(m, u); } catch (e) { el.checked = !on; ctx.err(e); } })));
    });
  }
  function edit(m) {
    const d = { i18n: {}, photo_url: null, whatsapp: '', published: true, ...JSON.parse(JSON.stringify(m)) };
    drawer({
      title: m.id ? pickLang(m.i18n, 'ru').name : 'Новый менеджер',
      body: () => h('div.stack', h('div.field', h('span', 'Фото'), photoPicker(ctx, d.photo_url, 'p-city', (u) => { d.photo_url = u; })),
        i18nEditor(d.i18n, F, (v) => { d.i18n = v; }),
        field('Личный WhatsApp (необязательно)', input(d.whatsapp, { placeholder: '37455957585', oninput: (v) => { d.whatsapp = v.replace(/\D/g, ''); } })),
        toggle(d.published, 'Показывать на сайте', (v) => { d.published = v; })),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        m.id ? h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Убрать из команды?'))) return; try { await ctx.api.remove('team', m.id); rows = rows.filter((x) => x.id !== m.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash')) : h('span'),
        h('button.btn.btn--primary', { onclick: async () => { try { const u = await ctx.api.save('team', d); if (m.id) Object.assign(m, u); else rows.push(u); toast('Сохранено'); api.close(); paint(); } catch (e) { ctx.err(e); } } }, 'Сохранить')),
    });
  }
  paint();
}

// ---------- reels ----------
const REEL_RE = /^https:\/\/(www\.)?instagram\.com\/(reel|p)\/[A-Za-z0-9_-]+\/?/;
async function reels(box, ctx) {
  let rows = await ctx.api.list('reels');
  const list = h('div.list');
  const inp = input('', { placeholder: 'https://www.instagram.com/reel/…', attrs: { type: 'url' } });
  const add = async () => {
    const url = inp.value.trim().split('?')[0];
    if (!REEL_RE.test(url)) { inp.classList.add('is-bad'); toast('Нужна ссылка на рилс: в Instagram → Поделиться → Копировать ссылку', 'bad'); return; }
    inp.classList.remove('is-bad');
    try { const u = await ctx.api.save('reels', { url: url.endsWith('/') ? url : url + '/', published: true, sort: rows.length }); rows.push(u); inp.value = ''; paint(); toast('Рилс добавлен'); } catch (e) { ctx.err(e); }
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  box.append(h('div.card', { style: { marginBottom: '14px' } }, h('div.row', { style: { flexWrap: 'nowrap' } }, inp, h('button.btn.btn--primary', { onclick: add }, icon('plus'), 'Добавить')),
    h('small.muted', 'На сайте три слота — показываются первые три опубликованных.')), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('reels', ids); toast('Порядок сохранён'); paint(); } catch (e) { ctx.err(e); } });
  function paint() {
    clear(list);
    let n = 0;
    rows.slice().sort((a, b) => a.sort - b.sort).forEach((r) => {
      const slot = r.published ? ++n : null;
      list.appendChild(h('div.item', { draggable: 'true', dataset: { id: r.id } }, h('span.item__grip', icon('grip')),
        h('div.item__thumb.p-jungle', { style: { display: 'grid', placeItems: 'center', color: '#fff' } }, icon('play')),
        h('div.item__main', h('b', r.url.replace(/^https:\/\/(www\.)?/, '')), h('small', slot && slot <= 3 ? 'Слот ' + slot + ' на сайте' : r.published ? 'Не влезает — на сайте 3 слота' : 'Скрыт')),
        h('a.btn.btn--ghost.btn--sm', { href: r.url, target: '_blank', rel: 'noopener', 'aria-label': 'Открыть' }, icon('external')),
        toggle(r.published, null, async (on, el) => { try { const u = await ctx.api.save('reels', { ...r, published: on }); Object.assign(r, u); paint(); } catch (e) { el.checked = !on; ctx.err(e); } }),
        h('button.btn.btn--ghost.btn--sm', { 'aria-label': 'Удалить', onclick: async () => { try { await ctx.api.remove('reels', r.id); rows = rows.filter((x) => x.id !== r.id); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'))));
    });
  }
  paint();
}

// ---------- numbers strip ----------
async function numbers(box, ctx) {
  const s = await ctx.settings();
  const d = { years: '', trips: '', destinations: '', travellers: '', ...(s.stats || {}) };
  const L = [['years', 'Лет в туризме'], ['trips', 'Поездок организовано'], ['destinations', 'Направлений'], ['travellers', 'Туристов отправлено']];
  const pv = h('div.kpis', { style: { gridTemplateColumns: 'repeat(4, 1fr)' } });
  const paintPv = () => mount(pv, L.map(([k, l]) => h('div.kpi', h('span.kpi__value', d[k] || '—'), h('span.kpi__label', l))));
  box.append(h('div.card', h('div.card__h', h('div', h('h3', 'Блок «В цифрах»'), h('p', 'Раздел «О нас». Пишите как на сайте: «500+», «3 000+».'))),
    h('div.grid2', L.map(([k, l]) => field(l, input(d[k], { oninput: (v) => { d[k] = v; paintPv(); } })))),
    h('div.section-t', 'Предпросмотр'), pv,
    h('div.btns', h('button.btn.btn--primary', { onclick: async () => { try { await ctx.api.saveSetting('stats', d); ctx.cache.settings.stats = d; toast('Цифры обновлены'); } catch (e) { ctx.err(e); } } }, 'Сохранить'))));
  paintPv();
}
