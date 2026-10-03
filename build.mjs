// ---------------------------------------------------------------------------
// Собирает папку публикации dist/ — только то, что должен видеть посетитель.
// Служебное (supabase/, инструкции, тесты, .claude) на хостинг не попадает.
//
//   node build.mjs
//
// Cloudflare Pages: Build command `node build.mjs`, Output directory `dist`.
// Зависимостей нет — голый Node.
// ---------------------------------------------------------------------------
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const OUT = join(ROOT, 'dist');

// Всё, что публикуется. Новый файл или папку сайта — дописать сюда.
const PUBLISH = [
  'index.html', 'cabinet.html', 'admin.html',
  'css', 'js', 'img',
  'sam-logo.png', 'og-image.jpg',
  'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png',
  'site.webmanifest', 'robots.txt', 'sitemap.xml',
  '_headers',
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

const missing = [];
for (const item of PUBLISH) {
  const from = join(ROOT, item);
  if (!existsSync(from)) { missing.push(item); continue; }
  cpSync(from, join(OUT, item), { recursive: true, filter: (src) => !src.endsWith('.DS_Store') });
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
