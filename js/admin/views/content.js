// Site content: hot tours, reviews, team, reels, the numbers strip — what the SMM
// specialist changes (TZ-CONTENT.md §7–§9). The plates, icons and texts of the site
// itself are static and are not edited here.
// Everything trilingual. With no published tours the site shows one card «Спросите нас в
// WhatsApp»; with no reviews or team members it hides that block (AUDIT.md, решение 1).
import { h, $$, mount, clear, icon, fmt, toast, drawer, modal, confirmDlg, field, input, select, toggle, chipsPick, i18nEditor, langDots, sortable, stars, starsPick, pageHead, LANGS, pickLang } from '../ui.js';
import { FRAMES, frameHint, cropFile } from '../crop.js';
import { ymd } from './common.js';
import { addDays } from '../reminders.js';

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
/** the texts a tour cannot go without in a language: the card and the description */
const TOUR_MUST = ['card_title', 'card_text', 'title', 'text'];
const GRADIENTS = ['p-sea', 'p-desert', 'p-lagoon', 'p-snow', 'p-island', 'p-jungle', 'p-ocean', 'p-city'];
/** the tour type: a fixed list (tours_tags_known in 080_content.sql); the site prints it in the visitor's language (js/cms.js) */
export const TOUR_TYPES = [
  ['beach', { ru: 'Пляж', en: 'Beach', hy: 'Լողափ' }], ['city', { ru: 'Город', en: 'City', hy: 'Քաղաք' }],
  ['nature', { ru: 'Природа', en: 'Nature', hy: 'Բնություն' }], ['family', { ru: 'Семейный', en: 'Family', hy: 'Ընտանեկան' }],
];
const typeName = (k, l = 'ru') => { const t = TOUR_TYPES.find((x) => x[0] === k); return t ? t[1][l] || t[1].en : k; };

export default async function contentView(root, ctx, params, route) {
  const base = route;   // 'content' or 'm/content'
  const smm = ctx.role === 'content';
  const TABS = [['tours', 'Горящие туры'], ['reels', 'Рилсы'], ['reviews', 'Отзывы'], ctx.can('team_photos') ? ['team', 'Команда'] : null, smm ? null : ['numbers', 'Цифры']].filter(Boolean);
  const tab = TABS.some((t) => t[0] === params[0]) ? params[0] : 'tours';
  root.append(pageHead('Контент сайта', 'Изменения появляются на сайте сразу после сохранения. Нет ни одного опубликованного тура — на сайте вместо карусели одна карточка «Спросите нас в WhatsApp»; нет отзывов или сотрудников — этот блок на сайте скрыт.',
    h('a.btn', { href: ctx.demo ? 'index.html?cms=demo' : 'index.html', target: '_blank', rel: 'noopener' }, icon('external'), 'Открыть сайт')));
  root.append(sizesGuide());
  root.append(h('div.tabs', { role: 'tablist' }, TABS.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === tab), onclick: () => ctx.go(base + '/' + k) }, l))));
  const box = h('div'); root.append(box);
  await ({ tours, reviews, team, reels, numbers }[tab])(box, ctx, params[1] === 'new');
}

// ---------- «Размеры фото»: the table of TZ-CONTENT.md §8 with schemes ----------
function sizesGuide() {
  const KEY = 'sam-admin-sizes';
  let open = true; try { open = localStorage.getItem(KEY) !== '0'; } catch (e) {}
  const scheme = (key, w, hh, inner) => h('div.sizes__sch.sizes__sch--' + key, { style: { aspectRatio: w + ' / ' + hh }, 'aria-hidden': 'true' }, inner || null);
  const items = [
    [scheme('card', 2, 3, h('i', 'текст')), FRAMES.card],
    [scheme('hero', 16, 9), FRAMES.hero],
    [scheme('person', 3, 4), FRAMES.person],
    [scheme('avatar', 1, 1, h('i')), FRAMES.avatar],
    [scheme('reel', 9, 16, icon('play')), { place: 'Рилс', ratio: '9 : 16', shape: 'Вертикальное видео', what: 'Ссылка на рилс в Instagram — файл не загружается', w: 0 }],
  ];
  const el = h('details.card.sizes', { open },
    h('summary', icon('image'), h('b', 'Размеры фото'), h('span.muted', 'что куда загружать и какой формы')),
    h('p.sizes__lede', 'У каждого места на сайте своя форма. Снимайте и подбирайте кадры сразу под неё — при загрузке панель покажет рамку нужной формы, фото под ней можно сдвинуть и приблизить. Растянуть или сплющить фото нельзя.'),
    h('div.sizes__grid', items.map(([sch, f]) => h('div.sizes__it', h('div.sizes__box', sch),
      h('div', h('b', f.place), h('span.sizes__ratio', f.ratio + ' · ' + f.shape.toLowerCase()), h('small', f.what),
        h('small.muted', f.w ? `Не меньше ${f.w} × ${f.h}. Сохраняется как ${f.w} × ${f.h}` : 'Вставляется ссылкой'))))));
  el.addEventListener('toggle', () => { try { localStorage.setItem(KEY, el.open ? '1' : '0'); } catch (e) {} });
  return el;
}

// ---------- photos ----------
const bg = (ctx, url) => { const s = ctx.api.src(url); return s ? `url("${s}")` : ''; };
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

/**
 * The files of one open form. A photo goes to the storage the moment it is cropped, the row
 * is saved later — so the form remembers what it uploaded and cleans up after itself:
 *   saved     → the photos the row no longer points to are deleted (the replaced ones);
 *   cancelled → everything uploaded in this form is deleted.
 */
function photoSession(ctx, before) {
  let old = (before || []).filter(Boolean);
  const fresh = new Set();
  const drop = (urls) => (urls.length ? ctx.api.removeFiles(urls).catch((e) => console.warn('Не удалось удалить заменённое фото', e)) : Promise.resolve());
  return {
    async upload(file) { const u = await ctx.api.upload(file, 'content'); fresh.add(u); return u; },
    commit(now) { const keep = new Set((now || []).filter(Boolean)); const gone = [...new Set([...old, ...fresh])].filter((u) => !keep.has(u)); old = [...keep]; fresh.clear(); return drop(gone); },
    cancel() { const gone = [...fresh]; fresh.clear(); return drop(gone); },
  };
}

