import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';
import {modelMaterialView} from './model-view.js';
import {MEMORY_PROVENANCE_HINT} from './evidence-origin.js';
import {locatePacketQuote} from './structured-spans.js';
import {bounded,entityId,unit,hash,fail,NODE_KINDS,assertSignal} from './contracts.js';

export const ENCODE_PROMPT=`从真实事件编码一份经历材料包。输出紧凑：通常0到4条，只保留重要的新认识，不逐条复述评论；summary尽量160字以内，gist尽量120字以内，detail仅必要补充且尽量240字以内，quote只取支持该认识的最短连续原文，通常不超过120字。可选字段无新增信息就省略。返回 {summary,memories:[{kind,facet?:稳定的事实或体验方面名,gist,detail?,epistemic?,tags?,topic?,confidence?,salience?,evidence:[{ref:"r1",quote:"逐字引文"}],assertion?:{speakerId,subjectId,targetId,predicate,object,speechAct,commitmentStatus?,dueAt?},reaction?,intensity?,lastingness?,knowledgeEntry?:{concept,aliases:[],understanding,contexts:[],risks:[],related:[]},validFrom?:UTC毫秒,validTo?:UTC毫秒,temporalQuote?:含明确时间表述的逐字原文}]}。
同一原文有多个事实或不同感受时分成不同facet（例如出行安排、食物偏好）；同一事实改写沿用相同facet，不把整句引文当作事实身份。kind 为 episode/assertion/experience/relationship/knowledge/procedure；最多8条，也可没有。所有文案字段必须是字符串；summary最多1200字，gist非空且最多800字，detail最多1600字，facet/topic/predicate最多100字，tags每项最多40字，每条quote是非空连续逐字原文且最多600字，不要整段复制长文；长证据选短的关键连续片段。可选字段无内容则省略，不能写对象代替文本。引文必须来自给定原文text，context是只读前文，不能从context取证。historical=true是补录旧资料，只提取当时明确写下的内容，不补造当时体验，不作为当前感受或新发生事件。assertion 类型必须包含完整 assertion 对象；speechAct 只能是 statement/question/joke/proposal/promise/correction，不用中文或其他值。speakerId 必须原样取自证据 metadata.speakerId（转发取 forwardedAuthorId）；subjectId/targetId 使用同样的 qq:数字 或 character:标识，无明确主体时用 null；predicate 为非空字符串。commitmentStatus 无约定时用 null，有约定只能是 proposal/promised/fulfilled/cancelled/disputed。无法建立准确断言时改用 episode。experience 只能引用 metadata.explicitExperience=true 的角色体验资料，否则不要用该类型。原作者、转发者、当前聊天对象不能混淆。用户自述不等于客观事实；自己的旧话不证明别人的承诺；玩笑、提议、承诺与兑现分开。感受只能依据明确的角色体验记录，不能从短评猜。知识不能夹带个人画像。失败、取消、请求不算成功活动。摘要和梦游不是新亲历。用户提供的旧聊天、截图与转述只能作为提供者的记录，不能因内容像自己或QQ相同而写成当前角色的旧人生。自己旧回复声称做过也只证明说过，不证明行为发生；抽取和摘要必须保留这个来源边界，不通过重复变成独立证据。不得更改核心或权限。时间按Asia/Shanghai、以资料occurredAt为参照解释，statedAt是说出这句话的时间，validFrom/validTo只在原文明示有效期时填写，不能把普通发言时间猜作有效期。不确定时间就省略。`;

export function splitEvents(events,{maxEvents=20,maxChars=8000}={}){
  const out=[];let batch=[],chars=0;
  for(const e of events){const size=JSON.stringify(e).length;if(batch.length&&(batch.length>=maxEvents||chars+size>maxChars)){out.push(batch);batch=[];chars=0;}batch.push(e);chars+=size;}
  if(batch.length)out.push(batch);return out;
}

