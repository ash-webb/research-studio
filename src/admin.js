import { renderAnalyses } from './results-ui.js';
import { plannerText } from './ab-results.js';
import { qualtricsRecords, classifyExport, eventsFromQualtrics } from './qualtrics-import.js';
import { METHODS, normalizeMethod, methodOutcomeRows, exportMethodRows, experimentComparisonRows } from './methods.js';
import { newActivity, methodOptions, methodEditorHTML, parseEditorValue, variantRowError, nextVariant } from './builder-ui.js';
import { $, $$, escapeHTML as esc, validateStudy, prototypeURL, download, csv, flattenEvents, separatePreviewSessions, formatDate, formatDuration } from './shared.js';
import { remoteEnabled, logIn, logOut, getAuth, registerStudy, listOwnedStudies, loadEvents } from './storage.js';

let study, studyIndex=[], studyCache=new Map(), records=[], flat={sessions:[],tasks:[],starts:[],answers:[],interactions:[],methodEvents:[]};
let selectedSession=null, selectedTask='', selectedPage='';
// Qualtrics data imported for one study (kept in memory only; never uploaded or stored).
let imported=null;
const by = id=>document.getElementById(id);
const questionTypes=[['text','Short text'],['textarea','Long text'],['scale5','5-point scale'],['scale7','7-point scale'],['single','Single choice'],['multi','Multiple choice']];

