import { normalizeMethod, METHODS, pairwiseSimilarity, flattenTree } from './methods.js';
const fmt=n=>Number.isFinite(n)?`${Math.round(n)}%`:'—';
const rate=(n,d)=>d?fmt(n/d*100):'—';
const pill=(name,value)=>`<span>${name}: <strong>${value}</strong></span>`;
function bars(items,total,esc){return items.map(x=>`<div class="analysis-bar"><label title="${esc(x.label)}">${esc(x.label)}</label><div class="analysis-bar-track"><div class="analysis-bar-fill" style="width:${total?Math.max(0,Math.min(100,x.n/total*100)):0}%"></div></div><small>${x.n}</small></div>`).join('');}
function cardsHTML(a,data,esc){
  const complete=data.filter(t=>t.result.completed===true);
  if(!complete.length)return '<p class="muted small">No fully completed sorts yet. Partial placements remain available in the raw method exports.</p>';
  const cards=a.cards||[];const similarity=pairwiseSimilarity(complete.map(x=>x.result),cards);
  const matrix=`<div class="table-scroll"><table class="similarity-grid"><thead><tr><th>Item</th>${cards.map(c=>`<th title="${esc(c.label)}">${esc(c.id)}</th>`).join('')}</tr></thead><tbody>${cards.map((c,i)=>`<tr><th title="${esc(c.label)}">${esc(c.label)}</th>${similarity[i].map((v,j)=>`<td title="${esc(cards[i].label)} + ${esc(cards[j].label)}: ${v.paired} of ${v.n} eligible sorts">${v.percent===null?'—':`${v.percent}%`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const categoryCount=new Map();
  for(const t of complete){const cats=new Map((t.result.categories||[]).map(c=>[c.id,c.label]));for(const groupId of Object.values(t.result.groups||{})){if(!groupId)continue;const label=cats.get(groupId)||'(unnamed group)';categoryCount.set(label,(categoryCount.get(label)||0)+1);}}
  const top=[...categoryCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([label,n])=>({label,n}));
  const hints=a.sortMode==='open'?'Participant-created category labels are shown without automatic synonym merging.':'Assignment counts include each card placement, not distinct participants.';
  return `<div class="method-summary">${pill('Completed sorts',complete.length)}${pill('Incomplete submissions',data.length-complete.length)}${pill('Cards',cards.length)}</div><h4>Card co-placement similarity</h4><p class="analysis-subtitle">Share of eligible completed sorts in which each pair was assigned to the same category. Labels are not assumed to be semantically equivalent.</p>${matrix}<h4>Most used category labels</h4>${bars(top,Math.max(1,complete.length*cards.length),esc)}<p class="analysis-subtitle">${esc(hints)}</p>`;
}
function treeHTML(a,data,esc){
  const attempted=data.length, successes=data.filter(t=>t.result.success).length;
  const directs=data.filter(t=>t.result.direct).length;
  const firstCorrect=data.filter(t=>t.result.first_branch_correct).length;
  const foundNone=data.filter(t=>t.result.participant_could_not_find).length;
  const lookup=new Map(flattenTree(a.tree).map(n=>[n.id,n.label]));
  const rows=data.slice(-15).reverse().map(t=>`<tr><td>${esc(t.session_id.slice(0,8))}…</td><td>${esc((t.result.selected_path||[]).map(x=>lookup.get(x)||x).join(' › ')||'No selection')}</td><td>${t.result.success?'Yes':'No'}</td><td>${t.result.direct?'Yes':'No'}</td><td>${t.result.backtracks||0}</td></tr>`).join('');
  return `<div class="method-summary">${pill('Success',`${successes}/${attempted} (${rate(successes,attempted)})`)}${pill('Direct paths',directs)}${pill('Correct first branch',firstCorrect)}${pill('Could not find',foundNone)}</div><h4>Recent navigation paths</h4><p class="analysis-subtitle">Direct path means no backtracking or detours before a correctly selected destination.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Session</th><th>Selected path</th><th>Success</th><th>Direct</th><th>Backtracks</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function clicksHTML(a,data,esc){
  // Scored attempts include "not sure" (no click) answers, matching the Activity outcomes table.
  const clicked=data.filter(t=>t.result.click),scored=data.filter(t=>t.result.scored),hits=scored.filter(t=>t.result.hit_target===true).length;
  const unsure=data.filter(t=>t.result.participant_could_not_choose).length;
  const dots=clicked.slice(0,60).map((t,i)=>{const x=+t.result.click.x_pct,y=+t.result.click.y_pct;if(!Number.isFinite(x)||!Number.isFinite(y))return '';
    return `<span class="click-dot" style="left:${Math.min(100,Math.max(0,x))}%;top:${Math.min(100,Math.max(0,y))}%" title="${esc(t.session_id.slice(0,8))} · first click">${i+1}</span>`;
  }).join('');
  return `<div class="method-summary">${pill('Recorded first clicks',`${clicked.length}/${data.length}`)}${pill('Target hit rate',scored.length?`${hits}/${scored.length} (${rate(hits,scored.length)})`:'Unscored')}${pill('Not sure (no click)',unsure)}</div><p class="analysis-subtitle">Dots show the first click reported by each completed session; positions are proportional to the source image. On scored tests, "not sure" answers count as attempts that did not hit a target.</p><div class="analysis-first-click"><img src="${esc(a.imageUrl)}" alt="${esc(a.imageAlt||'Test image')}">${dots}</div>`;
}
function preferenceHTML(a,data,esc){
 const n=data.length,items=a.variants.map(v=>({label:v.label,n:data.filter(t=>t.result.selected_id===v.id).length}));
 items.push({label:'No preference',n:data.filter(t=>t.result.no_preference).length});
 return `<div class="method-summary">${pill('Completed comparisons',n)}${pill('Randomized order','Yes')}</div><h4>Selections</h4>${bars(items,n,esc)}<p class="analysis-subtitle">Counts are descriptive, not statistical significance tests. Presentation order is retained in participant-level exports.</p>`;
}
const median=value=>{const v=value.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?(v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2):null;};
function abHTML(a,data,flat,esc){
  const exposures=(flat.starts||[]).filter(x=>x.task_id===a.id&&x.method==='ab_test');
  const rows=a.variants.map((variant,i)=>{
    const armExposures=exposures.filter(x=>x.variant_id===variant.id);
    const submissions=data.filter(x=>x.variant_id===variant.id);
    const withTracker=submissions.filter(x=>x.tracker_connected);
    const withSignal=withTracker.filter(x=>x.result.success_signal_status==='received');
    const selfReport=submissions.filter(x=>x.self_report==='completed');
    const times=submissions.map(x=>Number(x.time_seconds)).filter(Number.isFinite);
    const clicks=withTracker.map(x=>Number(x.click_count)).filter(Number.isFinite);
    const medianTime=median(times),medianClicks=median(clicks);
    return {variant,control:i===0,assigned:armExposures.length,completed:submissions.length,
      missing:Math.max(0,armExposures.length-submissions.length),connected:withTracker.length,
      signal:withSignal.length,selfReport:selfReport.length,medianTime,medianClicks};
  });
  const resultRows=rows.map(r=>`<tr><th scope="row">${esc(r.variant.label)}${r.control?' <small>(baseline)</small>':''}${r.variant.revision?`<div class="muted tiny">Build: ${esc(r.variant.revision)}</div>`:''}</th><td>${r.assigned}</td><td>${r.completed}</td><td>${r.missing}</td><td>${r.selfReport}/${r.completed||0}</td><td>${a.successSignal?(r.connected?`${r.signal}/${r.connected} (${rate(r.signal,r.connected)})`:'No connected sessions'):'Unscored'}</td><td>${r.medianTime==null?'—':`${Math.round(r.medianTime)}s`}</td><td>${r.medianClicks==null?'—':r.medianClicks.toFixed(1)}</td></tr>`).join('');
  const total=exposures.length;
  const barsRows=rows.map(r=>({label:r.variant.label,n:r.assigned}));
  const answers=(flat.answers||[]).filter(x=>x.task_id===a.id&&x.stage==='post_task');
  const questionRows=(a.questions||[]).map(q=>{
    const cells=a.variants.map(v=>{
      const values=answers.filter(x=>x.variant_id===v.id&&x.question_id===q.id).map(x=>x.response).filter(x=>x!==''&&x!==null&&x!==undefined);
      if(!values.length)return '<td>—</td>';
      if(['scale5','scale7'].includes(q.type)){
        const scored=values.map(Number).filter(Number.isFinite);
        const midpoint=median(scored);
        return `<td>${midpoint==null?'—':midpoint.toFixed(1)} <small>(n=${scored.length})</small></td>`;
      }
      if(q.type==='single'){
        const counts=new Map();for(const value of values)counts.set(String(value),(counts.get(String(value))||0)+1);
        return `<td>${[...counts.entries()].map(([label,n])=>`${esc(label)}: ${n}`).join(', ')}</td>`;
      }
      return `<td>${values.length} response(s)</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(q.text)}</th>${cells}</tr>`;
  });
  const answerSummary=questionRows.length?`<h4>Post-task responses by variant</h4><p class="analysis-subtitle">Ratings display the median and response count. Open-text feedback is counted but not automatically interpreted; use the Survey CSV for qualitative analysis.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Question</th>${a.variants.map(v=>`<th>${esc(v.label)}</th>`).join('')}</tr></thead><tbody>${questionRows.join('')}</tbody></table></div>`:'';
  const clicks=(flat.interactions||[]).filter(x=>x.task_id===a.id&&x.type==='click'&&x.variant_id);
  const topClicks=a.variants.map(v=>{
    const items=clicks.filter(x=>x.variant_id===v.id),count=new Map();
    for(const x of items){const target=x.target||'(unnamed)';count.set(target,(count.get(target)||0)+1);}
    return `<tr><th scope="row">${esc(v.label)}</th><td>${items.length}</td><td>${[...count.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([label,n])=>`${esc(label)} (${n})`).join(', ')||'No clicks captured'}</td></tr>`;
  }).join('');
  const clickSummary=`<h4>Tracked interaction targets by variant</h4><p class="analysis-subtitle">Counts are click events, not unique participants. Target IDs may differ between implementations; do not assume that elements with similar names are equivalent.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Variant</th><th>Tracked clicks</th><th>Most frequent element IDs</th></tr></thead><tbody>${topClicks}</tbody></table></div>`;
  const bySource=exposures.reduce((m,x)=>{const k=String(x.assignment||'stable-hash-equal').startsWith('link')?'link':(String(x.assignment||'').includes('not recognised')?'fallback':'builtin');m[k]=(m[k]||0)+1;return m;},{});
  const sourceText=[bySource.link?`${bySource.link} from study link`:'',bySource.builtin?`${bySource.builtin} built-in random`:'',bySource.fallback?`${bySource.fallback} built-in (link value not recognised)`:''].filter(Boolean).join(', ')||'None yet';
  return `<div class="method-summary">${pill('Assigned exposures',total)}${pill('Designs',a.variants.length)}${pill('Assigned by',esc(sourceText))}${pill('Experiment ID',esc(a.experimentId||a.id))}</div>${bySource.fallback?'<p class="notice warning">Some study links carried a design ID that this study does not have, so those sessions were assigned at random instead. Check the variant IDs in your survey randomizer.</p>':''}
    <h4>Implementation outcomes by variant</h4><p class="analysis-subtitle">Exposure counts include incomplete tasks. Self-reports and instrumented signals are different measures. A missing success signal does not establish task failure.</p>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>Variant</th><th>Exposed</th><th>Submitted</th><th>Not submitted</th><th>Self-reported complete</th><th>Signal received / connected</th><th>Median task time</th><th>Median tracked clicks</th></tr></thead><tbody>${resultRows}</tbody></table></div>
    <h4>Allocation by variant</h4>${bars(barsRows,total,esc)}
    ${answerSummary}${clickSummary}
    <p class="analysis-subtitle">The first configured variant is the descriptive baseline. Allocation is equal probability but not fixed quotas. Time metrics use submitted tasks; click metrics use tracker-connected tasks. No significance testing, sample-size determination, confidence claims, or automatic winner selection is performed. Use pinned design revisions and comparable recruitment/device conditions.</p>`;
}
function surveyHTML(a,data,flat,esc){
  const responses=flat.answers.filter(x=>x.task_id===a.id&&x.stage==='activity');
  if(!responses.length)return '<p class="muted small">No survey answers yet.</p>';
  const items=(a.questions||[]).map(q=>{
    const r=responses.filter(x=>x.question_id===q.id);
    if(['text','textarea'].includes(q.type))return `<h4>${esc(q.text)}</h4><p class="analysis-subtitle">${r.length} submitted answer(s). Showing up to 8; export all responses for qualitative review.</p><div class="click-timeline">${r.filter(x=>x.response).slice(0,8).map(x=>`<div>${esc(x.response)}</div>`).join('')||'<p>No text entered.</p>'}</div>`;
    const choices=q.type==='scale5'?['1','2','3','4','5']:q.type==='scale7'?['1','2','3','4','5','6','7']:q.options||[];
    const counts=choices.map(c=>({label:c,n:r.filter(x=>Array.isArray(x.response)?x.response.includes(c):x.response===c).length}));
    return `<h4>${esc(q.text)}</h4><p class="analysis-subtitle">${r.length} respondent(s); multi-select totals may exceed the number of respondents.</p>${bars(counts,r.length,esc)}`;
  });
  return `<div class="method-summary">${pill('Survey completions',data.length)}</div>${items.join('')}`;
}
function prototypeHTML(a,data,flat,esc){
  const connected=data.filter(t=>t.tracker_connected),observed=connected.filter(t=>t.observed_success),self=data.filter(t=>t.self_report==='completed');
  return `<div class="method-summary">${pill('Attempts completed',data.length)}${pill('Tracker-connected',connected.length)}${pill('Observed signals',a.successSignal?`${observed.length}/${connected.length}`:'No signal configured')}${pill('Self-reported completion',self.length)}</div><p class="analysis-subtitle">No observed success signal is not necessarily evidence of failure. Open a session in Prototype interaction explorer to view click history.</p>`;
}
export function renderAnalyses(study,flat,esc){
  if(!study?.tasks)return '<p class="muted small">Load the corresponding study JSON to view method analyses.</p>';
  const output=study.tasks.map(a=>{
    const method=normalizeMethod(a),data=flat.tasks.filter(t=>t.task_id===a.id);
    if(!data.length&&method!=='ab_test')return `<section class="method-analysis"><h3>${esc(a.title||a.id)}</h3><p class="muted small">${esc(METHODS[method]?.label||method)} · No completed activity records yet.</p></section>`;
    let content='';
    if(method==='card_sort')content=cardsHTML(a,data,esc);
    if(method==='tree_test')content=treeHTML(a,data,esc);
    if(method==='first_click')content=clicksHTML(a,data,esc);
    if(method==='preference')content=preferenceHTML(a,data,esc);
    if(method==='survey')content=surveyHTML(a,data,flat,esc);
    if(method==='prototype')content=prototypeHTML(a,data,flat,esc);
    if(method==='ab_test')content=abHTML(a,data,flat,esc);
    return `<section class="method-analysis"><p class="eyebrow accent">${esc(METHODS[method]?.label||method)}</p><h3>${esc(a.title||a.id)}</h3>${content}</section>`;
  });
  return output.join('');
}
