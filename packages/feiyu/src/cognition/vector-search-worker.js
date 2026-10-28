import {parentPort,workerData as d} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';import {cosine} from './contracts.js';
let db;
try{
 db=new DatabaseSync(d.file,{readOnly:true});db.exec('PRAGMA busy_timeout=250');
 if(d.arm==='archive'){
  if(db.prepare('SELECT character_id FROM owner').get()?.character_id!==d.characterId)throw Error('CHARACTER_MISMATCH');
  const scores=new Map(),f=d.filters||{},sql="SELECT v.*,d.metadata,d.kind,d.occurred_at,d.observed_at,d.body FROM v3_resource_vectors v JOIN documents d ON d.source_id=v.source_id AND d.revision=v.revision AND d.checksum=v.checksum WHERE v.model=? AND d.status='available' AND d.revision=(SELECT max(x.revision) FROM documents x WHERE x.source_id=d.source_id)";
  for(const row of db.prepare(sql).iterate(d.model)){let meta,vector;try{meta=JSON.parse(row.metadata);vector=JSON.parse(row.vector);}catch{continue;}if(!Array.isArray(vector)||vector.length!==d.dimensions||!vector.every(Number.isFinite))continue;
   const axis=f.axis==='stated'?(meta.statedAt??row.occurred_at):row.occurred_at;
   if(f.kind&&row.kind!==f.kind||f.speakerId&&meta.speakerId!==f.speakerId||f.conversationPeerId&&meta.conversationPeerId!==f.conversationPeerId||f.platform&&meta.platform!==f.platform||f.from!=null&&axis<f.from||f.to!=null&&axis>f.to)continue;
   const score=cosine(d.query,vector);if(score<d.threshold||scores.get(row.source_id)?.score>=score)continue;
   const chars=[...row.body],preview=chars.slice(row.offset,row.offset+row.length).join(''),offset=chars.slice(0,row.offset).join('').length;
   scores.set(row.source_id,{sourceId:row.source_id,revision:row.revision,checksum:row.checksum,kind:row.kind,metadata:meta,occurredAt:row.occurred_at,preview,previewOffset:offset,matchedSpans:[{offset,length:preview.length}],score});
  }
  parentPort.postMessage({hits:[...scores.values()].sort((a,b)=>b.score-a.score).slice(0,d.limit)});
 }else{
 const view=d.arm==='views',table=view?'v3_view_vectors':'v2_vectors';
 const sql=`SELECT e.* FROM ${table} e JOIN memory_nodes n ON n.character_id=? AND n.memory_id=e.memory_id AND n.current_revision=e.revision JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision AND v.content_hash=e.content_hash WHERE e.model=? ${view?'AND e.view_version=?':''} AND n.status IN ('active','contested','outdated','faded') AND NOT EXISTS(SELECT 1 FROM suppression x WHERE x.character_id=n.character_id AND x.target_type='memory' AND x.target_id=n.memory_id) AND NOT EXISTS(SELECT 1 FROM memory_evidence me JOIN suppression x ON x.character_id=n.character_id AND x.target_type='source' AND x.target_id=me.source_id WHERE me.character_id=n.character_id AND me.memory_id=n.memory_id AND me.memory_revision=n.current_revision)`;
 const best=new Map();for(const row of db.prepare(sql).iterate(d.characterId,d.model,...(view?[d.viewVersion]:[]))){
  let vector;try{vector=JSON.parse(row.vector);}catch{continue;}if(!Array.isArray(vector)||vector.length!==d.dimensions||!vector.every(Number.isFinite))continue;
  const score=cosine(d.query,vector),old=best.get(row.memory_id);if(score<d.threshold||old&&old.score>=score)continue;
  best.set(row.memory_id,{id:row.memory_id,score,revision:row.revision,contentHash:row.content_hash,...(view?{view:row.view_kind,part:row.part,offset:row.offset,length:row.length}:{})});
 }
 parentPort.postMessage({hits:[...best.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,d.limit)});
 }
}catch(e){parentPort.postMessage({error:e.code||e.message});}finally{db?.close();}
