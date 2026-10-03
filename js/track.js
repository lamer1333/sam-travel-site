/* ============================================================================
   First-party, cookieless analytics for the owner / marketing panels.
   ----------------------------------------------------------------------------
   No cookie, no localStorage, no fingerprint, no IP stored. A visit id is a
   random string kept in memory for this page load only, so "a visit" = one
   opening of the page. What is recorded: which blocks were seen, which buttons
   were pressed, where the visitor came from (UTM tags / referrer domain),
   device class and language. Events are sent in small batches to the
   `track` RPC (supabase/admin.sql), and only after js/cms.js has confirmed the
   backend is there — a site without the database never sends anything.
   ========================================================================== */
(function () {
  'use strict';
  var sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  var q = new URLSearchParams(location.search);
  var utm = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { var v = q.get(k); if (v) utm[k] = v.slice(0, 100); });
  var refHost = '';
  try { if (document.referrer) { var r = new URL(document.referrer); if (r.host !== location.host) refHost = r.host.replace(/^www\./, ''); } } catch (e) {}
  var w = Math.min(screen.width || innerWidth, innerWidth);
  var device = /iPad|Tablet/i.test(navigator.userAgent) || (w >= 600 && w < 1024 && 'ontouchstart' in window) ? 'tablet' : w < 768 ? 'mobile' : 'desktop';
  var queue = [], enabled = false, preview = q.has('promo_preview') || q.has('cms');
  function lang() { return (window.SAM_LANG && window.SAM_LANG()) || document.documentElement.lang || 'en'; }

  function track(name, props) {
    if (preview) return;
    var e = { sid: sid, name: name, lang: lang(), device: device, ref_host: refHost };
    for (var k in utm) e[k] = utm[k];
    for (var p in (props || {})) e[p] = props[p];
    queue.push(e);
    if (queue.length >= 25) flush();
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
  /* read by js/cms.js when a lead is submitted, so the request carries its source */
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

  /* clicks that matter, by delegation — works for blocks rebuilt from the database */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var href = a.getAttribute('href') || '';
    var where = a.closest('[id]'); where = where ? where.id : '';
    if (/wa\.me\//.test(href)) track('wa_click', { label: where });
    else if (/^tel:/.test(href)) track('tel_click', { label: where });
    else if (/^mailto:/.test(href)) track('mail_click', { label: where });
    else if (href === '#plan') track('plan_open', { label: where });
    else if (href.indexOf('#checklist') === 0) track('checklist_open', { label: where });
    else if (href === '#auth') track('auth_open');
  }, true);
})();
