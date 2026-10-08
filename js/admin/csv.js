// CSV text for the panel's exports — no DOM here, so the tests can load the file on its own
// (supabase/test/100-security.test.mjs).

/**
 * One cell. A text that starts with = + - @, a tab or a carriage return is a formula for
 * Excel, LibreOffice and Google Sheets — and the names, phones and utm tags in the exports
 * are typed by visitors. Such a cell gets a leading apostrophe (the spreadsheet then shows
 * it as text) and every text cell is quoted. Numbers the panel counted itself stay numbers.
 */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  const risky = /^\s*[=+\-@]|^[\t\r]/.test(s);
  if (risky) s = "'" + s;
  return risky || /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** columns: [[header, row => value]] → the text of the file, without the BOM */
export function csvText(rows, columns) {
  return [columns.map((c) => csvCell(c[0])).join(',')].concat(rows.map((r) => columns.map((c) => csvCell(c[1](r))).join(','))).join('\n');
}
