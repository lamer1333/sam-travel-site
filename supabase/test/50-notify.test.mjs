// Этап 5: письмо о заявке (миграция 050_notify + функция supabase/functions/lead-mail).
// Функция проверяется целиком на поддельном вебхуке: её обращения к базе идут в ту же
// тестовую базу (от имени суперпользователя = service_role), почтовый сервис подменён.
// Запуск: npm test  (или node supabase/test/run.mjs 50)
import { db, as, ok, bad, expectErr, formBack } from './_db.mjs';

await formBack();   // форма заявки снята этапом 7; здесь проверяется то, что осталось в базе на случай её возврата
import { handle, buildMail, buildTestMail } from '../functions/lead-mail/handler.mjs';

const ENV = {
  WEBHOOK_SECRET: 'test-secret-0123456789', SB_URL: 'http://db.test', SB_SERVICE_ROLE_KEY: 'service-key',
  SITE_URL: 'https://samtravel.am/', MAIL_API_URL: 'http://mail.test/send', MAIL_API_KEY: 'mail-key', MAIL_FROM: 'SAM TRAVEL <leads@samtravel.am>',
};
console.error = () => {};      // функция пишет причины неудач в журнал — в тестах они ожидаемы
const outbox = [];            // письма, принятые «почтовым сервисом»
const calls = [];             // все обращения функции наружу
let mailDown = false;

// Подмена сети: PostgREST → тестовая база, почтовый сервис → outbox.
async function fakeFetch(url, init) {
  const u = new URL(url), body = JSON.parse(init.body);
  calls.push(u.pathname);
  if (u.host === 'db.test') {
    if (init.headers.apikey !== ENV.SB_SERVICE_ROLE_KEY) return new Response('no key', { status: 401 });
    const fn = u.pathname.split('/').pop(), keys = Object.keys(body);
    const q = [`select public.${fn}(${keys.map((k, i) => `${k} := $${i + 1}`).join(', ')}) as v`, keys.map((k) => body[k])];
    // токен человека («Bearer jwt-owner») → запрос от его имени, как это делает PostgREST
    const who = /^Bearer jwt-(\w+)$/.exec(init.headers.Authorization || '');
    let r;
    if (who) { try { r = await as(who[1], ...q); } catch (e) { return new Response(JSON.stringify({ message: e.message }), { status: 403 }); } }
    else r = await db.query(...q);
    return new Response(JSON.stringify(r.rows[0].v ?? null), { status: 200 });
  }
  if (u.host === 'mail.test') {
    if (mailDown) return new Response('{"message":"provider is down"}', { status: mailDown === true ? 503 : mailDown });
    outbox.push({ headers: init.headers, ...body });
    return new Response('{"id":"m1"}', { status: 200 });
  }
  throw new Error('unexpected fetch ' + url);
}
const hook = (body, { secret = ENV.WEBHOOK_SECRET, method = 'POST', env = ENV } = {}) => handle(new Request('http://fn.test/lead-mail', {
  method, headers: { 'Content-Type': 'application/json', ...(secret == null ? {} : { 'x-webhook-secret': secret }) },
  body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
}), env, fakeFetch);
const insertHook = (lead) => hook({ type: 'INSERT', table: 'leads', schema: 'public', record: lead, old_record: null });
const log = async (leadId) => (await db.query(`select * from notify_log where lead_id = $1`, [leadId])).rows[0];
const due = (leadId) => db.query(`update notify_log set next_try_at = now() - interval '1 second' where lead_id = $1`, [leadId]);
let phoneN = 100;
const siteLead = async (extra = {}) => {
  const id = (await as('anon', `select submit_lead($1) id`, [JSON.stringify({ name: 'Анна', phone: '+374 91 000' + (phoneN++), ...extra })])).rows[0].id;
  return (await db.query(`select * from leads where id = $1`, [id])).rows[0];
};

// ---- база: кому положено письмо ----
const L1 = await siteLead({ message: 'Дубай в ноябре, двое', tour: 'dubai', coupon_code: 'autumn7', utm_source: 'instagram', utm_campaign: 'nov_dubai' });
let n = await log(L1.id);
n && n.status === 'pending' && n.attempts === 0 ? ok('заявка с сайта → задание на письмо (pending, 0 попыток)') : bad('нет задания для заявки с сайта');

