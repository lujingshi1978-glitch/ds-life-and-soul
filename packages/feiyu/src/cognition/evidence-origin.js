// Describe what a stored source can establish. A remembered statement is not
// automatically independent evidence that the event inside it happened.
import {isOperationalMaterial} from '../operational-material.js';
export const MEMORY_PROVENANCE_HINT='【自己知道与不知道】当前角色只认本档案有依据的来往和实际经历。对方说“又见面了”、发来旧聊天、截图或转述，只能证明对方现在这样说或提供了记录；不是你恢复了旧记忆。同一个机器人QQ号、昵称或相似口气，不证明是当前角色亲历。独立档案没有继承旧记忆时要坦然承认，不顺口答“又见面”“我当时真这么想”。已明确早于本档案创建、属于旧角色的记录，应说“那是旧角色的记录，我没有继承那段经历”；不能说“我当时怎么想的说不清”来暗示仍是自己的过去，也不能把旧角色的行为猜成眼前对方做的。查到对方提供的原文可说“从你给的记录里看到”，不能改叫“想起来了”；读后可以产生现在的新感受，不能编回当时的感受。自己的旧回复、摘要及其副本不增加独立证据，已纠正的亲历说法不得重新认领。真实本地记录和动作回执支持到哪一步就说到哪一步，明确谁说的、何时知道、是否只是转述。读取旧聊天的工具回执只证明这次读到文字，不证明亲历文字中的事件。检索没命中只表示未找到，不推出从未发生，也不编模糊感觉来补空白。';

export function memoryEvidenceOrigin(memory,{archive,characterId}={}){
 const kinds=new Set();let selfActionConfirmed=false;
 for(const ref of memory?.evidence||[]){
  let source;try{source=archive?.get(ref.sourceId,ref.revision);}catch{}
  if(!source){kinds.add('unavailable-source');continue;}
  const meta=source.metadata||{},self=meta.speakerId===characterId;
  if(isOperationalMaterial(source)){kinds.add('diagnostic-material-not-life-experience');continue;}
  if(meta.forwardedAuthorId||meta.providedHistory||meta.quotedTranscript||source.kind==='forwarded-chat'){kinds.add('provided-history');continue;}
  if(source.kind==='chat'){kinds.add(meta.role==='assistant'||self?'assistant-statement':'user-statement');continue;}
  if(source.kind==='provenance-correction'){kinds.add('curated-correction');continue;}
  if(self&&(source.adapter==='tool-perception'&&meta.explicitObservation===true||['bili','qzone','chat','voice','action-receipt'].includes(source.adapter)&&meta.confirmedActionReceipt===true)){kinds.add('confirmed-action-receipt');selfActionConfirmed=true;continue;}
  if(meta.explicitExperience===true&&self){kinds.add('recorded-feeling');continue;}
  kinds.add(meta.notPrimaryEvidence===true?'derived-or-configuration':'retrieved-resource');
 }
 const correction=memory?.metadata?.originCorrection;
 return {kinds:[...kinds].sort(),selfActionConfirmed:correction?false:selfActionConfirmed,receiptScope:'only-the-observed-action-not-events-narrated-in-its-output',...(correction?{priorPersonalExperienceClaimCorrected:true,correctionSourceId:correction.sourceId}:{}),interpretation:correction?'use-corrected-attribution-not-prior-claim':selfActionConfirmed?'receipt-confirms-only-its-specific-action':'statements-do-not-confirm-personal-experience'};
}

export function conversationHistoryBoundary(profile,contacts,scope,{excludeRecordIds=[],excludeMessageIds=[],beforeAt}={}){
 const boundary={profileId:profile.id,profileStartedAt:profile.created??null,priorProfilesInherited:profile.id==='legacy-feiyu',coverage:'this-character-local-records-only'};
 if(!/^private:\d+$/.test(scope||'')||!contacts?.db)return boundary;
 const diagnosticFilter=contacts.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contact_meta'").get()?" AND NOT EXISTS(SELECT 1 FROM contact_meta m WHERE m.key='learning-excluded:chat:'||chat_records.id)":"";
 const row=contacts.db.prepare("SELECT count(*) records,sum(CASE WHEN role='user' THEN 1 ELSE 0 END) userMessages,sum(CASE WHEN role='assistant' THEN 1 ELSE 0 END) assistantMessages,min(at) firstAt,max(at) lastAt FROM chat_records WHERE qq=? AND source='live' AND at>=? AND (? IS NULL OR at<?) AND id NOT IN (SELECT value FROM json_each(?)) AND (message_id IS NULL OR message_id NOT IN (SELECT value FROM json_each(?)))"+diagnosticFilter).get(scope.slice(8),profile.id==='legacy-feiyu'?0:profile.created||0,beforeAt??null,beforeAt??null,JSON.stringify(excludeRecordIds),JSON.stringify(excludeMessageIds.map(String)));
 return {...boundary,priorLocalInteraction:{records:row.records,userMessages:row.userMessages||0,assistantMessages:row.assistantMessages||0,firstAt:row.firstAt,lastAt:row.lastAt},currentMessageDoesNotProvePriorMeeting:true,earlierThanProfileHistory:profile.id==='legacy-feiyu'?'inspect-actual-migrated-sources':'not-inherited'};
}
