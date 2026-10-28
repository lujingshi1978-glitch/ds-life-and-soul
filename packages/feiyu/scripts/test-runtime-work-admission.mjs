import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {AppIntegrations} from '../src/app-integrations.js';
import {DailyCostBudget} from '../src/daily-cost-budget.js';
import {defaultRuntimeTuning} from '../src/runtime-tuning.js';
import {withAdminEnergy} from '../src/energy-context.js';
import {Birthdays} from '../src/birthdays.js';
import {OccasionObservations} from '../src/occasion-observations.js';

const ok=value=>({result:{ok:true,value}}),scope='private:100001';
function taskFixture(t,{stage={},admission}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-work-cost-'));fs.mkdirSync(path.join(root,'state'));const settings=defaultRuntimeTuning(),usage={knownCny:0},calls=[];settings.budget.dailySoftLimitCny=1;
 const daily=new DailyCostBudget({source:settings,readSpending:()=>({currency:'CNY',...usage})}),host={profileId:'fixture-profile',characterId:'character:fixture',roleEpoch:1,activationEpoch:1,origin:'operator',requestId:'fixture-request'};
 let sequence=0;
 const api={events:{follow:id=>calls.push(['follow',id])},sessions:{create:async args=>{calls.push(['create',args]);await stage.create?.({usage,calls});return ok({sessionId:'fixture-empty-'+(++sequence),agentPreset:args.agentPreset});},selectModel:async args=>{calls.push(['model',args]);await stage.model?.({usage,calls});return ok({});},prompt:async args=>{calls.push(['prompt',args]);await stage.prompt?.({usage,calls});return ok({accepted:true,turn:1});}},callUnary:async(method,args)=>{calls.push([method,args]);if(method==='commands/execute')return ok({result:{kind:'success'}});return ok({values:{permissions:{currentValue:'workspace-write'}}});},stopSessionWork:async id=>{calls.push(['stop',id]);return {};}};
 const creator={prepare:async cwd=>{calls.push(['prepare',cwd]);fs.mkdirSync(cwd,{recursive:true});await stage.prepare?.({usage,calls});},bindSession:()=>calls.push(['bind']),revoke:()=>calls.push(['revoke']),describe:()=>({boundary:'windows-lpac-private-workspace'})};
 const apps=new AppIntegrations({root,profileDir:root,cfg:{ownerQQ:'100001',sessionCwd:root},api,creatorSandbox:creator,getTaskHost:()=>({...host}),assertWorkAdmission:admission??(info=>{calls.push(['admit',info.phase]);return daily.assertStart();})});apps.update({complexTasks:true,creationEnabled:true});
 t.after(async()=>{await apps.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('feiyu-work-cost-'));fs.rmSync(root,{recursive:true,force:true});});
 return {apps,usage,daily,calls,root,host,count:name=>calls.filter(([kind])=>kind===name).length};
}

test('an already-reached cost limit rejects both new work and creation before any task, sandbox, session, permission or prompt side effect',async t=>{
 for(const creation of [false,true])await t.test(creation?'creation':'work',async t=>{const f=taskFixture(t);f.usage.knownCny=1;
  await assert.rejects(withAdminEnergy(()=>creation?f.apps.createCapability(scope,'fixture draft',{guard:()=>{},assertWorkAdmission:()=>true}):f.apps.startTask(scope,'fixture work',{guard:()=>{},assertWorkAdmission:()=>true})),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});
  for(const name of ['prepare','create','bind','commands/execute','model','prompt','stop'])assert.equal(f.count(name),0,name);assert.equal(f.apps.tasks().length,0);assert.equal(fs.existsSync(path.join(f.root,'work','creations')),false);
 });
});

test('host admission fails closed for a false verdict or an asynchronous callback',async t=>{
 for(const admission of [()=>({allowed:false}),()=>Promise.resolve({allowed:true})])await t.test('host callback',async t=>{const f=taskFixture(t,{admission});await assert.rejects(f.apps.startTask(scope,'fixture work'),error=>['DAILY_SOFT_LIMIT_WIND_DOWN','WORK_ADMISSION_MUST_BE_SYNCHRONOUS'].includes(error.code));assert.equal(f.count('create'),0);assert.equal(f.apps.tasks().length,0);});
});

test('a cost change while preparing the sandbox prevents session creation and preserves a non-executed deferred task',async t=>{
 const f=taskFixture(t,{stage:{prepare:({usage})=>{usage.knownCny=1;}}});await assert.rejects(f.apps.createCapability(scope,'fixture draft'),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});assert.equal(f.count('prepare'),1);assert.equal(f.count('create'),0);assert.equal(f.count('commands/execute'),0);assert.equal(f.count('prompt'),0);assert.equal(f.apps.tasks()[0].status,'deferred');assert.equal(f.apps.tasks()[0].phase,'daily-cost-deferred');
});

test('a cost change during empty-session creation stops only that empty session before pinning, selecting or prompting',async t=>{
 for(const creation of [false,true])await t.test(creation?'creation':'work',async t=>{const f=taskFixture(t,{stage:{create:({usage})=>{usage.knownCny=1;}}});await assert.rejects(creation?f.apps.createCapability(scope,'fixture draft'):f.apps.startTask(scope,'fixture work'),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});
  assert.equal(f.count('create'),1);assert.equal(f.count('bind'),0);assert.equal(f.count('commands/execute'),0);assert.equal(f.count('model'),0);assert.equal(f.count('prompt'),0);assert.equal(f.count('stop'),1);assert.equal(f.apps.tasks()[0].status,'deferred');
  const row=f.apps.tasks()[0];f.apps.observe(row.session_id,{type:'turn/start',seq:10,data:{turn:1}});f.apps.observe(row.session_id,{type:'assistant/message',seq:11,data:{turn:1,message:{content:[{type:'text',text:'must not revive'}]}}});assert.equal(f.apps.tasks()[0].status,'deferred');assert.equal(f.apps.taskResult(scope,row.id).result,'');
 });
});