for (const src of ['manual', 'phone', 'walk_in', 'instagram']) {
  const id = (await as('mgr', `insert into leads(name, phone, source, status, first_response_at) values ('Ручная', '+374 91 555000', $1, 'contacted', now()) returning id`, [src])).rows[0].id;
  (await log(id)) ? bad(`ручная заявка (${src}) получила задание на письмо`) : ok(`ручная заявка (${src}) — без письма`);
}

// ---- права ----
for (const w of ['anon', 'cli', 'mkt', 'mgr', 'owner']) await expectErr(w, `select notify_claim()`, [], w + ': notify_claim закрыт');
await expectErr('anon', `select notify_done($1, true)`, [n.id], 'anon: notify_done закрыт');
await expectErr('mgr', `select notify_done($1, true)`, [n.id], 'менеджер: notify_done закрыт');
await expectErr('anon', `select notify_kick()`, [], 'anon: notify_kick закрыт');
await expectErr('anon', `insert into notify_log(lead_id) values ($1)`, [L1.id], 'anon не пишет в notify_log');
await expectErr('mgr', `update notify_log set status = 'sent'`, [], 'менеджер не правит notify_log');
for (const w of ['anon', 'cli', 'mkt', 'mgr']) {
  const c = (await as(w, `select count(*)::int c from notify_log`)).rows[0].c;
  c === 0 ? ok(w + ' не видит notify_log') : bad(w + ' видит notify_log: ' + c);
}
(await as('owner', `select count(*)::int c from notify_log`)).rows[0].c === 1 ? ok('владелец читает notify_log') : bad('владелец не видит notify_log');
await expectErr('mgr', `select notify_status()`, [], 'менеджер: notify_status закрыт');
await expectErr('anon', `select notify_status()`, [], 'anon: notify_status закрыт');
let st = (await as('owner', `select notify_status() s`)).rows[0].s;
st.last_sent_at === null && st.pending === 1 ? ok('notify_status до первой отправки: писем нет, одно ждёт') : bad('notify_status ' + JSON.stringify(st));

// ---- функция: секрет вебхука ----
let r = await hook({ type: 'INSERT', table: 'leads', record: L1 }, { secret: 'wrong' });
r.status === 401 ? ok('неверный секрет → 401') : bad('неверный секрет: ' + r.status);
r = await hook({ type: 'INSERT', table: 'leads', record: L1 }, { secret: null });
r.status === 401 ? ok('без секрета → 401') : bad('без секрета: ' + r.status);
r = await hook({ type: 'retry' }, { secret: '' });
r.status === 401 ? ok('пустой секрет → 401') : bad('пустой секрет: ' + r.status);
r = await hook(null, { method: 'GET' });
r.status === 405 ? ok('GET → 405') : bad('GET: ' + r.status);
r = await hook({ type: 'INSERT', table: 'leads', record: L1 }, { secret: '', env: { ...ENV, WEBHOOK_SECRET: '' } });
r.status === 500 ? ok('секрет не задан в окружении → 500, а не открытая дверь') : bad('без WEBHOOK_SECRET: ' + r.status);
r = await hook('{not json');
r.status === 400 ? ok('битое тело → 400') : bad('битое тело: ' + r.status);
outbox.length === 0 && calls.length === 0 ? ok('до проверки секрета функция никуда не ходит') : bad('обращения без секрета: ' + calls.join(','));

// ---- функция: письмо ----
r = await insertHook(L1);
let out = await r.json();
r.status === 200 && out.sent === 1 && outbox.length === 1 ? ok('поддельный вебхук с верным секретом → 1 письмо') : bad('вебхук: ' + r.status + ' ' + JSON.stringify(out));
const m = outbox[0];
const agency = (await db.query(`select value ->> 'email' e from site_settings where key = 'contacts'`)).rows[0].e;
const tourRu = (await db.query(`select i18n -> 'ru' ->> 'title' t from tours where slug = 'dubai'`)).rows[0].t;
m.to.length === 1 && m.to[0] === agency ? ok('получатель — почта агентства из site_settings: ' + agency) : bad('получатель ' + JSON.stringify(m.to));
m.from === ENV.MAIL_FROM && m.headers.Authorization === 'Bearer mail-key' ? ok('отправитель и ключ — из переменных окружения') : bad('from/ключ');
for (const [what, s] of [['имя', 'Анна'], ['телефон', L1.phone], ['тур', tourRu], ['сообщение', 'Дубай в ноябре, двое'], ['промокод', 'AUTUMN7'],
  ['ссылка «Написать в WhatsApp»', 'https://wa.me/' + L1.phone_digits], ['ссылка «Открыть в панели»', 'https://samtravel.am/admin.html#/sales/' + L1.id]]) {
  m.html.includes(s) && m.text.includes(s) ? ok('в письме есть ' + what) : bad('в письме нет: ' + what + ' (' + s + ')');
}
m.html.includes('Написать в WhatsApp') && m.html.includes('Открыть в панели') ? ok('подписи кнопок в письме') : bad('подписи кнопок');
m.subject.includes('Анна') && m.subject.includes(tourRu) ? ok('тема: ' + m.subject) : bad('тема ' + m.subject);
n = await log(L1.id);
n.status === 'sent' && n.sent_at && n.attempts === 1 && n.to_addr === agency && n.last_error === null ? ok('notify_log: sent, 1 попытка, время доставки') : bad('notify_log ' + JSON.stringify(n));

