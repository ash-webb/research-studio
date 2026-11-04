import test from 'node:test';
import assert from 'node:assert/strict';
import {parseItems,parseTree,parseTargets,newActivity,methodEditorHTML} from '../src/builder-ui.js';
import {validateStudy} from '../src/shared.js';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const dir=new URL('../studies/',import.meta.url);
globalThis.location={href:'http://localhost:8000/'};
test('all shipped studies have validated activity configs',()=>{
  const files=readdirSync(dir).filter(x=>x.endsWith('.json')&&x!=='index.json');
  for(const file of files){const obj=JSON.parse(readFileSync(new URL(file,dir),'utf8'));assert.doesNotThrow(()=>validateStudy(obj),`${file} failed validation`);}
  assert.equal(files.length,9); // 8 demos + iola-current-vs-new
});
test('new study methods create valid default configurations once named',()=>{
 for(const method of ['card_sort','tree_test','first_click','preference','survey','ab_test']){
  const task=newActivity(method,1);
  const study={id:'example-study',title:'Example',tasks:[task]};
  assert.doesNotThrow(()=>validateStudy(study),`${method} did not validate`);
 }
});
test('tree text indentation builds nested nodes',()=>{
 const tree=parseTree('records | Records\n  transcript | Transcript\n  notices | Notices\npayments | Payments');
 assert.equal(tree.length,2);assert.equal(tree[0].children.length,2);assert.equal(tree[0].children[0].id,'transcript');
});
test('malformed tree indents reject',()=>assert.throws(()=>parseTree('records | Records\n   bad | Bad'),/indentation/));
test('parsing card rows and variant rows',()=>{
 assert.equal(parseItems('item | A card')[0].label,'A card');
 assert.deepEqual(parseItems('option-a | Option A | images/a.svg',true)[0],{id:'option-a',label:'Option A',imageUrl:'images/a.svg'});
});
test('target percentage coordinate parsing preserves values',()=>assert.deepEqual(parseTargets('12, 23, 35, 41 | Destination'),[{x:12,y:23,width:35,height:41,label:'Destination'}]));
test('builder HTML escapes participant-facing card labels',()=>assert.ok(methodEditorHTML({...newActivity('card_sort',1),cards:[{id:'x',label:'<img src=x onerror=alert(1)>'},{id:'y',label:'Card 2'}]}).includes('&lt;img')));
