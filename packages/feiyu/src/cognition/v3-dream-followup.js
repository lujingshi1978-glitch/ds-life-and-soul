import {parse,json,fail,sqlIds} from './contracts.js';
import {advancePsychologyMaintenance,deferPsychologyMaintenance,recoverPsychologyPayload,psychologyMaintenanceBatch} from './psyche-maintenance.js';
import {heldDreamCandidates,dreamIntegration} from './dream-subjectivity.js';
import {processNightReview,finishCommittedNightReviews} from './night-review.js';

export function queueDreamFollowup(runtime,job,report){
 const s=runtime.store,db=s.db;const old=db.prepare('SELECT * FROM v3_dream_followups WHERE dream_job_id=?').get(job.job_id);if(old)return old.inner_job_id;
 const ids=[...new Set([...(report.dispositionMemories||[]),...(report.abstracts||[]),...(report.changes||[]).map(c=>c.id),...(report.inputMemories||[])])].filter(id=>s.get(id)).slice(0,30),current=job.role_epoch===s.manifest().role_epoch;
 const id=current&&ids.length?s.enqueue('inner-dream-v3',{memoryIds:ids,dreamJobId:job.job_id,subjectiveCandidateIds:report.subjectiveCandidates||[],report:{summary:report.summary,changes:report.changes,abstracts:report.abstracts,keptCounterevidence:report.keptCounterevidence}},{fingerprint:'dream:'+job.job_id}):null;
 db.prepare('INSERT INTO v3_dream_followups VALUES(?,?,?,?,?)').run(job.job_id,id,job.role_epoch,current?(id?'queued':'no-evidence'):'obsolete-epoch',runtime.now());
 if(id)report.innerJob=id;return id;
}
export function installDreamFollowup(runtime){
 const s=runtime.store;s.db.exec('CREATE TABLE IF NOT EXISTS v3_dream_followups(dream_job_id TEXT PRIMARY KEY,inner_job_id TEXT,role_epoch INTEGER NOT NULL,disposition TEXT NOT NULL,at INTEGER NOT NULL)');
 runtime.consolidator.applyProposals();
 runtime.consolidator.afterDreamWithin=(job,report)=>queueDreamFollowup(runtime,job,report);
 // Recover the previous non-atomic implementation; only V3-era completed dreams.
 return s.atomic('v3-dream-followups-reconciled',()=>{let queued=0;
  for(const row of s.db.prepare(`SELECT j.job_id,j.role_epoch,r.report_json FROM jobs j JOIN maintenance_reports r USING(character_id,job_id) LEFT JOIN v3_dream_followups f ON f.dream_job_id=j.job_id WHERE j.kind='dream' AND j.status='complete' AND r.created_at>=? AND f.dream_job_id IS NULL`).all(runtime.inner.meta('activatedAt'))){const report=parse(row.report_json);if(report.kind==='dream'&&queueDreamFollowup(runtime,row,report))queued++;}
  return {queued,affected:[]};
 });
}
export async function processDreamFollowup(runtime,job,signal){
 if(job.payload.nightReview)return processNightReview(runtime,job,signal);
 if(job.payload.psycheCompression){
   const inner=runtime.inner,before=inner.psyche.pressure();
   if(before.fingerprint!==job.payload.fingerprint||(before.projectionRevision||0)!==(job.payload.projectionRevision||0))return runtime.store.atomic('psyche-pressure-superseded',()=>{runtime.store.finish(job,{kind:'inner-dream-v3',status:'superseded-no-replay'});const nextJobId=advancePsychologyMaintenance(inner,job,{before,after:before,superseded:true});return {status:'superseded-no-replay',nextJobId,affected:[]};});
   if(!job.payload.batch){job.payload={...job.payload,before,batch:psychologyMaintenanceBatch(inner)};runtime.store.db.prepare('UPDATE jobs SET payload_json=? WHERE job_id=?').run(json(job.payload),job.job_id);}
   const e=runtime.observe({adapter:'inner-psyche-pressure',externalId:job.job_id,kind:'psyche-review',text:'整理已有心理和当前统一表达，背景材料按游标分页；不是新经历，不代表情绪已经解决。',metadata:{speakerId:runtime.characterId,scope:'self',notPrimaryEvidence:true}},{kind:'psyche-review',eventRoot:'psyche-review:'+job.job_id});
   let result;try{
    result=await inner.reflect({eventIds:[e.eventId],key:'dream:'+job.job_id,kind:'dream',historical:true,compressionOnly:true,batch:job.payload.batch,signal,commitGuard:()=>{runtime.store.assertJob(job);const current=inner.psyche.pressure();if(current.fingerprint!==job.payload.fingerprint||(current.projectionRevision||0)!==(job.payload.projectionRevision||0))fail('COGNITION_READSET_STALE');},summary:'只整合此批已有表达，并承接当前统一心理；不制造新经历、感受、行动，不化解矛盾，不强求合并，不为凑满1000字重复旧事。'});if(result.status==='busy')fail('V3_INNER_BUSY');
   }catch(error){if(signal?.aborted||['ENERGY_DEPLETED','V3_INNER_BUSY','V3_HOURLY_MODEL_BUDGET','COGNITION_READSET_STALE','V3_HEAD_VERSION_CONFLICT','MEMORY_VERSION_CONFLICT'].includes(error.code))return deferPsychologyMaintenance(runtime,job,error);throw error;}
   return runtime.store.atomic('psyche-pressure-reviewed',()=>{const after=inner.psyche.pressure(),report={kind:'inner-dream-v3',reason:'psychological-pressure',before,after,...result};runtime.store.finish(job,report);report.nextJobId=advancePsychologyMaintenance(inner,job,{before,after});const maintenance=inner.meta('psycheMaintenanceV1');report.maintenanceStatus=maintenance.status;if(maintenance.retryAt)report.retryAt=maintenance.retryAt;runtime.store.db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(runtime.characterId,job.job_id,json(report),runtime.now());return {...report,affected:[]};});
 }
 const candidates=heldDreamCandidates(runtime,job.payload.subjectiveCandidateIds||[]),refs=[...new Set([...(job.payload.memoryIds||[]),...candidates.flatMap(c=>c.memoryIds)])].filter(id=>runtime.store.get(id));
 const result=refs.length?await runtime.inner.reflect({memoryIds:refs,key:'dream:'+job.job_id,kind:'dream',historical:true,signal,integration:dreamIntegration(runtime,candidates),commitGuard:()=>runtime.store.assertJob(job),summary:'根据真实记忆整理结果承接旧内心，回顾不是重新经历，不补造当时感受。整理结果：'+json(job.payload.report||{})}):{status:'evidence-unavailable'};
 if(result.status==='busy')fail('V3_INNER_BUSY');
 return runtime.store.atomic('inner-dream-complete',()=>{runtime.store.finish(job,{kind:'inner-dream-v3',...result});return {...result,affected:[]};});
}

