import { $, escapeHTML as esc, validateStudy, prototypeURL, questionFields, collectAnswers, uuid, download } from './shared.js';
import { normalizeMethod, scoreTree, scoreFirstClick, randomizeVariants, secureURL, resolveAssignments, variantForTask, cleanExternalId, safeReturnUrl, buildReturnUrl } from './methods.js';
import { StudyWriter } from './storage.js';
import { deviceClass } from './abstats.js';
import { EMBED_NS, EMBED_VERSION, hostAllowed, surveyFields } from './qualtrics-embed.js';
import { deviceKind, allowedOn } from './devices.js';

let study, writer, sessionId, activeTask=null, taskIndex=0;
let taskStartedAt=0, clickCount=0, taskInteractions=[], trackerConnected=false, observedSuccess=false;
// Seconds from activity start (same clock as time_seconds) to the first matching success signal and to "Finish this task".
let successSeconds=null, finishedSeconds=null;
let stage='welcome', prototypeOrigin='', timer=null, lastPage='', activeVariant=null;
// Resume-after-refresh state (v0.3.3). Progress is checkpointed in this tab's sessionStorage,
// which survives reloads and restored tabs but is cleared when the tab is closed.
const RESUME_MAX_AGE_MS=24*60*60*1000;
let resumeKey='', studyHash='', resumeStage='welcome', activityState={}, formDraft=null;
let interruptions=0, interruptedMs=0, resumedIntoActivity=false;
// A/B design per experiment for this session (from the link, e.g. a Qualtrics randomizer, or built in).
let assignments={}, abResults={};
const alertBox=$('#participantAlert');
const query=new URLSearchParams(location.search);
const preview=query.get('preview')==='1';
const returnUrl=safeReturnUrl(query.get('return'),(window.UTP_SETTINGS||{}).returnUrlHosts||['qualtrics.com']);
const $main=()=>$('#participantMain');
// Inside a Qualtrics survey (v0.3.11): study.html?embed=qualtrics shown in the survey's iframe.
// Results go to the survey's embedded data, and only after the survey's script has answered
// from an approved host (UTP_SETTINGS.embedHosts, default the return-link hosts).
const embedRequested=query.get('embed')==='qualtrics';
const embedded=embedRequested&&window.parent!==window&&!preview;
const embedHosts=(window.UTP_SETTINGS||{}).embedHosts||(window.UTP_SETTINGS||{}).returnUrlHosts||['qualtrics.com'];
let surveyOrigin='', surveySeq=0, surveyAcked=0, surveyFailed=false;
const surveyWaiters=new Set();
function connectSurvey(){
  return new Promise(resolve=>{
    window.addEventListener('message',e=>{
      if(e.source!==window.parent)return;const m=e.data;
      if(!m||m.ns!==EMBED_NS||m.v!==EMBED_VERSION)return;
      if(m.type==='hello-ack'&&!surveyOrigin&&hostAllowed(e.origin,embedHosts)){surveyOrigin=e.origin;resolve(true);return;}
      if(m.type==='saved'&&surveyOrigin&&e.origin===surveyOrigin&&Number.isInteger(m.seq)){surveyAcked=Math.max(surveyAcked,m.seq);surveyWaiters.forEach(w=>w());}
    });
    // The hello carries nothing about the participant, so it can go to any parent; data waits for an approved answer.
    const hello=()=>{if(!surveyOrigin)window.parent.postMessage({ns:EMBED_NS,v:EMBED_VERSION,type:'hello'},'*');};
    hello();[400,1200,2500,4500,7000].forEach(t=>setTimeout(hello,t));
    setTimeout(()=>resolve(!!surveyOrigin),9000);
  });
}
function surveyAck(seq){
  return new Promise(resolve=>{
    const check=()=>{if(surveyAcked>=seq){surveyWaiters.delete(check);resolve(true);}};
    surveyWaiters.add(check);check();
    setTimeout(()=>{surveyWaiters.delete(check);resolve(surveyAcked>=seq);},8000);
  });
}
// Laptop/desktop-only study opened on a phone or tablet (v0.3.12): nothing is recorded. Inside a survey,
// the survey is told (rs_status = device_not_supported) so it can end there and leave them out of results.
async function deviceNotSupported(kind){
  progress(0,'Computer needed');
  render(`<section class="welcome-card"><span class="eyebrow accent">COMPUTER NEEDED</span><h1>Please use a laptop or desktop computer</h1><p>This study only works on a laptop or desktop computer, and this looks like a ${esc(kind)}. ${embedded?'Taking you back to the survey…':'Please open the same link on a computer. You can close this page.'}</p></section>`,null);
  if(embedded&&surveyOrigin){
    const seq=++surveySeq;
    window.parent.postMessage({ns:EMBED_NS,v:EMBED_VERSION,type:'save',seq,status:'device_not_supported',fields:{rs_status:'device_not_supported',rs_device:kind}},surveyOrigin);
    if(await surveyAck(seq))window.parent.postMessage({ns:EMBED_NS,v:EMBED_VERSION,type:'done'},surveyOrigin);
  }
}
function surveyStatus(text){const el=$('#saveStatus');if(el)el.textContent=text;}
// Sends everything so far; resolves true once the survey confirms it stored this save (or a later one).
async function saveToSurvey(status){
  if(!embedded||!surveyOrigin||!writer)return false;
  const seq=++surveySeq;
  try{
    const {fields}=await surveyFields({study,sessionId,status,assignments,abResults,externalId:cleanExternalId(query.get('pid')),device:sessionDevice(),events:writer.sessionEvents()});
    window.parent.postMessage({ns:EMBED_NS,v:EMBED_VERSION,type:'save',seq,status,fields},surveyOrigin);
  }catch(err){surveyFailed=true;surveyStatus('Not saved to the survey');console.error(err);return false;}
  const ok=await surveyAck(seq);
  surveyFailed=!ok;surveyStatus(ok?'Saved to the survey':'Not saved to the survey yet');
  return ok;
}

