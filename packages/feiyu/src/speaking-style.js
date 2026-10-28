import {selectRoleText} from './role-card.js';
import {terms} from './cognition/contracts.js';
export const SPEAKING_STYLE_MAX_CHARS=550;
// The trusted system view preserves a role's complete, administrator-authored
// style. The smaller 550-character view remains for bounded legacy/channel
// context consumers; it must not silently discard the new role's main rules.
export const TRUSTED_SPEAKING_STYLE_MAX_CHARS=3000;
export function trustedSpeakingStyleContext(style){
  if(style===undefined)return '';
  if(typeof style!=='string'||style.length>TRUSTED_SPEAKING_STYLE_MAX_CHARS)throw Error('Invalid trusted speaking style');
  const text=selectRoleText(style,'v2').trim();
  if(!text)return '';
  return '【本角色说话方式；由当前角色卡提供】\n'+text+'\n本节只约束表达，不改变事实、身份、记忆归属或工具权限。示例只作语感参考，不是本角色真实发生过的经历。';
}
const RESPONSE_PRINCIPLE='表达自己的当下反应，不默认复述材料、逐项点评或总结情绪成因；明确求解时保留必要解释。';
const antiReport=/(?:不|别|少)[^。！？；\n]{0,45}(?:复述|总结|逐项点评|报告|观后感|说明书|完整论述)/;
const sentences=text=>String(text).match(/[^。！？；]+[。！？；]?/gu)||[];
function fitText(text,max){let out='';for(const ch of String(text)){if(out.length+ch.length>max)break;out+=ch;}return out;}
function fitRule(text,max){let out='';for(const sentence of sentences(text)){if(out.length+sentence.length>max)break;out+=sentence;}return out||fitText(text,max);}
function exampleContext(line){
  const arrow=line.indexOf('→');if(arrow>0&&line.slice(arrow+1).trim())return line.slice(0,arrow).trim();
  const contextual=/^(.{2,80}?)[：:]\s*(\S.+)$/.exec(line);
  return contextual&&!/^(?:示例|例子|说明|提示|注意|台词)$/.test(contextual[1].trim())?contextual[1].trim():null;
}
// A one-time, reviewable migration of the three old default performance rules.
// Other role text, examples and memories remain verbatim.
export function relaxPerformativeStyle(text){return String(text).replaceAll('傲娇嘴硬但有主见；','有主见，也有嘴硬的时候；').replaceAll('被熟人损时通常顺势顶一句，也能承认翻车','被熟人调侃时按具体语境接话，可以顶一句、直接认同或承认翻车').replaceAll('被夸会暗爽或装作不在意，吃瘪会顶半句，也能认栽。','被夸会开心，也可能嘴硬；吃瘪可以承认，也可能不想接。');}
// Role-owned style stays inside the card; never inferred from other characters.
export function splitSpeakingStyle(card='') {
  const core=[], style=[]; let depth=0;
  for(const line of String(card).split('\n')) {
    const h=/^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if(h && depth && h[1].length<=depth) depth=0;
    if(h && /^说话方式(?:\s*[〔\[].*)?$/.test(h[2])) {depth=h[1].length;continue;}
    (depth?style:core).push(line);
  }
  return {core:core.join('\n').trim(),style:style.join('\n').trim()};
}
export function validateSpeakingStyle(text) {
  if(typeof text!=='string'||text.length>3000)throw Error('说话方式最多3000字');
  if(/^#{1,2}\s/m.test(text))throw Error('说话方式内部标题请用三级标题（###）');
  return text.trim();
}
export function replaceSpeakingStyle(card,style) {
  const core=splitSpeakingStyle(card).core,value=validateSpeakingStyle(style);
  return core+(value?'\n\n## 说话方式\n'+value:'')+'\n';
}
export function speakingStyleContext(card,policy={}) {
  const selected=selectRoleText(String(card),'v2'),style=policy.styleOnly?selected:splitSpeakingStyle(selected).style;if(!style)return '';
  const parts=style.split(/^###\s+(?:示例|情境示例)\s*$/m);
  const rules=parts[0].trim();
  if(policy.selection==='inner-v3'){
    const cues=String(policy.incoming||''),q=new Set(terms(cues)),lines=rules.split('\n').map(s=>s.trim()).filter(s=>s&&!/^###/.test(s));
    if(/b23\.tv|bilibili\.com|BV[0-9A-Za-z]{10}/.test(cues))q.add('视频');
    const ranked=lines.map((line,index)=>({line,index,score:terms(line).filter(t=>q.has(t)).length})).sort((a,b)=>b.score-a.score||a.index-b.index);
    // Anti-report principles are independent of keyword similarity. Keep their
    // actual sentence, even when a topical line or example ranks higher.
    const principleIndex=lines.findIndex(line=>antiReport.test(line)),specific=principleIndex<0?null:sentences(lines[principleIndex]).find(sentence=>antiReport.test(sentence));
    const principle=specific&&specific.length<=180?specific:RESPONSE_PRINCIPLE;
    const example=parts.slice(1).join('\n').split('\n').map(s=>s.trim()).map((line,index)=>{const context=exampleContext(line);return {line,index,score:context?terms(context).filter(t=>q.has(t)).length:0};}).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.index-b.index)[0];
    const header='【角色说话方式；语感参考，可以不用】\n',examplePart=example?'\n本轮相关示例，只参考情境和语气，不照抄：\n'+fitText(example.line,140):'',budget=SPEAKING_STYLE_MAX_CHARS-header.length-examplePart.length-1;
    const anchor=fitRule(lines[0]||rules,Math.min(170,budget-principle.length-1)),selected=anchor?[anchor]:[];
    if(!anchor.includes(principle))selected.push(principle);
    const related=ranked.find(r=>r.index!==0&&r.index!==principleIndex&&r.score>0),remaining=budget-selected.join('\n').length-1;
    if(related&&remaining>0){const cue=fitRule(related.line,Math.min(170,remaining));if(cue)selected.push(cue);}
    return header+selected.join('\n')+examplePart+'\n';
  }
  const examples=(policy.selection==='inner-v3'||Number(policy.score??60)>=60)&&parts[1]?'\n示例仅供参考，不复读，不把每句话都写成包袱：\n'+parts.slice(1).join('\n').trim():'';
  return '【角色说话方式】\n'+rules+examples+(policy.selection==='inner-v3'?'\n表达来自此刻在意的事、关系想法和精力感受，自行决定长短、条数或不回复；保留事实与记忆归属。\n\n':'\n亲密度、精力决定愿不愿意聊、长度和条数；本节只管表达，不改变事实、权限、记忆归属或语音规则。\n\n');
}
