import {hash,json,parse} from './contracts.js';
import {hasExplicitCognitiveBudget} from './model.js';

const META='psycheMaintenanceV1',BATCH_SIZE=16,BASE_BACKOFF=30*60000;
const required=p=>!!(p.needsCompression||p.needsProjectionReview);
const epoch=i=>i.store.manifest().role_epoch;
const read=i=>i.meta(META)||{};
const backoff=n=>Math.min(6*3600000,BASE_BACKOFF*2**Math.min(4,Math.max(0,n-1)));
const batchView=batch=>({...batch,threads:batch.threads.map(t=>({id:t.id,revision:t.revision,status:t.status,text:t.text,kind:t.kind,importance:t.importance,intensity:t.intensity,createdAt:t.createdAt,objectIds:(t.objectIds||[]).slice(0,20),personId:typeof t.personId==='string'&&t.personId.length<=180?t.personId:undefined,people:(Array.isArray(t.people)?t.people:[]).filter(v=>typeof v==='string'&&v.length<=180).slice(0,8),uncertainBasis:!!t.uncertainBasis,reviewDisposition:t.reviewDisposition,evidenceCount:(t.sourceRefs?.length||0)+(t.memoryRefs?.length||0),reviewEvidenceCount:(t.reviewMemoryIds?.length||0)+(t.reviewSourceIds?.length||0)}))});
export const psychologyMaintenanceBatch=(inner,{cursor=null}={})=>({...batchView(inner.psyche.maintenanceBatch({limit:BATCH_SIZE,cursor})),cursor});

// One explicit review may be requested even when automatic pressure is low.
// Its stable request fingerprint survives an enqueue/checkpoint crash.
export function schedulePsychologyReview(inner,{requestId}={}){
 if(!hasExplicitCognitiveBudget()||typeof requestId!=='string'||!requestId.trim())throw Object.assign(new Error('V3_EXPLICIT_PSYCHOLOGY_REVIEW_REQUIRED'),{code:'V3_EXPLICIT_PSYCHOLOGY_REVIEW_REQUIRED'});
 const queued=inner.db.prepare("SELECT job_id FROM jobs WHERE character_id=? AND role_epoch=? AND kind='inner-dream-v3' AND status IN ('pending','running') AND json_extract(payload_json,'$.psycheCompression')=1 ORDER BY rowid LIMIT 1").get(inner.runtime.characterId,epoch(inner));if(queued)return queued.job_id;
 const p=inner.psyche.pressure();if(required(p))return null;
 const key='manualPsycheReview:'+hash([epoch(inner),requestId]),enqueue=()=>{const prior=inner.meta(key),old=prior?.jobId?inner.db.prepare('SELECT status FROM jobs WHERE job_id=?').get(prior.jobId):null;
  if(old){const committed=inner.db.prepare('SELECT 1 FROM v3_inner_commits WHERE idempotency_key=?').get('dream:'+prior.jobId),r=inner.db.prepare('SELECT report_json FROM maintenance_reports WHERE job_id=?').get(prior.jobId);if(committed||old.status!=='complete'||!r||parse(r.report_json).status!=='superseded-no-replay')return {jobId:prior.jobId,affected:[]};}
  const attempt=(prior?.attempt||0)+1,payload={memoryIds:[],psycheCompression:true,manualReview:true,reviewRequestId:requestId,fingerprint:p.fingerprint,projectionRevision:p.projectionRevision||0,before:p,batch:psychologyMaintenanceBatch(inner),cycle:read(inner).cycle||0,progressInPass:false};
  const jobId=inner.store.enqueue('inner-dream-v3',payload,{fingerprint:'psyche-manual-review:'+hash([inner.runtime.characterId,epoch(inner),requestId,attempt])});inner.meta(key,{jobId,attempt});return {jobId,affected:[]};
 };
 return (inner.db.isTransaction?enqueue():inner.store.atomic('psyche-manual-review-queued',enqueue)).jobId;
}

