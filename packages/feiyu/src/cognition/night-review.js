import {hash,json,parse,fail,assertSignal} from './contracts.js';
import {nightScope} from './night-scope.js';
import {MaintenanceBudget} from './maintenance-budget.js';
import {withCognitiveBudget} from './model.js';

const key=day=>'inner-night:'+day;
const committed=(r,day,epoch)=>r.store.db.prepare('SELECT commit_id,role_epoch FROM v3_inner_commits WHERE idempotency_key=? AND role_epoch=?').get(key(day),epoch);
export function installNightReviews(r){r.store.db.exec(`CREATE TABLE IF NOT EXISTS v3_night_reviews(day TEXT NOT NULL,role_epoch INTEGER NOT NULL,cutoff INTEGER NOT NULL,job_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL,source_refs TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(day,role_epoch));
CREATE TABLE IF NOT EXISTS v3_night_review_versions(job_id TEXT PRIMARY KEY,day TEXT NOT NULL,role_epoch INTEGER NOT NULL,generation INTEGER NOT NULL,cutoff INTEGER NOT NULL,event_id TEXT NOT NULL,source_refs TEXT NOT NULL,status TEXT NOT NULL,error TEXT,attempts INTEGER NOT NULL,at INTEGER NOT NULL);`);}
export function nightReviewState(r,day){
 const epoch=r.store.manifest().role_epoch,commit=committed(r,day,epoch);
 if(commit)return {status:'already-integrated',commitId:commit.commit_id};
 const row=r.store.db.prepare('SELECT n.*,j.status job_status,j.retry_at,j.attempts FROM v3_night_reviews n JOIN jobs j ON j.job_id=n.job_id WHERE n.day=? AND n.role_epoch=?').get(day,epoch);
 if(row)return {status:row.status==='blocked'?'blocked':['failed','cancelled'].includes(row.job_status)?row.job_status:'deferred',jobId:row.job_id,retryAt:row.retry_at||0,error:row.error||undefined,jobStatus:row.job_status,attempts:row.attempts};
 if(r.store.db.prepare('SELECT 1 FROM v3_night_scopes WHERE day=? AND role_epoch<>?').get(day,epoch)||r.store.db.prepare('SELECT 1 FROM v3_inner_commits WHERE idempotency_key=?').get(key(day)))return {status:'cancelled',error:'NIGHT_REVIEW_OBSOLETE_EPOCH'};
 return {status:'deferred',error:'NIGHT_REVIEW_NOT_QUEUED'};
}
function usable(r,ref){const d=r.archive.db.prepare('SELECT revision,status FROM documents WHERE source_id=? ORDER BY revision DESC LIMIT 1').get(ref.sourceId);return !!d&&d.revision===ref.revision&&d.status==='available'&&r.store.sourceRegistered(ref)&&!r.store.suppressed(ref.sourceId)&&r.store.sourceUsable(ref);}
const actualEvents=(r,refs,epoch)=>refs.flatMap(ref=>r.store.db.prepare('SELECT es.event_id FROM event_sources es JOIN cognitive_events e ON e.event_id=es.event_id WHERE es.source_id=? AND es.source_revision=? AND e.role_epoch=? ORDER BY e.rowid LIMIT 1').all(ref.sourceId,ref.revision,epoch).map(e=>e.event_id));
function rebaseNightReview(r,row){
 const s=r.store,db=s.db,job=db.prepare('SELECT * FROM jobs WHERE job_id=?').get(row.job_id),original=parse(row.source_refs);
 if(['cancelled','complete'].includes(job.status)||row.error==='V3_MAINTENANCE_BUDGET'||original.every(ref=>usable(r,ref)))return nightReviewState(r,row.day);
 if(job.status==='failed'&&row.error&&!['NIGHT_REVIEW_SOURCE_STALE','NIGHT_REVIEW_SOURCE_UNAVAILABLE','COGNITION_READSET_STALE'].includes(row.error))return nightReviewState(r,row.day);
 const scope=nightScope(r,row.day).refresh(),refs=original.map(ref=>({sourceId:ref.sourceId,revision:r.archive.db.prepare('SELECT max(revision) revision FROM documents WHERE source_id=?').get(ref.sourceId).revision||ref.revision}));
 if(refs.some(ref=>!scope.ids('source').has(ref.sourceId)||!usable(r,ref))){
  if(row.error!=='NIGHT_REVIEW_SOURCE_UNAVAILABLE')s.atomic('night-review-awaiting-source',()=>{db.prepare("UPDATE jobs SET status='failed',lease_owner=NULL,lease_until=NULL WHERE job_id=? AND status IN ('pending','running')").run(row.job_id);db.prepare("UPDATE v3_night_reviews SET status='blocked',error='NIGHT_REVIEW_SOURCE_UNAVAILABLE' WHERE job_id=?").run(row.job_id);return {affected:[]};});
  return nightReviewState(r,row.day);
 }
 // New revisions may replace only original source IDs in the frozen closure.
 // Preserve previous references/attempts and share the day/epoch model budget.
 const prior=r.archive.get(db.prepare('SELECT source_id FROM event_sources WHERE event_id=?').get(row.event_id).source_id,db.prepare('SELECT source_revision FROM event_sources WHERE event_id=?').get(row.event_id).source_revision),e=r.observe({adapter:'inner-night',externalId:row.day,kind:'night-review',occurredAt:row.cutoff,text:prior.text,metadata:{...prior.metadata,basisSources:refs}},{kind:'sleep-entry',eventRoot:key(row.day)});
 return s.atomic('night-review-source-rebased',()=>{
  db.prepare("INSERT OR IGNORE INTO v3_night_review_versions VALUES(?,?,?,1,?,?,?,'superseded',?,?,?)").run(row.job_id,row.day,row.role_epoch,row.cutoff,row.event_id,row.source_refs,row.error,job.attempts,r.now());
  db.prepare("UPDATE v3_night_review_versions SET status='superseded',error=?,attempts=? WHERE job_id=?").run(row.error,job.attempts,row.job_id);
  db.prepare("UPDATE jobs SET status='cancelled',lease_owner=NULL,lease_until=NULL WHERE job_id=? AND status<>'complete'").run(row.job_id);
  const payload={nightReview:{day:row.day,cutoff:row.cutoff,roleEpoch:row.role_epoch},eventIds:[e.eventId,...actualEvents(r,refs,row.role_epoch)],sourceRefs:refs},id=s.enqueue('inner-dream-v3',payload,{fingerprint:'night-review:'+hash([r.characterId,row.role_epoch,row.day,row.cutoff,refs])}),generation=db.prepare('SELECT coalesce(max(generation),0)+1 n FROM v3_night_review_versions WHERE day=? AND role_epoch=?').get(row.day,row.role_epoch).n;
  db.prepare("UPDATE v3_night_reviews SET job_id=?,event_id=?,source_refs=?,status='pending',error=NULL WHERE day=? AND role_epoch=?").run(id,e.eventId,json(refs),row.day,row.role_epoch);
  db.prepare("INSERT OR IGNORE INTO v3_night_review_versions VALUES(?,?,?,?,?,?,?,'pending',NULL,0,?)").run(id,row.day,row.role_epoch,generation,row.cutoff,e.eventId,json(refs),r.now());
  for(const [kind,value]of [['job',id],['event',e.eventId],['source',e.sourceId]])db.prepare('INSERT OR IGNORE INTO v3_night_members VALUES(?,?,?,?)').run(row.day,row.role_epoch,kind,value);
  return {affected:[],...nightReviewState(r,row.day)};
 });
}
export function ensureNightReview(r,day,cutoff){
 r.assertOpen();if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isSafeInteger(cutoff)||cutoff>r.now())fail('NIGHT_REVIEW_INVALID');
 installNightReviews(r);const s=r.store,db=s.db,epoch=s.manifest().role_epoch;
 if(committed(r,day,epoch))return nightReviewState(r,day);
 const existing=db.prepare('SELECT * FROM v3_night_reviews WHERE day=? AND role_epoch=?').get(day,epoch);
 if(existing){if(existing.cutoff!==cutoff)fail('NIGHT_REVIEW_CUTOFF_CONFLICT');return rebaseNightReview(r,existing);}
 // The canonical day key cannot be reused for another role incarnation.
 if(db.prepare('SELECT 1 FROM v3_inner_commits WHERE idempotency_key=?').get(key(day)))return {status:'cancelled',error:'NIGHT_REVIEW_OBSOLETE_EPOCH'};
 if(db.prepare('SELECT 1 FROM v3_night_scopes WHERE day=? AND role_epoch<>?').get(day,epoch))return {status:'cancelled',error:'NIGHT_REVIEW_OBSOLETE_EPOCH'};
 const scope=nightScope(r,day,{create:true,cutoff});scope.refresh();
 const selected=db.prepare("SELECT e.event_id,es.source_id,es.source_revision FROM v3_night_members m JOIN cognitive_events e ON e.event_id=m.id JOIN event_sources es ON es.event_id=e.event_id JOIN sources s ON s.source_id=es.source_id WHERE m.day=? AND m.role_epoch=? AND m.kind='event' AND e.role_epoch=? AND s.adapter<>'inner-night' ORDER BY e.rowid DESC LIMIT 8").all(day,epoch,epoch);
 // Archive and cognition have separate transactions. Reuse the first immutable
 // observation after a crash between archive append and obligation insertion.
 const prior=r.archive.db.prepare("SELECT * FROM documents WHERE adapter='inner-night' AND external_id=? AND kind='night-review' ORDER BY revision DESC LIMIT 1").get(day);
 const priorMeta=prior?parse(prior.metadata):null,frozen=priorMeta&&Object.hasOwn(priorMeta,'basisSources'),refs=frozen?priorMeta.basisSources:[...new Map(selected.map(v=>[v.source_id+'@'+v.source_revision,{sourceId:v.source_id,revision:v.source_revision}])).values()].filter(ref=>usable(r,ref));
 const e=r.observe(prior?{adapter:prior.adapter,externalId:prior.external_id,kind:prior.kind,revision:frozen?prior.revision:undefined,occurredAt:prior.occurred_at,text:prior.body,metadata:frozen?priorMeta:{...priorMeta,historical:true,basisSources:refs}}:{adapter:'inner-night',externalId:day,kind:'night-review',occurredAt:cutoff,text:'回顾'+day+'休眠前已接收的真实经历，承接此刻持续内心；不是重播旧情绪，不补做旧行动，夜后未读不在本次范围。',metadata:{speakerId:r.characterId,scope:'self',notPrimaryEvidence:true,historical:true,basisSources:refs}},{kind:'sleep-entry',eventRoot:key(day)});
 return s.atomic('night-review-obligation-created',()=>{
  const payload={nightReview:{day,cutoff,roleEpoch:epoch},eventIds:[e.eventId,...actualEvents(r,refs,epoch)],sourceRefs:refs};
  const jobId=s.enqueue('inner-dream-v3',payload,{fingerprint:'night-review:'+hash([r.characterId,epoch,day,cutoff])});
  db.prepare("INSERT INTO v3_night_reviews VALUES(?,?,?,?,?,?,'pending',NULL,?)").run(day,epoch,cutoff,jobId,e.eventId,json(refs),r.now());
  db.prepare("INSERT OR IGNORE INTO v3_night_review_versions VALUES(?,?,?,1,?,?,?,'pending',NULL,0,?)").run(jobId,day,epoch,cutoff,e.eventId,json(refs),r.now());
  db.prepare("INSERT OR IGNORE INTO v3_night_members VALUES(?,?,'job',?)").run(day,epoch,jobId);
  db.prepare("INSERT OR IGNORE INTO v3_night_members VALUES(?,?,'event',?)").run(day,epoch,e.eventId);
  db.prepare("INSERT OR IGNORE INTO v3_night_members VALUES(?,?,'source',?)").run(day,epoch,e.sourceId);
  return {affected:[],...nightReviewState(r,day)};
 });
}
function assertNightReview(r,job,signal){
 assertSignal(signal);r.assertOpen();r.store.assertJob(job);r.nightReviewGuard?.();
 const p=job.payload.nightReview,row=r.store.db.prepare('SELECT * FROM v3_night_reviews WHERE day=? AND role_epoch=?').get(p.day,p.roleEpoch);
 if(!row||row.job_id!==job.job_id||p.roleEpoch!==r.store.manifest().role_epoch||row.cutoff!==p.cutoff)fail('STALE_ROLE_EPOCH');
 if((job.payload.sourceRefs||[]).some(ref=>!usable(r,ref)))fail('NIGHT_REVIEW_SOURCE_STALE');
 return row;
}
function finish(r,job,commit,{recovered=false,signal}={}){
 return r.store.atomic('night-review-job-completed',()=>{
  assertSignal(signal);r.assertOpen();r.store.assertJob(job);r.nightReviewGuard?.();if(!recovered)assertNightReview(r,job,signal);const p=job.payload.nightReview,report={kind:'inner-dream-v3',reason:'night-review',day:p.day,status:'already-integrated',commitId:commit.commit_id,recoveredWithoutModel:recovered};
  r.store.finish(job,report);r.store.db.prepare("UPDATE v3_night_reviews SET status='complete',error=NULL WHERE job_id=?").run(job.job_id);r.store.db.prepare("UPDATE v3_night_review_versions SET status='complete',error=NULL WHERE job_id=?").run(job.job_id);return {...report,affected:[]};
 });
}
export async function processNightReview(r,job,signal){
 const p=job.payload.nightReview,prior=committed(r,p.day,job.role_epoch);if(prior)return finish(r,job,prior,{recovered:true,signal});
 assertSignal(signal);r.assertOpen();r.store.assertJob(job);r.nightReviewGuard?.();const current=ensureNightReview(r,p.day,p.cutoff);if(current.jobId!==job.job_id||current.status==='blocked')return {status:current.status==='blocked'?'blocked':'superseded',reason:'night-review',nextJobId:current.jobId,error:current.error};
 assertNightReview(r,job,signal);
 if(r.inner.busy){r.store.release(job,{aborted:true,error:'V3_INNER_BUSY'});return {status:'deferred',reason:'night-review',error:'V3_INNER_BUSY',retryAt:r.now()+1000};}
 if(nightScope(r,p.day).state().pendingRepairs){r.store.release(job,{aborted:true,error:'NIGHT_REVIEW_REPAIRS_PENDING'});return {status:'deferred',reason:'night-review',error:'NIGHT_REVIEW_REPAIRS_PENDING',retryAt:r.now()+1000};}
 const cap=new MaintenanceBudget(r.store,'night-review:'+r.characterId+':'+p.roleEpoch+':'+p.day,{maxCalls:3,maxInputChars:240000});cap.unlimited=false;
 const budget={reserve:(purpose,chars)=>{assertNightReview(r,job,signal);const b=cap.status();if(b.calls>=cap.maxCalls||b.input_chars+chars>cap.maxInputChars)fail('V3_MAINTENANCE_BUDGET');const reservation=r.inner.reserve(purpose,chars);cap.reserve(purpose,chars);return reservation;},receipt:value=>{cap.receipt(value);r.inner.receipt(value);},adjustInputChars:(extra,hour)=>{cap.adjustInputChars(extra);r.inner.adjustInputChars(extra,hour);}};
 const memories=r.store.db.prepare("SELECT n.memory_id FROM v3_night_members m JOIN memory_nodes n ON n.memory_id=m.id WHERE m.day=? AND m.role_epoch=? AND m.kind='memory' AND n.status IN ('active','faded','contested','outdated') AND n.kind IN ('experience','relationship','pattern') ORDER BY n.recorded_at DESC,n.rowid DESC LIMIT 20").all(p.day,p.roleEpoch).map(v=>v.memory_id).filter(id=>r.store.get(id));
 try{
  const result=await withCognitiveBudget(budget,()=>r.inner.reflect({eventIds:job.payload.eventIds,memoryIds:memories,key:key(p.day),kind:'dream',historical:true,signal,commitGuard:()=>assertNightReview(r,job,signal),summary:'此刻承接'+p.day+'休眠前的旧经历；保持真实人物、未完牵挂和不确定性，不重放旧情绪，不执行历史行动。'}));
  if(!result.stateId&&!result.commitId){r.store.release(job,{aborted:true,error:result.status||'NIGHT_REVIEW_PENDING'});return {...result,reason:'night-review'};}
  assertSignal(signal);const commit=committed(r,p.day,p.roleEpoch);if(!commit)fail('NIGHT_REVIEW_COMMIT_MISSING');return finish(r,job,commit,{signal});
 }catch(error){
  const code=error.code||error.message;
  if(!r.store.closed){const current=r.store.db.prepare('SELECT status,lease_owner,lease_until,role_epoch FROM jobs WHERE job_id=?').get(job.job_id);if(current?.status==='running'&&current.lease_owner===job.lease_owner&&current.lease_until>r.now()&&current.role_epoch===r.store.manifest().role_epoch)for(const table of ['v3_night_reviews','v3_night_review_versions'])r.store.db.prepare('UPDATE '+table+' SET error=? WHERE job_id=?').run(String(code).slice(0,180),job.job_id);}
  if(['V3_MAINTENANCE_BUDGET','NIGHT_REVIEW_SOURCE_STALE'].includes(code)&&!r.store.closed){
   r.store.assertJob(job);r.store.db.prepare("UPDATE jobs SET status='failed',lease_owner=NULL,lease_until=NULL WHERE job_id=?").run(job.job_id);for(const table of ['v3_night_reviews','v3_night_review_versions'])r.store.db.prepare("UPDATE "+table+" SET status='blocked' WHERE job_id=?").run(job.job_id);
   r.store.db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(r.characterId,job.job_id,json({status:'blocked',reason:'night-review',error:code,budget:cap.status()}),r.now());
  }
  throw error;
 }
}
export function finishCommittedNightReviews(r,jobIds,signal){
 if(!r.inner)return null;r.assertOpen();installNightReviews(r);
 const rows=r.store.db.prepare("SELECT j.*,n.day FROM v3_night_reviews n JOIN jobs j ON j.job_id=n.job_id WHERE n.role_epoch=? AND j.status IN ('pending','running','failed') ORDER BY n.created_at").all(r.store.manifest().role_epoch);
 for(const row of rows){if(jobIds&&!jobIds.includes(row.job_id)||row.status==='running'&&row.lease_until>r.now())continue;const commit=committed(r,row.day,row.role_epoch);if(!commit)continue;
  assertSignal(signal);r.nightReviewGuard?.();return r.store.atomic('night-review-committed-recovery',()=>{const report={kind:'inner-dream-v3',reason:'night-review',day:row.day,status:'already-integrated',commitId:commit.commit_id,recoveredWithoutModel:true};r.store.db.prepare("UPDATE jobs SET status='complete',lease_owner=NULL,lease_until=NULL,payload_json='{}' WHERE job_id=? AND role_epoch=?").run(row.job_id,row.role_epoch);for(const table of ['v3_night_reviews','v3_night_review_versions'])r.store.db.prepare("UPDATE "+table+" SET status='complete',error=NULL WHERE job_id=?").run(row.job_id);r.store.db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(r.characterId,row.job_id,json(report),r.now());return {status:'complete',jobId:row.job_id,report,affected:[]};});
 }
 return null;
}
