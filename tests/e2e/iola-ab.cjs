#!/usr/bin/env node
/* IOLA A/B study: browser integration checks (studies/iola-current-vs-new.json).
 *
 * Runs scripted, clearly synthetic participants through both designs inside Research Studio
 * and checks what the study records. These are software tests: the sessions stay in a throwaway
 * browser profile in local demo mode and are not research data.
 *
 * Where the prototypes come from (they live in the design-prototypes Pages site, not in this repo):
 *   IOLA_PROTOTYPES=<folder holding iola-ab-test/>   serve those bytes at the published addresses
 *   IOLA_LIVE=1                                       use the published site over the network
 * With neither set, the test is skipped.
 *
 * Usage:  IOLA_PROTOTYPES=/path/to/copy npm run test:iola
 *         E2E_PORT=8178 E2E_OUT=dir IOLA_ONLY=success,refresh node tests/e2e/iola-ab.cjs
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 8178);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.E2E_OUT || path.join(__dirname, 'output', 'iola');
const LOCAL = process.env.IOLA_PROTOTYPES ? path.resolve(process.env.IOLA_PROTOTYPES) : null;
const LIVE = process.env.IOLA_LIVE === '1';
const ONLY = (process.env.IOLA_ONLY || '').split(',').filter(Boolean);
const STUDY_ID = 'iola-current-vs-new';
const study = JSON.parse(fs.readFileSync(path.join(ROOT, 'studies', `${STUDY_ID}.json`), 'utf8'));
const TASKS = study.tasks.map(t => t.id);
const SIGNAL = Object.fromEntries(study.tasks.map(t => [t.id, t.successSignal]));
const URL_OF = Object.fromEntries(study.tasks[0].variants.map(v => [v.id, v.prototypeUrl]));
const HOSTED = new URL('../../', URL_OF['iola-current']).href; // .../design-prototypes/
const PROTO_HOST = new URL(HOSTED).host;

if (!LOCAL && !LIVE) { console.log('IOLA A/B checks skipped: set IOLA_PROTOTYPES=<folder holding iola-ab-test/> or IOLA_LIVE=1.'); process.exit(0); }
if (LOCAL && !fs.existsSync(path.join(LOCAL, 'iola-ab-test'))) { console.error(`IOLA_PROTOTYPES has no iola-ab-test/ folder: ${LOCAL}`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
function check(group, name, pass, detail) { checks.push({ group, name, pass: !!pass, detail: pass ? undefined : detail }); }
function eq(group, name, actual, expected) { check(group, name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

// ---------- server and prototype source ----------
async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + 'study.html')).ok) return proc; } catch {} await new Promise(r => setTimeout(r, 100)); }
  proc.kill(); throw new Error(`Static server did not start on port ${PORT}`);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
async function serveRule(ctx, { blockTracker = false } = {}) {
  // Playwright tries the most recently added route first, so the block goes in last.
  if (LOCAL) await ctx.route(HOSTED + '**', route => {
    let rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(HOSTED).pathname.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(LOCAL, rel);
    if (!file.startsWith(LOCAL) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  if (blockTracker) await ctx.route('**/iola-ab-test/load-tracker.js', r => r.fulfill({ status: 404, body: 'blocked by test' }));
}
async function newContext(browser, group, opts = {}) {
  const mobile = opts.viewport && opts.viewport.width < 500;
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1360, height: 900 }, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  await serveRule(ctx, opts);
  const errors = [], hosts = new Set();
  ctx.on('page', p => {
    p.on('console', m => { if (m.type() === 'error' && !/blocked by test|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
    p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    p.on('request', r => { try { hosts.add(new URL(r.url()).host); } catch {} });
    p.on('response', r => { if (r.status() >= 400 && !(opts.blockTracker && /load-tracker/.test(r.url()))) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  });
  return { ctx, errors, hosts, done: async () => {
    eq(group, 'no browser errors (console, page, HTTP)', errors, []);
    const extra = [...hosts].filter(h => h !== `localhost:${PORT}` && h !== PROTO_HOST);
    eq(group, 'no requests to hosts other than Research Studio and design-prototypes', extra, []);
    await ctx.close();
  } };
}

// ---------- participant helpers ----------
async function rerender(p, action) {
  await p.evaluate(() => document.querySelector('#participantMain').firstElementChild?.setAttribute('data-e2e-old', '1'));
  await action();
  await p.waitForFunction(() => !document.querySelector('#participantMain [data-e2e-old]'), null, { timeout: 10000 });
}
async function fillForm(p, answers) {
  for (const [name, value] of Object.entries(answers)) {
    const loc = p.locator(`#questionForm [name="${name}"]`).first();
    const kind = await loc.evaluate(el => el.type || el.tagName.toLowerCase());
    if (kind === 'radio') await p.locator(`#questionForm label.choice:has(input[name="${name}"][value="${value}"])`).click();
    else await loc.fill(value);
  }
  await rerender(p, () => p.click('#questionForm button[type=submit]'));
}
async function startSession(ctx, query) {
  const p = await ctx.newPage();
  await p.goto(`${BASE}study.html?study=${STUDY_ID}${query ? '&' + query : ''}`);
  // Consent is collected on the survey page (consentMode external): no checkbox here.
  await p.waitForSelector('#startStudy');
  if (await p.$('#consentCheck')) await p.check('#consentCheck');
  await rerender(p, () => p.click('#startStudy'));
  await fillForm(p, { 'iola-use': 'Yes, once or twice' });
  return p;
}
async function openTask(p, viewport) {
  await p.waitForSelector('#prototypeFrame');
  const connected = await p.waitForSelector('#bridgeIndicator.connected', { timeout: 10000 }).then(() => true, () => false);
  const f = p.frameLocator('#prototypeFrame');
  await f.locator('#app').first().waitFor();
  // Playwright doesn't scroll the page to reach fixed elements inside an iframe; a person scrolls.
  if (viewport && viewport.width < 500) await p.locator('#prototypeFrame').evaluate(el => el.scrollIntoView({ block: 'end' }));
  return { f, connected, src: await p.getAttribute('#prototypeFrame', 'src'), indicator: (await p.textContent('#bridgeIndicator')).trim() };
}
async function finishTask(p, taskId, self = 'completed', ease = '5') {
  await p.waitForTimeout(250);
  await rerender(p, () => p.click('#finishTask'));
  await p.locator(`.reflection-choice label:has(input[value="${self}"])`).click();
  await rerender(p, () => p.click('#reflectionForm button[type=submit]'));
  await fillForm(p, { [`${taskId}-ease`]: ease });
}
async function finishStudy(p) { await fillForm(p, { 'overall-ease': '5', confidence: '4' }); await p.waitForSelector('.done-card'); }
const allEvents = p => p.evaluate(() => JSON.parse(localStorage.getItem('utp-demo-events-v1') || '[]'));
async function sessionEvents(p) { const evs = await allEvents(p); const sid = evs[evs.length - 1]?.session_id; return evs.filter(e => e.session_id === sid); }
const ended = (evs, task) => evs.filter(e => e.kind === 'task_ended' && e.task_id === task).pop();
const interactions = (evs, task) => evs.filter(e => e.kind === 'interaction_batch' && e.task_id === task).flatMap(e => e.payload.items || []);
const click = (f, id) => f.locator(`[data-ut-id="${id}"]`).first().click();

// ---------- task scripts (one per design) ----------
const DESIGN = {
  'iola-current': {
    pay: async (f, { amount = '200.00', type = 'payTowardsBalance', year = '2024' } = {}) => {
      await click(f, 'home-make-payment');
      await f.locator('#ptype').selectOption(type); // re-renders the form
      await f.locator('#year').selectOption(year);
      if (type !== 'payBalanceInFull') await f.locator('#amount').fill(amount);
      await click(f, 'pay-continue-1'); await click(f, 'pay-continue-2');
      await f.locator('#authorize').check(); await click(f, 'pay-submit');
      await f.locator('[data-ut-id="pay-done"]').waitFor();
    },
    oic: async f => { await click(f, 'nav-payments'); await click(f, 'menu-payment-options'); await click(f, 'options-oic'); await f.getByRole('heading', { name: /offer in compromise/i }).first().waitFor(); },
    respond: async (f, choice = 'agree') => {
      await click(f, 'nav-notices'); await click(f, 'menu-notices'); await click(f, 'notices-view-cp2000'); await click(f, 'cp2000-respond');
      await f.locator(`[data-ut-id="respond-${choice}"]`).check();
      if (choice !== 'agree') await f.locator('#explain').fill('Synthetic test explanation.');
      await click(f, 'respond-continue'); await click(f, 'respond-submit'); await f.locator('[data-ut-id="respond-done"]').waitFor();
    },
    upload: async (f, { files = ['f1099', 'fstmt'], notice = 'CP2000', year = '2024' } = {}) => {
      await click(f, 'nav-notices'); await click(f, 'menu-notices'); await click(f, 'notices-view-cp2000'); await click(f, 'cp2000-dut-link');
      await f.locator('#dutNotice').selectOption(notice); await f.locator('#dutYear').selectOption(year);
      await click(f, 'dut-continue'); await click(f, 'dut-choose-files');
      for (const id of files) await f.locator(`[data-ut-id="picker-${id}"]`).check();
      await click(f, 'picker-add'); await click(f, 'dut-submit'); await f.locator('[data-ut-id="dut-done"]').waitFor();
    },
    wander: async f => { await click(f, 'nav-records'); await click(f, 'menu-tax-records'); await click(f, 'nav-balance'); await click(f, 'nav-home'); }
  },
  'iola-new': {
    pay: async (f, { amount = '200', slide = false, p } = {}) => {
      await click(f, 'home-pay-now'); await click(f, 'paysheet-amount');
      await f.locator('#amt').fill(amount); await click(f, 'paysheet-amount-done');
      if (slide) {
        const box = await f.locator('#slider').boundingBox(), k = await f.locator('#knob').boundingBox();
        await p.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await p.mouse.down();
        for (let i = 1; i <= 12; i++) await p.mouse.move(k.x + k.width / 2 + box.width * i / 12, k.y + k.height / 2);
        await p.mouse.up();
      } else await click(f, 'paysheet-pay-button');
      await click(f, 'confirm-yes'); await f.locator('[data-ut-id="paysheet-done"]').waitFor();
    },
    oic: async f => { await click(f, 'tab-pay'); await click(f, 'pay-over-time'); await click(f, 'options-oic'); await f.getByRole('heading', { name: /offer in compromise/i }).first().waitFor(); },
    respond: async (f, choice = 'agree') => {
      await click(f, 'tab-notices'); await click(f, 'notices-cp2000'); await click(f, 'cp2000-respond');
      await f.locator(`[data-ut-id="respond-${choice}"]`).check();
      if (choice !== 'agree') await f.locator('#explain').fill('Synthetic test explanation.');
      await click(f, 'respond-send'); await click(f, 'confirm-yes'); await f.locator('[data-ut-id="respond-done"]').waitFor();
    },
    upload: async (f, { files = ['f1099', 'fstmt'], office = 'Ogden, UT' } = {}) => {
      await click(f, 'home-alert-cp2000'); await click(f, 'cp2000-upload');
      await f.locator('#office').selectOption(office); await click(f, 'upload-select-file');
      for (const id of files) await f.locator(`[data-ut-id="picker-${id}"]`).check();
      await click(f, 'picker-add'); await click(f, 'upload-submit'); await click(f, 'confirm-yes');
      await f.locator('[data-ut-id="upload-done"]').waitFor();
    },
    wander: async f => { await click(f, 'tab-records'); await click(f, 'tab-notices'); await click(f, 'tab-home'); }
  }
};
const RIGHT = { 'one-time-payment': 'pay', 'find-oic': 'oic', 'respond-to-notice': 'respond', 'upload-documents': 'upload' };
// Clearly wrong outcomes that must not count as success.
const WRONG = {
  'iola-current': {
    'one-time-payment': f => DESIGN['iola-current'].pay(f, { year: '2025' }),            // right amount, wrong tax year
    'find-oic': async f => { await click(f, 'nav-payments'); await click(f, 'menu-payment-options'); },
    'respond-to-notice': f => DESIGN['iola-current'].respond(f, 'disagree'),
    'upload-documents': f => DESIGN['iola-current'].upload(f, { files: ['f1099', 'fphoto'] })
  },
  'iola-new': {
    'one-time-payment': f => DESIGN['iola-new'].pay(f, { amount: '1247.53' }),            // paid in full instead of $200
    'find-oic': async f => { await click(f, 'tab-pay'); },
    'respond-to-notice': f => DESIGN['iola-new'].respond(f, 'partial'),
    'upload-documents': f => DESIGN['iola-new'].upload(f, { office: 'Austin, TX' })
  }
};
const VARIANTS = ['iola-current', 'iola-new'];
// Does task t correctly in design v.
const doRight = (v, t, f, p) => t === 'one-time-payment' ? DESIGN[v].pay(f, { p }) : DESIGN[v][RIGHT[t]](f);

// ---------- scenarios ----------
const scenarios = {
  // Every task done correctly on computers (a full-size and a small laptop window), for both designs.
  async success(browser) {
    for (const v of VARIANTS) for (const viewport of [null, { width: 1024, height: 700 }]) {
      const g = `success ${v} ${viewport ? 'small laptop window' : 'desktop'}`;
      const c = await newContext(browser, g, { viewport });
      const p = await startSession(c.ctx, `variant=${v}`);
      for (const [i, t] of TASKS.entries()) {
        const { f, connected, src, indicator } = await openTask(p, viewport);
        check(g, `${t}: tracker connected`, connected);
        eq(g, `${t}: indicator text`, indicator, 'Click tracking active');
        eq(g, `${t}: loads the configured design`, src, new URL(URL_OF[v], BASE).href);
        await doRight(v, t, f, p);
        if (!viewport && i === 0) await p.screenshot({ path: path.join(OUT, `${v}-task1-done.png`) });
        await finishTask(p, t);
      }
      await finishStudy(p);
      const evs = await sessionEvents(p);
      for (const t of TASKS) {
        const e = ended(evs, t); const r = e?.payload?.result || {};
        eq(g, `${t}: success recorded`, [r.success_signal_received, r.success_signal_status], [true, 'received']);
        eq(g, `${t}: design recorded`, [e?.payload?.variant_id, e?.payload?.experiment_id, e?.payload?.variant_revision], [v, 'iola-current-vs-new', 'proto-v1']);
        eq(g, `${t}: tracker_connected recorded`, e?.payload?.tracker_connected, true);
        const P = e?.payload || {};
        check(g, `${t}: time to success <= time to Finish <= total time`, Number.isFinite(P.success_at_seconds) && P.success_at_seconds <= P.finished_at_seconds && P.finished_at_seconds <= P.time_seconds, [P.success_at_seconds, P.finished_at_seconds, P.time_seconds]);
        check(g, `${t}: clicks recorded`, (e?.payload?.click_count || 0) > 0, e?.payload?.click_count);
        const its = interactions(evs, t);
        check(g, `${t}: click positions recorded`, its.some(x => x.type === 'click' && x.x_pct > 0 && x.y_pct > 0), its.length);
        check(g, `${t}: screens recorded`, its.some(x => x.type === 'screen'), its.map(x => x.type));
        check(g, `${t}: wrong-outcome events not raised`, !its.some(x => x.type === 'custom' && /notice-response-(partial|disagree)/.test(x.target)), its.filter(x => x.type === 'custom').map(x => x.target));
        check(g, `${t}: ease answer kept`, evs.some(e2 => e2.kind === 'answers' && e2.task_id === t && e2.payload?.stage === 'post_task' && String(e2.payload?.answers?.[`${t}-ease`]) === '5'), 'missing');
      }
      check(g, 'session completed', evs.some(e => e.kind === 'session_completed'), 'no session_completed');
      await c.done();
    }
  },
  // Laptops and desktops only (study allowedDevices = desktop): phones and tablets are turned away before anything is recorded.
  async devices(browser) {
    const g = 'phones and tablets turned away';
    eq(g, 'the study is set to computers only', study.allowedDevices, 'desktop');
    const kinds = [
      ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }],
      ['Android tablet', { viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }],
      ['iPad (reports itself as a Mac)', { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' }]
    ];
    for (const [name, opts] of kinds) {
      const ctx = await browser.newContext(opts); await serveRule(ctx);
      const p = await ctx.newPage();
      await p.goto(`${BASE}study.html?study=${STUDY_ID}&variant=iola-new`);
      await p.waitForSelector('h1');
      eq(g, `${name}: told to use a computer`, (await p.textContent('h1')).trim(), 'Please use a laptop or desktop computer');
      check(g, `${name}: cannot start`, !(await p.$('#startStudy')), 'Begin shown');
      eq(g, `${name}: nothing recorded`, (await allEvents(p)).filter(e => e.study_id === STUDY_ID).length, 0);
      await ctx.close();
    }
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } }); await serveRule(ctx);
    const p = await ctx.newPage(); await p.goto(`${BASE}study.html?study=${STUDY_ID}`);
    await p.waitForSelector('#startStudy');
    check(g, 'a narrow window on a computer is still allowed', true);
    await ctx.close();
  },
  // Clearly wrong outcomes: none may count, and the wrong outcome is logged as a custom event.
  async wrong(browser) {
    for (const v of VARIANTS) {
      const g = `wrong outcome ${v}`;
      const c = await newContext(browser, g);
      const p = await startSession(c.ctx, `variant=${v}`);
      for (const t of TASKS) { const { f } = await openTask(p); await WRONG[v][t](f); await finishTask(p, t, 'completed', '3'); }
      await finishStudy(p);
      const evs = await sessionEvents(p);
      for (const t of TASKS) {
        const r = ended(evs, t)?.payload?.result || {};
        eq(g, `${t}: not counted as success`, [r.success_signal_received, r.success_signal_status], [false, 'not_observed']);
        eq(g, `${t}: no time to success`, 'success_at_seconds' in (ended(evs, t)?.payload || {}), false);
      }
      const customs = TASKS.map(t => interactions(evs, t).filter(x => x.type === 'custom').map(x => x.target));
      check(g, 'payment: wrong payment logged', customs[0].some(n => /^payment-submitted-/.test(n)), customs[0]);
      check(g, 'notice: non-agree response logged', customs[2].some(n => /^notice-response-(partial|disagree)$/.test(n)), customs[2]);
      check(g, 'upload: wrong submission logged', customs[3].some(n => /^documents-submitted-/.test(n)), customs[3]);
      await c.done();
    }
  },
  // Wandering, going back, repeating the action, and a success signal that belongs to another task.
  async backtrack(browser) {
    for (const v of VARIANTS) {
      const g = `backtracking and repeats ${v}`;
      const c = await newContext(browser, g);
      const p = await startSession(c.ctx, `variant=${v}`);
      let { f } = await openTask(p);
      await DESIGN[v].wander(f);
      await DESIGN[v].oic(f);                       // another task's signal during the payment task
      await (v === 'iola-current' ? click(f, 'nav-home') : click(f, 'tab-home'));
      await DESIGN[v].pay(f, { p });
      await (v === 'iola-current' ? click(f, 'pay-done') : click(f, 'paysheet-done'));
      await DESIGN[v].pay(f, { p });                // the same success a second time
      await finishTask(p, 'one-time-payment');
      ({ f } = await openTask(p)); await DESIGN[v].oic(f); await finishTask(p, 'find-oic');
      ({ f } = await openTask(p)); await finishTask(p, 'respond-to-notice', 'unable', '2'); // gave up straight away
      ({ f } = await openTask(p)); await DESIGN[v].upload(f, { files: ['fphoto'] });
      // second try in the same task, done right
      if (v === 'iola-current') await click(f, 'dut-done'); else { await click(f, 'upload-done'); await click(f, 'tab-home'); }
      await DESIGN[v].upload(f);
      await finishTask(p, 'upload-documents');
      await finishStudy(p);
      const evs = await sessionEvents(p);
      const r = t => ended(evs, t)?.payload?.result || {};
      eq(g, 'payment after wandering: one success', [r('one-time-payment').success_signal_received], [true]);
      eq(g, 'payment repeated: recorded as success once (a yes/no per task)', typeof r('one-time-payment').success_signal_received, 'boolean');
      const pays = interactions(evs, 'one-time-payment').filter(x => x.type === 'custom' && /^payment-submitted-200/.test(x.target)).length;
      eq(g, 'payment repeated: both submissions visible as custom events', pays, 2);
      eq(g, 'OIC found during the payment task does not leak into the OIC task', r('find-oic').success_signal_status, 'received');
      eq(g, 'gave up: status not_observed and self-report unable', [r('respond-to-notice').success_signal_status, ended(evs, 'respond-to-notice')?.payload?.self_report], ['not_observed', 'unable']);
      eq(g, 'wrong then right upload: success', r('upload-documents').success_signal_status, 'received');
      await c.done();
    }
  },
  // Reload in the middle of a task, and reload after success but before Finish.
  async refresh(browser) {
    for (const v of VARIANTS) {
      const g = `refresh and recovery ${v}`;
      const c = await newContext(browser, g);
      const p = await startSession(c.ctx, `variant=${v}`);
      let { f } = await openTask(p);
      await DESIGN[v].wander(f);
      await p.reload(); await p.waitForSelector('#resumeNotice');
      let o = await openTask(p);
      check(g, 'after reload mid-task: tracker reconnects', o.connected);
      await DESIGN[v].pay(o.f, { p });
      await finishTask(p, 'one-time-payment');
      ({ f } = await openTask(p)); await DESIGN[v].oic(f);
      await p.waitForTimeout(300);
      await p.reload(); await p.waitForSelector('#resumeNotice');
      o = await openTask(p);
      eq(g, 'after reload past success: same design reloads', o.src, new URL(URL_OF[v], BASE).href);
      await finishTask(p, 'find-oic');
      for (const t of TASKS.slice(2)) { ({ f } = await openTask(p)); await doRight(v, t, f, p); await finishTask(p, t); }
      await finishStudy(p);
      const evs = await sessionEvents(p);
      const e1 = ended(evs, 'one-time-payment'), e2 = ended(evs, 'find-oic');
      eq(g, 'reload mid-task: success still recorded', e1?.payload?.result?.success_signal_status, 'received');
      check(g, 'reload mid-task: interruption recorded', (e1?.payload?.interruptions || 0) >= 1, e1?.payload);
      eq(g, 'success before reload is kept', e2?.payload?.result?.success_signal_status, 'received');
      check(g, 'time to success before reload is kept', Number.isFinite(e2?.payload?.success_at_seconds) && e2.payload.success_at_seconds <= e2.payload.finished_at_seconds, e2?.payload);
      eq(g, 'design unchanged across all tasks', [...new Set(evs.filter(e => e.kind === 'task_ended').map(e => e.payload.variant_id))], [v]);
      await c.done();
    }
  },
  // Leaving mid-study: the record shows an unfinished session, not a failed task.
  async abandon(browser) {
    for (const v of VARIANTS) {
      const g = `abandonment ${v}`;
      const c = await newContext(browser, g);
      const p = await startSession(c.ctx, `variant=${v}`);
      const { f } = await openTask(p); await DESIGN[v].pay(f, { p }); await finishTask(p, 'one-time-payment');
      const o = await openTask(p); await DESIGN[v].wander(o.f); await p.waitForTimeout(300);
      const evs = await sessionEvents(p);
      await p.close();
      eq(g, 'task 1 recorded before leaving', ended(evs, 'one-time-payment')?.payload?.result?.success_signal_status, 'received');
      check(g, 'task 2 started but has no outcome', evs.some(e => e.kind === 'task_started' && e.task_id === 'find-oic') && !ended(evs, 'find-oic'), evs.map(e => e.kind));
      check(g, 'session not marked completed', !evs.some(e => e.kind === 'session_completed'), 'completed');
      await c.done();
    }
  },
  // Tracker can't load: Research Studio must report "unavailable", not a failed task.
  async nobridge(browser) {
    for (const v of VARIANTS) {
      const g = `missing tracker ${v}`;
      const c = await newContext(browser, g, { blockTracker: true });
      const p = await startSession(c.ctx, `variant=${v}`);
      const o = await openTask(p);
      check(g, 'indicator does not claim tracking', !o.connected && /Waiting for tracker/.test(o.indicator), o.indicator);
      await DESIGN[v].pay(o.f, { p });
      await finishTask(p, 'one-time-payment');
      const evs = await sessionEvents(p);
      const e = ended(evs, 'one-time-payment');
      eq(g, 'no evidence recorded as unavailable', [e?.payload?.result?.success_signal_status, e?.payload?.tracker_connected, 'observed_success' in (e?.payload || {})], ['unavailable', false, false]);
      await p.close(); await c.done();
    }
  },
  // Random assignment (no variant in the link) and the Qualtrics return link.
  async assignment(browser) {
    const g = 'assignment and Qualtrics return';
    const seen = new Set();
    for (let i = 0; i < 6 && seen.size < 2; i++) {
      const c = await newContext(browser, g);
      const ret = encodeURIComponent('https://irsresearch.gov1.qualtrics.com/jfe/form/SV_test');
      const p = await startSession(c.ctx, `pid=R_test${i}&return=${ret}`);
      const first = await openTask(p);
      const v = Object.keys(URL_OF).find(k => first.src === new URL(URL_OF[k], BASE).href);
      check(g, `session ${i}: assigned a configured design`, !!v, first.src);
      seen.add(v);
      await DESIGN[v].pay(first.f, { p }); await finishTask(p, 'one-time-payment');
      for (const t of TASKS.slice(1)) { const o = await openTask(p); eq(g, `session ${i} ${t}: same design`, o.src, first.src); await doRight(v, t, o.f, p); await finishTask(p, t); }
      await finishStudy(p);
      const href = await p.getAttribute('#returnToSurvey', 'href');
      const u = new URL(href);
      eq(g, `session ${i}: return link host`, u.host, 'irsresearch.gov1.qualtrics.com');
      eq(g, `session ${i}: return link variant`, u.searchParams.get('rs_variant'), v);
      eq(g, `session ${i}: return link per-task results`, TASKS.map((t, k) => [u.searchParams.get(`rs_ab${k + 1}_task`), u.searchParams.get(`rs_ab${k + 1}_success`)]), TASKS.map(t => [t, 'received']));
      eq(g, `session ${i}: return link carries the panel id`, u.searchParams.get('rs_pid'), `R_test${i}`);
      check(g, `session ${i}: return link has time to success for each task`, TASKS.every((t, k) => /^\d+$/.test(u.searchParams.get(`rs_ab${k + 1}_tts`) || '')), href);
      check(g, `session ${i}: return link has no click details`, ![...u.searchParams.keys()].some(k => /click_|x_pct|page/.test(k)), href);
      await c.done();
    }
    eq(g, 'both designs assigned across sessions', [...seen].sort(), [...VARIANTS].sort());
  },
  // Inside the study: no theme switch, light theme, no research banner text check (the deployed design omits it by choice).
  async frame(browser) {
    for (const v of VARIANTS) {
      const g = `in-frame presentation ${v}`;
      const c = await newContext(browser, g);
      const p = await startSession(c.ctx, `variant=${v}`);
      const { f } = await openTask(p);
      eq(g, 'theme is light', await f.locator('html').getAttribute('data-theme'), 'light');
      eq(g, 'dark mode switch hidden', await f.locator('[data-theme-toggle]').evaluateAll(els => els.filter(e => e.offsetParent !== null).length), 0);
      const ext = await f.locator('a[href^="http"]').evaluateAll(els => els.map(a => [a.getAttribute('href'), a.target]));
      check(g, 'external links open in a new tab (participant keeps the prototype)', ext.every(([, t]) => t === '_blank'), ext);
      await p.close(); await c.done();
    }
  }
};

// ---------- what participants see: contrast, accessibility and fit, in states other checks never open ----------
// Each state is a list of steps from a fresh load: 'id' clicks [data-ut-id=id]; '#sel=value' selects or fills; '+id' ticks a checkbox.
const STATES = {
  'iola-current': {
    'home': [], 'menu Payments open': ['nav-payments'], 'menu Records open': ['nav-records'], 'menu Notices open': ['nav-notices'], 'menu Authorizations open': ['nav-authorizations'],
    'payment step 1': ['home-make-payment', '#ptype=payTowardsBalance'], 'payment error': ['home-make-payment', 'pay-continue-1'],
    'payment review': ['home-make-payment', '#ptype=payTowardsBalance', '#year=2024', '#amount=200.00', 'pay-continue-1', 'pay-continue-2'],
    'payment done': ['home-make-payment', '#ptype=payTowardsBalance', '#year=2024', '#amount=200.00', 'pay-continue-1', 'pay-continue-2', '+pay-authorize', 'pay-submit'],
    'payment options': ['nav-payments', 'menu-payment-options'], 'offer in compromise': ['nav-payments', 'menu-payment-options', 'options-oic'],
    'notices': ['nav-notices', 'menu-notices'], 'notice CP2000': ['nav-notices', 'menu-notices', 'notices-view-cp2000'],
    'respond review': ['nav-notices', 'menu-notices', 'notices-view-cp2000', 'cp2000-respond', '+respond-agree', 'respond-continue'],
    'upload picker open': ['nav-notices', 'menu-notices', 'notices-view-cp2000', 'cp2000-dut-link', '#dutNotice=CP2000', '#dutYear=2024', 'dut-continue', 'dut-choose-files'],
    'upload done': ['nav-notices', 'menu-notices', 'notices-view-cp2000', 'cp2000-dut-link', '#dutNotice=CP2000', '#dutYear=2024', 'dut-continue', 'dut-choose-files', '+picker-f1099', '+picker-fstmt', 'picker-add', 'dut-submit']
  },
  'iola-new': {
    'home': [], 'pay sheet': ['home-pay-now'], 'pay sheet editing amount': ['home-pay-now', 'paysheet-amount'], 'pay confirm': ['home-pay-now', 'paysheet-pay-button'],
    'payment done': ['home-pay-now', 'paysheet-pay-button', 'confirm-yes'], 'payments tab': ['tab-pay'], 'payment options': ['tab-pay', 'pay-over-time'],
    'offer in compromise': ['tab-pay', 'pay-over-time', 'options-oic'], 'notices': ['tab-notices'], 'notice CP2000': ['tab-notices', 'notices-cp2000'],
    'respond confirm': ['tab-notices', 'notices-cp2000', 'cp2000-respond', '+respond-agree', 'respond-send'],
    'upload picker open': ['home-alert-cp2000', 'cp2000-upload', 'upload-select-file'],
    'upload done': ['home-alert-cp2000', 'cp2000-upload', '#office=Ogden, UT', 'upload-select-file', '+picker-f1099', '+picker-fstmt', 'picker-add', 'upload-submit', 'confirm-yes']
  }
};
async function runStep(page, step) {
  if (step.startsWith('#')) { const [sel, val] = step.split('='); const el = page.locator(sel); if (await el.evaluate(e => e.tagName) === 'SELECT') await el.selectOption(val); else await el.fill(val); return; }
  if (step.startsWith('+')) return page.locator(`[data-ut-id="${step.slice(1)}"]`).first().check();
  await page.locator(`[data-ut-id="${step}"]`).first().click();
}
scenarios.visual = async browser => {
  const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [ROOT] }), 'utf8');
  for (const v of VARIANTS) for (const width of [390, 1280]) {
    const g = `what participants see ${v} at ${width}px`;
    const c = await newContext(browser, g, { viewport: { width, height: 860 } });
    const page = await c.ctx.newPage();
    for (const [state, steps] of Object.entries(STATES[v])) {
      await page.goto('about:blank');
      await page.goto(URL_OF[v].replace('#', '?theme=light#'));
      await page.locator('#app').waitFor();
      try { for (const st of steps) await runStep(page, st); } catch (e) { check(g, `${state}: reachable`, false, e.message.split('\n')[0]); continue; }
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(g, `${state}: no sideways scroll`, over <= 1, `${over}px too wide`);
      await page.addScriptTag({ content: axeSource });
      const v8 = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'], resultTypes: ['violations'] })).violations
        .map(x => `${x.id} (${x.nodes.length}): ${x.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')}`));
      eq(g, `${state}: no WCAG 2.1 A/AA violations`, v8, []);
      // axe can't resolve the background of absolutely positioned pop-ups (it marks them "needs review"),
      // so check every visible piece of text against the background actually behind it.
      const low = await page.evaluate(() => {
        const rgb = c => { const m = c.match(/[\d.]+/g) || [0, 0, 0, 0]; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] }; };
        const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          const st = getComputedStyle(el), r = el.getBoundingClientRect();
          if (st.visibility === 'hidden' || +st.opacity === 0 || r.width === 0 || r.height === 0 || el.closest('[aria-hidden="true"]')) continue;
          const fg = rgb(st.color); if (fg.a < 0.5) continue;
          const L1 = lum(fg), L2 = lum(bgOf(el)), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const large = parseFloat(st.fontSize) >= 24 || (parseFloat(st.fontSize) >= 18.66 && +st.fontWeight >= 700);
          if (ratio < (large ? 3 : 4.5)) out.push(`"${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}:1`);
        }
        return out.slice(0, 8);
      });
      eq(g, `${state}: all visible text has enough contrast`, low, []);
      if (width === 1280 && /menu .* open/.test(state)) await page.screenshot({ path: path.join(OUT, `${v}-${state.replace(/\W+/g, '-')}.png`), clip: { x: 0, y: 0, width: 1280, height: 420 } });
    }
    await page.close(); await c.done();
  }
};

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  const started = Date.now();
  try {
    for (const [name, run] of Object.entries(scenarios)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      try { await run(browser); } catch (e) { check(name, 'scenario ran to completion', false, e.message.split('\n').filter(l => /Timeout|waiting for|Error|expected/i.test(l)).slice(0, 3).join(' | ')); }
    }
  } finally { await browser.close(); server.kill(); }
  const failed = checks.filter(c => !c.pass);
  fs.writeFileSync(path.join(OUT, 'iola-checks.json'), JSON.stringify({ source: LOCAL ? `local copy: ${LOCAL}` : 'live site', checks }, null, 2));
  console.log(`IOLA A/B (${LOCAL ? 'local copy of the published prototypes' : 'live site'}): ${checks.length - failed.length}/${checks.length} checks passed in ${Math.round((Date.now() - started) / 1000)}s`);
  for (const c of failed) console.log(`  FAIL [${c.group}] ${c.name}: ${c.detail}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
