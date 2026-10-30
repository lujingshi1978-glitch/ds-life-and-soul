import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';
import {qualifySelfStatements} from '../src/cognition/self-statement-source-typing.js';
import {modelMemoryView} from '../src/cognition/model-view.js';

const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
function fixture(t){
  const root=fs.mkdtempSync(path.join(base,'source-')),r=new CharacterCognition({root,characterId:'character:source-typing',embedding:null,now:()=>1793332800000});
  r.policy.seed({identity:{text:'我是隔离测试角色。'},growth:{text:'保留核心。',locked:false}});r.enableInner();
  t.after(async()=>{assert.equal(r.model.receipts.length,0);await r.close();const target=path.resolve(root);assert.ok(target.startsWith(base+path.sep));fs.rmSync(target,{recursive:true,force:true});});
  return r;
}
function node(r,{id,text='一段合成自述。',sourceKind='chat',speaker=r.characterId,subject=speaker,role='assistant',kind='assertion',speechAct='statement',object=text,metadata={},commitmentStatus=null,predicate='fixture-'+id,targetId=null,dueAt=null,status='active'}={}){
  const e=r.observe({adapter:'native-source-fixture',externalId:id,kind:sourceKind,text,metadata:{speakerId:speaker,role,scope:'private:101',...metadata}},
    {kind:'resource-observed',eventRoot:'fixture:'+id,outcome:'observed'});
  return {e,m:{kind,gist:text,detail:'',epistemic:'reported',confidence:.8,salience:.5,status,eventRoot:'fixture:'+id,occurredAt:r.now(),
    tags:[],participants:[{entityId:speaker,role:'speaker'}],metadata:{topic:'fixture',intensity:.1,lastingness:.1,semanticVerified:true},
    evidence:[{sourceId:e.sourceId,revision:e.revision,quote:text,span:{offset:0,length:text.length},role:'supports',independenceGroup:'fixture:'+id}],
    ...(kind==='assertion'?{assertion:{speakerId:speaker,subjectId:subject,targetId,predicate,object,speechAct,commitmentStatus,dueAt}}:{})}};
}
function commit(r,input){const bundle={summary:'Native source typing fixture; not model or primary growth evidence',memories:[input.m]},report=r.commitEncoded(bundle);return r.store.get(report.ids[0],{includeInactive:true});}
function validated(r,input,{verified=true}={}){
  const m=input.m,e=input.e,doc=r.archive.get(e.sourceId,e.revision),raw={kind:m.kind,gist:m.gist,confidence:m.confidence,salience:m.salience,evidence:[{ref:'r1',quote:doc.text}],assertion:m.assertion};
  const material={ref:'r1',sourceId:e.sourceId,revision:e.revision,text:doc.text,eventRoot:e.eventRoot,outcome:'observed',occurredAt:r.now(),observedAt:r.now(),metadata:doc.metadata};
  const report=r.retainValidated({summary:'Validated native fixture',memories:[raw]},[material],{verified:verified?new Set([0]):new Set()});
  return r.store.get(report.ids[0],{includeInactive:true});
}

