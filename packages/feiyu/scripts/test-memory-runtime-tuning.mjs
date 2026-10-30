import {createGrowthFixture,localModelReply} from './growth-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';
import {defaultRuntimeTuning,mergeRuntimeTuning} from '../src/runtime-tuning.js';
import {embeddingSelection,embeddingCompatibilityStatus,localEmbedding} from '../src/cognition/embedding.js';
import {modelMemoryView} from '../src/cognition/model-view.js';
import {buildPsychologyCompression} from '../src/cognition/psyche-compression.js';
import {feelingUpdate} from '../src/cognition/feeling-protocol.js';
import {DialogueAssociations} from '../src/cognition/dialogue-associations.js';
import {readCurrentInner} from '../src/cognition/current-context.js';
import {Consolidator} from '../src/cognition/consolidate.js';
import {ContextCompiler} from '../src/cognition/context.js';

function fixture(t,{inner=true,characterId='character:tuning-fixture'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-memory-tuning-'));let values=defaultRuntimeTuning();
 const r=new CharacterCognition({root,characterId,embedding:null,runtimeTuning:()=>values,now:()=>Date.parse('2026-10-28T12:00:00+08:00')});
 r.policy.seed({identity:{text:'认识世界，形成自己的判断，珍惜关系。'}});if(inner)r.enableInner();
 t.after(async()=>{await r.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('feiyu-memory-tuning-'));fs.rmSync(root,{recursive:true,force:true});});
 return {r,root,set(patch){values=mergeRuntimeTuning(values,patch);return values;},get:()=>values};
}
function memory(r,n,{text='陶艺 pottery 实际读到的一段材料。'.repeat(30),gist='陶艺 pottery 的第'+n+'段材料。'.repeat(10),metadata={}}={}){
 const e=r.observe({adapter:'tuning-fixture',externalId:'source-'+n,kind:'web-reading',text,metadata:{scope:'self',speakerId:r.characterId,privacyLabel:'public',explicitObservation:true}},{kind:'perception-observed',eventRoot:'event-'+n});
 const id=r.store.atomic('test-memory',()=>{const id=r.store.writeNode({kind:'knowledge',gist,detail:text,eventRoot:'event-'+n,epistemic:'observed',participants:[{entityId:r.characterId,role:'subject'}],evidence:[{sourceId:e.sourceId,revision:e.revision,span:{offset:0,length:text.length},role:'supports'}],metadata:{publicEvidence:true,...metadata}});return {id,affected:[id]};}).id;
 return {id,e,m:r.store.get(id)};
}
const adapter=(model,dimensions)=>({modelId:model,dimensions,remote:false,searchTimeoutMs:5000,embed:async texts=>texts.map(()=>Array(dimensions).fill(1))});
const config=(modelId,dimensions)=>({enabled:true,endpoint:'http://127.0.0.1:43114/v1/embeddings',modelId,dimensions,token:'fixture-local-embedding-token-long-enough-000'});

test('configured memory budgets change actual V3 packs and invalidate recall cache without altering memories',async t=>{
 const f=fixture(t),rows=Array.from({length:4},(_,n)=>memory(f.r,n));
 f.set({memory:{recallBudgetChars:12000,maxRecallItems:4}});const high=await f.r.retriever.recall('pottery');assert.equal(high.items.length,4);
 f.set({memory:{maxRecallItems:1}});const one=await f.r.retriever.recall('pottery');assert.equal(one.items.length,1);
 f.set({memory:{recallBudgetChars:200}});const tiny=await f.r.retriever.recall('pottery');assert.ok(tiny.chars<=200);assert.equal(tiny.items.length,0);assert.equal(tiny.omittedForBudget,true);assert.match(tiny.missing,/不表示没有/);
 assert.equal(f.r.store.list({kinds:['knowledge']}).length,4);for(const row of rows)assert.equal(f.r.store.get(row.id).detail,row.m.detail);
});

test('a configured item limit never splits a contradiction bundle to hide counter-evidence',t=>{
 const f=fixture(t),a=memory(f.r,1),b=memory(f.r,2);f.r.store.connect(a.id,b.id,'contradicts',{provenance:'explicit_evidence',evidence:[]});
 f.set({memory:{maxRecallItems:1,recallBudgetChars:12000}});assert.equal(f.r.retriever.pack([a.m],{budgetChars:12000}).items.length,0);
 f.set({memory:{maxRecallItems:2}});const packed=f.r.retriever.pack([a.m],{budgetChars:12000});assert.equal(packed.items.length,2);assert.equal(packed.bundles[0].conflict,true);
});

