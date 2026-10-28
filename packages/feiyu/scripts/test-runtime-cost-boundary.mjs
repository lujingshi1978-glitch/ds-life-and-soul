import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DailyCostBudget,beijingDayWindow} from '../src/daily-cost-budget.js';
import {defaultRuntimeTuning} from '../src/runtime-tuning.js';
import {accountThought,foregroundThought,withThoughtReservation} from '../src/cognition/thought-accounting.js';
import {withEnergyContext} from '../src/energy-context.js';
import {NightRest,nightClock} from '../src/night-rest.js';
import {nightWorkCutoff,LiveCognition} from '../src/cognition/live.js';
import {ContactStore} from '../src/contact-store.js';

const instant=value=>Date.parse(value+'+08:00');
const at=instant('2026-10-28T13:00:00');
const input={core:'fixture core',prompt:'fixture input'};
function budgetFixture(){
 const clock={at},settings=defaultRuntimeTuning(),usage={knownCny:.9,unknownCost:false,unknownSamples:0};settings.budget.dailySoftLimitCny=1;settings.budget.windDownGraceMs=1000;
 const daily=new DailyCostBudget({source:settings,now:()=>clock.at,readSpending:()=>({currency:'CNY',...usage})});
 const calls={invoke:0,reserve:0,receipt:0,adjust:0},budget={reserve(){calls.reserve++;return {hour:0};},receipt(){calls.receipt++;},adjustInputChars(){calls.adjust++;}};
 const invoke=async()=>{calls.invoke++;usage.knownCny+=.2;return {data:{text:'fixture'},receipt:{usage:{outputTokens:1},disposed:true,transcriptPersisted:false}};};
 return {clock,settings,usage,daily,calls,budget,invoke};
}

test('actual thought admission lets an already-returning call settle, records it, and rejects the next new background call',async()=>{
 const f=budgetFixture();await accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily});assert.equal(f.calls.invoke,1);assert.equal(f.calls.reserve,1);assert.equal(f.calls.receipt,1);assert.ok(f.usage.knownCny>1);
 await assert.rejects(accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily}),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});assert.equal(f.calls.invoke,1);assert.equal(f.calls.reserve,1);
});

test('trusted foreground ALS keeps replies available and charged while input text cannot grant foreground or finishing status',async()=>{
 const f=budgetFixture();f.usage.knownCny=1;f.daily.status();
 await assert.rejects(accountThought(null,{...input,foreground:true,finishCurrent:true,costStartedAt:at-1},f.invoke,{dailyCostBudget:f.daily}),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});
 await foregroundThought(()=>accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily}));assert.equal(f.calls.invoke,1);assert.ok(f.usage.knownCny>1);assert.equal(f.calls.reserve,0);
 await assert.rejects(accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily}),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});assert.equal(f.calls.invoke,1);
});

test('administrator energy exemption, finishCurrent without a timestamp and reservation reuse cannot bypass the daily cost boundary',async()=>{
 const f=budgetFixture();f.usage.knownCny=1;f.daily.status();
 for(const context of [{exempt:true},{exempt:true,finishCurrent:true},{finishCurrent:true,costStartedAt:at+1}])await assert.rejects(withEnergyContext(context,()=>accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily})),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});
 await assert.rejects(withThoughtReservation(()=>accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily}),{reserved:true}),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});assert.equal(f.calls.invoke,0);
});

test('host-timestamped bounded work may finish within grace, cannot request another continuation after it, and no in-flight reply is aborted',async()=>{
 const f=budgetFixture();f.usage.knownCny=1;f.daily.status();let finish;
 const result=withEnergyContext({finishCurrent:true,costStartedAt:at-1},()=>accountThought(f.budget,input,()=>new Promise(resolve=>{f.calls.invoke++;finish=resolve;}),{dailyCostBudget:f.daily}));
 f.clock.at+=1001;finish({data:{done:true},receipt:{disposed:true,transcriptPersisted:false}});assert.deepEqual((await result).data,{done:true});assert.equal(f.calls.invoke,1);
 await assert.rejects(withEnergyContext({finishCurrent:true,costStartedAt:at-1},()=>accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily})),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});assert.equal(f.calls.invoke,1);
});

test('foreground admission stays isolated across concurrent async tasks and midnight resumes ordinary background calls',async()=>{
 const f=budgetFixture();f.usage.knownCny=1;f.daily.status();
 const results=await Promise.allSettled([foregroundThought(async()=>{await Promise.resolve();return accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily});}),(async()=>{await Promise.resolve();return accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily});})()]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(f.calls.invoke,1);
 f.clock.at=beijingDayWindow(f.clock.at).to;f.usage.knownCny=0;f.usage.unknownCost=true;f.usage.unknownSamples=1;await accountThought(f.budget,input,f.invoke,{dailyCostBudget:f.daily});assert.equal(f.calls.invoke,2);assert.equal(f.daily.status().unknownCost,true);
});

