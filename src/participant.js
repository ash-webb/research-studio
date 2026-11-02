import { $, escapeHTML as esc, validateStudy, prototypeURL, questionFields, collectAnswers, uuid, download } from './shared.js';
import { normalizeMethod, scoreTree, scoreFirstClick, randomizeVariants, secureURL, assignExperimentVariant } from './methods.js';
import { StudyWriter } from './storage.js';

let study, writer, sessionId, activeTask=null, taskIndex=0;
let taskStartedAt=0, clickCount=0, taskInteractions=[], trackerConnected=false, observedSuccess=false;
let stage='welcome', prototypeOrigin='', timer=null, lastPage='', activeVariant=null;
// Resume-after-refresh state (v0.3.3). Progress is checkpointed in this tab's sessionStorage,
// which survives reloads and restored tabs but is cleared when the tab is closed.
const RESUME_MAX_AGE_MS=24*60*60*1000;
let resumeKey='', studyHash='', resumeStage='welcome', activityState={}, formDraft=null;
let interruptions=0, interruptedMs=0, resumedIntoActivity=false;
const alertBox=$('#participantAlert');
const query=new URLSearchParams(location.search);
const preview=query.get('preview')==='1';
const $main=()=>$('#participantMain');

function alertMessage(msg){alertBox.textContent=msg;alertBox.classList.remove('hidden');setTimeout(()=>alertBox.classList.add('hidden'),6500);}
function setSaveStatus(status,message=''){
  const el=$('#saveStatus');
  if(status==='demo')el.textContent=preview?'Preview · not counted in results':'Local demo · this browser only';
  else if(status==='saved')el.textContent='Responses synced';
  else if(status==='error'){el.textContent='Sync pending';if(message)alertMessage(`Some responses have not synced. ${message}`);}
}
function progress(value,label){$('#progressFill').style.width=`${Math.min(100,Math.round(value*100))}%`;$('#stepCount').textContent=label;}
// Replaces the screen and moves focus into it, so keyboard and screen-reader users are not
// sent back to the top of the page. focus: a selector to focus, 'h1' (default) for the new
// heading, or null to leave focus alone (first load).
function render(markup,focus='h1'){
  $main().innerHTML=markup;
  if(focus===null){window.scrollTo(0,0);return;}
  const target=(focus&&$main().querySelector(focus))||$main().querySelector('h1');
  if(!target){window.scrollTo(0,0);return;}
  if(target.matches('h1,h2,section,div,p'))target.setAttribute('tabindex','-1');
  if(focus==='h1'||target.matches('h1'))window.scrollTo(0,0);
  target.focus({preventScroll:focus==='h1'});
}
// Polite announcement for changes that do not move to a new screen.
function announce(message){const el=$('#srStatus');if(!el)return;el.textContent='';setTimeout(()=>{el.textContent=message;},30);}
function elapsed(){return Math.round((Date.now()-taskStartedAt)/1000);}