function alertMessage(msg){alertBox.textContent=msg;alertBox.classList.remove('hidden');setTimeout(()=>alertBox.classList.add('hidden'),6500);}
function setSaveStatus(status,message=''){
  const el=$('#saveStatus');
  if(embedded&&status==='demo'){if(!surveyAcked)el.textContent='Answers are saved to the survey';return;}
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
    interruptions,interruptedMs,activity:activityState,draft:formDraft,assignments,abResults,savedAt:Date.now()};
  try{sessionStorage.setItem(resumeKey,JSON.stringify(cp));}catch{}
}
function saveActivity(state){activityState={...state,successSeconds,finishedSeconds};persist('activity');}
// Another open tab of the same session answers this; a duplicated tab must not write into it.
const sessionChannel=('BroadcastChannel' in window)?new BroadcastChannel('utp-session-v1'):null;
sessionChannel?.addEventListener('message',e=>{if(e.data?.type==='ping'&&e.data.sessionId&&e.data.sessionId===sessionId&&stage!=='welcome')sessionChannel.postMessage({type:'here',sessionId,token:e.data.token});});
function sessionOpenElsewhere(id){
  if(!sessionChannel)return Promise.resolve(false);
  return new Promise(resolve=>{const token=uuid();const on=e=>{if(e.data?.type==='here'&&e.data.token===token){sessionChannel.removeEventListener('message',on);resolve(true);}};
    sessionChannel.addEventListener('message',on);sessionChannel.postMessage({type:'ping',sessionId:id,token});setTimeout(()=>{sessionChannel.removeEventListener('message',on);resolve(false);},250);});
}
function sessionDevice(){try{return sessionHistory().find(e=>e.kind==='session_started')?.payload?.device||deviceClass(innerWidth);}catch{return deviceClass(innerWidth);}}
function sessionHistory(){
  if(writer?.remote)return writer.history;
  if(writer?.store==='session')return writer.sessionEvents();
  try{return JSON.parse(localStorage.getItem('utp-demo-events-v1')||'[]').filter(e=>e.session_id===sessionId);}catch{return writer?.history||[];}
}
async function resume(cp){
  if(await sessionOpenElsewhere(cp.sessionId)){
    render(`<section class="welcome-card"><span class="eyebrow accent">ALREADY OPEN</span><h1>This study is open in another tab</h1><p>Please continue in the other tab. Using two tabs for the same session would mix up your responses.</p></section>`,null);
    progress(0,'Open in another tab');return;
  }
  sessionId=cp.sessionId;taskIndex=cp.taskIndex||0;writer=new StudyWriter(study.id,sessionId,setSaveStatus,preview,{store:embedded?'session':'local'});
  assignments=cp.assignments&&typeof cp.assignments==='object'?cp.assignments:resolveAssignments(study,sessionId,query);
  abResults=cp.abResults&&typeof cp.abResults==='object'?cp.abResults:{};
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
    case 'followup':activeTask=task;activeVariant=normalizeMethod(task)==='ab_test'?variantForTask(task,assignments):null;showFollowup();break;
    case 'post':showPost();break;
    case 'finish':finishStudy();break;
    case 'activity':case 'reflection':resumeActivity(cp,gap);break;
    default:startActivity();
  }
}
function resumeActivity(cp,gap){
  activeTask=study.tasks[taskIndex];
  activeVariant=normalizeMethod(activeTask)==='ab_test'?variantForTask(activeTask,assignments):null;
  stage='activity';taskStartedAt=cp.taskStartedAt||Date.now();taskInteractions=[];lastPage='';
  interruptions=(cp.interruptions||0)+1;interruptedMs=(cp.interruptedMs||0)+gap;resumedIntoActivity=true;
  activityState=cp.activity||{};
  clickCount=activityState.clickCount||0;trackerConnected=!!activityState.trackerConnected;observedSuccess=!!activityState.observedSuccess;
  successSeconds=activityState.successSeconds??null;finishedSeconds=activityState.finishedSeconds??null;
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
    if(embedRequested&&!embedded&&!preview){render(`<section class="welcome-card"><h1>Open this activity from the survey</h1><p>This part of the study runs inside the survey. Please go back to the survey link you were given.</p></section>`,null);progress(0,'Survey activity');return;}
    if(embedded){
      surveyStatus('Connecting to the survey…');progress(0,'Connecting');
      if(!await connectSurvey()){render(`<section class="welcome-card"><h1>This survey page can't receive your answers</h1><p>The survey isn't set up to store results from this activity, so nothing you did here would be saved. Please let the research team know, and don't continue with this part.</p></section>`,null);surveyStatus('Not connected to the survey');return;}
      surveyStatus('Answers are saved to the survey');
    }
    const kind=deviceKind();
    if(!allowedOn(study,kind)){await deviceNotSupported(kind);return;}
    studyHash=hashText(JSON.stringify(study));resumeKey=`utp-resume-v1:${preview?'preview':'live'}:${study.id}`;
    const cp=readCheckpoint();
    if(cp&&cp.v===1&&cp.studyId===study.id&&cp.hash===studyHash&&cp.sessionId&&Date.now()-(cp.savedAt||0)<RESUME_MAX_AGE_MS){await resume(cp);return;}
    if(cp)clearCheckpoint(); // changed study, expired, or unreadable: start a fresh session
    progress(0,'Introduction');welcome();
  }catch(err){render(`<section class="welcome-card"><h1>Study unavailable</h1><p>${esc(err.message)}</p><a class="btn btn-outline" href="index.html">Return to Research Studio</a></section>`,null);}
}
function welcome(){
  stage='welcome';
  render(`<section class="welcome-card"><span class="eyebrow accent">UNMODERATED RESEARCH STUDY</span><h1>${esc(study.title)}</h1><p>${esc(study.welcome||study.description||'')}</p><div class="notice"><strong>What this study may collect</strong><br>Task timing, navigation choices, random design assignment for implementation comparisons, card groupings and names, first-click locations, preferences, and answers you explicitly submit. An instrumented prototype may also record click locations and navigation. No screen recording, passwords, or typed prototype form values are collected by the tracker. Please do not enter sensitive personal information.</div>${study.consentMode==='external'?'<p class="notice">You agreed to take part in the survey before this activity.</p><button id="startStudy" class="btn btn-primary">Begin →</button>':`<label class="consent"><input id="consentCheck" type="checkbox"><span>${esc(study.consent||'I agree to participate and to the data collection described above.')}</span></label><button id="startStudy" class="btn btn-primary" disabled>Agree and begin study →</button>`}<p class="small muted" style="margin-top:18px">Participation is voluntary. You can close the page at any point.</p></section>`,null);
  if($('#consentCheck'))$('#consentCheck').onchange=e=>$('#startStudy').disabled=!e.target.checked;
  $('#startStudy').onclick=()=>{
    sessionId=uuid();writer=new StudyWriter(study.id,sessionId,setSaveStatus,preview,{store:embedded?'session':'local'});
    assignments=resolveAssignments(study,sessionId,query);
    const externalId=cleanExternalId(query.get('pid'));
    writer.add('session_started',null,{study_version:study.version||'1.0.0',viewport_width:innerWidth,viewport_height:innerHeight,device:deviceClass(innerWidth),device_kind:deviceKind(),consent:study.consentMode==='external'?'external':true,...(preview?{preview:true}:{}),...(externalId?{external_id:externalId}:{}),...(Object.keys(assignments).length?{assignments}:{}),...(returnUrl?{return_host:returnUrl.hostname}:{})});
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
  if(embedded)saveToSurvey('in_progress');
  if(taskIndex>=study.tasks.length){showPost();return;}
  stage='activity';activeTask=study.tasks[taskIndex];activeVariant=null;taskStartedAt=Date.now();clickCount=0;taskInteractions=[];trackerConnected=false;observedSuccess=false;lastPage='';successSeconds=null;finishedSeconds=null;
  activityState={};interruptions=0;interruptedMs=0;resumedIntoActivity=false;formDraft=null;
  if(normalizeMethod(activeTask)==='ab_test')activeVariant=variantForTask(activeTask,assignments);
  progress(.12+taskIndex/study.tasks.length*.73,`Activity ${taskIndex+1} of ${study.tasks.length}`);
  writer.add('task_started',activeTask.id,{method:normalizeMethod(activeTask),order:taskIndex+1,...(activeVariant?{experiment_id:activeTask.experimentId||activeTask.id,variant_id:activeVariant.id,variant_revision:activeVariant.revision||null,assignment:assignments[activeTask.experimentId||activeTask.id]?.source||'stable-hash-equal'}:{})});
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
    ...(['prototype','ab_test'].includes(normalizeMethod(activeTask))?{tracker_connected:trackerConnected,click_count:clickCount,
      ...(successSeconds!=null?{success_at_seconds:successSeconds}:{}),...(finishedSeconds!=null?{finished_at_seconds:finishedSeconds}:{})}:{}),
    // Reloads during the activity: time_seconds stays wall-clock; interrupted_seconds is the time away.
    ...(interruptions?{interruptions,interrupted_seconds:Math.round(interruptedMs/1000)}:{})
  });
  if(normalizeMethod(activeTask)==='ab_test')abResults[activeTask.id]={variant_id:activeVariant?.id||null,success_signal_status:result.success_signal_status||null,self_report:options.selfReport??null,time_seconds:elapsed(),click_count:clickCount,success_at_seconds:successSeconds};
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
  stage='complete';progress(1,'Study complete');writer.add('session_completed',null,{});formDraft=null;activityState={};persist('complete');
  if(embedded){await showSurveyCompleted(false);return;}
  await showCompleted(false);
}
// already: true when the participant reloads after finishing; nothing new is recorded.
// Inside the survey: save the finished session, then hand back to the survey.
async function showSurveyCompleted(already){
  stage='complete';progress(1,'Study complete');
  render(`<section class="done-card"><span class="eyebrow accent">ACTIVITY COMPLETE</span><h1>Saving your answers to the survey…</h1><p>Please wait a moment.</p></section>`);
  const ok=await saveToSurvey('complete');
  if(ok){
    render(`<section class="done-card"><span class="eyebrow accent">ACTIVITY COMPLETE</span><h1>Thank you. Your answers are saved.</h1><p>Continue with the rest of the survey.</p></section>`);
    window.parent.postMessage({ns:EMBED_NS,v:EMBED_VERSION,type:'done'},surveyOrigin);
    return;
  }
  render(`<section class="done-card"><span class="eyebrow accent">ACTIVITY COMPLETE</span><h1>Your answers haven't reached the survey yet</h1><p>Please try again. If it still doesn't work, let the research team know.</p><div class="actions-row">${cardButton('Try again','retrySurveySave')}</div></section>`);
  $('#retrySurveySave').onclick=()=>showSurveyCompleted(already);
}
async function showCompleted(already){
  if(embedded){await showSurveyCompleted(already);return;}
  stage='complete';progress(1,'Study complete');const ok=await writer.flush();
  render(`<section class="done-card"><span class="eyebrow accent">STUDY COMPLETE</span><h1>${already?'You have already completed this study.':'Thank you for participating.'}</h1><p>${already?'Your earlier responses are kept. There is nothing more to do; you can close this tab.':'Your contributions to this research session have been recorded.'}</p><div id="finalSaveNotice" class="notice ${ok?'':'warning'}">${writer.isSaved?(writer.remote?'All responses have synced to the research database.':'This is a local demonstration. Your responses were saved only in this browser and were not sent to a researcher.'):'Some responses could not sync. You can retry or download a copy of this session.'}</div>${returnUrl?`<div class="return-to-survey"><p><strong>One more step:</strong> return to the survey to finish. Your design and task results go back with you; nothing that identifies you is included.</p><a class="btn btn-primary" id="returnToSurvey" href="${esc(buildReturnUrl(returnUrl,{sessionId,status:'complete',assignments,abResults,tasks:study.tasks,externalId:cleanExternalId(query.get('pid')),device:sessionDevice()}))}">Return to the survey →</a></div>`:''}<div class="actions-row">${cardButton('Download a copy of this session','responseCopy','outline')}${writer.isSaved?'':cardButton('Retry sync','retrySave')}${already&&!writer.remote?cardButton('Start a new session','newSession','outline'):''}</div>${already&&!writer.remote?'<p class="small muted">“Start a new session” is only offered in local demo and preview mode, for piloting.</p>':''}</section>`);
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
  clearInterval(timer);stage='prototype_reflection';flushInteractions();if(finishedSeconds==null)finishedSeconds=elapsed();activityState={clickCount,trackerConnected,observedSuccess,successSeconds,finishedSeconds};persist('reflection');
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
  if(m.type==='success' && m.task_id===activeTask.successSignal){if(!observedSuccess)successSeconds=elapsed();observedSuccess=true;saveActivity({clickCount,trackerConnected,observedSuccess});return;}
  if(m.type==='ready'){lastPage=String(m.page||'').slice(0,90);return;}
  if(['click','scroll','screen','custom'].includes(m.type)){
    const hit={type:m.type,at:new Date().toISOString(),page:String(m.page||lastPage||'').slice(0,90),target:String(m.target||m.name||'').slice(0,90),x_pct:Math.min(100,Math.max(0,Number(m.x_pct)||0)),y_pct:Math.min(100,Math.max(0,Number(m.y_pct)||0)),viewport_width:Math.max(0,Number(m.viewport_width)||0),viewport_height:Math.max(0,Number(m.viewport_height)||0),...(['keyboard','pointer'].includes(m.input)?{input:m.input}:{})};
    taskInteractions.push(hit);if(m.type==='click'){clickCount++;if($('#taskClicks'))$('#taskClicks').textContent=clickCount;saveActivity({clickCount,trackerConnected,observedSuccess});}
    if(taskInteractions.length>=20)flushInteractions();
  }
});