test('an explicit 2200 character budget preserves both short conflicting attitudes with a UUID-length character identity',async t=>{
 const f=fixture(t,{characterId:'character:qq-00000000-0000-4000-8000-000000000001'}),r=f.r;
 const observe=(id,text)=>r.observe({adapter:'test-chat',externalId:id,kind:'chat',text,metadata:{speakerId:'qq:100001',conversationPeerId:'qq:100001',scope:'private:100001'}},{kind:'message-received',eventRoot:id});
 const remember=(e,text,key,extra={})=>r.inner.apply({summary:'我有自己的感受，旧想法仍在。',changes:[],dispositions:[{kind:'attitude',target:'qq:100001',facet:'相处',text,reason:'这次真实交谈使我有了这个感受',...extra}]},{expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],key});
 remember(observe('trust','你那次说的话我认真听了'),'我信任他认真听我说话。','trust');const old=r.dispositions.rows()[0];remember(observe('anger','刚才拿你在意的事开玩笑了'),'我还是信任他，但这次玩笑让我生气，暂时不想接话。','anger',{transition:'coexist',previousId:old.id,expectedRevision:old.revision});
 const found=await r.retriever.recall('信任 生气 玩笑',{budgetChars:2200});assert.equal(found.items.length,2);assert.ok(found.items.some(m=>m.id===old.id));assert.ok(found.chars<=2200);assert.equal(found.bundles[0].conflict,true);for(const m of found.items){assert.equal(m.subjectId,r.characterId);assert.equal(m.disposition.target,'qq:100001');assert.equal(m.evidence.length,1);assert.equal(m.evidenceOrigin.selfActionConfirmed,false);}
});

test('chat associations refresh on setting changes and fit even the smallest configured injection budget',async t=>{
 const f=fixture(t);for(let n=0;n<4;n++)memory(f.r,n);
 const a=new DialogueAssociations({runtime:f.r,isV3:true,closed:false,contacts:{recent:()=>[]}});t.after(()=>a.close());
 f.set({memory:{associationBudgetChars:12000,dialogueBudgetChars:12000,associationMaxItems:4}});
 await a.prepare('private:101',{incoming:'pottery'});const full=a.view('private:101',{incoming:'pottery'});assert.equal(full.memories.length,4);
 f.set({memory:{elasticRecallEnabled:0,associationMaxItems:1,dialogueBudgetChars:300}});await a.prepare('private:101',{incoming:'pottery'});const short=a.view('private:101',{incoming:'pottery'});assert.ok(JSON.stringify(short).length<=300);assert.ok(short.memories.length<=1);assert.equal(short.referenceOnly,true);
 assert.equal(f.r.store.list({kinds:['knowledge']}).length,4);
});

test('model views and archive reads obey live configured lengths while full original data survives',t=>{
 const f=fixture(t),row=memory(f.r,1,{text:'原始资料'.repeat(2000),gist:'pottery 陶艺'.repeat(40)});
 f.set({text:{memoryGistChars:100},memory:{detailChars:120,resourceReadChars:500}});
 const v=modelMemoryView(row.m,{runtimeTuning:f.r.runtimeTuning});assert.equal([...v.gist].length,100);assert.equal([...v.detail].length,120);assert.equal(v.partial,true);
 const h=f.r.openConversation('qq:101');const read=f.r.readArchive(h,row.e.sourceId,row.e.revision,{limit:20000,maxChars:60000});assert.equal(read.text.length,500);assert.equal(read.origin,'archive-not-memory');
 assert.ok(f.r.archive.get(row.e.sourceId,row.e.revision).text.length>500);
});

