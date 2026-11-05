// A/B results analysis and presentation (v0.3.7, revised after independent statistical review).
//
// Main measure: the success signal counting EVERYONE ASSIGNED to a design, with people who left
// or whose success could not be measured counted as not successful. This keeps the randomised
// groups intact. Secondary: the rate among people who finished with success measured.
// Ranges are 95% confidence intervals (difference ranges widened when 3+ designs are compared
// with the baseline). Descriptive only: no winner is declared.
import { plannedSize, hypothesisSentence, fmtDate, PRIMARY } from './plan.js';
import { wilson, diffProportions, median, medianCI, diffMedians, sampleRatioCheck, comparisonConfidence, planStudy, detectableDifference, deviceClass } from './abstats.js';

const MIN_COMPARE = 10; // below this per design, ranges are too wide to read a comparison
const letter = i => String.fromCharCode(65 + i);
const pct = p => `${Math.round(p * 100)}%`;
// Signed percentage points; one decimal under 1 point so a limit just above zero never shows "+0".
const pts = d => { const v = d * 100, a = Math.abs(v), s = v > 0 ? '+' : v < 0 ? '−' : '±'; return `${s}${a > 0 && a < 1 ? a.toFixed(1) : Math.round(a)}`; };
const secs = s => { if (s == null) return '—'; const r = Math.round(s); return r < 90 ? `${r}s` : `${Math.floor(r / 60)}m ${r % 60}s`; };
const signedSecs = d => `${d > 0 ? '+' : d < 0 ? '−' : '±'}${secs(Math.abs(d))}`;
const confText = c => c === 0.95 ? '95%' : `${(c * 100).toFixed(1).replace(/\.0$/, '')}%`;
const excludesZero = r => r && r.lo != null && (r.lo > 0 || r.hi < 0);

