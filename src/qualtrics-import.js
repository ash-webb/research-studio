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
// Blank or non-numeric → null (missing), never 0.
const num = v => { const t = String(v ?? '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
// Live responses only: Qualtrics Status 0 / "IP Address" (and 16 / "Offline"); previews, tests,
// spam and imported responses are left out, as are preview/test distribution channels.
export function isLiveResponse(rec) {
  const status = field(rec, 'Status').trim(), channel = field(rec, 'DistributionChannel').trim().toLowerCase();
  if (['preview', 'test'].includes(channel)) return false;
  return status === '' || ['0', 'ip address', '16', 'offline'].includes(status.toLowerCase());
}

// Returns { events, summary, problems (stop the import), warnings (shown with the results) }.
export function eventsFromQualtrics(study, survey2In, survey1In = []) {
  const abTasks = (study.tasks || []).filter(t => normalizeMethod(t) === 'ab_test');
  const byId = new Map(abTasks.map(t => [t.id, t]));
  const events = [], problems = [], warnings = [], unknownTasks = new Set();
  const survey1Provided = survey1In.length > 0;
  let seq = 0;
  const at = i => new Date(Date.UTC(2000, 0, 1) + i * 1000).toISOString();
  const push = (session_id, kind, task_id, payload) => events.push({ id: `qx-${++seq}`, study_id: study.id, session_id, kind, task_id, payload: { ...payload, imported: 'qualtrics' }, created_at: at(seq) });

  // ---- clean Survey 1: live, finished (sent on to Research Studio), with a design; one row per ResponseId
  const s1 = new Map(); let s1NotLive = 0, s1Dupes = 0;
  for (const rec of survey1In) {
    if (!isLiveResponse(rec)) { s1NotLive++; continue; }
    const rid = field(rec, 'ResponseId'), variant = field(rec, 'Variant'), finished = field(rec, 'Finished');
    if (!rid || !variant || (finished !== '' && !truthy(finished))) continue;
    if (s1.has(rid)) { s1Dupes++; continue; }
    s1.set(rid, variant);
  }
  // ---- clean Survey 2: live, one row per Research Studio session and per participant ID
  const seenSessions = new Set(), seenPids = new Set();
  let s2NotLive = 0, s2Dupes = 0, blankPid = 0, unmatched = 0, mismatched = 0, used = 0;
  const rows = [];
  for (const rec of survey2In) {
    if (!isLiveResponse(rec)) { s2NotLive++; continue; }
    const session = field(rec, 'rs_session'); if (!session) continue;
    const pid = field(rec, 'rs_pid');
    if (seenSessions.has(session) || (pid && seenPids.has(pid))) { s2Dupes++; continue; }
    seenSessions.add(session); if (pid) seenPids.add(pid); else blankPid++;
    rows.push(rec);
  }
  // Drop-outs can only be counted when every Survey 2 row can be matched to Survey 1.
  const canCountDropouts = survey1Provided && blankPid === 0;
  for (const rec of rows) {
    const session = field(rec, 'rs_session'), pid = field(rec, 'rs_pid');
    const assigned = pid ? s1.get(pid) : undefined;
    if (survey1Provided && pid && !assigned) unmatched++;
    used++;
    push(session, 'session_started', null, { external_id: pid || null, device: field(rec, 'rs_device') || null, study_version: null, survey1_provided: canCountDropouts });
    for (let k = 1; k <= 20; k++) {
      const taskId = field(rec, `rs_ab${k}_task`);
      if (!taskId) continue;
      const task = byId.get(taskId);
      if (!task) { unknownTasks.add(taskId); continue; }
      const linkVariant = field(rec, `rs_ab${k}_variant`) || field(rec, 'rs_variant');
      // Survey 1's randomizer is the record of assignment; the link value is checked against it.
      const fromS1 = assigned && task.variants.some(v => v.id === assigned) ? assigned : null;
      if (fromS1 && linkVariant && linkVariant !== fromS1) mismatched++;
      const variant = fromS1 || linkVariant;
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
  // ---- Survey 1 people with no Survey 2 response: assigned, started, not finished
  let dropouts = 0;
  if (canCountDropouts) for (const [rid, variant] of s1) {
    if (seenPids.has(rid)) continue;
    dropouts++;
    const session = `qualtrics-${rid}`;
    push(session, 'session_started', null, { external_id: rid, study_version: null, survey1_provided: true });
    // Only activities whose experiment actually has this design ID.
    for (const task of abTasks) if (task.variants.some(v => v.id === variant)) push(session, 'task_started', task.id, { method: 'ab_test', experiment_id: task.experimentId || task.id, variant_id: variant, assignment: 'link' });
  }
  if (unknownTasks.size) problems.push(`This export has A/B activities that are not in the selected study: ${[...unknownTasks].join(', ')}. Choose the matching study and import again.`);
  if (!used) problems.push('No usable Survey 2 rows with rs_session were found. Check that Survey 2 declares the rs_… embedded data fields (see the Qualtrics setup guide).');
  if (s1NotLive + s2NotLive) warnings.push(`Left out ${s1NotLive + s2NotLive} preview, test or imported response${s1NotLive + s2NotLive === 1 ? '' : 's'}.`);
  if (s1Dupes + s2Dupes) warnings.push(`Removed ${s1Dupes + s2Dupes} duplicate row${s1Dupes + s2Dupes === 1 ? '' : 's'}.`);
  if (!survey1Provided) warnings.push('Survey 1 was not imported, so drop-out and group balance are unknown.');
  else if (blankPid) warnings.push(`${blankPid} Survey 2 row${blankPid === 1 ? ' has' : 's have'} no rs_pid, so they can't be matched to Survey 1: drop-out is not counted.`);
  if (unmatched) warnings.push(`${unmatched} Survey 2 row${unmatched === 1 ? '' : 's'} had an rs_pid not found among finished Survey 1 responses.`);
  if (mismatched) warnings.push(`${mismatched} task result${mismatched === 1 ? '' : 's'} showed a different design from the one Survey 1 assigned; Survey 1's assignment was used.`);
  return { events, summary: { responses: used, dropouts, survey1Provided: canCountDropouts }, problems, warnings };
}
