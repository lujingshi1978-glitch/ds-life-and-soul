import {AsyncLocalStorage} from 'node:async_hooks';
const contexts=new AsyncLocalStorage();
// Only authenticated host code establishes this context. Model arguments and
// message text never grant exemptions; each HTTP request gets a fresh object.
export const withEnergyContext=(context,fn)=>contexts.run({...context},fn);
export const energyContext=()=>contexts.getStore()||{};
export const energyExempt=()=>energyContext().exempt===true;
export function authorizeAdminEnergy(scope){const ctx=contexts.getStore();if(ctx){ctx.exempt=true;ctx.scope=scope;ctx.source='authenticated-administrator';}}
export const withAdminEnergy=fn=>withEnergyContext({exempt:true,source:'authenticated-administrator'},fn);
export const withDiagnosticEnergy=fn=>withEnergyContext({exempt:true,diagnostic:true,source:'authenticated-diagnostic'},fn);
export function jobEnergyContext(runtime,job){
 const parent=energyContext(),scope=job.payload?.behavior?.scope||job.payload?.scope;
 let exempt=parent.exempt===true||job.payload?.energyExemptByAdministrator===true||runtime.isAdminScope?.(scope)===true,factor=1;
 if(!exempt){try{const materials=runtime.materials(job);if(materials.length){const total=materials.reduce((n,m)=>n+(m.text?.length||1),0),ordinary=materials.filter(m=>!m.metadata?.administratorOperation&&!runtime.isAdminScope?.(m.metadata?.scope)).reduce((n,m)=>n+(m.text?.length||1),0);factor=ordinary/total;exempt=ordinary===0;}}catch{}}
 return {...parent,scope:scope||parent.scope||'self',exempt,factor,finishCurrent:true};
}
