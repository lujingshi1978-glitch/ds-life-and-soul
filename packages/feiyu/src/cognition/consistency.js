import {installCorrectionBarriers,reconcileCorrectionBarriers} from './correction-barriers.js';
import {hash,json,parse,fail} from './contracts.js';
import {installCoreLineage,forgetCoreLineage} from './core-lineage.js';
import {transferStructuredSpan} from './structured-spans.js';
import {basisSources,dependentSources,psycheBasisSnapshot,reconcilePsycheProjectionBasis} from './basis-sources.js';
import {memorySources} from './source-repair-coverage.js';

// Immutable bytes and permission to use an interpretation are separate things.
export function installConsistency(runtime){
  const s=runtime.store,db=s.db;
  db.exec(`CREATE TABLE IF NOT EXISTS v3_source_heads(source_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,checksum TEXT NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL,change_kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS v3_source_effects(source_id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(source_id,revision));
    CREATE TABLE IF NOT EXISTS v3_forget_spans(source_id TEXT NOT NULL,revision INTEGER NOT NULL,offset INTEGER NOT NULL,length INTEGER NOT NULL,memory_id TEXT NOT NULL,PRIMARY KEY(source_id,revision,offset,length,memory_id));
    CREATE TABLE IF NOT EXISTS v3_core_fragments(field TEXT NOT NULL,fragment_id TEXT NOT NULL,text TEXT NOT NULL,evidence_json TEXT NOT NULL,PRIMARY KEY(field,fragment_id));
    CREATE TABLE IF NOT EXISTS v3_repair_queue(kind TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(kind,target));`);
  const outcomeDDL=db.prepare("SELECT sql FROM sqlite_master WHERE name='v3_experience_outcomes'").get()?.sql;if(outcomeDDL&&!outcomeDDL.includes("'abstained'")){
    db.exec('BEGIN IMMEDIATE');try{db.exec(outcomeDDL.replace('CREATE TABLE v3_experience_outcomes','CREATE TABLE v3_outcomes_new').replace("'delivered'","'abstained','delivered'"));db.exec('INSERT INTO v3_outcomes_new SELECT * FROM v3_experience_outcomes;DROP TABLE v3_experience_outcomes;ALTER TABLE v3_outcomes_new RENAME TO v3_experience_outcomes;COMMIT;');}catch(e){db.exec('ROLLBACK');throw e;}
  }
  installCoreLineage(s);installCorrectionBarriers(runtime);
  for(const t of runtime.inner.psyche.list({includeInactive:true}).filter(t=>t.status==='candidate'&&t.text)){
    runtime.inner.psyche.write(t.id,{...t,uncertainBasis:true,reviewMemoryIds:(t.memoryRefs||[]).map(m=>m.id),reviewSourceIds:(t.sourceRefs||[]).map(e=>e.sourceId),reason:'依据需要核对；当时的感受继续承接'},'active');db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('psyche',?,'evidence-changed','pending')").run(t.id);
  }
  for(const row of runtime.archive.db.prepare('SELECT * FROM documents ORDER BY source_id,revision').all()){
    db.prepare("INSERT INTO v3_source_effects VALUES(?,?,?) ON CONFLICT(source_id,revision) DO UPDATE SET status='deleted' WHERE excluded.status='deleted'").run(row.source_id,row.revision,row.status==='deleted'?'deleted':'available');
    db.prepare('INSERT INTO v3_source_heads VALUES(?,?,?,1,?,?) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision,checksum=excluded.checksum,status=excluded.status WHERE excluded.revision>=revision').run(row.source_id,row.revision,row.checksum,row.status==='deleted'?'deleted':'available','baseline');
  }
  s.sourceUsable=(ref,{historical=false}={})=>{const state=db.prepare('SELECT status FROM v3_source_effects WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision);return !state||state.status==='available'||historical&&state.status==='historical';};
  s.sourceDependencies=refs=>basisSources(runtime,refs);
  s.invalidateSourceMemory=(id,refs)=>invalidateSourceClosure(runtime,refs,'source-correction',{seeds:[id]});
  s.refreshSourceDependencies=id=>{const m=s.get(id,{includeInactive:true});if(!m)return;db.prepare('DELETE FROM memory_source_dependencies WHERE memory_id=? AND memory_revision=?').run(id,m.revision);const refs=memorySources(runtime,m,{includeCache:false});for(const ref of refs)db.prepare('INSERT OR IGNORE INTO memory_source_dependencies VALUES(?,?,?,?,?)').run(s.characterId,id,m.revision,ref.sourceId,ref.revision);};
  s.onSourceReceived=(source,envelope)=>{
    const head=db.prepare('SELECT * FROM v3_source_heads WHERE source_id=?').get(source.sourceId);
    if(head&&source.revision<=head.revision)return;
    const old=head?runtime.archive.db.prepare('SELECT * FROM documents WHERE source_id=? AND revision=?').get(source.sourceId,head.revision):null;
    const metadata=source.metadata||{},prior=old?parse(old.metadata):{};
    const identityChanged=['speakerId','forwardedAuthorId','conversationPeerId'].some(k=>metadata[k]!==prior[k]);
    const kind=metadata.changeKind||(old?(old.body===source.text&&!identityChanged?'annotation':!source.text.trim()?'retraction':['homepage','post'].includes(source.kind)?'state-change':'correction'):'observation');
    db.prepare('INSERT OR REPLACE INTO v3_source_heads VALUES(?,?,?,?,?,?)').run(source.sourceId,source.revision,source.checksum,(head?.epoch||0)+1,'available',kind);
    db.prepare('INSERT OR REPLACE INTO v3_source_effects VALUES(?,?,?)').run(source.sourceId,source.revision,'available');if(['correction','retraction'].includes(kind))db.prepare('INSERT OR IGNORE INTO v3_correction_barriers VALUES(?,?)').run(source.sourceId,source.revision);
    if(metadata.basisSources?.length){try{if(basisSources(runtime,[{sourceId:source.sourceId,revision:source.revision}]).some(r=>!s.sourceRegistered(r))){runtime.archive.erase(source.sourceId);return;}}catch(e){if(e.code!=='BASIS_SOURCE_UNAVAILABLE')throw e;runtime.archive.erase(source.sourceId);return;}}
    if(!old||kind==='annotation'||kind==='observation'){
      const stale=(metadata.basisSources||[]).filter(r=>!s.sourceUsable(r));if(stale.length)invalidateSourceClosure(runtime,stale,'source-correction');return;
    }
    db.prepare("UPDATE v3_source_effects SET status='historical' WHERE source_id=? AND revision<? AND status<>'deleted'").run(source.sourceId,source.revision);
    const candidates=db.prepare('SELECT DISTINCT e.memory_id FROM memory_evidence e JOIN memory_nodes n ON n.memory_id=e.memory_id AND n.current_revision=e.memory_revision WHERE e.source_id=? AND e.source_revision<?').all(source.sourceId,source.revision).map(r=>r.memory_id),affected=[];
    for(const id of candidates){
      const memory=s.get(id,{includeInactive:true});if(!memory||['forgotten','candidate'].includes(memory.status)){affected.push(id);continue;}
      const replacements=[];let unchanged=!identityChanged&&!['correction','retraction'].includes(kind);
      for(const e of memory.evidence.filter(e=>e.sourceId===source.sourceId&&e.revision<source.revision)){
        const priorDoc=runtime.archive.get(e.sourceId,e.revision),span=e.span;
        if(!span?.length||e.role==='context'){unchanged=false;break;}
        const structured=transferStructuredSpan(priorDoc.text,source.text,span);if(structured){replacements.push({...e,revision:source.revision,span:structured});continue;}
        const before=priorDoc.text.slice(0,span.offset),left=Math.max(...['\n','。','！','？'].map(c=>before.lastIndexOf(c)))+1;
        const ends=['\n','。','！','？'].map(c=>priorDoc.text.indexOf(c,span.offset+span.length)).filter(n=>n>=0),right=ends.length?Math.min(...ends)+1:priorDoc.text.length,sentence=priorDoc.text.slice(left,right),at=source.text.indexOf(sentence);
        if(at<0||at>0&&!/[。！？\n]/.test(source.text[at-1])||source.text.indexOf(sentence,at+1)>=0){unchanged=false;break;}
        replacements.push({...e,revision:source.revision,span:{...span,offset:at+span.offset-left}});
      }
      if(!unchanged||!replacements.length){affected.push(id);continue;}
      // Only an unchanged, uniquely located literal statement is transferred.
      // Current understanding gets a new revision; old snapshots remain pinned.
      runtime.lifecycle.revise(id,memory.revision,{});const revision=memory.revision+1;
      db.prepare('DELETE FROM memory_evidence WHERE memory_id=? AND memory_revision=? AND source_id=?').run(id,revision,source.sourceId);
      for(const e of replacements)db.prepare('INSERT INTO memory_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(s.characterId,id,revision,e.sourceId,e.revision,hash([e.sourceId,e.revision,e.span,e.role]),json(e.span),e.independenceGroup||e.sourceId,e.role||'supports');
      db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').run(id,revision);s.v3AfterWrite?.(id);
    }
    const stale=db.prepare('SELECT revision FROM v3_source_effects WHERE source_id=? AND revision<?').all(source.sourceId,source.revision).map(r=>({sourceId:source.sourceId,revision:r.revision}));
    invalidateSourceClosure(runtime,stale,'source-'+kind,{seeds:affected,status:kind==='state-change'?'outdated':'candidate'});
    runtime.retriever.cache.clear();
  };
  const derivedFrom=id=>runtime.archive.db.prepare("SELECT DISTINCT d.source_id FROM documents d,json_each(CASE WHEN json_type(d.metadata,'$.basisSources')='array' THEN json_extract(d.metadata,'$.basisSources') ELSE '[]' END) b WHERE d.status<>'deleted' AND d.source_id<>? AND json_extract(CASE WHEN json_valid(b.value) THEN b.value ELSE '{}' END,'$.sourceId')=?").all(id,id);
  runtime.archive.onErase=sourceId=>{const children=derivedFrom(sourceId),apply=()=>{db.prepare("UPDATE v3_source_heads SET status='deleted',epoch=epoch+1 WHERE source_id=?").run(sourceId);db.prepare("UPDATE v3_source_effects SET status='deleted' WHERE source_id=?").run(sourceId);const ids=db.prepare('SELECT e.memory_id FROM memory_evidence e JOIN memory_nodes n ON n.memory_id=e.memory_id AND n.current_revision=e.memory_revision WHERE e.source_id=? UNION SELECT e.memory_id FROM memory_source_dependencies e JOIN memory_nodes n ON n.memory_id=e.memory_id AND n.current_revision=e.memory_revision WHERE e.source_id=?').all(sourceId,sourceId).map(r=>r.memory_id);db.prepare("UPDATE sources SET status='deleted' WHERE source_id=?").run(sourceId);for(const id of ids){const m=s.get(id,{includeInactive:true});if(m&&m.status!=='forgotten')runtime.lifecycle.forgetWithin(id,m.revision);}for(const row of db.prepare('SELECT e.memory_id,e.memory_revision revision FROM memory_evidence e JOIN memory_nodes n ON n.memory_id=e.memory_id WHERE e.source_id=? AND e.memory_revision<>n.current_revision UNION SELECT e.memory_id,e.memory_revision revision FROM memory_source_dependencies e JOIN memory_nodes n ON n.memory_id=e.memory_id WHERE e.source_id=? AND e.memory_revision<>n.current_revision').all(sourceId,sourceId)){db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').run(row.memory_id,row.revision);db.prepare("UPDATE memory_versions SET gist='',detail=NULL,metadata_json='{}',content_hash=? WHERE memory_id=? AND revision=?").run(hash(['source-erased',row.memory_id,row.revision]),row.memory_id,row.revision);}invalidateProjections(s,ids);forgetCoreLineage(s,ids);runtime.inner.invalidateMemories(ids,{sourceIds:[sourceId],redact:true});return {affected:ids};};const result=db.isTransaction?apply():s.atomic('archive-source-deleted',apply);for(const child of children)runtime.archive.erase(child.source_id);return result;};
  runtime.model.captureReadSet=material=>captureReadSet(runtime,material);
  runtime.model.validateReadSet=set=>validateReadSet(runtime,set);
  for(const row of runtime.archive.db.prepare("SELECT DISTINCT source_id FROM documents WHERE status='deleted'").all())if(db.prepare("SELECT 1 FROM sources WHERE source_id=? AND status<>'deleted'").get(row.source_id)||derivedFrom(row.source_id).length)runtime.archive.onErase(row.source_id);
  // Older installations have already passed the one-shot basis migration.
  // Projection reconciliation is cheap and independently idempotent on reopen.
  reconcilePsycheProjectionBasis(runtime);
}

export function invalidateSourceClosure(runtime,refs,reason,{seeds=[],status='candidate'}={}){
  const s=runtime.store,db=s.db,closure=dependentSources(runtime,refs),keys=new Set(closure.map(r=>r.sourceId+'@'+r.revision)),direct=new Set(seeds);
  for(const r of closure)db.prepare("UPDATE v3_source_effects SET status='historical' WHERE source_id=? AND revision=? AND status<>'deleted'").run(r.sourceId,r.revision);
  for(const r of closure)for(const row of db.prepare('SELECT DISTINCT d.memory_id FROM memory_source_dependencies d JOIN memory_nodes n ON n.memory_id=d.memory_id AND n.current_revision=d.memory_revision WHERE d.source_id=? AND d.source_revision=?').all(r.sourceId,r.revision)){
    const m=s.get(row.memory_id,{includeInactive:true});if(m&&['active','faded','contested','outdated'].includes(m.status))direct.add(m.id);
  }
  const affected=new Set(direct),deps=db.prepare('SELECT d.child_id,d.parent_id FROM dependencies d JOIN memory_nodes n ON n.memory_id=d.child_id AND n.current_revision=d.child_revision').all();let grew=true;while(grew){grew=false;for(const d of deps)if(affected.has(d.parent_id)&&!affected.has(d.child_id)){affected.add(d.child_id);grew=true;}}
  for(const id of affected){const m=s.get(id,{includeInactive:true});if(!m||m.status==='forgotten')continue;db.prepare("UPDATE memory_nodes SET status=?,valid_to=coalesce(valid_to,?) WHERE memory_id=?").run(direct.has(id)?status==='outdated'&&['candidate','contested'].includes(m.status)?m.status:status:'candidate',s.now(),id);s.index(id);db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('memory',?,?,'pending')").run(id,direct.has(id)&&!db.prepare('SELECT 1 FROM dependencies WHERE child_id=? AND child_revision=? LIMIT 1').get(id,m.revision)?reason:'parent-revised');}
  const ids=[...affected];invalidateProjections(s,ids);forgetCoreLineage(s,ids,{redact:false});runtime.inner.invalidateMemories(ids,{sourceIds:[...new Set(closure.map(r=>r.sourceId))],sourceRefs:closure,reason});runtime.retriever.cache.clear();return {affected:ids,sources:closure.length};
}

export function reconcileSourceClosure(runtime){
  if(runtime.inner.meta('sourceClosureVersion')===1)return {alreadyReconciled:true};
  return runtime.store.atomic('source-closure-reconciled',()=>{const db=runtime.store.db,refs=db.prepare("SELECT source_id sourceId,revision FROM v3_source_effects WHERE status='historical'").all();const report=refs.length?invalidateSourceClosure(runtime,refs,'source-correction'):{affected:[],sources:0};runtime.inner.meta('sourceClosureVersion',1);return report;});
}

export function reconcileMemoryProvenance(runtime){
  if(runtime.inner.meta('memoryProvenanceVersion')===3)return;
  const s=runtime.store,db=s.db;
  s.atomic('memory-provenance-reconciled',()=>{
    for(const n of db.prepare('SELECT memory_id,current_revision FROM memory_nodes').all()){
      if(!db.prepare('SELECT 1 FROM dependencies WHERE child_id=? AND child_revision=?').get(n.memory_id,n.current_revision)){
        const previous=db.prepare('SELECT max(child_revision) revision FROM dependencies WHERE child_id=? AND child_revision<?').get(n.memory_id,n.current_revision);
        if(previous?.revision)db.prepare('INSERT OR IGNORE INTO dependencies SELECT character_id,child_id,?,parent_id,parent_revision FROM dependencies WHERE child_id=? AND child_revision=?').run(n.current_revision,n.memory_id,previous.revision);
      }
      s.refreshSourceDependencies(n.memory_id);
    }
    const refs=db.prepare("SELECT DISTINCT d.source_id sourceId,d.source_revision revision FROM memory_source_dependencies d JOIN memory_nodes n ON n.memory_id=d.memory_id AND n.current_revision=d.memory_revision JOIN v3_source_effects e ON e.source_id=d.source_id AND e.revision=d.source_revision JOIN v3_source_heads h ON h.source_id=d.source_id WHERE (n.status IN ('active','faded') OR n.status='outdated' AND h.change_kind IN ('correction','retraction')) AND e.status='historical'").all();
    for(const ref of db.prepare("SELECT DISTINCT d.source_id sourceId,d.source_revision revision FROM memory_source_dependencies d JOIN memory_nodes n ON n.memory_id=d.memory_id AND n.current_revision=d.memory_revision JOIN v3_source_effects e ON e.source_id=d.source_id AND e.revision=d.source_revision WHERE n.status='outdated' AND e.status='historical'").all())if(runtime.archive.db.prepare("SELECT 1 FROM documents WHERE source_id=? AND revision>? AND json_extract(metadata,'$.changeKind') IN ('correction','retraction') LIMIT 1").get(ref.sourceId,ref.revision)&&!refs.some(r=>r.sourceId===ref.sourceId&&r.revision===ref.revision))refs.push(ref);
    if(refs.length)invalidateSourceClosure(runtime,refs,'source-correction');
    reconcileCorrectionBarriers(runtime);runtime.inner.meta('memoryProvenanceVersion',3);return {affected:[]};
  });
}

export function reconcileSourceRevisions(runtime){
  const s=runtime.store,db=s.db;if(runtime.inner.meta('sourceHistoryReconciled')===1)return {alreadyReconciled:true};
  const sources=runtime.archive.db.prepare("SELECT source_id FROM documents WHERE status<>'deleted' GROUP BY source_id HAVING count(*)>1").all();let reviewed=0;
  s.atomic('source-history-effects-reconciled',()=>{
    for(const {source_id:id}of sources){const head=db.prepare('SELECT * FROM v3_source_heads WHERE source_id=?').get(id);if(head?.change_kind!=='baseline')continue;
      const versions=runtime.archive.db.prepare("SELECT revision FROM documents WHERE source_id=? AND status<>'deleted' ORDER BY revision").all(id);const first=runtime.archive.get(id,versions[0].revision);
      db.prepare('UPDATE v3_source_heads SET revision=?,checksum=?,epoch=epoch+1 WHERE source_id=?').run(first.revision,first.checksum,id);
      for(const v of versions.slice(1))s.onSourceReceived(runtime.archive.get(id,v.revision),{});reviewed++;
    }runtime.inner.meta('sourceHistoryReconciled',1);return {affected:[],reviewed};
  });return {reviewed};
}

export function invalidateProjections(s,ids){
  const targets=new Set(ids);for(const id of ids)for(const e of s.get(id,{includeInactive:true})?.evidence||[])targets.add('source:'+e.sourceId);
  for(const p of s.db.prepare('SELECT * FROM projections').all())if(parse(p.dependency_ids_json).some(id=>targets.has(id))){
    if(p.kind==='state'){const state=parse(p.body_json);s.setProjection('state',p.target_key,{...state,psychological:'',affectRevision:(state.affectRevision||0)+1},{dependencies:[]});}
    else if(p.kind==='interests'){const items=(parse(p.body_json).items||[]).filter(i=>i.anchored||!(i.evidence||[]).some(id=>targets.has(id)));s.setProjection('interests',p.target_key,{items},{dependencies:items.flatMap(i=>i.evidence||[])});}
    else if(p.kind==='expressions'){const base=s.projection('expression-base')?.text||'',learned=(parse(p.body_json).learned||[]).filter(e=>!e.evidence.some(id=>targets.has(id)));s.setProjection('expressions',p.target_key,{text:[base,...learned.map(e=>e.text)].filter(Boolean).join('\n'),learned},{dependencies:learned.flatMap(e=>e.evidence)});}
    else s.db.prepare('DELETE FROM projections WHERE kind=? AND target_key=?').run(p.kind,p.target_key);
  }
}

export function captureReadSet(r,material){
  const set={characterId:r.characterId,epoch:r.store.manifest().role_epoch,redactionEpoch:r.inner.meta('redactionEpoch')||0,memories:[],sources:[],inner:[],psyche:[],historicalInner:[],core:r.policy.core().map(c=>({field:c.field,revision:c.revision}))};
  const projection=r.store.db.prepare("SELECT revision,status,body FROM v3_psyche_projection_current WHERE id='current'").get();
  set.psycheProjection=projection?{revision:projection.revision,status:projection.status,bodyHash:hash(projection.body),basis:psycheBasisSnapshot(r,parse(projection.body))}:null;
  const seen=new Set(),historical=material?.historical===true||material?.retrospective===true;
  const walk=(value,inheritedHistorical=historical)=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);const historicalValue=inheritedHistorical||value.historical===true||value.retrospective===true||['outdated','contested'].includes(value.status);
    const id=value.memoryId||value.id;if(typeof id==='string'&&(id.startsWith('memory:')||id.startsWith('legacy:'))&&Number.isInteger(value.revision??value.memoryRevision)){const allowInactive=value.needsReinterpretation===true&&value.subjectId===r.characterId&&value.interpretation==='subjective-not-person-fact',m=r.store.get(id,{includeInactive:allowInactive});set.memories.push({id,revision:value.revision??value.memoryRevision,status:m?.status,validTo:m?.valid_to,allowInactive:allowInactive&&!!m?.metadata.disposition});for(const ref of r.store.db.prepare('SELECT source_id sourceId,source_revision revision FROM memory_source_dependencies WHERE memory_id=? AND memory_revision=?').all(id,value.revision??value.memoryRevision)){const h=r.store.db.prepare('SELECT epoch FROM v3_source_heads WHERE source_id=?').get(ref.sourceId);set.sources.push({...ref,epoch:h?.epoch||0,historical:historicalValue||['outdated','contested'].includes(m?.status)});}}
    if(typeof id==='string'&&id.startsWith('inner:')&&Number.isInteger(value.revision))set.inner.push({id,revision:value.revision,contentHash:r.inner.object(id)?.content_hash,invalidatedAt:r.inner.object(id)?.invalidated_at??null,status:r.inner.object(id)?.status});
    const psyche=typeof id==='string'&&id.startsWith('psyche:')&&Number.isInteger(value.revision);
    if(psyche){
      const thread=r.store.db.prepare('SELECT revision,status,body FROM v3_psyche_threads WHERE id=?').get(id);
      set.psyche.push({id,revision:value.revision,status:thread?.status,bodyHash:thread?hash(thread.body):null});
      // A feeling's provenance names immutable old object versions. It is not
      // a claim that each old object is still the current version. Check the
      // exact version and the current feeling independently; never rebase it.
      // Presentation omits potentially large provenance. The host still owns
      // the exact selected thread/version and must validate its dependencies.
      const stored=thread&&thread.revision===value.revision?parse(thread.body):null;
      for(const ref of stored?.objectRefs||value.objectRefs||[]){
        const version=r.store.db.prepare('SELECT body_json,content_hash FROM v3_inner_versions WHERE object_id=? AND revision=?').get(ref.id,ref.revision);
        set.historicalInner.push({id:ref.id,revision:ref.revision,contentHash:version?.content_hash,bodyHash:version?hash(version.body_json):null});
      }
    }
    if(value.sourceId&&Number.isInteger(value.revision??value.sourceRevision)){const revision=value.revision??value.sourceRevision,head=r.store.db.prepare('SELECT epoch FROM v3_source_heads WHERE source_id=?').get(value.sourceId);set.sources.push({sourceId:value.sourceId,revision,epoch:head?.epoch||0,historical:historicalValue});for(const basis of basisSources(r,[{sourceId:value.sourceId,revision}]))if(basis.sourceId!==value.sourceId||basis.revision!==revision){const h=r.store.db.prepare('SELECT epoch FROM v3_source_heads WHERE source_id=?').get(basis.sourceId);set.sources.push({...basis,epoch:h?.epoch||0,historical:true});}}
    for(const [key,child]of Object.entries(value)){if(['sourceRefs','memoryRefs'].includes(key)||psyche&&key==='objectRefs'||key==='object'&&'predicate' in value&&'speakerId' in value)continue;if(Array.isArray(child))child.forEach(c=>walk(c,historicalValue));else if(child&&typeof child==='object')walk(child,historicalValue);}
  };walk(material);validateReadSet(r,set);return set;
}
export function validateReadSet(r,set){
  if(r.closed||r.closing||set.characterId!==r.characterId||r.store.manifest().role_epoch!==set.epoch)fail('STALE_ROLE_EPOCH');
  if((set.redactionEpoch||0)!==(r.inner.meta('redactionEpoch')||0))fail('COGNITION_READSET_STALE');
  if(Object.hasOwn(set,'psycheProjection')){
    const projection=r.store.db.prepare("SELECT revision,status,body FROM v3_psyche_projection_current WHERE id='current'").get(),ref=set.psycheProjection;
    if(!ref?!!projection:!projection||projection.revision!==ref.revision||projection.status!==ref.status||hash(projection.body)!==ref.bodyHash)fail('COGNITION_READSET_STALE');
    if(ref){const basis=psycheBasisSnapshot(r,parse(projection.body));if(hash(basis)!==hash(ref.basis))fail('COGNITION_READSET_STALE');if(ref.status==='valid'&&(basis.sources.some(s=>!s.documentStatus||s.documentStatus==='deleted'||s.headStatus==='deleted'||s.suppressed)||basis.memories.some(m=>!m.versionHash||m.status==='forgotten'||m.suppressed)))fail('COGNITION_READSET_STALE');}
  }
  for(const c of set.core)if(r.policy.core().find(x=>x.field===c.field)?.revision!==c.revision)fail('COGNITION_READSET_STALE');
  for(const ref of set.memories){const m=r.store.get(ref.id,{includeInactive:ref.allowInactive===true});if(!m||m.revision!==ref.revision||m.status!==ref.status||m.valid_to!==ref.validTo)fail('COGNITION_READSET_STALE');}
  for(const ref of set.inner){const o=r.inner.object(ref.id);if(!o||o.current_revision!==ref.revision||o.content_hash!==ref.contentHash||(o.invalidated_at??null)!==ref.invalidatedAt||o.status!==ref.status)fail('COGNITION_READSET_STALE');}
  for(const ref of set.psyche||[]){const t=r.store.db.prepare('SELECT revision,status,body FROM v3_psyche_threads WHERE id=?').get(ref.id);if(!t||t.revision!==ref.revision||t.status!==ref.status||hash(t.body)!==ref.bodyHash)fail('COGNITION_READSET_STALE');}
  for(const ref of set.historicalInner||[]){const v=r.store.db.prepare('SELECT body_json,content_hash FROM v3_inner_versions WHERE object_id=? AND revision=?').get(ref.id,ref.revision);if(!v||v.body_json==='{}'||v.content_hash!==ref.contentHash||hash(v.body_json)!==ref.bodyHash)fail('COGNITION_READSET_STALE');}
  for(const ref of set.sources){const h=r.store.db.prepare('SELECT * FROM v3_source_heads WHERE source_id=?').get(ref.sourceId),doc=r.archive.db.prepare('SELECT status FROM documents WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision);if(!doc||doc.status==='deleted'||r.store.suppressed(ref.sourceId)||(h?.epoch||0)!==ref.epoch||h?.status==='deleted'||!r.store.sourceUsable(ref,{historical:ref.historical}))fail('COGNITION_READSET_STALE');}
  return true;
}
