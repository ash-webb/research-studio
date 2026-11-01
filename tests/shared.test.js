import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStudy, csv, flattenEvents, escapeHTML, getQuestionChoices} from '../src/shared.js';
globalThis.location={href:'http://localhost:8000/'};
const valid={id:'test-study',title:'Testing',prototypeUrl:'http://localhost:8000/demo/prototype.html',tasks:[{id:'find-thing',instructions:'Find a thing'}]};

test('validates a prototype test study',()=>assert.equal(validateStudy(valid).id,'test-study'));
test('rejects malformed task IDs',()=>assert.throws(()=>validateStudy({...valid,tasks:[{id:'bad id',instructions:'Go'}]}),/Task IDs/));
test('rejects JavaScript prototype URLs',()=>assert.throws(()=>validateStudy({...valid,prototypeUrl:'javascript:alert(1)'}),/HTTP/));
test('rejects HTTP on public internet',()=>assert.throws(()=>validateStudy({...valid,prototypeUrl:'http://example.org/'}),/HTTPS/));
test('escapes markup for display',()=>assert.equal(escapeHTML('<script>'), '&lt;script&gt;'));
test('CSV preserves commas, quotes, and newlines',()=>assert.equal(csv([{a:'x,"y"\nz'}],['a']), '"a"\r\n"x,""y""\nz"'));
test('scale choices are numeric strings',()=>assert.deepEqual(getQuestionChoices({type:'scale5'}),['1','2','3','4','5']));
test('flattens sessions, task outcome, answers, clicks with links intact',()=>{
  const rows=[
    {study_id:'s',session_id:'one',kind:'session_started',created_at:'2026-10-01T10:00:00Z',payload:{}},
    {study_id:'s',session_id:'one',kind:'task_ended',task_id:'t',created_at:'2026-10-01T10:01:00Z',payload:{observed_success:true,self_report:'unable',time_seconds:59,click_count:2,tracker_connected:true}},
    {study_id:'s',session_id:'one',kind:'answers',task_id:'t',created_at:'2026-10-01T10:01:03Z',payload:{stage:'post_task',answers:{ease:'2'}}},
    {study_id:'s',session_id:'one',kind:'interaction_batch',task_id:'t',created_at:'2026-10-01T10:00:30Z',payload:{items:[{type:'click',page:'/home',target:'nav',x_pct:4,y_pct:17}]}}
  ];
  const result=flattenEvents(rows);
  assert.equal(result.sessions.length,1);
  assert.equal(result.tasks[0].observed_success,true);
  assert.equal(result.tasks[0].self_report,'unable');
  assert.equal(result.answers[0].response,'2');
  assert.equal(result.interactions[0].x_pct,4);
  assert.equal(result.interactions[0].task_id,'t');
});