/** «Фото не подходит» — a refusal the person has time to read */
function explain(title, text) { modal({ title, sub: text, actions: [{ label: 'Понятно', kind: 'primary' }] }); }

/** file → crop dialogs for the frames → upload → { card: url, hero: url }, plus the frames the photo was too small for */
async function cropAndUpload(ctx, ses, file, frames) {
  let out;
  try { out = await cropFile(file, frames); } catch (e) { explain('Фото не подходит', e.message); return null; }
  if (!out) return null;
  const t = toast('Загружаем…', '', { ms: 30000 });
  try {
    const urls = {};
    for (const k of Object.keys(out.files)) urls[k] = await ses.upload(out.files[k]);
    t.remove();
    return { urls, skipped: out.skipped, w: out.w, h: out.h };
  } catch (e) { t.remove(); ctx.err(e); return null; }
}

/** one place for a photo: the thumb in its real shape, the hint with the size, upload / replace / remove */
function photoSlot(ctx, ses, f, url, onchange, { label, note } = {}) {
  const wrap = h('div.pslot.pslot--' + f.key);
  const file = h('input', { type: 'file', accept: ACCEPT, hidden: true, dataset: { frame: f.key } });
  function paint() {
    mount(wrap,
      h('div.pslot__frame', { style: { aspectRatio: f.w + ' / ' + f.h, backgroundImage: bg(ctx, url) } }, url ? null : h('span', f.ratio)),
      h('div.pslot__t', h('b', label || f.place), h('small', frameHint(f)), !url && note ? h('small.pslot__note', note) : null,
        h('div.btns', h('button.btn.btn--sm', { type: 'button', onclick: () => file.click() }, icon('upload'), url ? 'Заменить' : 'Загрузить'),
          url ? h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => { url = null; onchange(null); paint(); } }, 'Убрать') : null)),
      file);
  }
  file.addEventListener('change', async () => {
    const fl = file.files[0]; file.value = ''; if (!fl) return;
    const r = await cropAndUpload(ctx, ses, fl, [f]); if (!r) return;
    url = r.urls[f.key]; onchange(url); paint(); toast('Фото загружено');
  });
  wrap.setUrl = (u) => { url = u; paint(); };
  paint(); return wrap;
}

// ---------- languages: what is missing and what the visitor will see instead ----------
const LANG_RU = { en: ['английского', 'английской', 'английский'], ru: ['русского', 'русской', 'русский'], hy: ['армянского', 'армянской', 'армянский'] };
const LANG_LAB = Object.fromEntries(LANGS);
const filled = (v) => (Array.isArray(v) ? v.some((x) => x && String(x).trim()) : !!(v && String(v).trim()));
/** 'full' | 'part' | 'none' for every language of a tour */
function tourLangs(i18n) {
  return Object.fromEntries(LANGS.map(([l]) => {
    const o = (i18n || {})[l] || {}, n = TOUR_MUST.filter((k) => filled(o[k])).length;
    return [l, n === TOUR_MUST.length ? 'full' : n || TOUR_FIELDS.some((f) => filled(o[f.key])) ? 'part' : 'none'];
  }));
}
const reviewLangs = (body) => Object.fromEntries(LANGS.map(([l]) => [l, filled((body || {})[l]) ? 'full' : 'none']));
/** the site shows English when the visitor's language is empty, then Russian, then Armenian (js/cms.js) */
function fallbackOf(state, l) { return ['en', 'ru', 'hy'].find((x) => x !== l && state[x] !== 'none'); }
/** the lines of the warning before saving; empty when all three languages are complete */
function langWarnings(state) {
  return LANGS.map(([l]) => {
    if (state[l] === 'full') return null;
    const fb = fallbackOf(state, l); if (!fb) return null;
    const [gen, adj, nom] = LANG_RU[l];
    return state[l] === 'none'
      ? `Нет ${gen} текста — на ${adj} версии сайта покажется ${LANG_RU[fb][2]}.`
      : `${nom[0].toUpperCase() + nom.slice(1)} текст заполнен не полностью — пустые места на ${adj} версии сайта займёт ${LANG_RU[fb][2]}.`;
  }).filter(Boolean);
}
/** ask before saving a record with a language missing; true = save */
async function confirmLangs(state) {
  const w = langWarnings(state);
  return !w.length || confirmDlg(w.join(' ') + ' Сохранить всё равно?', { ok: 'Сохранить', danger: false, sub: 'Публиковать так можно. Перевод можно дописать позже — запись в списке будет с отметкой.' });
}
/** the mark in the list */
function langMark(state) {
  const none = LANGS.filter(([l]) => state[l] === 'none').map(([, lab]) => lab), part = LANGS.filter(([l]) => state[l] === 'part').map(([, lab]) => lab);
  if (!none.length && !part.length) return null;
  const text = [none.length ? 'нет перевода: ' + none.join(', ') : null, part.length ? 'не полностью: ' + part.join(', ') : null].filter(Boolean).join(' · ');
  return h('span.badge.badge--warn.badge--plain', { title: langWarnings(state).join(' ') }, text);
}

// ---------- history of a record and «Вернуть эту версию» ----------
const FIELD_NAME = { i18n: 'тексты', body: 'текст', photo_url: 'фото', photo_hero_url: 'фото шапки', photo_class: 'фон', price_from: 'цена', currency: 'валюта', tags: 'тип тура',
  hot_until: '«показывать до»', published: 'публикация', slug: 'адрес', author: 'имя', trip: 'поездка', rating: 'оценка', source: 'источник', featured: '«показывать первым»', whatsapp: 'WhatsApp', url: 'ссылка', sort: 'порядок' };
