import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostAllowed, answerFields, packSession, unpackSession, surveyFields, fieldNames, sessionFromRecord, PART_CHARS, MAX_PARTS } from '../src/qualtrics-embed.js';
import { eventsFromQualtrics, expandEmbedded, classifyExport } from '../src/qualtrics-import.js';
import { flattenEvents } from '../src/shared.js';
globalThis.location = { href: 'http://localhost:8000/' };
const study = JSON.parse(readFileSync(new URL('../studies/iola-current-vs-new.json', import.meta.url), 'utf8'));
const SID = '11111111-2222-4333-8444-555555555555';
const at = i => new Date(Date.UTC(2026, 10, 4, 15, 0, i)).toISOString();
// A synthetic session of the IOLA study: every task done, design iola-new.
function sessionEvents({ clicks = 30 } = {}) {
  const ev = []; let i = 0;
  const add = (kind, task_id, payload) => ev.push({ id: `e${i}`, study_id: study.id, session_id: SID, kind, task_id, payload, created_at: at(i++) });
  add('session_started', null, { study_version: '1.0.0', device: 'desktop', external_id: 'R_test1', assignments: { 'iola-current-vs-new': { variant_id: 'iola-new', source: 'link' } } });
  add('answers', null, { stage: 'pre', answers: { 'iola-use': 'No, never' } });
  for (const t of study.tasks) {
    add('task_started', t.id, { method: 'ab_test', order: 1, experiment_id: 'iola-current-vs-new', variant_id: 'iola-new', variant_revision: 'proto-v1', assignment: 'link' });
    // Research Studio sends interactions in batches of up to 20.
    for (let k0 = 0; k0 < clicks; k0 += 20) add('interaction_batch', t.id, { items: Array.from({ length: Math.min(20, clicks - k0) }, (_, k) => ({ type: 'click', at: at(i), page: '/home', target: `btn-${k0 + k}`, x_pct: 12.5, y_pct: 40.25, viewport_width: 400, viewport_height: 800, input: 'pointer' })) });
    add('task_ended', t.id, { method: 'ab_test', result: { success_signal_received: true, success_signal_status: 'received' }, time_seconds: 40, success_at_seconds: 21, finished_at_seconds: 33, experiment_id: 'iola-current-vs-new', variant_id: 'iola-new', variant_revision: 'proto-v1', self_report: 'completed', observed_success: true, tracker_connected: true, click_count: clicks });
    add('answers', t.id, { stage: 'post_task', answers: { [`${t.id}-ease`]: '6', [`${t.id}-issue`]: 'Synthetic, "quoted", with a comma' } });
  }
  add('answers', null, { stage: 'post', answers: { 'overall-ease': '6', confidence: '4', 'overall-comments': '' } });
  add('session_completed', null, {});
  return ev;
}
const abResults = Object.fromEntries(study.tasks.map(t => [t.id, { variant_id: 'iola-new', success_signal_status: 'received', self_report: 'completed', time_seconds: 40, click_count: 30, success_at_seconds: 21 }]));
const build = (events, status = 'complete') => surveyFields({ study, sessionId: SID, status, assignments: { 'iola-current-vs-new': { variant_id: 'iola-new', source: 'link' } }, abResults, externalId: 'R_test1', device: 'desktop', events });

