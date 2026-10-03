/* ============================================================================
   Analytics + cookie consent (GA4 + Meta Pixel)
   ----------------------------------------------------------------------------
   Privacy-first: Google Consent Mode v2 defaults everything to "denied", and no
   tracker loads until the visitor presses "Accept". The choice is remembered in
   localStorage ('sam-consent' = granted | denied); "Decline" keeps everything off.

   The IDs are set in the marketing panel (admin.html → SEO и пиксели); js/cms.js
   hands them over via window.SAM_ANALYTICS + the 'sam:analytics' event. The two
   constants below are only a fallback for a site running without the database.
   Each tracker loads on its own once its ID is real (no "XXXX").
   ========================================================================== */
(function () {
  'use strict';

  var GA_ID = 'G-XXXXXXXXXX';       // TODO: GA4 Measurement ID (Admin → Data streams)
  var FB_ID = 'XXXXXXXXXXXXXXX';    // TODO: Meta Pixel ID (Events Manager)

  var CONSENT_KEY = 'sam-consent';
  function ids() {
    var a = window.SAM_ANALYTICS || {};
    var ga = /^G-[A-Z0-9]{6,12}$/.test(a.ga4 || '') ? a.ga4 : GA_ID, fb = /^\d{10,20}$/.test(a.pixel || '') ? a.pixel : FB_ID;
    return { ga: ga.indexOf('XXXX') === -1 ? ga : '', fb: fb.indexOf('XXXX') === -1 ? fb : '' };
  }

  /* ---- banner copy in the site's three languages ---- */
  var STR = {
    en: { text: 'We use cookies to measure traffic and improve the site.', ok: 'Accept', no: 'Decline', more: 'Privacy' },
    ru: { text: 'Мы используем cookie, чтобы измерять трафик и улучшать сайт.', ok: 'Принять', no: 'Отклонить', more: 'Конфиденциальность' },
    hy: { text: 'Օգտագործում ենք cookie-ներ՝ երթևեկությունը չափելու և կայքը բարելավելու համար։', ok: 'Ընդունել', no: 'Մերժել', more: 'Գաղտնիություն' }
  };
  function lang() {
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (q && STR[q]) return q;
      var s = localStorage.getItem('sam-lang');
      if (s && STR[s]) return s;
    } catch (e) {}
    return 'en';
  }
  function getConsent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {} }

  /* ---- Consent Mode v2: deny by default, before any Google tag exists ---- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  /* ---- load the trackers (only after consent, only when IDs are set) ---- */
  var loaded = { ga: false, fb: false };
  function loadTrackers() {
    var id = ids();
    if (id.ga && !loaded.ga) { loaded.ga = true; loadGA(id.ga); }
    if (id.fb && !loaded.fb) { loaded.fb = true; loadFB(id.fb); }
  }
  function loadGA(GA_ID) {
    /* GA4 (gtag.js) */
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(g);
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  }
  function loadFB(FB_ID) {
    /* Meta Pixel */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', FB_ID);
    window.fbq('track', 'PageView');
  }

  function grant() {
    setConsent('granted');
    gtag('consent', 'update', {
      ad_storage: 'granted', ad_user_data: 'granted',
      ad_personalization: 'granted', analytics_storage: 'granted'
    });
    loadTrackers();
    removeBanner();
  }
  function deny() { setConsent('denied'); removeBanner(); }

  /* ---- banner ---- */
  var bannerEl = null;
  function removeBanner() { if (bannerEl && bannerEl.parentNode) { bannerEl.parentNode.removeChild(bannerEl); bannerEl = null; } }
  function buildBanner() {
    var t = STR[lang()] || STR.en;
    var el = document.createElement('div');
    el.className = 'cc';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookies');
    el.innerHTML =
      '<p class="cc__text">' + t.text +
        ' <a class="cc__more" href="#privacy">' + t.more + '</a></p>' +
      '<div class="cc__actions">' +
        '<button type="button" class="cc__btn cc__btn--no" data-cc="no">' + t.no + '</button>' +
        '<button type="button" class="cc__btn cc__btn--ok" data-cc="ok">' + t.ok + '</button>' +
      '</div>';
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cc]'); if (!b) return;
      if (b.dataset.cc === 'ok') grant(); else deny();
    });
    return el;
  }
  function showBanner() {
    if (bannerEl) return;
    bannerEl = buildBanner();
    document.body.appendChild(bannerEl);
    /* keep the banner text in sync if the visitor switches language while it is open */
    document.querySelectorAll('.lang button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!bannerEl) return;
        var t = STR[lang()] || STR.en;
        bannerEl.querySelector('.cc__text').firstChild.textContent = t.text + ' ';
        bannerEl.querySelector('.cc__more').textContent = t.more;
        bannerEl.querySelector('.cc__btn--no').textContent = t.no;
        bannerEl.querySelector('.cc__btn--ok').textContent = t.ok;
      });
    });
  }

  /* IDs arrive from the panel after the page loads */
  document.addEventListener('sam:analytics', function () { if (getConsent() === 'granted') loadTrackers(); });

  /* ---- boot ---- */
  var prior = getConsent();
  if (prior === 'granted') { grant(); return; }   // returning visitor who accepted
  if (prior === 'denied') { return; }             // returning visitor who declined
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
})();
