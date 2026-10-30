import test from 'node:test';import assert from 'node:assert/strict';
import {createGrowthFixture} from './growth-fixture.mjs';
import {roundReflectionEvents,currentRoundTriggerIds,reflectionIsHistorical} from '../src/cognition/current-reflection.js';
import {decisionProvenance} from '../src/cognition/action-provenance.js';
function fixture(t){const f=createGrowthFixture({label:'current-config',think:()=>{throw Error('NO_MODEL_CALL_EXPECTED');}});t.after(()=>f.close());let n=0;const r=f.r,i=r.inner;
 const event=(kind,{adapter='controlled-fixture',sourceKind='tool-result',historical=false,metadata={},when=r.now(),text='actual new bounded reading',eventKind=kind}={})=>r.observe({adapter,externalId:'cfg-test-'+n++,kind:sourceKind,text,occurredAt:when,metadata:{speakerId:r.characterId,scope:'self',explicitObservation:sourceKind!=='configuration',...(historical?{historical:true}:{}),...metadata}},{kind:eventKind,eventRoot:'cfg-event-'+n,outcome:'observed'});
 const behavior=kind=>({kind,scope:'self',eventScope:'self',startedAt:r.now(),endedAt:r.now(),eventWatermark:0});return {...f,r,i,event,behavior};}