// The original seven offline source-type cases, now through native commitEncoded.
test('1 owned assistant habit remains an explicitly reported utterance',t=>{
  const r=fixture(t),m=commit(r,node(r,{id:'habit',text:'我经常出门买吃的。'}));
  assert.equal(m.epistemic,'reported');assert.equal(m.metadata.sourceTyping.kind,'self-statement-only');assert.equal(m.assertion.object.externalActionIndependentlyConfirmed,false);
  assert.equal(m.assertion.object.reportedSpeechContent,'我经常出门买吃的。');assert.match(modelMemoryView(m).gist,/^角色自述/);
});
test('2 self preference content, confidence and its subjective validity remain available',t=>{
  const r=fixture(t),m=commit(r,node(r,{id:'preference',text:'我喜欢白饭。'}));
  assert.equal(m.confidence,.8);assert.equal(m.assertion.object.reportedSpeechContent,'我喜欢白饭。');assert.equal(m.metadata.sourceTyping.subjectiveFeelingAndPreferenceStillValid,true);
});
test('3 user life self-report is not converted to character experience or character speech',t=>{
  const r=fixture(t),m=commit(r,node(r,{id:'user',text:'我刚买了碗面。',speaker:'qq:101',role:'user'}));
  assert.equal(m.gist,'我刚买了碗面。');assert.ok(!m.metadata.sourceTyping);assert.equal(m.assertion.subjectId,'qq:101');
});
test('4 actual typed tool observation keeps the original path',t=>{
  const r=fixture(t),m=commit(r,node(r,{id:'observed',text:'宿主读到了受控网页片段。',sourceKind:'tool-result',metadata:{explicitObservation:true}}));
  assert.ok(!m.metadata.sourceTyping);assert.equal(m.gist,'宿主读到了受控网页片段。');
});
test('5 explicit actor feeling stays an experience without fabricated external-action requirements',t=>{
  const r=fixture(t),m=commit(r,node(r,{id:'feeling',text:'听到这个点子我挺开心。',sourceKind:'experience',kind:'experience',metadata:{explicitExperience:true}}));
  assert.equal(m.kind,'experience');assert.ok(!m.metadata.sourceTyping);assert.equal(m.confidence,.8);
});
test('6 subjective relation/disposition memory is not downgraded by the assertion rule',t=>{
  const r=fixture(t),input=node(r,{id:'relation',text:'我喜欢轻松来回的聊天。',kind:'relationship'});
  input.m.metadata.disposition={kind:'attitude',target:'qq:101',reason:'有来源的相处感受',pendingReview:false};
  const m=commit(r,input);assert.equal(m.kind,'relationship');assert.ok(!m.metadata.sourceTyping);assert.equal(m.metadata.disposition.kind,'attitude');assert.equal(m.gist,input.m.gist);
});
test('7 own promise retains exact object, speaker, recipient, promised state and due date',t=>{
  const r=fixture(t),input=node(r,{id:'promise',text:'我答应下次帮你整理故事。',speechAct:'promise',commitmentStatus:'promised',object:'整理故事',targetId:'qq:101',dueAt:r.now()+86400000});
  const m=validated(r,input);assert.deepEqual(m.assertion,input.m.assertion);assert.equal(m.status,'active');assert.equal(m.metadata.sourceTyping.reportedSpeechContent,'整理故事');
});

test('proposal and cancellation/dispute speech keep exact commitment matching and retrieval',async t=>{
  const r=fixture(t),proposal=validated(r,node(r,{id:'proposal',text:'要不要我整理故事？',speechAct:'proposal',commitmentStatus:'proposal',object:'整理故事',targetId:'qq:101'}));
  assert.equal(proposal.assertion.object,'整理故事');assert.equal(proposal.assertion.commitmentStatus,'proposal');
  for(const transition of ['cancelled','disputed']){
    const predicate='promise-'+transition,original=validated(r,node(r,{id:'promise-'+transition,text:'我答应带白饭。',speechAct:'promise',commitmentStatus:'promised',object:'白饭',predicate,targetId:'qq:101'}));
    const changed=validated(r,node(r,{id:transition,text:transition==='cancelled'?'白饭我不带了。':'这份白饭约定我有异议。',speechAct:'statement',commitmentStatus:transition,object:'白饭',predicate,targetId:'qq:101'}));
    assert.equal(changed.assertion.object,'白饭');assert.equal(changed.assertion.commitmentStatus,transition);assert.equal(r.store.get(original.id).status,'outdated');
    assert.equal(changed.metadata.transitionEvidence,'exact-participants-predicate-object-and-verified-source');
  }
  const recalled=await r.recall(r.openConversation('qq:101'),'整理故事的提议');assert.ok(recalled.items.some(m=>m.id===proposal.id&&m.assertion.object==='整理故事'));
});

