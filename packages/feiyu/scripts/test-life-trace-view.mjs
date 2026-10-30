import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';
import {buildTrace,createLifeTraceView,normalizeTraceFilters} from '../src/life-trace-view.js';

const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
export function seedTraceRuntime(root,{characterId='character:trace-fixture'}={}){
  const at=Date.parse('2026-10-30T03:00:00Z');
  const r=new CharacterCognition({root,characterId,now:()=>at,embedding:null});
  r.policy.seed({identity:{text:'我是隔离测试角色。\n## 核心愿望\n我想慢慢认识世界，形成自己的趣味，珍惜值得珍惜的关系。'}});r.enableInner();
  r.model.think=()=>{throw Error('TRACE_MUST_NOT_CALL_MODEL');};
  const event=r.observe({adapter:'trace-fixture',externalId:'input-a',kind:'chat',text:'我昨天画了一枚歪太阳，想给你看看。',occurredAt:at,
    metadata:{scope:'private:101',speakerId:'qq:101',conversationPeerId:'qq:101'}},{kind:'experience-recorded',outcome:'observed',eventRoot:'fixture-input'});
  r.store.addNodes([{id:'memory:trace-shared',kind:'experience',gist:'和朋友一起给歪太阳起了名字。',occurredAt:at,
    epistemic:'interpreted',participants:[{entityId:'qq:101',role:'participant'}],evidence:[{sourceId:event.sourceId,revision:event.revision}],metadata:{scope:'private:101',reaction:'心里暖了一点。'}}]);
  const head=r.inner.head();r.inner.apply({summary:'这个小太阳让我想到和朋友一起留下点什么。',changes:[],
    decision:{kind:'chat',personId:'qq:101',intent:'把刚想到的小太阳故事轻轻讲给他听。',meaning:'共同的小东西让我想起他。',memoryIds:['memory:trace-shared']}},
    {expectedGeneration:head.generation,eventIds:[event.eventId],memoryIds:['memory:trace-shared'],key:'fixture-choice',decisionContext:{fresh:true,origin:'foreground',eventIds:[event.eventId]}});
  const action=r.store.db.prepare('SELECT object_id,revision FROM v3_action_proposals ORDER BY rowid DESC LIMIT 1').get();
  const proposal=r.store.db.prepare('SELECT * FROM v3_action_proposals WHERE object_id=?').get(action.object_id);
  const gates=Object.fromEntries(['authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready'].map(k=>[k,true]));
  const run=r.inner.beginAction(proposal,gates);assert.ok(run,'fixture must create an actual host execution');
  r.inner.actionResult(run.executionId,{status:'succeeded',receipt:{status:'confirmed-controlled-delivery',text:'想到你画的歪太阳，就想顺手告诉你这个故事。',transport:'controlled-local-receiver',productionNetworkSend:false}});
  return {r,event,action,run,at};
}
function fixture(t){
  const root=fs.mkdtempSync(path.join(base,'trace-')),{r,...rest}=seedTraceRuntime(root);
  t.after(async()=>{await r.close();const resolved=path.resolve(root);assert.ok(resolved.startsWith(base+path.sep)&&path.basename(resolved).startsWith('trace-'));fs.rmSync(resolved,{recursive:true,force:true});});
  return {r,root,...rest};
}

