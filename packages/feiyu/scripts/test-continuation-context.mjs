import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';
import {continuationContext,validateContinuationPatch,continuationEvidenceRefs} from '../src/cognition/continuation-context.js';
import {ongoingIdentity} from '../src/cognition/ongoing-lifecycle.js';
const HOME=path.resolve(import.meta.dirname,'../../../.local/rechecks/continuation');fs.mkdirSync(HOME,{recursive:true});
function fixture(t){
 const home=fs.mkdtempSync(path.join(HOME,'fixture-'));let time=Date.parse('2026-10-30T12:00:00+08:00'),n=0;
 const r=new CharacterCognition({root:home,characterId:'character:continuation-test',embedding:null,now:()=>time});
 r.policy.seed({identity:{text:'我是测试角色。核心愿望是认识世界并尊重交往边界。',locked:true},personality_growth:{text:'尚未形成新的稳定倾向。',locked:false}});const i=r.enableInner();t.after(()=>r.close());
 const event=(text,{person='qq:100100',role='user',metadata={},kind='chat',outcome='observed'}={})=>r.observe({adapter:'continuation-fixture',externalId:'event-'+n++,kind,text,metadata:{speakerId:role==='user'?person:r.characterId,conversationPeerId:person,scope:'private:'+person.slice(3),role,...metadata},occurredAt:time},{kind:'fixture-input',eventRoot:'fixture-root-'+n,outcome});
 const apply=(change,e)=>{const value=validateContinuationPatch(i,change,{eventIds:[e.eventId]});if(value)change={...change,continuation:value};const result=i.apply({summary:i.head().mental_summary||'承接本轮实际对话。',changes:[change]},{expectedGeneration:i.head().generation,eventIds:[e.eventId],key:'fixture-apply-'+n++});return result.changed[0].id;};
 const concern=(text='他很累，先让他歇着',extra={})=>{const e=event(text);return {id:apply({kind:'concern',title:text,meaning:'可以等到自然相关时再聊，不是待办。',people:['qq:100100'],concernKind:'care',status:'quiet',continuation:{externalState:'unknown',significance:'care',revisitWhen:'重逢或有新相关信息时可以关心一句'},...extra},e),e};};
 return {r,i,event,apply,concern,advance:ms=>{time+=ms;},now:()=>time};
}

