// v0.3.6: design assignment through the study link and the return-to-survey hand-off.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveAssignments, variantForTask, safeReturnUrl, buildReturnUrl, cleanExternalId} from '../src/methods.js';
import {variantRowError, nextVariant} from '../src/builder-ui.js';
const study = JSON.parse(readFileSync(new URL('../studies/demo-ab-implementation.json', import.meta.url), 'utf8'));
const params = q => new URLSearchParams(q);

test('link variant is used for every activity in the experiment', () => {
  const a = resolveAssignments(study, 'session-1', params('variant=design-b'));
  assert.deepEqual(a, {'portal-navigation-2026': {variant_id: 'design-b', source: 'link'}});
  for (const t of study.tasks) assert.equal(variantForTask(t, a).id, 'design-b');
});
test('experiment-specific parameter wins; unknown value falls back to built-in and is flagged', () => {
  assert.equal(resolveAssignments(study, 's', params('variant=design-b&variant.portal-navigation-2026=design-a'))['portal-navigation-2026'].variant_id, 'design-a');
  const fb = resolveAssignments(study, 's', params('variant=design-z'))['portal-navigation-2026'];
  assert.equal(fb.source, 'stable-hash-equal (link value not recognised)');
  assert.ok(['design-a', 'design-b'].includes(fb.variant_id));
});
test('no link value: built-in assignment, stable for the same session', () => {
  const one = resolveAssignments(study, 'same', params(''))['portal-navigation-2026'];
  assert.equal(one.source, 'stable-hash-equal');
  assert.deepEqual(resolveAssignments(study, 'same', params('')), {'portal-navigation-2026': one});
});
test('return address must be https on an allow-listed host', () => {
  assert.ok(safeReturnUrl('https://irs.qualtrics.com/jfe/form/SV_1'));
  assert.ok(safeReturnUrl('https://qualtrics.com/x'));
  assert.equal(safeReturnUrl('http://irs.qualtrics.com/x'), null);
  assert.equal(safeReturnUrl('https://qualtrics.com.evil.example/x'), null);
  assert.equal(safeReturnUrl('https://evilqualtrics.com/x'), null);
  assert.equal(safeReturnUrl('javascript:alert(1)'), null);
  assert.ok(safeReturnUrl('https://surveys.example.gov/s', ['example.gov']));
});
test('return link carries session, design and per-task A/B results, keeping existing parameters', () => {
  const url = new URL(buildReturnUrl(new URL('https://x.qualtrics.com/jfe/form/SV_1?Q_CHL=gl'), {
    sessionId: 'abc', status: 'complete',
    assignments: {'portal-navigation-2026': {variant_id: 'design-a', source: 'link'}},
    abResults: {'find-service-request': {variant_id: 'design-a', success_signal_status: 'received', self_report: 'completed', time_seconds: 41, click_count: 5}},
    tasks: study.tasks
  }));
  const q = Object.fromEntries(url.searchParams);
  assert.equal(q.Q_CHL, 'gl');
  assert.deepEqual([q.rs_session, q.rs_status, q.rs_variant, q.rs_ab1_task, q.rs_ab1_success, q.rs_ab1_self, q.rs_ab1_time, q.rs_ab1_clicks], ['abc', 'complete', 'design-a', 'find-service-request', 'received', 'completed', '41', '5']);
  assert.equal(q.rs_ab2_task, undefined, 'unfinished tasks are not reported');
});
test('participant IDs: Qualtrics-style IDs kept, anything else dropped', () => {
  assert.equal(cleanExternalId('R_3abcDEF123'), 'R_3abcDEF123');
  assert.equal(cleanExternalId('<script>'), null);
  assert.equal(cleanExternalId('a'.repeat(81)), null);
});
test('design rows: plain-language validation', () => {
  const ok = {id: 'design-a', label: 'A', prototypeUrl: 'https://x.example/a/'};
  assert.equal(variantRowError(ok, [ok]), '');
  assert.match(variantRowError({...ok, label: ''}, [ok]), /name/);
  assert.match(variantRowError({...ok, id: 'Design A'}, [ok]), /lowercase/);
  assert.match(variantRowError(ok, [ok, {...ok}]), /same ID/);
  assert.match(variantRowError({...ok, prototypeUrl: 'http://x.example/'}, [ok]), /https/);
  assert.equal(variantRowError({...ok, prototypeUrl: 'http://localhost:8000/a'}, [ok]), '');
  assert.deepEqual(nextVariant([{id: 'design-a'}, {id: 'design-b'}]).id, 'design-c');
});
test('return link carries time to first success when there was one, blank otherwise', () => {
  const url = new URL(buildReturnUrl(new URL('https://x.qualtrics.com/jfe/form/SV_1'), {
    sessionId: 'abc', status: 'complete',
    assignments: {'portal-navigation-2026': {variant_id: 'design-b', source: 'link'}},
    abResults: {'find-service-request': {variant_id: 'design-b', success_signal_status: 'received', self_report: 'completed', time_seconds: 41, click_count: 5, success_at_seconds: 23},
      'find-message': {variant_id: 'design-b', success_signal_status: 'not_observed', self_report: 'unable', time_seconds: 60, click_count: 9, success_at_seconds: null}},
    tasks: study.tasks
  }));
  assert.equal(url.searchParams.get('rs_ab1_tts'), '23');
  assert.equal(url.searchParams.get('rs_ab2_tts'), '');
});
