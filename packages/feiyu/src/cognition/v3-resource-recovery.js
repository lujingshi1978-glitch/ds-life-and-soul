import {parse,json} from './contracts.js';

export class ResourceRecovery{
 constructor(runtime){this.r=runtime;this.db=runtime.archive.db;this.db.exec(`CREATE TABLE IF NOT EXISTS v3_resource_failures(source_id TEXT NOT NULL,revision INTEGER NOT NULL,model TEXT NOT NULL,checksum TEXT NOT NULL,failures INTEGER NOT NULL,retry_at INTEGER NOT NULL,error TEXT,PRIMARY KEY(source_id,revision,model));CREATE TABLE IF NOT EXISTS v3_resource_failed_jobs(job_id TEXT PRIMARY KEY,at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS v3_resource_failure_events(job_id TEXT NOT NULL,source_id TEXT NOT NULL,revision INTEGER NOT NULL,model TEXT NOT NULL,checksum TEXT NOT NULL,error TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(job_id,source_id,revision,model));CREATE TABLE IF NOT EXISTS v3_resource_recovery_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  if(!this.db.prepare("SELECT 1 FROM v3_resource_recovery_meta WHERE key='per-document-v3'").get()){
   // Old batch counters do not identify which document failed. Preserve, then retest individually.
   this.db.exec('BEGIN IMMEDIATE');try{this.db.exec('CREATE TABLE IF NOT EXISTS v3_resource_legacy_failures AS SELECT * FROM v3_resource_failures WHERE 0');this.db.exec('INSERT INTO v3_resource_legacy_failures SELECT * FROM v3_resource_failures');this.db.exec('DELETE FROM v3_resource_failures');this.db.prepare('INSERT INTO v3_resource_recovery_meta VALUES(?,?)').run('per-document-v3',json({at:runtime.now()}));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
 }
 recordFailure(ref,model,error,jobId){
  this.db.exec('BEGIN IMMEDIATE');try{
   const inserted=this.db.prepare('INSERT OR IGNORE INTO v3_resource_failure_events VALUES(?,?,?,?,?,?,?)').run(jobId,ref.sourceId,ref.revision,model,ref.checksum,String(error).slice(0,180),this.r.now());
   if(inserted.changes){const old=this.db.prepare('SELECT * FROM v3_resource_failures WHERE source_id=? AND revision=? AND model=?').get(ref.sourceId,ref.revision,model),count=(old?.checksum===ref.checksum?old.failures:0)+1;this.db.prepare('INSERT OR REPLACE INTO v3_resource_failures VALUES(?,?,?,?,?,?,?)').run(ref.sourceId,ref.revision,model,ref.checksum,count,this.r.now()+Math.min(6,2**(count-1))*3600000,String(error).slice(0,180));}
   this.db.exec('COMMIT');
  }catch(failure){this.db.exec('ROLLBACK');throw failure;}
 }
 reconcile(){const e=this.r.retriever.embedding;if(!e)return;
  for(const job of this.r.store.db.prepare("SELECT j.*,r.report_json FROM jobs j LEFT JOIN maintenance_reports r USING(character_id,job_id) WHERE j.kind='archive-embed-v3' AND j.status='failed'").all()){
   if(this.db.prepare('SELECT 1 FROM v3_resource_failed_jobs WHERE job_id=?').get(job.job_id))continue;
   const payload=parse(job.payload_json),report=parse(job.report_json||'{}'),model=payload.model||e.modelId;
   // A report without document attribution must never implicate the entire batch.
   for(const failure of report.failedDocs||[]){const ref=(payload.docs||[]).find(d=>d.sourceId===failure.sourceId&&d.revision===failure.revision);if(ref)this.recordFailure(ref,model,failure.error||report.error||'index-failed',job.job_id);}
   this.db.prepare('INSERT OR IGNORE INTO v3_resource_failed_jobs VALUES(?,?)').run(job.job_id,this.r.now());
  }
 }
 status(model){return this.db.prepare('SELECT count(*) failedDocuments,coalesce(sum(failures>=2),0) quarantined,coalesce(sum(failures<2 AND retry_at>?),0) backingOff FROM v3_resource_failures WHERE model=?').get(this.r.now(),model);}
}
