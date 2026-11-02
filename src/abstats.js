// A/B statistics for Research Studio (v0.3.7). Pure functions, no dependencies.
// Everything here is descriptive estimation: ranges are 95% confidence intervals unless
// stated otherwise. Nothing in this module declares a "winner".

// ---------- distributions ----------
// Inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9).
export function qnorm(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  let q, r;
  if (p < lo) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function logGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (const v of g) ser += v / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
// Regularized upper incomplete gamma Q(a, x) (Numerical Recipes gammq).
function gammq(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) { // series for P, return 1-P
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d; // continued fraction for Q
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
export function chiSquareSurvival(x, df) { return gammq(df / 2, x / 2); }

// ---------- proportions ----------
// Wilson score interval: well behaved for small samples and rates near 0% or 100%.
export function wilson(k, n, conf = 0.95) {
  if (!n || !(k >= 0) || k > n) return null;
  const z = qnorm(1 - (1 - conf) / 2), p = k / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), k, n };
}
// Difference p2 − p1 with Newcombe's hybrid score interval (method 10, Newcombe 1998).
export function diffProportions(k1, n1, k2, n2, conf = 0.95) {
  if (!n1 || !n2) return null;
  const a = wilson(k1, n1, conf), b = wilson(k2, n2, conf), d = b.p - a.p;
  return { d, lo: d - Math.sqrt((b.p - b.lo) ** 2 + (a.hi - a.p) ** 2), hi: d + Math.sqrt((b.hi - b.p) ** 2 + (a.p - a.lo) ** 2) };
}

// ---------- medians ----------
export function median(values) {
  const v = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}
function rng(seed) { // mulberry32: deterministic, so the same data always gives the same ranges
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const MIN_BOOT = 5;
function quantile(sorted, q) { const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
// Percentile bootstrap interval for a median (2,000 resamples, fixed seed). Null below 5 values.
export function medianCI(values, conf = 0.95, B = 2000, seed = 7) {
  const v = values.filter(Number.isFinite);
  const m = median(v); if (m == null) return null;
  if (v.length < MIN_BOOT) return { m, lo: null, hi: null, n: v.length };
  const r = rng(seed), out = new Float64Array(B), s = new Array(v.length);
  for (let b = 0; b < B; b++) { for (let i = 0; i < v.length; i++) s[i] = v[(r() * v.length) | 0]; out[b] = median(s); }
  const sorted = Array.from(out).sort((x, y) => x - y), tail = (1 - conf) / 2;
  return { m, lo: quantile(sorted, tail), hi: quantile(sorted, 1 - tail), n: v.length };
}
// Difference in medians (b − a) with a percentile bootstrap interval.
export function diffMedians(a, b, conf = 0.95, B = 2000, seed = 11) {
  const x = a.filter(Number.isFinite), y = b.filter(Number.isFinite);
  if (!x.length || !y.length) return null;
  const d = median(y) - median(x);
  if (x.length < MIN_BOOT || y.length < MIN_BOOT) return { d, lo: null, hi: null };
  const r = rng(seed), out = new Float64Array(B), sx = new Array(x.length), sy = new Array(y.length);
  for (let i = 0; i < B; i++) {
    for (let j = 0; j < x.length; j++) sx[j] = x[(r() * x.length) | 0];
    for (let j = 0; j < y.length; j++) sy[j] = y[(r() * y.length) | 0];
    out[i] = median(sy) - median(sx);
  }
  const sorted = Array.from(out).sort((p, q) => p - q), tail = (1 - conf) / 2;
  return { d, lo: quantile(sorted, tail), hi: quantile(sorted, 1 - tail) };
}

// ---------- design checks ----------
// Sample ratio check: are group sizes more uneven than equal random assignment would produce?
export function sampleRatioCheck(counts) {
  const n = counts.reduce((s, c) => s + c, 0), k = counts.length;
  if (k < 2 || n === 0) return null;
  const e = n / k, x = counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
  return { chi2: x, df: k - 1, p: chiSquareSurvival(x, k - 1) };
}
// Confidence level for comparisons with the baseline: Bonferroni over (designs − 1) comparisons.
export function comparisonConfidence(designs, overall = 0.95) { return designs <= 2 ? overall : 1 - (1 - overall) / (designs - 1); }

// ---------- planning ----------
// People per design needed to detect a change from p1 to p2 (two-sided test of two proportions,
// normal approximation without continuity correction; Fleiss). alpha is per comparison.
export function sampleSizePerGroup(p1, p2, { alpha = 0.05, power = 0.8 } = {}) {
  if (!(p1 >= 0 && p1 <= 1 && p2 >= 0 && p2 <= 1) || p1 === p2) return null;
  const za = qnorm(1 - alpha / 2), zb = qnorm(power), pbar = (p1 + p2) / 2;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2;
  return Math.ceil(n);
}
// The target is baseline + difference; when that would pass 100% the drop baseline − difference
// is planned instead (never a silently capped, impossible target).
export function planStudy({ baseline, difference, designs = 2, power = 0.8, alpha = 0.05 }) {
  if (!(baseline > 0 && baseline < 1) || !(difference > 0 && difference < 1)) return null;
  let target = baseline + difference;
  if (target >= 1) target = baseline - difference;
  if (!(target > 0 && target < 1)) return null;
  const perComparison = designs <= 2 ? alpha : alpha / (designs - 1);
  const n = sampleSizePerGroup(baseline, target, { alpha: perComparison, power });
  return n ? { perDesign: n, total: n * designs, alpha: perComparison, power, target, direction: target > baseline ? 'up' : 'down' } : null;
}
// Smallest difference (as a proportion, in whole points) that n people per design would detect
// with the given power. Null when even a very large difference would not be reliably detected.
export function detectableDifference(n, baseline, { designs = 2, power = 0.8, alpha = 0.05 } = {}) {
  if (!(n > 0)) return null;
  const b = Math.min(0.95, Math.max(0.05, baseline ?? 0.5));
  for (let d = 1; d <= 90; d++) { const plan = planStudy({ baseline: b, difference: d / 100, designs, power, alpha }); if (plan && plan.perDesign <= n) return d / 100; }
  return null;
}

// ---------- device class from viewport width (CSS px) ----------
export function deviceClass(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 'unknown';
  return w < 700 ? 'phone' : w < 1100 ? 'tablet' : 'desktop';
}
