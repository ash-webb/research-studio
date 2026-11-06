#!/usr/bin/env node
/* End-to-end browser QA for Civic Research Studio.
 *
 * Runs scripted (clearly synthetic) participants through every example study in
 * Chromium, then checks the stored events, the researcher dashboard and every export
 * against what the script actually did. These are software tests: the sessions they
 * create are not research data.
 *
 * Usage:  npm run test:e2e          (needs Node 18+, Python 3 and Playwright)
 *         E2E_PORT=8123 E2E_OUT=dir node tests/e2e/participant-flows.cjs
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const cs = require('./cardsort-helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 8123);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.E2E_OUT || path.join(__dirname, 'output');
const ONLY = (process.env.E2E_ONLY || '').split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
function check(group, name, pass, detail) { checks.push({ group, name, pass: !!pass, detail: pass ? undefined : detail }); }
function eq(group, name, actual, expected) {
  check(group, name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function near(group, name, actual, expected, tol) {
  check(group, name, Number.isFinite(actual) && Math.abs(actual - expected) <= tol, `expected ${expected}±${tol}, got ${actual}`);
}

// ---------- server ----------
async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + 'index.html'); if (r.ok) return proc; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error(`Static server did not start on port ${PORT}`);
}

// ---------- browser helpers ----------
async function newContext(browser, group, viewport = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, ...(viewport.width < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const errors = [];
  const watch = p => {
    p.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    p.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  };
  ctx.on('page', watch);
  return { ctx, errors, done: async () => { eq(group, 'no browser errors (console, page, HTTP)', errors, []); await ctx.close(); } };
}

// Waits for participant.js to re-render its main region after an action.
async function rerender(p, action) {
  await p.evaluate(() => { const m = document.querySelector('#participantMain'); m.firstElementChild?.setAttribute('data-e2e-old', '1'); });
  await action();
  await p.waitForFunction(() => !document.querySelector('#participantMain [data-e2e-old]'), null, { timeout: 8000 });
}

// Each session uses a new tab: reloading the same tab now resumes the earlier session.
async function startSession(ctx, studyId, page) {
  if (page) await page.close();
  const p = await ctx.newPage();
  await p.goto(`${BASE}study.html?study=${studyId}`);
  await p.waitForSelector('#consentCheck');
  const disabled = await p.isDisabled('#startStudy');
  await p.check('#consentCheck');
  await rerender(p, () => p.click('#startStudy'));
  return { p, startWasDisabled: disabled };
}

async function pickChoice(p, name, value) {
  await p.locator(`#questionForm label.choice:has(input[name="${name}"][value="${value}"])`).click();
}
async function fillForm(p, answers) {
  for (const [name, value] of Object.entries(answers)) {
    const kind = await p.locator(`#questionForm [name="${name}"]`).first().evaluate(el => el.type || el.tagName.toLowerCase());
    if (kind === 'radio') await pickChoice(p, name, value);
    else if (kind === 'checkbox') for (const v of value) await pickChoice(p, name, v);
    else await p.locator(`#questionForm [name="${name}"]`).fill(value);
  }
  await rerender(p, () => p.click('#questionForm button[type=submit]'));
}

async function prototypeTask(p, clicks, selfReport) {
  const connected = await p.waitForSelector('#bridgeIndicator.connected', { timeout: 8000 }).then(() => true, () => false);
  const frame = p.frameLocator('#prototypeFrame');
  for (const id of clicks) { await frame.locator(`[data-ut-id="${id}"]`).click(); await p.waitForTimeout(120); }
  await p.waitForTimeout(250);
  const src = await p.getAttribute('#prototypeFrame', 'src');
  const shownClicks = Number(await p.textContent('#taskClicks'));
  await rerender(p, () => p.click('#finishTask'));
  await p.locator(`.reflection-choice label:has(input[value="${selfReport}"])`).click();
  await rerender(p, () => p.click('#reflectionForm button[type=submit]'));
  return { src, connected, shownClicks };
}

const events = p => p.evaluate(() => JSON.parse(localStorage.getItem('utp-demo-events-v1') || '[]'));
const bySession = (evs, kind, taskId) => evs.filter(e => e.kind === kind && (taskId === undefined || e.task_id === taskId));

// ---------- dashboard helpers ----------
async function openResults(ctx, studyId, existingPage) {
  const p = existingPage || await ctx.newPage();
  if (!existingPage) {
    await p.goto(BASE + 'index.html');
    await p.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  }
  await p.click('.nav-option[data-tab="results"]');
  await p.selectOption('#resultsStudy', studyId);
  await p.click('#refreshResults');
  await p.waitForFunction(id => document.querySelector('#resultsStudy').value === id && /collected event records/.test(document.querySelector('#resultsStatus').textContent), studyId);
  await p.waitForTimeout(200);
  return p;
}
const tableRows = (p, sel) => p.$$eval(`${sel} tr`, trs => trs.map(tr => [...tr.cells].map(td => td.innerText.trim())));
async function metrics(p) {
  return p.$$eval('#metricCards .metric-card', cards => Object.fromEntries(cards.map(c => [c.querySelector('span').innerText.trim(), c.querySelector('strong').innerText.trim()])));
}
async function insightPills(p, sectionIndex = 0) {
  return p.$$eval('#methodInsights .method-analysis', (secs, i) => Object.fromEntries([...(secs[i]?.querySelectorAll('.method-summary span') || [])].map(s => { const [k, ...v] = s.innerText.split(':'); return [k.trim(), v.join(':').trim()]; })), sectionIndex);
}
async function exportFile(p, buttonId) {
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click('#' + buttonId)]);
  const text = fs.readFileSync(await d.path(), 'utf8');
  return { name: d.suggestedFilename(), text };
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
async function exportAll(p, studyId, group) {
  const out = {};
  for (const [key, id] of Object.entries({ tasks: 'exportTasks', answers: 'exportAnswers', interactions: 'exportClicks', methods: 'exportMethods', experiments: 'exportExperiments', methodEvents: 'exportMethodEvents', all: 'exportAll' })) {
    try {
      const f = await exportFile(p, id);
      out[key] = key === 'all' ? JSON.parse(f.text) : parseCSV(f.text);
      check(group, `export ${key}: filename starts with study id`, f.name.startsWith(studyId), f.name);
    } catch (err) { check(group, `export ${key} downloads`, false, err.message); out[key] = []; }
  }
  return out;
}

async function screenshot(p, name) { await p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); }
async function noHorizontalScroll(p, group, label) {
  const [sw, w] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check(group, `${label}: no sideways scrolling at ${w}px`, sw <= w + 1, `page is ${sw}px wide in a ${w}px window`);
}

// ---------- scenarios ----------
const scenarios = {};

scenarios.portal = async browser => {
  const G = 'Prototype usability (demo-portal)';
  const { ctx, done } = await newContext(browser, G);
  // Session 1: finds both targets.
  let { p, startWasDisabled } = await startSession(ctx, 'demo-portal');
  check(G, 'start button disabled until consent', startWasDisabled);
  await fillForm(p, { experience: 'Weekly' });
  const t1 = await prototypeTask(p, ['nav-activity', 'activity-open-detail'], 'completed');
  check(G, 'tracker bridge connects in the embedded prototype', t1.connected);
  eq(G, 'live click counter shows 2 clicks', t1.shownClicks, 2);
  await screenshot(p, 'portal-followup');
  await fillForm(p, { ease: '6', clarity: '4', comments: 'S1 found the activity' });
  await prototypeTask(p, ['nav-messages', 'message-open-detail'], 'completed');
  await fillForm(p, { ease: '7' });
  await fillForm(p, { overall: '5', 'final-feedback': 'S1 final feedback' });
  await p.waitForSelector('.done-card');
  check(G, 'completion page says data stayed in this browser', /saved only in this browser/.test(await p.textContent('#finalSaveNotice')));
  // Session 2: fails task 1, succeeds task 2.
  ({ p } = await startSession(ctx, 'demo-portal', p));
  await fillForm(p, { experience: 'Rarely or never' });
  await prototypeTask(p, ['nav-profile'], 'unable');
  await fillForm(p, { ease: '2', clarity: '1' });
  await prototypeTask(p, ['home-go-messages', 'message-open-detail'], 'completed');
  await fillForm(p, { ease: '5' });
  await fillForm(p, { overall: '3' });
  await p.waitForSelector('.done-card');

  const evs = await events(p);
  const sessions = [...new Set(evs.map(e => e.session_id))];
  eq(G, '2 sessions stored', sessions.length, 2);
  const ends = bySession(evs, 'task_ended', 'task-activity');
  const [s1, s2] = sessions.map(s => ends.find(e => e.session_id === s).payload);
  eq(G, 'S1 task 1: observed success', s1.observed_success, true);
  eq(G, 'S1 task 1: 2 clicks', s1.click_count, 2);
  eq(G, 'S1 task 1: self report completed', s1.self_report, 'completed');
  eq(G, 'S1 task 1: success signal status received', s1.result.success_signal_status, 'received');
  eq(G, 'S2 task 1: success signal not observed', s2.observed_success, false);
  eq(G, 'S2 task 1: 1 click', s2.click_count, 1);
  eq(G, 'S2 task 1: self report unable', s2.self_report, 'unable');
  const s1Targets = bySession(evs, 'interaction_batch', 'task-activity').filter(e => e.session_id === sessions[0]).flatMap(e => e.payload.items).filter(x => x.type === 'click').map(x => x.target);
  eq(G, 'S1 task 1 click targets recorded in order', s1Targets, ['nav-activity', 'activity-open-detail']);
  eq(G, 'every session has a completion event', bySession(evs, 'session_completed').length, 2);

  const r = await openResults(ctx, 'demo-portal');
  await screenshot(r, 'portal-results');
  const m = await metrics(r);
  eq(G, 'dashboard: 2 sessions', m['Sessions'], '2');
  eq(G, 'dashboard: 2 completions', m['Study completions'], '2');
  eq(G, 'dashboard: 4 finished activities', m['Finished activities'], '4');
  const rows = await tableRows(r, '#tasksTable');
  const row = title => rows.find(x => x[0].startsWith(title)) || [];
  const studyJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'studies/demo-portal.json'), 'utf8'));
  eq(G, 'dashboard: task 1 success 1 of 2', row(studyJson.tasks[0].title)[4], '1 of 2');
  eq(G, 'dashboard: task 2 success 2 of 2', row(studyJson.tasks[1].title)[4], '2 of 2');
  const pills = await insightPills(r, 0);
  eq(G, 'insights: observed signals 1/2', pills['Observed signals'], '1/2');
  eq(G, 'insights: self-reported completion 1', pills['Self-reported completion'], '1');
  const x = await exportAll(r, 'demo-portal', G);
  eq(G, 'tasks CSV: 4 rows', x.tasks.length, 4);
  eq(G, 'answers CSV: 16 rows (all questions, both sessions)', x.answers.length, 16);
  eq(G, 'answers CSV: pre-study answers present', x.answers.filter(a => a.stage === 'pre').map(a => a.response).sort(), ['Rarely or never', 'Weekly']);
  eq(G, 'interactions CSV: 7 clicks', x.interactions.filter(i => i.type === 'click').length, 7);
  eq(G, 'method outcomes CSV: 4 rows', x.methods.length, 4);
  eq(G, 'all-events JSON matches stored events', x.all.length, evs.length);
  await done();
};

scenarios.ab = async browser => {
  const G = 'A/B implementation test (demo-ab-implementation)';
  const { ctx, done } = await newContext(browser, G);
  const clicks = {
    'design-a': { ok1: ['a-nav-requests', 'a-request-open'], ok2: ['a-nav-messages', 'a-message-open'], fail: ['a-nav-profile'] },
    'design-b': { ok1: ['b-tile-requests', 'b-request-open'], ok2: ['b-tile-messages', 'b-message-open'], fail: ['b-tile-profile'] }
  };
  const runs = []; let p;
  for (let i = 0; i < 14; i++) {
    const arms = new Set(runs.map(r => r.arm));
    if (i >= 4 && arms.size === 2 && runs.filter(r => r.arm === 'design-a').length >= 2 && runs.filter(r => r.arm === 'design-b').length >= 2) break;
    ({ p } = await startSession(ctx, 'demo-ab-implementation', p));
    const src = await p.getAttribute('#prototypeFrame', 'src');
    const arm = /ab-design-a/.test(src) ? 'design-a' : 'design-b';
    const success = i % 2 === 0;
    const a = await prototypeTask(p, success ? clicks[arm].ok1 : clicks[arm].fail, success ? 'completed' : 'unable');
    if (i === 0) await screenshot(p, 'ab-followup');
    await fillForm(p, { 'request-ease': success ? '6' : '2' });
    const b = await prototypeTask(p, success ? clicks[arm].ok2 : clicks[arm].fail, success ? 'completed' : 'unable');
    await fillForm(p, { 'message-ease': '5' });
    await fillForm(p, { 'overall-clarity': '4' });
    await p.waitForSelector('.done-card');
    runs.push({ arm, success, srcSame: a.src === b.src, connected: a.connected && b.connected });
  }
  check(G, 'both designs were assigned', new Set(runs.map(r => r.arm)).size === 2, JSON.stringify(runs.map(r => r.arm)));
  check(G, 'each session saw the same design in both activities', runs.every(r => r.srcSame), JSON.stringify(runs));
  check(G, 'tracker connected in every task', runs.every(r => r.connected));
  const evs = await events(p);
  const sessions = [...new Set(evs.map(e => e.session_id))];
  eq(G, 'session count matches runs', sessions.length, runs.length);
  sessions.forEach((s, i) => {
    const st = bySession(evs, 'task_started').filter(e => e.session_id === s).map(e => e.payload.variant_id);
    eq(G, `S${i + 1}: stored variant matches the design shown`, st, [runs[i].arm, runs[i].arm]);
    const en = bySession(evs, 'task_ended').filter(e => e.session_id === s).map(e => e.payload.result.success_signal_status);
    eq(G, `S${i + 1}: success signal status`, en, runs[i].success ? ['received', 'received'] : ['not_observed', 'not_observed']);
  });
  const r = await openResults(ctx, 'demo-ab-implementation');
  await screenshot(r, 'ab-results');
  const outcome = await r.$$eval('#methodInsights .method-analysis', secs => { const t = secs[0].querySelector('table.ab-table'); return t ? [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerText.trim().replace(/\s*\n\s*/g, ' '))) : []; });
  const abStudy = JSON.parse(fs.readFileSync(path.join(ROOT, 'studies/demo-ab-implementation.json'), 'utf8'));
  for (const arm of ['design-a', 'design-b']) {
    const n = runs.filter(r => r.arm === arm).length, ok = runs.filter(r => r.arm === arm && r.success).length;
    const label = abStudy.tasks[0].variants.find(v => v.id === arm).label.toLowerCase();
    const rowA = outcome.find(row => row[0].toLowerCase().includes(label)) || [];
    eq(G, `results ${arm}: started`, rowA[1], String(n));
    eq(G, `results ${arm}: finished`, rowA[2], String(n));
    check(G, `results ${arm}: success signal ${ok}/${n} with a range`, new RegExp(`${ok}/${n} · \\d+%–\\d+%`).test(rowA[4] || ''), rowA[4]);
    check(G, `results ${arm}: self-reported ${ok}/${n}`, (rowA[5] || '').includes(`${ok}/${n}`), rowA[5]);
  }
  const x = await exportAll(r, 'demo-ab-implementation', G);
  eq(G, 'A/B exposures CSV: one row per session per activity', x.experiments.length, runs.length * 2);
  eq(G, 'A/B exposures CSV: all submitted', x.experiments.every(e => e.status === 'submitted'), true);
  eq(G, 'answers CSV carries variant on every task answer', x.answers.filter(a => a.task_id).every(a => a.variant_id === 'design-a' || a.variant_id === 'design-b'), true);
  const tasksCsv = x.tasks.map(t => ({ v: t.variant_id, ok: t.observed_success }));
  eq(G, 'tasks CSV: observed_success true only for successful sessions', tasksCsv.filter(t => t.ok === 'true').length, runs.filter(r => r.success).length * 2);
  await done();
};

