import {randomUUID} from 'node:crypto';

// Stored beside the character's contacts. An upstream ID survives process epochs.
export class InboundLedger {
 constructor(db,{now=Date.now}={}){this.db=db;this.now=now;db.exec(`CREATE TABLE IF NOT EXISTS inbound_ledger(
 account TEXT NOT NULL,channel TEXT NOT NULL,peer TEXT NOT NULL,message_id TEXT NOT NULL,
 payload TEXT NOT NULL,received_at INTEGER NOT NULL,stage TEXT NOT NULL DEFAULT 'received',
 lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,
 record_id TEXT,local_seq INTEGER,normalized TEXT,decision TEXT NOT NULL DEFAULT 'pending',
 model_cycle TEXT,error TEXT,PRIMARY KEY(account,channel,peer,message_id));
 CREATE INDEX IF NOT EXISTS inbound_ready ON inbound_ledger(account,decision,retry_at,received_at);
 CREATE INDEX IF NOT EXISTS inbound_record ON inbound_ledger(account,record_id,decision);
 CREATE INDEX IF NOT EXISTS inbound_peer_message ON inbound_ledger(account,peer,message_id,decision);
 CREATE TABLE IF NOT EXISTS inbound_seen(account TEXT NOT NULL,peer TEXT NOT NULL,message_id TEXT NOT NULL,cycle TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(account,peer,message_id,cycle));`);}
 key(account,peer,id){return [String(account), 'qq', String(peer).replace(/^private:/,''),String(id)];}
 receive(account,peer,event){const id=event.message_id??event.msg_id;if(id==null||!String(id).trim()||String(id)==='0')return null;this.db.prepare('INSERT OR IGNORE INTO inbound_ledger(account,channel,peer,message_id,payload,received_at) VALUES(?,?,?,?,?,?)').run(...this.key(account,peer,id),JSON.stringify(event),this.now());return String(id);}
 claim(account,peer,id){const lease=randomUUID(),result=this.db.prepare("UPDATE inbound_ledger SET lease=?,lease_until=?,error=NULL WHERE account=? AND channel=? AND peer=? AND message_id=? AND stage<>'projected' AND decision='pending' AND retry_at<=? AND lease_until<=?").run(lease,this.now()+180000,...this.key(account,peer,id),this.now(),this.now());return result.changes?lease:null;}
 release(account,peer,id,lease,error){this.db.prepare("UPDATE inbound_ledger SET lease=NULL,lease_until=0,retry_at=?,error=? WHERE account=? AND channel=? AND peer=? AND message_id=? AND lease=? AND stage<>'projected'").run(this.now()+5000,String(error?.code||error?.message||error||'deferred').slice(0,160),...this.key(account,peer,id),lease);}
 completeControl(account,peer,id,lease,decision='control-handled'){
  if(!['control-handled','control-rejected','legacy-control-retired'].includes(decision)||typeof lease!=='string'||!lease)throw Error('INVALID_INBOUND_CONTROL_DECISION');
  // Consume the leased input before an optional system notice or command side
  // effect. An ambiguous notification failure must not resend it every retry.
  return this.db.prepare("UPDATE inbound_ledger SET stage='control',decision=?,lease=NULL,lease_until=0,retry_at=0,error=NULL WHERE account=? AND channel=? AND peer=? AND message_id=? AND lease=? AND stage<>'projected' AND decision='pending'").run(decision,...this.key(account,peer,id),lease).changes>0;
 }
 project(account,peer,id,recordId,seq,normalized){this.db.prepare("UPDATE inbound_ledger SET stage='projected',record_id=?,local_seq=?,normalized=?,lease=NULL,lease_until=0,error=NULL WHERE account=? AND channel=? AND peer=? AND message_id=?").run(recordId||null,seq,JSON.stringify(normalized),...this.key(account,peer,id));}
 seen(account,peer,ids,cycle='chat'){for(const id of ids.filter(Boolean))this.db.prepare('INSERT OR IGNORE INTO inbound_seen VALUES(?,?,?,?,?)').run(String(account),String(peer).replace(/^private:/,''),String(id),cycle,this.now());}
 decide(account,peer,ids,decision='reviewed-no-reply'){for(const id of ids.filter(Boolean))this.db.prepare(`UPDATE inbound_ledger SET decision=? WHERE account=? AND channel=? AND peer=? AND message_id=? AND EXISTS(SELECT 1 FROM inbound_seen s WHERE s.account=inbound_ledger.account AND s.peer=inbound_ledger.peer AND s.message_id=inbound_ledger.message_id)`).run(decision,...this.key(account,peer,id));}
 pendingPeers(account){const now=this.now();return this.db.prepare("SELECT peer FROM inbound_ledger WHERE account=? AND channel='qq' AND decision='pending' AND stage<>'projected' AND retry_at<=? AND lease_until<=? GROUP BY peer ORDER BY min(received_at),min(rowid)").all(String(account),now,now).map(row=>row.peer);}
 pending(account,limit=50,{peers}={}){
  if(!Number.isSafeInteger(limit)||limit<1)throw Error('INVALID_INBOUND_LIMIT');
  if(peers!==undefined){
   // Check every array position, including holes, before encoding the bound value.
   if(!Array.isArray(peers)||Array.from(peers).some(peer=>typeof peer!=='string'||!/^\d+$/.test(peer)))throw Error('INVALID_INBOUND_PEERS');
   if(!peers.length)return [];
  }
  const now=this.now(),clauses=["account=?","channel='qq'","decision='pending'","stage<>'projected'","retry_at<=?","lease_until<=?"],args=[String(account),now,now];
  // Apply eligibility before ranking and LIMIT. One JSON parameter also avoids
  // SQLite's variable limit when an account has many ready conversations.
  if(peers!==undefined){clauses.push('peer IN (SELECT value FROM json_each(?))');args.push(JSON.stringify([...new Set(peers)]));}
  return this.db.prepare(`SELECT account,channel,peer,message_id,payload,received_at,stage,lease,lease_until,retry_at,record_id,local_seq,normalized,decision,model_cycle,error FROM (
   SELECT *,rowid AS sequence,row_number() OVER(PARTITION BY peer ORDER BY received_at,rowid) AS turn
   FROM inbound_ledger WHERE ${clauses.join(' AND ')}) ORDER BY turn,received_at,sequence LIMIT ?`).all(...args,limit);
 }
 pendingCount(account){return this.db.prepare("SELECT count(*) n FROM inbound_ledger WHERE account=? AND channel='qq' AND decision='pending' AND stage<>'projected'").get(String(account)).n;}
 row(account,peer,id){return this.db.prepare('SELECT * FROM inbound_ledger WHERE account=? AND channel=? AND peer=? AND message_id=?').get(...this.key(account,peer,id));}
}