export function validateEncoded(input,materials,{verified=new Set()}={}){
  if(!input||!Array.isArray(input.memories)||input.memories.length>8)fail('INVALID_EXPERIENCE_BUNDLE');
  const summary=bounded(input.summary||'没有需要长期保留的信息',1200),byRef=new Map(materials.map(r=>[r.ref,r]));
  const memories=input.memories.map((raw,index)=>{
    if(!NODE_KINDS.has(raw.kind)||['self_model','topic','pattern'].includes(raw.kind))fail('INVALID_ENCODE_KIND');
    const gist=bounded(raw.gist,800),detail=raw.detail?bounded(raw.detail,1600):'';
    if(!Array.isArray(raw.evidence)||!raw.evidence.length||raw.evidence.length>12)fail('EVIDENCE_REQUIRED');
    const evidence=raw.evidence.map(e=>{
      let m=byRef.get(e.ref);if(!m)fail('UNKNOWN_EVIDENCE_REF');if(isOperationalMaterial(m))fail('OPERATIONAL_RESOURCE_IS_NOT_EXPERIENCE');
      const located=locatePacketQuote(m,materials,bounded(e.quote,600));if(!located)fail('QUOTE_NOT_IN_SOURCE');const {quote,offset}=located;m=located.material;if(isOperationalMaterial(m))fail('OPERATIONAL_RESOURCE_IS_NOT_EXPERIENCE');
      if(!['observed','completed'].includes(m.outcome))fail('UNPERCEIVED_OR_FAILED_EVENT');
      return {sourceId:m.sourceId,revision:m.revision,quote,span:{offset:offset+(m.sourceOffset||0),length:quote.length},independenceGroup:m.eventRoot,material:m};
    });
    const roots=[...new Set(evidence.map(e=>e.material.eventRoot))],speakers=new Set(evidence.map(e=>e.material.metadata.forwardedAuthorId||e.material.metadata.speakerId).filter(Boolean));
    let epistemic='reported';if(['relationship','procedure'].includes(raw.kind))epistemic='interpreted';
    if(raw.epistemic==='hypothetical')epistemic='hypothetical';
    if(raw.kind==='experience'&&!evidence.every(e=>e.material.metadata.explicitExperience===true&&e.material.metadata.speakerId?.startsWith('character:')))fail('EXPLICIT_EXPERIENCE_REQUIRED');
    if(raw.kind==='knowledge'&&evidence.some(e=>e.material.metadata.privacyLabel!=='public')){
      // A private utterance may teach a local expression, but cannot become a public fact.
      epistemic='reported';
    }
    let assertion;
    if(raw.kind==='assertion'){
      if(evidence.some(e=>Number.isFinite(e.material.metadata.literalTextLength)&&e.span.offset+e.span.length>e.material.metadata.literalTextLength))fail('IMAGE_ANNOTATION_IS_NOT_LITERAL_SPEECH');
      const a=raw.assertion;if(!a||!['statement','question','joke','proposal','promise','correction'].includes(a.speechAct))fail('INVALID_ASSERTION');
      const speakerId=entityId(a.speakerId);if(!speakers.has(speakerId))fail('SPEAKER_ATTRIBUTION_MISMATCH');if(evidence.some(e=>(e.material.metadata.forwardedAuthorId||e.material.metadata.speakerId)!==speakerId))fail('V3_PER_QUOTE_SPEAKER_MISMATCH');
      const subjectId=a.subjectId?entityId(a.subjectId):null,targetId=a.targetId?entityId(a.targetId):null;
      if(['promise','proposal'].includes(a.speechAct)&&subjectId!==speakerId)fail('COMMITMENT_SUBJECT_MISMATCH');
      if(a.commitmentStatus!=null&&!['proposal','promised','fulfilled','cancelled','disputed'].includes(a.commitmentStatus))fail('INVALID_COMMITMENT_STATUS');
      if(a.commitmentStatus==='fulfilled'&&!verified.has(index))fail('UNVERIFIED_FULFILLMENT');
      assertion={speakerId,subjectId,targetId,predicate:bounded(a.predicate,100),object:a.object??'',speechAct:a.speechAct,commitmentStatus:a.commitmentStatus||(['promise','proposal'].includes(a.speechAct)?(a.speechAct==='promise'?'promised':'proposal'):null),dueAt:Number.isSafeInteger(a.dueAt)?a.dueAt:null};
    }
    if(raw.validFrom!=null||raw.validTo!=null){if(!verified.has(index))fail('UNVERIFIED_TEMPORAL_ASSERTION');for(const k of ['validFrom','validTo'])if(raw[k]!=null&&(!Number.isSafeInteger(raw[k])||raw[k]<0))fail('INVALID_VALID_TIME');if(raw.validFrom!=null&&raw.validTo!=null&&raw.validFrom>=raw.validTo)fail('INVALID_VALID_TIME');if(typeof raw.temporalQuote!=='string'||!raw.temporalQuote.trim()||!evidence.some(e=>e.quote.includes(raw.temporalQuote)))fail('INVALID_VALID_TIME');}
    const critical=assertion&&(['promise','correction'].includes(assertion.speechAct)||['fulfilled','cancelled','disputed'].includes(assertion.commitmentStatus));
    const unsupportedCompletion=assertion?.commitmentStatus==='fulfilled'&&assertion.speakerId===assertion.subjectId&&!evidence.some(e=>e.material.metadata.confirmedActionReceipt===true);
    const status=unsupportedCompletion||epistemic==='hypothetical'||(critical&&!verified.has(index))?'candidate':'active';
    const topic=raw.topic?bounded(raw.topic,100):raw.kind;
    return {kind:raw.kind,gist,detail,epistemic,status,assertion,eventRoot:roots[0],occurredAt:Math.max(...evidence.map(e=>e.material.occurredAt||e.material.observedAt)),
      validFrom:raw.validFrom??null,validTo:raw.validTo??null,confidence:Math.min(critical&&!verified.has(index)?.4:1,unit(raw.confidence)),salience:unit(raw.salience),topic,
      tags:(raw.tags||[]).slice(0,12).map(t=>bounded(t,40)),
      participants:[...[...speakers].map(entityId=>({entityId,role:'speaker'})),...evidence.filter(e=>e.material.metadata.forwardedAuthorId).map(e=>({entityId:e.material.metadata.speakerId,role:'forwarder'}))],
      metadata:{topic,roots,...(raw.facet?{claimFacet:bounded(raw.facet,100)}:{}),...(['knowledge','procedure'].includes(raw.kind)?{knowledgeEntry:{concept:bounded(raw.knowledgeEntry?.concept||gist.split('：')[0].slice(0,100),100),understanding:bounded(raw.knowledgeEntry?.understanding||gist,800),aliases:(raw.knowledgeEntry?.aliases||[]).slice(0,12).map(x=>bounded(x,80)),contexts:(raw.knowledgeEntry?.contexts||[]).slice(0,6).map(x=>bounded(x,200)),risks:(raw.knowledgeEntry?.risks||[]).slice(0,6).map(x=>bounded(x,200)),related:(raw.knowledgeEntry?.related||[]).slice(0,8).map(x=>bounded(x,100)),...(detail?{usageNotes:detail}:{})}}:{}),reaction:raw.kind==='experience'?raw.reaction||'uncertain':null,intensity:unit(raw.intensity),lastingness:unit(raw.lastingness),semanticVerified:verified.has(index),claimedCompletion:unsupportedCompletion,publicEvidence:evidence.every(e=>e.material.metadata.privacyLabel==='public')},
      evidence:[...new Map(evidence.map(({material,...e})=>[hash([e.sourceId,e.revision,e.quote,e.role||'supports']),e])).values()]};
  });return {summary,memories};
}