export function finishCommittedDream(runtime,jobIds,signal){
 if(!runtime.inner)return null;const night=finishCommittedNightReviews(runtime,jobIds,signal);if(night)return night;const s=runtime.store;
 return s.atomic('inner-dream-committed-recovery',()=>{
  const row=s.db.prepare(`SELECT j.*,c.commit_id,c.expected_mind_generation committed_base_generation FROM jobs j JOIN v3_inner_commits c ON c.idempotency_key='dream:'||j.job_id WHERE j.character_id=? AND j.kind='inner-dream-v3' AND j.role_epoch=? AND (? IS NULL OR j.job_id IN (SELECT value FROM json_each(?))) AND (j.status IN ('pending','failed') OR (j.status='running' AND j.lease_until<=?)) ORDER BY j.rowid LIMIT 1`).get(runtime.characterId,s.manifest().role_epoch,jobIds?sqlIds(jobIds):null,jobIds?sqlIds(jobIds):null,runtime.now());if(!row)return null;
  const report={kind:'inner-dream-v3',duplicate:true,commitId:row.commit_id,recoveredWithoutModel:true};
  s.db.prepare("UPDATE jobs SET status='complete',lease_owner=NULL,lease_until=NULL,payload_json='{}' WHERE job_id=?").run(row.job_id);
  const recovered=recoverPsychologyPayload(row);if(recovered.payload.psycheCompression){report.reason='psychological-pressure';report.nextJobId=advancePsychologyMaintenance(runtime.inner,recovered,{superseded:runtime.inner.head().generation!==row.committed_base_generation+1});const maintenance=runtime.inner.meta('psycheMaintenanceV1');report.maintenanceStatus=maintenance.status;if(maintenance.retryAt)report.retryAt=maintenance.retryAt;}
  s.db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(runtime.characterId,row.job_id,json(report),runtime.now());
  return {status:'complete',jobId:row.job_id,report,affected:[]};
 });
}
