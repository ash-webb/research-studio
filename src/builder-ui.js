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
  if(m==='ab_test'){
    const rows=(task.variants||[]).map((v,i)=>`<div class="variant-row" data-variant-index="${i}"><span class="variant-letter" aria-hidden="true">${String.fromCharCode(65+i)}</span><label class="field v-name">Design name<input data-variant-field="label" value="${esc(v.label)}" placeholder="e.g. Sidebar navigation"></label><label class="field v-id">Design ID<input data-variant-field="id" value="${esc(v.id)}" placeholder="design-a" autocomplete="off" spellcheck="false"></label><label class="field v-url">Prototype link<input data-variant-field="prototypeUrl" value="${esc(v.prototypeUrl)}" placeholder="https://…/design-a/" autocomplete="off" spellcheck="false"></label><label class="field v-ver">Version<input data-variant-field="revision" value="${esc(v.revision||'')}" placeholder="Optional, e.g. v1"></label><button type="button" class="btn btn-small btn-danger v-rm" data-remove-variant="${i}" ${(task.variants||[]).length<=2?'disabled title="An A/B test needs at least two designs"':''} aria-label="Remove ${esc(v.label||`design ${i+1}`)}">Remove</button><p class="variant-error" role="alert" ${task._variantErrors?.[i]?'':'hidden'}>${esc(task._variantErrors?.[i]||'')}</p></div>`).join('');
    return `<div class="method-editor"><p class="helper">Each participant sees one design, assigned at random or by your survey's randomizer through the study link. Use the same experiment ID in several activities to keep each participant on the same design throughout.</p><div class="form-grid">${fld('Experiment ID','experimentId',task.experimentId||task.id,'Use the same ID across activities that share an assignment')}${fld('Success signal (optional)','successSignal',task.successSignal||'','Every design sends this when the task is done')}</div><div class="variant-rows" data-variant-rows><div class="variant-rows-head"><strong>Designs to compare</strong><small>Most studies compare 2–3 designs.</small></div><p class="variant-legend">The <strong>name</strong> is for researchers only; participants never see it. The <strong>ID</strong> appears in your data and in study links (e.g. <code>variant=design-b</code>). The <strong>version</strong> records exactly which build participants saw.</p>${rows}<div class="variant-actions"><button type="button" class="btn btn-small btn-outline" data-add-variant="true" ${(task.variants||[]).length>=6?'disabled':''}>+ Add design</button><button type="button" class="btn btn-small btn-secondary" data-check-designs="true">Check designs</button></div></div><p class="helper">Add the tracking script to every design. Use a fixed address or version for each design so results can be traced to what participants saw. A missing success signal is never counted as a failure.</p></div>`;
  }
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

// v0.3.6 design rows: validation for one design, given all designs in the activity.
export function variantRowError(v,all,base='https://example.test/'){
  if(!String(v.label||'').trim())return 'Give this design a name.';
  if(!/^[a-z0-9-]{1,64}$/.test(v.id||''))return 'Design ID: use lowercase letters, numbers and hyphens only (for example design-a).';
  if(all.filter(o=>o.id===v.id).length>1)return 'Two designs have the same ID. Each needs its own.';
  if(!String(v.prototypeUrl||'').trim())return 'Add the prototype link for this design.';
  try{const u=new URL(v.prototypeUrl,base);if(u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))return 'Prototype links must start with https:// (http is only allowed for localhost).';if(!['http:','https:'].includes(u.protocol))return 'Prototype links must start with https://.';}
  catch{return 'That prototype link is not a valid web address.';}
  if(v.revision&&String(v.revision).length>120)return 'Version must be 120 characters or fewer.';
  return '';
}
export function nextVariant(existing){
  for(let i=0;i<26;i++){const letter=String.fromCharCode(97+i);const id=`design-${letter}`;if(!existing.some(v=>v.id===id))return {id,label:`Design ${letter.toUpperCase()}`,prototypeUrl:'',revision:''};}
  return {id:`design-${existing.length+1}`,label:`Design ${existing.length+1}`,prototypeUrl:'',revision:''};
}
