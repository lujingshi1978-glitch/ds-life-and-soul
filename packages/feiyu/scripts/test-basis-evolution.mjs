import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CharacterCognition} from '../src/cognition/service.js';
import {classifyProjectionBasisChange,reconcilePsycheProjectionBasis,psycheBasisSnapshot} from '../src/cognition/basis-sources.js';
import {buildTrace} from '../src/life-trace-view.js';

const home=path.resolve(import.meta.dirname,'../../../.local'),base=path.join(home,'test-data','basis-audit');fs.mkdirSync(base,{recursive:true});const checks=[];
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function scenario(name,fn){test(name,async t=>{try{const evidence=await fn(t);checks.push({name,passed:true,evidence:evidence||{}});}catch(e){checks.push({name,passed:false,error:e.code||e.message});throw e;}});}
after(()=>{const dir=path.join(home,'reports');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'basis-results.json'),JSON.stringify({at:new Date().toISOString(),pass:checks.filter(x=>x.passed).length,fail:checks.filter(x=>!x.passed).length,passed:checks.every(x=>x.passed),modelCalls:0,productionOperations:0,scope:'Typed classification plus native persisted SQLite offline mutation/reconciliation/restart tests; not a model semantic-growth experiment',checks},null,2));});

scenario('classification distinguishes availability-only evolution from changed bytes, versions, missing detail and uncertain/invalid memory',()=>{
 const prior={id:'memory:unit',revision:1,currentRevision:1,status:'active',detailState:'available',versionHash:'pinned-version-bytes',snapshotHash:'pinned-snapshot-bytes',suppressed:false};
 const unchanged=classifyProjectionBasisChange('memory',prior,{...prior,invalidatedAt:null});assert.equal(unchanged.kind,'unchanged');
 for(const a of ['active','faded','outdated'])for(const b of ['active','faded','outdated']){const actual=classifyProjectionBasisChange('memory',{...prior,status:a},{...prior,status:b,invalidatedAt:null});assert.equal(actual.kind,a===b?'unchanged':'normal-evolution',a+'→'+b);}
 const mutations=[{currentRevision:2},{revision:2},{versionHash:'corrected-version'},{versionHash:null},{snapshotHash:'changed-snapshot'},{snapshotHash:null},{detailState:'gist_only'},{detailState:'none'},{status:'contested'},{status:'candidate'},{status:null},{invalidatedAt:42},{status:'outdated',versionHash:'corrected-while-retired'}];
 for(const patch of mutations)assert.equal(classifyProjectionBasisChange('memory',prior,{...prior,invalidatedAt:null,...patch}).kind,'review-required',JSON.stringify(patch));
 assert.equal(classifyProjectionBasisChange('memory',prior,null).kind,'review-required');
 for(const patch of [{status:'forgotten'},{status:'redacted'},{suppressed:true}])assert.equal(classifyProjectionBasisChange('memory',prior,{...prior,...patch}).kind,'privacy-withdrawn');
 return {availabilityTransitions:9,reviewMutations:mutations.length,privacyMutations:3};
});

scenario('source classification retains exact checksum/permission/version checks and legacy memory qualification',()=>{
 const prior={sourceId:'source:unit',revision:1,headRevision:1,headEpoch:1,headStatus:'available',effectStatus:'available',documentStatus:'available',documentHash:'exact-pinned-document',suppressed:false};
 assert.equal(classifyProjectionBasisChange('source',prior,{...prior}).kind,'unchanged');
 for(const patch of [{revision:2},{headRevision:2},{headEpoch:2},{headStatus:'pending'},{effectStatus:'superseded'},{documentHash:'changed-checksum-body-or-permission'},{documentStatus:null},{documentHash:null}])assert.equal(classifyProjectionBasisChange('source',prior,{...prior,...patch}).kind,'review-required',JSON.stringify(patch));
 assert.equal(classifyProjectionBasisChange('source',prior,{...prior},{usable:false}).kind,'review-required');
 for(const patch of [{documentStatus:'deleted'},{headStatus:'deleted'},{suppressed:true}])assert.equal(classifyProjectionBasisChange('source',prior,{...prior,...patch}).kind,'privacy-withdrawn');
 const legacy={id:'memory:old',revision:1,currentRevision:1,status:'active',detailState:'available',versionHash:'v',snapshotHash:'s',suppressed:false};
 assert.equal(classifyProjectionBasisChange('memory',{},legacy).kind,'review-required');assert.equal(classifyProjectionBasisChange('memory',{}, {...legacy,currentRevision:2}).kind,'review-required');
 return {sourceReviewMutations:9,sourcePrivacyMutations:3,legacyWithoutOldBytesHeldForReview:true};
});

