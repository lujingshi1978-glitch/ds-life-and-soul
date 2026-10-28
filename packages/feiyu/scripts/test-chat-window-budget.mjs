import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {chatWindowView} from '../src/chat-window-budget.js';
import {startCompanionGateway} from '../src/companion-gateway.js';
import {DialogueAttention} from '../src/dialogue-attention.js';
import {defaultRuntimeTuning,mergeRuntimeTuning} from '../src/runtime-tuning.js';

test('the latest chat text survives a smaller detached window and a larger budget actually shows more',()=>{
 const rows=Array.from({length:5},(_,n)=>({id:'message-'+n,role:n%2?'assistant':'user',speakerId:'identity-'+n,scope:'desktop:fixture',at:n,text:('第'+n+'条旧到新消息 ').repeat(150)+(n===4?'最新尾部':'')}));
 const before=JSON.stringify(rows);for(const row of rows)Object.freeze(row);Object.freeze(rows);
 const small=chatWindowView(rows,1000),large=chatWindowView(rows,16000);
 assert.ok(JSON.stringify(small).length<=1000);assert.ok(JSON.stringify(large).length<=16000);assert.equal(small.partial,true);assert.ok(large.visibleChars>small.visibleChars);assert.equal(large.partial,false);assert.equal(large.messages.length,rows.length);assert.ok(small.messages.at(-1).text.endsWith('最新尾部'));assert.equal(JSON.stringify(rows),before);
});

test('JSON escaping, emoji and content fields fit the entire budget with explicit original character counts',()=>{
 const text='\\"🙂\n'.repeat(2000)+'新的话题',row={id:'source:完整身份',role:'user',speakerId:'person:完整主体',content:text},v=chatWindowView([row],1000);
 assert.ok(JSON.stringify(v).length<=1000);assert.equal(v.partial,true);assert.equal(v.messages[0].originalChars,[...text].length);assert.ok(v.messages[0].omittedPrefixChars.content>0);assert.ok(v.messages[0].content.endsWith('新的话题'));assert.equal(v.messages[0].id,row.id);assert.equal(v.messages[0].speakerId,row.speakerId);assert.ok(!v.messages[0].content.includes('\ud83d\n'));
 assert.doesNotThrow(()=>JSON.parse(JSON.stringify(v)));
});

test('oversized identity metadata causes whole-message omission and is never cropped into a different identity',()=>{
 const rows=[{id:'older',role:'user',speakerId:'person:earlier',text:'之前完整的内容'},{id:'identity-'+('长'.repeat(3000)),role:'assistant',speakerId:'person:latest',text:'最新一条内容'}],before=JSON.stringify(rows),v=chatWindowView(rows,1000);
 assert.equal(v.partial,true);assert.equal(v.omittedMessages,1);assert.equal(v.messages.length,1);assert.equal(v.messages[0].id,'older');assert.equal(JSON.stringify(rows),before);assert.ok(JSON.stringify(v).length<=1000);
});

test('short and empty windows remain complete, while malformed budgets and source rows fail explicitly',()=>{
 const short=chatWindowView([{role:'user',text:'你好'},{role:'assistant',text:'嗯嗯'}],1000);assert.equal(short.partial,false);assert.equal(short.omittedMessages,0);assert.equal(short.omittedChars,0);
 const empty=chatWindowView([],1000);assert.equal(empty.partial,false);assert.deepEqual(empty.messages,[]);
 for(const budget of [999,NaN,Infinity,'1000'])assert.throws(()=>chatWindowView([],budget),e=>e.code==='INVALID_CHAT_WINDOW_BUDGET');assert.throws(()=>chatWindowView([null],1000),e=>e.code==='INVALID_CHAT_WINDOW_ROW');
});

test('the real desktop HTTP route uses live window/recall settings and preserves SQLite originals and the existing incoming limit',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-window-gateway-'));fs.mkdirSync(path.join(root,'state'));const db=new DatabaseSync(':memory:'),attention=new DialogueAttention(),thoughts=[],recalls=[],archives=[],behaviors=new Set();let tuning=defaultRuntimeTuning();
 const mind={runtime:{runtimeTuning:()=>tuning,store:{db},characterId:'character:window-fixture',observe:()=>({eventId:'fixture-delivery'}),scheduleEncoding(){}},store:{core:()=> '固定角色核心，不由窗口改写'},archive:{put:(...args)=>archives.push(args)},context:()=> '同一角色当前内心',recall:async(scope,options)=>{recalls.push({scope,options});return {items:[]};},beginBehavior:id=>behaviors.add(id),endBehavior:id=>behaviors.delete(id)};
 const gateway=startCompanionGateway({root,mind,attention,owner:'101',ready:()=>true,port:0,think:async input=>{thoughts.push(input);return {data:{reply:'本机夹具答复'},receipt:{disposed:true,transcriptPersisted:false}};}});await once(gateway.server,'listening');
 t.after(async()=>{const close=once(gateway.server,'close');gateway.close();await close;db.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('feiyu-window-gateway-'));fs.rmSync(root,{recursive:true,force:true});});
 for(let n=0;n<20;n++)db.prepare('INSERT INTO companion_chat VALUES(?,?,?,?)').run('seed-'+n,n%2?'assistant':'user',('种子原文'+n+' 🙂\\"').repeat(160),n);
 const snapshot=()=>db.prepare("SELECT * FROM companion_chat WHERE id LIKE 'seed-%' ORDER BY id").all().map(row=>JSON.stringify(row));const before=snapshot();
 const request=async text=>{const r=await fetch('http://127.0.0.1:'+gateway.server.address().port+'/pet/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+gateway.credentials.pet,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:text}]})});const body=await r.json();await nextTurn();assert.equal(r.status,200);assert.equal(body.choices[0].message.content,'本机夹具答复');};
 const window=index=>JSON.parse(thoughts[index].prompt.split('【此窗口近期原文】')[1].split('\n【本轮来信】')[0]);
 tuning=mergeRuntimeTuning(tuning,{text:{liveChatChars:1000},memory:{recallBudgetChars:1200}});await request('第一条本机来信');const small=window(0);assert.ok(JSON.stringify(small).length<=1000);assert.equal(small.partial,true);assert.equal(recalls[0].options.budgetChars,1200);
 tuning=mergeRuntimeTuning(tuning,{text:{liveChatChars:10000},memory:{recallBudgetChars:9000}});await request('新'.repeat(12010));const large=window(1);assert.ok(JSON.stringify(large).length<=10000);assert.ok(large.visibleChars>small.visibleChars);assert.equal(recalls[1].options.budgetChars,9000);assert.deepEqual(snapshot(),before);
 const latest=db.prepare("SELECT text FROM companion_chat WHERE role='user' AND id NOT LIKE 'seed-%' ORDER BY at DESC,rowid DESC LIMIT 1").get();assert.equal(latest.text.length,12000);assert.equal(archives.filter(a=>a[4]?.role==='user').at(-1)[3].length,12000);assert.equal(behaviors.size,0);assert.equal(attention.active,null);assert.ok(thoughts.every(x=>x.core==='固定角色核心，不由窗口改写'));
});
