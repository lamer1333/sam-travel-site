/* ============================================================================
   Site ⇄ panel bridge. Loads everything the owner / marketer edit in
   admin.html with one call (public_site RPC) and applies it to the page:
   contacts, company numbers, the numbers strip, hot tours, reviews, team,
   reels, SEO texts, analytics IDs, promo bar / popup. The site has no request
   form: visitors write on WhatsApp, and a promo code taken from a banner travels
   in that message (js/app.js builds the links, js/wa.js holds the texts).

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
  var data = null, backend = false, state = { coupon: '', promoId: '', reelsDone: false };

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
      if (window.SAM_SET_WA) window.SAM_SET_WA(c.whatsapp);   // js/app.js rebuilds every WhatsApp link
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
  function waNumber() {
    var n = data && data.settings && data.settings.contacts && data.settings.contacts.whatsapp;
    return /^\d{10,15}$/.test(n || '') ? n : ORIG.wa;
  }
  /* One text of a tour: the visitor's language, else English, then Russian, then Armenian —
     field by field, so a half-translated tour never shows an empty line. */
  function T(i18n, k, l) {
    var o = i18n || {}, order = [l || lang(), 'en', 'ru', 'hy'];
    for (var i = 0; i < order.length; i++) {
      var v = (o[order[i]] || {})[k];
      if (Array.isArray(v) ? v.filter(Boolean).length : (v && String(v).trim())) return v;
    }
    return k === 'inc' ? [] : '';
  }
  /* The tour type is picked in the panel from a fixed list; the label is printed in the visitor's language. */
  var TYPES = { beach: { en: 'Beach', ru: 'Пляж', hy: 'Ծովափնյա հանգիստ' }, city: { en: 'City', ru: 'Город', hy: 'Քաղաքային տուրեր' },
    nature: { en: 'Nature', ru: 'Природа', hy: 'Բնություն' }, family: { en: 'Family', ru: 'Семейный', hy: 'Ընտանեկան' } };
  function typeLabels(tags, l) {
    return (tags || []).filter(function (k) { return TYPES[k]; }).map(function (k) { return TYPES[k][l || lang()] || TYPES[k].en; });
  }
  function applyTours(list) {
    if (!list || !list.length) return;
    var stage = $('#carou-stage'), dots = $('.carou__dots'); if (!stage) return;
    stage.innerHTML = list.map(function (t) {
      var bg = cssUrl(t.photo_url), season = T(t.i18n, 'season'), types = typeLabels(t.tags);
      /* photo--img: an uploaded photo is already cut to the card's shape (2 : 3) — it is shown edge to edge */
      return '<article class="tour" data-tour="' + esc(t.slug) + '" role="button" tabindex="0">'
        + '<div class="photo ' + esc(t.photo_class || 'p-sea') + (bg ? ' photo--img' : '') + '"' + (bg ? ' style="--photo:' + esc(bg) + '"' : '') + '>'
        + (season ? '<span class="tour__season">' + esc(season) + '</span>' : '') + '</div>'
        + '<a class="tour__wa" href="https://wa.me/' + esc(waNumber()) + '" target="_blank" rel="noopener" data-wa="tour" data-wa-tour="' + esc(t.slug) + '" aria-label="WhatsApp"><svg aria-hidden="true"><use href="#i-wa"/></svg></a>'
        + '<div class="tour__body">'
        + (types.length ? '<div class="tour-tags">' + types.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '')
        + '<h3>' + esc(T(t.i18n, 'card_title') || T(t.i18n, 'title') || t.slug) + '</h3><p>' + esc(T(t.i18n, 'card_text')) + '</p>'
        + '<div class="tour__foot"><span>' + esc(T(t.i18n, 'dates')) + '</span><b>' + esc(price(t)) + '</b></div></div></article>';
    }).join('');
    if (dots) dots.innerHTML = list.map(function (_, i) { return '<button type="button" role="tab" data-carou-go="' + i + '" aria-label="Slide ' + (i + 1) + '"></button>'; }).join('');
    if (window.SAM_CAROUSEL_REFRESH) window.SAM_CAROUSEL_REFRESH();
  }
  /* the tour sheet asks here first (see openTour in app.js) */
  window.SAM_CMS_TOURS = function (key, l) {
    var t = data && (data.tours || []).filter(function (x) { return x.slug === key; })[0]; if (!t) return null;
    /* the head of the description has its own frame (16 : 9); a tour saved before that has one photo for both places */
    var ok = function (u) { return /^(https:|data:image)/.test(u || '') ? u : ''; };
    return { meta: T(t.i18n, 'meta', l), title: T(t.i18n, 'title', l), text: T(t.i18n, 'text', l), inc: T(t.i18n, 'inc', l), photo: t.photo_class || 'p-sea',
      photoUrl: ok(t.photo_hero_url) || ok(t.photo_url), tags: typeLabels(t.tags, l) };
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
          + '<q>' + esc(body) + '</q><div class="review__who"><div class="photo' + (bg ? ' photo--img' : '') + '"' + (bg ? ' style="--photo:' + esc(bg) + '"' : '') + '></div>'
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
      return '<div class="person"><div class="photo' + (bg ? ' photo--img' : '') + '"' + (bg ? ' style="--photo:' + esc(bg) + '"' : '') + '>' + (bg ? '' : '<span class="ph">photo</span>') + '</div>'
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
  /* a banner that leads to WhatsApp: js/app.js writes the message into the link — the general
     text plus «Промокод: …» — and js/track.js sends the banner's id with the click */
  function link(p) { return p.link === 'wa' ? 'https://wa.me/' + waNumber() : safeHref(p.link || '#hot'); }
  function ctaAttrs(p) {
    var l = link(p);
    return ' href="' + esc(l) + '"' + (/^https:/.test(l) ? ' target="_blank" rel="noopener"' : '')
      + (p.link === 'wa' ? ' data-wa="promo"' + (p.coupon_code ? ' data-wa-coupon="' + esc(p.coupon_code) + '" data-wa-promo="' + esc(p.id) + '"' : '') : '') + ' data-promo-cta';
  }
  /* The visitor took a promo code (pressed the code or the banner's button): from now on
     every WhatsApp message from this page carries it, and the click event names the banner. */
  function useCoupon(code, promoId) {
    if (!code) return;
    state.coupon = code; state.promoId = promoId || '';
    refreshWa();
  }
  function refreshWa() { if (window.SAM_WA_REFRESH) window.SAM_WA_REFRESH(); }
  window.SAM_WA_COUPON = function () { return state.coupon; };
  window.SAM_WA_PROMO = function () { return state.promoId; };
  function track(name, p) { if (!PREVIEW && window.SAM_TRACK) window.SAM_TRACK(name, { promo_id: p.id }); }
  function codeBtn(p) {
    return p.coupon_code ? '<button type="button" class="promo-code" data-promo-code="' + esc(p.coupon_code) + '" data-promo-id="' + esc(p.id) + '" title="' + esc(TXT.code[lang()] || TXT.code.en) + '">' + esc(p.coupon_code) + '</button>' : '';
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
      + (cta ? '<a class="promo-bar__cta"' + ctaAttrs(p) + '>' + esc(cta) + ' →</a>' : '')
      + '<button type="button" class="promo-x" aria-label="' + esc(TXT.close[lang()] || 'Close') + '" data-promo-close>×</button>';
    barHeight(); refreshWa();
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
      + (cta ? '<a class="promo-pop__cta"' + ctaAttrs(p) + '>' + esc(cta) + '</a>' : '') + '</div>';
    refreshWa();
  }
  function closePopup(silent) {
    var s = shown.popup; if (!s) return;
    if (!silent) track('promo_close', s.p);
    s.el.classList.remove('is-open'); setTimeout(function () { s.el.remove(); }, 260); shown.popup = null;
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var code = t.closest && t.closest('[data-promo-code]');
    if (code) { var c = code.getAttribute('data-promo-code'); useCoupon(c, code.getAttribute('data-promo-id')); try { navigator.clipboard.writeText(c).catch(function () {}); } catch (x) {} toast(TXT.copy[lang()] || TXT.copy.en); return; }
    if (t.closest && t.closest('[data-promo-close]')) { if (t.closest('.promo-bar')) closeBar(); else closePopup(); return; }
    var cta = t.closest && t.closest('[data-promo-cta]');
    if (cta) {
      var s = cta.closest('.promo-bar') ? shown.bar : shown.popup; if (!s) return;
      track('promo_click', s.p); useCoupon(s.p.coupon_code, s.p.id);
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
    refreshWa();   // the tour cards were rebuilt: their WhatsApp buttons need the text again
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
      /* the demo panel keeps uploaded photos in this browser under short addresses (js/admin/demo.js) */
      try {
        var media = JSON.parse(localStorage.getItem('sam-demo-media') || '{}') || {};
        var real = function (u) { return /^demo-media:/.test(u || '') ? media[u.slice(11)] || null : u; };
        if (data) ['tours', 'reviews', 'team'].forEach(function (k) {
          (data[k] || []).forEach(function (r) { r.photo_url = real(r.photo_url); if ('photo_hero_url' in r) r.photo_hero_url = real(r.photo_hero_url); });
        });
      } catch (e) {}
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

  window.SAM_CMS = { data: function () { return data; }, reload: load };
  load();
})();
