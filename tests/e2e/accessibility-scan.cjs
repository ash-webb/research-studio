#!/usr/bin/env node
/* Automated accessibility scan (axe-core, WCAG 2.2 A/AA + best practice) of every
 * participant and researcher screen in Research Studio, at desktop and phone width.
 * Usage: npm run test:a11y   (needs Playwright + axe-core: npm install --no-save playwright axe-core)
 * Env:   E2E_PORT, E2E_OUT, A11Y_STRICT=0 to report without failing.
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const cs = require('./cardsort-helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 8125);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.E2E_OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
let AXE;
try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); }
catch { console.error('axe-core is not installed. Run: npm install --no-save axe-core'); process.exit(2); }
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + 'index.html')).ok) return proc; } catch {} await new Promise(r => setTimeout(r, 100)); }
  proc.kill(); throw new Error('server did not start');
}

const results = [];
async function scan(p, screen, viewportLabel) {
  await p.waitForTimeout(150);
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async tags => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return res.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target.join(' '), summary: n.failureSummary.split('\n').slice(0, 3).join(' ') })) }));
  }, TAGS);
  // WCAG 1.4.10 Reflow: no sideways scrolling of the page at narrow widths (400% zoom ≈ 320px).
  const [sw, w] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (sw > w + 1) r.push({ id: 'reflow-horizontal-scroll', impact: 'serious', help: 'Content must reflow without sideways page scrolling (WCAG 1.4.10)', nodes: [{ target: 'html', summary: `page is ${sw}px wide in a ${w}px window` }] });
  results.push({ screen, viewport: viewportLabel, violations: r });
}

async function rerender(p, action) {
  await p.evaluate(() => document.querySelector('#participantMain')?.firstElementChild?.setAttribute('data-e2e-old', '1'));
  await action();
  await p.waitForFunction(() => !document.querySelector('#participantMain [data-e2e-old]'), null, { timeout: 8000 });
}
async function begin(p, id) {
  await p.evaluate(() => { try { sessionStorage.clear(); } catch {} }).catch(() => {}); // fresh session in this tab
  await p.goto(`${BASE}study.html?study=${id}`);
  await p.waitForSelector('#consentCheck');
}
async function consent(p) { await p.check('#consentCheck'); await rerender(p, () => p.click('#startStudy')); }

async function participantScreens(p, vp) {
  await begin(p, 'demo-portal'); await scan(p, 'Consent page', vp);
  await consent(p); await scan(p, 'Pre-study questions', vp);
  await p.locator('label.choice:has(input[value="Weekly"])').click();
  await rerender(p, () => p.click('#questionForm button[type=submit]'));
  await p.waitForSelector('#bridgeIndicator.connected', { timeout: 8000 }).catch(() => {});
  await scan(p, 'Prototype task (with embedded prototype)', vp);
  await p.reload(); await p.waitForSelector('#resumeNotice'); await p.waitForTimeout(300);
  await scan(p, 'Prototype task after a reload (resume notice)', vp);
  await rerender(p, () => p.click('#finishTask')); await scan(p, 'Prototype "How did that task go?"', vp);
  await p.locator('.reflection-choice label:has(input[value="completed"])').click();
  await rerender(p, () => p.click('#reflectionForm button[type=submit]')); await scan(p, 'Follow-up questions (scales + text)', vp);

  await begin(p, 'demo-ab-implementation'); await consent(p);
  await p.waitForSelector('#bridgeIndicator.connected', { timeout: 8000 }).catch(() => {});
  await scan(p, 'A/B task (assigned design)', vp);

  await begin(p, 'demo-mixed'); await consent(p); await scan(p, 'Card sort (empty)', vp);
  await cs.dragCard(p, 'payments', '__new__');
  await scan(p, 'Card sort (unnamed group after a drop)', vp);
  await p.click('[data-card="refund"]');
  await scan(p, 'Card sort ("Move to" list open)', vp);
  await p.keyboard.press('Escape');
  await cs.nameGroup(p, 'created-1', 'Money');
  await scan(p, 'Card sort (group created, card placed)', vp);
  for (const c of await p.$$eval('.sort-unsorted [data-card]', s => s.map(x => x.dataset.card))) await cs.moveViaMenu(p, c, 'created-1');
  await rerender(p, () => p.click('#submitSort')); await rerender(p, () => p.click('#questionForm button[type=submit]'));
  await scan(p, 'Tree test (top level)', vp);
  await rerender(p, () => p.click('[data-tree-node="records"]')); await scan(p, 'Tree test (inside a section)', vp);
  await rerender(p, () => p.click('[data-tree-node="tax-transcripts"]'));
  await rerender(p, () => p.click('#selectDestination'));
  await p.locator('label.choice:has(input[value="4"])').click();
  await rerender(p, () => p.click('#questionForm button[type=submit]'));
  await p.waitForFunction(() => document.querySelector('#firstClickImage')?.complete);
  await scan(p, 'First-click test (before click)', vp);
  const box = await p.locator('#firstClickImage').boundingBox();
  await rerender(p, () => p.locator('#firstClickImage').click({ position: { x: box.width * .1, y: box.height * .4 } }));
  await scan(p, 'First-click test (after click)', vp);
  await rerender(p, () => p.click('#submitFirstClick')); await rerender(p, () => p.click('#questionForm button[type=submit]'));
  await scan(p, 'Preference test', vp);
  await p.locator('.preference-option:has(input[value="tiles"])').click();
  await rerender(p, () => p.click('#submitPreference')); await rerender(p, () => p.click('#questionForm button[type=submit]'));
  await scan(p, 'Survey', vp);
  await p.locator('label.choice:has(input[value="Weekly"])').click();
  await p.click('#questionForm button[type=submit]'); await p.waitForTimeout(150);
  await scan(p, 'Survey (validation error shown)', vp);
  await p.locator('label.choice:has(input[value="Find records"])').click();
  await rerender(p, () => p.click('#questionForm button[type=submit]'));
  await p.waitForSelector('.done-card'); await scan(p, 'Completion page', vp);
  await p.reload(); await p.waitForSelector('#newSession'); await scan(p, 'Already completed (reload after finishing)', vp);
  await p.goto(`${BASE}study.html?study=does-not-exist`); await p.waitForSelector('h1'); await scan(p, 'Study unavailable page', vp);
}

async function researcherScreens(p, vp) {
  await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await scan(p, 'Builder (A/B example loaded)', vp);
  await p.selectOption('#exampleStudy', 'demo-mixed'); await p.click('#loadExample');
  await p.waitForFunction(() => document.querySelector('#studyId').value === 'demo-mixed');
  await scan(p, 'Builder (multi-method example: all method editors)', vp);
  await p.selectOption('#exampleStudy', 'demo-portal'); await p.click('#loadExample');
  await p.waitForFunction(() => document.querySelector('#studyId').value === 'demo-portal');
  await scan(p, 'Builder (prototype example, pre/post questions)', vp);
  await p.click('.nav-option[data-tab="results"]');
  await p.selectOption('#resultsStudy', 'demo-mixed'); await p.click('#refreshResults');
  await p.waitForFunction(() => /collected event records/.test(document.querySelector('#resultsStatus').textContent));
  await scan(p, 'Results (multi-method, with data)', vp);
  await p.selectOption('#resultsStudy', 'demo-ab-implementation'); await p.click('#refreshResults'); await p.waitForTimeout(300);
  await scan(p, 'Results (A/B, with data)', vp);
  await p.selectOption('#resultsStudy', 'demo-portal'); await p.click('#refreshResults'); await p.waitForTimeout(300);
  await scan(p, 'Results (prototype, with click explorer)', vp);
  await p.click('.nav-option[data-tab="setup"]'); await scan(p, 'Setup & security', vp);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const [vp, viewport] of [['desktop 1360px', { width: 1360, height: 900 }], ['phone 390px', { width: 390, height: 844 }], ['400% zoom (320px)', { width: 320, height: 640 }]]) {
      const ctx = await browser.newContext({ viewport });
      const p = await ctx.newPage();
      await participantScreens(p, vp);
      // A/B session so the A/B results screen has data.
      await begin(p, 'demo-ab-implementation'); await consent(p);
      await rerender(p, () => p.click('#finishTask'));
      await p.locator('.reflection-choice label:has(input[value="unable"])').click();
      await rerender(p, () => p.click('#reflectionForm button[type=submit]'));
      await researcherScreens(p, vp);
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
  // Summarise by rule, merged across screens.
  const byRule = new Map();
  for (const r of results) for (const v of r.violations) {
    const k = v.id; if (!byRule.has(k)) byRule.set(k, { id: v.id, impact: v.impact, help: v.help, screens: new Set(), nodes: new Map() });
    const e = byRule.get(k); e.screens.add(`${r.screen} [${r.viewport}]`);
    for (const n of v.nodes) if (!e.nodes.has(n.target)) e.nodes.set(n.target, n.summary);
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const rules = [...byRule.values()].sort((a, b) => order[a.impact] - order[b.impact]);
  fs.writeFileSync(path.join(OUT, 'a11y-report.json'), JSON.stringify({ ran_at: new Date().toISOString(), screens: results.length, results }, null, 2));
  console.log(`Scanned ${results.length} screen states.`);
  for (const r of rules) {
    console.log(`\n[${r.impact}] ${r.id}: ${r.help}  (${r.screens.size} screen states, ${r.nodes.size} distinct elements)`);
    [...r.nodes.entries()].slice(0, 6).forEach(([t, s]) => console.log(`   - ${t}\n       ${s}`));
    console.log(`   screens: ${[...r.screens].slice(0, 4).join('; ')}${r.screens.size > 4 ? '; …' : ''}`);
  }
  console.log(`\n${rules.length} rule(s) violated.`);
  process.exit(rules.length && process.env.A11Y_STRICT !== '0' ? 1 : 0);
})();