scenarios.abLink = async browser => {
  const G = 'A/B design assigned by the study link (Qualtrics randomizer hand-off)';
  const { ctx, done } = await newContext(browser, G);
  const ret = encodeURIComponent('https://irsresearch.gov1.qualtrics.com/jfe/form/SV_test123?src=rs');
  const open = async query => {
    const p = await ctx.newPage();
    await p.goto(`${BASE}study.html?study=demo-ab-implementation&${query}`);
    await p.waitForSelector('#consentCheck'); await p.check('#consentCheck');
    await rerender(p, () => p.click('#startStudy'));
    return p;
  };
  // Valid link assignment + participant ID + allow-listed return address.
  const p = await open(`variant=design-b&pid=R_3abcDEF123&return=${ret}`);
  const src1 = await p.getAttribute('#prototypeFrame', 'src');
  check(G, 'link variant=design-b shows design B', /ab-design-b/.test(src1), src1);
  const t1 = await prototypeTask(p, ['b-tile-requests', 'b-request-open'], 'completed');
  await fillForm(p, { 'request-ease': '6' });
  const t2 = await prototypeTask(p, ['b-nav-profile'], 'unable');
  check(G, 'second activity keeps design B', /ab-design-b/.test(t2.src), t2.src);
  await fillForm(p, { 'message-ease': '3' });
  await fillForm(p, { 'overall-clarity': '4' });
  await p.waitForSelector('.done-card');
  check(G, '"Return to the survey" shown for an allow-listed Qualtrics address', await p.isVisible('#returnToSurvey'));
  const href = new URL(await p.getAttribute('#returnToSurvey', 'href'));
  const q = Object.fromEntries(href.searchParams);
  eq(G, 'return link keeps the survey address and its own parameters', [href.hostname, href.pathname, q.src], ['irsresearch.gov1.qualtrics.com', '/jfe/form/SV_test123', 'rs']);
  eq(G, 'return link: status and design', [q.rs_status, q.rs_variant], ['complete', 'design-b']);
  eq(G, 'return link: task 1 results', [q.rs_ab1_task, q.rs_ab1_variant, q.rs_ab1_success, q.rs_ab1_self, q.rs_ab1_clicks], ['find-service-request', 'design-b', 'received', 'completed', '2']);
  eq(G, 'return link: task 2 results', [q.rs_ab2_task, q.rs_ab2_success, q.rs_ab2_self, q.rs_ab2_clicks], ['find-message', 'not_observed', 'unable', '1']);
  check(G, 'return link: times are whole seconds', /^\d+$/.test(q.rs_ab1_time) && /^\d+$/.test(q.rs_ab2_time));
  eq(G, 'return link carries the participant ID back (to join Survey 1 and Survey 2)', q.rs_pid, 'R_3abcDEF123');
  const evs = await events(p);
  const start = bySession(evs, 'session_started')[0].payload;
  eq(G, 'participant ID recorded at session start', start.external_id, 'R_3abcDEF123');
  eq(G, 'assignments recorded at session start', start.assignments, { 'portal-navigation-2026': { variant_id: 'design-b', source: 'link' } });
  eq(G, 'each A/B task notes the link assigned it', bySession(evs, 'task_started').map(e => e.payload.assignment), ['link', 'link']);
  check(G, 'return link matches session ID in the data', q.rs_session === bySession(evs, 'session_started')[0].session_id);
  // Reload after finishing keeps the return link.
  await p.reload(); await p.waitForSelector('.done-card');
  check(G, 'reload after finishing still offers "Return to the survey"', await p.isVisible('#returnToSurvey'));
  // Unknown variant → built-in random, flagged.
  const p2 = await open('variant=design-z');
  const ev2 = (await events(p2)).filter(e => e.kind === 'task_started').at(-1).payload;
  eq(G, 'unknown link variant falls back to built-in random and says so', ev2.assignment, 'stable-hash-equal (link value not recognised)');
  // Return address in another Qualtrics account is ignored (settings list only the IRS account); bad participant IDs are dropped.
  const p3 = await open(`variant=design-a&pid=${encodeURIComponent('<script>')}&return=${encodeURIComponent('https://example.qualtrics.com/jfe/form/SV_other')}`);
  check(G, 'experiment-specific parameter form also works', /ab-design-a/.test(await p3.getAttribute('#prototypeFrame', 'src')));
  for (let i = 0; i < 2; i++) { await prototypeTask(p3, ['a-nav-profile'], 'unable'); await fillForm(p3, i === 0 ? { 'request-ease': '2' } : { 'message-ease': '2' }); }
  await fillForm(p3, { 'overall-clarity': '2' });
  await p3.waitForSelector('.done-card');
  check(G, 'return address in another Qualtrics account is ignored (no button)', !(await p3.$('#returnToSurvey')));
  const s3 = (await events(p3)).filter(e => e.kind === 'session_started').at(-1).payload;
  check(G, 'unsafe participant ID is not stored', !('external_id' in s3), JSON.stringify(s3));
  const p4 = await open('variant.portal-navigation-2026=design-a&variant=design-b');
  check(G, 'experiment-specific parameter wins over the general one', /ab-design-a/.test(await p4.getAttribute('#prototypeFrame', 'src')));
  // Consent already collected in Qualtrics: no second consent checkbox.
  const ext = JSON.parse(fs.readFileSync(path.join(ROOT, 'studies/demo-ab-implementation.json'), 'utf8'));
  const pe = await ctx.newPage(); await pe.goto(BASE + 'index.html');
  await pe.evaluate(s => localStorage.setItem('utp-preview-study', JSON.stringify({ ...s, consentMode: 'external' })), ext);
  await pe.goto(`${BASE}study.html?preview=1&variant=design-a`); await pe.waitForSelector('#startStudy');
  check(G, 'external consent: no consent checkbox, Begin button enabled', !(await pe.$('#consentCheck')) && !(await pe.isDisabled('#startStudy')));
  await rerender(pe, () => pe.click('#startStudy'));
  eq(G, 'external consent recorded as "external"', (await events(pe)).filter(e => e.kind === 'session_started').at(-1).payload.consent, 'external');
  // Dashboard and exports.
  const r = await openResults(ctx, 'demo-ab-implementation');
  await screenshot(r, 'ab-link-results');
  const pills = await insightPills(r, 0);
  check(G, 'dashboard says how designs were assigned', /from study link/.test(pills['Assigned by'] || '') && /link value not recognised/.test(pills['Assigned by'] || ''), JSON.stringify(pills));
  check(G, 'dashboard warns about unrecognised link values', /randomizer/.test(await r.textContent('#methodInsights')));
  const x = await exportAll(r, 'demo-ab-implementation', G);
  const row = x.experiments.find(e => e.external_id === 'R_3abcDEF123');
  eq(G, 'A/B exposures CSV carries participant ID and assignment source', [row?.assignment, row?.variant_id], ['link', 'design-b']);
  check(G, 'Task CSV carries participant ID', x.tasks.some(t => t.external_id === 'R_3abcDEF123'));
  await done();
};

