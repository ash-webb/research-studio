import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ensurePlan, planBlocks, sampleSummary, standardAnalysisPlan, validatePlan, planHTML } from '../src/plan.js';
import { activitySize, activityAnalysis, activityPlanCheck, renamePlanActivity, removeResearchQuestion, newActivityPlan } from '../src/method-plans.js';
import { sampleSizeForMargin, sampleSizeVsHalf, marginAt, benchmarkVerdict, wilson } from '../src/abstats.js';
import { flattenEvents, escapeHTML } from '../src/shared.js';
import { renderAnalyses } from '../src/results-ui.js';

globalThis.location = { href: 'http://localhost:8000/' };
const load = () => JSON.parse(readFileSync(new URL('../studies/demo-mixed.json', import.meta.url), 'utf8'));
const task = (s, id) => s.tasks.find(t => t.id === id);

test('planning statistics match independent values (SciPy)', () => {
  assert.equal(sampleSizeForMargin(0.5, 0.10), 97);
  assert.equal(sampleSizeForMargin(0.75, 0.09), 89);
  assert.equal(sampleSizeVsHalf(0.6), 194);
  assert.ok(Math.abs(marginAt(97, 0.5) - 0.097) < 0.003);
  assert.equal(benchmarkVerdict(wilson(45, 50), 0.7), 'above');
  assert.equal(benchmarkVerdict(wilson(25, 50), 0.7), 'below');
  assert.equal(benchmarkVerdict(wilson(35, 50), 0.7), 'inconclusive');
});
test('every non-A/B activity gets a plan with method defaults', () => {
  const s = load(); const p = ensurePlan(s);
  assert.deepEqual(Object.keys(p.activities).sort(), s.tasks.map(t => t.id).sort());
  assert.equal(p.activities['organize-content'].goal, task(s, 'organize-content').sortMode === 'open' ? 'explore' : 'validate');
  assert.equal(p.activities['choose-layout'].split, 60);
});
test('changing an activity method resets its plan; renaming keeps it', () => {
  const s = load(); const p = ensurePlan(s);
  p.activities['find-transcript'].objective = 'Can people find transcripts?';
  renamePlanActivity(p, 'find-transcript', 'find-doc'); task(s, 'find-transcript').id = 'find-doc'; ensurePlan(s);
  assert.equal(p.activities['find-doc'].objective, 'Can people find transcripts?');
  task(s, 'find-doc').method = 'survey'; ensurePlan(s);
  assert.equal(p.activities['find-doc'].method, 'survey'); assert.equal(p.activities['find-doc'].objective, '');
});
test('removing a research question re-points activity links', () => {
  const p = { researchQuestions: ['a', 'b', 'c'], activities: { x: { rqs: [0, 1, 2] } } };
  removeResearchQuestion(p, 1); assert.deepEqual(p.activities.x.rqs, [0, 1]);
});
test('sample-size guidance per method', () => {
  const s = load(); const p = ensurePlan(s);
  assert.match(activitySize(task(s, 'find-transcript'), { ...p.activities['find-transcript'], benchmark: 70 }).text, /About 81 people.*near 70%.*50 per tree/);
  assert.match(activitySize(task(s, 'organize-content'), { ...p.activities['organize-content'], goal: 'explore', target: 20 }).text, /About 20 people.*Tullis & Wood/);
  assert.match(activitySize(task(s, 'choose-layout'), p.activities['choose-layout']).text, /About 194 people.*60\/40/);
  const proto = { successSignal: '', method: 'prototype', id: 'p' };
  const d = activitySize(proto, newActivityPlan(proto));
  assert.equal(d.total, 12); assert.match(d.text, /6 people per round, 2 rounds/);
});
test('the study recruits for its largest need', () => {
  const s = load(); ensurePlan(s); const sum = sampleSummary(s);
  assert.equal(sum.top.n, 194); assert.equal(sum.top.name, task(s, 'choose-layout').title);
});
test('standard analysis covers every activity; benchmarks are stated when set', () => {
  const s = load(); const p = ensurePlan(s); p.activities['find-transcript'].benchmark = 70;
  const t = standardAnalysisPlan(s);
  for (const x of s.tasks) assert.ok(t.includes(`${x.title}:`), x.title);
  assert.match(activityAnalysis(task(s, 'find-transcript'), p.activities['find-transcript']), /benchmark of 70%/);
});
test('validation rejects out-of-range numbers and unknown goals', () => {
  const s = load(); const p = ensurePlan(s);
  assert.doesNotThrow(() => validatePlan(p, s));
  p.activities['find-transcript'].benchmark = 150; assert.throws(() => validatePlan(p, s), /benchmark/);
  p.activities['find-transcript'].benchmark = null; p.activities['organize-content'].goal = 'guess'; assert.throws(() => validatePlan(p, s), /goal/);
});
test('Word plan has activity plans and a sample-size section', () => {
  const s = load(); ensurePlan(s);
  const heads = planBlocks(s).filter(b => b.type === 'h1').map(b => b.text);
  assert.deepEqual(heads.slice(3, 5), ['4. Activity plans', '5. Sample size']);
  assert.ok(planBlocks(s).some(b => b.type === 'table' && b.rows.some(r => r[0] === 'Analysis')));
});
test('planner editor escapes researcher text', () => {
  const s = load(); const p = ensurePlan(s); p.activities['find-transcript'].objective = '<script>x</script>';
  const html = planHTML(s); assert.ok(html.includes('&lt;script&gt;x')); assert.ok(!html.includes('<script>x'));
});