function toast(message,timeout=4500){const el=by('toast');el.textContent=message;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),timeout);}
function switchTab(name){$$('.nav-option').forEach(b=>{const on=b.dataset.tab===name;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$$('.tab-panel').forEach(p=>p.classList.toggle('hidden',p.id!==`tab-${name}`));if(name==='results')refreshResults().catch(err=>toast(err.message));if(name==='setup')renderAuth();}
function newQuestion(){return {id:`question-${Math.random().toString(36).slice(2,7)}`,type:'textarea',text:'',required:false};}
function normalizeStudy(item){return {schemaVersion:item.schemaVersion||3,id:item.id || 'new-study',version:item.version||'1.0.0',title:item.title || '',description:item.description||'',prototypeUrl:item.prototypeUrl || '',welcome:item.welcome||'',consent:item.consent||'',...(item.consentMode==='external'?{consentMode:'external'}:{}),preQuestions:item.preQuestions || [],tasks:item.tasks || [],postQuestions:item.postQuestions || []};}
function prepareEditor(){
  const values={studyTitle:study.title,studyId:study.id,studyVersion:study.version,studyURL:study.prototypeUrl,studyDescription:study.description,studyWelcome:study.welcome,studyConsent:study.consent};
  for(const [id,v] of Object.entries(values))by(id).value=v;
  by('studyExternalConsent').checked=study.consentMode==='external';
  renderQuestions('preQuestions');renderQuestions('postQuestions');renderTasks();updateSummary();
}
function questionEditorHTML(q,stage,i,taskIndex=null){
  const attrs=`data-q-stage="${esc(stage)}" data-q-index="${i}" ${taskIndex===null?'':`data-q-task="${taskIndex}"`}`;
  return `<div class="edit-question" ${attrs}><div class="grid3"><label class="field">Question ID<input data-question-field="id" value="${esc(q.id)}"></label><label class="field">Answer type<select data-question-field="type">${questionTypes.map(([v,l])=>`<option value="${v}" ${q.type===v?'selected':''}>${l}</option>`).join('')}</select></label></div><label class="field">Question text<input data-question-field="text" value="${esc(q.text)}" placeholder="Write a neutral question…"></label>${['single','multi'].includes(q.type)?`<label class="field">Options, one per line<textarea rows="3" data-question-field="options">${esc((q.options||[]).join('\n'))}</textarea></label>`:''}${q.type.startsWith('scale')?`<div class="form-grid"><label class="field">Low-end label<input data-question-field="lowLabel" value="${esc(q.lowLabel||'Low')}"></label><label class="field">High-end label<input data-question-field="highLabel" value="${esc(q.highLabel||'High')}"></label></div>`:''}<div class="question-bottom"><label><input type="checkbox" data-question-field="required" ${q.required?'checked':''}> Required response</label><button type="button" class="btn btn-small btn-danger" data-remove-q="true">Remove question</button></div></div>`;
}
function renderQuestions(stage){
  const id=stage==='preQuestions'?'preQuestionEditor':'postQuestionEditor';
  by(id).innerHTML=study[stage].length?study[stage].map((q,i)=>questionEditorHTML(q,stage,i)).join(''):'<div class="empty-hint">No questions. Add one if needed.</div>';
}
function renderTasks(){
  by('taskEditor').innerHTML=study.tasks.map((t,i)=>{
    const method=normalizeMethod(t);
    const isSurvey=method==='survey';
    return `<section class="task-editor-block" data-task-index="${i}">
      <div class="task-top"><div style="display:flex;gap:10px;align-items:center"><span class="task-number">${i+1}</span><h3>Activity ${i+1}</h3></div><button type="button" class="btn btn-small btn-danger" data-remove-task="true">Remove activity</button></div>
      <div class="form-grid"><label class="field">Activity type<select data-task-field="method">${methodOptions(method)}</select></label><label class="field">Activity ID<input data-task-field="id" value="${esc(t.id)}"></label><label class="field span2">Activity title<input data-task-field="title" value="${esc(t.title||'')}"></label><label class="field span2">Participant-facing instructions<textarea rows="3" data-task-field="instructions">${esc(t.instructions)}</textarea></label></div>
      ${methodEditorHTML(t)}
      <div class="task-questions-header"><span>${isSurvey?'Survey questions':'Follow-up questions'} (${(t.questions||[]).length})</span><button type="button" class="btn btn-small btn-outline" data-add-task-q="true">+ Add question</button></div>
      <div class="question-editor">${(t.questions||[]).length?t.questions.map((q,qi)=>questionEditorHTML(q,'tasks',qi,i)).join(''):'<div class="empty-hint">No questions yet.</div>'}</div>
    </section>`;
  }).join('');
}

function updateSummary(){
 by('summaryTitle').textContent=study.title||'Untitled study';
 by('summaryTasks').textContent=study.tasks.length;
 by('summaryQuestions').textContent=study.preQuestions.length+study.postQuestions.length+study.tasks.reduce((n,t)=>n+(t.questions||[]).length,0);
 const types=[...new Set(study.tasks.map(normalizeMethod))];by('summaryMethods').textContent=types.length;
}

function questionList(stage,taskIndex){return stage==='tasks'?study.tasks[taskIndex].questions:study[stage];}
function handleEdit(e){
  const el=e.target, idToField={studyTitle:'title',studyId:'id',studyVersion:'version',studyURL:'prototypeUrl',studyDescription:'description',studyWelcome:'welcome',studyConsent:'consent'};
  if(el.id==='studyExternalConsent'){if(el.checked)study.consentMode='external';else delete study.consentMode;return;}
  if(idToField[el.id]){study[idToField[el.id]]=el.value;updateSummary();return;}
  if(el.matches('[data-task-lines],[data-task-tree]')){
    const ti=+el.closest('[data-task-index]').dataset.taskIndex;const t=study.tasks[ti];
    try {parseEditorValue(t,el);t._editorErrors={};el.setCustomValidity('');}
    catch(err){t._editorErrors||={};t._editorErrors[el.dataset.taskLines||el.dataset.taskTree]=err.message;el.setCustomValidity(err.message);}
    return;
  }
  if(el.matches('[data-variant-field]')){
    const ti=+el.closest('[data-task-index]').dataset.taskIndex,vi=+el.closest('[data-variant-index]').dataset.variantIndex;
    const v=study.tasks[ti].variants[vi],f=el.dataset.variantField;
    if(f==='revision'&&!el.value.trim())delete v.revision;else v[f]=f==='id'?el.value.trim():el.value;
    refreshVariantErrors(ti);return;
  }
  if(el.matches('[data-task-field]')){
    const ti=+el.closest('[data-task-index]').dataset.taskIndex;const field=el.dataset.taskField;
    if(field==='method'){
      const old=study.tasks[ti];const next=newActivity(el.value,ti+1);next.id=old.id;next.title=old.title;next.instructions=old.instructions;study.tasks[ti]=next;renderTasks();updateSummary();return;
    }
    if(field==='correctNodeIds'){parseEditorValue(study.tasks[ti],el);return;}
    study.tasks[ti][field]=el.value;updateSummary();return;
  }
  if(el.matches('[data-question-field]')){
    const div=el.closest('[data-q-stage]');const stage=div.dataset.qStage;const index=+div.dataset.qIndex;const taskIndex=div.dataset.qTask===undefined?null:+div.dataset.qTask;
    const q=questionList(stage,taskIndex)[index], field=el.dataset.questionField;
    q[field]=field==='required'?el.checked:field==='options'?el.value.split('\n').map(s=>s.trim()).filter(Boolean):el.value;
    if(field==='type'){
      if(stage==='tasks')renderTasks();else renderQuestions(stage);
    }
    updateSummary();
  }
}
// Inline validation for A/B design rows; blocks preview/export until fixed.
function refreshVariantErrors(ti){
  const task=study.tasks[ti];if(!task?.variants)return;
  const errors=task.variants.map(v=>variantRowError(v,task.variants,location.href));
  task._variantErrors=errors;
  task._editorErrors||={};
  const first=errors.findIndex(Boolean);
  if(first>=0)task._editorErrors.abVariants=`Design ${String.fromCharCode(65+first)}: ${errors[first]}`;else delete task._editorErrors.abVariants;
  by('taskEditor').querySelectorAll(`[data-task-index="${ti}"] [data-variant-index]`).forEach(row=>{
    const msg=errors[+row.dataset.variantIndex]||'',p=row.querySelector('.variant-error');
    if(p){p.textContent=msg;p.hidden=!msg;}
    row.classList.toggle('has-error',!!msg);
  });
}
// ---- Pre-launch check: does each design load the tracker and send the success signal? ----
function openDesignCheck(ti){
  const task=study.tasks[ti];
  const bad=task.variants.map(v=>variantRowError(v,task.variants,location.href)).findIndex(Boolean);
  if(bad>=0){toast(`Fix design ${String.fromCharCode(65+bad)} before checking: ${variantRowError(task.variants[bad],task.variants,location.href)}`,7000);return;}
  const state=task.variants.map(()=>({tracker:'not_checked',signal:task.successSignal?'not_checked':'none'}));
  let current=0,timer=null,frame=null,origin='';
  const dlg=document.createElement('dialog');dlg.className='design-check';dlg.setAttribute('aria-labelledby','designCheckTitle');
  document.body.appendChild(dlg);
  const icon=s=>({ok:'✓',fail:'✗',waiting:'…',not_checked:'○',none:'–'}[s]);
  const words=(v,st)=>{
    const tr={ok:'Tracking connected',fail:'Tracking script not detected',waiting:'Checking tracking…',not_checked:'Not checked yet'}[st.tracker];
    const sg={ok:`Success signal “${task.successSignal}” received`,fail:'Success signal not received',waiting:'Waiting for the success signal: complete the task in the design below',not_checked:'Success signal not checked yet',none:'No success signal set: success will not be measured'}[st.signal];
    return [tr,sg];
  };
  function summary(){const ready=state.filter(s=>s.tracker==='ok'&&(s.signal==='ok'||s.signal==='none')).length;return `${ready} of ${task.variants.length} designs ready`;}
  function listHTML(){return task.variants.map((d,i)=>`<button type="button" role="tab" aria-selected="${i===current}" class="design-check-item ${i===current?'active':''}" data-design="${i}"><span class="dc-name">${String.fromCharCode(65+i)} · ${esc(d.label)}</span><span class="dc-line dc-${state[i].tracker}">${icon(state[i].tracker)} ${esc(words(d,state[i])[0])}</span><span class="dc-line dc-${state[i].signal}">${icon(state[i].signal)} ${esc(words(d,state[i])[1])}</span></button>`).join('');}
  // Status changes refresh only the list and summary, never the design frame.
  function drawStatus(){
    dlg.querySelector('.design-check-summary').innerHTML=`<strong>${esc(summary())}</strong>`;
    const list=dlg.querySelector('.design-check-list'),hadFocus=list.contains(document.activeElement)?document.activeElement.dataset.design:null;
    list.innerHTML=listHTML();
    list.querySelectorAll('[data-design]').forEach(b=>b.onclick=()=>start(+b.dataset.design));
    if(hadFocus!=null)list.querySelector(`[data-design="${hadFocus}"]`)?.focus();
  }
  function drawFrame(){
    const v=task.variants[current];
    dlg.innerHTML=`<div class="design-check-head"><h2 id="designCheckTitle">Check designs</h2><button type="button" class="btn btn-small btn-outline" data-close>Close</button></div>
      <p class="helper">For each design: the page should load, tracking should connect within a few seconds, and when you complete the task inside the design the success signal should arrive. Nothing here is saved as study data.</p>
      <p class="design-check-summary" role="status" aria-live="polite"></p>
      <div class="design-check-list" role="tablist" aria-label="Designs"></div>
      <div class="design-check-frame" role="tabpanel" aria-label="${esc(v.label)}"><div class="dc-frame-top"><span>${esc(v.prototypeUrl)}</span><button type="button" class="btn btn-small btn-outline" data-reload>Reload design</button></div><iframe title="Design ${String.fromCharCode(65+current)}: ${esc(v.label)}" src="${esc(new URL(v.prototypeUrl,location.href).href)}"></iframe></div>`;
    frame=dlg.querySelector('iframe');origin=new URL(v.prototypeUrl,location.href).origin;
    dlg.querySelector('[data-close]').onclick=()=>dlg.close();
    dlg.querySelector('[data-reload]').onclick=()=>start(current);
    drawStatus();
  }
  function start(i){
    current=i;const st=state[i];
    if(st.tracker!=='ok')st.tracker='waiting';
    if(st.signal!=='none'&&st.signal!=='ok')st.signal='waiting';
    drawFrame();
    clearTimeout(timer);timer=setTimeout(()=>{if(state[i].tracker==='waiting'){state[i].tracker='fail';if(state[i].signal==='waiting')state[i].signal='fail';if(current===i)drawStatus();}},8000);
  }
  const onMessage=e=>{
    if(!frame||e.source!==frame.contentWindow||e.origin!==origin)return;
    const m=e.data;if(!m||m.namespace!=='UTP_BRIDGE'||m.version!==1)return;
    const st=state[current];let changed=false;
    if(st.tracker!=='ok'){st.tracker='ok';changed=true;}
    if(m.type==='success'&&task.successSignal&&m.task_id===task.successSignal&&st.signal!=='ok'){st.signal='ok';changed=true;}
    if(changed)drawStatus();
  };
  window.addEventListener('message',onMessage);
  dlg.addEventListener('close',()=>{clearTimeout(timer);window.removeEventListener('message',onMessage);dlg.remove();by('taskEditor').querySelector(`[data-task-index="${ti}"] [data-check-designs]`)?.focus();});
  dlg.showModal();start(0);
}
function handleClick(e){
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.addQ){study[t.dataset.addQ].push(newQuestion());renderQuestions(t.dataset.addQ);updateSummary();return;}
  if(t.dataset.addTaskQ){const idx=+t.closest('[data-task-index]').dataset.taskIndex;study.tasks[idx].questions ||= [];study.tasks[idx].questions.push(newQuestion());renderTasks();updateSummary();return;}
  if(t.dataset.removeQ){const d=t.closest('[data-q-stage]');const stage=d.dataset.qStage;const ti=d.dataset.qTask===undefined?null:+d.dataset.qTask;questionList(stage,ti).splice(+d.dataset.qIndex,1);if(stage==='tasks')renderTasks();else renderQuestions(stage);updateSummary();return;}
  if(t.dataset.addVariant){const ti=+t.closest('[data-task-index]').dataset.taskIndex,task=study.tasks[ti];task.variants.push(nextVariant(task.variants));renderTasks();refreshVariantErrors(ti);by('taskEditor').querySelector(`[data-task-index="${ti}"] [data-variant-index="${task.variants.length-1}"] [data-variant-field="label"]`)?.focus();return;}
  if(t.dataset.removeVariant!==undefined){const ti=+t.closest('[data-task-index]').dataset.taskIndex,task=study.tasks[ti];if(task.variants.length<=2){toast('An A/B test needs at least two designs.');return;}task.variants.splice(+t.dataset.removeVariant,1);renderTasks();refreshVariantErrors(ti);return;}
  if(t.dataset.checkDesigns){openDesignCheck(+t.closest('[data-task-index]').dataset.taskIndex);return;}
  if(t.dataset.removeTask){const ti=+t.closest('[data-task-index]').dataset.taskIndex;if(study.tasks.length===1){toast('A study needs at least one task.');return;}study.tasks.splice(ti,1);renderTasks();updateSummary();return;}
}
function validatedCurrent(){
  const withError=study.tasks.findIndex(t=>t._editorErrors&&Object.keys(t._editorErrors).length);
  if(withError>=0){const t=study.tasks[withError];throw new Error(`Activity ${withError+1}${t.title?` (${t.title})`:''}: ${Object.values(t._editorErrors)[0]}`);}
  validateStudy(study);
  const clean=JSON.parse(JSON.stringify(study));
  clean.tasks.forEach(t=>{delete t._editorErrors;delete t._variantErrors;});
  return clean;
}

async function loadStudy(item){const res=await fetch(item.config,{cache:'no-store'});if(!res.ok)throw new Error(`Cannot read ${item.config}`);const s=normalizeStudy(await res.json());studyCache.set(s.id,s);return s;}
function setStudySelect(){
  const ids=new Map(studyIndex.map(x=>[x.id,x.title]));if(study)ids.set(study.id,study.title);
  const existing=by('resultsStudy').value;
  by('resultsStudy').innerHTML=[...ids.entries()].map(([id,title])=>`<option value="${esc(id)}">${esc(title)}</option>`).join('');
  if(ids.has(existing))by('resultsStudy').value=existing;
}
async function initialize(){
  const idx=await fetch('studies/index.json',{cache:'no-store'});if(!idx.ok)throw new Error('Could not load studies/index.json. Serve this site through HTTP(S).');
  studyIndex=await idx.json();study=await loadStudy(studyIndex[0]);
  by('exampleStudy').innerHTML=studyIndex.map(item=>`<option value="${esc(item.id)}">${esc(item.title)}</option>`).join('');
  prepareEditor();setStudySelect();
  by('modeTag').textContent=remoteEnabled?'REMOTE CONNECTED':'LOCAL DEMO';
  by('modeSide').textContent=remoteEnabled?'Supabase connection configured':'Demo mode · local browser only';
  by('configPreview').innerHTML=`Mode: <strong>${remoteEnabled?'Remote collection':'Local demonstration'}</strong><br>Supabase URL: ${esc((window.UTP_SETTINGS||{}).supabaseUrl||'Not configured')}<br>Browser key: ${remoteEnabled?'Configured (publishable key)':'Not configured'}`;
  if(!remoteEnabled)by('registerStudy').disabled=true;
  renderAuth();
}

async function renderAuth(){
  const msg=by('authMsg'),form=by('loginForm'),out=by('logout');
  if(!remoteEnabled){msg.textContent='No remote database. Participant data stays in the browser used for the test.';form.classList.add('hidden');out.classList.add('hidden');return;}
  const auth=getAuth();
  if(auth?.user?.email){msg.textContent=`Signed in as ${auth.user.email}. Only your own study data is available to this account.`;form.classList.add('hidden');out.classList.remove('hidden');}
  else {msg.textContent='Remote database configured. Sign in with a Supabase Auth account to publish studies and read results.';form.classList.remove('hidden');out.classList.add('hidden');}
}

async function refreshResults(){
  const id=by('resultsStudy').value;if(!id)return;
  by('resultsStatus').textContent='Loading study events…';
  if(remoteEnabled && !getAuth()){records=[];flat=flattenEvents([]);renderResults();by('resultsStatus').textContent='Sign in on the Setup tab to view remote research data.';return;}
  try{
    if(!studyForId(id)){const item=studyIndex.find(x=>x.id===id);if(item)await loadStudy(item);}
    if(imported&&imported.studyId===id){records=imported.events;flat=flattenEvents(records);selectedSession=flat.sessions[0]?.session_id||null;selectedTask='';selectedPage='';renderResults();
      by('resultsStatus').innerHTML=`Showing imported Qualtrics data: ${imported.summary.responses} Survey 2 response${imported.summary.responses===1?'':'s'}${imported.summary.dropouts?`, plus ${imported.summary.dropouts} assigned in Survey 1 who did not return`:''}. Read in this browser only; nothing was uploaded.${imported.warnings?.length?` <strong>Note:</strong> ${esc(imported.warnings.join(' '))}`:''} <button type="button" class="btn btn-small btn-outline" id="clearImport">Show browser data instead</button>`;
      by('clearImport').onclick=()=>{imported=null;refreshResults();};return;}
    const loaded=await loadEvents(id);
    // Researcher "Preview locally" runs are labelled at session start and kept out of
    // participant results (dashboard and every export) unless explicitly included.
    const includePreviews=by('includePreviews').checked;
    const {events:kept,previewCount}=separatePreviewSessions(loaded,includePreviews);
    records=kept;
    flat=flattenEvents(records);selectedSession=flat.sessions[0]?.session_id||null;selectedTask='';selectedPage='';
    renderResults();
    const previewNote=previewCount?` ${previewCount} preview run${previewCount===1?'':'s'} ${includePreviews?'included':'hidden'}.`:'';
    by('resultsStatus').textContent=`${records.length} collected event records. ${remoteEnabled?'Loaded from Supabase.':'Local demo records only; not centrally collected.'}${previewNote}`;
  } catch(err){by('resultsStatus').textContent=`Unable to load results: ${err.message}`;records=[];flat=flattenEvents([]);renderResults();}
}
// Wide tables scroll sideways; make each scroll area reachable and named for keyboard
// and screen-reader users (WCAG 2.1.1 / axe scrollable-region-focusable).
function labelScrollRegions(root=document){
  const used=new Map();
  for(const el of root.querySelectorAll('.table-scroll')){
    if(el.hasAttribute('tabindex')){used.set(el.getAttribute('aria-label'),1);continue;}
    let heading=null;
    for(let n=el.previousElementSibling;n&&!heading;n=n.previousElementSibling)if(/^H[2-4]$/.test(n.tagName))heading=n;
    heading||=el.closest('section,.panel')?.querySelector('h2,h3,h4');
    // Prefix the activity title so tables repeated across activities stay distinguishable.
    const activity=el.closest('.method-analysis')?.querySelector('h3');
    const parts=[activity&&activity!==heading?activity.textContent.trim():'',heading?.textContent.trim()||'Results'].filter(Boolean);
    let label=`${parts.join(': ')} table (scrolls sideways)`;
    const n=(used.get(label)||0)+1;used.set(label,n);if(n>1)label=`${label} ${n}`;
    el.setAttribute('tabindex','0');el.setAttribute('role','region');el.setAttribute('aria-label',label);
  }
}
function metric(label,value,sub){return `<div class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;}
function renderResults(){
  const total=flat.sessions.length,completed=flat.sessions.filter(x=>x.completed_at).length, attempts=flat.tasks.length;
  const timed=flat.tasks.map(t=>t.time_seconds).filter(v=>Number.isFinite(v)&&v>0);
  const avg=timed.length?timed.reduce((n,v)=>n+v,0)/timed.length:null;
  by('metricCards').innerHTML=metric('Sessions',total,'Includes incomplete sessions')+metric('Study completions',completed,total?`${Math.round(completed/total*100)}% of sessions`:'No sessions')+metric('Finished activities',attempts,'Compare success within each method')+metric('Mean activity time',formatDuration(avg),`${timed.length} timed activities`);
  const taskIds=[...new Set([...flat.starts.map(t=>t.task_id),...flat.tasks.map(t=>t.task_id)])];
  const current=studyForId(by('resultsStudy').value);
  by('tasksTable').innerHTML=taskIds.length?taskIds.map(id=>{
    const results=flat.tasks.filter(t=>t.task_id===id),x=results.length;
    const starts=flat.starts.filter(t=>t.task_id===id);
    const finishedIds=new Set(results.map(t=>t.session_id));const unfinished=starts.filter(t=>!finishedIds.has(t.session_id)).length;
    const activity=current?.tasks?.find(t=>t.id===id);
    const method=results[0]?.method||normalizeMethod(activity||{});
    const tt=results.map(t=>t.time_seconds).filter(v=>Number.isFinite(v)&&v>0);const mean=tt.length?tt.reduce((n,v)=>n+v,0)/tt.length:null;
    const scored=results.filter(t=>method==='tree_test'||(method==='first_click'&&t.result.scored===true)||(method==='prototype'&&t.tracker_connected&&activity?.successSignal)||(method==='ab_test'&&t.tracker_connected&&activity?.successSignal));
    const good=scored.filter(t=>t.observed_success).length;
    let special='—';
    if(method==='card_sort')special=`${results.filter(t=>t.result.completed).length} fully sorted`;
    if(method==='tree_test')special=`${results.filter(t=>t.result.direct).length} direct paths`;
    if(method==='first_click')special=`${results.filter(t=>t.result.click).length} clicks recorded`;
    if(method==='preference')special=`${results.filter(t=>t.result.selected_id).length} selected options`;
    if(method==='survey')special=`${results.filter(t=>t.result.response_count>0).length} answered`;
    if(method==='prototype')special=`${results.filter(t=>t.self_report==='completed').length} self-reported completed`;
    if(method==='ab_test')special=`${new Set(starts.map(t=>t.variant_id).filter(Boolean)).size} assigned design(s)`;
    return `<tr><td><strong>${esc(activity?.title||id)}</strong></td><td>${esc(METHODS[method]?.label||method)}</td><td>${starts.length}</td><td>${unfinished}</td><td>${scored.length?`${good} of ${scored.length}`:'Not scored'}</td><td>${formatDuration(mean)}</td><td>${esc(special)}</td></tr>`;
  }).join(''):'<tr><td colspan="7">No activity results yet.</td></tr>';
  by('sessionsList').innerHTML=flat.sessions.length?flat.sessions.slice().reverse().map(s=>`<button class="session-item ${s.session_id===selectedSession?'active':''}" data-session="${esc(s.session_id)}"><strong>${esc(s.session_id.slice(0,8))}… · ${s.completed_at?'Finished':'In progress / left early'}${s.preview?' · Preview':''}${s.resumed_count?` · Resumed ×${s.resumed_count}`:''}</strong><small>${esc(formatDate(s.started_at))} · ${flat.tasks.filter(t=>t.session_id===s.session_id).length} completed activities</small></button>`).join(''):'<p class="muted small">No sessions recorded.</p>';
  renderMethodInsights();renderExplorer();labelScrollRegions();
}

function renderMethodInsights(){
 const current=studyForId(by('resultsStudy').value);
 by('methodInsights').innerHTML=renderAnalyses(current,flat,esc);
 // Sample-size planners inside A/B results: recompute as the researcher types.
 for(const box of by('methodInsights').querySelectorAll('[data-planner]')){
   const update=()=>{const v=k=>Number(box.querySelector(`[data-plan="${k}"]`).value);box.querySelector('[data-plan-out]').textContent=plannerText({baseline:v('baseline'),difference:v('difference'),power:v('power'),designs:Number(box.dataset.designs),measured:Number(box.dataset.measured)});};
   box.addEventListener('input',update);box.addEventListener('change',update);update();
 }
}
function studyForId(id){return studyCache.get(id)||(study.id===id?study:null);}
function renderExplorer(){
  if(!selectedSession){by('explorerHint').textContent='Choose a participant session to see click history.';by('explorerTask').innerHTML='';by('explorerPage').innerHTML='';by('clickOverlay').innerHTML='';by('clickTimeline').innerHTML='';by('heatmapFrame').removeAttribute('src');return;}
  const interactions=flat.interactions.filter(x=>x.session_id===selectedSession);
  const taskIds=[...new Set(interactions.map(x=>x.task_id))];
  if(!taskIds.includes(selectedTask))selectedTask=taskIds[0]||'';
  by('explorerTask').innerHTML=taskIds.map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('');by('explorerTask').value=selectedTask;
  const taskHits=interactions.filter(x=>x.task_id===selectedTask);
  const pages=[...new Set(taskHits.map(x=>x.page))];
  if(!pages.includes(selectedPage))selectedPage=pages[0]||'';
  by('explorerPage').innerHTML=pages.map(page=>`<option value="${esc(page)}">${esc(page || 'Unknown page')}</option>`).join('');by('explorerPage').value=selectedPage;
  const shown=taskHits.filter(x=>x.page===selectedPage&&x.type==='click');
  by('explorerHint').textContent=`${shown.length} clicks on selected page. Positions are scaled to this frame; viewport changes and dynamic content may affect alignment.`;
  const source=studyForId(by('resultsStudy').value);
  const f=by('heatmapFrame');
  if(source){try{const task=source.tasks.find(t=>t.id===selectedTask);if(!task||!['prototype','ab_test'].includes(normalizeMethod(task)))throw new Error('Not a prototype');
    const assigned=flat.starts.find(x=>x.session_id===selectedSession&&x.task_id===selectedTask)?.variant_id;
    const variant=normalizeMethod(task)==='ab_test'?task.variants.find(v=>v.id===assigned):null;
    if(normalizeMethod(task)==='ab_test'&&!variant)throw new Error('Missing assignment');
    const src=prototypeURL(variant?.prototypeUrl||task.prototypeUrl||source.prototypeUrl);if(f.getAttribute('src')!==src)f.setAttribute('src',src);}catch{f.removeAttribute('src');}}else f.removeAttribute('src');
  by('clickOverlay').innerHTML=shown.filter(x=>x.x_pct!==''&&x.y_pct!=='').slice(0,100).map((x,i)=>`<span class="click-dot" title="${esc(x.target)}" style="left:${Math.max(0,Math.min(100,+x.x_pct))}%;top:${Math.max(0,Math.min(100,+x.y_pct))}%">${i<99?i+1:'·'}</span>`).join('');
  by('clickTimeline').innerHTML=taskHits.length?taskHits.map((x,i)=>`<div><strong>${i+1}.</strong> ${esc(x.type)}${x.input==='keyboard'?' (keyboard)':''} · ${esc(x.target||x.page||'Unknown target')} · ${esc(formatDate(x.at))}</div>`).join(''):'<div>No interactions from this task. Confirm the bridge script is installed in the prototype.</div>';
}
function exportDataset(kind){
  const id=by('resultsStudy').value;
  if(kind==='all')return download(`${id}-all-events.json`,JSON.stringify(records,null,2),'application/json');
  if(kind==='methods')return download(`${id}-method-outcomes.csv`,csv(exportMethodRows(methodOutcomeRows(records)),['study_id','session_id','study_version','activity_id','method','experiment_id','variant_id','variant_revision','ended_at','time_seconds','interruptions','interrupted_seconds','result','self_report','observed_success']),'text/csv;charset=utf-8');
  if(kind==='experiments')return download(`${id}-ab-exposures.csv`,csv(experimentComparisonRows(records),['study_id','study_version','session_id','external_id','assignment','experiment_id','activity_id','variant_id','variant_revision','assigned_at','ended_at','status','time_seconds','click_count','tracker_connected','success_signal_status','self_report']),'text/csv;charset=utf-8');
  const fields={
    tasks:['session_id','external_id','study_id','task_id','at','method','experiment_id','variant_id','variant_revision','self_report','observed_success','tracker_connected','time_seconds','interruptions','interrupted_seconds','click_count'],
    answers:['session_id','study_id','task_id','experiment_id','variant_id','variant_revision','stage','question_id','response','at'],
    interactions:['session_id','study_id','task_id','experiment_id','variant_id','variant_revision','at','type','input','target','page','x_pct','y_pct','viewport_width','viewport_height'],
    methodEvents:['session_id','study_id','task_id','experiment_id','variant_id','variant_revision','at','method','action','detail']
  }[kind];
  const rows=kind==='methodEvents'?flat.methodEvents.map(e=>({...e,detail:JSON.stringify(e.detail)})):flat[kind];
  download(`${id}-${kind}.csv`,csv(rows,fields),'text/csv;charset=utf-8');
}

function wireActions(){
  $$('.nav-option').forEach(x=>x.addEventListener('click',()=>switchTab(x.dataset.tab)));
  by('studyTitle').closest('section').addEventListener('input',handleEdit);by('studyTitle').closest('section').addEventListener('change',handleEdit);
  by('preQuestionEditor').addEventListener('input',handleEdit);by('preQuestionEditor').addEventListener('change',handleEdit);
  by('postQuestionEditor').addEventListener('input',handleEdit);by('postQuestionEditor').addEventListener('change',handleEdit);
  by('taskEditor').addEventListener('input',handleEdit);by('taskEditor').addEventListener('change',handleEdit);
  by('tab-builder').addEventListener('click',handleClick);
  by('addTask').onclick=()=>{const i=study.tasks.length+1;study.tasks.push(newActivity(by('newMethod').value,i));renderTasks();updateSummary();};
  by('newStudy').onclick=()=>{study=normalizeStudy({id:'my-research-study',title:'My research study',tasks:[newActivity('card_sort',1)],welcome:'Please read the instructions for each activity.',consent:'I agree to participate in this study and to the collection described in the introduction.'});studyCache.set(study.id,study);prepareEditor();setStudySelect();toast('New draft created. Update the ID before publishing to avoid name conflicts.');};
  by('loadExample').onclick=async()=>{try{const item=studyIndex.find(x=>x.id===by('exampleStudy').value);if(!item)return;study=await loadStudy(item);prepareEditor();setStudySelect();toast(`Loaded ${study.title}.`);}catch(err){toast(err.message);}};
  by('importStudy').onclick=()=>by('fileStudy').click();
  by('fileStudy').onchange=async e=>{try{const file=e.target.files?.[0];if(!file)return;const parsed=normalizeStudy(JSON.parse(await file.text()));validateStudy(parsed);study=parsed;studyCache.set(study.id,study);prepareEditor();setStudySelect();toast('Imported study. Export to save changes.');}catch(err){toast(`Import error: ${err.message}`);}e.target.value='';};
  by('exportStudy').onclick=()=>{try{download(`${study.id}.json`,JSON.stringify(validatedCurrent(),null,2),'application/json');toast('Study configuration exported. Add the JSON file to GitHub.');}catch(err){toast(err.message);}};
  by('previewStudy').onclick=()=>{try{localStorage.setItem('utp-preview-study',JSON.stringify(validatedCurrent()));window.open('study.html?preview=1','_blank','noopener');}catch(err){toast(err.message);}};
  by('registerStudy').onclick=async()=>{try{const config=validatedCurrent();await registerStudy(config);toast(`Published ${config.id} for response collection. Ensure its JSON is also deployed to GitHub Pages.`);}catch(err){toast(`Publish failed: ${err.message}`);}};
  by('importQualtrics').onclick=()=>by('qualtricsFiles').click();
  by('qualtricsFiles').onchange=async e=>{
    const files=[...(e.target.files||[])];e.target.value='';if(!files.length)return;
    try{
      const id=by('resultsStudy').value;let current=studyForId(id);
      if(!current){const item=studyIndex.find(x=>x.id===id);if(item)current=await loadStudy(item);}
      if(!current)throw new Error('Choose the study these results belong to first.');
      let s2=[],s1=[];const unknown=[];
      for(const f of files){const recs=qualtricsRecords(await f.text());const kind=classifyExport(recs);if(kind==='survey2')s2=s2.concat(recs);else if(kind==='survey1')s1=s1.concat(recs);else unknown.push(f.name);}
      if(unknown.length)toast(`Not recognised as Survey 1 or Survey 2: ${unknown.join(', ')}`,8000);
      if(!s2.length)throw new Error('No Survey 2 export found. It should contain the rs_session and rs_ab1_… fields.');
      const result=eventsFromQualtrics(current,s2,s1);
      if(result.problems.length)throw new Error(result.problems.join(' '));
      imported={studyId:id,events:result.events,summary:result.summary,warnings:result.warnings};
      await refreshResults();toast('Qualtrics results imported.');
    }catch(err){toast(`Import failed: ${err.message}`,9000);}
  };
  by('resultsStudy').onchange=()=>{if(imported&&imported.studyId!==by('resultsStudy').value)imported=null;refreshResults();};by('refreshResults').onclick=refreshResults;by('includePreviews').onchange=()=>refreshResults();
  by('exportTasks').onclick=()=>exportDataset('tasks');by('exportAnswers').onclick=()=>exportDataset('answers');by('exportClicks').onclick=()=>exportDataset('interactions');by('exportAll').onclick=()=>exportDataset('all');by('exportMethods').onclick=()=>exportDataset('methods');by('exportMethodEvents').onclick=()=>exportDataset('methodEvents');by('exportExperiments').onclick=()=>exportDataset('experiments');
  by('sessionsList').onclick=e=>{const b=e.target.closest('[data-session]');if(b){selectedSession=b.dataset.session;selectedTask='';selectedPage='';renderResults();}};
  by('explorerTask').onchange=e=>{selectedTask=e.target.value;selectedPage='';renderExplorer();};by('explorerPage').onchange=e=>{selectedPage=e.target.value;renderExplorer();};
  by('loginForm').onsubmit=async e=>{e.preventDefault();try{await logIn(by('loginEmail').value,by('loginPassword').value);by('loginPassword').value='';renderAuth();toast('Signed in.');const owned=await listOwnedStudies();for(const s of owned){if(!studyIndex.some(x=>x.id===s.id))studyIndex.push({id:s.id,title:s.title,config:`studies/${s.id}.json`});}setStudySelect();}catch(err){toast(`Sign in failed: ${err.message}`);}};
  by('logout').onclick=()=>{logOut();renderAuth();records=[];flat=flattenEvents([]);renderResults();toast('Signed out.');};
}
wireActions();initialize().catch(err=>{toast(err.message,10000);console.error(err);});