scenarios.abQualtricsImport = async browser => {
  const G = 'A/B results from imported Qualtrics exports (synthetic fixtures)';
  const { ctx, done } = await newContext(browser, G);
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await p.click('.nav-option[data-tab="results"]');
  await p.selectOption('#resultsStudy', 'demo-ab-implementation'); await p.waitForTimeout(300);
  const fx = f => path.join(ROOT, 'tests/fixtures', f);
  // Survey 1 alone is rejected with a clear message.
  await p.setInputFiles('#qualtricsFiles', [fx('qualtrics-survey1-SYNTHETIC.csv')]);
  await p.waitForFunction(() => /Import failed/.test(document.querySelector('#toast').textContent));
  check(G, 'Survey 1 alone: explained that Survey 2 is needed', /No Survey 2 export/.test(await p.textContent('#toast')));
  await p.setInputFiles('#qualtricsFiles', [fx('qualtrics-survey1-SYNTHETIC.csv'), fx('qualtrics-survey2-SYNTHETIC.csv')]);
  await p.waitForFunction(() => /imported Qualtrics/.test(document.querySelector('#resultsStatus').textContent));
  check(G, 'status names the source, counts and that nothing was uploaded', /59 Survey 2 responses, plus 11 assigned in Survey 1 who did not return\. Read in this browser only; nothing was uploaded/.test(await p.textContent('#resultsStatus')), await p.textContent('#resultsStatus'));
  const lead = (await p.textContent('#methodInsights .ab-lead')).replace(/\s+/g, ' ');
  check(G, 'lead counts everyone assigned, with counts', /counting everyone assigned.*46% \(16 of 35\).*63% \(22 of 35\)/.test(lead), lead);
  check(G, 'lead gives the difference with its 95% range', /B vs A: \+17 points \(95% range −6 to \+38 points\)\. The range includes zero/.test(lead), lead);
  check(G, 'measured-finisher rates shown as secondary', /Among people who finished with success measured: A 55% \(16\/29\) · B 85% \(22\/26\)/.test(lead), lead);
  check(G, 'provisional banner with detectable difference', /Provisional\. With 35 people in the smallest group, only differences of about \d+ points/.test(lead), lead);
  check(G, 'lead never names a winner', !/winner|better design|best design/i.test(lead));
  eq(G, 'two charts drawn (rates, differences)', await p.locator('#methodInsights .method-analysis').first().locator('svg.ab-chart').count(), 2);
  const checks = await p.$$eval('#methodInsights .method-analysis:first-of-type .ab-checks li', l => l.map(x => x.textContent));
  check(G, 'data checks include group sizes, drop-out, tracking and devices', ['Group sizes', 'Drop-out', 'Tracking', 'Devices'].every(t => checks.some(c => c.includes(t))), JSON.stringify(checks));
  check(G, 'warns that the two ways of counting disagree', checks.some(c => /Ways of counting disagree/.test(c)), JSON.stringify(checks));
  check(G, 'drop-outs counted from Survey 1', checks.some(c => /A 14%, B 17%/.test(c)));
  check(G, 'imported data: follow-up and click sections replaced by an explanation', /follow-up answers stay in your Qualtrics export/.test(await p.textContent('#methodInsights')) && !(await p.textContent('#methodInsights')).includes('No clicks captured'));
  const out = () => p.textContent('[data-plan-out]');
  check(G, 'planner gives people per design', /About \d+ people assigned per design/.test(await out()), await out());
  const box = p.locator('[data-planner]').first();
  await box.locator('[data-plan="difference"]').fill('30');
  check(G, 'planner updates as you type (bigger difference → fewer people)', /About [1-4]\d people assigned per design/.test(await out()), await out());
  await screenshot(p, 'ab-imported-results');
  const x = await exportAll(p, 'demo-ab-implementation', G);
  eq(G, 'A/B exposures CSV from imported data: 70 people × 2 activities', x.experiments.length, 140);
  await p.click('#clearImport');
  await p.waitForFunction(() => !/imported Qualtrics/.test(document.querySelector('#resultsStatus').textContent));
  check(G, '"Show browser data instead" returns to browser data', /Local demo records/.test(await p.textContent('#resultsStatus')));
  await done();
};