test('only https addresses on the list (or their subdomains) can receive results', () => {
  assert.ok(hostAllowed('https://irsresearch.gov1.qualtrics.com', ['qualtrics.com']));
  assert.ok(hostAllowed('https://qualtrics.com', ['qualtrics.com']));
  assert.equal(hostAllowed('http://irsresearch.gov1.qualtrics.com', ['qualtrics.com']), false);
  assert.equal(hostAllowed('https://qualtrics.com.evil.example', ['qualtrics.com']), false);
  assert.equal(hostAllowed('https://evilqualtrics.com', ['qualtrics.com']), false);
  assert.equal(hostAllowed('null', ['qualtrics.com']), false);
});
test('every study question gets its own rs_q_ field', () => {
  const f = answerFields(study);
  assert.equal(f.length, study.preQuestions.length + study.tasks.length * 2 + study.postQuestions.length);
  assert.equal(new Set(f.map(x => x.field)).size, f.length);
  assert.ok(f.every(x => /^rs_q_[a-z0-9_]+$/.test(x.field)));
  assert.deepEqual(f.find(x => x.question_id === 'one-time-payment-ease'), { field: 'rs_q_one_time_payment_ease', question_id: 'one-time-payment-ease', stage: 'post_task', task_id: 'one-time-payment', text: f.find(x => x.question_id === 'one-time-payment-ease').text });
});
test('session data round-trips exactly', () => {
  const ev = sessionEvents();
  const back = unpackSession(packSession(study.id, SID, ev));
  assert.equal(back.events.length, ev.length);
  assert.deepEqual(back.events.map(e => [e.kind, e.task_id, e.created_at, e.payload]), ev.map(e => [e.kind, e.task_id, e.created_at, e.payload]));
});
test('survey fields: summary, answers, and data in parts under the Excel cell limit', async () => {
  const { fields, parts, chars } = await build(sessionEvents());
  assert.equal(fields.rs_session, SID); assert.equal(fields.rs_status, 'complete'); assert.equal(fields.rs_variant, 'iola-new');
  assert.equal(fields.rs_ab1_task, 'one-time-payment'); assert.equal(fields.rs_ab1_success, 'received'); assert.equal(fields.rs_ab1_tts, '21');
  assert.equal(fields.rs_q_one_time_payment_ease, '6'); assert.equal(fields.rs_q_iola_use, 'No, never'); assert.equal(fields.rs_q_overall_comments, '');
  assert.ok(parts >= 1 && parts <= MAX_PARTS);
  assert.ok(Object.values(fields).every(v => typeof v === 'string' && v.length <= 32767));
  assert.equal(Object.keys(fields).filter(k => /^rs_data_\d+$/.test(k)).length, MAX_PARTS, 'unused parts are sent blank so stale values are cleared');
  assert.equal(Number(fields.rs_data_chars), chars);
  assert.ok(Object.keys(fields).every(k => /^rs_[a-z0-9_]{1,60}$/.test(k)));
  assert.deepEqual(Object.keys(fields).filter(k => !fieldNames(study).includes(k)), [], 'every field sent is in the list to declare');
});
test('a very long session drops the oldest click batches first, never outcomes or answers', async () => {
  const ev = sessionEvents({ clicks: 2000 });
  const { fields, truncated, parts } = await build(ev);
  assert.ok(truncated); assert.ok(parts >= MAX_PARTS - 1 && parts <= MAX_PARTS, parts); assert.equal(fields.rs_data_truncated, 'yes');
  const r = await sessionFromRecord(fields);
  assert.equal(r.events.filter(e => e.kind === 'task_ended').length, study.tasks.length);
  assert.equal(r.events.filter(e => e.kind === 'answers').length, 2 + study.tasks.length);
});
test('reading the export back checks the parts against the checksum', async () => {
  const { fields } = await build(sessionEvents());
  assert.equal((await sessionFromRecord(fields)).events.length, sessionEvents().length);
  const js = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`__js_${k}`, v]));
  assert.equal((await sessionFromRecord(js)).events.length, sessionEvents().length, '__js_ names work too');
  const cut = { ...fields, rs_data_1: fields.rs_data_1.slice(0, -5) };
  assert.match((await sessionFromRecord(cut)).problem, /missing/);
  const changed = { ...fields, rs_data_1: fields.rs_data_1.replace('"6"', '"7"') };
  assert.match((await sessionFromRecord(changed)).problem, /checksum/);
  assert.deepEqual(await sessionFromRecord({ rs_session: 'x' }), { none: true });
});
// A Qualtrics CSV-like record: ResponseId, status columns plus the embedded data.
const qx = (fields, extra = {}) => ({ ResponseId: 'R_test1', Status: '0', Finished: '1', DistributionChannel: 'anonymous', ...fields, ...extra });
test('import uses the full session when it is intact, the summary when it is not', async () => {
  const { fields } = await build(sessionEvents());
  const good = qx(fields);
  const broken = qx({ ...fields, rs_session: 'S2', rs_pid: 'R_test2', rs_data_2: '', rs_data_chars: String(Number(fields.rs_data_chars) + 10) }, { ResponseId: 'R_test2' });
  const left = { ResponseId: 'R_test3', Status: '0', Finished: '0', DistributionChannel: 'anonymous', rs_variant: 'iola-current' };
  const recs = [good, broken, left];
  assert.equal(classifyExport(recs), 'survey2');
  await expandEmbedded(recs);
  const r = eventsFromQualtrics(study, recs);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.summary, { responses: 2, dropouts: 1, survey1Provided: true, fullSessions: 1 });
  assert.match(r.warnings.join(' '), /could not be read/);
  assert.match(r.warnings.join(' '), /left before the activity was saved/);
  const flat = flattenEvents(r.events);
  const full = flat.sessions.find(s => s.session_id === SID);
  assert.ok(full);
  assert.equal(flat.interactions.filter(x => x.session_id === SID).length, 30 * study.tasks.length, 'click records come across');
  assert.equal(flat.answers.filter(x => x.session_id === SID && x.question_id === 'one-time-payment-issue')[0].response, 'Synthetic, "quoted", with a comma');
  assert.equal(flat.tasks.filter(t => t.session_id === SID && t.success_at_seconds === 21).length, study.tasks.length);
  assert.equal(flat.tasks.filter(t => t.session_id === 'S2').length, study.tasks.length, 'summary fields still give outcomes');
  assert.equal(flat.starts.filter(t => t.session_id === 'qualtrics-R_test3').length, study.tasks.length, 'drop-out counted as assigned');
});
test('a finished-only export says drop-out is not counted', async () => {
  const { fields } = await build(sessionEvents());
  const recs = await expandEmbedded([qx(fields)]);
  const r = eventsFromQualtrics(study, recs);
  assert.match(r.warnings.join(' '), /finished responses only/);
  assert.equal(r.summary.survey1Provided, false);
});
test('data for another study is refused', async () => {
  const other = { ...study, id: 'some-other-study' };
  const { fields } = await surveyFields({ study: other, sessionId: SID, status: 'complete', assignments: {}, abResults: {}, events: sessionEvents().map(e => ({ ...e, study_id: other.id })) });
  const recs = await expandEmbedded([qx(fields)]);
  assert.match(eventsFromQualtrics(study, recs).problems.join(' '), /different study/);
});

