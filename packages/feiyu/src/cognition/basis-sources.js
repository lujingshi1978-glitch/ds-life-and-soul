import {fail,parse,hash} from './contracts.js';

// Follow exact source versions, so a corrected root invalidates an old derived
// note without invalidating a newer note already based on the corrected root.
export function dependentSources(runtime,refs){
  const reverse=new Map();for(const d of runtime.archive.db.prepare("SELECT source_id,revision,metadata FROM documents WHERE status<>'deleted'").all())for(const b of parse(d.metadata).basisSources||[]){const key=b.sourceId+'@'+b.revision;const rows=reverse.get(key)||[];rows.push({sourceId:d.source_id,revision:d.revision});reverse.set(key,rows);}
  const seen=new Map(),todo=[...refs];while(todo.length){const r=todo.pop(),key=r.sourceId+'@'+r.revision;if(seen.has(key))continue;seen.set(key,r);todo.push(...(reverse.get(key)||[]));}return [...seen.values()];
}

// Host-owned provenance closure. It does not add text to the model context.
export function basisSources(runtime,refs){
  const todo=[...refs],seen=new Map(),db=runtime.store.db,archive=runtime.archive.db;
  while(todo.length){const ref=todo.pop();if(!ref?.sourceId||!Number.isInteger(ref.revision))fail('BASIS_SOURCE_UNAVAILABLE');const key=ref.sourceId+'@'+ref.revision;if(seen.has(key))continue;
    if(seen.size>=4096)fail('BASIS_SOURCE_LIMIT');if(!db.prepare('SELECT 1 FROM sources WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision))fail('BASIS_SOURCE_UNAVAILABLE');
    const row=archive.prepare('SELECT metadata,status FROM documents WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision);if(!row)fail('BASIS_SOURCE_UNAVAILABLE');seen.set(key,{sourceId:ref.sourceId,revision:ref.revision});
    if(row.status!=='deleted')todo.push(...(parse(row.metadata).basisSources||[]));
  }return [...seen.values()].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.revision-b.revision);
}

// Exact immutable evidence bytes and the current permission/state of that
// evidence are recorded separately. This metadata never carries source prose.
export function psycheBasisSnapshot(runtime,{sourceRefs=[],memoryRefs=[],basisThreadRefs=[],previousProjectionRevision}={}){
  const db=runtime.store.db,archive=runtime.archive.db,refs=new Map(sourceRefs.map(r=>[r.sourceId+'@'+r.revision,r])),exists=table=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const memories=memoryRefs.map(ref=>{
    const node=db.prepare('SELECT current_revision,status,detail_state,invalidated_at FROM memory_nodes WHERE memory_id=?').get(ref.id),version=db.prepare('SELECT * FROM memory_versions WHERE memory_id=? AND revision=?').get(ref.id,ref.revision),snapshot=exists('v3_memory_snapshots')?db.prepare('SELECT body FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').get(ref.id,ref.revision):null;
    for(const e of db.prepare('SELECT source_id sourceId,source_revision revision FROM memory_evidence WHERE memory_id=? AND memory_revision=?').all(ref.id,ref.revision))refs.set(e.sourceId+'@'+e.revision,e);
    if(exists('memory_source_dependencies'))for(const e of db.prepare('SELECT source_id sourceId,source_revision revision FROM memory_source_dependencies WHERE memory_id=? AND memory_revision=?').all(ref.id,ref.revision))refs.set(e.sourceId+'@'+e.revision,e);
    return {id:ref.id,revision:ref.revision,currentRevision:node?.current_revision??null,status:node?.status??null,detailState:node?.detail_state??null,versionHash:version?hash(version):null,snapshotHash:snapshot?hash(snapshot.body):null,suppressed:runtime.store.nodeSuppressed(ref.id),invalidatedAt:node?.invalidated_at??null};
  }).sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision);
  let closure;try{closure=basisSources(runtime,[...refs.values()]);}catch{closure=[...refs.values()];}
  const sources=closure.map(ref=>{
    const head=exists('v3_source_heads')?db.prepare('SELECT revision,epoch,status FROM v3_source_heads WHERE source_id=?').get(ref.sourceId):null,effect=exists('v3_source_effects')?db.prepare('SELECT status FROM v3_source_effects WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision):null,document=archive.prepare('SELECT checksum,metadata,status,body FROM documents WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision);
    return {sourceId:ref.sourceId,revision:ref.revision,headRevision:head?.revision??null,headEpoch:head?.epoch??0,headStatus:head?.status??null,effectStatus:effect?.status??null,documentStatus:document?.status??null,documentHash:document?hash(document):null,suppressed:runtime.store.suppressed(ref.sourceId)};
  }).sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.revision-b.revision);
  const threads=basisThreadRefs.map(ref=>{const row=exists('v3_psyche_versions')?db.prepare('SELECT status,body FROM v3_psyche_versions WHERE id=? AND revision=?').get(ref.id,ref.revision):null;return {id:ref.id,revision:ref.revision,status:row?.status??null,bodyHash:row?hash(row.body):null};}).sort((a,b)=>a.id.localeCompare(b.id)||a.revision-b.revision);
  const parent=Number.isInteger(previousProjectionRevision)&&exists('v3_psyche_projection_versions')?db.prepare("SELECT status,body FROM v3_psyche_projection_versions WHERE id='current' AND revision=?").get(previousProjectionRevision):null;
  return {sources,memories,threads,previousProjection:Number.isInteger(previousProjectionRevision)?{revision:previousProjectionRevision,status:parent?.status??null,bodyHash:parent?hash(parent.body):null}:null};
}

