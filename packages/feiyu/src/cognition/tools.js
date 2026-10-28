import {bounded,fail} from './contracts.js';

const object=properties=>({type:'object',properties,additionalProperties:false});
const string={type:'string'};
export const COGNITION_TOOLS=Object.freeze([
  {name:'qq_recall',description:'回忆经历、关系、知识。保留人物和证据。精确原话请查档案。',parameters:object({query:string,depth:{enum:['shallow','deep']},purpose:{enum:['general','promise','why']}})},
  {name:'qq_knowledge_recall',description:'查询本角色已经学到的知识和表达，与回忆共用检索器。',parameters:object({query:string,depth:{enum:['shallow','deep']}})},
  {name:'qq_memory_expand',description:'按页展开已召回记忆的可用细节，实际篇幅遵从管理员预算；不是原文。',parameters:object({memoryId:string,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:10000}})},
  {name:'qq_search_resources',description:'查询原始档案；这是查资料，不是假装自然记起。',parameters:object({query:string,speakerId:string,kind:string,cursor:{type:'integer',minimum:0}})},
  {name:'qq_read_resource',description:'按来源版本与位置读取原始档案；实际篇幅遵从管理员设置的单次原文预算。',parameters:object({sourceId:string,revision:{type:'integer',minimum:1},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:60000}})},
  {name:'qq_update_mind_state',description:'记录自己的短期感受和情绪；不改变精力、身份或权限。',parameters:object({psychological:string,arousal:{type:'number',minimum:0,maximum:1},valence:{type:'number',minimum:-1,maximum:1},expectedRevision:{type:'integer',minimum:0}})},
  {name:'qq_record_experience',description:'根据已真正看到或完成的资源，记录明确的个人感受摘要，不写逐步推理。',parameters:object({summary:string,reaction:string,evidence:{type:'array',items:object({sourceId:string,revision:{type:'integer',minimum:1}}),minItems:1,maxItems:8},intensity:{type:'number',minimum:0,maximum:1},lastingness:{type:'number',minimum:0,maximum:1}})},
  {name:'qq_memory_feedback',description:'指出记忆或归属疑点，生成待核查提案，不直接改写事实。',parameters:object({memoryId:string,note:string})},
]);
// A capability is supplied out-of-band by a trusted host resolver, never from tool arguments.
export function bindCognitionTools(runtime,resolveHandle){
  if(typeof resolveHandle!=='function')fail('TRUSTED_CONTEXT_RESOLVER_REQUIRED');
  return COGNITION_TOOLS.map(spec=>({...spec,execute:async(args,execution={})=>{
    const handle=resolveHandle(execution);runtime.grant(handle);const a=args||{};
    const allowed=Object.keys(spec.parameters.properties);if(Object.keys(a).some(k=>!allowed.includes(k)))fail('UNKNOWN_TOOL_ARGUMENT');
    switch(spec.name){
      case 'qq_recall': return runtime.recall(handle,bounded(a.query,1000),{depth:a.depth||'shallow',purpose:a.purpose||'general',signal:execution.signal});
      case 'qq_knowledge_recall': return runtime.recall(handle,bounded(a.query,1000),{depth:a.depth||'shallow',kinds:['knowledge','procedure'],signal:execution.signal});
      case 'qq_memory_expand': return runtime.expand(handle,a.memoryId,{offset:a.offset??0,limit:a.limit});
      case 'qq_search_resources': return runtime.searchArchive(handle,a);
      case 'qq_read_resource': return runtime.readArchive(handle,a.sourceId,a.revision,a);
      case 'qq_update_mind_state': {const patch={};for(const k of ['psychological','arousal','valence'])if(a[k]!==undefined)patch[k]=a[k];for(const k of ['arousal','valence'])if(patch[k]!==undefined&&(!Number.isFinite(patch[k])||patch[k]<(k==='valence'?-1:0)||patch[k]>1))fail('INVALID_STATE_VALUE');return runtime.policy.updateState(patch,{expectedRevision:a.expectedRevision});}
      case 'qq_record_experience': return runtime.recordExperience(handle,a);
      case 'qq_memory_feedback': return runtime.feedback(handle,a);
    }
  }}));
}
