import {isAllowedToolName,canonicalQQToolName} from '../plugins/qq-agent-presets/qq-tool-restrict.mjs';

const fields=['version','key','administrator','origin','hasCurrentRequest','profileId','activationEpoch','turnId','freshSeqs','historySeqs'];
const origins=new Set(['operator','incoming','history','autonomous']);
const currentOrigins=new Set(['live','incoming']);
const delegatedTools=new Set(['qq_start_work','qq_create_capability','qq_wechat_desktop','qq_social_action']);
const isRecord=value=>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  if(prototype===null)return true;
  const constructor=Object.getOwnPropertyDescriptor(prototype,'constructor')?.value;
  return Object.getPrototypeOf(prototype)===null&&typeof constructor==='function'&&
    Function.prototype.toString.call(constructor)===Function.prototype.toString.call(Object);
};
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
const epochOrTurn=value=>identifier(value)||Number.isSafeInteger(value)&&value>=0;
const sequence=value=>Number.isSafeInteger(value)&&value>0;
const validSequences=value=>{
  if(!Array.isArray(value))return false;
  const values=Array.from({length:value.length},(_,index)=>Object.hasOwn(value,index)?value[index]:undefined);
  return values.every(sequence)&&new Set(values).size===values.length;
};

export function validateBehaviorFrame(frame){
 try{
  if(!isRecord(frame)||Reflect.ownKeys(frame).length!==fields.length||fields.some(field=>!Object.hasOwn(frame,field)))return false;
  if(frame.version!==1||typeof frame.key!=='string'||!/^(private|group):\d+$/.test(frame.key)||
    typeof frame.administrator!=='boolean'||!origins.has(frame.origin)||typeof frame.hasCurrentRequest!=='boolean'||
    !identifier(frame.profileId)||!epochOrTurn(frame.activationEpoch)||!epochOrTurn(frame.turnId)||
    !validSequences(frame.freshSeqs)||!validSequences(frame.historySeqs))return false;
  if(frame.administrator&&!frame.key.startsWith('private:'))return false;
  if(frame.hasCurrentRequest!==(frame.origin==='operator'||frame.origin==='incoming'))return false;
  if(frame.origin==='autonomous'&&(frame.freshSeqs.length||frame.historySeqs.length))return false;
  if(frame.origin==='incoming'&&!frame.freshSeqs.length)return false;
  if(frame.origin==='history'&&(!frame.historySeqs.length||frame.freshSeqs.length))return false;
  const historical=new Set(frame.historySeqs);
  return !frame.freshSeqs.some(seq=>historical.has(seq));
 }catch{return false;}
}

function historical(message){
  if(message.history===true||message.isHistory===true||message.historyOnly===true||message.fromHistory===true||
    message.recoveredUnanswered===true||message._historyDiscovery===true||Object.hasOwn(message,'_historyAt'))return true;
  // Unknown, recalled and external-resource origins cannot become a new request.
  return message.origin!==undefined&&!currentOrigins.has(message.origin);
}

// Call only with bridge-authenticated operator metadata. Text in unread messages,
// memories and webpages never supplies identity or an operator authorization.
export function createBehaviorFrame({key,ownerQQ,reason,operatorRequest,unread=[],profileId,activationEpoch,turnId}){
  if(!Array.isArray(unread))throw Error('INVALID_BEHAVIOR_UNREAD');
  const fresh=new Set(),history=new Set();
  for(const message of unread){
    if(!isRecord(message)||!sequence(message.seq)||message.isSelf===true||message.role==='assistant')continue;
    if(historical(message)||(message.role!==undefined&&message.role!=='user'))history.add(message.seq);
    else fresh.add(message.seq);
  }
  // Conflicting provenance for the same local sequence stays historical.
  for(const seq of history)fresh.delete(seq);
  const operator=reason==='operator-note'&&typeof operatorRequest==='string'&&!!operatorRequest.trim();
  const origin=operator?'operator':fresh.size?'incoming':history.size?'history':'autonomous';
  const owner=typeof ownerQQ==='string'?ownerQQ:Number.isSafeInteger(ownerQQ)&&ownerQQ>0?String(ownerQQ):'';
  const frame={version:1,key,administrator:/^[1-9]\d*$/.test(owner)&&key==='private:'+owner,
    origin,hasCurrentRequest:operator||fresh.size>0,profileId,activationEpoch,turnId,
    freshSeqs:[...fresh].sort((a,b)=>a-b),historySeqs:[...history].sort((a,b)=>a-b)};
  if(!validateBehaviorFrame(frame))throw Error('INVALID_BEHAVIOR_FRAME');
  return frame;
}

const deny=(code,message)=>({allowed:false,code,message});
export function assessBehaviorTool({name,args={},frame}={}){
  // Unframed sessions keep the ordinary DSH behavior. Authenticated envelopes
  // reject a present null/invalid frame before reaching this compatibility path.
  if(frame==null)return {allowed:true};
  if(!validateBehaviorFrame(frame))return deny('BEHAVIOR_FRAME_INVALID','行为上下文无效');
  if(!isRecord(args))return deny('BEHAVIOR_ARGUMENTS_INVALID','工具参数无效');
  if('key' in args&&args.key!==frame.key)return deny('BEHAVIOR_SCOPE_MISMATCH','会话范围不匹配');
  const canonical=typeof name==='string'&&/^qq_[A-Za-z0-9_]+$/.test(name)?'mcp__snowluma__'+name:name;
  if(!isAllowedToolName(canonical))return deny('BEHAVIOR_TOOL_NOT_ALLOWED','工具不在当前会话范围');
  const original=typeof canonical==='string'?canonical.split('__').at(-1):'',classified=canonicalQQToolName(canonical,args);
  if(['qq_self_change','qq_self_change_skill'].includes(original)&&!classified)return deny('BEHAVIOR_ARGUMENTS_INVALID','工具参数无效');
  const tool=classified??original;
  // args.ownerQQ/admin/role and other body claims never grant authority. The
  // existing backend capability switches and action guards remain authoritative.
  if(delegatedTools.has(tool)&&(!frame.administrator||!frame.hasCurrentRequest))return deny('BEHAVIOR_ADMIN_REQUEST_REQUIRED','需要管理员当前委托');
  return {allowed:true};
}