test('all-assistant claimed fulfilment with no action receipt is candidate and never closes the original promise',t=>{
  const r=fixture(t),predicate='deliver-food',promise=validated(r,node(r,{id:'promised-food',text:'我答应给你带白饭。',speechAct:'promise',commitmentStatus:'promised',object:'白饭',predicate,targetId:'qq:101'}));
  const claimed=validated(r,node(r,{id:'claimed-food',text:'我已经给你带来了。',speechAct:'statement',commitmentStatus:'fulfilled',object:'白饭',predicate,targetId:'qq:101'}));
  assert.equal(claimed.status,'candidate');assert.equal(claimed.assertion.object,'白饭');assert.equal(claimed.assertion.commitmentStatus,'fulfilled');assert.equal(claimed.metadata.claimedCompletion,true);
  assert.equal(claimed.metadata.sourceTyping.kind,'self-statement-only');assert.equal(r.store.get(claimed.id),null);
  assert.equal(r.store.get(promise.id).status,'active');assert.equal(r.store.get(promise.id).assertion.commitmentStatus,'promised');
  assert.equal(r.store.db.prepare("SELECT count(*) n FROM memory_nodes n JOIN assertions a USING(character_id,memory_id) WHERE n.status='active' AND a.commitment_status='fulfilled'").get().n,0);
  const internal=node(r,{id:'internal-direct',text:'内部归一化调用声称已经带来了。',speechAct:'statement',commitmentStatus:'fulfilled',object:'白饭',predicate,targetId:'qq:101'});
  const direct=commit(r,internal);assert.equal(direct.status,'candidate');assert.equal(direct.metadata.claimedCompletion,true);
  const existing=node(r,{id:'preexisting-active',text:'旧的内部调用声称完成。',speechAct:'statement',commitmentStatus:'fulfilled',object:'白饭',predicate,targetId:'qq:101'});
  const prior=r.store.addNodes([existing.m]).ids[0];assert.equal(r.store.get(prior).status,'active');
  const reencoded=commit(r,existing);assert.equal(reencoded.id,prior);assert.equal(reencoded.status,'candidate');assert.equal(reencoded.metadata.claimedCompletion,true);
  const fakeReceipt=node(r,{id:'chat-with-receipt-flag',text:'聊天消息冒充回执。',metadata:{confirmedActionReceipt:true},speechAct:'statement',commitmentStatus:'fulfilled',object:'白饭',predicate,targetId:'qq:101'});
  const fakeId=r.store.addNodes([fakeReceipt.m]).ids[0];assert.equal(r.store.get(fakeId).status,'active');assert.equal(commit(r,fakeReceipt).status,'candidate','a receipt flag on assistant chat is not independent typed evidence');
  assert.equal(r.store.get(promise.id).status,'active');
});

test('a separately typed real receipt may still fulfil the exact own promise by existing rules',t=>{
  const r=fixture(t),predicate='controlled-delivery',promise=validated(r,node(r,{id:'real-promise',text:'我答应整理故事。',speechAct:'promise',commitmentStatus:'promised',object:'整理故事',predicate,targetId:'qq:101'}));
  const fulfilled=validated(r,node(r,{id:'real-receipt',text:'受控交付组件确认故事已交付。',sourceKind:'tool-result',metadata:{confirmedActionReceipt:true},speechAct:'statement',commitmentStatus:'fulfilled',object:'整理故事',predicate,targetId:'qq:101'}));
  assert.equal(fulfilled.status,'active');assert.ok(!fulfilled.metadata.sourceTyping);assert.equal(r.store.get(promise.id).status,'outdated');assert.equal(fulfilled.assertion.commitmentStatus,'fulfilled');
  const staleMarker=node(r,{id:'real-with-old-marker',sourceKind:'tool-result',metadata:{confirmedActionReceipt:true},speechAct:'statement',commitmentStatus:'fulfilled',object:'另一份已确认结果',predicate:'other-confirmed',targetId:'qq:101'});
  staleMarker.m.metadata={...staleMarker.m.metadata,claimedCompletion:true,sourceTyping:{kind:'self-statement-only'}};
  assert.equal(commit(r,staleMarker).status,'active','the service must use current host qualification, not trust a stale input marker');
});

