import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';
import {mergeRuntimeTuning} from '../src/runtime-tuning.js';

const receipt={disposed:true,transcriptPersisted:false};
const quiet={summary:'暂时没有想做的事，安静待一会儿。',changes:[]};
const raw={people:[{personId:'qq:1',label:'隔离朋友',basis:'最近讨论过海洋'}],browse:[{platform:'web',modes:['search'],basis:'可读取公开资料'}]};
function fixture(t,{coreText='# 隔离角色\n\n## 核心愿望\n认识世界和珍惜关系。',text={}}={}){
 const parent=process.env.FEIYU_AGENCY_TEST_DIR||os.tmpdir();fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'agency-recovery-'));let now=Date.parse('2026-10-27T03:00:00Z'),settings=mergeRuntimeTuning({}, {text});
 const r=new CharacterCognition({root,characterId:'character:agency-recovery',embedding:null,now:()=>now,runtimeTuning:()=>settings});
 r.policy.seed({identity:{text:coreText,locked:true}});r.enableInner();r.store.ensureEntity('qq:1');r.getAutonomyOpportunities=()=>raw;
 t.after(async()=>{await r.close();if(!process.env.FEIYU_AGENCY_TEST_DIR){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('agency-recovery-'));fs.rmSync(root,{recursive:true,force:true});}});
 return {r,root,advance:ms=>now+=ms,setTuning:patch=>settings=mergeRuntimeTuning(settings,patch)};
}
const wakes=r=>r.store.db.prepare("SELECT event_id FROM cognitive_events WHERE kind='idle-reconsidered' ORDER BY rowid").all().map(row=>row.event_id);
const attempt=r=>r.inner.meta('agencyAttemptV2');

test('a failed model call retries after thirty seconds using one wake and a fresh snapshot',async t=>{
 const f=fixture(t),{r}=f,start=r.now(),inputs=[];let calls=0;
 r.model.think=async input=>{calls++;inputs.push(structuredClone(input.material));if(calls===1)throw Object.assign(Error('MODEL_DEADLINE'),{code:'MODEL_DEADLINE'});return {data:quiet,receipt};};
 await assert.rejects(r.inner.considerIdle(),{code:'MODEL_DEADLINE'});
 const failed=attempt(r),eventId=wakes(r)[0];assert.equal(calls,1);assert.equal(failed.lastAttemptAt,start);assert.equal(failed.lastSuccessfulConsiderationAt,undefined);assert.equal(failed.retryAfter,start+30000);assert.equal(failed.pendingWake.eventId,eventId);
 r.policy.updateState({arousal:0.7});f.advance(29999);
 assert.equal((await r.inner.considerIdle()).reason,'retry-backoff');assert.equal(calls,1);assert.deepEqual(wakes(r),[eventId]);
 f.advance(1);const result=await r.inner.considerIdle();
 assert.equal(result.status,'applied');assert.equal(calls,2);assert.deepEqual(wakes(r),[eventId]);
 assert.equal(inputs[0].newEvents[0].id,inputs[1].newEvents[0].id);assert.equal(inputs[0].before.physical.arousal,0.5);assert.equal(inputs[1].before.physical.arousal,0.7);
 assert.equal(inputs[1].before.time.at,start+30000);assert.equal(attempt(r).lastSuccessfulConsiderationAt,start+30000);assert.equal(attempt(r).pendingWake,null);assert.equal(attempt(r).status,'considered-no-action');
});

test('repeated model failure uses bounded short retry intervals and never creates extra wakes',async t=>{
 const f=fixture(t),{r}=f;let calls=0;r.model.think=async()=>{calls++;throw Object.assign(Error('MODEL_UNAVAILABLE'),{code:'MODEL_UNAVAILABLE'});};
 for(const delay of [30000,60000,120000,120000]){
  const at=r.now();await assert.rejects(r.inner.considerIdle(),{code:'MODEL_UNAVAILABLE'});assert.equal(attempt(r).retryAfter,at+delay);assert.equal(attempt(r).lastSuccessfulConsiderationAt,undefined);assert.equal(wakes(r).length,1);f.advance(delay);
 }
 assert.equal(calls,4);assert.equal(attempt(r).failureCount,4);
});

