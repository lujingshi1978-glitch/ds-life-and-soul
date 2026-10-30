import test from 'node:test';
import assert from 'node:assert/strict';
import {agencyAttemptKey,agencyAttemptPlan,beginAgencyAttempt,finishAgencyAttempt} from '../src/cognition/agency-attempt.js';

const start=10_000_000;
const opportunities={hasConcrete:true,fingerprint:'ocean'};
const identity={characterId:'character:test',roleEpoch:3,processKey:'process:one',config:{maxInputChars:48000,maxOutputChars:24000},inputFingerprint:'input:one'};
const key=agencyAttemptKey(identity);
const wake={eventId:'event:idle',key:'idle:event:idle',roleEpoch:3};
const begin=(prior={},now=start,extra={})=>beginAgencyAttempt(prior,{now,attemptKey:key,fingerprint:opportunities.fingerprint,pendingWake:wake,...extra});
const plan=(prior,now=start,extra={})=>agencyAttemptPlan({now,prior,attemptKey:key,opportunities,...extra});
const failure=(prior,now=start,code='MODEL_DEADLINE',extra={})=>finishAgencyAttempt(prior,{now,error:Object.assign(Error(code),{code}),...extra});

test('keys ignore object order and change with role, process, configuration or input',()=>{
 assert.equal(key,agencyAttemptKey({...identity,config:{maxOutputChars:24000,maxInputChars:48000}}));
 for(const changed of [{roleEpoch:4},{characterId:'character:other'},{processKey:'process:two'},{config:{...identity.config,maxInputChars:50000}},{inputFingerprint:'input:two'}])assert.notEqual(key,agencyAttemptKey({...identity,...changed}));
});

test('a delayed successful quiet consideration uses completion time and normal cooldown',()=>{
 const begun=begin(),completed=start+45000;
 assert.equal(begun.lastAttemptAt,start);assert.equal(begun.lastSuccessfulConsiderationAt,undefined);
 const quiet=finishAgencyAttempt(begun,{now:completed,result:{status:'applied'}});
 assert.equal(quiet.status,'considered-no-action');assert.equal(quiet.lastSuccessfulConsiderationAt,completed);assert.equal(quiet.pendingWake,null);
 assert.equal(plan(quiet,completed+1799999).due,false);assert.equal(plan(quiet,completed+1800000).due,true);
 assert.equal(plan(quiet,completed+299999,{opportunities:{hasConcrete:true,fingerprint:'volcano'}}).due,false);
 assert.equal(plan(quiet,completed+300000,{opportunities:{hasConcrete:true,fingerprint:'volcano'}}).due,true);
 const rest=finishAgencyAttempt(begin(),{now:completed,result:{status:'applied',actionId:'inner:rest',actionKind:'rest',decisionStatus:'rest-chosen'}});
 assert.equal(rest.status,'rest-chosen');assert.equal(rest.actionId,'inner:rest');assert.equal(rest.actionKind,'rest');
 const held=finishAgencyAttempt(begin(),{now:completed,result:{status:'applied',actionId:'inner:held',actionKind:'browse',decisionStatus:'proposal-held'}});
 assert.equal(held.status,'proposal-held');assert.equal(plan(held,completed+60000).due,false);
 assert.equal(finishAgencyAttempt(begin(),{now:completed,result:{status:'applied',decisionStatus:'action-chosen'}}).status,'considered-no-action');
 assert.equal(finishAgencyAttempt(begin(),{now:completed,result:{status:'applied',actionId:'inner:any',decisionStatus:'untrusted'}}).status,'considered-no-action');
});

test('transient errors retry in seconds, preserve the wake, and cap repeated failure delay',()=>{
 let state={},now=start;
 for(const expectedDelay of [30000,60000,120000,120000,120000]){
  state=failure(begin(state,now),now);assert.equal(state.lastSuccessfulConsiderationAt,undefined);
  assert.equal(state.retryAfter,now+expectedDelay);assert.deepEqual(state.pendingWake,wake);
  assert.equal(plan(state,now+expectedDelay-1).due,false);assert.equal(plan(state,now+expectedDelay).due,true);
  assert.equal(plan(state,now+expectedDelay).reusePendingWake,true);now+=expectedDelay;
 }
 assert.equal(state.failureCount,5);
});

test('a failure after a successful consideration bypasses the normal thirty minute cooldown',()=>{
 const old=finishAgencyAttempt(begin(),{now:start,result:{status:'applied'}});
 const changed=begin(old,start+300000,{attemptKey:'changed-input',fingerprint:'volcano'});
 const failed=failure(changed,start+305000);
 assert.equal(failed.lastSuccessfulConsiderationAt,start);
 assert.equal(agencyAttemptPlan({now:start+335000,prior:failed,attemptKey:'changed-input',opportunities:{hasConcrete:true,fingerprint:'volcano'}}).due,true);
});

