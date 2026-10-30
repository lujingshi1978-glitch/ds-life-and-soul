import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';
import {LegacyArchive} from '../src/cognition/legacy.js';
import {PublicReading,publicReadingMaterial} from '../src/cognition/public-reading.js';
import {compileReflectionInput} from '../src/cognition/reflection-input.js';

const receipt={disposed:true,transcriptPersisted:false};
const patch={summary:'读到新片段，原先挂念的事仍然保留。',changes:[],psychology:{},
 feeling:{mood:'平静',valence:0,arousal:0.4,appraisal:{focus:'刚读到的公开材料',trigger:'实际阅读了一个片段'}},
 publicReaction:{summary:'实际提供的公开文字片段。',feeling:'暂时没有更多想说的。',like:false,comment:null,topic:null}};
const item={platform:'web',url:'https://example.test/synthetic-reading',title:'隔离合成公开资料'};
const coverage={actualRead:true,text:true,scope:'supplied-text',notFullVideo:true};
const minimal=()=>({before:{core:[{field:'identity',text:'隔离核心'}],physical:{mood:'平静'},capabilities:{activities:['browse'],writesEnabled:false},
 continuations:{items:[],referenceOnly:true,noAutomaticSend:true},relationship:[]},newEvents:[],recalled:[],retrospective:false});
const size=value=>JSON.stringify(value).length;
const materialFor=text=>publicReadingMaterial({ref:{sourceId:'source:public',revision:2},item,text,coverage});

function fixture(t,{oversized=false,cap=18000,resourceReadChars=16000,coreText='# 隔离角色\n\n## 核心愿望\n认识世界。'}={}){
 const parent=process.env.FEIYU_AGENCY_TEST_DIR||os.tmpdir();fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'public-reading-budget-')),r=new CharacterCognition({root,characterId:'character:public-reading-budget',embedding:null,
  now:()=>Date.parse('2026-10-27T03:00:00Z'),runtimeTuning:{text:{thoughtInputChars:cap},memory:{resourceReadChars}}});
 r.policy.seed({identity:{text:coreText,locked:true}});r.enableInner();
 const archive=new LegacyArchive(r,{}),owner={runtime:r,archive,changed(){},log(){}},reader=new PublicReading(owner);let optional;
 if(oversized){
  const text='完整保留出处与范围的可选合成公开背景。'.repeat(4000);
  optional=archive.put('optional-background','self','web-reading',text,{privacyLabel:'public'},r.now());
  const snapshot=r.inner.snapshot.bind(r.inner);
  r.inner.snapshot=(...args)=>({...snapshot(...args),relationship:[{sourceId:optional.sourceId,revision:optional.revision,text,scope:'self',referenceOnly:true,noAutomaticSend:true}]});
 }
 t.after(async()=>{await r.close();if(!process.env.FEIYU_AGENCY_TEST_DIR){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('public-reading-budget-'));fs.rmSync(root,{recursive:true,force:true});}});
 return {r,archive,reader,optional,cap};
}
function reading(f,text='鲸🐳"\\\n'.repeat(4000)){
 return {ref:f.archive.put('actual-reading','self','web-reading',text,{privacyLabel:'public'},f.r.now()),item,text,coverage};
}
function checkWindow(material,input,cap){
 const shown=material.publicReading,window=shown.textWindow;
 assert.ok(size(material)<=cap);assert.deepEqual(shown.coverage,coverage);assert.equal(shown.platform,item.platform);assert.equal(shown.url,item.url);assert.equal(shown.title,item.title);
 assert.equal(window.scope,'suppliedReadingText');assert.equal(window.sourceId,input.ref.sourceId);assert.equal(window.revision,input.ref.revision);
 assert.equal(window.fullChars,[...input.text].length);assert.equal(window.excerptChars,[...shown.text].length);assert.equal(window.partial,window.excerptChars<window.fullChars);
 assert.equal(shown.text,[...input.text].slice(0,window.excerptChars).join(''));assert.ok(window.excerptChars>0);
}

test('an ordinary under-budget factory preserves the complete reading, guards and base exactly',()=>{
 const base=minimal(),copy=structuredClone(base),text='完整合成正文🐳。',extension=materialFor(text)(base,{maxInputChars:48000});
 assert.deepEqual(base,copy);assert.deepEqual(Object.keys(extension),['publicReading']);assert.equal(extension.publicReading.text,text);
 assert.equal(extension.publicReading.textWindow.partial,false);assert.equal(extension.publicReading.textWindow.excerptChars,[...text].length);
 const compiled=compileReflectionInput({...base,...extension},{maxChars:48000});assert.equal(compiled.coverage.compacted,false);
 assert.deepEqual(compiled.material.before.capabilities,base.before.capabilities);assert.deepEqual(compiled.material.before.continuations,base.before.continuations);
});