test('a mandatory-input budget block survives polling and recovers when the text cap changes',async t=>{
 const f=fixture(t,{coreText:'# 隔离角色\n\n## 核心愿望\n'+('必须完整保留的合成角色核心。'.repeat(380)),text:{thoughtInputChars:2000}}),{r}=f,start=r.now();let calls=0;
 r.model.think=async()=>{calls++;return {data:quiet,receipt};};
 await assert.rejects(r.inner.considerIdle(),error=>{assert.equal(error.code,'THOUGHT_INPUT_MINIMUM_TOO_LARGE');assert.ok(error.details.minimumChars>error.details.maxChars);return true;});
 const blocked=structuredClone(attempt(r)),diagnostic=structuredClone(r.inner.meta('agencyWakeV1'));assert.equal(calls,0);assert.equal(blocked.status,'blocked');assert.equal(blocked.failureType,'minimum-budget');assert.equal(blocked.reason,'THOUGHT_INPUT_MINIMUM_TOO_LARGE');assert.equal(blocked.lastSuccessfulConsiderationAt,undefined);
 for(const delay of [1000,1800000]){
  f.advance(delay);const result=await r.inner.considerIdle();assert.equal(result.reason,'input-budget-blocked');assert.equal(calls,0);assert.deepEqual(attempt(r),blocked);
  const visible=r.inner.meta('agencyWakeV1');assert.equal(visible.status,diagnostic.status);assert.equal(visible.reason,diagnostic.reason);assert.deepEqual(visible.lastFailure,diagnostic.lastFailure);assert.equal(visible.at,start);
 }
 f.setTuning({text:{thoughtInputChars:48000}});assert.equal((await r.inner.considerIdle()).status,'applied');
 assert.equal(calls,1);assert.equal(attempt(r).status,'considered-no-action');assert.equal(attempt(r).lastSuccessfulConsiderationAt,r.now());assert.notEqual(attempt(r).attemptKey,blocked.attemptKey);
});

test('a delayed choice returns and records its actual action at completion time',async t=>{
 const f=fixture(t),{r}=f,start=r.now();
 r.model.think=async()=>{await Promise.resolve();f.advance(45000);return {data:{summary:'愿意先休息片刻。',changes:[],decision:{kind:'rest',intent:'安静休息五分钟',durationMinutes:5}},receipt};};
 const result=await r.inner.considerIdle(),choice=r.inner.meta('agencyChoiceV1'),state=attempt(r),pending=r.inner.pendingAgencyAction();
 assert.equal(result.status,'applied');assert.ok(result.actionId);assert.equal(result.actionKind,'rest');assert.equal(result.decisionStatus,'rest-chosen');
 assert.equal(choice.actionId,result.actionId);assert.equal(choice.at,start+45000);assert.equal(state.actionId,result.actionId);assert.equal(state.status,'rest-chosen');assert.equal(state.lastAttemptAt,start);assert.equal(state.lastSuccessfulConsiderationAt,start+45000);assert.equal(pending.object_id,result.actionId);
 assert.equal((await r.inner.considerIdle()).status,'action-pending');
});

test('foreground preemption cancels the attempt and keeps priority when its short retry becomes ready',async t=>{
 const f=fixture(t),{r}=f,start=r.now(),controller=new AbortController();let calls=0;
 r.model.think=async()=>{calls++;if(calls===1){f.advance(5000);r.inner.meta('lastForegroundAt',r.now());controller.abort(Error('FOREGROUND_PREEMPTION'));}return {data:quiet,receipt};};
 const generation=r.inner.head().generation;
 await assert.rejects(r.inner.considerIdle({signal:controller.signal}),/FOREGROUND_PREEMPTION/);
 assert.equal(r.inner.head().generation,generation);assert.equal(attempt(r).failureType,'cancelled');assert.equal(attempt(r).retryAfter,start+20000);assert.equal(attempt(r).lastSuccessfulConsiderationAt,undefined);
 f.advance(15000);assert.equal((await r.inner.considerIdle()).status,'recent-foreground');assert.equal(calls,1);
 f.advance(104999);assert.equal((await r.inner.considerIdle()).status,'recent-foreground');assert.equal(calls,1);
 f.advance(1);assert.equal((await r.inner.considerIdle()).status,'applied');assert.equal(calls,2);assert.equal(attempt(r).lastSuccessfulConsiderationAt,start+125000);
});

test('a successful quiet consideration retains the normal thirty minute unchanged cooldown',async t=>{
 const f=fixture(t),{r}=f,start=r.now();let calls=0;r.model.think=async()=>{calls++;return {data:quiet,receipt};};
 assert.equal((await r.inner.considerIdle()).status,'applied');const successful=structuredClone(attempt(r));
 f.advance(1799999);assert.equal((await r.inner.considerIdle()).reason,'unchanged-opportunity-cooldown');assert.equal(calls,1);assert.deepEqual(attempt(r),successful);
 f.advance(1);assert.equal((await r.inner.considerIdle()).status,'applied');assert.equal(calls,2);assert.equal(attempt(r).lastSuccessfulConsiderationAt,start+1800000);
});