// ---- checks shown with results ----
const ev = (s, t, session, kind, payload) => ({ study_id: s.id, session_id: session, task_id: t.id, kind, created_at: '2026-11-02T10:00:00Z', payload: { method: t.method, ...payload } });
test('tree test: success counted over everyone who started and compared with the benchmark', () => {
  const s = load(); const p = ensurePlan(s); p.edited = true; const t = task(s, 'find-transcript'); p.activities[t.id].benchmark = 50;
  const events = [];
  for (let i = 0; i < 60; i++) { events.push(ev(s, t, `s${i}`, 'task_started', {})); if (i < 50) events.push(ev(s, t, `s${i}`, 'task_ended', { result: { success: i < 45, direct: i < 30 } })); }
  const out = renderAnalyses({ ...s, tasks: [t] }, flattenEvents(events), escapeHTML);
  assert.match(out, /Task success, everyone who started: <strong>75%<\/strong> \(45 of 60/);
  assert.match(out, /Benchmark 50%: Above the benchmark/);
  assert.match(out, /Target not yet reached/);
});
test('preference: leading option vs 50% with two options', () => {
  const s = load(); const p = ensurePlan(s); p.edited = true; const t = task(s, 'choose-layout');
  const [a, b] = t.variants; const events = [];
  for (let i = 0; i < 100; i++) events.push(ev(s, t, `s${i}`, 'task_ended', { result: { selected_id: i < 70 ? a.id : b.id } }));
  const html = activityPlanCheck(t, p.activities[t.id], flattenEvents(events).tasks, flattenEvents(events));
  assert.match(html, /70%.*excludes 50%/s);
});
test('card sort (closed): cards below the agreement threshold are flagged', () => {
  const s = load(); const p = ensurePlan(s); const t = { ...task(s, 'organize-content'), sortMode: 'closed' };
  const ap = { ...p.activities[t.id], goal: 'validate', threshold: 80 };
  const cats = [{ id: 'g1', label: 'Money' }, { id: 'g2', label: 'Records' }];
  const data = Array.from({ length: 10 }, (_, i) => ({ session_id: `s${i}`, result: { completed: true, categories: cats, groups: Object.fromEntries(t.cards.map((c, j) => [c.id, j === 0 && i < 4 ? 'g2' : 'g1'])) } }));
  const html = activityPlanCheck(t, ap, data, { starts: [] });
  assert.match(html, new RegExp(`Below 80% agreement on a category: ${t.cards[0].label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(60% in Money\\)`));
});
test('untouched default plans are not shown with results', () => {
  const s = load(); ensurePlan(s); const t = task(s, 'find-transcript');
  const out = renderAnalyses({ ...s, tasks: [t] }, flattenEvents([ev(s, t, 'x', 'task_ended', { result: { success: true } })]), escapeHTML);
  assert.ok(!out.includes('Activity plan'));
});
