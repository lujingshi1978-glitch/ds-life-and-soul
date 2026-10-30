import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CharacterCognition} from '../src/cognition/service.js';
import {reconcilePsycheProjectionBasis} from '../src/cognition/basis-sources.js';
import {buildTrace} from '../src/life-trace-view.js';

// Native SQLite component/integration scenarios. Model-shaped deltas are fixed
// fixtures; they are not evidence of an autonomous model decision or real QQ.
const home=path.resolve(import.meta.dirname,'../../../.local'),base=path.join(home,'test-data','chain-audit');fs.mkdirSync(base,{recursive:true});
const results=[],gates=Object.fromEntries(['authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready'].map(k=>[k,true]));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function scenario(name,fn){test(name,async t=>{try{const evidence=await fn(t);results.push({name,passed:true,evidence:evidence||{}});}catch(e){results.push({name,passed:false,error:e.code||e.message});throw e;}});}
after(()=>{const dir=path.join(home,'reports');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'chain-results.json'),JSON.stringify({at:new Date().toISOString(),passed:results.every(x=>x.passed),pass:results.filter(x=>x.passed).length,fail:results.filter(x=>!x.passed).length,modelCalls:0,productionOperations:0,controlledLocalReceiverOnly:true,checks:results},null,2));});
function fixture(t){
 const root=fs.mkdtempSync(path.join(base,'chain-')),characterId='character:chain-audit';let at=Date.parse('2026-10-30T03:00:00Z'),n=0,r;
 const open=()=>{r=new CharacterCognition({root,characterId,embedding:null,now:()=>at});r.model.think=()=>{throw Error('MODEL_FORBIDDEN');};r.enableInner();return r;};
 r=new CharacterCognition({root,characterId,embedding:null,now:()=>at});r.policy.seed({identity:{text:'隔离链路角色。\n## 核心愿望\n认识世界，形成有来源的理解，珍惜关系且尊重边界。',locked:true},personality_growth:{text:'尚未形成新的稳定倾向。',locked:false}});r.enableInner();r.model.think=()=>{throw Error('MODEL_FORBIDDEN');};r.store.ensureEntity('qq:101');
 const core=()=>r.policy.core().filter(x=>x.locked).map(x=>({field:x.field,revision:x.revision,body:x.body})),initialCore=hash(core());
 t.after(async()=>{assert.equal(hash(core()),initialCore,'locked core identity/value may not change');assert.equal(r.model.receipts.length,0);await r.close();const target=path.resolve(root);assert.ok(target.startsWith(base+path.sep)&&path.basename(target).startsWith('chain-'));fs.rmSync(target,{recursive:true,force:true});});
 const observe=(text,{externalId,metadata={}}={})=>{const id=externalId||'input-'+n++;return r.observe({adapter:'chain-native',externalId:id,kind:'chat',text,occurredAt:at,metadata:{scope:'private:101',speakerId:'qq:101',conversationPeerId:'qq:101',...metadata}},{kind:'experience-recorded',outcome:'observed',eventRoot:'chain:'+id});};
 const apply=(e,summary,{memoryIds=[],...patch}={})=>r.inner.apply({summary,changes:[],...patch},{expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],memoryIds,key:'apply-'+n++,decisionContext:{fresh:true,origin:'foreground',eventIds:[e.eventId]}});
 const latest=()=>r.store.db.prepare('SELECT * FROM v3_action_proposals ORDER BY rowid DESC LIMIT 1').get();
 const choose=(e,summary,{memoryIds=[],intent='看到新片段，想到你，于是分享。'}={})=>{apply(e,summary,{memoryIds,decision:{kind:'chat',personId:'qq:101',intent,meaning:summary,memoryIds}});const action=latest(),run=r.inner.beginAction(action,gates);assert.ok(run,'native claim required');r.inner.assertExecutable(run.executionId);return {action,run};};
 const deliver=run=>{const receiver=[];r.inner.effectStarting(run.executionId);r.inner.assertExecutable(run.executionId);const receipt={messageId:'local:'+run.executionId,status:'confirmed-local-receiver-recorded',transport:'controlled-local-receiver',text:run.intent,productionNetworkSend:false};receiver.push(receipt);r.inner.actionResult(run.executionId,{status:'succeeded',receipt});assert.equal(receiver.length,1);assert.equal(r.store.db.prepare('SELECT status FROM v3_action_executions WHERE execution_id=?').get(run.executionId).status,'succeeded');return receipt;};
 return {get r(){return r;},root,observe,apply,choose,latest,deliver,core,initialCore,advance:()=>at+=1000,reopen:async()=>{await r.close();return open();}};
}