test('expanded memory tools page real details within configured budgets and larger settings genuinely reveal more',t=>{
 const f=fixture(t),duplicate='不能从元数据绕过详情预算'.repeat(1000),row=memory(f.r,1,{text:'保留的完整资料'.repeat(1000),gist:'pottery '.repeat(80),metadata:{knowledgeEntry:{usageNotes:duplicate},expressionFeedback:{target:'private:101',sourceScope:'private:101',explicit:true}}}),h=f.r.openConversation('qq:101');
 f.set({memory:{detailChars:100},text:{memoryGistChars:100}});const first=f.r.expand(h,row.id,{limit:9000});assert.equal([...first.detail].length,100);assert.equal([...first.gist].length,100);assert.equal(first.partial,true);assert.equal(first.nextDetailOffset,100);assert.equal(first.detailTotalChars,[...row.m.detail].length);assert.deepEqual(first.evidence,row.m.evidence);
 const second=f.r.expand(h,row.id,{offset:first.nextDetailOffset});assert.equal(second.detail,[...row.m.detail].slice(100,200).join(''));assert.equal(second.detailOffset,100);
 assert.equal(JSON.stringify(first).includes(duplicate),false);assert.equal(first.metadata.expressionFeedback.target,'private:101');assert.equal(f.r.store.get(row.id).metadata.knowledgeEntry.usageNotes,duplicate);
 f.set({memory:{detailChars:4000},text:{memoryGistChars:1000}});const more=f.r.expand(h,row.id);assert.equal([...more.detail].length,4000);assert.equal(more.gist,row.m.gist);assert.equal(f.r.store.get(row.id).detail,row.m.detail);
 assert.throws(()=>f.r.expand(h,row.id,{offset:-1}),e=>e.code==='INVALID_MEMORY_PAGE');
});

test('the legacy context window fits serialized text including escaping and marks long input as a partial view',t=>{
 const f=fixture(t);f.set({text:{liveChatChars:1000}});const c=new ContextCompiler(f.r),text='\\"真实原话🙂'.repeat(500);c.append('fixture',{speakerId:'qq:101',text});
 const view=c.live.get('fixture');assert.ok(JSON.stringify(view).length<=1000);assert.equal(view[0].partial,true);assert.equal(view[0].sourceTextChars,[...text].length);assert.ok(text.startsWith(view[0].text));
 f.set({text:{liveChatChars:10000}});c.append('larger',{speakerId:'qq:101',text});assert.ok(c.live.get('larger')[0].text.length>view[0].text.length);
 c.append('unicode-large',{speakerId:'qq:101',text:'🙂'.repeat(130000)});assert.ok(JSON.stringify(c.live.get('unicode-large')).length<=10000);assert.equal(c.live.get('unicode-large')[0].sourceTextChars,130000);
});

test('raising the recall count expands the retrieval channels instead of retaining a hidden 16/40 item ceiling',async t=>{
 const f=fixture(t);for(let n=0;n<80;n++)memory(f.r,n,{gist:'pottery 陶艺 材料编号'+n,text:'实际材料'+n});
 f.set({memory:{deepRecallBudgetChars:60000,maxRecallItems:40}});const ordinary=await f.r.retriever.recall('pottery',{depth:'deep'});assert.ok(ordinary.items.length<=40);
 f.set({memory:{maxRecallItems:200}});const expanded=await f.r.retriever.recall('pottery',{depth:'deep'});assert.ok(expanded.items.length>40);assert.ok(expanded.items.length>ordinary.items.length);assert.ok(expanded.chars<=60000);assert.equal(f.r.store.list({kinds:['knowledge']}).length,80);
});

test('psychology generation and validators share configurable limits and preserve inherited longer state',t=>{
 const f=fixture(t);f.set({text:{psycheChars:2000,psycheThreadChars:1200}});
 const c=buildPsychologyCompression({summary:'旧感受',psychology:[]},undefined,{runtimeTuning:f.r.runtimeTuning});assert.match(c.prompt,/最多2000字/);assert.match(c.prompt,/最多1200字/);assert.equal(c.translate({summary:'感'.repeat(1500)}).summary.length,1500);
 const refs=[{sourceId:f.r.inner.store.db.prepare("SELECT source_id FROM sources LIMIT 1").get().source_id,sourceRevision:1}];
 // The real writer retains a coherent summary and its complete history.
 f.r.inner.psyche.apply({summary:'感'.repeat(1500)},refs);const saved=f.r.inner.psyche.current();assert.equal(saved.text.length,1500);
 f.set({text:{psycheChars:200}});assert.equal(f.r.inner.psyche.compile().length,1500);assert.doesNotThrow(()=>f.r.inner.psyche.preflight({summary:saved.text},refs));assert.throws(()=>f.r.inner.psyche.preflight({summary:'新'.repeat(201)},refs),e=>e.code==='V3_SUMMARY_TOO_LONG');
 const before={...f.r.policy.state()},inner={...f.r.inner,runtime:f.r,head:()=>({generation:1,mental_summary:saved.text,attention_json:'[]',emotional_tensions_json:'[]'}),psyche:{current:()=>saved,list:()=>[]}};
 assert.doesNotThrow(()=>feelingUpdate(inner,{},before));
});

