/* ============================================================================
   First-party, cookieless analytics for the owner / marketing panels.
   ----------------------------------------------------------------------------
   No cookie, no localStorage, no fingerprint, no IP stored. A visit id is a
   random string kept in memory for this page load only, so "a visit" = one
   opening of the page. What is recorded: which blocks were seen, which buttons
   were pressed, where the visitor came from (UTM tags / referrer domain),
   device class and language. A click on a WhatsApp link also carries the visit's
   reference number: five characters derived from the visit id, the same ones the
   site writes at the end of the WhatsApp message («№ K7M2X») — that is how the
   owner ties a chat to an advert (wa_ref in 070_whatsapp.sql). Events are sent in small batches to the
   `track` RPC (supabase/migrations/002_admin.sql), and only after js/cms.js has confirmed the
   backend is there — a site without the database never sends anything.
   ========================================================================== */
(function () {
  'use strict';
  var sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  /* five characters without look-alikes (no 0/O, no 1/I/L); the same function as refOf() in js/admin/metrics.js */
  function refOf(s) {
    var h = 2166136261, i, out = '';
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h >>>= 0;
    for (i = 0; i < 5; i++) { out += '23456789ABCDEFGHJKMNPQRSTUVWXYZ'.charAt(h % 31); h = Math.floor(h / 31); }
    return out;
  }
  var ref = refOf(sid);
  var q = new URLSearchParams(location.search);
  var utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) { var v = q.get(k); if (v) utm[k] = v.slice(0, 100); });
  var refHost = '';
  try { if (document.referrer) { var r = new URL(document.referrer); if (r.host !== location.host) refHost = r.host.replace(/^www\./, ''); } } catch (e) {}
  var w = Math.min(screen.width || innerWidth, innerWidth);
  var device = /iPad|Tablet/i.test(navigator.userAgent) || (w >= 600 && w < 1024 && 'ontouchstart' in window) ? 'tablet' : w < 768 ? 'mobile' : 'desktop';
  var queue = [], enabled = false, preview = q.has('promo_preview') || q.has('cms'), demo = q.get('cms') === 'demo';
  /* The first event (page_view) is sent before js/app.js has switched the page to the visitor's
     language, so until SAM_LANG exists the language is worked out the way app.js does it:
     ?lang= in the address, else the saved choice, else English. */
  var LANGS = { en: 1, ru: 1, hy: 1 };
  function lang() {
    if (window.SAM_LANG) return window.SAM_LANG();
    var l = q.get('lang');
    if (!(l && LANGS.hasOwnProperty(l))) { try { l = localStorage.getItem('sam-lang'); } catch (e) { l = null; } }
    return l && LANGS.hasOwnProperty(l) ? l : 'en';
  }

  function track(name, props) {
    if (preview && !(demo && name === 'wa_click')) return;
    var e = { sid: sid, name: name, lang: lang(), device: device, ref_host: refHost };
    for (var k in utm) e[k] = utm[k];
    for (var p in (props || {})) e[p] = props[p];
    if (preview) { demoWa(e); return; }
    queue.push(e);
    if (queue.length >= 25) flush();
  }
  /* ?cms=demo: nothing is sent anywhere; the click is left in this browser, where the demo
     panel (admin.html?demo) finds it by the reference number */
  function demoWa(e) {
    try {
      var list = JSON.parse(localStorage.getItem('sam-demo-wa') || '[]');
      e.ts = new Date().toISOString();
      list.push(e);
      localStorage.setItem('sam-demo-wa', JSON.stringify(list.slice(-40)));
    } catch (err) {}
  }
  function flush(beacon) {
    if (!enabled || !queue.length) return;
    var batch = queue.splice(0, 30), cfg = window.SAM_SUPABASE;
    if (!cfg) return;
    /* keepalive lets the last batch survive the tab closing */
    try {
      fetch(cfg.url + '/rest/v1/rpc/track', {
        method: 'POST', keepalive: !!beacon,
        headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
        body: JSON.stringify({ p_events: batch })
      }).catch(function () {});
    } catch (e) {}
  }
  setInterval(flush, 5000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
  window.addEventListener('pagehide', function () { flush(true); });

  window.SAM_TRACK = track;
  /* the reference number js/app.js writes at the end of every WhatsApp message */
  window.SAM_REF = ref;
  /* read by js/cms.js: which device and campaign a promo is shown to */
  window.SAM_TRACK_CTX = function () {
    var o = { sid: sid, device: device, referrer: document.referrer ? document.referrer.slice(0, 300) : '', page: (location.pathname + location.search).slice(0, 300) };
    for (var k in utm) o[k] = utm[k];
    return o;
  };
  window.SAM_TRACK_ENABLE = function () { if (enabled) return; enabled = true; flush(); };

  track('page_view');

  /* blocks that came into view — each once per visit */
  function watchSections() {
    if (!('IntersectionObserver' in window)) return;
    var seen = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var id = en.target.id;
        if (en.isIntersecting && !seen[id]) { seen[id] = 1; track('section_view', { section: id }); io.unobserve(en.target); }
      });
    }, { threshold: 0.35 });
    ['band-prices', 'hot', 'how', 'services', 'about', 'reviews', 'blog', 'contacts'].forEach(function (id) {
      var el = document.getElementById(id); if (el) io.observe(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchSections); else watchSections();

  /* where a link stands: its own data-track-label (a link that must not be mixed with the rest
     of its block), else the nearest block with an id, else one of the blocks that have none */
  var NO_ID = [['.fab', 'fab'], ['.footer', 'footer'], ['.promo-bar', 'promo_bar'], ['.promo-pop', 'promo_popup']];
  function placeOf(a) {
    var w = a.getAttribute('data-track-label'); if (w) return w;
    var el = a.closest('[id]'); if (el) return el.id;
    for (var i = 0; i < NO_ID.length; i++) if (a.closest(NO_ID[i][0])) return NO_ID[i][1];
    return '';
  }
  /* A WhatsApp link opened with the middle button, «open in a new tab» or a long press on a
     phone never fires `click`. Those are counted too — once: the menu and the click that may
     follow it on the same link within two seconds are one press. */
  var lastWa = { el: null, t: 0 };
  function onPress(e) {
    if (e.type === 'auxclick' && e.button !== 1) return;
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var href = a.getAttribute('href') || '';
    /* the middle button and the menu matter for WhatsApp links only */
    if ((e.type === 'auxclick' || e.type === 'contextmenu') && !/wa\.me\//.test(href)) return;
    var where = placeOf(a);
    if (/wa\.me\//.test(href)) {
      var now = Date.now();
      if (lastWa.el === a && now - lastWa.t < 2000) return;
      lastWa = { el: a, t: now };
      /* which tour the button is about, and the banner whose promo code the visitor took */
      var w = { label: where, ref: ref }, tour = a.getAttribute('data-wa-tour');
      var promo = a.getAttribute('data-wa-promo') || (window.SAM_WA_PROMO ? window.SAM_WA_PROMO() : '');
      if (tour) w.tour = tour;
      if (promo) w.promo_id = promo;
      track('wa_click', w);
    }
    else if (/^tel:/.test(href)) track('tel_click', { label: where });
    else if (/^mailto:/.test(href)) track('mail_click', { label: where });
    else if (href === '#plan') track('plan_open', { label: where });
    else if (href.indexOf('#checklist') === 0) track('checklist_open', { label: where });
    else if (href === '#auth') track('auth_open');
  }
  /* by delegation — works for blocks rebuilt from the database */
  ['click', 'auxclick', 'contextmenu'].forEach(function (t) { document.addEventListener(t, onPress, true); });
})();