function impression(f,{canary='最初印象-NATIVE-CHAIN'}={}){
 const e=f.observe('我喜欢你把故事留一点空白，'+canary);f.apply(e,'他愿意慢慢听，我先记下这次感受。',{dispositions:[{kind:'attitude',target:'qq:101',text:canary+'，这次愿意留白的问法让我放松。',facet:'留白的相处方式',reason:'来自这次实际输入',transition:'add',eventIds:[e.eventId],memoryIds:[]}]});
 const old=f.r.dispositions.rows({kind:'attitude',person:'qq:101'})[0];assert.ok(old);const second=f.observe('这幅画先不画完，等以后再一起添。');f.apply(second,'我记得他给我留白，这次更自在。',{memoryIds:[old.id]});
 return {e,old,projection:f.r.inner.psyche.current({includeInvalid:true})};
}

scenario('native impression evolution survives two actual close/open cycles and a new delivered action',async t=>{
 const f=fixture(t),{old}=impression(f);f.advance();const e=f.observe('现在也可以一起讨论，不必一直留白。');f.apply(e,'我能接受一起讨论，也保留最初那次安静的印象。',{memoryIds:[old.id],dispositions:[{kind:'attitude',target:'qq:101',text:'他既能留白也能一起讨论，我现在更放松。',facet:'留白的相处方式',reason:'新的实际交往使旧印象自然演化',transition:'continue',previousId:old.id,expectedRevision:old.revision,eventIds:[e.eventId],memoryIds:[]}]});
 assert.equal(f.r.store.get(old.id).status,'outdated');const before=f.r.inner.psyche.current({includeInvalid:true});assert.equal(before.status,'valid');
 await f.reopen();const once=f.r.inner.psyche.current({includeInvalid:true});assert.equal(once.status,'valid');assert.equal(once.revision,before.revision,'normal maturation must not create an invalid present projection');
 await f.reopen();const twice=f.r.inner.psyche.current({includeInvalid:true});assert.equal(twice.revision,before.revision);assert.equal(reconcilePsycheProjectionBasis(f.r).changedMemories,0);
 const fresh=f.observe('刚看到小店窗边半只橘子与猫，想到之前共创。'),{action,run}=f.choose(fresh,'这段新文字让我想到具体的朋友。');const receipt=f.deliver(run),db=f.r.store.db,ab=f.r.archive.db,counts=[db.prepare('SELECT total_changes() n').get().n,ab.prepare('SELECT total_changes() n').get().n];
 const graph=buildTrace(f.r,{type:'action',id:action.object_id,revision:action.revision,maxNodes:100,maxDepth:6});assert.ok(!graph.nodes.find(n=>n.key===graph.focus).unavailable);assert.ok(graph.nodes.some(n=>n.type==='execution'&&n.executionSucceeded));assert.ok(graph.nodes.some(n=>n.type==='outcome'));
 assert.deepEqual([db.prepare('SELECT total_changes() n').get().n,ab.prepare('SELECT total_changes() n').get().n],counts);return {oldStatus:'outdated',projectionBefore:before.revision,projectionAfterTwoOpens:twice.revision,executionId:run.executionId,receiptId:receipt.messageId,traceNodes:graph.nodes.length,readOnly:true};
});

