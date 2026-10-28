// A transport-neutral result of one conversational thought. Choosing silence is
// a completed choice, not a failed/empty model response that should be retried.
export const CONVERSATION_RESPONSE='只返回JSON {"reply":"此刻真想说的原话，或null"}。reply=null表示看过后决定暂不接话，不要为填字段编一句。不要添加解释、内部推理或其他字段。';
export function conversationReply(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='reply')||!Object.hasOwn(value,'reply'))throw Error('CONVERSATION_RESPONSE_INVALID');
 if(value.reply===null)return null;
 if(typeof value.reply!=='string'||value.reply.length>4000||!value.reply.trim())throw Error('CONVERSATION_RESPONSE_INVALID');
 return value.reply.trim();
}

export function recordChannelOutcome(mind,{id,platform,scope,status,bodyScope=scope,at=Date.now(),recovered=false}){
 const approved=new Set(['http-completed','reviewed-no-reply','confirmed','failed','unknown','cancelled']);
 if(!approved.has(status))throw Error('CHANNEL_OUTCOME_INVALID');
 const externalId=platform+':'+id+':'+status,text=JSON.stringify({platform,requestId:id,status,userReadConfirmed:false,voicePlaybackConfirmed:false});
 // Replaying the bookkeeping after a later local write failed must reuse the
 // original evidence, including whether it was current at first observation.
 const prior=mind.runtime.archive?.db?.prepare("SELECT body,metadata,occurred_at FROM documents WHERE adapter='channel-result' AND external_id=? AND kind='delivery-result' AND status='available' ORDER BY revision DESC LIMIT 1").get(externalId);
 const metadata=prior?JSON.parse(prior.metadata):{speakerId:mind.runtime.characterId,scope:bodyScope,conversationPeerId:/^private:\d+$/.test(scope)?'qq:'+scope.slice(8):scope,deliveryStatus:status,notPrimaryEvidence:true,...(recovered?{recovery:true,historical:true}:{})};
 if(prior&&(prior.body!==text||metadata.scope!==bodyScope))throw Error('CHANNEL_OUTCOME_CONFLICT');
 return mind.runtime.observe({adapter:'channel-result',externalId,kind:'delivery-result',occurredAt:prior?.occurred_at??at,text,metadata},
  {kind:'action-outcome',eventRoot:'channel:'+platform+':'+id,outcome:['http-completed','confirmed'].includes(status)?'completed':status==='reviewed-no-reply'?'observed':status==='unknown'?'started':status});
}