test('quiet care can surface on reunion, without resolving the external event or scheduling a send',t=>{
 const f=fixture(t),{id}=f.concern(),before=f.r.store.db.prepare('SELECT total_changes() n').get().n;
 f.advance(3*86400000);const view=continuationContext(f.i,{person:'qq:100100',query:'hello'}),item=view.items.find(x=>x.id===id);
 assert.ok(item);assert.equal(item.externalState,'unknown');assert.equal(item.attentionState,'quiet');assert.equal(item.mayConsider,true);assert.equal(item.notATask,true);assert.equal(item.lastRelatedDelivery,null);assert.equal(view.noAutomaticSend,true);
 assert.equal(f.r.store.db.prepare('SELECT count(*) n FROM v3_action_proposals').get().n,0);assert.equal(f.r.store.db.prepare('SELECT total_changes() n').get().n,before);
});
test('time alone does not change a context fingerprint, mutate evidence, or mark something completed',t=>{
 const f=fixture(t);f.concern();const a=continuationContext(f.i,{person:'qq:100100',query:'hello'});f.advance(10*86400000);const b=continuationContext(f.i,{person:'qq:100100',query:'hello'});assert.equal(a.fingerprint,b.fingerprint);assert.equal(b.items[0].externalState,'unknown');
});
test('unrelated new topic and changed-topic request do not re-open casual/care threads',t=>{
 const f=fixture(t);f.concern();assert.deepEqual(continuationContext(f.i,{person:'qq:100100',query:'推荐一本科幻小说'}).items,[]);assert.deepEqual(continuationContext(f.i,{person:'qq:100100',query:'先不聊刚才那个了'}).items,[]);
});
test('a different person cannot receive another persons pending care context',t=>{
 const f=fixture(t);f.concern();assert.deepEqual(continuationContext(f.i,{person:'qq:100101',query:'hello'}).items,[]);
});
test('OK may be a reported improvement for care; it does not complete a project or promise',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('OK');const change={id,kind:'concern',continuation:{externalState:'reported_improvement',confirmation:{eventId:e.eventId,quote:'OK'}}};
 assert.equal(validateContinuationPatch(f.i,change,{eventIds:[e.eventId]}).externalState,'reported_improvement');
 assert.throws(()=>validateContinuationPatch(f.i,{...change,continuation:{...change.continuation,externalState:'reported_complete'}},{eventIds:[e.eventId]}),{code:'CONTINUATION_ACK_NOT_OUTCOME'});
 const project=f.concern('方案还没完成',{concernKind:'creative_interest',continuation:{externalState:'unknown',significance:'casual'}});
 assert.throws(()=>validateContinuationPatch(f.i,{...change,id:project.id},{eventIds:[e.eventId]}),{code:'CONTINUATION_ACK_CONTEXT_REQUIRED'});
});
test('the persons exact report can update an outcome while keeping report/observation distinct',t=>{
 const f=fixture(t),{id}=f.concern('创赛方案还在写',{concernKind:'creative_interest'}),e=f.event('我的创赛方案已经提交了。');
 const value={externalState:'reported_complete',confirmation:{eventId:e.eventId,quote:'我的创赛方案已经提交了。'}};
 f.apply({id,kind:'concern',continuation:value},e);const item=continuationContext(f.i,{person:'qq:100100',query:'创赛方案'}).items.find(x=>x.id===id);assert.equal(item.externalState,'reported_complete');assert.equal(item.outcomeKnown,true);assert.match(item.externalStateBasis,/not independently observed/);assert.match(item.use,/do not ask again/);
});
test('an assistant suggestion cannot confirm another persons decision or completion',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('行，那换。',{role:'assistant'});assert.throws(()=>validateContinuationPatch(f.i,{id,kind:'concern',continuation:{externalState:'reported_complete',confirmation:{eventId:e.eventId,quote:'行，那换。'}}},{eventIds:[e.eventId]}),{code:'CONTINUATION_PERSON_REPORT_REQUIRED'});
});
test('forwarded/quoted old history and another person cannot become this persons current confirmation',t=>{
 const f=fixture(t),{id}=f.concern();for(const opts of [{metadata:{providedHistory:true}},{metadata:{quotedTranscript:true}},{metadata:{forwardedAuthorId:'qq:100102'}},{person:'qq:100101'}]){const e=f.event('我的方案已经提交了。',opts);assert.throws(()=>validateContinuationPatch(f.i,{id,kind:'concern',continuation:{externalState:'reported_complete',confirmation:{eventId:e.eventId,quote:'我的方案已经提交了。'}}},{eventIds:[e.eventId]}),{code:'CONTINUATION_PERSON_REPORT_REQUIRED'});}
});
test('fabricated quote and a past event outside this update cannot confirm an outcome',t=>{
 const f=fixture(t),{id,e}=f.concern();assert.throws(()=>validateContinuationPatch(f.i,{id,kind:'concern',continuation:{externalState:'reported_complete',confirmation:{eventId:e.eventId,quote:'我已经完成了比赛'}}},{eventIds:[e.eventId]}),{code:'CONTINUATION_PERSON_REPORT_REQUIRED'});assert.throws(()=>validateContinuationPatch(f.i,{id,kind:'concern',continuation:{externalState:'reported_complete',confirmation:{eventId:e.eventId,quote:'他很累，先让他歇着'}}},{eventIds:[]}),{code:'CONTINUATION_CURRENT_CONFIRMATION_REQUIRED'});
});
test('quiet/released attention never by itself claims an external outcome; obligations do not expire on time',t=>{
 const f=fixture(t),{id}=f.concern('答应下次一起核对方案',{concernKind:'promise',continuation:{externalState:'unknown',significance:'commitment'}});f.advance(40*86400000);const x=continuationContext(f.i,{person:'qq:100100',query:'聊点别的'}).items.find(x=>x.id===id);assert.ok(x);assert.equal(x.externalState,'unknown');assert.equal(x.attentionState,'quiet');const e=f.event('今天先放下这个话题。');f.apply({id,kind:'concern',status:'released',meaning:'退出持续关注，承诺本身没有被确认完成。'},e);assert.equal(f.i.object(id).body.continuation.externalState,'unknown');assert.equal(continuationContext(f.i,{person:'qq:100100',query:'hello'}).items.some(x=>x.id===id),false);
});
test('withdrawing an exact source removes the derived continuation view instead of exposing stale prose',t=>{
 const f=fixture(t),{e}=f.concern();f.r.archive.db.prepare("UPDATE documents SET status='deleted' WHERE source_id=? AND revision=?").run(e.sourceId,e.revision);assert.equal(continuationContext(f.i,{person:'qq:100100',query:'hello'}).items.length,0);
});
test('partial continuation update preserves the old outcome and exact confirmation',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('我今天缓过来一点了。');f.apply({id,kind:'concern',continuation:{externalState:'reported_improvement',confirmation:{eventId:e.eventId,quote:'我今天缓过来一点了。'}}},e);const value=validateContinuationPatch(f.i,{id,kind:'concern',continuation:{revisitWhen:'等他愿意展开时再听'}},{eventIds:[]});assert.equal(value.externalState,'reported_improvement');assert.equal(value.confirmation.eventId,e.eventId);
});
test('different external-state interpretation is not treated as an identical ongoing duplicate',t=>{
 const f=fixture(t),{id}=f.concern(),o=f.i.object(id),base={...o.body,continuation:{externalState:'unknown'}};assert.notEqual(ongoingIdentity(f.i,'concern',base,{id}),ongoingIdentity(f.i,'concern',{...base,continuation:{externalState:'reported_complete'}},{id}));
});
test('an unrelated successful tool read cannot count as observed completion of this concern',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('网页读取成功',{kind:'web-reading',outcome:'completed',metadata:{explicitObservation:true},role:'assistant'});assert.throws(()=>validateContinuationPatch(f.i,{id,kind:'concern',continuation:{externalState:'observed_complete',confirmation:{eventId:e.eventId,quote:'网页读取成功'}}},{eventIds:[e.eventId]}),{code:'CONTINUATION_BOUND_RECEIPT_REQUIRED'});
});
test('a host receipt binds exactly this object/version, with no model assertion substituting for it',t=>{
 const f=fixture(t),{id}=f.concern(),o=f.i.object(id),e=f.event('本对象的实际操作已完成',{kind:'tool-result',outcome:'completed',role:'assistant',metadata:{explicitObservation:true,continuationOutcome:{objectId:id,objectRevision:o.current_revision,externalState:'observed_complete'}}});const v=validateContinuationPatch(f.i,{id,kind:'concern',continuation:{externalState:'observed_complete',confirmation:{eventId:e.eventId,quote:'本对象的实际操作已完成'}}},{eventIds:[e.eventId]});assert.equal(v.externalState,'observed_complete');
});
test('action candidates and cancelled executions are not counted as delivered follow-up',t=>{
 const f=fixture(t),{id}=f.concern();const e=f.event('hello');f.i.apply({summary:'想自然关心一句。',decision:{kind:'chat',personId:'qq:100100',intent:'缓过来一点没',objectIds:[id]}},{expectedGeneration:f.i.head().generation,eventIds:[e.eventId],key:'decision'});const action=f.i.candidate('qq:100100');assert.ok(action);assert.equal(continuationContext(f.i,{person:'qq:100100',query:'hello'}).items[0].lastRelatedDelivery,null);f.i.cancelExecutions([action.object_id],'fixture-cancel');assert.equal(continuationContext(f.i,{person:'qq:100100',query:'hello'}).items[0].lastRelatedDelivery,null);
});
test('unknown execution receipt is not counted as a delivered follow-up and does not invite a blind resend',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('hello');f.i.apply({summary:'想自然关心一句。',decision:{kind:'chat',personId:'qq:100100',intent:'缓过来一点没',objectIds:[id]}},{expectedGeneration:f.i.head().generation,eventIds:[e.eventId],key:'decision'});const action=f.i.candidate('qq:100100'),claim=f.i.beginAction(action,Object.fromEntries(['authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready'].map(k=>[k,true])));assert.ok(claim);f.i.effectStarting(claim.executionId);f.i.actionResult(claim.executionId,{status:'unknown',receipt:{reason:'fixture-ack-lost'}});const view=continuationContext(f.i,{person:'qq:100100',query:'hello'});assert.equal(view.items[0].lastRelatedDelivery,null);assert.equal(view.items[0].lastRelatedAttempt.status,'unknown');assert.equal(view.items[0].lastRelatedAttempt.doNotBlindlyResend,true);assert.equal(f.i.candidate('qq:100100'),null);
});
test('retained reported outcome carries its old exact event dependency into a new object version',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('我今天缓过来一点了。');f.apply({id,kind:'concern',continuation:{externalState:'reported_improvement',confirmation:{eventId:e.eventId,quote:'我今天缓过来一点了。'}}},e);const newer=f.event('今天先聊别的吧。'),body=f.i.object(id).body,refs=continuationEvidenceRefs(f.i,body,[{eventId:newer.eventId}]);assert.deepEqual(refs,[{eventId:newer.eventId},{eventId:e.eventId}]);assert.equal(continuationEvidenceRefs(f.i,body,refs).length,2);
});
test('ambiguous multi-person reports require an explicit subject; inconsistent source scope is rejected',t=>{
 const f=fixture(t),{id}=f.concern('两个人的比赛进度还不知道'),other=f.event('我的进度也还没定。',{person:'qq:100101'});f.apply({id,kind:'concern',people:['qq:100100','qq:100101']},other);const e=f.event('我的方案已经提交了。');const change={id,kind:'concern',continuation:{externalState:'reported_complete',confirmation:{eventId:e.eventId,quote:'我的方案已经提交了。'}}};assert.throws(()=>validateContinuationPatch(f.i,change,{eventIds:[e.eventId]}),{code:'CONTINUATION_REPORT_SUBJECT_REQUIRED'});assert.equal(validateContinuationPatch(f.i,{...change,continuation:{...change.continuation,subjectId:'qq:100100'}},{eventIds:[e.eventId]}).subjectId,'qq:100100');const bad=f.event('我的方案已经提交了。',{metadata:{scope:'private:100101'}});assert.throws(()=>validateContinuationPatch(f.i,{...change,continuation:{...change.continuation,subjectId:'qq:100100',confirmation:{eventId:bad.eventId,quote:'我的方案已经提交了。'}}},{eventIds:[bad.eventId]}),{code:'CONTINUATION_PERSON_REPORT_REQUIRED'});
});
test('only succeeded native execution produces a related-delivery reference and changes its fingerprint',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('hello');f.i.apply({summary:'想自然关心一句。',decision:{kind:'chat',personId:'qq:100100',intent:'缓过来一点没',objectIds:[id]}},{expectedGeneration:f.i.head().generation,eventIds:[e.eventId],key:'decision'});const action=f.i.candidate('qq:100100'),before=continuationContext(f.i,{person:'qq:100100',query:'hello'}),claim=f.i.beginAction(action,Object.fromEntries(['authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready'].map(k=>[k,true])));assert.ok(claim);f.i.effectStarting(claim.executionId);f.i.actionResult(claim.executionId,{status:'succeeded',receipt:{messageId:'controlled-fixture-delivery',transport:'local-controlled-receiver'}});const after=continuationContext(f.i,{person:'qq:100100',query:'hello'}),x=after.items.find(x=>x.id===id);assert.equal(x.lastRelatedDelivery.actionId,action.object_id);assert.equal(x.lastRelatedDelivery.status,'succeeded');assert.match(x.lastRelatedDelivery.meaning,/does not prove/);assert.notEqual(after.fingerprint,before.fingerprint);
});
test('native apply retains a report dependency through attention-only updates, then native source erasure revokes the current object',t=>{
 const f=fixture(t),{id}=f.concern(),reported=f.event('我今天缓过来一点了。');
 f.i.apply({summary:'他自己说今天缓过来一点，先按他的说法理解。',changes:[{id,kind:'concern',continuation:{externalState:'reported_improvement',confirmation:{eventId:reported.eventId,quote:'我今天缓过来一点了。'}}}]},{expectedGeneration:f.i.head().generation,eventIds:[reported.eventId],key:'native-report'});
 const newTopic=f.event('今天想聊小说。');
 f.i.apply({summary:'这段关心先放在后台，接他眼前的话。',changes:[{id,kind:'concern',status:'quiet',continuation:{revisitWhen:'他愿意再提近况时听听'}}]},{expectedGeneration:f.i.head().generation,eventIds:[newTopic.eventId],key:'native-attention-only'});
 const object=f.i.object(id);assert.equal(object.body.continuation.externalState,'reported_improvement');assert.equal(object.body.continuation.confirmation.eventId,reported.eventId);
 assert.ok(f.i.db.prepare('SELECT 1 FROM v3_inner_evidence WHERE character_id=? AND object_id=? AND object_revision=? AND event_id=?').get(f.r.characterId,id,object.current_revision,reported.eventId));
 const sourceDependency=f.i.db.prepare('SELECT 1 FROM v3_inner_dependencies WHERE character_id=? AND child_id=? AND child_revision=? AND parent_source_id=? AND parent_source_revision=?').get(f.r.characterId,id,object.current_revision,reported.sourceId,reported.revision);assert.ok(sourceDependency);
 f.r.archive.erase(reported.sourceId);assert.equal(f.i.object(id).status,'redacted');assert.equal(continuationContext(f.i,{person:'qq:100100',query:'hello'}).items.some(x=>x.id===id),false);
});
test('native apply rejects an assistant-authored completion claim atomically without partial object/state changes',t=>{
 const f=fixture(t),{id}=f.concern(),e=f.event('行，那换。',{role:'assistant'}),before=f.i.object(id).current_revision,generation=f.i.head().generation;
 assert.throws(()=>f.i.apply({summary:'错误地当成他已经决定。',changes:[{id,kind:'concern',continuation:{externalState:'reported_complete',confirmation:{eventId:e.eventId,quote:'行，那换。'}}}]},{expectedGeneration:generation,eventIds:[e.eventId],key:'native-invalid-own-suggestion'}),{code:'CONTINUATION_PERSON_REPORT_REQUIRED'});
 assert.equal(f.i.object(id).current_revision,before);assert.equal(f.i.head().generation,generation);
});
