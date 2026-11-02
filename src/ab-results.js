// A/B results analysis and presentation (v0.3.7).
// Estimates with 95% ranges (confidence intervals), comparisons with the baseline (the first
// design), and data-quality checks. Descriptive only: no winner is declared.
import { wilson, diffProportions, median, medianCI, diffMedians, sampleRatioCheck, comparisonConfidence, planStudy, deviceClass } from './abstats.js';

const MIN_COMPARE = 10; // fewer measured people per design than this: report, but don't compare
const letter = i => String.fromCharCode(65 + i);
const pct = p => `${Math.round(p * 100)}%`;
const pts = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(Math.round(d * 100))}`;
const secs = s => s == null ? '—' : s < 90 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
const signedSecs = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${secs(Math.abs(d))}`;

export function analyzeAB(a, data, flat) {
  const exposures = (flat.starts || []).filter(x => x.task_id === a.id && x.method === 'ab_test');
  const sessions = new Map((flat.sessions || []).map(s => [s.session_id, s]));
  const hasSignal = !!a.successSignal;
  const designs = a.variants.map((v, i) => {
    const started = exposures.filter(x => x.variant_id === v.id);
    const finished = data.filter(x => x.variant_id === v.id);
    const measured = finished.filter(x => x.tracker_connected && ['received', 'not_observed'].includes(x.result?.success_signal_status));
    const successes = measured.filter(x => x.result.success_signal_status === 'received').length;
    const selfDone = finished.filter(x => x.self_report === 'completed').length;
    const activeTimes = finished.map(x => Number(x.time_seconds) - (Number(x.interrupted_seconds) || 0)).filter(t => Number.isFinite(t) && t >= 0);
    const clicks = finished.filter(x => x.tracker_connected).map(x => Number(x.click_count)).filter(Number.isFinite);
    const devices = started.reduce((m, x) => { const s = sessions.get(x.session_id); const d = s?.device || deviceClass(s?.viewport_width); m[d] = (m[d] || 0) + 1; return m; }, {});
    const nStarted = Math.max(started.length, finished.length); // imported data may lack starts
    return {
      variant: v, index: i, label: `${letter(i)} · ${v.label}`,
      started: nStarted, finished: finished.length, dropped: Math.max(0, nStarted - finished.length),
      measured: measured.length, successes,
      success: hasSignal ? wilson(successes, measured.length) : null,
      successAll: hasSignal && nStarted ? wilson(successes, nStarted) : null, // drop-outs counted as unsuccessful
      self: wilson(selfDone, finished.length),
      time: medianCI(activeTimes), times: activeTimes,
      clicks: median(clicks), devices
    };
  });
  // Primary measure: the success signal when one is set, otherwise self-reported completion.
  const primary = hasSignal ? 'success' : 'self';
  const conf = comparisonConfidence(designs.length);
  const base = designs[0];
  const comparisons = designs.slice(1).map(d => {
    const kA = primary === 'success' ? base.successes : base.self?.k || 0, nA = primary === 'success' ? base.measured : base.finished;
    const kB = primary === 'success' ? d.successes : d.self?.k || 0, nB = primary === 'success' ? d.measured : d.finished;
    return {
      design: d, enough: nA >= MIN_COMPARE && nB >= MIN_COMPARE,
      rate: diffProportions(kA, nA, kB, nB, conf),
      self: diffProportions(base.self?.k || 0, base.finished, d.self?.k || 0, d.finished, conf),
      time: diffMedians(base.times, d.times, conf)
    };
  });
  // ---- checks ----
  const checks = [];
  const totalStarted = designs.reduce((s, d) => s + d.started, 0);
  const srm = totalStarted >= 10 && exposures.length ? sampleRatioCheck(designs.map(d => d.started)) : null;
  if (srm) checks.push(srm.p < 0.01
    ? { level: 'warn', title: 'Group sizes', text: `Groups are more uneven than random assignment usually produces (${designs.map(d => d.started).join(' vs ')}; chance of this or worse ${srm.p < 0.001 ? '< 0.1%' : `${(srm.p * 100).toFixed(1)}%`}). Check how designs were assigned before comparing.` }
    : { level: 'ok', title: 'Group sizes', text: `${designs.map(d => d.started).join(' vs ')}: within what random assignment produces.` });
  if (totalStarted) {
    const dropRates = designs.map(d => d.started ? d.dropped / d.started : 0);
    const differs = designs.slice(1).some(d => { const r = diffProportions(base.dropped, base.started, d.dropped, d.started); return r && (r.lo > 0 || r.hi < 0); });
    checks.push({ level: differs ? 'warn' : 'ok', title: 'Drop-out', text: `${designs.map((d, i) => `${letter(i)} ${pct(dropRates[i])}`).join(', ')} of people who started did not finish.${differs ? ' Drop-out differs between designs, which can bias the comparison: people who struggle may be the ones who leave.' : ''}` });
  }
  if (hasSignal) {
    const low = designs.filter(d => d.finished && d.measured / d.finished < 0.9);
    checks.push(low.length
      ? { level: 'warn', title: 'Tracking', text: `Success could not be measured for many finishers in ${low.map(d => letter(d.index)).join(', ')} (${low.map(d => `${d.measured} of ${d.finished}`).join(', ')}). Use Check designs to confirm the tracking script and signal.` }
      : { level: 'ok', title: 'Tracking', text: 'Success was measurable for at least 90% of finishers in every design.' });
  }
  // Unknown devices (e.g. Survey 1 drop-outs in imported data) are left out of the shares.
  const phoneShare = designs.map(d => { const n = Object.entries(d.devices).filter(([k]) => k !== 'unknown').reduce((s, [, x]) => s + x, 0); return n ? (d.devices.phone || 0) / n : null; });
  if (phoneShare.every(x => x != null)) {
    const spread = Math.max(...phoneShare) - Math.min(...phoneShare);
    checks.push({ level: spread > 0.2 ? 'warn' : 'ok', title: 'Devices', text: `On phones: ${designs.map((d, i) => `${letter(i)} ${pct(phoneShare[i])}`).join(', ')}.${spread > 0.2 ? ' The device mix differs a lot between designs; compare phone and computer results separately if you can.' : ''}` });
  }
  const minMeasured = Math.min(...designs.map(d => primary === 'success' ? d.measured : d.finished));
  const plan = planStudy({ baseline: (primary === 'success' ? base.success?.p : base.self?.p) ?? 0.5, difference: 0.15, designs: designs.length });
  return { a, designs, comparisons, checks, primary, conf, minMeasured, plan, hasSignal };
}

