import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {createLifeTraceView} from '../src/life-trace-view.js';
import {createLifeMemoryView} from '../src/life-memory-view.js';
import {configuredOneBotEnabled,validateOneBotHttpUrl} from '../src/onebot-client.js';
import {mediaPython} from '../src/portable-paths.js';

async function fixture(t){
  const h=await bridgeHarness({config:{socialV2:{mind:{enabled:true,version:3}}},globals:{createLifeTraceView,createLifeMemoryView,configuredOneBotEnabled,validateOneBotHttpUrl,mediaPython}});h.setMode('reserved2');
  const r=h.mindSystem.runtime,now=Date.now();r.model.think=()=>{throw Error('TRACE_ROUTE_MUST_NOT_CALL_MODEL');};
  const e=r.observe({adapter:'fixture-web',externalId:'trace-route',kind:'web-reading',text:'只供隔离测试的正文，不应进入图响应。',metadata:{scope:'self',platform:'web'},occurredAt:now},{kind:'experience-recorded',eventRoot:'trace-route',outcome:'observed'});
  r.store.addNodes([{id:'memory:trace-route',kind:'experience',gist:'读到一篇文章，想起前几天与朋友的闲聊。',evidence:[{sourceId:e.sourceId,revision:e.revision}],epistemic:'interpreted',metadata:{scope:'self'}}]);
  r.inner.apply({summary:'这份联想有点暖。',changes:[]},{expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],memoryIds:['memory:trace-route'],key:'trace-route-thought'});
  const server=h.startConsoleServer();if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await h.close();});
  const context=()=>h.roleWrites.snapshot('/api/mind/trace');
  const request=async(query='type=memory&id=memory%3Atrace-route',{auth=true,role=context(),headers={}}={})=>{
    const response=await fetch(base+'/api/mind/trace?'+query,{headers:{...(auth?{'x-console-token':'fixture-console-token'}:{}),...(role?{'x-role-context':encodeURIComponent(JSON.stringify(role))}:{}),...headers}});
    return {status:response.status,body:await response.json()};
  };
  return {h,r,e,request,context,base};
}
test('staged real bridge route serves source graphs under original console authentication, without a QQ key',async t=>{
  const {r,request}=await fixture(t),before=r.store.db.prepare('SELECT total_changes() n').get().n;
  const response=await request();assert.equal(response.status,200);assert.equal(response.body.readOnly,true);assert.ok(response.body.nodes.some(n=>n.type==='source'));
  assert.ok(!JSON.stringify(response.body).includes('只供隔离测试的正文'));
  const mood=await request('type=mood&id=current');assert.equal(mood.status,200);assert.ok(mood.body.nodes.some(n=>n.type==='mood'));
  const index=await request('mode=index');assert.equal(index.status,200);assert.ok(Array.isArray(index.body.items));
  assert.equal(r.store.db.prepare('SELECT total_changes() n').get().n,before);
});
test('staged real bridge route denies missing auth, agent headers, missing role context, old activation and unsafe origin',async t=>{
  const {request,context}=await fixture(t);assert.equal((await request(undefined,{auth:false})).status,401);
  for(const headers of [{'x-agent-token':''},{'x-agent-call':'1'}])assert.equal((await request(undefined,{headers})).status,403);
  assert.equal((await request(undefined,{role:null})).status,428);
  assert.equal((await request(undefined,{role:{...context(),profileId:'other'}})).status,409);
  assert.equal((await request(undefined,{role:{...context(),activationEpoch:0}})).status,409);
  assert.equal((await request(undefined,{headers:{origin:'https://foreign.invalid'}})).status,403);
});
test('staged route refuses source invalidation and bad bounds without changing normal memory view',async t=>{
  const {request,r,e,base,context}=await fixture(t);assert.equal((await request('type=memory&id=memory%3Atrace-route&maxNodes=999')).status,400);
  const ordinary=await fetch(base+'/api/mind/view?view=memories',{headers:{'x-console-token':'fixture-console-token','x-role-context':encodeURIComponent(JSON.stringify(context()))}});assert.equal(ordinary.status,200);assert.ok((await ordinary.json()).items.some(m=>m.id==='memory:trace-route'));
  r.archive.db.prepare("UPDATE documents SET status='deleted' WHERE source_id=?").run(e.sourceId);
  const response=await request();assert.equal(response.status,200);assert.ok(response.body.nodes[0].unavailable);assert.ok(!JSON.stringify(response.body).includes('想起前几天'));
});
test('staged source reader serves pinned text only after console authorization and never caches it',async t=>{
  const {request,r,e,base,context}=await fixture(t),q='mode=source&type=source&id='+encodeURIComponent(e.sourceId)+'&revision='+e.revision;
  const response=await fetch(base+'/api/mind/trace?'+q,{headers:{'x-console-token':'fixture-console-token','x-role-context':encodeURIComponent(JSON.stringify(context()))}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const value=await response.json();assert.equal(value.available,true);assert.ok(value.text.includes('只供隔离测试的正文'));assert.equal(value.modelCalls,0);assert.equal((await request(q,{auth:false})).status,401);assert.equal((await request(q,{headers:{'x-agent-call':'1'}})).status,403);r.archive.erase(e.sourceId);assert.equal((await request(q)).body.available,false);
});
