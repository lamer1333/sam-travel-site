// Запускает все supabase/test/*.test.mjs по порядку имён, каждый отдельным процессом
// (у каждого своя чистая база, см. _db.mjs). Код выхода 1, если упал хотя бы один.
//
//   npm test                       все файлы
//   node supabase/test/run.mjs 10  только файлы, в имени которых есть «10»
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = new URL('.', import.meta.url);
const only = process.argv.slice(2);
const files = readdirSync(DIR).filter((f) => f.endsWith('.test.mjs') && (!only.length || only.some((o) => f.includes(o)))).sort();
if (!files.length) { console.error('Тестов не найдено'); process.exit(1); }

const failed = [];
for (const f of files) {
  console.log('\n' + f);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(f, DIR))], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\nУпали: ${failed.join(', ')}` : `\nВсе тесты зелёные (${files.length} файл.)`);
process.exit(failed.length ? 1 : 0);