// ---------- charts (inline SVG, one hue; rows are labelled so colour carries no meaning) ----------
function dotWhiskerSVG(rows, { min, max, ticks, fmt, zero = null, label }, esc) {
  const W = 660, left = 190, right = 140, top = 24, rowH = 38, H = top + rows.length * rowH + 26;
  const x = v => left + (v - min) / (max - min) * (W - left - right);
  const grid = ticks.map(t => `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 22}" class="ab-grid"/><text x="${x(t)}" y="${H - 6}" class="ab-tick" text-anchor="middle">${esc(fmt(t))}</text>`).join('');
  const zeroLine = zero == null ? '' : `<line x1="${x(zero)}" x2="${x(zero)}" y1="${top - 10}" y2="${H - 22}" class="ab-zero"/>`;
  const marks = rows.map((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const whisker = r.lo == null ? '' : `<line x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${y}" y2="${y}" class="ab-whisker"/><line x1="${x(r.lo)}" x2="${x(r.lo)}" y1="${y - 6}" y2="${y + 6}" class="ab-whisker"/><line x1="${x(r.hi)}" x2="${x(r.hi)}" y1="${y - 6}" y2="${y + 6}" class="ab-whisker"/>`;
    return `<g><title>${esc(r.tip)}</title><text x="${left - 12}" y="${y + 4}" class="ab-row-label" text-anchor="end">${esc(r.name)}</text>${whisker}<circle cx="${x(r.v)}" cy="${y}" r="6" class="ab-dot"/><text x="${W - right + 10}" y="${y + 4}" class="ab-value">${esc(r.text)}</text></g>`;
  }).join('');
  return `<svg class="ab-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMinYMin meet">${grid}${zeroLine}${marks}</svg>`;
}

