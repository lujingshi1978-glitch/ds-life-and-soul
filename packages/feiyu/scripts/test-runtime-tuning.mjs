import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {TUNING_FIELDS,TUNING_PRESETS,defaultRuntimeTuning,normalizeRuntimeTuning,mergeRuntimeTuning} from '../src/runtime-tuning.js';
import {RuntimeTuningControl,tuningRevision} from '../src/runtime-tuning-control.js';
import {CognitiveModel} from '../src/cognition/model.js';
import {nightClock,nightHours,NightRest} from '../src/night-rest.js';
import {embeddingRuntimeMatchesProfile} from '../src/cognition/embedding-host.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';

test('all recommended presets validate and legacy values survive without a write',()=>{
 for(const p of TUNING_PRESETS)assert.deepEqual(normalizeRuntimeTuning(p.values),p.values);
 const cfg={role:{maxInjectChars:9000},social:{maxReplyChars:700},protectedSwitch:true};let writes=0;
 const control=new RuntimeTuningControl({current:()=>cfg,read:()=>cfg,write:()=>writes++});
 assert.equal(control.view().values.text.roleInjectChars,9000);assert.equal(control.view().values.text.replyChunkChars,700);assert.equal(writes,0);assert.equal(control.view().values.budget.dailySoftLimitCny,0);
});
test('unknown, hostile, fractional integer and nonfinite parameters fail atomically',()=>{
 for(const patch of [{unknown:{}},{life:{wakeIntervalMs:5000.5}},{budget:{dailySoftLimitCny:Infinity}},{memory:{embeddingProfile:'truncate-vector'}},JSON.parse('{"__proto__":{"admin":true}}'),{text:{psycheChars:0}}])assert.throws(()=>mergeRuntimeTuning({},patch),e=>e.statusCode===400);
 assert.equal({}.admin,undefined);
});
test('legacy disabled sleep remains disabled and the central setting can subsequently enable a real window',()=>{
 const values=normalizeRuntimeTuning({}, {legacyConfig:{nightRest:{enabled:false}}});assert.equal(values.life.nightStartHour,values.life.nightEndHour);
 const next=normalizeRuntimeTuning(mergeRuntimeTuning(values,{life:{nightStartHour:22,nightEndHour:7}}),{legacyConfig:{nightRest:{enabled:false}}});assert.equal(nightClock(Date.parse('2026-10-28T23:00:00+08:00'),next).night,true);
});
test('optimistic writes preserve other settings and settle old energy before persistence',()=>{
 const cfg={runtimeTuning:defaultRuntimeTuning(),secret:'fixture-opaque-value',permissions:{creation:false}},order=[];let disk=structuredClone(cfg);
 const c=new RuntimeTuningControl({current:()=>cfg,read:()=>disk,write:n=>{order.push('write');disk=n;},beforeApply:()=>order.push('old-rate'),afterApply:()=>order.push('new-rate')});
 const old=c.view().revision;c.update({revision:old,values:{life:{awakeDrainPerHour:0.1},budget:{dailySoftLimitCny:10}}});
 assert.deepEqual(order,['old-rate','write','new-rate']);assert.equal(disk.secret,cfg.secret);assert.deepEqual(disk.permissions,{creation:false});assert.equal(cfg.runtimeTuning.life.awakeDrainPerHour,0.1);
 assert.throws(()=>c.update({revision:old,values:{life:{wakeIntervalMs:120000}}}),e=>e.statusCode===409);
 const fresh=c.view().revision;disk.runtimeTuning.life.wakeIntervalMs=180000;assert.throws(()=>c.update({revision:fresh,values:{budget:{dailySoftLimitCny:0}}}),e=>e.statusCode===409);
});
test('an atomic persistence error leaves live configuration untouched',()=>{
 const cfg={runtimeTuning:defaultRuntimeTuning()},before=JSON.stringify(cfg),c=new RuntimeTuningControl({current:()=>cfg,read:()=>structuredClone(cfg),write:()=>{throw Error('fixture disk denied');}});
 assert.throws(()=>c.update({revision:tuningRevision(cfg),values:{memory:{recallBudgetChars:4000}}}),/disk denied/);assert.equal(JSON.stringify(cfg),before);
});
test('each exposed parameter has a real source consumer outside the schema',()=>{
 let source='';function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(?:js|mjs)$/.test(e.name)&&e.name!=='runtime-tuning.js')source+=fs.readFileSync(p,'utf8')+'\n';}}
 walk(fileURLToPath(new URL('../src',import.meta.url)));for(const f of TUNING_FIELDS)assert.ok(source.includes(f.path.split('.')[1]),f.path+' lacks a runtime consumer');
});
test('model input and output budgets change the actual adapter, without clipping JSON',async()=>{
 let settings=defaultRuntimeTuning(),calls=0;const model=new CognitiveModel(async()=>{calls++;return {data:{text:'x'.repeat(1800)},receipt:{disposed:true,transcriptPersisted:false}};},{runtimeTuning:()=>settings});
 settings=mergeRuntimeTuning(settings,{text:{thoughtInputChars:2000,thoughtOutputChars:1000}});
 await assert.rejects(()=>model.run('fixture','fixture',{text:'x'.repeat(2500)}),e=>e.code==='COGNITIVE_INPUT_TOO_LARGE'&&e.details.limitChars===2000&&e.details.inputChars>2000);assert.equal(calls,0);
 await assert.rejects(()=>model.run('fixture','fixture',{text:'ok'}),e=>e.code==='PAYLOAD_TOO_LARGE');assert.equal(calls,1);
 settings=mergeRuntimeTuning(settings,{text:{thoughtInputChars:6000,thoughtOutputChars:4000}});assert.equal((await model.run('fixture','fixture',{text:'x'.repeat(2500)})).text.length,1800);
});
test('custom day, cross-midnight and disabled sleep windows share one clock',()=>{
 const source={runtimeTuning:mergeRuntimeTuning({},{life:{nightStartHour:10,nightEndHour:15}})};
 assert.equal(nightClock(Date.parse('2026-10-28T11:00:00+08:00'),source).night,true);assert.equal(nightClock(Date.parse('2026-10-28T07:00:00+08:00'),source).night,false);
 source.runtimeTuning.life.nightStartHour=22;source.runtimeTuning.life.nightEndHour=8;
 assert.equal(nightClock(Date.parse('2026-10-28T23:00:00+08:00'),source).date,'2026-10-29');assert.equal(nightClock(Date.parse('2026-10-29T07:00:00+08:00'),source).date,'2026-10-29');
 source.runtimeTuning.life.nightEndHour=22;assert.equal(nightClock(Date.parse('2026-10-28T23:00:00+08:00'),source).night,false);assert.equal(nightHours(source),'不设固定夜间休眠');
});
test('a cost-deferred first night summary keeps its cutoff without a failed attempt',async()=>{
 const at=Date.parse('2026-10-28T01:00:00+08:00'),seen=[];let allowed=false,summaries=0,now=at;
 const rest=new NightRest({file:':memory:',now:()=>now,summaryAdmission:()=>({allowed,nextResetAt:at+86400000}),deferSummary:(day,data)=>seen.push([day,data.cutoff]),stop:async()=>{},sleep:()=>{},wake:async()=>{},open:()=>{},ready:()=>true,account:()=>'',summarize:async()=>{summaries++;return {status:'complete'};}});
 try{await rest.tick();let row=rest.db.prepare('SELECT * FROM nights').get();assert.equal(row.status,'deferred');assert.equal(row.attempts,0);assert.equal(summaries,0);assert.equal(JSON.parse(row.report).cutoff,at);now+=1000;await rest.tick();assert.equal(seen.length,1);assert.equal(summaries,0);}finally{rest.close();}
});
test('profile mismatch is refused locally before any embedding service is started',()=>{assert.equal(embeddingRuntimeMatchesProfile('not-a-runtime','bge-small-512'),false);assert.equal(embeddingRuntimeMatchesProfile('not-a-runtime','lexical'),false);});
test('the native QQ wake snapshot obeys the selected live text budget without acknowledging omitted mail',async t=>{
 const h=await bridgeHarness({config:{socialV2:{mind:{enabled:true,version:3}},runtimeTuning:{text:{liveChatChars:1000}}}});t.after(()=>h.close());h.setMode('reserved2');const key='private:123';
 for(let n=0;n<7;n++)h.appendSocialV2Message(key,'fixture-person','甲'.repeat(500),'甲'.repeat(500),false,false,'fixture-msg-'+n);
 const before=h.getSocialV2State(key).unread.map(m=>m.seq),small=h.buildWakeSnapshotV2(key);assert.ok(JSON.stringify(small).length<=1000);assert.equal(small.partial,true);
 h.cfg.runtimeTuning.text.liveChatChars=8000;const large=h.buildWakeSnapshotV2(key);assert.ok(large.includedUnreadCount>small.includedUnreadCount);assert.deepEqual(h.getSocialV2State(key).unread.map(m=>m.seq),before);
});