// Card sort (v0.3.4): drag-first. Participants drag cards straight into groups, drop a card on
// "New group" to start one, and name groups whenever they like (names are required to finish).
// Dragging uses pointer events so it works with mouse, pen and touch (press-and-hold on touch,
// so the page still scrolls). Every card is also a button that opens a "Move to" list, for
// keyboard, screen-reader and switch users or anyone who prefers tapping.
function startCardSort(saved={}){
  const cards=activeTask.cards||[];
  const groups=Object.fromEntries(cards.map(c=>[c.id,saved.groups?.[c.id]||'']));
  const created=Array.isArray(saved.created)?saved.created.filter(c=>/^created-\d+$/.test(c.id)).map(c=>({id:c.id,label:typeof c.label==='string'?c.label:''})):[];
  let moves=Number(saved.moves)||0;
  const canCreate=activeTask.sortMode!=='closed';
  const predefined=activeTask.sortMode==='open'?[]:activeTask.categories||[];
  const categories=()=>[...predefined,...created];
  const keep=()=>saveActivity({groups:{...groups},created:created.map(c=>({...c})),moves});
  const methodAction=(action,detail)=>{moves++;event(action,detail);};
  const unnamedLabel=cat=>`Unnamed group ${created.indexOf(cat)+1}`;
  const labelOf=id=>{const c=categories().find(x=>x.id===id);return !c?'Cards to sort':(c.label||unnamedLabel(c));};
  const duplicateOf=cat=>cat.label.trim()&&categories().some(o=>o!==cat&&o.label.trim().toLocaleLowerCase()===cat.label.trim().toLocaleLowerCase());
  function blockers(){
    const left=cards.filter(c=>!groups[c.id]).length;
    const unnamed=created.filter(c=>!c.label.trim()).length;
    const dupes=created.filter(duplicateOf).length;
    const out=[];
    if(left)out.push(`${left} card${left===1?'':'s'} still to sort`);
    if(unnamed)out.push(`name ${unnamed===1?'1 group':`${unnamed} groups`}`);
    if(dupes)out.push('give each group a different name');
    return out;
  }
  function newGroup(via){
    const n=created.reduce((m,c)=>Math.max(m,Number(c.id.split('-')[1])||0),0)+1;
    const cat={id:`created-${n}`,label:''};created.push(cat);
    methodAction('category_created',{category_id:cat.id,label:'',via});
    return cat.id;
  }
  // Moves a card; '__new__' starts a new group. Empty participant-created groups are removed.
  function assign(cardId,target,via){
    if(!Object.hasOwn(groups,cardId))return;
    let categoryId=target;
    if(target==='__new__'){if(!canCreate)return;categoryId=newGroup(via);}
    if(categoryId&&!categories().some(c=>c.id===categoryId))return;
    if(groups[cardId]===categoryId){show(`[data-card="${CSS.escape(cardId)}"]`);return;}
    groups[cardId]=categoryId;
    methodAction('card_assignment',{card_id:cardId,category_id:categoryId||null,via});
    for(const cat of [...created])if(!Object.values(groups).includes(cat.id)){created.splice(created.indexOf(cat),1);methodAction('category_removed',{category_id:cat.id,label:cat.label,reason:'empty'});}
    keep();show(`[data-card="${CSS.escape(cardId)}"]`);
    const card=cards.find(c=>c.id===cardId),done=Object.values(groups).filter(Boolean).length;
    announce(`${card?.label||cardId} moved to ${categoryId?labelOf(categoryId):'Cards to sort'}${target==='__new__'?' (a new group you can name any time)':''}. ${done} of ${cards.length} cards sorted.`);
  }
  function show(focus='h1'){
    const cats=categories();const assigned=Object.values(groups).filter(Boolean).length;
    const cardMarkup=c=>`<div class="sort-card-wrap" data-card-wrap="${esc(c.id)}"><button type="button" class="sort-card" data-card="${esc(c.id)}" aria-haspopup="true" aria-expanded="false" aria-describedby="sortHelp"><span class="sort-grip" aria-hidden="true">⠿</span><span class="sort-card-title">${esc(c.label)}</span><span class="sr-only">, ${groups[c.id]?`in ${esc(labelOf(groups[c.id]))}`:'not sorted yet'}. Select to move.</span></button><div class="move-menu" hidden></div></div>`;
    const heading=cat=>predefined.includes(cat)
      ?`<strong>${esc(cat.label)}</strong>`
      :`<label class="group-name-field"><span class="sr-only">Name for ${esc(unnamedLabel(cat))}</span><input class="group-name" data-group-name="${esc(cat.id)}" value="${esc(cat.label)}" maxlength="80" placeholder="Name this group" autocomplete="off" ${duplicateOf(cat)?'aria-invalid="true"':''}></label>`;
    const groupsMarkup=cats.map(cat=>{const inGroup=cards.filter(c=>groups[c.id]===cat.id);return `<section class="sort-dropzone ${!predefined.includes(cat)&&!cat.label.trim()?'needs-name':''}" data-drop-category="${esc(cat.id)}" aria-label="${esc(cat.label||unnamedLabel(cat))}"><div class="sort-zone-heading">${heading(cat)}<small>${inGroup.length} card${inGroup.length===1?'':'s'}</small></div>${!predefined.includes(cat)&&duplicateOf(cat)?'<p class="group-name-error" role="alert">Another group already has this name.</p>':''}<div class="sort-zone-cards">${inGroup.map(cardMarkup).join('')||'<div class="drop-placeholder">Drag cards here</div>'}</div></section>`;}).join('');
    const newZone=canCreate?`<section class="sort-dropzone sort-new-group" data-drop-category="__new__" aria-label="New group"><strong>+ New group</strong><span>Drag a card here to start a new group. You can name it later.</span></section>`:'';
    const blocked=blockers();
    render(methodTemplate(`<p class="helper sort-help" id="sortHelp">${canCreate?'Drag each card into a group. Drop a card on “New group” to start one, and name your groups whenever you like.':'Drag each card into the group where you think it belongs.'}${matchMedia('(pointer: coarse)').matches?' On a touch screen, press and hold a card, then drag it.':''} You can also select a card to choose where it goes.</p><div class="sort-progress"><strong>${assigned} of ${cards.length} cards sorted</strong><span>${esc(activeTask.sortMode)} sort</span></div><div class="sort-layout"><section class="sort-unsorted" data-drop-category="" aria-label="Cards to sort"><div class="sort-zone-heading"><strong>Cards to sort</strong><small>${cards.length-assigned} left</small></div>${cards.filter(c=>!groups[c.id]).map(cardMarkup).join('')||'<p class="muted small">All cards are sorted. Drag a card here to unsort it.</p>'}</section><div class="sort-zones">${groupsMarkup}${newZone}</div></div><div class="method-actions"><button id="submitSort" class="btn btn-primary" ${blocked.length?'disabled aria-describedby="sortBlocker"':''}>Finish card sort →</button><button id="skipSort" class="btn btn-outline">I cannot finish grouping</button><span id="sortBlocker" class="small muted" aria-live="polite">${blocked.length?`To finish: ${esc(blocked.join(', '))}.`:''}</span></div>`),focus);
    wire();
  }
  function refreshBlockers(){
    const b=blockers(),btn=$('#submitSort'),msg=$('#sortBlocker');if(!btn)return;
    btn.disabled=!!b.length;if(b.length)btn.setAttribute('aria-describedby','sortBlocker');else btn.removeAttribute('aria-describedby');
    msg.textContent=b.length?`To finish: ${b.join(', ')}.`:'';
  }
  // ----- "Move to" list (click, tap, Enter or Space on a card) -----
  function closeMenus(){$main().querySelectorAll('.move-menu').forEach(m=>{m.hidden=true;m.innerHTML='';});$main().querySelectorAll('[data-card][aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));}
  function openMenu(btn){
    const id=btn.dataset.card,menu=btn.nextElementSibling,current=groups[id];
    const was=btn.getAttribute('aria-expanded')==='true';closeMenus();if(was){btn.focus();return;}
    const opts=categories().filter(c=>c.id!==current).map(c=>[c.id,c.label||unnamedLabel(c)]);
    if(canCreate)opts.push(['__new__','+ New group']);
    if(current)opts.push(['','Back to cards to sort']);
    menu.innerHTML=`<p class="move-menu-title">Move “${esc(cards.find(c=>c.id===id)?.label||id)}” to</p>${opts.map(([v,l])=>`<button type="button" data-move-to="${esc(v)}">${esc(l)}</button>`).join('')}`;
    menu.hidden=false;btn.setAttribute('aria-expanded','true');
    menu.querySelectorAll('[data-move-to]').forEach(o=>o.onclick=()=>assign(id,o.dataset.moveTo,'menu'));
    menu.onkeydown=e=>{const items=[...menu.querySelectorAll('[data-move-to]')],k=items.indexOf(document.activeElement);
      if(e.key==='Escape'){e.preventDefault();closeMenus();btn.focus();}
      else if(e.key==='ArrowDown'){e.preventDefault();items[(k+1)%items.length]?.focus();}
      else if(e.key==='ArrowUp'){e.preventDefault();items[(k-1+items.length)%items.length]?.focus();}};
    menu.querySelector('[data-move-to]')?.focus();
  }
  // ----- pointer dragging (mouse, pen, touch) -----
  let drag=null,suppressClickUntil=0,suppressCard=null;
  const preventScroll=e=>{if(drag?.active)e.preventDefault();};
  function dropTarget(x,y){return document.elementFromPoint(x,y)?.closest('[data-drop-category]')||null;}
  function beginDrag(x,y){
    const d=drag;if(!d||d.active)return;d.active=true;closeMenus();
    const r=d.card.getBoundingClientRect();d.offset={x:x-r.left,y:y-r.top};
    d.ghost=d.card.cloneNode(true);d.ghost.classList.add('sort-ghost');d.ghost.removeAttribute('data-card');d.ghost.setAttribute('aria-hidden','true');
    Object.assign(d.ghost.style,{width:`${r.width}px`,left:`${x-d.offset.x}px`,top:`${y-d.offset.y}px`});
    document.body.appendChild(d.ghost);d.card.classList.add('drag-source');document.body.classList.add('sorting');
    const scroll=()=>{if(!drag?.active)return;const edge=70,yy=drag.y;if(yy<edge)window.scrollBy(0,-Math.ceil((edge-yy)/5));else if(yy>innerHeight-edge)window.scrollBy(0,Math.ceil((yy-innerHeight+edge)/5));drag.raf=requestAnimationFrame(scroll);};
    d.raf=requestAnimationFrame(scroll);moveDrag(x,y);
  }
  function moveDrag(x,y){
    const d=drag;d.x=x;d.y=y;d.ghost.style.left=`${x-d.offset.x}px`;d.ghost.style.top=`${y-d.offset.y}px`;
    const t=dropTarget(x,y);if(t!==d.over){d.over?.classList.remove('drop-over');t?.classList.add('drop-over');d.over=t;}
  }
  function endDrag(commit){
    const d=drag;drag=null;if(!d)return;
    clearTimeout(d.timer);cancelAnimationFrame(d.raf);
    document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);document.removeEventListener('pointercancel',onCancel);
    document.removeEventListener('touchmove',preventScroll);
    d.card.classList.remove('pressing');
    if(!d.active)return;
    suppressClickUntil=Date.now()+150;suppressCard=d.id; // ignore only the click that ends this card's drag
    d.ghost.remove();d.card.classList.remove('drag-source');document.body.classList.remove('sorting');d.over?.classList.remove('drop-over');
    if(commit&&d.over)assign(d.id,d.over.dataset.dropCategory,d.touch?'touch':'drag');
  }
  function onMove(e){
    if(!drag||e.pointerId!==drag.pointerId)return;
    if(drag.active){e.preventDefault();moveDrag(e.clientX,e.clientY);return;}
    const dist=Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy);
    if(drag.touch){if(dist>10)endDrag(false);}       // finger moved before the hold: it is a scroll
    else if(dist>4)beginDrag(e.clientX,e.clientY);    // mouse/pen: start dragging straight away
  }
  function onUp(e){if(drag&&e.pointerId===drag.pointerId)endDrag(true);}
  function onCancel(e){if(drag&&e.pointerId===drag.pointerId)endDrag(false);}
  function onDown(e){
    if(drag||(e.pointerType==='mouse'&&e.button!==0))return;
    const card=e.currentTarget;
    drag={card,id:card.dataset.card,pointerId:e.pointerId,sx:e.clientX,sy:e.clientY,x:e.clientX,y:e.clientY,touch:e.pointerType==='touch',active:false};
    document.addEventListener('pointermove',onMove,{passive:false});document.addEventListener('pointerup',onUp);document.addEventListener('pointercancel',onCancel);
    document.addEventListener('touchmove',preventScroll,{passive:false});
    if(drag.touch){card.classList.add('pressing');const d=drag;d.timer=setTimeout(()=>{if(drag===d){navigator.vibrate?.(10);beginDrag(d.x,d.y);}},230);}
  }
  function wire(){
    $main().querySelectorAll('[data-card]').forEach(btn=>{
      btn.addEventListener('pointerdown',onDown);
      btn.addEventListener('contextmenu',e=>{if(drag)e.preventDefault();});
      btn.onclick=e=>{if(Date.now()<suppressClickUntil&&suppressCard===btn.dataset.card){e.preventDefault();return;}openMenu(btn);};
    });
    $main().querySelectorAll('[data-group-name]').forEach(input=>{
      const cat=created.find(c=>c.id===input.dataset.groupName);if(!cat)return;
      const before={v:cat.label};
      input.oninput=()=>{cat.label=input.value;keep();refreshBlockers();
        const zone=input.closest('.sort-dropzone');zone.classList.toggle('needs-name',!cat.label.trim());
        input.toggleAttribute('aria-invalid',!!duplicateOf(cat));
        let err=zone.querySelector('.group-name-error');
        if(duplicateOf(cat)&&!err){err=document.createElement('p');err.className='group-name-error';err.setAttribute('role','alert');err.textContent='Another group already has this name.';zone.querySelector('.sort-zone-heading').after(err);}
        else if(!duplicateOf(cat))err?.remove();};
      input.onchange=()=>{if(cat.label!==before.v){methodAction('category_renamed',{category_id:cat.id,label:cat.label.trim(),previous_label:before.v});before.v=cat.label;keep();}};
      input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}};
    });
    $('#submitSort').onclick=()=>{if(blockers().length)return;created.forEach(c=>c.label=c.label.trim());completeActivity({sort_mode:activeTask.sortMode,groups,categories:categories().map(c=>({...c})),move_count:moves,completed:true});};
    $('#skipSort').onclick=()=>completeActivity({sort_mode:activeTask.sortMode,groups,categories:categories().map(c=>({...c,label:c.label.trim()})),move_count:moves,completed:false,participant_could_not_finish:true});
  }
  document.addEventListener('pointerdown',e=>{if(stage==='activity'&&!e.target.closest?.('.sort-card-wrap'))closeMenus();});
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

