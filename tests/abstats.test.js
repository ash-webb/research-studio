// Reference values: Newcombe RG (1998) "Two-sided confidence intervals for the single proportion"
// and "Interval estimation for the difference between independent proportions", Statistics in
// Medicine 17; standard normal and chi-square tables; Fleiss sample-size formula worked by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { qnorm, wilson, diffProportions, median, medianCI, diffMedians, sampleRatioCheck, chiSquareSurvival, comparisonConfidence, sampleSizePerGroup, planStudy, deviceClass } from '../src/abstats.js';
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('inverse normal matches tables', () => {
  close(qnorm(0.975), 1.959964, 1e-6, 'z 0.975');
  close(qnorm(0.8), 0.841621, 1e-6, 'z 0.8');
  close(qnorm(0.0125), -2.241403, 1e-6, 'z 0.0125');
});
test('Wilson interval: Newcombe 1998 examples', () => {
  const a = wilson(81, 263); close(a.lo, 0.2553, 1e-4, '81/263 lo'); close(a.hi, 0.3662, 1e-4, '81/263 hi');
  const b = wilson(15, 148); close(b.lo, 0.0624, 1e-4, '15/148 lo'); close(b.hi, 0.1605, 1e-4, '15/148 hi');
  const z = wilson(0, 20); assert.equal(z.lo, 0); close(z.hi, 0.1611, 1e-4, '0/20 hi');
  const f = wilson(29, 29); close(f.lo, 0.8830, 1e-4, '29/29 lo'); assert.equal(f.hi, 1);
  assert.equal(wilson(0, 0), null);
});
test('difference of proportions: Newcombe 1998 method 10 example (56/70 − 48/80)', () => {
  const d = diffProportions(48, 80, 56, 70); // p2 − p1 = 0.8 − 0.6
  close(d.d, 0.2, 1e-12, 'difference'); close(d.lo, 0.0524, 1e-4, 'lo'); close(d.hi, 0.3339, 1e-4, 'hi');
  const e = diffProportions(9, 10, 3, 10); // 0.3 − 0.9, values cross-checked with an independent Python implementation
  close(e.lo, -0.8090, 1e-4, 'neg lo'); close(e.hi, -0.1705, 1e-4, 'neg hi');
});
test('medians and bootstrap intervals are deterministic and sensible', () => {
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 2, 3]), 2.5); assert.equal(median([]), null);
  const v = [30, 35, 41, 44, 47, 52, 55, 60, 64, 90];
  const a = medianCI(v), b = medianCI(v);
  assert.deepEqual(a, b, 'same data, same range');
  assert.ok(a.lo <= a.m && a.m <= a.hi && a.lo >= 30 && a.hi <= 90);
  assert.equal(medianCI([1, 2, 3]).lo, null, 'too few values → no range');
  const d = diffMedians([10, 12, 11, 13, 12, 11], [20, 22, 21, 23, 22, 21]);
  close(d.d, 10, 1e-9, 'median difference'); assert.ok(d.lo > 0 && d.hi < 14);
});
test('sample ratio check (chi-square goodness of fit vs equal groups)', () => {
  const r = sampleRatioCheck([13, 7]); close(r.chi2, 1.8, 1e-12, 'chi2'); close(r.p, 0.1797, 1e-4, 'p df1');
  close(chiSquareSurvival(5.991, 2), 0.05, 1e-4, 'df2 critical value');
  close(chiSquareSurvival(7.815, 3), 0.05, 1e-4, 'df3 critical value');
  close(sampleRatioCheck([50, 50]).p, 1, 1e-12, 'perfect balance');
});
test('comparison confidence adjusts for three designs', () => {
  assert.equal(comparisonConfidence(2), 0.95); close(comparisonConfidence(3), 0.975, 1e-12, '3 designs');
});
test('sample-size planner (Fleiss, no continuity correction)', () => {
  assert.equal(sampleSizePerGroup(0.5, 0.65), 170);
  assert.equal(sampleSizePerGroup(0.6, 0.8), 82);
  const p3 = planStudy({ baseline: 0.5, difference: 0.15, designs: 3 });
  assert.ok(p3.perDesign > 170 && p3.alpha === 0.025 && p3.total === p3.perDesign * 3);
  assert.equal(sampleSizePerGroup(0.5, 0.5), null);
});
test('device class from viewport width', () => {
  assert.deepEqual([deviceClass(390), deviceClass(820), deviceClass(1440), deviceClass(0)], ['phone', 'tablet', 'desktop', 'unknown']);
});
