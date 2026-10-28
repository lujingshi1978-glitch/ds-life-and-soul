import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defaultRuntimeTuning} from '../src/runtime-tuning.js';
import {energyPolicy,advanceEnergy,lifeNightAt} from '../src/energy-policy.js';
import {withAdminEnergy,withEnergyContext} from '../src/energy-context.js';
import {LiveCognition} from '../src/cognition/live.js';
import {ContactStore} from '../src/contact-store.js';
import {agencyWakePlan} from '../src/cognition/agency-opportunities.js';
import {DailyCostBudget,beijingDayWindow} from '../src/daily-cost-budget.js';
import {createTokenLedger} from '../src/token-ledger.js';
import {DEFAULT_PRICE_TABLE} from '../src/model-prices.js';

const midday=Date.parse('2026-10-28T13:00:00+08:00');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-adjustable-life-')),legacy=path.join(dir,'legacy');fs.mkdirSync(legacy);
 const contacts=new ContactStore(path.join(legacy,'contacts.sqlite')),clock={at:midday},settings=defaultRuntimeTuning();
 const owner=new LiveCognition({root:path.join(dir,'mind'),profile:{id:'life-fixture',name:'fixture',dir:legacy},contacts,core:'我想认识这个世界。',innerVersion:3,ownerQQ:7,now:()=>clock.at,runtimeTuning:()=>settings,think:async()=>{throw Error('Unexpected model');}});
 const runtime=owner.runtime;runtime.inner.clock.mono=()=>clock.at;runtime.policy.updateState({energy:1,behavior:{kind:'idle'}});owner.life.state.sleeping=false;owner.life.state.wakes={};owner.life.state.lastWakes={};
 t.after(async()=>{await owner.close();contacts.close();fs.rmSync(dir,{recursive:true,force:true});});return {owner,runtime,settings,clock};
}

test('energy settings change actual timed recovery/drain and action charges without changing administrator exemption',t=>{
 const {owner,runtime:r,settings,clock}=fixture(t);settings.life.idleRecoveryPerHour=.2;r.policy.updateState({energy:.4,behavior:{kind:'idle'}});clock.at+=3600000;near(r.policy.state().energy,.6);
 r.policy.updateState({behavior:{kind:'chat'}});settings.life.awakeDrainPerHour=.1;for(let n=0;n<6;n++){clock.at+=600000;r.policy.updateState({});}near(r.policy.state().energy,.5);
 r.policy.updateState({energy:1,behavior:{kind:'idle'}});settings.life.actionCostScale=2;owner.beginBehavior('normal','chat','private:8');near(r.policy.state().energy,.992);owner.endBehavior('normal');const before=r.policy.state().energy;
 owner.beginBehavior('admin','chat','private:7');withAdminEnergy(()=>r.inner.reserve('encode',20));near(r.policy.state().energy,before);owner.endBehavior('admin');
 near(advanceEnergy({energy:.5,energyUpdatedAt:0,behavior:{kind:'rest'}},3600000,energyPolicy(r)).energy,.58);
});

test('changed wake cadence applies to existing lane deadlines and survives reconstruction',t=>{
 const {owner,settings,clock}=fixture(t);settings.life.wakeIntervalMs=10000;assert.equal(owner.life.claim('cognition').accepted,true);clock.at+=3000;settings.life.wakeIntervalMs=5000;assert.equal(owner.life.claim('cognition').retryAt,midday+5000);clock.at+=2000;assert.equal(owner.life.claim('cognition').accepted,true);owner.life=new owner.life.constructor(owner);assert.equal(owner.life.claim('cognition').retryAt,midday+10000);
});

test('minimum sleep duration, wake energy and changed recovery rate govern real wake state',t=>{
 const {owner,runtime:r,settings,clock}=fixture(t);settings.life.minimumSleepMs=600000;settings.life.wakeEnergy=.3;settings.life.sleepRecoveryPerHour=.3;
 r.policy.updateState({energy:0});owner.refreshEnergy();assert.equal(owner.life.state.sleeping,true);clock.at+=60000;r.policy.updateState({energy:.4});owner.refreshEnergy();assert.equal(owner.life.state.sleeping,true);clock.at+=540000;owner.refreshEnergy();assert.equal(owner.life.state.sleeping,false);
});

test('night window handles crossing midnight, Shanghai time and equal-hour disable',()=>{
 const settings=defaultRuntimeTuning();settings.life.nightStartHour=22;settings.life.nightEndHour=7;
 assert.equal(lifeNightAt(settings,Date.parse('2026-10-28T23:00:00+08:00')),true);assert.equal(lifeNightAt(settings,Date.parse('2026-10-29T06:59:00+08:00')),true);assert.equal(lifeNightAt(settings,Date.parse('2026-10-29T07:00:00+08:00')),false);settings.life.nightEndHour=22;assert.equal(lifeNightAt(settings,midday),false);
});

test('free-time decisions use configured changed/unchanged and foreground intervals',()=>{
 const opts={now:midday,lastForegroundAt:midday-1000,lastConsideredAt:midday-20000,opportunities:{hasConcrete:true,fingerprint:'new'},foregroundIdleMs:5000,idleChangedIntervalMs:10000,idleUnchangedIntervalMs:60000};assert.equal(agencyWakePlan(opts).reason,'recent-foreground');opts.foregroundIdleMs=0;assert.equal(agencyWakePlan(opts).due,true);opts.lastFingerprint='new';assert.equal(agencyWakePlan(opts).due,false);opts.idleUnchangedIntervalMs=10000;assert.equal(agencyWakePlan(opts).due,true);
});

