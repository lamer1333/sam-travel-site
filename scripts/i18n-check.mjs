// Проверка переводов сайта (AUDIT.md, B8).
//
//   node scripts/i18n-check.mjs            что не переведено + осиротевшие ключи словаря
//   node scripts/i18n-check.mjs --orphans  только список осиротевших ключей (для чистки)
//
// Сайт переводится так: js/app.js обходит текстовые узлы страницы и ищет каждый (с
// нормализованными пробелами) ключом в словаре js/i18n.js; для aria-label и placeholder
// ключ — «имя-атрибута::текст». Скрипт делает то же по исходнику index.html и печатает
// видимый текст, для которого нет ключа в ru или в hy. Код выхода 1, если такой есть.
//
// Не проверяется: содержимое <script>, <style>, <svg>; политика конфиденциальности
// ([data-lng] — три готовых текста); имена собственные из списка PROPER.
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
globalThis.window = {};
await import(new URL('js/i18n.js', root));
const I = window.SAM_I18N;

// То, что на всех языках пишется одинаково.
const PROPER = new Set(['SAM TRAVEL', 'WhatsApp', 'EN', 'RU', 'HY', 'Instagram', 'Facebook', 'E-mail', '✕', '×',
  '+374 55 957585', 'outgoingsamtravel@gmail.com', '1', '2', '3', '4', '3+', '500+', '25+', '3 000+',
  'aria-label::WhatsApp', 'aria-label::SAM TRAVEL', 'aria-label::Instagram', 'aria-label::Facebook']);

const ent = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const norm = (s) => ent(s).replace(/\s+/g, ' ').trim();

let body = html.slice(html.indexOf('<body'));
body = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>').replace(/<template[\s\S]*?<\/template>/gi, (t) => t.replace(/<\/?template[^>]*>/gi, ''));
// политика конфиденциальности: три готовых текста, показывается тот, что совпал с языком
body = body.replace(/<div data-lng="(en|ru|hy)">[\s\S]*?\n      <\/div>/g, '');

const found = new Map();   // ключ → строка исходника
const lineOf = (key) => { const i = html.indexOf('>' + key.replace(/^[a-z-]+::/, '').slice(0, 30)); return i < 0 ? '?' : html.slice(0, i).split('\n').length; };
// data-i18n-ctx="x": у текста внутри свой ключ «x::текст» (см. applyLang в js/app.js)
body = body.replace(/<(\w+)[^>]*\sdata-i18n-ctx="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g, (all, tag, ctx, inner) => {
  for (const m of ('>' + inner + '<').matchAll(/>([^<]+)</g)) { const k = norm(m[1]); if (k) found.set(ctx + '::' + k, 0); }
  return '';
});
// data-i18n="key" на самом элементе: у его текста свой ключ (заголовки услуг, разбитые на два узла)
body = body.replace(/<(\w+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)/g, (all, tag, key) => { found.set(key, 0); return '<' + tag + '>'; });
for (const m of body.matchAll(/>([^<]+)</g)) { const k = norm(m[1]); if (k && /\p{L}|\d/u.test(k)) found.set(k, 0); }
for (const m of body.matchAll(/\s(aria-label|placeholder)="([^"]*)"/g)) { const k = norm(m[2]); if (k) found.set(m[1] + '::' + k, 0); }

const missing = [];
for (const k of found.keys()) {
  if (PROPER.has(k) || /^[\d\s+–·.,/:-]+$/.test(k.replace(/^[a-z-]+::/, ''))) continue;
  const no = ['ru', 'hy'].filter((l) => I[l][k] === undefined);
  if (no.length) missing.push([lineOf(k), no.join('+'), k]);
}

// Осиротевшие ключи: их нет ни в index.html, ни среди тех, что берёт код.
// __js — тексты для js/app.js; ключи, которые js/cms.js дописывает сам, в файле словаря не лежат.
const KEEP = new Set(['__js']);
const orphans = Object.keys(I.ru).filter((k) => !found.has(k) && !KEEP.has(k));
const lopsided = Object.keys(I.ru).filter((k) => !(k in I.hy)).concat(Object.keys(I.hy).filter((k) => !(k in I.ru)));

if (process.argv.includes('--orphans')) { console.log(JSON.stringify(orphans)); process.exit(0); }
console.log(`Видимых текстов в index.html: ${found.size}`);
console.log(`Без ключа в словаре: ${missing.length}`);
missing.sort((a, b) => a[0] - b[0]).forEach(([ln, no, k]) => console.log(`  index.html:${ln}  [нет ${no}]  ${k}`));
console.log(`Ключей в словаре: ru ${Object.keys(I.ru).length}, hy ${Object.keys(I.hy).length}; есть только в одном из двух: ${lopsided.length}`);
lopsided.forEach((k) => console.log('  ' + k));
console.log(`Осиротевших ключей (нет на странице): ${orphans.length}`);
orphans.forEach((k) => console.log('  ' + k));
process.exit(missing.length || lopsided.length ? 1 : 0);