test('a cost change during model selection blocks the expensive prompt while retaining the original deferred request',async t=>{
 const f=taskFixture(t,{stage:{model:({usage})=>{usage.knownCny=1;}}});await assert.rejects(f.apps.startTask(scope,'fixture work'),{code:'DAILY_SOFT_LIMIT_WIND_DOWN'});assert.equal(f.count('create'),1);assert.equal(f.count('model'),1);assert.equal(f.count('prompt'),0);assert.equal(f.count('stop'),1);const row=f.apps.tasks()[0];assert.equal(row.status,'deferred');assert.equal(f.apps.db.prepare('SELECT prompt FROM app_tasks WHERE id=?').get(row.id).prompt,'fixture work');
});

test('a prompt already submitted before the cap is not killed, and checking that request again creates no new work',async t=>{
 const f=taskFixture(t,{stage:{prompt:({usage})=>{usage.knownCny=1;}}});const task=await f.apps.startTask(scope,'fixture work');assert.equal(task.status,'running');assert.equal(f.count('prompt'),1);assert.equal(f.count('stop'),0);const again=await f.apps.startTask(scope,'fixture work');assert.equal(again.id,task.id);assert.equal(f.count('create'),1);assert.equal(f.count('prompt'),1);assert.equal(f.count('stop'),0);
});

function calendarFixture(t,{at='2026-10-28T07:30:00+08:00',runtimeTuning=true,publish}={}){
 const db=new DatabaseSync(':memory:'),settings=defaultRuntimeTuning(),clock={at:Date.parse(at)},calls={observe:0,compose:0,send:0,publish:0};settings.life.nightStartHour=22;settings.life.nightEndHour=7;
 const options={db,now:()=>clock.at,...(runtimeTuning?{runtimeTuning:()=>settings}:{}),ready:()=>true,allowed:()=>true,observe:async rows=>{calls.observe+=rows.length;return {observed:rows.length};},compose:async()=>{calls.compose++;return 'fixture greeting';},send:async()=>{calls.send++;}};
 const birthdays=new Birthdays(options);birthdays.set({qq:'100001',monthDay:'10-28'});const holidays={directory:{settings:()=>[],contacts:()=>[]}};
 const observer=new OccasionObservations({...options,birthdays,holidays,profileId:'fixture-role',characterId:'character:fixture',publish:async(source,event)=>{calls.publish++;await publish?.({clock,settings,calls,source,event});return {eventId:'event:'+calls.publish,sourceId:'source:'+calls.publish,revision:1};}});t.after(()=>db.close());return {db,settings,clock,calls,birthdays,observer};
}

test('calendar observation follows the shared night window rather than a hidden 08:00 threshold and never forces a greeting',async t=>{
 const f=calendarFixture(t);assert.equal((await f.birthdays.tick()).observed,1);assert.equal((await f.observer.tick()).observed,1);assert.equal(f.calls.compose,0);assert.equal(f.calls.send,0);
 f.settings.life.nightStartHour=10;f.settings.life.nightEndHour=15;f.clock.at=Date.parse('2026-10-28T11:00:00+08:00');f.birthdays.set({qq:'100002',monthDay:'10-28'});assert.equal((await f.birthdays.tick()).status,'blocked');assert.equal((await f.observer.tick()).status,'blocked');assert.equal(f.calls.publish,1);
 f.clock.at=Date.parse('2026-10-28T15:00:00+08:00');assert.equal((await f.observer.tick()).observed,1);assert.equal(f.calls.publish,2);assert.equal(f.calls.send,0);
});

test('an omitted calendar tuning callback keeps the original midnight-to-eight default',async t=>{
 const f=calendarFixture(t,{runtimeTuning:false});assert.equal((await f.birthdays.tick()).status,'blocked');assert.equal((await f.observer.tick()).status,'blocked');await f.birthdays.greetManually({qq:'100001',authority:'user',currentRequest:true,requestId:'fixture'});assert.equal(f.calls.compose,0);assert.equal(f.calls.send,0);f.clock.at=Date.parse('2026-10-28T08:00:00+08:00');assert.equal((await f.observer.tick()).observed,1);
});

test('a newly configured sleep window is rechecked after manual composition and between automatic observations',async t=>{
 const f=calendarFixture(t);f.birthdays.compose=async()=>{f.calls.compose++;f.settings.life.nightStartHour=10;f.settings.life.nightEndHour=15;f.clock.at=Date.parse('2026-10-28T11:00:00+08:00');return 'fixture greeting';};await f.birthdays.greetManually({qq:'100001',authority:'user',currentRequest:true,requestId:'fixture'});assert.equal(f.calls.compose,1);assert.equal(f.calls.send,0);assert.equal(f.db.prepare('SELECT count(*) n FROM birthday_sends').get().n,0);
 const second=calendarFixture(t,{at:'2026-10-28T09:30:00+08:00',publish:({clock,settings})=>{settings.life.nightStartHour=10;settings.life.nightEndHour=15;clock.at=Date.parse('2026-10-28T11:00:00+08:00');}});second.birthdays.set({qq:'100002',monthDay:'10-28'});assert.equal((await second.observer.tick()).observed,1);assert.equal(second.calls.publish,1);assert.equal(second.db.prepare("SELECT count(*) n FROM occasion_observations WHERE status='pending'").get().n,1);assert.equal(second.calls.send,0);
});