test('daily cost soft limit stops new background work, permits replies and bounded finishing, and resets next Beijing day',()=>{
 let at=midday,known=.9;const settings=defaultRuntimeTuning();settings.budget.dailySoftLimitCny=1;settings.budget.windDownGraceMs=1000;
 const budget=new DailyCostBudget({source:settings,now:()=>at,readSpending:()=>({currency:'CNY',knownCny:known,unknownCost:false,unknownSamples:0})});assert.equal(budget.admit().allowed,true);known=1;assert.equal(budget.admit().allowed,false);assert.equal(budget.admit({foreground:true}).allowed,true);assert.equal(budget.admit({finishing:true,startedAt:at-500}).allowed,true);assert.equal(budget.admit({finishing:true,startedAt:at+1}).allowed,false);at+=1001;assert.equal(budget.admit({finishing:true,startedAt:midday-500}).allowed,false);assert.equal(budget.status().abortInflight,false);assert.throws(()=>budget.assertStart(),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});
 at=beijingDayWindow(at).to;known=0;assert.equal(budget.admit().allowed,true);assert.equal(budget.status().reachedAt,null);
});

test('unknown prices and unavailable usage remain unknown and never become invented costs',()=>{
 const settings=defaultRuntimeTuning();settings.budget.dailySoftLimitCny=1;
 const budget=new DailyCostBudget({source:settings,now:()=>midday,readSpending:()=>({currency:'CNY',knownCny:.2,unknownCost:true,unknownSamples:2})});assert.equal(budget.status().unknownCost,true);assert.equal(budget.admit().allowed,true);
 const failed=new DailyCostBudget({source:settings,now:()=>midday,readSpending:()=>{throw Error('fixture');}});assert.equal(failed.status().knownCny,null);assert.equal(failed.status().error,'usage-unavailable');assert.equal(failed.admit().allowed,true);
});

test('daily ledger uses exact Beijing day, idempotent provider usage, known model rates and no lifetime baseline attribution',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-daily-ledger-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'usage.jsonl');
 const table={...DEFAULT_PRICE_TABLE,peakMultiplier:1,peakWeekdays:[],models:{'fixture-known':{label:'fixture',off:{cacheMiss:1,cacheHit:.1,output:2}}},fallbackModel:'fixture-known'};let now=midday;
 const ledger=createTokenLedger({file,priceTable:table,now:()=>now});
 const record=(turn,at,model='fixture-known',seq=turn,input=1000000)=>ledger.ingestEvent({sessionId:'fixture',model,at,event:{type:'assistant/message',seq,data:{turn,step:1,usage:{inputTokens:input}}}});
 const day=beijingDayWindow(now);record(1,day.from-1);record(2,day.from);record(3,now,'unknown');record(4,day.to);near(ledger.dailySpending().knownCny,1);assert.equal(ledger.dailySpending().unknownSamples,1);
 assert.equal(record(2,day.from),false);near(ledger.dailySpending().knownCny,1);record(2,day.from,'fixture-known',100,2000000);near(ledger.dailySpending().knownCny,2);
 ledger.ingestBaseline({sessionId:'legacy',model:'fixture-known',at:now,projection:{asOfSeq:1,values:{tokenUsage:{inputTokens:9000000}}}});const usage=ledger.dailySpending();near(usage.knownCny,2);assert.equal(usage.unattributedHistory,true);assert.equal(usage.baselineAssignedToToday,false);
 ledger.compact();const reopened=createTokenLedger({file,priceTable:table,now:()=>now});near(reopened.dailySpending().knownCny,2);now=day.to;near(reopened.dailySpending().knownCny,1);
 reopened.ingestEvent({sessionId:'late-receipt',model:'fixture-known',at:day.to-1,event:{type:'assistant/message',seq:1,data:{turn:1,step:1,usage:{inputTokens:1000000}}}});near(reopened.dailySpending().knownCny,1);
});

test('daily cap defers actual autonomous mind entry points without invoking a model',async t=>{
 const {owner,runtime:r}=fixture(t);r.dailyCostBudget=new DailyCostBudget({settings:()=>({dailySoftLimitCny:1,windDownGraceMs:1000}),readSpending:()=>({currency:'CNY',knownCny:1}),now:r.now});
 assert.equal((await owner.work({force:true})).status,'daily-cost-winding-down');assert.equal((await r.inner.considerIdle()).status,'daily-cost-winding-down');assert.equal((await r.inner.tick()).status,'daily-cost-winding-down');
 const job=r.store.enqueue('learn',{scope:'self'},{fingerprint:'new-costly-job'});assert.equal((await withEnergyContext({finishCurrent:true,exempt:true},()=>r.runNext())).status,'daily-cost-winding-down');assert.equal(r.store.db.prepare('SELECT status FROM jobs WHERE job_id=?').get(job).status,'pending');assert.equal((await owner.actions.tick()).status,'daily-cost-winding-down');
});

test('an in-progress job reaching its wind-down deadline is deferred without consuming a failure attempt',async t=>{
 const {runtime:r}=fixture(t);const id=r.store.enqueue('fixture-cost-work',{scope:'self'},{fingerprint:'finish-deadline'});r.jobHandlers={...(r.jobHandlers||{}),'fixture-cost-work':async()=>{throw Object.assign(Error('finish later'),{code:'DAILY_SOFT_LIMIT_WIND_DOWN',retryAt:beijingDayWindow(r.now()).to});}};
 const result=await r.runNext({kinds:['fixture-cost-work']});assert.equal(result.status,'daily-cost-winding-down');const job=r.store.db.prepare('SELECT status,attempts,payload_json FROM jobs WHERE job_id=?').get(id);assert.equal(job.status,'pending');assert.equal(job.attempts,0);assert.equal(JSON.parse(job.payload_json).scope,'self');
});
