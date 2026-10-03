// ---------------------------------------------------------------------------
// SAM TRAVEL — client cabinet logic (cabinet.html)
// The sign-in / sign-up form lives in-page on index.html (#auth), driven by
// js/app.js. This file only powers the logged-in cabinet.
// Depends on: js/supabase-config.js (defines window.sb)
// ---------------------------------------------------------------------------
(function () {
  const sb = window.sb;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));
  const AUTH_URL = 'index.html#auth';   // where an unauthenticated visitor is sent

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  // ------- i18n (en is the markup default; ru/hy override) ------------------
  const I18N = {
    ru: {
      signOut: 'Выйти', panel: 'Панель управления', hi: 'Привет', lead: 'Ваши поездки и заявки — ниже.',
      bookingsH: 'Бронирования',
      empty: 'Пока нет бронирований. Отправьте заявку с сайта — она появится здесь.',
      onbTitle: 'Один момент', onbText: 'Хотите получать акции и скидки?',
      onbConsent: 'Да, присылайте мне акции, скидки и купоны на email. Отписаться можно в любой момент.',
      onbContinue: 'Продолжить',
      loadErr: 'Не удалось загрузить бронирования.',
      clientPrefix: 'клиент', locale: 'ru-RU',
      roles: { client: 'клиент', manager: 'менеджер', marketer: 'маркетолог', admin: 'владелец' },
      statuses: { new: 'новая', in_progress: 'в работе', confirmed: 'подтверждена', cancelled: 'отменена' },
    },
    hy: {
      signOut: 'Դուրս գալ', panel: 'Կառավարման վահանակ', hi: 'Բարև', lead: 'Ձեր ուղևորություններն ու հարցումները՝ ստորև։',
      bookingsH: 'Ամրագրումներ',
      empty: 'Դեռ ամրագրումներ չկան։ Ուղարկեք հարցում կայքից, և այն կհայտնվի այստեղ։',
      onbTitle: 'Մեկ պահ', onbText: 'Ցանկանո՞ւմ եք ստանալ ակցիաներ և զեղչեր։',
      onbConsent: 'Այո, ուղարկեք ինձ ակցիաներ, զեղչեր և կտրոններ էլ. փոստով։ Կարող եմ ցանկացած պահի չեղարկել բաժանորդագրությունը։',
      onbContinue: 'Շարունակել',
      loadErr: 'Չհաջողվեց բեռնել ամրագրումները։',
      clientPrefix: 'հաճախորդ', locale: 'hy-AM',
      roles: { client: 'հաճախորդ', manager: 'մենեջեր', marketer: 'մարքեթոլոգ', admin: 'սեփականատեր' },
      statuses: { new: 'նոր', in_progress: 'ընթացքում', confirmed: 'հաստատված', cancelled: 'չեղարկված' },
    },
    en: {
      clientPrefix: 'client', locale: 'en-US',
      loadErr: 'Could not load bookings.',
      roles: { client: 'client', manager: 'manager', marketer: 'marketer', admin: 'owner' },
      statuses: { new: 'new', in_progress: 'in progress', confirmed: 'confirmed', cancelled: 'cancelled' },
    },
  };
  let cur = 'en';
  const T = () => I18N[cur] || I18N.en;

  function initialLang() {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (['en', 'ru', 'hy'].includes(q)) return q;
      const saved = localStorage.getItem('sam-lang');
      if (['en', 'ru', 'hy'].includes(saved)) return saved;
    } catch (e) {}
    return 'en';
  }

  // module state so a language switch can re-render live data
  let lastBookings = [], lastIsStaff = false, lastRole = null;

  function applyLang(lang) {
    cur = I18N[lang] ? lang : 'en';
    document.documentElement.setAttribute('lang', cur);
    const dict = I18N[cur];
    if (dict) $$('[data-i18n]').forEach((el) => { if (dict[el.dataset.i18n]) el.textContent = dict[el.dataset.i18n]; });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === cur)));
    if (lastRole) paintRole(lastRole);
    renderBookings(lastBookings, lastIsStaff);
    try { localStorage.setItem('sam-lang', cur); } catch (e) {}
  }

  function paintRole(role) {
    const el = $('#role-badge'); if (!el) return;
    el.textContent = T().roles[role] || role; el.hidden = false;
  }

  async function initCabinet() {
    cur = initialLang();
    $$('.lang button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)));
    applyLang(cur);   // paint static strings immediately

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace(AUTH_URL); return; }

    const { data: profile, error: pErr } = await sb
      .from('profiles').select('*').eq('id', session.user.id).single();
    if (pErr) console.error(pErr);

    // First social login has no consent checkbox → show the consent screen once.
    if (profile && !profile.onboarded) await runOnboarding();

    const nameEl = $('#greet');
    if (nameEl) nameEl.textContent = (profile && profile.full_name) || session.user.email;
    lastRole = profile ? profile.role : 'client';
    lastIsStaff = profile && (profile.role === 'manager' || profile.role === 'admin');
    paintRole(lastRole);
    // the team (owner, managers, marketer) get a door into admin.html
    if (['admin', 'manager', 'marketer'].includes(lastRole)) show($('#btn-panel'));

    // Bookings: RLS returns the client's own rows, or ALL rows for staff.
    const { data: bookings, error: bErr } = await sb
      .from('bookings').select('*').order('created_at', { ascending: false });
    lastBookings = bookings || [];
    renderBookings(lastBookings, lastIsStaff, bErr);

    const out = $('#btn-logout');
    if (out) out.addEventListener('click', async () => {
      await sb.auth.signOut();
      location.replace(AUTH_URL);
    });
  }

  function runOnboarding() {
    return new Promise((resolve) => {
      const modal = $('#onboard');
      if (!modal) { markOnboarded(false); resolve(); return; }
      show(modal);
      $('#onboard-save').addEventListener('click', async () => {
        await markOnboarded($('#onboard-consent').checked);
        hide(modal);
        resolve();
      }, { once: true });
    });
  }

  async function markOnboarded(consent) {
    const patch = { onboarded: true, marketing_consent: consent };
    if (consent) { patch.consent_at = new Date().toISOString(); patch.consent_source = 'onboarding_social'; }
    const { data: { session } } = await sb.auth.getSession();
    if (session) await sb.from('profiles').update(patch).eq('id', session.user.id);
  }

  function renderBookings(rows, isStaff, err) {
    const list = $('#bookings');
    const empty = $('#bookings-empty');
    if (!list) return;
    if (err) { list.innerHTML = '<p class="msg" data-kind="err">' + escapeHtml(T().loadErr) + '</p>'; return; }
    if (!rows.length) { list.innerHTML = ''; show(empty); return; }
    hide(empty);
    const st = T().statuses, dloc = T().locale, cliLabel = T().clientPrefix;
    list.innerHTML = rows.map((b) => `
      <article class="booking">
        <div class="booking__head">
          <h3>${escapeHtml(b.tour)}</h3>
          <span class="booking__status status--${b.status}">${escapeHtml(st[b.status] || b.status)}</span>
        </div>
        ${b.dates ? `<p class="booking__dates">${escapeHtml(b.dates)}</p>` : ''}
        ${b.details ? `<p class="booking__details">${escapeHtml(b.details)}</p>` : ''}
        ${isStaff ? `<p class="booking__meta">${escapeHtml(cliLabel)}: ${escapeHtml(b.user_id)}</p>` : ''}
        <time class="booking__time">${new Date(b.created_at).toLocaleDateString(dloc)}</time>
      </article>`).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'cabinet') initCabinet();
  });
})();
