import {fail,json,clip} from './contracts.js';
import {tuningFor} from '../runtime-tuning.js';

// A continuous summary can be inherited from before. It is not the payload of
// every later feeling update. Archive only fields supplied in this invocation,
// with host-normalized values where applicable, not a replay of old context.
export function feelingExperienceText(input,{appraisal}={}){
  const fields={};
  for(const name of ['psychological','psychology','psyche','dispositions','mood','valence','arousal']){
    if(Object.hasOwn(input,name)&&input[name]!==undefined)fields[name]=name==='mood'?clip(input.mood,120):structuredClone(input[name]);
  }
  if(Object.hasOwn(input,'appraisal')&&input.appraisal!==undefined){
    const selected={};
    for(const name of ['focus','trigger','impulse'])if(Object.hasOwn(input.appraisal,name))selected[name]=appraisal[name];
    if(Object.hasOwn(input.appraisal,'emotions'))selected.emotions=Object.fromEntries(Object.keys(input.appraisal.emotions||{}).map(k=>[k,appraisal.emotions[k]]));
    fields.appraisal=selected;
  }
  return json({format:'subjective-update-fields-v1',
    interpretation:'本次实际提交并接受的主观更新字段；不表示每项内容首次形成，不独立证实所叙外部行为。未提供的旧摘要没有作为本轮新体验归档。',
    fields});
}

// The foreground model supplies a coherent current state. Residual feelings are
// explicit deltas, never an implicit copy of every successive full summary.
export function feelingUpdate(inner,input,before){
  if(input.dispositions!==undefined&&!Array.isArray(input.dispositions))fail('INVALID_DISPOSITIONS');
  const head=inner.head(),projection=inner.psyche.current?.({includeInvalid:true});
  if(input.expectedMindGeneration!==undefined&&input.expectedMindGeneration!==head.generation)fail('V3_HEAD_VERSION_CONFLICT');
  if(input.expectedPsycheRevision!==undefined&&input.expectedPsycheRevision!==(projection?.revision||0))fail('V3_PSYCHOLOGY_VERSION_CONFLICT');
  const summary=input.psychological===undefined?head.mental_summary:input.psychological;
  if(typeof summary!=='string'||[...summary].length>tuningFor(inner.runtime).text.psycheChars&&summary!==head.mental_summary)fail('V3_SUMMARY_TOO_LONG');
  const psychology=input.psychology||{};
  if(typeof psychology!=='object'||Array.isArray(psychology))fail('V3_INVALID_PSYCHOLOGY_DELTA');
  const operations=['add','update','merge','resolve','release'];
  for(const name of Object.keys(psychology))if(!operations.includes(name))fail('V3_INVALID_PSYCHOLOGY_DELTA');
  for(const name of operations)if(psychology[name]!==undefined&&(!Array.isArray(psychology[name])||psychology[name].length>(name==='merge'?4:8)))fail('V3_INVALID_PSYCHOLOGY_DELTA');
  const threads=new Map(inner.psyche.list().map(t=>[t.id,t]));
  for(const name of operations)for(const op of psychology[name]||[]){
    if(!op||typeof op!=='object')fail('V3_INVALID_PSYCHOLOGY_DELTA');
    if(name==='merge'){
      if(!Array.isArray(op.ids)||op.ids.length<2||op.ids.length>8||new Set(op.ids).size!==op.ids.length||op.ids.some(id=>!threads.has(id))||!op.reason)fail('V3_INVALID_PSYCHOLOGY_DELTA');
      if(op.expectedRevisions!==undefined&&(!Array.isArray(op.expectedRevisions)||op.expectedRevisions.length!==op.ids.length||op.ids.some(id=>op.expectedRevisions.find(r=>r.id===id)?.revision!==threads.get(id).revision)))fail('V3_PSYCHOLOGY_VERSION_CONFLICT');
    }else if(name!=='add'){
      const old=threads.get(op.id);if(!old)fail('V3_UNKNOWN_PSYCHOLOGY_THREAD');
      if(op.expectedRevision!==undefined&&op.expectedRevision!==old.revision)fail('V3_PSYCHOLOGY_VERSION_CONFLICT');
      if(typeof op.reason!=='string'||!op.reason.trim())fail('V3_PSYCHOLOGY_CHANGE_REASON_REQUIRED');
    }
    const text=op.text??threads.get(op.id)?.text;
    if(typeof text!=='string'||!text.trim()||op.text!==undefined&&text!==threads.get(op.id)?.text&&[...text].length>tuningFor(inner.runtime).text.psycheThreadChars)fail('V3_INVALID_PSYCHOLOGY_DELTA');
    if((op.objectIds||[]).some(id=>!inner.object(id)))fail('V3_UNKNOWN_OBJECT');
    for(const field of ['importance','intensity'])if(op[field]!==undefined&&(!Number.isFinite(op[field])||op[field]<0||op[field]>1))fail('V3_INVALID_PSYCHOLOGY_DELTA');
  }
  if(input.psyche!==undefined){
    if(!input.psyche||typeof input.psyche!=='object'||Array.isArray(input.psyche))fail('V3_INVALID_PATCH');
    for(const [name,field] of [['attention','focus'],['emotionalTensions','feeling']])if(input.psyche[name]!==undefined){
      if(!Array.isArray(input.psyche[name])||input.psyche[name].length>8)fail('V3_INVALID_PATCH');
      for(const item of input.psyche[name])if(!item||typeof item[field]!=='string'||[...item[field]].length>160||[item.objectId,...(item.objectIds||[])].filter(Boolean).some(id=>!inner.object(id)))fail('V3_INVALID_PATCH');
    }
  }
  const hasDelta=operations.some(name=>psychology[name]?.length);
  const psycheChanged=input.psyche!==undefined&&Object.entries(input.psyche).some(([name,value])=>json(value)!==json(name==='attention'?JSON.parse(head.attention_json||'[]'):name==='emotionalTensions'?JSON.parse(head.emotional_tensions_json||'[]'):undefined));
  const affectChanged=['mood','arousal','valence'].some(name=>input[name]!==undefined&&input[name]!==before[name])||input.appraisal!==undefined&&Object.entries(input.appraisal).some(([name,value])=>name==='emotions'?Object.entries(value||{}).some(([key,v])=>v!==before.appraisal?.emotions?.[key]):value!==before.appraisal?.[name]);
  return {head,summary,psychology,psyche:input.psyche,hasChanges:summary!==head.mental_summary||hasDelta||psycheChanged||affectChanged||!!input.dispositions?.length};
}

