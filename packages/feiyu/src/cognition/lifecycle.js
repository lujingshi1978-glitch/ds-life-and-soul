import {storyAnchors} from './model-view.js';
import {forgetCoreLineage} from './core-lineage.js';
import {bounded,hash,json,parse,fail,unit} from './contracts.js';
import {invalidateProjections} from './consistency.js';

export class MemoryLifecycle {
  constructor(store){this.store=store;}
  revise(memoryId,expectedRevision,{gist,detail,status,detailState,metadata,validTo}={}){
    const s=this.store,m=s.get(memoryId,{includeInactive:true});if(!m||m.revision!==expectedRevision||m.status==='forgotten')fail('MEMORY_VERSION_CONFLICT');
    const next=m.revision+1,newGist=gist??m.gist,newDetail=detail??m.detail,meta=metadata??m.metadata;
    s.db.prepare('INSERT INTO memory_versions VALUES(?,?,?,?,?,?,?,?)').run(s.characterId,memoryId,next,newGist,newDetail,hash([newGist,newDetail]),json(meta),s.now());
    s.db.prepare(`INSERT INTO memory_evidence SELECT character_id,memory_id,?,source_id,source_revision,evidence_key,span_json,independence_group,role FROM memory_evidence WHERE character_id=? AND memory_id=? AND memory_revision=?`).run(next,s.characterId,memoryId,m.revision);
    s.db.prepare('INSERT OR IGNORE INTO dependencies SELECT character_id,child_id,?,parent_id,parent_revision FROM dependencies WHERE character_id=? AND child_id=? AND child_revision=?').run(next,s.characterId,memoryId,m.revision);
    s.db.prepare('INSERT OR IGNORE INTO memory_source_dependencies SELECT character_id,memory_id,?,source_id,source_revision FROM memory_source_dependencies WHERE character_id=? AND memory_id=? AND memory_revision=?').run(next,s.characterId,memoryId,m.revision);
    s.db.prepare('UPDATE memory_nodes SET current_revision=?,status=?,detail_state=?,valid_to=? WHERE character_id=? AND memory_id=?').run(next,status||m.status,detailState||m.detail_state,validTo??m.valid_to,s.characterId,memoryId);
    s.db.prepare('DELETE FROM v2_vectors WHERE memory_id=?').run(memoryId);s.db.prepare('DELETE FROM embedding_registry WHERE character_id=? AND memory_id=?').run(s.characterId,memoryId);s.index(memoryId);s.dirty(meta.topic||m.kind,'memory-revised');s.v3AfterWrite?.(memoryId);
    if(s.inner&&gist!==undefined&&gist!==m.gist){
      const affected=new Set([memoryId]);let grew=true;while(grew){grew=false;for(const d of s.db.prepare('SELECT d.child_id,d.parent_id FROM dependencies d JOIN memory_nodes n ON n.memory_id=d.child_id AND n.current_revision=d.child_revision').all())if(affected.has(d.parent_id)&&!affected.has(d.child_id)){affected.add(d.child_id);grew=true;}}
      for(const id of affected)if(id!==memoryId){s.db.prepare("UPDATE memory_nodes SET status='candidate' WHERE memory_id=? AND status<>'forgotten'").run(id);s.index(id);s.db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('memory',?,'parent-revised','pending')").run(id);}
      invalidateProjections(s,[...affected]);forgetCoreLineage(s,[...affected],{redact:false});s.inner.invalidateMemories([...affected],{reason:'memory-reinterpreted'});
    }return next;
  }
  protected(m){return !!m.metadata.disposition||m.kind==='assertion'||m.metadata.protected===true||m.metadata.boundary===true||m.salience>=.85;}
  attachEvidence(targetId,incomingId,{verified=false}={}){
    const s=this.store,a=s.get(targetId),b=s.get(incomingId);if(!verified||!a||!b||a.id===b.id||a.kind!==b.kind||!['knowledge','procedure','assertion'].includes(a.kind))fail('INVALID_EVIDENCE_ATTACHMENT');
    if(a.metadata.duplicateOf||b.metadata.duplicateOf)fail('INVALID_EVIDENCE_ATTACHMENT');
    if(a.assertion&&(json(a.assertion)!==json(b.assertion)||['promise','proposal','correction','question','joke'].includes(a.assertion.speechAct)))fail('INVALID_EVIDENCE_ATTACHMENT');
    const refs=[...new Map([...a.evidence,...b.evidence].map(e=>[hash([e.sourceId,e.revision,e.span,e.role]),e])).values()];if(refs.length>20)fail('EVIDENCE_ATTACHMENT_CAPACITY');
    this.revise(a.id,a.revision,{metadata:{...a.metadata,roots:[...new Set([...(a.metadata.roots||[a.event_root]),...(b.metadata.roots||[b.event_root])])],corroboratedBy:[...(a.metadata.corroboratedBy||[]),b.id]}});
    s.db.prepare('DELETE FROM memory_evidence WHERE memory_id=? AND memory_revision=?').run(a.id,a.revision+1);
    for(const e of refs)s.db.prepare('INSERT INTO memory_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(s.characterId,a.id,a.revision+1,e.sourceId,e.revision,hash([e.sourceId,e.revision,e.span,e.role]),json(e.span||{}),e.independenceGroup||e.sourceId,e.role||'supports');
    this.revise(b.id,b.revision,{metadata:{...b.metadata,duplicateOf:a.id}});s.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').run(a.id,a.revision+1);s.v3AfterWrite?.(a.id);s.addEdge(a.id,b.id,'supports',{provenance:'model_inference',evidence:refs});return {canonicalId:a.id,attached:b.id};
  }
  cool(memoryId,expectedRevision,{factor=.5}={}){if(!Number.isFinite(factor)||factor<=0||factor>=1)fail('INVALID_COOLING_FACTOR');const s=this.store;return s.atomic('memory-cooled',()=>{const m=s.get(memoryId);if(!m||m.revision!==expectedRevision)fail('MEMORY_VERSION_CONFLICT');this.revise(memoryId,expectedRevision,{});s.db.prepare('UPDATE memory_nodes SET base_strength=? WHERE character_id=? AND memory_id=?').run(m.base_strength*factor,s.characterId,memoryId);return {affected:[memoryId],confidenceUnchanged:true};});}
  fade(memoryId,expectedRevision,{autonomous=false}={}){
    return this.store.atomic('memory-detail-faded',()=>{
      const m=this.store.get(memoryId);if(!m)fail('MEMORY_UNAVAILABLE');if(autonomous&&this.protected(m))fail('MEMORY_PROTECTED');
      this.revise(memoryId,expectedRevision,{detail:'',detailState:'gist_only'});return {affected:[memoryId]};
    });
  }
  forget(memoryId,expectedRevision,{autonomous=false}={}){
    const s=this.store;return s.atomic('memory-forgotten',()=>this.forgetWithin(memoryId,expectedRevision,{autonomous}));
  }
  forgetWithin(memoryId,expectedRevision,{autonomous=false}={}){
    const s=this.store,m=s.get(memoryId,{includeInactive:true});if(!m||m.revision!==expectedRevision||m.status==='forgotten')fail('MEMORY_VERSION_CONFLICT');
    if(autonomous&&this.protected(m))fail('MEMORY_PROTECTED');
    const sourceIds=new Set(m.evidence.map(e=>e.sourceId)),affected=new Set([memoryId]),repair=new Map();
    if(!s.inner){for(const sourceId of sourceIds)s.db.prepare("INSERT OR IGNORE INTO suppression VALUES(?,'source',?,'subjective-forget',?)").run(s.characterId,sourceId,s.now());for(const row of s.db.prepare('SELECT memory_id,source_id FROM memory_evidence').all())if(sourceIds.has(row.source_id))affected.add(row.memory_id);}
    let grew=true;while(grew){grew=false;for(const d of s.db.prepare('SELECT d.child_id,d.parent_id FROM dependencies d JOIN memory_nodes n ON n.memory_id=d.child_id AND n.current_revision=d.child_revision WHERE d.character_id=?').all(s.characterId)){
      if(!affected.has(d.parent_id)&&!repair.has(d.parent_id)||affected.has(d.child_id)||repair.has(d.child_id))continue;
      const remaining=s.db.prepare('SELECT DISTINCT d.parent_id FROM dependencies d JOIN memory_nodes n ON n.memory_id=d.child_id AND n.current_revision=d.child_revision WHERE d.child_id=?').all(d.child_id).filter(p=>!affected.has(p.parent_id)&&!repair.has(p.parent_id)).map(p=>s.get(p.parent_id)).filter(Boolean);
      if(s.inner&&remaining.length)repair.set(d.child_id,remaining);else affected.add(d.child_id);grew=true;
    }}
    if(s.inner)for(const alias of s.list({limit:50000}))if(affected.has(alias.metadata.duplicateOf))affected.add(alias.id);
    if(autonomous&&[...affected].some(id=>{const n=s.get(id,{includeInactive:true});return n&&this.protected(n);}))fail('MEMORY_PROTECTED');
    for(const target of affected){const old=s.get(target,{includeInactive:true});if(s.inner&&old&&!old.metadata.disposition)for(const e of old.evidence)if(e.span?.length>0)s.db.prepare('INSERT OR IGNORE INTO v3_forget_spans VALUES(?,?,?,?,?)').run(e.sourceId,e.revision,e.span.offset,e.span.length,target);
      s.db.prepare("INSERT OR IGNORE INTO suppression VALUES(?,'memory',?,'subjective-forget',?)").run(s.characterId,target,s.now());
      s.db.prepare("UPDATE memory_nodes SET status='forgotten',detail_state='none',current_revision=current_revision+1 WHERE character_id=? AND memory_id=?").run(s.characterId,target);
      s.db.prepare("UPDATE memory_versions SET gist='',detail=NULL,metadata_json='{}' WHERE character_id=? AND memory_id=?").run(s.characterId,target);
      s.db.prepare("UPDATE assertions SET predicate='已遗忘',object_json='null',commitment_status=NULL,due_at=NULL WHERE memory_id=?").run(target);
      s.db.prepare("UPDATE memory_evidence SET span_json='{}' WHERE character_id=? AND memory_id=?").run(s.characterId,target);
      s.db.prepare('DELETE FROM recall_fts WHERE memory_id=?').run(target);s.db.prepare('DELETE FROM v2_vectors WHERE memory_id=?').run(target);s.db.prepare('DELETE FROM embedding_registry WHERE memory_id=?').run(target);
    }
    for(const [id,parents]of repair){const old=s.get(id,{includeInactive:true});if(!old)continue;
      this.revise(id,old.revision,{gist:'独立证据保留，等待重新整理',detail:'',detailState:'none',status:'candidate',metadata:{topic:old.metadata.topic||old.kind,repairNeeded:true,roots:[...new Set(parents.flatMap(p=>p.metadata.roots||[p.event_root]))]}});
      const revision=old.revision+1;s.db.prepare('DELETE FROM dependencies WHERE child_id=? AND child_revision=?').run(id,revision);for(const p of parents)s.db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?,?,?)').run(s.characterId,id,revision,p.id,p.revision);s.db.prepare('DELETE FROM memory_evidence WHERE memory_id=?').run(id);
      const refs=[...new Map(parents.flatMap(p=>p.evidence).map(e=>[hash([e.sourceId,e.revision,e.span]),e])).values()];
      for(const e of refs)s.db.prepare('INSERT INTO memory_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(s.characterId,id,revision,e.sourceId,e.revision,hash([e.sourceId,e.revision,e.span]),json(e.span||{}),e.independenceGroup||e.sourceId,e.role||'supports');
      s.db.prepare("UPDATE memory_versions SET gist='',detail=NULL,metadata_json='{}' WHERE memory_id=? AND revision<?").run(id,revision);
      s.db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('memory',?,'partial-forget','pending')").run(id);
    }
    const invalid=new Set([...affected,...repair.keys()]);
    for(const id of repair.keys()){s.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=(SELECT current_revision FROM memory_nodes WHERE memory_id=?)').run(id,id);s.v3AfterWrite?.(id);}
    invalidateProjections(s,[...invalid,...(!s.inner?[...sourceIds].map(id=>'source:'+id):[])]);
    if(s.inner)forgetCoreLineage(s,[...invalid]);else for(const r of s.db.prepare('SELECT field,evidence FROM v2_core WHERE locked=0').all())if(parse(r.evidence).some(id=>invalid.has(id)))s.db.prepare('DELETE FROM v2_core WHERE field=?').run(r.field);
    for(const r of s.db.prepare('SELECT job_id,report_json FROM maintenance_reports').all())if([...invalid].some(id=>r.report_json.includes(id)))s.db.prepare('UPDATE maintenance_reports SET report_json=? WHERE job_id=?').run(json({redacted:true,reason:'subjective-forget'}),r.job_id);
    for(const r of s.db.prepare('SELECT id,body FROM v2_proposals').all())if([...invalid].some(id=>r.body.includes(id)))s.db.prepare("UPDATE v2_proposals SET body='{}',status='redacted' WHERE id=?").run(r.id);
    s.inner?.invalidateMemories([...invalid],{redact:true,reason:'subjective-forget'});s.dirty(m.metadata.topic||m.kind,'forget-or-correction');return {affected:[...affected],rebuild:[...repair.keys()],sourceIds:[...sourceIds],archivePreserved:true};
  }
  supersede(oldId,newId,{validTo,correction=false}={}){
    return this.store.atomic(correction?'attribution-corrected':'fact-updated',()=>this.supersedeWithin(oldId,newId,{validTo,correction}));
  }
  supersedeWithin(oldId,newId,{validTo,correction=false}={}){
      const s=this.store;
      const old=s.get(oldId),fresh=s.get(newId);if(!old||!fresh)fail('MEMORY_UNAVAILABLE');
      if(correction&&!fresh.metadata.semanticVerified)fail('CORRECTION_NOT_VERIFIED');
      if(!correction&&old.assertion&&fresh.assertion&&(old.assertion.subjectId!==fresh.assertion.subjectId||old.assertion.predicate!==fresh.assertion.predicate))fail('UNRELATED_UPDATE');
      this.revise(oldId,old.revision,{status:correction?'contested':'outdated',validTo:validTo??fresh.occurred_at??s.now()});
      s.addEdge(newId,oldId,correction?'contradicts':'supersedes',{evidence:fresh.evidence});
      // Invalidate derived interpretations instead of silently retaining stale portraits.
      const invalid=new Set([oldId]);let grew=true;while(grew){grew=false;for(const d of s.db.prepare('SELECT d.child_id,d.parent_id FROM dependencies d JOIN memory_nodes n ON n.memory_id=d.child_id AND n.current_revision=d.child_revision WHERE d.character_id=?').all(s.characterId))if(invalid.has(d.parent_id)&&!invalid.has(d.child_id)){invalid.add(d.child_id);grew=true;}}
      for(const child of invalid)if(child!==oldId){s.db.prepare("UPDATE memory_nodes SET status='candidate' WHERE character_id=? AND memory_id=?").run(s.characterId,child);s.index(child);if(s.inner)s.db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('memory',?,'parent-revised','pending')").run(child);}
      invalidateProjections(s,[...invalid]);
      s.inner?.invalidateMemories([...invalid]);s.dirty(old.metadata.topic||old.kind,'contradiction');return {affected:[oldId,newId]};
  }
  abstract(group,snapshot){
    const s=this.store;if(!Array.isArray(group.ids)||group.ids.length<2||group.ids.length>8||new Set(group.ids).size!==group.ids.length)fail('INVALID_ABSTRACTION');
    const members=group.ids.map(id=>{const m=s.get(id),before=snapshot.find(r=>r.id===id);if(!m||!before||m.revision!==before.revision)fail('MEMORY_VERSION_CONFLICT');return m;});
    const selected=new Set(group.ids);for(const m of members){const todo=[...(m.metadata.children||[])],seen=new Set();while(todo.length){const id=todo.pop();if(selected.has(id))fail('INVALID_ABSTRACTION');if(seen.has(id))continue;seen.add(id);if(seen.size>5000)fail('INVALID_ABSTRACTION');todo.push(...(s.get(id)?.metadata.children||[]));}}
    const evidence=[...new Map(members.flatMap(m=>m.evidence).map(e=>[hash([e.sourceId,e.revision,e.span,e.role]),e])).values()];
    const id=s.writeNode({kind:'pattern',gist:bounded(group.gist,800),epistemic:'interpreted',evidence:evidence.slice(0,20),eventRoot:'derived:'+hash(members.map(m=>[m.id,m.revision])),confidence:Math.min(...members.map(m=>m.confidence)),salience:Math.max(...members.map(m=>m.salience)),topic:group.topic||members[0].metadata.topic||'pattern',metadata:{topic:group.topic||members[0].metadata.topic||members[0].kind,storyAnchors:storyAnchors(members),derived:true,consolidationLevel:Math.min(3,1+Math.max(...members.map(m=>m.metadata.consolidationLevel||(m.metadata.derived?1:0)))),consolidationLayer:['aspect','story','chapter'][Math.min(2,Math.max(...members.map(m=>m.metadata.consolidationLevel||(m.metadata.derived?1:0))))],children:group.ids,roots:[...new Set(members.flatMap(m=>m.metadata.roots||[m.event_root]))]},participants:members.flatMap(m=>m.participants.map(p=>({entityId:p.entity_id,role:p.role})))});
    for(const m of members){s.db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?,?,?)').run(s.characterId,id,1,m.id,m.revision);s.db.prepare('INSERT OR IGNORE INTO memory_members VALUES(?,?,?,?,?)').run(s.characterId,id,m.id,'supporting',1);s.addEdge(id,m.id,'abstracts',{evidence:m.evidence});}
    if(s.v3AfterWrite){s.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').run(id,s.get(id,{includeInactive:true}).revision);s.v3AfterWrite(id);}return id;
  }
  rebuildIndex(){const s=this.store;return s.atomic('index-rebuilt',()=>{s.db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5(character_id UNINDEXED,memory_id UNINDEXED,revision UNINDEXED,terms)');s.db.prepare('DELETE FROM recall_fts WHERE character_id=?').run(s.characterId);const rows=s.db.prepare('SELECT memory_id FROM memory_nodes WHERE character_id=?').all(s.characterId);rows.forEach(r=>s.index(r.memory_id));return {indexed:rows.length};});}
}