test('minimum-budget blocks retain the original diagnostic through polling and need a changed key',()=>{
 const blocked=failure(begin(),start,'THOUGHT_INPUT_MINIMUM_TOO_LARGE');
 const snapshot=structuredClone(blocked);
 for(const now of [start+1000,start+1800000,start+86400000]){
  const waiting=plan(blocked,now);assert.equal(waiting.due,false);assert.equal(waiting.reason,'input-budget-blocked');
  assert.equal(waiting.blockedReason,'THOUGHT_INPUT_MINIMUM_TOO_LARGE');assert.equal(waiting.state,blocked);assert.equal(waiting.retryAt,null);
 }
 assert.deepEqual(blocked,snapshot);
 for(const changed of [{roleEpoch:4},{processKey:'process:two'},{config:{maxInputChars:50000}},{inputFingerprint:'input:two'}]){
  const changedKey=agencyAttemptKey({...identity,...changed});const ready=plan(blocked,start+1000,{attemptKey:changedKey});
  assert.equal(ready.due,true);assert.equal(ready.reusePendingWake,false);
  const next=beginAgencyAttempt(blocked,{now:start+1000,attemptKey:changedKey,fingerprint:'ocean'});
  assert.equal(next.pendingWake,null);assert.equal(next.failureCount,0);
 }
});

test('a last-boundary input overflow retries once, then blocks the identical input',()=>{
 const first=failure(begin(),start,'COGNITIVE_INPUT_TOO_LARGE');assert.equal(first.status,'retrying');
 const second=failure(begin(first,first.retryAfter),first.retryAfter,'COGNITIVE_INPUT_TOO_LARGE');
 assert.equal(second.status,'blocked');assert.equal(second.failureType,'input-budget');assert.equal(plan(second,start+3600000).due,false);
 assert.equal(plan(second,start+3600000,{attemptKey:'new-config'}).due,true);
});

test('recent foreground always wins over retry readiness and changed deterministic blocks',()=>{
 const blocked=failure(begin(),start,'THOUGHT_INPUT_MINIMUM_TOO_LARGE');
 const waiting=plan(blocked,start+200000,{attemptKey:'new-key',lastForegroundAt:start+190000});
 assert.equal(waiting.due,false);assert.equal(waiting.reason,'recent-foreground');assert.equal(waiting.retryAt,start+310000);assert.equal(waiting.state,blocked);
 const retry=failure(begin(),start);assert.equal(plan(retry,start+40000,{lastForegroundAt:start+35000}).reason,'recent-foreground');
});

test('busy, cancellation, no-change and duplicate without a commit never mark success',()=>{
 for(const result of [{status:'busy'},{status:'no-change'},{status:'cancelled'},{duplicate:true}]){
  const state=finishAgencyAttempt(begin(),{now:start+5000,result});
  assert.equal(state.lastSuccessfulConsiderationAt,undefined);assert.equal(state.status,'retrying');assert.deepEqual(state.pendingWake,wake);
  assert.equal(state.retryAfter,start+5000+(result.status==='busy'||result.status==='cancelled'?15000:30000));
 }
 const aborted=finishAgencyAttempt(begin(),{now:start+5000,error:Object.assign(Error('foreground took attention'),{name:'AbortError'})});
 assert.equal(aborted.failureType,'cancelled');assert.equal(aborted.retryAfter,start+20000);
 const committed=finishAgencyAttempt(begin(),{now:start+5000,result:{duplicate:true,commitId:'commit:actual'}});
 assert.equal(committed.lastSuccessfulConsiderationAt,start+5000);
});

test('budget-specific retry times are honored without changing the successful cooldown',()=>{
 const old=finishAgencyAttempt(begin(),{now:start,result:{status:'applied'}});
 const blocked=failure(begin(old,start+1800000),start+1801000,'ENERGY_DEPLETED',{retryAt:start+3600000});
 assert.equal(blocked.retryAfter,start+3600000);assert.equal(blocked.lastSuccessfulConsiderationAt,start);
 assert.equal(plan(blocked,start+3599999).due,false);assert.equal(plan(blocked,start+3600000).due,true);
});

test('an empty opportunity initializes waiting without inventing a successful consideration',()=>{
 const empty={hasConcrete:false,fingerprint:'empty'};
 const first=plan({},start,{opportunities:empty});assert.equal(first.initialize,true);assert.equal(first.state.waitingSince,start);
 assert.equal(first.state.lastSuccessfulConsiderationAt,undefined);assert.equal(plan(first.state,start+1799999,{opportunities:empty}).due,false);
 assert.equal(plan(first.state,start+1800000,{opportunities:empty}).due,true);
});

test('an in-flight attempt has a bounded lease and a no-due poll never mutates diagnostics',()=>{
 const old=failure(begin(),start),active=begin(old,start+30000);
 assert.equal(plan(active,start+30001).reason,'attempt-in-progress');assert.equal(plan(active,start+120000).due,true);
 assert.deepEqual(active.lastFailure,old.lastFailure);
 const success=finishAgencyAttempt(active,{now:start+50000,result:{status:'applied'}});
 assert.equal(plan(success,start+50001).state,success);assert.equal(success.lastFailure.reason,'MODEL_DEADLINE');
});

test('a fake clock starting at zero retains the successful and empty-input cooldowns',()=>{
 const success=finishAgencyAttempt(begin({},0),{now:0,result:{status:'applied'}});
 assert.equal(plan(success,1).due,false);assert.equal(plan(success,1800000).due,true);
 const empty={hasConcrete:false,fingerprint:'empty'},first=plan({},0,{opportunities:empty});
 assert.equal(first.state.waitingSince,0);assert.equal(plan(first.state,1,{opportunities:empty}).due,false);
 assert.equal(plan(first.state,1800000,{opportunities:empty}).due,true);
});