r = await insertHook(L1); out = await r.json();
out.sent === 0 && outbox.length === 1 ? ok('повторный вебхук по той же заявке — второго письма нет') : bad('дубль письма');
r = await hook({ type: 'retry' }); out = await r.json();
out.sent === 0 && out.failed === 0 && outbox.length === 1 ? ok('повтор, когда повторять нечего, — ничего не шлёт') : bad('лишний повтор');

// заявка, которой нет в notify_log (ручная): даже с верным секретом письма нет
calls.length = 0;
r = await insertHook({ id: L1.id, source: 'walk_in', name: 'x', phone: '1' }); out = await r.json();
out.skipped === 'manual' && calls.length === 0 ? ok('вебхук по ручной заявке → пропуск, без обращений к базе и почте') : bad('ручная через вебхук');
const manualId = (await db.query(`select id from leads where source = 'phone' limit 1`)).rows[0].id;
r = await insertHook({ id: manualId, source: 'form' }); out = await r.json();
out.sent === 0 && outbox.length === 1 ? ok('подделанный source в теле не помогает: решает база') : bad('ручная заявка ушла письмом');
r = await hook({ type: 'UPDATE', table: 'leads', record: L1 }); out = await r.json();
out.skipped === 'not_a_lead_insert' ? ok('не вставка в leads → пропуск') : bad('UPDATE обработан');
r = await hook({ type: 'INSERT', table: 'profiles', record: L1 }); out = await r.json();
out.skipped === 'not_a_lead_insert' ? ok('чужая таблица → пропуск') : bad('чужая таблица обработана');

// ---- неудачные: повтор раз в 5 минут, не больше 5 попыток ----
mailDown = true;
const L2 = await siteLead({ message: 'не дойдёт' });
r = await insertHook(L2); out = await r.json();
n = await log(L2.id);
out.failed === 1 && n.status === 'pending' && n.attempts === 1 && /503/.test(n.last_error) ? ok('почта недоступна → попытка 1 записана, причина: ' + n.last_error.slice(0, 40)) : bad('неудача не записана ' + JSON.stringify(n));
const wait = (new Date(n.next_try_at) - Date.now()) / 60000;
wait > 4.5 && wait < 5.5 ? ok('следующая попытка через 5 минут') : bad('next_try_at через ' + wait + ' мин');
r = await hook({ type: 'retry' }); out = await r.json();
out.failed === 0 && (await log(L2.id)).attempts === 1 ? ok('раньше 5 минут повтор не делается') : bad('повтор раньше срока');
for (let i = 2; i <= 5; i++) {
  await due(L2.id);
  await hook({ type: 'retry' });
  n = await log(L2.id);
  if (n.attempts !== i) bad(`попытка ${i}: attempts = ${n.attempts}`);
  if (i < 5 && n.status !== 'pending') bad(`попытка ${i}: статус ${n.status}`);
}
n.attempts === 5 && n.status === 'failed' ? ok('после 5-й неудачи — failed') : bad('после 5 попыток: ' + n.status + ' / ' + n.attempts);
await due(L2.id);
calls.length = 0;
r = await hook({ type: 'retry' }); out = await r.json();
n = await log(L2.id);
out.failed === 0 && n.attempts === 5 && !calls.includes('/send') ? ok('6-й попытки нет') : bad('6-я попытка сделана');
st = (await as('owner', `select notify_status() s`)).rows[0].s;
st.failed_7d === 1 && st.last_sent_at && /503/.test(st.last_error) ? ok('notify_status: 1 недоставленное, время последнего доставленного, причина') : bad('notify_status ' + JSON.stringify(st));

