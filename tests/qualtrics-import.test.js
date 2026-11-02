import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, qualtricsRecords, classifyExport, eventsFromQualtrics } from '../src/qualtrics-import.js';
import { flattenEvents } from '../src/shared.js';
globalThis.location = { href: 'http://localhost:8000/' };
const study = JSON.parse(readFileSync(new URL('../studies/demo-ab-implementation.json', import.meta.url), 'utf8'));
const fx = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('CSV parser handles quotes, commas, newlines in cells and BOM', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n"x, y","line1\nline2"\r\n"q ""quoted""",2'), [['a', 'b'], ['x, y', 'line1\nline2'], ['q "quoted"', '2']]);
});
test('Qualtrics three-row header is skipped and exports are classified', () => {
  const s1 = qualtricsRecords(fx('qualtrics-survey1-SYNTHETIC.csv')), s2 = qualtricsRecords(fx('qualtrics-survey2-SYNTHETIC.csv'));
  assert.equal(s1.length, 70); assert.equal(s2.length, 59);
  assert.equal(classifyExport(s1), 'survey1'); assert.equal(classifyExport(s2), 'survey2');
  assert.ok(s1[0].ResponseId.startsWith('R_TEST'));
});
test('events from Qualtrics: results per task and Survey 1 drop-outs', () => {
  const { events, summary, problems } = eventsFromQualtrics(study, qualtricsRecords(fx('qualtrics-survey2-SYNTHETIC.csv')), qualtricsRecords(fx('qualtrics-survey1-SYNTHETIC.csv')));
  assert.deepEqual(problems, []);
  assert.deepEqual(summary, { responses: 59, dropouts: 11 });
  const flat = flattenEvents(events);
  assert.equal(flat.sessions.length, 70);
  assert.equal(flat.starts.filter(s => s.task_id === 'find-service-request').length, 70);
  assert.equal(flat.tasks.filter(t => t.task_id === 'find-service-request').length, 59);
  assert.ok(flat.tasks.every(t => ['design-a', 'design-b'].includes(t.variant_id)));
});
test('tasks not in the selected study are reported, not silently dropped', () => {
  const s2 = [{ rs_session: 's1', rs_pid: 'R_1', rs_status: 'complete', rs_ab1_task: 'other-task', rs_ab1_variant: 'design-a', rs_ab1_success: 'received' }];
  const r = eventsFromQualtrics(study, s2);
  assert.match(r.problems.join(' '), /other-task/);
});
