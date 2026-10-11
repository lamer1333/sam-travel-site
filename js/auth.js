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
//   set_consent(c)             switch the mailing consent on or off (110_fixes.sql)
// «Forgot password» on the site sends a link that opens this page: the new password is
// asked for here, before the cabinet (PASSWORD_RECOVERY).
// The cabinet is the profile only (TZ-BACKEND.md §0 п.22): the site has no request form,
// so there is no list of requests here.
// ---------------------------------------------------------------------------
(function () {
  const sb = window.sb;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));
  const AUTH_URL = 'index.html#auth';   // where an unauthenticated visitor is sent

  // The recovery link carries its mark in the address; supabase-js removes it once the session
  // is read, and may announce PASSWORD_RECOVERY before the page is ready — so both are caught here.
  const inUrl = (re) => re.test(location.hash) || re.test(location.search);
  let recovery = inUrl(/[#&?]type=recovery(&|$)/);
  const linkError = inUrl(/[#&?]error(_code|_description)?=/);
  let onRecovery = null;
  if (sb) sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') { recovery = true; if (onRecovery) onRecovery(); } });

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  // ------- i18n (en is also the markup default) ------------------------------
  const I18N = {
    en: {
      signOut: 'Sign out', toSite: 'Back to site', panel: 'Control panel', hi: 'Hi', lead: 'Your details are below.',
      profileH: 'Profile', birthLabel: 'Date of birth', change: 'Change', save: 'Save', cancel: 'Cancel',
      onbTitle: 'One quick thing', onbText: 'We need your date of birth to open your account.',
      onbTextConsent: 'Would you like to hear about deals and discounts?',
      onbConsent: 'Yes, send me deals, discounts and coupons by email. I can unsubscribe anytime.',
      onbContinue: 'Continue',
      errBirth: 'Enter a valid date of birth.', errBirthAge: 'An account is available from the age of 16.',
      errSave: 'Could not save. Check the connection and try again.',
      profileErr: 'Could not load your account. Refresh the page or sign in again.',
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      date: (y, m, d, mo) => d + ' ' + mo[m] + ' ' + y,
      consentLabel: 'Deals and discounts by email', consentOn: 'Subscribed', consentOff: 'Not subscribed',
      consentNote: 'Offers, discounts and promo codes. You can switch it off at any time.',
      recTitle: 'New password', recText: 'Choose a new password for your account — at least 10 characters.',
      recPass: 'New password', recPass2: 'Repeat the password', recSave: 'Save the password',
      recShort: 'The password must be at least 10 characters.', recDiff: 'The two passwords do not match.',
      recSame: 'The new password must differ from the old one.', recDone: 'The password has been changed.',
      recExpired: 'This link has expired or was already used. Ask for a new one: Sign in → Forgot password.',
      roles: { client: 'client', manager: 'manager', marketer: 'marketer', content: 'content', admin: 'owner' },
    },
    ru: {
      signOut: 'Выйти', toSite: 'На сайт', panel: 'Панель управления', hi: 'Привет', lead: 'Ваши данные — ниже.',
      profileH: 'Профиль', birthLabel: 'Дата рождения', change: 'Изменить', save: 'Сохранить', cancel: 'Отмена',
      onbTitle: 'Один момент', onbText: 'Чтобы открыть кабинет, укажите дату рождения.',
      onbTextConsent: 'Хотите получать акции и скидки?',
      onbConsent: 'Да, присылайте мне акции, скидки и купоны на email. Отписаться можно в любой момент.',
      onbContinue: 'Продолжить',
      errBirth: 'Укажите корректную дату рождения.', errBirthAge: 'Кабинет доступен с 16 лет.',
      errSave: 'Не удалось сохранить. Проверьте связь и попробуйте ещё раз.',
      profileErr: 'Не удалось загрузить кабинет. Обновите страницу или войдите заново.',
      months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      date: (y, m, d, mo) => d + ' ' + mo[m] + ' ' + y,
      consentLabel: 'Акции и скидки на email', consentOn: 'Вы подписаны', consentOff: 'Вы не подписаны',
      consentNote: 'Предложения, скидки и промокоды. Отключить можно в любой момент.',
      recTitle: 'Новый пароль', recText: 'Придумайте новый пароль для своего аккаунта — не короче 10 символов.',
      recPass: 'Новый пароль', recPass2: 'Повторите пароль', recSave: 'Сохранить пароль',
      recShort: 'Пароль должен быть не короче 10 символов.', recDiff: 'Пароли не совпадают.',
      recSame: 'Новый пароль должен отличаться от прежнего.', recDone: 'Пароль изменён.',
      recExpired: 'Ссылка устарела или уже использована. Запросите новую: «Вход» → «Забыли пароль?».',
      roles: { client: 'клиент', manager: 'менеджер', marketer: 'маркетолог', content: 'контент', admin: 'владелец' },
    },
    hy: {
      signOut: 'Ելք', toSite: 'Դեպի կայք', panel: 'Կառավարման վահանակ', hi: 'Բարև', lead: 'Ձեր տվյալները՝ ստորև։',
      profileH: 'Պրոֆիլ', birthLabel: 'Ծննդյան ամսաթիվ', change: 'Փոխել', save: 'Պահպանել', cancel: 'Չեղարկել',
      onbTitle: 'Մեկ պահ', onbText: 'Անձնական էջը բացելու համար նշեք ձեր ծննդյան ամսաթիվը։',
      onbTextConsent: 'Ցանկանո՞ւմ եք ստանալ ակցիաներ և զեղչեր։',
      onbConsent: 'Այո, ուղարկեք ինձ ակցիաներ, զեղչեր և կտրոններ էլ. փոստով։ Կարող եմ ցանկացած պահի չեղարկել բաժանորդագրությունը։',
      onbContinue: 'Շարունակել',
      errBirth: 'Նշեք ճիշտ ծննդյան ամսաթիվ։', errBirthAge: 'Անձնական էջը հասանելի է 16 տարեկանից։',
      errSave: 'Չհաջողվեց պահպանել։ Ստուգեք կապը և փորձեք կրկին։',
      profileErr: 'Չհաջողվեց բեռնել անձնական էջը։ Թարմացրեք էջը կամ նորից մուտք գործեք։',
      months: ['հունվարի', 'փետրվարի', 'մարտի', 'ապրիլի', 'մայիսի', 'հունիսի', 'հուլիսի', 'օգոստոսի', 'սեպտեմբերի', 'հոկտեմբերի', 'նոյեմբերի', 'դեկտեմբերի'],
      date: (y, m, d, mo) => y + ' թ. ' + mo[m] + ' ' + d,
      consentLabel: 'Ակցիաներ և զեղչեր էլ. փոստով', consentOn: 'Դուք բաժանորդագրված եք', consentOff: 'Դուք բաժանորդագրված չեք',
      consentNote: 'Առաջարկներ, զեղչեր և պրոմոկոդեր։ Կարող եք անջատել ցանկացած պահի։',
      recTitle: 'Նոր գաղտնաբառ', recText: 'Ընտրեք նոր գաղտնաբառ ձեր հաշվի համար՝ առնվազն 10 նիշ։',
      recPass: 'Նոր գաղտնաբառ', recPass2: 'Կրկնեք գաղտնաբառը', recSave: 'Պահպանել գաղտնաբառը',
      recShort: 'Գաղտնաբառը պետք է լինի առնվազն 10 նիշ։', recDiff: 'Գաղտնաբառերը չեն համընկնում։',
      recSame: 'Նոր գաղտնաբառը պետք է տարբերվի նախորդից։', recDone: 'Գաղտնաբառը փոխված է։',
      recExpired: 'Հղումը ժամկետանց է կամ արդեն օգտագործվել է։ Պահանջեք նորը՝ «Մուտք» → «Մոռացե՞լ եք գաղտնաբառը»։',
      roles: { client: 'հաճախորդ', manager: 'մենեջեր', marketer: 'մարքեթոլոգ', content: 'բովանդակություն', admin: 'սեփականատեր' },
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
  let profile = null, pageErr = '', onboardNeedsBirth = true;

  function applyLang(lang) {
    cur = I18N[lang] ? lang : 'en';
    document.documentElement.setAttribute('lang', cur);
    const dict = T();
    $$('[data-i18n]').forEach((el) => { if (dict[el.dataset.i18n]) el.textContent = dict[el.dataset.i18n]; });
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === cur)));
    paintOnboardText();
    paintProfile();
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
    const cv = $('#consent-value'), ct = $('#consent-toggle');
    if (cv) cv.textContent = profile.marketing_consent ? T().consentOn : T().consentOff;
    if (ct) ct.checked = !!profile.marketing_consent;
  }
  function paintOnboardText() {
    const p = $('#onboard [data-i18n="onbText"]');
    if (p) p.textContent = onboardNeedsBirth ? T().onbText : T().onbTextConsent;
  }
  function paintPageErr() { setMsg($('#cabinet-error'), pageErr ? T()[pageErr] : ''); }

  // ------- flow --------------------------------------------------------------
  async function initCabinet() {
    cur = initialLang();
    $$('.lang button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)));
    applyLang(cur);   // paint static strings immediately

    const { data: { session } } = await sb.auth.getSession();
    // a recovery link that has expired brings an error instead of a session: say so, do not just bounce
    if (!session && linkError) { pageErr = 'recExpired'; paintPageErr(); return; }
    if (!session) { location.replace(AUTH_URL); return; }
    // came by the link from the «Forgot password» email: the new password first
    if (recovery) await runRecovery();
    else onRecovery = runRecovery;

    const out = $('#btn-logout');
    if (out) out.addEventListener('click', async () => {
      await sb.auth.signOut();
      location.replace(AUTH_URL);
    });

    const { data, error } = await sb.rpc('my_profile');
    if (error || !data) { console.error(error); pageErr = 'profileErr'; paintPageErr(); return; }
    profile = data;

    // No date of birth (Google) or the consent question was never asked:
    // the cabinet does not open until the first-login screen is answered.
    if (!profile.onboarded || !profile.birth_date) await runOnboarding();

    paintProfile();
    // the team (owner, managers, marketer) get a door into admin.html
    if (['admin', 'manager', 'marketer', 'content'].includes(profile.role)) show($('#btn-panel'));
    wireBirthEdit();
    wireConsent();
    show($('#cabinet'));
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

  // the mailing consent: the switch saves at once and goes back if the database refused
  function wireConsent() {
    const t = $('#consent-toggle'), msg = $('#consent-msg');
    if (!t) return;
    t.addEventListener('change', async () => {
      setMsg(msg, '');
      t.disabled = true;
      const { data, error } = await sb.rpc('set_consent', { p_consent: t.checked });
      t.disabled = false;
      if (error || !data) { console.error(error); setMsg(msg, T().errSave); } else profile = data;
      paintProfile();
    });
  }

  // «Forgot password»: the new password, twice, at least 10 characters (TZ-BACKEND.md §8)
  let recovering = null;
  function runRecovery() {
    if (recovering) return recovering;
    recovering = new Promise((resolve) => {
      const modal = $('#recover'), form = $('#recover-form'), p1 = $('#recover-pass'), p2 = $('#recover-pass2');
      const btn = $('#recover-save'), msg = $('#recover-msg');
      show(modal); p1.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setMsg(msg, '');
        if (p1.value.length < 10) { setMsg(msg, T().recShort); p1.focus(); return; }
        if (p1.value !== p2.value) { setMsg(msg, T().recDiff); p2.focus(); return; }
        btn.disabled = true;
        const { error } = await sb.auth.updateUser({ password: p1.value });
        btn.disabled = false;
        if (error) {
          console.error(error);
          const m = error.message || '';
          setMsg(msg, /different from the old|same_password/i.test(m) ? T().recSame : /at least|weak|short/i.test(m) ? T().recShort : T().errSave);
          return;
        }
        recovery = false;
        hide(modal); p1.value = p2.value = '';
        const done = $('#cabinet-error');
        if (done) { done.dataset.kind = 'ok'; setMsg(done, T().recDone); setTimeout(() => { done.dataset.kind = 'err'; paintPageErr(); }, 6000); }
        resolve();
      });
    });
    return recovering;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'cabinet') initCabinet();
  });
})();