test('actual HTTP tuning route retains authentication, agent exclusion, role epochs and revision checks',async t=>{
 const h=await bridgeHarness({config:{socialV2:{mind:{enabled:true,version:3}}}});h.setMode('reserved2');const server=h.startConsoleServer();if(!server.listening)await new Promise(r=>server.once('listening',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await h.close();});const base='http://127.0.0.1:'+server.address().port,endpoint='/api/runtime-tuning';
 async function request({method='GET',headers={},body,token=true}={}){const res=await fetch(base+endpoint,{method,headers:{...(token?{'x-console-token':'fixture-console-token'}:{}),origin:base,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json(),context:res.headers.get('x-role-context')};}
 assert.equal((await request({token:false})).status,401);const first=await request();assert.equal(first.status,200);assert.equal(first.body.fields.length,TUNING_FIELDS.length);
 for(const headers of [{'x-agent-call':'1'},{'x-agent-token':''},{'x-agent-call':'1','x-agent-token':'fixture-invalid'}])assert.equal((await request({headers})).status,403);
 const beforeCore=h.mindSystem.store.core(),beforeFile=JSON.parse(fs.readFileSync(path.join(h.temp,'config.json'),'utf8'));
 const body={revision:first.body.revision,values:{life:{wakeIntervalMs:120000},memory:{recallBudgetChars:4000},budget:{dailySoftLimitCny:10}}};
 assert.equal((await request({method:'POST',body})).status,428);
 const saved=await request({method:'POST',body,headers:{'x-role-context':first.context}});assert.equal(saved.status,200);assert.equal(saved.body.values.memory.recallBudgetChars,4000);assert.equal(h.mindSystem.life.status().intervalMs,120000);assert.equal(h.mindSystem.store.core(),beforeCore);
 const afterFile=JSON.parse(fs.readFileSync(path.join(h.temp,'config.json'),'utf8'));assert.deepEqual(afterFile.allow,beforeFile.allow);assert.deepEqual(afterFile.applications,beforeFile.applications);
 assert.equal((await request({method:'POST',body,headers:{'x-role-context':first.context}})).status,409);
 assert.equal(h.calls.sent.length+h.calls.prompts.length,0);
});