// Availability and privacy are checked before comparing historical bytes. A
// past impression becoming outdated (or fading) does not alter what was felt
// then. It is safe to retain that history only when the exact pinned content,
// version, detail availability and permission are still unchanged. Revision
// advances and unknown states remain review-required: there is no host proof
// here that a newer version is mere growth rather than a factual correction.
const EVOLVING_MEMORY_STATUSES=new Set(['active','faded','outdated']);
export function classifyProjectionBasisChange(kind,prior,current,{usable=true}={}){
  const review=reason=>({kind:'review-required',reason});
  if(!current)return review('basis-missing');
  if(current.suppressed||kind==='source'&&(current.documentStatus==='deleted'||current.headStatus==='deleted')||kind==='memory'&&['forgotten','redacted'].includes(current.status))return {kind:'privacy-withdrawn',reason:'permission-withdrawn'};
  if(kind==='source'){
    if(!current.documentStatus||!current.documentHash)return review('source-missing');
    if(!usable)return review('source-unusable');
    return Object.keys(prior||{}).length&&hash(prior)!==hash(current)?review('source-version-or-permission-changed'):{kind:'unchanged',reason:'exact-source-available'};
  }
  if(!current.versionHash||!current.status)return review('memory-missing');
  if(current.invalidatedAt!=null)return review('memory-invalidated');
  if(!EVOLVING_MEMORY_STATUSES.has(current.status))return review('memory-state-needs-review');
  if(!Object.keys(prior||{}).length){
    if(current.detailState!=='available'||!current.snapshotHash)return review('legacy-memory-availability-unproven');
    // Current availability cannot establish byte equality with an unrecorded
    // past basis. One ordinary evidence-backed integration creates a new
    // snapshot; until then the historical derivation remains unverified.
    return review('legacy-basis-unverifiable');
  }
  // Normalize only the newly recorded invalidation timestamp for old snapshots;
  // missing non-null values remain a change. All other recorded fields count.
  const before={...prior,invalidatedAt:prior.invalidatedAt??null},after={...current,invalidatedAt:current.invalidatedAt??null};
  if(hash(before)===hash(after))return {kind:'unchanged',reason:'exact-memory-available'};
  if(EVOLVING_MEMORY_STATUSES.has(before.status)&&before.status!==after.status&&hash({...before,status:after.status})===hash(after))return {kind:'normal-evolution',reason:'availability-status-only'};
  return review('memory-content-version-or-availability-changed');
}

