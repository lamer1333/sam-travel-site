// Contacts & company details: one place, applied to every link on the site
// (header, menu, contacts block, footer, floating WhatsApp, structured data).
import { h, icon, toast, field, input, select, toggle, pageHead, i18nEditor, setCurrency } from '../ui.js';
import { waSettings } from '../reminders.js';

const SAMPLE = { licence: '23-1057-2023', insurance: 'TRV-2026-0412' };

export default async function contactsView(root, ctx) {
  const s = await ctx.settings();
  const c = { phone: '', whatsapp: '', email: '', address: {}, instagram: '', facebook: '', telegram: '', ...(s.contacts || {}) };
  const co = { legal_name: '', licence: '', insurance: '', currency: 'USD', margin_pct: 10, ...(s.company || {}) };
  /** true when the database took the value */
  const save = async (key, val, msg) => { try { await ctx.api.saveSetting(key, val); ctx.cache.settings[key] = val; toast(msg || 'Сохранено — сайт обновится при следующем открытии'); return true; } catch (e) { ctx.err(e); return false; } };
  const bad = (el, ok) => { el.classList.toggle('is-bad', !ok); return ok; };

  root.append(pageHead('Контакты и реквизиты', 'Меняете здесь — меняется на всём сайте: шапка, меню, блок контактов, подвал, кнопка WhatsApp, данные для Google.'));
  const g = h('div.dash'); root.append(g);

  const wa = input(c.whatsapp, { placeholder: '37455957585', oninput: (v) => { c.whatsapp = v.replace(/\D/g, ''); bad(wa, /^\d{10,15}$/.test(c.whatsapp)); waTest.href = 'https://wa.me/' + c.whatsapp; } });
  const waTest = h('a.btn.btn--sm', { href: 'https://wa.me/' + c.whatsapp, target: '_blank', rel: 'noopener' }, icon('wa'), 'Проверить');
  const em = input(c.email, { type: 'email', oninput: (v) => { c.email = v.trim(); bad(em, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)); } });
  g.append(h('section.card.c6', h('div.card__h', h('div', h('h3', 'Как с вами связаться'))),
    h('div.stack',
      field('Телефон (как показывать)', input(c.phone, { placeholder: '+374 55 957585', oninput: (v) => { c.phone = v; } })),
      field('WhatsApp — номер цифрами, с кодом страны', h('div.row', { style: { flexWrap: 'nowrap' } }, wa, waTest), 'Сюда ведут все кнопки сайта: клиент пишет вам сам, сообщение уже набрано'),
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
        field('Валюта панели', select(Array.from(new Set(['USD', 'EUR', 'AMD', 'RUB', co.currency])), co.currency, (v) => { co.currency = v; }), 'В ней вносятся продажи и считаются отчёты. Уже введённые суммы не пересчитываются'),
        field('Маржа агентства, %', input(co.margin_pct, { type: 'number', attrs: { min: 1, max: 100 }, oninput: (v) => { co.margin_pct = Math.max(1, Math.min(100, Number(v) || 10)); } }), 'Средняя комиссия с тура — для честного ROMI рекламы')),
      h('div.btns', h('button.btn.btn--primary', { onclick: () => save('company', co).then((ok) => { if (ok) setCurrency(co.currency); }) }, 'Сохранить реквизиты')))));

  // Flight reminders (TZ-BACKEND.md §4.12). The system prepares the list and the text; the
  // message is sent by a person. «Отправлять автоматически» is shown but locked: it needs the
  // paid WhatsApp Business Platform, and the database refuses the mode until then.
  const w = waSettings(s);
  const rv = input(w.review_url, { type: 'url', placeholder: 'https://g.page/r/…/review', oninput: (v) => { w.review_url = v.trim(); bad(rv, !w.review_url || /^https?:\/\/\S+$/.test(w.review_url)); } });
  const okMail = (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const mt = input(w.mail_to, { type: 'email', placeholder: c.email || 'owner@example.com', oninput: (v) => { w.mail_to = v.trim(); bad(mt, okMail(w.mail_to)); } });
  const auto = toggle(false, 'Отправлять автоматически');
  auto.querySelector('input').disabled = true; auto.style.opacity = '.55'; auto.style.cursor = 'not-allowed';
  g.append(h('section.card.c12', h('div.card__h', h('div', h('h3', 'Напоминания о вылетах'), h('p', 'Накануне вылета и на следующий день после возвращения панель подсказывает, кому написать, и готовит текст на языке клиента. Сообщение отправляете вы — со своего WhatsApp, одним нажатием.'))),
    h('div.grid2',
      h('div.stack',
        toggle(w.enabled, 'Напоминания включены', (v) => { w.enabled = v; }),
        field('Час письма со списком (по Еревану)', select(Array.from({ length: 24 }, (_, i) => [i, String(i).padStart(2, '0') + ':00']), w.mail_hour, (v) => { w.mail_hour = Number(v); }),
          'Раз в день приходит письмо «Сегодня написать: …» с кнопками WhatsApp. Писать некому — письма нет'),
        field('Куда слать письмо', mt, 'Этот адрес посетители сайта не видят. Пусто — письмо идёт на почту агентства' + (c.email ? ' (' + c.email + ')' : ''))),
      h('div.stack',
        field('Ссылка для отзыва', rv, 'Дописывается в сообщение «с возвращением» — например, ссылка на ваши отзывы в Google'),
        h('div.field', h('span', 'Автоматическая отправка'), auto, h('small', 'Станет доступно после подключения WhatsApp Business Platform')))),
    h('div.btns', { style: { marginTop: '14px' } },
      h('button.btn.btn--primary', { onclick: () => {
        if (w.review_url && !/^https?:\/\/\S+$/.test(w.review_url)) { toast('Ссылка для отзыва должна начинаться с https://', 'bad'); rv.focus(); return; }
        if (!okMail(w.mail_to)) { toast('Адрес для письма с напоминаниями записан неверно', 'bad'); mt.focus(); return; }
        save('whatsapp', { ...w, mode: 'remind' }, 'Настройки напоминаний сохранены').then((ok) => { if (ok) ctx.reminders(true).catch(() => {}); });
      } }, 'Сохранить'),
      h('button.btn', { onclick: () => ctx.go('templates') }, 'Тексты сообщений'))));
}
