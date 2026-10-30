import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';
import {basisSources} from './basis-sources.js';

// A fresh external stimulus chooses the retrieval query. Existing psychology
// remains available to the same forebrain, but does not rewrite this query.
export function stimulusRecallPlan({materials=[],recallCue,historical=false,compressionOnly=false}={}){
 if(historical||compressionOnly)return null;
 const query=(recallCue||materials.filter(m=>m.externalStimulus).map(m=>m.text).join('\n')).trim().slice(0,800);
 return query?{query}:null;
}

// Source qualification is shared with opportunity refresh. The complete exact
// basis closure must be usable before any association becomes visible.
export function associationSources(runtime,refs,{current=false}={}){
 if(runtime.store?.characterId!==runtime.characterId||runtime.archive?.characterId!==runtime.characterId)return [];
 let closure;try{closure=basisSources(runtime,refs);}catch{return [];}
 if(!closure.length||closure.length>128)return [];
 const qualified=[];
 for(const ref of closure){try{
  const source=runtime.archive.get(ref.sourceId,ref.revision),m=source.metadata||{};
  if(!runtime.store.sourceUsable(ref,{historical:!current})||!runtime.store.sourceRegistered(ref)||runtime.store.suppressed(ref.sourceId)||source.status!=='available'||isOperationalMaterial(source)||m.providedHistory||m.quotedTranscript||m.forwardedAuthorId||source.kind==='forwarded-chat'||current&&m.historical)return [];
  qualified.push({ref,source});
 }catch{return [];}}
 return qualified;
}

// People mentioned in a story are not automatically conversation partners.
// Trace exact, available local conversation sources without reading new pages
// or promoting a supplied old transcript to a personal shared experience.
export function conversationAssociations(runtime,memoryIds){
 const contacts=new Map();
 if(runtime.store?.characterId!==runtime.characterId||runtime.archive?.characterId!==runtime.characterId)return [];
 for(const id of memoryIds.slice(0,20)){
  const memory=runtime.store.get(id);if(!memory||!memoryLearningEligible(runtime.archive,memory))continue;
  const qualified=associationSources(runtime,memory.evidence||[]);if(!qualified.length)continue;
  const todo=qualified.map(x=>x.ref),seen=new Set();let inspected=0;
  const ownSelfModel=memory.kind==='self_model'&&memory.participants.some(p=>p.entity_id===runtime.characterId&&p.role==='subject');
  while(todo.length&&inspected++<128){const ref=todo.shift(),key=ref.sourceId+'@'+ref.revision;if(seen.has(key))continue;seen.add(key);
   let source;try{if(!runtime.store.sourceUsable(ref,{historical:true}))continue;source=runtime.archive.get(ref.sourceId,ref.revision);}catch{continue;}
   const meta=source.metadata||{};
   if(source.status!=='available'||runtime.store.suppressed?.(ref.sourceId)||!runtime.store.sourceRegistered(ref))continue;
   if(isOperationalMaterial(source)||meta.providedHistory||meta.quotedTranscript||meta.forwardedAuthorId||source.kind==='forwarded-chat')continue;
   if(source.kind==='chat'&&['user','assistant'].includes(meta.role)&&/^private:\d+$/.test(meta.scope||'')){
    const personId='qq:'+meta.scope.slice(8);if(meta.conversationPeerId&&meta.conversationPeerId!==personId)continue;
    if(!runtime.store.db.prepare('SELECT 1 FROM entities WHERE character_id=? AND entity_id=?').get(runtime.characterId,personId))continue;
    if(meta.role==='user'&&meta.speakerId!==personId||meta.role==='assistant'&&meta.speakerId!==runtime.characterId)continue;
    const participant=memory.participants.some(p=>p.entity_id===personId),selfExpression=ownSelfModel&&meta.role==='assistant'&&meta.speakerId===runtime.characterId&&meta.conversationPeerId===personId;
    if(!participant&&!selfExpression)continue;
    const relationKind=participant?'participant-conversation-reference':'source-conversation-reference';
    const contact=contacts.get(personId)||{personId,memoryIds:[],sourceRefs:[],associations:[],basis:participant?'local-conversation-source':'source-conversation-reference',referenceOnly:true,authorization:'not-granted-by-association',privateReference:true,mayDiscloseSourceText:false};
    if(contact.associations.length<6&&!contact.associations.some(a=>a.memoryId===id&&a.sourceId===ref.sourceId&&a.sourceRevision===ref.revision))contact.associations.push({kind:relationKind,memoryId:id,memoryRevision:memory.revision,sourceId:ref.sourceId,sourceRevision:ref.revision,scope:meta.scope,speakerRole:meta.role,privacyLabel:meta.privacyLabel||'private',supports:participant?'sourced-conversation-reference':'self-expression-in-this-conversation',peerPreferenceKnown:false,jointExperienceKnown:false});
    if(!contact.memoryIds.includes(id))contact.memoryIds.push(id);
    if(contact.sourceRefs.length<2&&!contact.sourceRefs.some(r=>r.sourceId===ref.sourceId&&r.revision===ref.revision))contact.sourceRefs.push({sourceId:ref.sourceId,revision:ref.revision});contacts.set(personId,contact);
   }
   // Complete basis closure was checked before emitting any reference.
  }
 }
 return [...contacts.values()].slice(0,6);
}

export const ASSOCIATION_HINT='有依据但暂不想说的分享念头，可用现有changes中的motive（motiveKind=share、status=quiet、personId和本轮memoryIds/eventIds）留作背景，不必创建decision；没有念头则不新增。它不是待办，不因保留就必须联系，之后可搁置或release。不要另造独立的联想人格或推理记录。 每次真实外界信息进入，本轮memoryAssociation是先用这次信息做的记忆联想。先看新信息与recalled有没有实际关联：可能想到某位好友曾聊过的内容、问过你的事情，或一个想分享的新发现；由你决定要不要联系，也可以没有联想、继续看、换事或休息，不规定分享次数。memoryAssociation.contacts只标明记忆有本地聊天来源；其中source-conversation-reference仅说明自己的这份理解曾在与此人的会话中表达，不说明对方也喜欢、不说明共同亲历、不提供私聊转述许可，不表示对方此刻来信、有空或同意公开私聊；people和参与者不等于共同经历。只有证据确实支持，才说“我们聊过这个”；对方转述、提供的旧聊天和你自己的推测不能升级成亲历。无命中或检索降级不推出从未发生，也不编一个好友来凑分享。想联系本轮记忆联想到的具体人时可选择chat并引用memoryIds，不受近期候选列表顺序限制；执行前仍必须复核该人的许可和拒绝边界。';
