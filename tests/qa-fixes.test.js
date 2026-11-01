// Regression tests for defects found in the v0.3 browser QA pass (see docs/QA-REPORT-v0.3.1.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderAnalyses} from '../src/results-ui.js';
import {escapeHTML, flattenEvents, separatePreviewSessions, csv} from '../src/shared.js';

const firstClickStudy = JSON.parse(readFileSync(new URL('../studies/demo-first-click.json', import.meta.url), 'utf8'));
const ended = (session, task, payload) => ({kind:'task_ended', study_id:'s', session_id:session, task_id:task, created_at:'2026-11-01T10:00:00Z', payload});
const started = (session, payload = {}) => ({kind:'session_started', study_id:'s', session_id:session, created_at:'2026-11-01T09:59:00Z', payload});

test('first-click hit rate counts "not sure" answers as scored attempts', () => {
  const task = firstClickStudy.tasks[0];
  const flat = {tasks:[
    {task_id:task.id, session_id:'a', result:{click:{x_pct:10,y_pct:40}, hit_target:true, scored:true}},
    {task_id:task.id, session_id:'b', result:{click:{x_pct:60,y_pct:60}, hit_target:false, scored:true}},
    {task_id:task.id, session_id:'c', result:{click:null, hit_target:null, scored:true, participant_could_not_choose:true}}
  ], answers:[]};
  const out = renderAnalyses(firstClickStudy, flat, escapeHTML);
  assert.match(out, /Target hit rate: <strong>1\/3 \(33%\)<\/strong>/);
  assert.match(out, /Not sure \(no click\): <strong>1<\/strong>/);
  assert.match(out, /Recorded first clicks: <strong>2\/3<\/strong>/);
});

test('missing success evidence stays unknown (null) instead of false in flattened tasks', () => {
  const flat = flattenEvents([
    started('one'),
    ended('one', 'sort', {method:'card_sort', result:{completed:true}}),
    ended('one', 'proto', {method:'prototype', tracker_connected:false, result:{success_signal_status:'unavailable'}}),
    ended('one', 'tree', {method:'tree_test', observed_success:false, result:{success:false}}),
    ended('one', 'tree2', {method:'tree_test', observed_success:true, result:{success:true}})
  ]);
  assert.deepEqual(flat.tasks.map(t => t.observed_success), [null, null, false, true]);
  const text = csv(flat.tasks, ['task_id', 'observed_success']);
  assert.ok(text.includes('"sort",""'), 'unknown outcome must export as a blank cell');
  assert.ok(text.includes('"tree","false"'));
});

test('preview sessions are excluded by default and counted', () => {
  const events = [
    started('real'), ended('real', 't', {method:'survey'}),
    started('prev', {preview:true}), ended('prev', 't', {method:'survey'})
  ];
  const hidden = separatePreviewSessions(events);
  assert.equal(hidden.previewCount, 1);
  assert.deepEqual([...new Set(hidden.events.map(e => e.session_id))], ['real']);
  const shown = separatePreviewSessions(events, true);
  assert.equal(shown.events.length, 4);
  assert.equal(flattenEvents(shown.events).sessions.find(s => s.session_id === 'prev').preview, true);
});

test('sessions recorded before the preview flag existed are still counted', () => {
  const legacy = [started('old', {study_version:'0.2.0'}), ended('old', 't', {method:'survey'})];
  assert.equal(separatePreviewSessions(legacy).events.length, 2);
});

test('prototype analysis without a configured success signal does not show a signal rate', () => {
  const study = {tasks:[{id:'p', method:'prototype', title:'Proto', instructions:'x'}]};
  const out = renderAnalyses(study, {tasks:[{task_id:'p', session_id:'a', tracker_connected:true, observed_success:null, self_report:'completed', result:{}}], answers:[]}, escapeHTML);
  assert.match(out, /Observed signals: <strong>No signal configured<\/strong>/);
});
