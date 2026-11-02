import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ensurePlan, applyControl, renamePlanVariant, hypothesisSentence, experimentsOf, standardAnalysisPlan, validatePlan, planBlocks, planDocx, planHTML } from '../src/plan.js';
import { zipStore } from '../src/docx.js';
import { flattenEvents, escapeHTML } from '../src/shared.js';
import { renderAnalyses } from '../src/results-ui.js';

globalThis.location = { href: 'http://localhost:8000/' };
const load = () => JSON.parse(readFileSync(new URL('../studies/demo-ab-implementation.json', import.meta.url), 'utf8'));

test('ensurePlan creates a plan per experiment with the first design as control and one hypothesis per treatment', () => {
  const s = load(); const p = ensurePlan(s); const [exp] = experimentsOf(s);
  const e = p.experiments[exp.id];
  assert.equal(e.controlId, 'design-a');
  assert.deepEqual(e.hypotheses.map(h => h.treatmentId), ['design-b']);
  assert.equal(e.primaryMeasure, 'success');
});
test('choosing a control moves it first in every activity of the experiment and re-points hypotheses', () => {
  const s = load(); ensurePlan(s); const [exp] = experimentsOf(s);
  applyControl(s, exp.id, 'design-b'); ensurePlan(s);
  for (const t of exp.tasks) assert.equal(t.variants[0].id, 'design-b');
  assert.equal(s.plan.experiments[exp.id].hypotheses[0].treatmentId, 'design-a');
  assert.match(hypothesisSentence(experimentsOf(s)[0], s.plan.experiments[exp.id], s.plan.experiments[exp.id].hypotheses[0]), /^Compared with Design A \(Dashboard shortcuts\), the control, Design B \(Sidebar navigation\) will have a higher task success rate\.$/);
});
test('renaming a design ID keeps its role, description and hypotheses', () => {
  const s = load(); ensurePlan(s); const [exp] = experimentsOf(s); const e = s.plan.experiments[exp.id];
  e.treatments['design-b'] = 'Tiles';
  renamePlanVariant(s, exp.id, 'design-b', 'tiles');
  assert.equal(e.treatments.tiles, 'Tiles'); assert.equal(e.hypotheses[0].treatmentId, 'tiles');
});
test('time hypotheses read naturally', () => {
  const s = load(); ensurePlan(s); const [exp] = experimentsOf(s); const e = s.plan.experiments[exp.id];
  assert.match(hypothesisSentence(exp, e, { treatmentId: 'design-b', direction: 'lower', measure: 'time' }), /will need less active time on the task\.$/);
});
test('standard analysis plan states the denominator, intervals, target and stopping rule', () => {
  const s = load(); ensurePlan(s); const t = standardAnalysisPlan(s);
  assert.match(t, /Everyone assigned to a design is included in its denominator/);
  assert.match(t, /Newcombe/); assert.match(t, /Target sample: \d+ people assigned per design/); assert.match(t, /No early stopping/);
  const three = load(); three.tasks.forEach(x => x.variants.push({ id: 'design-c', label: 'C', prototypeUrl: 'demo/ab-design-a.html' })); ensurePlan(three);
  assert.match(standardAnalysisPlan(three), /97\.5% \(Bonferroni\)/);
});
test('validatePlan rejects a control that is not a design and bad hypotheses', () => {
  const s = load(); ensurePlan(s); const id = experimentsOf(s)[0].id;
  assert.doesNotThrow(() => validatePlan(s.plan, s));
  s.plan.experiments[id].controlId = 'nope'; assert.throws(() => validatePlan(s.plan, s), /control/);
  s.plan.experiments[id].controlId = 'design-a'; s.plan.experiments[id].hypotheses[0].direction = 'up'; assert.throws(() => validatePlan(s.plan, s), /direction/);
});
test('plan editor escapes researcher text', () => {
  const s = load(); ensurePlan(s); s.plan.background = '<img src=x onerror=alert(1)>';
  const html = planHTML(s); assert.ok(html.includes('&lt;img src=x')); assert.ok(!html.includes('<img src=x'));
});
test('plan document covers every section, and the change log only when locked', () => {
  const s = load(); ensurePlan(s);
  const heads = planBlocks(s).filter(b => b.type === 'h1').map(b => b.text);
  assert.deepEqual(heads, ['1. Background', '2. Research questions', '3. Participants', '4. Designs and hypotheses', '5. Procedure', '6. Analysis plan', '7. How results will be used']);
  s.plan.locked = { at: '2026-11-02T10:00:00Z' }; s.plan.changes = [{ at: '2026-11-03T10:00:00Z', what: 'Study plan › Background', before: 'a', after: 'b', reason: '' }];
  assert.ok(planBlocks(s).some(b => b.text === '8. Change log'));
});
test('.docx is a valid package Word can open (checked with python-docx when available)', () => {
  const s = load(); ensurePlan(s); s.plan.background = 'Ampersand & <angle> "quote" — dash';
  const bytes = planDocx(s, new Date('2026-11-02T10:00:00Z'));
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  try {
    const out = execFileSync('python3', ['-c', 'import sys,io,docx;d=docx.Document(io.BytesIO(sys.stdin.buffer.read()));print(d.paragraphs[0].text);print(any("Ampersand & <angle>" in p.text for p in d.paragraphs));print(len(d.tables))'], { input: Buffer.from(bytes) }).toString().trim().split('\n');
    assert.equal(out[0], s.title); assert.equal(out[1], 'True'); assert.ok(Number(out[2]) >= 3);
  } catch (err) { if (/No module named|ENOENT/.test(String(err.stderr || err.message))) return; throw err; }
});
test('zip writer CRCs match a known value', () => {
  const z = zipStore([{ name: 'a.txt', data: 'hello' }], new Date('2026-01-01T00:00:00'));
  const crc = new DataView(z.buffer).getUint32(14, true);
  assert.equal(crc.toString(16), '3610a686');
});
test('A/B results show the plan, target size and each hypothesis without naming a winner', () => {
  const s = load(); ensurePlan(s); const task = s.tasks[0];
  const empty = renderAnalyses({ ...s, tasks: [task] }, flattenEvents([]), escapeHTML);
  assert.ok(!empty.includes('class="ab-plan"'), 'an untouched default plan is not shown in results');
  s.plan.locked = { at: '2026-11-02T10:00:00Z' };
  const ev = []; let n = 0;
  const person = (v, sig) => { const id = `p${++n}`; ev.push({ study_id: s.id, session_id: id, task_id: task.id, kind: 'task_started', created_at: '2026-11-02T10:00:00Z', payload: { method: 'ab_test', experiment_id: task.experimentId, variant_id: v } }, { study_id: s.id, session_id: id, task_id: task.id, kind: 'task_ended', created_at: '2026-11-02T10:01:00Z', payload: { method: 'ab_test', experiment_id: task.experimentId, variant_id: v, time_seconds: 40, click_count: 3, tracker_connected: true, self_report: 'completed', result: { success_signal_status: sig } } }); };
  for (let i = 0; i < 30; i++) { person('design-a', i < 12 ? 'received' : 'not_observed'); person('design-b', i < 27 ? 'received' : 'not_observed'); }
  const out = renderAnalyses({ ...s, tasks: [task] }, flattenEvents(ev), escapeHTML);
  assert.match(out, /Study plan<\/strong> · locked/);
  assert.match(out, /Target: \d+ people per design; smallest group now 30/);
  assert.match(out, /H1\.<\/strong> Compared with Design A/);
  assert.match(out, /Consistent with the hypothesis/);
  assert.match(out, /Target sample not yet reached/);
  assert.ok(!/winner(?! is declared)/i.test(out.replace(/do not pick a winner/g, '')));
});
test('primary measure "self-reported" in the plan switches the main A/B measure', () => {
  const s = load(); ensurePlan(s); s.plan.edited = true; s.plan.experiments[s.tasks[0].experimentId].primaryMeasure = 'self';
  const out = renderAnalyses({ ...s, tasks: [s.tasks[0]] }, flattenEvents([]), escapeHTML);
  assert.match(out, /Primary measure: Self-reported completion/);
});
