// ---------------------------------------------------------------------------
// SAM TRAVEL — client cabinet logic (cabinet.html)
// The sign-in / sign-up form lives in-page on index.html (#auth), driven by
// js/app.js. This file only powers the logged-in cabinet.
// Depends on: js/supabase-config.js (defines window.sb)
//
// Everything goes through RPCs from supabase/migrations/040_clients.sql:
//   my_profile()               own profile, including the date of birth
//   finish_onboarding(d, c)    first-login screen: date of birth + mailing consent
//   set_birth_date(d)          change the date of birth
//   my_requests()              own requests from the site with a client-facing status
// ---------------------------------------------------------------------------
(function () {
  const sb = window.sb;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));
  const AUTH_URL = 'index.html#auth';   // where an unauthenticated visitor is sent

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  // ------- i18n (en is also the markup default) ------------------------------
  const I18N = {
    en: {
      signOut: 'Sign out', panel: 'Control panel', hi: 'Hi', lead: 'Your details and travel requests are below.',
      profileH: 'Profile', birthLabel: 'Date of birth', change: 'Change', save: 'Save', cancel: 'Cancel',
      requestsH: 'My requests',
      empty: 'No requests yet. Send one from the site while signed in and it will show up here with its status.',
      onbTitle: 'One quick thing', onbText: 'We need your date of birth to open your account.',
      onbTextConsent: 'Would you like to hear about deals and discounts?',
      onbConsent: 'Yes, send me deals, discounts and coupons by email. I can unsubscribe anytime.',
      onbContinue: 'Continue',
      errBirth: 'Enter a valid date of birth.', errBirthAge: 'An account is available from the age of 16.',
      errSave: 'Could not save. Check the connection and try again.',
      loadErr: 'Could not load your requests.', profileErr: 'Could not load your account. Refresh the page or sign in again.',
      request: 'Travel request',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      date: (y, m, d, mo) => d + ' ' + mo[m] + ' ' + y,
      roles: { client: 'client', manager: 'manager', marketer: 'marketer', admin: 'owner' },
      statuses: { received: 'Received', in_touch: 'In touch', offer: 'Offer sent', done: 'Booked', closed: 'Closed' },
    },
    ru: {
      signOut: 'Выйти', panel: 'Панель управления', hi: 'Привет', lead: 'Ваши данные и заявки на поездки — ниже.',
      profileH: 'Профиль', birthLabel: 'Дата рождения', change: 'Изменить', save: 'Сохранить', cancel: 'Отмена',
      requestsH: 'Мои заявки',
      empty: 'Заявок пока нет. Отправьте заявку с сайта, войдя в аккаунт, — она появится здесь со статусом.',
      onbTitle: 'Один момент', onbText: 'Чтобы открыть кабинет, укажите дату рождения.',
      onbTextConsent: 'Хотите получать акции и скидки?',
      onbConsent: 'Да, присылайте мне акции, скидки и купоны на email. Отписаться можно в любой момент.',
      onbContinue: 'Продолжить',
      errBirth: 'Укажите корректную дату рождения.', errBirthAge: 'Кабинет доступен с 16 лет.',
      errSave: 'Не удалось сохранить. Проверьте связь и попробуйте ещё раз.',
      loadErr: 'Не удалось загрузить заявки.', profileErr: 'Не удалось загрузить кабинет. Обновите страницу или войдите заново.',
      request: 'Заявка на поездку',
      months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      date: (y, m, d, mo) => d + ' ' + mo[m] + ' ' + y,
      roles: { client: 'клиент', manager: 'менеджер', marketer: 'маркетолог', admin: 'владелец' },
      statuses: { received: 'Получили', in_touch: 'На связи', offer: 'Предложение отправлено', done: 'Оформлено', closed: 'Закрыто' },
    },
    hy: {
      signOut: 'Դուրս գալ', panel: 'Կառավարման վահանակ', hi: 'Բարև', lead: 'Ձեր տվյալներն ու ճամփորդության հայտերը՝ ստորև։',
      profileH: 'Պրոֆիլ', birthLabel: 'Ծննդյան ամսաթիվ', change: 'Փոխել', save: 'Պահպանել', cancel: 'Չեղարկել',
      requestsH: 'Իմ հայտերը',
      empty: 'Հայտեր դեռ չկան։ Ուղարկեք հայտ կայքից՝ մուտք գործած վիճակում, և այն կհայտնվի այստեղ՝ իր կարգավիճակով։',
      onbTitle: 'Մեկ պահ', onbText: 'Անձնական էջը բացելու համար նշեք ձեր ծննդյան ամսաթիվը։',
      onbTextConsent: 'Ցանկանո՞ւմ եք ստանալ ակցիաներ և զեղչեր։',
      onbConsent: 'Այո, ուղարկեք ինձ ակցիաներ, զեղչեր և կտրոններ էլ. փոստով։ Կարող եմ ցանկացած պահի չեղարկել բաժանորդագրությունը։',
      onbContinue: 'Շարունակել',
      errBirth: 'Նշեք ճիշտ ծննդյան ամսաթիվ։', errBirthAge: 'Անձնական էջը հասանելի է 16 տարեկանից։',
      errSave: 'Չհաջողվեց պահպանել։ Ստուգեք կապը և փորձեք կրկին։',
      loadErr: 'Չհաջողվեց բեռնել հայտերը։', profileErr: 'Չհաջողվեց բեռնել անձնական էջը։ Թարմացրեք էջը կամ նորից մուտք գործեք։',
      request: 'Ճամփորդության հայտ',
      months: ['հունվարի', 'փետրվարի', 'մարտի', 'ապրիլի', 'մայիսի', 'հունիսի', 'հուլիսի', 'օգոստոսի', 'սեպտեմբերի', 'հոկտեմբերի', 'նոյեմբերի', 'դեկտեմբերի'],
      date: (y, m, d, mo) => y + ' թ. ' + mo[m] + ' ' + d,
      roles: { client: 'հաճախորդ', manager: 'մենեջեր', marketer: 'մարքեթոլոգ', admin: 'սեփականատեր' },
      statuses: { received: 'Ստացվել է', in_touch: 'Կապի մեջ ենք', offer: 'Առաջարկն ուղարկված է', done: 'Ձևակերպված է', closed: 'Փակված է' },
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
  let profile = null, requests = [], requestsErr = null, pageErr = '', onboardNeedsBirth = true;

  function applyLang(lang) {
    cur = I18N[lang] ? lang : 'en';
    document.documentElement.setAttribute('lang', cur);
    const dict = T();
    $$('[data-i18n]').forEach((el) => { if (dict[el.dataset.i18n]) el.textContent = dict[el.dataset.i18n]; });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === cur)));
    paintOnboardText();
    paintProfile();
    renderRequests();
    paintPageErr();
    try { localStorage.setItem('sam-lang', cur); } catch (e) {}
  }

  // ------- dates -------------------------------------------------------------
  // full years between a yyyy-mm-dd date and today; NaN for garbage
  function ageOf(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); if (!m) return NaN;
    const d = new Date(+m[1], +m[2] - 1, +m[3]), now = new Date();
    if (d.getMonth() !== +m[2] - 1) return NaN;
    let age = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
    return age;
  }
  const isoDay = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  function boundDateInput(el) {
    const now = new Date();
    el.max = isoDay(new Date(now.getFullYear() - 16, now.getMonth(), now.getDate()));
    el.min = isoDay(new Date(now.getFullYear() - 120, now.getMonth(), now.getDate()));
  }
  /** '' when the date is fine, otherwise the text to show */
  function birthProblem(ymd) {
    const age = ageOf(ymd);
    if (isNaN(age) || age < 0 || age > 120) return T().errBirth;
    if (age < 16) return T().errBirthAge;
    return '';
  }
  // Dates are written out from our own month names: browsers often ship no Armenian
  // locale and silently print the system language instead.
  // A date of birth has no time zone: format the calendar day as written.
  function fmtBirth(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); if (!m) return '—';
    return T().date(+m[1], +m[2] - 1, +m[3], T().months);
  }
  // a moment → its calendar day in Yerevan (UTC+4 all year)
  function fmtDay(ts) {
    const d = new Date(new Date(ts).getTime() + 4 * 3600e3);
    return isNaN(d) ? '' : T().date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), T().months);
  }
  function rpcErrText(e) {
    const m = (e && e.message) || '';
    if (/birth_date_invalid|birth_date_required/.test(m)) return T().errBirth;
    return T().errSave;
  }
  function setMsg(el, text) { if (!el) return; el.textContent = text || ''; el.hidden = !text; }

  // ------- painting ----------------------------------------------------------
  function paintProfile() {
    if (!profile) return;
    const nameEl = $('#greet');
    if (nameEl) nameEl.textContent = profile.full_name || profile.email || '';
    const badge = $('#role-badge');
    if (badge) { badge.textContent = T().roles[profile.role] || profile.role; badge.hidden = false; }
    const bv = $('#birth-value'); if (bv) bv.textContent = fmtBirth(profile.birth_date);
  }
  function paintOnboardText() {
    const p = $('#onboard [data-i18n="onbText"]');
    if (p) p.textContent = onboardNeedsBirth ? T().onbText : T().onbTextConsent;
  }
  function paintPageErr() { setMsg($('#cabinet-error'), pageErr ? T()[pageErr] : ''); }

  function renderRequests() {
    const list = $('#requests'), empty = $('#requests-empty');
    if (!list) return;
    if (requestsErr) { hide(empty); list.innerHTML = '<p class="msg" data-kind="err">' + escapeHtml(T().loadErr) + '</p>'; return; }
    if (!requests.length) { list.innerHTML = ''; show(empty); return; }
    hide(empty);
    const t = T();
    list.innerHTML = requests.map((r) => {
      const title = (r.tour_title && (r.tour_title[cur] || r.tour_title.en)) || t.request;
      return `
      <article class="booking">
        <div class="booking__head">
          <h3>${escapeHtml(title)}</h3>
          <span class="booking__status status--${escapeHtml(r.status)}">${escapeHtml(t.statuses[r.status] || r.status)}</span>
        </div>
        <time class="booking__time" datetime="${escapeHtml(r.created_at)}">${escapeHtml(fmtDay(r.created_at))}</time>
      </article>`;
    }).join('');
  }

  // ------- flow --------------------------------------------------------------
  async function initCabinet() {
    cur = initialLang();
    $$('.lang button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)));
    applyLang(cur);   // paint static strings immediately

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace(AUTH_URL); return; }

    const out = $('#btn-logout');
    if (out) out.addEventListener('click', async () => {
      await sb.auth.signOut();
      location.replace(AUTH_URL);
    });

    const { data, error } = await sb.rpc('my_profile');
    if (error || !data) { console.error(error); pageErr = 'profileErr'; paintPageErr(); return; }
    profile = data;

    // No date of birth (Google / Mail.ru) or the consent question was never asked:
    // the cabinet does not open until the first-login screen is answered.
    if (!profile.onboarded || !profile.birth_date) await runOnboarding();

    paintProfile();
    // the team (owner, managers, marketer) get a door into admin.html
    if (['admin', 'manager', 'marketer'].includes(profile.role)) show($('#btn-panel'));
    wireBirthEdit();
    show($('#cabinet'));

    const res = await sb.rpc('my_requests');
    requests = res.data || []; requestsErr = res.error || null;
    if (res.error) console.error(res.error);
    renderRequests();
  }

  function runOnboarding() {
    return new Promise((resolve) => {
      const modal = $('#onboard'), form = $('#onboard-form'), birth = $('#onboard-birth');
      const consent = $('#onboard-consent'), btn = $('#onboard-save'), msg = $('#onboard-msg');
      onboardNeedsBirth = !profile.birth_date;
      $('#onboard-birth-field').hidden = !onboardNeedsBirth;
      boundDateInput(birth);
      consent.checked = !!profile.marketing_consent;
      paintOnboardText();
      show(modal);
      (onboardNeedsBirth ? birth : consent).focus();

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setMsg(msg, '');
        if (onboardNeedsBirth) {
          const problem = birthProblem(birth.value);
          if (problem) { setMsg(msg, problem); birth.focus(); return; }
        }
        btn.disabled = true;
        const { data, error } = await sb.rpc('finish_onboarding', {
          p_birth_date: onboardNeedsBirth ? birth.value : null, p_consent: consent.checked,
        });
        btn.disabled = false;
        if (error || !data) { console.error(error); setMsg(msg, rpcErrText(error)); return; }
        profile = data;
        hide(modal);
        resolve();
      });
    });
  }

  function wireBirthEdit() {
    const form = $('#birth-form'), inp = $('#birth-input'), msg = $('#birth-msg'), change = $('#birth-change');
    if (!form) return;
    boundDateInput(inp);
    const close = () => { hide(form); show(change); setMsg(msg, ''); };
    change.addEventListener('click', () => { inp.value = (profile.birth_date || '').slice(0, 10); show(form); hide(change); inp.focus(); });
    $('#birth-cancel').addEventListener('click', close);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setMsg(msg, '');
      const problem = birthProblem(inp.value);
      if (problem) { setMsg(msg, problem); return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { data, error } = await sb.rpc('set_birth_date', { p_date: inp.value });
      btn.disabled = false;
      if (error || !data) { console.error(error); setMsg(msg, rpcErrText(error)); return; }
      profile = data;
      paintProfile();
      close();
    });
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
