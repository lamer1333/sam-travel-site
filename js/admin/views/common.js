// Helpers shared by several views.
import { yv, ymd, median } from '../metrics.js';

export { yv, ymd, median };   // Asia/Yerevan (UTC+4)
/** a sale date picked in a form → timestamp: today keeps the real time, a past day lands at noon in Yerevan */
export const saleIso = (day) => day === ymd(Date.now()) ? new Date().toISOString() : new Date(day + 'T12:00:00+04:00').toISOString();
export const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60e3;
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
export const inRange = (d, from, to) => { const t = new Date(d).getTime(); return t >= from.getTime() && t < to.getTime(); };

export function waLink(phone, text) {
  const d = String(phone || '').replace(/\D/g, '');
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}
export function fillTemplate(body, { name, tour, manager }) {
  return String(body || '')
    .replace(/\{name\}/g, (name || '').split(' ')[0] || '')
    .replace(/\{tour\}/g, tour ? ' (' + tour + ')' : '')
    .replace(/\{manager\}/g, (manager || '').split(' ')[0] || 'SAM TRAVEL');
}

let toursP = null;
export function loadTours(ctx, force) { if (force || !toursP) toursP = ctx.api.list('tours').then((r) => (ctx.cache.tours = r)).catch(() => (ctx.cache.tours = [])); return toursP; }
export function tourName(ctx, slug) {
  if (!slug) return null;
  const t = (ctx.cache.tours || []).find((x) => x.slug === slug);
  return (t && ((t.i18n.ru && t.i18n.ru.title) || (t.i18n.en && t.i18n.en.title))) || slug;
}
export const CHANNELS = {
  instagram: 'Instagram', facebook: 'Facebook', google: 'Google Ads', tiktok: 'TikTok', email: 'Email-рассылка',
  offline: 'Офлайн / QR', youtube: 'YouTube', influencer: 'Блогер', other: 'Другое',
};
export const SRC_NAME = { direct: 'Прямые заходы', 'google.com': 'Google (поиск)', 'instagram.com': 'Instagram (органика)', 'facebook.com': 'Facebook (органика)', 'yandex.ru': 'Яндекс', 'tripadvisor.com': 'Tripadvisor', instagram: 'Instagram (реклама)', facebook: 'Facebook (реклама)', google: 'Google Ads', newsletter: 'Email-рассылка', flyer: 'Флаеры / QR',
  // sales without a reference number — the source the owner picked, see lead_channel() in 070_whatsapp.sql
  'manual:phone': 'Звонок', 'manual:walk_in': 'Пришли в офис', 'manual:instagram': 'Instagram Direct', 'manual:manual': 'WhatsApp (без номера обращения)' };
export const srcName = (s) => SRC_NAME[s] || s;
export const SECTION_NAME = { 'band-prices': 'Первый экран', hot: 'Горящие туры', how: 'Как это работает', services: 'Услуги', about: 'О нас', reviews: 'Отзывы', blog: 'Рилсы', contacts: 'Контакты' };
export const CTA_NAME = { wa_click: 'Клик в WhatsApp', tel_click: 'Клик по телефону', mail_click: 'Клик по email', tour_open: 'Открыли тур', plan_open: 'Открыли «Подбор тура»', plan_send: 'Отправили подбор в WhatsApp', checklist_open: 'Открыли чек-лист', lang_switch: 'Сменили язык', auth_open: 'Открыли вход', promo_view: 'Показ промо', promo_click: 'Клик по промо', promo_close: 'Закрыли промо' };
export const DEVICE_NAME = { mobile: 'Телефон', desktop: 'Компьютер', tablet: 'Планшет', '?': 'Неизвестно' };
/** '1996-10-06' → '6 октября 1996'. A date of birth has no time zone: print the day as written. */
export const birthDate = (d) => d ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
/** where on the page a WhatsApp link was pressed (events.label) */
export const WA_PLACE = { sheet: 'описание тура', 'carou-stage': 'карточка тура', contacts_cta: 'блок контактов', contacts: 'блок контактов', services: 'услуги', b2b: 'услуги', topbar: 'шапка сайта', menu: 'меню', plan: 'подбор тура', 'c-send': 'чек-лист документов', top: 'общая кнопка' };
export const LANG_NAME = { ru: 'Русский', hy: 'Армянский', en: 'Английский', '?': '—' };

/** Downscale an image before upload: max 1600px, JPEG/WebP ~0.82 — keeps the site fast */
export function shrinkImage(file, max = 1600) {
  return new Promise((res) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return res(file);
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k === 1 && file.size < 400e3) { URL.revokeObjectURL(url); return res(file); }
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { URL.revokeObjectURL(url); res(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' }) : file); }, 'image/webp', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}
