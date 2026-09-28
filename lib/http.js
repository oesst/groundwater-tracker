// Small fetch helpers (Node 20+ has global fetch). No external dependencies.

const UA = 'grundwasser-de/0.1 (+https://github.com/) daily-static-pipeline';

export async function getText(url, { timeout = 20000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'de,en', ...headers },
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function getJSON(url, opts = {}) {
  const txt = await getText(url, { headers: { Accept: 'application/json' }, ...opts });
  return JSON.parse(txt);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run tasks with bounded concurrency (be polite to state portals).
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { __error: String(e && e.message || e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

// German number "510,57" -> 510.57 ; returns null if not parseable.
export function deNum(s) {
  if (s == null) return null;
  const m = String(s).trim().replace(/\./g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// "04.06.2026 10:00" / "04.06.2026" -> ISO date string (UTC-naive) or null.
export function deDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h = '00', mi = '00'] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:00`;
}
