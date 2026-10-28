import {withAdminEnergy,withDiagnosticEnergy} from './energy-context.js';
import {randomUUID} from 'node:crypto';
import {createBehaviorFrame} from './behavior-armor.js';
import {DelegationIntentGate} from './delegation-intent.js';
const reject=message=>{throw Object.assign(Error(message),{statusCode:400});};
export function adminRuntimeStatus(owner,ownerQQ,{readOnly=false}={}){return {administrator:String(ownerQQ),key:'private:'+ownerQQ,energy:readOnly?{energy:owner?.runtime?.store.projection('state')?.energy}:owner?.life?.status()||null,interfaces:{inspect:{method:'GET',path:'/api/admin/runtime'},review:{method:'POST',path:'/api/admin/runtime',body:{action:'review',eventIds:'可省略，默认最近12条管理员聊天'}},psycheMaintenance:{method:'POST',path:'/api/admin/runtime',body:{action:'psyche-organize',requestId:'独立维护请求标识',maxBatches:1,reviewCurrent:true}},expressionPreview:{method:'POST',path:'/api/admin/runtime',body:{action:'expression-preview',text:'管理员测试来信'}},expressionTest:{method:'POST',path:'/api/admin/runtime',body:{action:'expression-test',text:'管理员测试来信'}},nativeChat:{purpose:'real-interaction-writes-character-experience; use expressionTest for isolated tests',method:'POST',path:'/api/console/notify-ai',body:{key:'private:'+ownerQQ,message:'真实管理员指令',diagnostic:false}}},externalTestTargets:'administrator-only',usageAccounting:'actual-model-usage-recorded-without-hourly-quota'};}
export async function adminRuntimeTest(owner,ownerQQ,body={}){
 const key='private:'+ownerQQ;if(!owner?.isV3||!ownerQQ)reject('管理员运行接口需要 V3 和管理员账号');
 if(body.key!==undefined&&body.key!==key)reject('测试只能使用管理员账号');
 if(body.action==='inspect'||body.action===undefined)return adminRuntimeStatus(owner,ownerQQ);
 if(body.action==='behavior-test'){
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>2000)reject('行为核验需要1到2000字的管理员测试原文');
  if(!['qq_start_work','qq_create_capability','qq_wechat_desktop','qq_social_action'].includes(body.tool))reject('请选择受支持的特权工具');
  if(!body.operation||typeof body.operation!=='object'||Array.isArray(body.operation)||JSON.stringify(body.operation).length>4000)reject('测试动作参数无效');
  // This probe never enters the host authority map and has no action callback.
  // Its answer demonstrates the isolated check; it cannot authorize execution.
  const frame=createBehaviorFrame({key,ownerQQ,reason:'operator-note',operatorRequest:body.text,
   profileId:owner.profile?.id||owner.runtime.characterId,activationEpoch:0,turnId:randomUUID()});
  let nativeReceipt;
  const gate=new DelegationIntentGate({think:async(system,material,signal)=>{
   const response=await owner.think(material,signal,{system});nativeReceipt=response?.receipt;return response;
  }});
  const result=await withAdminEnergy(async()=>{
   try{return {status:'complete',...await gate.authorize({frame,requestText:body.text,tool:body.tool,operation:body.operation,guard:()=>{}})};}
   catch(error){if(error.code!=='DELEGATION_INTENT_DENIED')throw error;return {status:'complete',allow:false,scopeSummary:error.scopeSummary};}
  });
  return {result:{...result,receipt:nativeReceipt},test:{target:key,entry:'native-dsh-behavior-check',testOnly:true,grantsAuthority:false,externalMessages:0,publicWrites:0}};
 }
 if(['expression-preview','expression-test'].includes(body.action)){
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>1500)reject('表达测试需要1到1500字的管理员来信');
  const before=owner.runtime.store.projection('state')?.energy,cursor=owner.runtime.store.db.prepare('SELECT coalesce(max(rowid),0) n FROM energy_usage').get().n;
  const result=await withDiagnosticEnergy(()=>body.action==='expression-preview'?{status:'preview',...owner.expressionContext(key,{incoming:body.text})}:owner.testExpression(key,body.text));
  const charges=owner.runtime.store.db.prepare('SELECT scope,kind,cost,exempt FROM energy_usage WHERE rowid>?').all(cursor);
  return {...adminRuntimeStatus(owner,ownerQQ,{readOnly:true}),result,energyAudit:{before,after:owner.runtime.store.projection('state')?.energy,charged:charges.reduce((n,r)=>n+r.cost,0),actions:charges},test:{target:key,externalMessages:0,publicWrites:0,entry:body.action,learningExcluded:true,writesCharacterState:false}};
 }
 if(body.requestId!==undefined&&(typeof body.requestId!=='string'||!body.requestId.trim()||body.requestId.length>120))reject('requestId 格式不正确');
 if(body.action==='psyche-organize'){
  if(body.maxBatches!==undefined&&(!Number.isSafeInteger(body.maxBatches)||body.maxBatches<1||body.maxBatches>8))reject('maxBatches 必须为1到8');
  const before=owner.store.state().energy,cursor=owner.runtime.store.db.prepare('SELECT coalesce(max(rowid),0) n FROM energy_usage').get().n;
  const receiptCursor=owner.runtime.model.receipts.length;
  const result=await withAdminEnergy(()=>owner.organizePsychology({requestId:body.requestId,maxBatches:body.maxBatches??1,reviewCurrent:body.reviewCurrent===true}));
  const charges=owner.runtime.store.db.prepare('SELECT scope,kind,cost,exempt FROM energy_usage WHERE rowid>?').all(cursor);
  return {result,receipts:owner.runtime.model.receipts.slice(receiptCursor),energyAudit:{before,after:owner.store.state().energy,charged:charges.reduce((n,r)=>n+r.cost,0),actions:charges},test:{target:key,externalMessages:0,publicWrites:0,entry:'native-dsh-existing-psyche-maintenance'}};
 }
 if(body.action!=='review')reject('支持 inspect、review、psyche-organize、expression-preview、expression-test、behavior-test；完整原生对话请用返回的 nativeChat 接口');
 let ids=body.eventIds;if(ids!==undefined&&(!Array.isArray(ids)||ids.length<1||ids.length>12||ids.some(id=>typeof id!=='string')))reject('eventIds 必须是1到12条管理员事件');
 if(!ids&&owner.contacts?.recent&&owner.archive?.ref){owner.syncRaw(key);ids=owner.contacts.recent(key,12).map(row=>{const ref=owner.archive.ref('chat:'+row.id);return ref?owner.runtime.store.db.prepare('SELECT e.event_id FROM cognitive_events e JOIN event_sources s USING(character_id,event_id) WHERE s.source_id=? AND s.source_revision=? ORDER BY e.rowid DESC LIMIT 1').get(ref.sourceId,ref.revision)?.event_id:null;}).filter(Boolean).reverse();}
 if(!ids){const rows=owner.runtime.store.db.prepare('SELECT e.event_id,s.source_id,s.source_revision FROM cognitive_events e JOIN event_sources s USING(character_id,event_id) ORDER BY e.rowid DESC LIMIT 500').all(),seen=new Set();ids=[];for(const r of rows){const d=owner.runtime.archive.get(r.source_id,r.source_revision);if(d.kind!=='chat'||d.metadata.scope!==key||seen.has(d.sourceId))continue;seen.add(d.sourceId);ids.push(r.event_id);if(ids.length===12)break;}ids.reverse();}
 if(!ids.length)reject('暂时没有管理员聊天可用于原生验收');
 const before=owner.store.state().energy,cursor=owner.runtime.store.db.prepare('SELECT coalesce(max(rowid),0) n FROM energy_usage').get().n;
 const result=await withAdminEnergy(()=>owner.reviewEvents(key,ids,{requestId:body.requestId}));
 const charges=owner.runtime.store.db.prepare('SELECT scope,kind,cost,exempt FROM energy_usage WHERE rowid>?').all(cursor);
 return {...adminRuntimeStatus(owner,ownerQQ),result,energyAudit:{before,after:owner.store.state().energy,charged:charges.reduce((n,r)=>n+r.cost,0),actions:charges},test:{target:key,externalMessages:0,publicWrites:0,entry:'native-dsh-ephemeral-integration'}};
}
