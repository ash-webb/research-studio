import { renderAnalyses } from './results-ui.js';
import { METHODS, normalizeMethod, methodOutcomeRows, exportMethodRows, experimentComparisonRows } from './methods.js';
import { newActivity, methodOptions, methodEditorHTML, parseEditorValue } from './builder-ui.js';
import { $, $$, escapeHTML as esc, validateStudy, prototypeURL, download, csv, flattenEvents, formatDate, formatDuration } from './shared.js';
import { remoteEnabled, logIn, logOut, getAuth, registerStudy, listOwnedStudies, loadEvents } from './storage.js';

let study, studyIndex=[], studyCache=new Map(), records=[], flat={sessions:[],tasks:[],starts:[],answers:[],interactions:[],methodEvents:[]};
let selectedSession=null, selectedTask='', selectedPage='';
const by = id=>document.getElementById(id);
const questionTypes=[['text','Short text'],['textarea','Long text'],['scale5','5-point scale'],['scale7','7-point scale'],['single','Single choice'],['multi','Multiple choice']];

function toast(message,timeout=4500){const el=by('toast');el.textContent=message;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),timeout);}
function switchTab(name){$$('.nav-option').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.tab-panel').forEach(p=>p.classList.toggle('hidden',p.id!==`tab-${name}`));if(name==='results')refreshResults().catch(err=>toast(err.message));if(name==='setup')renderAuth();}
function newQuestion(){return {id:`question-${Math.random().toString(36).slice(2,7)}`,type:'textarea',text:'',required:false};}
function normalizeStudy(item){return {schemaVersion:item.schemaVersion||3,id:item.id || 'new-study',version:item.version||'1.0.0',title:item.title || '',description:item.description||'',prototypeUrl:item.prototypeUrl || '',welcome:item.welcome||'',consent:item.consent||'',preQuestions:item.preQuestions || [],tasks:item.tasks || [],postQuestions:item.postQuestions || []};}
function prepareEditor(){
  const values={studyTitle:study.title,studyId:study.id,studyVersion:study.version,studyURL:study.prototypeUrl,studyDescription:study.description,studyWelcome:study.welcome,studyConsent:study.consent};
  for(const [id,v] of Object.entries(values))by(id).value=v;
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
  if(idToField[el.id]){study[idToField[el.id]]=el.value;updateSummary();return;}
  if(el.matches('[data-task-lines],[data-task-tree]')){
    const ti=+el.closest('[data-task-index]').dataset.taskIndex;const t=study.tasks[ti];
    try {parseEditorValue(t,el);t._editorErrors={};el.setCustomValidity('');}
    catch(err){t._editorErrors||={};t._editorErrors[el.dataset.taskLines||el.dataset.taskTree]=err.message;el.setCustomValidity(err.message);}
    return;
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
function handleClick(e){
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.addQ){study[t.dataset.addQ].push(newQuestion());renderQuestions(t.dataset.addQ);updateSummary();return;}
  if(t.dataset.addTaskQ){const idx=+t.closest('[data-task-index]').dataset.taskIndex;study.tasks[idx].questions ||= [];study.tasks[idx].questions.push(newQuestion());renderTasks();updateSummary();return;}
  if(t.dataset.removeQ){const d=t.closest('[data-q-stage]');const stage=d.dataset.qStage;const ti=d.dataset.qTask===undefined?null:+d.dataset.qTask;questionList(stage,ti).splice(+d.dataset.qIndex,1);if(stage==='tasks')renderTasks();else renderQuestions(stage);updateSummary();return;}
  if(t.dataset.removeTask){const ti=+t.closest('[data-task-index]').dataset.taskIndex;if(study.tasks.length===1){toast('A study needs at least one task.');return;}study.tasks.splice(ti,1);renderTasks();updateSummary();return;}
}
function validatedCurrent(){
  if(study.tasks.some(t=>t._editorErrors&&Object.keys(t._editorErrors).length))throw new Error('Fix activity editor errors before previewing.');
  validateStudy(study);
  const clean=JSON.parse(JSON.stringify(study));
  clean.tasks.forEach(t=>delete t._editorErrors);
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
    records=await loadEvents(id);flat=flattenEvents(records);selectedSession=flat.sessions[0]?.session_id||null;selectedTask='';selectedPage='';
    renderResults();
    by('resultsStatus').textContent=`${records.length} collected event records. ${remoteEnabled?'Loaded from Supabase.':'Local demo records only; not centrally collected.'}`;
  } catch(err){by('resultsStatus').textContent=`Unable to load results: ${err.message}`;records=[];flat=flattenEvents([]);renderResults();}
}
function metric(label,value,sub){return `<div class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></div>`;}
function renderResults(){
  const total=flat.sessions.length,completed=flat.sessions.filter(x=>x.completed_at).length, attempts=flat.tasks.length;
  const avg=attempts?flat.tasks.reduce((n,t)=>n+(+t.time_seconds||0),0)/attempts:null;
  by('metricCards').innerHTML=metric('Sessions',total,'Includes incomplete sessions')+metric('Study completions',completed,total?`${Math.round(completed/total*100)}% of sessions`:'No sessions')+metric('Finished activities',attempts,'Compare success within each method')+metric('Mean activity time',formatDuration(avg),`${attempts} completed activities`);
  const taskIds=[...new Set([...flat.starts.map(t=>t.task_id),...flat.tasks.map(t=>t.task_id)])];
  const current=studyForId(by('resultsStudy').value);
  by('tasksTable').innerHTML=taskIds.length?taskIds.map(id=>{
    const results=flat.tasks.filter(t=>t.task_id===id),x=results.length;
    const starts=flat.starts.filter(t=>t.task_id===id);
    const finishedIds=new Set(results.map(t=>t.session_id));const unfinished=starts.filter(t=>!finishedIds.has(t.session_id)).length;
    const activity=current?.tasks?.find(t=>t.id===id);
    const method=results[0]?.method||normalizeMethod(activity||{});
    const mean=x?results.reduce((n,t)=>n+(+t.time_seconds||0),0)/x:null;
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
  by('sessionsList').innerHTML=flat.sessions.length?flat.sessions.slice().reverse().map(s=>`<button class="session-item ${s.session_id===selectedSession?'active':''}" data-session="${esc(s.session_id)}"><strong>${esc(s.session_id.slice(0,8))}… · ${s.completed_at?'Finished':'In progress / left early'}</strong><small>${esc(formatDate(s.started_at))} · ${flat.tasks.filter(t=>t.session_id===s.session_id).length} completed activities</small></button>`).join(''):'<p class="muted small">No sessions recorded.</p>';
  renderMethodInsights();renderExplorer();
}

function renderMethodInsights(){
 const current=studyForId(by('resultsStudy').value);
 by('methodInsights').innerHTML=renderAnalyses(current,flat,esc);
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
  by('clickTimeline').innerHTML=taskHits.length?taskHits.map((x,i)=>`<div><strong>${i+1}.</strong> ${esc(x.type)} · ${esc(x.target||x.page||'Unknown target')} · ${esc(formatDate(x.at))}</div>`).join(''):'<div>No interactions from this task. Confirm the bridge script is installed in the prototype.</div>';
}
function exportDataset(kind){
  const id=by('resultsStudy').value;
  if(kind==='all')return download(`${id}-all-events.json`,JSON.stringify(records,null,2),'application/json');
  if(kind==='methods')return download(`${id}-method-outcomes.csv`,csv(exportMethodRows(methodOutcomeRows(records)),['study_id','session_id','study_version','activity_id','method','experiment_id','variant_id','variant_revision','ended_at','time_seconds','result','self_report','observed_success']),'text/csv;charset=utf-8');
  if(kind==='experiments')return download(`${id}-ab-exposures.csv`,csv(experimentComparisonRows(records),['study_id','study_version','session_id','experiment_id','activity_id','variant_id','variant_revision','assigned_at','ended_at','status','time_seconds','click_count','tracker_connected','success_signal_status','self_report']),'text/csv;charset=utf-8');
  const fields={
    tasks:['session_id','study_id','task_id','at','method','experiment_id','variant_id','variant_revision','self_report','observed_success','tracker_connected','time_seconds','click_count'],
    answers:['session_id','study_id','task_id','experiment_id','variant_id','variant_revision','stage','question_id','response','at'],
    interactions:['session_id','study_id','task_id','experiment_id','variant_id','variant_revision','at','type','target','page','x_pct','y_pct','viewport_width','viewport_height'],
    methodEvents:['session_id','study_id','task_id','experiment_id','variant_id','variant_revision','at','method','action','detail']
  }[kind];
  const rows=kind==='methodEvents'?flat.methodEvents.map(e=>({...e,detail:JSON.stringify(e.detail)})):flat[kind];
  download(`${id}-${kind}.csv`,csv(rows,fields),'text/csv;charset=utf-8');
}

function wireActions(){
  $$('.nav-option').forEach(x=>x.addEventListener('click',()=>switchTab(x.dataset.tab)));
  by('studyTitle').closest('section').addEventListener('input',handleEdit);
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
  by('resultsStudy').onchange=()=>refreshResults();by('refreshResults').onclick=refreshResults;
  by('exportTasks').onclick=()=>exportDataset('tasks');by('exportAnswers').onclick=()=>exportDataset('answers');by('exportClicks').onclick=()=>exportDataset('interactions');by('exportAll').onclick=()=>exportDataset('all');by('exportMethods').onclick=()=>exportDataset('methods');by('exportMethodEvents').onclick=()=>exportDataset('methodEvents');by('exportExperiments').onclick=()=>exportDataset('experiments');
  by('sessionsList').onclick=e=>{const b=e.target.closest('[data-session]');if(b){selectedSession=b.dataset.session;selectedTask='';selectedPage='';renderResults();}};
  by('explorerTask').onchange=e=>{selectedTask=e.target.value;selectedPage='';renderExplorer();};by('explorerPage').onchange=e=>{selectedPage=e.target.value;renderExplorer();};
  by('loginForm').onsubmit=async e=>{e.preventDefault();try{await logIn(by('loginEmail').value,by('loginPassword').value);by('loginPassword').value='';renderAuth();toast('Signed in.');const owned=await listOwnedStudies();for(const s of owned){if(!studyIndex.some(x=>x.id===s.id))studyIndex.push({id:s.id,title:s.title,config:`studies/${s.id}.json`});}setStudySelect();}catch(err){toast(`Sign in failed: ${err.message}`);}};
  by('logout').onclick=()=>{logOut();renderAuth();records=[];flat=flattenEvents([]);renderResults();toast('Signed out.');};
}
wireActions();initialize().catch(err=>{toast(err.message,10000);console.error(err);});
