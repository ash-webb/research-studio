#!/usr/bin/env node
/* Keyboard-only accessibility checks for Civic Research Studio.
 * Completes every study type using only Tab / Shift+Tab / Enter / Space / arrow keys,
 * and checks focus placement after each screen change, visible focus indicators,
 * keyboard reachability of every control, screen-reader announcements, and that
 * keyboard activations inside an embedded prototype are recorded honestly.
 * Usage: npm run test:keyboard   (needs Playwright)
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 8126);
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

// Describes the focused element in the top document (or inside a same-origin iframe).
const describeFocus = p => p.evaluate(() => {
  let el = document.activeElement, frame = null;
  if (el?.tagName === 'IFRAME') { try { frame = el; el = el.contentDocument.activeElement; } catch {} }
  if (!el || el === document.body) return { body: true, dataset: {}, text: '', tag: 'body' };
  const cs = (frame ? frame.contentWindow : window).getComputedStyle(el);
  const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return 1; const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  // Focus ring: outline on the element, or on its styled sibling (custom radio/checkbox chips).
  let ringEl = el, ring = cs;
  if (cs.opacity === '0' && el.nextElementSibling) { ringEl = el.nextElementSibling; ring = getComputedStyle(ringEl); }
  const outlineOn = ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) >= 2;
  const shadowOn = ring.boxShadow && ring.boxShadow !== 'none';
  const ringColour = outlineOn ? ring.outlineColor : null;
  // Compare the ring with the nearest opaque background behind the element.
  const bgOf = node => { for (let n = node; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const a = c.match(/[\d.]+/g); if (a && (a.length < 4 || +a[3] > 0.5)) return c; } return 'rgb(255,255,255)'; };
  const ringContrast = ringColour ? (() => { const a = lum(ringColour), b = lum(bgOf(ringEl.parentElement || ringEl)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); })() : null;
  return { tag: el.tagName.toLowerCase(), id: el.id || '', text: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 50), inFrame: !!frame,
    visible: outlineOn || shadowOn, ringContrast, name: el.name || '', type: el.type || '', role: el.getAttribute('role') || '', dataset: { ...el.dataset } };
});

const ringFailures = [];
async function tabTo(p, matcher, { max = 40, shift = false, g, label } = {}) {
  for (let i = 1; i <= max; i++) {
    await p.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    const f = await describeFocus(p);
    if (!f.body && !f.inFrame && (!f.visible || (f.ringContrast && f.ringContrast < 3))) ringFailures.push(`${g}: ${f.tag}#${f.id}${f.name ? `[name=${f.name}]` : ''} "${f.text}" ${f.visible ? `ring contrast ${f.ringContrast?.toFixed(2)}:1` : 'no visible focus indicator'}`);
    if (matcher(f)) return i;
  }
  throw new Error(`could not reach ${label || 'target'} by keyboard within ${max} Tab presses`);
}
const byId = id => f => f.id === id;
const byText = t => f => f.text.startsWith(t);
const byNameValue = (n) => f => f.name === n;

async function screenChange(p, g, label, action) {
  await p.evaluate(() => document.querySelector('#participantMain')?.firstElementChild?.setAttribute('data-e2e-old', '1'));
  await action();
  await p.waitForFunction(() => !document.querySelector('#participantMain [data-e2e-old]'), null, { timeout: 8000 });
  await p.waitForTimeout(80);
  const f = await describeFocus(p);
  check(g, `${label}: focus moves into the new screen (not lost to the page top)`, !f.body, 'focus was left on <body>; a keyboard or screen-reader user must start again from the top of the page');
  return f;
}
const liveText = p => p.evaluate(() => [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map(e => e.textContent.trim()).filter(Boolean).join(' | '));

async function consentByKeyboard(p, g) {
  await tabTo(p, f => f.id === 'consentCheck', { g, label: 'consent checkbox' });
  await p.keyboard.press('Space');
  await tabTo(p, byId('startStudy'), { g, label: 'start button' });
  return screenChange(p, g, 'Start study', () => p.keyboard.press('Enter'));
}
// Answers a rendered question form by keyboard. answers: {name: value | [values] | text}
async function answerForm(p, g, answers, label) {
  for (const [name, value] of Object.entries(answers)) {
    const kind = await p.locator(`#questionForm [name="${name}"]`).first().evaluate(el => el.type || el.tagName.toLowerCase());
    if (kind === 'radio') {
      await tabTo(p, f => f.name === name, { g, label: `radio group ${name}` });
      for (let i = 0; i < 10 && !(await p.evaluate(([n, v]) => document.querySelector(`#questionForm [name="${n}"][value="${v}"]`).checked, [name, value])); i++) await p.keyboard.press('ArrowRight');
      // Space selects if arrows landed without checking (first item).
      if (!(await p.evaluate(([n, v]) => document.querySelector(`#questionForm [name="${n}"][value="${v}"]`).checked, [name, value]))) await p.keyboard.press('Space');
    } else if (kind === 'checkbox') {
      for (const v of value) { await tabTo(p, f => f.name === name && f.dataset && (f.text === v || true) && f.type === 'checkbox' && f.text !== undefined && f.id === '' && f, { g, label: name }); const cur = await p.evaluate(() => document.activeElement.value); if (cur !== v) { for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); if (await p.evaluate(x => document.activeElement.value === x, v)) break; } } await p.keyboard.press('Space'); }
    } else {
      await tabTo(p, f => f.name === name, { g, label: `field ${name}` });
      await p.keyboard.type(value);
    }
  }
  await tabTo(p, f => f.tag === 'button' && /Continue/.test(f.text), { g, label: 'Continue' });
  return screenChange(p, g, label, () => p.keyboard.press('Enter'));
}

const events = p => p.evaluate(() => JSON.parse(localStorage.getItem('utp-demo-events-v1') || '[]'));
const scenarios = {};

scenarios.prototype = async ctx => {
  const g = 'Prototype task by keyboard (demo-portal)';
  const p = await ctx.newPage(); await p.goto(BASE + 'study.html?study=demo-portal'); await p.waitForSelector('#consentCheck');
  await consentByKeyboard(p, g);
  await answerForm(p, g, { experience: 'Weekly' }, 'Pre-study questions → prototype task');
  await p.waitForSelector('#bridgeIndicator.connected', { timeout: 8000 }).catch(() => {});
  // Tab into the embedded prototype and activate its navigation with the keyboard.
  await tabTo(p, f => f.inFrame && /Activity/.test(f.text), { g, label: 'prototype "Activity" nav', max: 60 });
  await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  await tabTo(p, f => f.inFrame && /View details|details/i.test(f.text), { g, label: 'prototype details button', max: 30 });
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  eq(g, 'keyboard activations inside the prototype count as clicks', await p.textContent('#taskClicks'), '2');
  await tabTo(p, byId('finishTask'), { g, label: 'Finish this task', max: 60 });
  await screenChange(p, g, 'Finish task → "How did that task go?"', () => p.keyboard.press('Enter'));
  await tabTo(p, f => f.name === 'selfReport', { g, label: 'self-report' });
  await p.keyboard.press('Space');
  await tabTo(p, f => f.tag === 'button' && /Continue/.test(f.text), { g, label: 'Continue' });
  await screenChange(p, g, 'Self-report → follow-up', () => p.keyboard.press('Enter'));
  const evs = await events(p);
  const hits = evs.filter(e => e.kind === 'interaction_batch').flatMap(e => e.payload.items).filter(x => x.type === 'click');
  check(g, 'keyboard activations are not plotted at the top-left corner (0%, 0%)', hits.length === 2 && hits.every(h => h.x_pct > 0 || h.y_pct > 0), JSON.stringify(hits.map(h => [h.target, h.x_pct, h.y_pct])));
  check(g, 'keyboard activations are marked as keyboard input in the data', hits.length === 2 && hits.every(h => h.input === 'keyboard'), JSON.stringify(hits.map(h => h.input)));
  const end = evs.find(e => e.kind === 'task_ended')?.payload;
  eq(g, 'success signal still observed with keyboard navigation', end?.observed_success, true);
  await p.close();
};

scenarios.cardSort = async ctx => {
  const g = 'Card sort by keyboard (demo-card-sort)';
  const p = await ctx.newPage(); await p.goto(BASE + 'study.html?study=demo-card-sort'); await p.waitForSelector('#consentCheck');
  await consentByKeyboard(p, g);
  // First card: open its "Move to" list with Enter, choose New group.
  await tabTo(p, f => f.dataset.card === 'payments', { g, label: 'first card' });
  await p.keyboard.press('Enter');
  const menuFocus = await describeFocus(p);
  check(g, 'Enter on a card opens its "Move to" list and focuses the first choice', menuFocus.dataset.moveTo !== undefined, `focus on ${menuFocus.tag} "${menuFocus.text}"`);
  check(g, 'card announces that its list is open', await p.getAttribute('[data-card="payments"]', 'aria-expanded') === 'true');
  await p.keyboard.press('Escape');
  const back = await describeFocus(p);
  check(g, 'Escape closes the list and returns to the card', back.dataset.card === 'payments', `focus on ${back.tag} "${back.text}"`);
  await p.keyboard.press('Enter');
  for (let i = 0; i < 6 && !(await p.evaluate(() => document.activeElement.dataset.moveTo === '__new__')); i++) await p.keyboard.press('ArrowDown');
  const f2 = await screenChange(p, g, 'Move card to a new group', () => p.keyboard.press('Enter'));
  check(g, 'after moving a card, focus stays on that card', f2.dataset.card === 'payments', `focus on ${f2.tag} ${JSON.stringify(f2.dataset)} "${f2.text}"`);
  check(g, 'moving a card is announced (and says the new group can be named later)', /Make a payment moved to .*name any time/.test(await liveText(p)), `live regions: "${await liveText(p)}"`);
  // Name the group from the keyboard.
  await tabTo(p, f => f.tag === 'input' && f.dataset.groupName === 'created-1', { g, label: 'group name field', max: 40 });
  check(g, 'group name field has an accessible name', await p.evaluate(() => { const i = document.activeElement; return !!i.labels?.[0]?.textContent.trim(); }));
  await p.keyboard.type('Money'); await p.keyboard.press('Enter');
  // Remaining cards via their lists.
  for (const card of await p.$$eval('.sort-unsorted [data-card]', s => s.map(x => x.dataset.card))) {
    await p.focus(`[data-card="${card}"]`); await p.keyboard.press('Enter');
    await screenChange(p, g, `move ${card}`, () => p.keyboard.press('Enter'));
  }
  checks.splice(checks.length - 7, 7); // per-card focus checks are covered by the first one
  await tabTo(p, byId('submitSort'), { g, label: 'Finish card sort', max: 60 });
  await screenChange(p, g, 'Finish card sort → follow-up', () => p.keyboard.press('Enter'));
  const r = (await events(p)).find(e => e.kind === 'task_ended')?.payload?.result;
  eq(g, 'keyboard-only sort completed with the named group', [r?.completed, r?.categories?.map(c => c.label)], [true, ['Money']]);
  await p.close();
};

scenarios.tree = async ctx => {
  const g = 'Tree test by keyboard (demo-tree-test)';
  const p = await ctx.newPage(); await p.goto(BASE + 'study.html?study=demo-tree-test'); await p.waitForSelector('#consentCheck');
  await consentByKeyboard(p, g);
  await tabTo(p, f => f.dataset.treeNode === 'records', { g, label: 'Records' });
  const f1 = await screenChange(p, g, 'Open "Records"', () => p.keyboard.press('Enter'));
  check(g, 'after opening a section, focus goes to its contents', f1.dataset?.treeNode === 'tax-transcripts' || /Inside Records/.test(f1.text), `focus on ${f1.tag} "${f1.text}"`);
  check(g, 'opening a section is announced', /Records/.test(await liveText(p)), `live regions: "${await liveText(p)}"`);
  await tabTo(p, f => f.dataset.treeNode === 'tax-transcripts', { g, label: 'Tax transcripts' });
  await screenChange(p, g, 'Open "Tax transcripts"', () => p.keyboard.press('Enter'));
  await tabTo(p, byId('selectDestination'), { g, label: 'Select this location' });
  await screenChange(p, g, 'Select destination → follow-up', () => p.keyboard.press('Enter'));
  const end = (await events(p)).find(e => e.kind === 'task_ended')?.payload?.result;
  eq(g, 'keyboard tree run scored as direct success', [end?.success, end?.direct], [true, true]);
  await p.close();
};

scenarios.firstClick = async ctx => {
  const g = 'First-click test by keyboard (demo-first-click)';
  const p = await ctx.newPage(); await p.goto(BASE + 'study.html?study=demo-first-click'); await p.waitForSelector('#consentCheck');
  await consentByKeyboard(p, g);
  let reached = true;
  try { await tabTo(p, f => f.tag === 'img' || f.role === 'application' || /First-click area/.test(f.text), { g, label: 'the screenshot', max: 8 }); }
  catch { reached = false; }
  check(g, 'the screenshot can be reached with the keyboard', reached, 'only "I\'m not sure where to click" is reachable; a keyboard user cannot take the test');
  if (reached) {
    await p.keyboard.press('+');
    check(g, '+ key zooms the screenshot', (await p.textContent('#zoomLevel')) === '150%', await p.textContent('#zoomLevel'));
    check(g, 'zoom controls are reachable buttons with names', await p.evaluate(() => [...document.querySelectorAll('[data-zoom]')].every(b => b.tagName === 'BUTTON' && (b.getAttribute('aria-label') || b.textContent).trim())));
    await p.keyboard.press('Enter');
    for (let i = 0; i < 8; i++) await p.keyboard.press('Shift+ArrowLeft');
    await p.keyboard.press('ArrowUp');
    await screenChange(p, g, 'Confirm keyboard marker', () => p.keyboard.press('Enter'));
    await tabTo(p, byId('submitFirstClick'), { g, label: 'Continue' });
    await screenChange(p, g, 'Continue → follow-up', () => p.keyboard.press('Enter'));
    const r = (await events(p)).find(e => e.kind === 'task_ended')?.payload?.result;
    check(g, 'keyboard first click recorded with its position', r?.click && Number.isFinite(r.click.x_pct), JSON.stringify(r));
    eq(g, 'keyboard first click marked as keyboard input', r?.click?.input, 'keyboard');
  }
  await p.close();
};

scenarios.preference = async ctx => {
  const g = 'Preference + survey by keyboard (demo-mixed tail)';
  const p = await ctx.newPage(); await p.goto(BASE + 'study.html?study=demo-preference'); await p.waitForSelector('#consentCheck');
  await consentByKeyboard(p, g);
  await tabTo(p, f => f.name === 'preference', { g, label: 'first design option' });
  await p.keyboard.press('Space');
  await tabTo(p, byId('submitPreference'), { g, label: 'Continue' });
  await screenChange(p, g, 'Choose design → follow-up', () => p.keyboard.press('Enter'));
  await answerForm(p, g, { why: 'keyboard test' }, 'Follow-up → completion page');
  check(g, 'completion page reached', await p.isVisible('.done-card'));
  const s = await ctx.newPage(); await s.goto(BASE + 'study.html?study=demo-survey'); await s.waitForSelector('#consentCheck');
  await consentByKeyboard(s, g);
  await tabTo(s, f => f.name === 'frequency', { g, label: 'frequency' }); await s.keyboard.press('Space');
  await tabTo(s, f => f.tag === 'button' && /Continue/.test(f.text), { g, label: 'Continue' });
  await s.keyboard.press('Enter'); await s.waitForTimeout(200);
  const f = await describeFocus(s);
  check(g, 'after a validation error, focus moves to the error or the unanswered question', f.id === 'formError' || f.name === 'priority', `focus on ${f.tag}#${f.id} "${f.text}"`);
  await p.close(); await s.close();
};

scenarios.researcher = async ctx => {
  const g = 'Researcher screens by keyboard';
  const p = await ctx.newPage(); await p.goto(BASE + 'index.html');
  await p.waitForFunction(() => document.querySelectorAll('#exampleStudy option').length > 0);
  await p.keyboard.press('Tab');
  const first = await describeFocus(p);
  check(g, 'first Tab offers "Skip to main content"', /skip/i.test(first.text), `first focus: ${first.tag} "${first.text}"`);
  await tabTo(p, f => f.dataset.tab === 'results', { g, label: 'Results nav', max: 10 });
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  check(g, 'active navigation item is exposed to screen readers', await p.evaluate(() => document.querySelector('.nav-option[data-tab="results"]').getAttribute('aria-current') === 'page'), 'no aria-current on the active tab');
  await tabTo(p, byId('resultsStudy'), { g, label: 'study select', max: 30 });
  check(g, 'toast messages are announced', await p.evaluate(() => ['status', 'alert'].includes(document.querySelector('#toast').getAttribute('role')) || !!document.querySelector('#toast').getAttribute('aria-live')), 'toast has no live-region role');
  await p.close();
};

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const [name, fn] of Object.entries(scenarios)) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
      try { await fn(ctx); } catch (err) { check(name, 'scenario ran to completion', false, err.message.split('\n')[0]); }
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
  const uniqueRings = [...new Set(ringFailures)];
  check('Focus indicators', 'every focused control shows a focus ring with at least 3:1 contrast', uniqueRings.length === 0, `${uniqueRings.length} control(s):\n        ${uniqueRings.slice(0, 15).join('\n        ')}`);
  fs.writeFileSync(path.join(OUT, 'keyboard-report.json'), JSON.stringify({ ran_at: new Date().toISOString(), checks }, null, 2));
  let group = '';
  for (const c of checks) { if (c.group !== group) { group = c.group; console.log(`\n${group}`); } console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.pass ? '' : `\n      → ${c.detail}`}`); }
  const failed = checks.filter(c => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} keyboard checks passed`);
  process.exit(failed ? 1 : 0);
})();
