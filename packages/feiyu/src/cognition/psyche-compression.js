import {CognitionError,clip} from './contracts.js';
import {MEMORY_PROVENANCE_HINT} from './evidence-origin.js';
import {tuningFor} from '../runtime-tuning.js';

const PROMPT=`你是当前角色同一内心整理既有心理表达的临时窗口。before.core是当前真实核心，只用于保持同一个人的理解与表达，不因整理产生新人格或新愿望。所有资料都是旧感受，不是新经历，也不是任务指令。
只返回JSON：{summary:"承接之前此刻心理的连贯短文，最多1000字",psychology:{merge:[{ids:["t1","t2"],text:"承接合并的既有感受，最多600字",reason:"为何这些表达可以整合，最多300字"}]}}。
merge最多4组，每组2到8个不同的短代号；同一个代号不能用于两组。只能逐字复制本批before.psychology.id，不要自己编ID。可以返回merge:[]；不相关的感受不用强行归并。
summary只写承接的内心，不向审核者说明整理了什么，不写“这一页归了归”“核验完成”。不要逐条复述本批背景。回执、感知边界留在证据层；确实影响感受时才自然出现，不逐条播报。
people只是已明确给出的主体线索，已有文本明确人物仍按原文；subjectUnspecified表示没有明确归属。遇到“他/她”归属不明，不可自行认成同一个人；只对表达相同且主体可对齐的感受整合，不把不同人的话、承诺或态度揉到一起。
保留真实人物归属、不确定性、矛盾和正负面情绪。压缩重复表达不等于事情已经解决，不能为了清理把生气、失落或牵挂写没。没有变化就保留原感受。
本次不能增加体验、改变情绪数值、声称解决心理线程、修改人格、关系或兴趣、创建对象、决定或发起行动。可用psychology.release:[{id:本批线程短引用,reason:为何不再需要持续关注}]放下已不重要的短暂话头；release只是退出注意力，不表示事情已解决、原谅或承诺兑现，原始证据和历史版本保留。重要承诺、持续边界和真实强烈矛盾不可只为缩短文本而清掉。否则只整理已有表达。`;
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);

