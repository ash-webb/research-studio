// Activity planners for non-A/B methods (v0.3.9): objective, research questions answered,
// method-specific goal, success criterion or benchmark, sample-size guidance, standard analysis,
// Word blocks and the plan check shown with results. A/B experiments are planned in plan.js.
import { normalizeMethod, pairwiseSimilarity } from './methods.js';
import { wilson, sampleSizeForMargin, marginAt, sampleSizeVsHalf, benchmarkVerdict } from './abstats.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = p => `${Math.round(p * 100)}%`;
const num = v => (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Number(v);
export const PLANNED_METHODS = ['prototype', 'card_sort', 'tree_test', 'first_click', 'preference', 'survey'];

export const GOALS = {
  prototype: { measure: 'Measure how many complete the task', discover: 'Find usability problems' },
  card_sort: { explore: 'Explore how people group the content', validate: 'Check whether people agree with our categories' }
};
const BENCH_LABEL = { prototype: 'task success', tree_test: 'task success (correct destination)', first_click: 'first-click success (click in a target area)' };

export function newActivityPlan(task) {
  const m = normalizeMethod(task);
  const base = { method: m, objective: '', rqs: [], criteria: '', margin: 10 };
  if (m === 'prototype') return { ...base, goal: task.successSignal ? 'measure' : 'discover', measure: task.successSignal ? 'success' : 'self', benchmark: null, rounds: 2, perRound: 6 };
  if (m === 'tree_test') return { ...base, benchmark: null, directBenchmark: null };
  if (m === 'first_click') return { ...base, benchmark: null };
  if (m === 'card_sort') return { ...base, goal: task.sortMode === 'open' ? 'explore' : 'validate', threshold: 60, target: 20 };
  if (m === 'preference') return { ...base, split: 60, power: 0.8 };
  if (m === 'survey') return { ...base, constructs: '' };
  return base;
}
// Keeps one plan per activity (by ID), reset when the activity changes method.
export function ensureActivityPlans(study, plan) {
  plan.activities ||= {};
  for (const t of study.tasks || []) {
    const m = normalizeMethod(t);
    if (!PLANNED_METHODS.includes(m)) continue;
    if (!plan.activities[t.id] || plan.activities[t.id].method !== m) plan.activities[t.id] = newActivityPlan(t);
    const ap = plan.activities[t.id]; ap.rqs ||= [];
    if (m === 'prototype' && ap.measure === 'success' && !t.successSignal) ap.measure = 'self';
  }
  return plan.activities;
}
export function renamePlanActivity(plan, from, to) {
  if (!plan?.activities || from === to || !plan.activities[from] || plan.activities[to]) return;
  plan.activities[to] = plan.activities[from]; delete plan.activities[from];
}
// Keep research-question links pointing at the same questions after one is removed.
export function removeResearchQuestion(plan, index) {
  for (const ap of Object.values(plan.activities || {})) ap.rqs = (ap.rqs || []).filter(i => i !== index).map(i => i > index ? i - 1 : i);
}

// ---------- sample size ----------
export function activitySize(task, ap) {
  const m = normalizeMethod(task), margin = (num(ap.margin) || 10) / 100;
  const p = num(ap.benchmark) != null ? Math.min(0.95, Math.max(0.05, num(ap.benchmark) / 100)) : 0.5;
  if (m === 'prototype' && ap.goal === 'discover') {
    const per = Math.max(1, num(ap.perRound) || 6), rounds = Math.max(1, num(ap.rounds) || 2);
    return { n: per, total: per * rounds, text: `${per} people per round, ${rounds} round${rounds === 1 ? '' : 's'} (${per * rounds} in total), fixing problems between rounds. Small rounds find many of the most common problems; problems few people meet need more participants. Results describe problems, not rates for the whole population.` };
  }
  if (m === 'card_sort' && ap.goal === 'explore') {
    const n = Math.max(5, num(ap.target) || 20);
    return { n, text: `About ${n} people completing the sort. For open card sorts, 15–30 is common practice; similarity scores tend to settle at around 15–20 participants (Tullis & Wood, 2004).` };
  }
  if (m === 'preference') {
    const split = (num(ap.split) || 60) / 100, n = sampleSizeVsHalf(split, { power: Number(ap.power) || 0.8 });
    return n ? { n, text: `About ${n} people choosing between two options, to tell a ${Math.round(split * 100)}/${100 - Math.round(split * 100)} split from 50/50 with ${Math.round((Number(ap.power) || 0.8) * 100)}% power. "No preference" answers and a third option need more people.` } : { n: null, text: 'Enter a split other than 50%.' };
  }
  const n = sampleSizeForMargin(p, margin);
  if (!n) return { n: null, text: 'Enter a margin between 1 and 49 points.' };
  const what = m === 'card_sort' ? 'the share placing a card in a category' : m === 'survey' ? 'a percentage answer' : `${BENCH_LABEL[m] || 'the rate'}`;
  const extra = m === 'tree_test' ? ' Many teams recruit about 50 per tree.' : '';
  return { n, text: `About ${n} people completing the activity, so that ${what} near ${Math.round(p * 100)}% is estimated to within about ±${Math.round(margin * 100)} points (95% interval).${extra} Recruit extra for drop-out.` };
}

// ---------- standard analysis text ----------
export function activityAnalysis(task, ap) {
  const m = normalizeMethod(task), b = num(ap.benchmark);
  const bench = b != null ? ` Compare with the benchmark of ${b}%: above if the whole 95% interval is above it, below if the whole interval is below it, otherwise inconclusive.` : '';
  const denom = 'People who started the activity but did not finish count as not successful.';
  if (m === 'prototype') return ap.goal === 'discover'
    ? 'List usability problems from click histories and follow-up answers, with the number of participants who met each and its severity. Counts describe this sample and are not population rates. Report self-reported completion and time for context.'
    : `Report the share who completed the task (${ap.measure === 'success' ? `success signal "${task.successSignal}"` : 'self-reported completion'}) with a 95% Wilson interval. ${denom}${bench} Report median active time and follow-up answers for context.`;
  if (m === 'tree_test') return `Report task success (ended at a correct destination) with a 95% Wilson interval, directness (no backtracking), first-level choices and the most common wrong destinations. ${denom}${bench}${num(ap.directBenchmark) != null ? ` Compare directness with ${num(ap.directBenchmark)}% the same way.` : ''}`;
  if (m === 'first_click') return `Report the share whose first click landed in a target area ("Not sure" counts as a miss) with a 95% Wilson interval, the click map and the most common wrong areas. ${denom}${bench}`;
  if (m === 'card_sort') return ap.goal === 'explore'
    ? `Use completed sorts. Report the similarity matrix (share of participants who grouped each pair together), common group names and cards with no clear home (no partner grouped with it by at least ${num(ap.threshold) ?? 60}% of participants). Group names are not merged automatically.`
    : `Use completed sorts. For each card, report the share placing it in each category with 95% intervals. Cards whose most common category falls below ${num(ap.threshold) ?? 60}% agreement are flagged for review.`;
  if (m === 'preference') return 'Report the share choosing each option with 95% Wilson intervals. With two options, report whether the interval for the leading option excludes 50%. Summarise reasons from follow-up answers. Preference is not performance: compare with task results where available. Presentation order is randomised.';
  if (m === 'survey') return `Summarise each question: distribution and median for scales, counts and percentages with 95% intervals for choices, and themes for open text.${ap.constructs?.trim() ? ` Questions are grouped by what they measure: ${ap.constructs.trim()}.` : ''}`;
  return '';
}

// ---------- editor ----------
export function rqLinksHTML(task, ap, plan) {
  const id = task.id;
  const rqs = (plan.researchQuestions || []).map((q, i) => q.trim() ? `<label><input type="checkbox" data-plan-act="${esc(id)}" data-plan-act-rq="${i}" ${ap.rqs.includes(i) ? 'checked' : ''}> RQ${i + 1}: ${esc(q.length > 90 ? q.slice(0, 87) + '…' : q)}</label>` : '').join('');
  return rqs ? `<fieldset class="plan-checks plan-rq-links"><legend>Research questions it answers</legend>${rqs}</fieldset>` : '';
}
const attr = (id, f) => `data-plan-act="${esc(id)}" data-field="${f}"`;
const numField = (id, f, label, value, small = '', min = 1, max = 99) => `<label class="field">${label}${small ? `<small>${small}</small>` : ''}<input type="number" min="${min}" max="${max}" ${attr(id, f)} value="${esc(value ?? '')}"></label>`;
export function activityPlanHTML(task, ap, plan, index) {
  const m = normalizeMethod(task), id = task.id;

  const goal = GOALS[m] ? `<label class="field">Goal<select ${attr(id, 'goal')}>${Object.entries(GOALS[m]).map(([k, l]) => `<option value="${k}" ${ap.goal === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : '';
  let specific = '';
  if (m === 'prototype') specific = ap.goal === 'discover'
    ? `<div class="form-grid">${numField(id, 'perRound', 'People per round', ap.perRound, '', 1, 30)}${numField(id, 'rounds', 'Rounds', ap.rounds, '', 1, 10)}</div>`
    : `<div class="form-grid"><label class="field">Success measure<select ${attr(id, 'measure')}><option value="success" ${ap.measure === 'success' ? 'selected' : ''} ${task.successSignal ? '' : 'disabled'}>Success signal${task.successSignal ? ` (${esc(task.successSignal)})` : ' (none set)'}</option><option value="self" ${ap.measure === 'self' ? 'selected' : ''}>Self-reported completion</option></select></label>${numField(id, 'benchmark', 'Benchmark success rate (%)', ap.benchmark, 'Optional. The rate you want to reach, e.g. 75')}${numField(id, 'margin', 'Precision wanted (± points)', ap.margin, '', 1, 49)}</div>`;
  if (m === 'tree_test') specific = `<div class="form-grid">${numField(id, 'benchmark', 'Benchmark success rate (%)', ap.benchmark, 'Optional, e.g. 70')}${numField(id, 'directBenchmark', 'Benchmark directness (%)', ap.directBenchmark, 'Optional')}${numField(id, 'margin', 'Precision wanted (± points)', ap.margin, '', 1, 49)}</div><p class="helper">Correct destinations are set in the activity: ${esc((task.correctNodeIds || []).join(', ') || 'none yet')}.</p>`;
  if (m === 'first_click') specific = `<div class="form-grid">${numField(id, 'benchmark', 'Benchmark first-click success (%)', ap.benchmark, 'Optional, e.g. 80')}${numField(id, 'margin', 'Precision wanted (± points)', ap.margin, '', 1, 49)}</div><p class="helper">${(task.targetAreas || []).length ? `${task.targetAreas.length} target area(s) set in the activity.` : 'No target areas yet: add them in the activity to score first clicks.'}</p>`;
  if (m === 'card_sort') specific = `<div class="form-grid">${numField(id, 'threshold', 'Agreement threshold (%)', ap.threshold, ap.goal === 'explore' ? 'Pairs grouped together by at least this share count as strong' : 'Cards placed in their top category by fewer than this share are flagged', 10, 100)}${ap.goal === 'explore' ? numField(id, 'target', 'Target participants', ap.target, '', 5, 500) : numField(id, 'margin', 'Precision wanted (± points)', ap.margin, '', 1, 49)}</div><p class="helper">${esc(task.sortMode || 'open')} sort with ${(task.cards || []).length} cards${task.categories?.length ? ` and ${task.categories.length} categories` : ''}.</p>`;
  if (m === 'preference') specific = `<div class="form-grid">${numField(id, 'split', 'Smallest split worth finding (% choosing one option)', ap.split, 'e.g. 60 means a 60/40 split', 51, 95)}<label class="field">Power<select ${attr(id, 'power')}><option value="0.8" ${Number(ap.power) !== 0.9 ? 'selected' : ''}>80% (common)</option><option value="0.9" ${Number(ap.power) === 0.9 ? 'selected' : ''}>90%</option></select></label></div>`;
  if (m === 'survey') specific = `<label class="field">What the questions measure <small>Optional, e.g. ease, confidence, trust</small><input ${attr(id, 'constructs')} value="${esc(ap.constructs)}"></label><div class="form-grid">${numField(id, 'margin', 'Precision wanted (± points)', ap.margin, '', 1, 49)}</div>`;
  const size = activitySize(task, ap);
  return `<div class="plan-exp plan-activity" data-plan-act-block="${esc(id)}"><h4>${index + 1}. ${esc(task.title || id)} <span class="muted">· ${esc(methodLabel(m))}</span></h4>
    <label class="field">What this activity should tell you${`<textarea rows="2" ${attr(id, 'objective')}>${esc(ap.objective)}</textarea>`}</label>
    <div data-plan-rq-links="${esc(id)}">${rqLinksHTML(task, ap, plan)}</div>
    ${goal}${specific}
    <p class="plan-size-out" data-plan-act-size="${esc(id)}" aria-live="polite">${esc(size.text)}</p>
    <label class="field">What result would be good enough, and what you would do <small>Optional</small><textarea rows="2" ${attr(id, 'criteria')}>${esc(ap.criteria)}</textarea></label>
    <details class="plan-act-analysis"><summary>Standard analysis for this activity</summary><p data-plan-act-analysis="${esc(id)}">${esc(activityAnalysis(task, ap))}</p></details></div>`;
}
const methodLabel = m => ({ prototype: 'Prototype usability', card_sort: 'Card sort', tree_test: 'Tree test', first_click: 'First click', preference: 'Preference', survey: 'Survey' }[m] || m);

// ---------- validation ----------
export function validateActivityPlans(plan, study) {
  const tasks = new Map((study.tasks || []).map(t => [t.id, t]));
  for (const [id, ap] of Object.entries(plan.activities || {})) {
    if (!ap || typeof ap !== 'object') throw new Error(`Study plan: activity ${id} plan must be an object.`);
    const t = tasks.get(id); if (!t) continue;
    for (const k of ['objective', 'criteria', 'constructs']) if (ap[k] != null && (typeof ap[k] !== 'string' || ap[k].length > 3000)) throw new Error(`Study plan: ${k} for activity ${id} must be text of 3000 characters or fewer.`);
    if (ap.goal && GOALS[normalizeMethod(t)] && !(ap.goal in GOALS[normalizeMethod(t)])) throw new Error(`Study plan: unknown goal for activity ${id}.`);
    for (const [k, lo, hi] of [['benchmark', 1, 99], ['directBenchmark', 1, 99], ['margin', 1, 49], ['threshold', 10, 100], ['split', 51, 95], ['target', 5, 500]]) {
      const v = num(ap[k]); if (ap[k] != null && ap[k] !== '' && (v == null || v < lo || v > hi)) throw new Error(`Study plan: ${k} for activity ${id} must be between ${lo} and ${hi}.`);
    }
    if (ap.rqs != null && (!Array.isArray(ap.rqs) || ap.rqs.some(i => !Number.isInteger(i)))) throw new Error(`Study plan: research-question links for ${id} must be a list of numbers.`);
  }
}

// ---------- Word blocks ----------
export function activityDocxBlocks(task, ap, plan, add) {
  const m = normalizeMethod(task), size = activitySize(task, ap);
  const rq = ap.rqs.map(i => plan.researchQuestions?.[i]?.trim() ? `RQ${i + 1}` : null).filter(Boolean);
  const rows = [['Item', 'Plan'], ['Method', methodLabel(m)], ['What it should tell us', ap.objective?.trim() || '—'], ['Research questions', rq.join(', ') || '—']];
  if (GOALS[m]) rows.push(['Goal', GOALS[m][ap.goal] || '—']);
  if (m === 'prototype' && ap.goal !== 'discover') rows.push(['Success measure', ap.measure === 'success' ? `Success signal (${task.successSignal})` : 'Self-reported completion']);
  if (['prototype', 'tree_test', 'first_click'].includes(m) && !(m === 'prototype' && ap.goal === 'discover')) rows.push(['Benchmark', num(ap.benchmark) != null ? `${num(ap.benchmark)}% ${BENCH_LABEL[m]}` : 'None']);
  if (m === 'tree_test') rows.push(['Correct destinations', (task.correctNodeIds || []).join(', ') || '—'], ['Directness benchmark', num(ap.directBenchmark) != null ? `${num(ap.directBenchmark)}%` : 'None']);
  if (m === 'card_sort') rows.push(['Sort type', `${task.sortMode || 'open'} (${(task.cards || []).length} cards${task.categories?.length ? `, ${task.categories.length} categories` : ''})`], ['Agreement threshold', `${num(ap.threshold) ?? 60}%`]);
  if (m === 'preference') rows.push(['Options', (task.variants || []).map(v => v.label).join(', ')]);
  if (m === 'survey' && ap.constructs?.trim()) rows.push(['What the questions measure', ap.constructs.trim()]);
  rows.push(['Sample size', size.text], ['Good enough, and next steps', ap.criteria?.trim() || '—'], ['Analysis', activityAnalysis(task, ap)]);
  add('table', null, { rows, widths: [0.28, 0.72] });
}

// ---------- check against the plan, shown with results ----------
function startedCount(flat, taskId, finished) {
  const s = new Set((flat.starts || []).filter(x => x.task_id === taskId).map(x => x.session_id));
  for (const t of finished) s.add(t.session_id);
  return s.size;
}
const verdictText = { above: 'Above the benchmark: the whole interval is above it.', below: 'Below the benchmark: the whole interval is below it.', inconclusive: 'Inconclusive: the interval includes the benchmark.' };
const rateLine = (name, w) => `${name}: <strong>${pct(w.p)}</strong> (${w.k} of ${w.n}; 95% range ${pct(w.lo)}–${pct(w.hi)})`;
export function activityPlanCheck(task, ap, data, flat) {
  const m = normalizeMethod(task), size = activitySize(task, ap), lines = [];
  const finished = data.length, started = startedCount(flat, task.id, data);
  const bench = num(ap.benchmark) != null ? num(ap.benchmark) / 100 : null;
  const judge = (name, w, b) => { if (!w) return; let t = rateLine(name, w); if (b != null) t += `. Benchmark ${pct(b)}: ${verdictText[benchmarkVerdict(w, b)]}`; lines.push(t); };
  if (m === 'prototype' && ap.goal !== 'discover') {
    const k = ap.measure === 'success' ? data.filter(t => t.tracker_connected && t.result?.success_signal_status === 'received').length : data.filter(t => t.self_report === 'completed').length;
    judge(ap.measure === 'success' ? 'Task success (success signal), everyone who started' : 'Self-reported completion, everyone who started', wilson(k, started), bench);
  }
  if (m === 'tree_test') { judge('Task success, everyone who started', wilson(data.filter(t => t.result?.success).length, started), bench); judge('Direct success', wilson(data.filter(t => t.result?.direct).length, started), num(ap.directBenchmark) != null ? num(ap.directBenchmark) / 100 : null); }
  if (m === 'first_click') {
    if ((task.targetAreas || []).length) judge('First-click success, everyone who started', wilson(data.filter(t => t.result?.hit_target === true).length, started), bench);
    else lines.push('Unscored: no target areas, so first-click success cannot be compared with the plan.');
  }
  if (m === 'card_sort') {
    const complete = data.filter(t => t.result?.completed === true).map(t => t.result), cards = task.cards || [], th = (num(ap.threshold) ?? 60) / 100;
    if (complete.length) {
      if (ap.goal === 'explore') {
        const sim = pairwiseSimilarity(complete, cards); let strong = 0; const lonely = [];
        cards.forEach((c, i) => { let has = false; cards.forEach((_, j) => { if (i !== j && sim[i][j].percent != null && sim[i][j].percent / 100 >= th) { has = true; if (j > i) strong++; } }); if (!has) lonely.push(c.label); });
        lines.push(`${strong} card pair${strong === 1 ? '' : 's'} grouped together by at least ${pct(th)} of participants.`);
        lines.push(lonely.length ? `No clear home (no partner at ${pct(th)} or more): ${esc(lonely.slice(0, 12).join(', '))}${lonely.length > 12 ? ` and ${lonely.length - 12} more` : ''}.` : `Every card has at least one partner at ${pct(th)} or more.`);
      } else {
        const weak = [];
        for (const c of cards) {
          const counts = new Map(); let n = 0;
          for (const r of complete) { const g = r.groups?.[c.id]; if (!g) continue; n++; const label = (r.categories || []).find(x => x.id === g)?.label || g; counts.set(label, (counts.get(label) || 0) + 1); }
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
          if (n && top[1] / n < th) weak.push(`${c.label} (${pct(top[1] / n)} in ${top[0]})`);
        }
        lines.push(weak.length ? `Below ${pct(th)} agreement on a category: ${esc(weak.slice(0, 10).join('; '))}${weak.length > 10 ? ` and ${weak.length - 10} more` : ''}.` : `Every card's most common category reaches ${pct(th)} agreement.`);
      }
    } else lines.push('No completed sorts yet.');
  }
  if (m === 'preference') {
    const chose = data.filter(t => t.result?.selected_id), opts = (task.variants || []).map(v => ({ v, k: chose.filter(t => t.result.selected_id === v.id).length })).sort((a, b) => b.k - a.k);
    if (chose.length && opts.length) {
      const w = wilson(opts[0].k, chose.length);
      lines.push(`${rateLine(`Chose ${esc(opts[0].v.label)} (of those who chose)`, w)}${opts.length === 2 ? `. ${w.lo > 0.5 ? 'The interval excludes 50%: a clear preference in this sample.' : 'The interval includes 50%: no clear preference yet.'}` : ''}`);
      const none = data.filter(t => t.result?.no_preference).length; if (none) lines.push(`${none} chose "No preference".`);
    }
  }
  if (m === 'survey') { const mg = marginAt(finished); if (mg) lines.push(`With ${finished} completions, a 50% answer has a 95% range of about ±${Math.round(mg * 100)} points.`); }
  const target = size.n ? `Target ${size.total ? `${size.n} per round (${size.total} in total)` : size.n}; ${m === 'prototype' && ap.goal === 'discover' ? `${finished} finished so far` : `${finished} finished${started > finished ? `, ${started} started` : ''}`}.` : '';
  const reached = size.n && !size.total && finished < size.n ? ' <em>Target not yet reached: treat results as provisional.</em>' : '';
  return `<div class="ab-plan"><p><strong>Activity plan</strong>${ap.objective?.trim() ? ` · ${esc(ap.objective.trim())}` : ''}${GOALS[m] ? ` · Goal: ${esc(GOALS[m][ap.goal])}` : ''}. ${target}${reached}</p>${lines.length ? `<ul class="ab-hyps">${lines.map(l => `<li>${l}</li>`).join('')}</ul>` : ''}${ap.criteria?.trim() ? `<p class="small muted">Planned: ${esc(ap.criteria.trim())}</p>` : ''}</div>`;
}
