import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {CharacterCognition} from '../src/cognition/service.js';import {buildTrace} from '../src/life-trace-view.js';
const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
const gates=Object.fromEntries(['authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready'].map(k=>[k,true]));
function fixture(t){
 const root=fs.mkdtempSync(path.join(base,'partial-trace-')),at=Date.parse('2026-10-30T03:00:00Z'),r=new CharacterCognition({root,characterId:'character:partial-trace',now:()=>at,embedding:null});
 t.after(async()=>{await r.close();const target=path.resolve(root);assert.ok(target.startsWith(base+path.sep)&&path.basename(target).startsWith('partial-trace-'));fs.rmSync(target,{recursive:true,force:true});});
 r.policy.seed({identity:{text:'隔离测试角色\n## 核心愿望\n认识世界，珍惜真实关系。'}});r.enableInner();r.store.ensureEntity('qq:101');r.model.think=()=>{throw Error('MODEL_FORBIDDEN');};let n=0;
 function apply(text,intent){const e=r.observe({adapter:'partial-trace-fixture',externalId:'event-'+n++,kind:'chat',text,occurredAt:at,metadata:{scope:'private:101',speakerId:'qq:101',conversationPeerId:'qq:101'}},{kind:'experience-recorded',outcome:'observed',eventRoot:'fixture-'+n});
  r.inner.apply({summary:text,changes:[],...(intent?{decision:{kind:'chat',personId:'qq:101',intent}}:{})},{expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],key:'apply-'+n,decisionContext:{fresh:true,origin:'foreground',eventIds:[e.eventId]}});return e;}
 const canary='PAST_PRIVATE_PROJECTION_CANARY',old=apply('旧时的理解 '+canary),oldState=r.inner.head();
 r.inner.invalidateMemories([],{sourceIds:[old.sourceId],reason:'fixture-normal-review-needed'});
 const gapState=r.inner.head(),gapProjection=r.inner.psyche.current({includeInvalid:true});assert.equal(gapProjection.status,'needs-review');
 const fresh=apply('当前新输入：窗边有一小盆薄荷，我想到一位朋友。','分享刚看到的小盆薄荷。'),currentState=r.inner.head();
 assert.equal(r.inner.psyche.current({includeInvalid:true}).status,'valid');
 const action=r.store.db.prepare('SELECT * FROM v3_action_proposals ORDER BY rowid DESC LIMIT 1').get(),run=r.inner.beginAction(action,gates);assert.ok(run);r.inner.assertExecutable(run.executionId);
 const received=[];r.inner.effectStarting(run.executionId);r.inner.assertExecutable(run.executionId);received.push({text:run.intent,status:'controlled-receiver-confirmed',transport:'controlled-local-receiver',productionNetworkSend:false});r.inner.actionResult(run.executionId,{status:'succeeded',receipt:received[0]});
 return {r,old,oldState,gapState,gapProjection,fresh,currentState,action,run,received,canary};
}
const graph=(r,q)=>buildTrace(r,{maxNodes:100,maxDepth:6,...q});
test('native new reflection and controlled delivery remain visible across an unrelated historical review gap',t=>{
 const {r,action,run,gapState,currentState,received,canary}=fixture(t),before=r.store.db.prepare('SELECT total_changes() n').get().n,archiveBefore=r.archive.db.prepare('SELECT total_changes() n').get().n,g=graph(r,{type:'action',id:action.object_id});
 assert.equal(received.length,1);assert.ok(!g.nodes[0].unavailable);assert.ok(g.nodes.some(n=>n.type==='execution'&&n.id===run.executionId&&n.executionSucceeded));
 assert.ok(g.nodes.some(n=>n.type==='inner'&&n.id===currentState.state_id&&!n.unavailable));const gap=g.nodes.find(n=>n.id===gapState.state_id);assert.ok(gap?.unavailable);assert.equal(gap.gap.kind,'review-required');assert.equal(g.partial,true);assert.ok(g.gapKinds['review-required']>=1);assert.ok(!JSON.stringify(g).includes(canary));
 assert.ok(g.edges.some(e=>e.relation==='continues'));assert.ok(g.edges.some(e=>e.provenance==='pinned-psychology-projection'));assert.equal(r.store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(r.archive.db.prepare('SELECT total_changes() n').get().n,archiveBefore);
});
test('direct expansion of the withheld historical state or mood never revives its prose',t=>{
 const {r,gapState,gapProjection,oldState,canary}=fixture(t);
 for(const q of [{type:'inner',id:gapState.state_id,revision:gapState.state_revision},{type:'mood',id:'current',revision:gapProjection.revision},{type:'inner',id:oldState.state_id,revision:oldState.state_revision}]){const g=graph(r,q);assert.ok(g.nodes[0].unavailable);assert.ok(!JSON.stringify(g).includes(canary));}
});
test('a current true psychology dependency on the old private source still blocks action and receipt after deletion',t=>{
 const {r,old,action,run,canary}=fixture(t),db=r.store.db,rev=r.inner.psyche.current().revision;
 db.prepare('INSERT OR IGNORE INTO v3_psyche_projection_dependencies VALUES(?,?,?,?,?)').run(rev,'source',old.sourceId,old.revision,'{}');
 r.archive.db.prepare("UPDATE documents SET status='deleted' WHERE source_id=? AND revision=?").run(old.sourceId,old.revision);
 for(const q of [{type:'action',id:action.object_id},{type:'execution',id:run.executionId}]){const g=graph(r,q);assert.ok(g.nodes[0].unavailable);assert.ok(!JSON.stringify(g).includes('小盆薄荷'));assert.ok(!JSON.stringify(g).includes(canary));}
});
for(const restriction of ['suppression','diagnostic','learning-excluded'])test('current indirect '+restriction+' cannot be bypassed through a temporal edge',t=>{
 const {r,old,action}=fixture(t),db=r.store.db,rev=r.inner.psyche.current().revision;
 db.prepare('INSERT OR IGNORE INTO v3_psyche_projection_dependencies VALUES(?,?,?,?,?)').run(rev,'source',old.sourceId,old.revision,'{}');
 if(restriction==='suppression')db.prepare('INSERT INTO suppression VALUES(?,?,?,?,?)').run(r.characterId,'source',old.sourceId,'fixture',Date.now());
 if(restriction==='diagnostic')r.archive.db.prepare("UPDATE documents SET metadata=json_set(metadata,'$.diagnostic',1) WHERE source_id=?").run(old.sourceId);
 if(restriction==='learning-excluded')r.archive.db.prepare("UPDATE documents SET metadata=json_set(metadata,'$.learningExcluded',1) WHERE source_id=?").run(old.sourceId);
 assert.ok(graph(r,{type:'action',id:action.object_id}).nodes[0].unavailable);
});
test('a genuine derived_from old state is mandatory even when the same endpoint is also chronological',t=>{
 const {r,action,currentState,gapState}=fixture(t),db=r.store.db;
 db.prepare('INSERT INTO v3_inner_dependencies(character_id,child_id,child_revision,dependency_id,parent_inner_id,parent_inner_revision,relation,confidence,valid_from) VALUES(?,?,?,?,?,?,?,?,?)').run(r.characterId,currentState.state_id,currentState.state_revision,randomUUID(),gapState.state_id,gapState.state_revision,'derived_from',1,r.now());
 assert.ok(graph(r,{type:'action',id:action.object_id}).nodes[0].unavailable);
});
test('evidence cycles fail closed and are distinguished from absent records',t=>{
 const {r,action,currentState}=fixture(t),db=r.store.db;
 const wish=r.inner.object('inner:life-direction'),insert=db.prepare('INSERT INTO v3_inner_dependencies(character_id,child_id,child_revision,dependency_id,parent_inner_id,parent_inner_revision,relation,confidence,valid_from) VALUES(?,?,?,?,?,?,?,?,?)');insert.run(r.characterId,currentState.state_id,currentState.state_revision,randomUUID(),wish.object_id,wish.current_revision,'derived_from',1,r.now());insert.run(r.characterId,wish.object_id,wish.current_revision,randomUUID(),currentState.state_id,currentState.state_revision,'derived_from',1,r.now());
 const g=graph(r,{type:'action',id:action.object_id});assert.ok(g.nodes[0].unavailable);assert.equal(g.nodes[0].gap.kind,'dependency-cycle');const missing=graph(r,{type:'inner',id:'inner:not-recorded'});assert.equal(missing.nodes[0].gap.kind,'missing-record');assert.equal(missing.nodes[0].status,'unknown');
});
test('oversized evidence closure remains withheld independently of the visual node/depth budget',t=>{
 const {r,action,currentState,fresh}=fixture(t),db=r.store.db;
 const insert=db.prepare('INSERT INTO v3_inner_dependencies(character_id,child_id,child_revision,dependency_id,parent_source_id,parent_source_revision,relation,confidence,valid_from) VALUES(?,?,?,?,?,?,?,?,?)');
 for(let n=0;n<129;n++)insert.run(r.characterId,currentState.state_id,currentState.state_revision,randomUUID(),fresh.sourceId,fresh.revision,'derived_from',1,r.now());
 const g=buildTrace(r,{type:'action',id:action.object_id,maxNodes:8,maxDepth:1});assert.ok(g.nodes[0].unavailable);assert.equal(g.nodes[0].gap.kind,'verification-limit');assert.ok(g.nodes.length<=8);assert.ok(!JSON.stringify(g).includes('分享刚看到'));
});
