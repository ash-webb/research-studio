// Phone or tablet? (v0.3.12) Used when a study allows laptops and desktops only.
// Not by window width: a narrow window on a computer is still a computer. Signals:
//   - the browser says it's mobile (user agent, or User-Agent Client Hints);
//   - an iPad that reports itself as a Mac (touch points on "Macintosh");
//   - a screen whose only pointer is a finger (no hover, coarse pointer).
// A touchscreen laptop has a trackpad or mouse as well, so it counts as a computer.
// docs/qualtrics-device-check.js repeats this logic for the survey page (keep them in step).
export const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i;

export function deviceKind(env = globalThis) {
  const nav = env.navigator || {}, ua = String(nav.userAgent || '');
  const mm = q => { try { return !!env.matchMedia?.(q).matches; } catch { return false; } };
  const mobile = MOBILE_UA.test(ua) || nav.userAgentData?.mobile === true;
  const iPadAsMac = /Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1;
  const touchOnly = mm('(hover: none) and (pointer: coarse)') && !mm('(any-pointer: fine)');
  if (!(mobile || iPadAsMac || touchOnly)) return 'desktop';
  const s = env.screen || {};
  const short = Math.min(Number(s.width) || 0, Number(s.height) || 0);
  return short && short < 600 ? 'phone' : 'tablet';
}
export const allowedOn = (study, kind) => study?.allowedDevices !== 'desktop' || kind === 'desktop';