scenario('legacy empty observation is unverified even with current detail/snapshot; missing availability stays blocked',()=>{
 const current={id:'memory:legacy',revision:1,currentRevision:1,status:'active',detailState:'available',versionHash:'pinned-v1',snapshotHash:'present-snapshot',suppressed:false,invalidatedAt:null};
 const available=classifyProjectionBasisChange('memory',{},current);assert.equal(available.kind,'review-required');assert.equal(available.reason,'legacy-basis-unverifiable');
 for(const patch of [{detailState:'gist_only'},{detailState:null},{snapshotHash:null}]){const result=classifyProjectionBasisChange('memory',{}, {...current,...patch});assert.equal(result.kind,'review-required');assert.equal(result.reason,'legacy-memory-availability-unproven');}
 return {currentlyAvailableStillUnverified:true,downgradedOrUnprovenCases:3};
});

function fixture(t){
 const root=fs.mkdtempSync(path.join(base,'basis-')),characterId='character:basis-audit',at=Date.parse('2026-10-30T03:00:00Z');let r,n=0;
 const open=()=>{r=new CharacterCognition({root,characterId,embedding:null,now:()=>at});r.model.think=()=>{throw Error('MODEL_FORBIDDEN');};r.enableInner();return r;};
 r=new CharacterCognition({root,characterId,embedding:null,now:()=>at});r.policy.seed({identity:{text:'隔离复核角色。\n## 核心愿望\n成长有来源，隐私有边界。',locked:true}});r.enableInner();r.model.think=()=>{throw Error('MODEL_FORBIDDEN');};r.store.ensureEntity('qq:101');
 const core=hash(r.policy.core().filter(x=>x.locked).map(x=>({field:x.field,revision:x.revision,body:x.body})));
 t.after(async()=>{assert.equal(hash(r.policy.core().filter(x=>x.locked).map(x=>({field:x.field,revision:x.revision,body:x.body}))),core);assert.equal(r.model.receipts.length,0);await r.close();const target=path.resolve(root);assert.ok(target.startsWith(base+path.sep)&&path.basename(target).startsWith('basis-'));fs.rmSync(target,{recursive:true,force:true});});
 const observe=text=>r.observe({adapter:'basis-native',externalId:'source-'+n++,kind:'chat',text,occurredAt:at,metadata:{scope:'private:101',speakerId:'qq:101',conversationPeerId:'qq:101'}},{kind:'experience-recorded',outcome:'observed',eventRoot:'basis:'+n});
 const a=observe('第一份实际来源，关系印象的起点。'),b=observe('第二份实际来源，交往中的独立补充。'),id='memory:basis-shared',canary='BASIS-PRIVATE-TWO-SOURCES';
 r.store.addNodes([{id,kind:'relationship',gist:'两次交往让我觉得可以慢慢相处。'+canary,detail:'实际有两份来源，不是两次重复阅读。',epistemic:'interpreted',participants:[{entityId:'qq:101',role:'target'}],evidence:[{sourceId:a.sourceId,revision:a.revision},{sourceId:b.sourceId,revision:b.revision}],metadata:{scope:'private:101',selfInterpretation:true}}]);
 const apply=(e,summary,{memoryIds=[id]}={})=>r.inner.apply({summary,changes:[]},{expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],memoryIds,key:'apply-'+n++});
 apply(b,'两次交往中形成的感受。'+canary);const before=r.inner.psyche.current({includeInvalid:true});assert.equal(before.status,'valid');
 return {get r(){return r;},id,a,b,canary,observe,apply,before,reopen:async()=>{await r.close();return open();}};
}

