import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {LiveCognition} from '../src/cognition/live.js';import {ContactStore} from '../src/contact-store.js';
import {sourceTextFormat} from '../src/cognition/structured-spans.js';
const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
const OLD='OLD_CUP_BACKGROUND_CANARY';
function fixture(t,{summary=OLD,active=true}={}){
 const home=fs.mkdtempSync(path.join(base,'native-')),profileDir=path.join(home,'profile');fs.mkdirSync(profileDir);
 const contacts=new ContactStore(path.join(profileDir,'contacts.sqlite')),scope='private:101';
 const mind=new LiveCognition({root:path.join(home,'cognition'),profile:{id:path.basename(home),dir:profileDir,created:1793332799000},contacts,core:'我是隔离原生归档测试角色。',innerVersion:3,ownerQQ:'1',now:()=>1793332800000,ready:()=>true,allowed:()=>true,mirror:path.join(profileDir,'mind-core.json'),think:()=>{throw Error('NO_MODEL');}}),r=mind.runtime;
 const old=r.observe({adapter:'fixture-old',externalId:'old',kind:'chat',text:'旧轮次的杯子话题。',metadata:{speakerId:'qq:101',scope}},{kind:'chat-received',eventRoot:'old-root',outcome:'observed'});
 r.inner.apply({summary,changes:[]},{expectedGeneration:r.inner.head().generation,eventIds:[old.eventId],key:'old-summary'});
 const recordId=contacts.record(scope,{role:'user',text:'这是本轮新的交流。',at:r.now(),messageId:'current',source:'live'}),current=mind.archive.ref('chat:'+recordId);
 if(active)mind.beginBehavior('current','chat',scope,'显式零模型归档fixture');
 const versions=()=>({expectedVersion:mind.store.state().version,expectedMindGeneration:r.inner.head().generation,expectedPsycheRevision:r.inner.psyche.current({includeInvalid:true})?.revision||0});
 const count=()=>r.archive.db.prepare("SELECT count(*) n FROM documents WHERE adapter='inner-feeling'").get().n;
 const update=input=>mind.recordFeeling({...versions(),...input},scope);
 const archived=out=>{const es=r.store.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE event_id=? AND character_id=?').get(out.pendingInnerIntegration,r.characterId);return r.archive.get(es.source_id,es.source_revision);};
 t.after(async()=>{assert.equal(r.model.receipts.length,0);await mind.close();contacts.close();const target=path.resolve(home);assert.ok(target.startsWith(base+path.sep));fs.rmSync(target,{recursive:true,force:true});});
 return {mind,r,scope,old,current,versions,count,update,archived};
}
function body(d){const parsed=JSON.parse(d.text);assert.equal(parsed.format,'subjective-update-fields-v1');assert.match(parsed.interpretation,/不独立证实/);assert.ok(!d.text.includes(OLD));return parsed.fields;}
test('mood-only update is neither empty nor an inherited old summary; canonical summary remains continuous',t=>{
 const f=fixture(t),out=f.update({mood:'轻松了些'}),d=f.archived(out),fields=body(d);
 assert.deepEqual(fields,{mood:'轻松了些'});assert.equal(f.r.inner.head().mental_summary,OLD);assert.equal(out.mood,'轻松了些');assert.equal(f.count(),1);
});
test('empty prior summary with mood-only still archives the supplied accepted field',t=>{
 const f=fixture(t,{summary:''}),out=f.update({mood:'有点开心'}),d=f.archived(out);
 assert.ok(d.text.length>0);assert.deepEqual(body(d),{mood:'有点开心'});assert.equal(f.r.inner.head().mental_summary,'');
});
test('appraisal-only records supplied normalized fields, not inherited emotion values or old summary',t=>{
 const f=fixture(t),a={focus:'这轮的署名',trigger:'对方本轮认真说明',impulse:'stay',emotions:{interest:.45}},out=f.update({appraisal:a}),d=f.archived(out);
 assert.deepEqual(body(d),{appraisal:a});assert.equal(f.r.store.projection('state').appraisal.emotions.interest,.45);assert.equal(f.r.inner.head().mental_summary,OLD);
 const later=f.update({appraisal:{emotions:{hurt:.2}}}),fields=body(f.archived(later));assert.deepEqual(fields,{appraisal:{emotions:{hurt:.2}}});assert.ok(!('interest' in fields.appraisal.emotions));
});
test('psychology-only keeps actual operation text and reason without replaying the inherited summary',t=>{
 const f=fixture(t),psychology={add:[{text:'本轮被认真听见，我觉得安稳。',reason:'这一次来回带来的感受。',importance:.4,intensity:.3}]},out=f.update({psychology});
 assert.deepEqual(body(f.archived(out)),{psychology});assert.ok(f.r.inner.psyche.list().some(x=>x.text===psychology.add[0].text));assert.equal(f.r.inner.head().mental_summary,OLD);
});
test('psyche/disposition/mood delta preserves the submitted current fields and native commit',t=>{
 const f=fixture(t),input={psyche:{attention:[{focus:'眼前这一轮交流'}]},dispositions:[{kind:'attitude',target:'qq:101',text:'现在觉得可以放松一点接话。',facet:'眼前相处',transition:'add',reason:'这轮对方认真回应。'}],mood:'安稳'};
 const out=f.update(input),d=f.archived(out);assert.deepEqual(body(d),input);assert.equal(out.dispositionChanges.length,1);assert.equal(f.r.inner.head().generation,out.generation);assert.ok(out.pendingInnerIntegration);
});
test('explicit psychological summary is recorded exactly and applies as the coherent summary',t=>{
 const f=fixture(t),input={psychological:'本轮我明确感到轻松，而不是刚才的旧话题。',mood:'轻快',valence:.35,arousal:.55},out=f.update(input),d=f.archived(out);
 assert.deepEqual(body(d),input);assert.equal(f.r.inner.head().mental_summary,input.psychological);assert.equal(out.valence,.35);assert.equal(d.metadata.subjectiveUpdateFormat,'subjective-update-fields-v1');
});
test('same-value or empty noChange creates no experience source',t=>{
 const f=fixture(t),before=f.mind.store.state(),out=f.update({psychological:before.psychological,mood:before.mood,valence:before.valence,arousal:before.arousal});
 assert.equal(out.noChange,true);assert.equal(out.pendingInnerIntegration,null);assert.equal(f.count(),0);assert.equal(f.update({}).noChange,true);assert.equal(f.count(),0);
});
test('physical, generation and psyche version conflicts retain existing rejection before archive',t=>{
 const f=fixture(t),v=f.versions();
 for(const [patch,error]of [[{expectedVersion:v.expectedVersion+1},/STATE_VERSION_CONFLICT/],[{expectedMindGeneration:v.expectedMindGeneration+1},/V3_HEAD_VERSION_CONFLICT/],[{expectedPsycheRevision:v.expectedPsycheRevision+1},/V3_PSYCHOLOGY_VERSION_CONFLICT/]]){
  assert.throws(()=>f.update({mood:'不应写入',...patch}),error);assert.equal(f.count(),0);
 }
});
test('no active attention still rejects before an experience is archived',t=>{
 const f=fixture(t,{active:false});assert.throws(()=>f.update({mood:'不应写入'}),/EXPERIENCE_REQUIRES_ACTIVE_ATTENTION/);assert.equal(f.count(),0);
});
test('withdrawn old event evidence and invalid preflight retain source refusal without a new experience',t=>{
 const f=fixture(t),e=f.r.observe({adapter:'stale-fixture',externalId:'one',kind:'chat',text:'旧引用',metadata:{speakerId:'qq:101',scope:f.scope}},{kind:'chat-received',eventRoot:'stale-root',outcome:'observed'});
 f.r.observe({adapter:'stale-fixture',externalId:'one',kind:'chat',text:'已经更正',metadata:{speakerId:'qq:101',scope:f.scope}},{kind:'chat-received',eventRoot:'stale-root',outcome:'observed'});
 assert.throws(()=>f.update({psychology:{add:[{text:'不能采纳旧源',eventIds:[e.eventId]}]}}),/V3_UNKNOWN_PSYCHOLOGY_EVIDENCE/);assert.equal(f.count(),0);
 assert.throws(()=>f.update({psychology:{update:[{id:'psyche:missing',text:'不存在的条目',reason:'非法'}]}}),/V3_UNKNOWN_PSYCHOLOGY_THREAD/);assert.equal(f.count(),0);
 assert.throws(()=>f.update({appraisal:{emotions:{anger:2}}}),/INVALID_APPRAISAL/);assert.equal(f.count(),0);
});
test('actual structured feeling source encodes with correct self ownership/current root; an old summary cannot be quoted as new',t=>{
 const f=fixture(t),text='这次觉得“被听见”\n可以慢慢接话。',out=f.update({psychology:{add:[{text,reason:'本轮真实选择的自我表达。'}]}}),d=f.archived(out);
 const event=f.r.store.db.prepare('SELECT event_root FROM cognitive_events WHERE character_id=? AND event_id=?').get(f.r.characterId,out.pendingInnerIntegration);
 assert.equal(d.kind,'experience');assert.equal(d.metadata.speakerId,f.r.characterId);assert.equal(d.metadata.scope,f.scope);assert.equal(d.metadata.privacyLabel,'private');assert.equal(d.metadata.explicitExperience,true);
 assert.ok(d.metadata.basisSources.some(x=>x.sourceId===f.current.sourceId));assert.ok(!d.metadata.basisSources.some(x=>x.sourceId===f.old.sourceId));assert.equal(event.event_root,'resource:chat:101:user:current');
 const material={ref:'r1',sourceId:d.sourceId,revision:d.revision,text:d.text,textFormat:sourceTextFormat(d.text),sourceOffset:0,eventRoot:event.event_root,outcome:'observed',metadata:d.metadata,occurredAt:f.r.now(),observedAt:f.r.now()};
 const raw={summary:'本轮被听见的感受',memories:[{kind:'experience',gist:'这轮感到被听见。',reaction:text,intensity:.1,lastingness:.1,confidence:.8,evidence:[{ref:'r1',quote:text}]}]};
 const saved=f.r.retainValidated(raw,[material]),m=f.r.store.get(saved.ids[0]);assert.equal(m.kind,'experience');assert.equal(m.event_root,event.event_root);assert.equal(m.metadata.reaction,text);assert.ok(!m.metadata.sourceTyping);assert.ok(m.evidence.some(e=>e.sourceId===d.sourceId&&e.revision===d.revision));assert.ok(m.participants.some(p=>p.entity_id===f.r.characterId));
 assert.throws(()=>f.r.retainValidated({summary:'错误旧摘要',memories:[{kind:'experience',gist:'错误地当新体验',evidence:[{ref:'r1',quote:OLD}]}]},[material]),/QUOTE_NOT_IN_SOURCE/);
 assert.equal(f.r.policy.core().find(c=>!c.locked).revision,1);
});
