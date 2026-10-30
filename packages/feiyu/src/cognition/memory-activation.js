import {hash,clip,terms} from './contracts.js';
import {memoryLearningEligible} from '../operational-material.js';
import {memoryEvidenceOrigin} from './evidence-origin.js';
import {selfUnderstandingModelView} from './model-view.js';
import {tuningFor} from '../runtime-tuning.js';

export const PREFERENCE_MEMORY_HINT='【兴趣、经历与念头分开】interest只保留自己被什么吸引或排斥、吸引点与顾虑、认识范围及尚不知道的部分。它是有来源、可修正的偏好，不是活动流水账。第一次真实触动也可形成小范围、暂定的好奇，不按次数或天数升级。读前瞻、听别人介绍与亲自尝试分清；看视频不能记成自己玩过。只有形成新偏好或吸引点、保留意见真的变化时才提交interest；再次提及、分享出去、对方回应开心、现在想做什么，都不自动改变兴趣。具体经历保存在已有原始观察/experience记忆；愿意分享写changes中的motive（motiveKind=share，给真实来源和相关人物），没有必要可不写。偏好与经历、人物、念头通过记忆ID及来源关联，不能互相冒充。before/recalled里出现过某兴趣不要求本轮续聊；当前话题改变时先接当前内容。';

export function currentTopicCue(text=''){
 const s=String(text).trim(),shift=/(?:先不(?:聊|说|谈)|不聊.{0,40}了|换个话题|(?:别再|不要再)(?:聊|说|谈)|不用继续)/u;
 const parts=s.split(/[，,。；;\n]/u);const cut=parts.findIndex(p=>shift.test(p));
 if(cut>=0)return {query:parts.slice(cut+1).join('，').trim().slice(0,800),changed:true,usesRecent:false};
 const elliptical=/^(?:嗯[嗯呢啊]?|然后呢|继续|那个呢|说说看|怎么说|为什么[呢啊]?|还有呢|它呢|这是什么意思)[？?。!！\s]*$/u.test(s);
 return {query:s.slice(0,800),changed:false,usesRecent:elliptical};
}

export function contextualMemoryView(runtime,m,{chars=220,expressionScope,person,query=''}={}){
 if((expressionScope||person)&&!selfUnderstandingApplies(m,{expressionScope,person,query}))return null;
 chars=Math.min(chars,tuningFor(runtime).text.memoryGistChars);
 const d=m.metadata?.disposition;
 return {id:m.id,revision:m.revision,gist:clip(m.gist,chars),kind:m.kind,people:m.participants.map(p=>p.entity_id),epistemic:m.epistemic,occurredAt:m.occurred_at,evidenceOrigin:memoryEvidenceOrigin(m,{archive:runtime.archive,characterId:runtime.characterId}),...(m.metadata?.expressionFeedback?{expressionFeedback:{...m.metadata.expressionFeedback,referenceOnly:true,notGlobalInstruction:m.metadata.expressionFeedback.target!=='self'}}:{}),...(m.metadata?.selfUnderstanding?{selfUnderstanding:selfUnderstandingModelView(m.metadata.selfUnderstanding),interpretation:'scoped-subjective-self-understanding-not-current-task-or-person-rule'}:{}),...(d?{subjectId:runtime.characterId,disposition:{kind:d.kind,target:d.target,facet:d.facet,...(d.preference?{preference:d.preference}:{})},interpretation:'subjective-memory-not-current-task-or-person-fact'}:{})};
}