for(const status of ['faded','outdated'])scenario('two-source pinned memory '+status+' is retained through two native restarts without recurring review',async t=>{
 const f=fixture(t),db=f.r.store.db,prior=psycheBasisSnapshot(f.r,{memoryRefs:[{id:f.id,revision:1}]}).memories[0];
 db.prepare('UPDATE memory_nodes SET status=? WHERE memory_id=?').run(status,f.id);const report=reconcilePsycheProjectionBasis(f.r);assert.equal(report.changedMemories,0);assert.ok(report.changes.some(x=>x.kind==='normal-evolution'));
 const after=psycheBasisSnapshot(f.r,{memoryRefs:[{id:f.id,revision:1}]}).memories[0];assert.equal(prior.versionHash,after.versionHash);assert.equal(prior.snapshotHash,after.snapshotHash);
 assert.equal(f.r.inner.psyche.current().revision,f.before.revision);await f.reopen();assert.equal(f.r.inner.psyche.current().revision,f.before.revision);await f.reopen();assert.equal(f.r.inner.psyche.current().revision,f.before.revision);
 assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'valid');return {sources:2,status,projectionRevision:f.before.revision,restarts:2,normalEvolutionReported:true};
});

const memoryMutations={
 'current-revision-advance':f=>f.r.lifecycle.revise(f.id,1,{}),
 'same-version-content-change':f=>f.r.store.db.prepare('UPDATE memory_versions SET gist=? WHERE memory_id=? AND revision=1').run('精确版本字节被离线改动。',f.id),
 'snapshot-bytes-change':f=>f.r.store.db.prepare('UPDATE v3_memory_snapshots SET body=? WHERE memory_id=? AND revision=1').run('{"gist":"不同的快照内容"}',f.id),
 'snapshot-missing':f=>f.r.store.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=1').run(f.id),
 'detail-withdrawn':f=>f.r.store.db.prepare("UPDATE memory_nodes SET detail_state='gist_only' WHERE memory_id=?").run(f.id),
 'contested':f=>f.r.store.db.prepare("UPDATE memory_nodes SET status='contested' WHERE memory_id=?").run(f.id),
 'invalidated':f=>f.r.store.db.prepare('UPDATE memory_nodes SET invalidated_at=? WHERE memory_id=?').run(42,f.id),
 'exact-version-missing':f=>{const db=f.r.store.db;db.exec('PRAGMA foreign_keys=OFF');db.prepare('DELETE FROM memory_versions WHERE memory_id=? AND revision=1').run(f.id);db.exec('PRAGMA foreign_keys=ON');}
};
for(const [name,mutate]of Object.entries(memoryMutations))scenario('offline '+name+' is review-required rather than normal growth',t=>{
 const f=fixture(t);mutate(f);const report=reconcilePsycheProjectionBasis(f.r);assert.ok(report.changedMemories>0);assert.ok(report.changes.some(x=>x.kind==='review-required'));assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'needs-review');
 const graph=buildTrace(f.r,{type:'mood',id:'current',maxNodes:100,maxDepth:6});assert.ok(!JSON.stringify(graph).includes(f.canary));return {mutation:name,changedMemories:report.changedMemories,status:'needs-review',canaryExposed:false};
});