scenarios.abBuilder = async browser => {
  const G = 'A/B builder: design rows and the "Check designs" pre-launch check';
  const { ctx, done } = await newContext(browser, G);
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  const row = i => `[data-task-index="0"] [data-variant-index="${i}"]`;
  check(G, 'designs shown as rows (no text-line editor)', await p.locator(row(0)).count() === 1 && !(await p.$('[data-task-lines="abVariants"]')));
  check(G, 'cannot remove below two designs', await p.isDisabled(`${row(0)} [data-remove-variant]`));
  await p.fill(`${row(1)} [data-variant-field="id"]`, 'Design B!');
  check(G, 'invalid design ID explained inline', /lowercase letters/.test(await p.textContent(`${row(1)} .variant-error`)));
  await p.click('#previewStudy'); await p.waitForTimeout(200);
  check(G, 'preview blocked with a message naming the problem', /Design B: Design ID/.test(await p.textContent('#toast')), await p.textContent('#toast'));
  await p.fill(`${row(1)} [data-variant-field="id"]`, 'design-a');
  check(G, 'duplicate design IDs flagged', /same ID/.test(await p.textContent(`${row(1)} .variant-error`)));
  await p.fill(`${row(1)} [data-variant-field="id"]`, 'design-b');
  check(G, 'error clears when fixed', await p.isHidden(`${row(1)} .variant-error`));
  await p.click('[data-task-index="0"] [data-add-variant]');
  eq(G, '"+ Add design" adds design C and focuses its name', [await p.locator('[data-task-index="0"] [data-variant-index]').count(), await p.evaluate(() => document.activeElement.dataset.variantField)], [3, 'label']);
  await p.click('[data-task-index="0"] [data-check-designs]');
  check(G, 'check refuses to start while design C has no link', /Fix design C/.test(await p.textContent('#toast')));
  await p.fill(`${row(2)} [data-variant-field="prototypeUrl"]`, 'demo/assets/design-a.svg');
  await p.click('[data-task-index="0"] [data-check-designs]');
  await p.waitForSelector('dialog.design-check[open]');
  await p.waitForFunction(() => /Tracking connected/.test(document.querySelector('.design-check-item.active')?.textContent || ''), null, { timeout: 8000 });
  const f = p.frameLocator('dialog.design-check iframe');
  await f.locator('[data-ut-id="a-nav-requests"]').click(); await f.locator('[data-ut-id="a-request-open"]').click();
  await p.waitForFunction(() => /received/.test(document.querySelector('.design-check-item.active')?.textContent || ''), null, { timeout: 5000 });
  check(G, 'design A: tracking connected and success signal received', /1 of 3 designs ready/.test(await p.textContent('.design-check-summary')));
  await p.click('[data-design="2"]');
  await p.waitForFunction(() => /not detected/.test(document.querySelector('.design-check-item.active')?.textContent || ''), null, { timeout: 12000 });
  check(G, 'design without the tracking script is flagged after 8 seconds', /Tracking script not detected/.test(await p.textContent('.design-check-item.active')));
  await screenshot(p, 'ab-check-dialog');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.querySelector('dialog.design-check'), null, { timeout: 3000 }).catch(() => {});
  check(G, 'Escape closes the check and returns focus to its button', !(await p.$('dialog.design-check')) && await p.evaluate(() => document.activeElement.dataset.checkDesigns === 'true'));
  await p.click(`[data-task-index="0"] [data-variant-index="2"] [data-remove-variant]`);
  eq(G, 'a third design can be removed again', await p.locator('[data-task-index="0"] [data-variant-index]').count(), 2);
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#exportStudy')]);
  const exported = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
  check(G, 'exported study has clean designs (no editor-only fields)', exported.tasks[0].variants.length === 2 && !('_variantErrors' in exported.tasks[0]) && !('_editorErrors' in exported.tasks[0]));
  await done();
};

scenarios.studyPlan = async browser => {
  const G = 'Study plan: roles, hypotheses, sample size, lock + change log, Word download';
  const { ctx, done } = await newContext(browser, G);
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await p.selectOption('#exampleStudy', 'demo-ab-implementation'); await p.click('#loadExample'); await p.waitForTimeout(300);
  check(G, 'plan step shown first in the builder', /01 \/ PLAN/.test(await p.textContent('.builder-main .panel:first-child')));
  await p.fill('[data-plan-field="background"]', 'People cannot find request status.');
  await p.fill('[data-plan-rq="0"]', 'Can people find a service request?');
  await p.click('[data-plan-action="add-rq"]');
  check(G, '"+ Add research question" adds a row and focuses it', await p.evaluate(() => document.activeElement.dataset.planRq === '1'));
  await p.fill('[data-plan-treatment="design-b"]', 'Dashboard shortcut tiles');
  await p.selectOption('[data-plan-exp][data-field="controlId"]', 'design-b'); await p.waitForTimeout(150);
  eq(G, 'choosing a control moves it to design A in every activity', await p.$$eval('[data-variant-index="0"] [data-variant-field="id"]', els => els.map(e => e.value)), ['design-b', 'design-b']);
  check(G, 'hypothesis sentence follows the roles', /Compared with Design A \(Dashboard shortcuts\), the control, Design B \(Sidebar navigation\)/.test(await p.textContent('.plan-sentence')));
  await p.selectOption('[data-plan-exp][data-field="controlId"]', 'design-a'); await p.waitForTimeout(150);
  await p.selectOption('[data-plan-hyp="0"][data-field="direction"]', 'lower');
  check(G, 'sentence updates as the hypothesis changes', /lower task success rate/.test(await p.textContent('.plan-sentence')));
  await p.fill('[data-plan-exp][data-field="baseline"]', '60');
  check(G, 'sample size updates as you type', /from 60% to 75%/.test(await p.textContent('[data-plan-size]')), await p.textContent('[data-plan-size]'));
  check(G, 'standard analysis plan reflects the plan', /Target sample: \d+ people assigned per design/.test(await p.textContent('[data-plan-standard]')));
  await p.click('[data-plan-action="copy-analysis"]');
  check(G, '"Edit a copy" puts the standard text in an editable box', /Newcombe/.test(await p.inputValue('[data-plan-field="analysis"]')));
  await screenshot(p, 'study-plan-draft');
  await p.click('[data-plan-action="lock"]');
  check(G, 'locking shows the lock date and removes the Lock button', /Plan locked/.test(await p.textContent('.plan-status')) && !(await p.$('[data-plan-action="lock"]')));
  await p.fill('[data-plan-field="background"]', 'Changed after locking'); await p.locator('[data-plan-field="background"]').blur();
  await p.fill('[data-task-index="0"] [data-task-field="instructions"]', 'New instructions'); await p.locator('[data-task-index="0"] [data-task-field="instructions"]').blur();
  await p.click('[data-task-index="0"] [data-add-variant]');
  await p.waitForTimeout(100);
  const log = await p.$$eval('.plan-changes tbody tr', rows => rows.map(r => r.cells[1].textContent));
  eq(G, 'changes after locking are logged with where they happened', log, ['Study plan › Background', 'Study activities › Activity 1 › Participant-facing instructions', 'Study activities › Activity 1 › Add design']);
  check(G, 'log keeps before and after values', await p.$eval('.plan-changes tbody tr', r => r.cells[2].textContent === 'People cannot find request status.' && r.cells[3].textContent === 'Changed after locking'));
  await p.click('[data-task-index="0"] [data-variant-index="2"] [data-remove-variant]');
  await p.fill('[data-plan-reason="0"]', 'Clarified wording');
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-plan-action="docx"]')]);
  const docPath = await d.path(); const bytes = fs.readFileSync(docPath);
  eq(G, 'plan downloads as a .docx file', [d.suggestedFilename(), bytes.slice(0, 2).toString()], ['demo-ab-implementation-study-plan.docx', 'PK']);
  try {
    const text = require('child_process').execFileSync('python3', ['-c', 'import sys,docx;d=docx.Document(sys.argv[1]);print("\\n".join(p.text for p in d.paragraphs));print("TABLES",len(d.tables))', docPath]).toString();
    check(G, 'Word document has the plan sections, hypothesis and change log', ['1. Background', 'Changed after locking', '4. A/B experiments', 'H1.', 'lower task success rate', '7. Analysis plan', '9. Change log'].every(t => text.includes(t)), text.slice(0, 400));
  } catch (err) { if (!/No module named/.test(String(err.stderr))) throw err; }
  const [wc] = await Promise.all([p.waitForEvent('download'), p.click('#saveWorkingCopy')]);
  const working = JSON.parse(fs.readFileSync(await wc.path(), 'utf8'));
  const [pub] = await Promise.all([p.waitForEvent('download'), p.click('#exportStudy')]);
  const published = JSON.parse(fs.readFileSync(await pub.path(), 'utf8'));
  check(G, 'working copy keeps the plan; published study file leaves it out', !!working.plan?.locked && working.plan.changes.length === 4 && working.plan.changes[0].reason === 'Clarified wording' && !('plan' in published));
  // Round trip: import the working copy in a fresh page.
  const p2 = await ctx.newPage(); await p2.goto(BASE + 'index.html');
  await p2.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await p2.setInputFiles('#fileStudy', await wc.path()); await p2.waitForTimeout(300);
  check(G, 'importing the working copy restores the locked plan and log', /Plan locked/.test(await p2.textContent('.plan-status')) && await p2.locator('.plan-changes tbody tr').count() === 4);
  await p2.click('.nav-option[data-tab="results"]'); await p2.selectOption('#resultsStudy', 'demo-ab-implementation'); await p2.waitForTimeout(400);
  check(G, 'A/B results show the plan and its hypothesis', /Study plan · locked/.test(await p2.textContent('#methodInsights .ab-plan')) && /H1\./.test(await p2.textContent('#methodInsights .ab-plan')));
  // Phone width: the plan step must not scroll the page sideways.
  await p.setViewportSize({ width: 360, height: 800 }); await p.waitForTimeout(150);
  check(G, 'no sideways page scroll at 360px', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await done();
};