// ---------- resume after refresh ----------
function hashText(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function readCheckpoint(){try{return JSON.parse(sessionStorage.getItem(resumeKey)||'null');}catch{return null;}}
function clearCheckpoint(){try{sessionStorage.removeItem(resumeKey);}catch{}}
// Saves where the participant is. stage: pre | start | activity | reflection | followup | post | finish | complete.
// 'start' and 'finish' mark points where the previous step's records are already written, so a
// reload continues forward instead of repeating that step.
function persist(stageName=resumeStage,index=taskIndex){
  if(!sessionId||!resumeKey)return;
  resumeStage=stageName;
  const cp={v:1,studyId:study.id,hash:studyHash,sessionId,stage:stageName,taskIndex:index,taskStartedAt,
    interruptions,interruptedMs,activity:activityState,draft:formDraft,savedAt:Date.now()};
  try{sessionStorage.setItem(resumeKey,JSON.stringify(cp));}catch{}
}
function saveActivity(state){activityState=state;persist('activity');}
// Another open tab of the same session answers this; a duplicated tab must not write into it.
const sessionChannel=('BroadcastChannel' in window)?new BroadcastChannel('utp-session-v1'):null;
sessionChannel?.addEventListener('message',e=>{if(e.data?.type==='ping'&&e.data.sessionId&&e.data.sessionId===sessionId&&stage!=='welcome')sessionChannel.postMessage({type:'here',sessionId,token:e.data.token});});
function sessionOpenElsewhere(id){
  if(!sessionChannel)return Promise.resolve(false);
  return new Promise(resolve=>{const token=uuid();const on=e=>{if(e.data?.type==='here'&&e.data.token===token){sessionChannel.removeEventListener('message',on);resolve(true);}};
    sessionChannel.addEventListener('message',on);sessionChannel.postMessage({type:'ping',sessionId:id,token});setTimeout(()=>{sessionChannel.removeEventListener('message',on);resolve(false);},250);});
}
function sessionHistory(){
  if(writer?.remote)return writer.history;
  try{return JSON.parse(localStorage.getItem('utp-demo-events-v1')||'[]').filter(e=>e.session_id===sessionId);}catch{return writer?.history||[];}
}
async function resume(cp){
  if(await sessionOpenElsewhere(cp.sessionId)){
    render(`<section class="welcome-card"><span class="eyebrow accent">ALREADY OPEN</span><h1>This study is open in another tab</h1><p>Please continue in the other tab. Using two tabs for the same session would mix up your responses.</p></section>`,null);
    progress(0,'Open in another tab');return;
  }
  sessionId=cp.sessionId;taskIndex=cp.taskIndex||0;writer=new StudyWriter(study.id,sessionId,setSaveStatus,preview);
  if(cp.stage==='complete'){stage='complete';showCompleted(true);return;}
  const gap=Math.max(0,Date.now()-(cp.savedAt||Date.now()));
  const task=study.tasks[taskIndex];
  writer.add('session_resumed',['activity','reflection','followup'].includes(cp.stage)?task?.id||null:null,{stage:cp.stage,order:taskIndex+1,gap_seconds:Math.round(gap/1000),viewport_width:innerWidth,viewport_height:innerHeight});
  if(!writer.remote)setSaveStatus('demo');
  formDraft=cp.draft||null;
  alertMessage('Welcome back. Your place in the study has been restored.');
  switch(cp.stage){
    case 'pre':showPre();break;
    case 'start':startActivity();break;
    case 'followup':activeTask=task;activeVariant=normalizeMethod(task)==='ab_test'?assignExperimentVariant(sessionId,study.id,task):null;showFollowup();break;
    case 'post':showPost();break;
    case 'finish':finishStudy();break;
    case 'activity':case 'reflection':resumeActivity(cp,gap);break;
    default:startActivity();
  }
}
function resumeActivity(cp,gap){
  activeTask=study.tasks[taskIndex];
  activeVariant=normalizeMethod(activeTask)==='ab_test'?assignExperimentVariant(sessionId,study.id,activeTask):null;
  stage='activity';taskStartedAt=cp.taskStartedAt||Date.now();taskInteractions=[];lastPage='';
  interruptions=(cp.interruptions||0)+1;interruptedMs=(cp.interruptedMs||0)+gap;resumedIntoActivity=true;
  activityState=cp.activity||{};
  clickCount=activityState.clickCount||0;trackerConnected=!!activityState.trackerConnected;observedSuccess=!!activityState.observedSuccess;
  progress(.12+taskIndex/study.tasks.length*.73,`Activity ${taskIndex+1} of ${study.tasks.length}`);
  clearInterval(timer);persist('activity');
  if(cp.stage==='reflection'&&['prototype','ab_test'].includes(normalizeMethod(activeTask))){finishPrototype();return;}
  launchMethod(activityState);
}
function launchMethod(saved={}){
  switch(normalizeMethod(activeTask)){
    case 'prototype':case 'ab_test':startPrototype();break;
    case 'card_sort':startCardSort(saved);break;
    case 'tree_test':startTreeTest(saved);break;
    case 'first_click':startFirstClick(saved);break;
    case 'preference':startPreference(saved);break;
    case 'survey':startSurvey();break;
  }
}
// Half-typed answers are kept in this tab so a reload does not lose them.
function draftValues(form){
  const out={};
  for(const el of form.querySelectorAll('[name]')){
    if(el.type==='radio'){if(el.checked)out[el.name]=el.value;else if(!(el.name in out))out[el.name]=out[el.name]??null;}
    else if(el.type==='checkbox'){out[el.name]||=[];if(el.checked)out[el.name].push(el.value);}
    else out[el.name]=el.value;
  }
  return out;
}
function restoreDraft(form,values){
  for(const [name,value] of Object.entries(values||{})){
    for(const el of form.querySelectorAll(`[name="${CSS.escape(name)}"]`)){
      if(el.type==='radio')el.checked=el.value===value;
      else if(el.type==='checkbox')el.checked=Array.isArray(value)&&value.includes(el.value);
      else if(typeof value==='string')el.value=value;
    }
  }
}
function event(action,detail={}){writer.add('method_event',activeTask.id,{method:normalizeMethod(activeTask),action,detail});}
function instructionCard(title,subtitle=''){
 return `<div class="method-intro"><span class="eyebrow accent">${esc(normalizeMethod(activeTask).replaceAll('_',' ').toUpperCase())} · ${taskIndex+1} OF ${study.tasks.length}</span><h1>${esc(title)}</h1><p>${esc(activeTask.instructions)}</p>${subtitle?`<p class="helper">${esc(subtitle)}</p>`:''}</div>`;
}
function cardButton(text,id='nextMethod',type='primary'){return `<button type="button" id="${esc(id)}" class="btn btn-${type}">${esc(text)}</button>`;}
function methodTemplate(content){return `<section class="method-card">${instructionCard(activeTask.title||'Activity')}${content}</section>`;}

async function init(){
  try{
    if(preview)study=JSON.parse(localStorage.getItem('utp-preview-study')||'null');
    else {
      const id=query.get('study')||'demo-portal';
      if(!/^[a-z0-9-]{3,64}$/.test(id))throw new Error('Invalid study ID.');
      const response=await fetch(`studies/${id}.json`,{cache:'no-store'});
      if(!response.ok)throw new Error(`Study ${id} was not found. Check that its JSON file is published to GitHub Pages.`);
      study=await response.json();
      if(study.id!==id)throw new Error('Study ID does not match its published configuration.');
    }
    validateStudy(study);
    document.title=`${study.title} · Research Studio`;
    studyHash=hashText(JSON.stringify(study));resumeKey=`utp-resume-v1:${preview?'preview':'live'}:${study.id}`;
    const cp=readCheckpoint();
    if(cp&&cp.v===1&&cp.studyId===study.id&&cp.hash===studyHash&&cp.sessionId&&Date.now()-(cp.savedAt||0)<RESUME_MAX_AGE_MS){await resume(cp);return;}
    if(cp)clearCheckpoint(); // changed study, expired, or unreadable: start a fresh session
    progress(0,'Introduction');welcome();
  }catch(err){render(`<section class="welcome-card"><h1>Study unavailable</h1><p>${esc(err.message)}</p><a class="btn btn-outline" href="index.html">Return to Research Studio</a></section>`,null);}
}
function welcome(){
  stage='welcome';
  render(`<section class="welcome-card"><span class="eyebrow accent">UNMODERATED RESEARCH STUDY</span><h1>${esc(study.title)}</h1><p>${esc(study.welcome||study.description||'')}</p><div class="notice"><strong>What this study may collect</strong><br>Task timing, navigation choices, random design assignment for implementation comparisons, card groupings and names, first-click locations, preferences, and answers you explicitly submit. An instrumented prototype may also record click locations and navigation. No screen recording, passwords, or typed prototype form values are collected by the tracker. Please do not enter sensitive personal information.</div><label class="consent"><input id="consentCheck" type="checkbox"><span>${esc(study.consent||'I agree to participate and to the data collection described above.')}</span></label><button id="startStudy" class="btn btn-primary" disabled>Agree and begin study →</button><p class="small muted" style="margin-top:18px">Participation is voluntary. You can close the page at any point.</p></section>`,null);
  $('#consentCheck').onchange=e=>$('#startStudy').disabled=!e.target.checked;
  $('#startStudy').onclick=()=>{
    sessionId=uuid();writer=new StudyWriter(study.id,sessionId,setSaveStatus,preview);
    writer.add('session_started',null,{study_version:study.version||'1.0.0',viewport_width:innerWidth,viewport_height:innerHeight,consent:true,...(preview?{preview:true}:{})});
    if(study.preQuestions?.length)showPre();else{persist('start',0);startActivity();}
  };
}
function formPage(eyebrow,title,helper,questions,onSubmit){
  const draftKey=`${resumeStage}:${taskIndex}`;
  render(`<section class="survey-card"><span class="eyebrow accent">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p>${esc(helper)}</p><form id="questionForm">${questionFields(questions,'form')}<div id="formError" class="notice warning hidden" role="alert"></div><button class="btn btn-primary" type="submit">Continue →</button></form></section>`);
  const formEl=$('#questionForm');
  if(formDraft?.key===draftKey)restoreDraft(formEl,formDraft.values);else formDraft=null;
  const keepDraft=()=>{formDraft={key:draftKey,values:draftValues(formEl)};persist();};
  formEl.addEventListener('input',keepDraft);formEl.addEventListener('change',keepDraft);
  formEl.onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;try{const answers=collectAnswers(form,questions);$('#formError').classList.add('hidden');formDraft=null;await onSubmit(answers);}catch(err){
    $('#formError').textContent=err.message;$('#formError').classList.remove('hidden');
    // Take the participant straight to the unanswered question.
    form.querySelectorAll('[aria-invalid]').forEach(x=>x.removeAttribute('aria-invalid'));
    const first=err.questionId?form.querySelector(`[name="${CSS.escape(err.questionId)}"]`):null;
    if(first){first.closest('.question')?.querySelector('[role=group]')?.setAttribute('aria-invalid','true');first.focus();}
  }};
}
function showPre(){stage='pre';persist('pre');progress(.08,'Before the activities');formPage('BEFORE WE BEGIN','A few quick questions','Please answer the following questions.',study.preQuestions,async answers=>{
 writer.add('answers',null,{stage:'pre',answers});persist('start',0);await writer.flush();startActivity();
});}
function startActivity(){
  if(taskIndex>=study.tasks.length){showPost();return;}
  stage='activity';activeTask=study.tasks[taskIndex];activeVariant=null;taskStartedAt=Date.now();clickCount=0;taskInteractions=[];trackerConnected=false;observedSuccess=false;lastPage='';
  activityState={};interruptions=0;interruptedMs=0;resumedIntoActivity=false;formDraft=null;
  if(normalizeMethod(activeTask)==='ab_test')activeVariant=assignExperimentVariant(sessionId,study.id,activeTask);
  progress(.12+taskIndex/study.tasks.length*.73,`Activity ${taskIndex+1} of ${study.tasks.length}`);
  writer.add('task_started',activeTask.id,{method:normalizeMethod(activeTask),order:taskIndex+1,...(activeVariant?{experiment_id:activeTask.experimentId||activeTask.id,variant_id:activeVariant.id,variant_revision:activeVariant.revision||null,assignment:'stable-hash-equal'}:{})});
  persist('activity');
  clearInterval(timer);
  launchMethod();
}
async function completeActivity(result={}, options={}){
  if(stage!=='activity')return;
  stage='transition';clearInterval(timer);flushInteractions();
  writer.add('task_ended',activeTask.id,{
    method:normalizeMethod(activeTask),result,time_seconds:elapsed(),
    ...(activeVariant?{experiment_id:activeTask.experimentId||activeTask.id,variant_id:activeVariant.id,variant_revision:activeVariant.revision||null}:{}),
    ...(options.selfReport!==undefined?{self_report:options.selfReport}:{}),
    ...(options.observedSuccess!==undefined?{observed_success:options.observedSuccess}:{}),
    ...(['prototype','ab_test'].includes(normalizeMethod(activeTask))?{tracker_connected:trackerConnected,click_count:clickCount}:{}),
    // Reloads during the activity: time_seconds stays wall-clock; interrupted_seconds is the time away.
    ...(interruptions?{interruptions,interrupted_seconds:Math.round(interruptedMs/1000)}:{})
  });
  const followup=normalizeMethod(activeTask)!=='survey' && activeTask.questions?.length;
  activityState={};formDraft=null;
  if(followup)persist('followup');else persist('start',taskIndex+1);
  await writer.flush();
  if(followup)showFollowup();
  else nextActivity();
}
function showFollowup(){
  stage='followup';persist('followup');progress(.12+(taskIndex+.7)/study.tasks.length*.73,`Activity ${taskIndex+1} follow-up`);
  formPage('AFTER THIS ACTIVITY','A few follow-up questions','Please answer based on what you just experienced.',activeTask.questions,async answers=>{
    writer.add('answers',activeTask.id,{stage:'post_task',answers});persist('start',taskIndex+1);await writer.flush();nextActivity();
  });
}
function nextActivity(){taskIndex++;startActivity();}
function showPost(){stage='post';clearInterval(timer);progress(.94,'Final questions');if(!study.postQuestions?.length){persist('finish');finishStudy();return;}
 persist('post');
 formPage('ALMOST FINISHED','Final questions','Your feedback helps identify opportunities for improvement.',study.postQuestions,async answers=>{
   writer.add('answers',null,{stage:'post',answers});persist('finish');await writer.flush();finishStudy();
 });
}
async function finishStudy(){
  stage='complete';progress(1,'Study complete');writer.add('session_completed',null,{});formDraft=null;activityState={};persist('complete');await showCompleted(false);
}
// already: true when the participant reloads after finishing; nothing new is recorded.
async function showCompleted(already){
  stage='complete';progress(1,'Study complete');const ok=await writer.flush();
  render(`<section class="done-card"><span class="eyebrow accent">STUDY COMPLETE</span><h1>${already?'You have already completed this study.':'Thank you for participating.'}</h1><p>${already?'Your earlier responses are kept. There is nothing more to do; you can close this tab.':'Your contributions to this research session have been recorded.'}</p><div id="finalSaveNotice" class="notice ${ok?'':'warning'}">${writer.isSaved?(writer.remote?'All responses have synced to the research database.':'This is a local demonstration. Your responses were saved only in this browser and were not sent to a researcher.'):'Some responses could not sync. You can retry or download a copy of this session.'}</div><div class="actions-row">${cardButton('Download a copy of this session','responseCopy','outline')}${writer.isSaved?'':cardButton('Retry sync','retrySave')}${already&&!writer.remote?cardButton('Start a new session','newSession','outline'):''}</div>${already&&!writer.remote?'<p class="small muted">“Start a new session” is only offered in local demo and preview mode, for piloting.</p>':''}</section>`);
  if($('#newSession'))$('#newSession').onclick=()=>{clearCheckpoint();location.reload();};
  $('#responseCopy').onclick=()=>download(`${study.id}-session-${sessionId}.json`,JSON.stringify(sessionHistory(),null,2),'application/json');
  if($('#retrySave'))$('#retrySave').onclick=async()=>{const synced=await writer.flush();if(synced)$('#retrySave').classList.add('hidden');$('#finalSaveNotice')?.replaceChildren(document.createTextNode(synced?'Responses synced.':'Sync still unavailable.'));};
}

