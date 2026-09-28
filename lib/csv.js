// Minimal CSV helpers. German portals use ';' + comma decimals.
import { deNum } from './http.js';

export function parseCsv(text, sep) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];
  const delim = sep || (lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',');
  return lines.map((l) => l.split(delim).map((c) => c.trim()));
}

// Return the last row whose column `valueCol` parses as a German number,
// together with the value and (optional) date column. Robust to header/footer noise.
export function lastNumericRow(rows, { dateCol = 0, valueCol = 1 } = {}) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = deNum(rows[i][valueCol]);
    if (v != null && /\d/.test(rows[i][dateCol] || '')) {
      return { date: rows[i][dateCol], value: v };
    }
  }
  return null;
}
