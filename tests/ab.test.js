import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateStudy,flattenEvents,escapeHTML,csv} from '../src/shared.js';
import {validateActivity,assignExperimentVariant,experimentComparisonRows,methodOutcomeRows} from '../src/methods.js';
import {newActivity,methodEditorHTML,parseImplementedVariants} from '../src/builder-ui.js';
import {renderAnalyses} from '../src/results-ui.js';

globalThis.location={href:'http://localhost:8000/'};
const study=JSON.parse(readFileSync(new URL('../studies/demo-ab-implementation.json',import.meta.url),'utf8'));
const task=study.tasks[0];
const exposure=(session,id='design-a',at='2026-11-01T10:00:00Z')=>({study_id:study.id,session_id:session,task_id:task.id,created_at:at,kind:'task_started',payload:{method:'ab_test',experiment_id:task.experimentId,variant_id:id,variant_revision:'demo-v1'}});
const end=(session,id='design-a',signal='received',at='2026-11-01T10:01:00Z')=>({study_id:study.id,session_id:session,task_id:task.id,created_at:at,kind:'task_ended',payload:{method:'ab_test',experiment_id:task.experimentId,variant_id:id,variant_revision:'demo-v1',time_seconds:46,click_count:3,tracker_connected:true,self_report:'completed',result:{experiment_id:task.experimentId,variant_id:id,success_signal_status:signal}}});
test('demo A/B study is valid',()=>assert.doesNotThrow(()=>validateStudy(study)));
test('requires at least two implemented variants',()=>assert.throws(()=>validateActivity({...task,variants:task.variants.slice(0,1)}),/at least two/));
test('rejects duplicate variant IDs',()=>assert.throws(()=>validateActivity({...task,variants:[task.variants[0],task.variants[0]]}),/unique/));
test('rejects script URLs',()=>assert.throws(()=>validateActivity({...task,variants:[{...task.variants[0],prototypeUrl:'javascript:alert(1)'},task.variants[1]]}),/HTTPS|URLs/));
test('rejects unencrypted remote variant pages',()=>assert.throws(()=>validateActivity({...task,variants:[{...task.variants[0],prototypeUrl:'http://example.com/'},task.variants[1]]}),/HTTPS/));
test('allows HTTPS variant pages',()=>assert.doesNotThrow(()=>validateActivity({...task,variants:[{...task.variants[0],prototypeUrl:'https://example.com/a'},task.variants[1]]})));
test('same experiment ID must use same variant IDs in all tasks',()=>assert.throws(()=>validateStudy({...study,tasks:[task,{...study.tasks[1],variants:[{...task.variants[0],id:'other'},task.variants[1]]}]}),/same variant IDs/));
test('experiment allows reordered variant lists across tasks',()=>assert.doesNotThrow(()=>validateStudy({...study,tasks:[task,{...study.tasks[1],variants:study.tasks[1].variants.slice().reverse()}]})));
test('rejects unknown experiment ID',()=>assert.throws(()=>validateActivity({...task,experimentId:'Bad characters'}),/experiment ID/));
test('rejects overly long revision',()=>assert.throws(()=>validateActivity({...task,variants:[{...task.variants[0],revision:'a'.repeat(121)},task.variants[1]]}),/revision/));
test('assignment is stable for same session and experiment despite variant order',()=>{
 const one=assignExperimentVariant('some-uuid',study.id,task);
 const shuffled=assignExperimentVariant('some-uuid',study.id,{...task,variants:task.variants.slice().reverse()});
 assert.equal(one.id,shuffled.id);
 assert.equal(one.id,assignExperimentVariant('some-uuid',study.id,study.tasks[1]).id);
});
test('assignment supports three or more variants',()=>{
 const three={...task,variants:[...task.variants,{id:'design-c',label:'C',prototypeUrl:'https://example.com/c'}]};
 const ids=new Set(Array.from({length:400},(_,i)=>assignExperimentVariant(`uuid-${i}`,study.id,three).id));
 assert.deepEqual([...ids].sort(),['design-a','design-b','design-c']);
});
test('A/B editor creates valid draft and parses optional revisions',()=>{
 const newTask=newActivity('ab_test',1);assert.equal(newTask.variants.length,2);
 assert.ok(methodEditorHTML(newTask).includes('data-variant-rows'));
 assert.deepEqual(parseImplementedVariants('a | Alpha | https://example.com/a | 7b3c\nb | Beta | https://example.com/b'),[
  {id:'a',label:'Alpha',prototypeUrl:'https://example.com/a',revision:'7b3c'},
  {id:'b',label:'Beta',prototypeUrl:'https://example.com/b'}]);
});
test('A/B exposure export includes non-submissions and real trial outcomes',()=>{
 const events=[{study_id:study.id,session_id:'one',kind:'session_started',payload:{study_version:'0.3.0'},created_at:'2026-11-01T09:59:00Z'},exposure('one'),end('one'),exposure('two','design-b')];
 const rows=experimentComparisonRows(events);
 assert.equal(rows.length,2);
 assert.equal(rows[0].variant_id,'design-a');
 assert.equal(rows[0].status,'submitted');
 assert.equal(rows[0].study_version,'0.3.0');
 assert.equal(rows[0].success_signal_status,'received');
 assert.equal(rows[1].status,'not_submitted');
 assert.equal(rows[1].time_seconds,null);
 assert.ok(csv(rows,['variant_id','status']).includes('not_submitted'));
});
test('A/B variant ID is preserved across outcomes, answers, interactions and method rows',()=>{
 const events=[exposure('one'),end('one'),{study_id:study.id,session_id:'one',task_id:task.id,created_at:'2026-11-01T10:02:00Z',kind:'answers',payload:{stage:'post_task',answers:{ease:'5'}}},{study_id:study.id,session_id:'one',task_id:task.id,created_at:'2026-11-01T10:01:00Z',kind:'interaction_batch',payload:{items:[{type:'click',target:'a-nav',x_pct:10,y_pct:20}]}}];
 const flat=flattenEvents(events);
 assert.equal(flat.starts[0].variant_id,'design-a');
 assert.equal(flat.tasks[0].variant_id,'design-a');
 assert.equal(flat.interactions[0].variant_id,'design-a');
 assert.equal(flat.answers[0].experiment_id,task.experimentId);
 assert.equal(methodOutcomeRows(events)[0].variant_revision,'demo-v1');
});
test('results show per-arm assignment, missing sessions and no automatic winner',()=>{
 const events=[exposure('one'),end('one'),exposure('two','design-b')];
 const flat=flattenEvents(events);
 const out=renderAnalyses({...study,tasks:[task]},flat,escapeHTML);
 assert.ok(out.includes('Implementation outcomes by variant'));
 assert.ok(out.includes('No significance testing'));
 assert.ok(out.includes('Not submitted'));
 assert.ok(out.includes('automatic winner selection'));
});
test('A/B dashboard separates post-task ratings and clicks by assigned arm',()=>{
 const events=[exposure('one'),end('one'),exposure('two','design-b'),end('two','design-b','not_observed'),
  {study_id:study.id,session_id:'one',task_id:task.id,kind:'answers',created_at:'2026-11-01T10:02:00Z',payload:{stage:'post_task',answers:{'request-ease':'7'}}},
  {study_id:study.id,session_id:'two',task_id:task.id,kind:'answers',created_at:'2026-11-01T10:02:00Z',payload:{stage:'post_task',answers:{'request-ease':'2'}}},
  {study_id:study.id,session_id:'two',task_id:task.id,kind:'interaction_batch',created_at:'2026-11-01T10:00:30Z',payload:{items:[{type:'click',target:'b-tile-requests',x_pct:9,y_pct:15}]}}
 ];
 const out=renderAnalyses({...study,tasks:[task]},flattenEvents(events),escapeHTML);
 assert.ok(out.includes('Post-task responses by variant'));
 assert.ok(out.includes('Tracked interaction targets by variant'));
 assert.ok(out.includes('b-tile-requests'));
 assert.ok(out.includes('7.0'));
 assert.ok(out.includes('2.0'));
});
test('A/B dashboard escapes untrusted variant labels',()=>{
 const attack='<svg onload=alert(1)>';
 const malicious={...task,variants:task.variants.map((v,i)=>i===0?{...v,label:attack}:v)};
 const out=renderAnalyses({...study,tasks:[malicious]},flattenEvents([exposure('one')]),escapeHTML);
 assert.ok(out.includes('&lt;svg onload=alert(1)&gt;'));
 assert.ok(!out.includes(attack));
});
