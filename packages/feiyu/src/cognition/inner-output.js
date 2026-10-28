// Compatibility at the model-output boundary. Move only an already fully typed
// disposition operation to its documented container; never infer its sentiment,
// target, evidence, transition, permissions or missing fields.
const fields=new Set(['kind','target','text','preference','facet','transition','previousId','expectedRevision','reason','eventIds','memoryIds']);
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function normalizeInnerContainers(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(value.changes))return {patch:value,repairs:[]};
 const repairs=[],changes=[],dispositions=Array.isArray(value.dispositions)?[...value.dispositions]:value.dispositions;
 let next=dispositions;
 for(const [index,op]of value.changes.entries()){
  if(!op||!['attitude','interest'].includes(op.kind)){changes.push(op);continue;}
  const {id,status,...typed}=op;
  const hasContent=typeof typed.text==='string'&&typed.text.trim()||typed.kind==='interest'&&typed.preference&&typeof typed.preference==='object'&&!Array.isArray(typed.preference);
  const valid=typeof typed.target==='string'&&typed.target.trim()&&hasContent&&typeof typed.reason==='string'&&typed.reason.trim()&&Object.keys(typed).every(k=>fields.has(k))&&(id===undefined||id===typed.previousId)&&(status===undefined||status==='active')&&(next===undefined||Array.isArray(next));
  if(!valid){const e=Object.assign(Error('V3_INVALID_PATCH'),{code:'V3_INVALID_PATCH',details:{path:`changes[${index}]`,expectedContainer:'dispositions',required:['kind','target','text','reason'],allowedFields:[...fields],reason:'Relationship attitudes and interests use dispositions; no missing fields are invented. A generic title/meaning object cannot be converted.'}});throw e;}
  next??=[];if(!next.some(existing=>canonical(existing)===canonical(typed)))next.push(typed);repairs.push({from:`changes[${index}]`,to:'dispositions',kind:typed.kind,previousId:typed.previousId||null});
 }
 return repairs.length?{patch:{...value,changes,dispositions:next},repairs}:{patch:value,repairs};
}