// Prototype usability method: the embedded page must include sdk/utp-tracker.js.
function startPrototype(){
  const url=prototypeURL(activeVariant?.prototypeUrl||activeTask.prototypeUrl||study.prototypeUrl);
  prototypeOrigin=new URL(url).origin;
  render(`<div class="task-shell"><section class="prototype-pane"><div class="pane-top"><span>INTERACTIVE DESIGN</span><span id="bridgeIndicator" class="live-indicator">Waiting for tracker</span></div><iframe id="prototypeFrame" src="${esc(url)}" title="Prototype for ${esc(activeTask.title||activeTask.id)}" allow="fullscreen"></iframe></section><aside class="task-instructions"><span class="eyebrow accent">ACTIVITY ${taskIndex+1} OF ${study.tasks.length}</span><h1>${esc(activeTask.title||'Prototype task')}</h1><p>${esc(activeTask.instructions)}</p>${resumedIntoActivity?'<div class="notice" id="resumeNotice">The page was reloaded, so the design has restarted from its first screen. Your time and clicks so far are kept.</div>':''}<div class="task-meta"><span>Elapsed <strong id="taskElapsed">0:00</strong></span><span>Clicks <strong id="taskClicks">${clickCount}</strong></span></div>${cardButton('Finish this task →','finishTask')}<span class="small muted">When finished, or if you cannot complete the task, select Finish this task.</span></aside></div>`);
  timer=setInterval(()=>{const t=Math.floor((Date.now()-taskStartedAt)/1000);const f=$('#taskElapsed');if(f)f.textContent=`${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;},1000);
  $('#finishTask').onclick=finishPrototype;
}
function flushInteractions(){if(!taskInteractions.length||!writer||!activeTask)return;const hits=taskInteractions.splice(0);for(let i=0;i<hits.length;i+=20)writer.add('interaction_batch',activeTask.id,{items:hits.slice(i,i+20)});}
function finishPrototype(){
  if(stage!=='activity')return;
  clearInterval(timer);stage='prototype_reflection';flushInteractions();activityState={clickCount,trackerConnected,observedSuccess};persist('reflection');
  render(`<section class="survey-card"><span class="eyebrow accent">AFTER THE TASK</span><h1>How did that task go?</h1><p>Please indicate whether you believe you completed the task. Your answer is measured separately from a prototype success signal.</p><form id="reflectionForm"><div class="question"><span class="question-title">Were you able to complete the task? <span class="required">*</span></span><div class="reflection-choice"><label><input type="radio" name="selfReport" value="completed" required> Yes, I completed it</label><label><input type="radio" name="selfReport" value="unable" required> No, I could not complete it</label></div></div><button type="submit" class="btn btn-primary">Continue →</button></form></section>`);
  $('#reflectionForm').onsubmit=async e=>{
    e.preventDefault();const selfReport=e.currentTarget.querySelector('[name="selfReport"]:checked')?.value;
    if(!selfReport)return;
    stage='activity';
    const isAB=normalizeMethod(activeTask)==='ab_test';
    const successStatus=activeTask.successSignal && trackerConnected?(observedSuccess?'received':'not_observed'):'unavailable';
    const result={success_signal_received:observedSuccess,success_signal_status:successStatus,
      ...(isAB?{experiment_id:activeTask.experimentId||activeTask.id,variant_id:activeVariant.id,variant_revision:activeVariant.revision||null}:{} )};
    // Without a configured signal and a connected tracker there is no evidence either way,
    // so observed_success is left out rather than recorded as false.
    const observed=isAB?(successStatus==='received'?true:undefined):(successStatus==='unavailable'?undefined:observedSuccess);
    await completeActivity(result,{selfReport,observedSuccess:observed});
  };
}
window.addEventListener('message',e=>{
  if(stage!=='activity'||!activeTask||!['prototype','ab_test'].includes(normalizeMethod(activeTask)))return;
  const frame=$('#prototypeFrame');if(!frame||e.source!==frame.contentWindow||e.origin!==prototypeOrigin)return;
  const m=e.data;
  if(!m||m.namespace!=='UTP_BRIDGE'||m.version!==1||!['ready','click','scroll','screen','success','custom'].includes(m.type))return;
  if(!trackerConnected){trackerConnected=true;saveActivity({clickCount,trackerConnected,observedSuccess});}
  $('#bridgeIndicator').textContent='Click tracking active';$('#bridgeIndicator').classList.add('connected');
  if(m.type==='success' && m.task_id===activeTask.successSignal){observedSuccess=true;saveActivity({clickCount,trackerConnected,observedSuccess});return;}
  if(m.type==='ready'){lastPage=String(m.page||'').slice(0,90);return;}
  if(['click','scroll','screen','custom'].includes(m.type)){
    const hit={type:m.type,at:new Date().toISOString(),page:String(m.page||lastPage||'').slice(0,90),target:String(m.target||m.name||'').slice(0,90),x_pct:Math.min(100,Math.max(0,Number(m.x_pct)||0)),y_pct:Math.min(100,Math.max(0,Number(m.y_pct)||0)),viewport_width:Math.max(0,Number(m.viewport_width)||0),viewport_height:Math.max(0,Number(m.viewport_height)||0),...(['keyboard','pointer'].includes(m.input)?{input:m.input}:{})};
    taskInteractions.push(hit);if(m.type==='click'){clickCount++;if($('#taskClicks'))$('#taskClicks').textContent=clickCount;saveActivity({clickCount,trackerConnected,observedSuccess});}
    if(taskInteractions.length>=20)flushInteractions();
  }
});

// Card sort: native drag/drop plus a labeled select on every card for keyboard and mobile.
function startCardSort(saved={}){
  const groups=Object.fromEntries((activeTask.cards||[]).map(c=>[c.id,saved.groups?.[c.id]||'']));
  const created=Array.isArray(saved.created)?saved.created.filter(c=>/^created-\d+$/.test(c.id)&&typeof c.label==='string'):[];
  let moves=Number(saved.moves)||0;
  const keep=()=>saveActivity({groups:{...groups},created:[...created],moves});
  const categories=()=>[...(activeTask.sortMode==='open'?[]:activeTask.categories||[]),...created];
  const methodAction=(action,detail)=>{moves++;event(action,detail);};
  function assign(cardId,categoryId){if(!Object.hasOwn(groups,cardId))return;if(categoryId&&!categories().some(c=>c.id===categoryId))return;groups[cardId]=categoryId;methodAction('card_assignment',{card_id:cardId,category_id:categoryId||null});keep();show(`select[data-assign-card="${CSS.escape(cardId)}"]`);
    const card=activeTask.cards.find(c=>c.id===cardId),cat=categories().find(c=>c.id===categoryId),done=Object.values(groups).filter(Boolean).length;
    announce(`${card?.label||cardId} moved to ${cat?.label||'Unsorted'}. ${done} of ${activeTask.cards.length} cards grouped.`);}
  function show(focus='h1'){
    const cats=categories();const assigned=Object.values(groups).filter(Boolean).length;
    const cardMarkup=c=>`<div class="sort-card" draggable="true" data-drag-card="${esc(c.id)}"><span class="sort-grip" aria-hidden="true">⠿</span><span class="sort-card-title">${esc(c.label)}</span><label class="sort-card-select"><span class="sr-only">Category for ${esc(c.label)}</span><select data-assign-card="${esc(c.id)}" aria-label="Category for ${esc(c.label)}"><option value="">Unsorted</option>${cats.map(cat=>`<option value="${esc(cat.id)}" ${groups[c.id]===cat.id?'selected':''}>${esc(cat.label)}</option>`).join('')}</select></label></div>`;
    const groupsMarkup=cats.map(cat=>`<section class="sort-dropzone" data-drop-category="${esc(cat.id)}"><div class="sort-zone-heading"><strong>${esc(cat.label)}</strong><small>${Object.values(groups).filter(x=>x===cat.id).length} cards</small></div><div class="sort-zone-cards">${activeTask.cards.filter(c=>groups[c.id]===cat.id).map(cardMarkup).join('')||'<div class="drop-placeholder">Drag a card here or use its category menu</div>'}</div></section>`).join('');
    render(methodTemplate(`<div class="sort-progress"><strong>${assigned} of ${activeTask.cards.length} cards grouped</strong><span>${esc(activeTask.sortMode)} sort</span></div><div class="sort-layout"><section class="sort-unsorted" data-drop-category=""><div class="sort-zone-heading"><strong>Unsorted cards</strong><small>${activeTask.cards.length-assigned} remaining</small></div>${activeTask.cards.filter(c=>!groups[c.id]).map(cardMarkup).join('')||'<p class="muted small">All cards have been assigned.</p>'}</section><div class="sort-zones">${groupsMarkup||'<div class="notice">Create a group to begin sorting.</div>'}${activeTask.sortMode!=='closed'?`<form id="addGroupForm" class="add-group-form"><label for="newGroupName" class="field">New category name<input id="newGroupName" required maxlength="80" placeholder="Enter a group name"></label><button class="btn btn-outline" type="submit">+ Add group</button></form>`:''}</div></div><div class="method-actions"><button id="submitSort" class="btn btn-primary" ${assigned!==activeTask.cards.length?'disabled':''}>Finish card sort →</button><button id="skipSort" class="btn btn-outline">I cannot finish grouping</button></div>`),focus);
    $main().querySelectorAll('[data-assign-card]').forEach(el=>el.onchange=e=>assign(e.target.dataset.assignCard,e.target.value));
    if($('#addGroupForm'))$('#addGroupForm').onsubmit=e=>{e.preventDefault();const label=$('#newGroupName').value.trim();if(!label)return;
      if(categories().some(cat=>cat.label.toLocaleLowerCase()===label.toLocaleLowerCase()))return alertMessage('That category name already exists.');
      const id=`created-${created.length+1}`;created.push({id,label});methodAction('category_created',{category_id:id,label});keep();show('#newGroupName');announce(`Group "${label}" added. Cards can now be moved to it.`);};
    $main().querySelectorAll('[data-drag-card]').forEach(el=>el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',el.dataset.dragCard);e.dataTransfer.effectAllowed='move';}));
    $main().querySelectorAll('[data-drop-category]').forEach(el=>{el.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});el.addEventListener('drop',e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');if(Object.hasOwn(groups,id))assign(id,el.dataset.dropCategory);});});
    $('#submitSort').onclick=()=>completeActivity({sort_mode:activeTask.sortMode,groups,categories:cats,move_count:moves,completed:true});
    $('#skipSort').onclick=()=>completeActivity({sort_mode:activeTask.sortMode,groups,categories:cats,move_count:moves,completed:false,participant_could_not_finish:true});
  }
  show();
}

// Tree test: the answer is never disclosed to the participant. Navigation events
// preserve detours, backtracking, first selection, and final selected destination.
function startTreeTest(saved={}){
  let stack=[],history=Array.isArray(saved.history)?saved.history.slice(0,500):[];
  for(const id of Array.isArray(saved.path)?saved.path:[]){const next=(stack.length?stack.at(-1).children||[]:activeTask.tree).find(n=>n.id===id);if(!next)break;stack.push(next);}
  const keep=()=>saveActivity({path:stack.map(n=>n.id),history});
  const currentChildren=()=>stack.length?stack.at(-1).children||[]:activeTask.tree;
  function show(moved=false){
    const current=stack.at(-1);
    const breadcrumb=`<nav class="tree-breadcrumb" aria-label="Navigation path"><button type="button" data-tree-root>Start</button>${stack.map((n,i)=>`<span aria-hidden="true">›</span><button type="button" data-tree-level="${i}" ${i===stack.length-1?'aria-current="location"':''}>${esc(n.label)}</button>`).join('')}</nav>`;
    render(methodTemplate(`${breadcrumb}<div class="tree-explorer"><div class="tree-section-title">${current?`Inside ${esc(current.label)}`:'Choose a starting location'}</div><div class="tree-choices">${currentChildren().length?currentChildren().map(n=>`<button type="button" class="tree-choice" data-tree-node="${esc(n.id)}"><span class="tree-choice-icon" aria-hidden="true">${n.children?.length?'▤':'◻'}</span><span>${esc(n.label)}</span><span aria-hidden="true">›</span></button>`).join(''):'<p class="muted">There are no more items inside this location.</p>'}</div></div><div class="method-actions">${current?cardButton('Select this location →','selectDestination'):''}<button class="btn btn-outline" id="cannotFind">I cannot find it</button></div><p class="small muted">Select the location where you expect the requested information to be. You can navigate back if needed.</p>`),moved?'.tree-choices .tree-choice, #selectDestination':'h1');
    if(moved){const kids=currentChildren();announce(current?`Inside ${current.label}. ${kids.length?`${kids.length} item${kids.length===1?'':'s'}.`:'No more items inside. You can select this location or go back.'}`:`Starting locations. ${kids.length} items.`);}
    function navigateTo(nodes){stack=nodes;show();}
    $main().querySelectorAll('[data-tree-node]').forEach(el=>el.onclick=()=>{
      const n=currentChildren().find(x=>x.id===el.dataset.treeNode);if(!n)return;
      stack.push(n);const entry={action:'open',node_id:n.id,at_ms:Date.now()-taskStartedAt};history.push(entry);event('tree_open',entry);keep();show(true);
    });
    $main().querySelectorAll('[data-tree-level]').forEach(el=>el.onclick=()=>{
      const idx=Number(el.dataset.treeLevel);if(idx<stack.length-1){const popped=stack.slice(idx+1).map(x=>x.id);stack=stack.slice(0,idx+1);const entry={action:'back',to_node:stack.at(-1)?.id||null,popped,at_ms:Date.now()-taskStartedAt};history.push(entry);event('tree_back',entry);keep();show(true);}
    });
    if($main().querySelector('[data-tree-root]'))$main().querySelector('[data-tree-root]').onclick=()=>{
      if(stack.length){const entry={action:'back',to_node:null,popped:stack.map(x=>x.id),at_ms:Date.now()-taskStartedAt};history.push(entry);event('tree_back',entry);stack=[];keep();show(true);}
    };
    if($('#selectDestination'))$('#selectDestination').onclick=()=>{
      const chosen=stack.at(-1).id;event('tree_selected',{node_id:chosen});completeActivity(scoreTree(activeTask.tree,activeTask.correctNodeIds,chosen,history),{observedSuccess:activeTask.correctNodeIds.includes(chosen)});
    };
    $('#cannotFind').onclick=()=>{event('tree_unable',{});completeActivity({...scoreTree(activeTask.tree,activeTask.correctNodeIds,null,history),participant_could_not_find:true},{observedSuccess:false});};
  }
  show();
}

function startFirstClick(saved={}){
  let first=saved.first&&Number.isFinite(saved.first.x_pct)?saved.first:null,pending=null;
  const image=secureURL(activeTask.imageUrl,location.href);
  const alt=activeTask.imageAlt||'Interface screenshot for first-click test';
  // input records how the position was chosen: 'pointer' (mouse/touch) or 'keyboard'.
  function record(x,y,input){
    first={x_pct:Math.round(x*100)/100,y_pct:Math.round(y*100)/100,at_ms:Date.now()-taskStartedAt,input};
    event('first_click',first);saveActivity({first});show('#submitFirstClick');announce('First click recorded. Select Continue when ready.');
  }
  function show(focus='h1'){
    // Once the first click is made it is final, so the "not sure" option and keyboard marker are withdrawn.
    const interactive=!first;
    render(methodTemplate(`<div class="image-test"><p class="helper" id="firstClickHelp">Click or tap the first place you would go. Your first selection is final.${interactive?' <span class="keyboard-hint">Using a keyboard? Move to the screenshot, press Enter to show a marker, move it with the arrow keys (hold Shift for bigger steps), then press Enter again to confirm. Escape removes the marker.</span>':''}</p><div class="click-image-frame" ${interactive?`tabindex="0" role="application" aria-label="${esc(alt)}. First-click area" aria-describedby="firstClickHelp"`:''}><img id="firstClickImage" src="${esc(image)}" alt="${esc(alt)}" draggable="false">${first?`<span class="first-click-marker" style="left:${first.x_pct}%;top:${first.y_pct}%" aria-hidden="true"></span>`:'<span class="first-click-marker pending" hidden aria-hidden="true"></span>'}</div></div><div class="method-actions">${first?cardButton('Continue →','submitFirstClick'):'<button class="btn btn-outline" id="cannotChoose">I\'m not sure where to click</button>'}</div>`),focus);
    const img=$('#firstClickImage');img.onerror=()=>alertMessage('Could not load the test image. Ask the researcher to check the URL.');
    img.onclick=e=>{
      if(first)return;const r=e.currentTarget.getBoundingClientRect();
      record((e.clientX-r.left)/r.width*100,(e.clientY-r.top)/r.height*100,'pointer');
    };
    const frame=$main().querySelector('.click-image-frame[tabindex]'),marker=$main().querySelector('.first-click-marker.pending');
    if(frame)frame.onkeydown=e=>{
      const place=()=>{marker.hidden=false;marker.style.left=`${pending.x}%`;marker.style.top=`${pending.y}%`;};
      if(e.key==='Enter'||e.key===' '){e.preventDefault();
        if(!pending){pending={x:50,y:50};place();announce('Marker shown in the centre of the screenshot. Move it with the arrow keys, press Enter to confirm, or Escape to remove it.');}
        else record(pending.x,pending.y,'keyboard');
        return;}
      if(e.key==='Escape'&&pending){e.preventDefault();pending=null;marker.hidden=true;announce('Marker removed.');return;}
      const step=e.shiftKey?10:2,moves={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
      if(moves&&pending){e.preventDefault();pending.x=Math.min(100,Math.max(0,pending.x+moves[0]));pending.y=Math.min(100,Math.max(0,pending.y+moves[1]));place();}
    };
    if($('#submitFirstClick'))$('#submitFirstClick').onclick=()=>completeActivity({click:first,hit_target:scoreFirstClick(first,activeTask.targetAreas||[]),scored:!!activeTask.targetAreas?.length},{observedSuccess:scoreFirstClick(first,activeTask.targetAreas||[])??undefined});
    // "Not sure" on a scored test is an observed miss, like "I cannot find it" in a tree test.
    if($('#cannotChoose'))$('#cannotChoose').onclick=()=>{event('first_click_unsure',{});const scored=!!activeTask.targetAreas?.length;completeActivity({click:null,hit_target:null,scored,participant_could_not_choose:true},{observedSuccess:scored?false:undefined});};
  }
  show();
}

function startPreference(saved={}){
  // The randomised order is kept so a reload shows (and records) the same order.
  const restored=Array.isArray(saved.order)?saved.order.map(id=>activeTask.variants.find(v=>v.id===id)).filter(Boolean):[];
  const options=restored.length===activeTask.variants.length?restored:randomizeVariants(activeTask.variants);
  if(!restored.length||restored.length!==activeTask.variants.length)saveActivity({order:options.map(v=>v.id)});
  let selection=null;
  render(methodTemplate(`<div class="preference-grid">${options.map((v,i)=>`<label class="preference-option"><input type="radio" name="preference" value="${esc(v.id)}"><span class="preference-image"><img src="${esc(secureURL(v.imageUrl,location.href))}" alt="${esc(v.label||`Design option ${i+1}`)}"></span><strong>${esc(v.label||`Option ${i+1}`)}</strong></label>`).join('')}</div><div class="no-preference"><label><input name="preference" type="radio" value="__none__"> I do not have a preference</label></div><div class="method-actions"><button id="submitPreference" class="btn btn-primary" disabled>Continue →</button></div>`));
  $main().querySelectorAll('[name="preference"]').forEach(el=>el.onchange=e=>{selection=e.target.value;$('#submitPreference').disabled=false;});
  $('#submitPreference').onclick=()=>{if(!selection)return;event('preference_selected',{selected_id:selection});completeActivity({selected_id:selection==='__none__'?null:selection,no_preference:selection==='__none__',display_order:options.map(x=>x.id)});};
}
function startSurvey(){
  formPage('SURVEY',activeTask.title||'Survey',activeTask.instructions,activeTask.questions||[],async answers=>{
    writer.add('answers',activeTask.id,{stage:'activity',answers});
    stage='activity';await completeActivity({answered_question_ids:Object.keys(answers),response_count:Object.keys(answers).length});
  });
}
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&stage==='activity')flushInteractions();});
// Before a reload or tab close: write buffered interactions and stamp the checkpoint time.
window.addEventListener('pagehide',()=>{if(stage==='activity')flushInteractions();if(stage!=='welcome'&&stage!=='complete')persist();});
setInterval(()=>{if(stage==='activity')flushInteractions();writer?.flush().catch(()=>{});},7000);
init();