scenario('reviewed current action and receipt stay visible with a real old correction gap in chronology',t=>{
 const f=fixture(t),{old}=impression(f,{canary:'旧心理缺口-CORRECTION-CANARY'}),before=f.r.inner.psyche.current();
 f.r.lifecycle.revise(old.id,old.revision,{gist:'旧问法并非愿意留白；原理解需要修正。'});const invalid=f.r.inner.psyche.current({includeInvalid:true});assert.equal(invalid.status,'needs-review');assert.ok(invalid.revision>before.revision);
 const e=f.observe('今天可以聊一段新的猫故事，和之前的印象无关。'),{action,run}=f.choose(e,'依据新的独立来信，我现在想分享猫故事。',{intent:'分享今天新看到的猫故事。'});assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'valid');f.deliver(run);
 const graph=buildTrace(f.r,{type:'action',id:action.object_id,revision:action.revision,maxNodes:100,maxDepth:6}),focus=graph.nodes.find(n=>n.key===graph.focus);assert.ok(!focus.unavailable,'pure chronology cannot invalidate reviewed independent present');assert.ok(graph.nodes.some(n=>n.type==='execution'&&n.executionSucceeded));assert.ok(graph.nodes.some(n=>n.unavailable),'historical invalid branch must remain a visible gap');assert.ok(!JSON.stringify(graph).includes('旧心理缺口-CORRECTION-CANARY'));
 return {oldProjection:invalid.revision,currentProjection:f.r.inner.psyche.current().revision,actionVisible:true,receiptVisible:true,gapRetained:true};
});

for(const mode of ['source-correction','erase','withdraw','suppression','memory-correction'])for(const started of [false,true])scenario(mode+' revokes '+(started?'started':'claimed')+' current dependency without allowing local send or trace leakage',t=>{
 const f=fixture(t),prior=f.observe('无关的开放时间是十点。'),independent=f.choose(prior,'我只根据独立来源告知开放时间。',{intent:'告诉朋友十点开门。'}),secret='PRIVATE-CURRENT-DEPENDENCY-'+mode;
 const e=f.observe('一条需要严格保护的当前资料 '+secret,{externalId:'protected-source'});f.r.store.addNodes([{id:'memory:current-secret',kind:'experience',gist:'当前资料 '+secret,evidence:[{sourceId:e.sourceId,revision:e.revision}],participants:[{entityId:'qq:101',role:'speaker'}],epistemic:'observed',metadata:{scope:'private:101'}}]);
 const {action,run}=f.choose(e,'这条当前资料影响了这次选择 '+secret,{memoryIds:['memory:current-secret'],intent:'当前行动 '+secret});if(started)f.r.inner.effectStarting(run.executionId);
 if(mode==='source-correction')f.observe('更正：上条资料已经不成立，请不要使用。',{externalId:'protected-source'});
 else if(mode==='erase')f.r.archive.erase(e.sourceId);
 else if(mode==='withdraw'){f.r.inner.invalidateMemories([],{redact:true,sourceIds:[e.sourceId],reason:'explicit-user-privacy-withdrawal'});f.r.archive.erase(e.sourceId);}
 else if(mode==='suppression')f.r.store.db.prepare('INSERT INTO suppression(character_id,target_type,target_id,reason_code,created_at) VALUES(?,?,?,?,?)').run(f.r.characterId,'source',e.sourceId,'privacy-policy',Date.now());
 else f.r.lifecycle.revise('memory:current-secret',1,{gist:'当前资料被明确纠正，旧解释不再成立。'});
 const receiver=[];assert.throws(()=>{f.r.inner.assertExecutable(run.executionId);receiver.push(secret);},/V3_ACTION_REVOKED/);assert.equal(receiver.length,0);
 const graph=buildTrace(f.r,{type:'action',id:action.object_id,revision:action.revision,maxNodes:100,maxDepth:6});assert.ok(!JSON.stringify(graph).includes(secret),'invalid current dependencies must not survive partial-tree policy');
 f.r.inner.assertExecutable(independent.run.executionId);const independentReceipt=f.deliver(independent.run);assert.equal(independentReceipt.text,'告诉朋友十点开门。');
 return {stage:started?'started':'claimed',mode,blocked:true,localSendsAfterRevocation:0,traceLeaksCanary:false,independentActionDelivered:true};
});