// упало один раз, потом почта ожила → доставлено со второй попытки
const L3 = await siteLead({ message: 'дойдёт со второй' });
await insertHook(L3);
mailDown = false;
await due(L3.id);
r = await hook({ type: 'retry' }); out = await r.json();
n = await log(L3.id);
out.sent === 1 && n.status === 'sent' && n.attempts === 2 && n.last_error === null && outbox.at(-1).text.includes('дойдёт со второй') ? ok('повтор после сбоя доставил письмо (2 попытки)') : bad('повтор не доставил ' + JSON.stringify(n));
const lastSent = (await as('owner', `select notify_status() s`)).rows[0].s.last_sent_at;
Math.abs(new Date(lastSent) - new Date(n.sent_at)) < 1000 ? ok('notify_status.last_sent_at = время последнего доставленного письма') : bad('last_sent_at ' + lastSent);

// повтор берёт несколько заявок за раз, вебхук — только свою
const L4 = await siteLead(), L5 = await siteLead();
r = await insertHook(L4); out = await r.json();
out.sent === 1 && (await log(L5.id)).attempts === 0 ? ok('вебхук шлёт только свою заявку') : bad('вебхук задел чужую');
r = await hook({ type: 'retry' }); out = await r.json();
out.sent === 1 && (await log(L5.id)).status === 'sent' ? ok('потерянный вебхук подбирает повтор') : bad('потерянный вебхук не подобран');

// ---- края ----
const L6 = await siteLead({ name: '<script>alert(1)</script>', message: 'a & b <b>' });
await insertHook(L6);
const x = outbox.at(-1);
!x.html.includes('<script>') && x.html.includes('&lt;script&gt;') && x.html.includes('a &amp; b &lt;b&gt;') ? ok('HTML в имени и сообщении экранируется') : bad('HTML не экранирован');

const contacts = (await db.query(`select value from site_settings where key = 'contacts'`)).rows[0].value;
await db.query(`update site_settings set value = value - 'email' where key = 'contacts'`);
const L7 = await siteLead();
r = await insertHook(L7); out = await r.json();
n = await log(L7.id);
out.failed === 1 && /no agency email/.test(n.last_error) ? ok('нет почты агентства в настройках → неудача с понятной причиной') : bad('без почты: ' + JSON.stringify(n));
await db.query(`update site_settings set value = $1 where key = 'contacts'`, [JSON.stringify(contacts)]);
await db.query(`update site_settings set value = jsonb_set(value, '{email}', '"new@samtravel.am"') where key = 'contacts'`);
await due(L7.id);
await hook({ type: 'retry' });
outbox.at(-1).to[0] === 'new@samtravel.am' ? ok('адрес сменили в панели → повтор уходит на новый') : bad('новый адрес не подхватился');

const L8 = await siteLead();
r = await hook({ type: 'INSERT', table: 'leads', record: L8 }, { env: { ...ENV, MAIL_API_KEY: '' } }); out = await r.json();
out.failed === 1 && (await log(L8.id)).last_error === 'mail_not_configured' ? ok('нет ключа почтового сервиса → неудача записана, повторится') : bad('без ключа почты');

const before = outbox.length;
await due(L8.id);
r = await hook({ type: 'retry' }, { env: { ...ENV, MAIL_PROVIDER: 'brevo', MAIL_API_URL: 'http://mail.test/brevo' } });
const b = outbox.at(-1);
outbox.length === before + 1 && b.headers['api-key'] === 'mail-key' && b.sender.email === 'leads@samtravel.am' && b.sender.name === 'SAM TRAVEL' && b.to[0].email === 'new@samtravel.am' && b.htmlContent
  ? ok('другой почтовый сервис (brevo) включается переменной окружения') : bad('brevo ' + JSON.stringify(b).slice(0, 200));

const L9 = await siteLead();
r = await hook({ type: 'INSERT', table: 'leads', record: L9 }, { env: { ...ENV, MAIL_PROVIDER: 'mailjet', MAIL_API_KEY: ' pub: sec\n', MAIL_API_URL: 'http://mail.test/mailjet' } });
const mj = outbox.at(-1), mjm = (mj.Messages || [])[0] || {};
mj.headers.Authorization === 'Basic ' + btoa('pub:sec') && mjm.From.Email === 'leads@samtravel.am' && mjm.From.Name === 'SAM TRAVEL' && mjm.To[0].Email === 'new@samtravel.am' && mjm.HTMLPart && mjm.TextPart && mjm.Subject
  ? ok('почтовый сервис mailjet: пара ключей уходит в Basic (пробелы и перенос строки отброшены), письмо в формате Send API v3.1') : bad('mailjet ' + JSON.stringify(mj).slice(0, 200));

