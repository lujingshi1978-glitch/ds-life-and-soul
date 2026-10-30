import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CognitionArchive} from '../src/cognition/archive.js';
import {CognitionStore} from '../src/cognition/store.js';
import {CharacterPolicy} from '../src/cognition/policy.js';
import {InnerLife,innerPrompt} from '../src/cognition/inner-life.js';
import {PSYCHE_CONTINUITY_PROMPT,feelingUpdate} from '../src/cognition/feeling-protocol.js';

// Real SQLite components with explicit fixture inputs. No actor, scheduler,
// provider, live adapter or production database is constructed or opened.
const fixtures=path.resolve(import.meta.dirname,'../../../.local/test-data');
fs.mkdirSync(fixtures,{recursive:true});
function fixture(t){
  const home=fs.mkdtempSync(path.join(fixtures,'reference-')),characterId='character:reference-contract-fixture',now=()=>1793318400000;
  const archive=new CognitionArchive(home,characterId,{now}),store=new CognitionStore(home,characterId,{now}),policy=new CharacterPolicy(store);
  policy.seed({identity:{text:'隔离组件fixture',locked:true},core_wish:{text:'保留既有核心边界',locked:true}});
  let sequence=0;
  const runtime={characterId,now,store,archive,policy,retriever:{cache:new Map()},model:{run(){throw Error('NO_MODEL_ALLOWED');}},observe(source,event){
    const envelope=archive.append(source,event);store.receive(envelope,archive.get(envelope.sourceId,envelope.revision));archive.ack(envelope.idempotencyKey);return envelope;
  }};
  const inner=runtime.inner=new InnerLife(runtime);
  const observe=()=>runtime.observe({adapter:'reference-fixture',externalId:String(++sequence),kind:'chat',text:'QQ 101 本轮提供的明确fixture材料',metadata:{speakerId:'qq:101',conversationPeerId:'qq:101',scope:'private:101'}},{eventRoot:'reference:'+sequence,kind:'chat-received'});
  const apply=(patch,options={})=>{const e=observe();return inner.apply({summary:'此刻的连续心理',changes:[],...patch},{expectedGeneration:inner.head().generation,eventIds:[e.eventId],key:'reference:'+sequence,...options});};
  const seed=apply({changes:[{kind:'concern',title:'本轮实际提到的画猫兴趣',meaning:'保留明确主体与来源',concernKind:'creative_interest',people:['qq:101']}],psychology:{add:[{text:'本轮对画猫产生一点兴趣。'}]}});
  const objectId=seed.changed[0].id,threadId=inner.psyche.list()[0].id;
  t.after(()=>{store.close();archive.close();});
  return {runtime,inner,store,archive,policy,apply,objectId,threadId};
}

test('shared native prompt distinguishes supplied inner objects and psychology thread IDs',()=>{
  assert.ok(innerPrompt({}).includes(PSYCHE_CONTINUITY_PROMPT));
  for(const text of ['psyche.attention','psyche.emotionalTensions','psychology各操作的objectIds','decision.objectIds','before.ongoing','before.psychology','psyche:线程ID','不发明ID','可省略可选objectId'])assert.ok(PSYCHE_CONTINUITY_PROMPT.includes(text),text);
});

test('a supplied inner reference commits while a supplied psyche ID updates its own thread',t=>{
  const f=fixture(t),before=f.inner.snapshot('qq:101');
  assert.ok(before.ongoing.some(x=>x.id===f.objectId));assert.ok(before.psychology.some(x=>x.id===f.threadId));
  const result=f.apply({psyche:{attention:[{objectId:f.objectId,focus:'眼前的画猫兴趣'}],emotionalTensions:[{objectIds:[f.objectId],feeling:'好奇但不着急'}]},psychology:{update:[{id:f.threadId,text:'仍然有点好奇，允许慢慢看。',reason:'本轮材料明确更新',objectIds:[f.objectId]}]}});
  assert.equal(result.status,'applied');
  assert.equal(JSON.parse(f.inner.head().attention_json)[0].objectId,f.objectId);
  assert.deepEqual(f.inner.psyche.list().find(x=>x.id===f.threadId).objectIds,[f.objectId]);
  assert.equal(f.inner.psyche.list().find(x=>x.id===f.threadId).revision,2);
});

test('psyche, contact, character, memory, event and source IDs remain rejected as object references',t=>{
  const f=fixture(t);
  for(const id of [f.threadId,'qq:101',f.runtime.characterId,'memory:missing','event:missing','source:missing'])for(const psyche of [{attention:[{objectId:id,focus:'错误类型'}]},{emotionalTensions:[{objectIds:[id],feeling:'错误类型'}]}]){
    const generation=f.inner.head().generation,commits=f.store.db.prepare('SELECT count(*) n FROM v3_inner_commits').get().n;
    assert.throws(()=>f.apply({psyche}),{code:'V3_UNKNOWN_OBJECT'});
    assert.equal(f.inner.head().generation,generation);assert.equal(f.store.db.prepare('SELECT count(*) n FROM v3_inner_commits').get().n,commits);
  }
  assert.throws(()=>f.apply({psychology:{add:[{text:'不能把线程当对象',objectIds:[f.threadId]}]}}),{code:'V3_UNKNOWN_OBJECT'});
});

test('optional unbound attention remains valid and foreground preflight keeps its original rejection',t=>{
  const f=fixture(t),out=f.apply({psyche:{attention:[{focus:'没有对应长期对象的当下好奇'}],emotionalTensions:[]}});
  assert.equal(out.status,'applied');assert.equal(JSON.parse(f.inner.head().attention_json)[0].objectId,undefined);
  const before=f.policy.state();
  assert.doesNotThrow(()=>feelingUpdate(f.inner,{psyche:{attention:[{objectId:f.objectId,focus:'有效对象'}]}},before));
  assert.throws(()=>feelingUpdate(f.inner,{psyche:{attention:[{objectId:f.threadId,focus:'错误类型'}]}},before),{code:'V3_INVALID_PATCH'});
});

test('person ownership, core lock and generation boundaries remain unchanged',t=>{
  const f=fixture(t),core=f.policy.core(),head=f.inner.head().generation;
  assert.throws(()=>f.apply({changes:[{kind:'concern',title:'不能换成另一位朋友',people:['qq:202']}]}),{code:'V3_PERSON_NOT_IN_EVIDENCE'});
  assert.throws(()=>f.apply({changes:[{kind:'wish',id:'inner:life-direction',title:'不能改核心'}]}),{code:'CORE_FIELD_LOCKED'});
  assert.throws(()=>f.apply({},{expectedGeneration:head-1}),{code:'V3_HEAD_VERSION_CONFLICT'});
  assert.equal(f.inner.head().generation,head);assert.deepEqual(f.policy.core(),core);
});
