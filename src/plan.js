// Study plan (v0.3.8): research questions, participants, control/treatment roles, hypotheses,
// measures, sample size, analysis plan and decisions, plus lock + change log and a Word export.
// The plan is saved with the researcher's working copy of the study; it is left out of the
// study JSON that is published for participants.
import { normalizeMethod } from './methods.js';
import { planStudy } from './abstats.js';
import { buildDocx } from './docx.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const letter = i => String.fromCharCode(65 + i);
export const PRIMARY = { success: 'Task success (success signal)', self: 'Self-reported completion' };
export const SECONDARY = { measured: 'Success among finishers with success measured', self: 'Self-reported completion', time: 'Active time on task', success_time: 'Time for successful attempts', clicks: 'Clicks in the design', dropout: 'Drop-out by design', followup: 'Follow-up question answers' };
export const HYP_MEASURES = { success: 'task success', self: 'self-reported completion', time: 'active time on task' };
export const DEVICES = { any: 'Any device', mostly_phone: 'Mostly phones', mostly_desktop: 'Mostly computers', phone: 'Phones only', desktop: 'Computers only' };
const STOP_DEFAULT = 'Field until the target sample is reached in every design, then analyse once. No early stopping based on results.';

// ---------- model ----------
export function experimentsOf(study) {
  const map = new Map();
  for (const t of study.tasks || []) {
    if (normalizeMethod(t) !== 'ab_test') continue;
    const id = t.experimentId || t.id;
    if (!map.has(id)) map.set(id, { id, tasks: [], variants: t.variants || [] });
    map.get(id).tasks.push(t);
  }
  return [...map.values()];
}
function newExperimentPlan(exp) {
  const signal = exp.tasks.some(t => t.successSignal);
  const control = exp.variants[0]?.id || '';
  return {
    controlId: control, treatments: {},
    hypotheses: exp.variants.filter(v => v.id !== control).map((v, i) => ({ id: `h${i + 1}`, treatmentId: v.id, direction: 'higher', measure: signal ? 'success' : 'self', rationale: '' })),
    primaryMeasure: signal ? 'success' : 'self', secondary: ['measured', 'self', 'time', 'dropout'],
    baseline: 50, difference: 15, power: 0.8, stoppingRule: ''
  };
}
// Adds missing parts and keeps the plan in step with the study's experiments and designs.
export function ensurePlan(study) {
  const p = study.plan ||= {};
  p.background ??= ''; p.researchQuestions ||= ['']; p.participants ||= {};
  for (const k of ['audience', 'recruitment', 'exclusions']) p.participants[k] ??= '';
  p.participants.devices ||= 'any';
  p.experiments ||= {}; p.analysis ??= ''; p.decisions ??= ''; p.locked ??= null; p.changes ||= [];
  for (const exp of experimentsOf(study)) {
    const e = p.experiments[exp.id] ||= newExperimentPlan(exp);
    const ids = exp.variants.map(v => v.id);
    if (!ids.includes(e.controlId)) e.controlId = ids[0] || '';
    e.treatments ||= {}; e.hypotheses ||= []; e.secondary ||= [];
    // Control is always shown first (results treat the first design as the baseline).
    if (ids[0] !== e.controlId && e.controlId) applyControl(study, exp.id, e.controlId);
    const treatmentsNow = exp.variants.filter(v => v.id !== e.controlId).map(v => v.id);
    for (const h of e.hypotheses) if (!treatmentsNow.includes(h.treatmentId)) h.treatmentId = treatmentsNow[0] || '';
  }
  return p;
}
export function applyControl(study, expId, controlId) {
  for (const t of study.tasks || []) {
    if (normalizeMethod(t) !== 'ab_test' || (t.experimentId || t.id) !== expId) continue;
    const i = t.variants.findIndex(v => v.id === controlId);
    if (i > 0) { const [v] = t.variants.splice(i, 1); t.variants.unshift(v); delete t._variantErrors; }
  }
  if (study.plan?.experiments?.[expId]) study.plan.experiments[expId].controlId = controlId;
}
export function renamePlanVariant(study, expId, from, to) {
  const e = study.plan?.experiments?.[expId]; if (!e || from === to) return;
  if (e.controlId === from) e.controlId = to;
  if (from in e.treatments) { e.treatments[to] = e.treatments[from]; delete e.treatments[from]; }
  for (const h of e.hypotheses) if (h.treatmentId === from) h.treatmentId = to;
}
export function plannedSize(e, designs) {
  return planStudy({ baseline: Number(e.baseline) / 100, difference: Number(e.difference) / 100, designs, power: Number(e.power) || 0.8 });
}
const label = (exp, id) => { const i = exp.variants.findIndex(v => v.id === id); return i < 0 ? id : `Design ${letter(i)} (${exp.variants[i].label})`; };
export function hypothesisSentence(exp, e, h) {
  const control = label(exp, e.controlId), treat = label(exp, h.treatmentId);
  const m = h.measure;
  const what = m === 'time'
    ? { higher: 'more active time on the task', lower: 'less active time on the task', different: 'a different active time on the task' }[h.direction]
    : `a ${{ higher: 'higher', lower: 'lower', different: 'different' }[h.direction]} ${m === 'self' ? 'self-reported completion rate' : 'task success rate'}`;
  return `Compared with ${control}, the control, ${treat} will ${m === 'time' ? 'need' : 'have'} ${what}.`;
}
export function sizeText(e, designs) {
  const s = plannedSize(e, designs);
  if (!s) return 'Enter an expected control rate between 1 and 99% and a difference that keeps the target between 0 and 100%.';
  return `Recruit about ${s.perDesign} people assigned per design (${s.total} in total), plus extra for drop-out. This gives ${Math.round(s.power * 100) === 80 ? 'an' : 'a'} ${Math.round(s.power * 100)}% chance of detecting a change from ${e.baseline}% to ${Math.round(s.target * 100)}%${s.direction === 'down' && Number(e.baseline) + Number(e.difference) >= 100 ? ` (planned as a drop, since ${Number(e.baseline) + Number(e.difference)}% is not possible)` : ''}${designs > 2 ? `, with significance adjusted for ${designs - 1} comparisons with the control` : ''}.`;
}
// Standard analysis plan, used unless the researcher writes their own.
export function standardAnalysisPlan(study) {
  const exps = experimentsOf(study), plan = study.plan || {};
  if (!exps.length) return 'Report each activity with the method-specific analysis in Research Studio (completion, success where configured, time and follow-up answers). Describe results; do not generalise beyond the sample recruited.';
  return exps.map(exp => {
    const e = plan.experiments?.[exp.id] || newExperimentPlan(exp), n = exp.variants.length, s = plannedSize(e, n);
    const control = label(exp, e.controlId), measure = PRIMARY[e.primaryMeasure] || PRIMARY.success;
    const sec = (e.secondary || []).map(k => SECONDARY[k]).filter(Boolean);
    return [
      `${exps.length > 1 ? `Experiment ${exp.id}. ` : ''}Primary analysis: compare each treatment design with ${control}, the control, on ${measure.toLowerCase()}. Everyone assigned to a design is included in its denominator; people who drop out${e.primaryMeasure === 'success' ? ' or whose success cannot be measured' : ''} count as not successful.`,
      `Report each design's rate with a 95% Wilson score interval and the difference from the control with a Newcombe hybrid score interval${n > 2 ? `, at 97.5% (Bonferroni) because ${n - 1} treatments are each compared with the control` : ''}. An interval that excludes zero is reported as a clear difference; an interval that includes zero is reported as inconclusive, not as evidence that the designs perform the same. No winner is declared automatically: the team judges whether a difference matters in practice.`,
      s ? `Target sample: ${s.perDesign} people assigned per design (${s.total} in total) to detect a change from ${e.baseline}% to ${Math.round(s.target * 100)}% with ${Math.round(s.power * 100)}% power.` : 'Target sample: to be set.',
      `Stopping rule: ${e.stoppingRule?.trim() || STOP_DEFAULT}`,
      'Before interpreting outcomes, check: group sizes (sample-ratio check), drop-out by design, success-tracking coverage by design and device mix. Any problem is reported with the results.',
      sec.length ? `Secondary measures (${sec.join('; ').toLowerCase()}) are reported descriptively with intervals for context and are not used to decide between designs.` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

export const standardHTML = study => standardAnalysisPlan(study).split(/\n+/).map(l => `<p>${esc(l)}</p>`).join('');

// ---------- validation ----------
export function validatePlan(plan, study) {
  if (plan == null) return;
  if (typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Study plan must be an object.');
  const str = (v, name, max = 5000) => { if (v != null && (typeof v !== 'string' || v.length > max)) throw new Error(`Study plan: ${name} must be text of ${max} characters or fewer.`); };
  str(plan.background, 'background'); str(plan.analysis, 'analysis plan', 20000); str(plan.decisions, 'decisions');
  if (plan.researchQuestions != null && (!Array.isArray(plan.researchQuestions) || plan.researchQuestions.length > 30)) throw new Error('Study plan: up to 30 research questions.');
  (plan.researchQuestions || []).forEach((q, i) => str(q, `research question ${i + 1}`, 1000));
  for (const k of ['audience', 'recruitment', 'exclusions']) str(plan.participants?.[k], `participants ${k}`, 2000);
  if (plan.participants?.devices && !(plan.participants.devices in DEVICES)) throw new Error('Study plan: unknown device choice.');
  const exps = new Map(experimentsOf(study).map(x => [x.id, x]));
  for (const [id, e] of Object.entries(plan.experiments || {})) {
    const exp = exps.get(id); if (!exp) continue; // plans for removed experiments are kept but ignored
    if (e.controlId && !exp.variants.some(v => v.id === e.controlId)) throw new Error(`Study plan: the control for ${id} is not one of its designs.`);
    if (e.primaryMeasure && !(e.primaryMeasure in PRIMARY)) throw new Error(`Study plan: unknown primary measure for ${id}.`);
    if ((e.hypotheses || []).length > 20) throw new Error(`Study plan: up to 20 hypotheses per experiment.`);
    for (const h of e.hypotheses || []) {
      if (!['higher', 'lower', 'different'].includes(h.direction) || !(h.measure in HYP_MEASURES)) throw new Error(`Study plan: hypothesis ${h.id || ''} in ${id} needs a direction and a measure.`);
      str(h.rationale, 'hypothesis rationale', 2000);
    }
    for (const [k, v] of Object.entries(e.treatments || {})) str(v, `treatment description for ${k}`, 2000);
    str(e.stoppingRule, 'stopping rule', 2000);
  }
  if (plan.changes != null && !Array.isArray(plan.changes)) throw new Error('Study plan: change log must be a list.');
}

// ---------- editor ----------
const ta = (attr, value, rows = 3, placeholder = '') => `<textarea rows="${rows}" ${attr} placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
export function fmtDate(iso) { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
export function planHTML(study) {
  const p = ensurePlan(study), exps = experimentsOf(study);
  const status = p.locked
    ? `<div class="plan-status plan-locked" role="status"><strong>Plan locked</strong> on ${esc(fmtDate(p.locked.at))}. You can still edit; every change is recorded in the change log below.</div>`
    : '<div class="plan-status"><strong>Draft.</strong> Lock the plan before the study goes live, so changes made after seeing results are on record.</div>';
  const rqs = p.researchQuestions.map((q, i) => `<div class="plan-list-row"><label class="field"><span>Research question ${i + 1}</span><input data-plan-rq="${i}" value="${esc(q)}" placeholder="e.g. Can taxpayers find the status of a service request?"></label><button type="button" class="btn btn-small btn-danger" data-plan-action="remove-rq" data-index="${i}" ${p.researchQuestions.length <= 1 ? 'disabled' : ''} aria-label="Remove research question ${i + 1}">Remove</button></div>`).join('');
  const expHTML = exps.length ? exps.map(exp => {
    const e = p.experiments[exp.id], n = exp.variants.length;
    const titles = exp.tasks.map(t => t.title || t.id).join(', ');
    const designRows = exp.variants.map((v, i) => `<tr><th scope="row">${letter(i)} · ${esc(v.label)}<div class="muted tiny">${esc(v.id)}</div></th><td>${v.id === e.controlId ? '<span class="role-pill role-control">Control</span>' : '<span class="role-pill">Treatment</span>'}</td><td><label class="sr-only" for="tr-${esc(exp.id)}-${esc(v.id)}">What is different in ${esc(v.label)}</label><textarea id="tr-${esc(exp.id)}-${esc(v.id)}" rows="2" data-plan-exp="${esc(exp.id)}" data-plan-treatment="${esc(v.id)}" placeholder="${v.id === e.controlId ? 'e.g. Current live design' : 'What changes compared with the control'}">${esc(e.treatments[v.id] || '')}</textarea></td></tr>`).join('');
    const treatments = exp.variants.filter(v => v.id !== e.controlId);
    const hyps = e.hypotheses.map((h, i) => `<fieldset class="plan-hyp"><legend>H${i + 1}</legend><div class="plan-hyp-grid">${treatments.length > 1 ? `<label class="field">Design<select data-plan-exp="${esc(exp.id)}" data-plan-hyp="${i}" data-field="treatmentId">${treatments.map(v => `<option value="${esc(v.id)}" ${h.treatmentId === v.id ? 'selected' : ''}>${esc(label(exp, v.id))}</option>`).join('')}</select></label>` : ''}<label class="field">Expected result<select data-plan-exp="${esc(exp.id)}" data-plan-hyp="${i}" data-field="direction">${[['higher', 'Higher than control'], ['lower', 'Lower than control'], ['different', 'Different (either way)']].map(([k, l]) => `<option value="${k}" ${h.direction === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="field">Measure<select data-plan-exp="${esc(exp.id)}" data-plan-hyp="${i}" data-field="measure">${Object.entries(HYP_MEASURES).map(([k, l]) => `<option value="${k}" ${h.measure === k ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select></label></div><p class="plan-sentence" data-plan-sentence="${esc(exp.id)}:${i}">${esc(hypothesisSentence(exp, e, h))}</p><label class="field">Why you expect this <small>Optional</small>${ta(`data-plan-exp="${esc(exp.id)}" data-plan-hyp="${i}" data-field="rationale"`, h.rationale, 2)}</label><button type="button" class="btn btn-small btn-danger" data-plan-action="remove-hyp" data-exp="${esc(exp.id)}" data-index="${i}">Remove H${i + 1}</button></fieldset>`).join('');
    return `<div class="plan-exp" data-plan-exp-block="${esc(exp.id)}"><h3>A/B experiment <code>${esc(exp.id)}</code></h3><p class="helper">Activities: ${esc(titles)}. Designs are named and linked in the activity below; set their roles here.</p>
      <label class="field plan-control">Control (baseline) design<select data-plan-exp="${esc(exp.id)}" data-field="controlId">${exp.variants.map((v, i) => `<option value="${esc(v.id)}" ${v.id === e.controlId ? 'selected' : ''}>${letter(i)} · ${esc(v.label)}</option>`).join('')}</select><small>Usually the current design. It is listed first and every other design (treatment) is compared with it.</small></label>
      <div class="table-scroll"><table class="data-table plan-designs"><thead><tr><th>Design</th><th>Role</th><th>What is different (treatment)</th></tr></thead><tbody>${designRows}</tbody></table></div>
      <h4>Hypotheses</h4>${hyps || '<p class="empty-hint">No hypotheses yet.</p>'}<button type="button" class="btn btn-small btn-outline" data-plan-action="add-hyp" data-exp="${esc(exp.id)}">+ Add hypothesis</button>
      <h4>Measures</h4><div class="form-grid"><label class="field">Primary measure<select data-plan-exp="${esc(exp.id)}" data-field="primaryMeasure">${Object.entries(PRIMARY).map(([k, l]) => `<option value="${k}" ${e.primaryMeasure === k ? 'selected' : ''} ${k === 'success' && !exp.tasks.some(t => t.successSignal) ? 'disabled' : ''}>${l}</option>`).join('')}</select><small>Counted over everyone assigned to a design. ${exp.tasks.some(t => t.successSignal) ? '' : 'Task success needs a success signal in the activity.'}</small></label><fieldset class="plan-checks"><legend>Secondary measures <small>for context only</small></legend>${Object.entries(SECONDARY).map(([k, l]) => `<label><input type="checkbox" data-plan-exp="${esc(exp.id)}" data-plan-secondary="${k}" ${e.secondary.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset></div>
      <h4>Sample size</h4><div class="form-grid plan-size"><label class="field">Expected ${e.primaryMeasure === 'self' ? 'completion' : 'success'} rate for the control (%)<input type="number" min="1" max="99" data-plan-exp="${esc(exp.id)}" data-field="baseline" value="${esc(e.baseline)}"></label><label class="field">Smallest difference worth finding (points)<input type="number" min="1" max="60" data-plan-exp="${esc(exp.id)}" data-field="difference" value="${esc(e.difference)}"></label><label class="field">Power<select data-plan-exp="${esc(exp.id)}" data-field="power"><option value="0.8" ${Number(e.power) !== 0.9 ? 'selected' : ''}>80% (common)</option><option value="0.9" ${Number(e.power) === 0.9 ? 'selected' : ''}>90%</option></select></label></div><p class="plan-size-out" data-plan-size="${esc(exp.id)}" aria-live="polite">${esc(sizeText(e, n))}</p>
      <label class="field">Stopping rule${ta(`data-plan-exp="${esc(exp.id)}" data-field="stoppingRule"`, e.stoppingRule, 2, STOP_DEFAULT)}</label></div>`;
  }).join('') : '<p class="empty-hint">Add an A/B implementation test activity below to plan the control and treatment designs, hypotheses, measures and sample size.</p>';
  const activities = (study.tasks || []).map((t, i) => `<li>${i + 1}. ${esc(t.title || t.id)} <span class="muted">· ${(t.questions || []).length} follow-up question${(t.questions || []).length === 1 ? '' : 's'}</span></li>`).join('');
  return planBody(study, p, status, rqs, expHTML, activities);
}
export function changeLogHTML(p) {
  return p.locked ? `<h3>Change log</h3>${p.changes.length ? `<div class="table-scroll"><table class="data-table plan-changes"><thead><tr><th>When</th><th>What changed</th><th>Before</th><th>After</th><th>Reason</th></tr></thead><tbody>${p.changes.map((c, i) => `<tr><td>${esc(fmtDate(c.at))}</td><td>${esc(c.what)}</td><td>${esc(c.before)}</td><td>${esc(c.after)}</td><td><label class="sr-only" for="reason-${i}">Reason for change ${i + 1}</label><input id="reason-${i}" data-no-log data-plan-reason="${i}" value="${esc(c.reason || '')}" placeholder="Optional"></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No changes since the plan was locked.</p>'}` : '';
}
function planBody(study, p, status, rqs, expHTML, activities) {
  return `${status}
    <div class="plan-actions actions-row">${p.locked ? '' : '<button type="button" class="btn btn-secondary" data-plan-action="lock">Lock plan</button>'}<button type="button" class="btn btn-outline" data-plan-action="docx">Download plan (.docx)</button></div>
    <h3>Background and research questions</h3>
    <label class="field">Background <small>Why this study, and what decision it will inform</small>${ta('data-plan-field="background"', p.background, 3)}</label>
    <div class="plan-list">${rqs}</div><button type="button" class="btn btn-small btn-outline" data-plan-action="add-rq">+ Add research question</button>
    <h3>Participants</h3>
    <div class="form-grid"><label class="field">Who takes part<input data-plan-field="participants.audience" value="${esc(p.participants.audience)}" placeholder="e.g. Taxpayers who used the portal in the last year"></label><label class="field">Recruitment<input data-plan-field="participants.recruitment" value="${esc(p.participants.recruitment)}" placeholder="e.g. Qualtrics panel, intake survey with screener"></label><label class="field">Devices<select data-plan-field="participants.devices">${Object.entries(DEVICES).map(([k, l]) => `<option value="${k}" ${p.participants.devices === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="field">Exclusions <small>Optional</small><input data-plan-field="participants.exclusions" value="${esc(p.participants.exclusions)}" placeholder="e.g. IRS employees; duplicate responses"></label></div>
    <h3>Designs, hypotheses and sample size</h3>${expHTML}
    <h3>Tasks and questions</h3><p class="helper">Set in the steps below and included in the plan document: ${study.preQuestions?.length || 0} pre-study question${study.preQuestions?.length === 1 ? '' : 's'}, ${(study.tasks || []).length} activit${(study.tasks || []).length === 1 ? 'y' : 'ies'}, ${study.postQuestions?.length || 0} post-study question${study.postQuestions?.length === 1 ? '' : 's'}.</p><ul class="plan-activities">${activities}</ul>
    <h3>Analysis plan</h3>
    ${p.analysis.trim() ? `<label class="field">Analysis plan <small>Your own text replaces the standard plan.</small>${ta('data-plan-field="analysis"', p.analysis, 10)}</label><button type="button" class="btn btn-small btn-outline" data-plan-action="clear-analysis">Use the standard analysis plan instead</button>` : `<div class="plan-standard"><p class="muted small">Standard analysis plan, used unless you write your own. It updates as you change the plan above.</p><div class="plan-standard-text" data-plan-standard>${standardHTML(study)}</div></div><button type="button" class="btn btn-small btn-outline" data-plan-action="copy-analysis">Edit a copy of this text</button>`}
    <label class="field">How results will be used <small>Decisions or next steps each outcome would lead to</small>${ta('data-plan-field="decisions"', p.decisions, 3)}</label>
    <div data-plan-changes>${changeLogHTML(p)}</div>`;
}

// ---------- Word document ----------
const methodName = { prototype: 'Prototype usability', ab_test: 'A/B implementation test', card_sort: 'Card sort', tree_test: 'Tree test', first_click: 'First click', preference: 'Preference', survey: 'Survey' };
const qType = { text: 'Short text', textarea: 'Long text', scale5: '5-point scale', scale7: '7-point scale', single: 'Single choice', multi: 'Multiple choice' };
const qRows = qs => [['#', 'Question', 'Answer type', 'Required'], ...qs.map((q, i) => [String(i + 1), `${q.text || '(no text)'}${q.options?.length ? `\nOptions: ${q.options.join('; ')}` : ''}${q.type?.startsWith('scale') ? `\n${q.lowLabel || 'Low'} … ${q.highLabel || 'High'}` : ''}`, qType[q.type] || q.type, q.required ? 'Yes' : 'No'])];
const QW = [0.07, 0.55, 0.23, 0.15];
export function planBlocks(study, now = new Date()) {
  const p = ensurePlan(JSON.parse(JSON.stringify(study))), s = { ...study, plan: p }, exps = experimentsOf(s), B = [];
  const add = (type, text, extra = {}) => B.push({ type, text, ...extra });
  add('title', study.title || 'Untitled study');
  add('p', [{ text: 'Study plan', bold: true }, { text: ` · Study ID ${study.id} · version ${study.version || '1.0.0'}` }]);
  add('note', `${p.locked ? `Plan locked on ${fmtDate(p.locked.at)}${p.changes.length ? `; ${p.changes.length} change${p.changes.length === 1 ? '' : 's'} recorded since (see Change log)` : '; no changes since'}.` : 'Draft plan (not locked).'} Generated by Research Studio on ${fmtDate(now.toISOString())}.`);
  add('h1', '1. Background'); add('p', p.background.trim() || 'Not yet written.');
  if (study.description?.trim()) add('note', `Study description: ${study.description.trim()}`);
  add('h1', '2. Research questions');
  const rq = p.researchQuestions.filter(q => q.trim());
  if (rq.length) rq.forEach((q, i) => add('number', q, { n: i + 1 })); else add('p', 'Not yet written.');
  add('h1', '3. Participants');
  add('table', null, { widths: [0.3, 0.7], rows: [['Item', 'Plan'], ['Who takes part', p.participants.audience || '—'], ['Recruitment', p.participants.recruitment || '—'], ['Devices', DEVICES[p.participants.devices] || '—'], ['Exclusions', p.participants.exclusions || '—'], ['Consent', study.consentMode === 'external' ? 'Collected in the survey before the study' : 'Collected at the start of the study']] });
  add('h1', '4. Designs and hypotheses');
  if (!exps.length) add('p', 'This study has no A/B experiment.');
  for (const exp of exps) {
    const e = p.experiments[exp.id], n = exp.variants.length;
    add('h2', `Experiment: ${exp.id}`);
    add('note', `Activities: ${exp.tasks.map(t => t.title || t.id).join(', ')}. Each participant sees one design, assigned at random (or by the survey's randomizer) and kept across these activities.`);
    add('table', null, { rows: [['Design', 'ID', 'Role', 'What is different', 'Prototype link', 'Version'], ...exp.variants.map((v, i) => [`${letter(i)} · ${v.label}`, v.id, v.id === e.controlId ? 'Control' : 'Treatment', e.treatments[v.id] || '—', v.prototypeUrl || '—', v.revision || '—'])], widths: [0.2, 0.13, 0.12, 0.25, 0.2, 0.1] });
    add('p', [{ text: 'Hypotheses', bold: true }]);
    if (e.hypotheses.length) e.hypotheses.forEach((h, i) => add('bullet', [{ text: `H${i + 1}. `, bold: true }, { text: hypothesisSentence(exp, e, h) }, ...(h.rationale?.trim() ? [{ text: ` Rationale: ${h.rationale.trim()}`, italic: true }] : [])]));
    else add('p', 'None stated.');
    const signal = [...new Set(exp.tasks.map(t => t.successSignal).filter(Boolean))];
    add('p', [{ text: 'Primary measure: ', bold: true }, { text: `${PRIMARY[e.primaryMeasure]}, counting everyone assigned to a design${signal.length && e.primaryMeasure === 'success' ? ` (success signal: ${signal.join(', ')})` : ''}.` }]);
    add('p', [{ text: 'Secondary measures: ', bold: true }, { text: e.secondary.map(k => SECONDARY[k]).filter(Boolean).join('; ') || 'None.' }]);
    add('p', [{ text: 'Sample size: ', bold: true }, { text: sizeText(e, n) }]);
    add('p', [{ text: 'Stopping rule: ', bold: true }, { text: e.stoppingRule?.trim() || STOP_DEFAULT }]);
  }
  add('h1', '5. Procedure');
  add('p', [{ text: 'Welcome: ', bold: true }, { text: study.welcome?.trim() || '—' }]);
  add('h2', 'Pre-study questions');
  if (study.preQuestions?.length) add('table', null, { rows: qRows(study.preQuestions), widths: QW }); else add('p', 'None.');
  add('h2', 'Activities');
  (study.tasks || []).forEach((t, i) => {
    const m = normalizeMethod(t);
    add('p', [{ text: `${i + 1}. ${t.title || t.id}`, bold: true }, { text: ` (${methodName[m] || m})` }]);
    add('p', [{ text: 'Instructions: ', italic: true }, { text: t.instructions?.trim() || '—' }]);
    if (m === 'ab_test') add('note', `Designs: ${t.variants.map((v, k) => `${letter(k)} ${v.label}`).join(', ')}. Success signal: ${t.successSignal || 'none (self-report only)'}.`);
    if (m === 'tree_test') add('note', `Correct destination(s): ${(t.correctNodeIds || []).join(', ') || 'not set'}.`);
    if (m === 'card_sort') add('note', `${t.sortMode || 'open'} sort with ${(t.cards || []).length} cards${t.categories?.length ? ` and ${t.categories.length} categories` : ''}.`);
    if (m === 'first_click') add('note', `${(t.targetAreas || []).length ? `${t.targetAreas.length} scored target area(s)` : 'Unscored'}.`);
    if (t.questions?.length) { add('note', m === 'survey' ? 'Survey questions:' : 'Follow-up questions after this activity:'); add('table', null, { rows: qRows(t.questions), widths: QW }); }
  });
  add('h2', 'Post-study questions');
  if (study.postQuestions?.length) add('table', null, { rows: qRows(study.postQuestions), widths: QW }); else add('p', 'None.');
  add('h1', '6. Analysis plan');
  add('p', p.analysis.trim() || standardAnalysisPlan(s));
  add('h1', '7. How results will be used'); add('p', p.decisions.trim() || 'Not yet written.');
  if (p.locked) {
    add('h1', '8. Change log');
    add('note', `Changes made after the plan was locked on ${fmtDate(p.locked.at)}.`);
    if (p.changes.length) add('table', null, { rows: [['When', 'What changed', 'Before', 'After', 'Reason'], ...p.changes.map(c => [fmtDate(c.at), c.what, c.before || '—', c.after || '—', c.reason || '—'])], widths: [0.16, 0.24, 0.22, 0.22, 0.16] });
    else add('p', 'No changes.');
  }
  return B;
}
export function planDocx(study, now = new Date()) { return buildDocx(planBlocks(study, now), { title: `${study.title || study.id} — study plan` }, now); }
