// Contacts & company details: one place, applied to every link on the site
// (header, menu, contacts block, footer, floating WhatsApp, structured data).
import { h, mount, icon, toast, field, input, chipsPick, pageHead, card, i18nEditor } from '../ui.js';

const SAMPLE = { licence: '23-1057-2023', insurance: 'TRV-2026-0412' };

export default async function contactsView(root, ctx) {
  const s = await ctx.settings();
  const c = { phone: '', whatsapp: '', email: '', address: {}, instagram: '', facebook: '', telegram: '', ...(s.contacts || {}) };
  const co = { legal_name: '', licence: '', insurance: '', currency: 'USD', margin_pct: 12, ...(s.company || {}) };
  const hr = { days: [1, 2, 3, 4, 5, 6], from: '10:00', to: '19:00', sla_min: 60, ...(s.hours || {}) };
  const save = async (key, val, msg) => { try { await ctx.api.saveSetting(key, val); ctx.cache.settings[key] = val; toast(msg || 'Сохранено — сайт обновится при следующем открытии'); } catch (e) { ctx.err(e); } };
  const bad = (el, ok) => { el.classList.toggle('is-bad', !ok); return ok; };

  root.append(pageHead('Контакты и реквизиты', 'Меняете здесь — меняется на всём сайте: шапка, меню, блок контактов, подвал, кнопка WhatsApp, данные для Google.'));
  const g = h('div.dash'); root.append(g);

  const wa = input(c.whatsapp, { placeholder: '37455957585', oninput: (v) => { c.whatsapp = v.replace(/\D/g, ''); bad(wa, /^\d{10,15}$/.test(c.whatsapp)); waTest.href = 'https://wa.me/' + c.whatsapp; } });
  const waTest = h('a.btn.btn--sm', { href: 'https://wa.me/' + c.whatsapp, target: '_blank', rel: 'noopener' }, icon('wa'), 'Проверить');
  const em = input(c.email, { type: 'email', oninput: (v) => { c.email = v.trim(); bad(em, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)); } });
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Как с вами связаться'))),
    h('div.stack',
      field('Телефон (как показывать)', input(c.phone, { placeholder: '+374 55 957585', oninput: (v) => { c.phone = v; } })),
      field('WhatsApp — номер цифрами, с кодом страны', h('div.row', { style: { flexWrap: 'nowrap' } }, wa, waTest), 'Сюда уходят все кнопки WhatsApp и заявки из «Подбора тура»'),
      field('Email', em),
      field('Instagram', input(c.instagram, { placeholder: 'https://www.instagram.com/…', oninput: (v) => { c.instagram = v.trim(); } })),
      field('Facebook', input(c.facebook, { oninput: (v) => { c.facebook = v.trim(); } })),
      field('Telegram (необязательно)', input(c.telegram, { placeholder: 'https://t.me/…', oninput: (v) => { c.telegram = v.trim(); } })),
      h('div.field', h('span', 'Адрес офиса'), i18nEditor(Object.fromEntries(['en', 'ru', 'hy'].map((l) => [l, { a: (c.address || {})[l] || '' }])), [{ key: 'a', label: 'Адрес' }], (v) => { c.address = Object.fromEntries(Object.entries(v).map(([l, x]) => [l, x.a])); })),
      h('div.btns', h('button.btn.btn--primary', { onclick: () => {
        if (!/^\d{10,15}$/.test(c.whatsapp)) { toast('WhatsApp: только цифры с кодом страны, например 37455957585', 'bad'); return; }
        save('contacts', c);
      } }, 'Сохранить контакты')))));

  const lic = input(co.licence, { oninput: (v) => { co.licence = v; } }), ins = input(co.insurance, { oninput: (v) => { co.insurance = v; } });
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Реквизиты'), h('p', 'Показываются в «О нас» и в подвале'))),
    co.licence === SAMPLE.licence || co.insurance === SAMPLE.insurance ? h('div.note.note--warn', { style: { marginBottom: '14px' } }, icon('alert'), h('span', 'Сейчас на сайте номера-образцы из макета. Замените на настоящие до запуска.')) : null,
    h('div.stack',
      field('Юридическое название', input(co.legal_name, { oninput: (v) => { co.legal_name = v; } })),
      field('Номер лицензии туроператора', lic), field('Номер страхового полиса (финансовая гарантия)', ins),
      h('div.grid2',
        field('Валюта в отчётах', input(co.currency, { placeholder: 'USD', oninput: (v) => { co.currency = v.toUpperCase().slice(0, 3); } }), 'USD, EUR, AMD, RUB'),
        field('Маржа агентства, %', input(co.margin_pct, { type: 'number', attrs: { min: 1, max: 100 }, oninput: (v) => { co.margin_pct = Math.max(1, Math.min(100, Number(v) || 12)); } }), 'Средняя комиссия с тура — для честного ROMI рекламы')),
      h('div.btns', h('button.btn.btn--primary', { onclick: () => save('company', co) }, 'Сохранить реквизиты')))));

  const days = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [7, 'Вс']];
  g.append(h('section.card.c12', h('div.card__h', h('div', h('h3', 'Рабочее время и скорость ответа'), h('p', 'На сайте обещано «ответим в течение часа в рабочие дни». По этим настройкам панель подсвечивает заявки, которые ждут слишком долго.'))),
    h('div.grid3',
      h('div.field', h('span', 'Рабочие дни'), chipsPick(days, hr.days, (v) => { hr.days = v.map(Number).sort(); })),
      h('div.grid2', field('С', input(hr.from, { type: 'time', oninput: (v) => { hr.from = v; } })), field('До', input(hr.to, { type: 'time', oninput: (v) => { hr.to = v; } }))),
      field('Ответить в течение, мин', input(hr.sla_min, { type: 'number', attrs: { min: 5, max: 1440 }, oninput: (v) => { hr.sla_min = Math.max(5, Number(v) || 60); } }))),
    h('div.btns', { style: { marginTop: '14px' } }, h('button.btn.btn--primary', { onclick: () => save('hours', hr, 'Рабочее время сохранено') }, 'Сохранить'))));
}
