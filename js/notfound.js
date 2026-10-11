// Страница 404: язык тот же, что посетитель выбрал на сайте (?lang= или сохранённый).
// Английский текст стоит в разметке — без скрипта страница остаётся рабочей.
(function () {
  var T = {
    ru: {
      doc: 'Страница не найдена — SAM TRAVEL',
      title: 'Страница не найдена',
      text: 'Такого адреса нет или страница переехала. Все наши туры — на главной.',
      home: 'На главную'
    },
    hy: {
      doc: 'Էջը չի գտնվել — SAM TRAVEL',
      title: 'Էջը չի գտնվել',
      text: 'Նման հասցե չկա, կամ էջը տեղափոխվել է։ Մեր բոլոր տուրերը գլխավոր էջում են։',
      home: 'Դեպի գլխավոր էջ'
    }
  };
  var lang = new URLSearchParams(location.search).get('lang');
  if (!lang) { try { lang = localStorage.getItem('sam-lang'); } catch (e) {} }
  if (!lang || !Object.prototype.hasOwnProperty.call(T, lang)) return;
  var t = T[lang];
  document.documentElement.setAttribute('lang', lang);
  document.title = t.doc;
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t[el.dataset.t]; });
  // главная открывается на сохранённом языке сама; ?lang= — на случай запрета localStorage
  document.querySelectorAll('a[href="/"]').forEach(function (a) { a.setAttribute('href', '/?lang=' + lang); });
})();