// An internally evoked memory remains a reference. It is neither a new event,
// a separate interest store nor a selected activity. Selection is soft and can
// return the same memory; it never commands interest rotation or social action.
export function spontaneousMemoryCue(runtime){
 const s=runtime.store,inner=runtime.inner,old=inner.meta('spontaneousRecallV1')||{sequence:0,recent:[]},sequence=old.sequence+1;
 const pivot='memory:'+hash([runtime.characterId,sequence,runtime.now()]).slice(0,32);
 const sql="SELECT memory_id FROM memory_nodes WHERE character_id=? AND status='active' AND kind IN ('experience','self_model','knowledge','pattern','relationship') AND memory_id>=? ORDER BY memory_id LIMIT 32";
 const ids=s.db.prepare(sql).all(runtime.characterId,pivot);if(ids.length<32)ids.push(...s.db.prepare(sql).all(runtime.characterId,'').slice(0,32-ids.length));
 const candidates=[...new Set(ids.map(x=>x.memory_id))].map(id=>s.get(id)).filter(m=>m&&memoryLearningEligible(runtime.archive,m)&&!s.nodeSuppressed(m.id)&&!m.metadata.expressionFeedback&&!m.metadata.protected&&m.evidence?.length);
 const ranked=candidates.map(m=>{const recent=old.recent.filter(id=>id===m.id).length,weight=(.4+Math.max(0,Number(m.salience)||.5))/(1+recent*.7),u=(parseInt(hash([sequence,pivot,m.id]).slice(0,8),16)+1)/4294967297;return {m,draw:-Math.log(u)/weight};}).sort((a,b)=>a.draw-b.draw);
 const m=ranked[0]?.m;inner.meta('spontaneousRecallV1',{sequence,at:runtime.now(),recent:m?[...old.recent,m.id].slice(-12):old.recent,selectedId:m?.id||null,referenceOnly:true,actionSelected:false});
 if(!m)return null;const d=m.metadata?.disposition;return {memoryId:m.id,revision:m.revision,query:[d?.target,d?.facet,m.gist].filter(Boolean).join(' ').slice(0,650),referenceOnly:true,notNewExperience:true,notAnAction:true};
}

export function isInterestMemory(memory){return memory?.metadata?.disposition?.kind==='interest';}

// Generic self-description words must not make every preference relevant to
// every question about "what you like". Semantic hits and supported graph
// paths remain separate admissible routes; this only qualifies lexical cues.
const genericPreferenceWords=new Set(['自己','喜欢','兴趣','觉得','想法','什么','怎么','现在','今天','最近','目前','之前','这回','上回','以后','当时','时候','东西','一点','愿意','没有','不会','不是','可以','一起','我们','对方','感觉','好奇','想看','视频','看过','玩过','了解','实际','确实','有点','还有','还是','不用','不急','这个','那个','那段','我的','你的','本来','一些','有些','也是','就是','究竟','了吗','吗','呢']);
export function lexicalInterestRelevant(memory,query){
 const cues=new Set(terms(query).filter(t=>!genericPreferenceWords.has(t)));if(!cues.size)return true;
 const d=memory.metadata?.disposition;return terms([d?.target,d?.facet,memory.gist].filter(Boolean).join(' ')).some(t=>cues.has(t));
}

export function expressionFeedbackApplies(memory,scope){const target=memory?.metadata?.expressionFeedback?.target;return !target||target==='self'||target===scope;}

// Internal association may inspect a local self-understanding as a reference.
// Expression projections require its actual person/situation scope. Ordinary
// cross-person episodes/interests are deliberately unaffected by this rule.
export function selfUnderstandingApplies(memory,{expressionScope,person,query='',internalReference=false}={}){
 const u=memory?.metadata?.selfUnderstanding;if(!u)return true;
 if(internalReference||expressionScope==='self'&&!person)return true;
 const scope=selfUnderstandingModelView(u)?.scope;if(!scope)return false;
 const current=person||(/^private:\d+$/.test(expressionScope||'')?'qq:'+expressionScope.slice(8):/^(?:qq:|wechat:)/.test(expressionScope||'')?expressionScope:null);
 if(scope.general)return scope.people.length===0;
 if(scope.people.length)return !!current&&scope.people.includes(current);
 const cues=new Set(terms(String(query)));return cues.size>0&&scope.situations.some(s=>terms(s).some(t=>cues.has(t)));
}
