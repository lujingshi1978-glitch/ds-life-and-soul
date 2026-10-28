import {createHash} from 'node:crypto';

const code=error=>String(error?.code||error?.message||error||'LOCAL_CONFIRM_FAILED').slice(0,160);
function normalize(value){
  if(!value||typeof value!=='object'||value.status==='unknown'||value.ok===false)return null;
  const {profileId,key}=value,raw=value.messageId;
  const messageId=typeof raw==='number'&&Number.isSafeInteger(raw)?String(raw):typeof raw==='string'?raw.trim():'';
  if(typeof profileId!=='string'||!profileId.trim()||!/^private:\d+$/.test(key)||!/^\-?\d+$/.test(messageId)||/^\-?0+$/.test(messageId)
    ||!Array.isArray(value.recordIds)||!value.recordIds.length||value.recordIds.some(id=>typeof id!=='string'||!id.trim()))return null;
  const recordIds=[...new Set(value.recordIds)].sort();
  const id=createHash('sha256').update(JSON.stringify([profileId,key,recordIds,messageId])).digest('hex');
  return {id,profileId,key,recordIds,messageId};
}

// These synchronous dependencies own persistence and the local receipt ledger.
// There is deliberately no network/send dependency. Replaying an outbox item
// means confirming an existing QQ receipt locally, never repeating its effect.
export class QQDeliveryOutbox {
  constructor({profile,read,write,confirm}){
    if([profile,read,write,confirm].some(fn=>typeof fn!=='function'))throw new TypeError('Outbox dependencies must be functions');
    Object.assign(this,{profile,read,write,confirm});this.memory=new Map();
  }
  load(){
    const memory=[...this.memory.values()].filter(item=>item.profileId===this.profile());
    try{
      const stored=this.read();if(!Array.isArray(stored))throw Error('INVALID_OUTBOX_STATE');
      const rows=[],seen=new Set();
      for(const raw of [...stored,...memory]){
        const item=normalize(raw);
        if(!item){rows.push(raw);continue;}
        if(!seen.has(item.id)){seen.add(item.id);rows.push(item);}
      }
      return {rows};
    }catch(error){return {error:code(error),rows:memory};}
  }
  persist(rows){
    try{if(this.write(rows)===false)throw Error('OUTBOX_PERSIST_FAILED');return {ok:true};}
    catch(error){return {ok:false,error:code(error)};}
  }
  confirmItem(item,rows){
    try{
      const count=this.confirm(item.key,[...item.recordIds],{messageId:item.messageId,channel:item.key});
      if(count!==item.recordIds.length)throw Error('DELIVERY_CONFIRMATION_INCOMPLETE');
    }catch(error){return {delivered:true,persisted:true,confirmed:false,pending:true,error:code(error),rows};}
    const remaining=rows.filter(raw=>normalize(raw)?.id!==item.id),saved=this.persist(remaining);
    if(!saved.ok)return {delivered:true,persisted:false,confirmed:true,pending:true,error:saved.error,rows};
    this.memory.delete(item.id);
    return {delivered:true,persisted:true,confirmed:true,pending:false,rows:remaining};
  }
  record(value){
    const item=normalize(value);if(!item)return {delivered:false,persisted:false,confirmed:false,pending:false,error:'INVALID_QQ_DELIVERY_RECEIPT'};
    if(item.profileId!==this.profile())return {delivered:true,persisted:false,confirmed:false,pending:false,ignored:true};
    this.memory.set(item.id,item);
    const loaded=this.load();
    if(loaded.error)return {delivered:true,persisted:false,confirmed:false,pending:true,error:loaded.error};
    const saved=this.persist(loaded.rows);
    if(!saved.ok)return {delivered:true,persisted:false,confirmed:false,pending:true,error:saved.error};
    const {rows,...result}=this.confirmItem(item,loaded.rows);return result;
  }
  flush(){
    const loaded=this.load();
    if(loaded.error)return {confirmed:0,pending:loaded.rows.length,ignored:0,durability:false,error:loaded.error};
    let rows=loaded.rows;const items=rows.map(normalize).filter(Boolean),current=items.filter(item=>item.profileId===this.profile());
    if(!current.length)return {confirmed:0,pending:0,ignored:items.length,durability:true};
    const saved=this.persist(rows);
    if(!saved.ok)return {confirmed:0,pending:current.length,ignored:items.length-current.length,durability:false,error:saved.error};
    let confirmed=0,durability=true;const failures=[];
    for(const item of current){
      const result=this.confirmItem(item,rows);rows=result.rows;
      if(!result.pending)confirmed++;
      if(!result.persisted)durability=false;
      if(result.error)failures.push({id:item.id,error:result.error});
    }
    return {confirmed,pending:current.length-confirmed,ignored:items.length-current.length,durability,failures};
  }
  pending(key,recordIds){
    if(!/^private:\d+$/.test(key)||!Array.isArray(recordIds)||!recordIds.length)return false;
    const loaded=this.load();if(loaded.error)return true;
    const selected=new Set(recordIds);
    return loaded.rows.some(raw=>{const item=normalize(raw);return item&&item.profileId===this.profile()&&item.key===key&&item.recordIds.some(id=>selected.has(id));});
  }
}
