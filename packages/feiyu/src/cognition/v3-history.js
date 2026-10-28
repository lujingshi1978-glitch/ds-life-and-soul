import {randomUUID} from 'node:crypto';
import {json,parse,terms,entityId,fail,hash} from './contracts.js';

export class HistorySearch {
  constructor(archive){this.archive=archive;this.db=archive.db;this.now=archive.now;
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS v3_archive_fts USING fts5(source_id UNINDEXED,revision UNINDEXED,terms);
      CREATE TABLE IF NOT EXISTS v3_archive_index(source_id TEXT NOT NULL,revision INTEGER NOT NULL,checksum TEXT NOT NULL,PRIMARY KEY(source_id,revision));
      CREATE TABLE IF NOT EXISTS v3_search_snapshots(id TEXT PRIMARY KEY,query_hash TEXT NOT NULL,expires INTEGER NOT NULL,items TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS v3_archive_fts_rows(source_id TEXT NOT NULL,revision INTEGER NOT NULL,fts_rowid INTEGER NOT NULL UNIQUE,PRIMARY KEY(source_id,revision));
      CREATE TABLE IF NOT EXISTS v3_archive_fts_rowmap_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.installRowMap();
    this.pruneOrphans();
  }
  write(fn){
    // Join an existing archive transaction without committing or rolling it back.
    const own=this.db.isTransaction===false,savepoint='archive_fts_'+randomUUID().replaceAll('-','');
    this.db.exec(own?'BEGIN IMMEDIATE':'SAVEPOINT '+savepoint);
    try{const result=fn();this.db.exec(own?'COMMIT':'RELEASE '+savepoint);return result;}
    catch(error){if(own)this.db.exec('ROLLBACK');else this.db.exec('ROLLBACK TO '+savepoint+'; RELEASE '+savepoint);throw error;}
  }
  installRowMap(){
    if(this.db.prepare("SELECT 1 FROM v3_archive_fts_rowmap_meta WHERE key='version' AND value='1'").get())return;
    this.write(()=>{
      if(this.db.prepare("SELECT 1 FROM v3_archive_fts_rowmap_meta WHERE key='version' AND value='1'").get())return;
      // This is the only full FTS scan. Preserve valid legacy rowids and content.
      const rows=this.db.prepare('SELECT rowid,source_id,revision FROM v3_archive_fts ORDER BY rowid').all();
      this.db.exec('DELETE FROM v3_archive_fts_rows');
      const doc=this.db.prepare("SELECT 1 FROM documents WHERE source_id=? AND revision=? AND status<>'deleted'"),find=this.db.prepare('SELECT fts_rowid FROM v3_archive_fts_rows WHERE source_id=? AND revision=?'),insert=this.db.prepare('INSERT INTO v3_archive_fts_rows VALUES(?,?,?)'),remove=this.db.prepare('DELETE FROM v3_archive_fts WHERE rowid=?'),invalidate=this.db.prepare('DELETE FROM v3_archive_index WHERE source_id=? AND revision=?');
      for(const row of rows){
        if(typeof row.source_id!=='string'||!Number.isSafeInteger(row.revision)||row.revision<1||!doc.get(row.source_id,row.revision)){remove.run(row.rowid);continue;}
        if(find.get(row.source_id,row.revision)){
          remove.run(row.rowid);
          // A duplicate's terms may disagree. Rebuild this key from complete raw text.
          invalidate.run(row.source_id,row.revision);
        }else insert.run(row.source_id,row.revision,row.rowid);
      }
      this.db.exec('DELETE FROM v3_archive_index WHERE NOT EXISTS(SELECT 1 FROM v3_archive_fts_rows m WHERE m.source_id=v3_archive_index.source_id AND m.revision=v3_archive_index.revision)');
      this.db.prepare("INSERT OR REPLACE INTO v3_archive_fts_rowmap_meta VALUES('version','1')").run();
    });
  }
  pruneOrphans(){
    // Also finish a deletion interrupted after the archive tombstone committed.
    const missing=this.db.prepare("SELECT m.* FROM v3_archive_fts_rows m LEFT JOIN documents d ON d.source_id=m.source_id AND d.revision=m.revision WHERE d.source_id IS NULL OR d.status='deleted'");
    if(!missing.get())return;
    this.write(()=>{const rows=missing.all(),remove=this.db.prepare('DELETE FROM v3_archive_fts WHERE rowid=?'),mapping=this.db.prepare('DELETE FROM v3_archive_fts_rows WHERE source_id=? AND revision=?'),coverage=this.db.prepare('DELETE FROM v3_archive_index WHERE source_id=? AND revision=?');for(const row of rows){remove.run(row.fts_rowid);mapping.run(row.source_id,row.revision);coverage.run(row.source_id,row.revision);}});
  }
  index(){
    const rows=this.db.prepare(`SELECT d.source_id,d.revision FROM documents d LEFT JOIN v3_archive_index i ON i.source_id=d.source_id AND i.revision=d.revision LEFT JOIN v3_archive_fts_rows m ON m.source_id=d.source_id AND m.revision=d.revision WHERE d.status<>'deleted' AND (i.checksum IS NULL OR i.checksum<>d.checksum||':full-v2' OR m.fts_rowid IS NULL) LIMIT 20000`).all();
    if(!rows.length)return 0;
    return this.write(()=>{
      const get=this.db.prepare("SELECT * FROM documents WHERE source_id=? AND revision=? AND status<>'deleted'"),mapping=this.db.prepare('SELECT fts_rowid FROM v3_archive_fts_rows WHERE source_id=? AND revision=?'),remove=this.db.prepare('DELETE FROM v3_archive_fts WHERE rowid=?'),insert=this.db.prepare('INSERT INTO v3_archive_fts VALUES(?,?,?)'),saveMapping=this.db.prepare('INSERT OR REPLACE INTO v3_archive_fts_rows VALUES(?,?,?)'),saveCoverage=this.db.prepare('INSERT OR REPLACE INTO v3_archive_index VALUES(?,?,?)');let indexed=0;
      for(const ref of rows){const d=get.get(ref.source_id,ref.revision);if(!d)continue;const old=mapping.get(d.source_id,d.revision);if(old)remove.run(old.fts_rowid);
        const chunks=[];for(let offset=0;offset<d.body.length;offset+=400)chunks.push(...terms(d.body.slice(Math.max(0,offset-8),offset+408)));
        const result=insert.run(d.source_id,d.revision,[...new Set(chunks)].join(' '));
        saveMapping.run(d.source_id,d.revision,result.lastInsertRowid);saveCoverage.run(d.source_id,d.revision,d.checksum+':full-v2');indexed++;
      }return indexed;
    });
  }
  search(input={}){
    const {query='',speakerId,conversationPeerId,kind,platform,knowledgeAsOf,time,mode='terms'}=input;
    for(const p of [speakerId,conversationPeerId].filter(Boolean))entityId(p);
    if(!['terms','literal','semantic'].includes(mode)||String(query).length>1000)fail('INVALID_HISTORY_QUERY');
    if(time?.axis==='valid')return {origin:'archive-not-memory',items:[],nextCursor:null,unsupportedAxis:'valid',nextAction:'查有来源的命题有效期；原始消息只有发生和提及时间'};
    if(time?.axis&&!['occurred','stated'].includes(time.axis))fail('INVALID_TIME_AXIS');
    const limit=Math.max(1,Math.min(20,Number(input.limit)||10));
    let entries,offset=0,snapshotId;
    if(input.cursor&&typeof input.cursor==='string'){
      let cursor;try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));}catch{fail('INVALID_HISTORY_CURSOR');}
      const snap=this.db.prepare('SELECT * FROM v3_search_snapshots WHERE id=?').get(cursor.snapshotId);if(!snap||snap.expires<this.now())fail('HISTORY_SNAPSHOT_EXPIRED');
      const signature={query,speakerId,conversationPeerId,kind,platform,knowledgeAsOf,time,mode,from:input.from,to:input.to};if(snap.query_hash!==hash(signature))fail('HISTORY_CURSOR_QUERY_MISMATCH');
      entries=parse(snap.items);offset=cursor.offset;snapshotId=cursor.snapshotId;if(!Number.isSafeInteger(offset)||offset<0)fail('INVALID_HISTORY_CURSOR');
    }else{
      this.index();
      const signature={query,speakerId,conversationPeerId,kind,platform,knowledgeAsOf,time,mode,from:input.from,to:input.to},args=[],where=["d.status<>'deleted'"];
      if(knowledgeAsOf!=null){if(!Number.isSafeInteger(knowledgeAsOf))fail('INVALID_TIME');where.push('d.observed_at<=?');args.push(knowledgeAsOf);}
      where.push('d.revision=(SELECT max(z.revision) FROM documents z WHERE z.source_id=d.source_id'+(knowledgeAsOf!=null?' AND z.observed_at<=?':'')+')');if(knowledgeAsOf!=null)args.push(knowledgeAsOf);
      for(const [expr,value]of [['d.kind',kind],["json_extract(d.metadata,'$.speakerId')",speakerId],["json_extract(d.metadata,'$.conversationPeerId')",conversationPeerId],["json_extract(d.metadata,'$.platform')",platform]])if(value){where.push(expr+'=?');args.push(value);}
      const from=time?.from??input.from,to=time?.to??input.to;
      const at=time?.axis==='stated'?"coalesce(json_extract(d.metadata,'$.statedAt'),d.occurred_at)":'d.occurred_at';
      if(from!=null){where.push(at+'>=?');args.push(from);}if(to!=null){where.push(at+'<=?');args.push(to);}
      let join='',order='coalesce(d.occurred_at,d.observed_at) DESC,d.source_id,d.revision';
      if(query){if(mode==='literal'){where.push("d.body LIKE ? ESCAPE '\\'");args.push('%'+String(query).replace(/[\\%_]/g,'\\$&')+'%');}
        else{const words=terms(query).slice(0,40);if(!words.length)return {origin:'archive-not-memory',items:[],nextCursor:null};join=' JOIN v3_archive_fts f ON f.source_id=d.source_id AND f.revision=d.revision';where.push('v3_archive_fts MATCH ?');args.push(words.map(x=>'"'+x.replaceAll('"','""')+'"').join(' OR '));order='bm25(v3_archive_fts),'+order;}}
      entries=this.db.prepare('SELECT d.source_id sourceId,d.revision,d.checksum FROM documents d'+join+' WHERE '+where.join(' AND ')+' ORDER BY '+order+' LIMIT 200').all(...args);
      snapshotId=randomUUID();this.db.prepare('INSERT INTO v3_search_snapshots VALUES(?,?,?,?)').run(snapshotId,hash(signature),this.now()+600000,json(entries));this.db.prepare('DELETE FROM v3_search_snapshots WHERE expires<?').run(this.now());
    }
    const items=[],end=Math.min(entries.length,offset+limit);
    for(const ref of entries.slice(offset,end)){
      const d=this.db.prepare("SELECT * FROM documents WHERE source_id=? AND revision=? AND status<>'deleted'").get(ref.sourceId,ref.revision);if(!d)continue;
      const latest=this.db.prepare('SELECT revision,status FROM documents WHERE source_id=? ORDER BY revision DESC LIMIT 1').get(ref.sourceId);if(latest?.status==='deleted')continue;
      const body=d.body,words=mode==='literal'?[query]:[query,...terms(query)],matches=[];for(const word of words.filter(Boolean)){const at=body.toLowerCase().indexOf(String(word).toLowerCase());if(at>=0&&!matches.some(s=>s.offset===at&&s.length===word.length))matches.push({offset:at,length:word.length});if(matches.length>=6)break;}
      const start=Math.max(0,(matches[0]?.offset||0)-100),finish=Math.min(body.length,start+500);
      items.push({sourceId:d.source_id,revision:d.revision,checksum:d.checksum,kind:d.kind,metadata:parse(d.metadata),occurredAt:d.occurred_at,observedAt:d.observed_at,preview:body.slice(start,finish),previewOffset:start,matchedSpans:matches,revisionAfterSnapshot:latest?.revision>d.revision?latest.revision:null});
    }
    return {origin:'archive-not-memory',snapshotId,items,nextCursor:end<entries.length?Buffer.from(json({snapshotId,offset:end})).toString('base64url'):null,coverage:{resultWindow:200,frozenOrdering:true},...(mode==='semantic'?{limitation:'语义档案候选当前用词法降级；可先用回忆定位来源再查原文'}:{})};
  }
  erase(sourceId){return this.write(()=>{const rows=this.db.prepare('SELECT fts_rowid FROM v3_archive_fts_rows WHERE source_id=?').all(sourceId),remove=this.db.prepare('DELETE FROM v3_archive_fts WHERE rowid=?');for(const row of rows)remove.run(row.fts_rowid);this.db.prepare('DELETE FROM v3_archive_fts_rows WHERE source_id=?').run(sourceId);this.db.prepare('DELETE FROM v3_archive_index WHERE source_id=?').run(sourceId);});}
}
