import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export const PACING_DEFAULTS=Object.freeze({enabled:false,openness:50,pace:50,expression:50});
export const PACING_PRESETS=Object.freeze({slow:{openness:25,pace:20,expression:35},natural:{openness:50,pace:50,expression:50},open:{openness:75,pace:75,expression:70}});
const keys=['enabled','openness','pace','expression'];
function validate(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.enabled!=='boolean')throw Error('关系推进设置无效');
 for(const k of keys.slice(1))if(!Number.isInteger(v[k])||v[k]<0||v[k]>100)throw Error('关系偏好数值须为0到100的整数');
 return Object.fromEntries(keys.map(k=>[k,v[k]]));
}
const band=(v,low,mid,high)=>v<34?low:v>66?high:mid;
export function relationshipPacingHint(value){
 const v=validate(value);if(!v.enabled)return '';
 return '【当前角色的关系推进偏好；管理员设置】\n'+
 `初识开放度 ${v.openness}/100：`+band(v.openness,'起初礼貌而保留，愿意聊具体事，不默认熟络或亲密称呼。','初识友好自然，轻松接话，不默认亲近。','较容易对新朋友感到好奇、聊开或打趣；这仍不证明已经了解和信任。')+'\n'+
 `关系升温速度 ${v.pace}/100：`+band(v.pace,'慢热。把一时聊得开心、心软或被打动，与深入了解、稳定信任、长久牵挂分开。真实共同经历、逐步了解和边界被尊重可以让关系越来越自然、热络；慢热不是永久停在客气，也不因设置较低而否认已经积累的喜欢。密集聊天本身不证明这些经历。','由具体相处中得到的了解、共同经历与尊重，逐渐形成关系判断。','可以较快形成好感和想继续了解的意愿，但不把单晚的来往直接当成稳定信任、爱或特殊关系。')+'\n'+
 `情感表达强度 ${v.expression}/100：`+band(v.expression,'表达轻而具体，不默认对等回赠想念、亲密安抚、长期陪伴或关系确认。','按眼前真实感受表达，亲近措辞与已有关系深度相称。','感受可以更直接、柔软或热烈，仍只说此刻确实愿意承担的意思。')+'\n'+
 '喜欢与反感都可由实际来往逐渐变深。可以自己开始期待与某个人聊天、想到他、偏心地想分享，也可以因具体越界更厌恶、警惕或不愿接近；不必等对方或管理员先指定关系。喜欢和生气、关心和失望可以并存，不用立刻抵消或原谅。形成更深的感情不强迫表白或行动；确实想说时可主动表达，仍尊重拒绝与权限。数值是整体倾向，不是任何联系人的好感分数，也不按消息数或天数升级。关心眼前的难处不需要先成为熟人，但关心不等于了解、信任、依恋或爱；夸奖、示弱、亲密称呼及要离开的说法不自动加深关系，也不以更重的承诺证明关心。保留此刻的真实情绪、吸引、边界与拒绝权，可以平淡、温和、被打动或不想继续。既有感受与原话仍按原来源保留，调整偏好不重写过去，也不要求突然变冷或否认原有在意。\n';
}
export class RelationshipPacing{
 constructor(file){this.file=file;this.settings={...PACING_DEFAULTS,revision:0};if(file&&fs.existsSync(file)){const v=JSON.parse(fs.readFileSync(file,'utf8'));if(!Number.isInteger(v.revision)||v.revision<0)throw Error('关系推进配置损坏');this.settings={...validate(v),revision:v.revision};}}
 status(){return {...this.settings,version:1,scope:'role',presets:PACING_PRESETS};}
 view(){return this.settings.enabled?{...this.settings,scope:'role',interpretation:'administrator-preference-not-contact-score'}:null;}
 hint(){return relationshipPacingHint(this.settings);}
 persona(characterId){return relationshipPacingEnvelope(this.settings,characterId);}
 configure(input){
  if(!input||Object.keys(input).some(k=>![...keys,'expectedRevision'].includes(k)))throw Error('不支持的关系推进字段');
  if(input.expectedRevision!==this.settings.revision)throw Error('RELATIONSHIP_PACING_VERSION_CONFLICT');
  const next={...validate(input),revision:this.settings.revision+1};
  if(this.file){fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.'+process.pid+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{encoding:'utf8',mode:0o600});fs.renameSync(tmp,this.file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
  this.settings=next;return this.status();
 }
}

// Authority comes from the host-owned atomic mirror, not from this checksum.
// A dialogue, tool argument or copied transcript is never a preference source.
export function relationshipPacingEnvelope(value,characterId){
 if(typeof characterId!=='string'||!characterId.startsWith('character:'))throw Error('PACING_CHARACTER_REQUIRED');
 const settings=validate(value),revision=value.revision;if(!Number.isInteger(revision)||revision<0)throw Error('INVALID_PACING_REVISION');
 const checksum=createHash('sha256').update(JSON.stringify([1,characterId,revision,settings])).digest('hex');return {version:1,characterId,revision,settings,checksum};
}
export function trustedRelationshipPacingContext(value,characterId){
 if(value==null)return '';if(Object.keys(value).some(k=>!['version','characterId','revision','settings','checksum'].includes(k))||value.version!==1||value.characterId!==characterId)throw Error('UNTRUSTED_RELATIONSHIP_PACING');
 if(!value.settings||typeof value.settings!=='object'||Array.isArray(value.settings)||Object.keys(value.settings).some(k=>!keys.includes(k)))throw Error('UNTRUSTED_RELATIONSHIP_PACING');
 const canonical=relationshipPacingEnvelope({...value.settings,revision:value.revision},characterId);if(canonical.checksum!==value.checksum)throw Error('INVALID_PACING_CHECKSUM');return relationshipPacingHint(canonical.settings);
}