// First-click test. v0.3.5: zoom controls so details stay readable on small screens. The test
// still opens at "Fit" (the whole screen visible, as a first impression should be); participants
// can zoom in and drag to look around. Only a tap/click records the first click, never a pan.
// The zoom level at the moment of the click is recorded with it.
const FIRST_CLICK_ZOOMS=[1,1.5,2,3];
function startFirstClick(saved={}){
  let first=saved.first&&Number.isFinite(saved.first.x_pct)?saved.first:null,pending=null;
  let zoomIndex=Math.max(0,FIRST_CLICK_ZOOMS.indexOf(Number(saved.zoom)||1));
  const image=secureURL(activeTask.imageUrl,location.href);
  const alt=activeTask.imageAlt||'Interface screenshot for first-click test';
  const coarse=matchMedia('(pointer: coarse)').matches;
  const zoom=()=>FIRST_CLICK_ZOOMS[zoomIndex];
  // input records how the position was chosen: 'pointer' (mouse/touch) or 'keyboard'.
  function record(x,y,input){
    const stage=$main().querySelector('.click-stage');
    first={x_pct:Math.round(x*100)/100,y_pct:Math.round(y*100)/100,at_ms:Date.now()-taskStartedAt,input,zoom:zoom(),display_width_px:Math.round(stage?.getBoundingClientRect().width||0)};
    event('first_click',first);saveActivity({first,zoom:zoom()});show('#submitFirstClick');announce('First click recorded. Select Continue when ready.');
  }
  // Fit = the image's size when it fits the frame; zoomed = a multiple of that width.
  function applyZoom(keepCentre=true){
    const frame=$main().querySelector('.click-image-frame'),stage=$main().querySelector('.click-stage'),img=$('#firstClickImage');if(!frame||!stage||!img)return;
    const cx=frame.scrollLeft+frame.clientWidth/2,cy=frame.scrollTop+frame.clientHeight/2,before=stage.getBoundingClientRect();
    stage.classList.toggle('zoomed',zoom()>1);stage.style.width='';
    if(zoom()>1){
      if(!stage.dataset.fitWidth){stage.classList.remove('zoomed');stage.dataset.fitWidth=String(img.getBoundingClientRect().width||frame.clientWidth);stage.classList.add('zoomed');}
      stage.style.width=`${Math.round(Number(stage.dataset.fitWidth)*zoom())}px`;
    }
    frame.classList.toggle('pannable',zoom()>1);
    const after=stage.getBoundingClientRect(),k=before.width?after.width/before.width:1;
    if(keepCentre){frame.scrollLeft=cx*k-frame.clientWidth/2;frame.scrollTop=cy*k-frame.clientHeight/2;}
    const label=$('#zoomLevel');if(label)label.textContent=zoom()===1?'Fit':`${Math.round(zoom()*100)}%`;
    const out=$main().querySelector('[data-zoom="out"]'),inn=$main().querySelector('[data-zoom="in"]'),fit=$main().querySelector('[data-zoom="fit"]');
    if(out)out.disabled=zoomIndex===0;if(inn)inn.disabled=zoomIndex===FIRST_CLICK_ZOOMS.length-1;if(fit)fit.disabled=zoomIndex===0;
  }
  function setZoom(index){
    const next=Math.max(0,Math.min(FIRST_CLICK_ZOOMS.length-1,index));if(next===zoomIndex)return;
    zoomIndex=next;applyZoom();event('first_click_zoom',{zoom:zoom()});saveActivity({first,zoom:zoom()});
    announce(zoom()===1?'Zoomed to fit the screen.':`Zoomed to ${Math.round(zoom()*100)} percent. ${coarse?'Drag to look around.':'Scroll to look around.'}`);
  }
  function show(focus='h1'){
    // Once the first click is made it is final, so the "not sure" option and keyboard marker are withdrawn.
    const interactive=!first;
    const tools=interactive?`<div class="zoom-tools" role="group" aria-label="Zoom the screenshot"><button type="button" class="btn btn-outline btn-small" data-zoom="out" aria-label="Zoom out">−</button><span id="zoomLevel" class="zoom-level" aria-hidden="true">Fit</span><button type="button" class="btn btn-outline btn-small" data-zoom="in" aria-label="Zoom in">+</button><button type="button" class="btn btn-outline btn-small" data-zoom="fit">Fit to screen</button></div>`:'';
    const hint=interactive?(coarse?' Use + to zoom in if details are hard to read, and drag to look around. A single tap chooses your answer.':' Use + to zoom in if details are hard to read.'):'';
    render(methodTemplate(`<div class="image-test"><p class="helper" id="firstClickHelp">Click or tap the first place you would go. Your first selection is final.${hint}${interactive?' <span class="keyboard-hint">Using a keyboard? Move to the screenshot, press Enter to show a marker, move it with the arrow keys (hold Shift for bigger steps), then press Enter again to confirm. Escape removes the marker.</span>':''}</p>${tools}<div class="click-image-frame" ${interactive?`tabindex="0" role="application" aria-label="${esc(alt)}. First-click area" aria-describedby="firstClickHelp"`:''}><div class="click-stage"><img id="firstClickImage" src="${esc(image)}" alt="${esc(alt)}" draggable="false">${first?`<span class="first-click-marker" style="left:${first.x_pct}%;top:${first.y_pct}%" aria-hidden="true"></span>`:'<span class="first-click-marker pending" hidden aria-hidden="true"></span>'}</div></div></div><div class="method-actions">${first?cardButton('Continue →','submitFirstClick'):'<button class="btn btn-outline" id="cannotChoose">I\'m not sure where to click</button>'}</div>`),focus);
    const img=$('#firstClickImage');img.onerror=()=>alertMessage('Could not load the test image. Ask the researcher to check the URL.');
    const ready=()=>applyZoom(false);if(img.complete)ready();else img.addEventListener('load',ready,{once:true});
    $main().querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>setZoom(b.dataset.zoom==='in'?zoomIndex+1:b.dataset.zoom==='out'?zoomIndex-1:0));
    // A click on the image is the answer; panning a zoomed image (touch or scrollbar) never fires one.
    img.onclick=e=>{
      if(first)return;const r=e.currentTarget.getBoundingClientRect();
      record((e.clientX-r.left)/r.width*100,(e.clientY-r.top)/r.height*100,'pointer');
    };
    const frame=$main().querySelector('.click-image-frame[tabindex]'),marker=$main().querySelector('.first-click-marker.pending');
    if(frame)frame.onkeydown=e=>{
      const place=()=>{marker.hidden=false;marker.style.left=`${pending.x}%`;marker.style.top=`${pending.y}%`;marker.scrollIntoView({block:'nearest',inline:'nearest'});};
      if(e.key==='Enter'||e.key===' '){e.preventDefault();
        if(!pending){pending={x:50,y:50};place();announce('Marker shown in the centre of the screenshot. Move it with the arrow keys, press Enter to confirm, or Escape to remove it.');}
        else record(pending.x,pending.y,'keyboard');
        return;}
      if(e.key==='Escape'&&pending){e.preventDefault();pending=null;marker.hidden=true;announce('Marker removed.');return;}
      if((e.key==='+'||e.key==='=')&&!pending){e.preventDefault();setZoom(zoomIndex+1);return;}
      if(e.key==='-'&&!pending){e.preventDefault();setZoom(zoomIndex-1);return;}
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