for(const mutation of ['detail-withdrawn','snapshot-missing'])scenario('legacy empty observation still detects offline '+mutation+' in native reconciliation',t=>{
 const f=fixture(t);f.r.store.db.prepare("UPDATE v3_psyche_projection_dependencies SET observation_json='{}' WHERE kind='memory' AND target_id=?").run(f.id);memoryMutations[mutation](f);
 const report=reconcilePsycheProjectionBasis(f.r);assert.ok(report.changedMemories>0);assert.ok(report.changes.some(x=>x.basisKind==='memory'&&x.reason==='legacy-memory-availability-unproven'));assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'needs-review');
 assert.ok(!JSON.stringify(buildTrace(f.r,{type:'mood',id:'current',maxNodes:100,maxDepth:6})).includes(f.canary));return {legacyObservationEmpty:true,mutation,status:'needs-review',canaryExposed:false};
});

scenario('unverifiable legacy basis waits once for normal re-integration, then modern snapshots survive repeated native startup',async t=>{
 const f=fixture(t);f.r.store.db.prepare("UPDATE v3_psyche_projection_dependencies SET observation_json='{}' WHERE kind='memory' AND target_id=?").run(f.id);
 const report=reconcilePsycheProjectionBasis(f.r);assert.ok(report.changes.some(x=>x.reason==='legacy-basis-unverifiable'));assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'needs-review');
 const actual=f.observe('今天新的实际来信：我愿意继续慢慢相处。');f.apply(actual,'这次真实来信让我重新理解当前的相处方式。');const fresh=f.r.inner.psyche.current({includeInvalid:true});assert.equal(fresh.status,'valid');assert.ok(fresh.revision>f.before.revision);
 const observation=JSON.parse(f.r.store.db.prepare("SELECT observation_json FROM v3_psyche_projection_dependencies WHERE revision=? AND kind='memory' AND target_id=?").get(fresh.revision,f.id).observation_json);assert.ok(observation.versionHash&&observation.snapshotHash);assert.equal(observation.detailState,'available');
 await f.reopen();assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'valid');assert.equal(f.r.inner.psyche.current().revision,fresh.revision);await f.reopen();assert.equal(f.r.inner.psyche.current().revision,fresh.revision);
 assert.equal(reconcilePsycheProjectionBasis(f.r).changedMemories,0);return {legacyHeld:true,actualNewInput:true,reintegratedProjection:fresh.revision,modernBasisPresent:true,restarts:2,noReviewLoop:true};
});

const sourceMutations={
 'checksum-change':f=>f.r.archive.db.prepare('UPDATE documents SET checksum=? WHERE source_id=? AND revision=?').run('offline-changed-checksum',f.a.sourceId,f.a.revision),
 'metadata-permission-change':f=>{const db=f.r.archive.db,row=db.prepare('SELECT metadata FROM documents WHERE source_id=? AND revision=?').get(f.a.sourceId,f.a.revision),metadata={...JSON.parse(row.metadata),privacyLabel:'private-restricted'};db.prepare('UPDATE documents SET metadata=? WHERE source_id=? AND revision=?').run(JSON.stringify(metadata),f.a.sourceId,f.a.revision);},
 'source-head-epoch-change':f=>f.r.store.db.prepare('UPDATE v3_source_heads SET epoch=epoch+1 WHERE source_id=?').run(f.a.sourceId),
 'exact-source-missing':f=>{const db=f.r.archive.db;db.exec('PRAGMA foreign_keys=OFF');db.prepare('DELETE FROM documents WHERE source_id=? AND revision=?').run(f.a.sourceId,f.a.revision);db.exec('PRAGMA foreign_keys=ON');}
};
for(const [name,mutate]of Object.entries(sourceMutations))scenario('offline '+name+' keeps source integrity/permission review active',t=>{
 const f=fixture(t);mutate(f);const report=reconcilePsycheProjectionBasis(f.r);assert.ok(report.changedSources>0);assert.ok(report.changes.some(x=>x.basisKind==='source'&&x.kind==='review-required'));assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'needs-review');
 assert.ok(!JSON.stringify(buildTrace(f.r,{type:'mood',id:'current',maxNodes:100,maxDepth:6})).includes(f.canary));return {mutation:name,changedSources:report.changedSources,canaryExposed:false};
});

