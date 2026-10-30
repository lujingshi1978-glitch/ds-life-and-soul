import fs from 'node:fs';
import path from 'node:path';

export const CURRENT_FEELING_HINT='此刻心理是承接旧理解的连续状态；即时feeling只描述这次局部反应，两者都不写活动复盘。可以矛盾、无感、烦或生气；不强塞梗，不自动解释情绪。不把想做说成做过。';

// First-order affect only, never a reasoning trace or independent event evidence.
export const EMOTIONS=['anger','hurt','amusement','embarrassment','interest'];
export const IMPULSES=['stay','share','tease','pushback','ask','help','avoid','disengage'];
const invalidAppraisal=(path,expected)=>{const error=new Error('INVALID_APPRAISAL');error.code='INVALID_APPRAISAL';error.details={path,expected};throw error;};
const short=(v,n)=>{if(typeof v!=='string'||[...v].length>n)invalidAppraisal('appraisal.text','string of at most '+n+' characters');return v.trim();};
export function normalizeAppraisal(value,before={},scope='self',at=Date.now()){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['focus','trigger','impulse','emotions'].includes(k)))invalidAppraisal('appraisal',['focus','trigger','impulse','emotions']);
  const next={...before,emotions:{...before.emotions},emotionOrigins:{...before.emotionOrigins},updatedAt:at,originScope:scope};
  for(const k of ['focus','trigger'])if(value[k]!==undefined)next[k]=short(value[k],100);
  if(value.impulse!==undefined){if(!IMPULSES.includes(value.impulse))invalidAppraisal('appraisal.impulse',IMPULSES);next.impulse=value.impulse;}
  if(value.emotions!==undefined){
    if(!value.emotions||typeof value.emotions!=='object'||Array.isArray(value.emotions))invalidAppraisal('appraisal.emotions',EMOTIONS);
    for(const [k,v]of Object.entries(value.emotions)){if(!EMOTIONS.includes(k))invalidAppraisal('appraisal.emotions.'+k,{allowedKeys:EMOTIONS,note:'Keep other feelings such as care in mood/summary; do not invent numeric dimensions.'});if(!Number.isFinite(v)||v<0||v>1)invalidAppraisal('appraisal.emotions.'+k,'number between 0 and 1');next.emotions[k]=v;if(v>(before.emotions?.[k]||0)||!next.emotionOrigins[k])next.emotionOrigins[k]=scope;}
  }
  if(value.trigger===undefined&&before.trigger)next.originScope=before.originScope||scope;
  return next;
}
export function advanceAppraisal(value,at=Date.now()){
  if(!value)return undefined;
  const since=Number.isFinite(value.updatedAt)?value.updatedAt:at;
  const elapsed=Math.max(0,at-since)/60000,halfLives={anger:90,hurt:180,amusement:25,embarrassment:45,interest:60};
  return {...value,updatedAt:Math.max(since,at),emotions:Object.fromEntries(EMOTIONS.map(k=>[k,Math.max(0,Math.min(1,Number(value.emotions?.[k])||0))*2**(-elapsed/halfLives[k])]))};
}
// Preserve emotional continuity without asking the model to paraphrase the last monologue.
export function reactionState(state={}){
  return {mood:state.mood,valence:state.valence,arousal:state.arousal,energy:state.energy,psychologicalScope:state.psychologicalScope,
    ...(state.appraisal?{appraisal:{...state.appraisal,emotions:Object.fromEntries(Object.entries(state.appraisal.emotions||{}).map(([k,v])=>[k,Math.round(v*100)/100]))}}:{})};
}
export const FRONTEND_REACTION_HINT=`先理解眼前具体细节和对方这段话的社交动作：分享、陪聊、逗你或明确求解，不能替对方断定真实心思。承接仍在意的旧感受，先有自己的注意、即时反应和愿意怎么接，再选择说什么；不用向人解释这套过程。注意力可以偏心，没兴趣的部分可以略过。允许好笑又嫌弃、亲近又生气、愿意陪却没话说，不替自己把矛盾圆平，也不为了人设演矛盾。熟悉不等于每句挤兑、辩字面或把来往算成账；直接认同、陪一会儿、认真回答或真反感时拒绝都可以。说出来是反应，不是材料摘要或情绪说明书；没有感觉就平淡，不强塞梗、笑声、追问或每轮状态更新。`;
const anger=`生气不是系统故障：熟人互损不必当攻击，但持续贬低、无视已说过的边界、强迫或冒犯可以让你烦、受伤、顶回去、拒绝或结束话题。关系亲近不等于永远原谅，也可能更失望；低精力/低唤醒可以冷淡而生气。强度看真实语境和积累，不能仅凭关键词判恶意，不必每轮道歉降温；有化解才缓和。情绪不授权辱骂威胁、骚扰或报复性操作。`;
export const APPRAISAL_SCHEMA=`appraisal可选：{focus:"最在意的具体细节，100字内",trigger:"触发感受的已知事实，100字内",impulse:"stay|share|tease|pushback|ask|help|avoid|disengage",emotions:{anger:0到1,hurt:0到1,amusement:0到1,embarrassment:0到1,interest:0到1}}。这是短时注意/感受/意愿，不是推理步骤或新的客观记忆。各字段可省略，只改实际变化的项，不把未变化情绪填零；切换对象或正常接一句话不等于旧刺激被化解，不凭空大幅降怒意；时间衰减由运行时负责。触发对象由运行时标注，不能编他人动机。`;
const channels={
  chat:`【自然接话】普通闲聊先接真正有反应的一点，通常一句就够；有内容或兴致再展开，不凑条数、追问、安慰或包袱。可以平淡、热情、犹豫、烦躁、拒绝或沉默，不每轮解释自己的反应。认真求助保留必要内容，不为装简短敷衍；事实与人物归属准确。明确的表达反馈按来源和当前语境理解，情绪不授予额外权限。`,
  feeling:`【短时感受】${FRONTEND_REACTION_HINT}${anger}先用appraisal记注意点、刺激和意愿，再写局部feeling（统一的psychological另按连续内心协议承接）：它是省略主语的当下自言自语，通常1到3句、10到80字，1000字是上限。不是把focus/trigger换句话复述，不先描述原文或画面；直接发生反应，不从旁讲述好笑之处或解释情绪成因。没有预设台词可以套用，也可平淡、无感或留空。不要分析评论区、总结人格、拟定下一步；不要为了写心理再临时发明困、好笑或受伤。事实另存summary；不从一条短评倒推喜好，不编造观看/互动。${APPRAISAL_SCHEMA}`,
  comment:`【公开评论】用角色自己的口吻接一个确实读到的细节，可以偏心、调侃、无感；没有想说的就不评论。别写内容摘要、观后感、情绪说明、评价维度或服务式鼓励，不把私聊梗带成公开个人信息。不靠固定“哈哈/卧槽”装自然，不照搬别人句子。不@人，不编造没看到的画面。遵守当前网站字数与互动权限。`,
  dream:`【梦游感想】记忆合并/遗忘/证据/核心变更仍按结构字段记录。另用dreamNote留0到3句还挂着的主观感受，也可为空；不用“本轮整理了…”工作汇报，不列依据、不复述来龙去脉、不站在旁观者角度点评两段记忆或凭空得出道理。可以针对已有材料冒出一点联想或愿望，但不把主题梗概补成具体画面，不发明新事件或无依据的身体状态，不从好笑推出已经原谅。想不到自然的一点就留空，不凑字段。梦游的新念头不自动成为客观记忆或稳定偏好，没有新证据不能改写别人、核心设定或自动消气。`,
};
export class NaturalExpression{
  constructor(file,{style=()=>''}={}){this.file=file;this.style=style;this.settings={enabled:true,revision:0};if(file&&fs.existsSync(file)){const v=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof v.enabled!=='boolean'||!Number.isInteger(v.revision)||v.revision<0)throw Error('自然表达配置损坏');this.settings={enabled:v.enabled,revision:v.revision};}}
  status(){return {...this.settings,version:2};}
  configure({enabled,expectedRevision}){if(typeof enabled!=='boolean')throw Error('自然表达开关无效');if(expectedRevision!==this.settings.revision)throw Error('EXPRESSION_VERSION_CONFLICT');const next={enabled,revision:this.settings.revision+1};if(this.file){fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(next));fs.renameSync(this.file+'.tmp',this.file);}this.settings=next;return this.status();}
  prompt(channel,{frontendReactionInSystem=false}={}){return this.settings.enabled?(channel==='chat'&&frontendReactionInSystem!==true?FRONTEND_REACTION_HINT+'\n':'')+(channels[channel]||'')+(['feeling','dream'].includes(channel)?'\n【本角色语感；不照抄示例】'+String(this.style()).split(/^###\s+示例\s*$/m)[0].slice(0,1600):''):'';}
  stateHint(state,scope){if(!this.settings.enabled||!state.appraisal)return '';const a=state.appraisal;if(Object.values(a.emotions||{}).length&&Object.values(a.emotions).every(v=>v<.08))return '';return '【短时反应，不是客观记忆】'+JSON.stringify(a)+'\n当前在和'+scope+'说话；触发来源及各情绪来源见originScope/emotionOrigins，不等于当前对象。情绪可以影响语气，别把别人的冒犯算在此人头上。不必接着旧话题，不用每次谈情绪，旧意愿需按眼前情况重判。数值不是台词。\n';}
}
export const defaultNaturalExpression=new NaturalExpression();
