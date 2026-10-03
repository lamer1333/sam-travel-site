/* ============================================================================
   Site ⇄ panel bridge. Loads everything the owner / marketer edit in
   admin.html with one call (public_site RPC) and applies it to the page:
   contacts, company numbers, the numbers strip, hot tours, reviews, team,
   reels, SEO texts, analytics IDs, promo bar / popup. Also sends the lead form
   to the CRM.

   Rules:
   • The built-in HTML is the fallback. A block is replaced only when the
     database has published rows for it, and nothing changes if the database
     can't be reached — the page just stays as shipped.
   • js/app.js re-translates the page on a language switch and fires
     'sam:lang'; everything here is re-applied after that.
   • ?cms=demo reads the panel's demo data from this browser instead.
   • ?promo_preview=1 shows the promo the panel is editing, to its author only.
   ========================================================================== */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var q = new URLSearchParams(location.search);
  var DEMO = q.get('cms') === 'demo', PREVIEW = q.has('promo_preview');
  var data = null, backend = false, state = { coupon: '', lastTour: '', reelsDone: false };

  function lang() { return (window.SAM_LANG && window.SAM_LANG()) || document.documentElement.lang || 'en'; }
  /** pick the current language from {en, ru, hy}, falling back to English */
  function L(o) { var l = lang(); if (!o) return null; return o[l] || o.en || o.ru || o.hy || null; }
  function Ls(o, k) { var l = lang(); return (o && ((o[l] && o[l][k]) || (o.en && o.en[k]))) || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cssUrl(u) { return /^(https:\/\/|data:image\/)/.test(u || '') ? 'url("' + String(u).replace(/["\\\n\r]/g, encodeURIComponent) + '") center / cover no-repeat' : ''; }
  function safeHref(u) { u = String(u || ''); return /^(#[\w/-]*|https:\/\/)/.test(u) ? u : '#'; }
  function toast(m) { if (window.SAM_TOAST) window.SAM_TOAST(m); }

  /* ---------- text helpers that survive the language switch ----------
     app.js keeps each text node's first-seen value and re-translates it on every
     switch; so edits are re-applied after 'sam:lang', and the dictionaries get
     the new strings too, for nodes first seen after an edit. */
  function textNodes() {
    var out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) { var p = n.parentElement; if (p && !p.closest('script, style, svg')) out.push(n); }
    return out;
  }
  function replaceAll(from, to) {
    if (!from || !to || from === to) return;
    textNodes().forEach(function (n) { if (n.nodeValue.indexOf(from) > -1) n.nodeValue = n.nodeValue.split(from).join(to); });
    var I = window.SAM_I18N || {};
    Object.keys(I).forEach(function (l) {
      var d = I[l]; Object.keys(d).forEach(function (k) {
        if (k.indexOf(from) > -1 && typeof d[k] === 'string') d[k.split(from).join(to)] = d[k].split(from).join(to);
      });
    });
  }
  /** a whole string that differs per language (e.g. the address) */
  function swapText(variants, per) {
    var v = L(per); if (!v) return;
    var set = {}; variants.concat([per.en, per.ru, per.hy]).forEach(function (x) { if (x) set[x.trim()] = 1; });
    textNodes().forEach(function (n) { var t = n.nodeValue.trim(); if (t && set[t] && t !== v) n.nodeValue = n.nodeValue.replace(t, v); });
    var I = window.SAM_I18N || {};
    ['ru', 'hy'].forEach(function (l) { if (I[l] && per.en && per[l]) I[l][per.en] = per[l]; });
  }

  /* ---------- contacts & company ---------- */
  var ORIG = { phone: '+374 55 957585', wa: '37455957585', email: 'outgoingsamtravel@gmail.com', address: 'Komitas 51, Yerevan', licence: '23-1057-2023', insurance: 'TRV-2026-0412' };
  function applyContacts(c) {
    if (!c) return;
    if (/^\d{10,15}$/.test(c.whatsapp || '')) {
      $$('a[href*="wa.me/"]').forEach(function (a) { a.setAttribute('href', a.getAttribute('href').replace(/wa\.me\/\d+/, 'wa.me/' + c.whatsapp)); });
      if (window.SAM_SET_WA) window.SAM_SET_WA(c.whatsapp);
    }
    if (c.phone) {
      var tel = 'tel:' + c.phone.replace(/[^\d+]/g, '');
      $$('a[href^="tel:"]').forEach(function (a) { a.setAttribute('href', tel); });
      replaceAll(ORIG.phone, c.phone);
    }
    if (c.email && /@/.test(c.email)) {
      $$('a[href^="mailto:"]').forEach(function (a) { a.setAttribute('href', 'mailto:' + c.email); });
      replaceAll(ORIG.email, c.email);
    }
    [['instagram', /instagram\.com\/(?!reel\/|p\/)/], ['facebook', /facebook\.com\//]].forEach(function (x) {
      var url = c[x[0]]; if (!/^https:\/\//.test(url || '')) return;
      $$('a[href]').forEach(function (a) { if (x[1].test(a.getAttribute('href')) && !a.closest('.reel')) a.setAttribute('href', url); });
    });
    if (c.address && c.address.en) swapText([ORIG.address, 'Комитас 51, Ереван', 'Կոմիտաս 51, Երևան'], c.address);
    // structured data for Google
    var ld = $('script[type="application/ld+json"]');
    if (ld) try {
      var j = JSON.parse(ld.textContent);
      if (c.phone) j.telephone = c.phone;
      if (c.email) j.email = c.email;
      if (c.address && c.address.en) j.address.streetAddress = c.address.en.split(',')[0];
      j.sameAs = [c.instagram, c.facebook, c.telegram].filter(function (u) { return /^https:\/\//.test(u || ''); });
      ld.textContent = JSON.stringify(j, null, 2);
    } catch (e) {}
  }
  function applyCompany(co) {
    if (!co) return;
    if (co.licence) replaceAll(ORIG.licence, co.licence);
    if (co.insurance) replaceAll(ORIG.insurance, co.insurance);
  }
  function applyStats(s) {
    if (!s) return;
    var b = $$('.about-nums b');
    ['years', 'trips', 'destinations', 'travellers'].forEach(function (k, i) { if (b[i] && s[k]) b[i].textContent = s[k]; });
  }

  /* ---------- hot tours ---------- */
  var ASK = { en: 'Ask for price →', ru: 'Узнать цену →', hy: 'Իմանալ գինը →' };
  function price(t) {
    if (!t.price_from) return ASK[lang()] || ASK.en;
    var n; try { n = Number(t.price_from).toLocaleString({ en: 'en-US', ru: 'ru-RU', hy: 'hy-AM' }[lang()] || 'en-US', { style: 'currency', currency: t.currency || 'USD', maximumFractionDigits: 0 }); } catch (e) { n = '$' + t.price_from; }
    return lang() === 'hy' ? n + '-ից →' : (lang() === 'ru' ? 'от ' : 'from ') + n + ' →';
  }
  function applyTours(list) {
    if (!list || !list.length) return;
    var stage = $('#carou-stage'), dots = $('.carou__dots'); if (!stage) return;
    stage.innerHTML = list.map(function (t) {
      var c = L(t.i18n) || {}, bg = cssUrl(t.photo_url);
      return '<button class="tour" type="button" data-tour="' + esc(t.slug) + '">'
        + '<div class="photo ' + esc(t.photo_class || 'p-sea') + '"' + (bg ? ' style="--photo:' + esc(bg) + '"' : '') + '>'
        + (c.season ? '<span class="tour__season">' + esc(c.season) + '</span>' : '') + '</div>'
        + '<div class="tour__body"><h3>' + esc(c.card_title || c.title || t.slug) + '</h3><p>' + esc(c.card_text || '') + '</p>'
        + '<div class="tour__foot"><span>' + esc(c.dates || '') + '</span><b>' + esc(price(t)) + '</b></div></div></button>';
    }).join('');
    if (dots) dots.innerHTML = list.map(function (_, i) { return '<button type="button" role="tab" data-carou-go="' + i + '" aria-label="Slide ' + (i + 1) + '"></button>'; }).join('');
    if (window.SAM_CAROUSEL_REFRESH) window.SAM_CAROUSEL_REFRESH();
  }
  /* the tour sheet asks here first (see openTour in app.js) */
  window.SAM_CMS_TOURS = function (key, l) {
    var t = data && (data.tours || []).filter(function (x) { return x.slug === key; })[0]; if (!t) return null;
    var c = t.i18n[l] || t.i18n.en || {}, en = t.i18n.en || {};
    return { meta: c.meta || en.meta || '', title: c.title || en.title || '', text: c.text || en.text || '', inc: (c.inc && c.inc.length ? c.inc : en.inc) || [], photo: t.photo_class || 'p-sea', photoUrl: /^(https:|data:image)/.test(t.photo_url || '') ? t.photo_url : '' };
  };

  /* ---------- reviews ---------- */
  var STAR = '<svg><use href="#i-star"/></svg>';
  function applyReviews(list) {
    if (!list || !list.length) return;
    var tracks = $$('.tcol__track'); if (!tracks.length) return;
    var lede = $('#reviews .lede'); if (lede) lede.remove();
    var cols = tracks.map(function () { return []; });
    var n = Math.max(list.length, tracks.length * 3);   // enough cards for the endless scroll
    for (var i = 0; i < n; i++) cols[i % tracks.length].push(list[(i + Math.floor(i / list.length)) % list.length]);
    tracks.forEach(function (tr, ci) {
      var html = cols[ci].map(function (r) {
        var body = L(r.body) || '', bg = cssUrl(r.photo_url);
        return '<article class="review"><div class="stars" aria-label="' + r.rating + ' stars">' + new Array(r.rating + 1).join(STAR) + '</div>'
          + '<q>' + esc(body) + '</q><div class="review__who"><div class="photo"' + (bg ? ' style="--photo:' + esc(bg) + '"' : '') + '></div>'
          + '<div><b>' + esc(r.author) + '</b><span>' + esc(r.trip || '') + '</span></div></div></article>';
      }).join('');
      tr.innerHTML = '<div class="tcol__set">' + html + '</div><div class="tcol__set" aria-hidden="true">' + html + '</div>';
    });
  }

  /* ---------- team ---------- */
  function applyTeam(list) {
    if (!list || !list.length) return;
    var box = $('.about-panel__photos'); if (!box) return;
    box.innerHTML = list.slice(0, 4).map(function (m) {
      var bg = cssUrl(m.photo_url);
      return '<div class="person"><div class="photo"' + (bg ? ' style="--photo:' + esc(bg) + '"' : '') + '>' + (bg ? '' : '<span class="ph">photo</span>') + '</div>'
        + '<b>' + esc(Ls(m.i18n, 'name')) + '</b><span>' + esc(Ls(m.i18n, 'role')) + '</span></div>';
    }).join('');
  }

  /* ---------- reels (once — Instagram turns them into iframes) ---------- */
  function applyReels(list) {
    if (state.reelsDone || !list || !list.length) return;
    state.reelsDone = true;
    $$('.reels .reel').forEach(function (slot, i) {
      var url = list[i], old = $('blockquote', slot);
      var live = $('iframe.instagram-media', slot);
      if (live) live.remove();
      if (old) old.remove();
      slot.classList.toggle('reel--live', !!url);
      if (!url || !/^https:\/\/(www\.)?instagram\.com\/(reel|p)\//.test(url)) return;
      var bq = document.createElement('blockquote');
      bq.className = 'instagram-media'; bq.setAttribute('data-instgrm-permalink', url); bq.setAttribute('data-instgrm-version', '14');
      bq.innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener">View this reel on Instagram</a>';
      slot.insertBefore(bq, slot.firstChild);
    });
    try { if (window.instgrm) window.instgrm.Embeds.process(); } catch (e) {}
  }

  /* ---------- SEO + analytics ---------- */
  function applySeo(seo) {
    if (!seo) return;
    var t = Ls(seo, 'title'), d = Ls(seo, 'description');
    if (t) { document.title = t; var ot = $('meta[property="og:title"]'); if (ot) ot.setAttribute('content', t); }
    if (d) { ['meta[name="description"]', 'meta[property="og:description"]'].forEach(function (s) { var m = $(s); if (m) m.setAttribute('content', d); }); }
  }
  function applyAnalytics(a) {
    if (!a || (!a.ga4 && !a.pixel)) return;
    window.SAM_ANALYTICS = { ga4: a.ga4 || '', pixel: a.pixel || '' };
    document.dispatchEvent(new CustomEvent('sam:analytics'));
  }

  /* ---------- promos ---------- */
  var shown = { bar: null, popup: null };
  var TXT = { copy: { en: 'Code copied', ru: 'Промокод скопирован', hy: 'Պրոմոկոդը պատճենված է' }, code: { en: 'Promo code', ru: 'Промокод', hy: 'Պրոմոկոդ' }, close: { en: 'Close', ru: 'Закрыть', hy: 'Փակել' } };
  function device() { return (window.SAM_TRACK_CTX && window.SAM_TRACK_CTX().device) || 'desktop'; }
  function store(kind) { try { return kind === 'once' ? localStorage : sessionStorage; } catch (e) { return null; } }
  function eligible(p) {
    var a = p.audience || {}, ctx = window.SAM_TRACK_CTX ? window.SAM_TRACK_CTX() : {};
    if (a.langs && a.langs.length && a.langs.indexOf(lang()) < 0) return false;
    if (a.devices && a.devices.length && a.devices.indexOf(device()) < 0) return false;
    if (a.utm_campaign && ctx.utm_campaign !== a.utm_campaign) return false;
    if (!Ls(p.i18n, p.kind === 'bar' ? 'text' : 'title')) return false;
    var f = a.frequency || (p.kind === 'bar' ? 'always' : 'session'), s = store(f === 'once' ? 'once' : 'session');
    if (f !== 'always' && s && s.getItem('sam-promo-' + p.id)) return false;
    try { if (sessionStorage.getItem('sam-promo-x-' + p.id)) return false; } catch (e) {}
    return true;
  }
  function seen(p) {
    var f = (p.audience || {}).frequency || (p.kind === 'bar' ? 'always' : 'session');
    if (f === 'always' || PREVIEW) return;
    var s = store(f === 'once' ? 'once' : 'session'); try { if (s) s.setItem('sam-promo-' + p.id, '1'); } catch (e) {}
  }
  function link(p) {
    if (p.link === 'wa') {
      var wa = (data && data.settings && data.settings.contacts && data.settings.contacts.whatsapp) || ORIG.wa;
      return 'https://wa.me/' + wa + '?text=' + encodeURIComponent([Ls(p.i18n, 'title') || Ls(p.i18n, 'text'), p.coupon_code].filter(Boolean).join(' — '));
    }
    return safeHref(p.link || '#hot');
  }
  function useCoupon(code) {
    if (!code) return;
    state.coupon = code;
    var inp = $('#f-coupon'); if (inp) { inp.value = code; var det = inp.closest('details'); if (det) det.open = true; }
  }
  function track(name, p) { if (!PREVIEW && window.SAM_TRACK) window.SAM_TRACK(name, { promo_id: p.id }); }
  function codeBtn(p) {
    return p.coupon_code ? '<button type="button" class="promo-code" data-promo-code="' + esc(p.coupon_code) + '" title="' + esc(TXT.code[lang()] || TXT.code.en) + '">' + esc(p.coupon_code) + '</button>' : '';
  }
  function renderBar(p) {
    var el = shown.bar && shown.bar.el;
    if (!el) {
      el = document.createElement('div'); el.className = 'promo-bar promo--' + (p.theme || 'brand'); el.setAttribute('role', 'region');
      document.body.insertBefore(el, document.body.firstChild);
      shown.bar = { p: p, el: el };
      track('promo_view', p); seen(p);
      window.addEventListener('resize', barHeight);
    }
    var cta = Ls(p.i18n, 'cta');
    el.setAttribute('aria-label', Ls(p.i18n, 'text'));
    el.innerHTML = '<span class="promo-bar__text">' + esc(Ls(p.i18n, 'text')) + '</span>' + codeBtn(p)
      + (cta ? '<a class="promo-bar__cta" href="' + esc(link(p)) + '"' + (/^https:/.test(link(p)) ? ' target="_blank" rel="noopener"' : '') + ' data-promo-cta>' + esc(cta) + ' →</a>' : '')
      + '<button type="button" class="promo-x" aria-label="' + esc(TXT.close[lang()] || 'Close') + '" data-promo-close>×</button>';
    barHeight();
  }
  function barHeight() {
    var b = shown.bar && shown.bar.el; if (!b) return;
    document.documentElement.classList.add('has-promo-bar');
    document.documentElement.style.setProperty('--promo-h', b.offsetHeight + 'px');
  }
  function closeBar() {
    var b = shown.bar; if (!b) return;
    track('promo_close', b.p); try { sessionStorage.setItem('sam-promo-x-' + b.p.id, '1'); } catch (e) {}
    b.el.remove(); shown.bar = null;
    document.documentElement.classList.remove('has-promo-bar'); document.documentElement.style.removeProperty('--promo-h');
  }
  function renderPopup(p, fresh) {
    var el = shown.popup && shown.popup.el;
    if (!el) {
      if (!fresh) return;
      el = document.createElement('div'); el.className = 'promo-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'promo-pop-t');
      document.body.appendChild(el); shown.popup = { p: p, el: el };
      el.addEventListener('click', function (e) { if (e.target === el) closePopup(); });
      track('promo_view', p); seen(p);
      requestAnimationFrame(function () { el.classList.add('is-open'); var c = $('.promo-pop__cta', el); if (c) c.focus(); });
    }
    var cta = Ls(p.i18n, 'cta');
    el.innerHTML = '<div class="promo-pop__card promo--' + esc(p.theme || 'brand') + '"><button type="button" class="promo-x" aria-label="' + esc(TXT.close[lang()] || 'Close') + '" data-promo-close>×</button>'
      + '<h3 id="promo-pop-t">' + esc(Ls(p.i18n, 'title')) + '</h3>' + (Ls(p.i18n, 'text') ? '<p>' + esc(Ls(p.i18n, 'text')) + '</p>' : '')
      + (p.coupon_code ? '<p class="promo-pop__code">' + esc(TXT.code[lang()] || TXT.code.en) + ': ' + codeBtn(p) + '</p>' : '')
      + (cta ? '<a class="promo-pop__cta" href="' + esc(link(p)) + '"' + (/^https:/.test(link(p)) ? ' target="_blank" rel="noopener"' : '') + ' data-promo-cta>' + esc(cta) + '</a>' : '') + '</div>';
  }
  function closePopup(silent) {
    var s = shown.popup; if (!s) return;
    if (!silent) track('promo_close', s.p);
    s.el.classList.remove('is-open'); setTimeout(function () { s.el.remove(); }, 260); shown.popup = null;
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var code = t.closest && t.closest('[data-promo-code]');
    if (code) { var c = code.getAttribute('data-promo-code'); useCoupon(c); try { navigator.clipboard.writeText(c).catch(function () {}); } catch (x) {} toast(TXT.copy[lang()] || TXT.copy.en); return; }
    if (t.closest && t.closest('[data-promo-close]')) { if (t.closest('.promo-bar')) closeBar(); else closePopup(); return; }
    var cta = t.closest && t.closest('[data-promo-cta]');
    if (cta) {
      var s = cta.closest('.promo-bar') ? shown.bar : shown.popup; if (!s) return;
      track('promo_click', s.p); useCoupon(s.p.coupon_code);
      if (s === shown.popup) closePopup(true);
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && shown.popup) closePopup(); });

  function schedulePopup(p) {
    var a = p.audience || {}, fired = false;
    function fire() {
      if (fired) return;
      /* never on top of an open page, menu or sheet — try again shortly */
      if (document.documentElement.classList.contains('is-locked')) { setTimeout(fire, 3000); return; }
      fired = true; renderPopup(p, true);
    }
    if (PREVIEW) { setTimeout(fire, 700); return; }
    var trig = a.trigger || 'delay';
    if (trig === 'scroll') {
      var onS = function () { if (scrollY + innerHeight > document.documentElement.scrollHeight * 0.5) { removeEventListener('scroll', onS); fire(); } };
      addEventListener('scroll', onS, { passive: true });
    } else if (trig === 'exit' && device() === 'desktop') {
      document.addEventListener('mouseout', function onX(e) { if (!e.relatedTarget && e.clientY <= 0) { document.removeEventListener('mouseout', onX); fire(); } });
    } else setTimeout(fire, Math.max(0, (trig === 'exit' ? 25 : (a.delay_s == null ? 6 : a.delay_s))) * 1000);
  }
  function applyPromos(list) {
    if (PREVIEW) {
      var pv = null; try { pv = JSON.parse(localStorage.getItem('sam-promo-preview') || 'null'); } catch (e) {}
      if (pv) {
        list = [pv];
        var tag = document.createElement('div'); tag.className = 'promo-preview-tag'; tag.textContent = 'Предпросмотр промо — посетители его не видят';
        document.body.appendChild(tag);
      }
    }
    (list || []).forEach(function (p) {
      if (!PREVIEW && !eligible(p)) return;
      if (p.kind === 'bar' && !shown.bar) renderBar(p);
      else if (p.kind === 'popup' && !shown.popup && !state.popupScheduled) { state.popupScheduled = true; schedulePopup(p); }
    });
  }

  /* ---------- lead form → CRM ---------- */
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tour]'); if (t) state.lastTour = t.getAttribute('data-tour'); }, true);
  function submitLead(d) {
    var ctx = window.SAM_TRACK_CTX ? window.SAM_TRACK_CTX() : {};
    var p = {}; var k;
    for (k in ctx) p[k] = ctx[k];
    for (k in d) p[k] = d[k];
    p.source = 'form'; p.tour = state.lastTour || '';
    p.coupon_code = (d.coupon_code || state.coupon || '').toUpperCase();
    if (DEMO) return demoSubmit(p);
    if (!backend || !window.sb) return Promise.reject(new Error('backend unavailable'));
    return window.sb.rpc('submit_lead', { p: p }).then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  /* demo: drop the lead straight into the panel's demo data in this browser */
  function demoSubmit(p) {
    return new Promise(function (res) {
      try {
        var key = 'sam-admin-demo-v1', st = JSON.parse(localStorage.getItem(key) || 'null');
        if (st && !p.website) {
          var now = new Date().toISOString();
          st.leads.unshift({ id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), created_at: now, updated_at: now, name: p.name, phone: p.phone, email: null, message: p.message || null,
            source: 'form', tour: p.tour || null, details: {}, lang: p.lang, device: p.device, page: p.page, referrer: p.referrer || null,
            utm_source: p.utm_source || null, utm_medium: p.utm_medium || null, utm_campaign: p.utm_campaign || null, utm_content: p.utm_content || null, utm_term: null,
            coupon_code: p.coupon_code || null, status: 'new', lost_reason: null, value: null, currency: 'USD', assigned_to: null, tags: [], follow_up_at: null, first_response_at: null, closed_at: null, user_id: null });
          localStorage.setItem(key, JSON.stringify(st));
        }
      } catch (e) {}
      setTimeout(res, 500);
    });
  }

  /* ---------- load + apply ---------- */
  function apply() {
    if (!data) return;
    var s = data.settings || {};
    try { applyContacts(s.contacts); } catch (e) { console.warn('cms contacts', e); }
    try { applyCompany(s.company); } catch (e) { console.warn('cms company', e); }
    try { applyStats(s.stats); } catch (e) { console.warn('cms stats', e); }
    try { applyTours(data.tours); } catch (e) { console.warn('cms tours', e); }
    try { applyReviews(data.reviews); } catch (e) { console.warn('cms reviews', e); }
    try { applyTeam(data.team); } catch (e) { console.warn('cms team', e); }
    try { applyReels(data.reels); } catch (e) { console.warn('cms reels', e); }
    try { applySeo(s.seo); } catch (e) { console.warn('cms seo', e); }
    if (shown.bar) renderBar(shown.bar.p);
    if (shown.popup) renderPopup(shown.popup.p);
  }
  function first() {
    apply();
    try { applyAnalytics((data.settings || {}).analytics); } catch (e) {}
    try { applyPromos(data.promos); } catch (e) { console.warn('cms promos', e); }
  }
  document.addEventListener('sam:lang', apply);

  function load() {
    if (DEMO) {
      try { data = JSON.parse(localStorage.getItem('sam-cms-demo') || 'null'); } catch (e) {}
      if (data) first(); else if (PREVIEW) { data = { settings: {}, promos: [] }; first(); }
      return;
    }
    if (!window.sb) { if (PREVIEW) { data = { settings: {}, promos: [] }; first(); } return; }
    window.sb.rpc('public_site').then(function (r) {
      if (r.error || !r.data) { if (PREVIEW) { data = { settings: {}, promos: [] }; first(); } return; }
      backend = true; data = r.data;
      if (window.SAM_TRACK_ENABLE) window.SAM_TRACK_ENABLE();
      first();
    }, function () {});
  }

  window.SAM_CMS = { submitLead: submitLead, data: function () { return data; }, reload: load };
  load();
})();