test('psychological background pressure follows configured thresholds without discarding old threads',t=>{
 const f=fixture(t);for(let n=0;n<5;n++)f.r.inner.psyche.write('psyche:fixture-'+n,{text:'暂存感受'.repeat(50)},'quiet');
 assert.equal(f.r.inner.psyche.pressure().needsCompression,false);f.set({text:{psycheBackgroundThreads:4,psycheBackgroundChars:1000}});
 const pressure=f.r.inner.psyche.pressure();assert.equal(pressure.needsCompression,true);assert.equal(pressure.softThreadLimit,4);assert.equal(pressure.softCharLimit,1000);assert.equal(f.r.inner.psyche.list().length,5);
});

test('lowered thread limits accept a byte-for-byte inherited long feeling but reject new overlong prose',t=>{
 const f=fixture(t),row=memory(f.r,1),oldText='真实旧感受'.repeat(100),id=f.r.inner.psyche.write('psyche:old-long',{text:oldText,kind:'feeling'},'active');f.set({text:{psycheThreadChars:100}});
 const refs=[{sourceId:row.e.sourceId,sourceRevision:row.e.revision}],op={id,text:oldText,importance:.8,reason:'只重新标记在意程度，不改写旧文'};
 assert.doesNotThrow(()=>f.r.inner.psyche.preflight({psychology:{update:[op]}},refs));f.r.inner.psyche.apply({psychology:{update:[op]}},refs);assert.equal(f.r.inner.psyche.list().find(t=>t.id===id).text,oldText);
 assert.throws(()=>f.r.inner.psyche.preflight({psychology:{update:[{...op,text:oldText+'新'}]}},refs),e=>e.code==='V3_INVALID_PSYCHOLOGY_DELTA');
 const before=f.r.policy.state();assert.doesNotThrow(()=>feelingUpdate(f.r.inner,{psychology:{update:[op]}},before));
});

test('the real V3 growth context uses configured psychology instructions and memory views',async t=>{
 const values=mergeRuntimeTuning(defaultRuntimeTuning(),{text:{psycheChars:200,psycheThreadChars:100,memoryGistChars:100},memory:{detailChars:100}});let captured;
 const f=createGrowthFixture({label:'configured-native-growth',think:async input=>{captured=input;return localModelReply({selfUnderstanding:[],reason:'保持当前理解。'});}});t.after(()=>f.close());
 f.r.runtimeTuning=()=>values;f.r.store.runtimeTuning=f.r.runtimeTuning;f.r.model.runtimeTuning=f.r.runtimeTuning;
 const m=f.experience('相处反馈'.repeat(120));f.r.policy.registerGrowth(m.id);const result=await f.r.runNext({kinds:['grow']});assert.equal(result.status,'complete',result.error);
 assert.match(captured.system,/最多200字/);assert.match(captured.system,/每条新text最多100字/);assert.equal([...captured.material.memories[0].gist].length,100);assert.equal([...captured.material.memories[0].detail].length,100);assert.ok(f.r.store.get(m.id).detail.length>100);
});

test('internal understanding and foreground chat use separately adjustable psychological context budgets',t=>{
 const f=fixture(t),ids=Array.from({length:5},(_,n)=>f.r.inner.psyche.write('psyche:context-'+n,{text:'当下感受'.repeat(40)},'active'));
 const h=f.r.inner.head();f.r.store.db.prepare('UPDATE v3_inner_states SET attention_json=? WHERE character_id=? AND object_id=? AND revision=?').run(JSON.stringify(ids.map(threadId=>({threadId,focus:'本轮实际关注'}))),f.r.characterId,h.state_id,h.state_revision);
 const owner={runtime:f.r,store:{state:()=>f.r.policy.state()}},before=readCurrentInner(owner);assert.equal(before.psychology.length,2);
 f.set({text:{psycheContextChars:500,psycheContextThreads:3,dialoguePsycheChars:200,dialoguePsycheThreads:1}});
 assert.equal(f.r.inner.snapshot().psychology.length,3);assert.equal(readCurrentInner(owner).psychology.length,1);assert.equal(f.r.inner.psyche.list().length,5);
});

test('CharacterCognition passes dynamic input limits to its real model adapter without corrupting JSON',async t=>{
 const f=fixture(t);let calls=0;f.r.model.think=async()=>{calls++;return {data:{okay:true},receipt:{disposed:true,transcriptPersisted:false}};};
 assert.equal(f.r.model.runtimeTuning,f.r.runtimeTuning);f.set({text:{thoughtInputChars:2000}});
 await assert.rejects(f.r.model.run('fixture','保持完整证据',{text:'长'.repeat(2001)}),e=>e.code==='COGNITIVE_INPUT_TOO_LARGE'&&e.details.limitChars===2000&&e.details.inputChars>2000);assert.equal(calls,0);
 f.set({text:{thoughtInputChars:4000}});assert.deepEqual(await f.r.model.run('fixture','保持完整证据',{text:'长'.repeat(2001)}),{okay:true});assert.equal(calls,1);
});