test('actual V3 persisted choice expands to motive, state, memories, source, execution and feedback without writes',async t=>{
  const {r,action}=fixture(t),before=r.store.db.prepare('SELECT total_changes() n').get().n,archiveBefore=r.archive.db.prepare('SELECT total_changes() n').get().n;
  const graph=buildTrace(r,{type:'action',id:action.object_id,maxNodes:100,maxDepth:6});
  for(const type of ['action','inner','memory','source','execution','outcome','event'])assert.ok(graph.nodes.some(n=>n.type===type),'missing '+type);
  assert.ok(graph.nodes.some(n=>n.type==='execution'&&n.text==='confirmed-controlled-delivery'));
  assert.ok(graph.nodes.some(n=>n.type==='source'&&n.epistemic==='保留原始来源，不自动认定亲历'));
  assert.ok(graph.edges.every(e=>e.causal===false));assert.equal(graph.readOnly,true);assert.equal(graph.newCapture,false);assert.equal(graph.modelCalls,0);
  assert.equal(r.store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(r.archive.db.prepare('SELECT total_changes() n').get().n,archiveBefore);
  assert.ok(!JSON.stringify(graph).includes('我昨天画了一枚歪太阳'),'raw archive text must not be returned');
});
test('current mood is backed by exact persisted versions and source references',t=>{
  const {r}=fixture(t);const graph=buildTrace(r,{type:'mood',id:'current'});
  assert.ok(graph.nodes.some(n=>n.type==='mood'&&n.revision>=1&&n.text.includes('小太阳')));
  assert.ok(graph.nodes.some(n=>n.type==='source'));
  assert.ok(graph.notices.some(x=>x.includes('隐藏')));
});
test('a missing old revision is unknown and never silently replaced with current text',t=>{
  const {r}=fixture(t),graph=buildTrace(r,{type:'memory',id:'memory:trace-shared',revision:999});
  assert.equal(graph.nodes[0].status,'unknown');assert.equal(graph.nodes[0].unavailable,true);assert.ok(!JSON.stringify(graph).includes('和朋友一起给歪太阳'));
});
test('deleted source suppresses the memory and mood contents even if stored prose remains',t=>{
  const {r,event}=fixture(t);r.archive.db.prepare("UPDATE documents SET status='deleted' WHERE source_id=?").run(event.sourceId);
  for(const query of [{type:'memory',id:'memory:trace-shared'},{type:'mood',id:'current'}]){
    const graph=buildTrace(r,query);assert.ok(graph.nodes[0].unavailable);assert.ok(!JSON.stringify(graph).includes('这个小太阳让我想到'));assert.ok(!JSON.stringify(graph).includes('和朋友一起给歪太阳'));
  }
});
test('diagnostic and explicitly suppressed sources never leak through graph selection',t=>{
  const {r,event}=fixture(t);r.store.db.prepare("INSERT INTO suppression(character_id,target_type,target_id,reason_code,created_at) VALUES(?,?,?,?,?)").run(r.characterId,'source',event.sourceId,'fixture',Date.now());
  const graph=buildTrace(r,{type:'memory',id:'memory:trace-shared'});assert.ok(graph.nodes[0].unavailable);assert.ok(!JSON.stringify(graph).includes('和朋友一起给歪太阳'));
});
test('unknown execution stays unknown, with no success or recipient interpretation',t=>{
  const {r,run}=fixture(t);r.store.db.prepare("UPDATE v3_action_executions SET status='unknown',receipt_json='{}' WHERE execution_id=?").run(run.executionId);
  const graph=buildTrace(r,{type:'execution',id:run.executionId,maxDepth:1});const node=graph.nodes.find(n=>n.type==='execution');
  assert.equal(node.executionSucceeded,false);assert.match(node.note,/未知/);assert.equal(node.productionNetworkSend,false);
});
test('graph has bounded expansion and does not duplicate nodes in bidirectional relations',t=>{
  const {r,event}=fixture(t);for(let i=0;i<12;i++)r.store.addNodes([{id:'memory:branch-'+i,kind:'episode',gist:'关联片段 '+i,evidence:[{sourceId:event.sourceId,revision:event.revision}],epistemic:'observed'}]);
  for(let i=0;i<12;i++){r.store.connect('memory:trace-shared','memory:branch-'+i,'semantic',{provenance:'model_inference'});if(i)r.store.connect('memory:branch-'+i,'memory:branch-'+(i-1),'same_entity');}
  const graph=buildTrace(r,{type:'memory',id:'memory:trace-shared',maxNodes:8,maxDepth:1});
  assert.ok(graph.nodes.length<=8);assert.ok(graph.limits.truncated);assert.equal(new Set(graph.nodes.map(x=>x.key)).size,graph.nodes.length);
  assert.ok(graph.edges.every(e=>graph.nodes.some(n=>n.key===e.from)&&graph.nodes.some(n=>n.key===e.to)));
});
test('current core is labelled contextual, never asserted as historical causal proof',t=>{
  const {r,action}=fixture(t),graph=buildTrace(r,{type:'action',id:action.object_id});
  const core=graph.nodes.find(n=>n.type==='core');assert.ok(core);const edge=graph.edges.find(e=>e.relation==='value_context');assert.equal(edge.causal,false);assert.equal(edge.provenance,'current-host-context');
});
test('core anchor historical label and body come from the same exact persisted version',t=>{
  const {r,event,action}=fixture(t),id='inner:core-wish';
  const old=r.store.db.prepare('SELECT revision,text FROM v3_inner_anchors WHERE object_id=? ORDER BY revision DESC LIMIT 1').get(id);
  const commit=r.store.db.prepare('SELECT commit_id FROM v3_inner_commits ORDER BY rowid DESC LIMIT 1').get().commit_id;
  const newer=r.inner.writeObject('anchor',{text:'这是第二版隔离核心，仅用于版本测试。',anchorKind:'core_wish',locked:true},commit,{id,authority:'user',evidence:[{sourceId:event.sourceId,sourceRevision:event.revision}]});
  const historical=buildTrace(r,{type:'core',id,revision:old.revision}).nodes[0];assert.equal(historical.revision,old.revision);assert.equal(historical.text,old.text);
  const current=buildTrace(r,{type:'core',id}).nodes[0];assert.equal(current.revision,newer.revision);assert.ok(current.text.includes('第二版'));
  assert.equal(buildTrace(r,{type:'core',id,revision:999}).nodes[0].status,'unknown');
  const graph=buildTrace(r,{type:'action',id:action.object_id,maxDepth:6,maxNodes:100}),anchor=graph.nodes.find(n=>n.type==='core'&&n.id===id&&n.revision===old.revision);
  assert.equal(anchor.text,old.text);assert.ok(graph.edges.some(e=>e.to===anchor.key&&e.provenance==='host-recorded-wish-anchor-reference'));
});
test('actual action goal and wish anchor references expose core direction without claiming psychological causality',t=>{
  const {r,action}=fixture(t),graph=buildTrace(r,{type:'action',id:action.object_id,maxDepth:6,maxNodes:100});
  const wish=graph.nodes.find(n=>n.type==='inner'&&n.id==='inner:life-direction');assert.ok(wish);
  assert.ok(graph.edges.some(e=>e.from===graph.focus&&e.to===wish.key&&e.relation==='pursues'&&e.provenance==='host-recorded-goal-reference'&&!e.causal));
  assert.ok(graph.edges.some(e=>e.from===wish.key&&e.provenance==='host-recorded-wish-anchor-reference'&&e.relation==='expresses'&&!e.causal));
});
test('character-less goal links cannot connect an owned action to a foreign role object',t=>{
  const {r,action}=fixture(t),db=r.store.db;
  const clone=(table,row,patch)=>{const value={...row,...patch},keys=Object.keys(value);db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>value[k]));};
  db.exec('PRAGMA foreign_keys=OFF');try{
    clone('v3_inner_objects',db.prepare("SELECT * FROM v3_inner_objects WHERE object_id='inner:life-direction'").get(),{character_id:'character:foreign',object_id:'inner:foreign-goal'});
    clone('v3_inner_versions',db.prepare("SELECT * FROM v3_inner_versions WHERE object_id='inner:life-direction' LIMIT 1").get(),{character_id:'character:foreign',object_id:'inner:foreign-goal',body_json:JSON.stringify({title:'FOREIGN_GOAL_SECRET'})});
    db.prepare('INSERT INTO v3_goal_links VALUES(?,?,?,?,?)').run(action.object_id,action.revision,'inner:foreign-goal',1,'pursues');
    const raw=JSON.stringify(buildTrace(r,{type:'action',id:action.object_id,maxDepth:6,maxNodes:100}));assert.ok(!raw.includes('inner:foreign-goal'));assert.ok(!raw.includes('FOREIGN_GOAL_SECRET'));
  }finally{db.exec('PRAGMA foreign_keys=ON');}
});
test('all view reads require console authority, matching role activation and current character',t=>{
  const {r,action}=fixture(t),binding={profileId:'fixture',activationEpoch:4};
  const view=createLifeTraceView({runtime:r,profile:{id:'fixture',name:'隔离示例'},getBinding:()=>binding,authorizeConsole:q=>q.console===true});
  const request={console:true,headers:{},context:{...binding},filters:{type:'action',id:action.object_id}};
  assert.ok(view.read(request).ok);
  assert.throws(()=>view.read({...request,console:false}),/CONSOLE_ADMIN_ONLY/);
  for(const headers of [{'x-agent-token':''},{'X-Agent-Call':'1'}])assert.throws(()=>view.read({...request,headers}),/CONSOLE_ADMIN_ONLY/);
  assert.throws(()=>view.read({...request,context:null}),/ROLE_READ_CONTEXT_REQUIRED/);
  assert.throws(()=>view.read({...request,context:{...binding,profileId:'other'}}),/ROLE_READ_CONFLICT/);
  binding.activationEpoch++;assert.throws(()=>view.read(request),/ROLE_READ_CONFLICT/);
});
test('malformed bounds are rejected, SQL-like unknown ids remain inert, and credentials in selected summaries are masked',t=>{
  const {r}=fixture(t);for(const q of [{maxNodes:1000},{maxDepth:7},{offset:-1},{type:'raw'},{id:'bad\n'}])assert.throws(()=>normalizeTraceFilters(q),/TRACE_/);
  assert.equal(buildTrace(r,{type:'memory',id:"' OR 1=1 --"}).nodes[0].status,'unknown');
  r.store.db.prepare("UPDATE memory_versions SET gist=? WHERE memory_id='memory:trace-shared'").run('API_KEY=secretfixture sk-'+'or-v1-abcdefghijklmnopqrstuvwxyz012345');
  const raw=JSON.stringify(buildTrace(r,{type:'memory',id:'memory:trace-shared'}));assert.ok(!raw.includes('secretfixture'));assert.ok(!raw.includes('abcdefghijklmnopqrstuvwxyz012345'));assert.ok(raw.includes('隐藏'));
});
test('same IDs in an accidentally mixed database cannot select another character or cross-link its event',t=>{
  const {r,event}=fixture(t),db=r.store.db;
  const clone=(table,row,patch)=>{const value={...row,...patch},keys=Object.keys(value);db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>value[k]));};
  db.exec('PRAGMA foreign_keys=OFF');
  try{
    const n=db.prepare('SELECT * FROM memory_nodes WHERE character_id=? AND memory_id=?').get(r.characterId,'memory:trace-shared');
    const v=db.prepare('SELECT * FROM memory_versions WHERE character_id=? AND memory_id=?').get(r.characterId,'memory:trace-shared');
    clone('memory_nodes',n,{character_id:'character:other'});clone('memory_versions',v,{character_id:'character:other',gist:'OTHER_ROLE_SECRET'});
    clone('memory_nodes',n,{character_id:'character:other',memory_id:'memory:only-other'});clone('memory_versions',v,{character_id:'character:other',memory_id:'memory:only-other',gist:'OTHER_ROLE_SECRET'});
    const e=db.prepare('SELECT * FROM cognitive_events WHERE character_id=? AND event_id=?').get(r.characterId,event.eventId);
    clone('cognitive_events',e,{character_id:'character:other',event_id:'event:only-other',idempotency_key:'other-idempotency'});
    db.prepare('INSERT INTO v3_memory_events VALUES(?,?,?,?,?,?)').run('memory:trace-shared',1,'event:only-other',event.sourceId,event.revision,'{}');
    db.prepare('INSERT INTO v3_memory_events VALUES(?,?,?,?,?,?)').run('memory:only-other',1,event.eventId,event.sourceId,event.revision,'{}');
    for(const query of [{type:'memory',id:'memory:trace-shared'},{type:'event',id:event.eventId}]){
      const result=JSON.stringify(buildTrace(r,query));assert.ok(!result.includes('OTHER_ROLE_SECRET'));assert.ok(!result.includes('event:only-other'));assert.ok(!result.includes('memory:only-other'));
    }
  }finally{db.exec('PRAGMA foreign_keys=ON');}
});
test('a runtime character mismatch cannot expose unscoped psyche tables',t=>{
  const {r}=fixture(t),original=r.characterId;r.characterId='character:other';
  try{assert.throws(()=>buildTrace(r,{type:'mood',id:'current'}),/TRACE_CHARACTER_MISMATCH/);}finally{r.characterId=original;}
});
test('oversized event and inner evidence fail closed before a hidden tail source can leak summary',t=>{
  const {r,event,action,at}=fixture(t);
  for(let i=0;i<26;i++){
    const e=r.observe({adapter:'fixture-many',externalId:'source-'+i,kind:'chat',text:'额外来源 '+i,occurredAt:at,metadata:{scope:'self'}},{kind:'experience-recorded',eventRoot:'many-'+i,outcome:'observed'});
    r.store.db.prepare('INSERT INTO event_sources VALUES(?,?,?,?)').run(r.characterId,event.eventId,e.sourceId,e.revision);
    r.store.db.prepare('INSERT INTO v3_inner_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(r.characterId,action.object_id,action.revision,'many-'+i,e.sourceId,e.revision,null,null,null,'context','{}','many-'+i);
    if(i===25)r.archive.db.prepare("UPDATE documents SET status='deleted' WHERE source_id=?").run(e.sourceId);
  }
  for(const query of [{type:'event',id:event.eventId},{type:'action',id:action.object_id}]){
    const graph=buildTrace(r,query);assert.ok(graph.nodes[0].unavailable);assert.ok(!JSON.stringify(graph).includes('这个小太阳让我想到'));assert.ok(!JSON.stringify(graph).includes('把刚想到的小太阳故事'));
  }
});
test('diagnostic source metadata hides a still-stored memory and source node',t=>{
  const {r,event}=fixture(t);r.archive.db.prepare("UPDATE documents SET metadata=json_set(metadata,'$.diagnostic',1) WHERE source_id=?").run(event.sourceId);
  assert.ok(buildTrace(r,{type:'memory',id:'memory:trace-shared'}).nodes[0].unavailable);
  assert.ok(buildTrace(r,{type:'source',id:event.sourceId,revision:event.revision}).nodes[0].unavailable);
});
test('withdrawn indirect dependencies hide parent action, receipt, feedback and mood summaries',t=>{
  const {r,action,run,at}=fixture(t),db=r.store.db;
  const e=r.observe({adapter:'fixture-private',externalId:'withdrawn',kind:'chat',text:'不应继续展示的私密来源',occurredAt:at,metadata:{scope:'private:202'}},{kind:'experience-recorded',outcome:'observed',eventRoot:'withdrawn-root'});
  r.store.addNodes([{id:'memory:withdrawn',kind:'episode',gist:'曾被间接使用的私密内容',epistemic:'observed',evidence:[{sourceId:e.sourceId,revision:e.revision}]}]);
  db.prepare(`INSERT INTO v3_inner_dependencies(character_id,child_id,child_revision,dependency_id,parent_memory_id,parent_memory_revision,relation,confidence,valid_from)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(r.characterId,action.object_id,action.revision,'private-parent','memory:withdrawn',1,'derived_from',1,at);
  const mood=db.prepare("SELECT revision FROM v3_psyche_projection_versions WHERE id='current' ORDER BY revision DESC LIMIT 1").get();
  db.prepare('INSERT INTO v3_psyche_projection_dependencies VALUES(?,?,?,?,?)').run(mood.revision,'memory','memory:withdrawn',1,'{}');
  assert.ok(!buildTrace(r,{type:'action',id:action.object_id}).nodes[0].unavailable);
  r.archive.db.prepare("UPDATE documents SET status='deleted' WHERE source_id=?").run(e.sourceId);
  const outcome=db.prepare('SELECT outcome_id FROM v3_experience_outcomes WHERE execution_id=?').get(run.executionId);
  for(const query of [{type:'action',id:action.object_id},{type:'execution',id:run.executionId},{type:'outcome',id:outcome.outcome_id},{type:'mood',id:'current'}]){
    const graph=buildTrace(r,query);assert.ok(graph.nodes[0].unavailable,JSON.stringify(query));assert.ok(!JSON.stringify(graph).includes('想到你画的歪太阳'));
  }
});
test('cyclic semantic derivation fails closed without uncontrolled recursion',t=>{
  const {r,action,at}=fixture(t),db=r.store.db;
  const motive=db.prepare('SELECT motive_id,motive_revision FROM v3_action_proposals WHERE object_id=?').get(action.object_id);
  db.prepare(`INSERT INTO v3_inner_dependencies(character_id,child_id,child_revision,dependency_id,parent_inner_id,parent_inner_revision,relation,confidence,valid_from)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(r.characterId,motive.motive_id,motive.motive_revision,'cycle',action.object_id,action.revision,'derived_from',1,at);
  assert.ok(buildTrace(r,{type:'action',id:action.object_id}).nodes[0].unavailable);
});
test('host source revocation removes an old canary across 40 real continues generations',t=>{
  const {r,at}=fixture(t),canary='撤销金丝雀-TRACE-40-GEN';
  const first=r.observe({adapter:'fixture-continue',externalId:'old-canary',kind:'chat',text:canary,occurredAt:at,metadata:{scope:'private:101'}},{kind:'experience-recorded',outcome:'observed',eventRoot:'old-canary'});
  r.inner.apply({summary:'记着 '+canary,changes:[]},{expectedGeneration:r.inner.head().generation,eventIds:[first.eventId],key:'canary-initial'});
  for(let i=0;i<40;i++){
    const e=r.observe({adapter:'fixture-continue',externalId:'next-'+i,kind:'chat',text:'今天的普通日常 '+i,occurredAt:at+i+1,metadata:{scope:'private:101'}},{kind:'experience-recorded',outcome:'observed',eventRoot:'continue-'+i});
    r.inner.apply({summary:'日常继续，还留着 '+canary,changes:[],...(i===39?{decision:{kind:'chat',personId:'qq:101',intent:'说说 '+canary,meaning:'想起从前的事'}}:{})},
      {expectedGeneration:r.inner.head().generation,eventIds:[e.eventId],key:'canary-generation-'+i,decisionContext:{fresh:true,origin:'foreground',eventIds:[e.eventId]}});
  }
  const action=r.store.db.prepare('SELECT object_id,revision FROM v3_action_proposals ORDER BY rowid DESC LIMIT 1').get();
  assert.ok(!buildTrace(r,{type:'action',id:action.object_id}).nodes[0].unavailable,'long normal continuity must stay usable');
  assert.ok(JSON.stringify(buildTrace(r,{type:'mood',id:'current'})).includes(canary));
  // Use the existing host withdrawal path, rather than editing a source status.
  const affected=r.inner.invalidateMemories([],{redact:true,sourceIds:[first.sourceId],reason:'fixture-user-source-withdrawal'});
  r.archive.erase(first.sourceId);
  assert.ok(r.store.db.prepare('SELECT count(*) n FROM v3_inner_invalidations').get().n>0);
  for(const query of [{type:'mood',id:'current'},{type:'action',id:action.object_id},{type:'inner',id:r.inner.head().state_id}]){
    const graph=buildTrace(r,query);assert.ok(!JSON.stringify(graph).includes(canary),'withdrawn text leaked from '+query.type);
  }
  assert.ok(Array.isArray(affected));
});
test('native reflection carries host evidence origin for self-statements, other statements, pasted history and actual bounded receipts',async t=>{
  const {r,at}=fixture(t),events=[];let captured;
  const observe=(externalId,kind,text,metadata,adapter='fixture-origin')=>{const e=r.observe({adapter,externalId,kind,text,occurredAt:at,metadata:{scope:'self',...metadata}},{kind:'experience-recorded',outcome:'observed',eventRoot:externalId});events.push(e.eventId);};
  observe('assistant-claim','chat','我说过“和你一起看过星星”，但此处只有这句话。',{speakerId:r.characterId,role:'assistant'});
  observe('other-claim','chat','你还记得上次见面吗？',{speakerId:'qq:101',role:'user'});
  observe('pasted-history','forwarded-chat','旧截图里的过去。',{speakerId:'qq:101',providedHistory:true});
  observe('specific-receipt','tool-result','受控读取器已读到本页文字，未看完整视频。',{speakerId:r.characterId,confirmedActionReceipt:true},'action-receipt');
  r.retriever.recall=async()=>({items:[],degradedChannels:[]});
  r.model.think=async input=>{captured=structuredClone(input.material);return {data:{summary:'区分这次读到的材料和话中描述的过去。',changes:[]},receipt:{id:'local-origin-projection-fixture',disposed:true,transcriptPersisted:false}};};
  await r.inner.reflect({eventIds:events,key:'origin-material-fixture'});
  const byText=text=>captured.newEvents.find(x=>x.text.startsWith(text)).evidenceOrigin;
  assert.deepEqual(byText('我说过').kinds,['assistant-statement']);assert.equal(byText('我说过').selfActionConfirmed,false);
  assert.deepEqual(byText('你还记得').kinds,['user-statement']);assert.equal(byText('你还记得').selfActionConfirmed,false);
  assert.deepEqual(byText('旧截图').kinds,['provided-history']);assert.equal(byText('旧截图').selfActionConfirmed,false);
  assert.deepEqual(byText('受控读取器').kinds,['confirmed-action-receipt']);assert.equal(byText('受控读取器').selfActionConfirmed,true);assert.equal(byText('受控读取器').receiptScope,'only-the-observed-action-not-events-narrated-in-its-output');
});
