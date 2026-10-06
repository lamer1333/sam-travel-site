(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var html = document.documentElement;

  var PAGES = { plan: true, checklist: true, auth: true, privacy: true };

  /* ---------- smooth anchors (Lenis on desktop, native elsewhere) ---------- */
  function scrollToEl(el) {
    if (window.__lenis) window.__lenis.scrollTo(el, { offset: -64, duration: 1.1 });
    else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (a.dataset.soon) { e.preventDefault(); toast(tr(a.dataset.soon) + (J().soon || ' — next page, designed in the next round')); return; }
    if (!id) return;
    if (PAGES[id]) { e.preventDefault(); if (location.hash !== '#' + id) location.hash = '#' + id; else openPage(id); return; }
    var el = document.getElementById(id) || (id === 'top' ? document.body : null);
    if (!el) return;
    e.preventDefault();
    /* This listener runs before the [data-close] one, so a link inside the menu would
       otherwise scroll while the page is still locked and Lenis stopped — i.e. not at
       all. Release the overlay first, then scroll. close() is a no-op if already shut. */
    if (a.dataset.close) close(a.dataset.close);
    scrollToEl(el);
  });

  /* ---------- top bar: materialize after the hero's first screen, track section ---------- */
  var topbar = $('#topbar'), navLinks = $$('.topbar__nav a');
  var sections = navLinks.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  function onScroll() {
    var y = window.scrollY || 0;
    topbar.classList.toggle('is-solid', y > 40);
    var cur = -1, mark = y + window.innerHeight * 0.35;
    sections.forEach(function (s, i) { if (s && s.offsetTop <= mark) cur = i; });
    navLinks.forEach(function (a, i) { a.classList.toggle('is-active', i === cur); });
  }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* ---------- scroll reveals ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
  $$('.rv, .rv-group').forEach(function (el) { io.observe(el); });

  /* ---------- number tickers (trust strip) ---------- */
  var LOCALE = { en: 'en-US', ru: 'ru-RU', hy: 'hy-AM' };
  function fmtCount(el, v) {
    var dec = (el.dataset.count.split('.')[1] || '').length;
    var n;
    if (dec) n = v.toFixed(dec);
    else {
      n = String(Math.round(v));
      /* 10000 reads as 10,000 / 10 000 depending on the language */
      if (Math.abs(v) >= 1000) { try { n = Math.round(v).toLocaleString(LOCALE[cur] || 'en-US'); } catch (err) {} }
    }
    return n + (el.dataset.suffix || '');
  }
  function paintCounts() {
    $$('[data-count]').forEach(function (el) {
      if (el.dataset.done) el.textContent = fmtCount(el, parseFloat(el.dataset.count));
    });
  }
  var tick = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return; tick.unobserve(en.target);
      var el = en.target, target = parseFloat(el.dataset.count);
      function settle() { el.dataset.done = '1'; el.textContent = fmtCount(el, target); }
      if (reduced) { settle(); return; }
      var t0 = performance.now(), dur = 1300;
      (function frame(t) {
        var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        if (p < 1) { el.textContent = fmtCount(el, target * e); requestAnimationFrame(frame); }
        else settle();
      })(t0);
    });
  }, { threshold: 0.6 });
  $$('[data-count]').forEach(function (el) { tick.observe(el); });

  /* ---------- destination filters ---------- */
  var chips = $$('.chip[data-filter]'), grid = $('#grid');
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      chips.forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
      var f = c.dataset.filter;
      grid.classList.remove('in');
      $$('.card', grid).forEach(function (card) { card.classList.toggle('is-hidden', f !== 'all' && card.dataset.type.split(' ').indexOf(f) === -1); });
      requestAnimationFrame(function () { requestAnimationFrame(function () { grid.classList.add('in'); }); });
    });
  });

  /* ---------- rails: arrows + mouse drag with momentum (touch stays native) ---------- */
  function project(v, d) { d = d || 0.998; return (v / 1000) * d / (1 - d); }
  $$('[data-rail]').forEach(function (b) {
    b.addEventListener('click', function () {
      var rail = document.getElementById(b.dataset.rail), card = rail.firstElementChild;
      var step = card ? card.getBoundingClientRect().width + 16 : rail.clientWidth * 0.8;
      rail.scrollBy({ left: step * Number(b.dataset.dir), behavior: reduced ? 'auto' : 'smooth' });
    });
  });
  $$('.rail').forEach(function (rail) {
    var down = false, startX = 0, startL = 0, hist = [], moved = false;
    rail.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') return;
      down = true; moved = false; startX = e.clientX; startL = rail.scrollLeft; hist = [[e.clientX, performance.now()]];
      rail.setPointerCapture(e.pointerId);
    });
    rail.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 6) { moved = true; rail.classList.add('is-dragging'); }
      rail.scrollLeft = startL - dx;
      hist.push([e.clientX, performance.now()]); if (hist.length > 6) hist.shift();
    });
    function release() {
      if (!down) return; down = false;
      var a = hist[0], b = hist[hist.length - 1], v = (b[1] - a[1]) > 0 ? (b[0] - a[0]) / (b[1] - a[1]) * 1000 : 0;
      var card = rail.firstElementChild, step = card ? card.getBoundingClientRect().width + 16 : 300;
      var end = rail.scrollLeft - project(v), snap = Math.round(end / step) * step;
      rail.classList.remove('is-dragging');
      rail.scrollTo({ left: snap, behavior: reduced ? 'auto' : 'smooth' });
    }
    rail.addEventListener('pointerup', release); rail.addEventListener('pointercancel', release);
    rail.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  });

  /* ---------- lock / unlock page scroll ---------- */
  var locks = 0;
  function lock() { if (++locks === 1) { html.classList.add('is-locked'); if (window.__lenis) window.__lenis.stop(); } }
  function unlock() { if (locks > 0 && --locks === 0) { html.classList.remove('is-locked'); if (window.__lenis) window.__lenis.start(); } }

  /* ---------- tour sheet ---------- */
  var tours = {
    dubai:    { meta: 'UAE · year-round', title: 'Dubai', text: 'Four hours from Yerevan, visa on arrival, and a city that works as well in January as in October. Beach mornings, mall afternoons, desert at sunset.', photo: 'p-desert', inc: ['Direct flight from Yerevan', 'Hotel on the beach or in the city — we shortlist three', 'Desert safari and Burj Khalifa tickets on request', 'Manager on the line during the trip'] },
    sharm:    { meta: 'Egypt · Oct–May', title: 'Sharm El Sheikh', text: 'Warm sea all winter, the best reef diving four hours from home, and hotels where nothing has to be decided after breakfast.', photo: 'p-sea', inc: ['Direct flight from Yerevan', 'All-inclusive hotel by your budget', 'Transfer, insurance, visa on arrival', 'Manager on the line during the trip'] },
    maldives: { meta: 'Islands · Nov–Apr', title: 'Maldives', text: 'One island, one hotel, one lagoon. We pick the island by what you want: house reef, quiet, kids club, or none of the above.', photo: 'p-lagoon', inc: ['Flights with one comfortable connection', 'Water or beach villa — we explain the real difference', 'Seaplane or speedboat transfer', 'Manager on the line during the trip'] },
    bali:     { meta: 'Indonesia · Apr–Oct', title: 'Bali', text: 'Rice terraces, temples, surf and the calmest sea for kids on the south coast. We split the stay between two areas so you see both Balis.', photo: 'p-jungle', inc: ['Flights via Doha or Dubai', 'Two-area itinerary: Ubud + coast', 'Driver-guide for temple days', 'Manager on the line during the trip'] },
    antalya:  { meta: 'Türkiye · May–Oct', title: 'Antalya', text: 'The family default for a reason: short flight, all-inclusive done properly, and a coastline that fits any budget.', photo: 'p-ocean', inc: ['Direct charter from Yerevan', 'All-inclusive hotel with kids club', 'Transfer and insurance included', 'Manager on the line during the trip'] },
    paris:    { meta: 'France · all seasons', title: 'Paris', text: 'A city break with the visa handled. We book the flights, a hotel in the right arrondissement, and tell you which museum to skip.', photo: 'p-city', inc: ['Schengen visa support', 'Flights and central hotel', 'Museum passes and day trips on request', 'Manager on the line during the trip'] },
    phuket:   { meta: 'Thailand · Nov–Apr', title: 'Phuket', text: 'Big island, many beaches. We match the beach to the traveller — lively Patong, quiet Kata, or a villa away from both.', photo: 'p-island', inc: ['Flights with one connection', 'Beach hotel or villa', 'Island day-trips by longtail or speedboat', 'Manager on the line during the trip'] },
    georgia:  { meta: 'Georgia · Dec–Mar', title: 'Gudauri', text: 'Skiing five hours from Yerevan by car. Ski-in hotels, lift passes, instructors for first-timers, and khachapuri after.', photo: 'p-snow', inc: ['Car transfer from Yerevan', 'Ski-in hotel and lift pass', 'Instructor and gear rental on request', 'Manager on the line during the trip'] }
  };
  var sheet = $('#sheet'), scrim = $('#scrim'), openId = null;
  function openTour(key) {
    var t = tours[key];
    var loc = (window.SAM_TOURS_I18N || {})[cur]; if (loc && loc[key]) t = loc[key];
    /* tours managed in the panel (js/cms.js) win over the built-in copy */
    var db = window.SAM_CMS_TOURS && window.SAM_CMS_TOURS(key, cur); if (db) t = db;
    if (!t) return;
    if (window.SAM_TRACK) window.SAM_TRACK('tour_open', { tour: key });
    $('#sheet-meta').textContent = t.meta; $('#sheet-title').textContent = t.title; $('#sheet-text').textContent = t.text;
    var ph = $('#sheet-photo'); ph.className = 'sheet__hero photo ' + t.photo;
    ph.style.setProperty('--photo', t.photoUrl ? 'url("' + t.photoUrl + '") center / cover no-repeat' : '');
    var phLabel = ph.querySelector('.ph'); if (phLabel) phLabel.hidden = !!t.photoUrl;
    $('#sheet-inc').innerHTML = t.inc.map(function (s) { return '<li><svg><use href="#i-check"/></svg>' + s + '</li>'; }).join('');
    sheet.scrollTop = 0; sheet.style.transform = '';
    open('sheet');
  }
  function occlude(on) { document.dispatchEvent(new CustomEvent('sam:occlude', { detail: on })); }

  function open(id) {
    var el = document.getElementById(id); if (!el) return;
    if (id !== 'menu') scrim.classList.add('is-open');
    el.classList.add('is-open'); lock(); openId = id;
    if (id === 'menu') { $('.topbar__burger').setAttribute('aria-expanded', 'true'); topbar.classList.add('is-menu-open'); occlude(true); }
    var f = id === 'menu' ? el.querySelector('.menu__list a') : el.querySelector('input:not([hidden]), button:not(.sheet__close):not(.modal__close)');
    if (f && id !== 'sheet') setTimeout(function () { f.focus(); }, 280);
  }
  function close(id) {
    var el = document.getElementById(id); if (!el || !el.classList.contains('is-open')) return;
    el.classList.remove('is-open'); unlock();
    if (id !== 'menu') scrim.classList.remove('is-open');
    if (id === 'menu') {
      var bg = $('.topbar__burger');
      bg.setAttribute('aria-expanded', 'false'); topbar.classList.remove('is-menu-open');
      occlude(false);
      /* focus goes back to the control that opened it, not to the top of the document */
      if (el.contains(document.activeElement)) bg.focus();
    }
    if (openId === id) openId = null;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-tour]'); if (t) { openTour(t.dataset.tour); return; }
    var pc = e.target.closest('[data-page-close]'); if (pc) { e.preventDefault(); closePage(); return; }
    var tg = e.target.closest('[data-toggle]');
    if (tg) { e.preventDefault(); var tid = tg.dataset.toggle;
      if (document.getElementById(tid).classList.contains('is-open')) close(tid); else open(tid); return; }
    var o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); if (o.dataset.open === 'dirpick') pickTarget = o.dataset.target || 'prices'; if (o.dataset.close) close(o.dataset.close); open(o.dataset.open); return; }
    var c = e.target.closest('[data-close]'); if (c) { close(c.dataset.close); }
  });
  scrim.addEventListener('click', function () { if (openId) close(openId); });
  document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return; if (openId) close(openId); else if (curPage) closePage(); });
  /* focus trap: a modal dialog should not leak Tab into the page behind it.
     For the menu the burger counts as part of the dialog — it is its close control. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !openId) return;
    var el = document.getElementById(openId);
    var f = $$('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])', el)
      .filter(function (x) { return x.offsetWidth || x.offsetHeight; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* sheet: drag-to-dismiss from the grip with velocity (Apple/Vaul feel) */
  (function () {
    var grip = $('#grip'), y0 = 0, dy = 0, t0 = 0, on = false;
    grip.addEventListener('pointerdown', function (e) { on = true; y0 = e.clientY; t0 = performance.now(); dy = 0; grip.setPointerCapture(e.pointerId); sheet.classList.add('is-dragging'); });
    grip.addEventListener('pointermove', function (e) {
      if (!on) return; dy = Math.max(0, e.clientY - y0);
      sheet.style.transform = 'translate(-50%, ' + dy + 'px)';
    });
    function end() {
      if (!on) return; on = false; sheet.classList.remove('is-dragging');
      var v = dy / Math.max(1, performance.now() - t0);
      if (dy > sheet.offsetHeight * 0.3 || v > 0.6) { sheet.style.transform = ''; close('sheet'); }
      else { sheet.style.transform = ''; }
    }
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
  })();


  /* ---------- full-screen pages: #prices (Plan your trip) and #checklist ----------
     Both are ports of the Travel Expert pages. Their copy lives in window.SAM_PAGES,
     already trilingual, so these render straight from the site's current language
     rather than going through the TreeWalker. */
  /* `cur` is assigned further down, so read every localised value through this */
  function L(o) { return (o && (o[cur] || o.en)) || ''; }
  var P = window.SAM_PAGES || { CUI: {}, CDATA: {}, PDEST: {}, PUI: {} };
  var WA = '37455957585';
  /* the number comes from the panel (Contacts); js/cms.js calls this */
  window.SAM_SET_WA = function (n) { if (n && n !== WA) { WA = n; pWhatsapp(); cWhatsapp(); } };
  var curPage = null;

  function openPage(id) {
    if (curPage === id) return;
    if (curPage) { document.getElementById(curPage).classList.remove('is-open'); unlock(); }
    var el = document.getElementById(id); el.classList.add('is-open'); lock(); curPage = id;
    el.querySelector('.page__scroll').scrollTop = 0;
    occlude(true);
    if (id === 'checklist') { renderChecklist(); measureTrack(); }
  }
  function closePage() {
    if (!curPage) return;
    document.getElementById(curPage).classList.remove('is-open'); unlock(); curPage = null;
    occlude(false);
    if (PAGES[location.hash.slice(1)]) history.replaceState(null, '', location.pathname + location.search);
  }
  function route() {
    var parts = location.hash.slice(1).split('/'), id = parts[0];
    if (id === 'checklist') applyDeepLink(parts);
    if (PAGES[id]) openPage(id); else if (curPage) closePage();
  }
  /* a QR scanned at the office deep-links straight to one checklist */
  function applyDeepLink(parts) {
    if (!parts[1] || !P.CDATA[parts[1]]) return;
    cDest = parts[1];
    cType = (parts[2] && P.CDATA[cDest].types[parts[2]]) ? parts[2] : Object.keys(P.CDATA[cDest].types)[0];
  }

  function paint(root, attr, dict) {
    $$('[' + attr + ']', root).forEach(function (el) {
      var v = dict[el.getAttribute(attr)];
      if (v == null) return;
      if (v.indexOf('<') > -1) el.innerHTML = v; else el.textContent = v;
    });
  }

  /* ============ Plan your trip ============ */
  var pDest = null, pMeals = { breakfast: false, lunch: false, dinner: false };
  var pSheet = $('#p-sheet');

  function pT() { return P.PUI[cur] || P.PUI.en; }

  function buildMealChips() {
    var t = pT(), row = $('#p-meals'); row.innerHTML = '';
    ['breakfast', 'lunch', 'dinner'].forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip chip--meal'; b.textContent = t[k];
      b.setAttribute('aria-pressed', String(!!pMeals[k]));
      b.addEventListener('click', function () {
        pMeals[k] = !pMeals[k];
        b.setAttribute('aria-pressed', String(pMeals[k]));
        pWhatsapp();
      });
      row.appendChild(b);
    });
  }

  function buildDestList() {
    var list = $('#p-sheet-list'); list.innerHTML = '';
    Object.keys(P.PDEST).forEach(function (key) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-pressed', String(key === pDest));
      b.innerHTML = '<span>' + L(P.PDEST[key]) + '</span><svg><use href="#i-check"/></svg>';
      b.addEventListener('click', function () { pDest = key; closeSheet(); renderPrices(); });
      li.appendChild(b); list.appendChild(li);
    });
  }

  function openSheet() { pSheet.hidden = false; requestAnimationFrame(function () { pSheet.classList.add('is-open'); }); lock(); }
  function closeSheet() {
    pSheet.classList.remove('is-open'); unlock();
    setTimeout(function () { if (!pSheet.classList.contains('is-open')) pSheet.hidden = true; }, 280);
  }

  function fmtDate(iso) {
    if (!iso) return null;
    var d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return null;
    try { return d.toLocaleDateString(LOCALE[cur] || 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return iso; }
  }
  function pPeople() { var n = parseInt($('#p-people').value, 10); return (!n || n < 1) ? 1 : n; }

  function pWhatsapp() {
    var t = pT();
    var destText = pDest ? L(P.PDEST[pDest]) : t.msgNotChosen;
    var f = fmtDate($('#p-from').value), to = fmtDate($('#p-to').value);
    var dates = (f && to) ? (f + ' – ' + to) : (f || t.msgNotChosen);
    var chosen = [];
    if (pMeals.breakfast) chosen.push(t.breakfast);
    if (pMeals.lunch) chosen.push(t.lunch);
    if (pMeals.dinner) chosen.push(t.dinner);
    var msg = t.msgGreeting + '\n'
      + t.msgDestination + ': ' + destText + '\n'
      + t.msgTravelers + ': ' + pPeople() + '\n'
      + t.msgDates + ': ' + dates + '\n'
      + t.msgMeals + ': ' + (chosen.length ? chosen.join(', ') : t.msgNoMeals);
    $('#p-send').href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);
  }

  function renderPrices() {
    var t = pT();
    paint($('#plan'), 'data-p', t);
    var v = $('#p-dest-value');
    v.textContent = pDest ? L(P.PDEST[pDest]) : t.destBoxPlaceholder;
    $('#p-dest').classList.toggle('is-set', !!pDest);
    buildMealChips(); buildDestList(); pWhatsapp();
  }

  $('#p-dest').addEventListener('click', openSheet);
  $('#p-send').addEventListener('click', function () {
    if (window.SAM_TRACK) window.SAM_TRACK('plan_send', { tour: pDest || '' });
  });
  $$('[data-dsheet-close]').forEach(function (b) { b.addEventListener('click', closeSheet); });
  $('#p-people').addEventListener('input', pWhatsapp);
  $('#p-from').addEventListener('change', pWhatsapp);
  $('#p-to').addEventListener('change', pWhatsapp);

  /* ============ Checklist ============ */
  var cDest = 'europe', cType = 'tourist', cChecked = {}, cWasComplete = false;

  function cT() { return P.CUI[cur] || P.CUI.en; }
  function cTypeData() { return P.CDATA[cDest].types[cType]; }

  function cBuildChips() {
    var destRow = $('#c-dest'); destRow.innerHTML = '';
    Object.keys(P.CDATA).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.setAttribute('aria-pressed', String(key === cDest));
      b.textContent = P.CDATA[key].flag + ' ' + L(P.CDATA[key].label);
      b.addEventListener('click', function () {
        cDest = key;
        var types = Object.keys(P.CDATA[key].types);
        if (types.indexOf(cType) === -1) cType = types[0];
        renderChecklist();
      });
      destRow.appendChild(b);
    });
    var typeRow = $('#c-type'); typeRow.innerHTML = '';
    Object.keys(P.CDATA[cDest].types).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip chip--type';
      b.setAttribute('aria-pressed', String(key === cType));
      b.textContent = L(P.CDATA[cDest].types[key].label);
      b.addEventListener('click', function () { cType = key; renderChecklist(); });
      typeRow.appendChild(b);
    });
  }

  function cBuildList() {
    var u = cT(), td = cTypeData();
    /* required first, order otherwise preserved */
    var items = td.items.slice().sort(function (a, b) { return a.tag === b.tag ? 0 : (a.tag === 'required' ? -1 : 1); });
    var note = $('#c-note');
    if (td.note) { note.textContent = L(td.note); note.hidden = false; } else { note.hidden = true; }

    var ul = $('#c-list'); ul.innerHTML = '';
    items.forEach(function (item, i) {
      var id = cDest + '-' + cType + '-' + i;
      var li = document.createElement('li');
      li.className = 'citem' + (cChecked[id] ? ' is-done' : '');
      var lab = document.createElement('label');
      var inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!cChecked[id];
      var box = document.createElement('span'); box.className = 'box'; box.innerHTML = '<svg><use href="#i-check"/></svg>';
      var txt = document.createElement('span'); txt.className = 'citem__txt';
      txt.innerHTML = '<span class="citem__title"></span><span class="badge badge--' + item.tag + '"></span><span class="citem__desc"></span>';
      txt.querySelector('.citem__title').textContent = L(item.t);
      txt.querySelector('.badge').textContent = u[item.tag];
      txt.querySelector('.citem__desc').textContent = L(item.d);
      inp.addEventListener('change', function () {
        cChecked[id] = inp.checked;
        li.classList.toggle('is-done', inp.checked);
        try { localStorage.setItem('sam-cl', JSON.stringify(cChecked)); } catch (e) {}
        cProgress(); cWhatsapp();
      });
      lab.appendChild(inp); lab.appendChild(box); lab.appendChild(txt);
      li.appendChild(lab); ul.appendChild(li);
    });
    cProgress();
  }

  var trackScale = 1;
  function measureTrack() {
    var track = $('#c-track');
    if (track && track.clientWidth) { trackScale = track.clientWidth / 380; cProgress(); }
  }

  function cProgress() {
    var u = cT(), items = cTypeData().items, done = 0;
    items.forEach(function (_, i) { if (cChecked[cDest + '-' + cType + '-' + i]) done++; });
    $('#c-count').textContent = done + ' / ' + items.length + ' ' + u.collected;
    var pct = items.length ? done / items.length : 0;

    var pathEl = $('#c-path'), fillEl = $('#c-fill');
    var total = pathEl.getTotalLength();
    fillEl.style.strokeDasharray = total;
    fillEl.style.strokeDashoffset = total * (1 - pct);

    var pt = pathEl.getPointAtLength(total * pct);
    var ahead = pathEl.getPointAtLength(Math.min(total, total * pct + 4));
    var angle = Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * (180 / Math.PI);
    if (pct >= 1) angle = 0;

    var plane = $('#c-plane');
    plane.style.left = (pt.x * trackScale) + 'px';
    plane.style.top = (pt.y * trackScale) + 'px';
    plane.style.transform = 'translate(-50%,-50%) rotate(' + angle + 'deg)';
    plane.classList.toggle('is-landed', pct >= 1);

    var complete = pct >= 1 && items.length > 0;
    $('#c-landed').classList.toggle('is-on', complete);
    if (complete && !cWasComplete && !reduced) {
      var c = $('#c-confetti');
      c.classList.remove('is-burst'); void c.offsetWidth; c.classList.add('is-burst');
    }
    cWasComplete = complete;
  }

  function cWhatsapp() { $('#c-send').href = 'https://wa.me/' + WA; }

  function cQR() {
    /* only a real http(s) page has a scannable address; anywhere else, skip the code
       rather than encode "null" into it */
    var http = /^https?:$/.test(location.protocol);
    var url = http ? (location.origin + location.pathname + '#checklist/' + cDest + '/' + cType) : '';
    $('#c-qr-url').textContent = url.replace(/^https?:\/\//, '');
    var box = $('#c-qr'); box.innerHTML = '';
    if (!url || typeof QRCode === 'undefined') { box.classList.add('is-missing'); return; }
    box.classList.remove('is-missing');
    try { new QRCode(box, { text: url, width: 104, height: 104, colorDark: '#0B0D12', colorLight: '#ffffff' }); }
    catch (e) { box.classList.add('is-missing'); }
  }

  function renderChecklist() {
    paint($('#checklist-card'), 'data-c', cT());
    cBuildChips(); cBuildList(); cWhatsapp(); cQR();
  }

  try {
    var saved = JSON.parse(localStorage.getItem('sam-cl') || '{}');
    if (saved && typeof saved === 'object') cChecked = saved;
  } catch (e) {}

  window.addEventListener('resize', measureTrack);

  /* ---------- lead form → the panel's CRM (js/cms.js). If the database can't be
     reached the request is not lost: it opens WhatsApp with the same text. ---------- */
  $('#lead').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, ok = true;
    $$('input[required]', f).forEach(function (i) { if (!i.value.trim()) { ok = false; i.focus(); i.style.borderColor = '#d33'; setTimeout(function () { i.style.borderColor = ''; }, 1200); } });
    if (!ok) return;
    var btn = $('button[type=submit]', f), label = $('.flow__text', btn) || btn, was = label.textContent;
    btn.disabled = true;
    label.textContent = J().sending || 'Sending…';
    var data = {
      name: f.elements.name.value.trim(), phone: f.elements.phone.value.trim(),
      message: f.elements.message.value.trim(), website: f.elements.website ? f.elements.website.value : '',
      coupon_code: f.elements.coupon ? f.elements.coupon.value.trim() : '', lang: cur
    };
    function sent() { f.classList.add('is-sent'); }
    function viaWhatsApp() {
      var text = data.name + '\n' + data.phone + (data.message ? '\n' + data.message : '') + (data.coupon_code ? '\n' + data.coupon_code : '');
      window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
      sent();
    }
    if (!window.SAM_CMS || !window.SAM_CMS.submitLead) { setTimeout(viaWhatsApp, 300); return; }
    window.SAM_CMS.submitLead(data).then(sent, function () {
      btn.disabled = false; label.textContent = was; viaWhatsApp();
    });
  });
  $('#lead').addEventListener('focusin', function once() {
    if (window.SAM_TRACK) window.SAM_TRACK('form_start');
    $('#lead').removeEventListener('focusin', once);
  });

  /* ---------- language: EN / RU / HY — swaps every string in place, remembers the choice ---------- */
  var I18N = window.SAM_I18N || {}, cur = 'en', originals = new WeakMap();
  function tr(key) { var d = I18N[cur]; return (d && d[key] !== undefined) ? d[key] : key; }
  function J() { return (I18N[cur] && I18N[cur].__js) || {}; }
  function applyLang(lang) {
    cur = I18N[lang] ? lang : 'en';
    html.setAttribute('lang', cur);
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      var el = n.parentElement; if (!el || el.closest('script, style, svg, [data-count]')) continue;
      if (!originals.has(n)) originals.set(n, n.nodeValue);
      var orig = originals.get(n), key = orig.replace(/\s+/g, ' ').trim(); if (!key) continue;
      var t = tr(key);
      n.nodeValue = (t === key) ? orig : orig.match(/^\s*/)[0] + t + orig.match(/\s*$/)[0];
    }
    $$('[placeholder], [aria-label]').forEach(function (e) {
      if (e.closest('svg')) return;
      ['placeholder', 'aria-label'].forEach(function (a) {
        var v = e.getAttribute(a); if (v === null) return;
        var k = 'data-i18n-' + a; if (!e.hasAttribute(k)) e.setAttribute(k, v);
        var o = e.getAttribute(k), t = tr(a + '::' + o); e.setAttribute(a, t === a + '::' + o ? o : t);
      });
    });
    $$('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === cur)); });
    paintCounts();
    renderPrices(); renderChecklist(); paintAuth();
    try { localStorage.setItem('sam-lang', cur); } catch (err) {}
    document.dispatchEvent(new CustomEvent('sam:lang', { detail: cur }));
  }
  window.SAM_LANG = function () { return cur; };
  $$('.lang button').forEach(function (b) { b.addEventListener('click', function () {
    if (window.SAM_TRACK && b.dataset.lang !== cur) window.SAM_TRACK('lang_switch', { label: b.dataset.lang });
    applyLang(b.dataset.lang);
  }); });
  /* ?lang=ru / ?lang=hy in the URL wins over the saved choice — shared links and
     search-engine hreflang crawls must render the language they ask for. */
  var saved = 'en';
  try {
    var qlang = new URLSearchParams(location.search).get('lang');
    saved = (qlang && I18N[qlang]) ? qlang : (localStorage.getItem('sam-lang') || 'en');
  } catch (err) {}
  if (saved !== 'en') applyLang(saved);

  /* ---------- toast ---------- */
  var toastEl;
  window.SAM_TOAST = function (m) { toast(m); };
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); toastEl.style.cssText = 'position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translate(-50%,8px);z-index:999;background:#0B0D12;color:#fff;font:600 .88rem/1.3 -apple-system,system-ui,sans-serif;padding:11px 16px;border-radius:999px;box-shadow:0 12px 30px -12px rgba(0,0,0,.6);opacity:0;transition:opacity 220ms ease,transform 220ms cubic-bezier(.23,1,.32,1);pointer-events:none;max-width:90vw;text-align:center'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    requestAnimationFrame(function () { toastEl.style.opacity = '1'; toastEl.style.transform = 'translate(-50%,0)'; });
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.style.opacity = '0'; toastEl.style.transform = 'translate(-50%,8px)'; }, 2600);
  }


  /* ============ Sign in / Sign up ============
     Port of the auth-switch component: the panels and the sliding forms are CSS, this
     drives the mode, the method, validation and the code step. Nothing authenticates —
     there is no server behind this site yet, and the window says so. */
  /* reuse the hero's already-loaded mountain rather than embedding a second copy */
  (function () {
    var root = document.documentElement;
    [['1', '--ararat-sky'], ['2', '--ararat-mtn']].forEach(function (pair) {
      var n = document.querySelector('[data-parallax-layer="' + pair[0] + '"]');
      var img = n && (n.tagName === 'IMG' ? n : n.querySelector('img'));
      var src = img && (img.currentSrc || img.src);
      if (src) root.style.setProperty(pair[1], 'url("' + src + '")');
    });
  })();
  var authBox = $('#auth-box');
  var sb = window.sb;                 /* Supabase client from js/supabase-config.js */
  function aT() { return P.AUI[cur] || P.AUI.en; }

  function setMode(mode) {
    authBox.classList.toggle('is-signup', mode === 'signup');
    var f = authBox.querySelector('.aform--' + mode);
    resetForm(authBox.querySelector('.aform--' + (mode === 'signup' ? 'signin' : 'signup')));
    setTimeout(function () { var i = f.querySelector('input:not([type=checkbox])'); if (i) i.focus(); }, 620);
  }
  function resetForm(f) { if (!f) return; err(f, ''); msg(f, ''); }

  function err(f, text, field) {
    $$('.aerr', f).forEach(function (e) { e.textContent = ''; });
    $$('.ifield', f).forEach(function (e) { e.classList.remove('is-bad'); });
    if (!text) return;
    var box = f.querySelector('.aerr'); if (box) box.textContent = text;
    if (field) field.closest('.ifield').classList.add('is-bad');
  }
  function msg(f, text, kind) {
    var m = f.querySelector('.amsg'); if (!m) return;
    m.textContent = text || ''; m.dataset.kind = kind || ''; m.hidden = !text;
  }

  function paintAuth() {
    var t = aT();
    paint($('#auth'), 'data-a', t);
    $$('[data-ph]', $('#auth')).forEach(function (i) { i.placeholder = t[i.dataset.ph] || ''; });
  }

  function friendly(e) {
    var t = aT(), m = (e && e.message) || String(e);
    if (/invalid login credentials/i.test(m)) return t.errCreds;
    if (/already registered|already been registered|user already exists/i.test(m)) return t.errExists;
    return m;
  }

  if (sb) {
    $$('.aform').forEach(function (f) {
      var isSignup = f.classList.contains('aform--signup');
      var emailEl = f.querySelector('[data-field="email"]');
      var passEl = f.querySelector('[data-field="password"]');
      var nameEl = f.querySelector('[data-field="name"]');
      var consentEl = f.querySelector('[data-field="consent"]');
      var submitBtn = f.querySelector('button[type="submit"]');

      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var t = aT(); err(f, ''); msg(f, '');
        var email = (emailEl.value || '').trim(), pass = passEl.value || '';
        if (isSignup && nameEl && !nameEl.value.trim()) { err(f, t.errName, nameEl); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err(f, t.errEmail, emailEl); return; }
        if (pass.length < 6) { err(f, t.errPass, passEl); return; }

        submitBtn.disabled = true;
        var done = function () { submitBtn.disabled = false; };

        if (isSignup) {
          sb.auth.signUp({
            email: email, password: pass,
            options: {
              emailRedirectTo: new URL('cabinet.html', location.href).href,
              data: {
                full_name: (nameEl && nameEl.value.trim()) || '',
                lang: cur,
                marketing_consent: !!(consentEl && consentEl.checked),
                consent_source: 'signup_form'
              }
            }
          }).then(function (r) {
            if (r.error) throw r.error;
            if (r.data && r.data.session) location.assign('cabinet.html');
            else msg(f, t.msgConfirm, 'ok');   /* email confirmation is on */
          }).catch(function (e2) { err(f, friendly(e2)); }).then(done, done);
        } else {
          sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
            if (r.error) throw r.error;
            location.assign('cabinet.html');
          }).catch(function (e2) { err(f, friendly(e2)); }).then(done, done);
        }
      });

      /* Google (native) / Mail.ru (via edge function) */
      $$('[data-oauth]', f).forEach(function (b) {
        b.addEventListener('click', function () {
          err(f, ''); msg(f, '');
          var prov = b.dataset.oauth;
          var back = new URL('cabinet.html', location.href).href;
          if (prov === 'mailru') {
            var base = (window.SAM_SUPABASE && window.SAM_SUPABASE.url) || '';
            location.href = base + '/functions/v1/mailru-auth/start?redirect_to=' + encodeURIComponent(back);
            return;
          }
          sb.auth.signInWithOAuth({ provider: prov, options: { redirectTo: back } })
            .then(function (r) { if (r.error) err(f, friendly(r.error)); });
        });
      });

      /* Forgot password */
      var forgot = f.querySelector('[data-forgot]');
      if (forgot) forgot.addEventListener('click', function () {
        var t = aT(); err(f, ''); msg(f, '');
        var email = (emailEl.value || '').trim();
        if (!email) { msg(f, t.msgResetFirst, 'err'); return; }
        sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('cabinet.html', location.href).href })
          .then(function (r) { msg(f, r.error ? friendly(r.error) : t.msgReset, r.error ? 'err' : 'ok'); });
      });
    });

    /* Already signed in? Send the "Sign in" entries straight to the cabinet. */
    sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) {
        $$('a[href="#auth"]').forEach(function (a) { a.setAttribute('href', 'cabinet.html'); });
      }
    });
  }

  $$('[data-mode]').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });


  /* ============ Hot tours carousel ============
     Ported from the stacked drag carousel. Same feel — drag, flick, wrap-around, spring
     settle — but linear: rotation and the vertical arc are dropped, so the cards stay on
     one straight centred line. Framer Motion's spring is reproduced by hand below. */
  (function () {
    var stage = $('#carou-stage'); if (!stage) return;
    var cards = $$('.tour', stage), n = cards.length;
    var dots = $$('[data-carou-go]');
    /* js/cms.js swaps the cards for the ones managed in the panel, then calls this */
    window.SAM_CAROUSEL_REFRESH = function () {
      cards = $$('.tour', stage); n = cards.length; dots = $$('[data-carou-go]');
      pos = target = vel = 0; if (n) paint();
    };
    if (!n) return;

    var pos = 0, target = 0, vel = 0, raf = 0;
    var dragging = false, startPos = 0, startX = 0, lastX = 0, lastT = 0, moved = 0, dragVel = 0;

    function cfg() {
      var w = window.innerWidth;
      if (w < 640)  return { x: 150, scale: 0.08, rot: 28, z: 90,  sens: 180, dist: 120, velDiv: 500 };
      if (w < 1024) return { x: 230, scale: 0.09, rot: 26, z: 120, sens: 220, dist: 160, velDiv: 650 };
      return { x: 320, scale: 0.10, rot: 24, z: 160, sens: 250, dist: 200, velDiv: 800 };
    }
    /* shortest way round the loop */
    function wrap(d) { d = d % n; if (d > n / 2) d -= n; if (d < -n / 2) d += n; return d; }

    function paint() {
      var c = cfg(), half = n / 2;
      cards.forEach(function (el, i) {
        var o = wrap(i - pos), ao = Math.abs(o);
        /* coverflow: side cards turn toward the centre and sink back in Z */
        var rot = Math.max(-1.25, Math.min(1.25, o)) * -c.rot;
        el.style.transform = 'translate(-50%,-50%) translateX(' + (o * c.x).toFixed(2) + 'px) translateZ(' + (-ao * c.z).toFixed(2) + 'px) rotateY(' + rot.toFixed(2) + 'deg) scale(' + (1 - ao * c.scale).toFixed(4) + ')';
        el.style.filter = 'brightness(' + Math.max(0.55, 1 - ao * 0.16).toFixed(3) + ')';
        el.style.opacity = ao > half - 0.5 ? String(Math.max(0, (half - ao) / 0.5)) : '1';
        el.style.zIndex = String(Math.round(100 - ao * 10));
        var cur = ao < 0.5;
        el.classList.toggle('is-current', cur);
        el.setAttribute('tabindex', cur ? '0' : '-1');
        el.setAttribute('aria-hidden', cur ? 'false' : 'true');
      });
      var active = ((Math.round(pos) % n) + n) % n;
      dots.forEach(function (d, i) { d.setAttribute('aria-selected', String(i === active)); });
    }

    /* stiffness 200, damping 30, mass 1 — the same spring the component used */
    function tick() {
      raf = 0;
      if (reduced) { pos = target; vel = 0; paint(); return; }
      var dt = 1 / 60, steps = 2;
      for (var s2 = 0; s2 < steps; s2++) {
        var a = (-200 * (pos - target) - 30 * vel);
        vel += a * (dt / steps);
        pos += vel * (dt / steps);
      }
      paint();
      if (Math.abs(pos - target) > 0.0005 || Math.abs(vel) > 0.0005) raf = requestAnimationFrame(tick);
      else { pos = target; vel = 0; paint(); }
    }
    function run() { if (!raf) raf = requestAnimationFrame(tick); }
    function goTo(t) { target = t; if (reduced) { pos = t; vel = 0; paint(); } else run(); }
    function nudge(d) { goTo(Math.round(target) + d); }

    /* Capture the pointer only once a real drag begins. Capturing on pointerdown
       retargets the click to the stage, and the card underneath never gets it — so a
       plain tap would never open the tour. */
    var down = false, captured = false;
    stage.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      down = true; captured = false; moved = 0; dragVel = 0;
      startPos = pos; startX = lastX = e.clientX; lastT = e.timeStamp;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      vel = 0;
    });
    stage.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - lastX, dt = Math.max(1, e.timeStamp - lastT);
      dragVel = dx / dt * 1000;
      lastX = e.clientX; lastT = e.timeStamp;
      moved += Math.abs(dx);
      if (!captured) {
        if (moved <= 4) return;
        captured = dragging = true;
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      }
      pos -= dx / cfg().sens;
      paint();
    });
    function release(e) {
      if (!down) return;
      down = false;
      if (!captured) return;            /* a tap — let the click reach the card */
      dragging = false; captured = false;
      try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
      var c = cfg();
      var shift = Math.round(-(e.clientX - startX) / c.dist + -dragVel / c.velDiv);
      shift = Math.max(-3, Math.min(3, shift));
      goTo(Math.round(startPos) + shift);
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    /* a drag must not also count as a tap on the card underneath */
    stage.addEventListener('click', function (e) { if (moved > 8) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);

    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
    });
    $$('[data-carou]').forEach(function (b) { b.addEventListener('click', function () { nudge(Number(b.dataset.carou)); }); });
    document.addEventListener('click', function (e) {
      var d = e.target.closest('[data-carou-go]'); if (!d) return;
      var i = Number(d.dataset.carouGo);
      /* travel the short way round rather than spinning back through the middle */
      goTo(Math.round(target) + wrap(i - Math.round(target)));
    });
    window.addEventListener('resize', paint);
    paint();
  })();

  /* ============ Services: stacked scroll deck ============
     While the next card rises to cover a pinned one, the pinned card
     shrinks and dims slightly — the SOHub stacking effect. */
  (function () {
    var cards = $$('.svc'); if (!cards.length || reduced) return;
    function upd() {
      var h = window.innerHeight;
      for (var i = 0; i < cards.length - 1; i++) {
        var t = cards[i + 1].getBoundingClientRect().top;
        var p = Math.min(1, Math.max(0, 1 - (t - 100) / (h * 0.75)));
        cards[i].style.transform = 'scale(' + (1 - p * 0.05).toFixed(4) + ')';
        cards[i].style.filter = 'brightness(' + (1 - p * 0.28).toFixed(3) + ')';
      }
    }
    window.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    upd();
  })();

  /* ============ Reels: a slot whose permalink is filled in goes live ============
     Empty slots lose their blockquote so Instagram's embed.js doesn't request
     a bogus /embed/ URL for them. */
  $$('.reel').forEach(function (r) {
    var b = $('blockquote', r);
    if (!b) return;
    if (b.getAttribute('data-instgrm-permalink')) r.classList.add('reel--live');
    else b.parentNode.removeChild(b);
  });

  /* ============ Reviews: clone each column's set for the seamless loop ============ */
  $$('.tcol__track').forEach(function (t) {
    var set = t.firstElementChild; if (!set) return;
    var copy = set.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    t.appendChild(copy);
  });

  /* first paint happens here, after the saved language has been applied */
  renderPrices(); renderChecklist(); paintAuth();

  /* ---------- router last: everything above must exist before a deep link opens a page ---------- */
  window.addEventListener('hashchange', route); route();
})();
