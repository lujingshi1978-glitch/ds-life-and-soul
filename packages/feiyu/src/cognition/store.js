import {energyExempt} from '../energy-context.js';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {bounded,id,json,parse,hash,fail,unit,terms,NODE_KINDS,LIVE_STATUSES,evidenceKey,entityId as validateEntity,sqlIds} from './contracts.js';

const extra=`
CREATE TABLE IF NOT EXISTS v3_job_birth(job_id TEXT PRIMARY KEY,at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS memory_source_dependencies(character_id TEXT NOT NULL,memory_id TEXT NOT NULL,memory_revision INTEGER NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,PRIMARY KEY(character_id,memory_id,memory_revision,source_id,source_revision));
CREATE INDEX IF NOT EXISTS memory_source_dependencies_source ON memory_source_dependencies(source_id,source_revision);
CREATE INDEX IF NOT EXISTS memory_source_dependencies_memory ON memory_source_dependencies(memory_id,memory_revision);
CREATE INDEX IF NOT EXISTS memory_evidence_id_version ON memory_evidence(memory_id,memory_revision);
CREATE INDEX IF NOT EXISTS memory_versions_id_revision ON memory_versions(memory_id,revision);
CREATE INDEX IF NOT EXISTS memory_edges_to_lookup ON memory_edges(character_id,to_id);
CREATE INDEX IF NOT EXISTS memory_edges_from_lookup ON memory_edges(character_id,from_id);
CREATE INDEX IF NOT EXISTS memory_node_status_time ON memory_nodes(status,recorded_at);
CREATE INDEX IF NOT EXISTS job_kind_status ON jobs(kind,status,role_epoch);
CREATE TABLE IF NOT EXISTS v2_core(field TEXT PRIMARY KEY,body TEXT NOT NULL,locked INTEGER NOT NULL,revision INTEGER NOT NULL,evidence TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_growth_events(event_root TEXT PRIMARY KEY,impact REAL NOT NULL,at INTEGER NOT NULL,evidence TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_growth_uses(field TEXT NOT NULL,event_root TEXT NOT NULL,PRIMARY KEY(field,event_root));
CREATE TABLE IF NOT EXISTS v2_growth_changes(id TEXT PRIMARY KEY,at INTEGER NOT NULL,field TEXT NOT NULL,edit_chars INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v2_vectors(memory_id TEXT NOT NULL,revision INTEGER NOT NULL,model TEXT NOT NULL,vector TEXT NOT NULL,content_hash TEXT NOT NULL,PRIMARY KEY(memory_id,model));
CREATE TABLE IF NOT EXISTS v2_dirty(topic TEXT PRIMARY KEY,watermark INTEGER NOT NULL,reason TEXT NOT NULL,processed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS v2_proposals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v2_recall_log(id TEXT PRIMARY KEY,at INTEGER NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_actions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v2_dream_coverage(topic TEXT NOT NULL,memory_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(topic,memory_id));
CREATE TABLE IF NOT EXISTS v2_core_versions(field TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,evidence TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(field,revision));
`;

