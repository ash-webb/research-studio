import { METHODS, validateActivity, validateQuestions, normalizeMethod } from './methods.js';
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((b,i) => ([4,6,8,10].includes(i) ? '-' : '') + b.toString(16).padStart(2,'0')).join('');
}

export function validateStudy(study) {
  if (!study || !/^[a-z0-9-]{3,64}$/.test(study.id ?? '')) throw new Error('Study ID must be 3–64 lowercase letters, numbers, or hyphens.');
  if (!String(study.title || '').trim()) throw new Error('Study title is required.');
  if (!Array.isArray(study.tasks) || !study.tasks.length) throw new Error('At least one activity is required.');
  validateQuestions(study.preQuestions || []);validateQuestions(study.postQuestions || []);
  const ids = new Set(), experiments = new Map();
  for (const task of study.tasks) {
    if (!/^[a-z0-9-]{2,64}$/.test(task.id || '') || ids.has(task.id)) throw new Error('Task IDs must be unique, lowercase, and use hyphens.');
    ids.add(task.id);
    validateActivity(task, location.href);
    if(normalizeMethod(task)==='ab_test'){
      const experimentId=task.experimentId||task.id;
      const signature=task.variants.map(x=>x.id).sort().join('|');
      if(experiments.has(experimentId)&&experiments.get(experimentId)!==signature)throw new Error(`A/B experiment ${experimentId} must use the same variant IDs across all its activities.`);
      experiments.set(experimentId,signature);
    }
    if (normalizeMethod(task) === 'prototype') {
      if (!(task.prototypeUrl || study.prototypeUrl)) throw new Error(`Prototype activity ${task.id} needs a URL.`);
      prototypeURL(task.prototypeUrl || study.prototypeUrl);
    }
  }
  return study;
}

export function prototypeURL(value) {
  const u = new URL(value, location.href);
  if (!['https:', 'http:'].includes(u.protocol) || (u.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(u.hostname))) throw new Error('Prototype URL must be HTTPS (or localhost for development).');
  return u.href;
}

export function getQuestionChoices(q) {
  const v = q.type === 'scale7' ? 7 : q.type === 'scale5' ? 5 : 0;
  if (v) return Array.from({ length: v }, (_, i) => String(i+1));
  return Array.isArray(q.options) ? q.options : [];
}

export function questionFields(questions = [], idPrefix = 'q') {
  if (!questions.length) return '<p class="muted">No questions in this section.</p>';
  return questions.map(q => {
    const id = `${idPrefix}-${q.id}`;
    let control = '';
    if (q.type === 'text') control = `<input id="${escapeHTML(id)}" name="${escapeHTML(q.id)}" type="text" autocomplete="off" ${q.required ? 'required' : ''} maxlength="500" placeholder="Your response">`;
    else if (q.type === 'textarea') control = `<textarea id="${escapeHTML(id)}" name="${escapeHTML(q.id)}" rows="3" ${q.required ? 'required' : ''} maxlength="4000" placeholder="Your response"></textarea>`;
    else {
      const choices = getQuestionChoices(q);
      control = `<div class="choice-grid ${q.type.startsWith('scale') ? 'scale-grid' : ''}" role="group" aria-label="${escapeHTML(q.text)}">${choices.map((choice,i) => `<label class="choice"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="${escapeHTML(q.id)}" value="${escapeHTML(choice)}" ${q.required && q.type !== 'multi' ? 'required' : ''}><span>${escapeHTML(choice)}</span></label>`).join('')}</div>`;
      if (q.type.startsWith('scale')) control += `<div class="scale-labels"><span>${escapeHTML(q.lowLabel || 'Low')}</span><span>${escapeHTML(q.highLabel || 'High')}</span></div>`;
    }
    return `<div class="question"><label class="question-title" ${['text','textarea'].includes(q.type) ? `for="${escapeHTML(id)}"` : ''}>${escapeHTML(q.text)} ${q.required ? '<span class="required">*</span>' : ''}</label>${control}</div>`;
  }).join('');
}

export function collectAnswers(form, questions=[]) {
  const result = {};
  for (const q of questions) {
    const inputs = [...form.querySelectorAll(`[name="${CSS.escape(q.id)}"]`)];
    let value;
    if (q.type === 'multi') value = inputs.filter(i => i.checked).map(i => i.value);
    else if (['scale5','scale7','single'].includes(q.type)) value = inputs.find(i => i.checked)?.value ?? '';
    else value = inputs[0]?.value?.trim() ?? '';
    if (q.required && (!value || (Array.isArray(value) && !value.length))) throw Object.assign(new Error(`Please answer: ${q.text}`), { questionId: q.id });
    result[q.id] = value;
  }
  return result;
}

export function csv(rows, fields) {
  const cell = v => `"${(v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/"/g,'""')}"`;
  return [fields.map(cell).join(','), ...rows.map(row => fields.map(k => cell(row[k])).join(','))].join('\r\n');
}

