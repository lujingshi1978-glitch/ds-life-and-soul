import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// Baseline mode imports original source read-only; every runtime/database still
// lives exclusively in this script's owned isolated test-data directory.
const fixtureSource=process.env.TRACE_REVOCATION_BASELINE_SOURCE?pathToFileURL(path.resolve(process.env.TRACE_REVOCATION_BASELINE_SOURCE)):new URL('../src/cognition/service.js',import.meta.url);
const {CharacterCognition}=await import(fixtureSource);

const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
const gates=Object.fromEntries(['authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready'].map(k=>[k,true]));
function longFixture(t){
  const root=fs.mkdtempSync(path.join(base,'trace-revocation-')),at=Date.parse('2026-10-30T03:00:00Z'),r=new CharacterCognition({root,characterId:'character:revocation-fixture',now:()=>at,embedding:null});
  t.after(async()=>{await r.close();const resolved=path.resolve(root);assert.ok(resolved.startsWith(base+path.sep)&&path.basename(resolved).startsWith('trace-revocation-'));fs.rmSync(resolved,{recursive:true,force:true});});
  r.policy.seed({identity:{text:'隔离测试角色\n## 核心愿望\n认识世界，保留真实的关系。'}});r.enableInner();r.store.ensureEntity('qq:101');r.model.think=()=>{throw Error('MODEL_FORBIDDEN');};
  let sequence=0;
  function apply(summary,{intent,inputText=summary}={}){
    const i=sequence++,e=r.observe({adapter:'fixture-revocation',externalId:'source-'+i,kind:'chat',text:inputText,occurredAt:at,metadata:{scope:'private:101'}},{kind:'experience-recorded',outcome:'observed',eventRoot:'event-'+i});
    r.inner.apply({summary,changes:[],...(intent?{decision:{kind:'chat',personId:'qq:101',intent,meaning:summary}}:{})},
      {expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],key:'generation-'+i,decisionContext:{fresh:true,origin:'foreground',eventIds:[e.eventId]}});
    return e;
  }
  const latest=()=>r.store.db.prepare('SELECT * FROM v3_action_proposals ORDER BY rowid DESC LIMIT 1').get();
  const independentSource=apply('独立事项：已经确认今天开门。',{intent:'告诉朋友今天开门。'});
  const independentAction=latest(),independentRun=r.inner.beginAction(independentAction,gates);assert.ok(independentRun);r.inner.assertExecutable(independentRun.executionId);
  const canary='撤销金丝雀-CLAIMED-40-GEN',first=apply('最早的私密资料 '+canary);
  for(let i=0;i<40;i++)apply('普通日常 '+i+'，仍记着 '+canary,{inputText:'今天普通日常 '+i,...(i===39?{intent:'和朋友说说 '+canary}:{})});
  const action=latest(),run=r.inner.beginAction(action,gates);assert.ok(run);r.inner.assertExecutable(run.executionId);
  return {r,first,canary,action,run,independentAction,independentRun,independentSource,apply,latest};
}
test('normal 40-generation choice can still execute through the host with a controlled receiver',t=>{
  const {r,run,canary}=longFixture(t),received=[];
  r.inner.effectStarting(run.executionId);r.inner.assertExecutable(run.executionId);received.push(run.intent);
  r.inner.actionResult(run.executionId,{status:'succeeded',receipt:{transport:'controlled-local-receiver',productionNetworkSend:false,text:run.intent}});
  assert.equal(received.length,1);assert.ok(received[0].includes(canary));assert.equal(r.store.db.prepare('SELECT status FROM v3_action_executions WHERE execution_id=?').get(run.executionId).status,'succeeded');
});
for(const started of [false,true])test('source withdrawal revokes '+(started?'started':'claimed')+' old-psychology action while preserving an independent in-flight choice',t=>{
  const {r,first,action,run,independentRun,independentSource,canary}=longFixture(t),received=[];
  const commit=r.store.db.prepare('SELECT commit_id FROM v3_inner_commits ORDER BY rowid DESC LIMIT 1').get().commit_id;
  const spoof=r.inner.writeObject('concern',{title:'独立的开放时间',meaning:'只依赖独立告知',psychologyProjection:{revision:r.inner.psyche.current().revision}},commit,
    {evidence:[{sourceId:independentSource.sourceId,sourceRevision:independentSource.revision}]});
  if(started)r.inner.effectStarting(run.executionId);
  const signal=r.inner.executionSignal(run.executionId);
  r.inner.invalidateMemories([],{redact:true,sourceIds:[first.sourceId],reason:'fixture-user-source-withdrawal'});r.archive.erase(first.sourceId);
  assert.equal(r.inner.beginAction(action,gates),null,'old proposal cannot be newly claimed');
  assert.throws(()=>{r.inner.assertExecutable(run.executionId);received.push(run.intent);},/V3_ACTION_REVOKED/,'existing claim must not cross the outbound boundary');
  assert.equal(received.length,0);assert.equal(signal.aborted,true);
  const execution=r.store.db.prepare('SELECT status FROM v3_action_executions WHERE execution_id=?').get(run.executionId);assert.equal(execution.status,started?'unknown':'cancelled');
  const proposal=r.store.db.prepare('SELECT status,bounded_intent FROM v3_action_proposals WHERE object_id=?').get(action.object_id);assert.equal(proposal.status,'cancelled');assert.equal(proposal.bounded_intent,'');
  assert.ok(r.store.db.prepare('SELECT 1 FROM v3_inner_invalidations WHERE object_id=? AND revision=?').get(action.object_id,action.revision),'existing versioned invalidation table records the exact affected action');
  assert.ok(!JSON.stringify(r.inner.snapshot()).includes(canary),'ordinary mind snapshot must not expose the withdrawn last-choice copy');
  assert.equal(r.inner.object(spoof.id).status,'active','a model-supplied similarly named field is not a host state binding');
  r.inner.assertExecutable(independentRun.executionId);r.inner.effectStarting(independentRun.executionId);received.push(independentRun.intent);
  assert.deepEqual(received,['告诉朋友今天开门。'],'a disjoint action remains executable');
});
test('withdrawal also removes a completed affected choice from ordinary snapshot summaries',t=>{
  const {r,first,run,canary,independentRun}=longFixture(t);
  r.inner.effectStarting(run.executionId);r.inner.actionResult(run.executionId,{status:'succeeded',receipt:{transport:'controlled-local-receiver',productionNetworkSend:false,text:run.intent}});
  r.inner.effectStarting(independentRun.executionId);r.inner.actionResult(independentRun.executionId,{status:'succeeded',receipt:{text:'独立回执-NORMAL',deep:{independent:'保留真实回执'}}});
  const affectedSource=r.archive.db.prepare("SELECT source_id,revision FROM documents WHERE json_extract(metadata,'$.executionId')=?").get(run.executionId);
  const independentBefore=r.store.db.prepare('SELECT outcome_kind,observed_at FROM v3_experience_outcomes WHERE execution_id=?').get(independentRun.executionId);
  r.inner.invalidateMemories([],{redact:true,sourceIds:[first.sourceId],reason:'fixture-user-source-withdrawal'});r.archive.erase(first.sourceId);
  assert.ok(!JSON.stringify(r.inner.snapshot()).includes(canary));assert.ok(!JSON.stringify(r.inner.status()).includes(canary));
  assert.equal(r.archive.search({query:canary}).items.length,0,'completed-action derived source must not reintroduce withdrawn text through archive recall');
  assert.throws(()=>r.archive.read(affectedSource.source_id,affectedSource.revision),/SOURCE_UNAVAILABLE/);
  assert.deepEqual(r.materials({payload:{parts:[{sourceId:affectedSource.source_id,revision:affectedSource.revision,offset:0,length:999}]}}),[],'normal native learning input excludes the withdrawn source');
  const affected=r.store.db.prepare('SELECT outcome_kind,observed_at,observation_summary FROM v3_experience_outcomes WHERE execution_id=?').get(run.executionId);assert.equal(affected.outcome_kind,'delivered');assert.ok(affected.observed_at);assert.ok(!affected.observation_summary.includes(canary));
  assert.equal(r.archive.search({query:'独立回执-NORMAL',mode:'literal'}).items.length,1);assert.deepEqual(r.store.db.prepare('SELECT outcome_kind,observed_at FROM v3_experience_outcomes WHERE execution_id=?').get(independentRun.executionId),independentBefore);
  assert.ok(r.store.db.prepare('SELECT receipt_json FROM v3_action_executions WHERE execution_id=?').get(independentRun.executionId).receipt_json.includes('保留真实回执'));
  assert.equal(r.inner.actionResult(run.executionId,{status:'succeeded',receipt:{text:canary,nested:{privateCopy:canary}}}),null,'duplicate success does not revive a withdrawn source');
  assert.equal(r.archive.search({query:canary}).items.length,0);
});
for(const started of [false,true])test('late receipts after '+(started?'started':'claimed')+' withdrawal preserve only the allowed effect fact, never old nested prose',t=>{
  const {r,first,run,canary}=longFixture(t);if(started)r.inner.effectStarting(run.executionId);
  r.inner.invalidateMemories([],{redact:true,sourceIds:[first.sourceId],reason:'fixture-user-source-withdrawal'});r.archive.erase(first.sourceId);
  const receipt={status:'late-controlled-confirmation',text:canary,nested:{privateCopy:canary,more:[{secret:canary}]}};
  assert.equal(r.inner.actionResult(run.executionId,{status:'unknown',receipt}),null,'uncertain late payload cannot revive or upgrade a cancelled claim');
  const result=r.inner.actionResult(run.executionId,{status:'succeeded',receipt});
  const stored=r.store.db.prepare('SELECT status,receipt_json,external_receipt FROM v3_action_executions WHERE execution_id=?').get(run.executionId);
  if(started){assert.ok(result);assert.equal(stored.status,'succeeded');assert.ok(JSON.parse(stored.receipt_json).receipt.redacted);assert.ok(stored.external_receipt);assert.equal(r.store.db.prepare('SELECT outcome_kind FROM v3_experience_outcomes WHERE execution_id=?').get(run.executionId).outcome_kind,'delivered');}
  else{assert.equal(result,null);assert.equal(stored.status,'cancelled');}
  assert.ok(!stored.receipt_json.includes(canary));assert.equal(r.archive.search({query:canary}).items.length,0);assert.ok(!JSON.stringify(r.inner.snapshot()).includes(canary));
});