scenarios.activityPlans = async browser => {
  const G = 'Activity planners: card sort, tree, first click, preference, survey';
  const { ctx, done } = await newContext(browser, G);
  const p = await ctx.newPage();
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await p.selectOption('#exampleStudy', 'demo-mixed'); await p.click('#loadExample');
  await p.waitForFunction(() => document.querySelector('#studyId').value === 'demo-mixed');
  eq(G, 'one planner per activity', await p.$$eval('[data-plan-act-block]', e => e.map(x => x.dataset.planActBlock)), ['organize-content', 'find-transcript', 'first-click-records', 'choose-layout', 'survey-questions']);
  await p.fill('[data-plan-rq="0"]', 'Do people understand our record categories?'); await p.locator('[data-plan-rq="0"]').blur(); await p.waitForTimeout(100);
  await p.check('[data-plan-act="find-transcript"][data-plan-act-rq="0"]');
  await p.fill('[data-plan-act="find-transcript"][data-field="objective"]', 'Can people find a transcript?');
  await p.fill('[data-plan-act="find-transcript"][data-field="benchmark"]', '70');
  check(G, 'tree test: sample size follows the benchmark and precision', /About 81 people.*near 70%/.test(await p.textContent('[data-plan-act-size="find-transcript"]')), await p.textContent('[data-plan-act-size="find-transcript"]'));
  check(G, 'tree test: standard analysis states the benchmark', /benchmark of 70%/.test(await p.textContent('[data-plan-act-analysis="find-transcript"]')));
  await p.selectOption('[data-plan-act="organize-content"][data-field="goal"]', 'explore');
  await p.fill('[data-plan-act="organize-content"][data-field="target"]', '25');
  check(G, 'card sort (explore): participant target with guidance', /About 25 people.*15–30/.test(await p.textContent('[data-plan-act-size="organize-content"]')));
  await p.fill('[data-plan-act="choose-layout"][data-field="split"]', '65');
  check(G, 'preference: split-based sample size', /to tell a 65\/35 split from 50\/50/.test(await p.textContent('[data-plan-act-size="choose-layout"]')));
  check(G, 'study summary recruits for the largest need', /Recruit for the largest need: about \d+ people/.test(await p.textContent('[data-plan-summary]')));
  await screenshot(p, 'activity-plans');
  await p.click('[data-plan-action="lock"]');
  await p.fill('[data-plan-act="find-transcript"][data-field="benchmark"]', '75'); await p.locator('[data-plan-act="find-transcript"][data-field="benchmark"]').blur(); await p.waitForTimeout(100);
  check(G, 'locked: planner edits are logged with the activity name', await p.$eval('.plan-changes tbody tr', r => /Study plan › 2\. Find a transcript › Benchmark success rate/.test(r.cells[1].textContent) && r.cells[2].textContent === '70' && r.cells[3].textContent === '75'));
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('[data-plan-action="docx"]')]);
  try {
    const text = require('child_process').execFileSync('python3', ['-c', 'import sys,docx;d=docx.Document(sys.argv[1]);print("\\n".join(p.text for p in d.paragraphs));print("\\n".join(c.text for t in d.tables for r in t.rows for c in r.cells))', await d.path()]).toString();
    check(G, 'Word plan includes activity plans, links to RQs and sample size', ['Activity plans', 'Can people find a transcript?', 'RQ1', '75% task success', 'Sample size', 'Recruit for the largest need'].every(t => text.includes(t)), text.slice(0, 300));
  } catch (err) { if (!/No module named/.test(String(err.stderr))) throw err; }
  const [wc] = await Promise.all([p.waitForEvent('download'), p.click('#saveWorkingCopy')]);
  const working = JSON.parse(fs.readFileSync(await wc.path(), 'utf8'));
  check(G, 'working copy keeps activity plans', working.plan.activities['find-transcript'].benchmark === 75 && working.plan.activities['find-transcript'].rqs[0] === 0);
  await p.setViewportSize({ width: 360, height: 800 }); await p.waitForTimeout(150);
  check(G, 'no sideways page scroll at 360px', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await done();
};

scenarios.cardSort = async browser => {
  const G = 'Open card sort (demo-card-sort)';
  const { ctx, done } = await newContext(browser, G);
  let { p } = await startSession(ctx, 'demo-card-sort');
  check(G, 'finish disabled before any card is sorted', await p.isDisabled('#submitSort'));
  check(G, 'no group needs naming before sorting starts (no name form up front)', !(await p.$('#newGroupName')) && await p.isVisible('[data-drop-category="__new__"]'));
  // Drag first, name later.
  await cs.dragCard(p, 'payments', '__new__');
  check(G, 'dropping on "New group" creates an unnamed group holding the card', await p.locator('[data-drop-category="created-1"] [data-card="payments"]').count() === 1 && (await p.inputValue('[data-group-name="created-1"]')) === '');
  await cs.dragCard(p, 'payment-history', 'created-1');
  await cs.dragCard(p, 'tax-documents', '__new__');
  await cs.dragCard(p, 'support', '__new__');
  await cs.dragCard(p, 'notices', 'created-2');
  await cs.dragCard(p, 'profile', 'created-3');
  // A card dragged out of a one-card group empties it: the empty group disappears.
  await cs.dragCard(p, 'payment-plan', '__new__');
  await cs.dragCard(p, 'payment-plan', 'created-1');
  check(G, 'an emptied group is removed automatically', await p.locator('[data-drop-category="created-4"]').count() === 0);
  // Drag a card back to "Cards to sort", then use the Move-to list for the last one.
  await cs.dragCard(p, 'notices', '');
  check(G, 'a card can be dragged back to "Cards to sort"', await p.locator('.sort-unsorted [data-card="notices"]').count() === 1);
  await cs.moveViaMenu(p, 'notices', 'created-2');
  check(G, 'finish blocked while cards remain', await p.isDisabled('#submitSort') && /1 card still to sort/.test(await p.textContent('#sortBlocker')));
  await cs.dragCard(p, 'refund', 'created-1');
  check(G, 'all sorted but unnamed groups still block finishing, with a reason', await p.isDisabled('#submitSort') && /name 3 groups/.test(await p.textContent('#sortBlocker')), await p.textContent('#sortBlocker'));
  await cs.nameGroup(p, 'created-1', 'Money');
  await cs.nameGroup(p, 'created-2', 'Records');
  await cs.nameGroup(p, 'created-3', 'money');
  check(G, 'duplicate group name (different case) is flagged and blocks finishing', await p.isVisible('.group-name-error') && await p.isDisabled('#submitSort'));
  await cs.nameGroup(p, 'created-3', 'Account');
  check(G, 'all named and sorted: finish enabled', !(await p.isDisabled('#submitSort')));
  await screenshot(p, 'card-sort-complete');
  await rerender(p, () => p.click('#submitSort'));
  await fillForm(p, { 'grouping-notes': 'S1 notes' });
  await p.waitForSelector('.done-card');
  const plan = { payments: 'created-1', 'payment-history': 'created-1', 'payment-plan': 'created-1', refund: 'created-1', 'tax-documents': 'created-2', notices: 'created-2', support: 'created-3', profile: 'created-3' };
  ({ p } = await startSession(ctx, 'demo-card-sort', p));
  await cs.dragCard(p, 'payments', '__new__');
  await cs.dragCard(p, 'refund', 'created-1');
  await rerender(p, () => p.click('#skipSort'));
  await fillForm(p, { 'grouping-notes': '' });
  await p.waitForSelector('.done-card');

  const evs = await events(p);
  const [e1, e2] = bySession(evs, 'task_ended').map(e => e.payload.result);
  const sortKeys = o => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));
  eq(G, 'S1 groups stored exactly', sortKeys(e1.groups), sortKeys(plan));
  eq(G, 'S1 completed', e1.completed, true);
  eq(G, 'S1 category labels', e1.categories.map(c => c.label), ['Money', 'Records', 'Account']);
  eq(G, 'S2 marked could-not-finish', [e2.completed, e2.participant_could_not_finish], [false, true]);
  eq(G, 'S2 partial placements kept', Object.values(e2.groups).filter(Boolean).length, 2);
  const r = await openResults(ctx, 'demo-card-sort');
  await screenshot(r, 'card-sort-results');
  const pills = await insightPills(r, 0);
  eq(G, 'insights: 1 completed sort', pills['Completed sorts'], '1');
  eq(G, 'insights: 1 incomplete', pills['Incomplete submissions'], '1');
  const grid = await tableRows(r, '#methodInsights .similarity-grid');
  const head = grid[0], payRow = grid.find(x => x[0] === 'Make a payment') || [];
  eq(G, 'similarity: payment + payment history = 100%', payRow[head.indexOf('payment-history')], '100%');
  eq(G, 'similarity: payment + tax documents = 0%', payRow[head.indexOf('tax-documents')], '0%');
  const rows = await tableRows(r, '#tasksTable');
  eq(G, 'dashboard: "1 fully sorted"', rows[0]?.[6], '1 fully sorted');
  const x = await exportAll(r, 'demo-card-sort', G);
  const actions = x.methodEvents.reduce((m, e) => (m[e.action] = (m[e.action] || 0) + 1, m), {});
  eq(G, 'method events: creations, removal, renames and moves recorded', [actions.category_created, actions.category_removed, actions.category_renamed, actions.card_assignment], [4 + 1, 1, 4, 11 + 2]);
  await done();
};

