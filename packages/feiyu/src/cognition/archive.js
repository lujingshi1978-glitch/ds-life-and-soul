import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {bounded,id,json,parse,hash,fail,entityId} from './contracts.js';
import {HistorySearch} from './v3-history.js';
import {isOperationalMaterial} from '../operational-material.js';

// Versioned resource bytes and durable adapter outbox are separate from memory.
export class CognitionArchive {
  constructor(dir,characterId,{now=Date.now}={}){
    this.characterId=characterId;this.now=now;this.databaseFile=path.join(dir,'archive-v2.sqlite');this.db=new DatabaseSync(this.databaseFile);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),character_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(source_id TEXT NOT NULL,revision INTEGER NOT NULL,adapter TEXT NOT NULL,external_id TEXT NOT NULL,kind TEXT NOT NULL,
        checksum TEXT NOT NULL,body TEXT NOT NULL,metadata TEXT NOT NULL,observed_at INTEGER NOT NULL,occurred_at INTEGER,status TEXT NOT NULL DEFAULT 'available',PRIMARY KEY(source_id,revision));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,applied INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS learning_exclusions(source_id TEXT NOT NULL,revision INTEGER NOT NULL,request_id TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(source_id,revision));`);
    const owner=this.db.prepare('SELECT character_id FROM owner').get();
    if(owner&&owner.character_id!==characterId){this.db.close();fail('CHARACTER_MISMATCH');}
    this.db.prepare('INSERT OR IGNORE INTO owner VALUES(1,?)').run(characterId);
    this.db.exec('CREATE INDEX IF NOT EXISTS outbox_pending_applied ON outbox(applied)');
  }
  append(source,event={}){
    const adapter=bounded(source.adapter,40),externalId=id(source.externalId),kind=bounded(source.kind,40);bounded(source.text,250000,{empty:true});const body=source.text;
    const metadata={...(source.metadata||{})};if(metadata.speakerId)entityId(metadata.speakerId);
    if((metadata.basisSources||[]).some(ref=>this.learningExcluded(ref.sourceId,ref.revision))){metadata.learningExcluded=true;metadata.diagnostic=true;}
    const checksum=hash([body,metadata]),sourceId='source:'+hash([adapter,externalId,kind]).slice(0,32);
    const latest=this.db.prepare('SELECT * FROM documents WHERE source_id=? ORDER BY revision DESC LIMIT 1').get(sourceId);
    if(latest?.status==='deleted')fail('SOURCE_DELETED');
    const revision=source.revision??(latest?.checksum===checksum?latest.revision:(latest?.revision||0)+1);
    if(!Number.isSafeInteger(revision)||revision<1)fail('INVALID_REVISION');
    const existing=this.db.prepare('SELECT * FROM documents WHERE source_id=? AND revision=?').get(sourceId,revision);
    if(existing&&existing.checksum!==checksum)fail('SOURCE_REVISION_CONFLICT');
    if(!existing&&latest&&revision<=latest.revision)fail('SOURCE_REVISION_CONFLICT');
    const eventKind=bounded(event.kind||'resource-observed',60),root=id(event.eventRoot||`${adapter}:${externalId}`),outcome=event.outcome||'observed';
    if(!['observed','requested','started','completed','failed','cancelled'].includes(outcome))fail('INVALID_OUTCOME');
    const key=hash([this.characterId,sourceId,revision,eventKind,event.externalId||'',outcome]);
    const envelope={sourceId,revision,eventId:'event:'+key.slice(0,32),idempotencyKey:key,eventRoot:root,kind:eventKind,outcome,payload:event.payload||{}};
    const prior=this.db.prepare('SELECT payload FROM outbox WHERE id=?').get(key);
    if(prior&&prior.payload!==json(envelope))fail('EVENT_IDEMPOTENCY_CONFLICT');
    this.db.exec('BEGIN IMMEDIATE');try{
      this.db.prepare('INSERT OR IGNORE INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(sourceId,revision,adapter,externalId,kind,checksum,body,json(metadata),this.now(),source.occurredAt??null,'available');
      this.db.prepare('INSERT OR IGNORE INTO outbox(id,payload) VALUES(?,?)').run(key,json(envelope));this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return envelope;
  }
  learningExcluded(sourceId,revision,seen=new Set()){const key=sourceId+'@'+revision;if(seen.has(key))return false;if(seen.size>=4096)fail('BASIS_SOURCE_LIMIT');seen.add(key);if(this.db.prepare('SELECT 1 FROM learning_exclusions WHERE source_id=? AND revision=?').get(sourceId,revision))return true;const row=this.db.prepare('SELECT metadata,body FROM documents WHERE source_id=? AND revision=?').get(sourceId,revision);if(!row)return false;const meta=parse(row.metadata);return isOperationalMaterial({text:row.body,metadata:meta})||(meta.basisSources||[]).some(ref=>this.learningExcluded(ref.sourceId,ref.revision,seen));}
  get(sourceId,revision){const row=this.db.prepare('SELECT * FROM documents WHERE source_id=? AND revision=?').get(sourceId,revision);if(!row||row.status==='deleted')fail('SOURCE_UNAVAILABLE');const exclusion=this.db.prepare('SELECT request_id,reason FROM learning_exclusions WHERE source_id=? AND revision=?').get(sourceId,revision),excluded=this.learningExcluded(sourceId,revision);return {...row,sourceId:row.source_id,externalId:row.external_id,metadata:{...parse(row.metadata),...(excluded?{learningExcluded:true,diagnostic:true,...(exclusion?{diagnosticExclusion:exclusion}:{})}: {})},text:row.body};}
  pending(limit=100){return this.db.prepare('SELECT id,payload FROM outbox WHERE applied=0 ORDER BY rowid LIMIT ?').all(limit).map(r=>({...r,envelope:parse(r.payload)}));}
  enableV3(){this.history??=new HistorySearch(this);return this.history;}
  ack(key){this.db.prepare('UPDATE outbox SET applied=1 WHERE id=?').run(key);}
  search({query='',speakerId,kind,from=0,to=Number.MAX_SAFE_INTEGER,cursor=0,limit=10}={}){
    if(this.history)return this.history.search(arguments[0]||{});
    limit=Math.max(1,Math.min(20,Number(limit)||10));cursor=Math.max(0,Number(cursor)||0);
    if(speakerId)entityId(speakerId);
    const escaped=String(query).replace(/[\\%_]/g,'\\$&');
    const rows=this.db.prepare(`SELECT d.* FROM documents d WHERE status<>'deleted' AND revision=(SELECT max(revision) FROM documents WHERE source_id=d.source_id)
      AND body LIKE ? ESCAPE '\\' AND (? IS NULL OR kind=?) AND (? IS NULL OR json_extract(metadata,'$.speakerId')=?)
      AND coalesce(occurred_at,observed_at) BETWEEN ? AND ? ORDER BY observed_at DESC,source_id LIMIT ? OFFSET ?`)
      .all('%'+escaped+'%',kind||null,kind||null,speakerId||null,speakerId||null,from,to,limit,cursor);
    return {origin:'archive-not-memory',items:rows.map(r=>({sourceId:r.source_id,revision:r.revision,kind:r.kind,metadata:parse(r.metadata),occurredAt:r.occurred_at,observedAt:r.observed_at,preview:r.body.slice(0,300)})),nextCursor:rows.length===limit?cursor+limit:null};
  }
  read(sourceId,revision,{offset=0,limit=4000,maxChars=12000}={}){const r=this.get(sourceId,revision),start=Math.max(0,Number(offset)||0),cap=Math.max(1,Math.min(Math.max(1,Math.min(100000,Number(maxChars)||12000)),Number(limit)||4000));return {origin:'archive-not-memory',sourceId,revision,metadata:r.metadata,text:r.text.slice(start,start+cap),nextOffset:start+cap<r.text.length?start+cap:null,checksum:r.checksum};}
  erase(sourceId){this.db.prepare("UPDATE documents SET body='',metadata='{}',status='deleted' WHERE source_id=?").run(sourceId);this.history?.erase(sourceId);this.resourceVectors?.erase(sourceId);this.onErase?.(sourceId);}
  close(){this.db.close();}
}
