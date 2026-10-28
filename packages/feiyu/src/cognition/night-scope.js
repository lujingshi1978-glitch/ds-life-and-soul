import {json,parse,hash,fail} from './contracts.js';
import {EXTRACTOR_VERSION,scheduleV3Encoding} from './v3-extraction.js';

export const NIGHT_KINDS=['encode','dream','grow','embed','embed-views','link-v3','archive-embed-v3','inner-dream-v3','history-v3','link-local-v3','repair-v3','review','reflect'];
export function installNightScopes(r){r.store.db.exec(`CREATE TABLE IF NOT EXISTS v3_night_scopes(day TEXT NOT NULL,role_epoch INTEGER NOT NULL,cutoff INTEGER NOT NULL,version INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(day,role_epoch));
 CREATE TABLE IF NOT EXISTS v3_night_members(day TEXT NOT NULL,role_epoch INTEGER NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(day,role_epoch,kind,id));`);}
export function nightScope(r,day,{create=false,cutoff}={}){
 const epoch=r.store.manifest().role_epoch,found=r.store.db.prepare('SELECT * FROM v3_night_scopes WHERE day=? AND role_epoch=?').get(day,epoch);
 if(!found&&!create)return null;
 if(!found)r.store.atomic('night-scope-created',()=>{r.store.db.prepare('INSERT OR IGNORE INTO v3_night_scopes VALUES(?,?,?,1,?)').run(day,epoch,cutoff,r.now());return {affected:[]};});
 return new NightScope(r,day,epoch,found?.cutoff??cutoff);
}
class NightScope{
 constructor(r,day,epoch,cutoff){Object.assign(this,{r,day,epoch,cutoff,db:r.store.db});this.members=new Map();this.addMember=this.db.prepare('INSERT OR IGNORE INTO v3_night_members VALUES(?,?,?,?)');}
 ids(kind){if(!this.members.has(kind))this.members.set(kind,new Set(this.db.prepare('SELECT id FROM v3_night_members WHERE day=? AND role_epoch=? AND kind=?').all(this.day,this.epoch,kind).map(x=>x.id)));return this.members.get(kind);}
 add(kind,id){const known=this.ids(kind);if(!known.has(id)){this.addMember.run(this.day,this.epoch,kind,id);known.add(id);}}
 refresh(){
  this.members.clear();
  const r=this.r,s=r.store;if(r.closed||r.closing||s.manifest().role_epoch!==this.epoch)fail('STALE_ROLE_EPOCH');const docs=new Map(r.archive.db.prepare('SELECT source_id,revision,adapter,external_id,kind,metadata FROM documents').all().map(d=>[d.source_id+'@'+d.revision,{...parse(d.metadata),nightReviewDay:d.adapter==='inner-night'&&d.kind==='night-review'?d.external_id:null}]));
  s.atomic('night-scope-refreshed',()=>{
   const roots=this.ids('source');
   for(const e of this.db.prepare('SELECT e.event_id,e.role_epoch,e.recorded_at,es.source_id,es.source_revision FROM cognitive_events e JOIN event_sources es USING(character_id,event_id) ORDER BY e.rowid').all()){
    const meta=docs.get(e.source_id+'@'+e.source_revision)||{};
    if(e.role_epoch===this.epoch&&(!meta.nightReviewDay||meta.nightReviewDay===this.day)&&(e.recorded_at<=this.cutoff||roots.has(e.source_id)||(meta.basisSources||[]).some(x=>roots.has(x.sourceId)))){this.add('event',e.event_id);this.add('source',e.source_id);roots.add(e.source_id);}
   }
   const seenVersions=this.ids('memory-version'),relatedMemories=new Set(this.db.prepare("SELECT DISTINCT d.memory_id FROM memory_source_dependencies d JOIN memory_nodes n ON n.memory_id=d.memory_id AND n.current_revision=d.memory_revision JOIN v3_night_members m ON m.id=d.source_id AND m.kind='source' AND m.day=? AND m.role_epoch=?").all(this.day,this.epoch).map(r=>r.memory_id));
   for(const n of this.db.prepare("SELECT memory_id,current_revision,recorded_at FROM memory_nodes WHERE status<>'forgotten'").all())if(n.recorded_at<=this.cutoff||relatedMemories.has(n.memory_id)){
    this.add('memory',n.memory_id);const version=n.memory_id+'@'+n.current_revision;
    if(!seenVersions.has(version)){const m=s.get(n.memory_id),topic=m?.metadata.topic||m?.kind;if(topic&&this.db.prepare('SELECT 1 FROM v2_dirty WHERE topic=? AND watermark>processed').get(topic))this.add('dream-memory',n.memory_id);this.add('memory-version',version);}
   }
   const memories=this.ids('memory'),events=this.ids('event'),jobs=this.ids('job'),repairs=this.ids('repair');
   for(const q of this.db.prepare('SELECT * FROM v3_repair_queue').all()){
    let relevant=q.kind==='memory'&&memories.has(q.target);
    if(q.kind==='psyche'){const row=this.db.prepare('SELECT body FROM v3_psyche_threads WHERE id=?').get(q.target),p=row?parse(row.body):{};relevant=(p.memoryRefs||[]).some(x=>memories.has(x.id))||(p.sourceRefs||[]).some(x=>roots.has(x.sourceId))||(p.reviewMemoryIds||[]).some(x=>memories.has(x))||(p.reviewSourceIds||[]).some(x=>roots.has(x));}
    if(relevant){this.add('repair',q.kind+'|'+q.target);repairs.add(q.kind+'|'+q.target);}
   }
   const related=value=>{if(typeof value==='string')return roots.has(value)||memories.has(value)||events.has(value)||jobs.has(value)||repairs.has('memory|'+value)||repairs.has('psyche|'+value);if(Array.isArray(value))return value.some(related);if(value&&typeof value==='object')return Object.values(value).some(related);return false;};
   const allJobs=this.db.prepare('SELECT j.*,b.at birth FROM jobs j LEFT JOIN v3_job_birth b USING(job_id) WHERE j.role_epoch=? AND j.kind IN (SELECT value FROM json_each(?)) ORDER BY j.rowid').all(this.epoch,json(NIGHT_KINDS));let changed=true;while(changed){changed=false;for(const j of allJobs){const p=j.parsed??=parse(j.payload_json),review=p.nightReview;if(!jobs.has(j.job_id)&&(review?review.day===this.day&&review.cutoff===this.cutoff&&review.roleEpoch===this.epoch:j.birth==null||j.birth<=this.cutoff||related(p))){this.add('job',j.job_id);jobs.add(j.job_id);changed=true;}}}
   return {affected:[]};
  });return this;
 }
 uncovered(){return this.db.prepare(`SELECT n.memory_id FROM v3_night_members m JOIN memory_nodes n ON n.memory_id=m.id JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision LEFT JOIN v2_dream_coverage c ON c.memory_id=n.memory_id AND c.topic=coalesce(json_extract(v.metadata_json,'$.topic'),n.kind) WHERE m.day=? AND m.role_epoch=? AND m.kind='dream-memory' AND n.status<>'forgotten' AND (coalesce(json_extract(v.metadata_json,'$.derived'),0)=0 OR coalesce(json_extract(v.metadata_json,'$.consolidationLevel'),1)<3) AND (c.revision IS NULL OR c.revision<>n.current_revision)`).all(this.day,this.epoch).map(r=>this.r.store.get(r.memory_id)).filter(Boolean);}
 uncoveredTopicCount(){return this.db.prepare(`SELECT count(DISTINCT coalesce(json_extract(v.metadata_json,'$.topic'),n.kind)) n FROM v3_night_members m JOIN memory_nodes n ON n.memory_id=m.id JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision LEFT JOIN v2_dream_coverage c ON c.memory_id=n.memory_id AND c.topic=coalesce(json_extract(v.metadata_json,'$.topic'),n.kind) WHERE m.day=? AND m.role_epoch=? AND m.kind='dream-memory' AND n.status<>'forgotten' AND (coalesce(json_extract(v.metadata_json,'$.derived'),0)=0 OR coalesce(json_extract(v.metadata_json,'$.consolidationLevel'),1)<3) AND (c.revision IS NULL OR c.revision<>n.current_revision)`).get(this.day,this.epoch).n;}
 splitEncoding(){const events=this.ids('event'),s=this.r.store;return s.atomic('night-encoding-partitioned',()=>{let split=0;for(const j of this.db.prepare("SELECT * FROM jobs WHERE role_epoch=? AND kind='encode' AND status='pending'").all(this.epoch)){
   const p=parse(j.payload_json),old=(p.parts||[]).filter(x=>events.has(x.eventId)),fresh=(p.parts||[]).filter(x=>!events.has(x.eventId));if(!old.length||!fresh.length)continue;
   // Keep the future partition's original identity/retry history. The old
   // partition inherits attempts/backoff; splitting never resets its budget.
   const id=s.enqueue('encode',{...p,parts:old,historical:true},{fingerprint:hash(['night-partition',j.job_id,old.map(x=>x.unitId||x.eventId)])});
   this.db.prepare('UPDATE jobs SET attempts=?,retry_at=? WHERE job_id=?').run(j.attempts,j.retry_at,id);
   this.db.prepare('UPDATE jobs SET payload_json=? WHERE job_id=?').run(json({...p,parts:fresh}),j.job_id);
   for(const part of old)if(part.unitId)this.db.prepare('UPDATE v3_extract_units SET job_id=? WHERE unit_id=? AND job_id=?').run(id,part.unitId,j.job_id);
   this.db.prepare("DELETE FROM v3_night_members WHERE day=? AND role_epoch=? AND kind='job' AND id=?").run(this.day,this.epoch,j.job_id);this.ids('job').delete(j.job_id);this.add('job',id);split++;
  }return {split,affected:[]};});}
 *preparationSteps(){
  yield ()=>this.refresh();
  yield ()=>{const events=[...this.ids('event')],started=performance.now();for(let page=0;page<4;page++){if(page&&performance.now()-started>50)break;const count=this.unscheduled();if(!count)break;scheduleV3Encoding(this.r,{eventIds:events,historical:true,limit:120});if(this.unscheduled()>=count)break;}this.splitEncoding();};
  yield ()=>this.r.repairs.schedule({targets:[...this.ids('repair')]});
  yield ()=>this.r.consolidator.schedule({ids:[...this.ids('dream-memory')],nightDay:this.day});
  yield ()=>this.r.inner.schedulePsychologyCompression();
  yield ()=>this.r.archiveVectors?.schedule({sourceIds:[...this.ids('source')]});
  yield ()=>this.refresh();
 }
 prepare(){for(const step of this.preparationSteps())step();return this;}
 async prepareAsync({signal}={}){const phases=['refresh','encoding','repairs','dreams','psyche','archive','refresh-final'],slices=[];this.r.lastMaintenanceSlices={at:this.r.now(),day:this.day,slices};for(const step of this.preparationSteps()){signal?.throwIfAborted();if(this.r.closed||this.r.closing||this.r.store.manifest().role_epoch!==this.epoch)fail('STALE_ROLE_EPOCH');const start=performance.now();step();const slice={phase:phases[slices.length],ms:Math.round(performance.now()-start)};slices.push(slice);this.r.onMaintenanceSlice?.(slice);await new Promise(resolve=>setTimeout(resolve,0));}return this;}

