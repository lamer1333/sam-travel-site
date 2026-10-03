// Launch readiness: the panel checks the site's own data for placeholders,
// missing translations, missing IDs and slow answers — and links to the fix.
import { h, icon, fmt, pageHead, card } from '../ui.js';
import { ring } from '../charts.js';
import { median, minutesBetween, inRange } from './common.js';
import { isFilled, LANGS } from '../ui.js';

export default async function healthView(root, ctx) {
  const [s, tours, reviews, team, reels, tpl, users, leads] = await Promise.all([
    ctx.settings(true), ctx.api.list('tours'), ctx.api.list('reviews'), ctx.api.list('team'), ctx.api.list('reels'), ctx.api.list('wa_templates'), ctx.users(true), ctx.leads(),
  ]);
  const co = s.company || {}, seo = s.seo || {}, an = s.analytics || {}, sla = (s.hours || {}).sla_min || 60;
  const pubT = tours.filter((t) => t.published), pubR = reviews.filter((r) => r.published), pubTeam = team.filter((m) => m.published);
  const F4 = [{ key: 'card_title' }, { key: 'card_text' }, { key: 'title' }, { key: 'text' }];
  const untranslated = pubT.filter((t) => LANGS.some(([l]) => !isFilled(t.i18n[l], F4)));
  const last30 = leads.filter((l) => inRange(l.created_at, new Date(Date.now() - 30 * 86400e3), new Date()) && l.status !== 'spam');
  const resp = median(last30.filter((l) => l.first_response_at).map((l) => minutesBetween(l.created_at, l.first_response_at)));
  const waiting = leads.filter((l) => l.status === 'new' && minutesBetween(l.created_at, Date.now()) > sla);
  const owners = users.filter((u) => u.role === 'admin');
  const C = [
    // [weight, ok, title, detail, route, level if not ok]
    [3, co.licence && co.licence !== '23-1057-2023' && co.insurance && co.insurance !== 'TRV-2026-0412', 'Настоящие номера лицензии и страховки', 'Сейчас на сайте номера-образцы из макета — это видят клиенты и проверяющие.', 'contacts', 'bad'],
    [3, pubR.length >= 3, 'Минимум 3 настоящих отзыва', pubR.length ? `Опубликовано ${pubR.length}.` : 'Пока на сайте шаблонные «Sample review».', 'content/reviews', 'bad'],
    [2, pubTeam.length >= 1 && pubTeam.every((m) => m.photo_url && isFilled(m.i18n.ru, [{ key: 'name' }])), 'Менеджеры с фото и именами', pubTeam.length ? pubTeam.filter((m) => !m.photo_url).length + ' без фото.' : 'На сайте «Manager name» и пустые фото.', 'content/team', 'bad'],
    [2, pubT.length >= 3, 'В «Горящих турах» есть что показать', `Сейчас на сайте ${pubT.length} ${pubT.length === 1 ? 'тур' : 'туров'}.`, 'content/tours', 'warn'],
    [2, pubT.every((t) => t.photo_url), 'Фото у всех горящих туров', pubT.filter((t) => !t.photo_url).length + ' с градиентом вместо фото.', 'content/tours', 'warn'],
    [2, !untranslated.length, 'Туры переведены на все три языка', untranslated.length ? 'Нет перевода: ' + untranslated.map((t) => t.slug).join(', ') : '', 'content/tours', 'warn'],
    [1, reels.filter((r) => r.published).length >= 3, 'Три рилса в блоке «Перед поездкой»', reels.filter((r) => r.published).length + ' из 3 слотов заполнено.', 'content/reels', 'warn'],
    [2, ['ru', 'hy'].every((l) => seo[l] && seo[l].title && seo[l].description), 'SEO-тексты на русском и армянском', 'Без них Google показывает английский текст всем.', 'm/seo', 'warn'],
    [2, !!(an.ga4 && an.pixel), 'Подключены Google Analytics и Meta Pixel', 'Нужны для рекламных кабинетов и ретаргетинга.', 'm/seo', 'warn'],
    [2, resp != null && resp <= sla, `Медианный ответ не дольше ${sla} мин`, resp != null ? 'За 30 дней: ' + fmt.dur(resp) + '.' : 'Пока нет заявок с ответом.', 'dashboard', 'warn'],
    [2, !waiting.length, 'Никто не ждёт ответа дольше обещанного', waiting.length ? waiting.length + ' заявок ждут дольше ' + sla + ' мин.' : '', 'leads', 'bad'],
    [2, !users.some((u) => u.email === 'demo@samtravel.am'), 'Удалён тестовый пользователь', 'demo@samtravel.am создавался для проверки входа — удалите в Supabase → Authentication.', 'people', 'bad'],
    [1, owners.length >= 2, 'Второй человек с правами владельца', 'Если единственный владелец потеряет доступ, назначить роли будет некому.', 'people', 'warn'],
    [1, ['ru', 'hy', 'en'].every((l) => tpl.some((t) => t.lang === l)), 'Шаблоны ответов на всех языках', 'Есть языки: ' + Array.from(new Set(tpl.map((t) => t.lang))).join(', ').toUpperCase(), 'templates', 'warn'],
    [1, !/@(gmail|mail|yandex|yahoo)\./i.test((s.contacts || {}).email || ''), 'Почта на своём домене', 'info@samtravel.am выглядит солиднее, чем gmail, и реже попадает в спам.', 'contacts', 'warn'],
  ];
  const total = C.reduce((a, c) => a + c[0], 0), got = C.reduce((a, c) => a + (c[1] ? c[0] : 0), 0);
  const score = got / total;
  const fails = C.filter((c) => !c[1]).sort((a, b) => (a[5] === 'bad' ? -1 : 1) - (b[5] === 'bad' ? -1 : 1) || b[0] - a[0]);
  const oks = C.filter((c) => c[1]);

  root.append(pageHead('Готовность сайта', 'Панель сама проверяет контент и работу с заявками. Пункты обновляются при каждом открытии.'));
  root.append(h('div.dash',
    h('section.card.c4', { style: { display: 'grid', placeItems: 'center', textAlign: 'center', gap: '10px', alignSelf: 'start', position: 'sticky', top: '84px', padding: '28px 20px' } },
      ring(score, { size: 150 }),
      h('div', h('b', { style: { fontSize: '16px' } }, score >= 0.85 ? 'Можно запускать' : score >= 0.6 ? 'Почти готово' : 'Нужно доделать'),
        h('div.muted', oks.length + ' из ' + C.length + ' пунктов в порядке'))),
    h('section.card.c8', h('div.card__h', h('div', h('h3', 'Что исправить'), h('p', 'Сначала красное — это видят клиенты'))),
      fails.length ? fails.map((c) => row(c, ctx)) : h('div.empty', h('b', 'Всё готово'), 'Ни одного замечания')),
    oks.length ? h('section.card.c12', h('div.card__h', h('div', h('h3', 'В порядке'))), oks.map((c) => row(c, ctx))) : null));
}
function row([, ok, title, detail, route, level], ctx) {
  return h('div.check', h('span.check__ic.check__ic--' + (ok ? 'ok' : level), icon(ok ? 'check' : level === 'bad' ? 'alert' : 'clock')),
    h('div.check__b', h('b', title), !ok && detail ? h('small', detail) : null),
    !ok ? h('button.btn.btn--sm', { onclick: () => ctx.go(route) }, 'Исправить →') : null);
}