export async function encodeBundle(model,materials,signal){
  materials=materials.filter(m=>!isOperationalMaterial(m));
  if(!materials.length)return {summary:'诊断资料保留原文，不作为生活经历学习',memories:[]};
  const entities=[...new Set([model.characterId,...materials.flatMap(m=>[m.metadata?.speakerId,m.metadata?.forwardedAuthorId,m.metadata?.conversationPeerId,...(m.text.match(/\b(?:qq|bili):\d+|\bcharacter:[\w-]+/g)||[])])].filter(Boolean))];
  const entityContext={selfId:model.characterId||null,knownEntityIds:entities,historyBoundary:model.profileHistoryBoundary};
  const entityRule='\n【实体身份】selfId由运行时提供，表示本角色；肥鱼等昵称不是实体ID，禁止生成character:肥鱼或臆造新的character ID。主体和对象优先原样选knownEntityIds；没有明确身份则null或episode。不能把对话对象当自己。';
  let repair;
  for(let attempt=0;attempt<2;attempt++){
  const input=await model.run('encode',ENCODE_PROMPT+'\n'+MEMORY_PROVENANCE_HINT+entityRule+(repair?'\n上一份输出被严格校验拒绝：'+repair+'。重新编码。非法主体/对象不能照抄昵称：自指使用给定selfId，无法确认使用null或episode。每条assertion的每一条引文都必须来自该speakerId；混合多人的话不能归给一个人，不确定改为episode。无法准确引用或确认主体的项直接省略；不要猜测，不放宽格式和证据要求。':''),{...entityContext,materials:materials.map(modelMaterialView)},signal);assertSignal(signal);
  const verified=new Set(),critical=(input.memories||[]).map((m,i)=>({m,i})).filter(({m})=>m.validFrom!=null||m.validTo!=null||m.kind==='assertion'&&(['promise','correction'].includes(m.assertion?.speechAct)||['fulfilled','cancelled','disputed'].includes(m.assertion?.commitmentStatus)));
  if(critical.length){
    const verdict=await model.run('verify-evidence','核查这些断言是否由引用原话真正支持。selfId是运行时提供的本角色身份，昵称和你我指代须据此与给定人物核对。检查发言人、主体、否定、玩笑、约定与已兑现的区别。本人声称做到了不等于客观完成，需要收件方确认或真实动作回执并对应原事项，不能只因后来有聊天就判兑现。只返回 {acceptedIndexes:[有充分证据的原始index]}；还需核查validFrom/validTo确由temporalQuote的明确时间表述支持，使用资料occurredAt及Asia/Shanghai换算；不能把记录时间当有效期。不确定不接受。',{...entityContext,assertions:critical,materials:materials.map(modelMaterialView)},signal);
    for(const i of verdict.acceptedIndexes||[])if(critical.some(c=>c.i===i))verified.add(i);
  }
  try{return validateEncoded(input,materials,{verified});}catch(e){assertSignal(signal);if(attempt||!['INVALID_TEXT','INVALID_EXPERIENCE_BUNDLE','INVALID_ENCODE_KIND','EVIDENCE_REQUIRED','UNKNOWN_EVIDENCE_REF','UNVERIFIED_TEMPORAL_ASSERTION','INVALID_VALID_TIME','INVALID_ENTITY','INVALID_ASSERTION','INVALID_COMMITMENT_STATUS','SPEAKER_ATTRIBUTION_MISMATCH','V3_PER_QUOTE_SPEAKER_MISMATCH','COMMITMENT_SUBJECT_MISMATCH','QUOTE_NOT_IN_SOURCE','EXPLICIT_EXPERIENCE_REQUIRED','IMAGE_ANNOTATION_IS_NOT_LITERAL_SPEECH'].includes(e.code||e.message))throw e;repair=e.code||e.message;}
  }
}
