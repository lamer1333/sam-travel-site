// Логика моста Mail.ru → Supabase Auth без привязки к среде: только fetch / Request /
// Response и клиент Supabase, который передают снаружи. Тот же файл работает в Deno
// (index.ts) и в тестах на Node (supabase/test/100-security.test.mjs), где Mail.ru и
// Supabase Admin API подменены. Все настройки приходят в `env`, ключей в коде нет.
//
// Как идёт вход:
//   1. /mailru-auth/start?redirect_to=…  → в cookie кладётся случайное число, то же число и
//      адрес возврата — в `state`; браузер уходит на страницу согласия Mail.ru
//   2. Mail.ru возвращает сюда ?code=…&state=…  → число из `state` сверяется с cookie:
//      вход, начатый в другом браузере (чужая ссылка), не проходит
//   3. код меняется на токен, по токену берётся адрес почты
//   4. пользователь с таким адресом ищется в Supabase. Нет — создаётся. Есть, но адрес не
//      подтверждён (учётную запись мог завести кто угодно, зная чужой адрес) — пароль
//      сбрасывается на случайный, прежде чем впустить настоящего владельца ящика
//   5. выпускается одноразовая ссылка входа, браузер уходит по ней → вошёл
// Любая неудача — возврат на сайт к форме входа; в журнал пишется только короткий код шага.

export const STATE_COOKIE = 'sam_mailru_state';
const ENV_KEYS = ['MAILRU_CLIENT_ID', 'MAILRU_CLIENT_SECRET', 'MAILRU_REDIRECT_URI', 'SB_URL', 'SB_SERVICE_ROLE_KEY', 'SITE_URL'];
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"'.]{2,}$/;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** сравнение без утечки по времени */
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

