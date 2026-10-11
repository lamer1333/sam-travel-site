// What a client chose in the cabinet, in words for the «Поездки» tab (views/people.js).
// The rows come from client_trips() (160_trips.sql): the plan and the checklist exactly as
// the site saved them (js/travel.js). The names of the countries and the lists themselves
// live in js/pages.js. Pure functions, no DOM — supabase/test/160-trips.test.mjs checks them.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** '2026-12-01' → '1 дек 2026'; a calendar day has no time zone */
export function dayText(ymd) {
  const m = DAY.exec(ymd || '');
  return m ? +m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
}
/** whole days from `today` (a Date) to a yyyy-mm-dd day; null when there is no date */
export function daysUntil(ymd, today = new Date()) {
  const m = DAY.exec(ymd || ''); if (!m) return null;
  return Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
}

/**
 * One row of client_trips() → what the table shows.
 * pages — window.SAM_PAGES; without it the keys are shown as they are.
 */
export function tripView(row, pages, today = new Date()) {
  const P = pages || {}, plan = row.plan || {}, cl = row.checklist || {};
  const ru = (o) => (o && (o.ru || o.en)) || '';
  const meals = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин' };
  const out = {
    dest: plan.dest ? (own(P.PDEST, plan.dest) ? ru(P.PDEST[plan.dest]) : plan.dest) : '',
    dates: plan.from && plan.to ? dayText(plan.from) + ' — ' + dayText(plan.to) : dayText(plan.from),
    days: daysUntil(plan.from, today),
    people: plan.people || null,
    meals: (Array.isArray(plan.meals) ? plan.meals : []).map((k) => meals[k] || k).join(', '),
    docs: null,
  };
  if (cl.dest) {
    const country = own(P.CDATA, cl.dest) ? P.CDATA[cl.dest] : null;
    const type = country && own(country.types, cl.type) ? cl.type : country ? Object.keys(country.types)[0] : cl.type;
    const total = country ? country.types[type].items.length : 0;
    // a tick is «страна-тип-номер»; only the ticks of the list chosen now count
    const done = Object.keys(cl.checked || {}).filter((id) => {
      const m = /^(.+)-(\d+)$/.exec(id);
      return m && m[1] === cl.dest + '-' + type && cl.checked[id] === true && (!total || +m[2] < total);
    }).length;
    out.docs = { label: country ? ru(country.label) + ' · ' + ru(country.types[type].label) : cl.dest, done, total };
  }
  return out;
}
