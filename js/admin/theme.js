// Applied before first paint so the panel never flashes the wrong theme.
(function () {
  try {
    var t = localStorage.getItem('sam-admin-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    var ws = localStorage.getItem('sam-admin-ws');
    if (ws === 'mkt') document.documentElement.setAttribute('data-ws', 'mkt');
  } catch (e) {}
})();