// Scheduling never chooses an activity or supplies a fresh emotional experience.
// Its durable cursor only determines which existing expressions get reviewed.
export function schedulePsychologyMaintenance(inner,options={}){return ensurePsychologyMaintenance(inner,options);}
export function ensurePsychologyMaintenance(inner,{waitingFor=null}={}){
 if(inner.store.closed||inner.runtime.closed||inner.runtime.closing)return null;
 let jobId=null;
 const apply=()=>{const result=scheduleMaintenanceWithin(inner,{waitingFor});jobId=result.jobId;return result.changed?{affected:[]}:null;};
 if(inner.db.isTransaction)apply();else inner.store.atomic('psyche-maintenance-ensured',apply);
 return jobId;
}
function scheduleMaintenanceWithin(inner,{waitingFor}){
 const p=inner.psyche.pressure(),now=inner.now(),roleEpoch=epoch(inner);let state=read(inner);
 let changed=false;const save=value=>{if(json(read(inner))!==json(value)){inner.meta(META,value);changed=true;}},done=jobId=>({jobId,changed});
 const queued=inner.db.prepare("SELECT j.job_id,j.role_epoch,j.status,j.payload_json,j.retry_at,EXISTS(SELECT 1 FROM v3_inner_commits c WHERE c.idempotency_key='dream:'||j.job_id) committed FROM jobs j WHERE character_id=? AND kind='inner-dream-v3' AND status IN ('pending','running') AND json_extract(payload_json,'$.psycheCompression')=1 ORDER BY committed DESC,j.rowid").all(inner.runtime.characterId);
 let current=null;
 for(const job of queued){const payload=parse(job.payload_json),matches=job.role_epoch===roleEpoch&&payload.fingerprint===p.fingerprint&&(payload.projectionRevision||0)===(p.projectionRevision||0);
  // A committed page must reach finishCommittedDream even if its own commit
  // changed the projection. A stale manual request must reach the explicit
  // superseded receipt, so its finite request can select one fresh snapshot.
  if(job.role_epoch===roleEpoch&&(job.committed||payload.manualReview||required(p)&&matches)&&!current){current=job;continue;}
  inner.db.prepare("UPDATE jobs SET status='cancelled',lease_owner=NULL,lease_until=NULL WHERE job_id=?").run(job.job_id);changed=true;
 }
 if(!required(p)&&!current){save({...state,roleEpoch,status:'current',cursor:null,fingerprint:p.fingerprint,projectionRevision:p.projectionRevision||0,retryAt:0,jobId:null,reason:null,waitingFor:null});return done(null);}
 if(state.roleEpoch!==roleEpoch)state={roleEpoch,cycle:0};
 if(state.fingerprint&&state.fingerprint!==p.fingerprint||p.needsProjectionReview&&state.projectionRevision!==(p.projectionRevision||0))state={...state,status:'continuing',cursor:null,progressInPass:false,retryAt:0,noProgressPasses:0,failedPasses:0,cycle:(state.cycle||0)+1};
 if(current){const deferred=current.retry_at>now;save({...state,roleEpoch,status:current.committed?'recovery-pending':deferred?'deferred':waitingFor?'waiting':'queued',fingerprint:p.fingerprint,projectionRevision:p.projectionRevision||0,jobId:current.job_id,retryAt:deferred?current.retry_at:0,reason:deferred?state.reason:null,waitingFor:waitingFor||null});return done(current.job_id);}
 if(state.jobId){const old=inner.db.prepare('SELECT status FROM jobs WHERE job_id=?').get(state.jobId);if(old?.status==='failed'&&state.lastFailedJob!==state.jobId){const failures=(state.failedPasses||0)+1;state={...state,status:failures>=3?'blocked':'deferred',failedPasses:failures,lastFailedJob:state.jobId,retryAt:failures>=3?0:now+backoff(failures),reason:'maintenance-failed'};save(state);}else if(old&&['cancelled','complete'].includes(old.status))state={...state,jobId:null,cycle:(state.cycle||0)+1};}
 state={...state,roleEpoch,fingerprint:p.fingerprint,projectionRevision:p.projectionRevision||0,waitingFor:waitingFor||null};
 if(state.status==='blocked'){save(state);return done(null);}
 if(hasExplicitCognitiveBudget()&&state.reason==='V3_HOURLY_MODEL_BUDGET')state={...state,status:'continuing',retryAt:0,reason:null};
 if((state.retryAt||0)>now){save(state);return done(null);}
 if(!waitingFor&&!hasExplicitCognitiveBudget()&&inner.budgetExhausted?.()){save({...state,status:'deferred',retryAt:now+60000,reason:'ENERGY_DEPLETED'});return done(null);}
 const cursor=state.cursor??null,batch=psychologyMaintenanceBatch(inner,{cursor});
 const cycle=(state.cycle||0)+(state.status==='deferred'?1:0),payload={memoryIds:[],psycheCompression:true,fingerprint:p.fingerprint,projectionRevision:p.projectionRevision||0,before:p,batch:{...batch,cursor},cycle,progressInPass:!!state.progressInPass};
 const jobId=inner.store.enqueue('inner-dream-v3',payload,{fingerprint:'psyche-maintenance:'+hash([roleEpoch,cycle,p.fingerprint,p.projectionRevision||0,cursor])});
 changed=true;save({...state,status:waitingFor?'waiting':'queued',cursor,cycle,retryAt:0,jobId,reason:null});return done(jobId);
}