test('an oversized optional base permits a whole reading and keeps all authority wrappers',()=>{
 const base=minimal();base.before.relationship=[{text:'可选背景'.repeat(20000),scope:'self',referenceOnly:true,noAutomaticSend:true}];const copy=structuredClone(base),text='真实公开片段。'.repeat(100);
 assert.ok(size(base)>48000);const extension=materialFor(text)(base,{maxInputChars:48000}),compiled=compileReflectionInput({...base,...extension},{maxChars:48000});
 assert.deepEqual(base,copy);assert.equal(extension.publicReading.text,text);assert.ok(compiled.coverage.partial);assert.deepEqual(compiled.material.before.relationship,[]);
 assert.deepEqual(compiled.material.before.capabilities,base.before.capabilities);assert.deepEqual(compiled.material.before.continuations,base.before.continuations);
 assert.deepEqual(compiled.material.publicReading,extension.publicReading);
});

test('only the oversized-base branch uses the configured single-read text window',()=>{
 const text='鲸🐳。'.repeat(10000),base=minimal(),ordinary=materialFor(text)(base,{maxInputChars:48000,resourceReadChars:1000});
 assert.equal(ordinary.publicReading.text,text);assert.equal(ordinary.publicReading.textWindow.partial,false);
 base.before.relationship=[{text:'可选背景'.repeat(20000)}];
 const bounded=materialFor(text)(base,{maxInputChars:48000,resourceReadChars:1000});
 assert.equal(bounded.publicReading.textWindow.excerptChars,1000);assert.equal(bounded.publicReading.textWindow.partial,true);assert.equal(bounded.publicReading.text,[...text].slice(0,1000).join(''));
 const defaultWindow=materialFor(text)(base,{maxInputChars:48000});assert.equal(defaultWindow.publicReading.textWindow.excerptChars,16000);
});

test('compiler failures other than a mandatory minimum error are never swallowed by sizing',()=>{
 const base=minimal();base.before.relationship=[{text:'可选背景'.repeat(20000)}];base.reflectionInputCoverage={forbiddenHostCollision:true};
 assert.throws(()=>materialFor('实际正文')(base,{maxInputChars:48000}),{code:'THOUGHT_INPUT_INVALID'});
});

for(const repair of [false,true])test(`native PublicReading.appraise packs an oversized base through ${repair?'initial and repair':'initial'} integration`,async t=>{
 const f=fixture(t,{oversized:true}),{r,reader}=f,input=reading(f),source=r.archive.get(input.ref.sourceId,input.ref.revision),core=r.policy.core()[0].body,calls=[];
 const before=r.inner.snapshot(),generation=r.inner.head().generation;assert.ok(size(before)>f.cap);
 r.model.think=async request=>{calls.push(structuredClone(request));return {data:repair&&calls.length===1?{...patch,summary:'坏'.repeat(3000)}:patch,receipt};};
 const result=await reader.appraise(input);assert.equal(calls.length,repair?2:1);
 for(const call of calls){
  checkWindow(call.material,input,f.cap);assert.ok(call.material.publicReading.textWindow.partial);assert.ok(call.material.reflectionInputCoverage.partial);
  assert.ok(call.material.reflectionInputCoverage.groups.some(group=>group.path==='before.relationship'&&group.omitted===1));
  assert.deepEqual(call.material.before.capabilities,before.capabilities);assert.deepEqual(call.material.before.core,before.core);
  assert.equal(call.material.before.continuations.referenceOnly,before.continuations.referenceOnly);assert.equal(call.material.before.continuations.noAutomaticSend,before.continuations.noAutomaticSend);
 }
 if(repair){assert.equal(calls[1].purpose,'inner-repair');assert.equal(calls[1].material.error,'V3_INVALID_PATCH');assert.ok(calls[1].material.errorDetails);assert.deepEqual(calls[1].material.newEvents,calls[0].material.newEvents);}
 assert.equal(reader.row(result.id).generation,generation+1);assert.equal(r.inner.head().generation,generation+1);assert.equal(r.policy.core()[0].body,core);
 assert.equal(r.store.db.prepare('SELECT count(*) n FROM v3_inner_commits WHERE idempotency_key=?').get('public-reading:'+result.id).n,1);
 assert.equal(r.archive.get(input.ref.sourceId,input.ref.revision).text,input.text);assert.equal(r.archive.get(input.ref.sourceId,input.ref.revision).checksum,source.checksum);
 assert.deepEqual(JSON.parse(reader.row(result.id).effects_json),{like:{status:'declined'},comment:{status:'declined'}});
 await reader.appraise(input);assert.equal(calls.length,repair?2:1);
});