export function reconcilePsycheProjectionBasis(runtime){
  const db=runtime.store.db;if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='v3_psyche_projection_current'").get())return {redactedSources:0,redactedMemories:0,changedSources:0,changedMemories:0};
  const current=()=>db.prepare("SELECT * FROM v3_psyche_projection_current WHERE id='current'").get(),cache=new Map(),actual=dependency=>{
    const key=dependency.kind+':'+dependency.target_id+'@'+dependency.target_revision;if(cache.has(key))return cache.get(key);
    const ref=dependency.kind==='source'?{sourceId:dependency.target_id,revision:dependency.target_revision}:{id:dependency.target_id,revision:dependency.target_revision},snapshot=psycheBasisSnapshot(runtime,dependency.kind==='source'?{sourceRefs:[ref]}:{memoryRefs:[ref]}),value=dependency.kind==='source'?snapshot.sources.find(s=>s.sourceId===ref.sourceId&&s.revision===ref.revision):snapshot.memories.find(m=>m.id===ref.id&&m.revision===ref.revision);cache.set(key,value);return value;
  };
  const forgottenSources=new Map(),forgottenMemories=new Map(),historical=db.prepare("SELECT DISTINCT d.kind,d.target_id,d.target_revision FROM v3_psyche_projection_dependencies d JOIN v3_psyche_projection_versions v ON v.revision=d.revision WHERE v.status<>'redacted' AND d.kind IN ('source','memory')").all();
  for(const dependency of historical){const ref=actual(dependency);if(dependency.kind==='source'&&(ref.documentStatus==='deleted'||ref.headStatus==='deleted'||ref.suppressed))forgottenSources.set(ref.sourceId+'@'+ref.revision,{sourceId:ref.sourceId,revision:ref.revision});else if(dependency.kind==='memory'&&(['forgotten','redacted'].includes(ref.status)||ref.suppressed))forgottenMemories.set(ref.id+'@'+ref.revision,{id:ref.id,revision:ref.revision});}
  if(forgottenSources.size||forgottenMemories.size)runtime.inner.invalidateMemories([...new Set([...forgottenMemories.values()].map(r=>r.id))],{redact:true,sourceIds:[...new Set([...forgottenSources.values()].map(r=>r.sourceId))],sourceRefs:[...forgottenSources.values()],memoryRefs:[...forgottenMemories.values()],reason:'projection-offline-forgetting'});
  const live=current(),changedSources=[],changedMemories=[],changes=[];
  if(live?.status==='valid'){
    // Walk persistent lineage only during reconciliation. Per-turn context and
    // read sets retain the direct version and one parent hash, never a union of
    // every ancestor's sources. Canonical corrections use the indexed closure.
    const lineage=db.prepare("WITH RECURSIVE ancestry(revision) AS (SELECT ? UNION SELECT l.parent_revision FROM v3_psyche_projection_lineage l JOIN ancestry a ON l.revision=a.revision) SELECT d.* FROM ancestry a JOIN v3_psyche_projection_dependencies d ON d.revision=a.revision WHERE d.kind IN ('source','memory')").all(live.revision);
    for(const dependency of lineage){const ref=actual(dependency),prior=parse(dependency.observation_json),change=classifyProjectionBasisChange(dependency.kind,prior,ref,{usable:dependency.kind!=='source'||runtime.store.sourceUsable(ref)});if(change.kind!=='unchanged')changes.push({projectionRevision:dependency.revision,basisKind:dependency.kind,id:dependency.target_id,revision:dependency.target_revision,...change});if(['review-required','privacy-withdrawn'].includes(change.kind)){if(dependency.kind==='source'&&!changedSources.some(s=>s.sourceId===ref.sourceId&&s.revision===ref.revision))changedSources.push({sourceId:ref.sourceId,revision:ref.revision});if(dependency.kind==='memory'&&!changedMemories.some(m=>m.id===ref.id&&m.revision===ref.revision))changedMemories.push({id:ref.id,revision:ref.revision});}}
    if(changedSources.length||changedMemories.length)runtime.inner.invalidateMemories([...new Set(changedMemories.map(r=>r.id))],{sourceIds:[...new Set(changedSources.map(r=>r.sourceId))],sourceRefs:changedSources,memoryRefs:changedMemories,reason:'projection-offline-basis-changed'});
  }
  return {redactedSources:forgottenSources.size,redactedMemories:forgottenMemories.size,changedSources:changedSources.length,changedMemories:changedMemories.length,changes};
}

export function reconcileBasisDependencies(runtime){
  const db=runtime.store.db;let added=0;const erased=new Set(),changed=new Set();
  for(const row of db.prepare('SELECT DISTINCT child_id,child_revision,parent_source_id,parent_source_revision FROM v3_inner_dependencies WHERE parent_source_id IS NOT NULL').all()){
    let refs;try{refs=basisSources(runtime,[{sourceId:row.parent_source_id,revision:row.parent_source_revision}]);}catch{continue;}
    for(const ref of refs){if(!db.prepare('SELECT 1 FROM v3_inner_dependencies WHERE child_id=? AND child_revision=? AND parent_source_id=? AND parent_source_revision=?').get(row.child_id,row.child_revision,ref.sourceId,ref.revision)){
      runtime.inner.insert('v3_inner_dependencies',{character_id:runtime.characterId,child_id:row.child_id,child_revision:row.child_revision,dependency_id:'basis:'+row.child_id+':'+row.child_revision+':'+ref.sourceId+':'+ref.revision,parent_source_id:ref.sourceId,parent_source_revision:ref.revision,relation:'derived_from',confidence:1,valid_from:runtime.now()});added++;
    }}
  }
  for(const t of runtime.inner.psyche.list({includeInactive:true}))for(const ref of t.sourceRefs||[]){const status=runtime.archive.db.prepare('SELECT status FROM documents WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision)?.status;if(status==='deleted')erased.add(ref.sourceId);else if(!runtime.store.sourceUsable(ref))changed.add(ref.sourceId);}
  for(const id of erased)runtime.archive.onErase(id);if(changed.size)runtime.inner.invalidateMemories([],{sourceIds:[...changed],reason:'basis-source-reconciled'});
  return {added,erased:erased.size,changed:changed.size,psycheProjection:reconcilePsycheProjectionBasis(runtime)};
}