export function analyzeAB(a, data, flat, studyPlan = null) {
  const ep = studyPlan?.experiments?.[a.experimentId || a.id] || null;
  const sessions = new Map((flat.sessions || []).map(s => [s.session_id, s]));
  // One exposure per session per activity (repeated task_started events are not extra people).
  const seen = new Set();
  const exposures = (flat.starts || []).filter(x => x.task_id === a.id && x.method === 'ab_test').filter(x => { const k = `${x.session_id}|${x.task_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const importedSessions = [...sessions.values()].filter(s => s.imported === 'qualtrics');
  // Drop-out is unknown for imported data without Survey 1, or when no starts were recorded at all.
  const dropoutUnknown = (importedSessions.length > 0 && !importedSessions.some(s => s.survey1_provided)) || (!exposures.length && data.length > 0);
  // The plan's primary measure decides; task success needs a success signal.
  const hasSignal = !!a.successSignal && ep?.primaryMeasure !== 'self';
  const designs = a.variants.map((v, i) => {
    const started = exposures.filter(x => x.variant_id === v.id);
    const finished = data.filter(x => x.variant_id === v.id);
    const measured = finished.filter(x => x.tracker_connected && ['received', 'not_observed'].includes(x.result?.success_signal_status));
    const successes = measured.filter(x => x.result.success_signal_status === 'received').length;
    const selfDone = finished.filter(x => x.self_report === 'completed').length;
    const active = x => { const t = Number(x.time_seconds); return Number.isFinite(t) && t > 0 ? t - (Number(x.interrupted_seconds) || 0) : null; };
    const times = finished.map(active).filter(t => t != null && t > 0);
    const succeeded = hasSignal ? finished.filter(x => x.result?.success_signal_status === 'received') : finished.filter(x => x.self_report === 'completed');
    // Time to success: from the success signal itself where recorded (v0.3.10), otherwise the activity's active time.
    const successTimes = succeeded.map(x => hasSignal && Number.isFinite(x.success_at_seconds) && x.success_at_seconds > 0 ? x.success_at_seconds : active(x)).filter(t => t != null && t > 0);
    // Self-report against what happened, among finishers whose success was measured.
    const answered = measured.filter(x => ['completed', 'unable'].includes(x.self_report));
    const overclaim = answered.filter(x => x.self_report === 'completed' && x.result.success_signal_status === 'not_observed').length;
    const underclaim = answered.filter(x => x.self_report === 'unable' && x.result.success_signal_status === 'received').length;
    const clicks = finished.filter(x => x.tracker_connected).map(x => x.click_count).filter(Number.isFinite);
    const devices = (started.length ? started : finished).reduce((m, x) => { const s = sessions.get(x.session_id); const d = s?.device || deviceClass(s?.viewport_width); m[d] = (m[d] || 0) + 1; return m; }, {});
    const nAssigned = dropoutUnknown ? finished.length : Math.max(started.length, finished.length);
    const kPrimary = hasSignal ? successes : selfDone;
    return {
      variant: v, index: i, label: `${letter(i)} · ${v.label}`,
      assigned: nAssigned, finished: finished.length, dropped: dropoutUnknown ? null : Math.max(0, nAssigned - finished.length),
      measured: measured.length, unmeasured: finished.length - measured.length, successes, selfDone,
      primary: wilson(kPrimary, nAssigned),                                   // everyone assigned
      measuredRate: hasSignal ? wilson(successes, measured.length) : null,    // finishers with success measured
      self: wilson(selfDone, finished.length),                                // finishers' own view
      time: medianCI(times), times, successTime: medianCI(successTimes), successTimes,
      clicks: median(clicks), devices,
      overclaim: hasSignal ? wilson(overclaim, answered.length) : null, underclaim: hasSignal ? underclaim : null, answered: answered.length
    };
  });
  const conf = comparisonConfidence(designs.length);
  const base = designs[0];
  const comparisons = designs.slice(1).map(d => ({
    design: d,
    enough: base.assigned >= MIN_COMPARE && d.assigned >= MIN_COMPARE,
    primary: diffProportions(hasSignal ? base.successes : base.selfDone, base.assigned, hasSignal ? d.successes : d.selfDone, d.assigned, conf),
    measured: hasSignal ? diffProportions(base.successes, base.measured, d.successes, d.measured, conf) : null,
    self: diffProportions(base.selfDone, base.finished, d.selfDone, d.finished, conf),
    time: diffMedians(base.times, d.times, conf)
  }));
  const minAssigned = Math.min(...designs.map(d => d.assigned));
  const baseRate = base.primary?.p ?? 0.5;
  const detectable = detectableDifference(minAssigned, baseRate, { designs: designs.length });
  const planned = ep ? plannedSize(ep, designs.length) : null;
  const target = planned || planStudy({ baseline: Math.min(0.95, Math.max(0.05, baseRate)), difference: 0.15, designs: designs.length });

  // ---- data checks ----
  const checks = [];
  const linkAssigned = exposures.length > 0 && exposures.every(x => String(x.assignment || '').startsWith('link'));
  if (dropoutUnknown) {
    checks.push({ level: 'warn', title: 'Drop-out', text: importedSessions.length ? 'Unknown: Survey 1 was not imported (or could not be matched), so people who were assigned a design but never finished are missing. Rates below count finishers only.' : 'Unknown: no task starts were recorded.' });
    checks.push({ level: 'info', title: 'Group sizes', text: 'Not checked: assignment balance needs everyone assigned, not just finishers.' });
  } else {
    const total = designs.reduce((s, d) => s + d.assigned, 0);
    const srm = total >= 10 ? sampleRatioCheck(designs.map(d => d.assigned)) : null;
    if (srm) checks.push(srm.p < 0.01
      ? { level: 'warn', title: 'Group sizes', text: `Groups are more uneven than random assignment usually produces (${designs.map(d => d.assigned).join(' vs ')}; chance of this or worse ${srm.p < 0.001 ? 'under 0.1%' : `${(srm.p * 100).toFixed(1)}%`}). Check how designs were assigned before comparing.` }
      : { level: 'ok', title: 'Group sizes', text: `${designs.map(d => d.assigned).join(' vs ')}. No sign of uneven assignment${linkAssigned ? ' (assigned through the study link, e.g. a Qualtrics randomizer)' : ''}; this check detects little with small groups.` });
    const dropDiff = designs.slice(1).map(d => diffProportions(base.dropped, base.assigned, d.dropped, d.assigned)).some(excludesZero);
    checks.push({ level: dropDiff ? 'warn' : 'ok', title: 'Drop-out', text: `${designs.map(d => `${letter(d.index)} ${d.assigned ? pct(d.dropped / d.assigned) : '—'}`).join(', ')} of people assigned did not finish.${dropDiff ? ' Drop-out differs between designs: people who struggle may be the ones who leave, which biases comparisons among finishers.' : ''}` });
  }
  if (hasSignal) {
    const low = designs.filter(d => d.finished && d.measured / d.finished < 0.9);
    const unevenTracking = designs.slice(1).map(d => diffProportions(base.unmeasured, base.finished, d.unmeasured, d.finished)).some(excludesZero);
    checks.push(low.length || unevenTracking
      ? { level: 'warn', title: 'Tracking', text: `${low.length ? `Success could not be measured for many finishers in ${low.map(d => `${letter(d.index)} (${d.measured} of ${d.finished} measured)`).join(', ')}. ` : ''}${unevenTracking ? 'The share of unmeasured finishers differs between designs, which can bias the comparison. ' : ''}Use Check designs to confirm the tracking script and signal.` }
      : { level: 'ok', title: 'Tracking', text: 'Success was measurable for at least 90% of finishers in every design, at similar rates.' });
  }
  const known = d => Object.entries(d.devices).filter(([k]) => k !== 'unknown').reduce((s, [, x]) => s + x, 0);
  if (designs.every(d => known(d) > 0)) {
    const differs = designs.slice(1).map(d => diffProportions(base.devices.phone || 0, known(base), d.devices.phone || 0, known(d))).some(excludesZero);
    checks.push({ level: differs ? 'warn' : 'ok', title: 'Devices', text: `On phones: ${designs.map(d => `${letter(d.index)} ${pct((d.devices.phone || 0) / known(d))}`).join(', ')}.${differs ? ' The device mix differs between designs more than chance would explain; compare phone and computer results separately.' : ''}` });
  }
  if (hasSignal) {
    const withAnswers = designs.filter(d => d.overclaim && d.answered >= 5);
    const worst = withAnswers.reduce((m, d) => (!m || d.overclaim.p > m.overclaim.p ? d : m), null);
    if (worst && worst.overclaim.p >= 0.15) checks.push({ level: 'info', title: 'Self-report and observed success differ', text: `${withAnswers.map(d => `${letter(d.index)}: ${d.overclaim.k} of ${d.overclaim.n} (${pct(d.overclaim.p)})`).join('; ')} said they completed the task when the prototype did not record success. This is why the success signal, not the self-report, is the main measure${withAnswers.length > 1 && Math.abs(withAnswers[0].overclaim.p - withAnswers.at(-1).overclaim.p) >= 0.15 ? '; the gap differs between designs, which is itself worth reporting' : ''}.` });
  }
  if (hasSignal && !dropoutUnknown) {
    const disagree = comparisons.filter(c => c.enough && c.primary && c.measured && excludesZero(c.primary) !== excludesZero(c.measured));
    if (disagree.length) checks.push({ level: 'warn', title: 'Ways of counting disagree', text: `Counting everyone assigned and counting only measured finishers lead to different conclusions for ${disagree.map(c => `${letter(c.design.index)} vs ${letter(0)}`).join(', ')}. Drop-out or tracking differences are likely shaping the result; rely on the everyone-assigned figure.` });
  }
  // ---- planned hypotheses, assessed against the matching comparison (descriptive, no winner) ----
  const hypotheses = (ep?.hypotheses || []).map((h, i) => {
    const c = comparisons.find(x => x.design.variant.id === h.treatmentId);
    const sentence = hypothesisSentence({ variants: a.variants }, ep, h);
    if (!c) return { n: i + 1, sentence, status: 'missing', text: 'This design is not in the results.' };
    const r = h.measure === 'time' ? c.time : h.measure === 'success' ? (hasSignal ? c.primary : c.measured) : (hasSignal ? c.self : c.primary);
    const isRate = h.measure !== 'time';
    const value = r ? (isRate ? `${pts(r.d)} points${r.lo != null ? ` (${confText(conf)} range ${pts(r.lo)} to ${pts(r.hi)})` : ''}` : `${signedSecs(r.d)}${r.lo != null && r.lo !== r.hi ? ` (${confText(conf)} range ${signedSecs(r.lo)} to ${signedSecs(r.hi)})` : ''}`) : '';
    let status, text;
    if (!r || r.lo == null || r.lo === r.hi) { status = 'early'; text = 'Too few results to assess.'; }
    else if (!c.enough) { status = 'early'; text = `Fewer than ${MIN_COMPARE} people in a design: too early to assess.`; }
    else if (excludesZero(r)) {
      const dir = r.lo > 0 ? 'higher' : 'lower';
      status = h.direction === 'different' || h.direction === dir ? 'consistent' : 'opposite';
      text = status === 'consistent' ? 'Consistent with the hypothesis: the range excludes zero in the expected direction.' : 'Opposite to the hypothesis: the range excludes zero in the other direction.';
    } else { status = 'inconclusive'; text = 'Inconclusive: the range includes zero.'; }
    if (planned && minAssigned < planned.perDesign && status !== 'missing') text += ` Target sample not yet reached (${minAssigned} of ${planned.perDesign} in the smallest group).`;
    const secondary = h.measure === 'time' || (h.measure === 'success') !== hasSignal;
    return { n: i + 1, sentence, status, text, value, secondary };
  });
  const planInfo = ep ? { locked: studyPlan.locked, changes: (studyPlan.changes || []).length, primary: hasSignal ? 'success' : 'self', planned, control: a.variants[0] } : null;
  return { a, designs, comparisons, checks, conf, hasSignal, dropoutUnknown, minAssigned, detectable, plan: target, planned, hypotheses, planInfo, ep };
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
  const { designs, comparisons, checks, conf, hasSignal, dropoutUnknown, minAssigned, detectable, plan, planned, hypotheses = [], planInfo, ep } = an;
  const measureName = hasSignal ? 'Success signal' : 'Self-reported completion';
  const confText = conf === 0.95 ? '95%' : `${(conf * 100).toFixed(1).replace(/\.0$/, '')}%`;
  const basis = dropoutUnknown ? 'counting finishers only (drop-out unknown)' : `counting everyone assigned${hasSignal ? '; people who left or whose success could not be measured count as not successful' : '; people who left count as not completed'}`;
  // ---- lead ----
  let lead;
  if (designs.every(d => !d.primary)) lead = `<p class="ab-lead">No ${measureName.toLowerCase()} results yet.</p>`;
  else {
    const rates = designs.map(d => d.primary ? `${esc(d.label)} <strong>${pct(d.primary.p)}</strong> <span class="muted">(${d.primary.k} of ${d.primary.n})</span>` : `${esc(d.label)}: no results`).join(' · ');
    const lines = comparisons.map(c => {
      const name = `${letter(c.design.index)} vs ${letter(0)}`;
      if (!c.primary) return `<li>${name}: not enough results yet.</li>`;
      const range = `${pts(c.primary.lo)} to ${pts(c.primary.hi)} points`;
      if (!c.enough) return `<li><strong>${name}:</strong> ${pts(c.primary.d)} points (${confText} range ${range}). With fewer than ${MIN_COMPARE} people in a design, ranges are too wide to compare.</li>`;
      const verdict = excludesZero(c.primary)
        ? `The ${confText} range excludes zero: if the designs truly performed the same, a gap this large would be unusual. Before acting, check drop-out and tracking below, and whether a difference as small as ${pts(Math.abs(c.primary.lo) < Math.abs(c.primary.hi) ? c.primary.lo : c.primary.hi).replace('+', '')} points would matter.`
        : `The range includes zero: the data fit no difference, ${letter(c.design.index)} being up to ${pts(c.primary.lo).replace('−', '').replace('+', '')} points lower, or up to ${pts(c.primary.hi).replace('+', '').replace('−', '')} points higher. This is not evidence that the designs perform the same.`;
      return `<li><strong>${name}:</strong> ${pts(c.primary.d)} points (${confText} range ${range}). ${verdict}</li>`;
    }).join('');
    const secondary = hasSignal && !dropoutUnknown && designs.some(d => d.measuredRate) ? `<p class="ab-secondary">Among people who finished with success measured: ${designs.map(d => d.measuredRate ? `${letter(d.index)} ${pct(d.measuredRate.p)} (${d.measuredRate.k}/${d.measuredRate.n})` : `${letter(d.index)} —`).join(' · ')}${comparisons.filter(c => c.measured).map(c => `; ${letter(c.design.index)} vs ${letter(0)} ${pts(c.measured.d)} (${pts(c.measured.lo)} to ${pts(c.measured.hi)})`).join('')}. Secondary: these leave out people who dropped out or weren't measured.</p>` : '';
    const warns = checks.filter(c => c.level === 'warn').length;
    const provisional = plan && minAssigned < plan.perDesign
      ? `<p class="ab-provisional"><strong>Provisional.</strong> With ${minAssigned} people in the smallest group${planned ? ` (planned: ${planned.perDesign} per design)` : ''}, only differences of ${detectable ? `about ${Math.round(detectable * 100)} points or more` : 'very large size'} would reliably show up. Decide the sample size before fielding (planner below) and judge results once it is reached: checking repeatedly and stopping when results look good raises false positives.</p>` : '';
    lead = `<div class="ab-lead"><p><strong>${measureName}</strong>, ${basis}: ${rates}</p><ul>${lines}</ul>${secondary}${provisional}${warns ? `<p class="notice warning">Read with care: ${warns} data check${warns === 1 ? '' : 's'} below need${warns === 1 ? 's' : ''} attention.</p>` : ''}${!hasSignal ? '<p class="analysis-subtitle">No success signal is set for this activity, so designs are compared on self-reported completion.</p>' : ''}</div>`;
  }
  // ---- charts ----
  const rateRows = designs.filter(d => d.primary).map(d => ({ name: d.label, v: d.primary.p, lo: d.primary.lo, hi: d.primary.hi, text: `${pct(d.primary.p)} (${pct(d.primary.lo)}–${pct(d.primary.hi)})`, tip: `${d.label}: ${pct(d.primary.p)}, 95% range ${pct(d.primary.lo)} to ${pct(d.primary.hi)}, ${d.primary.k} of ${d.primary.n}` }));
  const rateChart = rateRows.length ? dotWhiskerSVG(rateRows, { min: 0, max: 1, ticks: [0, .25, .5, .75, 1], fmt: v => pct(v), label: `${measureName} by design (${basis}) with 95% ranges: ${rateRows.map(r => `${r.name} ${r.text}`).join('; ')}` }, esc) : '';
  const diffRows = comparisons.filter(c => c.primary).map(c => ({ name: `${letter(c.design.index)} vs ${letter(0)}`, v: c.primary.d, lo: c.primary.lo, hi: c.primary.hi, text: `${pts(c.primary.d)} (${pts(c.primary.lo)} to ${pts(c.primary.hi)})`, tip: `${letter(c.design.index)} minus ${letter(0)}: ${pts(c.primary.d)} points, ${confText} range ${pts(c.primary.lo)} to ${pts(c.primary.hi)}` }));
  const lim = Math.max(0.1, ...diffRows.flatMap(r => [Math.abs(r.lo), Math.abs(r.hi)]));
  const span = Math.min(1, Math.ceil(lim * 10) / 10);
  const diffChart = diffRows.length ? dotWhiskerSVG(diffRows, { min: -span, max: span, ticks: [-span, -span / 2, 0, span / 2, span], fmt: v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)}`, zero: 0, label: `Difference from design ${letter(0)} in percentage points with ${confText} ranges: ${diffRows.map(r => `${r.name} ${r.text}`).join('; ')}` }, esc) : '';
  const charts = rateChart ? `<div class="ab-charts"><figure><figcaption>${measureName} by design, ${dropoutUnknown ? 'finishers only' : 'everyone assigned'} <span>dot = rate, line = 95% range</span></figcaption>${rateChart}</figure>${diffChart ? `<figure><figcaption>Difference from ${letter(0)} (percentage points) <span>right of the zero line = higher than ${letter(0)}; line = ${confText} range</span></figcaption>${diffChart}</figure>` : ''}</div>` : '';
  // ---- tables ----
  const cell = w => w ? `${pct(w.p)} <small>${w.k}/${w.n} · ${pct(w.lo)}–${pct(w.hi)}</small>` : '—';
  const timeCell = t => t?.m == null ? '—' : `${secs(t.m)}${t.lo == null ? ' <small>too few for a range</small>' : t.lo === t.hi ? ' <small>range not estimable (tied values)</small>' : ` <small>${secs(t.lo)}–${secs(t.hi)}</small>`}`;
  const rows = designs.map(d => `<tr><th scope="row">${esc(d.label)}${d.variant.revision ? `<div class="muted tiny">Version: ${esc(d.variant.revision)}</div>` : ''}</th><td>${d.assigned}</td><td>${d.finished}</td><td>${d.dropped == null ? 'unknown' : `${d.dropped}${d.assigned ? ` <small>${pct(d.dropped / d.assigned)}</small>` : ''}`}</td><td>${cell(d.primary)}</td>${hasSignal ? `<td>${cell(d.measuredRate)}</td>` : ''}<td>${cell(d.self)}</td>${hasSignal ? `<td>${cell(d.overclaim)}${d.underclaim ? ` <small>${d.underclaim} said they couldn't but did</small>` : ''}</td>` : ''}<td>${timeCell(d.time)}</td><td>${timeCell(d.successTime)}</td><td>${d.clicks == null ? '—' : d.clicks.toFixed(1).replace(/\.0$/, '')}</td></tr>`).join('');
  const table = `<div class="table-scroll"><table class="data-table ab-table"><thead><tr><th>Design</th><th>${dropoutUnknown ? 'Finished (assigned unknown)' : 'Assigned'}</th><th>Finished</th><th>Dropped out</th><th>${measureName}, ${dropoutUnknown ? 'finishers' : 'everyone assigned'} <small>main measure</small></th>${hasSignal ? '<th>Success signal, measured finishers <small>secondary</small></th>' : ''}<th>Self-reported complete, finishers <small>secondary</small></th>${hasSignal ? '<th>Said they completed it but didn\'t <small>measured finishers</small></th>' : ''}<th>Median active time <small>secondary</small></th><th>Median time to success${hasSignal ? ' <small>from the success signal</small>' : ''}</th><th>Median clicks</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const cmpRow = (name, f) => `<tr><th scope="row">${name}</th>${comparisons.map(c => `<td>${f(c)}</td>`).join('')}</tr>`;
  const rangeTxt = r => r ? `${pts(r.d)} pts <small>${pts(r.lo)} to ${pts(r.hi)}</small>` : '—';
  const cmp = comparisons.length ? `<div class="table-scroll"><table class="data-table ab-table"><thead><tr><th>Difference from ${letter(0)}</th>${comparisons.map(c => `<th>${letter(c.design.index)} vs ${letter(0)}</th>`).join('')}</tr></thead><tbody>${cmpRow(`${measureName}, ${dropoutUnknown ? 'finishers' : 'everyone assigned'} <small>main measure</small>`, c => rangeTxt(c.primary))}${hasSignal ? cmpRow('Success signal, measured finishers <small>secondary</small>', c => rangeTxt(c.measured)) : ''}${cmpRow('Self-reported complete <small>secondary</small>', c => rangeTxt(c.self))}${cmpRow('Median active time <small>secondary</small>', c => c.time ? `${signedSecs(c.time.d)}${c.time.lo == null ? ' <small>too few for a range</small>' : c.time.lo === c.time.hi ? ' <small>range not estimable</small>' : ` <small>${signedSecs(c.time.lo)} to ${signedSecs(c.time.hi)}</small>`}` : '—')}</tbody></table></div><p class="analysis-subtitle">Difference ranges are ${confText} confidence intervals${conf !== 0.95 ? `, widened from 95% because ${comparisons.length} designs are each compared with ${letter(0)}` : ''}; each design's own range is 95%. Overlapping ranges in the chart above are not a test: use the difference ranges. Secondary measures are for context and are not adjusted for being several looks at the same data. Active time excludes time away after a page reload and includes both successful and unsuccessful attempts.</p>` : '';
  // ---- checks ----
  const icon = l => l === 'ok' ? '✓' : l === 'warn' ? '!' : 'i';
  const word = l => l === 'ok' ? 'OK' : l === 'warn' ? 'Needs attention' : 'Note';
  const checkList = checks.length ? `<ul class="ab-checks">${checks.map(c => `<li class="ab-check-${c.level}"><span class="ab-check-icon" aria-hidden="true">${icon(c.level)}</span><span class="sr-only">${word(c.level)}:</span> <strong>${esc(c.title)}.</strong> ${esc(c.text)}</li>`).join('')}</ul>` : '<p class="muted small">Checks appear once people have taken part.</p>';
  // ---- planner ----
  const basePct = ep ? Number(ep.baseline) : Math.round(Math.min(0.95, Math.max(0.05, designs[0].primary?.p ?? 0.5)) * 100);
  const planner = `<div class="ab-planner" data-planner data-designs="${designs.length}" data-measured="${minAssigned}"><div class="ab-planner-inputs"><label class="field">Expected ${hasSignal ? 'success' : 'completion'} rate for ${letter(0)} (%)<input type="number" min="1" max="99" step="1" value="${basePct}" data-plan="baseline"></label><label class="field">Smallest difference worth finding (points)<input type="number" min="1" max="60" step="1" value="${ep ? Number(ep.difference) : 15}" data-plan="difference"></label><label class="field">Power<select data-plan="power"><option value="0.8" ${Number(ep?.power) !== 0.9 ? 'selected' : ''}>80% (common)</option><option value="0.9" ${Number(ep?.power) === 0.9 ? 'selected' : ''}>90%</option></select></label></div><p class="ab-planner-out" data-plan-out aria-live="polite"></p></div>`;
  const planBox = planInfo ? `<div class="ab-plan"><p><strong>Study plan</strong> · ${planInfo.locked ? `locked ${esc(fmtDate(planInfo.locked.at))}${planInfo.changes ? `, ${planInfo.changes} change${planInfo.changes === 1 ? '' : 's'} recorded since` : ', no changes since'}` : 'not locked'}. Control: ${esc(`A · ${planInfo.control?.label || ''}`)}. Primary measure: ${esc(PRIMARY[planInfo.primary])}, everyone assigned.${planInfo.planned ? ` Target: ${planInfo.planned.perDesign} people per design; smallest group now ${minAssigned}.` : ''}</p>${hypotheses.length ? `<ul class="ab-hyps">${hypotheses.map(h => `<li class="ab-hyp-${h.status}"><strong>H${h.n}.</strong> ${esc(h.sentence)}<br><span class="ab-hyp-result">${h.value ? `${esc(h.value)}. ` : ''}${esc(h.text)}${h.secondary ? ' (Measured on a secondary measure.)' : ''}</span></li>`).join('')}</ul>` : '<p class="muted small">No hypotheses in the plan.</p>'}</div>` : '';
  return `${planBox}${lead}${charts}<h4>All results by design</h4>${table}${cmp ? `<h4>Differences from ${letter(0)} (baseline)</h4>${cmp}` : ''}<h4>Data checks</h4>${checkList}<h4>How many people do you need?</h4>${planner}`;
}

// Planner text; called on render and on input (admin.js). `measured` = people assigned in the smallest group.
export function plannerText({ baseline, difference, power, designs, measured }) {
  const plan = planStudy({ baseline: baseline / 100, difference: difference / 100, designs, power });
  if (!plan) return 'Enter a rate between 1 and 99% and a difference that keeps the target between 0 and 100%.';
  const article = /^(8|11|18)/.test(String(Math.round(power * 100))) ? 'an' : 'a';
  const target = Math.round(plan.target * 100);
  return `About ${plan.perDesign} people assigned per design (${plan.total} in total) to have ${article} ${Math.round(power * 100)}% chance of detecting a change from ${baseline}% to ${target}%${plan.direction === 'down' && baseline + difference >= 100 ? ` (planned as a drop, since ${baseline + difference}% is not possible)` : ''}${designs > 2 ? `, with significance adjusted for ${designs - 1} comparisons` : ''}. The smallest group has ${measured} so far. Fix this number before fielding and stop only when it is reached; stopping when results look good raises false positives. Recruit a little more to allow for people who leave.`;
}
