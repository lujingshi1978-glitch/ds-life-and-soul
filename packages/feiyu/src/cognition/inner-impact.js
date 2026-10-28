import {hash,json,parse} from './contracts.js';

// A dependency belongs to a version, never to all future incarnations of an ID.
export function installInnerImpact(inner){
 const db=inner.db;
 db.exec(`CREATE INDEX IF NOT EXISTS inner_dep_memory_version ON v3_inner_dependencies(parent_memory_id,parent_memory_revision);
 CREATE INDEX IF NOT EXISTS inner_dep_source_version ON v3_inner_dependencies(parent_source_id,parent_source_revision);
 CREATE INDEX IF NOT EXISTS inner_dep_inner_version ON v3_inner_dependencies(parent_inner_id,parent_inner_revision);
 CREATE TABLE IF NOT EXISTS v3_inner_invalidations(object_id TEXT NOT NULL,revision INTEGER NOT NULL,reason TEXT NOT NULL,redacted INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(object_id,revision));`);
 // The previous-state pointer is narrative continuity, not factual derivation.
 db.exec(`UPDATE v3_inner_dependencies SET relation='continues' WHERE parent_inner_id IS NOT NULL AND EXISTS
 (SELECT 1 FROM v3_inner_states s WHERE s.object_id=child_id AND s.revision=child_revision AND s.previous_state_id=parent_inner_id AND s.previous_state_revision=parent_inner_revision)`);
}
export function planInnerImpact(inner,memoryIds,sourceIds,{memoryRefs,sourceRefs}={}){
 const db=inner.db,versions=new Map(),queue=[],key=(id,revision)=>id+'@'+revision;
 const add=d=>{const k=key(d.child_id,d.child_revision);if(!versions.has(k)){versions.set(k,{id:d.child_id,revision:d.child_revision});queue.push({id:d.child_id,revision:d.child_revision});}};
 const scan=(field,id,revision)=>db.prepare(`SELECT * FROM v3_inner_dependencies WHERE parent_${field}_id=? AND (? IS NULL OR parent_${field}_revision=?)`).all(id,revision??null,revision??null).forEach(add);
 for(const id of memoryIds){const refs=memoryRefs?.filter(r=>r.id===id);if(refs?.length)for(const r of refs)scan('memory',id,r.revision);else scan('memory',id);}
 const inferred=[];
 for(const id of sourceIds){const refs=sourceRefs?.filter(r=>r.sourceId===id),revisions=refs?.length?refs.map(r=>r.revision):[null];for(const revision of revisions){scan('source',id,revision);for(const m of db.prepare('SELECT DISTINCT memory_id id,memory_revision revision FROM memory_source_dependencies WHERE source_id=? AND (? IS NULL OR source_revision=?)').all(id,revision,revision)){scan('memory',m.id,m.revision);inferred.push(m);}}}
 for(let pos=0;pos<queue.length;pos++){const p=queue[pos];for(const d of db.prepare("SELECT * FROM v3_inner_dependencies WHERE parent_inner_id=? AND parent_inner_revision=? AND relation<>'continues'").all(p.id,p.revision))add(d);}
 const all=[...versions.values()],current=all.filter(r=>inner.object(r.id)?.current_revision===r.revision);
 const expandedIds=[...new Set([...memoryIds,...inferred.map(r=>r.id)])],expandedRefs=[...inferred,...(memoryRefs||memoryIds.flatMap(id=>db.prepare('SELECT revision FROM memory_versions WHERE memory_id=?').all(id).map(r=>({id,revision:r.revision}))))];
 return {versions:all,current,memoryIds:expandedIds,sourceIds,memoryRefs:expandedRefs,sourceRefs};
}
export function redactInnerVersion(inner,id,revision){
 const db=inner.db,body={};
 db.prepare('UPDATE v3_inner_versions SET body_json=?,content_hash=? WHERE object_id=? AND revision=?').run(json(body),hash(body),id,revision);
 const fields={v3_open_concerns:"title='已遗忘',personal_meaning='',continuation_conditions_json='{}',release_conditions_json='[]',resolution_summary=NULL",v3_relationship_cues:"personal_meaning='',known_facts_json='[]',uncertain_interpretation_json='[]'",v3_inner_wishes:"wish_text='已遗忘',why_it_matters='',revisit_conditions_json='[]'",v3_life_chapters:"title='已遗忘',personal_meaning='',narrative_so_far='',open_questions_json='[]',possible_continuations_json='[]'",v3_inner_motives:"what_draws_me=''",v3_action_proposals:"bounded_intent='',target_locator_json='{}'"};
 for(const [table,set]of Object.entries(fields))db.prepare(`UPDATE ${table} SET ${set} WHERE object_id=? AND revision=?`).run(id,revision);
}
export function recordInnerImpact(inner,plan,{redact,reason}){
 for(const r of plan.versions){inner.db.prepare('INSERT INTO v3_inner_invalidations VALUES(?,?,?,?,?) ON CONFLICT(object_id,revision) DO UPDATE SET redacted=max(redacted,excluded.redacted),reason=excluded.reason,at=excluded.at').run(r.id,r.revision,reason,redact?1:0,inner.now());if(redact&&inner.object(r.id)?.kind!=='inner_state')redactInnerVersion(inner,r.id,r.revision);}
}