test('a changed concrete opportunity keeps the normal five minute successful cooldown',async t=>{
 const f=fixture(t),{r}=f,start=r.now();let calls=0;r.model.think=async()=>{calls++;return {data:quiet,receipt};};
 await r.inner.considerIdle();r.getAutonomyOpportunities=()=>({...raw,topics:['想了解海底火山']});f.advance(299999);
 assert.equal((await r.inner.considerIdle()).reason,'opportunity-change-cooldown');assert.equal(calls,1);
 f.advance(1);assert.equal((await r.inner.considerIdle()).status,'applied');assert.equal(calls,2);assert.equal(attempt(r).lastSuccessfulConsiderationAt,start+300000);
});

test('a changed source omitted from model presentation still invalidates the complete host read set',async t=>{
 const f=fixture(t,{text:{thoughtInputChars:12000}}),{r}=f;
 const source={adapter:'agency-recovery-basis',externalId:'optional',kind:'post',text:'合成公开背景，尚未更正。',metadata:{speakerId:r.characterId,scope:'self',explicitObservation:true}};
 const original=r.observe(source,{kind:'perception-observed'}),snapshot=r.inner.snapshot.bind(r.inner);let calls=0;
 // Host-owned optional context is intentionally too large to present as one
 // complete unit. Its exact source remains part of the captured full read set.
 r.inner.snapshot=(...args)=>({...snapshot(...args),relationship:[{sourceId:original.sourceId,revision:original.revision,text:'可省略的合成背景资料。'.repeat(3000),referenceOnly:true,scope:'self'}]});
 r.model.think=async input=>{
  calls++;assert.ok(input.material.reflectionInputCoverage.partial);assert.deepEqual(input.material.before.relationship,[]);assert.ok(input.material.reflectionInputCoverage.groups.some(group=>group.path==='before.relationship'&&group.omitted===1));
  r.observe({...source,text:'真实更正后的合成公开背景。'},{kind:'perception-observed'});return {data:quiet,receipt};
 };
 const generation=r.inner.head().generation;
 await assert.rejects(r.inner.considerIdle(),{code:'COGNITION_READSET_STALE'});
 assert.equal(calls,1);assert.equal(r.inner.head().generation,generation);assert.equal(attempt(r).reason,'COGNITION_READSET_STALE');assert.equal(attempt(r).lastSuccessfulConsiderationAt,undefined);
 assert.equal(r.store.db.prepare('SELECT count(*) n FROM v3_inner_commits WHERE idempotency_key=?').get(attempt(r).pendingWake.key).n,0);
});

test('an evidence-only source revision unlocks a minimum block without a head change or polling reset',async t=>{
 const f=fixture(t,{coreText:'# 隔离角色\n\n## 核心愿望\n'+('必须完整保留的合成角色核心。'.repeat(380)),text:{thoughtInputChars:2000}}),{r}=f;
 const source={adapter:'agency-key-evidence',externalId:'source-only',kind:'post',text:'独立合成资料原版。',metadata:{speakerId:r.characterId,scope:'self',explicitObservation:true}};
 const original=r.observe(source,{kind:'perception-observed'}),generation=r.inner.head().generation,core=JSON.stringify(r.policy.core());let reflects=0,calls=0;
 const reflect=r.inner.reflect.bind(r.inner);r.inner.reflect=options=>{reflects++;return reflect(options);};r.model.think=async()=>{calls++;return {data:quiet,receipt};};
 await assert.rejects(r.inner.considerIdle(),{code:'THOUGHT_INPUT_MINIMUM_TOO_LARGE'});const blocked=structuredClone(attempt(r));assert.equal(reflects,1);
 for(let n=0;n<2;n++){
  r.inner.meta('isolated-key-diagnostic',{iteration:n});f.advance(1000);assert.equal((await r.inner.considerIdle()).reason,'input-budget-blocked');assert.deepEqual(attempt(r),blocked);assert.equal(reflects,1);
 }
 const corrected=r.observe({...source,text:'独立合成资料已真实更正。'},{kind:'perception-observed'});
 assert.equal(corrected.sourceId,original.sourceId);assert.equal(corrected.revision,original.revision+1);assert.equal(r.inner.head().generation,generation);
 f.advance(1);await assert.rejects(r.inner.considerIdle(),{code:'THOUGHT_INPUT_MINIMUM_TOO_LARGE'});const retried=structuredClone(attempt(r));
 assert.equal(reflects,2);assert.notEqual(retried.attemptKey,blocked.attemptKey);assert.notEqual(retried.pendingWake.eventId,blocked.pendingWake.eventId);assert.equal(retried.lastAttemptAt,r.now());
 assert.equal(r.inner.head().generation,generation);assert.equal(JSON.stringify(r.policy.core()),core);assert.equal(calls,0);
 r.inner.meta('isolated-key-diagnostic',{iteration:'after-revision'});f.advance(1000);assert.equal((await r.inner.considerIdle()).reason,'input-budget-blocked');assert.deepEqual(attempt(r),retried);assert.equal(reflects,2);
});