export function download(filename, content, type='text/plain') {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function flattenEvents(events) {
  const sessions = new Map(), interactions = [], tasks = [], starts = [], answers = [], methodEvents = [];
  for (const e of events.slice().sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!sessions.has(e.session_id)) sessions.set(e.session_id, {session_id:e.session_id,study_id:e.study_id,started_at:null,completed_at:null,resumed_count:0});
    const s = sessions.get(e.session_id), p = e.payload || {};
    if (e.kind === 'session_started') {s.started_at = e.created_at;s.study_version=p.study_version||null;s.preview=p.preview===true;s.external_id=p.external_id||'';s.viewport_width=p.viewport_width??null;s.device=p.device||null;s.imported=p.imported||null;s.survey1_provided=p.survey1_provided===true;}
    if (e.kind === 'session_completed') s.completed_at = e.created_at;
    if (e.kind === 'session_resumed') s.resumed_count++;
    if (e.kind === 'task_started') starts.push({session_id:e.session_id,study_id:e.study_id,task_id:e.task_id,at:e.created_at,method:p.method||'prototype',experiment_id:p.experiment_id||null,variant_id:p.variant_id||null,variant_revision:p.variant_revision||null,assignment:p.assignment||null});
    if (e.kind === 'task_ended') tasks.push({session_id:e.session_id,study_id:e.study_id,task_id:e.task_id,at:e.created_at,method:p.method||'prototype',result:p.result||{},experiment_id:p.experiment_id||p.result?.experiment_id||null,variant_id:p.variant_id||p.result?.variant_id||null,variant_revision:p.variant_revision||p.result?.variant_revision||null,self_report:p.self_report ?? '',observed_success:typeof p.observed_success === 'boolean' ? p.observed_success : null,tracker_connected:!!p.tracker_connected,time_seconds:Number.isFinite(p.time_seconds)?p.time_seconds:null,success_at_seconds:Number.isFinite(p.success_at_seconds)?p.success_at_seconds:null,finished_at_seconds:Number.isFinite(p.finished_at_seconds)?p.finished_at_seconds:null,click_count:Number.isFinite(p.click_count)?p.click_count:null,interruptions:p.interruptions ?? 0,interrupted_seconds:p.interrupted_seconds ?? 0});
    if (e.kind === 'method_event') methodEvents.push({session_id:e.session_id,study_id:e.study_id,task_id:e.task_id,at:e.created_at,action:p.action||'',method:p.method||'',detail:p.detail||{}});
    if (e.kind === 'answers') for (const [question_id, response] of Object.entries(p.answers || {})) answers.push({session_id:e.session_id,study_id:e.study_id,task_id:e.task_id ?? '',stage:p.stage ?? '',question_id,response,at:e.created_at});
    if (e.kind === 'interaction_batch') for (const [i, hit] of (p.items || []).entries()) interactions.push({session_id:e.session_id,study_id:e.study_id,task_id:e.task_id ?? '',at:hit.at || e.created_at,type:hit.type,target:hit.target ?? '',page:hit.page ?? '',x_pct:hit.x_pct ?? '',y_pct:hit.y_pct ?? '',viewport_width:hit.viewport_width ?? '',viewport_height:hit.viewport_height ?? '',input:hit.input ?? '',batch_index:i});
  }
  const assignments=new Map(starts.filter(x=>x.variant_id).map(x=>[`${x.session_id}|${x.task_id}`,x]));
  for(const task of tasks){
    task.study_version=sessions.get(task.session_id)?.study_version||null;
    task.external_id=sessions.get(task.session_id)?.external_id||'';
    const start=assignments.get(`${task.session_id}|${task.task_id}`);
    if(start){task.variant_id ||= start.variant_id;task.experiment_id ||= start.experiment_id;task.variant_revision ||= start.variant_revision;}
  }
  for(const list of [answers,interactions,methodEvents])for(const row of list){
    const start=assignments.get(`${row.session_id}|${row.task_id}`);
    if(start){row.variant_id=start.variant_id;row.experiment_id=start.experiment_id;row.variant_revision=start.variant_revision;}
  }
  return { sessions:[...sessions.values()], tasks, starts, answers, interactions, methodEvents };
}

// Researcher "Preview locally" runs are labelled preview:true on session_started.
// Returns the events to analyse plus how many preview sessions were found.
export function separatePreviewSessions(events = [], includePreviews = false) {
  const previews = new Set(events.filter(e => e.kind === 'session_started' && e.payload?.preview === true).map(e => e.session_id));
  return { events: includePreviews ? events : events.filter(e => !previews.has(e.session_id)), previewCount: previews.size };
}

export function formatDuration(s) {if (s == null || Number.isNaN(+s)) return '—'; return `${Math.floor(s/60)}m ${Math.round(s%60)}s`;}
export function formatDate(s) {return s ? new Date(s).toLocaleString() : '—';}
