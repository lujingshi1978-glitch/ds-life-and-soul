import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import path from 'node:path';

const kinds=new Set(['private','group']);
function record(kind,peer,event,account,{body=JSON.stringify(event),at=Date.now(),reason=null}={}){
  if(!kinds.has(kind))throw Error('INVALID_INBOX_KIND');
  if(!event||typeof event!=='object'||typeof body!=='string')throw Error('INVALID_INBOX_EVENT');
  if(!Number.isSafeInteger(at))throw Error('INVALID_INBOX_TIME');
  if(reason!==null&&typeof reason!=='string')throw Error('INVALID_INBOX_REASON');
  account=String(account??event.self_id??'unknown');peer=String(peer);
  const ref=event.message_id??event.msg_id??createHash('sha256').update(body).digest('hex');
  // A reason describes why delivery waited; it never changes event identity.
  return {id:JSON.stringify([account,kind,peer,String(ref)]),account,kind,peer,body,at,reason};
}

// Unperceived transport mail. Character memory and night summary state live elsewhere.
export class TransportInbox {
  constructor(file,{now=Date.now,db}={}){
    this.now=now;this.db=db||new DatabaseSync(file);this.ownsDatabase=!db;
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS transport_inbox(
        id TEXT PRIMARY KEY,account TEXT NOT NULL,kind TEXT NOT NULL,peer TEXT NOT NULL,
        body TEXT NOT NULL,at INTEGER NOT NULL,reason TEXT);
      CREATE INDEX IF NOT EXISTS transport_inbox_scope ON transport_inbox(account,kind,peer,at);
      CREATE TABLE IF NOT EXISTS transport_inbox_migrations(
        source TEXT PRIMARY KEY,completed_at INTEGER NOT NULL,rows_read INTEGER NOT NULL,rows_inserted INTEGER NOT NULL);`);
  }
  insert(row){
    return this.db.prepare(`INSERT INTO transport_inbox(id,account,kind,peer,body,at,reason) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET reason=COALESCE(transport_inbox.reason,excluded.reason),at=MIN(transport_inbox.at,excluded.at)`)
      .run(row.id,row.account,row.kind,row.peer,row.body,row.at,row.reason);
  }
  buffer(kind,peer,event,account,reason=null){
    const row=record(kind,peer,event,account,{at:this.now(),reason});this.insert(row);return row.id;
  }
  count(account){
    return account===undefined?this.db.prepare('SELECT count(*) n FROM transport_inbox').get().n:
      this.db.prepare('SELECT count(*) n FROM transport_inbox WHERE account=?').get(String(account)).n;
  }
  peers(account){
    return this.db.prepare('SELECT kind,peer FROM transport_inbox WHERE account=? GROUP BY kind,peer ORDER BY min(at),min(rowid)').all(String(account));
  }
  list(account,{kind,peer,peers,limit=100}={}){
    if(kind!==undefined&&!kinds.has(kind))throw Error('INVALID_INBOX_KIND');
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_INBOX_LIMIT');
    if(peers!==undefined){
      if(!Array.isArray(peers)||peers.some(scope=>typeof scope!=='string'||!/^(private|group):[^\x00-\x20\x7f]+$/.test(scope)))throw Error('INVALID_INBOX_PEERS');
      if(!peers.length)return [];
    }
    const clauses=['account=?'],args=[String(account)];
    if(kind!==undefined){clauses.push('kind=?');args.push(kind);}
    if(peer!==undefined){clauses.push('peer=?');args.push(String(peer));}
    // Filter eligible conversations before ranking and LIMIT; blocked peers
    // must not occupy the entire window. One JSON parameter handles large sets.
    if(peers!==undefined){clauses.push("(kind||':'||peer) IN (SELECT value FROM json_each(?))");args.push(JSON.stringify([...new Set(peers)]));}
    // Each conversation contributes its next message before any contributes its second.
    // A full or unauthorized conversation therefore cannot hide every other peer.
    return this.db.prepare(`SELECT id,account,kind,peer,body,at,reason FROM (
      SELECT *,rowid AS sequence,row_number() OVER(PARTITION BY kind,peer ORDER BY at,rowid) AS turn
      FROM transport_inbox WHERE ${clauses.join(' AND ')}) ORDER BY turn,at,sequence LIMIT ?`).all(...args,limit);
  }
  remove(id){return this.db.prepare('DELETE FROM transport_inbox WHERE id=?').run(id).changes>0;}
  close(){if(this.ownsDatabase)this.db.close();}

  migrateLegacy({nightRestFile,energyInboxFile}={}){
    return [[nightRestFile,'inbox','night-rest'],[energyInboxFile,'energy_inbox','energy-rest']]
      .filter(([file])=>file).map(([file,table,reason])=>this.migrateSource(file,table,reason));
  }
  migrateSource(file,table,reason){
    if(!['inbox','energy_inbox'].includes(table))throw Error('INVALID_LEGACY_INBOX_TABLE');
    const source=JSON.stringify([path.resolve(file),table]);
    if(this.db.prepare('SELECT 1 FROM transport_inbox_migrations WHERE source=?').get(source))return {source,status:'complete',imported:0};
    if(file===':memory:'||!existsSync(file))return {source,status:'missing',imported:0};
    // The legacy database is a read-only snapshot. Its transaction cannot commit
    // atomically with the destination; only destination rows and its completion
    // marker share a transaction. Retained source files must have no active writer
    // once bridge routing switches to this inbox.
    const legacy=new DatabaseSync(file,{readOnly:true});let rows;
    try{
      legacy.exec('PRAGMA query_only=ON; BEGIN');
      if(!legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))return {source,status:'absent',imported:0};
      rows=legacy.prepare(`SELECT account,kind,peer,body,at FROM ${table} ORDER BY at,rowid`).all();
    }finally{legacy.close();}
    this.db.exec('BEGIN IMMEDIATE');
    try{
      // Recheck after taking the target write lock, including competing importers.
      if(this.db.prepare('SELECT 1 FROM transport_inbox_migrations WHERE source=?').get(source)){
        this.db.exec('COMMIT');return {source,status:'complete',imported:0};
      }
      let imported=0;
      for(const row of rows){
        const entry=record(row.kind,row.peer,JSON.parse(row.body),row.account,{body:row.body,at:row.at,reason});
        const exists=this.db.prepare('SELECT 1 FROM transport_inbox WHERE id=?').get(entry.id);
        this.insert(entry);if(!exists)imported++;
      }
      this.db.prepare('INSERT INTO transport_inbox_migrations VALUES(?,?,?,?)').run(source,this.now(),rows.length,imported);
      this.db.exec('COMMIT');return {source,status:'migrated',read:rows.length,imported};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