for(const revoked of ['reading','omitted-context'])test(`revoking the ${revoked} source during the native model call blocks the full host read set`,async t=>{
 const f=fixture(t,{oversized:true}),{r,reader}=f,input=reading(f);let calls=0;
 r.model.think=async request=>{
  calls++;checkWindow(request.material,input,f.cap);assert.deepEqual(request.material.before.relationship,[]);
  r.archive.erase(revoked==='reading'?input.ref.sourceId:f.optional.sourceId);return {data:patch,receipt};
 };
 await assert.rejects(reader.appraise(input),{code:'COGNITION_READSET_STALE'});assert.equal(calls,1);
 assert.equal(r.store.db.prepare('SELECT count(*) n FROM v3_public_readings').get().n,0);
 assert.equal(r.store.db.prepare("SELECT count(*) n FROM v3_inner_commits WHERE idempotency_key LIKE 'public-reading:%'").get().n,0);
});

test('a native mandatory minimum failure carries numeric diagnostics and never calls the model',async t=>{
 const f=fixture(t,{cap:6000,coreText:'# 隔离角色\n\n## 核心愿望\n'+('必须完整保留的核心。'.repeat(700))}),{r,reader}=f,input=reading(f,'实际读取的少量正文。');let calls=0;
 r.model.think=async()=>{calls++;return {data:patch,receipt};};
 await assert.rejects(reader.appraise(input),error=>{assert.equal(error.code,'THOUGHT_INPUT_MINIMUM_TOO_LARGE');assert.ok(error.details.minimumChars>error.details.maxChars);assert.ok(Object.values(error.details).every(value=>typeof value==='number'&&Number.isFinite(value)));return true;});
 assert.equal(calls,0);assert.equal(r.store.db.prepare('SELECT count(*) n FROM v3_public_readings').get().n,0);
});

test('ordinary native appraisal stays complete and quiet with one model call and one commit',async t=>{
 const f=fixture(t),{r,reader}=f,input=reading(f,'普通合成公开正文🐳。');let calls=0;
 r.model.think=async request=>{calls++;checkWindow(request.material,input,f.cap);assert.equal(request.material.reflectionInputCoverage,undefined);assert.equal(request.material.publicReading.textWindow.partial,false);return {data:patch,receipt};};
 const result=await reader.appraise(input);assert.equal(calls,1);assert.equal(r.inner.pendingAgencyAction(),null);assert.equal(reader.row(result.id).represented,1);
 assert.deepEqual(JSON.parse(reader.row(result.id).effects_json),{like:{status:'declined'},comment:{status:'declined'}});
 assert.equal((await reader.appraise(input)).duplicate,true);assert.equal(calls,1);
});

test('a long native reading with a fat base retains its relevant friend association without requiring chat',async t=>{
 const resourceReadChars=4096,f=fixture(t,{oversized:true,cap:48000,resourceReadChars}),{r,reader}=f,person='qq:42';
 const conversation=r.observe({adapter:'isolated-friend-conversation',externalId:'marine-friend',kind:'chat',text:'我喜欢研究海洋里的透明小鱼。',
  metadata:{scope:'private:42',speakerId:person,conversationPeerId:person,role:'user',privacyLabel:'private'}},{kind:'experience-recorded'});
 const memoryId=r.store.addNodes([{kind:'episode',gist:'qq:42曾与我聊过海洋里的透明小鱼。',eventRoot:'marine-friend',
  participants:[{entityId:person,role:'speaker'},{entityId:r.characterId,role:'participant'}],evidence:[{sourceId:conversation.sourceId,revision:conversation.revision}]}]).ids[0];
 const input=reading(f,'海洋透明小鱼的公开介绍。'.repeat(4500)),original=r.archive.get(input.ref.sourceId,input.ref.revision);let calls=0;
 r.model.think=async request=>{
  calls++;const material=request.material;checkWindow(material,input,f.cap);
  assert.equal(material.publicReading.textWindow.excerptChars,resourceReadChars);assert.equal(material.publicReading.textWindow.partial,true);
  assert.ok(material.recalled.some(memory=>memory.id===memoryId));
  const friend=material.memoryAssociation.contacts.find(contact=>contact.personId===person);assert.ok(friend);assert.ok(friend.memoryIds.includes(memoryId));
  assert.equal(friend.referenceOnly,true);assert.equal(friend.authorization,'not-granted-by-association');assert.equal(friend.privateReference,true);assert.equal(friend.mayDiscloseSourceText,false);
  assert.deepEqual(material.before.relationship,[]);return {data:patch,receipt};
 };
 const result=await reader.appraise(input);assert.equal(calls,1);assert.equal(r.inner.pendingAgencyAction(),null);assert.ok(reader.row(result.id));
 assert.equal(r.archive.get(input.ref.sourceId,input.ref.revision).text,input.text);assert.equal(r.archive.get(input.ref.sourceId,input.ref.revision).checksum,original.checksum);
 assert.equal(r.store.sourceUsable({sourceId:conversation.sourceId,revision:conversation.revision}),true);
});
