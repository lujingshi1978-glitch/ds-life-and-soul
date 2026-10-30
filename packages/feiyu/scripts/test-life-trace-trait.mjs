import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CharacterCognition } from '../src/cognition/service.js';
import { buildTrace, createLifeTraceView, normalizeTraceFilters } from '../src/life-trace-view.js';

// All changed trait rows below are synthetic archived-version fixtures. They
// never call applyGrowth/registerGrowth and are not evidence of actual growth.
const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
function fixture(t){
  const root=fs.mkdtempSync(path.join(base,'trait-'));
  const r=new CharacterCognition({root,characterId:'character:trait-fixture',now:()=>1793300400000,embedding:null});
  r.policy.seed({identity:{text:'我是隔离测试角色。\n## 核心愿望\n慢慢认识世界。'},personality_growth:{text:'初始可变倾向。',locked:false}});
  r.enableInner();r.model.think=()=>{throw Error('TRAIT_VIEW_MUST_NOT_CALL_MODEL');};
  const e=r.observe({adapter:'trait-fixture',externalId:'observed-one',kind:'chat',text:'合成原始事件。',
    metadata:{scope:'private:101',speakerId:'qq:101'}},{kind:'chat-received',eventRoot:'fixture-one',outcome:'observed'});
  r.store.addNodes([{id:'memory:trait-one',kind:'episode',gist:'第一版合成记忆。',epistemic:'reported',
    evidence:[{sourceId:e.sourceId,revision:e.revision}],metadata:{scope:'private:101'}}]);
  t.after(async()=>{await r.close();const target=path.resolve(root);assert.ok(target.startsWith(base+path.sep));fs.rmSync(target,{recursive:true,force:true});});
  return {r,e,db:r.store.db};
}
function archived(db,revision,body,evidence,{current=true}={}){
  db.prepare('INSERT INTO v2_core_versions VALUES(?,?,?,?,?)').run('personality_growth',revision,body,JSON.stringify(evidence),1793300400000+revision);
  if(current)db.prepare('UPDATE v2_core SET body=?,revision=?,evidence=? WHERE field=?').run(body,revision,JSON.stringify(evidence),'personality_growth');
}
const trace=(r,revision,extra={})=>buildTrace(r,{type:'trait',id:'personality_growth',revision,maxDepth:3,maxNodes:30,...extra});

test('initial mutable field is initial setting, not learned growth; missing versions stay unknown; read is pure',t=>{
  const {r,db}=fixture(t),before=db.prepare('SELECT total_changes() n').get().n,abefore=r.archive.db.prepare('SELECT total_changes() n').get().n;
  const graph=trace(r),node=graph.nodes.find(n=>n.key===graph.focus);
  assert.equal(node.text,'初始可变倾向。');assert.equal(node.revision,1);assert.equal(node.status,'initial-setting');
  assert.equal(node.formation,'initial-setting');assert.equal(node.growthReview,'unknown');assert.equal(node.sourceCount,0);
  assert.match(node.detail,/初始/);assert.match(node.note,/没有可核对/);assert.equal(graph.modelCalls,0);assert.equal(graph.newCapture,false);
  assert.equal(trace(r,999).nodes[0].status,'unknown');
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before);assert.equal(r.archive.db.prepare('SELECT total_changes() n').get().n,abefore);
  assert.equal(db.prepare('SELECT count(*) n FROM v2_growth_events').get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM jobs WHERE kind='grow'").get().n,0);
});

test('old/current trait bodies retain their own revisions; legacy ID edges never pretend to pin historical memory versions',t=>{
  const {r,db}=fixture(t);archived(db,2,'第二版倾向存档。',['memory:trait-one']);archived(db,3,'第三版没有记忆依据。',[]);
  db.prepare('UPDATE memory_versions SET gist=? WHERE memory_id=? AND revision=1').run('现在可核对的记忆正文。','memory:trait-one');
  const old=trace(r,2),current=trace(r),n=old.nodes[0],edge=old.edges.find(e=>e.provenance==='legacy-id-reference');
  assert.equal(n.text,'第二版倾向存档。');assert.equal(n.revision,2);assert.equal(n.status,'historical-version');
  assert.equal(current.nodes[0].text,'第三版没有记忆依据。');assert.equal(current.nodes[0].formation,'unattributed-revision');
  assert.equal(n.growthReview,'unknown');assert.ok(edge);assert.equal(edge.historicalMemoryRevisionPinned,false);assert.equal(edge.causal,false);
  assert.equal(edge.referenceMemoryId,'memory:trait-one');assert.match(edge.label,/历史版本未固定/);assert.match(edge.note,/当前可用/);
  const memory=old.nodes.find(x=>x.type==='memory');assert.equal(memory.text,'现在可核对的记忆正文。');
  const reverse=buildTrace(r,{type:'memory',id:'memory:trait-one',maxDepth:1});
  assert.ok(reverse.edges.some(e=>e.provenance==='legacy-id-reference'&&e.direction==='incoming'&&e.to==='trait:personality_growth@2'));
  assert.ok(!reverse.edges.some(e=>e.provenance==='legacy-id-reference'&&e.to==='trait:personality_growth@3'));
});