// ---- кнопка «Отправить пробное письмо»: токен владельца вместо секрета вебхука ----
{
  const press = (who, body = { type: 'test' }, env = ENV) => handle(new Request('http://fn.test/lead-mail', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: 'Bearer jwt-' + who } : {}) }, body: JSON.stringify(body),
  }), env, fakeFetch);
  const logN = async () => Number((await db.query(`select count(*) n from notify_log`)).rows[0].n);
  const n0 = outbox.length, log0 = await logN();
  r = await press('owner'); out = await r.json();
  const t = outbox.at(-1);
  r.status === 200 && out.ok === true && out.to === 'new@samtravel.am' && outbox.length === n0 + 1 && t.to[0] === 'new@samtravel.am' && t.subject === buildTestMail(ENV).subject && t.html.includes('/admin.html')
    ? ok('пробное письмо: владелец нажал → письмо ушло на почту агентства, ответ { ok, to }') : bad('пробное письмо ' + r.status + ' ' + JSON.stringify(out));
  r.headers.get('access-control-allow-origin') === '*' ? ok('пробное письмо: ответ читается из браузера (CORS)') : bad('нет CORS в ответе');
  for (const w of ['mgr', 'mkt', 'cli', 'anon']) {
    r = await press(w);
    r.status === 403 && outbox.length === n0 + 1 ? ok('пробное письмо: ' + w + ' → 403, письма нет') : bad('пробное письмо от ' + w + ': ' + r.status);
  }
  r = await press('owner', { type: 'retry' });
  r.status === 401 ? ok('токен владельца не заменяет секрет вебхука: { type: retry } → 401') : bad('retry с токеном: ' + r.status);
  r = await press('owner', { type: 'test' }, { ...ENV, MAIL_API_KEY: '' }); out = await r.json();
  out.ok === false && out.error === 'mail_not_configured' ? ok('пробное письмо без ключа почты → причина в ответе') : bad('без ключа: ' + JSON.stringify(out));
  mailDown = true;
  r = await press('owner'); out = await r.json();
  mailDown = false;
  out.ok === false && /503/.test(out.error) ? ok('почтовый сервис отказал → его ответ виден владельцу') : bad('отказ сервиса: ' + JSON.stringify(out));
  mailDown = 401;
  r = await press('owner', { type: 'test' }, { ...ENV, MAIL_PROVIDER: 'mailjet', MAIL_API_KEY: 'abc:secret-value-1', MAIL_API_URL: 'http://mail.test/mailjet' }); out = await r.json();
  mailDown = false;
  out.ok === false && /частей через двоеточие: 2 .*длины: 3 и 14/.test(out.error) && !out.error.includes('secret-value-1')
    ? ok('Mailjet отказал во входе → в ответе форма ключа (части и длины), самого ключа нет') : bad('форма ключа: ' + JSON.stringify(out));
  (await logN()) === log0 ? ok('пробное письмо в очередь notify_log не попадает') : bad('пробное письмо задело notify_log');
  r = await handle(new Request('http://fn.test/lead-mail', { method: 'OPTIONS' }), ENV, fakeFetch);
  r.status === 204 && /authorization/.test(r.headers.get('access-control-allow-headers') || '') ? ok('предзапрос браузера (OPTIONS) → 204 с CORS') : bad('OPTIONS: ' + r.status);
}

const noSite = buildMail({ id: L1.id, name: 'A', phone: '12', phone_digits: '12' }, {});
!noSite.text.includes('wa.me') && !noSite.text.includes('admin.html') ? ok('короткий номер / нет SITE_URL — битых ссылок в письме нет') : bad('битые ссылки');

(await db.query(`select public.notify_kick() k`)).rows[0].k === false ? ok('notify_kick без pg_net / секретов тихо ничего не делает') : bad('notify_kick');
await as('owner', `delete from leads where id = $1`, [L1.id]);
(await log(L1.id)) ? bad('после удаления заявки запись в notify_log осталась') : ok('удаление заявки убирает её запись из notify_log');
