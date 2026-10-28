import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';

// A fresh external stimulus chooses the retrieval query. Existing psychology
// remains available to the same forebrain, but does not rewrite this query.
export function stimulusRecallPlan({materials=[],recallCue,historical=false,compressionOnly=false}={}){
 if(historical||compressionOnly)return null;
 const query=(recallCue||materials.filter(m=>m.externalStimulus).map(m=>m.text).join('\n')).trim().slice(0,800);
 return query?{query}:null;
}

// People mentioned in a story are not automatically conversation partners.
// Trace exact, available local conversation sources without reading new pages
// or promoting a supplied old transcript to a personal shared experience.
export function conversationAssociations(runtime,memoryIds){
 const contacts=new Map();
 for(const id of memoryIds.slice(0,20)){
  const memory=runtime.store.get(id);if(!memory||!memoryLearningEligible(runtime.archive,memory))continue;
  const todo=[...(memory.evidence||[])],seen=new Set();let inspected=0;
  while(todo.length&&inspected++<64){const ref=todo.shift(),key=ref.sourceId+'@'+ref.revision;if(seen.has(key))continue;seen.add(key);
   let source;try{if(!runtime.store.sourceUsable(ref,{historical:true}))continue;source=runtime.archive.get(ref.sourceId,ref.revision);}catch{continue;}
   const meta=source.metadata||{};
   if(isOperationalMaterial(source)||meta.providedHistory||meta.quotedTranscript||meta.forwardedAuthorId||source.kind==='forwarded-chat')continue;
   if(source.kind==='chat'&&['user','assistant'].includes(meta.role)&&/^private:\d+$/.test(meta.scope||'')){
    const personId='qq:'+meta.scope.slice(8);if(meta.conversationPeerId&&meta.conversationPeerId!==personId)continue;
    if(!memory.participants.some(p=>p.entity_id===personId))continue;
    const contact=contacts.get(personId)||{personId,memoryIds:[],sourceRefs:[],basis:'local-conversation-source',referenceOnly:true};
    if(!contact.memoryIds.includes(id))contact.memoryIds.push(id);
    if(contact.sourceRefs.length<2&&!contact.sourceRefs.some(r=>r.sourceId===ref.sourceId&&r.revision===ref.revision))contact.sourceRefs.push({sourceId:ref.sourceId,revision:ref.revision});contacts.set(personId,contact);
   }
   todo.push(...(meta.basisSources||[]).slice(0,16));
  }
 }
 return [...contacts.values()].slice(0,6);
}

export const ASSOCIATION_HINT='有依据但暂不想说的分享念头，可用现有changes中的motive（motiveKind=share、status=quiet、personId和本轮memoryIds/eventIds）留作背景，不必创建decision；没有念头则不新增。它不是待办，不因保留就必须联系，之后可搁置或release。不要另造独立的联想人格或推理记录。 每次真实外界信息进入，本轮memoryAssociation是先用这次信息做的记忆联想。先看新信息与recalled有没有实际关联：可能想到某位好友曾聊过的内容、问过你的事情，或一个想分享的新发现；由你决定要不要联系，也可以没有联想、继续看、换事或休息，不规定分享次数。memoryAssociation.contacts只标明记忆有本地聊天来源，不表示对方此刻来信、有空或同意公开私聊；people和参与者不等于共同经历。只有证据确实支持，才说“我们聊过这个”；对方转述、提供的旧聊天和你自己的推测不能升级成亲历。无命中或检索降级不推出从未发生，也不编一个好友来凑分享。想联系本轮记忆联想到的具体人时可选择chat并引用memoryIds，不受近期候选列表顺序限制；执行前仍必须复核该人的许可和拒绝边界。';