export const PSYCHE_CONTINUITY_PROMPT='当前心理是一份有版本的连续工作状态，表达此刻真正关注的感受，不要求把before.summary每件旧事续写或收尾，不要求填满设置的字数。心情、事实记忆、注意力和明确委托各有用途；背景感受不是待完成清单。当前来信可以成为前台，没解决的旧事可以quiet/paused，日常调侃、等一句回应等轻微牵挂不必新建长期线程。确实还会持续影响选择时才add，同主题用update，未变可空。resolve表示确已化解，需要支持；release表示不再让它占着注意力，可以因为不重要、不想继续或对方转向而放下，写明选择即可，不要求外部事情先解决。release不代表原谅、兑现承诺或抹掉事实；重要承诺、边界和持续影响仍按真实证据保留。放下时同步移出psyche.attention，不为连续性保留一个等待答案的尾巴。旧文字、模型自己的旧说法和别人转发不自动变亲历。工具事实留在来源层；只写现在真实引发的感受。时间、精力和能力只是条件，不规定动作，可以没有决定。引用类型按字段区分：psyche.attention和psyche.emotionalTensions的objectId/objectIds、psychology各操作的objectIds、decision.objectIds只引用本轮before.ongoing已提供且有效的inner:对象ID；before.psychology的psyche:线程ID仅用于psychology.update/resolve/release的id或merge.ids。qq:、character:、memory:、event:和source: ID不是inner对象。没有合适对象时可省略可选objectId或用空objectIds，不发明ID、不为绑定新建对象，也不按文字相似转换或晋升ID。';

// Provenance is checked in the host read-set, not dumped into every prompt.
export function psycheBackground(inner,options={}){return inner.psyche.background(options).map(t=>({id:t.id,revision:t.revision,status:t.status,text:t.text,kind:t.kind,importance:t.importance,intensity:t.intensity,feltAt:t.feltAt??t.createdAt,objectIds:(t.objectIds||[]).slice(0,12),uncertainBasis:!!t.uncertainBasis,reviewDisposition:t.reviewDisposition,evidenceCount:(t.sourceRefs?.length||0)+(t.memoryRefs?.length||0)}));}

export function feelingEvidence(runtime,input){
  const ops=Object.values(input.psychology||{}).flat(),memoryIds=[...new Set([...(input.dispositions||[]).flatMap(d=>d.memoryIds||[]),...ops.flatMap(op=>op.memoryIds||[])])],eventIds=[...new Set(ops.flatMap(op=>op.eventIds||[]))];
  const refs=memoryIds.map(id=>{const m=runtime.store.get(id);if(!m||['forgotten','redacted'].includes(m.status))fail('V3_UNKNOWN_PSYCHOLOGY_EVIDENCE');return {memoryId:id,memoryRevision:m.revision};});
  for(const eventId of eventIds){const sources=runtime.store.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE event_id=? AND character_id=?').all(eventId,runtime.characterId);if(!sources.length||sources.some(ref=>{const d=runtime.archive.db.prepare('SELECT status FROM documents WHERE source_id=? AND revision=?').get(ref.source_id,ref.source_revision);return !d||d.status==='deleted'||runtime.store.suppressed(ref.source_id)||runtime.store.sourceUsable?.({sourceId:ref.source_id,revision:ref.source_revision})===false;}))fail('V3_UNKNOWN_PSYCHOLOGY_EVIDENCE');refs.push({eventId});}
  return {memoryIds,eventIds,refs};
}
