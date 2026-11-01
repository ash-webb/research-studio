/* Research Studio prototype bridge v0.1.1 (v0.1.1: keyboard activations recorded at the element centre and labelled input:'keyboard')
   Install in every page of a prototype that you control:
   <script src="https://YOUR-RESEARCH-SITE/sdk/utp-tracker.js"
           data-parent-origin="https://YOUR-RESEARCH-SITE"></script>
   It NEVER reads text inputs, user-entered values, full DOM contents, or URL query strings.
*/
(function () {
  'use strict';
  if (window.parent === window) return; // not embedded
  const script = document.currentScript;
  let allowed = script?.getAttribute('data-parent-origin') || '';
  if (allowed === 'auto') { // development/demo convenience ONLY; use explicit origin in real studies
    try {allowed = new URL(document.referrer).origin;} catch {allowed = location.origin;}
  }
  try {
    const u = new URL(allowed);
    if (!['https:', 'http:'].includes(u.protocol) || u.origin !== allowed || (u.protocol === 'http:' && !['localhost','127.0.0.1'].includes(u.hostname))) return;
  } catch {return;}
  let screen = location.pathname;
  const tracked = new Set();
  const clean = value => String(value || '').replace(/[^\w.\-/:]/g,'').slice(0,90);
  const page = () => clean(location.pathname);
  function send(type, fields={}) {
    window.parent.postMessage({namespace:'UTP_BRIDGE',version:1,type,page:screen || page(),at:new Date().toISOString(),...fields},allowed);
  }
  function viewport(){return {viewport_width:window.innerWidth,viewport_height:window.innerHeight};}
  function targetFor(el) {
    const tagged = el.closest('[data-ut-id]');
    return clean(tagged?.getAttribute('data-ut-id') || el.closest('button,a,input,[role="button"]')?.tagName.toLowerCase() || el.tagName.toLowerCase());
  }
  window.UTP = Object.freeze({
    markSuccess(taskId) {if (taskId && !tracked.has(taskId)){tracked.add(taskId);send('success',{task_id:clean(taskId)});}},
    markScreen(screenId) {screen=clean(screenId) || page();send('screen',viewport());},
    customEvent(name) {send('custom',{name:clean(name)});}
  });
  document.addEventListener('click',e => {
    if(!(e.target instanceof Element)) return;
    const el=e.target;
    // Enter/Space on a button fires a click with no pointer position (0,0). Record those at
    // the centre of the activated element and label them, so click maps are not skewed.
    const keyboard = e.detail === 0 && e.clientX === 0 && e.clientY === 0;
    let cx = e.clientX, cy = e.clientY;
    if (keyboard) {const r=(el.closest('button,a,input,select,[role="button"],[data-ut-id]')||el).getBoundingClientRect();cx=r.left+r.width/2;cy=r.top+r.height/2;}
    const x_pct = Number((100*cx/Math.max(1,window.innerWidth)).toFixed(2));
    const y_pct = Number((100*cy/Math.max(1,window.innerHeight)).toFixed(2));
    send('click',{target:targetFor(el),x_pct,y_pct,input:keyboard?'keyboard':'pointer',...viewport()});
    const completion = el.closest('[data-ut-success]')?.getAttribute('data-ut-success');
    if(completion) window.UTP.markSuccess(completion);
  },true);
  let scrollTimer;
  window.addEventListener('scroll',()=>{
    if (scrollTimer) return;
    scrollTimer=setTimeout(()=>{
      scrollTimer=null;
      send('scroll',{scroll_pct:Number((100*window.scrollY/Math.max(1,document.documentElement.scrollHeight-window.innerHeight)).toFixed(2)),...viewport()});
    },500);
  },{passive:true});
  window.addEventListener('popstate',()=>{screen=page();send('screen',viewport());});
  window.addEventListener('hashchange',()=>{send('screen',viewport());});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>send('ready',viewport()),{once:true});
  else send('ready',viewport());
})();