scenarios.touchCardSort = async browser => {
  const G = 'Card sort with touch on a phone (390px, press-and-hold drag)';
  const { ctx, done } = await newContext(browser, G, { width: 390, height: 700 });
  const { p } = await startSession(ctx, 'demo-card-sort');
  check(G, 'touch hint shown on a touch screen', /press and hold/.test(await p.textContent('#sortHelp')));
  const y0 = await p.evaluate(() => scrollY);
  await cs.touchSwipe(p, 'tax-documents', -260);
  check(G, 'a quick swipe that starts on a card scrolls the page', (await p.evaluate(() => scrollY)) > y0 + 100);
  eq(G, '…and does not move the card', await p.locator('.sort-unsorted [data-card]').count(), 8);
  await p.evaluate(() => scrollTo(0, 0));
  await cs.touchDrag(p, 'payments', '__new__');
  check(G, 'press-and-hold then drag reaches "New group" below the fold (auto-scroll)', await p.locator('[data-drop-category="created-1"] [data-card="payments"]').count() === 1);
  await p.evaluate(() => scrollTo(0, 0));
  await cs.touchDrag(p, 'refund', 'created-1');
  eq(G, 'second touch drag into the same group', await p.locator('[data-drop-category="created-1"] [data-card]').count(), 2);
  await cs.nameGroup(p, 'created-1', 'Money');
  await screenshot(p, 'touch-card-sort');
  await noHorizontalScroll(p, G, 'card sort while sorting');
  const evs = await events(p);
  check(G, 'touch moves are labelled via "touch" in the data', evs.filter(e => e.payload?.action === 'card_assignment').every(e => e.payload.detail.via === 'touch'));
  await done();
};

scenarios.tree = async browser => {
  const G = 'Tree test (demo-tree-test)';
  const { ctx, done } = await newContext(browser, G);
  let { p } = await startSession(ctx, 'demo-tree-test');
  check(G, 'no "select" button at the top level', !(await p.$('#selectDestination')));
  await rerender(p, () => p.click('[data-tree-node="records"]'));
  await rerender(p, () => p.click('[data-tree-node="tax-transcripts"]'));
  await screenshot(p, 'tree-leaf');
  await rerender(p, () => p.click('#selectDestination'));
  await fillForm(p, { confidence: '5' });
  ({ p } = await startSession(ctx, 'demo-tree-test', p));
  await rerender(p, () => p.click('[data-tree-node="payments"]'));
  await rerender(p, () => p.click('[data-tree-root]'));
  await rerender(p, () => p.click('[data-tree-node="records"]'));
  await rerender(p, () => p.click('[data-tree-node="tax-documents"]'));
  await rerender(p, () => p.click('#selectDestination'));
  await fillForm(p, { confidence: '3' });
  ({ p } = await startSession(ctx, 'demo-tree-test', p));
  await rerender(p, () => p.click('#cannotFind'));
  await fillForm(p, { confidence: '1' });
  await p.waitForSelector('.done-card');
  const evs = await events(p);
  const [a, b, c] = bySession(evs, 'task_ended').map(e => e.payload);
  eq(G, 'S1: success, direct, correct first branch, 0 backtracks', [a.result.success, a.result.direct, a.result.first_branch_correct, a.result.backtracks], [true, true, true, 0]);
  eq(G, 'S1: observed success', a.observed_success, true);
  eq(G, 'S2: wrong destination, 1 backtrack, first click payments', [b.result.success, b.result.backtracks, b.result.first_selection, b.result.first_branch_correct], [false, 1, 'payments', false]);
  eq(G, 'S2: selected path', b.result.selected_path, ['records', 'tax-documents']);
  eq(G, 'S3: could not find, nothing selected', [c.result.success, c.result.participant_could_not_find, c.result.selected_node], [false, true, null]);
  const r = await openResults(ctx, 'demo-tree-test');
  await screenshot(r, 'tree-results');
  const pills = await insightPills(r, 0);
  eq(G, 'insights: success 1/3', pills['Success'], '1/3 (33%)');
  eq(G, 'insights: 1 direct path', pills['Direct paths'], '1');
  eq(G, 'insights: 1 could not find', pills['Could not find'], '1');
  const rows = await tableRows(r, '#tasksTable');
  eq(G, 'dashboard: success 1 of 3', rows[0]?.[4], '1 of 3');
  const paths = await tableRows(r, '#methodInsights .data-table');
  check(G, 'insights: path table shows labels', paths.some(x => x[1] === 'Records › Tax transcripts'), JSON.stringify(paths));
  await exportAll(r, 'demo-tree-test', G);
  await done();
};

scenarios.firstClick = async browser => {
  const G = 'First-click test (demo-first-click)';
  const { ctx, done } = await newContext(browser, G);
  const clickAt = async (p, fx, fy) => {
    const img = p.locator('#firstClickImage');
    await p.waitForFunction(() => document.querySelector('#firstClickImage')?.complete);
    const box = await img.boundingBox();
    await rerender(p, () => img.click({ position: { x: box.width * fx, y: box.height * fy } }));
  };
  let { p } = await startSession(ctx, 'demo-first-click');
  check(G, 'no continue button before clicking', !(await p.$('#submitFirstClick')));
  await clickAt(p, 0.10, 0.40);
  check(G, '"not sure" option withdrawn once the first click is made', !(await p.$('#cannotChoose')));
  await screenshot(p, 'first-click-marked');
  await rerender(p, () => p.click('#submitFirstClick'));
  await fillForm(p, { reason: 'S1 reason' });
  ({ p } = await startSession(ctx, 'demo-first-click', p));
  await clickAt(p, 0.60, 0.60);
  await rerender(p, () => p.click('#submitFirstClick'));
  await fillForm(p, { reason: '' });
  ({ p } = await startSession(ctx, 'demo-first-click', p));
  await rerender(p, () => p.click('#cannotChoose'));
  await fillForm(p, { reason: 'S3 not sure' });
  await p.waitForSelector('.done-card');
  const evs = await events(p);
  const [a, b, c] = bySession(evs, 'task_ended').map(e => e.payload);
  eq(G, 'S1 hit target', a.result.hit_target, true);
  near(G, 'S1 click x ≈ 10%', a.result.click?.x_pct, 10, 1);
  near(G, 'S1 click y ≈ 40%', a.result.click?.y_pct, 40, 1);
  eq(G, 'S2 missed target', b.result.hit_target, false);
  eq(G, 'S3 no click, unsure flagged', [c.result.click, c.result.participant_could_not_choose], [null, true]);
  eq(G, 'S3 "not sure" on a scored test recorded as not hitting a target', c.observed_success, false);
  const r = await openResults(ctx, 'demo-first-click');
  await screenshot(r, 'first-click-results');
  const pills = await insightPills(r, 0);
  eq(G, 'insights: 2 of 3 recorded clicks', pills['Recorded first clicks'], '2/3');
  eq(G, 'insights: 1 "not sure"', pills['Not sure (no click)'], '1');
  const rows = await tableRows(r, '#tasksTable');
  const insightRate = pills['Target hit rate'];
  eq(G, 'insights: target hit rate (not sure counts as an attempt)', insightRate, '1/3 (33%)');
  check(G, 'dashboard and insights agree on first-click success', !!rows[0]?.[4] && insightRate.startsWith(rows[0][4].replace(' of ', '/')), `dashboard table says "${rows[0]?.[4]}", insights say "${insightRate}"`);
  eq(G, 'insights: 2 dots plotted', await r.locator('#methodInsights .click-dot').count(), 2);
  await exportAll(r, 'demo-first-click', G);
  await done();
};

scenarios.firstClickZoom = async browser => {
  const G = 'First-click zoom on a phone (360px touch)';
  const { ctx, done } = await newContext(browser, G, { width: 360, height: 740 });
  const { p } = await startSession(ctx, 'demo-first-click');
  await p.waitForFunction(() => document.querySelector('#firstClickImage')?.complete);
  check(G, 'opens at "Fit" with zoom controls', (await p.textContent('#zoomLevel')) === 'Fit' && await p.isDisabled('[data-zoom="out"]'));
  check(G, 'keyboard instructions are not shown visually on a touch screen', (await p.locator('.keyboard-hint').boundingBox())?.width <= 1);
  const fitW = (await p.locator('#firstClickImage').boundingBox()).width;
  await p.tap('[data-zoom="in"]'); await p.tap('[data-zoom="in"]');
  const zW = (await p.locator('#firstClickImage').boundingBox()).width;
  check(G, 'zooming to 200% doubles the screenshot width', Math.abs(zW / fitW - 2) < 0.05, `${fitW} → ${zW}`);
  eq(G, 'zoom level shown', await p.textContent('#zoomLevel'), '200%');
  const cdp = await ctx.newCDPSession(p);
  const fr = await p.locator('.click-image-frame').boundingBox();
  const sx = fr.x + fr.width * 0.6, sy = fr.y + fr.height * 0.5;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx - i * 14, y: sy - i * 6 }] }); await p.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(400);
  check(G, 'dragging around the zoomed screenshot does not record a click', !(await p.$('#submitFirstClick')));
  await p.evaluate(() => { const f = document.querySelector('.click-image-frame'), img = document.querySelector('#firstClickImage'); f.scrollLeft = 0; f.scrollTop = img.offsetHeight * 0.40 - f.clientHeight / 2; });
  await p.waitForTimeout(150);
  const ib = await p.locator('#firstClickImage').boundingBox();
  await rerender(p, async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ib.x + ib.width * 0.11, y: ib.y + ib.height * 0.40 }] });
    await p.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
  await screenshot(p, 'first-click-zoomed-tap');
  await rerender(p, () => p.tap('#submitFirstClick'));
  const evs = await events(p);
  const r = bySession(evs, 'task_ended')[0]?.payload.result;
  near(G, 'tap at 200% recorded at the right image position (x ≈ 11%)', r?.click?.x_pct, 11, 1);
  near(G, '…(y ≈ 40%)', r?.click?.y_pct, 40, 1);
  eq(G, 'tap on the target while zoomed scores a hit', r?.hit_target, true);
  eq(G, 'zoom level recorded with the click', r?.click?.zoom, 2);
  eq(G, 'zoom changes recorded as method events', evs.filter(e => e.payload?.action === 'first_click_zoom').map(e => e.payload.detail.zoom), [1.5, 2]);
  await cdp.detach();
  await done();
};

