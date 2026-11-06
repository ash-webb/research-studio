// Civic Research Studio inside a Qualtrics survey (v0.3.11): shared by the participant page, the setup
// page and the Qualtrics import.
//
// The survey shows study.html?embed=qualtrics in an iframe. Its question JavaScript
// (docs/qualtrics-embed.js) answers Civic Research Studio's "hello" from an approved Qualtrics address,
// then saves what Civic Research Studio sends into embedded data fields:
//   rs_session, rs_status, rs_pid, rs_device, rs_variant, rs_abN_*   — the same summary as the return link
//   rs_q_<question>                                                   — answers to the study's own questions
//   rs_data_1 … rs_data_N, rs_data_parts, rs_data_chars, rs_data_sha256 — every event of the session
// Each value stays under Excel's 32,767-character cell limit.
import { normalizeMethod, resultFields } from './methods.js';

export const EMBED_NS = 'RS_QX';
export const EMBED_VERSION = 1;
export const PART_CHARS = 30000;
export const MAX_PARTS = 8;
export const ANSWER_CHARS = 5000;
export const FIELD_RE = /^rs_[a-z0-9_]{1,60}$/;

// https only, the host itself or a subdomain of an allowed host.
export function hostAllowed(origin, hosts) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.origin !== origin) return false;
    return (hosts || []).some(h => { h = String(h).toLowerCase().replace(/^\.+/, ''); return h && (u.hostname === h || u.hostname.endsWith('.' + h)); });
  } catch { return false; }
}

// ---------- answers ----------
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 54) || 'q';
// Every question in the study, in order, with the embedded data field it is saved to.
export function answerFields(study) {
  const out = [], used = new Set();
  const add = (q, stage, taskId) => {
    let name = `rs_q_${slug(q.id)}`, n = 2;
    while (used.has(name)) name = `rs_q_${slug(q.id)}_${n++}`;
    used.add(name); out.push({ field: name, question_id: q.id, stage, task_id: taskId || null, text: q.text || '' });
  };
  for (const q of study.preQuestions || []) add(q, 'pre');
  for (const t of study.tasks || []) {
    // Survey activities ask their questions as the activity itself; others ask them afterwards.
    for (const q of t.questions || []) add(q, normalizeMethod(t) === 'survey' ? 'activity' : 'post_task', t.id);
  }
  for (const q of study.postQuestions || []) add(q, 'post');
  return out;
}
const answerText = v => (Array.isArray(v) ? v.join('|') : String(v ?? '')).slice(0, ANSWER_CHARS);

// ---------- full session ----------
// Compact form: study and session once, then [kind, task_id, created_at, payload] per event.
export function packSession(studyId, sessionId, events) {
  return JSON.stringify({ v: EMBED_VERSION, study_id: studyId, session_id: sessionId,
    events: events.map(e => [e.kind, e.task_id ?? null, e.created_at, e.payload || {}]) });
}
export function unpackSession(text) {
  const o = JSON.parse(text);
  if (!o || o.v !== EMBED_VERSION || !Array.isArray(o.events) || typeof o.session_id !== 'string') throw new Error('Unrecognised session data.');
  return { study_id: o.study_id, session_id: o.session_id, events: o.events.map(([kind, task_id, created_at, payload], i) => ({
    id: `qxe-${o.session_id}-${i}`, study_id: o.study_id, session_id: o.session_id, kind, task_id, payload: payload || {}, created_at })) };
}
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function splitParts(text, size = PART_CHARS) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts.length ? parts : [''];
}

