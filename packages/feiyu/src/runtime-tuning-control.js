import {createHash} from 'node:crypto';
import {normalizeRuntimeTuning,mergeRuntimeTuning,runtimeTuningView} from './runtime-tuning.js';
const conflict=()=>{throw Object.assign(new Error('运行参数已变化，请刷新后核对当前草稿'),{code:'RUNTIME_TUNING_CONFLICT',statusCode:409});};
export function tuningRevision(config){return createHash('sha256').update(JSON.stringify(normalizeRuntimeTuning(config.runtimeTuning||{},{legacyConfig:config}))).digest('hex');}
export class RuntimeTuningControl{
 constructor({current,read,write,beforeApply=()=>{},afterApply=()=>{},effective=()=>({})}){Object.assign(this,{current,read,write,beforeApply,afterApply,effective});}
 view(){const cfg=this.current();return runtimeTuningView(normalizeRuntimeTuning(cfg.runtimeTuning||{},{legacyConfig:cfg}),{revision:tuningRevision(cfg),effective:this.effective()});}
 update(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['revision','values','profileId'].includes(k)))throw Object.assign(new Error('运行参数请求格式无效'),{statusCode:400});
  if(!body.values||typeof body.values!=='object'||Array.isArray(body.values))throw Object.assign(new Error('参数修改必须是对象'),{statusCode:400});
  const cfg=this.current(),file=JSON.parse(JSON.stringify(this.read()));
  if(typeof body.revision!=='string'||body.revision!==tuningRevision(cfg)||body.revision!==tuningRevision(file))conflict();
  const values=mergeRuntimeTuning(normalizeRuntimeTuning(file.runtimeTuning||{},{legacyConfig:file}),JSON.parse(JSON.stringify(body.values)));
  const next={...file,runtimeTuning:values,runtimeTuningRevision:(Number.isSafeInteger(file.runtimeTuningRevision)?file.runtimeTuningRevision:0)+1,role:{...file.role,maxInjectChars:values.text.roleInjectChars},social:{...file.social,maxReplyChars:values.text.replyChunkChars}};
  // Settle elapsed energy using the previous rates, then persist atomically.
  this.beforeApply();this.write(next);
  cfg.runtimeTuning=values;cfg.runtimeTuningRevision=next.runtimeTuningRevision;cfg.role={...cfg.role,maxInjectChars:values.text.roleInjectChars};cfg.social={...cfg.social,maxReplyChars:values.text.replyChunkChars};
  this.afterApply({before:file.runtimeTuning,values});
  return {...this.view(),message:'已保存；行为和文本参数从后续步骤采用，向量适配在下次重启后启用。'};
 }
}