scenarios.preference = async browser => {
  const G = 'Preference test (demo-preference)';
  const { ctx, done } = await newContext(browser, G);
  let { p } = await startSession(ctx, 'demo-preference');
  check(G, 'continue disabled before choosing', await p.isDisabled('#submitPreference'));
  const order1 = await p.$$eval('.preference-option input', els => els.map(e => e.value));
  await p.locator('.preference-option:has(input[value="list"])').click();
  await screenshot(p, 'preference-chosen');
  await rerender(p, () => p.click('#submitPreference'));
  await fillForm(p, { why: 'S1 why' });
  ({ p } = await startSession(ctx, 'demo-preference', p));
  await p.locator('.no-preference label').click();
  await rerender(p, () => p.click('#submitPreference'));
  await fillForm(p, { why: '' });
  await p.waitForSelector('.done-card');
  const evs = await events(p);
  const [a, b] = bySession(evs, 'task_ended').map(e => e.payload.result);
  eq(G, 'S1 chose list', [a.selected_id, a.no_preference], ['list', false]);
  eq(G, 'S1 display order stored as shown', a.display_order, order1);
  eq(G, 'S2 no preference', [b.selected_id, b.no_preference], [null, true]);
  const r = await openResults(ctx, 'demo-preference');
  await screenshot(r, 'preference-results');
  const bars = await r.$$eval('#methodInsights .analysis-bar', els => els.map(e => [e.querySelector('label').innerText.trim(), e.querySelector('small').innerText.trim()]));
  const study = JSON.parse(fs.readFileSync(path.join(ROOT, 'studies/demo-preference.json'), 'utf8'));
  const listLabel = study.tasks[0].variants.find(v => v.id === 'list').label;
  eq(G, 'insights: list chosen once', bars.find(x => x[0] === listLabel)?.[1], '1');
  eq(G, 'insights: no preference once', bars.find(x => x[0] === 'No preference')?.[1], '1');
  await exportAll(r, 'demo-preference', G);
  await done();
};

scenarios.survey = async browser => {
  const G = 'Survey (demo-survey)';
  const { ctx, done } = await newContext(browser, G);
  let { p } = await startSession(ctx, 'demo-survey');
  await p.click('#questionForm button[type=submit]');
  await p.waitForTimeout(200);
  eq(G, 'empty submit is blocked (no answers stored)', bySession(await events(p), 'answers').length, 0);
  await pickChoice(p, 'frequency', 'Weekly');
  await p.click('#questionForm button[type=submit]');
  await p.waitForTimeout(200);
  check(G, 'missing multi-select answer shows an error', /Please answer/.test(await p.textContent('#formError')) && await p.isVisible('#formError'));
  await screenshot(p, 'survey-error');
  await pickChoice(p, 'priority', 'Make a payment');
  await pickChoice(p, 'priority', 'Read notices');
  await p.fill('#questionForm [name="feedback"]', 'S1: clearer labels');
  await rerender(p, () => p.click('#questionForm button[type=submit]'));
  await p.waitForSelector('.done-card');
  ({ p } = await startSession(ctx, 'demo-survey', p));
  await fillForm(p, { frequency: 'Daily', priority: ['Find records'] });
  await p.waitForSelector('.done-card');
  const evs = await events(p);
  const answers = bySession(evs, 'answers').map(e => e.payload.answers);
  eq(G, 'S1 answers stored', answers[0], { frequency: 'Weekly', priority: ['Make a payment', 'Read notices'], feedback: 'S1: clearer labels' });
  eq(G, 'S2 answers stored', answers[1], { frequency: 'Daily', priority: ['Find records'], feedback: '' });
  const r = await openResults(ctx, 'demo-survey');
  await screenshot(r, 'survey-results');
  const bars = await r.$$eval('#methodInsights .analysis-bar', els => els.map(e => [e.querySelector('label').innerText.trim(), e.querySelector('small').innerText.trim()]));
  const get = l => bars.filter(x => x[0] === l).map(x => x[1]);
  eq(G, 'insights: Weekly 1, Daily 1', [get('Weekly')[0], get('Daily')[0]], ['1', '1']);
  eq(G, 'insights: "Make a payment" 1, "Find records" 1', [get('Make a payment')[0], get('Find records')[0]], ['1', '1']);
  check(G, 'insights: open-text answer shown', (await r.textContent('#methodInsights')).includes('S1: clearer labels'));
  const rows = await tableRows(r, '#tasksTable');
  eq(G, 'dashboard: "2 answered"', rows[0]?.[6], '2 answered');
  const x = await exportAll(r, 'demo-survey', G);
  eq(G, 'answers CSV: 6 rows', x.answers.length, 6);
  eq(G, 'answers CSV: multi-select kept as list', x.answers.find(a => a.question_id === 'priority')?.response, '["Make a payment","Read notices"]');
  await done();
};

async function mixedRun(p, G, mobile) {
  const shot = async n => { await screenshot(p, `${mobile ? 'mobile' : 'mixed'}-${n}`); if (mobile) await noHorizontalScroll(p, G, n); };
  await shot('0-consent-done');
  const all = await p.$$eval('[data-card]', s => s.map(x => x.dataset.card));
  if (mobile) await cs.touchDrag(p, all[0], '__new__'); else await cs.dragCard(p, all[0], '__new__');
  for (const card of all.slice(1)) await cs.moveViaMenu(p, card, 'created-1');
  await cs.nameGroup(p, 'created-1', 'Everything');
  await shot('1-card-sort');
  await rerender(p, () => p.click('#submitSort'));
  await fillForm(p, { 'grouping-notes': '' });
  await rerender(p, () => p.click('[data-tree-node="records"]'));
  await shot('2-tree');
  await rerender(p, () => p.click('[data-tree-node="tax-transcripts"]'));
  await rerender(p, () => p.click('#selectDestination'));
  await fillForm(p, { confidence: '4' });
  await p.waitForFunction(() => document.querySelector('#firstClickImage')?.complete);
  const box = await p.locator('#firstClickImage').boundingBox();
  await shot('3-first-click');
  await rerender(p, () => p.locator('#firstClickImage').click({ position: { x: box.width * 0.1, y: box.height * 0.4 } }));
  await rerender(p, () => p.click('#submitFirstClick'));
  await fillForm(p, { reason: '' });
  await shot('4-preference');
  await p.locator('.preference-option:has(input[value="tiles"])').click();
  await rerender(p, () => p.click('#submitPreference'));
  await fillForm(p, { why: '' });
  await shot('5-survey');
  await fillForm(p, { frequency: 'Monthly', priority: ['Update information'] });
  await p.waitForSelector('.done-card');
  await shot('6-done');
}

scenarios.mixed = async browser => {
  const G = 'Multi-method study (demo-mixed)';
  const { ctx, done } = await newContext(browser, G);
  const { p } = await startSession(ctx, 'demo-mixed');
  await mixedRun(p, G, false);
  const evs = await events(p);
  eq(G, '5 activities ended in study order', bySession(evs, 'task_ended').map(e => e.task_id), ['organize-content', 'find-transcript', 'first-click-records', 'choose-layout', 'survey-questions']);
  eq(G, 'session completed', bySession(evs, 'session_completed').length, 1);
  const r = await openResults(ctx, 'demo-mixed');
  await screenshot(r, 'mixed-results');
  eq(G, 'dashboard: 5 activity rows', (await tableRows(r, '#tasksTable')).length, 5);
  eq(G, 'insights: 5 method sections', await r.locator('#methodInsights .method-analysis').count(), 5);
  await exportAll(r, 'demo-mixed', G);
  await done();
};

scenarios.mobile = async browser => {
  const G = 'Phone-size screen (390px, demo-mixed + demo-portal)';
  const { ctx, done } = await newContext(browser, G, { width: 390, height: 844 });
  const { p } = await startSession(ctx, 'demo-mixed');
  await mixedRun(p, G, true);
  const { p: p2 } = await startSession(ctx, 'demo-portal', p);
  await fillForm(p2, { experience: 'Daily' });
  await p2.waitForSelector('#bridgeIndicator.connected', { timeout: 8000 }).catch(() => {});
  await screenshot(p2, 'mobile-7-prototype');
  await noHorizontalScroll(p2, G, 'prototype task');
  const r = await openResults(ctx, 'demo-mixed');
  await screenshot(r, 'mobile-8-results');
  await noHorizontalScroll(r, G, 'results dashboard');
  await done();
};

