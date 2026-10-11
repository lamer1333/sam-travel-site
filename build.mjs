// ---------------------------------------------------------------------------
// Собирает папку публикации dist/ — только то, что должен видеть посетитель.
// Служебное (supabase/, инструкции, тесты, .claude) на хостинг не попадает.
//
//   node build.mjs
//
// Cloudflare Pages: Build command `node build.mjs`, Output directory `dist`.
// Зависимостей нет — голый Node.
// ---------------------------------------------------------------------------
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const OUT = join(ROOT, 'dist');

// Всё, что публикуется. Новый файл или папку сайта — дописать сюда.
const PUBLISH = [
  'index.html', 'cabinet.html', 'admin.html', '404.html',
  'css', 'js', 'img',
  'sam-logo.png', 'og-image.jpg',
  'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
  'site.webmanifest', 'robots.txt', 'sitemap.xml',
  '_headers',
];

// Чужие библиотеки лежат в js/vendor/ (публикуются вместе с папкой js) — с CDN страницы
// ничего не грузят. Файл должен совпадать с тем, что записано в js/vendor/README.md:
// сборка сверяет контрольную сумму и останавливается, если файл подменён или обновлён
// без записи. Новую версию — сюда, в README и в теги <script> трёх страниц.
const VENDOR = {
  'js/vendor/supabase-js-2.117.2.js': '59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd',
};
for (const [file, sha256] of Object.entries(VENDOR)) {
  const path = join(ROOT, file);
  const got = existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'нет файла';
  if (got !== sha256) {
    console.error(`Библиотека ${file} не та, что записана в js/vendor/README.md:\n  ждали ${sha256}\n  есть   ${got}`);
    process.exit(1);
  }
  for (const page of ['index.html', 'cabinet.html', 'admin.html']) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    if (!html.includes(`<script src="${file}"></script>`)) { console.error(`${page} не подключает ${file}`); process.exit(1); }
    if (/cdn\.jsdelivr\.net/.test(html)) { console.error(`${page} снова ссылается на cdn.jsdelivr.net`); process.exit(1); }
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

const missing = [];
for (const item of PUBLISH) {
  const from = join(ROOT, item);
  if (!existsSync(from)) { missing.push(item); continue; }
  // инструкции (README.md в js/vendor/) посетителю не нужны
  cpSync(from, join(OUT, item), { recursive: true, filter: (src) => !src.endsWith('.DS_Store') && !src.endsWith('.md') });
}
if (missing.length) {
  console.error('Нет файлов из списка публикации: ' + missing.join(', '));
  process.exit(1);
}

let files = 0, bytes = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), s = statSync(p);
    if (s.isDirectory()) walk(p); else { files++; bytes += s.size; }
  }
})(OUT);
console.log(`dist/ готова: ${files} файлов, ${(bytes / 1024).toFixed(0)} КБ`);
