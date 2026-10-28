import {lifeNightAt} from '../energy-policy.js';
import {fail,hash,json,parse} from './contracts.js';
const terminal=status=>['succeeded','failed','cancelled','unknown'].includes(status);
const jobTerminal=status=>['complete','failed','cancelled'].includes(status);
const refsKey=refs=>Array.isArray(refs)&&refs.every(r=>r&&typeof r.sourceId==='string'&&Number.isSafeInteger(r.revision))?hash(refs.map(r=>({sourceId:r.sourceId,revision:r.revision,checksum:r.checksum})).sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.revision-b.revision)):null;
export class InnerActionDispatcher{
 constructor(owner){this.owner=owner;this.inner=owner.runtime.inner;this.runtime=owner.runtime;this.db=this.runtime.store.db;this.active=null;this.db.exec('CREATE TABLE IF NOT EXISTS v3_dispatch_runs(execution_id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL)');for(const row of this.db.prepare("SELECT * FROM v3_dispatch_runs WHERE status='active'").all()){const run=JSON.parse(row.body),execution=this.execution(run);if(run.kind==='learn'){if(execution&&['claimed','started'].includes(execution.status))this.active=run;continue;}if(!execution||!['claimed','started'].includes(execution.status)){this.mark(run,'terminal');continue;}this.inner.actionResult(run.executionId,{status:'cancelled',receipt:{reason:'restart-interrupted-rest-no-offline-experience'}});this.mark(run,'cancelled');}}
 mark(run,status='active'){this.db.prepare('INSERT OR REPLACE INTO v3_dispatch_runs VALUES(?,?,?,?)').run(run.executionId,run.kind,JSON.stringify(run),status);}
 execution(run){return this.db.prepare('SELECT * FROM v3_action_executions WHERE character_id=? AND execution_id=?').get(this.runtime.characterId,run.executionId);}
 learningProof(run){
  const execution=this.execution(run),job=this.db.prepare("SELECT * FROM jobs WHERE character_id=? AND job_id=? AND kind='learn'").get(this.runtime.characterId,run.jobId);
  const ledger=this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='learning_tasks'").get()?this.db.prepare('SELECT * FROM learning_tasks WHERE id=? AND character_id=?').get(run.jobId,this.runtime.characterId):null;
  if(!execution||!job||!ledger||!jobTerminal(job.status)||run.proposalId!==execution.action_id||ledger.kind!=='learn'||ledger.native_job_id!==run.jobId||ledger.owner_scope!=='self'||ledger.role_epoch!==execution.claimed_role_epoch||job.role_epoch!==ledger.role_epoch||ledger.origin!=='inner-proposal')fail('LEARNING_RECEIPT_UNAVAILABLE');
  const origin=parse(ledger.origin_ref);if(origin?.proposalId!==run.proposalId||origin?.executionId!==run.executionId)fail('LEARNING_RECEIPT_MISMATCH');
  const receipt=parse(ledger.receipt),contextRefs=parse(ledger.source_refs),provenance=this.inner.actionProvenance(execution.action_id,execution.action_revision);
  if(!provenance||refsKey(contextRefs)!==refsKey([...new Map(provenance.sources.map(ref=>[ref.sourceId+'@'+ref.revision,ref])).values()]))fail('LEARNING_RECEIPT_MISMATCH');
  const report=this.db.prepare('SELECT * FROM maintenance_reports WHERE character_id=? AND job_id=?').get(this.runtime.characterId,run.jobId),result=report?parse(report.report_json):null;
  if(job.status==='complete'&&(ledger.phase!=='facts-retained'||receipt?.kind!=='source-backed-facts'||!Number.isSafeInteger(receipt.retainedFacts)||receipt.retainedFacts<0||receipt.masteryClaim!==false||!Array.isArray(receipt.memoryIds)||receipt.memoryIds.length!==receipt.retainedFacts||!Array.isArray(receipt.sourceRefs)||!receipt.sourceRefs.length||receipt.sourceRefs.some(ref=>typeof ref.sourceId!=='string'||!Number.isSafeInteger(ref.revision)||ref.revision<1||! /^[a-f0-9]{64}$/.test(ref.checksum))||!result?.learning||hash(result.learning)!==hash(receipt)))fail('LEARNING_RECEIPT_UNAVAILABLE');
  const at=report?.created_at??ledger.updated_at;return {execution,job,ledger,receipt,contextRefs,result,occurredAt:Number.isSafeInteger(at)&&at>=0&&at<=8640000000000000?at:null};
 }
 learningReceipt(run){
  const proof=this.learningProof(run),task=this.owner.knowledgeHost?.job('self',run.jobId),descriptor=task?.task;
  if(!task||task.id!==run.jobId||task.kind!=='learn'||task.status!==proof.job.status||descriptor?.id!==run.jobId||descriptor.kind!=='learn'||descriptor.executor!=='cognition'||descriptor.executorId!==run.jobId||descriptor.ownerScope!=='self'||descriptor.characterId!==this.runtime.characterId||descriptor.roleEpoch!==proof.ledger.role_epoch||descriptor.origin!=='inner-proposal'||descriptor.originRef?.proposalId!==run.proposalId||descriptor.originRef?.executionId!==run.executionId||refsKey(descriptor.sourceRefs)!==refsKey(proof.contextRefs)||hash(task.receipt??null)!==hash(proof.receipt??null))fail('LEARNING_RECEIPT_UNAVAILABLE');
  return {kind:'learn',jobId:run.jobId,proposalId:run.proposalId,executionId:run.executionId,ownerScope:'self',processingStatus:proof.job.status,outcome:proof.job.status==='complete'?'materials-processed':proof.job.status==='failed'?'processing-failed':'processing-cancelled',retainedFacts:proof.job.status==='complete'?proof.receipt.retainedFacts:null,sourceRefs:proof.receipt?.sourceRefs||[],contextSourceRefs:proof.contextRefs,masteryClaim:false};
 }
 receiptMatches(actual,expected){return actual?.kind==='learn'&&actual.jobId===expected.jobId&&actual.proposalId===expected.proposalId&&actual.executionId===expected.executionId&&actual.ownerScope==='self'&&actual.masteryClaim===false&&actual.retainedFacts===expected.retainedFacts&&Array.isArray(actual.sourceRefs)&&hash(actual.sourceRefs)===hash(expected.sourceRefs)&&(actual.contextSourceRefs===undefined||refsKey(actual.contextSourceRefs)===refsKey(expected.contextSourceRefs));}
 learningRecovery(){
  // Provenance recovery may already have cancelled the old process's grant and
  // dispatch row. A finished job is still a fact; it never grants another run.
  const row=this.db.prepare("SELECT d.body FROM v3_dispatch_runs d JOIN v3_action_executions e ON e.execution_id=d.execution_id JOIN jobs j ON j.character_id=e.character_id AND j.job_id=json_extract(d.body,'$.jobId') AND j.kind='learn' WHERE d.kind='learn' AND e.character_id=? AND coalesce(json_extract(d.body,'$.completionFinalized'),0)<>1 AND coalesce(json_extract(d.body,'$.receiptUnavailable.code'),'') NOT IN ('LEARNING_RECEIPT_LEGACY_UNVERIFIED','LEARNING_RECEIPT_SOURCE_REDACTED') AND (e.status IN ('succeeded','failed','unknown','cancelled') OR j.status IN ('complete','failed','cancelled')) ORDER BY d.rowid LIMIT 1").get(this.runtime.characterId);
  return row?parse(row.body):null;
 }
 finishLearning(run){
  try{return this.settleLearning(run);}catch(error){
   if(error.code!=='SOURCE_DELETED')throw error;
   // A tombstone is a durable privacy decision, not a transient store outage.
   // Keep the unfinished receipt auditable without blocking unrelated actions.
   run.receiptUnavailable={code:'LEARNING_RECEIPT_SOURCE_REDACTED',reason:'durable-receipt-source-erased-do-not-reconstruct',masteryClaim:false,newAuthorization:false};
   this.mark(run,'receipt-unavailable');if(this.active?.executionId===run.executionId)this.active=null;
   return {status:'receipt-unavailable',kind:'learn',jobId:run.jobId,actionStatus:this.execution(run)?.status,receipt:null,reason:run.receiptUnavailable};
  }
 }
 settleLearning(run){
  this.runtime.assertOpen();if(terminal(this.execution(run)?.status))this.db.prepare("UPDATE jobs SET status='cancelled',lease_owner=NULL,lease_until=NULL WHERE character_id=? AND job_id=? AND kind='learn' AND status IN ('pending','running')").run(this.runtime.characterId,run.jobId);
  const legacy=this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='learning_tasks'").get()?this.db.prepare("SELECT * FROM learning_tasks WHERE id=? AND character_id=? AND origin='legacy' AND migration_reason IS NOT NULL").get(run.jobId,this.runtime.characterId):null;
  if(legacy){
   let execution=this.execution(run);const native=()=>this.db.prepare("SELECT * FROM jobs WHERE character_id=? AND job_id=? AND kind='learn'").get(this.runtime.characterId,run.jobId);
   if(!execution||!native()||legacy.native_job_id!==run.jobId)fail('LEARNING_RECEIPT_UNAVAILABLE');
   if(!terminal(execution.status)){this.inner.cancelExecutions([execution.action_id],'legacy-learning-receipt-unverified');execution=this.execution(run);}
   if(!terminal(execution.status))fail('LEARNING_RECEIPT_UNAVAILABLE');
   if(!this.db.prepare('SELECT 1 FROM v3_experience_outcomes WHERE outcome_id=? AND execution_id=?').get(run.executionId+':'+execution.status,run.executionId))this.inner.recordOutcome(run.executionId,execution.status,parse(execution.receipt_json).receipt,{recovered:true});
   run.receiptUnavailable={code:'LEARNING_RECEIPT_LEGACY_UNVERIFIED',reason:legacy.migration_reason,jobStatus:native().status,masteryClaim:false,newAuthorization:false};
   this.mark(run,'receipt-unavailable');if(this.active?.executionId===run.executionId)this.active=null;
   return {status:'receipt-unavailable',kind:'learn',jobId:run.jobId,actionStatus:execution.status,receipt:null,reason:run.receiptUnavailable};
  }
  let proof=this.learningProof(run);
  if(!run.completion){const receipt=this.learningReceipt(run);run.completion={version:1,jobStatus:proof.job.status,receipt,occurredAt:proof.occurredAt};this.mark(run,'completion-pending');}
  const completed=run.completion,expected={jobId:run.jobId,proposalId:run.proposalId,executionId:run.executionId,retainedFacts:proof.job.status==='complete'?proof.receipt.retainedFacts:null,sourceRefs:proof.receipt?.sourceRefs||[],contextSourceRefs:proof.contextRefs};
  if(completed.version!==1||completed.jobStatus!==proof.job.status||completed.receipt?.processingStatus!==proof.job.status||!this.receiptMatches(completed.receipt,expected)||refsKey(completed.receipt.contextSourceRefs)!==refsKey(proof.contextRefs))fail('LEARNING_RECEIPT_MISMATCH');
  if(!terminal(proof.execution.status)){
   try{this.inner.assertExecutable(run.executionId);}catch{this.inner.cancelExecutions([proof.execution.action_id],'dispatcher-action-no-longer-current');}
   proof=this.learningProof(run);
   if(!terminal(proof.execution.status))this.inner.actionResult(run.executionId,{status:proof.job.status==='complete'?'succeeded':proof.job.status,receipt:completed.receipt});
  }
  const execution=this.execution(run);if(!terminal(execution?.status))fail('LEARNING_RECEIPT_UNAVAILABLE');
  const canonical=parse(execution.receipt_json).receipt;
  if(execution.status==='succeeded'&&(proof.job.status!=='complete'||!this.receiptMatches(canonical,expected)))fail('LEARNING_RECEIPT_MISMATCH');
  // actionResult can have committed its terminal state before archive/store
  // failed. Reconcile that exact state before asserting any current authority.
  if(!this.db.prepare('SELECT 1 FROM v3_experience_outcomes WHERE outcome_id=? AND execution_id=?').get(run.executionId+':'+execution.status,run.executionId))this.inner.recordOutcome(run.executionId,execution.status,canonical,{recovered:true});
  if(proof.job.status==='complete'&&execution.status!=='succeeded'){
   if(!completed.effectEnvelope){completed.effectEnvelope={source:{adapter:'learning-dispatch-receipt',externalId:run.executionId+':'+run.jobId,kind:'action-outcome',text:json({observation:'学习资料已由实际任务处理；原行动许可已终止，这份回执不是新授权。',actionStatus:execution.status,processingStatus:'complete',receipt:completed.receipt}),occurredAt:completed.occurredAt,metadata:{scope:'self',speakerId:this.runtime.characterId,executionId:run.executionId,proposalId:run.proposalId,jobId:run.jobId,historical:true,recovered:true,notPrimaryEvidence:true,newAuthorization:false,learningExcluded:true,sourceRefs:completed.receipt.sourceRefs}},event:{kind:'action-outcome',eventRoot:'action:'+run.proposalId,outcome:'observed'}};this.mark(run,'completion-pending');}
   this.inner.noteActionEffect(run.executionId,completed.receipt);
   const envelope=completed.effectEnvelope,event=this.runtime.observe(envelope.source,envelope.event);completed.effectReceipt={sourceId:event.sourceId,revision:event.revision,eventId:event.eventId};
  }
  run.completionFinalized=true;this.mark(run,proof.job.status);if(this.active?.executionId===run.executionId)this.active=null;
  return {status:execution.status==='succeeded'?'complete':execution.status,kind:'learn',jobId:run.jobId,processingStatus:proof.job.status,receipt:completed.receipt};
 }
 proposal(){this.inner.expireActions();return this.db.prepare("SELECT a.* FROM v3_action_proposals a JOIN v3_inner_objects o ON o.object_id=a.object_id AND o.current_revision=a.revision WHERE a.status='proposed' AND a.based_on_mind_generation=? AND a.based_on_role_epoch=? AND a.expires_at>? AND coalesce(a.not_before,0)<=? ORDER BY o.created_at DESC LIMIT 50").all(this.inner.head().generation,this.runtime.store.manifest().role_epoch,this.runtime.now(),this.runtime.now()).find(a=>this.inner.actionIsCurrent(a))||null;}
 get resting(){return this.active?.kind==='rest';}
 interrupt(){if(!this.active||this.active.kind==='learn')return;const a=this.active;this.active=null;if(a.behaviorId)this.owner.endBehavior(a.behaviorId,'休息被真实来信打断；没有发生额外活动。');this.mark(a,'cancelled');this.inner.actionResult(a.executionId,{status:'cancelled',receipt:{reason:'foreground-interrupted'}});}
 async tick(host={}){const now=this.runtime.now(),recovery=this.learningRecovery();if(recovery)return this.finishLearning(recovery);if(this.active){const a=this.active,execution=this.execution(a);let eligible=false;try{this.inner.assertExecutable(a.executionId);eligible=true;}catch{if(execution&&['claimed','started'].includes(execution.status)){const action=this.db.prepare('SELECT action_id FROM v3_action_executions WHERE execution_id=?').get(a.executionId);if(action)this.inner.cancelExecutions([action.action_id],'dispatcher-action-no-longer-current');}}if(!eligible){if(a.kind==='learn')return this.finishLearning(a);this.active=null;this.mark(a,'cancelled');if(a.behaviorId)this.owner.endBehavior(a.behaviorId,'原意图已撤销。');return {status:'cancelled'};}if(a.kind==='rest'&&now>=a.until){this.active=null;this.mark(a,'complete');this.inner.actionResult(a.executionId,{status:'succeeded',receipt:{kind:'rest',startedAt:a.startedAt,finishedAt:now}});this.owner.endBehavior(a.behaviorId,'这段安静休息结束。');return {status:'rested'};}return {status:'active',kind:a.kind};}
 const spending=this.runtime.dailyCostBudget?.admit();if(spending?.allowed===false)return {status:'daily-cost-winding-down',retryAt:spending.nextResetAt};
 if(!this.owner.ready()||this.owner.behaviors.size||lifeNightAt(this.runtime,now)||host.attention?.status().active)return {status:'blocked'};const proposal=this.proposal();if(!proposal)return {status:'idle'};
 // Chat and browse keep their adapter-owned send/read checks and shared attention lane.
 if(['chat','browse'].includes(proposal.action_kind))return {status:'adapter-pending',kind:proposal.action_kind};
 if(proposal.action_kind==='learn'&&!this.owner.knowledgeHost)return {status:'capability-unavailable'};
 const run=this.inner.beginAction(proposal,{authorization:true,sleep_window:true,recipient_refusal:true,budget:true,attention_lane:true,capability_ready:true});if(!run)return {status:'stale'};
 try{if(proposal.action_kind==='learn'){const sources=(this.inner.actionProvenance(proposal.object_id,proposal.revision)?.sources||[]).map(ref=>({sourceId:ref.sourceId,revision:ref.revision}));const job=this.owner.knowledgeHost.enqueue('self',proposal.bounded_intent,{kind:'learn',online:true,publicResearch:false,learningGoal:proposal.bounded_intent,host:{origin:'inner-proposal',originRef:{proposalId:proposal.object_id,executionId:run.executionId},sourceRefs:sources}});this.db.prepare('UPDATE v3_action_executions SET lease_until=? WHERE execution_id=?').run(now+24*3600000,run.executionId);this.active={kind:'learn',proposalId:proposal.object_id,executionId:run.executionId,jobId:job.id};this.mark(this.active);return {status:'queued',kind:'learn',jobId:job.id,task:job.task};}
 if(proposal.action_kind==='rest'){const body=this.inner.object(proposal.object_id).body,minutes=Math.max(5,Math.min(60,Number(body.durationMinutes)||15)),behaviorId='inner-rest:'+run.actionId;this.owner.beginBehavior(behaviorId,'rest','self','安静休息');this.db.prepare('UPDATE v3_action_executions SET lease_until=? WHERE execution_id=?').run(now+minutes*60000+60000,run.executionId);this.active={kind:'rest',executionId:run.executionId,behaviorId,startedAt:now,until:now+minutes*60000};this.mark(this.active);return {status:'resting',until:this.active.until};}
 this.inner.actionResult(run.executionId,{status:'succeeded',receipt:{kind:'do_nothing',externalAction:false}});return {status:'quiet'};
 }catch(error){this.inner.actionResult(run.executionId,{status:'failed',receipt:{reason:String(error.code||error.message).slice(0,180)}});throw error;}}
 status(){return {active:this.active?{...this.active}:null,next:this.proposal()?.action_kind||null,source:'single-inner-proposal',creationEnabled:false};}
}