scenarios.preview = async browser => {
  const G = 'Builder → Preview locally (demo-survey)';
  const { ctx, done } = await newContext(browser, G);
  const b = await ctx.newPage();
  await b.goto(BASE + 'index.html');
  await b.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await b.selectOption('#exampleStudy', 'demo-survey');
  await b.click('#loadExample');
  await b.waitForFunction(() => document.querySelector('#studyId').value === 'demo-survey');
  const [p] = await Promise.all([ctx.waitForEvent('page'), b.click('#previewStudy')]);
  await p.waitForSelector('#consentCheck');
  check(G, 'preview opens the loaded study', (await p.textContent('h1')).length > 0 && /preview=1/.test(p.url()));
  await p.check('#consentCheck');
  await rerender(p, () => p.click('#startStudy'));
  await fillForm(p, { frequency: 'Daily', priority: ['Find records'] });
  await p.waitForSelector('.done-card');
  const evs = await events(p);
  const start = bySession(evs, 'session_started')[0];
  check(G, 'preview session is labelled as a preview in stored data', start?.payload?.preview === true, `session_started payload: ${JSON.stringify(start?.payload)}`);
  check(G, 'participant header says the preview is not counted', /Preview/.test(await p.textContent('#saveStatus')));
  const r = await openResults(ctx, 'demo-survey');
  const m = await metrics(r);
  check(G, 'researcher preview runs are not counted as participant sessions', m['Sessions'] === '0', `dashboard Sessions card shows ${m['Sessions']} after only a researcher preview`);
  check(G, 'status line says a preview run is hidden', /1 preview run hidden/.test(await r.textContent('#resultsStatus')), await r.textContent('#resultsStatus'));
  const hidden = await exportFile(r, 'exportAll');
  eq(G, 'Full JSON export excludes hidden preview runs', JSON.parse(hidden.text).length, 0);
  await r.check('#includePreviews');
  await r.waitForFunction(() => /included/.test(document.querySelector('#resultsStatus').textContent));
  eq(G, 'with "include previews" ticked the run appears', (await metrics(r))['Sessions'], '1');
  check(G, 'included preview session is labelled in the session list', /Preview/.test(await r.textContent('#sessionsList')));
  await done();
};

// Configurations not covered by the bundled examples: closed and hybrid card sorts,
// an unscored first-click test, and a prototype page without the tracker installed.
scenarios.customCoverage = async browser => {
  const G = 'Extra configurations via Import JSON → Preview (closed/hybrid sort, unscored click, untracked prototype)';
  const { ctx, done } = await newContext(browser, G);
  const cards = [{ id: 'pay-bill', label: 'Pay a bill' }, { id: 'view-notice', label: 'View a notice' }, { id: 'set-plan', label: 'Set up a payment plan' }];
  const study = {
    schemaVersion: 3, id: 'qa-extra-configs', version: '0.0.1', title: 'QA extra configurations (synthetic)', description: 'Synthetic software test.',
    welcome: 'Synthetic software test run.', consent: 'I agree (software test).', preQuestions: [], postQuestions: [],
    tasks: [
      { id: 'closed-sort', method: 'card_sort', sortMode: 'closed', title: 'Closed sort', instructions: 'Sort each card.', cards, categories: [{ id: 'money', label: 'Money' }, { id: 'mail', label: 'Mail' }] },
      { id: 'hybrid-sort', method: 'card_sort', sortMode: 'hybrid', title: 'Hybrid sort', instructions: 'Sort each card; add groups if needed.', cards, categories: [{ id: 'money', label: 'Money' }] },
      { id: 'unscored-click', method: 'first_click', title: 'Unscored first click', instructions: 'Click anywhere.', imageUrl: 'demo/assets/first-click.svg' },
      { id: 'untracked-proto', method: 'prototype', title: 'Untracked prototype', instructions: 'Look, then finish.', prototypeUrl: 'demo/assets/design-a.svg', successSignal: 'never-fires' }
    ]
  };
  const file = path.join(OUT, 'qa-extra-configs.json');
  fs.writeFileSync(file, JSON.stringify(study, null, 2));
  const b = await ctx.newPage();
  await b.goto(BASE + 'index.html');
  await b.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await b.setInputFiles('#fileStudy', file);
  await b.waitForFunction(() => document.querySelector('#studyId').value === 'qa-extra-configs');
  check(G, 'Import JSON loads the study into the builder', true);
  const [p] = await Promise.all([ctx.waitForEvent('page'), b.click('#previewStudy')]);
  await p.waitForSelector('#consentCheck');
  await p.check('#consentCheck');
  await rerender(p, () => p.click('#startStudy'));
  // Closed sort: no way to add groups.
  check(G, 'closed sort offers no "New group" area', !(await p.$('[data-drop-category="__new__"]')));
  await cs.dragCard(p, 'pay-bill', 'money'); await cs.dragCard(p, 'view-notice', 'mail'); await cs.moveViaMenu(p, 'set-plan', 'money');
  await rerender(p, () => p.click('#submitSort'));
  // Hybrid sort: predefined group plus a participant-created one.
  check(G, 'hybrid sort shows the predefined group', await p.locator('[data-drop-category="money"]').count() === 1);
  await cs.dragCard(p, 'pay-bill', 'money'); await cs.dragCard(p, 'view-notice', '__new__'); await cs.dragCard(p, 'set-plan', 'money');
  check(G, 'hybrid: predefined group names are fixed (not editable)', !(await p.$('[data-group-name="money"]')));
  await cs.nameGroup(p, 'created-1', 'Letters');
  await screenshot(p, 'hybrid-sort');
  await rerender(p, () => p.click('#submitSort'));
  // Unscored first click.
  await p.waitForFunction(() => document.querySelector('#firstClickImage')?.complete);
  const box = await p.locator('#firstClickImage').boundingBox();
  await rerender(p, () => p.locator('#firstClickImage').click({ position: { x: box.width * 0.5, y: box.height * 0.5 } }));
  await rerender(p, () => p.click('#submitFirstClick'));
  // Prototype page without the tracker script.
  await p.waitForTimeout(1500);
  eq(G, 'untracked prototype: indicator still waiting for tracker', (await p.textContent('#bridgeIndicator')).trim(), 'Waiting for tracker');
  await rerender(p, () => p.click('#finishTask'));
  await p.locator('.reflection-choice label:has(input[value="completed"])').click();
  await rerender(p, () => p.click('#reflectionForm button[type=submit]'));
  await p.waitForSelector('.done-card');
  const evs = await events(p);
  const end = id => bySession(evs, 'task_ended', id)[0]?.payload || {};
  eq(G, 'closed sort: categories are the predefined ones', end('closed-sort').result?.categories?.map(c => c.id), ['money', 'mail']);
  eq(G, 'hybrid sort: predefined + created categories', end('hybrid-sort').result?.categories?.map(c => c.label), ['Money', 'Letters']);
  eq(G, 'unscored click: hit_target null, scored false', [end('unscored-click').result?.hit_target, end('unscored-click').result?.scored], [null, false]);
  check(G, 'unscored click: no observed_success recorded', !('observed_success' in end('unscored-click')), JSON.stringify(end('unscored-click')));
  eq(G, 'untracked prototype: tracker_connected false', end('untracked-proto').tracker_connected, false);
  eq(G, 'untracked prototype: signal status "unavailable"', end('untracked-proto').result?.success_signal_status, 'unavailable');
  check(G, 'untracked prototype: missing evidence is not recorded as failure', !('observed_success' in end('untracked-proto')), `observed_success = ${JSON.stringify(end('untracked-proto').observed_success)}`);
  // An imported draft lives only in the builder tab it was imported into, so results are read there.
  const r = await openResults(ctx, 'qa-extra-configs', b);
  await r.check('#includePreviews');
  await r.waitForFunction(() => /included/.test(document.querySelector('#resultsStatus').textContent));
  await screenshot(r, 'extra-configs-results');
  const rows = await tableRows(r, '#tasksTable');
  const row = t => rows.find(x => x[0] === t) || [];
  eq(G, 'dashboard: closed sort "1 fully sorted"', row('Closed sort')[6], '1 fully sorted');
  eq(G, 'dashboard: unscored click shows "Not scored"', row('Unscored first click')[4], 'Not scored');
  eq(G, 'dashboard: untracked prototype shows "Not scored"', row('Untracked prototype')[4], 'Not scored');
  const pills = await insightPills(r, 2);
  eq(G, 'insights: unscored first click says "Unscored"', pills['Target hit rate'], 'Unscored');
  const x = await exportAll(r, 'qa-extra-configs', G);
  eq(G, 'Task CSV: observed_success blank (unknown) for all four activities', x.tasks.map(t => t.observed_success), ['', '', '', '']);
  await done();
};

// ---------- run ----------
(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  const started = Date.now();
  try {
    for (const [name, fn] of Object.entries(scenarios)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      try { await fn(browser); }
      catch (err) { check(name, 'scenario ran to completion', false, err.stack.split('\n').slice(0, 4).join(' | ')); }
    }
  } finally { await browser.close(); server.kill(); }
  const failed = checks.filter(c => !c.pass);
  fs.writeFileSync(path.join(OUT, 'e2e-report.json'), JSON.stringify({ ran_at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), total: checks.length, failed: failed.length, checks }, null, 2));
  let group = '';
  for (const c of checks) {
    if (c.group !== group) { group = c.group; console.log(`\n${group}`); }
    console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : `\n      → ${c.detail}`}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(failed.length ? 1 : 0);
})();