const NOT_A_CHANGE = ['updated_at', 'updated_by', 'created_at', 'id'];
function changedFields(prev, cur) {
  return Object.keys({ ...prev, ...cur }).filter((k) => !NOT_A_CHANGE.includes(k) && JSON.stringify((prev || {})[k] ?? null) !== JSON.stringify((cur || {})[k] ?? null)).map((k) => {
    if (k !== 'i18n' && k !== 'body') return FIELD_NAME[k] || k;
    const ls = LANGS.filter(([l]) => JSON.stringify(((prev || {})[k] || {})[l] ?? null) !== JSON.stringify(((cur || {})[k] || {})[l] ?? null)).map(([, lab]) => lab);
    return FIELD_NAME[k] + (ls.length ? ' (' + ls.join(', ') + ')' : '');
  });
}
/**
 * «История»: past versions with the date and the author, «Вернуть эту версию» on each.
 * The database decides who may return what (restore_version) and writes the return to the log.
 * onRestored(row, before) — the row as it became, and as it was a moment ago.
 */
async function historyDlg(ctx, table, row, title, describe, onRestored) {
  let list;
  try { list = await ctx.api.history(table, row.id); } catch (e) { ctx.err(e); return; }
  // reordering the list writes a line per row — not a version worth showing
  const vers = list.map((v, i) => ({ ...v, changed: list[i + 1] ? changedFields(list[i + 1].version, v.version) : null }))
    .filter((v, i) => i === 0 || !v.changed || !v.changed.length || v.changed.some((c) => c !== FIELD_NAME.sort));
  const m = modal({
    title: 'История: ' + title, wide: true,
    sub: 'Возвращаются тексты, фото, цена и остальные поля. Место в списке и «Опубликован» остаются как сейчас. Возврат — тоже правка: он попадает в журнал, и его можно вернуть так же.',
    body: () => (vers.length ? h('div.hist', vers.map((v, i) => h('div.hist__row',
      h('div.hist__main',
        h('b', fmt.dt(v.at)), h('span.muted', ' · ' + (v.actor_name || 'система')), i === 0 ? h('span.badge.badge--ok.badge--plain', { style: { marginLeft: '8px' } }, 'сейчас') : null,
        h('small', v.action === 'insert' || !v.changed ? (v.action === 'insert' ? 'Запись создана' : 'Правка') : v.changed.length ? 'Изменено: ' + v.changed.join(', ') : 'Сохранено без изменений'),
        h('small.muted', describe(v.version || {}))),
      i === 0 ? null : h('button.btn.btn--sm', { type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;   // gone from the event after the first await
        if (!(await confirmDlg('Вернуть версию от ' + fmt.dt(v.at) + '?', { ok: 'Вернуть', danger: false, sub: describe(v.version || {}) }))) return;
        btn.disabled = true;
        try {
          const before = JSON.parse(JSON.stringify(row));
          const r = await ctx.api.restore(v.id);
          toast(r.photo_kept ? 'Версия возвращена. Фото той версии уже удалено из хранилища — осталось нынешнее' : 'Версия возвращена', '', { ms: r.photo_kept ? 7000 : 3200 });
          m.close(); onRestored(r.row, before);
        } catch (x) { btn.disabled = false; ctx.err(x); }
      } }, icon('history'), 'Вернуть эту версию')))) : h('div.empty', h('b', 'Истории пока нет'), 'Она появится после первой правки')),
    actions: [{ label: 'Закрыть' }],
  });
}
/** after a return the row may point to other photos: the ones it left behind are deleted, like any replaced photo */
function dropLeftPhotos(ctx, before, now) {
  const keep = [now.photo_url, now.photo_hero_url].filter(Boolean);
  const gone = [before.photo_url, before.photo_hero_url].filter((u) => u && !keep.includes(u));
  if (gone.length) ctx.api.removeFiles(gone).catch((e) => console.warn('Не удалось удалить заменённое фото', e));
}
const historyBtn = (onclick) => h('button.btn.btn--ghost', { type: 'button', onclick }, icon('history'), 'История');

// ---------- tours ----------
const ASK = { ru: 'Узнать цену →', hy: 'Իմանալ գինը →', en: 'Ask for price →' };
/** a text of the tour in a language, or what the site would show instead (the same order as js/cms.js) */
const tourText = (i18n, l, k) => { const o = i18n || {}; for (const x of [l, 'en', 'ru', 'hy']) { const v = (o[x] || {})[k]; if (filled(v)) return v; } return k === 'inc' ? [] : ''; };