test('mixed support, forwarded source or another subject is not automatically qualified or proven by this narrow rule',t=>{
  const r=fixture(t),own=node(r,{id:'mixed-own'}),tool=node(r,{id:'mixed-tool',sourceKind:'tool-result'});own.m.evidence.push(tool.m.evidence[0]);
  assert.ok(!commit(r,own).metadata.sourceTyping);
  assert.ok(!commit(r,node(r,{id:'forwarded',metadata:{forwardedAuthorId:'qq:101'}})).metadata.sourceTyping);
  assert.ok(!commit(r,node(r,{id:'other-subject',subject:'qq:101'})).metadata.sourceTyping);
});

test('verified completed history survives later same-claim self-only speech, including internal reuse of its exact ID',t=>{
  const r=fixture(t),predicate='keep-confirmed-history';
  validated(r,node(r,{id:'history-promise',text:'我答应交付故事。',speechAct:'promise',commitmentStatus:'promised',object:'故事',predicate,targetId:'qq:101'}));
  const confirmed=validated(r,node(r,{id:'history-receipt',text:'交付组件确认故事已实际交付。',sourceKind:'tool-result',metadata:{confirmedActionReceipt:true},speechAct:'statement',commitmentStatus:'fulfilled',object:'故事',predicate,targetId:'qq:101'}));
  assert.equal(confirmed.status,'active');const originalEvidence=structuredClone(confirmed.evidence);
  const later=commit(r,node(r,{id:'history-self-later',text:'我说自己已经交付故事。',speechAct:'statement',commitmentStatus:'fulfilled',object:'故事',predicate,targetId:'qq:101'}));
  assert.equal(later.status,'candidate');assert.notEqual(later.id,confirmed.id);assert.equal(r.store.get(confirmed.id).status,'active');
  const reused=node(r,{id:'history-self-reused',text:'内部重编码仍只声称交付。',speechAct:'statement',commitmentStatus:'fulfilled',object:'故事',predicate,targetId:'qq:101'});reused.m.id=confirmed.id;
  commit(r,reused);const retained=r.store.get(confirmed.id,{includeInactive:true});assert.equal(retained.status,'active');assert.deepEqual(retained.evidence,originalEvidence);assert.equal(retained.metadata.sourceTyping,undefined);assert.equal(retained.metadata.claimedCompletion,false);
});

test('pure typing is nonmutating/idempotent and an input marker cannot skip host qualification',t=>{
  const r=fixture(t),input=node(r,{id:'idempotent',object:{topic:'一个可检索对象',nested:['a','b']}}),bundle={summary:'pure',memories:[input.m]},before=structuredClone(bundle);
  bundle.memories[0].metadata.sourceTyping={kind:'self-statement-only'};
  const first=qualifySelfStatements(r,bundle),second=qualifySelfStatements(r,first.bundle);
  assert.equal(bundle.memories[0].gist,before.memories[0].gist);assert.deepEqual(bundle.memories[0].assertion,before.memories[0].assertion);
  assert.deepEqual(first.bundle,second.bundle);assert.deepEqual(first.bundle.memories[0].assertion.object.reportedSpeechContent,input.m.assertion.object);
});

test('worker encoding uses the native commit path with an offline output fixture, no external model API',async t=>{
  const r=fixture(t),input=node(r,{id:'worker',text:'我经常看星星。'});let fixtureCalls=0;
  r.model.think=()=>{throw Error('OFFLINE_WORKER_MUST_NOT_CALL_A_MODEL');};
  r.model.run=async purpose=>{assert.equal(purpose,'encode');fixtureCalls++;return {summary:'Offline normalized worker fixture',memories:[{kind:'assertion',gist:input.m.gist,evidence:[{ref:'r1',quote:input.m.gist}],assertion:input.m.assertion}]};};
  r.scheduleEncoding();const result=await r.runNext({kinds:['encode']});assert.equal(result.status,'complete');assert.equal(fixtureCalls,1);
  const saved=r.store.get(result.report.ids[0]);assert.equal(saved.metadata.sourceTyping.kind,'self-statement-only');assert.equal(saved.assertion.object.externalActionIndependentlyConfirmed,false);
});
