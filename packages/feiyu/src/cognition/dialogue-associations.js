import {currentTopicCue,contextualMemoryView,expressionFeedbackApplies} from './memory-activation.js';
import {hash,clip,terms} from './contracts.js';
import {memoryLearningEligible} from '../operational-material.js';
import {conversationAssociations} from './stimulus-recall.js';
import {memoryEvidenceOrigin} from './evidence-origin.js';
import {tuningFor} from '../runtime-tuning.js';

const selfQuestion=text=>/(?:在干(?:什么|嘛)|在做什么|忙什么|最近.{0,8}(?:看|玩|做)|(?:还在|刚才|刚刚).{0,6}看|看(?:什么|啥))/u.test(text);
const changedTopic=text=>currentTopicCue(text).changed;
const related=(a,b)=>{const query=new Set(terms(a).filter(t=>!['这个','那个','什么','一下','现在','刚才','我们','自己'].includes(t)));return terms(b).some(t=>query.has(t));};

// A turn-local evidence view, not another thinker, memory store or action loop.
export class DialogueAssociations {
 constructor(owner){this.owner=owner;this.views=new Map();this.controllers=new Set();}
 close(){for(const c of this.controllers)c.abort();this.controllers.clear();this.views.clear();}
 current(binding){const r=this.owner.runtime;return !this.owner.closed&&!r.closed&&r.store.manifest().role_epoch===binding.roleEpoch&&r.inner.head().generation===binding.generation&&r.inner.clock.epoch===binding.processEpoch;}
 async prepare(scope,{incoming='',budgetMs=900,signal}={}){
  if(!/^private:\d+$/.test(scope)||!this.owner.isV3||!incoming.trim())return;
  const r=this.owner.runtime,tuning=tuningFor(r),binding={roleEpoch:r.store.manifest().role_epoch,generation:r.inner.head().generation,processEpoch:r.inner.clock.epoch};
  const tuningKey=hash([tuning.memory.associationBudgetChars,tuning.memory.dialogueBudgetChars,tuning.memory.associationMaxItems,tuning.memory.maxRecallItems,tuning.text.memoryGistChars]);
  const key=hash(incoming),previous=this.views.get(scope);if(previous?.key===key&&previous.tuningKey===tuningKey&&this.current(previous.binding)&&Date.now()-previous.at<10000)return;
  const controller=new AbortController();this.controllers.add(controller);const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const recent=(this.owner.contacts?.recent(scope,3)||[]).filter(m=>m.at>=Date.now()-300000).map(m=>m.text||'').join(' ').slice(-400);
  const now=r.now(),self=selfQuestion(incoming),cards=self?this.publicCards({query:incoming,self:true}):[];
  const cue=currentTopicCue(incoming),query=[cue.query,...(cue.changed?[]:[...(cue.usesRecent?[recent]:[]),...cards.map(c=>c.summary)])].join(' ').slice(0,800);
  let timer;const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'unavailable',degradedChannels:['dialogue-recall-deadline'],items:[]});},Math.max(10,Math.min(1200,budgetMs)));});
  let found;
  try{
   const work=query.trim()?Promise.resolve().then(()=>r.retriever.recall(query,{depth:'shallow',purpose:'stimulus-associate',budgetChars:tuning.memory.associationBudgetChars,signal:combined,currentInterestsOnly:true,expressionScope:scope})).then(value=>({...value,status:value.items?.length?'recalled':value.omittedForBudget?'budget-limited':'empty'}),error=>({status:'unavailable',degradedChannels:[error.code||'dialogue-recall-unavailable'],items:[]})):Promise.resolve({status:'empty',items:[],bundles:[],degradedChannels:[]});
   found=query.trim()?await Promise.race([work,deadline]):{status:'empty',items:[],bundles:[],degradedChannels:[]};
  }finally{clearTimeout(timer);this.controllers.delete(controller);}
  if(signal?.aborted||!this.current(binding))return;
  const memoryBundles=[];let count=0;for(const bundle of found.bundles||(found.items||[]).map(m=>({ids:[m.id]}))){if(count+bundle.ids.length>Math.min(tuning.memory.associationMaxItems,tuning.memory.maxRecallItems))continue;memoryBundles.push(bundle);count+=bundle.ids.length;}
  const ids=memoryBundles.flatMap(b=>b.ids),memories=ids.map(id=>r.store.get(id)).filter(m=>memoryLearningEligible(r.archive,m)).map(m=>contextualMemoryView(r,m));
  const sources=changedTopic(incoming)?[]:cards.length?cards:this.publicCards({query,ids,self:false});
  const view={key,tuningKey,binding,at:Date.now(),incoming,status:found.status,degradedChannels:found.degradedChannels||[],memories,memoryBundles,contacts:conversationAssociations(r,memories.map(m=>m.id)),sources,currentBehavior:r.policy.state().behavior||null};
  this.views.set(scope,view);if(this.views.size>20)this.views.delete(this.views.keys().next().value);
  r.inner.meta('dialogueAssociationV1',{at:now,scope,status:view.status,memoryIds:memories.map(m=>m.id),sourceIds:sources.map(s=>s.sourceId),inputHash:key,foregroundModelCalls:0});
 }
 publicCards({query='',ids=[],self=false}={}){
  const r=this.owner.runtime,db=r.store.db;if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='v3_public_readings'").get())return [];
  const basis=new Set();for(const id of ids){const memory=r.store.get(id);for(const ref of memory?.evidence||[])basis.add(ref.sourceId);}
  const rows=db.prepare('SELECT source_id,source_revision,platform,target,reaction_json,at FROM v3_public_readings WHERE at<=? ORDER BY at DESC LIMIT 24').all(r.now());const out=[];
  for(const row of rows){
   if(!this.sourceUsable({sourceId:row.source_id,revision:row.source_revision}))continue;
   const reaction=JSON.parse(row.reaction_json);if(!self&&!basis.has(row.source_id)&&!related(query,reaction.summary))continue;
   let url;try{url=new URL(row.target);if(url.protocol!=='https:'||url.username||url.password||url.hostname==='localhost'||/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname))continue;}catch{continue;}
   out.push({sourceId:row.source_id,revision:row.source_revision,platform:row.platform,url:url.href,summary:clip(reaction.summary,220),observedAt:row.at,coverage:'actual-supplied-material-not-whole-video',pastReadingNotCurrentActivity:true});if(out.length>=2)break;
  }return out;
 }
 sourceUsable(ref){const r=this.owner.runtime;try{return r.store.sourceUsable(ref,{historical:true})&&r.archive.get(ref.sourceId,ref.revision).metadata.privacyLabel==='public';}catch{return false;}}
 ideas(scope,incoming=''){
  const r=this.owner.runtime,person='qq:'+scope.slice(8);if(changedTopic(incoming))return [];
  const rows=r.store.db.prepare("SELECT m.object_id FROM v3_inner_motives m JOIN v3_inner_objects o ON o.object_id=m.object_id AND o.current_revision=m.revision WHERE m.motive_kind='share' AND m.valid_until>? AND o.invalidated_at IS NULL AND o.status IN ('active','quiet') AND (m.candidate_person_id IS NULL OR m.candidate_person_id=?) ORDER BY o.created_at DESC LIMIT 8").all(r.now(),person);
  return rows.flatMap(row=>{const o=r.inner.object(row.object_id);if(o.status==='quiet'&&!selfQuestion(incoming)&&!related(incoming,o.body.title+' '+o.body.meaning))return [];
   const evidence=r.store.db.prepare('SELECT event_id,memory_id,memory_revision,source_id,source_revision FROM v3_inner_evidence WHERE object_id=? AND object_revision=?').all(o.object_id,o.current_revision);try{for(const e of evidence)r.inner.evidence(e.event_id?{eventId:e.event_id}:e.memory_id?{memoryId:e.memory_id,memoryRevision:e.memory_revision}:{sourceId:e.source_id,sourceRevision:e.source_revision});}catch{return [];}
   return [{id:o.object_id,revision:o.current_revision,connection:clip(o.body.meaning||o.body.title,160),personId:o.body.personId||null,memoryIds:evidence.filter(e=>e.memory_id).map(e=>e.memory_id),formedAt:o.created_at,epistemic:'subjective-association-not-new-fact',referenceOnly:true,intentIsNotAnAction:true}];}).slice(0,2);
 }
 view(scope,{incoming=''}={}){
  const saved=this.views.get(scope),r=this.owner.runtime;
  const ideas=this.ideas(scope,incoming);
  if(!saved||hash(incoming)!==saved.key||!this.current(saved.binding)||Date.now()-saved.at>120000)return ideas.length?{ideas,referenceOnly:true}:null;
  const tuning=tuningFor(r),valid=new Map(saved.memories.filter(m=>{const current=r.store.get(m.id);return current?.revision===m.revision&&memoryLearningEligible(r.archive,current)&&expressionFeedbackApplies(current,scope);}).map(m=>[m.id,contextualMemoryView(r,r.store.get(m.id))]));
  let count=0;const bundles=saved.memoryBundles.filter(b=>{if(!b.ids.every(id=>valid.has(id))||count+b.ids.length>Math.min(tuning.memory.associationMaxItems,tuning.memory.maxRecallItems))return false;count+=b.ids.length;return true;});
  const value={status:saved.status,degradedChannels:saved.degradedChannels,memories:bundles.flatMap(b=>b.ids.map(id=>valid.get(id))),contacts:[],publicSources:saved.sources.filter(s=>this.sourceUsable(s)),ideas,currentBehavior:saved.currentBehavior,referenceOnly:true,note:'相关经历与念头供本轮自由联想，不是待完成任务。可以不提；对方换题后不自动续说。已读内容只证明当时读过；旧语音或链接失败不代表当前能力，旧承诺不自动重启。'};
  const updateContacts=()=>{value.contacts=conversationAssociations(r,value.memories.map(m=>m.id));};updateContacts();
  while(JSON.stringify(value).length>tuning.memory.dialogueBudgetChars&&(bundles.length||value.publicSources.length||value.ideas.length)){value.omittedForBudget=true;if(bundles.length){bundles.pop();value.memories=bundles.flatMap(b=>b.ids.map(id=>valid.get(id)));updateContacts();}else if(value.publicSources.length)value.publicSources.pop();else value.ideas.pop();}
  if(JSON.stringify(value).length>tuning.memory.dialogueBudgetChars)return {status:value.status,referenceOnly:true,omittedForBudget:true,memories:[],contacts:[],note:'本轮联想资料预算不足；没有命中或省略不等于从未发生。'};
  return value;
 }
}
