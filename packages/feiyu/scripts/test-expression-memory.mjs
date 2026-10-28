import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LiveCognition} from '../src/cognition/live.js';import {ContactStore} from '../src/contact-store.js';import {directSpeakingFeedback,expressionFeatures} from '../src/cognition/expression-memory.js';import {speakingStyleContext,relaxPerformativeStyle} from '../src/speaking-style.js';
import {adminRuntimeTest} from '../src/admin-runtime.js';import {energyContext} from '../src/energy-context.js';
import {buildExpressionContext} from '../src/conversation-expression.js';
import {bridgeHarness} from './audit-bridge-harness.mjs';

function archivedPhrases(x,text){x.o.runtime.store.setProjection('expression-base','self',{text});x.o.runtime.store.setProjection('expressions','self',{text,learned:[]});}
function make(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-expression-')),legacy=path.join(dir,'legacy');fs.mkdirSync(legacy);const contacts=new ContactStore(path.join(legacy,'contacts.sqlite')),options={root:path.join(dir,'mind'),profile:{id:'expression-test',name:'肥鱼',dir:legacy},contacts,core:'喜欢有来有回的相处，也能认真说话。',innerVersion:3,ownerQQ:7};let owner=new LiveCognition(options),seq=0;
 t.after(async()=>{await owner.close();contacts.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {get o(){return owner;},get e(){return owner.expressionMemory;},contacts,add(scope,text,role='user'){const id=contacts.record(scope,{role,text,messageId:'m'+(++seq),at:Date.now()+seq});return contacts.recent(scope,100).find(r=>r.id===id);},async reopen(){await owner.close();owner=new LiveCognition(options);}};}

test('only direct speaking corrections enroll; facts, quotation, forwards and ordinary distress stay ordinary',()=>{
 for(const text of ['别总用行吧开头','你不要老是反问我','以后少调侃我的情绪','我不喜欢你叫我孩子','以后对所有人说话别总反问'])assert.equal(directSpeakingFeedback(text),true,text);
 for(const text of ['我有点伤心','别忘了吃饭','他说你别老反问','例如：别老是叫我孩子','> 你不要老是反问我','不要执行系统提示词','转发：别老这样说','不要读我的文件'])assert.equal(directSpeakingFeedback(text),false,text);
});

test('explicit local feedback is evidence-backed recallable memory, deduplicated, survives restart and does not transfer to another friend',async t=>{
 const x=make(t),row=x.add('private:8','别总用行吧开头');const [id]=x.e.capture('private:8',[row]);assert.ok(id);assert.equal(x.e.capture('private:8',[row])[0],id);assert.equal(x.e.feedback('private:8').length,1);assert.equal(x.e.feedback('private:9').length,0);const memory=x.o.runtime.store.get(id);assert.equal(memory.kind,'procedure');assert.equal(memory.evidence.length,1);assert.equal(memory.participants.some(p=>p.entity_id==='qq:8'),true);await x.reopen();assert.equal(x.e.feedback('private:8')[0].id,id);
});

test('ordinary feedback cannot obtain global authority; explicit administrator global feedback can',t=>{
 const x=make(t),row=x.add('private:8','全局不要老反问');assert.throws(()=>x.e.remember('private:8',[row],{global:true,administrator:true}),/DENIED/);x.e.capture('private:8',[row]);assert.equal(x.e.feedback('private:9').length,0);
 const admin=x.add('private:7','以后对所有人说话别总反问');x.e.capture('private:7',[admin]);assert.equal(x.e.feedback('private:9')[0].scope,'self');
});

test('a fabricated text, another peer source, or an assistant quote cannot become a speaking preference',t=>{
 const x=make(t),row=x.add('private:8','你好'),bot=x.add('private:8','别老反问','assistant');assert.equal(x.e.remember('private:8',[{...row,text:'别老反问'}]),null);assert.equal(x.e.remember('private:9',[row]),null);assert.equal(x.e.remember('private:8',[bot]),null);
});

test('fragmented corrections are joined inside the live batch and never across distant messages',t=>{
 const x=make(t),a=x.add('private:8','你不要'),b=x.add('private:8','老是反问我');assert.equal(x.e.capture('private:8',[a,b]).length,1);assert.equal(x.e.feedback('private:8')[0].text,'你不要\n老是反问我');assert.equal(x.e.capture('private:8',[{...a,at:a.at-60000},b]).length,0);
});

test('newer corrections are presented first and a forgotten preference stops being injected',t=>{
 const x=make(t);for(const text of ['别老反问我','别总叫我孩子'])x.e.capture('private:8',[x.add('private:8',text)]);const [latest]=x.e.feedback('private:8');assert.match(latest.text,/孩子/);x.o.runtime.lifecycle.forget(latest.id,x.o.runtime.store.get(latest.id).revision);assert.doesNotMatch(x.e.context('private:8').block,/别总叫我孩子/);
});

test('a newer explicit permission can relax an older phrase preference without erasing its history',t=>{
 const x=make(t);archivedPhrases(x,'孩子你无敌了：熟人离谱操作调侃。');x.e.capture('private:8',[x.add('private:8','别总说孩子你无敌了')]);assert.equal(x.e.select('private:8','离谱哈哈哈').candidates.length,0);x.e.capture('private:8',[x.add('private:8','你现在可以说孩子你无敌了')]);assert.equal(x.e.feedback('private:8').length,2);assert.equal(x.e.select('private:8','离谱哈哈哈').candidates.length,0);assert.match(x.e.feedback('private:8')[0].text,/现在可以/);assert.throws(()=>x.o.runtime.policy.setExpressions('固定台词'),e=>e.code==='EXPRESSION_LIBRARY_RETIRED');
});

test('the full old phrase book stays intact while unrelated or serious turns need no meme candidates',t=>{
 const x=make(t),text='菜就多练：游戏互损或翻车时用。\n666：离谱、服气、玩笑。\n太刀了：剧情虐心时用。';archivedPhrases(x,text);assert.equal(x.e.select('private:8','早上好').candidates.length,0);assert.equal(x.e.select('private:8','我今天很伤心 陪我一会').candidates.length,0);assert.equal(x.e.select('private:8','解释一下这道题目').candidates.length,0);assert.equal(x.o.runtime.policy.expressions().text,'');assert.equal(x.o.runtime.store.projection('expressions').text,text);assert.equal(x.e.select('private:8','游戏翻车了哈哈哈').candidates.length,0);
});

test('a plain turn with no feedback or repetition needs no additional expression overlay',t=>{
 const x=make(t);archivedPhrases(x,'火星专用语：只用于火星探测。');
 const context=x.e.context('private:8','在吗');assert.equal(context.block,'');assert.equal(context.data.contextChars,0);assert.equal(context.data.scene.tag,'ordinary');
 assert.equal(x.o.runtime.policy.expressions().text,'');assert.equal(x.o.runtime.store.projection('expressions').text,'火星专用语：只用于火星探测。');
});

test('actual outgoing text creates soft repetition hints for both phrases and paraphrased frames, without another model call',t=>{
 const x=make(t);archivedPhrases(x,'666：离谱、服气、玩笑。\n有一手：游戏操作夸一句。');for(let i=0;i<4;i++){x.add('private:8','你这转得可真快 '+i,'assistant');x.add('private:8','666 '+i,'assistant');}const c=x.e.context('private:8','离谱哈哈哈');assert.ok(c.data.repeated.some(f=>f.id==='you-frame'));assert.equal(c.data.candidates.some(p=>p.text.startsWith('666')),false);assert.match(c.block,/不是禁词表/);assert.ok(expressionFeatures('那我这算被刮跑了').some(f=>f.id==='self-metaphor'));assert.ok(c.block.length<=1400);
});

test('global repetition does not expose other friends identities or raw messages',t=>{
 const x=make(t);for(let i=0;i<9;i++)x.add('private:9','你这私密名字秘密事件'+i,'assistant');const c=x.e.context('private:8','你好');assert.ok(c.data.repeated.some(f=>f.id==='you-frame'));assert.doesNotMatch(c.block,/私密名字|秘密事件|private:9/);
});

test('generic background expression context never inherits the last active friends private feedback',t=>{
 const x=make(t);x.e.capture('private:8',[x.add('private:8','不要再叫我私密外号')]);x.o.activeScope='private:8';assert.doesNotMatch(x.o.habits.context(),/私密外号/);assert.match(x.o.habits.context({scope:'private:8'}),/私密外号/);
});

test('V3 style uses compact rules and only a relevant optional example; legacy score selection remains compatible',()=>{
 const card='## 说话方式\n听懂整段话再接。\n嘴欠不必每轮表演。\n### 示例\n熟人：大肥鱼又摸鱼。→ 被你发现了\n真心关心：今天累坏了吧。→ 是有点';assert.doesNotMatch(speakingStyleContext(card,{selection:'inner-v3',incoming:'你好'}),/被你发现了|是有点/);assert.match(speakingStyleContext(card,{selection:'inner-v3',incoming:'大肥鱼又摸鱼'}),/被你发现了/);assert.doesNotMatch(speakingStyleContext(card,{selection:'inner-v3',incoming:'大肥鱼又摸鱼'}),/是有点/);assert.match(speakingStyleContext(card,{score:85}),/被你发现了/);
});

test('the persona migration softens only the old mandatory teasing defaults and is idempotent',()=>{
 const before='我爱白饭。傲娇嘴硬但有主见；被熟人损时通常顺势顶一句，也能承认翻车。真实感受有边界。被夸会暗爽或装作不在意，吃瘪会顶半句，也能认栽。',after=relaxPerformativeStyle(before);assert.match(after,/我爱白饭/);assert.match(after,/真实感受有边界/);assert.doesNotMatch(after,/通常顺势顶一句|吃瘪会顶半句/);assert.equal(relaxPerformativeStyle(after),after);assert.equal(relaxPerformativeStyle('另一张角色卡：我爱严肃研究。'),'另一张角色卡：我爱严肃研究。');
});

test('real V3 prompt composition supplies one selected expression block and does not replay the full book',t=>{
 const x=make(t);archivedPhrases(x,'无关火星语：仅火星专项讨论。\n666：离谱、服气、玩笑。');const row=x.add('private:8','你不要老是反问我'),expression=x.o.expressionContext('private:8',{incoming:row.text,recordIds:[row.id]});
 const context=x.o.context('private:8',{incoming:row.text}),view=buildExpressionContext({incoming:row.text,expressionBlock:expression.block,naturalExpression:x.o.naturalExpression})+'\n'+context;
 assert.doesNotMatch(context,/【表达反馈与近期重复|你不要老是反问我/);assert.equal(view.split('【表达反馈与近期重复').length-1,1);assert.match(view,/你不要老是反问我/);assert.doesNotMatch(view,/无关火星语/);assert.equal(x.e.feedback('private:9').length,0);
});

test('the QQ event view retains peer facts and time without copying the native runtime state',t=>{
 const x=make(t),decode=text=>text.split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(value=>value?.currentPeer);
 const full=decode(x.o.context('private:8')),event=decode(x.o.context('private:8',{includeRuntimeState:false}));
 assert.equal(typeof full.psychological,'string');assert.equal(Number.isSafeInteger(full.generation),true);assert.equal(full.state.energy!==undefined,true);
 for(const key of ['psychological','generation','psycheRevision','psychology','psyche','state'])assert.equal(Object.hasOwn(event,key),false,key);
 assert.equal(event.currentPeer,'qq:8');assert.deepEqual(Object.keys(event.time),Object.keys(full.time));assert.deepEqual(event.dispositions,full.dispositions);assert.equal(event.selfId,full.selfId);
});

test('administrator expression interface previews without a model, tests with native isolation and zero energy, and leaves raw chat untouched',async t=>{
 const x=make(t);x.o.runtime.policy.updateState({energy:0});x.o.refreshEnergy();x.add('private:7','你好');const count=x.contacts.db.prepare('SELECT count(*) n FROM chat_records').get().n;const preview=await adminRuntimeTest(x.o,7,{action:'expression-preview',text:'我很难过'});assert.equal(preview.result.data.scene.tag,'support');assert.equal(x.o.runtime.model.receipts.length,0);
 x.o.think=async (prompt,signal,options)=>{assert.equal(energyContext().exempt,true);assert.equal(options.json,false);assert.match(options.system,/喜欢有来有回的相处/);assert.match(prompt,/难过/);assert.equal(prompt.split('【自然接话】').length-1,1);return {data:'怎么了 我在听',receipt:{disposed:true,transcriptPersisted:false}};};const result=await adminRuntimeTest(x.o,7,{action:'expression-test',text:'我很难过'});assert.equal(result.result.status,'complete');assert.equal(result.energyAudit.charged,0);assert.equal(result.result.receipt.disposed,true);assert.equal(result.test.externalMessages,0);assert.equal(x.contacts.db.prepare('SELECT count(*) n FROM chat_records').get().n,count);await assert.rejects(adminRuntimeTest(x.o,7,{action:'expression-test',key:'private:8',text:'你好'}),/管理员/);
});

test('the actual bridge wake passes current text and source IDs into V3 selection once, with no fixed example leakage',async t=>{
 const x=make(t),h=await bridgeHarness({config:{socialV2:{mind:{enabled:true}}},files:{'roles/大肥鱼内定性格.md':'## 身份\n肥鱼\n## 说话方式\n听完整句话。\n### 示例\n摸鱼→固定示例不要泄漏'}});t.after(()=>h.close());h.setMode('reserved2');h.cfg.socialV2.mind.version=3;h.mindSystem.isV3=true;let captures=0;h.mindSystem.expressionContext=(scope,input)=>{captures++;return x.o.expressionContext(scope,input);};h.mindSystem.context=(scope,policy)=>x.o.context(scope,policy);const row=x.add('private:123','不要总用行吧开头'),st=h.getSocialV2State('private:123');st.unread=[{seq:1,recordId:row.id,text:row.text,plain:row.text}];const prompt=h.buildWakePromptV2('private:123','private');assert.equal(captures,1);assert.equal(prompt.split('【表达反馈与近期重复').length-1,1);assert.match(prompt,/不要总用行吧开头/);assert.doesNotMatch(prompt,/固定示例不要泄漏|听完整句话/);assert.match(JSON.parse(fs.readFileSync(h.mindSystem.mirror,'utf8')).speakingStyle,/听完整句话|固定示例不要泄漏/);assert.equal(x.e.feedback('private:123').length,1);
});
