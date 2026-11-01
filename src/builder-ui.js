// Researcher-facing method editors. All displayed study text is HTML-escaped.
import { METHODS, normalizeMethod } from './methods.js';
const esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fld=(label,name,value,small='')=>`<label class="field">${label}${small?`<small>${esc(small)}</small>`:''}<input data-task-field="${name}" value="${esc(value??'')}"></label>`;
const txt=(label,name,value,rows=4,small='')=>`<label class="field">${label}${small?`<small>${esc(small)}</small>`:''}<textarea rows="${rows}" data-task-${name.includes('tree')?'tree':'lines'}="${esc(name)}">${esc(value||'')}</textarea></label>`;
const lines=items=>(items||[]).map(item=>`${item.id} | ${item.label}`).join('\n');
const variants=items=>(items||[]).map(item=>`${item.id} | ${item.label} | ${item.imageUrl}`).join('\n');
const implementedVariants=items=>(items||[]).map(item=>`${item.id} | ${item.label} | ${item.prototypeUrl}${item.revision?' | '+item.revision:''}`).join('\n');
const treeText=(tree=[],depth=0)=>tree.map(n=>`${'  '.repeat(depth)}${n.id} | ${n.label}` + (n.children?.length?`\n${treeText(n.children,depth+1)}`:'' )).join('\n');
const targets=items=>(items||[]).map(a=>`${a.x}, ${a.y}, ${a.width}, ${a.height} | ${a.label||''}`).join('\n');
const options=Object.entries(METHODS).map(([id,m])=>`<option value="${id}">${m.label}</option>`).join('');
export function methodOptions(current){return Object.entries(METHODS).map(([v,o])=>`<option value="${v}" ${current===v?'selected':''}>${o.label}</option>`).join('');}
export function newActivity(method='prototype',index=1){
  const base={id:`activity-${index}`,method,title:METHODS[method]?.label||'Activity',instructions:'',questions:[]};
  switch(method){
    case 'prototype':return {...base,successSignal:`activity-${index}`,prototypeUrl:''};
    case 'ab_test':return {...base,title:'Compare implemented designs',instructions:'Find the details of the latest service request.',experimentId:`design-comparison-${index}`,successSignal:'ab-request-detail',variants:[{id:'design-a',label:'Design A',prototypeUrl:'demo/ab-design-a.html',revision:'demo-v1'},{id:'design-b',label:'Design B',prototypeUrl:'demo/ab-design-b.html',revision:'demo-v1'}]};
    case 'card_sort':return {...base,sortMode:'open',instructions:'Organize these items into groups that make sense to you.',cards:[{id:'item-one',label:'First item'},{id:'item-two',label:'Second item'}],categories:[]};
    case 'tree_test':return {...base,instructions:'Where would you look for the requested information?',tree:[{id:'records',label:'Records',children:[{id:'document',label:'Document'}]},{id:'payments',label:'Payments'}],correctNodeIds:['document']};
    case 'first_click':return {...base,instructions:'Where would you click first to complete the task?',imageUrl:'demo/assets/first-click.svg',imageAlt:'Example screen',targetAreas:[]};
    case 'preference':return {...base,instructions:'Which design would you prefer?',variants:[{id:'option-a',label:'Option A',imageUrl:'demo/assets/design-a.svg'},{id:'option-b',label:'Option B',imageUrl:'demo/assets/design-b.svg'}]};
    case 'survey':return {...base,instructions:'Please answer the following questions.',questions:[{id:'feedback',type:'textarea',text:'What would you like to share?',required:false}]};
    default:return base;
  }
}
export function methodEditorHTML(task){
  const m=normalizeMethod(task);
  if(m==='prototype')return `<div class="method-editor"><p class="helper">Tracking requires the instrumented prototype to send messages from the included bridge script.</p><div class="form-grid">${fld('Prototype URL (optional override)','prototypeUrl',task.prototypeUrl,'Leave empty to use the study-level URL')}${fld('Success signal ID','successSignal',task.successSignal,'Match the signal sent by your prototype')}</div></div>`;
  if(m==='ab_test')return `<div class="method-editor"><p class="helper">Between-participant A/B/n experiment. Each participant sees only one randomly assigned interactive implementation. Reuse the same experiment ID and variant IDs in additional activities to keep assignments consistent.</p><div class="form-grid">${fld('Experiment ID','experimentId',task.experimentId||task.id,'Use the same ID across activities that share an assignment')}${fld('Shared success signal (optional)','successSignal',task.successSignal||'','Send this signal from each implementation after the same intended outcome')}</div>${txt('Interactive variants','abVariants',implementedVariants(task.variants),5,'One per line: variant-id | Label | HTTPS prototype URL | Revision (optional). Equal-probability allocation; not quota balanced.')}<p class="helper">Use pinned deployments or record a distinct revision for each design. Add the tracking bridge to every variant. Missing signals are not treated as proven failures.</p></div>`;
  if(m==='card_sort')return `<div class="method-editor"><label class="field">Sort type<select data-task-field="sortMode"><option value="open" ${task.sortMode==='open'?'selected':''}>Open — participants name groups</option><option value="closed" ${task.sortMode==='closed'?'selected':''}>Closed — groups are fixed</option><option value="hybrid" ${task.sortMode==='hybrid'?'selected':''}>Hybrid — fixed + participant-created groups</option></select></label>${txt('Cards','cards',lines(task.cards),7,'One per line: card-id | Card label')}${txt('Predefined categories','categories',lines(task.categories),4,'One per line: category-id | Category label. Required for closed card sorts.')}</div>`;
  if(m==='tree_test')return `<div class="method-editor">${txt('Navigation tree','tree',treeText(task.tree||[]),11,'Indent children with two spaces. Each line: node-id | Node label')}${fld('Correct destination ID(s)','correctNodeIds',(task.correctNodeIds||[]).join(', '),'Comma-separated IDs matching nodes in the tree')}${task._editorErrors?.tree?`<p class="notice warning">${esc(task._editorErrors.tree)}</p>`:''}</div>`;
  if(m==='first_click')return `<div class="method-editor">${fld('Image URL','imageUrl',task.imageUrl,'Use an HTTPS image or a file under demo/assets/')}${fld('Image alt text','imageAlt',task.imageAlt)}${txt('Optional correct target rectangles','targetAreas',targets(task.targetAreas),3,'One per line: x, y, width, height | Label. All values are % of image width/height. Leave empty for unscored exploration.')}</div>`;
  if(m==='preference')return `<div class="method-editor">${txt('Design options','variants',variants(task.variants),6,'One per line: option-id | Display label | HTTPS or relative image URL. Order is randomized for participants.')}</div>`;
  if(m==='survey')return `<div class="method-editor"><p class="helper">Add survey questions below. This activity does not require a prototype.</p></div>`;
  return `<p class="notice warning">Unsupported method: ${esc(m)}</p>`;
}
const slug=(v)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'item';
export function parseItems(text,variant=false){
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,i)=>{
    const parts=line.split('|').map(x=>x.trim());
    if(variant){if(parts.length<3)throw new Error('Each design option needs ID | Label | Image URL.');return {id:parts[0]||`option-${i+1}`,label:parts[1],imageUrl:parts.slice(2).join('|').trim()};}
    return parts.length===1?{id:slug(parts[0]),label:parts[0]}:{id:parts[0]||slug(parts[1]),label:parts.slice(1).join('|').trim()};
  });
}
export function parseImplementedVariants(text){
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,i)=>{
    const parts=line.split('|').map(x=>x.trim());
    if(parts.length<3||parts.length>4)throw new Error(`Variant line ${i+1} needs ID | Label | Prototype URL | Revision (optional).`);
    const [id,label,prototypeUrl,revision]=parts;
    return {id:id||slug(label),label,prototypeUrl,...(revision?{revision}:{})};
  });
}
export function parseTree(text){
  const roots=[],stack=[];
  for(const line of text.split(/\r?\n/)){
    if(!line.trim())continue;
    const leading=line.match(/^ */)[0].length;if(leading%2)throw new Error('Tree indentation must be multiples of two spaces.');
    const depth=leading/2;
    const [item]=parseItems(line.trim());
    const node={id:item.id,label:item.label};
    if(depth>stack.length)throw new Error('Each tree level must be nested directly beneath its parent.');
    if(depth===0)roots.push(node);
    else {const parent=stack[depth-1];if(!parent)throw new Error('Tree item needs a parent.');parent.children??=[];parent.children.push(node);}
    stack[depth]=node;stack.length=depth+1;
  }
  return roots;
}
export function parseTargets(text){
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{
    const [coords,label='']=line.split('|');const parts=coords.split(',').map(x=>Number(x.trim()));
    if(parts.length!==4||parts.some(x=>!Number.isFinite(x)))throw new Error('Each first-click target needs x, y, width, height | Label.');
    const [x,y,width,height]=parts;return {x,y,width,height,label:label.trim()};
  });
}
export function parseEditorValue(task,element){
  if(element.dataset.taskLines){
    const field=element.dataset.taskLines;
    if(field==='abVariants')task.variants=parseImplementedVariants(element.value);
    else task[field]=field==='targetAreas'?parseTargets(element.value):parseItems(element.value,field==='variants');
  }
  if(element.dataset.taskTree){task.tree=parseTree(element.value);}
  if(element.dataset.taskField==='correctNodeIds')task.correctNodeIds=element.value.split(',').map(x=>x.trim()).filter(Boolean);
}
