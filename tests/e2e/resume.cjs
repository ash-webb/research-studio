#!/usr/bin/env node
/* Resume-after-refresh checks for Civic Research Studio (v0.3.3).
 * Reloads the participant page at every kind of point in every study type and checks that
 * the same session continues, in-progress work is restored, nothing is recorded twice,
 * interruptions are recorded, and the safeguards (changed study, expiry, duplicate tab) hold.
 * Usage: npm run test:resume   (needs Playwright)
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const cs = require('./cardsort-helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 8127);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.E2E_OUT || path.join(__dirname, 'output');
const ONLY = (process.env.E2E_ONLY || '').split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (g, name, pass, detail) => checks.push({ group: g, name, pass: !!pass, detail: pass ? undefined : detail });
const eq = (g, name, a, e) => check(g, name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + 'index.html')).ok) return proc; } catch {} await new Promise(r => setTimeout(r, 100)); }
  proc.kill(); throw new Error('server did not start');
}
async function rerender(p, action) {
  await p.evaluate(() => document.querySelector('#participantMain')?.firstElementChild?.setAttribute('data-e2e-old', '1'));
  await action();
  await p.waitForFunction(() => !document.querySelector('#participantMain [data-e2e-old]'), null, { timeout: 8000 });
}
async function open(ctx, studyId) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}study.html?study=${studyId}`);
  await p.waitForSelector('#consentCheck');
  await p.check('#consentCheck');
  await rerender(p, () => p.click('#startStudy'));
  return p;
}
async function reload(p) {
  await p.reload();
  await p.waitForFunction(() => !/Loading study/.test(document.querySelector('#participantMain').textContent));
  await p.waitForTimeout(350); // resume waits briefly for a duplicate-tab answer
}
const events = p => p.evaluate(() => JSON.parse(localStorage.getItem('utp-demo-events-v1') || '[]'));
const kinds = (evs, kind, task) => evs.filter(e => e.kind === kind && (task === undefined || e.task_id === task));
async function pick(p, name, value) { await p.locator(`#questionForm label.choice:has(input[name="${name}"][value="${value}"])`).click(); }
async function submitForm(p) { await rerender(p, () => p.click('#questionForm button[type=submit]')); }
async function protoClick(p, ids) {
  await p.waitForSelector('#bridgeIndicator.connected', { timeout: 8000 });
  for (const id of ids) { await p.frameLocator('#prototypeFrame').locator(`[data-ut-id="${id}"]`).click(); await p.waitForTimeout(150); }
  await p.waitForTimeout(200);
}
const heading = p => p.textContent('#participantMain h1');

const scenarios = {};

scenarios.prototype = async ctx => {
  const g = 'Prototype study with reloads at every stage (demo-portal)';
  const p = await open(ctx, 'demo-portal');
  // Reload on the pre-study form with an answer chosen but not submitted.
  await pick(p, 'experience', 'Weekly');
  await reload(p);
  check(g, 'pre-study form: chosen answer restored after reload', await p.isChecked('#questionForm input[name="experience"][value="Weekly"]'));
  check(g, 'welcome-back message shown', /restored/.test(await p.textContent('#participantAlert')));
  await submitForm(p);
  // Reload mid-task after one click.
  await protoClick(p, ['nav-activity']);
  await reload(p);
  check(g, 'mid-task reload returns to the same task', /Locate account activity|activity/i.test(await heading(p)), await heading(p));
  check(g, 'mid-task reload explains the design restarted', await p.isVisible('#resumeNotice'));
  eq(g, 'click counter keeps clicks from before the reload', await p.textContent('#taskClicks'), '1');
  // Reach the success screen, then reload before finishing.
  await protoClick(p, ['nav-activity', 'activity-open-detail']);
  await reload(p);
  await p.waitForSelector('#bridgeIndicator.connected', { timeout: 8000 });
  await rerender(p, () => p.click('#finishTask'));
  // Reload on "How did that task go?".
  await reload(p);
  check(g, 'reload on the self-report screen returns to it', /How did that task go/.test(await heading(p)), await heading(p));
  await p.locator('.reflection-choice label:has(input[value="completed"])').click();
  await rerender(p, () => p.click('#reflectionForm button[type=submit]'));
  // Reload on the follow-up with typed text.
  await pick(p, 'ease', '6');
  await p.fill('#questionForm [name="comments"]', 'typed before reload');
  await reload(p);
  check(g, 'follow-up: typed text restored', (await p.inputValue('#questionForm [name="comments"]')) === 'typed before reload');
  check(g, 'follow-up: chosen rating restored', await p.isChecked('#questionForm input[name="ease"][value="6"]'));
  await pick(p, 'clarity', '4');
  await submitForm(p);
  // Task 2 straight through, then reload on the final questions.
  await protoClick(p, ['nav-messages', 'message-open-detail']);
  await rerender(p, () => p.click('#finishTask'));
  await p.locator('.reflection-choice label:has(input[value="completed"])').click();
  await rerender(p, () => p.click('#reflectionForm button[type=submit]'));
  await pick(p, 'ease', '7'); await submitForm(p);
  await pick(p, 'overall', '5');
  await reload(p);
  check(g, 'final questions: reload returns to them with the answer kept', /Final questions/.test(await heading(p)) && await p.isChecked('#questionForm input[name="overall"][value="5"]'));
  await submitForm(p);
  await p.waitForSelector('.done-card');
  const before = (await events(p)).length;
  await reload(p);
  check(g, 'reload after finishing shows "already completed"', /already completed/.test(await heading(p)), await heading(p));
  eq(g, 'reload after finishing records nothing new', (await events(p)).length, before);
  check(g, '"Start a new session" offered in local demo mode', await p.isVisible('#newSession'));

  const evs = await events(p);
  eq(g, 'one session only', [...new Set(evs.map(e => e.session_id))].length, 1);
  eq(g, 'one session_started', kinds(evs, 'session_started').length, 1);
  eq(g, 'one session_resumed per reload before finishing (6)', kinds(evs, 'session_resumed').length, 6);
  eq(g, 'each task started once', [kinds(evs, 'task_started', 'task-activity').length, kinds(evs, 'task_started', 'task-message').length], [1, 1]);
  eq(g, 'each task ended once', [kinds(evs, 'task_ended', 'task-activity').length, kinds(evs, 'task_ended', 'task-message').length], [1, 1]);
  eq(g, 'pre-study answer recorded once', kinds(evs, 'answers').filter(e => e.payload.stage === 'pre').map(e => e.payload.answers.experience), ['Weekly']);
  const end = kinds(evs, 'task_ended', 'task-activity')[0].payload;
  eq(g, 'task 1: 3 interruptions recorded (two mid-task, one on self-report)', end.interruptions, 3);
  check(g, 'task 1: time away recorded', Number.isFinite(end.interrupted_seconds), JSON.stringify(end));
  eq(g, 'task 1: clicks counted across reloads (1 + 2)', end.click_count, 3);
  eq(g, 'task 1: success seen before a reload is kept', end.observed_success, true);
  eq(g, 'task 2: no interruptions field', kinds(evs, 'task_ended', 'task-message')[0].payload.interruptions, undefined);
  const followup = kinds(evs, 'answers', 'task-activity')[0]?.payload.answers;
  eq(g, 'follow-up answers include the text typed before the reload', followup?.comments, 'typed before reload');
  eq(g, 'clicks from before the first reload were saved', kinds(evs, 'interaction_batch', 'task-activity').flatMap(e => e.payload.items).filter(x => x.type === 'click').length, 3);

  // Dashboard + CSV
  const r = await ctx.newPage();
  await r.goto(BASE + 'index.html');
  await r.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await r.click('.nav-option[data-tab="results"]');
  await r.selectOption('#resultsStudy', 'demo-portal'); await r.click('#refreshResults');
  await r.waitForFunction(() => /collected event records/.test(document.querySelector('#resultsStatus').textContent));
  check(g, 'dashboard: session marked "Resumed ×6"', /Resumed ×6/.test(await r.textContent('#sessionsList')), await r.textContent('#sessionsList'));
  eq(g, 'dashboard: 1 session', await r.$$eval('#metricCards .metric-card strong', s => s[0].textContent), '1');
  const [d] = await Promise.all([r.waitForEvent('download'), r.click('#exportTasks')]);
  const csv = fs.readFileSync(await d.path(), 'utf8');
  check(g, 'Task CSV has interruptions columns', /"interruptions","interrupted_seconds"/.test(csv.split('\n')[0]), csv.split('\n')[0]);
  // Pilot restart
  await rerender(p, () => p.click('#newSession'));
  check(g, '"Start a new session" returns to the consent page', await p.isVisible('#consentCheck'));
};

scenarios.cardSort = async ctx => {
  const g = 'Card sort reload (demo-card-sort)';
  const p = await open(ctx, 'demo-card-sort');
  await cs.dragCard(p, 'payments', '__new__');
  await cs.dragCard(p, 'payment-history', 'created-1');
  await cs.dragCard(p, 'refund', 'created-1');
  await cs.dragCard(p, 'notices', '__new__');
  await cs.nameGroup(p, 'created-1', 'Money');
  await reload(p);
  eq(g, 'named and unnamed groups survive reload', await p.$$eval('[data-group-name]', s => s.map(x => x.value)), ['Money', '']);
  eq(g, 'placed cards survive reload', await p.$$eval('[data-drop-category="created-1"] [data-card]', s => s.map(x => x.dataset.card).sort()), ['payment-history', 'payments', 'refund']);
  check(g, 'progress text reflects restored placements', /4 of 8/.test(await p.textContent('.sort-progress')));
  for (const c of await p.$$eval('.sort-unsorted [data-card]', s => s.map(x => x.dataset.card))) await cs.moveViaMenu(p, c, 'created-1');
  await cs.nameGroup(p, 'created-2', 'Notices');
  await rerender(p, () => p.click('#submitSort'));
  const evs = await events(p);
  const r = kinds(evs, 'task_ended')[0].payload;
  eq(g, 'one task_started', kinds(evs, 'task_started').length, 1);
  eq(g, 'all 8 cards in the final result', Object.values(r.result.groups).filter(Boolean).length, 8);
  eq(g, 'move count includes moves before the reload (2 groups + 8 cards + 2 names)', r.result.move_count, 12);
  eq(g, '1 interruption recorded', r.interruptions, 1);
};

scenarios.tree = async ctx => {
  const g = 'Tree test reload, and reload between steps (demo-tree-test)';
  const p = await open(ctx, 'demo-tree-test');
  await rerender(p, () => p.click('[data-tree-node="records"]'));
  await reload(p);
  check(g, 'still inside "Records" after reload', /Inside Records/.test(await p.textContent('.tree-section-title')));
  await rerender(p, () => p.click('[data-tree-node="tax-transcripts"]'));
  await rerender(p, () => p.click('#selectDestination'));
  // Now on the follow-up: reload must not reopen the tree.
  await reload(p);
  check(g, 'reload on the follow-up stays on the follow-up', /follow-up/i.test(await heading(p)), await heading(p));
  await pick(p, 'confidence', '5'); await submitForm(p);
  const evs = await events(p);
  const r = kinds(evs, 'task_ended')[0].payload.result;
  eq(g, 'one task_ended despite reloading after it', kinds(evs, 'task_ended').length, 1);
  eq(g, 'path before and after the reload combined; scored direct success', [r.success, r.direct, r.navigation_event_count], [true, true, 2]);
  eq(g, 'follow-up answered once', kinds(evs, 'answers').length, 1);
};

scenarios.firstClick = async ctx => {
  const g = 'First-click reload (demo-first-click)';
  const p = await open(ctx, 'demo-first-click');
  await p.waitForFunction(() => document.querySelector('#firstClickImage')?.complete);
  const box = await p.locator('#firstClickImage').boundingBox();
  await rerender(p, () => p.locator('#firstClickImage').click({ position: { x: box.width * .1, y: box.height * .4 } }));
  await reload(p);
  check(g, 'recorded click and Continue shown after reload', await p.isVisible('.first-click-marker:not(.pending)') && await p.isVisible('#submitFirstClick'));
  check(g, 'cannot click again or choose "not sure" after reload', !(await p.$('#cannotChoose')) && !(await p.$('.click-image-frame[tabindex]')));
  await rerender(p, () => p.click('#submitFirstClick'));
  const evs = await events(p);
  eq(g, 'one first_click event', kinds(evs, 'method_event').filter(e => e.payload.action === 'first_click').length, 1);
  eq(g, 'click from before the reload is the result', kinds(evs, 'task_ended')[0].payload.result.hit_target, true);
};

scenarios.preference = async ctx => {
  const g = 'Preference reload (demo-preference)';
  let sameEvery = true; let lastOrder = null;
  for (let i = 0; i < 3; i++) {
    const p = await open(ctx, 'demo-preference');
    const order = await p.$$eval('.preference-option input', s => s.map(x => x.value));
    await reload(p);
    const after = await p.$$eval('.preference-option input', s => s.map(x => x.value));
    if (JSON.stringify(order) !== JSON.stringify(after)) sameEvery = false;
    lastOrder = after;
    if (i === 2) {
      await p.locator(`.preference-option:has(input[value="${after[0]}"])`).click();
      await rerender(p, () => p.click('#submitPreference'));
      const r = kinds(await events(p), 'task_ended').at(-1).payload.result;
      eq(g, 'recorded display order is the order shown after the reload', r.display_order, after);
    }
    await p.close();
  }
  check(g, 'randomised design order is the same after reload (3 sessions)', sameEvery, `last order ${JSON.stringify(lastOrder)}`);
};

scenarios.survey = async ctx => {
  const g = 'Survey reload with half-filled answers (demo-survey)';
  const p = await open(ctx, 'demo-survey');
  await pick(p, 'frequency', 'Monthly');
  await pick(p, 'priority', 'Read notices');
  await pick(p, 'priority', 'Find records');
  await p.fill('#questionForm [name="feedback"]', 'half-written thought');
  await reload(p);
  eq(g, 'single choice restored', await p.isChecked('#questionForm input[name="frequency"][value="Monthly"]'), true);
  eq(g, 'multiple choices restored', await p.$$eval('#questionForm input[name="priority"]:checked', s => s.map(x => x.value)), ['Find records', 'Read notices']);
  eq(g, 'text restored', await p.inputValue('#questionForm [name="feedback"]'), 'half-written thought');
  await rerender(p, () => p.click('#questionForm button[type=submit]'));
  const a = kinds(await events(p), 'answers')[0]?.payload.answers;
  eq(g, 'submitted answers match the restored ones', a, { frequency: 'Monthly', priority: ['Find records', 'Read notices'], feedback: 'half-written thought' });
};

scenarios.abTest = async ctx => {
  const g = 'A/B reload keeps the assigned design (demo-ab-implementation)';
  for (let i = 0; i < 3; i++) {
    const p = await open(ctx, 'demo-ab-implementation');
    const src = await p.getAttribute('#prototypeFrame', 'src');
    await reload(p);
    eq(g, `session ${i + 1}: same design after reload`, await p.getAttribute('#prototypeFrame', 'src'), src);
    const all = await events(p);
    const current = kinds(all, 'session_started').at(-1).session_id;
    eq(g, `session ${i + 1}: task started once`, kinds(all.filter(e => e.session_id === current), 'task_started').length, 1);
    await p.close();
  }
};

scenarios.safeguards = async ctx => {
  const g = 'Safeguards: changed study, expired progress, duplicate tab';
  // Changed study (researcher edits a preview, then the participant tab reloads).
  const b = await ctx.newPage(); await b.goto(BASE + 'index.html');
  const study = JSON.parse(fs.readFileSync(path.join(ROOT, 'studies/demo-survey.json'), 'utf8'));
  await b.evaluate(s => localStorage.setItem('utp-preview-study', JSON.stringify(s)), study);
  const p = await ctx.newPage(); await p.goto(BASE + 'study.html?preview=1'); await p.waitForSelector('#consentCheck');
  await p.check('#consentCheck'); await rerender(p, () => p.click('#startStudy'));
  await b.evaluate(s => localStorage.setItem('utp-preview-study', JSON.stringify({ ...s, title: s.title + ' (edited)' })), study);
  await reload(p);
  check(g, 'study changed since the last visit → starts fresh at consent', await p.isVisible('#consentCheck'));
  // Expired progress.
  // The page stamps the checkpoint as it unloads, so leave it first (same site, same tab
  // storage), then age the checkpoint as if the tab had been restored a day later.
  const q = await open(ctx, 'demo-tree-test');
  await q.goto(BASE + 'index.html');
  await q.evaluate(() => { for (const k of Object.keys(sessionStorage)) if (k.startsWith('utp-resume-v1')) { const cp = JSON.parse(sessionStorage.getItem(k)); cp.savedAt = Date.now() - 25 * 3600 * 1000; sessionStorage.setItem(k, JSON.stringify(cp)); } });
  await q.goto(`${BASE}study.html?study=demo-tree-test`); await q.waitForSelector('#consentCheck');
  check(g, 'progress older than 24 hours → starts fresh at consent', await q.isVisible('#consentCheck'));
  // Duplicate tab: copy tab A's session storage into tab B.
  const a = await open(ctx, 'demo-card-sort');
  const store = await a.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage))));
  const dup = await ctx.newPage();
  await dup.addInitScript(s => { if (!sessionStorage.length) for (const [k, v] of Object.entries(JSON.parse(s))) sessionStorage.setItem(k, v); }, store);
  const before = (await events(a)).length;
  await dup.goto(`${BASE}study.html?study=demo-card-sort`);
  await dup.waitForFunction(() => !/Loading study/.test(document.querySelector('#participantMain').textContent));
  await dup.waitForTimeout(400);
  check(g, 'duplicated tab is told the study is open in another tab', /open in another tab/i.test(await dup.textContent('#participantMain h1')), await dup.textContent('#participantMain h1'));
  eq(g, 'duplicated tab records nothing', (await events(a)).length, before);
  check(g, 'original tab keeps working', await a.isVisible('[data-drop-category="__new__"]'));
  // After the original tab closes, the duplicate can resume.
  await a.close();
  await reload(dup);
  check(g, 'once the original tab is closed, the other tab resumes the session', await dup.isVisible('[data-drop-category="__new__"]'));
};

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const [name, fn] of Object.entries(scenarios)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
      const errors = [];
      ctx.on('page', pg => { pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); });
      try { await fn(ctx); } catch (err) { check(name, 'scenario ran to completion', false, err.message.split('\n')[0]); }
      eq(name, 'no browser errors', errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
  fs.writeFileSync(path.join(OUT, 'resume-report.json'), JSON.stringify({ ran_at: new Date().toISOString(), checks }, null, 2));
  let group = '';
  for (const c of checks) { if (c.group !== group) { group = c.group; console.log(`\n${group}`); } console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : `\n      → ${c.detail}`}`); }
  const failed = checks.filter(c => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} resume checks passed`);
  process.exit(failed ? 1 : 0);
})();
