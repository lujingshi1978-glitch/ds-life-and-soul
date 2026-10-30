import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {LiveCognition} from '../src/cognition/live.js';import {ContactStore} from '../src/contact-store.js';
const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
export function fixture(t,{scope='self',active=true}={}){const home=fs.mkdtempSync(path.join(base,'perception-')),profileDir=path.join(home,'profile');fs.mkdirSync(profileDir);const at=Date.parse('2026-11-13T03:00:00Z'),contacts=new ContactStore(path.join(profileDir,'contacts.sqlite')),mind=new LiveCognition({root:path.join(home,'cognition'),profile:{id:path.basename(home),dir:profileDir,created:at},contacts,innerVersion:3,ownerQQ:'1',core:'我是隔离当前观察归因测试角色。',now:()=>at,ready:()=>true,allowed:()=>true,mirror:path.join(profileDir,'mind-core.json'),think:()=>{throw Error('NO_REAL_MODEL');}}),r=mind.runtime;
 const migration=r.observe({adapter:'migration-fixture',externalId:'old',kind:'configuration',text:'旧的配置迁移，不是本次外界阅读。',occurredAt:at-86400000,metadata:{speakerId:r.characterId,scope:'self',notPrimaryEvidence:true}},{kind:'disposition-migrated',eventRoot:'disposition-migration-v1'});
 // A separately stored article is not the current self-scoped tool receipt.
 const article=r.observe({adapter:'article-fixture',externalId:'unknown-time',kind:'web-reading',text:'原文事件发生时间未知。',metadata:{scope:'stored-article',privacyLabel:'public'}},{eventRoot:'article-unknown-time'});
 r.inner.meta('lastCurrentReflectionAt',at-60000);r.inner.meta('currentAffectEvidenceAt',at-60000);r.inner.meta('stimulusRecallV1',{at:at-60000,triggerEventIds:['old-trigger']});
 let userRef=null;if(scope!=='self'){const id=contacts.record(scope,{role:'user',text:'现在请看看这个片段。',at,messageId:'current-user',source:'live'});userRef=mind.archive.ref('chat:'+id);}
 if(active)mind.beginBehavior('current',scope==='self'?'web':'chat',scope);
 const calls=[],recalls=[];r.model.run=async(purpose,prompt,material)=>{calls.push({purpose,prompt,material});return {summary:material.retrospective?'只回看旧资料，不视作本次新的外界刺激。':'这次实际返回的文字有一点新鲜，我先留下这点感受。',changes:[],...(!material.retrospective?{feeling:{mood:'平静又有点好奇',appraisal:{focus:'本次实际返回的文字片段',trigger:'当前工具回执'}}}:{})};};r.retriever.recall=async(query,options)=>{recalls.push({query,purpose:options.purpose});return {items:[],degradedChannels:[]};};
 const read=()=>mind.recordPerception(scope,{tool:'local-fixture-read',target:'local-synthetic-fixture',result:{text:'这次实际读取的短片段。',perception:{},errors:{}}});
 const finish=async()=>{mind.endBehavior('current','本次工具回执范围见来源，不推断完整网页或视频。');return r.runNext({kinds:['reflect']});};
 const event=id=>r.store.db.prepare('SELECT * FROM cognitive_events WHERE character_id=? AND event_id=?').get(r.characterId,id),source=e=>r.archive.get(e.sourceId,e.revision);
 const close=async()=>{assert.equal(r.model.receipts.length,0);await mind.close();contacts.close();const target=path.resolve(home);assert.ok(target.startsWith(base+path.sep));fs.rmSync(target,{recursive:true,force:true});};if(t)t.after(close);
 return {mind,r,scope,at,migration,article,userRef,calls,recalls,read,finish,event,source,close};
}