 unscheduled(){return this.db.prepare('SELECT count(*) n FROM event_sources es WHERE es.event_id IN (SELECT id FROM v3_night_members WHERE day=? AND role_epoch=? AND kind=\'event\') AND NOT EXISTS(SELECT 1 FROM v3_extract_units u WHERE u.event_id=es.event_id AND u.source_id=es.source_id AND u.source_revision=es.source_revision AND u.extractor_version=?)').get(this.day,this.epoch,EXTRACTOR_VERSION).n;}
 state(){
  this.refresh();const now=this.r.now(),jobs=this.db.prepare("SELECT j.* FROM jobs j JOIN v3_night_members m ON m.id=j.job_id AND m.kind='job' WHERE m.day=? AND m.role_epoch=? AND j.role_epoch=? AND j.status IN ('pending','running','failed')").all(this.day,this.epoch,this.epoch),pending=jobs.filter(j=>j.status!=='failed');
  const units=this.db.prepare("SELECT count(*) n FROM v3_extract_units u WHERE u.extractor_version=? AND u.event_id IN (SELECT id FROM v3_night_members WHERE day=? AND role_epoch=? AND kind='event') AND u.status NOT IN ('complete','adopted-v2-complete','no-primary-evidence','source-unavailable')").get(EXTRACTOR_VERSION,this.day,this.epoch).n;
  const repairs=this.db.prepare("SELECT q.* FROM v3_repair_queue q JOIN v3_night_members m ON m.id=q.kind||'|'||q.target AND m.kind='repair' WHERE m.day=? AND m.role_epoch=? AND q.status IN ('pending','reextract-scheduled')").all(this.day,this.epoch);
  const model=this.r.retriever.embedding?.modelId,roots=this.ids('source'),failures=model?this.r.archive.db.prepare("SELECT f.* FROM v3_resource_failures f JOIN documents d ON d.source_id=f.source_id AND d.revision=f.revision AND d.checksum=f.checksum WHERE f.model=? AND d.status='available' AND d.revision=(SELECT max(x.revision) FROM documents x WHERE x.source_id=d.source_id)").all(model).filter(f=>roots.has(f.source_id)):[];
  const unindexedDocuments=model?this.r.archive.db.prepare("SELECT d.source_id FROM documents d LEFT JOIN v3_resource_vector_progress p ON p.source_id=d.source_id AND p.revision=d.revision AND p.model=? WHERE d.status='available' AND length(d.body)>0 AND d.revision=(SELECT max(x.revision) FROM documents x WHERE x.source_id=d.source_id) AND (p.checksum IS NULL OR p.checksum<>d.checksum OR p.next_part<p.total)").all(model).filter(d=>roots.has(d.source_id)).length:0;
  const retryTimes=[...pending.map(j=>j.status==='running'?Number(j.lease_until):Number(j.retry_at)),...failures.filter(f=>f.failures<2).map(f=>f.retry_at)].filter(t=>t>now),byKind={};for(const j of pending)byKind[j.kind]=(byKind[j.kind]||0)+1;
  return {scopeVersion:1,pending:pending.length,byKind,unscheduledEvents:this.unscheduled(),uncoveredUnits:units,pendingRepairs:repairs.length,dirtyTopics:this.uncoveredTopicCount(),failedJobs:jobs.length-pending.length,unindexedDocuments,failedDocuments:failures.length,quarantinedDocuments:failures.filter(f=>f.failures>=2).length,backingOffDocuments:failures.filter(f=>f.failures<2&&f.retry_at>now).length,retryAt:retryTimes.length?Math.min(...retryTimes):0};
 }
 jobIds(){return [...this.ids('job')];}
}
