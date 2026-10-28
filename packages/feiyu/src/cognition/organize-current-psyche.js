import {energyExempt} from '../energy-context.js';
import {randomUUID} from 'node:crypto';
import {assertSignal,fail,json,parse} from './contracts.js';
import {MaintenanceBudget} from './maintenance-budget.js';
import {withCognitiveBudget} from './model.js';
import {schedulePsychologyMaintenance,schedulePsychologyReview} from './psyche-maintenance.js';
import {processDreamFollowup,finishCommittedDream} from './v3-dream-followup.js';

const TABLE='v3_psyche_organize_requests';
const needs=p=>!!(p.needsCompression||p.needsProjectionReview);
const maintenance=i=>i.meta('psycheMaintenanceV1')||{};
const summary=i=>i.psyche.compile();
const abortCodes=new Set(['V3_INNER_BUSY','COGNITION_READSET_STALE','V3_HEAD_VERSION_CONFLICT','MEMORY_VERSION_CONFLICT']);

// Explicit administrator maintenance owns a finite, durable budget. It does not
// replace the model's hourly budget or alter the normal background worker.
export async function organizeCurrentPsyche(owner,{maxBatches=3,requestId=randomUUID(),reviewCurrent=false,signal}={}){
 if(typeof requestId!=='string'||!requestId.trim()||requestId.length>120||typeof reviewCurrent!=='boolean'||!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>8)fail('INVALID_PSYCHOLOGY_ORGANIZE_REQUEST');
 const r=owner.runtime,i=r?.inner,s=r?.store;if(!i||owner.isV3===false)fail('V3_NOT_ENABLED');r.assertOpen?.();assertSignal(signal);
 const db=s.db,roleEpoch=s.manifest().role_epoch;
 db.exec(`CREATE TABLE IF NOT EXISTS ${TABLE}(request_id TEXT PRIMARY KEY,role_epoch INTEGER NOT NULL,status TEXT NOT NULL,report_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`);
 const prior=db.prepare(`SELECT * FROM ${TABLE} WHERE request_id=?`).get(requestId);
 if(prior&&prior.role_epoch!==roleEpoch)fail('STALE_ROLE_EPOCH');
 // Older reports used a terminal request status even when the leased job had
 // been released as pending. Resume that exact job and its original budget;
 // claim() still enforces the stored retry time and three-attempt limit.
 const priorReport=prior?parse(prior.report_json):null,lastFailure=priorReport?.steps?.at(-1),retryJob=prior?.status==='failed'&&lastFailure?.error===priorReport.reason?db.prepare('SELECT status,role_epoch,attempts,kind,payload_json FROM jobs WHERE job_id=?').get(lastFailure.jobId):null;
 const committedFailure=retryJob&&!!db.prepare('SELECT 1 FROM v3_inner_commits WHERE idempotency_key=?').get('dream:'+lastFailure.jobId);
 const resumableFailure=retryJob?.role_epoch===roleEpoch&&retryJob.kind==='inner-dream-v3'&&(committedFailure||retryJob.status==='pending'&&retryJob.attempts<3&&parse(retryJob.payload_json).psycheCompression===true);
 if(prior&&((prior.status==='complete'||prior.status==='budget-exhausted'&&!energyExempt())||prior.status==='failed'&&!resumableFailure))return {...priorReport,duplicate:true};
 if(owner.running||[...(owner.behaviors?.values?.()||[])].some(b=>b.kind!=='sleep'))return {status:'foreground-busy',requestId};
 const abort=new AbortController(),combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal,slot=owner.actionHost?.attention?.tryBackground('operator-psyche-organize',()=>abort.abort(new Error('FOREGROUND_PREEMPTION')));
 if(owner.actionHost?.attention&&!slot)return {status:'foreground-busy',requestId};
 let lease;try{lease=await r.attention.acquire('organize',null,{background:true,signal:combined});}catch(error){slot?.release();throw error;}
 if(!lease){slot?.release();return {status:'foreground-busy',requestId};}
 const budget=new MaintenanceBudget(s,'operator-psyche:'+r.characterId+':'+roleEpoch+':'+requestId,{maxCalls:8,maxInputChars:360000});
 let report=prior?priorReport:{requestId,roleEpoch,status:'running',startedAt:r.now(),before:i.psyche.pressure(),summaryBefore:summary(i),generationBefore:i.head().generation,steps:[]};
 report={...report,reviewCurrent:report.reviewCurrent===true||reviewCurrent,reviewCompleted:report.reviewCompleted===true};
 if(resumableFailure)report={...report,resumedPendingFailure:true,...(retryJob.status==='complete'?{activeJobId:lastFailure.jobId}:{})};
 const save=status=>{report={...report,status,updatedAt:r.now(),after:i.psyche.pressure(),summaryAfter:summary(i),generationAfter:i.head().generation,budget:budget.status(),maintenance:maintenance(i),budgetPolicy:budget.unlimited?'administrator-energy-exempt-usage-accounting-only':'explicit-finite-psyche-maintenance-usage-history-preserved'};db.prepare(`INSERT INTO ${TABLE} VALUES(?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET status=excluded.status,report_json=excluded.report_json,updated_at=excluded.updated_at`).run(requestId,roleEpoch,status,json(report),report.startedAt,r.now());return report;};
 const record=(jobId,result)=>{const step={jobId,...result};report.steps=[...report.steps.filter(v=>v.jobId!==jobId),step];report.activeJobId=null;if(report.reviewCurrent&&result.commitId){const commit=db.prepare('SELECT expected_mind_generation FROM v3_inner_commits WHERE commit_id=?').get(result.commitId);if(jobId===report.reviewJobId||commit?.expected_mind_generation+1===i.head().generation)report.reviewCompleted=true;}};
 owner.running={abort,job:{kind:'operator-psyche-organize',id:requestId}};
 const work=withCognitiveBudget(budget,async()=>{
  try{
   const awaiting=report.activeJobId||(report.reviewCurrent&&!report.reviewCompleted?report.nextJobId:null);if(awaiting){const row=db.prepare('SELECT status FROM jobs WHERE job_id=?').get(awaiting);if(row?.status==='complete'){const saved=db.prepare('SELECT report_json FROM maintenance_reports WHERE job_id=?').get(awaiting);record(awaiting,{...(saved?parse(saved.report_json):{}),recoveredWithoutModel:true});}}
   save('running');
   if(!r.model.available){report.reason='MODEL_NOT_CONFIGURED';return save('deferred');}
   for(let batch=0;batch<maxBatches;batch++){
    assertSignal(lease.signal);if(s.manifest().role_epoch!==roleEpoch)fail('STALE_ROLE_EPOCH');
    const ids=db.prepare("SELECT job_id FROM jobs WHERE character_id=? AND role_epoch=? AND kind='inner-dream-v3' AND json_extract(payload_json,'$.psycheCompression')=1 AND status IN ('pending','running','failed')").all(r.characterId,roleEpoch).map(j=>j.job_id);
    const recovered=ids.length?finishCommittedDream(r,ids):null;if(recovered){record(recovered.jobId,{...recovered.report,status:'recovered'});save('running');continue;}
    let id=schedulePsychologyMaintenance(i);
    if(!id&&!needs(i.psyche.pressure())&&report.reviewCurrent&&!report.reviewCompleted){id=schedulePsychologyReview(i,{requestId});report.reviewJobId=id;save('running');}
    if(!id){report.retryAt=maintenance(i).retryAt||0;report.reason=maintenance(i).reason||null;return save(needs(i.psyche.pressure())?'deferred':report.reviewCurrent&&!report.reviewCompleted?'partial':'complete');}
    const queued=db.prepare('SELECT * FROM jobs WHERE job_id=?').get(id),saved=db.prepare('SELECT report_json FROM maintenance_reports WHERE job_id=?').get(id),last=saved?parse(saved.report_json):{};
    if(queued.status==='complete'){record(id,{...last,recoveredWithoutModel:true});save('running');continue;}
    if(queued.status==='failed'){report.nextJobId=id;report.reason=last.error||'maintenance-job-failed';return save('failed');}
    // Only the ordinary quota's delay can be handled by the explicit budget.
    // No-progress, stale/foreground retry times and permanent failures remain.
    if(queued.status==='pending'&&queued.retry_at>r.now()&&last.error==='V3_HOURLY_MODEL_BUDGET')db.prepare('UPDATE jobs SET retry_at=? WHERE job_id=?').run(r.now(),id);
    const job=s.claim({kinds:['inner-dream-v3'],jobIds:[id],owner:'operator-psyche:'+requestId});
    if(!job){report.nextJobId=id;report.retryAt=queued.status==='running'?queued.lease_until:queued.retry_at;report.reason='existing-job-not-runnable';return save('deferred');}
    report.activeJobId=job.job_id;save('running');let heartbeat;
    try{heartbeat=setInterval(()=>{try{s.heartbeat(job);}catch(error){lease.abort.abort(error);}},30000);heartbeat.unref?.();const result=await processDreamFollowup(r,job,lease.signal);record(job.job_id,result);owner.changed?.();save('running');if(result.status==='deferred'){report.retryAt=result.retryAt;report.reason=result.error;return save('deferred');}}
    catch(error){const code=error.code||error.message;s.release(job,{aborted:lease.signal.aborted||abortCodes.has(code)||code==='V3_MAINTENANCE_BUDGET',error:code});const released=db.prepare('SELECT status,retry_at FROM jobs WHERE job_id=?').get(job.job_id);record(job.job_id,{status:released?.status==='pending'?'deferred':'failed',error:code});report.reason=code;report.nextJobId=job.job_id;report.retryAt=released?.retry_at||0;if(code==='V3_MAINTENANCE_BUDGET')return save('budget-exhausted');const state=maintenance(i);if(state.jobId===job.job_id)i.meta('psycheMaintenanceV1',{...state,status:released?.status==='pending'?'deferred':'failed',reason:code,retryAt:report.retryAt});return save(released?.status==='pending'?'deferred':'failed');}finally{clearInterval(heartbeat);}
   }
   report.nextJobId=maintenance(i).jobId||null;report.retryAt=maintenance(i).retryAt||0;report.reason=maintenance(i).reason||null;return save(needs(i.psyche.pressure())?(report.retryAt>r.now()?'deferred':'partial'):report.reviewCurrent&&!report.reviewCompleted?'partial':'complete');
  }catch(error){report.reason=error.code||error.message;return save(combined.aborted||lease.signal.aborted?'deferred':'failed');}
 });
 r.pending?.add(work);
 try{return await work;}finally{r.pending?.delete(work);lease.release();slot?.release();owner.running=null;}
}
