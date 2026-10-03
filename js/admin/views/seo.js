// SEO & sharing: title/description per language with a Google snippet and a
// social-card preview; analytics IDs (GA4, Meta Pixel) without touching code.
import { h, mount, icon, toast, field, input, textarea, pageHead, card, LANGS } from '../ui.js';

const LIM = { title: [30, 60], description: [70, 160] };
const HOST = { en: 'samtravel.am', ru: 'samtravel.am › ?lang=ru', hy: 'samtravel.am › ?lang=hy' };

export default async function seoView(root, ctx) {
  const settings = await ctx.settings();
  const seo = JSON.parse(JSON.stringify(settings.seo || {}));
  const an = { ga4: '', pixel: '', ...(settings.analytics || {}) };
  LANGS.forEach(([l]) => { seo[l] = { title: '', description: '', ...(seo[l] || {}) }; });
  let lang = 'ru';

  root.append(pageHead('SEO и пиксели', 'Как сайт выглядит в Google и когда ссылку присылают в WhatsApp, Telegram, Facebook. Пустой язык берёт английский текст — лучше заполнить все три.'));
  const g = h('div.dash'); root.append(g);
  const edBox = h('div'), pvBox = h('div.stack');
  const tabs = h('div.langtabs');
  function paintTabs() {
    mount(tabs, LANGS.map(([l, lab]) => h('button', { type: 'button', 'aria-pressed': String(l === lang), onclick: () => { lang = l; paintTabs(); paintEd(); paintPv(); } },
      h('i', { class: seo[l].title && seo[l].description ? '' : 'is-missing' }), lab)));
  }
  function counter(k, v) {
    const [lo, hi] = LIM[k], n = v.length;
    return h('span.counter', { class: n > hi ? 'is-over' : n >= lo ? 'is-good' : '' }, n + ' / ' + hi);
  }
  function paintEd() {
    const s = seo[lang];
    const tCnt = h('span'), dCnt = h('span');
    const ti = input(s.title, { oninput: (v) => { s.title = v; mount(tCnt, counter('title', v)); paintPv(); paintTabs(); } });
    const de = textarea(s.description, { rows: 4, oninput: (v) => { s.description = v; mount(dCnt, counter('description', v)); paintPv(); paintTabs(); } });
    mount(tCnt, counter('title', s.title)); mount(dCnt, counter('description', s.description));
    mount(edBox, h('div.stack',
      field('Заголовок (title)', ti, 'Главное — в начало: что, где. Google обрежет после ~60 символов.', tCnt),
      field('Описание (description)', de, 'Одно-два предложения с выгодой и призывом. 120–160 символов.', dCnt),
      checks(s)));
  }
  function checks(s) {
    const key = { ru: /ереван/i, hy: /երևան/i, en: /yerevan/i }[lang];
    const list = [
      [s.title.length >= LIM.title[0] && s.title.length <= LIM.title[1], 'Длина заголовка 30–60 символов'],
      [s.description.length >= LIM.description[0] && s.description.length <= LIM.description[1], 'Длина описания 70–160 символов'],
      [key.test(s.title + ' ' + s.description), 'Упомянут город — люди ищут «турагентство Ереван»'],
      [/sam travel/i.test(s.title), 'В заголовке есть название агентства'],
      [s.title !== (seo.en.title) || lang === 'en', 'Текст переведён, а не скопирован с английского'],
    ];
    return h('div', list.map(([ok, t]) => h('div.row', { style: { gap: '8px', fontSize: '13px', padding: '3px 0' } }, h('span', { style: { color: ok ? 'var(--ok)' : 'var(--ink-3)' } }, ok ? '✓' : '○'), t)));
  }
  function paintPv() {
    const s = seo[lang], en = seo.en;
    const t = s.title || en.title, d = s.description || en.description;
    mount(pvBox,
      h('div.section-t', 'Так вас видят в Google'),
      h('div.serp', h('div.serp__url', h('i'), h('div', h('div', { style: { color: '#202124' } }, 'SAM TRAVEL'), HOST[lang])),
        h('div.serp__t', cut(t, 60)), h('div.serp__d', cut(d, 160))),
      h('div.section-t', 'Так выглядит ссылка в мессенджерах'),
      h('div.og', h('img', { src: 'og-image.jpg', alt: '' }), h('div.og__b', h('small', 'samtravel.am'), h('b', cut(t, 70)), h('p', cut(d, 110)))));
  }
  paintTabs(); paintEd(); paintPv();
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Тексты для поиска'))), tabs, edBox,
    h('div.btns', { style: { marginTop: '16px' } }, h('button.btn.btn--primary', { onclick: async () => { try { await ctx.api.saveSetting('seo', seo); ctx.cache.settings.seo = seo; toast('SEO сохранено — сайт подхватит при следующем открытии'); } catch (e) { ctx.err(e); } } }, 'Сохранить'))),
    h('section.card.c6', pvBox));

  // analytics IDs
  const gaOk = (v) => !v || /^G-[A-Z0-9]{6,12}$/.test(v), pxOk = (v) => !v || /^\d{10,20}$/.test(v);
  const gaIn = input(an.ga4, { placeholder: 'G-XXXXXXXXXX', oninput: (v) => { an.ga4 = v.trim().toUpperCase(); gaIn.classList.toggle('is-bad', !gaOk(an.ga4)); } });
  const pxIn = input(an.pixel, { placeholder: '123456789012345', oninput: (v) => { an.pixel = v.trim(); pxIn.classList.toggle('is-bad', !pxOk(an.pixel)); } });
  g.append(h('section.card.c12', h('div.card__h', h('div', h('h3', 'Google Analytics и Meta Pixel'), h('p', 'Вставьте ID — трекеры начнут работать у тех, кто нажал «Принять» в баннере cookie. Код сайта трогать не нужно.'))),
    h('div.grid2',
      field('GA4 Measurement ID', gaIn, 'Google Analytics → Администратор → Потоки данных → ваш сайт'),
      field('Meta Pixel ID', pxIn, 'Meta Events Manager → Источники данных → ваш пиксель')),
    h('div.note', { style: { marginTop: '14px' } }, icon('shield'), h('span', 'Собственная аналитика панели (раздел «Трафик и конверсии») работает всегда и без cookie. GA4 и Pixel нужны для рекламных кабинетов: ретаргетинг, оптимизация кампаний по заявкам.')),
    h('div.btns', { style: { marginTop: '14px' } }, h('button.btn.btn--primary', { onclick: async () => {
      if (!gaOk(an.ga4) || !pxOk(an.pixel)) { toast('Проверьте формат ID', 'bad'); return; }
      try { await ctx.api.saveSetting('analytics', an); ctx.cache.settings.analytics = an; toast('ID сохранены'); } catch (e) { ctx.err(e); }
    } }, 'Сохранить ID'))));
}
const cut = (s, n) => !s ? '' : s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