export function renderABCore(an, esc) {
  const { designs, comparisons, checks, primary, conf, hasSignal, minMeasured } = an;
  const measureName = primary === 'success' ? 'Success signal' : 'Self-reported completion';
  const est = d => primary === 'success' ? d.success : d.self;
  const confText = conf === 0.95 ? '95%' : `${(conf * 100).toFixed(1).replace(/\.0$/, '')}%`;
  // ---- lead ----
  let lead;
  const measuredWord = primary === 'success' ? 'measured' : 'finished';
  if (designs.every(d => !est(d))) lead = `<p class="ab-lead">No finished ${measureName.toLowerCase()} results yet.</p>`;
  else {
    const rates = designs.map(d => est(d) ? `${d.label} <strong>${pct(est(d).p)}</strong> <span class="muted">(${est(d).k} of ${est(d).n} ${measuredWord})</span>` : `${d.label}: no results`).join(' · ');
    const lines = comparisons.map(c => {
      const name = `${letter(c.design.index)} vs ${letter(0)}`;
      if (!c.rate) return `<li>${name}: not enough results yet.</li>`;
      const range = `${pts(c.rate.lo)} to ${pts(c.rate.hi)} points`;
      if (!c.enough) return `<li><strong>${name}:</strong> ${pts(c.rate.d)} points (range ${range}). Fewer than ${MIN_COMPARE} people per design, so too early to compare.</li>`;
      const clear = c.rate.lo > 0 || c.rate.hi < 0;
      return `<li><strong>${name}:</strong> ${pts(c.rate.d)} points (${confText} range ${range}). ${clear ? `The range doesn't include zero, so a difference in this direction is unlikely to be chance alone.` : `The range includes zero, so this sample can't tell a real difference from chance.`}</li>`;
    }).join('');
    const warns = checks.filter(c => c.level === 'warn').length;
    lead = `<div class="ab-lead"><p><strong>${measureName}:</strong> ${rates}</p><ul>${lines}</ul>${warns ? `<p class="notice warning">Read with care: ${warns} data check${warns === 1 ? '' : 's'} below need${warns === 1 ? 's' : ''} attention.</p>` : ''}${!hasSignal ? '<p class="analysis-subtitle">No success signal is set for this activity, so designs are compared on self-reported completion.</p>' : ''}</div>`;
  }
  // ---- charts ----
  const rateRows = designs.filter(d => est(d)).map(d => ({ name: d.label, v: est(d).p, lo: est(d).lo, hi: est(d).hi, text: `${pct(est(d).p)} (${pct(est(d).lo)}–${pct(est(d).hi)})`, tip: `${d.label}: ${pct(est(d).p)}, 95% range ${pct(est(d).lo)} to ${pct(est(d).hi)}, ${est(d).k} of ${est(d).n}` }));
  const rateChart = rateRows.length ? dotWhiskerSVG(rateRows, { min: 0, max: 1, ticks: [0, .25, .5, .75, 1], fmt: v => pct(v), label: `${measureName} by design with 95% ranges: ${rateRows.map(r => `${r.name} ${r.text}`).join('; ')}` }, esc) : '';
  const diffRows = comparisons.filter(c => c.rate).map(c => ({ name: `${letter(c.design.index)} vs ${letter(0)}`, v: c.rate.d, lo: c.rate.lo, hi: c.rate.hi, text: `${pts(c.rate.d)} (${pts(c.rate.lo)} to ${pts(c.rate.hi)})`, tip: `${letter(c.design.index)} minus ${letter(0)}: ${pts(c.rate.d)} points, ${confText} range ${pts(c.rate.lo)} to ${pts(c.rate.hi)}` }));
  const lim = Math.max(0.1, ...diffRows.flatMap(r => [Math.abs(r.lo), Math.abs(r.hi)]));
  const span = Math.min(1, Math.ceil(lim * 10) / 10);
  const diffChart = diffRows.length ? dotWhiskerSVG(diffRows, { min: -span, max: span, ticks: [-span, -span / 2, 0, span / 2, span], fmt: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)}`, zero: 0, label: `Difference from design ${letter(0)} in percentage points with ${confText} ranges: ${diffRows.map(r => `${r.name} ${r.text}`).join('; ')}` }, esc) : '';
  const charts = rateChart ? `<div class="ab-charts"><figure><figcaption>${measureName} by design <span>dot = rate, line = 95% range</span></figcaption>${rateChart}</figure>${diffChart ? `<figure><figcaption>Difference from ${letter(0)} (percentage points) <span>right of the zero line = higher than ${letter(0)}</span></figcaption>${diffChart}</figure>` : ''}</div>` : '';
  // ---- tables ----
  const cell = w => w ? `${pct(w.p)} <small>${w.k}/${w.n} · ${pct(w.lo)}–${pct(w.hi)}</small>` : '—';
  const rows = designs.map(d => `<tr><th scope="row">${esc(d.label)}${d.variant.revision ? `<div class="muted tiny">Version: ${esc(d.variant.revision)}</div>` : ''}</th><td>${d.started}</td><td>${d.finished}</td><td>${d.dropped}${d.started ? ` <small>${pct(d.dropped / d.started)}</small>` : ''}</td>${hasSignal ? `<td>${cell(d.success)}</td>` : ''}<td>${cell(d.self)}</td><td>${secs(d.time?.m)}${d.time?.lo != null ? ` <small>${secs(d.time.lo)}–${secs(d.time.hi)}</small>` : ''}</td><td>${d.clicks == null ? '—' : d.clicks.toFixed(1).replace(/\.0$/, '')}</td></tr>`).join('');
  const table = `<div class="table-scroll"><table class="data-table ab-table"><thead><tr><th>Design</th><th>Started</th><th>Finished</th><th>Dropped out</th>${hasSignal ? '<th>Success signal</th>' : ''}<th>Self-reported complete</th><th>Median active time</th><th>Median clicks</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const cmpRow = (name, f) => `<tr><th scope="row">${name}</th>${comparisons.map(c => `<td>${f(c)}</td>`).join('')}</tr>`;
  const rangeTxt = r => r ? `${pts(r.d)} pts <small>${pts(r.lo)} to ${pts(r.hi)}</small>` : '—';
  const cmp = comparisons.length ? `<div class="table-scroll"><table class="data-table ab-table"><thead><tr><th>Difference from ${letter(0)}</th>${comparisons.map(c => `<th>${letter(c.design.index)} vs ${letter(0)}</th>`).join('')}</tr></thead><tbody>${hasSignal ? cmpRow('Success signal', c => rangeTxt(c.rate)) : ''}${cmpRow('Self-reported complete', c => rangeTxt(c.self))}${cmpRow('Median active time', c => c.time ? `${signedSecs(c.time.d)}${c.time.lo != null ? ` <small>${signedSecs(c.time.lo)} to ${signedSecs(c.time.hi)}</small>` : ''}` : '—')}</tbody></table></div><p class="analysis-subtitle">Ranges are ${confText} confidence intervals${conf !== 0.95 ? `, widened from 95% because ${comparisons.length} designs are each compared with ${letter(0)}` : ''}. Small text in the table above: count and 95% range. Active time excludes time away after a page reload.</p>` : '';
  // ---- checks ----
  const checkList = checks.length ? `<ul class="ab-checks">${checks.map(c => `<li class="ab-check-${c.level}"><span class="ab-check-icon" aria-hidden="true">${c.level === 'ok' ? '✓' : '!'}</span><span class="sr-only">${c.level === 'ok' ? 'OK' : 'Needs attention'}:</span> <strong>${esc(c.title)}.</strong> ${esc(c.text)}</li>`).join('')}</ul>` : '<p class="muted small">Checks appear once people have taken part.</p>';
  // ---- planner ----
  const basePct = Math.round(((primary === 'success' ? designs[0].success?.p : designs[0].self?.p) ?? 0.5) * 100);
  const planner = `<div class="ab-planner" data-planner data-designs="${designs.length}" data-measured="${minMeasured}"><div class="ab-planner-inputs"><label class="field">Expected success rate for ${letter(0)} (%)<input type="number" min="1" max="99" step="1" value="${basePct}" data-plan="baseline"></label><label class="field">Smallest difference worth finding (points)<input type="number" min="1" max="60" step="1" value="15" data-plan="difference"></label><label class="field">Power<select data-plan="power"><option value="0.8" selected>80% (common)</option><option value="0.9">90%</option></select></label></div><p class="ab-planner-out" data-plan-out aria-live="polite"></p></div>`;
  return `${lead}${charts}<h4>All results by design</h4>${table}${cmp ? `<h4>Differences from ${letter(0)} (baseline)</h4>${cmp}` : ''}<h4>Data checks</h4>${checkList}<h4>How many people do you need?</h4>${planner}`;
}

// Planner text; called on render and on input (admin.js).
export function plannerText({ baseline, difference, power, designs, measured }) {
  const plan = planStudy({ baseline: baseline / 100, difference: difference / 100, designs, power });
  if (!plan) return 'Enter a success rate between 1 and 99% and a difference of at least 1 point.';
  const enough = measured >= plan.perDesign;
  return `About ${plan.perDesign} people per design (${plan.total} in total) who finish with success measured, to have ${/^(8|11|18)/.test(String(Math.round(power * 100))) ? 'an' : 'a'} ${Math.round(power * 100)}% chance of detecting a ${difference}-point difference from ${baseline}%${designs > 2 ? ` (significance adjusted for ${designs - 1} comparisons)` : ''}. ${enough ? `You have at least that many (${measured} in the smallest group).` : `You have ${measured} in the smallest group so far.`} Start counts higher than this, since some people drop out.`;
}