// Called in the same transaction that finishes (or recovers) the committed job.
export function advancePsychologyMaintenance(inner,job,{before=job.payload.before,after=inner.psyche.pressure(),superseded=false}={}){
 const old=read(inner),p=job.payload,now=inner.now();
 if(superseded){inner.meta(META,{...old,status:'superseded',roleEpoch:epoch(inner),fingerprint:after.fingerprint,projectionRevision:after.projectionRevision||0,cursor:null,progressInPass:false,retryAt:0,cycle:Math.max(old.cycle||0,p.cycle||0)+1,jobId:null});return schedulePsychologyMaintenance(inner);}
 const compressed=!!before&&(after.threads<before.threads||after.chars<before.chars),progress=!!p.progressInPass||compressed;
 let state={...old,roleEpoch:epoch(inner),fingerprint:after.fingerprint,projectionRevision:after.projectionRevision||0,jobId:null,cycle:p.cycle||0,reason:null};
 if(!required(after)){state={...state,status:'current',cursor:null,progressInPass:false,noProgressPasses:0,retryAt:0};inner.meta(META,state);inner.meta('lastPsycheCompressionFingerprint',after.fingerprint);return null;}
 if(p.batch?.hasMore){state={...state,status:'continuing',cursor:p.batch.nextCursor,progressInPass:progress,retryAt:0};}
 else if(progress){state={...state,status:'continuing',cursor:null,progressInPass:false,noProgressPasses:0,retryAt:0,cycle:state.cycle+1};}
 else{const noProgressPasses=(old.noProgressPasses||0)+1;state={...state,status:'deferred',cursor:null,progressInPass:false,noProgressPasses,retryAt:now+backoff(noProgressPasses),reason:'no-compression-progress'};}
 inner.meta(META,state);return schedulePsychologyMaintenance(inner);
}

export function deferPsychologyMaintenance(runtime,job,error){
 const inner=runtime.inner,code=error.code||error.message||'interrupted',now=runtime.now(),retryAt=code==='V3_HOURLY_MODEL_BUDGET'?(Math.floor(now/3600000)+1)*3600000:now+30000;
 return runtime.store.atomic('psyche-maintenance-deferred',()=>{
  runtime.store.assertJob(job);const report={kind:'inner-dream-v3',reason:'psychological-maintenance',status:'deferred',error:code,retryAt};
  inner.db.prepare("UPDATE jobs SET status='pending',retry_at=?,lease_owner=NULL,lease_until=NULL WHERE character_id=? AND job_id=?").run(retryAt,runtime.characterId,job.job_id);
  inner.db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(runtime.characterId,job.job_id,json(report),now);
  inner.meta(META,{...read(inner),status:'deferred',reason:code,retryAt,jobId:job.job_id});return {...report,affected:[]};
 });
}

export function recoverPsychologyPayload(row){return {...row,payload:parse(row.payload_json||'{}')};}
