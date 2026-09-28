// Percentile of a value within a station's own reference distribution.
//
// reference-stats.json format, per station id:
//   { "q": [p0, p10, p20, ..., p100] }   // 11 ascending breakpoints (m ü. NHN)
//
// We interpolate linearly between breakpoints -> 0..100. This answers the only
// question that is comparable across stations: "where does today sit within
// THIS well's own historical range?" — i.e. the hoch/niedrig axis.

export function percentileFromQuantiles(value, q) {
  if (value == null || !Array.isArray(q) || q.length < 2) return null;
  const n = q.length;               // breakpoints at 0,100/(n-1),...,100
  const step = 100 / (n - 1);
  if (value <= q[0]) return 0;
  if (value >= q[n - 1]) return 100;
  for (let i = 1; i < n; i++) {
    if (value <= q[i]) {
      const lo = q[i - 1], hi = q[i];
      const frac = hi === lo ? 0 : (value - lo) / (hi - lo);
      return +(step * (i - 1) + frac * step).toFixed(1);
    }
  }
  return null;
}

export function classFromPercentile(p) {
  if (p == null) return null;
  if (p >= 90) return 'vhigh';
  if (p >= 75) return 'high';
  if (p >= 25) return 'normal';
  if (p >= 10) return 'low';
  return 'vlow';
}

// Build 11 quantile breakpoints from a raw numeric series (used by the
// reference-stats build script).
export function quantiles11(series) {
  const xs = series.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < 12) return null;
  const q = [];
  for (let k = 0; k <= 10; k++) {
    const pos = (k / 10) * (xs.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    q.push(+(xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)).toFixed(3));
  }
  return q;
}
