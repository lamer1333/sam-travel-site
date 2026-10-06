/* ============================================================================
   WhatsApp messages (TZ-BACKEND.md §4.11).
   ----------------------------------------------------------------------------
   The site has no request form: every WhatsApp link opens a chat with a short
   text about what the visitor pressed, in the language the site is shown in.
   js/app.js puts these texts into the links and rebuilds them on a language
   switch. The last line is the reference number of the visit («№ K7M2X», see
   js/track.js): it ties the chat to what the site knows about the visit.

   Pure functions, no DOM — supabase/test/70-whatsapp.test.mjs checks the texts.
   The Armenian phrases are built so that a tour name never has to be declined.
   ========================================================================== */
(function (root) {
  'use strict';
  var T = {
    en: { tour: "Hello! I'd like to ask about the {t} tour.", general: "Hello! I'd like to ask about a tour.", service: "Hello! I'd like to ask about: {s}.", coupon: 'Promo code: {c}', write: 'Write about {t}' },
    ru: { tour: 'Здравствуйте! Хочу спросить про тур «{t}».', general: 'Здравствуйте! Хочу спросить про тур.', service: 'Здравствуйте! Хочу спросить про: {s}.', coupon: 'Промокод: {c}', write: 'Написать про {t}' },
    hy: { tour: 'Բարև ձեզ։ Հետաքրքրում է «{t}» տուրը։', general: 'Բարև ձեզ։ Ուզում եմ հարցնել տուրի մասին։', service: 'Բարև ձեզ։ Հետաքրքրում է՝ {s}։', coupon: 'Պրոմոկոդ՝ {c}', write: 'Գրել «{t}» տուրի մասին' }
  };
  /* what a service button asks about (data-wa-topic in index.html) */
  var TOPICS = {
    visa:      { en: 'visa support', ru: 'визовая поддержка', hy: 'վիզայի աջակցություն' },
    insurance: { en: 'travel insurance', ru: 'страховка для поездки', hy: 'ճամփորդական ապահովագրություն' },
    group:     { en: 'a group trip', ru: 'групповая поездка', hy: 'խմբային ուղևորություն' },
    corporate: { en: 'corporate travel', ru: 'корпоративные поездки', hy: 'կորպորատիվ ուղևորություններ' },
    documents: { en: 'documents for a trip', ru: 'документы для поездки', hy: 'ուղևորության փաստաթղթեր' }
  };
  function dict(lang) { return T[lang] || T.en; }
  /** the lines every message ends with: the promo code the visitor took, then the reference number */
  function tail(lang, o) {
    o = o || {};
    var out = [];
    if (o.coupon) out.push(dict(lang).coupon.replace('{c}', o.coupon));
    if (o.ref) out.push('№ ' + o.ref);
    return out;
  }
  /**
   * kind: 'tour' {tour: title} · 'service' {topic: key} · 'promo' / 'general' · 'custom' {body}
   * o.coupon — promo code from a banner, o.ref — reference number of the visit
   */
  function text(kind, lang, o) {
    o = o || {};
    var d = dict(lang), first;
    if (kind === 'custom' && o.body) first = o.body;
    else if (kind === 'tour' && o.tour) first = d.tour.replace('{t}', o.tour);
    else if (kind === 'service' && o.topic) first = d.service.replace('{s}', (TOPICS[o.topic] && (TOPICS[o.topic][lang] || TOPICS[o.topic].en)) || o.topic);
    else first = d.general;
    return [first].concat(tail(lang, o)).join('\n');
  }
  /** the main button of a tour description: «Написать про {тур}» */
  function label(lang, tour) { return dict(lang).write.replace('{t}', tour); }

  root.SAM_WA = { text: text, tail: tail, label: label };
})(typeof window !== 'undefined' ? window : globalThis);