test('fresh self-reading plus a legacy migration is a current trigger; the original mixed set remains rejected by unchanged provenance',t=>{
 const f=fixture(t),old=f.event('configuration-imported',{adapter:'disposition-migration',sourceKind:'configuration',historical:true,when:null,metadata:{notPrimaryEvidence:true}}),fresh=f.event('perception-observed'),raw=[old.eventId,fresh.eventId];
 const original=decisionProvenance(f.i,{eventIds:raw});assert.equal(original.executable,false);assert.equal(original.reason,'retrospective-source');
 const ids=roundReflectionEvents({runtime:f.r},f.behavior('web'),raw);assert.deepEqual(ids,[fresh.eventId]);assert.equal(reflectionIsHistorical(f.r,ids),false);const repaired=decisionProvenance(f.i,{eventIds:ids});assert.equal(repaired.executable,true);assert.deepEqual(repaired.freshEventIds,[fresh.eventId]);
 assert.equal(f.r.archive.get(old.sourceId,old.revision).status,'available');assert.equal(f.i.db.prepare('SELECT count(*) n FROM v3_inner_intake WHERE event_id=?').get(old.eventId).n,0);
});
test('the same classification repairs supplied legacy queued IDs for every supported I/O behavior',t=>{
 const f=fixture(t),old=f.event('configuration-imported',{adapter:'inner-config',sourceKind:'configuration',historical:true,when:null}),fresh=f.event('perception-observed');
 for(const kind of ['chat','web','bili','qzone'])assert.deepEqual(roundReflectionEvents({runtime:f.r},f.behavior(kind),[old.eventId,fresh.eventId]),[fresh.eventId]);
});
test('current configuration sources in the additional round events are also excluded, not only old supplied IDs',t=>{
 const f=fixture(t),old=f.event('configuration-imported',{sourceKind:'configuration',metadata:{notPrimaryEvidence:true}}),fresh=f.event('perception-observed');assert.deepEqual(roundReflectionEvents({runtime:f.r},f.behavior('web'),[]),[fresh.eventId]);assert.ok(f.r.archive.get(old.sourceId,old.revision));
});
test('configuration-only/no-read does not create a current action or invent another source',async t=>{
 const f=fixture(t),old=f.event('configuration-imported',{adapter:'disposition-migration',sourceKind:'configuration',historical:true,when:null}),before=f.r.store.db.prepare('SELECT count(*) n FROM cognitive_events').get().n;
 const ids=roundReflectionEvents({runtime:f.r},f.behavior('web'),[old.eventId]);assert.deepEqual(ids,[]);const p=decisionProvenance(f.i,{eventIds:ids});assert.equal(p.executable,false);assert.equal(p.reason,'no-current-observation');const reflected=await f.i.reflect({eventIds:ids,key:'configuration-only-filtered'});assert.equal(reflected.status,'no-change');assert.equal(f.r.store.db.prepare('SELECT count(*) n FROM cognitive_events').get().n,before);assert.equal(f.r.model.receipts.length,0);
});
test('ordinary historical and forwarded material is retained and still fails the existing retrospective-source gate',t=>{
 const f=fixture(t),history=f.event('chat-received',{adapter:'history-fixture',sourceKind:'forwarded-chat',historical:true,metadata:{providedHistory:true,forwardedAuthorId:'qq:101'}}),fresh=f.event('perception-observed'),ids=roundReflectionEvents({runtime:f.r},f.behavior('web'),[history.eventId,fresh.eventId]);assert.deepEqual(ids,[history.eventId,fresh.eventId]);const p=decisionProvenance(f.i,{eventIds:ids});assert.equal(p.executable,false);assert.equal(p.reason,'retrospective-source');
});
test('unclassified source material is not silently removed as configuration',t=>{
 const f=fixture(t),unknown=f.event('fixture-material',{sourceKind:'unknown-material',historical:true}),fresh=f.event('perception-observed'),ids=currentRoundTriggerIds(f.r,f.behavior('web'),[unknown.eventId,fresh.eventId]);assert.deepEqual(ids,[unknown.eventId,fresh.eventId]);assert.equal(decisionProvenance(f.i,{eventIds:ids}).reason,'retrospective-source');
});
test('non-I/O maintenance keeps its old classification and cannot be promoted through this filter',t=>{
 const f=fixture(t),old=f.event('configuration-imported',{adapter:'disposition-migration',sourceKind:'configuration',historical:true}),fresh=f.event('perception-observed'),ids=currentRoundTriggerIds(f.r,f.behavior('organize'),[old.eventId,fresh.eventId]);assert.deepEqual(ids,[old.eventId,fresh.eventId]);assert.equal(decisionProvenance(f.i,{eventIds:ids}).executable,false);
});
test('a native current action can be proposed after the filtered reading; source withdrawal still revokes it',t=>{
 const f=fixture(t),old=f.event('configuration-imported',{adapter:'disposition-migration',sourceKind:'configuration',historical:true,when:null}),fresh=f.event('perception-observed'),ids=roundReflectionEvents({runtime:f.r},f.behavior('web'),[old.eventId,fresh.eventId]);f.r.store.ensureEntity('qq:101');
 f.i.apply({summary:'新读到的片段让我想分享一句。',decision:{kind:'chat',personId:'qq:101',intent:'分享新读到的小片段。',objectIds:[]}},{expectedGeneration:f.i.head().generation,eventIds:ids,key:'filtered-current-choice'});const a=f.i.candidate('qq:101');assert.ok(a);assert.equal(f.i.actionProvenance(a.object_id,a.revision).origin,'current-observation');f.r.archive.erase(fresh.sourceId);assert.equal(f.i.candidate('qq:101'),null);assert.equal(f.i.actionIsCurrent(a),false);
});
test('a later role epoch cannot execute a proposal created from the old current reading',t=>{
 const f=fixture(t),fresh=f.event('perception-observed'),ids=roundReflectionEvents({runtime:f.r},f.behavior('web'),[fresh.eventId]);f.r.store.ensureEntity('qq:101');f.i.apply({summary:'想分享本次片段。',decision:{kind:'chat',personId:'qq:101',intent:'只分享本次实际读到的内容。',objectIds:[]}},{expectedGeneration:f.i.head().generation,eventIds:ids,key:'old-role-choice'});const a=f.i.candidate('qq:101');assert.ok(a);f.r.store.db.prepare('UPDATE character_manifest SET role_epoch=role_epoch+1 WHERE singleton=1').run();assert.equal(f.i.actionIsCurrent(a),false);assert.equal(f.i.beginAction(a,Object.fromEntries(['authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready'].map(x=>[x,true]))),null);
});
