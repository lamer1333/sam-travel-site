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
// The site has no request form (TZ-BACKEND.md §0 п.22), so there is no list of requests here.
// What the cabinet does show is the person's own trip — the two pages of the site they fill
// in before talking to a manager, kept by js/travel.js (150_travel.sql):
//   «My trip»       what was chosen on «Plan your trip» (index.html#plan)
//   «My documents»  the checklist (index.html#checklist), with the same ticks
// Depends on js/pages.js (the checklist and the destinations), js/wa.js, js/travel.js.
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
      tag: 'Your account', lead0: 'Start with a trip or with your documents — everything is kept here.', lead1: 'Your trip and your documents, in one place.',
      stepTrip: 'Trip', stepDocs: 'Documents', stepTalk: 'Manager', stepTalkSub: 'A real price for your dates',
      stepTripTodo: 'Choose where and when', stepDocsTodo: 'Pick a country',
      tripH: 'My trip', tripEmptyT: 'Where are we flying?', tripEmptyP: 'Pick a destination and dates — a manager replies with a real price, not a range.',
      tripStart: 'Plan a trip', tripEdit: 'Change the trip', tripAsk: 'Get the price on WhatsApp', tripNoDest: 'Destination not chosen yet',
      fDates: 'Dates', fPeople: 'Travellers', fMeals: 'Meals', notSet: 'Not set',
      inDays: (n) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days'),
      docsH: 'My documents', docsEmptyT: 'Which country?', docsEmptyP: 'Pick a country — we show exactly what to collect.',
      docsProgress: 'Collected', docsLeft: 'Still to collect', docsAll: 'Open the full list', docsOther: 'Another country',
      docsMore: (n) => 'and ' + n + ' more in the full list',
      helpH: 'Your manager', helpT: 'A person on the other end', helpP: 'Your manager sees the trip and the documents you saved here, so there is no need to explain it all again. Write to us — we answer on WhatsApp.',
      helpWa: 'Write on WhatsApp',
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
      tag: 'Личный кабинет', lead0: 'Начните с поездки или со списка документов — всё сохранится здесь.', lead1: 'Ваша поездка и документы — в одном месте.',
      stepTrip: 'Поездка', stepDocs: 'Документы', stepTalk: 'Менеджер', stepTalkSub: 'Реальная цена на ваши даты',
      stepTripTodo: 'Выберите, куда и когда', stepDocsTodo: 'Выберите страну',
      tripH: 'Моя поездка', tripEmptyT: 'Куда летим?', tripEmptyP: 'Выберите направление и даты — менеджер ответит реальной ценой, а не диапазоном.',
      tripStart: 'Спланировать поездку', tripEdit: 'Изменить поездку', tripAsk: 'Узнать цену в WhatsApp', tripNoDest: 'Направление пока не выбрано',
      fDates: 'Даты', fPeople: 'Путешественники', fMeals: 'Питание', notSet: 'Не указано',
      inDays: (n) => (n === 0 ? 'Сегодня' : n === 1 ? 'Завтра' : 'Через ' + n + ' дн.'),
      docsH: 'Мои документы', docsEmptyT: 'В какую страну?', docsEmptyP: 'Выберите страну — покажем, что именно собрать.',
      docsProgress: 'Собрано', docsLeft: 'Осталось собрать', docsAll: 'Открыть весь список', docsOther: 'Другая страна',
      docsMore: (n) => 'и ещё ' + n + ' — в полном списке',
      helpH: 'Ваш менеджер', helpT: 'На связи человек, а не бот', helpP: 'Менеджер видит поездку и документы, которые вы здесь сохранили, — объяснять заново не придётся. Напишите нам, отвечаем в WhatsApp.',
      helpWa: 'Написать в WhatsApp',
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
      tag: 'Անձնական էջ', lead0: 'Սկսեք ուղևորությունից կամ փաստաթղթերի ցանկից. ամեն ինչ կպահպանվի այստեղ։', lead1: 'Ձեր ուղևորությունը և փաստաթղթերը՝ մեկ տեղում։',
      stepTrip: 'Ուղևորություն', stepDocs: 'Փաստաթղթեր', stepTalk: 'Մենեջեր', stepTalkSub: 'Իրական գին ձեր ամսաթվերի համար',
      stepTripTodo: 'Ընտրեք՝ ուր և երբ', stepDocsTodo: 'Ընտրեք երկիրը',
      tripH: 'Իմ ուղևորությունը', tripEmptyT: 'Ո՞ւր ենք թռչում', tripEmptyP: 'Ընտրեք ուղղությունը և ամսաթվերը. մենեջերը կպատասխանի իրական գնով, ոչ թե մոտավոր։',
      tripStart: 'Պլանավորել ուղևորությունը', tripEdit: 'Փոխել ուղևորությունը', tripAsk: 'Իմանալ գինը WhatsApp-ով', tripNoDest: 'Ուղղությունը դեռ ընտրված չէ',
      fDates: 'Ամսաթվեր', fPeople: 'Ճամփորդներ', fMeals: 'Սնունդ', notSet: 'Նշված չէ',
      inDays: (n) => (n === 0 ? 'Այսօր' : n === 1 ? 'Վաղը' : n + ' օրից'),
      docsH: 'Իմ փաստաթղթերը', docsEmptyT: 'Ո՞ր երկիր', docsEmptyP: 'Ընտրեք երկիրը. ցույց կտանք, թե ինչ է պետք հավաքել։',
      docsProgress: 'Հավաքված է', docsLeft: 'Մնում է հավաքել', docsAll: 'Բացել ամբողջ ցանկը', docsOther: 'Այլ երկիր',
      docsMore: (n) => 'և ևս ' + n + '՝ ամբողջ ցանկում',
      helpH: 'Ձեր մենեջերը', helpT: 'Կապի մեջ մարդ է, ոչ թե բոտ', helpP: 'Մենեջերը տեսնում է այստեղ պահպանված ձեր ուղևորությունը և փաստաթղթերը. նորից բացատրելու կարիք չկա։ Գրեք մեզ, պատասխանում ենք WhatsApp-ով։',
      helpWa: 'Գրել WhatsApp-ով',
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
    $$('[data-i18n]').forEach((el) => { if (typeof dict[el.dataset.i18n] === 'string') el.textContent = dict[el.dataset.i18n]; });
    $$('[data-i18n-label]').forEach((el) => el.setAttribute('aria-label', dict[el.dataset.i18nLabel] || ''));
    $$('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === cur)));
    paintOnboardText();
    paintProfile();
    paintTravel();
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
    const name = (profile.full_name || '').trim(), mail = profile.email || '';
    // greet by the first name; the full one is in the profile card
    $('#greet').textContent = name.split(/\s+/)[0] || mail;
    $('#who-name').textContent = name || mail;
    $('#who-mail').textContent = name ? mail : '';
    $('#who-pic').textContent = Array.from(name || mail).slice(0, 1).join('').toUpperCase();
    // a client is not told they are a «client»; the team sees which role they are signed in with
    const badge = $('#role-badge'), staff = profile.role !== 'client';
    if (staff) badge.textContent = T().roles[profile.role] || profile.role;
    badge.hidden = !staff;
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

  // ------- my trip · my documents ---------------------------------------------
  const P = window.SAM_PAGES || { CUI: {}, CDATA: {}, PDEST: {}, PUI: {} }, TR = window.SAM_TRAVEL;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
  const Lz = (o) => (o && (o[cur] || o.en)) || '';
  const DOCS_SHOWN = 4;             // the cabinet lists the next few; the whole list is on the site
  let WA = '37455957585', contacts = null, pickingCountry = false, travelReady = false;
  const waUrl = (text) => 'https://wa.me/' + WA + '?text=' + encodeURIComponent(text);

  /** whole days from today to a yyyy-mm-dd date; NaN for garbage */
  function daysUntil(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); if (!m) return NaN;
    const now = new Date();
    return Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  }

  function paintTrip(plan) {
    const t = T(), u = P.PUI[cur] || P.PUI.en || {}, has = TR.hasPlan(plan);
    const dest = own(P.PDEST, plan.dest) ? Lz(P.PDEST[plan.dest]) : '';
    $('#trip-title').textContent = has ? (dest || t.tripNoDest) : t.tripEmptyT;
    const days = daysUntil(plan.from), when = $('#trip-when');
    when.hidden = !(has && days >= 0);
    if (!when.hidden) when.textContent = t.inDays(days);
    $('#trip-empty').hidden = has;
    $('#trip-facts').hidden = !has;
    const dates = plan.from && plan.to ? fmtBirth(plan.from) + ' — ' + fmtBirth(plan.to) : plan.from ? fmtBirth(plan.from) : '';
    const meals = plan.meals.map((k) => u[k] || k).join(', ');
    $('#trip-dates').textContent = dates || t.notSet;
    $('#trip-people').textContent = plan.people || t.notSet;
    $('#trip-meals').textContent = meals || t.notSet;
    const edit = $('#trip-edit'), wa = $('#trip-wa');
    edit.textContent = has ? t.tripEdit : t.tripStart;
    edit.className = 'btn ' + (has ? 'btn--ghost' : 'btn--brand');
    wa.hidden = !has;
    // the same message the «Plan your trip» page writes (js/app.js, pWhatsapp)
    if (has && window.SAM_WA) {
      wa.href = waUrl(window.SAM_WA.text('custom', cur, { body: [u.msgGreeting,
        u.msgDestination + ': ' + (dest || u.msgNotChosen), u.msgTravelers + ': ' + (plan.people || 1),
        u.msgDates + ': ' + (dates || u.msgNotChosen), u.msgMeals + ': ' + (meals || u.msgNoMeals)].join('\n') }));
    }
    return dest;
  }

  /** the checklist of the chosen country in the order the site shows it: required first */
  function docItems(c) {
    if (!own(P.CDATA, c.dest)) return null;
    const types = P.CDATA[c.dest].types, type = own(types, c.type) ? c.type : Object.keys(types)[0];
    const items = types[type].items.slice().sort((a, b) => (a.tag === b.tag ? 0 : a.tag === 'required' ? -1 : 1));
    return { type, label: P.CDATA[c.dest].flag + ' ' + Lz(P.CDATA[c.dest].label) + ' · ' + Lz(types[type].label),
      items: items.map((it, i) => ({ id: c.dest + '-' + type + '-' + i, it })) };
  }

  function paintFlight(pct) {
    const path = $('#d-path'), fill = $('#d-fill'), track = $('#d-track'), plane = $('#d-plane');
    if (!track.clientWidth) return;
    const total = path.getTotalLength(), k = track.clientWidth / 380;
    fill.style.strokeDasharray = total;
    fill.style.strokeDashoffset = total * (1 - pct);
    const pt = path.getPointAtLength(total * pct), ahead = path.getPointAtLength(Math.min(total, total * pct + 4));
    const angle = pct >= 1 ? 0 : Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * (180 / Math.PI);
    plane.style.left = (pt.x * k) + 'px'; plane.style.top = (pt.y * k) + 'px';
    plane.style.transform = 'translate(-50%,-50%) rotate(' + angle + 'deg)';
  }

  function paintDocs(c) {
    const t = T(), u = P.CUI[cur] || P.CUI.en || {}, d = pickingCountry ? null : docItems(c);
    $('#docs-empty').hidden = !!d;
    $('#docs-full').hidden = !d;
    $('#docs-sub').textContent = d ? d.label : '';
    if (!d) {
      const row = $('#docs-chips'); row.textContent = '';
      Object.keys(P.CDATA).forEach((key) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip';
        b.textContent = P.CDATA[key].flag + ' ' + Lz(P.CDATA[key].label);
        b.addEventListener('click', () => {
          const s = TR.get().checklist;
          TR.setChecklist({ dest: key, type: Object.keys(P.CDATA[key].types)[0], checked: s.checked });
          pickingCountry = false; paintTravel();
        });
        row.appendChild(b);
      });
      return { done: 0, total: 0 };
    }
    const todo = d.items.filter((x) => !c.checked[x.id]), total = d.items.length, done = total - todo.length;
    $('#d-count').textContent = done + ' / ' + total;
    paintFlight(total ? done / total : 0);
    const all = total > 0 && done === total;
    $('#docs-done').hidden = !all; $('#docs-done').textContent = u.landedText || '';
    $('#docs-todo').hidden = all;
    $('#docs-open').href = 'index.html#checklist/' + c.dest + '/' + d.type;
    const ul = $('#d-list'); ul.textContent = '';
    todo.slice(0, DOCS_SHOWN).forEach((x) => {
      const li = document.createElement('li'), lab = document.createElement('label'), inp = document.createElement('input');
      li.className = 'citem'; inp.type = 'checkbox';
      const box = document.createElement('span'); box.className = 'box';
      box.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
      const txt = document.createElement('span'), title = document.createElement('span'), tag = document.createElement('span');
      title.className = 'citem__title'; title.textContent = Lz(x.it.t);
      tag.className = 'citem__tag citem__tag--' + (x.it.tag === 'required' ? 'required' : 'conditional'); tag.textContent = u[x.it.tag] || '';
      txt.appendChild(title); txt.appendChild(tag);
      inp.addEventListener('change', () => {
        const s = TR.get().checklist;
        if (inp.checked) s.checked[x.id] = true; else delete s.checked[x.id];
        TR.setChecklist(s);
        li.classList.toggle('is-done', inp.checked);
        // the plane moves at once; the list moves on after the tick has been seen
        const left = d.items.filter((y) => !s.checked[y.id]).length;
        $('#d-count').textContent = (total - left) + ' / ' + total;
        paintFlight((total - left) / total);
        clearTimeout(paintDocs.timer); paintDocs.timer = setTimeout(paintTravel, 700);
      });
      lab.appendChild(inp); lab.appendChild(box); lab.appendChild(txt); li.appendChild(lab); ul.appendChild(li);
    });
    const more = $('#d-more'), rest = todo.length - DOCS_SHOWN;
    more.hidden = rest <= 0; if (rest > 0) more.textContent = t.docsMore(rest);
    return { done, total };
  }

  function paintHelp() {
    const u = P.CUI[cur] || P.CUI.en || {}, c = contacts || {};
    $('#help-addr').textContent = (c.address && (c.address[cur] || c.address.en)) || u.contactAddress || '';
    if (c.phone) { $('#help-phone').textContent = c.phone; $('#help-tel').href = 'tel:' + c.phone.replace(/[^\d+]/g, ''); }
    if (window.SAM_WA) $('#help-wa').href = waUrl(window.SAM_WA.text('general', cur, {}));
  }

  function paintTravel() {
    if (!TR || !travelReady) return;
    const t = T(), s = TR.get();
    const dest = paintTrip(s.plan), docs = paintDocs(s.checklist);
    paintHelp();
    $('#hero-lead').textContent = (TR.hasPlan(s.plan) || TR.hasChecklist(s.checklist)) ? t.lead1 : t.lead0;
    // the three steps: done, next, later
    const tripDone = !!dest, docsDone = docs.total > 0 && docs.done === docs.total;
    $('#step-trip-sub').textContent = dest || t.stepTripTodo;
    $('#step-docs-sub').textContent = docs.total ? docs.done + ' / ' + docs.total : t.stepDocsTodo;
    const next = !tripDone ? 'trip' : !docsDone ? 'docs' : 'talk';
    [['trip', tripDone], ['docs', docsDone], ['talk', false]].forEach(([k, done]) => {
      const el = $('#step-' + k); el.classList.toggle('is-done', done); el.classList.toggle('is-next', k === next);
    });
  }

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
      // what is still on its way to the account goes first; then this browser forgets the trip
      if (TR) { await TR.flush(); }
      await sb.auth.signOut();
      if (TR) TR.forget();
      location.replace(AUTH_URL);
    });

    const { data, error } = await sb.rpc('my_profile');
    if (error || !data) { console.error(error); pageErr = 'profileErr'; paintPageErr(); return; }
    profile = data;

    // No date of birth (Google) or the consent question was never asked:
    // the cabinet does not open until the first-login screen is answered.
    if (!profile.onboarded || !profile.birth_date) await runOnboarding();

    paintProfile();
    // the trip and the documents: take what the account holds, then paint
    if (TR) {
      await TR.sync();
      travelReady = true;
      $('#docs-other').addEventListener('click', () => { pickingCountry = true; paintTravel(); });
      window.addEventListener('resize', paintTravel);
      // the WhatsApp number, the phone and the address are set in the panel (Contacts)
      sb.rpc('public_site').then((r) => {
        const c = r.data && r.data.settings && r.data.settings.contacts;
        if (!c) return;
        contacts = c;
        if (/^\d{10,15}$/.test(c.whatsapp || '')) WA = c.whatsapp;
        paintTravel();
      }, () => {});
    }
    // the team (owner, managers, marketer) get a door into admin.html
    if (['admin', 'manager', 'marketer', 'content'].includes(profile.role)) show($('#btn-panel'));
    wireBirthEdit();
    wireConsent();
    show($('#cabinet'));
    paintTravel();   // the plane is placed by the width of its track, so only once the page is shown
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