export class CognitionStore {
  constructor(dir,characterId,{now=Date.now,epoch=1}={}){
    this.characterId=characterId;this.now=now;this.closed=false;
    this.databaseFile=path.join(dir,'cognition-v2.sqlite');this.db=new DatabaseSync(this.databaseFile);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    try{
      const version=this.db.prepare('PRAGMA user_version').get().user_version;
      if(version===0){this.db.exec('BEGIN IMMEDIATE');try{this.db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));this.db.prepare('INSERT INTO character_manifest VALUES(1,?,?,0,2)').run(characterId,epoch);this.db.exec(extra+'PRAGMA user_version=2; COMMIT;');}catch(e){this.db.exec('ROLLBACK');throw e;}}
      else if(version!==2)fail('SCHEMA_VERSION_UNSUPPORTED');
      if(this.manifest().character_id!==characterId)fail('CHARACTER_MISMATCH');
      this.db.exec(extra);
    }catch(e){this.db.close();throw e;}
  }
  manifest(){return this.db.prepare('SELECT * FROM character_manifest WHERE singleton=1').get();}
  atomic(kind,fn,{epoch,revision}={}){
    if(this.closed)fail('CLOSED');this.db.exec('BEGIN IMMEDIATE');
    try{
      const before=this.manifest();if(epoch!==undefined&&epoch!==before.role_epoch)fail('STALE_ROLE_EPOCH');if(revision!==undefined&&revision!==before.cognition_revision)fail('REVISION_CONFLICT');
      const result=fn();if(result?.then)fail('ASYNC_TRANSACTION_FORBIDDEN');
      if(result===null){this.db.exec('COMMIT');return null;}
      const next=before.cognition_revision+1;this.db.prepare('UPDATE character_manifest SET cognition_revision=? WHERE singleton=1').run(next);
      this.db.prepare('INSERT INTO change_outbox VALUES(?,?,?,?,?,?)').run(this.characterId,next,0,kind,json(result?.affected||[]),this.now());
      this.db.exec('COMMIT');try{this.onCommit?.({kind,revision:next});this.lastProjectionError=null;}catch(error){this.lastProjectionError=error.code||'PROJECTION_EXPORT_FAILED';}return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  suppressed(sourceId){return !!this.db.prepare("SELECT 1 FROM suppression WHERE character_id=? AND target_type='source' AND target_id=?").get(this.characterId,sourceId);}
  nodeSuppressed(memoryId){return !!this.db.prepare("SELECT 1 FROM suppression WHERE character_id=? AND target_type='memory' AND target_id=?").get(this.characterId,memoryId);}
  sourceRegistered(ref){return this.db.prepare("SELECT * FROM sources WHERE character_id=? AND source_id=? AND revision=? AND status='available'").get(this.characterId,ref.sourceId,ref.revision);}
  receive(envelope,source){
    const prior=this.db.prepare('SELECT * FROM cognitive_events WHERE character_id=? AND event_id=?').get(this.characterId,envelope.eventId);
    if(prior)return {duplicate:true,eventId:prior.event_id};
    return this.atomic('event-received',()=>{
      this.db.prepare('INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(this.characterId,source.sourceId,source.adapter,source.externalId,source.kind,source.revision,source.checksum,json({archive:true}),source.observed_at,source.occurred_at,source.metadata.privacyLabel||'private','available');
      this.db.prepare('INSERT INTO cognitive_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(this.characterId,envelope.eventId,envelope.eventRoot,envelope.idempotencyKey,this.manifest().role_epoch,envelope.kind,source.occurred_at,this.now(),envelope.outcome,json(envelope.payload));
      this.db.prepare('INSERT INTO event_sources VALUES(?,?,?,?)').run(this.characterId,envelope.eventId,source.sourceId,source.revision);
      this.onSourceReceived?.(source,envelope);
      return {eventId:envelope.eventId,affected:[envelope.eventId]};
    });
  }
  ensureEntity(entityId){validateEntity(entityId);const [namespace,...rest]=entityId.split(':');this.db.prepare('INSERT OR IGNORE INTO entities VALUES(?,?,?,?,?)').run(this.characterId,entityId,namespace,rest.join(':'),namespace==='character'?'self':'person');}
  alias(entity,alias,source){validateEntity(entity);bounded(alias,100);if(!source||!this.sourceRegistered(source))fail('EVIDENCE_REQUIRED');return this.atomic('entity-alias-recorded',()=>{this.ensureEntity(entity);this.db.prepare('INSERT OR IGNORE INTO entity_aliases VALUES(?,?,?,?,?,?,?)').run(this.characterId,entity,alias.normalize('NFKC').toLowerCase(),this.now(),null,source.sourceId,source.revision);return {entity,alias};});}
  resolveAlias(alias){return this.db.prepare('SELECT DISTINCT entity_id FROM entity_aliases WHERE character_id=? AND alias=? AND valid_to IS NULL').all(this.characterId,alias.normalize('NFKC').toLowerCase()).map(r=>r.entity_id);}
  get(memoryId,{revision,includeInactive=false}={}){
    const n=this.db.prepare('SELECT * FROM memory_nodes WHERE character_id=? AND memory_id=?').get(this.characterId,memoryId);if(!n)return null;
    if(!includeInactive&&(!LIVE_STATUSES.has(n.status)||this.nodeSuppressed(memoryId)))return null;
    if(revision&&this.v3){const snapshot=this.db.prepare('SELECT body FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').get(memoryId,revision);if(snapshot){const old=parse(snapshot.body);if(!includeInactive&&old.evidence.some(e=>this.suppressed(e.sourceId)))return null;return {...old,historicalSnapshot:true};}if(revision!==n.current_revision)return null;}
    const v=this.db.prepare('SELECT * FROM memory_versions WHERE character_id=? AND memory_id=? AND revision=?').get(this.characterId,memoryId,revision??n.current_revision);if(!v)return null;
    const evidence=this.db.prepare('SELECT * FROM memory_evidence WHERE character_id=? AND memory_id=? AND memory_revision=?').all(this.characterId,memoryId,v.revision).map(e=>({sourceId:e.source_id,revision:e.source_revision,independenceGroup:e.independence_group,role:e.role,...(this.v3?{span:parse(e.span_json)}:{})}));
    if(!includeInactive&&evidence.some(e=>this.suppressed(e.sourceId)))return null;
    const assertion=this.db.prepare('SELECT * FROM assertions WHERE character_id=? AND memory_id=?').get(this.characterId,memoryId);
    const participants=this.db.prepare('SELECT entity_id,role FROM memory_entities WHERE character_id=? AND memory_id=?').all(this.characterId,memoryId);
    return {...n,id:memoryId,revision:v.revision,gist:v.gist,detail:n.detail_state==='available'?v.detail||'':'',metadata:parse(v.metadata_json),contentHash:v.content_hash,evidence,participants,assertion:assertion?{speakerId:assertion.speaker_id,subjectId:assertion.subject_id,targetId:assertion.target_id,predicate:assertion.predicate,object:parse(assertion.object_json),speechAct:assertion.speech_act,commitmentStatus:assertion.commitment_status,dueAt:assertion.due_at}:null};
  }
  index(memoryId){
    this.db.prepare('DELETE FROM recall_fts WHERE character_id=? AND memory_id=?').run(this.characterId,memoryId);
    const m=this.get(memoryId);if(!m)return;
    this.db.prepare('INSERT INTO recall_fts VALUES(?,?,?,?)').run(this.characterId,memoryId,m.revision,terms([m.gist,m.detail,m.metadata.disposition?.target||'',m.metadata.disposition?.facet||'',...(m.metadata.tags||[]),...(m.metadata.aliases||[])].join(' ')).join(' '));
  }
  writeNode(record){
    if(!NODE_KINDS.has(record.kind))fail('INVALID_MEMORY_KIND');bounded(record.gist,800);
    const evidence=record.evidence||[];if(evidence.some(e=>e.role&&!['supports','contradicts','context'].includes(e.role)))fail('INVALID_MEMORY_EVIDENCE_ROLE');if(!evidence.length||evidence.length>(record.metadata?.legacy===true?64:20))fail('EVIDENCE_REQUIRED');
    if(evidence.some(e=>!this.sourceRegistered(e)||this.suppressed(e.sourceId)))fail('EVIDENCE_UNAVAILABLE');
    const sourceDependencies=this.sourceDependencies?.(evidence)||evidence;
    if(this.v3&&sourceDependencies.some(e=>!this.sourceRegistered(e)||this.suppressed(e.sourceId)||!this.sourceUsable(e)))record={...record,status:'candidate',metadata:{...record.metadata,basisUnavailable:true}};
    record=this.resolveClaim?.(record)||record;
    const memoryId=record.id||'memory:'+hash([record.kind,record.eventRoot,record.gist,record.assertion||null,evidence.map(evidenceKey)]).slice(0,32);
    if(this.inner&&evidence.some(e=>{const span=e.span;if(!span?.length)return false;return this.db.prepare('SELECT 1 FROM v3_forget_spans WHERE source_id=? AND revision=? AND offset<? AND offset+length>? LIMIT 1').get(e.sourceId,e.revision,span.offset+span.length,span.offset);}))fail('MEMORY_SUPPRESSED');
    const old=this.get(memoryId,{includeInactive:true});if(old){if(old.status==='forgotten')fail('MEMORY_SUPPRESSED');if(record.metadata?.basisUnavailable)this.invalidateSourceMemory?.(memoryId,sourceDependencies.filter(e=>!this.sourceUsable(e)));return memoryId;}
    const metadata={...record.metadata,topic:record.topic||record.metadata?.topic||record.kind,tags:record.tags||record.metadata?.tags||[]};
    const status=record.status||'active',epistemic=record.epistemic||'reported',occurredAt=record.occurredAt??null;
    this.db.prepare('INSERT INTO memory_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(this.characterId,memoryId,record.kind,1,record.detail?'available':'none',epistemic,status,record.eventRoot||null,occurredAt,this.now(),record.validFrom??null,record.validTo??null,null,unit(record.confidence),unit(record.salience),unit(record.strength,1),Math.max(.1,record.halfLifeDays||30),this.now());
    this.db.prepare('INSERT INTO memory_versions VALUES(?,?,?,?,?,?,?,?)').run(this.characterId,memoryId,1,record.gist,record.detail||null,hash([record.gist,record.detail||'']),json(metadata),this.now());
    for(const e of evidence)this.db.prepare('INSERT OR IGNORE INTO memory_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(this.characterId,memoryId,1,e.sourceId,e.revision,hash([e.sourceId,e.revision,e.span||{},e.quote||'',e.role||'supports']),json(e.span||{}),e.independenceGroup||record.eventRoot||e.sourceId,e.role||'supports');
    for(const e of sourceDependencies)this.db.prepare('INSERT OR IGNORE INTO memory_source_dependencies VALUES(?,?,?,?,?)').run(this.characterId,memoryId,1,e.sourceId,e.revision);
    const parties=[...(record.participants||[])];
    if(record.assertion){const a=record.assertion;for(const [k,r]of [['speakerId','speaker'],['subjectId','subject'],['targetId','target']])if(a[k]){this.ensureEntity(a[k]);parties.push({entityId:a[k],role:r});}
      this.db.prepare('INSERT INTO assertions VALUES(?,?,?,?,?,?,?,?,?,?)').run(this.characterId,memoryId,a.speakerId||null,a.subjectId||null,a.targetId||null,bounded(a.predicate,100),json(a.object),a.speechAct||'statement',a.commitmentStatus||null,a.dueAt??null);
    }
    for(const p of parties){this.ensureEntity(p.entityId);this.db.prepare('INSERT OR IGNORE INTO memory_entities VALUES(?,?,?,?)').run(this.characterId,memoryId,p.entityId,p.role||'participant');}
    this.index(memoryId);this.dirty(record.topic||metadata.topic||record.kind,'new-memory');this.v3AfterWrite?.(memoryId);return memoryId;
  }
  addNodes(records,{epoch,job}={}){
    return this.atomic('memories-written',()=>{
      if(job)this.assertJob(job);
      // Entities must exist before typed assertion foreign keys are inserted.
      for(const r of records)for(const k of ['speakerId','subjectId','targetId'])if(r.assertion?.[k])this.ensureEntity(r.assertion[k]);
      const ids=records.map(r=>this.writeNode(r));return {ids,affected:ids};
    },{epoch});
  }
  list({kinds,includeInactive=false,limit=5000}={}){
    const rows=this.db.prepare("SELECT memory_id FROM memory_nodes WHERE character_id=? AND (? IS NULL OR kind IN (SELECT value FROM json_each(?))) AND (?=1 OR status IN ('active','contested','outdated','faded')) ORDER BY recorded_at DESC LIMIT ?").all(this.characterId,kinds?json(kinds):null,kinds?json(kinds):null,includeInactive?1:0,Math.min(50000,limit));
    return rows.map(r=>this.get(r.memory_id,{includeInactive})).filter(m=>m&&(!kinds||kinds.includes(m.kind)));
  }
  lexical(query,limit=30){const ts=terms(query).slice(0,60);if(!ts.length)return[];const match=ts.map(t=>'"'+t.replaceAll('"','""')+'"').join(' OR ');
    return this.db.prepare('SELECT memory_id,bm25(recall_fts) AS rank FROM recall_fts WHERE recall_fts MATCH ? AND character_id=? ORDER BY rank LIMIT ?').all(match,this.characterId,limit).map(r=>this.get(r.memory_id)).filter(Boolean);
  }
  addEdge(from,to,relation,{provenance='explicit_evidence',confidence=.7,evidence=[]}={}){
    if(!this.get(from)||!this.get(to))fail('EDGE_ENDPOINT_UNAVAILABLE');
    if(relation==='causes'&&provenance!=='explicit_evidence')fail('CAUSAL_EVIDENCE_REQUIRED');
    if(relation==='causes'&&!evidence.length)fail('CAUSAL_EVIDENCE_REQUIRED');
    this.db.prepare('INSERT OR REPLACE INTO memory_edges VALUES(?,?,?,?,?,?,?,1)').run(this.characterId,from,to,relation,provenance,unit(confidence),json(evidence));
  }
  connect(from,to,relation,options){return this.atomic('link-created',()=>{this.addEdge(from,to,relation,options);return {affected:[from,to]};});}
  edges(memoryId){return this.db.prepare('SELECT * FROM memory_edges WHERE character_id=? AND (from_id=? OR to_id=?)').all(this.characterId,memoryId,memoryId);}
  members(memoryId){return this.db.prepare('SELECT member_id FROM memory_members WHERE character_id=? AND container_id=? ORDER BY weight DESC').all(this.characterId,memoryId).map(r=>this.get(r.member_id)).filter(Boolean);}
  projection(kind,target='self'){const r=this.db.prepare('SELECT * FROM projections WHERE character_id=? AND kind=? AND target_key=?').get(this.characterId,kind,target);return r?{...parse(r.body_json),revision:r.revision,basedOnRevision:r.based_on_cognition_revision}:null;}
  setProjection(kind,target,body,{expectedRevision,dependencies=[]}={}){
    const old=this.projection(kind,target);if(expectedRevision!==undefined&&expectedRevision!==(old?.revision||0))fail('PROJECTION_VERSION_CONFLICT');
    this.db.prepare('INSERT OR REPLACE INTO projections VALUES(?,?,?,?,?,?,?)').run(this.characterId,kind,target,(old?.revision||0)+1,this.manifest().cognition_revision+1,json(body),json(dependencies));
  }
  dirty(topic,reason){this.db.prepare('INSERT INTO v2_dirty VALUES(?,?,?,0) ON CONFLICT(topic) DO UPDATE SET watermark=excluded.watermark,reason=excluded.reason').run(id(topic),this.manifest().cognition_revision+1,reason);}
  enqueue(kind,payload,{topic=null,fingerprint=hash([kind,payload])}={}){
    payload={...payload};delete payload.energyExemptByAdministrator;if(energyExempt())payload.energyExemptByAdministrator=true;
    const jobId='job:'+hash([this.characterId,kind,fingerprint]).slice(0,32),epoch=this.manifest().role_epoch;
    this.db.prepare("INSERT OR IGNORE INTO jobs VALUES(?,?,?,?,?,?,'pending',NULL,NULL,0,0,?)").run(this.characterId,jobId,kind,topic,fingerprint,epoch,json(payload));this.db.prepare('INSERT OR IGNORE INTO v3_job_birth VALUES(?,?)').run(jobId,this.now());return jobId;
  }
  claim({leaseMs=120000,owner=randomUUID(),recordedBefore,jobIds,kinds=['encode','dream','grow','embed']}={}){
    return this.atomic('job-claimed',()=>{
      const now=this.now(),reviewTurn=(this.claimCount=(this.claimCount||0)+1)%5===0;this.db.prepare("UPDATE jobs SET status='pending',lease_owner=NULL WHERE character_id=? AND status='running' AND lease_until<=?").run(this.characterId,now);
      const fair=reviewTurn&&this.v3;const lastKind=this.v3?this.db.prepare('SELECT last_kind FROM v3_scheduler_cursor WHERE character_id=?').get(this.characterId)?.last_kind||'':'';
      const j=this.db.prepare("SELECT * FROM jobs WHERE character_id=? AND status='pending' AND coalesce(retry_at,0)<=? AND role_epoch=? AND kind IN (SELECT value FROM json_each(?)) AND (? IS NULL OR job_id IN (SELECT value FROM json_each(?))) AND (? IS NULL OR kind<>'encode' OR (json_array_length(payload_json,'$.parts')>0 AND NOT EXISTS(SELECT 1 FROM json_each(jobs.payload_json,'$.parts') p JOIN cognitive_events e ON e.event_id=json_extract(p.value,'$.eventId') WHERE e.recorded_at>?))) ORDER BY CASE WHEN ?=0 THEN CASE WHEN kind='inner-dream-v3' AND json_extract(payload_json,'$.psycheCompression')=1 AND json_extract(payload_json,'$.before.needsProjectionReview')=1 THEN -2 WHEN kind='reflect' AND json_extract(payload_json,'$.behavior.startedAt')>=? THEN -1 ELSE 0 END ELSE 0 END,CASE WHEN ? THEN CASE WHEN kind>? THEN 0 ELSE 1 END ELSE 0 END,CASE WHEN ? THEN kind ELSE '' END,CASE kind WHEN 'reflect' THEN 0 WHEN 'learn' THEN 1 WHEN 'review' THEN CASE WHEN ? THEN 2 ELSE 5 END WHEN 'encode' THEN 3 WHEN 'grow' THEN 4 WHEN 'dream' THEN 6 ELSE 7 END,CASE WHEN kind='reflect' THEN -coalesce(json_extract(payload_json,'$.behavior.startedAt'),0) ELSE rowid END,rowid LIMIT 1").get(this.characterId,now,this.manifest().role_epoch,json(kinds),jobIds?sqlIds(jobIds):null,jobIds?sqlIds(jobIds):null,recordedBefore??null,recordedBefore??null,fair?1:0,now-2*3600000,fair?1:0,lastKind,fair?1:0,reviewTurn?1:0);
      if(!j)return null;if(fair)this.db.prepare('INSERT OR REPLACE INTO v3_scheduler_cursor VALUES(?,?)').run(this.characterId,j.kind);
      this.db.prepare("UPDATE jobs SET status='running',lease_owner=?,lease_until=? WHERE character_id=? AND job_id=?").run(owner,now+leaseMs,this.characterId,j.job_id);
      return {...j,lease_owner:owner,lease_until:now+leaseMs,payload:parse(j.payload_json)};
    });
  }
  assertJob(job){const row=this.db.prepare('SELECT * FROM jobs WHERE character_id=? AND job_id=?').get(this.characterId,job.job_id);if(!row||row.status!=='running'||row.lease_owner!==job.lease_owner||row.lease_until<=this.now()||row.role_epoch!==this.manifest().role_epoch)fail('STALE_JOB_LEASE');}
  heartbeat(job,leaseMs=120000){this.assertJob(job);this.db.prepare('UPDATE jobs SET lease_until=? WHERE character_id=? AND job_id=? AND lease_owner=?').run(this.now()+leaseMs,this.characterId,job.job_id,job.lease_owner);}
  finish(job,report){this.assertJob(job);this.db.prepare("UPDATE jobs SET status='complete',lease_owner=NULL,lease_until=NULL,payload_json='{}' WHERE character_id=? AND job_id=?").run(this.characterId,job.job_id);this.db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(this.characterId,job.job_id,json(report),this.now());}
  release(job,{aborted=false,error='worker-failed'}={}){
    const r=this.db.prepare('SELECT * FROM jobs WHERE character_id=? AND job_id=?').get(this.characterId,job.job_id);
    if(!r||r.status!=='running'||r.lease_owner!==job.lease_owner)return;
    const attempts=r.attempts+(aborted?0:1),status=attempts>=3?'failed':'pending';
    this.db.prepare('UPDATE jobs SET status=?,attempts=?,retry_at=?,lease_owner=NULL,lease_until=NULL WHERE character_id=? AND job_id=?').run(status,attempts,['V3_HOURLY_MODEL_BUDGET','V3_BACKGROUND_MODEL_BUDGET'].includes(error)?(Math.floor(this.now()/3600000)+1)*3600000:this.now()+(aborted?1000:300000),this.characterId,job.job_id);
    this.db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(this.characterId,job.job_id,json({status,aborted,error}),this.now());
  }
  reports(limit=20){return this.db.prepare('SELECT job_id,created_at,report_json FROM maintenance_reports WHERE character_id=? ORDER BY created_at DESC LIMIT ?').all(this.characterId,limit).map(r=>({jobId:r.job_id,at:r.created_at,...parse(r.report_json)}));}
  close(){if(!this.closed){this.closed=true;this.db.close();}}
}