const cookieOf = (req, name) => {
  for (const part of String(req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
};
const setCookie = (value, maxAge) => `${STATE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

/** Ошибка с коротким кодом шага: в журнал идёт только он — ни токена, ни ответа Mail.ru. */
class Step extends Error { constructor(code) { super(code); this.step = code; } }

/**
 * @param {Request} req
 * @param {Record<string, string>} env  переменные окружения функции
 * @param {{ admin: any, fetch?: typeof fetch, log?: (code: string) => void }} deps
 *   admin — клиент supabase-js с ключом service_role; fetch и log подменяются в тестах
 */
export async function handle(req, env, deps = {}) {
  const fetchFn = deps.fetch || fetch;
  const log = deps.log || ((code) => console.error('mailru-auth: ' + code));
  const plain = (text, status) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

  // ---- настройки: без любой из них функция не работает и говорит об этом сама ----
  const missing = ENV_KEYS.filter((k) => !String(env[k] || '').trim());
  let site = null, callback = null;
  try { site = new URL(String(env.SITE_URL).trim().replace(/\/+$/, '')); if (site.protocol !== 'https:' && site.hostname !== 'localhost') throw 0; } catch (_) { site = null; if (!missing.includes('SITE_URL')) missing.push('SITE_URL'); }
  try { callback = new URL(String(env.MAILRU_REDIRECT_URI).trim()); } catch (_) { callback = null; if (!missing.includes('MAILRU_REDIRECT_URI')) missing.push('MAILRU_REDIRECT_URI'); }
  if (!deps.admin && !missing.includes('SB_SERVICE_ROLE_KEY')) missing.push('SB_SERVICE_ROLE_KEY');
  if (missing.length) { log('not_configured ' + missing.join(',')); return plain('Sign-in with Mail.ru is not configured.', 500); }
  if (req.method !== 'GET') return plain('Method not allowed', 405);

  const base = site.origin + site.pathname.replace(/\/+$/, '');
  const redirect = (location, cookie) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
  const fail = (code) => { log(code); return redirect(base + '/index.html?auth_error=mailru#auth', setCookie('', 0)); };
  /** возврат — только на свой сайт, никогда на адрес, присланный со стороны */
  const safeReturn = (raw) => {
    const fallback = base + '/cabinet.html';
    try {
      const u = new URL(String(raw || ''));
      if (u.origin === site.origin && (u.pathname + '/').startsWith(site.pathname.replace(/\/+$/, '') + '/')) return u.toString();
    } catch (_) { /* не адрес */ }
    return fallback;
  };

  let url;
  try { url = new URL(req.url); } catch (_) { return plain('Bad request', 400); }
  const code = url.searchParams.get('code');

  // Mail.ru вернул отказ (человек нажал «Отмена») — не начинать вход заново по кругу
  if (!code && url.searchParams.get('error')) return fail('denied');

  // ---- шаг 1: начало ----
  if (!code) {
    const returnTo = safeReturn(url.searchParams.get('redirect_to'));
    // Cookie читается только тем адресом, который её поставил. Если вход начат не с того
    // адреса, на который вернёт Mail.ru, — сначала перейти туда (один раз: метка hop).
    if (url.host !== callback.host && !url.searchParams.has('hop')) {
      const hop = new URL(callback.toString());
      hop.searchParams.set('hop', '1'); hop.searchParams.set('redirect_to', returnTo);
      return redirect(hop.toString());
    }
    try {
      const nonce = random();
      const state = b64url(new TextEncoder().encode(JSON.stringify({ n: nonce, r: returnTo })));
      const auth = new URL('https://oauth.mail.ru/login');
      auth.searchParams.set('client_id', env.MAILRU_CLIENT_ID);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', 'userinfo');
      auth.searchParams.set('redirect_uri', callback.toString());
      auth.searchParams.set('state', state);
      return redirect(auth.toString(), setCookie(nonce, 600));
    } catch (_) { return fail('start'); }
  }

  // ---- шаг 2: возврат от Mail.ru — state обязан совпасть с cookie этого браузера ----
  let st = null;
  try { st = JSON.parse(new TextDecoder().decode(unb64url(url.searchParams.get('state') || ''))); } catch (_) { st = null; }
  const nonce = cookieOf(req, STATE_COOKIE);
  if (!st || typeof st.n !== 'string' || st.n.length < 20 || !nonce || !(await same(st.n, nonce))) return fail('state');
  const returnTo = safeReturn(st.r);

  try {
    // ---- шаг 3: код → токен → адрес почты ----
    let token = null;
    try {
      const res = await fetchFn('https://oauth.mail.ru/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code,
          client_id: env.MAILRU_CLIENT_ID, client_secret: env.MAILRU_CLIENT_SECRET,
          redirect_uri: callback.toString(),
        }),
      });
      token = (await res.json()).access_token;
    } catch (_) { token = null; }
    if (!token || typeof token !== 'string') throw new Step('token');

    // Токен — в заголовке, а не в адресе запроса: адреса оседают в журналах по дороге.
    // В описании Mail.ru есть только вариант с ?access_token=…, поэтому он оставлен
    // запасным — на случай, если заголовок там не читают.
    const userinfo = async (inHeader) => {
      try {
        const res = inHeader
          ? await fetchFn('https://oauth.mail.ru/userinfo', { headers: { Authorization: 'Bearer ' + token } })
          : await fetchFn('https://oauth.mail.ru/userinfo?access_token=' + encodeURIComponent(token));
        const j = await res.json();
        return j && typeof j.email === 'string' ? j : null;
      } catch (_) { return null; }
    };
    const info = (await userinfo(true)) || (await userinfo(false));
    const email = info ? info.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) throw new Step('userinfo');
    const fullName = String(info.name || [info.first_name, info.last_name].filter(Boolean).join(' ') || '').trim().slice(0, 120);

    // ---- шаг 4: найти или создать пользователя ----
    const admin = deps.admin;
    const lookup = async () => {
      const { data, error } = await admin.rpc('auth_user_by_email', { p_email: email });
      if (error) throw new Step('lookup');
      return data || null;
    };
    let user = await lookup();
    if (!user) {
      const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName, provider: 'mailru' } });
      if (error) {
        // «уже существует» — кто-то зарегистрировал адрес между двумя запросами; любая
        // другая ошибка — настоящая, и вход на ней останавливается
        const exists = error.code === 'email_exists' || error.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(String(error.message || ''));
        if (!exists) throw new Step('create');
        user = await lookup();
        if (!user) throw new Step('create');
      }
    }
    if (user && !user.confirmed) {
      const { error } = await admin.auth.admin.updateUserById(user.id, { password: random(36), email_confirm: true });
      if (error) throw new Step('reset');
    }

    // ---- шаг 5: одноразовая ссылка входа ----
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: returnTo } });
    const link = !error && data && data.properties && data.properties.action_link;
    if (!link) throw new Step('link');
    return redirect(link, setCookie('', 0));
  } catch (err) {
    return fail(err instanceof Step ? err.step : 'unexpected');
  }
}
