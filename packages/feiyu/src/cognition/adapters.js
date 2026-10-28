import {entityId,id,fail,bounded} from './contracts.js';

// These are normalization adapters, not QQ/Bili clients. Existing hosts must pass real receipts.
export function qqMessage({messageId,senderQQ,peerQQ,text,at,forwardedAuthorQQ}){
  const speakerId=entityId('qq:'+senderQQ),peerId=entityId('qq:'+peerQQ);id(String(messageId));bounded(text,250000,{empty:true});
  return {source:{adapter:'qq',externalId:String(messageId),kind:'chat',text,occurredAt:at,metadata:{speakerId,conversationPeerId:peerId,privacyLabel:'private',...(forwardedAuthorQQ?{forwardedAuthorId:entityId('qq:'+forwardedAuthorQQ)}:{})}},event:{kind:'message-received',eventRoot:'qq:message:'+messageId,outcome:'observed'}};
}
export function activityReceipt({characterId,activityId,kind,outcome,text,at,sourceUrl,explicitExperience=false}){
  entityId(characterId);if(!characterId.startsWith('character:'))fail('CHARACTER_ID_REQUIRED');
  if(!['bili','qzone','learn','chat','voice','sleep'].includes(kind))fail('INVALID_ACTIVITY');
  return {source:{adapter:kind,externalId:id(activityId),kind:explicitExperience?'experience':'activity',text,occurredAt:at,metadata:{speakerId:characterId,explicitExperience,privacyLabel:'private',...(sourceUrl?{sourceUrl}:{} )}},event:{kind:kind+'-activity',eventRoot:kind+':'+activityId,outcome}};
}
export function biliObservation({bvid,part=1,segmentId='0',text,at,kind='subtitles',authorUID,completed=false,receiptId}){
  if(!/^BV[0-9A-Za-z]{10}$/.test(bvid)||!['subtitles','frames','comments','metadata','asr'].includes(kind))fail('INVALID_BILI_OBSERVATION');
  if(completed&&!receiptId)fail('ACTUAL_RECEIPT_REQUIRED');
  return {source:{adapter:'bili',externalId:`${bvid}:${part}:${kind}:${segmentId}`,kind:'video-'+kind,text,occurredAt:at,metadata:{privacyLabel:'public',sourceUrl:`https://www.bilibili.com/video/${bvid}/?p=${part}`,perception:kind,...(authorUID?{speakerId:entityId('bili:'+authorUID)}:{}),...(receiptId?{receiptId}:{})}},event:{kind:'video-'+kind+'-observed',eventRoot:`bili:${bvid}:${part}`,outcome:completed?'completed':'observed'}};
}
