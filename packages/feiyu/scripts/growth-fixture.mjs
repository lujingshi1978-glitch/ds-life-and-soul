import fs from 'node:fs';import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';
import {selfModelContext,selfModelNodes} from '../src/cognition/self-model.js';

// An explicitly synthetic native fixture. No live profile, network, QQ client,
// production DB, credential or hidden-reasoning field is opened here.
export function createGrowthFixture({label='growth',think,core='我是隔离测试角色，身份、核心价值与权限保持不变。'}={}){
 const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});const home=fs.mkdtempSync(path.join(base,label+'-'));let time=Date.parse('2026-10-30T12:00:00+08:00'),serial=0;
 const r=new CharacterCognition({root:path.join(home,'cognition'),characterId:'character:isolated-growth-'+path.basename(home),embedding:null,now:()=>time,think});r.policy.seed({identity:{text:core,locked:true},personality_growth:{text:'尚未形成新的稳定倾向。',locked:false}});r.enableInner();
 function experience(text,{peer='qq:101',root,kind='experience',intensity=.1,lastingness=.1,externalId}={}){
  time++;const n=++serial,source=r.observe({adapter:'controlled-subjective-fixture',externalId:externalId||'exp-'+n,kind:'experience',text,occurredAt:time,metadata:{speakerId:r.characterId,conversationPeerId:peer,scope:'private:'+peer.slice(3),explicitExperience:true}},{kind:'experience-recorded',eventRoot:root||'fixture-root-'+n,outcome:'observed'});
  const id=r.store.addNodes([{kind,gist:text,detail:text,eventRoot:root||'fixture-root-'+n,occurredAt:time,epistemic:'interpreted',confidence:.9,salience:.6,metadata:{intensity,lastingness,roots:[root||'fixture-root-'+n],reaction:text,scope:'private:'+peer.slice(3)},evidence:[{sourceId:source.sourceId,revision:source.revision,span:{offset:0,length:text.length},role:'supports'}],participants:[{entityId:r.characterId,role:'subject'},{entityId:peer,role:'participant'}]}]).ids[0];
  return {id,source,root:root||'fixture-root-'+n};
 }
 return {r,home,experience,advance:ms=>{time+=ms;},selfModelContext:options=>selfModelContext(r.store,options),nodes:()=>selfModelNodes(r.store),async close(){await r.close();}};
}
export function localModelReply(data,id='native-test-reply'){return {data,receipt:{id,disposed:true,transcriptPersisted:false,usage:{inputTokens:0,outputTokens:0}}};}
export function scopedProposal(material,{text='和这位愿意留白的朋友聊天时，我更愿意说自己的小念头。',general=false,people=['qq:101'],standing='tentative',supportIds,scope}={}){
 return {reason:'本轮明确的相处反馈引起了一点新的自我理解。',selfUnderstanding:[{facet:'表达自己的小念头',text,reason:'对方认真接住话，又没有催我继续。',scope:scope||{people,situations:['被认真听见、允许留白的聊天'],general},standing,supportIds:supportIds||material.memories.map(m=>m.id),counterIds:[],eventIds:[],transition:'add'}],innerPatch:{summary:material.before.summary,changes:[]}};
}
