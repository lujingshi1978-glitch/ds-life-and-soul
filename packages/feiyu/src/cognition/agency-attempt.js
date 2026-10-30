import {createHash} from 'node:crypto';
import {agencyWakePlan} from './agency-opportunities.js';

const time=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const count=value=>Number.isSafeInteger(value)&&value>0?Math.min(32,value):0;
const reason=value=>String(value||'AGENCY_REFLECTION_INCOMPLETE').replace(/[\u0000-\u001f]/g,' ').slice(0,180);
const incomplete=new Set(['busy','cancelled','interrupted','preempted']);
const pending=new Set(['considering','retrying','blocked']);
const decisions=new Set(['action-chosen','rest-chosen','quiet-chosen','proposal-held']);

// Callers pass only identity, policy/model configuration and an input digest.
// Sorting object keys avoids invalidating a block merely because fields moved.
function stable(value){
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,stable(value[key])]));
 return value;
}
export function agencyAttemptKey({characterId,roleEpoch,processKey,config,inputFingerprint}={}){
 return createHash('sha256').update(JSON.stringify(stable({characterId,roleEpoch,processKey,config,inputFingerprint}))).digest('hex');
}

// A no-due poll returns the stored diagnostic unchanged. Scheduling reasons are
// deliberately separate: a cooldown must not rewrite a real failure as quiet.
export function agencyAttemptPlan({now,prior={},attemptKey,opportunities,lastForegroundAt=0,...life}={}){
 const lastSuccessfulAt=time(prior.lastSuccessfulConsiderationAt);
 const lastConsideredAt=lastSuccessfulAt??time(prior.waitingSince);
 let base=agencyWakePlan({now,lastForegroundAt,lastConsideredAt:lastConsideredAt??0,lastFingerprint:prior.lastSuccessfulFingerprint,opportunities,...life});
 // The older wake planner uses 0 as an absent timestamp. A pure state helper
 // also supports a fake clock beginning at the epoch without inventing wakes.
 if(lastConsideredAt===0&&base.reason!=='clock-unavailable'&&base.reason!=='recent-foreground'){
  const changed=opportunities?.hasConcrete===true&&opportunities.fingerprint!==prior.lastSuccessfulFingerprint;
  const interval=changed?(life.idleChangedIntervalMs??300000):(life.idleUnchangedIntervalMs??1800000);
  base=now<interval?{due:false,reason:changed?'opportunity-change-cooldown':'unchanged-opportunity-cooldown',retryAt:interval}:{due:true,reason:changed?'opportunity-changed':'free-time-reconsideration'};
 }
 const sameKey=typeof attemptKey==='string'&&attemptKey===prior.attemptKey;
 const output=(plan,state=prior)=>({...plan,state,reusePendingWake:sameKey&&!!prior.pendingWake});
 // Foreground attention is checked even when a failed attempt is ready again.
 if(base.reason==='clock-unavailable'||base.reason==='recent-foreground')return output(base);
 if(pending.has(prior.status)){
  if(!sameKey)return output({due:true,reason:'attempt-context-changed'});
  if(prior.status==='blocked'&&['minimum-budget','input-budget'].includes(prior.failureType))return output({due:false,reason:'input-budget-blocked',blockedReason:prior.reason,retryAt:null});
  const retryAfter=time(prior.retryAfter);
  if(retryAfter!==null&&now<retryAfter)return output({due:false,reason:prior.status==='considering'?'attempt-in-progress':'retry-backoff',retryAt:retryAfter});
  return output({due:true,reason:'retry-after-failure'});
 }
 if(base.initialize)return output(base,{...prior,version:2,waitingSince:now});
 return output(base);
}

// The wake event and reflection idempotency key are opaque here. The host must
// validate their current source, role epoch and intake state before reusing them.
export function beginAgencyAttempt(prior={}, {now,attemptKey,fingerprint,pendingWake,reason:why,attemptLeaseMs=90000}={}){
 if(time(now)===null||typeof attemptKey!=='string'||!attemptKey)throw new TypeError('INVALID_AGENCY_ATTEMPT');
 const sameKey=prior.attemptKey===attemptKey;
 return {...prior,version:2,status:'considering',at:now,lastAttemptAt:now,attemptKey,fingerprint,
  reason:why||'free-time-reconsideration',retryAfter:now+Math.max(1000,time(attemptLeaseMs)??90000),
  failureCount:sameKey?count(prior.failureCount):0,inputBoundaryFailureCount:sameKey?count(prior.inputBoundaryFailureCount):0,
  failureType:null,pendingWake:pendingWake??(sameKey?prior.pendingWake:null)??null};
}

function classification(prior,{result,error,cancelled}){
 const code=reason(error?.code||error?.message||error?.name||result?.reason||('reflection-'+(result?.status||'incomplete')));
 if(cancelled||error?.name==='AbortError'||error?.code==='ABORT_ERR'||['cancelled','interrupted','preempted'].includes(result?.status))return {type:'cancelled',code};
 if(result?.status==='busy'||code==='V3_INNER_BUSY')return {type:'busy',code};
 if(code==='THOUGHT_INPUT_MINIMUM_TOO_LARGE')return {type:'minimum-budget',code};
 if(code==='COGNITIVE_INPUT_TOO_LARGE')return {type:count(prior.inputBoundaryFailureCount)>=1?'input-budget':'transient',code};
 return {type:'transient',code};
}

// Completion is determined by the actual commit result, never by comparing the
// clock to agencyChoiceV1.at. Busy, no-change and unproven duplicates are retries.
export function finishAgencyAttempt(prior={}, {now,result,error,cancelled=false,retryAt}={}){
 if(time(now)===null)throw new TypeError('INVALID_AGENCY_ATTEMPT_TIME');
 const successful=!error&&!cancelled&&!incomplete.has(result?.status)&&(result?.status==='applied'||result?.duplicate===true&&typeof result.commitId==='string'&&!!result.commitId);
 if(successful){
  const next={...prior,version:2,status:result.actionId&&decisions.has(result.decisionStatus)?result.decisionStatus:'considered-no-action',at:now,
   lastSuccessfulConsiderationAt:now,lastSuccessfulFingerprint:prior.fingerprint,lastSuccessfulAttemptKey:prior.attemptKey,
   retryAfter:null,failureCount:0,inputBoundaryFailureCount:0,failureType:null,pendingWake:null};
  delete next.actionId;delete next.actionKind;
  if(result.actionId)next.actionId=result.actionId;
  if(result.actionKind)next.actionKind=result.actionKind;
  return next;
 }
 const failure=classification(prior,{result,error,cancelled}),failureCount=count(prior.failureCount)+1;
 const blocked=['minimum-budget','input-budget'].includes(failure.type);
 const delay=['busy','cancelled'].includes(failure.type)?15000:Math.min(120000,30000*2**Math.min(2,failureCount-1));
 const override=time(retryAt??result?.retryAt??error?.retryAt);
 return {...prior,version:2,status:blocked?'blocked':'retrying',at:now,reason:failure.code,failureType:failure.type,
  failureCount:Math.min(32,failureCount),inputBoundaryFailureCount:failure.code==='COGNITIVE_INPUT_TOO_LARGE'?Math.min(32,count(prior.inputBoundaryFailureCount)+1):count(prior.inputBoundaryFailureCount),
  retryAfter:blocked?null:override!==null?Math.max(now,override):now+delay,
  lastFailure:{at:now,reason:failure.code,type:failure.type,attemptKey:prior.attemptKey}};
}