test('withdrawn original source hides trait prose even after the same memory ID gets a clean current revision',t=>{
  const {r,db,e}=fixture(t);archived(db,2,'WITHDRAWN_DERIVED_CANARY',['memory:trait-one']);
  const fresh=r.observe({adapter:'trait-fixture',externalId:'correction',kind:'provenance-correction',text:'独立的当前修订。',metadata:{scope:'self'}},{kind:'source-corrected',eventRoot:'fresh-correction',outcome:'observed'});
  const old=db.prepare('SELECT * FROM memory_versions WHERE memory_id=? AND revision=1').get('memory:trait-one');
  db.prepare('INSERT INTO memory_versions VALUES(?,?,?,?,?,?,?,?)').run(r.characterId,'memory:trait-one',2,'修订后的干净记忆。','',old.content_hash,'{}',1793300400001);
  db.prepare('UPDATE memory_nodes SET current_revision=2 WHERE character_id=? AND memory_id=?').run(r.characterId,'memory:trait-one');
  const evidence=db.prepare('SELECT * FROM memory_evidence WHERE memory_id=? AND memory_revision=1 LIMIT 1').get('memory:trait-one');
  const value={...evidence,memory_revision:2,source_id:fresh.sourceId,source_revision:fresh.revision};
  const keys=Object.keys(value);db.prepare(`INSERT INTO memory_evidence(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>value[k]));
  assert.equal(buildTrace(r,{type:'memory',id:'memory:trait-one',maxDepth:1}).nodes[0].text,'修订后的干净记忆。');
  r.archive.db.prepare("UPDATE documents SET status='deleted' WHERE source_id=? AND revision=?").run(e.sourceId,e.revision);
  const graph=trace(r);assert.equal(graph.nodes[0].unavailable,true);assert.ok(!JSON.stringify(graph).includes('WITHDRAWN_DERIVED_CANARY'));
});

test('missing/foreign memory IDs, suppressed and historical-only source evidence do not expose derived trait text',t=>{
  const {r,db,e}=fixture(t);archived(db,2,'ONLY_OWNED_EVIDENCE_ALLOWED',['memory:only-foreign']);
  const n=db.prepare('SELECT * FROM memory_nodes WHERE memory_id=?').get('memory:trait-one'),v=db.prepare('SELECT * FROM memory_versions WHERE memory_id=?').get('memory:trait-one');
  const clone=(table,row,patch)=>{const value={...row,...patch},keys=Object.keys(value);db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>value[k]));};
  db.exec('PRAGMA foreign_keys=OFF');try{clone('memory_nodes',n,{character_id:'character:other',memory_id:'memory:only-foreign'});clone('memory_versions',v,{character_id:'character:other',memory_id:'memory:only-foreign',gist:'FOREIGN_MEMORY_BODY'});}finally{db.exec('PRAGMA foreign_keys=ON');}
  let graph=trace(r);assert.ok(graph.nodes[0].unavailable);assert.ok(!JSON.stringify(graph).includes('FOREIGN_MEMORY_BODY'));assert.ok(!JSON.stringify(graph).includes('ONLY_OWNED_EVIDENCE_ALLOWED'));
  archived(db,3,'SUPPRESSED_DERIVED_CANARY',['memory:trait-one']);
  db.prepare('INSERT INTO suppression VALUES(?,?,?,?,?)').run(r.characterId,'memory','memory:trait-one','fixture',1793300400000);
  graph=trace(r);assert.ok(graph.nodes[0].unavailable);assert.ok(!JSON.stringify(graph).includes('SUPPRESSED_DERIVED_CANARY'));
  db.prepare('DELETE FROM suppression WHERE character_id=? AND target_id=?').run(r.characterId,'memory:trait-one');
  db.prepare("UPDATE v3_source_effects SET status='historical' WHERE source_id=? AND revision=?").run(e.sourceId,e.revision);
  graph=trace(r);assert.ok(graph.nodes[0].unavailable);assert.ok(!JSON.stringify(graph).includes('SUPPRESSED_DERIVED_CANARY'));
});

test('oversized/malformed legacy evidence and excessive unpinned revision history fail closed',t=>{
  const {r,db}=fixture(t);archived(db,2,'OVERSIZED_TRAIT_BODY',Array.from({length:26},(_,i)=>'memory:oversized-'+i));
  assert.ok(trace(r).nodes[0].unavailable);
  db.prepare('UPDATE v2_core_versions SET evidence=? WHERE field=? AND revision=2').run('{invalid','personality_growth');
  db.prepare('UPDATE v2_core SET evidence=? WHERE field=?').run('{invalid','personality_growth');
  assert.doesNotThrow(()=>buildTrace(r,{type:'memory',id:'memory:trait-one',maxDepth:1}));assert.ok(trace(r).nodes[0].unavailable);
  archived(db,3,'TOO_MANY_HISTORY_CANARY',['memory:trait-one']);
  const old=db.prepare('SELECT * FROM memory_versions WHERE memory_id=? AND revision=1').get('memory:trait-one');
  for(let i=2;i<=26;i++)db.prepare('INSERT INTO memory_versions VALUES(?,?,?,?,?,?,?,?)').run(r.characterId,'memory:trait-one',i,old.gist,old.detail,old.content_hash,old.metadata_json,old.created_at+i);
  db.prepare('UPDATE memory_nodes SET current_revision=26 WHERE memory_id=?').run('memory:trait-one');
  const graph=trace(r);assert.ok(graph.nodes[0].unavailable);assert.ok(!JSON.stringify(graph).includes('TOO_MANY_HISTORY_CANARY'));
});

test('trait field allowlist never returns identity/custom/locked bodies or an inconsistent current archive',t=>{
  const {r,db}=fixture(t);
  for(const id of ['identity','custom','',"personality_growth' OR 1=1 --"]){assert.throws(()=>normalizeTraceFilters({type:'trait',id}),/TRACE_(?:TRAIT_FIELD_DENIED|ID_INVALID)/);}
  db.prepare("UPDATE v2_core SET locked=1,body='LOCKED_TRAIT_CANARY' WHERE field='personality_growth'").run();
  assert.ok(trace(r).nodes[0].unavailable);assert.ok(!JSON.stringify(trace(r)).includes('LOCKED_TRAIT_CANARY'));
  db.prepare("UPDATE v2_core SET locked=0,body='UNARCHIVED_TRAIT_CANARY' WHERE field='personality_growth'").run();
  assert.ok(trace(r).nodes[0].unavailable);assert.ok(!JSON.stringify(trace(r)).includes('UNARCHIVED_TRAIT_CANARY'));
});

test('trait reads keep console/agent/activation/character guards and return no foreign role context',t=>{
  const {r}=fixture(t),binding={profileId:'trait-fixture',activationEpoch:4};
  const view=createLifeTraceView({runtime:r,profile:{id:binding.profileId,name:'隔离倾向夹具'},getBinding:()=>binding,authorizeConsole:q=>q.console===true});
  const request={console:true,headers:{},context:{...binding},filters:{type:'trait',id:'personality_growth'}};
  assert.equal(view.read(request).nodes[0].formation,'initial-setting');
  assert.throws(()=>view.read({...request,console:false}),/CONSOLE_ADMIN_ONLY/);
  assert.throws(()=>view.read({...request,headers:{'x-agent-token':'fixture'}}),/CONSOLE_ADMIN_ONLY/);
  assert.throws(()=>view.read({...request,context:null}),/ROLE_READ_CONTEXT_REQUIRED/);
  assert.throws(()=>view.read({...request,context:{...binding,profileId:'other'}}),/ROLE_READ_CONFLICT/);
  binding.activationEpoch++;assert.throws(()=>view.read(request),/ROLE_READ_CONFLICT/);
  const original=r.characterId;r.characterId='character:other';try{assert.throws(()=>trace(r),/TRACE_CHARACTER_MISMATCH/);}finally{r.characterId=original;}
});