test('memory revision and status-only changes unlock a minimum block while idle diagnostics remain stable',async t=>{
 const f=fixture(t,{coreText:'# 隔离角色\n\n## 核心愿望\n'+('必须完整保留的合成角色核心。'.repeat(380)),text:{thoughtInputChars:2000}}),{r}=f;
 const source=r.observe({adapter:'agency-key-memory',externalId:'unrelated-memory',kind:'post',text:'独立合成观察：今天有一片云。',metadata:{speakerId:r.characterId,scope:'self',explicitObservation:true}},{kind:'perception-observed'});
 const memoryId=r.store.addNodes([{kind:'episode',gist:'独立合成观察：今天有一片云。',eventRoot:'key-memory',evidence:[{sourceId:source.sourceId,revision:source.revision}]}]).ids[0];
 const generation=r.inner.head().generation,core=JSON.stringify(r.policy.core()),cursor=()=>r.store.db.prepare("SELECT max(rowid) sequence,count(*) n FROM cognitive_events WHERE kind<>'idle-reconsidered'").get(),beforeCursor=cursor();let reflects=0,calls=0;
 const reflect=r.inner.reflect.bind(r.inner);r.inner.reflect=options=>{reflects++;return reflect(options);};r.model.think=async()=>{calls++;return {data:quiet,receipt};};
 await assert.rejects(r.inner.considerIdle(),{code:'THOUGHT_INPUT_MINIMUM_TOO_LARGE'});let blocked=structuredClone(attempt(r));
 r.inner.meta('isolated-memory-diagnostic',{iteration:0});f.advance(1000);assert.equal((await r.inner.considerIdle()).reason,'input-budget-blocked');assert.deepEqual(attempt(r),blocked);assert.equal(reflects,1);
 r.lifecycle.revise(memoryId,1,{gist:'独立合成观察修订：今天有两片云。'});assert.equal(r.store.get(memoryId).revision,2);assert.equal(r.inner.head().generation,generation);assert.deepEqual(cursor(),beforeCursor);
 f.advance(1);await assert.rejects(r.inner.considerIdle(),{code:'THOUGHT_INPUT_MINIMUM_TOO_LARGE'});const revised=structuredClone(attempt(r));assert.notEqual(revised.attemptKey,blocked.attemptKey);assert.equal(reflects,2);
 r.inner.meta('isolated-memory-diagnostic',{iteration:1});f.advance(1000);assert.equal((await r.inner.considerIdle()).reason,'input-budget-blocked');assert.deepEqual(attempt(r),revised);assert.equal(reflects,2);blocked=revised;
 // Native maintenance may update a memory's qualification without writing a
 // new prose version. Isolate that dimension from revision, events and head.
 r.store.db.prepare("UPDATE memory_nodes SET status='contested' WHERE memory_id=?").run(memoryId);assert.equal(r.store.get(memoryId).revision,2);assert.equal(r.inner.head().generation,generation);assert.deepEqual(cursor(),beforeCursor);
 f.advance(1);await assert.rejects(r.inner.considerIdle(),{code:'THOUGHT_INPUT_MINIMUM_TOO_LARGE'});const requalified=structuredClone(attempt(r));assert.notEqual(requalified.attemptKey,blocked.attemptKey);assert.equal(reflects,3);
 r.inner.meta('isolated-memory-diagnostic',{iteration:2});f.advance(1000);assert.equal((await r.inner.considerIdle()).reason,'input-budget-blocked');assert.deepEqual(attempt(r),requalified);assert.equal(reflects,3);assert.equal(calls,0);
 assert.equal(r.inner.head().generation,generation);assert.equal(JSON.stringify(r.policy.core()),core);assert.deepEqual(cursor(),beforeCursor);
});
