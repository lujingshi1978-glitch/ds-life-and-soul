import {recordChannelOutcome} from './conversation-response.js';

// Delivery bookkeeping only. Retrying a local archive never invokes a model or
// repeats the HTTP reply, speech synthesis or any public/social operation.
export function companionDelivery(mind,owner){
 const db=mind.runtime.store.db,current=new Set();
 db.exec(`CREATE TABLE IF NOT EXISTS companion_delivery(id TEXT PRIMARY KEY,status TEXT NOT NULL,text TEXT,at INTEGER NOT NULL,epoch INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,error TEXT);`);
 const epoch=()=>mind.runtime.store.manifest?.().role_epoch??0;
 function enqueue({id,status,text=null,at=Date.now(),roleEpoch=epoch()}){
  const own=!db.isTransaction;if(own)db.exec('BEGIN IMMEDIATE');
  try{
   const added=db.prepare('INSERT OR IGNORE INTO companion_delivery(id,status,text,at,epoch) VALUES(?,?,?,?,?)').run(id,status,text,at,roleEpoch).changes;
   if(added&&status==='http-completed'&&text!==null)db.prepare('INSERT OR IGNORE INTO companion_chat VALUES(?,?,?,?)').run(id+':out','assistant',text,at);
   if(own)db.exec('COMMIT');if(added)current.add(id);
  }catch(error){if(own&&db.isTransaction)db.exec('ROLLBACK');throw error;}
 }
 function flush(){
  let completed=0;
  for(const row of db.prepare('SELECT * FROM companion_delivery WHERE archived=0 ORDER BY at,rowid LIMIT 8').all()){
   const recovered=!current.has(row.id)||row.epoch!==epoch();
   try{
    // A receipt may have failed after the original was already archived. That
    // successful original remains the same evidence, not a historical edit.
    if(row.status==='http-completed'&&row.text!==null&&!mind.archive.ref?.('desktop:'+row.id+':out')){
     const alias='desktop:'+row.id+':out',prior=mind.runtime.archive?.db?.prepare("SELECT body,metadata FROM documents WHERE adapter='qq-live-archive' AND external_id=? AND kind='chat' AND status='available' ORDER BY revision DESC LIMIT 1").get(alias),metadata=prior?JSON.parse(prior.metadata):null;
     if(prior&&(prior.body!==row.text||metadata.scope!=='pet:'+owner||metadata.role!=='assistant'||metadata.requestId!==row.id))throw Error('COMPANION_ARCHIVE_CONFLICT');
     // append() can succeed before LegacyArchive saves its alias. Reuse those
     // exact bytes and metadata to repair the alias without a new revision.
     mind.archive.put(alias,'pet:'+owner,'chat',row.text,metadata||{platform:'desktop',speakerId:mind.runtime.characterId,conversationPeerId:'qq:'+owner,role:'assistant',requestId:row.id,delivery:'http-completed',userReadConfirmed:false,...(recovered?{recovery:true,historical:true}:{})},row.at,{historical:metadata?metadata.historical===true:recovered});
    }
    recordChannelOutcome(mind,{id:row.id,platform:'desktop',scope:'private:'+owner,bodyScope:'pet:'+owner,status:row.status,at:row.at,recovered});
    db.prepare('UPDATE companion_delivery SET archived=1,error=NULL WHERE id=?').run(row.id);current.delete(row.id);completed++;
   }catch{db.prepare("UPDATE companion_delivery SET error='LOCAL_ARCHIVE_PENDING' WHERE id=?").run(row.id);}
  }
  if(completed)mind.runtime.scheduleEncoding();return completed;
 }
 return {enqueue,flush};
}
