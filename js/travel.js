/* ============================================================================
   The visitor's trip: the document checklist (#checklist) and the trip plan (#plan).
   ----------------------------------------------------------------------------
   Both pages used to remember things only in this browser. This file is the one
   place that reads and writes them, for the site (js/app.js) and for the cabinet
   (js/auth.js):

     • always kept in localStorage, so a guest loses nothing;
     • for a signed-in client also kept in the account — my_travel() / save_travel()
       from supabase/migrations/150_travel.sql — so the cabinet shows the trip and
       the ticks follow the person to another phone.

   If the database does not know these functions yet, everything quietly stays
   local. Depends on window.sb (js/supabase-config.js); works without it.
   ========================================================================== */
(function (root) {
  'use strict';
  var K = { checked: 'sam-cl', sel: 'sam-cl-sel', plan: 'sam-plan', dirty: 'sam-travel-dirty', uid: 'sam-travel-uid' };
  var MEALS = ['breakfast', 'lunch', 'dinner'];
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function parse(s) { try { var o = JSON.parse(s || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch (e) { return {}; } }
  var isDay = function (s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); };
  var isKey = function (s) { return typeof s === 'string' && /^[a-z0-9_]{1,40}$/.test(s); };

  /* whatever comes from storage or from the account is cut down to the known shape */
  function cleanChecklist(o) {
    o = o || {};
    var out = { dest: isKey(o.dest) ? o.dest : '', type: isKey(o.type) ? o.type : '', checked: {} }, n = 0;
    Object.keys(o.checked || {}).forEach(function (id) {
      if (o.checked[id] === true && /^[a-z0-9_]+-[a-z0-9_]+-\d{1,3}$/.test(id) && n < 300) { out.checked[id] = true; n++; }
    });
    return out;
  }
  function cleanPlan(o) {
    o = o || {};
    var people = parseInt(o.people, 10);
    return {
      dest: isKey(o.dest) ? o.dest : '',
      people: (people >= 1 && people <= 99) ? people : 0,
      from: isDay(o.from) ? o.from : '', to: isDay(o.to) ? o.to : '',
      meals: (Array.isArray(o.meals) ? o.meals : []).filter(function (m, i, a) { return MEALS.indexOf(m) > -1 && a.indexOf(m) === i; })
    };
  }
  function hasPlan(p) { return !!(p.dest || p.from || p.to || p.meals.length); }
  function hasChecklist(c) { return !!(c.dest || Object.keys(c.checked).length); }

  function get() {
    var sel = parse(ls.get(K.sel));
    return {
      checklist: cleanChecklist({ dest: sel.dest, type: sel.type, checked: parse(ls.get(K.checked)) }),
      plan: cleanPlan(parse(ls.get(K.plan)))
    };
  }
  function writeLocal(state) {
    var c = cleanChecklist(state.checklist), p = cleanPlan(state.plan);
    ls.set(K.checked, JSON.stringify(c.checked));
    if (c.dest) ls.set(K.sel, JSON.stringify({ dest: c.dest, type: c.type })); else ls.del(K.sel);
    if (hasPlan(p) || p.people) ls.set(K.plan, JSON.stringify(p)); else ls.del(K.plan);
  }

  var signedIn = false, timer = null, pushing = null;
  function push() {
    if (!signedIn || !root.sb) return Promise.resolve(false);
    var s = get();
    pushing = root.sb.rpc('save_travel', { p_checklist: s.checklist, p_plan: s.plan }).then(function (r) {
      if (r.error) return false;
      /* an edit made while the request was on its way keeps the mark */
      if (JSON.stringify(get()) === JSON.stringify(s)) ls.del(K.dirty);
      return true;
    }, function () { return false; });
    return pushing;
  }
  function touched() {
    ls.set(K.dirty, '1');
    if (!signedIn) return;
    clearTimeout(timer);
    timer = setTimeout(push, 700);
  }
  function setChecklist(c) { var s = get(); s.checklist = c; writeLocal(s); touched(); }
  function setPlan(p) { var s = get(); s.plan = p; writeLocal(s); touched(); }
  /** send what is waiting right now (before leaving the page) */
  function flush() { if (timer) { clearTimeout(timer); timer = null; return push(); } return pushing || Promise.resolve(true); }

  /**
   * Call once a session may exist. Resolves to true when the local copy was replaced
   * by what the account holds — the caller re-reads get() and repaints.
   */
  function sync() {
    var sb = root.sb;
    if (!sb) return Promise.resolve(false);
    return sb.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session) return false;
      var uid = session.user.id;
      return sb.rpc('my_travel').then(function (res) {
        if (res.error) return false;                 /* the database is older than this file */
        signedIn = true;
        var local = get(), dirty = ls.get(K.dirty) === '1', sameUser = ls.get(K.uid) === uid;
        var server = res.data ? { checklist: cleanChecklist(res.data.checklist), plan: cleanPlan(res.data.plan) } : null;
        ls.set(K.uid, uid);
        if (!server) { if (hasChecklist(local.checklist) || hasPlan(local.plan)) push(); return false; }
        if (dirty && sameUser) { push(); return false; }          /* this device has the newer edits */
        if (dirty) {
          /* ticked as a guest, then signed in: keep both — nothing ticked is lost */
          var merged = { checklist: server.checklist, plan: hasPlan(local.plan) ? local.plan : server.plan };
          if (local.checklist.dest) { merged.checklist.dest = local.checklist.dest; merged.checklist.type = local.checklist.type; }
          Object.keys(local.checklist.checked).forEach(function (id) { merged.checklist.checked[id] = true; });
          writeLocal(merged); push();
          return true;
        }
        var changed = JSON.stringify(local) !== JSON.stringify(server);
        if (changed) writeLocal(server);
        return changed;
      });
    }).catch(function () { return false; });
  }

  /** on sign-out: the account keeps the trip, this browser forgets it — unless something is still unsent */
  function forget() {
    signedIn = false; clearTimeout(timer);
    if (ls.get(K.dirty) === '1') return;
    [K.checked, K.sel, K.plan, K.uid].forEach(ls.del);
  }

  /* the line that ties the two pages to the account (painted by js/app.js) */
  var HINT = {
    en: { guest: 'Sign in to keep this in your account', user: 'Saved to your account' },
    ru: { guest: 'Войдите, чтобы это сохранилось в вашем кабинете', user: 'Сохраняется в вашем кабинете' },
    hy: { guest: 'Մուտք գործեք՝ սա ձեր անձնական էջում պահելու համար', user: 'Պահպանվում է ձեր անձնական էջում' }
  };

  root.SAM_TRAVEL = {
    get: get, setChecklist: setChecklist, setPlan: setPlan, sync: sync, flush: flush, forget: forget,
    hasPlan: hasPlan, hasChecklist: hasChecklist, HINT: HINT,
    isSignedIn: function () { return signedIn; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
