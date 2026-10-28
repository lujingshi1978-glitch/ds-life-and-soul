import {hash,json} from './contracts.js';
import {EXTRACTOR_VERSION,sourceUnits} from './v3-extraction.js';

export function adoptLegacyCoverage(runtime){
  const s=runtime.store,db=s.db;let adopted=0;
  for(const event of db.prepare('SELECT e.*,es.source_id,es.source_revision FROM cognitive_events e JOIN event_sources es USING(character_id,event_id)').all()){
    const parts=db.prepare('SELECT p.part,p.job_id,j.status,j.payload_json FROM v2_event_parts p JOIN jobs j USING(job_id) WHERE p.event_id=? ORDER BY p.part').all(event.event_id);
    if(!parts.length)continue;
    let doc;try{doc=runtime.archive.get(event.source_id,event.source_revision);}catch{continue;}
    db.prepare("DELETE FROM v3_extract_units WHERE event_id=? AND source_id=? AND status LIKE 'adopted-v2-%'").run(event.event_id,event.source_id);
    for(const p of parts){
      const payload=JSON.parse(p.payload_json),matching=(payload.parts||[]).filter(x=>x.eventId===event.event_id&&x.sourceId===event.source_id&&x.revision===event.source_revision&&x.part===p.part);
      // The original V2 splitter used UTF-16 slices of 3000. Completed jobs
      // intentionally discarded payload; the immutable part ordinal remains.
      const ranges=matching.length?matching:[{offset:p.part*3000,length:Math.min(3000,Math.max(0,doc.text.length-p.part*3000))}];
      for(const range of ranges){if(range.offset>doc.text.length)continue;const length=Math.min(range.length,doc.text.length-range.offset),id='unit:'+hash([event.event_id,event.source_id,event.source_revision,range.offset,length,EXTRACTOR_VERSION,'v2-range']).slice(0,32);
        const status=p.status==='complete'?'adopted-v2-complete':'adopted-v2-inflight';
        db.prepare('INSERT OR REPLACE INTO v3_extract_units VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,event.event_id,event.source_id,event.source_revision,range.offset,length,EXTRACTOR_VERSION,p.job_id,status,json({sourceOffset:Math.max(0,range.offset-500),text:doc.text.slice(Math.max(0,range.offset-500),range.offset),contextOnly:true}));adopted++;
      }
    }
  }
  return adopted;
}

export function coverDirectEncoding(runtime,materials,jobId){
  const s=runtime.store;
  if(!runtime.inner)return;
  for(const m of materials){if(runtime.archive.db.prepare('SELECT status FROM documents WHERE source_id=? AND revision=?').get(m.sourceId,m.revision)?.status==='deleted')continue;const events=s.db.prepare('SELECT e.* FROM cognitive_events e JOIN event_sources es USING(character_id,event_id) WHERE es.source_id=? AND es.source_revision=?').all(m.sourceId,m.revision);
    for(const event of events){const doc=runtime.archive.get(m.sourceId,m.revision);for(const u of sourceUnits(event,doc))s.db.prepare('INSERT OR REPLACE INTO v3_extract_units VALUES(?,?,?,?,?,?,?,?,?,?)').run(u.unitId,u.eventId,u.sourceId,u.revision,u.offset,u.length,EXTRACTOR_VERSION,jobId,'complete',json(u.context));}
  }
}

// A source is covered only after every one of its historical split jobs has
// actually completed. This prevents both premature coverage and a second replay.
export function adoptHistoricalUnitCoverage(runtime,version){
  const db=runtime.store.db;let sources=0;
  for(const c of db.prepare("SELECT * FROM v3_history_coverage WHERE version=? AND status='complete'").all(version)){
    try{const ids=JSON.parse(c.job_ids);coverDirectEncoding(runtime,[{sourceId:c.source_id,revision:c.revision}],ids[0]||null);sources++;}catch(e){if(!['SOURCE_DELETED','SOURCE_NOT_FOUND'].includes(e.code))throw e;}
  }return {sources};
}
