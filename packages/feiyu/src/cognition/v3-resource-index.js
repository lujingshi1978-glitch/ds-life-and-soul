import {json,assertSignal} from './contracts.js';
import {viewChunks} from './v3-views.js';

export async function indexResource(index,ref,model,signal){
 let d;try{d=index.a.get(ref.sourceId,ref.revision);}catch(error){if(error.code==='SOURCE_UNAVAILABLE')return 0;throw error;}
 if(d.status!=='available'||d.checksum!==ref.checksum)return 0;
 const db=index.db,e=index.r.retriever.embedding,parts=viewChunks({kind:'resource',text:d.text},{size:320,overlap:48}),old=db.prepare('SELECT * FROM v3_resource_vector_progress WHERE source_id=? AND revision=? AND model=?').get(ref.sourceId,ref.revision,model),start=old?.checksum===d.checksum?old.next_part:0,rows=parts.slice(start,start+8),vectors=[];
 for(let i=0;i<rows.length;i+=e.batchSize||3)vectors.push(...await index.r.retriever.embed(rows.slice(i,i+(e.batchSize||3)).map(x=>x.text),{signal,purpose:'index',privateData:d.metadata.privacyLabel!=='public'}));
 assertSignal(signal);let latest;try{latest=index.a.get(ref.sourceId,ref.revision);}catch(error){if(error.code==='SOURCE_UNAVAILABLE')return 0;throw error;}if(latest.status!=='available'||latest.checksum!==d.checksum)return 0;
 db.exec('BEGIN IMMEDIATE');try{for(let i=0;i<rows.length;i++)db.prepare('INSERT OR REPLACE INTO v3_resource_vectors VALUES(?,?,?,?,?,?,?,?)').run(ref.sourceId,ref.revision,model,d.checksum,start+i,rows[i].offset,rows[i].length,json(vectors[i]));db.prepare('INSERT OR REPLACE INTO v3_resource_vector_progress VALUES(?,?,?,?,?,?)').run(ref.sourceId,ref.revision,model,d.checksum,start+rows.length,parts.length);db.prepare('DELETE FROM v3_resource_failures WHERE source_id=? AND revision=? AND model=?').run(ref.sourceId,ref.revision,model);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}return rows.length;
}