// Everything the survey should store at this point of the session.
// events: every event of this session so far. Returns { fields, parts, chars, truncated }.
export async function surveyFields({ study, sessionId, status, assignments, abResults, externalId, device, events }) {
  const fields = { ...resultFields({ sessionId, status, assignments, abResults, tasks: study.tasks, externalId, device }) };
  // Latest answer per question (a question can only be answered once, but be safe after reloads).
  const latest = new Map();
  for (const e of events) if (e.kind === 'answers') for (const [qid, v] of Object.entries(e.payload?.answers || {})) latest.set(`${e.payload?.stage}|${e.task_id ?? ''}|${qid}`, v);
  for (const a of answerFields(study)) {
    const v = latest.get(`${a.stage}|${a.task_id ?? ''}|${a.question_id}`);
    fields[a.field] = v === undefined ? '' : answerText(v);
  }
  let text = packSession(study.id, sessionId, events), truncated = false;
  // Keep within MAX_PARTS: drop the oldest click/scroll batches first, never outcomes or answers.
  if (text.length > PART_CHARS * MAX_PARTS) {
    const keep = [...events];
    while (text.length > PART_CHARS * MAX_PARTS) {
      const i = keep.findIndex(e => e.kind === 'interaction_batch');
      if (i < 0) break;
      keep.splice(i, 1); truncated = true;
      text = packSession(study.id, sessionId, keep);
    }
  }
  const parts = splitParts(text);
  if (parts.length > MAX_PARTS) throw new Error('Session data is too large for the survey.');
  for (let i = 1; i <= MAX_PARTS; i++) fields[`rs_data_${i}`] = parts[i - 1] ?? '';
  fields.rs_data_parts = String(parts.length);
  fields.rs_data_chars = String(text.length);
  fields.rs_data_sha256 = await sha256Hex(text);
  fields.rs_data_truncated = truncated ? 'yes' : '';
  return { fields, parts: parts.length, chars: text.length, truncated };
}

// Every field the survey must declare (Qualtrics only stores declared embedded data).
export function fieldNames(study) {
  const ab = (study.tasks || []).filter(t => normalizeMethod(t) === 'ab_test');
  const exps = [...new Set(ab.map(t => t.experimentId || t.id))];
  const names = ['rs_embed_ok', 'rs_session', 'rs_status', 'rs_pid', 'rs_device'];
  if (study.allowedDevices === 'desktop') names.push('rs_device_class'); // set by docs/qualtrics-device-check.js
  if (exps.length <= 1) names.push('rs_variant'); else for (const x of exps) names.push(`rs_variant_${x}`);
  ab.forEach((t, i) => { for (const k of ['task', 'variant', 'success', 'self', 'time', 'tts', 'clicks']) names.push(`rs_ab${i + 1}_${k}`); });
  for (const a of answerFields(study)) names.push(a.field);
  for (let i = 1; i <= MAX_PARTS; i++) names.push(`rs_data_${i}`);
  names.push('rs_data_parts', 'rs_data_chars', 'rs_data_sha256', 'rs_data_truncated');
  return names;
}

// ---------- reading a survey export back ----------
const get = (rec, name) => {
  const want = [name.toLowerCase(), `__js_${name}`.toLowerCase()];
  for (const w of want) { const k = Object.keys(rec).find(x => x.toLowerCase() === w); if (k && rec[k] !== '') return rec[k]; }
  return '';
};
// Rebuilds the session from rs_data_* and checks it against rs_data_sha256.
// Returns { events } or { problem } (no rs_data_* at all → { none: true }).
export async function sessionFromRecord(rec) {
  const parts = Number(get(rec, 'rs_data_parts'));
  if (!parts) return { none: true };
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) return { problem: 'unexpected rs_data_parts' };
  let text = '';
  for (let i = 1; i <= parts; i++) text += get(rec, `rs_data_${i}`);
  const chars = Number(get(rec, 'rs_data_chars'));
  if (Number.isFinite(chars) && chars !== text.length) return { problem: `${chars - text.length} characters missing (a field may be undeclared or cut off)` };
  const want = get(rec, 'rs_data_sha256').toLowerCase();
  if (!want || want !== await sha256Hex(text)) return { problem: 'checksum does not match' };
  try { return { ...unpackSession(text), truncated: /^yes$/i.test(get(rec, 'rs_data_truncated')) }; }
  catch (e) { return { problem: e.message }; }
}
export const recordField = get;
