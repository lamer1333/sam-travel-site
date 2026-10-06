// Subscribers: people who explicitly agreed to receive offers. Growth, segments,
// export ready for Brevo / Mailchimp / Resend. Only consented rows ever reach here.
import { h, mount, icon, fmt, input, table, csv, copyText, debounce, pageHead, chipsPick, card, plural } from '../ui.js';
import { kpi, timeChart, stackBar } from '../charts.js';
import { ymd, LANG_NAME } from './common.js';

export default async function audienceView(root, ctx, params) {
  const rows = await ctx.api.audience();
  const f = { q: '', langs: [], src: [] };
  const now = Date.now(), d30 = now - 30 * 86400e3, d60 = now - 60 * 86400e3;
  const new30 = rows.filter((r) => r.consent_at && new Date(r.consent_at) > d30).length;
  const new60 = rows.filter((r) => r.consent_at && new Date(r.consent_at) > d60 && new Date(r.consent_at) <= d30).length;
  const byLang = (l) => rows.filter((r) => r.lang === l).length;

  root.append(pageHead('Подписчики', 'Только те, кто сам поставил галочку «присылайте акции» — при регистрации или при первом входе. Рассылка идёт через сервис рассылок (Brevo, Mailchimp) — с отпиской в каждом письме.',
    h('button.btn.btn--primary', { onclick: () => exportAs('brevo') }, icon('download'), 'Выгрузить для Brevo')));

  root.append(h('div.kpis',
    kpi({ label: 'Подписчиков', value: fmt.num(rows.length) }),
    kpi({ label: 'Новых за 30 дней', value: fmt.num(new30), cur: new30, prev: new60 }),
    kpi({ label: 'Пришли через соцвход', value: fmt.pct(rows.length ? rows.filter((r) => r.consent_source === 'onboarding_social').length / rows.length : null, 0), hint: 'Согласились на экране после входа через Google / Mail.ru' })));

  // growth: cumulative by consent date, last 180 days
  const days = []; for (let t = now - 180 * 86400e3; t <= now; t += 86400e3) days.push(ymd(t));
  const perDay = {}; rows.forEach((r) => { if (r.consent_at) { const d = ymd(r.consent_at); perDay[d] = (perDay[d] || 0) + 1; } });
  let acc = rows.filter((r) => r.consent_at && ymd(r.consent_at) < days[0]).length;
  const cum = days.map((d) => (acc += perDay[d] || 0));
  const g = h('div.dash'); root.append(g);
  g.append(h('section.card.c8', h('div.card__h', h('div', h('h3', 'Рост базы'), h('p', 'Всего подписчиков на дату, последние полгода'))),
    timeChart({ labels: days, series: [{ name: 'Подписчики', type: 'area', color: 'var(--s7)', values: cum }] })));
  g.append(h('section.card.c4', h('div.card__h', h('div', h('h3', 'Сегменты по языку'), h('p', 'Пишите каждому сегменту на его языке'))),
    stackBar([{ label: 'RU', value: byLang('ru'), color: 'var(--s1)' }, { label: 'HY', value: byLang('hy'), color: 'var(--s2)' }, { label: 'EN', value: byLang('en'), color: 'var(--s3)' }]),
    h('div.btns', { style: { marginTop: '16px' } }, ['ru', 'hy', 'en'].map((l) => h('button.btn.btn--sm', { onclick: () => exportAs('brevo', rows.filter((r) => r.lang === l), l) }, icon('download'), l.toUpperCase() + ' · ' + byLang(l))))));

  // list
  const listBox = h('div');
  const search = input('', { placeholder: 'Email или имя', attrs: { type: 'search' } });
  search.addEventListener('input', debounce(() => { f.q = search.value.trim().toLowerCase(); paint(); }, 150));
  g.append(h('section.card.c12', h('div.card__h', h('div', h('h3', 'Список'), h('p', 'Отфильтруйте — выгрузка возьмёт только отфильтрованных')),
    h('div.btns', h('button.btn.btn--sm', { onclick: () => copyText(filtered().map((r) => r.email).join(', '), 'Адреса скопированы') }, icon('copy'), 'Скопировать адреса'),
      h('button.btn.btn--sm', { onclick: () => exportAs('generic') }, icon('download'), 'CSV (все поля)'))),
    h('div.toolbar', search,
      chipsPick([['ru', 'RU'], ['hy', 'HY'], ['en', 'EN']], [], (v) => { f.langs = v; paint(); }),
      chipsPick([['signup_form', 'Регистрация'], ['onboarding_social', 'Соцвход']], [], (v) => { f.src = v; paint(); })),
    listBox));

  function filtered() {
    return rows.filter((r) => (!f.q || (r.email || '').toLowerCase().includes(f.q) || (r.full_name || '').toLowerCase().includes(f.q))
      && (!f.langs.length || f.langs.includes(r.lang)) && (!f.src.length || f.src.includes(r.consent_source)));
  }
  function paint() {
    const data = filtered();
    mount(listBox, h('div.muted', { style: { marginBottom: '8px', fontSize: '12.5px' } }, fmt.num(data.length) + ' ' + plural(data.length, 'подписчик', 'подписчика', 'подписчиков')),
      table({ rows: data.slice(0, 500), initialSort: ['consent_at', -1], columns: [
        { key: 'email', label: 'Email', sort: true, render: (r) => h('div.cell-main', h('b', r.email), r.full_name ? h('small', r.full_name) : null) },
        { key: 'lang', label: 'Язык', sort: true, render: (r) => (r.lang || '').toUpperCase() },
        { key: 'consent_source', label: 'Как подписался', sort: true, render: (r) => r.consent_source === 'onboarding_social' ? 'Соцвход' : r.consent_source === 'signup_form' ? 'Регистрация' : (r.consent_source || '—') },
        { key: 'consent_at', label: 'Согласие', sort: true, render: (r) => fmt.date(r.consent_at) },
      ] }),
      data.length > 500 ? h('div.muted', { style: { marginTop: '8px' } }, 'Показаны первые 500 — выгрузка возьмёт всех') : null);
  }
  function exportAs(kind, list = filtered(), suffix = '') {
    const name = 'subscribers' + (suffix ? '-' + suffix : '') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    if (kind === 'brevo') csv(name, list, [['EMAIL', (r) => r.email], ['FIRSTNAME', (r) => (r.full_name || '').split(' ')[0]], ['LASTNAME', (r) => (r.full_name || '').split(' ').slice(1).join(' ')], ['LANG', (r) => r.lang], ['OPT_IN_DATE', (r) => r.consent_at ? r.consent_at.slice(0, 10) : '']]);
    else csv(name, list, [['email', (r) => r.email], ['name', (r) => r.full_name], ['lang', (r) => r.lang], ['consent_source', (r) => r.consent_source], ['consent_at', (r) => r.consent_at], ['registered_at', (r) => r.created_at]]);
  }
  paint();
  if (params[0] === 'export') exportAs('brevo');
}
