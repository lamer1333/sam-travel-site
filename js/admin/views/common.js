// Helpers shared by several views.
import { h, fmt } from '../ui.js';
import { MANUAL_SOURCES } from '../main.js';
import { yv, ymd, median, slaOf, waitMinutes, responseMinutes } from '../metrics.js';

export { yv, ymd, median };   // Asia/Yerevan (UTC+4)
/** a sale date picked in a form → timestamp: today keeps the real time, a past day lands at noon in Yerevan */
export const saleIso = (day) => day === ymd(Date.now()) ? new Date().toISOString() : new Date(day + 'T12:00:00+04:00').toISOString();
export const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60e3;
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
export const inRange = (d, from, to) => { const t = new Date(d).getTime(); return t >= from.getTime() && t < to.getTime(); };

export function inWorkingHours(d, hours) {
  if (!hours) return true;
  const y = yv(d), dow = y.getUTCDay() || 7, hm = y.getUTCHours() * 60 + y.getUTCMinutes();
  const [fh, fm] = (hours.from || '10:00').split(':').map(Number), [th, tm] = (hours.to || '19:00').split(':').map(Number);
  return (hours.days || [1, 2, 3, 4, 5, 6]).includes(dow) && hm >= fh * 60 + fm && hm < th * 60 + tm;
}

/** SLA badge for a lead: waiting time for a new one, answer time otherwise — both in working hours (§5) */
export const isManual = (l) => MANUAL_SOURCES.includes(l.source);
export function slaBadge(l, hours) {
  const slaMin = slaOf(hours);
  if (l.status === 'new') {
    const w = waitMinutes(l, hours);
    const cls = w > slaMin ? 'bad' : w > slaMin * 0.6 ? 'warn' : 'ok';
    return h('span.sla.sla--' + cls, { title: 'Ждёт ответа — считается только рабочее время' }, 'ждёт ' + fmt.dur(w));
  }
  const r = responseMinutes(l, hours);
  if (r != null) return h('span.sla.sla--' + (r <= slaMin ? 'ok' : 'warn'), { title: 'Время первого ответа в рабочих часах' }, 'ответ ' + fmt.dur(r));
  return null;
}
/** new leads that have waited longer than the norm, in working minutes */
export const isOverdue = (l, hours) => l.status === 'new' && waitMinutes(l, hours) > slaOf(hours);

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
  // leads typed in by a manager — their own channels, see lead_channel() in 030_stats.sql
  'manual:phone': 'Звонок', 'manual:walk_in': 'Пришли в офис', 'manual:instagram': 'Instagram Direct', 'manual:manual': 'WhatsApp' };
export const srcName = (s) => SRC_NAME[s] || s;
export const SECTION_NAME = { 'band-prices': 'Первый экран', hot: 'Горящие туры', how: 'Как это работает', services: 'Услуги', about: 'О нас', reviews: 'Отзывы', blog: 'Рилсы', contacts: 'Контакты и форма' };
export const CTA_NAME = { wa_click: 'Клик в WhatsApp', tel_click: 'Клик по телефону', mail_click: 'Клик по email', tour_open: 'Открыли тур', plan_open: 'Открыли «Подбор тура»', plan_send: 'Отправили подбор в WhatsApp', checklist_open: 'Открыли чек-лист', form_start: 'Начали заполнять форму', lead_submit: 'Отправили форму', lang_switch: 'Сменили язык', auth_open: 'Открыли вход', promo_view: 'Показ промо', promo_click: 'Клик по промо', promo_close: 'Закрыли промо' };
export const DEVICE_NAME = { mobile: 'Телефон', desktop: 'Компьютер', tablet: 'Планшет', '?': 'Неизвестно' };
/** '1996-10-06' → '6 октября 1996'. A date of birth has no time zone: print the day as written. */
export const birthDate = (d) => d ? new Date(d.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—';
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
