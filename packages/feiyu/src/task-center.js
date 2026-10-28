// A task describes accepted work and its receipts. It is never an execution
// grant. The existing cognition scheduler and native DSH sessions do the work.
const plain=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);if(prototype===null)return true;
  const constructor=Object.getOwnPropertyDescriptor(prototype,'constructor')?.value;
  return Object.getPrototypeOf(prototype)===null&&typeof constructor==='function'&&constructor.prototype===prototype&&Function.prototype.toString.call(constructor)===Function.prototype.toString.call(Object);
};
const invalid=()=>{throw Object.assign(new Error('TASK_HOST_INVALID'),{code:'TASK_HOST_INVALID'});};
const text=(value,limit=256)=>value==null?null:typeof value==='string'&&value.length>0&&value.length<=limit&&!/[\u0000-\u001f\u007f]/.test(value)?value:invalid();
const count=value=>value==null?null:Number.isSafeInteger(value)&&value>=0?value:invalid();
const origins=new Set(['legacy','operator','incoming','history','autonomous','world','inner-proposal']);

export function normalizeTaskHost(host={},defaults={}) {
  if(!plain(host)||!plain(defaults))invalid();
  const ownerScope=text(defaults.ownerScope??host.ownerScope);
  if(!ownerScope||host.ownerScope!==undefined&&host.ownerScope!==ownerScope)invalid();
  const origin=host.origin??'legacy';if(!origins.has(origin))invalid();
  let originRef=null;
  if(host.originRef!=null){
    if(typeof host.originRef==='string')originRef=text(host.originRef);
    else {
      if(!plain(host.originRef)||Object.keys(host.originRef).some(k=>!['proposalId','executionId','turnId','eventId','revision'].includes(k)))invalid();
      originRef=Object.fromEntries(Object.entries(host.originRef).map(([key,value])=>[key,key==='revision'?count(value):text(value)]));
    }
  }
  const refs=host.sourceRefs??[];
  if(!Array.isArray(refs)||refs.length>64||Array.from(refs).some(ref=>!plain(ref)||Object.keys(ref).some(k=>!['sourceId','revision','checksum'].includes(k))))invalid();
  const sourceRefs=Array.from(refs,ref=>{
    const sourceId=text(ref.sourceId),revision=count(ref.revision),checksum=text(ref.checksum,128);
    if(!sourceId||!revision)invalid();return {sourceId,revision,...(checksum?{checksum}:{})};
  });
  return {version:1,ownerScope,profileId:text(host.profileId??defaults.profileId),characterId:text(host.characterId??defaults.characterId),roleEpoch:count(host.roleEpoch??defaults.roleEpoch),activationEpoch:count(host.activationEpoch),origin,originRef,requestId:text(host.requestId),sourceRefs};
}

export function taskDescriptor({id,kind,host,status,phase,executor,executorId,sessionId,receipt=null,recovered=false,createdAt,updatedAt,executionBoundary}) {
  const owner=normalizeTaskHost(host,{ownerScope:host?.ownerScope});
  return {...owner,id,kind,status,phase,executor,...(executor==='dsh'?{executionBoundary:executionBoundary==='windows-lpac-private-workspace'?executionBoundary:'standard-session-cwd-not-os-sandbox'}:{}),...(executorId?{executorId}:{}),...(sessionId?{sessionId}:{}),receipt,recovered:!!recovered,createdAt,updatedAt};
}

export class TaskCenter {
  constructor({learning,applications}={}){Object.assign(this,{learning,applications});}
  learn(scope,input,options={}){if(!this.learning)throw Error('LEARNING_UNAVAILABLE');return this.learning.enqueue(scope,input,options);}
  work(scope,prompt,options={}){if(!this.applications)throw Error('WORK_UNAVAILABLE');return this.applications.startTask(scope,prompt,options);}
  create(scope,prompt,options={}){if(!this.applications)throw Error('WORK_UNAVAILABLE');return this.applications.createCapability(scope,prompt,options);}
  status(scope,id,{kind}={}){
    if(typeof id!=='string'||!id||id.length>256)return null;
    if(kind!==undefined&&!['learn','work','creation-draft'].includes(kind))throw Error('TASK_KIND_INVALID');
    const learning=/^(job:|observed:)/.test(id);
    if(learning)return kind&&kind!=='learn'?null:this.learning?.job(scope,id)??null;
    if(kind==='learn')return null;
    const value=this.applications?.taskResult(scope,id)??null;
    return kind&&value?.task?.kind!==kind?null:value;
  }
  list(scope,{kind}={}){
    if(kind!==undefined&&!['learn','work','creation-draft'].includes(kind))throw Error('TASK_KIND_INVALID');
    return [...(!kind||kind==='learn'?this.learning?.jobs(scope)??[]:[]),...(!kind||kind!=='learn'?this.applications?.taskList(scope)??[]:[])].filter(row=>!kind||row.task?.kind===kind);
  }
}