// Only repair a status when the immutable current body explicitly records it,
// its exact evidence is healthy, and the invalid old branch is disjoint.
// Never invent erased prose or revive an execution.
export function reconcileHistoricalInnerStatuses(r){
 const i=r.inner,db=r.store.db;if(i.meta('innerVersionStatusRepairV1'))return i.meta('innerVersionStatusRepairV1');
 const source=ref=>{const s=db.prepare('SELECT status FROM v3_source_effects WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision),d=r.archive.db.prepare('SELECT status FROM documents WHERE source_id=? AND revision=?').get(ref.sourceId,ref.revision);return s?.status==='available'&&d?.status==='available'&&!r.store.suppressed(ref.sourceId);};
 const inspect=(id,revision,seen=new Set())=>{const key=id+'@'+revision;if(seen.has(key))return {valid:false,refs:new Set()};seen=new Set([...seen,key]);let valid=true;const refs=new Set(),deps=db.prepare("SELECT * FROM v3_inner_dependencies WHERE child_id=? AND child_revision=? AND relation<>'continues'").all(id,revision);if(!deps.length)valid=false;
  for(const d of deps){if(d.parent_source_id){const ref={sourceId:d.parent_source_id,revision:d.parent_source_revision};refs.add(ref.sourceId+'@'+ref.revision);valid=source(ref)&&valid;}
   if(d.parent_memory_id){const m=r.store.get(d.parent_memory_id);if(!m||m.revision!==d.parent_memory_revision)valid=false;const basis=db.prepare('SELECT source_id sourceId,source_revision revision FROM memory_source_dependencies WHERE memory_id=? AND memory_revision=?').all(d.parent_memory_id,d.parent_memory_revision);if(!basis.length)valid=false;for(const ref of basis){refs.add(ref.sourceId+'@'+ref.revision);valid=source(ref)&&valid;}}
   if(d.parent_inner_id){const p=i.object(d.parent_inner_id),part=inspect(d.parent_inner_id,d.parent_inner_revision,seen);valid=!!p&&p.current_revision===d.parent_inner_revision&&!p.invalidated_at&&part.valid&&valid;for(const ref of part.refs)refs.add(ref);}
  }return {valid,refs};};
 return r.store.atomic('inner-version-status-repaired',()=>{let examined=0,restored=0,needsEvidence=0;const affected=[];
  for(const o of db.prepare("SELECT * FROM v3_inner_objects WHERE status='contested' AND kind NOT IN ('anchor','inner_state','action')").all()){
   examined++;const current=i.object(o.object_id),expected=current.body.status;if(!['active','quiet','paused','resolved','released'].includes(expected)){needsEvidence++;continue;}
   const now=inspect(o.object_id,o.current_revision),old=db.prepare('SELECT revision FROM v3_inner_versions WHERE object_id=? AND revision<?').all(o.object_id,o.current_revision).map(v=>inspect(o.object_id,v.revision));
   if(!now.valid||!old.some(v=>!v.valid)||old.some(v=>[...now.refs].some(ref=>v.refs.has(ref)))){needsEvidence++;continue;}
   restored+=Number(db.prepare("UPDATE v3_inner_objects SET status=?,invalidated_at=NULL WHERE object_id=? AND current_revision=? AND status='contested'").run(expected,o.object_id,o.current_revision).changes);affected.push(o.object_id);
  }
  const report={examined,restored,needsEvidence,proseRestored:0,actionsReplayed:0,modelCalls:0,at:r.now()};i.meta('innerVersionStatusRepairV1',report);return {...report,affected};
 });
}