async function tours(box, ctx, isNew) {
  let rows = await ctx.api.list('tours');
  const list = h('div.list');
  const today = ymd(Date.now());   // «показывать до» is a Yerevan day
  box.append(h('div.toolbar', h('span.muted', 'Порядок карточек в карусели — перетаскиванием. Выключенные туры — черновики.'), h('span', { style: { flex: 1 } }),
    h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Новый тур')), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('tours', ids); ids.forEach((id, i) => { rows.find((r) => r.id === id).sort = i; }); toast('Порядок сохранён'); } catch (e) { ctx.err(e); } });
  function paint() {
    clear(list);
    rows.slice().sort((a, b) => a.sort - b.sort).forEach((t) => {
      const ru = pickLang(t.i18n, 'ru'), expired = t.hot_until && t.hot_until < today;
      list.appendChild(h('div.item', { draggable: 'true', dataset: { id: t.id } },
        h('span.item__grip', { title: 'Перетащите' }, icon('grip')),
        h('div.item__thumb.item__thumb--card' + (t.photo_url ? '' : '.' + t.photo_class), { style: { backgroundImage: bg(ctx, t.photo_url) } }),
        h('div.item__main', { style: { cursor: 'pointer' }, onclick: () => edit(t) },
          h('b', ru.card_title || ru.title || t.slug),
          h('small', [ru.dates, ru.meta, t.price_from ? 'от ' + fmt.money(t.price_from, t.currency) : null, (t.tags || []).map((k) => typeName(k)).join(', ') || null].filter(Boolean).join(' · '))),
        !t.photo_url ? h('span.badge.badge--warn.badge--plain', 'нет фото') : !t.photo_hero_url ? h('span.badge.badge--warn.badge--plain', { title: 'Сайт сам обрежет фото карточки под шапку описания' }, 'нет кадра шапки') : null,
        expired ? h('span.badge.badge--off', { title: 'Последний день показа — ' + fmt.date(t.hot_until) }, 'скрыт с ' + fmt.date(addDays(t.hot_until, 1))) : t.hot_until ? h('span.badge.badge--warn', 'до ' + fmt.day(t.hot_until)) : null,
        langMark(tourLangs(t.i18n)),
        toggle(t.published, null, async (on, el) => { try { const u = await ctx.api.save('tours', { ...t, published: on }); Object.assign(t, u); toast(on ? 'Тур на сайте' : 'Тур скрыт'); paint(); } catch (e) { el.checked = !on; ctx.err(e); } })));
    });
    if (!rows.length) list.appendChild(h('div.card', h('div.empty', h('b', 'Туров нет'), 'На сайте вместо карусели — одна карточка «Спросите нас в WhatsApp»')));
  }
  function edit(t) {
    const d = { slug: '', published: false, photo_url: null, photo_hero_url: null, photo_class: 'p-sea', tags: [], price_from: null, currency: 'USD', hot_until: null, i18n: {}, ...JSON.parse(JSON.stringify(t)) };
    const ses = photoSession(ctx, [t.photo_url, t.photo_hero_url]);
    let lang = 'ru', saved = false;
    const pv = h('div.pv');
    // the card and the head of the description as the visitor sees them: real shapes, the text over the photo
    function paintPv() {
      const T = (k) => tourText(d.i18n, lang, k);
      const card = bg(ctx, d.photo_url), hero = bg(ctx, d.photo_hero_url || d.photo_url);
      const types = (d.tags || []).length ? h('div.ttags', d.tags.map((k) => h('span', typeName(k, lang)))) : null;
      mount(pv, h('div.langtabs', LANGS.map(([l, lab]) => h('button', { type: 'button', 'aria-pressed': String(l === lang), onclick: () => { lang = l; paintPv(); } }, lab))),
        h('div.pv__cap', 'Карточка в карусели · 2 : 3'),
        h('div.tprev' + (card ? '' : '.' + d.photo_class), { style: { backgroundImage: card } },
          h('span.tprev__wa', { 'aria-hidden': 'true' }, icon('wa')), T('season') ? h('span.tprev__season', T('season')) : null,
          h('div.tprev__b', types, h('h4', T('card_title') || T('title') || 'Заголовок карточки'), h('p', T('card_text') || 'Короткое описание'),
            h('div.tprev__f', h('span', T('dates') || ''), h('b', d.price_from ? ({ ru: 'от ', en: 'from ', hy: '' }[lang]) + fmt.money(d.price_from, d.currency) + (lang === 'hy' ? '-ից' : '') + ' →' : ASK[lang])))),
        h('div.pv__cap', 'Шапка описания · 16 : 9', !d.photo_hero_url && d.photo_url ? h('span.pv__warn', ' — кадра нет, сайт обрежет фото карточки сам') : null),
        h('div.hprev', h('div.hprev__hero' + (hero ? '' : '.' + d.photo_class), { style: { backgroundImage: hero } }),
          h('div.hprev__b', h('small', T('meta') || ''), h('h4', T('title') || 'Заголовок в подробностях'), (d.tags || []).length ? h('div.ttags.ttags--ink', d.tags.map((k) => h('span', typeName(k, lang)))) : null,
            h('p', T('text') || 'Рассказ о направлении'), h('ul', (T('inc') || []).filter(Boolean).map((x) => h('li', x))))));
    }
    const grads = h('div.swatches', GRADIENTS.map((g) => h('button.swatch.' + g, { type: 'button', 'aria-label': g, 'aria-pressed': String(d.photo_class === g), onclick: (e) => { d.photo_class = g; $$('.swatch', grads).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paintPv(); } })));

    // one photo → two frames: the card (2 : 3) and the head of the description (16 : 9)
    const cardSlot = photoSlot(ctx, ses, FRAMES.card, d.photo_url, (u) => { d.photo_url = u; paintPv(); }, { label: 'Карточка' });
    const heroSlot = photoSlot(ctx, ses, FRAMES.hero, d.photo_hero_url, (u) => { d.photo_hero_url = u; paintPv(); }, { label: 'Шапка описания', note: 'Пока кадра нет, сайт обрезает фото карточки сам — по центру' });
    const both = h('input', { type: 'file', accept: ACCEPT, hidden: true, dataset: { frame: 'tour' } });
    both.addEventListener('change', async () => {
      const fl = both.files[0]; both.value = ''; if (!fl) return;
      const r = await cropAndUpload(ctx, ses, fl, [FRAMES.card, FRAMES.hero]); if (!r) return;
      if (r.urls.card) { d.photo_url = r.urls.card; cardSlot.setUrl(d.photo_url); }
      if (r.urls.hero) { d.photo_hero_url = r.urls.hero; heroSlot.setUrl(d.photo_hero_url); }
      paintPv();
      if (r.skipped.length) {
        const f = r.skipped[0], made = f.key === 'hero' ? 'Карточка готова' : 'Шапка описания готова';
        explain(made + ', второй кадр — нет', `Для места «${f.place}» это фото мало: оно ${r.w} × ${r.h}, а нужно не меньше ${f.w} × ${f.h} — на сайте кадр был бы мутным. Загрузите для него другое фото кнопкой у этого кадра.`);
      } else toast('Оба кадра загружены');
    });

    const dr = drawer({
      title: t.id ? (pickLang(t.i18n, 'ru').card_title || t.slug) : 'Новый тур', sub: 'Карточка в «Горящих турах» и окно с подробностями', wide: true,
      onClose: () => { if (!saved) ses.cancel(); },
      body: () => h('div.grid2.editgrid', { style: { alignItems: 'start', gap: '22px' } },
        h('div.stack',
          h('div.grid2', field('Адрес (slug)', input(d.slug, { placeholder: 'dubai', oninput: (v) => { d.slug = v.toLowerCase().replace(/[^a-z0-9-]/g, ''); } }), 'Латиница, для аналитики и ссылок'),
            field('Цена «от», $', input(d.price_from ?? '', { type: 'number', placeholder: 'не показывать', oninput: (v) => { d.price_from = v === '' ? null : Number(v); paintPv(); } }))),
          h('div.grid2', field('Показывать до', input(d.hot_until || '', { type: 'date', oninput: (v) => { d.hot_until = v || null; } }), 'На следующий день тур сам уйдёт с сайта'),
            h('div.field', h('span', 'Опубликован'), toggle(d.published, 'Виден на сайте', (v) => { d.published = v; }))),
          h('div.field', h('span', 'Фото тура'),
            h('div.pnote', h('div', h('b', 'Одно фото — два кадра.'), ' Выберите файл: сначала выставите рамку для карточки, потом для шапки описания. Подойдёт фото не меньше 1600 × 1620.'),
              h('button.btn.btn--primary', { type: 'button', onclick: () => both.click() }, icon('upload'), 'Загрузить фото'), both),
            h('div.pslots', cardSlot, heroSlot)),
          h('div.field', h('span', 'Фон, пока нет фото'), grads),
          h('div.field', h('span', 'Тип тура'), chipsPick(TOUR_TYPES.map(([k, n]) => [k, n.ru]), d.tags, (v) => { d.tags = TOUR_TYPES.map((x) => x[0]).filter((k) => v.includes(k)); paintPv(); }),
            h('small', 'Можно несколько. На сайте тип виден меткой на карточке и в описании, на языке посетителя')),
          i18nEditor(d.i18n, TOUR_FIELDS, (v) => { d.i18n = v; paintPv(); })),
        h('div.pvcol', h('div.section-t', 'Как это выглядит на сайте'), pv)),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        t.id ? h('div.btns', h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить тур?', { sub: 'Можно просто выключить — он останется черновиком. Удалённый тур вернёт только владелец из журнала.' }))) return; try { await ctx.api.remove('tours', t.id); rows = rows.filter((x) => x.id !== t.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'), 'Удалить'),
          historyBtn(() => historyDlg(ctx, 'tours', t, pickLang(t.i18n, 'ru').card_title || t.slug,
            (v) => [pickLang(v.i18n, 'ru').card_title || v.slug, v.price_from ? 'от ' + fmt.money(v.price_from, v.currency) : null, (v.tags || []).map((k) => typeName(k)).join(', ') || null, v.photo_url ? 'с фото' : 'без фото'].filter(Boolean).join(' · '),
            (row, before) => { Object.assign(t, row); dropLeftPhotos(ctx, before, row); api.close(); paint(); }))) : h('span'),
        h('div.btns', h('button.btn', { onclick: () => api.close() }, 'Отмена'), h('button.btn.btn--primary', { onclick: async () => {
          if (!/^[a-z0-9-]{2,40}$/.test(d.slug)) { toast('Адрес: 2–40 латинских букв, цифр или дефисов', 'bad'); return; }
          const st = tourLangs(d.i18n);
          if (!LANGS.some(([l]) => filled(((d.i18n || {})[l] || {}).card_title))) { toast('Заполните заголовок карточки хотя бы на одном языке', 'bad'); return; }
          if (!(await confirmLangs(st))) return;
          try {
            const u = await ctx.api.save('tours', { ...d, sort: d.sort ?? rows.length });
            saved = true; await ses.commit([u.photo_url, u.photo_hero_url]);
            if (t.id) Object.assign(t, u); else rows.push(u);
            toast('Сохранено'); api.close(); paint();
          } catch (e) { ctx.err(e); }
        } }, 'Сохранить'))),
    });
    paintPv();
    return dr;
  }
  paint();
  if (isNew) edit({});
}

