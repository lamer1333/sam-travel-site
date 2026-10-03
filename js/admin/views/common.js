// Helpers shared by several views.
import { h, fmt } from '../ui.js';

export const yv = (d) => new Date(new Date(d).getTime() + 4 * 3600e3);          // Asia/Yerevan (UTC+4)
export const ymd = (d) => yv(d).toISOString().slice(0, 10);
export const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60e3;
export function median(arr) { const a = arr.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
export const inRange = (d, from, to) => { const t = new Date(d).getTime(); return t >= from.getTime() && t < to.getTime(); };

export function inWorkingHours(d, hours) {
  if (!hours) return true;
  const y = yv(d), dow = y.getUTCDay() || 7, hm = y.getUTCHours() * 60 + y.getUTCMinutes();
  const [fh, fm] = (hours.from || '10:00').split(':').map(Number), [th, tm] = (hours.to || '19:00').split(':').map(Number);
  return (hours.days || [1, 2, 3, 4, 5, 6]).includes(dow) && hm >= fh * 60 + fm && hm < th * 60 + tm;
}

/** SLA badge for a lead: waiting time for a new one, answer time otherwise */
export function slaBadge(l, slaMin = 60) {
  if (l.status === 'new') {
    const w = minutesBetween(l.created_at, Date.now());
    const cls = w > slaMin ? 'bad' : w > slaMin * 0.6 ? 'warn' : 'ok';
    return h('span.sla.sla--' + cls, { title: 'Ждёт ответа' }, 'ждёт ' + fmt.dur(w));
  }
  if (l.first_response_at) {
    const r = minutesBetween(l.created_at, l.first_response_at);
    return h('span.sla.sla--' + (r <= slaMin ? 'ok' : 'warn'), { title: 'Время первого ответа' }, 'ответ ' + fmt.dur(r));
  }
  return null;
}

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
  instagram: 'Instagram', facebook: 'Facebook', google: 'Google Ads', tiktok: 'TikTok', telegram: 'Telegram', email: 'Email-рассылка',
  offline: 'Офлайн / QR', youtube: 'YouTube', influencer: 'Блогер', other: 'Другое',
};
export const SRC_NAME = { direct: 'Прямые заходы', 'google.com': 'Google (поиск)', 'instagram.com': 'Instagram (органика)', 'facebook.com': 'Facebook (органика)', 'yandex.ru': 'Яндекс', 't.me': 'Telegram', 'tripadvisor.com': 'Tripadvisor', instagram: 'Instagram (реклама)', facebook: 'Facebook (реклама)', google: 'Google Ads', telegram: 'Telegram (посевы)', newsletter: 'Email-рассылка', flyer: 'Флаеры / QR' };
export const srcName = (s) => SRC_NAME[s] || s;
export const SECTION_NAME = { 'band-prices': 'Первый экран', hot: 'Горящие туры', how: 'Как это работает', services: 'Услуги', about: 'О нас', reviews: 'Отзывы', blog: 'Рилсы', contacts: 'Контакты и форма' };
export const CTA_NAME = { wa_click: 'Клик в WhatsApp', tel_click: 'Клик по телефону', mail_click: 'Клик по email', tour_open: 'Открыли тур', plan_open: 'Открыли «Подбор тура»', plan_send: 'Отправили подбор в WhatsApp', checklist_open: 'Открыли чек-лист', form_start: 'Начали заполнять форму', lead_submit: 'Отправили форму', lang_switch: 'Сменили язык', auth_open: 'Открыли вход', promo_view: 'Показ промо', promo_click: 'Клик по промо', promo_close: 'Закрыли промо' };
export const DEVICE_NAME = { mobile: 'Телефон', desktop: 'Компьютер', tablet: 'Планшет', '?': 'Неизвестно' };
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
