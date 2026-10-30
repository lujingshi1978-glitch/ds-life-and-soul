import test from 'node:test';import assert from 'node:assert/strict';
import {planRecallBudget,finishRecallBudget} from '../src/cognition/recall-budget.js';
import {defaultRuntimeTuning,normalizeRuntimeTuning,runtimeTuningView} from '../src/runtime-tuning.js';

test('budget grows only to qualified complete evidence demand and records actual use',()=>{
 const p=planRecallBudget({baseChars:2200,requestedChars:2200,maxExpansionRatio:3,callerCeilingChars:6000,contextAllowanceChars:5000,bundles:[{id:'current',chars:1800,relevance:1},{id:'related-via-semantic-graph',chars:1500,relevance:.6},{id:'unrelated',chars:9000,relevance:0}],overheadChars:100});
 assert.equal(p.demand,3400);assert.equal(p.effective,3400);assert.equal(p.ceiling,5000);assert.equal(p.expanded,true);assert.deepEqual(p.selectedIds,['current','related-via-semantic-graph']);assert.equal(p.contextAllowanceKnown,true);assert.equal(p.tokenAllowanceKnown,false);
 assert.equal(finishRecallBudget(p,{actualChars:3200}).unused,200);
});
test('greeting or weak unrelated pool does not cause expansion or filling',()=>{
 const p=planRecallBudget({baseChars:2200,bundles:[{id:'old-topic',chars:5000,relevance:0}]});assert.equal(p.effective,2200);assert.equal(p.expanded,false);assert.equal(p.demand,0);assert.deepEqual(p.selectedIds,[]);assert.ok(p.reasons.includes('no-qualified-expansion-demand'));
 assert.equal(finishRecallBudget(p,{actualChars:0}).actual,0);
});
test('soft requested value is visible and may exceed configured base, while fixed preserves min',()=>{
 const elastic=planRecallBudget({baseChars:2200,requestedChars:3000,demandChars:4500,callerCeilingChars:6000}),fixed=planRecallBudget({baseChars:2200,requestedChars:3000,demandChars:4500,elastic:false});
 assert.equal(elastic.requested,3000);assert.equal(elastic.base,2200);assert.equal(elastic.effective,4500);assert.equal(fixed.effective,2200);assert.equal(fixed.requested,3000);assert.ok(fixed.reasons.includes('fixed-policy'));
});
test('explicit caller or context envelopes remain authoritative and zero room is valid',()=>{
 const p=planRecallBudget({baseChars:2200,requestedChars:3000,demandChars:5000,callerCeilingChars:2600,contextAllowanceChars:2400});assert.equal(p.effective,2400);assert.ok(p.reasons.includes('host-context-envelope'));assert.ok(p.reasons.includes('explicit-caller-ceiling'));
 assert.equal(planRecallBudget({baseChars:2200,demandChars:5000,contextAllowanceChars:0}).effective,0);
});
test('whole bundles are estimated together and never partly declared selected',()=>{
 const p=planRecallBudget({baseChars:1000,callerCeilingChars:2200,bundles:[{id:'claim-with-counterevidence',chars:2400,relevance:1},{id:'other-complete-bundle',chars:600,relevance:.5}]});assert.equal(p.effective,2200);assert.deepEqual(p.selectedIds,['other-complete-bundle']);assert.deepEqual(p.omitted.map(x=>x.id),['claim-with-counterevidence']);
});
test('unknown context/token allowance stays explicit and full budget is not an instruction to speak',()=>{
 const p=planRecallBudget({baseChars:2200,demandChars:3000});assert.equal(p.contextAllowanceKnown,false);assert.equal(p.tokenAllowanceKnown,false);assert.equal(p.actual,null);assert.equal(p.unit,'serialized-js-characters-not-model-tokens');
});
test('malformed budget and underestimated usage fail instead of silently overrunning',()=>{
 for(const input of [{baseChars:NaN},{baseChars:2200,demandChars:-1},{baseChars:2200,maxExpansionRatio:Infinity},{baseChars:2200,callerCeilingChars:2.5},{baseChars:2200,bundles:[{id:'x',chars:1,relevance:1},{id:'x',chars:1,relevance:1}]}])assert.throws(()=>planRecallBudget(input),{code:'RECALL_BUDGET_INVALID'});
 assert.throws(()=>finishRecallBudget(planRecallBudget({baseChars:100}),{actualChars:101}),{code:'RECALL_BUDGET_INVALID'});
});
test('administrator knobs round-trip in the existing automatic runtime settings schema',()=>{
 const d=defaultRuntimeTuning();assert.equal(d.memory.elasticRecallEnabled,1);assert.equal(d.memory.elasticRecallMaxRatio,3);assert.equal(normalizeRuntimeTuning({memory:{elasticRecallEnabled:0,elasticRecallMaxRatio:2.5}}).memory.elasticRecallMaxRatio,2.5);assert.equal(runtimeTuningView(d).fields.filter(x=>x.path.startsWith('memory.elasticRecall')).length,2);assert.throws(()=>normalizeRuntimeTuning({memory:{elasticRecallEnabled:2}}));
});