// ---------- reviews ----------
const SRC = { direct: 'Напрямую', google: 'Google', instagram: 'Instagram', facebook: 'Facebook' };
const reviewText = (r) => { const b = r.body || {}; return b.ru || b.en || b.hy || ''; };
async function reviews(box, ctx, isNew) {
  let rows = await ctx.api.list('reviews');
  const list = h('div.list');
  let filter = 'all';
  box.append(h('div.toolbar',
    h('div.seg', [['all', 'Все'], ['pending', 'На модерации'], ['live', 'На сайте']].map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(k === filter), onclick: (e) => { filter = k; $$('button', e.currentTarget.parentNode).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); paint(); } }, l))),
    h('span', { style: { flex: 1 } }), h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Добавить отзыв')), list);
  // the order is kept in the rows too — otherwise the next repaint would put them back;
  // under a filter the list is partial, and dragging it would renumber the hidden rows wrongly
  sortable(list, async (ids) => { if (filter !== 'all') return; try { await ctx.api.reorder('reviews', ids); ids.forEach((id, i) => { const r = rows.find((x) => x.id === id); if (r) r.sort = i; }); toast('Порядок сохранён'); } catch (e) { ctx.err(e); paint(); } });
  function paint() {
    clear(list);
    const data = rows.filter((r) => filter === 'all' || (filter === 'live' ? r.published : !r.published)).sort((a, b) => a.sort - b.sort);
    const drag = filter === 'all';
    data.forEach((r) => {
      const text = reviewText(r);
      list.appendChild(h('div.item', { draggable: drag ? 'true' : null, dataset: { id: r.id }, style: { alignItems: 'flex-start' } },
        drag ? h('span.item__grip', { title: 'Перетащите' }, icon('grip')) : h('span.item__grip', { title: 'Порядок меняется во вкладке «Все»', style: { opacity: '.3', cursor: 'default' } }, icon('grip')),
        h('div.item__thumb.item__thumb--round' + (r.photo_url ? '' : '.p-city'), { style: { backgroundImage: bg(ctx, r.photo_url) } }),
        h('div.item__main', { style: { cursor: 'pointer' }, onclick: () => edit(r) },
          h('div.row', h('b', r.author), stars(r.rating), h('span.tag', SRC[r.source] || r.source), r.featured ? h('span.badge.badge--warn.badge--plain', '★ первым') : null, langMark(reviewLangs(r.body))),
          h('small', r.trip || ''), h('div.dim', { style: { fontSize: '13px', marginTop: '4px', whiteSpace: 'normal' } }, text.length > 180 ? text.slice(0, 180) + '…' : text)),
        h('div.stack', { style: { gap: '6px', justifyItems: 'end' } },
          toggle(r.published, r.published ? 'На сайте' : 'Скрыт', async (on, el) => { try { const u = await ctx.api.save('reviews', { ...r, published: on }); Object.assign(r, u); paint(); } catch (e) { el.checked = !on; ctx.err(e); } }))));
    });
    if (!data.length) list.appendChild(h('div.card', h('div.empty', h('b', filter === 'pending' ? 'Модерировать нечего' : 'Отзывов нет'), rows.length ? '' : 'Пока нет ни одного опубликованного — блок «Отзывы» на сайте скрыт. Добавьте настоящие отзывы клиентов.')));
  }
  function edit(r) {
    const d = { author: '', trip: '', rating: 5, source: 'direct', published: false, featured: false, photo_url: null, body: {}, ...JSON.parse(JSON.stringify(r)) };
    const asObj = Object.fromEntries(LANGS.map(([l]) => [l, { text: (d.body || {})[l] || '' }]));
    const ses = photoSession(ctx, [r.photo_url]);
    let saved = false;
    drawer({
      title: r.id ? r.author : 'Новый отзыв', sub: 'Копируйте из Google, Instagram или со слов клиента — с его разрешения',
      onClose: () => { if (!saved) ses.cancel(); },
      body: () => h('div.stack',
        h('div.grid2', field('Имя клиента', input(d.author, { placeholder: 'Гаяне и Тигран', oninput: (v) => { d.author = v; } })), field('Поездка', input(d.trip, { placeholder: 'Шарм-эль-Шейх · окт 2025', oninput: (v) => { d.trip = v; } }))),
        h('div.grid2', h('div.field', h('span', 'Оценка'), starsPick(d.rating, (v) => { d.rating = v; })), field('Откуда', select(Object.entries(SRC), d.source, (v) => { d.source = v; }))),
        i18nEditor(asObj, [{ key: 'text', label: 'Текст отзыва', type: 'textarea', rows: 5, max: 400 }], (v) => { d.body = Object.fromEntries(Object.entries(v).filter(([, x]) => x.text && x.text.trim()).map(([k, x]) => [k, x.text])); }),
        h('div.field', h('span', 'Фото клиента (по желанию)'), photoSlot(ctx, ses, FRAMES.avatar, d.photo_url, (u) => { d.photo_url = u; }, { label: 'Фото автора отзыва' })),
        h('div.row', toggle(d.published, 'Показывать на сайте', (v) => { d.published = v; }), toggle(d.featured, 'Показывать первым', (v) => { d.featured = v; }))),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        r.id ? h('div.btns', h('button.btn.btn--danger.btn--ghost', { onclick: async () => { if (!(await confirmDlg('Удалить отзыв?', { sub: 'Удалённый отзыв вернёт только владелец из журнала.' }))) return; try { await ctx.api.remove('reviews', r.id); rows = rows.filter((x) => x.id !== r.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'), 'Удалить'),
          historyBtn(() => historyDlg(ctx, 'reviews', r, r.author, (v) => { const t = reviewText(v); return [v.author, '★'.repeat(v.rating || 0), t.length > 90 ? t.slice(0, 90) + '…' : t].filter(Boolean).join(' · '); },
            (row, before) => { Object.assign(r, row); dropLeftPhotos(ctx, before, row); api.close(); paint(); }))) : h('span'),
        h('div.btns', h('button.btn', { onclick: () => api.close() }, 'Отмена'), h('button.btn.btn--primary', { onclick: async () => {
          if (!d.author.trim() || !Object.keys(d.body).length) { toast('Нужны имя и текст', 'bad'); return; }
          if (!(await confirmLangs(reviewLangs(d.body)))) return;
          try { const u = await ctx.api.save('reviews', { ...d, sort: d.sort ?? rows.length }); saved = true; await ses.commit([u.photo_url]); if (r.id) Object.assign(r, u); else rows.push(u); toast('Сохранено'); api.close(); paint(); } catch (e) { ctx.err(e); }
        } }, 'Сохранить'))),
    });
  }
  paint();
  if (isNew) edit({});
}

// ---------- team ----------
// The role «Контент» changes only the photo of a team member (AUDIT.md, «Решения заказчика» 2):
// it does not add or remove people, rename them, hide them or move them. The owner does all of it.
async function team(box, ctx) {
  let rows = await ctx.api.list('team');
  const full = ctx.can('team');
  const F = [{ key: 'name', label: 'Имя', max: 40 }, { key: 'role', label: 'Специализация и стаж', max: 50, placeholder: 'Пляжи и острова · 8 лет' }];
  const list = h('div.list');
  box.append(h('div.toolbar', h('span.muted', full ? 'Менеджеры в блоке «О нас». Фото с лицом повышают доверие сильнее любых слов.' : 'Менеджеры в блоке «О нас». Вы меняете фото; имя, должность и состав команды правит владелец.'), h('span', { style: { flex: 1 } }),
    full ? h('button.btn.btn--primary', { onclick: () => edit({}) }, icon('plus'), 'Добавить') : null), list);
  if (full) sortable(list, async (ids) => { try { await ctx.api.reorder('team', ids); ids.forEach((id, i) => { const r = rows.find((x) => x.id === id); if (r) r.sort = i; }); toast('Порядок сохранён'); } catch (e) { ctx.err(e); paint(); } });
  function paint() {
    clear(list);
    rows.slice().sort((a, b) => a.sort - b.sort).forEach((m) => {
      const ru = pickLang(m.i18n, 'ru');
      list.appendChild(h('div.item', { draggable: full ? 'true' : null, dataset: { id: m.id } }, full ? h('span.item__grip', { title: 'Перетащите' }, icon('grip')) : null,
        h('div.item__thumb.item__thumb--person' + (m.photo_url ? '' : '.p-city'), { style: { backgroundImage: bg(ctx, m.photo_url) } }),
        h('div.item__main', { style: { cursor: 'pointer' }, onclick: () => edit(m) }, h('b', ru.name || '—'), h('small', ru.role || '')),
        !m.photo_url ? h('span.badge.badge--warn', 'нет фото') : null, langDots(m.i18n, F),
        full ? toggle(m.published, null, async (on, el) => { try { const u = await ctx.api.save('team', { ...m, published: on }); Object.assign(m, u); } catch (e) { el.checked = !on; ctx.err(e); } })
          : h('span.badge.badge--plain' + (m.published ? '.badge--ok' : '.badge--off'), m.published ? 'на сайте' : 'скрыт')));
    });
    if (!rows.length) list.appendChild(h('div.card', h('div.empty', h('b', 'В команде никого'), 'Блок с фотографиями менеджеров на сайте скрыт')));
  }
  function edit(m) {
    const d = { i18n: {}, photo_url: null, whatsapp: '', published: true, ...JSON.parse(JSON.stringify(m)) };
    const ses = photoSession(ctx, [m.photo_url]);
    let saved = false;
    drawer({
      title: m.id ? pickLang(m.i18n, 'ru').name : 'Новый менеджер',
      sub: full ? null : pickLang(m.i18n, 'ru').role || null,
      onClose: () => { if (!saved) ses.cancel(); },
      body: () => h('div.stack', h('div.field', h('span', 'Фото'), photoSlot(ctx, ses, FRAMES.person, d.photo_url, (u) => { d.photo_url = u; }, { label: 'Фото сотрудника' })),
        full ? [i18nEditor(d.i18n, F, (v) => { d.i18n = v; }),
          field('Личный WhatsApp (необязательно)', input(d.whatsapp, { placeholder: '37455957585', oninput: (v) => { d.whatsapp = v.replace(/\D/g, ''); } })),
          toggle(d.published, 'Показывать на сайте', (v) => { d.published = v; })]
          : h('div.note', icon('shield'), h('span', 'Имя, должность, WhatsApp и показ на сайте меняет владелец.'))),
      footer: (api) => h('div.btns', { style: { width: '100%', justifyContent: 'space-between' } },
        m.id ? h('div.btns', full ? h('button.btn.btn--danger.btn--ghost', { 'aria-label': 'Убрать из команды', onclick: async () => { if (!(await confirmDlg('Убрать из команды?', { sub: 'Удалённую запись вернёт только владелец из журнала.' }))) return; try { await ctx.api.remove('team', m.id); rows = rows.filter((x) => x.id !== m.id); api.close(); paint(); } catch (e) { ctx.err(e); } } }, icon('trash')) : null,
          historyBtn(() => historyDlg(ctx, 'team', m, pickLang(m.i18n, 'ru').name || 'сотрудник', (v) => [pickLang(v.i18n, 'ru').name, pickLang(v.i18n, 'ru').role, v.photo_url ? 'с фото' : 'без фото'].filter(Boolean).join(' · '),
            (row, before) => { Object.assign(m, row); dropLeftPhotos(ctx, before, row); api.close(); paint(); }))) : h('span'),
        h('button.btn.btn--primary', { onclick: async () => {
          try {
            // the content role sends the row as it is with the new photo only
            const u = await ctx.api.save('team', full ? { ...d, sort: d.sort ?? rows.length } : { ...m, photo_url: d.photo_url });
            saved = true; await ses.commit([u.photo_url]); if (m.id) Object.assign(m, u); else rows.push(u); toast('Сохранено'); api.close(); paint();
          } catch (e) { ctx.err(e); }
        } }, 'Сохранить')),
    });
  }
  paint();
}

// ---------- reels ----------
/**
 * Whatever the person pasted → { url } in the one form the site and the database take
 * (https://www.instagram.com/reel/<id>/), or { error } saying what is wrong with the link.
 */
export function parseReel(raw) {
  const s = String(raw || '').trim();
  if (!s) return { error: 'Вставьте ссылку на рилс: в Instagram откройте рилс → «Поделиться» → «Копировать ссылку».' };
  let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return { error: 'Это не ссылка. Нужна ссылка вида https://www.instagram.com/reel/…' }; }
  if (!/^(www\.|m\.)?instagram\.com$/i.test(u.hostname)) return { error: 'Это ссылка не из Instagram. Свои видеофайлы и ролики с других сайтов не загружаются — только рилсы Instagram по ссылке.' };
  const m = /^\/(?:[A-Za-z0-9._]+\/)?(reels?|p)\/([A-Za-z0-9_-]{5,})\/?$/.exec(u.pathname);
  if (!m || m[2] === 'audio') return { error: 'Это ссылка на профиль, историю или подборку, а не на рилс. Откройте сам рилс → «Поделиться» → «Копировать ссылку».' };
  return { url: 'https://www.instagram.com/' + (m[1] === 'p' ? 'p' : 'reel') + '/' + m[2] + '/' };
}
const reelId = (url) => (/\/(?:reel|p)\/([A-Za-z0-9_-]+)/.exec(url || '') || [])[1] || '';

async function reels(box, ctx) {
  let rows = await ctx.api.list('reels');
  const list = h('div.list'), slots = h('div.reelslots');
  const inp = input('', { placeholder: 'https://www.instagram.com/reel/…', attrs: { type: 'url', 'aria-label': 'Ссылка на рилс' } });
  const msg = h('small.reel-msg', { role: 'status' });
  const say = (text, bad) => { msg.textContent = text || ''; msg.classList.toggle('is-bad', !!bad); inp.classList.toggle('is-bad', !!bad); };
  const check = () => {
    if (!inp.value.trim()) { say(''); return null; }
    const r = parseReel(inp.value);
    if (r.error) { say(r.error, true); return null; }
    if (rows.some((x) => reelId(x.url) === reelId(r.url))) { say('Этот рилс уже добавлен.', true); return null; }
    say('Ссылка на рилс — подходит: ' + r.url.replace('https://www.', ''));
    return r.url;
  };
  const add = async () => {
    const url = check();
    if (!url) { if (!inp.value.trim()) say(parseReel('').error, true); return; }
    try { const u = await ctx.api.save('reels', { url, published: true, sort: rows.length }); rows.push(u); inp.value = ''; say(''); paint(); toast('Рилс добавлен'); } catch (e) { ctx.err(e); }
  };
  inp.addEventListener('input', check);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  box.append(
    h('div.card', { style: { marginBottom: '14px' } }, h('div.card__h', h('div', h('h3', 'Три слота на сайте'), h('p', 'Раздел «Блог». Вертикальные, 9 : 16 — так они стоят на сайте, слева направо. Показываются первые три включённых рилса из списка ниже.'))), slots),
    h('div.card', { style: { marginBottom: '14px' } }, h('div.row', { style: { flexWrap: 'nowrap' } }, inp, h('button.btn.btn--primary', { onclick: add }, icon('plus'), 'Добавить')), msg,
      h('small.muted', { style: { display: 'block' } }, 'Видео — только рилсы по ссылке из Instagram, файл не загружается. Порядок — перетаскиванием.')), list);
  sortable(list, async (ids) => { try { await ctx.api.reorder('reels', ids); ids.forEach((id, i) => { rows.find((r) => r.id === id).sort = i; }); toast('Порядок сохранён'); paint(); } catch (e) { ctx.err(e); } });
  function paint() {
    clear(list);
    const sorted = rows.slice().sort((a, b) => a.sort - b.sort), live = sorted.filter((r) => r.published);
    mount(slots, [0, 1, 2].map((i) => {
      const r = live[i];
      return h('div.reelslot' + (r ? '.is-live' : ''), h('span.reelslot__n', String(i + 1)),
        r ? [icon('play'), h('b', reelId(r.url)), h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Открыть в Instagram')] : [h('b', 'Пусто'), h('small', 'На сайте здесь останется заглушка')]);
    }));
    let n = 0;
    sorted.forEach((r) => {
      const slot = r.published ? ++n : null;
      list.appendChild(h('div.item', { draggable: 'true', dataset: { id: r.id } }, h('span.item__grip', icon('grip')),
        h('div.item__thumb.item__thumb--reel.p-jungle', slot && slot <= 3 ? h('b', String(slot)) : icon('play')),
        h('div.item__main', h('b', r.url.replace(/^https:\/\/(www\.)?/, '')), h('small', slot && slot <= 3 ? 'Слот ' + slot + ' на сайте' : r.published ? 'Не влезает — на сайте 3 слота' : 'Скрыт')),
        h('a.btn.btn--ghost.btn--sm', { href: r.url, target: '_blank', rel: 'noopener', 'aria-label': 'Открыть' }, icon('external')),
        h('button.btn.btn--ghost.btn--sm', { 'aria-label': 'История', title: 'История', onclick: () => historyDlg(ctx, 'reels', r, reelId(r.url), (v) => (v.url || '').replace(/^https:\/\/(www\.)?/, ''), (row) => { Object.assign(r, row); paint(); }) }, icon('history')),
        toggle(r.published, null, async (on, el) => { try { const u = await ctx.api.save('reels', { ...r, published: on }); Object.assign(r, u); paint(); } catch (e) { el.checked = !on; ctx.err(e); } }),
        h('button.btn.btn--ghost.btn--sm', { 'aria-label': 'Удалить', onclick: async () => { if (!(await confirmDlg('Удалить рилс из списка?', { sub: 'Можно просто выключить — он останется в списке.' }))) return; try { await ctx.api.remove('reels', r.id); rows = rows.filter((x) => x.id !== r.id); paint(); } catch (e) { ctx.err(e); } } }, icon('trash'))));
    });
    if (!rows.length) list.appendChild(h('div.card', h('div.empty', h('b', 'Рилсов нет'), 'На сайте в блоке останутся заглушки')));
  }
  paint();
}

// ---------- numbers strip ----------
async function numbers(box, ctx) {
  const s = await ctx.settings();
  const d = { years: '', trips: '', destinations: '', travellers: '', ...(s.stats || {}) };
  const L = [['years', 'Лет в туризме'], ['trips', 'Поездок организовано'], ['destinations', 'Направлений'], ['travellers', 'Туристов отправлено']];
  const pv = h('div.kpis.kpis--plain');
  const paintPv = () => mount(pv, L.map(([k, l]) => h('div.kpi', h('span.kpi__value', d[k] || '—'), h('span.kpi__label', l))));
  box.append(h('div.card', h('div.card__h', h('div', h('h3', 'Блок «В цифрах»'), h('p', 'Раздел «О нас». Пишите как на сайте: «500+», «3 000+».'))),
    h('div.grid2', L.map(([k, l]) => field(l, input(d[k], { oninput: (v) => { d[k] = v; paintPv(); } })))),
    h('div.section-t', 'Предпросмотр'), pv,
    h('div.btns', h('button.btn.btn--primary', { onclick: async () => { try { await ctx.api.saveSetting('stats', d); ctx.cache.settings.stats = d; toast('Цифры обновлены'); } catch (e) { ctx.err(e); } } }, 'Сохранить'))));
  paintPv();
}