test('512/1024 profile selection requires the whole model identity; lexical selection never reads or fetches a model',t=>{
 const f=fixture(t),large='BAAI/bge-large-zh-v1.5@fixture:onnx-int8:cls-l2-query-v1',small='BAAI/bge-small-zh-v1.5@fixture:onnx-int8:cls-l2-query-v1';
 fs.writeFileSync(path.join(f.root,'embedding.local.json'),JSON.stringify(config(large,1024)));
 assert.throws(()=>embeddingSelection(f.root,'__proto__'),e=>e.code==='INVALID_EMBEDDING_PROFILE');
 const mismatch=embeddingSelection(f.root,'bge-small-512');assert.equal(mismatch.config,undefined);assert.equal(mismatch.status.reason,'configured-model-does-not-match-selection');assert.equal(mismatch.status.lexicalFallback,true);
 fs.writeFileSync(path.join(f.root,'embedding-small-512.local.json'),JSON.stringify(config(small,512)));
 const selected=embeddingSelection(f.root,'bge-small-512');assert.equal(selected.config.modelId,small);assert.equal(selected.config.dimensions,512);assert.equal(selected.status.serviceHealth,'not-probed');
 fs.writeFileSync(path.join(f.root,'embedding.local.json'),'invalid json');assert.equal(embeddingSelection(f.root,'lexical').status.reason,'lexical-selected');
 assert.equal(JSON.stringify(selected.status).includes('fixture-local-embedding-token'),false);
});

test('real vector indexes retain both model buckets, never truncate 1024D into 512D, and report reindex coverage',async t=>{
 const f=fixture(t),row=memory(f.r,1),small='BAAI/bge-small-zh-v1.5@fixture:onnx-int8:cls-l2-query-v1',large='BAAI/bge-large-zh-v1.5@fixture:onnx-int8:cls-l2-query-v1';
 fs.writeFileSync(path.join(f.root,'embedding-small-512.local.json'),JSON.stringify(config(small,512)));
 f.r.retriever.embedding=adapter(small,512);await f.r.retriever.index([row.id]);
 const smallStatus=embeddingCompatibilityStatus(f.root,{profile:'bge-small-512',store:f.r.store,activeEmbedding:f.r.retriever.embedding});assert.equal(smallStatus.index.covered,1);assert.equal(smallStatus.index.requiresReindex,false);
 f.r.store.db.prepare('DELETE FROM embedding_registry WHERE model_id=?').run(small);assert.equal(embeddingCompatibilityStatus(f.root,{profile:'bge-small-512',store:f.r.store}).index.covered,1);
 f.r.retriever.embedding=adapter(large,1024);await f.r.retriever.index([row.id]);
 assert.equal(f.r.store.db.prepare('SELECT count(*) n FROM v2_vectors WHERE memory_id=?').get(row.id).n,2);
 assert.equal((await f.r.retriever.vector('pottery')).length,1);
 f.r.retriever.embedding=adapter(small,512);assert.equal((await f.r.retriever.vector('pottery')).length,1);
 f.r.store.db.prepare('UPDATE v2_vectors SET vector=? WHERE model=?').run(JSON.stringify(Array(1024).fill(1)),small);
 assert.equal((await f.r.retriever.vector('pottery')).length,0);
  const corrupt=embeddingCompatibilityStatus(f.root,{profile:'bge-small-512',store:f.r.store,activeEmbedding:f.r.retriever.embedding});assert.equal(corrupt.index.covered,0);assert.equal(corrupt.index.requiresReindex,true);assert.ok(f.r.scheduleEmbedding()?.jobId);
 assert.equal(f.r.store.get(row.id).gist,row.m.gist);
});

test('a real embedding response with the wrong dimension fails instead of being projected',async()=>{
 const c=config('BAAI/bge-small-zh-v1.5@fixture',512),e=localEmbedding(c,{fetchImpl:async()=>new Response(JSON.stringify({model:c.modelId,data:[{index:0,embedding:Array(1024).fill(1)}]}))});
 await assert.rejects(e.embed(['pottery']),error=>error.code==='INVALID_EMBEDDING_RESPONSE');
});
