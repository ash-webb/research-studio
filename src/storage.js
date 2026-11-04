import { uuid } from './shared.js';

const settings = window.UTP_SETTINGS || {};
const url = String(settings.supabaseUrl || '').replace(/\/$/, '');
const key = String(settings.supabasePublishableKey || '');
export const remoteEnabled = /^https:\/\/[^/]+\.supabase\.co$/.test(url) && key.length > 15;
const DEMO_KEY = 'utp-demo-events-v1';
const AUTH_KEY = 'utp-researcher-auth-v1';

async function request(path, {method='GET', body, bearer, headers={}}={}) {
  if (!remoteEnabled) throw new Error('Remote collection is not configured.');
  const response = await fetch(`${url}${path}`, {
    method,
    headers:{'apikey':key, ...(bearer ? {'Authorization':`Bearer ${bearer}`} : {}), ...body ? {'Content-Type':'application/json'} : {}, ...headers},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    let msg = `Request failed (${response.status})`;
    try {const j = await response.json();msg = j.message || j.msg || j.error_description || j.error || msg;} catch {}
    throw new Error(msg);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return null;
  const t = await response.text(); return t ? JSON.parse(t) : null;
}

export function getAuth() {
  try {return JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');} catch {return null;}
}

export async function logIn(email, password) {
  const obj = await request('/auth/v1/token?grant_type=password', {method:'POST',body:{email,password}});
  if (!obj.access_token || !obj.user?.id) throw new Error('Could not establish an authenticated session.');
  obj.expires_at ||= Math.floor(Date.now()/1000) + (obj.expires_in || 3600);
  sessionStorage.setItem(AUTH_KEY, JSON.stringify(obj));
  return obj;
}

export function logOut(){ sessionStorage.removeItem(AUTH_KEY); }

async function authToken() {
  let session = getAuth(); if (!session?.access_token) throw new Error('Sign in to view research data.');
  if (Date.now()/1000 >= ((session.expires_at || 0) - 90)) {
    if (!session.refresh_token) throw new Error('Session expired. Sign in again.');
    const refreshed = await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});
    session = refreshed;
    session.expires_at ||= Math.floor(Date.now()/1000) + (session.expires_in || 3600);
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(session));
  }
  return session.access_token;
}

export async function registerStudy(study) {
  const session = getAuth(); if (!session?.user?.id) throw new Error('Sign in first.');
  return request('/rest/v1/studies',{method:'POST',bearer:await authToken(),headers:{Prefer:'return=minimal'},body:{id:study.id,owner_id:session.user.id,title:study.title,published:true}});
}

export async function listOwnedStudies() {
  return await request('/rest/v1/studies?select=id,title,published&order=id.asc',{bearer:await authToken()}) || [];
}

export async function loadEvents(studyId) {
  if (!remoteEnabled) return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]').filter(e=>e.study_id===studyId);
  const bearer = await authToken(); let page=0;const all=[];
  while(true) {
    const data = await request(`/rest/v1/study_events?select=id,study_id,session_id,kind,task_id,payload,created_at&study_id=eq.${encodeURIComponent(studyId)}&order=created_at.asc&limit=1000&offset=${page*1000}`, {bearer});
    all.push(...(data||[]));
    if (!data || data.length < 1000) break;
    page++;
    if(page >= 100) throw new Error('Result is too large for browser export; use database export for a full archive.');
  }
  return all;
}

export class StudyWriter {
  // store: 'local' (demo records kept in this browser) or 'session' (v0.3.11, inside a survey:
  // kept only for this tab, so nothing stays on the participant's device after it closes).
  constructor(studyId, sessionId, onStatus=()=>{}, localOnly=false, {store='local'}={}) {
    this.studyId=studyId; this.sessionId=sessionId; this.onStatus=onStatus;
    this.remote = remoteEnabled && !localOnly;
    this.store = store === 'session' ? 'session' : 'local';
    this.sessionKey = `utp-embed-events-v1:${sessionId}`;
    this.history=[];
    this.queueKey=`utp-outbox-${sessionId}`;
    this.pending = this.remote ? JSON.parse(sessionStorage.getItem(this.queueKey) || '[]') : [];
    this.flushing = null;
    this.flushTimer = null;
  }
  add(kind, taskId=null, payload={}) {
    const row={id:uuid(),study_id:this.studyId,session_id:this.sessionId,kind,task_id:taskId,payload,created_at:new Date().toISOString()};
    this.history.push(row);
    if(this.store==='session'){try{const x=JSON.parse(sessionStorage.getItem(this.sessionKey)||'[]');x.push(row);sessionStorage.setItem(this.sessionKey,JSON.stringify(x));}catch{}}
    if(!this.remote){if(this.store!=='session'){const x=JSON.parse(localStorage.getItem(DEMO_KEY) || '[]');x.push(row);localStorage.setItem(DEMO_KEY,JSON.stringify(x));}this.onStatus('demo');return;}
    this.pending.push(row);this.persist();
    if (!this.flushTimer) this.flushTimer=setTimeout(()=>{this.flushTimer=null;this.flush().catch(()=>{});},500);
  }
  persist(){if(this.remote) sessionStorage.setItem(this.queueKey,JSON.stringify(this.pending));}
  async flush(){
    if(this.flushTimer){clearTimeout(this.flushTimer);this.flushTimer=null;}
    if(!this.remote) return true;
    if(this.flushing) return this.flushing;
    this.flushing=(async()=>{
      while(this.pending.length){
        try {
          const batch=this.pending.slice(0,30);
          await request('/rest/v1/study_events',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:batch});
          this.pending.splice(0,batch.length);this.persist();this.onStatus('saved');
        } catch(e){this.onStatus('error',e.message);return false;}
      }
      return true;
    })();
    try{return await this.flushing;} finally {this.flushing=null;}
  }
  get isSaved(){return !this.remote || this.pending.length === 0;}
  // Every event of this session written in this tab, including before a reload (session store only).
  sessionEvents(){if(this.store!=='session')return this.history;try{return JSON.parse(sessionStorage.getItem(this.sessionKey)||'[]');}catch{return this.history;}}
  clearSession(){try{sessionStorage.removeItem(this.sessionKey);}catch{}}
}
