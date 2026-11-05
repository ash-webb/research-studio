#!/usr/bin/env node
/* Research Studio inside a Qualtrics survey: browser checks of docs/qualtrics-embed.js and
 * study.html?embed=qualtrics, with a stand-in for the Qualtrics page served at a qualtrics.com
 * address. Runs the IOLA A/B study end to end and imports the stored fields back.
 * Synthetic participants only; these are software tests, not research data.
 *
 * Needs the IOLA prototypes (they are not in this repo):
 *   IOLA_PROTOTYPES=<folder holding iola-ab-test/> npm run test:embed
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
// Research Studio is served from this folder at its published address, inside the test browser only:
// a public survey page may not frame a localhost address (Chrome's local network protection).
const BASE = 'https://ash-webb.github.io/research-studio/';
const OUT = process.env.E2E_OUT || path.join(__dirname, 'output', 'embed');
const LOCAL = process.env.IOLA_PROTOTYPES ? path.resolve(process.env.IOLA_PROTOTYPES) : null;
const ONLY = (process.env.EMBED_ONLY || '').split(',').filter(Boolean);
const STUDY_ID = 'iola-current-vs-new';
const SURVEY = 'https://irsresearch.gov1.qualtrics.com/jfe/form/SV_mockEmbed';
const EVIL = 'https://not-approved.example.com/survey';
const OTHER_QX = 'https://otheraccount.qualtrics.com/jfe/form/SV_other';
if (!LOCAL || !fs.existsSync(path.join(LOCAL, 'iola-ab-test'))) { console.log('Qualtrics embed checks skipped: set IOLA_PROTOTYPES=<folder holding iola-ab-test/>.'); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });
const study = JSON.parse(fs.readFileSync(path.join(ROOT, 'studies', `${STUDY_ID}.json`), 'utf8'));
const TASKS = study.tasks.map(t => t.id);
const URL_OF = Object.fromEntries(study.tasks[0].variants.map(v => [v.id, v.prototypeUrl]));
const HOSTED = new URL('../../', URL_OF['iola-current']).href;

const checks = [];
const check = (group, name, pass, detail) => checks.push({ group, name, pass: !!pass, detail: pass ? undefined : detail });
const eq = (group, name, a, e) => check(group, name, JSON.stringify(a) === JSON.stringify(e), `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);

let M; // ES modules from src/
const SERVE_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function serveStudio(ctx) {
  await ctx.route(BASE + '**', route => {
    let rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(BASE).pathname.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || /node_modules|\.git/.test(rel) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: SERVE_TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
}

// ---------- the stand-in Qualtrics page ----------
// mode 'js': newer layouts (setJSEmbeddedData → __js_<name>); 'classic': setEmbeddedData → <name>.
// Like Qualtrics, only declared fields are kept.
function surveyHtml({ mode = 'js', layout = 'fullscreen', variant = '', script = true, declare = null, responseId = 'R_mockResponse1' }) {
  let snippet = fs.readFileSync(path.join(ROOT, 'docs', 'qualtrics-embed.js'), 'utf8')
    .replace(/studyPage: '[^']*'/, `studyPage: '${BASE}study.html'`).replace(/studyId: '[^']*'/, `studyId: '${STUDY_ID}'`)
    .replace(/layout: '[^']*'/, `layout: '${layout}'`)
    .replace('${e://Field/rs_variant}', variant).replace('${e://Field/ResponseID}', responseId); // Qualtrics pipes these in
  const names = declare || M.fieldNames(study);
  const declared = mode === 'js' ? names.map(n => `__js_${n}`) : names;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock survey</title>
<style>body{font:16px system-ui;margin:0;padding:20px}#Buttons{margin-top:20px}</style></head><body>
<div id="Questions"><div id="QID1" class="QuestionOuter"><div class="QuestionText">Please complete the activity.</div></div></div>
<div id="Buttons"><button id="PreviousButton" type="button">←</button> <button id="NextButton" type="button">→</button></div>
<script>
window.__ed = {}; window.__next = 0; window.__got = [];
const DECLARED = new Set(${JSON.stringify(declared)}), MODE = ${JSON.stringify(mode)};
const q = { getQuestionContainer: () => document.getElementById('QID1'),
  hideNextButton() { NextButton.hidden = true; }, showNextButton() { NextButton.hidden = false; }, hidePreviousButton() { PreviousButton.hidden = true; },
  clickNextButton() { window.__next++; } };
window.addEventListener('message', e => { if (e.data && e.data.ns === 'RS_QX') window.__got.push(e.data.type); });
window.Qualtrics = { SurveyEngine: {
  addOnReady(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fn.call(q)); else fn.call(q); },
  addOnload(fn) { this.addOnReady(fn); }, addOnUnload() {},
  setJSEmbeddedData(n, v) { if (MODE !== 'js') throw new Error('not in this layout'); if (DECLARED.has('__js_' + n)) __ed['__js_' + n] = String(v); },
  setEmbeddedData(n, v) { if (MODE !== 'classic') return; if (DECLARED.has(n)) __ed[n] = String(v); } } };
</script>
${script ? `<script>${snippet}</script>` : `<iframe title="Research activity" src="${BASE}study.html?study=${STUDY_ID}&embed=qualtrics" style="width:100%;height:80vh;border:0"></iframe>`}
</body></html>`;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.md': 'text/markdown' };
async function newContext(browser, group, { viewport, survey } = {}) {
  const mobile = viewport && viewport.width < 500;
  const ctx = await browser.newContext({ viewport: viewport || { width: 1360, height: 900 }, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.route(HOSTED + '**', route => {
    let rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(new URL(HOSTED).pathname.length));
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(LOCAL, rel);
    if (!file.startsWith(LOCAL) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await serveStudio(ctx);
  await ctx.route(SURVEY + '**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: surveyHtml(survey || {}) }));
  const errors = [];
  ctx.on('page', p => {
    p.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    p.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  });
  return { ctx, done: async () => { eq(group, 'no browser errors', errors, []); await ctx.close(); } };
}

// ---------- driving Research Studio inside the survey ----------
const rsFrame = page => page.frames().find(f => /study\.html/.test(f.url()));
async function waitRs(page) { await page.waitForFunction(() => !!document.querySelector('iframe[title="Research activity"]')); for (let i = 0; i < 100 && !rsFrame(page); i++) await page.waitForTimeout(50); const rs = rsFrame(page); await rs.waitForLoadState(); return rs; }
async function rerender(rs, action) {
  await rs.evaluate(() => document.querySelector('#participantMain').firstElementChild?.setAttribute('data-e2e-old', '1'));
  await action();
  await rs.waitForFunction(() => !document.querySelector('#participantMain [data-e2e-old]'), null, { timeout: 15000 });
}
async function fillForm(rs, answers) {
  for (const [name, value] of Object.entries(answers)) {
    const loc = rs.locator(`#questionForm [name="${name}"]`).first();
    const kind = await loc.evaluate(el => el.type || el.tagName.toLowerCase());
    if (kind === 'radio') await rs.locator(`#questionForm label.choice:has(input[name="${name}"][value="${value}"])`).click();
    else await loc.fill(value);
  }
  await rerender(rs, () => rs.click('#questionForm button[type=submit]'));
}
async function begin(rs) {
  await rs.waitForSelector('#startStudy', { timeout: 15000 });
  if (await rs.$('#consentCheck')) await rs.check('#consentCheck');
  await rerender(rs, () => rs.click('#startStudy'));
  await fillForm(rs, { 'iola-use': 'No, never' });
}
const click = (f, id) => f.locator(`[data-ut-id="${id}"]`).first().click();
const RIGHT = {
  'iola-current': {
    'one-time-payment': async f => { await click(f, 'home-make-payment'); await f.locator('#ptype').selectOption('payTowardsBalance'); await f.locator('#year').selectOption('2024'); await f.locator('#amount').fill('200.00'); await click(f, 'pay-continue-1'); await click(f, 'pay-continue-2'); await f.locator('#authorize').check(); await click(f, 'pay-submit'); await f.locator('[data-ut-id="pay-done"]').waitFor(); },
    'find-oic': async f => { await click(f, 'nav-payments'); await click(f, 'menu-payment-options'); await click(f, 'options-oic'); await f.getByRole('heading', { name: /offer in compromise/i }).first().waitFor(); },
    'respond-to-notice': async f => { await click(f, 'nav-notices'); await click(f, 'menu-notices'); await click(f, 'notices-view-cp2000'); await click(f, 'cp2000-respond'); await f.locator('[data-ut-id="respond-agree"]').check(); await click(f, 'respond-continue'); await click(f, 'respond-submit'); await f.locator('[data-ut-id="respond-done"]').waitFor(); },
    'upload-documents': async f => { await click(f, 'nav-notices'); await click(f, 'menu-notices'); await click(f, 'notices-view-cp2000'); await click(f, 'cp2000-dut-link'); await f.locator('#dutNotice').selectOption('CP2000'); await f.locator('#dutYear').selectOption('2024'); await click(f, 'dut-continue'); await click(f, 'dut-choose-files'); for (const id of ['f1099', 'fstmt']) await f.locator(`[data-ut-id="picker-${id}"]`).check(); await click(f, 'picker-add'); await click(f, 'dut-submit'); await f.locator('[data-ut-id="dut-done"]').waitFor(); }
  },
  'iola-new': {
    'one-time-payment': async f => { await click(f, 'home-pay-now'); await click(f, 'paysheet-amount'); await f.locator('#amt').fill('200'); await click(f, 'paysheet-amount-done'); await click(f, 'paysheet-pay-button'); await click(f, 'confirm-yes'); await f.locator('[data-ut-id="paysheet-done"]').waitFor(); },
    'find-oic': async f => { await click(f, 'tab-pay'); await click(f, 'pay-over-time'); await click(f, 'options-oic'); await f.getByRole('heading', { name: /offer in compromise/i }).first().waitFor(); },
    'respond-to-notice': async f => { await click(f, 'tab-notices'); await click(f, 'notices-cp2000'); await click(f, 'cp2000-respond'); await f.locator('[data-ut-id="respond-agree"]').check(); await click(f, 'respond-send'); await click(f, 'confirm-yes'); await f.locator('[data-ut-id="respond-done"]').waitFor(); },
    'upload-documents': async f => { await click(f, 'home-alert-cp2000'); await click(f, 'cp2000-upload'); await f.locator('#office').selectOption('Ogden, UT'); await click(f, 'upload-select-file'); for (const id of ['f1099', 'fstmt']) await f.locator(`[data-ut-id="picker-${id}"]`).check(); await click(f, 'picker-add'); await click(f, 'upload-submit'); await click(f, 'confirm-yes'); await f.locator('[data-ut-id="upload-done"]').waitFor(); }
  }
};
async function doTask(page, rs, i, { phone } = {}) {
  await rs.waitForSelector('#prototypeFrame');
  const connected = await rs.waitForSelector('#bridgeIndicator.connected', { timeout: 12000 }).then(() => true, () => false);
  const src = await rs.getAttribute('#prototypeFrame', 'src');
  const v = Object.keys(URL_OF).find(k => src === URL_OF[k]);
  const f = rs.frameLocator('#prototypeFrame'); await f.locator('#app').first().waitFor();
  if (phone) await rs.locator('#prototypeFrame').evaluate(el => el.scrollIntoView({ block: 'end' }));
  await RIGHT[v][TASKS[i]](f);
  await page.waitForTimeout(250);
  await rerender(rs, () => rs.click('#finishTask'));
  await rs.locator('.reflection-choice label:has(input[value="completed"])').click();
  await rerender(rs, () => rs.click('#reflectionForm button[type=submit]'));
  await fillForm(rs, { [`${TASKS[i]}-ease`]: '5', [`${TASKS[i]}-issue`]: `Synthetic note for ${TASKS[i]}, with "quotes"` });
  return { v, connected };
}
async function finish(rs) { await fillForm(rs, { 'overall-ease': '5', confidence: '4' }); }
const stored = page => page.evaluate(() => ({ ed: window.__ed, next: window.__next, got: window.__got, overlay: !!document.querySelector('iframe[title="Research activity"]'), nextHidden: document.getElementById('NextButton').hidden }));
const bare = ed => Object.fromEntries(Object.entries(ed).map(([k, v]) => [k.replace(/^__js_/, ''), v]));

// ---------- scenarios ----------
const scenarios = {
  // Full study inside the survey, newer layout, full screen, design from the survey's randomizer.
  async full(browser) {
    for (const [v, viewport] of [['iola-new', null], ['iola-current', null], ['iola-current', { width: 1024, height: 700 }]]) {
      const g = `full study in the survey · ${v}${viewport ? ' · small laptop window' : ''}`;
      const c = await newContext(browser, g, { viewport, survey: { mode: 'js', layout: 'fullscreen', variant: v } });
      const page = await c.ctx.newPage(); await page.goto(SURVEY);
      const rs = await waitRs(page);
      const box = await page.locator('iframe[title="Research activity"]').boundingBox();
      check(g, 'Research Studio covers the survey page', box && box.x === 0 && box.y === 0 && Math.abs(box.width - (viewport?.width || 1360)) < 2, box);
      check(g, 'survey Next button hidden while it runs', (await stored(page)).nextHidden, 'visible');
      if (!viewport) eq(g, 'survey page behind is inert while it runs (keyboard stays in the activity)', await page.evaluate(() => [document.getElementById('Questions').inert, document.getElementById('Buttons').inert]), [true, true]);
      await page.waitForTimeout(500);
      eq(g, 'focus moves into Research Studio', await page.evaluate(() => document.activeElement?.title), 'Research activity');
      await begin(rs);
      check(g, 'header says answers go to the survey', /^(Answers are saved to the survey|Saved to the survey)$/.test((await rs.textContent('#saveStatus')).trim()), await rs.textContent('#saveStatus'));
      const designs = [];
      for (let i = 0; i < TASKS.length; i++) {
        const r = await doTask(page, rs, i); designs.push(r.v);
        check(g, `${TASKS[i]}: tracker connected inside the survey`, r.connected);
        if (i === 0) { await page.waitForTimeout(400); const s = bare((await stored(page)).ed); eq(g, 'saved after task 1 (partial results)', [s.rs_status, s.rs_ab1_success, s.rs_ab2_task || ''], ['in_progress', 'received', '']); }
      }
      eq(g, 'same design in every task, from the randomizer', [...new Set(designs)], [v]);
      const leftovers = await rs.evaluate(() => ({ local: Object.keys(localStorage).filter(k => /utp/.test(k)), session: Object.keys(sessionStorage).filter(k => /utp/.test(k)) }));
      eq(g, 'nothing kept in the browser\'s long-term storage (only this tab\'s session storage)', leftovers.local, []);
      await finish(rs);
      await page.waitForFunction(() => window.__next > 0, null, { timeout: 15000 });
      const s = await stored(page);
      check(g, 'when finished, the survey moves on by itself', s.next === 1 && !s.overlay && !s.nextHidden, s);
      eq(g, 'survey page usable again afterwards', await page.evaluate(() => [document.getElementById('Questions').inert, document.getElementById('Buttons').inert]), [false, false]);
      eq(g, 'the survey received hello, saves and done, in that order', [s.got[0], s.got.includes('save'), s.got.at(-1)], ['hello', true, 'done']);
      const ed = bare(s.ed);
      check(g, 'only declared rs_ fields were written', Object.keys(s.ed).every(k => /^__js_rs_/.test(k)), Object.keys(s.ed));
      eq(g, 'summary fields', [ed.rs_embed_ok, ed.rs_status, ed.rs_variant, ed.rs_pid, ...TASKS.map((_, k) => ed[`rs_ab${k + 1}_success`])], ['yes', 'complete', v, 'R_mockResponse1', ...TASKS.map(() => 'received')]);
      check(g, 'time to success recorded for every task', TASKS.every((_, k) => /^\d+$/.test(ed[`rs_ab${k + 1}_tts`])), TASKS.map((_, k) => ed[`rs_ab${k + 1}_tts`]));
      eq(g, 'answers stored as their own fields', [ed.rs_q_iola_use, ed.rs_q_one_time_payment_ease, ed.rs_q_upload_documents_issue, ed.rs_q_confidence], ['No, never', '5', 'Synthetic note for upload-documents, with "quotes"', '4']);
      check(g, 'every value fits in an Excel cell', Object.values(s.ed).every(x => x.length <= 32767), Math.max(...Object.values(s.ed).map(x => x.length)));
      const back = await M.sessionFromRecord(s.ed);
      check(g, 'full session reads back and matches its checksum', back.events && !back.problem, back.problem);
      if (back.events) {
        const ends = back.events.filter(e => e.kind === 'task_ended');
        eq(g, 'every task outcome is in the session data', ends.map(e => [e.task_id, e.payload.result.success_signal_status, e.payload.variant_id]), TASKS.map(t => [t, 'received', v]));
        check(g, 'click and screen records are in the session data', back.events.filter(e => e.kind === 'interaction_batch').flatMap(e => e.payload.items).filter(x => x.type === 'click' && x.target).length >= 12, 'few clicks');
        eq(g, 'the session in the data is the one in rs_session', back.session_id, ed.rs_session);
      }
      fs.writeFileSync(path.join(OUT, `export-${v}${viewport ? '-small' : ''}.json`), JSON.stringify({ ResponseId: 'R_mockResponse1', Status: '0', Finished: '1', DistributionChannel: 'anonymous', ...s.ed }));
      await page.close(); await c.done();
    }
  },
  // Computers-only study opened on a phone inside the survey: nothing recorded, the survey is told and moves on.
  async phoneInSurvey(browser) {
    const g = 'phone inside the survey (computers-only study)';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await serveStudio(ctx);
    await ctx.route(SURVEY + '**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: surveyHtml({ mode: 'js', variant: 'iola-new' }) }));
    const page = await ctx.newPage(); await page.goto(SURVEY);
    const rs = await waitRs(page);
    await rs.waitForSelector('h1:has-text("Please use a laptop or desktop computer")', { timeout: 15000 });
    await page.waitForFunction(() => window.__next > 0, null, { timeout: 15000 });
    const s = await stored(page), ed = bare(s.ed);
    eq(g, 'survey told: device not supported, kind recorded', [ed.rs_status, ed.rs_device], ['device_not_supported', 'phone']);
    eq(g, 'no session or results sent', [ed.rs_session, ed.rs_data_parts, ed.rs_ab1_success], [undefined, undefined, undefined]);
    check(g, 'survey moved on (its branch can end the survey there)', s.next === 1, s.next);
    await ctx.close();
    // ...and the import leaves them out rather than counting a drop-out.
    const MI = await import(pathToFileURL(path.join(ROOT, 'src', 'qualtrics-import.js')).href);
    const recs = [{ ResponseId: 'R_phone', Status: '0', Finished: '0', DistributionChannel: 'anonymous', rs_variant: 'iola-new', ...s.ed }];
    const full = JSON.parse(fs.readFileSync(path.join(OUT, fs.readdirSync(OUT).find(f => /^export-iola-new\.json$/.test(f)) || 'missing'), 'utf8'));
    recs.push(full, { ResponseId: 'R_tablet', Status: '0', Finished: '0', DistributionChannel: 'anonymous', rs_device_class: 'tablet' });
    await MI.expandEmbedded(recs);
    const r = MI.eventsFromQualtrics(study, recs);
    eq(g, 'import: phone and tablet left out, not drop-outs', [r.summary.responses, r.summary.dropouts], [1, 0]);
    check(g, 'import says how many were left out', r.warnings.some(w => /2 participants on a phone or tablet/.test(w)), r.warnings);
  },
  // Older layout, inline in the question, no design from the survey (Research Studio picks).
  async classicInline(browser) {
    const g = 'older layout, inline, Research Studio picks the design';
    const c = await newContext(browser, g, { survey: { mode: 'classic', layout: 'inline', variant: '' } });
    const page = await c.ctx.newPage(); await page.goto(SURVEY);
    const rs = await waitRs(page);
    const inQuestion = await page.evaluate(() => !!document.querySelector('#QID1 iframe[title="Research activity"]'));
    check(g, 'shown inside the question', inQuestion, 'not in question');
    await begin(rs);
    for (let i = 0; i < TASKS.length; i++) await doTask(page, rs, i);
    await finish(rs);
    await page.waitForFunction(() => window.__next > 0, null, { timeout: 15000 });
    const s = await stored(page);
    check(g, 'fields stored without the __js_ prefix', Object.keys(s.ed).length > 20 && Object.keys(s.ed).every(k => /^rs_/.test(k)), Object.keys(s.ed).slice(0, 5));
    check(g, 'a design was assigned', Object.keys(URL_OF).includes(s.ed.rs_variant), s.ed.rs_variant);
    check(g, 'the activity stays on the page after finishing (inline)', s.overlay, 'removed');
    check(g, 'full session reads back', !(await M.sessionFromRecord(s.ed)).problem, 'problem');
    await page.close(); await c.done();
  },
  // The survey page reloads in the middle: Research Studio continues and the final data has everything.
  // A new survey response in the same tab (a restarted preview, or a second response without the
  // resume cookie) must start a fresh session, not resume the earlier response's one (v0.3.16).
  async newResponse(browser) {
    const g = 'new survey response in the same tab starts fresh';
    const c = await newContext(browser, g, { survey: { mode: 'js', variant: 'iola-new' } });
    const page = await c.ctx.newPage(); await page.goto(SURVEY);
    let rs = await waitRs(page);
    await begin(rs); await doTask(page, rs, 0);
    await c.ctx.unroute(SURVEY + '**');
    await c.ctx.route(SURVEY + '**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: surveyHtml({ mode: 'js', variant: 'iola-current', responseId: 'R_mockResponse2' }) }));
    await page.goto(SURVEY); rs = await waitRs(page);
    await rs.waitForSelector('#startStudy', { timeout: 15000 });
    check(g, 'the second response sees the welcome page, not the first response\'s task', !(await rs.$('#prototypeFrame')), 'resumed into a task');
    check(g, 'no "welcome back" message', !/Welcome back/.test(await rs.evaluate(() => document.body.innerText)), 'welcome back shown');
    // Back to the first response (Qualtrics resumes it by cookie): its session continues.
    await c.ctx.unroute(SURVEY + '**');
    await c.ctx.route(SURVEY + '**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: surveyHtml({ mode: 'js', variant: 'iola-new' }) }));
    await page.goto(SURVEY); rs = await waitRs(page);
    await rs.waitForSelector('#prototypeFrame', { timeout: 15000 });
    check(g, 'the first response still resumes its own session', true);
    await page.close(); await c.done();
  },
  async reload(browser) {
    const g = 'survey page reloaded mid-study';
    const c = await newContext(browser, g, { survey: { mode: 'js', variant: 'iola-new' } });
    const page = await c.ctx.newPage(); await page.goto(SURVEY);
    let rs = await waitRs(page);
    await begin(rs); await doTask(page, rs, 0);
    await page.reload(); rs = await waitRs(page);
    await rs.waitForSelector('#prototypeFrame', { timeout: 15000 });
    for (let i = 1; i < TASKS.length; i++) await doTask(page, rs, i);
    await finish(rs);
    await page.waitForFunction(() => window.__next > 0, null, { timeout: 15000 });
    const back = await M.sessionFromRecord((await stored(page)).ed);
    eq(g, 'all four outcomes, including the one before the reload', (back.events || []).filter(e => e.kind === 'task_ended').map(e => e.task_id), TASKS);
    check(g, 'the reload is recorded', (back.events || []).some(e => e.kind === 'session_resumed'), 'no session_resumed');
    eq(g, 'pre-questions from before the reload kept', bare((await stored(page)).ed).rs_q_iola_use, 'No, never');
    await page.close(); await c.done();
  },
  // A survey page without the script, a page that isn't on the list, and the link opened directly.
  async refusals(browser) {
    const g = 'pages that must not get results';
    const c = await newContext(browser, g, { survey: { mode: 'js', script: false } });
    await c.ctx.route(EVIL + '**', r => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>x</title><script>window.got=[];addEventListener('message',e=>{if(e.data&&e.data.ns==='RS_QX'){got.push(e.data.type);if(e.data.type==='hello')e.source.postMessage({ns:'RS_QX',v:1,type:'hello-ack'},e.origin);}})</script><iframe title="Research activity" src="${BASE}study.html?study=${STUDY_ID}&embed=qualtrics" style="width:100%;height:600px"></iframe>` }));
    let page = await c.ctx.newPage(); await page.goto(SURVEY);
    let rs = await waitRs(page);
    await rs.waitForSelector('h1:has-text("can\'t receive")', { timeout: 15000 });
    check(g, 'survey without the script: participant told not to continue, no Begin button', !(await rs.$('#startStudy')), 'Begin shown');
    await page.close();
    page = await c.ctx.newPage(); await page.goto(EVIL);
    rs = await waitRs(page);
    await rs.waitForSelector('h1:has-text("can\'t receive")', { timeout: 15000 });
    eq(g, 'unlisted site that answers hello still gets nothing but hello', [...new Set(await page.evaluate(() => window.got))], ['hello']);
    await page.close();
    // Another Qualtrics account: refused now that embedHosts lists only the IRS account (v0.3.14).
    await c.ctx.route(OTHER_QX + '**', r => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>x</title><script>window.got=[];addEventListener('message',e=>{if(e.data&&e.data.ns==='RS_QX'){got.push(e.data.type);if(e.data.type==='hello')e.source.postMessage({ns:'RS_QX',v:1,type:'hello-ack'},e.origin);}})</script><iframe title="Research activity" src="${BASE}study.html?study=${STUDY_ID}&embed=qualtrics" style="width:100%;height:600px"></iframe>` }));
    page = await c.ctx.newPage(); await page.goto(OTHER_QX);
    rs = await waitRs(page);
    await rs.waitForSelector('h1:has-text("can\'t receive")', { timeout: 15000 });
    eq(g, 'a different Qualtrics account gets nothing but hello', [...new Set(await page.evaluate(() => window.got))], ['hello']);
    await page.close();
    page = await c.ctx.newPage(); await page.goto(`${BASE}study.html?study=${STUDY_ID}&embed=qualtrics`);
    await page.waitForSelector('h1:has-text("Open this activity from the survey")');
    check(g, 'link opened outside a survey: sent back to the survey', !(await page.$('#startStudy')), 'Begin shown');
    await page.close(); await c.done();
  },
  // The survey script only writes rs_ fields, whatever it is sent.
  async fieldGuard(browser) {
    const g = 'survey script writes only rs_ fields';
    const c = await newContext(browser, g, { survey: { mode: 'js', variant: 'iola-new', declare: [...M.fieldNames(study), 'Q1', 'rs_extra'] } });
    const page = await c.ctx.newPage(); await page.goto(SURVEY);
    const rs = await waitRs(page);
    await rs.waitForSelector('#startStudy');
    await rs.evaluate(() => window.parent.postMessage({ ns: 'RS_QX', v: 1, type: 'save', seq: 50, fields: { Q1: 'overwritten', 'rs_extra': 'ok', 'rs_bad name': 'x' } }, 'https://irsresearch.gov1.qualtrics.com'));
    await page.waitForTimeout(300);
    const ed = (await stored(page)).ed;
    eq(g, 'other survey fields untouched, rs_ field written', [ed.__js_Q1, ed.__js_rs_extra], [undefined, 'ok']);
    await page.close(); await c.done();
  },
  // The setup page gives the script and field list a researcher pastes into Qualtrics.
  async setupPage(browser) {
    const g = 'Qualtrics setup page';
    const c = await newContext(browser, g, { viewport: { width: 1280, height: 900 } });
    const page = await c.ctx.newPage();
    await page.goto(`${BASE}qualtrics-embed.html?study=${STUDY_ID}`);
    await page.waitForFunction(() => /rs_session/.test(document.querySelector('#fields').value));
    const names = (await page.inputValue('#fields')).split('\n');
    eq(g, 'field list is exactly what Research Studio sends', names, M.fieldNames(study));
    await page.click('#namesJs');
    check(g, '__js_ names on request', (await page.inputValue('#fields')).split('\n').every(n => n.startsWith('__js_rs_')), 'not prefixed');
    const script = await page.inputValue('#script');
    check(g, 'script filled in for this study and site', script.includes(`studyPage: '${BASE}study.html'`) && script.includes(`studyId: '${STUDY_ID}'`) && script.includes("layout: 'fullscreen'"), script.slice(0, 400));
    await page.selectOption('#layout', 'inline'); await page.uncheck('#advance');
    const s2 = await page.inputValue('#script');
    check(g, 'layout and auto-advance choices reach the script', s2.includes("layout: 'inline'") && s2.includes('autoAdvance: false'), 'unchanged');
    check(g, 'variant IDs listed for the randomizer', /iola-current, iola-new/.test(await page.textContent('#variantIds')), await page.textContent('#variantIds'));
    await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [ROOT] }), 'utf8') });
    const v = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map(x => `${x.id}: ${x.nodes.length}`));
    eq(g, 'no WCAG 2.1 A/AA violations', v, []);
    await page.setViewportSize({ width: 360, height: 800 });
    eq(g, 'no sideways scroll at 360px', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await page.close(); await c.done();
  },
  // The stored fields, exported, give the same results in Research Studio's dashboard.
  async importBack(browser) {
    const g = 'import the survey export into Research Studio';
    const recs = fs.readdirSync(OUT).filter(f => /^export-.*\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
    if (!recs.length) { check(g, 'exports from the full-study runs exist', false, 'run the full scenario first'); return; }
    // Distinct response IDs, as in a real export.
    recs.forEach((r, i) => { r.ResponseId = `R_mock${i}`; r.rs_pid = r.__js_rs_pid = `R_mock${i}`; });
    const header = [...new Set(recs.flatMap(r => Object.keys(r)))];
    const csvCell = v => /[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
    const csv = [header.join(','), header.map(h => csvCell(h)).join(','), header.map(h => csvCell(`{"ImportId":"${h}"}`)).join(','), ...recs.map(r => header.map(h => csvCell(r[h] ?? '')).join(','))].join('\r\n');
    const file = path.join(OUT, 'qualtrics-export-SYNTHETIC.csv'); fs.writeFileSync(file, csv);
    const c = await newContext(browser, g);
    const page = await c.ctx.newPage();
    await page.goto(BASE + 'index.html');
    await page.waitForFunction(() => document.querySelectorAll('#resultsStudy option').length > 0);
    await page.click('.nav-option[data-tab="results"]');
    await page.selectOption('#resultsStudy', STUDY_ID);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#importQualtrics')]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => /Showing imported Qualtrics data/.test(document.querySelector('#resultsStatus')?.textContent || ''), null, { timeout: 15000 });
    const status = await page.textContent('#resultsStatus');
    check(g, 'every response imported with its full session record', new RegExp(`${recs.length} responses \\(${recs.length} with the full session record\\)`).test(status), status);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportClicks')]);
    const clicksCsv = fs.readFileSync(await dl.path(), 'utf8');
    check(g, 'click records available for export after import', clicksCsv.split('\n').length > 30 && /home-pay-now|home-make-payment/.test(clicksCsv), clicksCsv.slice(0, 200));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#exportAnswers')]);
    check(g, 'answers available for export after import', /upload-documents-issue/.test(fs.readFileSync(await dl2.path(), 'utf8')), 'missing');
    await page.close(); await c.done();
  }
};

(async () => {
  M = { ...(await import(pathToFileURL(path.join(ROOT, 'src', 'qualtrics-embed.js')).href)) };
  const browser = await chromium.launch();
  const t0 = Date.now();
  try {
    for (const [name, run] of Object.entries(scenarios)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      try { await run(browser); } catch (e) { check(name, 'scenario ran to completion', false, (e.stack || e.message).split('\n').slice(0, 4).join(' | ')); }
    }
  } finally { await browser.close(); }
  const failed = checks.filter(c => !c.pass);
  fs.writeFileSync(path.join(OUT, 'embed-checks.json'), JSON.stringify(checks, null, 2));
  console.log(`Qualtrics embed: ${checks.length - failed.length}/${checks.length} checks passed in ${Math.round((Date.now() - t0) / 1000)}s`);
  for (const c of failed) console.log(`  FAIL [${c.group}] ${c.name}: ${c.detail}`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
