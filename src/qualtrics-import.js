// Import Qualtrics CSV exports into Research Studio's event format (v0.3.7), entirely in the
// browser. Survey 2 (the follow-up survey) carries the rs_* fields from the return link; Survey 1
// (intake), if supplied, adds people who were assigned a design but never reached Survey 2.
import { normalizeMethod } from './methods.js';

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const t = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

// Qualtrics exports have a header row, then (usually) a question-text row and an ImportId row.
export function qualtricsRecords(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  let body = rows.slice(1);
  const isMeta = r => r.some(x => /^\{"ImportId"/.test(String(x).trim()));
  if (body[1] && isMeta(body[1])) body = body.slice(2);
  else if (body[0] && isMeta(body[0])) body = body.slice(1);
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const field = (rec, name) => { const k = Object.keys(rec).find(x => x.toLowerCase() === name.toLowerCase()); return k ? rec[k] : ''; };
export function classifyExport(records) {
  if (!records.length) return 'empty';
  const keys = Object.keys(records[0]).map(k => k.toLowerCase());
  if (keys.includes('rs_session') || keys.some(k => /^rs_ab\d+_task$/.test(k))) return 'survey2';
  if (keys.includes('variant') && (keys.includes('responseid'))) return 'survey1';
  return 'unknown';
}

const truthy = v => /^(1|true|yes)$/i.test(String(v).trim());
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Returns { events, summary, problems }.
export function eventsFromQualtrics(study, survey2, survey1 = []) {
  const abTasks = (study.tasks || []).filter(t => normalizeMethod(t) === 'ab_test');
  const byId = new Map(abTasks.map(t => [t.id, t]));
  const events = [], problems = [], unknownTasks = new Set();
  let seq = 0;
  const at = i => new Date(Date.UTC(2000, 0, 1) + i * 1000).toISOString();
  const push = (session_id, kind, task_id, payload) => events.push({ id: `qx-${++seq}`, study_id: study.id, session_id, kind, task_id, payload: { ...payload, imported: 'qualtrics' }, created_at: at(seq) });
  const seenPids = new Set();
  let used = 0;
  for (const rec of survey2) {
    const session = field(rec, 'rs_session');
    if (!session) continue;
    used++;
    const pid = field(rec, 'rs_pid'); if (pid) seenPids.add(pid);
    const device = field(rec, 'rs_device');
    push(session, 'session_started', null, { external_id: pid || null, device: device || null, study_version: null });
    for (let k = 1; k <= 20; k++) {
      const taskId = field(rec, `rs_ab${k}_task`);
      if (!taskId) continue;
      const task = byId.get(taskId);
      if (!task) { unknownTasks.add(taskId); continue; }
      const variant = field(rec, `rs_ab${k}_variant`) || field(rec, 'rs_variant');
      const exp = task.experimentId || task.id;
      const status = field(rec, `rs_ab${k}_success`) || 'unavailable';
      push(session, 'task_started', taskId, { method: 'ab_test', experiment_id: exp, variant_id: variant, assignment: 'link' });
      push(session, 'task_ended', taskId, {
        method: 'ab_test', experiment_id: exp, variant_id: variant,
        time_seconds: num(field(rec, `rs_ab${k}_time`)), click_count: num(field(rec, `rs_ab${k}_clicks`)),
        tracker_connected: status !== 'unavailable', self_report: field(rec, `rs_ab${k}_self`) || null,
        ...(status === 'received' ? { observed_success: true } : {}),
        result: { success_signal_status: status, experiment_id: exp, variant_id: variant }
      });
    }
    if (field(rec, 'rs_status') === 'complete') push(session, 'session_completed', null, {});
  }
  // Survey 1: assigned and sent to Research Studio, but no Survey 2 response → started, not finished.
  let dropouts = 0;
  for (const rec of survey1) {
    const rid = field(rec, 'ResponseId'), variant = field(rec, 'Variant');
    const finished = field(rec, 'Finished');
    if (!rid || !variant || (finished !== '' && !truthy(finished)) || seenPids.has(rid)) continue;
    dropouts++;
    const session = `qualtrics-${rid}`;
    push(session, 'session_started', null, { external_id: rid, study_version: null });
    for (const task of abTasks) push(session, 'task_started', task.id, { method: 'ab_test', experiment_id: task.experimentId || task.id, variant_id: variant, assignment: 'link' });
  }
  if (unknownTasks.size) problems.push(`This export has A/B activities that are not in the selected study: ${[...unknownTasks].join(', ')}. Choose the matching study and import again.`);
  if (!used) problems.push('No rows with rs_session were found. Check that Survey 2 declares the rs_… embedded data fields (see the Qualtrics setup guide).');
  return { events, summary: { responses: used, dropouts }, problems };
}