// ---------- laptops and desktops only (v0.3.12) ----------
import { deviceKind, allowedOn } from '../src/devices.js';
import { starterSurvey } from '../src/qualtrics-qsf.js';
const env = ({ ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', touch = 0, coarseOnly = false, fine = true, w = 1440, h = 900, mobileHint } = {}) => ({
  navigator: { userAgent: ua, maxTouchPoints: touch, ...(mobileHint !== undefined ? { userAgentData: { mobile: mobileHint } } : {}) },
  matchMedia: q => ({ matches: q === '(hover: none) and (pointer: coarse)' ? coarseOnly : q === '(any-pointer: fine)' ? fine : false }),
  screen: { width: w, height: h }
});
test('device check: computers pass, phones and tablets do not, whatever the window size', () => {
  assert.equal(deviceKind(env()), 'desktop');
  assert.equal(deviceKind(env({ w: 800, h: 600 })), 'desktop', 'a small screen on a computer is still a computer');
  assert.equal(deviceKind(env({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', touch: 10, coarseOnly: false, fine: true })), 'desktop', 'Windows touchscreen laptop with a trackpad');
  assert.equal(deviceKind(env({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148', w: 390, h: 844, touch: 5, coarseOnly: true, fine: false })), 'phone');
  assert.equal(deviceKind(env({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36', w: 412, h: 915 })), 'phone');
  assert.equal(deviceKind(env({ ua: 'Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36', w: 1280, h: 800, mobileHint: true })), 'tablet');
  assert.equal(deviceKind(env({ touch: 5, w: 1180, h: 820 })), 'tablet', 'iPad reporting itself as a Mac');
  assert.equal(deviceKind(env({ coarseOnly: true, fine: false, w: 1280, h: 800 })), 'tablet', 'touch-only screen');
  assert.equal(allowedOn({ allowedDevices: 'desktop' }, 'tablet'), false);
  assert.equal(allowedOn({}, 'phone'), true, 'studies without the setting allow any device');
});
test('the survey script\'s device check uses the same rules as Research Studio', () => {
  const src = readFileSync(new URL('../docs/qualtrics-device-check.js', import.meta.url), 'utf8');
  assert.ok(src.includes('Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile'));
  assert.ok(src.includes("'(hover: none) and (pointer: coarse)'") && src.includes("'(any-pointer: fine)'") && src.includes('maxTouchPoints') && src.includes('< 600'));
});
test('starter survey: fields, device screening before the randomizer, randomizer, script, safety-net branch', () => {
  const template = readFileSync(new URL('../docs/qualtrics-embed.js', import.meta.url), 'utf8');
  const deviceCheck = readFileSync(new URL('../docs/qualtrics-device-check.js', import.meta.url), 'utf8');
  const qsf = starterSurvey(study, { studyPage: 'https://ash-webb.github.io/research-studio/study.html', template, deviceCheck });
  const el = k => qsf.SurveyElements.find(e => e.Element === k);
  const flow = el('FL').Payload.Flow;
  assert.deepEqual(flow[0].EmbeddedData.map(x => x.Field), fieldNames(study));
  assert.ok(fieldNames(study).includes('rs_device_class'));
  assert.deepEqual(flow.map(f => f.Type), ['EmbeddedData', 'Block', 'Branch', 'BlockRandomizer', 'Block', 'Branch', 'Block']);
  const pre = flow[2].BranchLogic[0];
  assert.deepEqual([pre[0].LeftOperand, pre[0].RightOperand, pre[1].RightOperand, pre[1].Conjuction], ['rs_device_class', 'phone', 'tablet', 'Or']);
  assert.deepEqual(flow[2].Flow.map(f => f.Type), ['Block', 'EndSurvey']);
  assert.deepEqual(flow[3].Flow.map(f => f.EmbeddedData[0].Value), ['iola-current', 'iola-new']);
  assert.equal(flow[3].EvenPresentation, true);
  assert.equal(flow[5].BranchLogic[0][0].RightOperand, 'device_not_supported');
  const blocks = el('BL').Payload.map(b => b.ID), used = [];
  const walk = f => f.forEach(x => { if (x.Type === 'Block') used.push(x.ID); if (x.Flow) walk(x.Flow); });
  walk(flow);
  assert.equal(new Set(used).size, used.length, 'each block appears once in the flow');
  assert.deepEqual(used.sort(), blocks.sort());
  const qs = qsf.SurveyElements.filter(e => e.Element === 'SQ');
  assert.match(qs.find(q => q.PrimaryAttribute === 'QID2').Payload.QuestionJS, /studyId: 'iola-current-vs-new'/);
  assert.match(qs.find(q => q.PrimaryAttribute === 'QID1').Payload.QuestionJS, /rs_device_class/);
  // Qualtrics rejects the import unless these match its ID patterns (seen live: ESDEF10 Data validation failure).
  const e = qsf.SurveyEntry;
  for (const v of [e.SurveyOwnerID, e.CreatorID]) assert.match(v, /^URH?_[a-zA-Z0-9]{11,15}$/);
  assert.match(e.SurveyActiveResponseSet, /^RS_[a-zA-Z0-9]{11,15}$/);
  assert.match(el('RS').PrimaryAttribute, /^RS_[a-zA-Z0-9]{11,15}$/);
  assert.ok(e.SurveyBrandID.length >= 1);
  assert.match(e.SurveyID, /^SV_[a-zA-Z0-9]{11,15}$/);
  const any = starterSurvey({ ...study, allowedDevices: undefined }, { studyPage: 'https://x.example/study.html', template, deviceCheck });
  assert.deepEqual(any.SurveyElements.find(e => e.Element === 'FL').Payload.Flow.map(f => f.Type), ['EmbeddedData', 'Block', 'BlockRandomizer', 'Block', 'Block']);
});
