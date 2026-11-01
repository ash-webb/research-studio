import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderAnalyses} from '../src/results-ui.js';
import {escapeHTML,flattenEvents,csv} from '../src/shared.js';
import {methodOutcomeRows,exportMethodRows} from '../src/methods.js';
const study=JSON.parse(readFileSync(new URL('../studies/demo-mixed.json',import.meta.url),'utf8'));
function outcome(id,method,result){return {session_id:'sample-session',study_id:'demo-mixed',task_id:id,method,result,time_seconds:12,observed_success:result?.success??false};}
test('results render each method without an external API',()=>{
 const flat={tasks:[
  outcome('organize-content','card_sort',{sort_mode:'open',groups:Object.fromEntries(study.tasks[0].cards.map((x,i)=>[x.id,i%2?'group-2':'group-1'])),categories:[{id:'group-1',label:'Category 1'},{id:'group-2',label:'Category 2'}],completed:true}),
  outcome('find-transcript','tree_test',{success:true,direct:true,first_branch_correct:true,selected_path:['records','tax-transcripts'],backtracks:0}),
  outcome('first-click-records','first_click',{click:{x_pct:10,y_pct:40},hit_target:true,scored:true}),
  outcome('choose-layout','preference',{selected_id:'tiles',no_preference:false,display_order:['list','tiles']}),
  outcome('survey-questions','survey',{answered_question_ids:['frequency'],response_count:1})
 ],answers:[{task_id:'survey-questions',stage:'activity',question_id:'frequency',response:'Weekly'}]};
 const out=renderAnalyses(study,flat,escapeHTML);
 for(const section of ['Card co-placement similarity','Recent navigation paths','Recorded first clicks','Selections','Account experience survey'])assert.ok(out.includes(section),`${section} missing`);
 assert.ok(out.includes('100%'));
});
test('survey text is HTML escaped in result rendering',()=>{
 const flat={tasks:[outcome('survey-questions','survey',{response_count:1})],answers:[{task_id:'survey-questions',stage:'activity',question_id:'feedback',response:'<script>alert(1)</script>'}]};
 const out=renderAnalyses({...study,tasks:[study.tasks.at(-1)]},flat,escapeHTML);
 assert.ok(out.includes('&lt;script&gt;'));assert.ok(!out.includes('<script>'));
});
test('method event and study version survive flatten and export',()=>{
 const src=[
  {kind:'session_started',study_id:'demo-mixed',session_id:'one',created_at:'2026-01-01T00:00:00Z',payload:{study_version:'0.2.0'}},
  {kind:'method_event',study_id:'demo-mixed',session_id:'one',task_id:'find-transcript',created_at:'2026-01-01T00:00:01Z',payload:{method:'tree_test',action:'tree_open',detail:{node_id:'records'}}},
  {kind:'task_ended',study_id:'demo-mixed',session_id:'one',task_id:'find-transcript',created_at:'2026-01-01T00:00:02Z',payload:{method:'tree_test',time_seconds:2,result:{success:true}}}
 ];
 const flat=flattenEvents(src);assert.equal(flat.methodEvents[0].detail.node_id,'records');assert.equal(flat.sessions[0].study_version,'0.2.0');
 const rows=exportMethodRows(methodOutcomeRows(src));assert.equal(rows[0].study_version,'0.2.0');assert.equal(JSON.parse(rows[0].result).success,true);
 const text=csv(rows,['session_id','study_version','result']);assert.ok(text.includes('0.2.0'));
});
