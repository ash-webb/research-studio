'use strict';
/* Shared card-sort actions for the browser suites (v0.3.4 drag-first card sort). */

async function waitRerender(p, action) {
  await p.evaluate(() => document.querySelector('#participantMain')?.firstElementChild?.setAttribute('data-e2e-old', '1'));
  await action();
  await p.waitForFunction(() => !document.querySelector('#participantMain [data-e2e-old]'), null, { timeout: 8000 });
}
const centre = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// Mouse drag of a card onto a group, "__new__" (New group) or "" (back to cards to sort).
async function dragCard(p, cardId, target) {
  await p.locator(`[data-card="${cardId}"]`).scrollIntoViewIfNeeded();
  const a = centre(await p.locator(`[data-card="${cardId}"]`).boundingBox());
  await waitRerender(p, async () => {
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    await p.mouse.move(a.x + 8, a.y + 6, { steps: 2 });
    // Drag towards the target; if it is off screen, hold near the edge so the page auto-scrolls.
    for (let i = 0; i < 80; i++) {
      const t = centre(await p.locator(`[data-drop-category="${target}"]`).boundingBox());
      const vh = await p.evaluate(() => innerHeight);
      if (t.y > 30 && t.y < vh - 30) { await p.mouse.move(t.x, t.y, { steps: 8 }); break; }
      await p.mouse.move(t.x, t.y < 30 ? 12 : vh - 12, { steps: 2 });
      await p.waitForTimeout(60);
    }
    await p.mouse.up();
  });
  await p.waitForTimeout(200); // the click that ends a drag is ignored for 150ms; act at human speed
}

// Real touch input through Chrome DevTools: press, hold, move, release.
async function touchDrag(p, cardId, target, { hold = 380 } = {}) {
  const cdp = await p.context().newCDPSession(p);
  await p.locator(`[data-card="${cardId}"]`).scrollIntoViewIfNeeded();
  const a = centre(await p.locator(`[data-card="${cardId}"]`).boundingBox());
  await waitRerender(p, async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
    await p.waitForTimeout(hold);
    // The target may be off screen on a phone: the page auto-scrolls near the edges, so
    // re-measure while moving.
    let pos = { ...a };
    for (let i = 0; i < 60; i++) {
      const box = await p.locator(`[data-drop-category="${target}"]`).boundingBox();
      const t = centre(box), vh = await p.evaluate(() => innerHeight);
      const goal = { x: t.x, y: Math.max(20, Math.min(vh - 20, t.y)) };
      pos = { x: pos.x + (goal.x - pos.x) / 3, y: pos.y + (goal.y - pos.y) / 3 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pos.x, y: pos.y }] });
      await p.waitForTimeout(30);
      if (t.y > 20 && t.y < vh - 20 && Math.hypot(t.x - pos.x, t.y - pos.y) < 6) break;
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
  await cdp.detach();
  await p.waitForTimeout(200);
}

// Quick swipe starting on a card (no hold): should scroll, not drag.
async function touchSwipe(p, cardId, dy) {
  const cdp = await p.context().newCDPSession(p);
  const a = centre(await p.locator(`[data-card="${cardId}"]`).boundingBox());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x, y: a.y + dy * i / 8 }] }); await p.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await p.waitForTimeout(300);
}

// Click/tap a card and pick a destination from its "Move to" list.
async function moveViaMenu(p, cardId, target) {
  await p.click(`[data-card="${cardId}"]`);
  await waitRerender(p, () => p.click(`[data-card="${cardId}"] + .move-menu [data-move-to="${target}"]`));
}

async function nameGroup(p, groupId, name) {
  const input = p.locator(`[data-group-name="${groupId}"]`);
  await input.fill(name);
  await input.press('Enter');
}

module.exports = { dragCard, touchDrag, touchSwipe, moveViaMenu, nameGroup, waitRerender };