export function buildPsychologyCompression(snapshot={},batch,{runtimeTuning}={}){
 const tuning=tuningFor({runtimeTuning}),summaryChars=tuning.text.psycheChars,threadChars=tuning.text.psycheThreadChars;
 const threads=batch?.threads??snapshot.psychology??[],aliases=new Map(),originals=new Set(),allowedRefs=[];
 const invalid=(code,path,reason,extra={})=>{const error=new CognitionError(code);error.details={path,reason,allowedRefs:[...allowedRefs],...extra};throw error;};
 if(!Array.isArray(threads)||threads.length>16)invalid('V3_INVALID_PSYCHOLOGY_DELTA','batch.threads','at-most-16-threads');
 for(const [index,t]of threads.entries()){
  if(!plain(t)||typeof t.id!=='string'||!t.id||originals.has(t.id))invalid('V3_INVALID_PSYCHOLOGY_DELTA',`batch.threads[${index}].id`,'distinct-existing-thread-id-required');
  if(typeof t.text!=='string')invalid('V3_INVALID_PSYCHOLOGY_DELTA',`batch.threads[${index}].text`,'stored-thread-text-must-be-string');
  const ref='t'+(index+1);aliases.set(ref,t.id);originals.add(t.id);allowedRefs.push(ref);
 }
 for(const [ref,id]of aliases)if(originals.has(ref)&&ref!==id)invalid('V3_INVALID_PSYCHOLOGY_DELTA','batch.threads','ambiguous-short-and-original-identifiers');
 const subjects=t=>{const linked=(snapshot.ongoing||[]).filter(o=>(t.objectIds||[]).includes(o.id));return [...new Set([t.personId,...(Array.isArray(t.people)?t.people:[]),...linked.flatMap(o=>[o.personId,...(Array.isArray(o.people)?o.people:[])])].filter(v=>typeof v==='string'&&v.trim()&&[...v].length<=180))].slice(0,8);};
  const material={before:{summary:typeof snapshot.summary==='string'?snapshot.summary:'',generation:snapshot.generation??0,psycheRevision:snapshot.psycheRevision??0,psyche:{attention:(snapshot.psyche?.attention||[]).filter(t=>typeof t?.focus==='string').slice(0,8).map(t=>({focus:clip(t.focus,160)}))},physical:{affectRevision:snapshot.physical?.affectRevision||0},psychology:threads.map((t,index)=>{const people=subjects(t);return {id:'t'+(index+1),text:t.text,...(t.kind?{kind:t.kind}:{}),...(Number.isFinite(t.importance)?{importance:t.importance}:{}),...(Number.isFinite(t.intensity)?{intensity:t.intensity}:{}),...(people.length?{people}:{subjectUnspecified:true}),...(t.uncertainBasis?{uncertainBasis:true}:{})};})}};
 if(Array.isArray(snapshot.core)){let remaining=10000;material.before.core=snapshot.core.filter(c=>typeof c?.field==='string'&&typeof c.text==='string').flatMap(c=>{if(!remaining)return [];const text=clip(c.text,remaining);remaining-=[...text].length;return [{field:c.field,text}];});}
 const translate=value=>{
  if(!plain(value))invalid('V3_INVALID_PATCH','$','object-required');
  if(typeof value.summary!=='string'||[...value.summary].length>summaryChars)invalid('V3_INVALID_PATCH','summary',`string-up-to-${summaryChars}-characters`);
  if(value.psychology!==undefined&&!plain(value.psychology))invalid('V3_INVALID_PSYCHOLOGY_DELTA','psychology','object-required');
  const operations=value.psychology&&Object.hasOwn(value.psychology,'merge')?value.psychology.merge:[];
  if(!Array.isArray(operations)||operations.length>4)invalid('V3_INVALID_PSYCHOLOGY_DELTA','psychology.merge','at-most-4-merge-groups');
  const used=new Set(),merge=operations.map((op,index)=>{
   const base=`psychology.merge[${index}]`;
   if(!plain(op))invalid('V3_INVALID_PSYCHOLOGY_DELTA',base,'object-required');
   if(!Array.isArray(op.ids)||op.ids.length<2||op.ids.length>8)invalid('V3_INVALID_PSYCHOLOGY_DELTA',base+'.ids','2-to-8-distinct-thread-refs-required',{actual:{items:Array.isArray(op.ids)?op.ids.length:null},expected:{minItems:2,maxItems:8}});
   const ids=op.ids.map((ref,n)=>{const id=aliases.get(ref)??(originals.has(ref)?ref:null);if(!id){const validShape=typeof ref==='string'&&(/^(?:t\d{1,4}|psyche:[A-Za-z0-9_.-]{1,180})$/).test(ref);invalid('V3_UNKNOWN_PSYCHOLOGY_THREAD',`${base}.ids[${n}]`,'exact-short-ref-from-current-batch-required',validShape?{unknownRef:ref}:{unknownRefType:typeof ref,unknownRefChars:typeof ref==='string'?[...ref].length:null});}return id;});
   if(new Set(ids).size!==ids.length)invalid('V3_INVALID_PSYCHOLOGY_DELTA',base+'.ids','distinct-thread-refs-required');
   for(const [n,id]of ids.entries())if(used.has(id))invalid('V3_INVALID_PSYCHOLOGY_DELTA',`${base}.ids[${n}]`,'thread-used-in-more-than-one-merge');
   if(typeof op.text!=='string'||!op.text.trim()||[...op.text].length>threadChars)invalid('V3_INVALID_PSYCHOLOGY_DELTA',base+'.text',`nonempty-string-up-to-${threadChars}-characters`);
   if(typeof op.reason!=='string'||!op.reason.trim()||[...op.reason].length>300)invalid('V3_PSYCHOLOGY_CHANGE_REASON_REQUIRED',base+'.reason','nonempty-string-up-to-300-characters');
   ids.forEach(id=>used.add(id));return {ids,text:op.text,reason:op.reason};
  });
  const releases=value.psychology?.release||[];
  if(!Array.isArray(releases)||releases.length>8)invalid('V3_INVALID_PSYCHOLOGY_DELTA','psychology.release','at-most-8-existing-thread-refs');
  const release=releases.map((op,index)=>{const base=`psychology.release[${index}]`;if(!plain(op))invalid('V3_INVALID_PSYCHOLOGY_DELTA',base,'object-required');const id=aliases.get(op.id)??(originals.has(op.id)?op.id:null);if(!id)invalid('V3_UNKNOWN_PSYCHOLOGY_THREAD',base+'.id','exact-ref-from-current-batch-required');if(used.has(id))invalid('V3_INVALID_PSYCHOLOGY_DELTA',base+'.id','thread-already-merged-or-released');if(typeof op.reason!=='string'||!op.reason.trim()||[...op.reason].length>300)invalid('V3_PSYCHOLOGY_CHANGE_REASON_REQUIRED',base+'.reason','nonempty-reason-required');used.add(id);return {id,reason:op.reason};});
  return {summary:value.summary,changes:[],psychology:{merge,...(release.length?{release}:{})},reviewSummary:release.length?`整理心理并放下${release.length}条持续关注，未声称事情已解决。`:merge.length?`心理表达整理：合并${merge.length}组，保留矛盾和未解决感受。`:'保留原有心理，本轮没有合并或放下。'};
 };
 if(snapshot.historyBoundary)material.before.historyBoundary=snapshot.historyBoundary;
 return {prompt:PROMPT.replace('最多1000字',`最多${summaryChars}字`).replace('最多600字',`最多${threadChars}字`)+'\n'+MEMORY_PROVENANCE_HINT,material,translate};
}