for(const kind of ['deleted-source','suppressed-source','forgotten-memory','suppressed-memory'])scenario('offline '+kind+' still redacts affected historical and present psychology',t=>{
 const f=fixture(t),db=f.r.store.db;
 if(kind==='deleted-source')f.r.archive.db.prepare("UPDATE documents SET status='deleted',body='',metadata='{}' WHERE source_id=?").run(f.a.sourceId);
 else if(kind==='forgotten-memory')db.prepare("UPDATE memory_nodes SET status='forgotten' WHERE memory_id=?").run(f.id);
 else db.prepare('INSERT INTO suppression(character_id,target_type,target_id,reason_code,created_at) VALUES(?,?,?,?,?)').run(f.r.characterId,kind==='suppressed-source'?'source':'memory',kind==='suppressed-source'?f.a.sourceId:f.id,'explicit-private-withdrawal',Date.now());
 const report=reconcilePsycheProjectionBasis(f.r);assert.ok(report.redactedSources+report.redactedMemories>0);
 for(const query of [{type:'mood',id:'current'},{type:'mood',id:'current',revision:f.before.revision},{type:'memory',id:f.id,revision:1}])assert.ok(!JSON.stringify(buildTrace(f.r,{...query,maxNodes:100,maxDepth:6})).includes(f.canary));
 const historic=db.prepare('SELECT status,body FROM v3_psyche_projection_versions WHERE revision=?').get(f.before.revision);assert.equal(historic.status,'redacted');assert.ok(!historic.body.includes(f.canary));return {kind,redactedSources:report.redactedSources,redactedMemories:report.redactedMemories,historicalBodyRedacted:true};
});

scenario('independently reintegrated new projection survives restarts while a later historic privacy withdrawal still erases only affected history',async t=>{
 const f=fixture(t);f.r.lifecycle.revise(f.id,1,{gist:'明确纠正这份旧印象，不再沿用旧解释。'});assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'needs-review');
 const fresh=f.observe('今天想聊窗外的雨，与之前那件事无关。');f.apply(fresh,'今天的新来信让我想安静听雨。',{memoryIds:[]});const current=f.r.inner.psyche.current({includeInvalid:true});assert.equal(current.status,'valid');assert.ok(!JSON.stringify(current).includes(f.canary));
 await f.reopen();assert.equal(f.r.inner.psyche.current().revision,current.revision);assert.equal(reconcilePsycheProjectionBasis(f.r).changedMemories,0);
 // Persist an actual privacy withdrawal in the archive while the process is
 // offline from the perspective of the cached basis, then use normal startup.
 f.r.archive.db.prepare("UPDATE documents SET status='deleted',body='',metadata='{}' WHERE source_id=?").run(f.a.sourceId);await f.reopen();
 assert.equal(f.r.inner.psyche.current({includeInvalid:true}).status,'valid');assert.equal(f.r.inner.psyche.current().revision,current.revision);
 const historic=f.r.store.db.prepare('SELECT status,body FROM v3_psyche_projection_versions WHERE revision=?').get(f.before.revision);assert.equal(historic.status,'redacted');assert.ok(!historic.body.includes(f.canary));
 const graph=buildTrace(f.r,{type:'inner',id:f.r.inner.head().state_id,revision:f.r.inner.head().state_revision,maxNodes:100,maxDepth:6});assert.ok(!graph.nodes.find(n=>n.key===graph.focus).unavailable);assert.ok(!JSON.stringify(graph).includes(f.canary));assert.ok(graph.partial);
 return {currentProjection:current.revision,currentStillValid:true,historicalProjection:f.before.revision,historicalRedacted:true,restarts:2,partialTreeNoCanary:true};
});