function nightFixture(t,{clockAt=instant('2026-10-28T11:00:00'),start=10,end=15,cap=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-cost-night-')),settings=defaultRuntimeTuning(),clock={at:clockAt},events=[],processed=[],deferred=[];settings.life.nightStartHour=start;settings.life.nightEndHour=end;
 let capped=cap;const d={file:path.join(dir,'night.sqlite'),runtimeTuning:()=>settings,now:()=>clock.at,account:()=> '9',allowed:()=>true,capacity:()=>true,ready:()=>true,idempotentSummary:true,summaryReady:()=>!capped,summaryAdmission:()=>({allowed:!capped,nextResetAt:beijingDayWindow(clock.at).to}),deferSummary:(day,options)=>deferred.push({day,...options}),stop:async()=>events.push('stop'),summarize:async day=>{events.push('summary:'+day);return {summary:'fixture summary'};},sleep:()=>events.push('sleep'),wake:async()=>events.push('wake'),open:()=>events.push('open'),ingest:async(kind,peer,event)=>{processed.push(event.message_id);return true;}};
 const rest=new NightRest(d);t.after(()=>{rest.close();fs.rmSync(dir,{recursive:true,force:true});});return {rest,d,clock,settings,events,processed,deferred,setCap:value=>capped=value};
}

test('the actual night inbox uses configured daytime sleep hours and reopening the window drains messages once',async t=>{
 const f=nightFixture(t);assert.equal(nightClock(f.clock.at,{runtimeTuning:()=>f.settings}).night,true);await f.rest.tick();f.rest.buffer('private',7,{self_id:9,message_id:100,message:[{type:'text',data:{text:'fixture'}}]});assert.equal(f.rest.status().blocked,true);assert.equal(f.rest.status().hours,'10:00–15:00');assert.deepEqual(f.processed,[]);
 f.clock.at=instant('2026-10-28T15:00:00');await f.rest.tick();assert.equal(f.rest.status().blocked,false);assert.deepEqual(f.processed,[100]);await f.rest.tick();assert.deepEqual(f.processed,[100]);assert.equal(f.events.filter(x=>x==='summary:2026-10-28').length,1);
});

test('a cross-midnight night has one wake-day identity, and disabling it dynamically wakes the actual rest controller',async t=>{
 const f=nightFixture(t,{clockAt:instant('2026-10-28T23:00:00'),start:22,end:7});assert.equal(nightClock(f.clock.at,{runtimeTuning:()=>f.settings}).date,'2026-10-29');await f.rest.tick();f.clock.at=instant('2026-10-29T01:00:00');await f.rest.tick();assert.equal(f.events.filter(x=>x.startsWith('summary:')).length,1);assert.equal(f.rest.status().blocked,true);
 f.settings.life.nightEndHour=22;await f.rest.tick();assert.equal(f.rest.status().blocked,false);assert.equal(f.rest.status().hours,'不设固定夜间休眠');assert.equal(f.events.filter(x=>x==='wake').length,1);
});

test('cost-limited first night creates a durable deferred summary with frozen cutoff and no model attempt',async t=>{
 const f=nightFixture(t,{cap:true});await f.rest.tick();await f.rest.tick();const row=f.rest.status().lastSummary;assert.equal(row.status,'deferred');assert.equal(row.attempts,0);assert.equal(row.retry_at,beijingDayWindow(f.clock.at).to);assert.equal(f.events.some(x=>x.startsWith('summary:')),false);assert.equal(f.deferred[0].cutoff,f.clock.at);assert.equal(f.rest.status().phase,'sleeping');
});

test('new current night freezes its real entry, preserved cutoffs remain unchanged, and missing historical cutoffs never use current-day new events',()=>{
 const settings=defaultRuntimeTuning();settings.life.nightStartHour=10;settings.life.nightEndHour=15;let now=instant('2026-10-28T11:00:00'),meta=null,known=null;
 const runtime={runtimeTuning:()=>settings,now:()=>now,inner:{meta:()=>meta},store:{manifest:()=>({role_epoch:1}),db:{prepare:()=>({get:()=>known})}}};assert.equal(nightWorkCutoff(runtime,'2026-10-28'),now);
 meta={cutoff:instant('2026-10-28T10:07:00'),roleEpoch:1};now=instant('2026-10-28T16:00:00');assert.equal(nightWorkCutoff(runtime,'2026-10-28'),meta.cutoff);known={cutoff:instant('2026-10-28T10:03:00')};assert.equal(nightWorkCutoff(runtime,'2026-10-28'),known.cutoff);
 meta=null;known=null;assert.equal(nightWorkCutoff(runtime,'2026-10-27'),instant('2026-10-27T15:00:00'));assert.throws(()=>nightWorkCutoff(runtime,'2026-10-30'),{code:'INVALID_NIGHT_DAY'});
});

test('real V3 summary freezes the chosen sleep-entry scope without a model or an eight-o-clock fallback',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-night-scope-')),legacy=path.join(dir,'legacy');fs.mkdirSync(legacy);const contacts=new ContactStore(path.join(legacy,'contacts.sqlite')),settings=defaultRuntimeTuning(),clock={at:instant('2026-10-28T11:00:00')};settings.life.nightStartHour=10;settings.life.nightEndHour=15;
 const owner=new LiveCognition({root:path.join(dir,'mind'),profile:{id:'night-cutoff-fixture',name:'fixture',dir:legacy},contacts,core:'我想认识世界。',innerVersion:3,now:()=>clock.at,runtimeTuning:()=>settings,think:async()=>{throw Error('Unexpected real model');}});t.after(async()=>{await owner.close();contacts.close();fs.rmSync(dir,{recursive:true,force:true});});owner.runtime.runMaintenance=async()=>[{status:'fixture-no-model'}];
 await owner.v3NightSummary('2026-10-28');const meta=owner.runtime.inner.meta('night-work:2026-10-28');assert.equal(meta.cutoff,clock.at);clock.at=instant('2026-10-28T16:00:00');await owner.v3NightSummary('2026-10-28');assert.equal(owner.runtime.inner.meta('night-work:2026-10-28').cutoff,meta.cutoff);assert.equal(owner.runtime.model.receipts.length,0);
});
