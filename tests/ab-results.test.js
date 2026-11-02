import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flattenEvents, escapeHTML } from '../src/shared.js';
import { analyzeAB, renderABCore, plannerText } from '../src/ab-results.js';
import { qualtricsRecords, eventsFromQualtrics } from '../src/qualtrics-import.js';
import { planStudy } from '../src/abstats.js';

const study = JSON.parse(readFileSync(new URL('../studies/demo-ab-implementation.json', import.meta.url), 'utf8'));
const task = study.tasks[0];
const fx = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const run = (events, t = task) => { const flat = flattenEvents(events); return analyzeAB(t, flat.tasks.filter(x => x.task_id === t.id), flat); };
let n = 0;
const person = (variant, { finish = true, signal = 'received', time = 40, tracked = true } = {}) => {
  const s = `s${++n}`, base = { study_id: study.id, session_id: s, task_id: task.id };
  const ev = [{ ...base, task_id: null, kind: 'session_started', payload: { viewport_width: 1200 }, created_at: '2026-11-01T10:00:00Z' },
    { ...base, kind: 'task_started', payload: { method: 'ab_test', experiment_id: task.experimentId, variant_id: variant }, created_at: '2026-11-01T10:00:01Z' }];
  if (finish) ev.push({ ...base, kind: 'task_ended', created_at: '2026-11-01T10:01:00Z', payload: { method: 'ab_test', experiment_id: task.experimentId, variant_id: variant, time_seconds: time, click_count: tracked ? 3 : null, tracker_connected: tracked, self_report: 'completed', result: { success_signal_status: tracked ? signal : 'unavailable', variant_id: variant } } });
  return ev;
};
const many = (k, ...a) => Array.from({ length: k }, () => person(...a)).flat();

test('C1: main measure counts everyone assigned; drop-outs are not successes', () => {
  const an = run([...many(20, 'design-a'), ...many(10, 'design-b'), ...many(10, 'design-b', { finish: false })]);
  const [a, b] = an.designs;
  assert.equal(a.primary.n, 20); assert.equal(a.primary.p, 1);
  assert.equal(b.primary.n, 20); assert.equal(b.primary.k, 10);
  assert.equal(b.measuredRate.p, 1, 'secondary rate among measured finishers is 100%');
  assert.equal(b.dropped, 10);
});
test('C1: imported fixture compares 16/35 vs 22/35 and flags that counting methods disagree', () => {
  const { events } = eventsFromQualtrics(study, qualtricsRecords(fx('qualtrics-survey2-SYNTHETIC.csv')), qualtricsRecords(fx('qualtrics-survey1-SYNTHETIC.csv')));
  const an = run(events);
  assert.deepEqual(an.designs.map(d => [d.primary.k, d.primary.n]), [[16, 35], [22, 35]]);
  const c = an.comparisons[0];
  assert.ok(c.primary.lo < 0 && c.primary.hi > 0, 'everyone-assigned range includes zero');
  assert.ok(c.measured.lo > 0, 'measured-finisher range excludes zero');
  assert.ok(an.checks.some(x => x.title === 'Ways of counting disagree' && x.level === 'warn'));
});
test('C2: missing times are left out, never treated as 0 seconds', () => {
  const an = run([...many(6, 'design-a', { time: null }), ...many(6, 'design-a', { time: 30 }), ...many(12, 'design-b')]);
  assert.equal(an.designs[0].times.length, 6);
  assert.equal(an.designs[0].time.m, 30);
});
test('C2: tied times give "range not estimable", not a zero-width range', () => {
  const out = renderABCore(run([...many(12, 'design-a', { time: 30 }), ...many(12, 'design-b', { time: 30 })]), escapeHTML);
  assert.ok(out.includes('range not estimable'));
});
test('C4: imported data without Survey 1 reports drop-out as unknown and skips the group-size check', () => {
  const { events } = eventsFromQualtrics(study, qualtricsRecords(fx('qualtrics-survey2-SYNTHETIC.csv')));
  const an = run(events);
  assert.equal(an.dropoutUnknown, true);
  assert.equal(an.designs[0].dropped, null);
  assert.ok(an.checks.find(c => c.title === 'Drop-out').text.startsWith('Unknown'));
  assert.equal(an.checks.find(c => c.title === 'Group sizes').level, 'info');
});
test('C5: planner never caps the target; near 100% it plans a drop instead', () => {
  const p = planStudy({ baseline: 0.9, difference: 0.15 });
  assert.equal(p.direction, 'down'); assert.ok(Math.abs(p.target - 0.75) < 1e-9);
  assert.match(plannerText({ baseline: 90, difference: 15, power: 0.8, designs: 2, measured: 10 }), /from 90% to 75%.*planned as a drop/);
  assert.match(plannerText({ baseline: 50, difference: 15, power: 0.8, designs: 2, measured: 10 }), /an 80% chance/);
});
test('repeated task starts in one session count as one person', () => {
  const ev = person('design-a'); const dup = { ...ev[1], created_at: '2026-11-01T10:00:30Z' };
  const an = run([...ev, dup, ...many(3, 'design-b')]);
  assert.equal(an.designs[0].assigned, 1);
});
test('wording: no winner, provisional banner and range language', () => {
  const out = renderABCore(run([...many(15, 'design-a'), ...many(15, 'design-b', { signal: 'not_observed' })]), escapeHTML);
  assert.ok(out.includes('Provisional.'));
  assert.ok(out.includes('excludes zero'));
  assert.ok(out.includes('Overlapping ranges in the chart above are not a test'));
  assert.ok(!/winner/i.test(out));
});
