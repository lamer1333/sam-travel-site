// Сайт, кабинет и панель на поддельном Supabase — чтобы открыть их в браузере с настоящим
// входом и не сделать ни одного запроса к действующему проекту.
//
//   node supabase/test/fake-site.mjs [порт]        (по умолчанию 8957)
//   или конфигурация «sam-fake-backend» в .claude/launch.json
//
// Отдаёт файлы репозитория как есть, кроме js/supabase-config.js: в нём адрес проекта
// заменён на адрес этого же сервера, поэтому supabase-js (js/vendor/) ходит сюда. Ответы —
// минимальные: вход по почте и паролю, профиль для кабинета, whoami для панели, пустой
// public_site. Данные ниже — выдуманные, только для этой проверки.
//
// К `npm test` не относится (run.mjs берёт только *.test.mjs).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8957);
// учётная запись для проверки: существует только в этом файле
export const TEST_USER = { email: 'client@samtravel.test', password: 'local-test-password-1', role: process.env.FAKE_ROLE || 'client' };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER_ID = '11111111-2222-4333-8444-555555555555';
const user = () => ({ id: USER_ID, aud: 'authenticated', role: 'authenticated', email: TEST_USER.email, email_confirmed_at: '2026-10-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Тестовый Клиент' }, created_at: '2026-10-01T00:00:00Z' });
const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: [b64({ alg: 'HS256', typ: 'JWT' }), b64({ sub: USER_ID, role: 'authenticated', exp, email: TEST_USER.email }), 'fake-signature'].join('.'),
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'fake-refresh-token', user: user() };
};
let travel = null;   // client_travel этого пользователя (150_travel.sql)
const RPC = {
  public_site: () => ({ settings: {}, tours: [], reviews: [], team: [], reels: [], promos: [] }),
  track: () => null,
  my_profile: () => ({ id: USER_ID, email: TEST_USER.email, full_name: 'Тестовый Клиент', phone: null, role: TEST_USER.role, lang: 'ru', marketing_consent: false, onboarded: true, birth_date: '1990-05-05' }),
  my_travel: () => travel,
  save_travel: (b) => (travel = { checklist: b.p_checklist || {}, plan: b.p_plan || {}, updated_at: new Date().toISOString() }),
  whoami: () => ({ id: USER_ID, email: TEST_USER.email, full_name: 'Тестовый Клиент', role: TEST_USER.role, lang: 'ru' }),
};
const log = [];   // что спросили у «Supabase» — GET /__log

const body = (req) => new Promise((res) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch (e) { res({}); } }); });
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(data === undefined ? '' : JSON.stringify(data)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__log') return json(res, 200, log);
  if (u.pathname.startsWith('/auth/v1/') || u.pathname.startsWith('/rest/v1/') || u.pathname.startsWith('/storage/v1/') || u.pathname.startsWith('/functions/v1/')) {
    log.push(req.method + ' ' + u.pathname + (u.search || ''));
    const b = req.method === 'GET' ? {} : await body(req);
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
      return b.email === TEST_USER.email && b.password === TEST_USER.password ? json(res, 200, session()) : json(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (u.pathname === '/auth/v1/token') return json(res, 200, session());
    if (u.pathname === '/auth/v1/user') return json(res, 200, user());
    if (u.pathname === '/auth/v1/logout') return json(res, 204);
    if (u.pathname.startsWith('/rest/v1/rpc/')) { const fn = u.pathname.split('/').pop(); return json(res, 200, RPC[fn] ? RPC[fn](b) : {}); }
    if (u.pathname.startsWith('/rest/v1/')) return json(res, 200, []);
    return json(res, 404, { message: 'not in the fake' });
  }
  let rel = decodeURIComponent(u.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let data = fs.readFileSync(file);
  // тот же файл настроек, только адрес проекта — этот сервер
  if (rel === '/js/supabase-config.js') data = Buffer.from(String(data).replace(/url: '[^']+'/, `url: 'http://' + location.host`));
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}).listen(PORT, '127.0.0.1', () => console.log(`Сайт на поддельном Supabase: http://127.0.0.1:${PORT}/  (вход: ${TEST_USER.email}, пароль — в supabase/test/fake-site.mjs)`));
