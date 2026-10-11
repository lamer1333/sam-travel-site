// Launch readiness: the panel checks the site's own data for placeholders,
// missing translations and missing IDs — and links to the fix. The site has no request
// form (§4.11), so there is nothing about requests or letters here.
import { h, icon, pageHead, plural, fmt, toast } from '../ui.js';
import { ring } from '../charts.js';
import { isFilled, LANGS } from '../ui.js';

export default async function healthView(root, ctx) {
  const [s, tours, reviews, team, reels, tpl, users, ns] = await Promise.all([
    ctx.settings(true), ctx.api.list('tours'), ctx.api.list('reviews'), ctx.api.list('team'), ctx.api.list('reels'), ctx.api.list('wa_templates'), ctx.users(true),
    ctx.api.notifyStatus().catch(() => null),
  ]);
  // the daily letter «Сегодня написать: …» (§4.12): is it set up, and does it leave
  const rm = (ns && ns.reminders) || null;
  const mailWhy = !rm ? 'База не ответила на notify_status() — накатите миграции из supabase/migrations/.'
    : !rm.mail_to ? 'Не указана почта агентства — письму некуда идти.'
    : !rm.secrets ? 'В Supabase Vault нет адреса функции почты и секрета (lead_mail_url, lead_mail_secret) — см. SETUP-ADMIN.md.'
    : !rm.schedule ? 'Не стоит расписание reminders-mail: включите pg_cron и накатите миграции ещё раз.'
    : +rm.failed_7d ? 'За неделю не доставлено писем: ' + rm.failed_7d + '. Причина: ' + (rm.last_error || 'неизвестна') + '.'
    : '';
  const mailOk = !!rm && (!rm.enabled || !mailWhy);
  const co = s.company || {}, seo = s.seo || {}, an = s.analytics || {}, wa = (s.contacts || {}).whatsapp || '';
  const pubT = tours.filter((t) => t.published), pubR = reviews.filter((r) => r.published), pubTeam = team.filter((m) => m.published);
  const F4 = [{ key: 'card_title' }, { key: 'card_text' }, { key: 'title' }, { key: 'text' }];
  const untranslated = pubT.filter((t) => LANGS.some(([l]) => !isFilled(t.i18n[l], F4)));
  const owners = users.filter((u) => u.role === 'admin');
  const replies = tpl.filter((t) => !t.kind);   // without the texts of the flight reminders: those exist in all three languages from the start
  const C = [
    // [weight, ok, title, detail, route, level if not ok]
    [3, co.licence && co.licence !== '23-1057-2023' && co.insurance && co.insurance !== 'TRV-2026-0412', 'Настоящие номера лицензии и страховки', 'Сейчас на сайте номера-образцы из макета — это видят клиенты и проверяющие.', 'contacts', 'bad'],
    [3, pubR.length >= 3, 'Минимум 3 настоящих отзыва', pubR.length ? `Опубликовано ${pubR.length}.` : 'Пока на сайте шаблонные «Sample review».', 'content/reviews', 'bad'],
    [2, pubTeam.length >= 1 && pubTeam.every((m) => m.photo_url && isFilled(m.i18n.ru, [{ key: 'name' }])), 'Менеджеры с фото и именами', pubTeam.length ? pubTeam.filter((m) => !m.photo_url).length + ' без фото.' : 'На сайте «Manager name» и пустые фото.', 'content/team', 'bad'],
    [2, pubT.length >= 3, 'В «Горящих турах» есть что показать', `Сейчас на сайте ${pubT.length} ${plural(pubT.length, 'тур', 'тура', 'туров')}.`, 'content/tours', 'warn'],
    [2, pubT.every((t) => t.photo_url), 'Фото у всех горящих туров', pubT.filter((t) => !t.photo_url).length + ' с градиентом вместо фото.', 'content/tours', 'warn'],
    [2, !untranslated.length, 'Туры переведены на все три языка', untranslated.length ? 'Нет перевода: ' + untranslated.map((t) => t.slug).join(', ') : '', 'content/tours', 'warn'],
    [1, reels.filter((r) => r.published).length >= 3, 'Три рилса в блоке «Перед поездкой»', reels.filter((r) => r.published).length + ' из 3 слотов заполнено.', 'content/reels', 'warn'],
    [2, ['ru', 'hy'].every((l) => seo[l] && seo[l].title && seo[l].description), 'SEO-тексты на русском и армянском', 'Без них Google показывает английский текст всем.', 'm/seo', 'warn'],
    [2, !!(an.ga4 && an.pixel), 'Подключены Google Analytics и Meta Pixel', 'Нужны для рекламных кабинетов и ретаргетинга.', 'm/seo', 'warn'],
    [3, /^\d{10,15}$/.test(wa), 'Номер WhatsApp указан', 'Все кнопки сайта ведут в WhatsApp. Номер — цифрами с кодом страны, без «+».', 'contacts', 'bad'],
    [2, mailOk, rm && !rm.enabled ? 'Напоминания о вылетах выключены — письмо не нужно' : 'Письмо с напоминаниями настроено и уходит' + (rm && rm.last_sent_at ? ' (последнее — ' + fmt.dt(rm.last_sent_at) + ')' : ''), mailWhy, 'contacts', 'bad'],
    [1, owners.length >= 2, 'Второй человек с правами владельца', 'Если единственный владелец потеряет доступ, назначить роли будет некому.', 'people', 'warn'],
    [1, ['ru', 'hy', 'en'].every((l) => replies.some((t) => t.lang === l)), 'Шаблоны ответов на всех языках', 'Есть языки: ' + Array.from(new Set(replies.map((t) => t.lang))).join(', ').toUpperCase(), 'templates', 'warn'],
    [1, !/@(gmail|mail|yandex|yahoo)\./i.test((s.contacts || {}).email || ''), 'Почта на своём домене', 'info@samtravel.am выглядит солиднее, чем gmail, и реже попадает в спам.', 'contacts', 'warn'],
  ];
  const total = C.reduce((a, c) => a + c[0], 0), got = C.reduce((a, c) => a + (c[1] ? c[0] : 0), 0);
  const score = got / total;
  const fails = C.filter((c) => !c[1]).sort((a, b) => (a[5] === 'bad' ? -1 : 1) - (b[5] === 'bad' ? -1 : 1) || b[0] - a[0]);
  const oks = C.filter((c) => c[1]);

  root.append(pageHead('Готовность сайта', 'Панель сама проверяет контент сайта и настройки. Пункты обновляются при каждом открытии.'));
  root.append(h('div.dash',
    h('section.card.c4.health-score', { style: { display: 'grid', placeItems: 'center', textAlign: 'center', gap: '10px', alignSelf: 'start', padding: '28px 20px' } },
      ring(score, { size: 150 }),
      h('div', h('b', { style: { fontSize: '16px' } }, score >= 0.85 ? 'Можно запускать' : score >= 0.6 ? 'Почти готово' : 'Нужно доделать'),
        h('div.muted', oks.length + ' из ' + C.length + ' пунктов в порядке'))),
    h('section.card.c8', h('div.card__h', h('div', h('h3', 'Что исправить'), h('p', 'Сначала красное — это видят клиенты'))),
      fails.length ? fails.map((c) => row(c, ctx)) : h('div.empty', h('b', 'Всё готово'), 'Ни одного замечания')),
    oks.length ? h('section.card.c12', h('div.card__h', h('div', h('h3', 'В порядке'))), oks.map((c) => row(c, ctx))) : null,
    mailTestCard(ctx)));
}
// «Отправить пробное письмо»: the only way to see that the keys of the mail service and the
// sender's address really work without waiting for a day with flights.
const MAIL_ERR = {
  mail_not_configured: 'В секретах функции lead-mail нет MAIL_API_KEY или MAIL_FROM — см. SETUP-ADMIN.md.',
  no_agency_email: 'Не указана почта агентства («Контакты и реквизиты») — письму некуда идти.',
  db_unavailable: 'Функция почты не достучалась до базы. Попробуйте ещё раз через минуту.',
};
function mailTestCard(ctx) {
  const out = h('small.muted', { role: 'status' }, 'Письмо уходит сразу на почту агентства и в журнал напоминаний не попадает.');
  const btn = h('button.btn', { onclick: async () => {
    btn.disabled = true; out.textContent = 'Отправляем…';
    try {
      const r = await ctx.api.mailTest();
      if (r && r.ok) { out.textContent = 'Отправлено на ' + r.to + (ctx.demo ? ' (демо: письмо не уходит).' : '. Проверьте входящие и «Спам».'); toast('Пробное письмо отправлено'); }
      else { out.textContent = 'Не отправлено. ' + (MAIL_ERR[r && r.error] || 'Ответ почтового сервиса: ' + ((r && r.error) || 'неизвестная ошибка')); toast('Письмо не отправлено', 'bad'); }
    } catch (e) { out.textContent = 'Не отправлено: функция почты не ответила. Проверьте, что lead-mail выложена (SETUP-ADMIN.md).'; toast('Письмо не отправлено', 'bad'); }
    btn.disabled = false;
  } }, 'Отправить пробное письмо');
  return h('section.card.c12', h('div.card__h', h('div', h('h3', 'Проверка почты'), h('p', 'Показывает, что ключи почтового сервиса и адрес отправителя рабочие.'))),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px' } }, btn, out));
}
function row([, ok, title, detail, route, level], ctx) {
  return h('div.check', h('span.check__ic.check__ic--' + (ok ? 'ok' : level), icon(ok ? 'check' : level === 'bad' ? 'alert' : 'clock')),
    h('div.check__b', h('b', title), !ok && detail ? h('small', detail) : null),
    !ok ? h('button.btn.btn--sm', { onclick: () => ctx.go(route) }, 'Исправить →') : null);
}
