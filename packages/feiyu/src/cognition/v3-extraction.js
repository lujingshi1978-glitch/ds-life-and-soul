import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';
import {hash,json,parse,clip,fail,sqlIds} from './contracts.js';
export const EXTRACTOR_VERSION='inner-v3-evidence-1';
// UTF-16 spans preserve exact archive offsets; all chunks end on a safe boundary.
export function sourceUnits(event,source,{maxChars=2800,contextChars=500}={}){
  const out=[],text=source.text;let start=0;
  do{
    let end=Math.min(text.length,start+maxChars);
    if(end<text.length){const split=Math.max(text.lastIndexOf('\n',end),text.lastIndexOf('。',end));if(split>start+Math.floor(maxChars*.6))end=split+1;if(end>start&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;}
    const unitId='unit:'+hash([event.event_id||event.eventId,source.sourceId,source.revision,start,end,EXTRACTOR_VERSION]).slice(0,32);
    out.push({unitId,eventId:event.event_id||event.eventId,sourceId:source.sourceId,revision:source.revision,offset:start,length:end-start,eventRoot:event.event_root||event.eventRoot,outcome:event.outcome,contextOnly:false,
      context:{text:text.slice(Math.max(0,start-contextChars),start),sourceOffset:Math.max(0,start-contextChars),contextOnly:true},
      conversationId:source.metadata.conversationId||source.metadata.scope||source.metadata.conversationPeerId||source.sourceId});
    if(end===text.length)break;start=end;
  }while(start<text.length);return out;
}
export function scheduleV3Encoding(runtime,{before,eventIds,historical=false,limit=120}={}){
  const s=runtime.store,version=EXTRACTOR_VERSION;
  const events=s.db.prepare(`SELECT e.*,es.source_id,es.source_revision FROM cognitive_events e JOIN event_sources es USING(character_id,event_id)
    WHERE e.character_id=? AND (? IS NULL OR e.recorded_at<=?) AND (? IS NULL OR e.event_id IN (SELECT value FROM json_each(?))) AND NOT EXISTS(SELECT 1 FROM v3_extract_units u WHERE u.event_id=e.event_id AND u.source_id=es.source_id AND u.source_revision=es.source_revision AND u.extractor_version=?)
    ORDER BY e.recorded_at,e.rowid LIMIT ?`).all(runtime.characterId,before??null,before??null,eventIds?sqlIds(eventIds):null,eventIds?sqlIds(eventIds):null,version,limit);
  if(!events.length)return {jobs:[]};
  const plans=events.map(e=>{try{return {e,source:runtime.archive.get(e.source_id,e.source_revision)};}catch(error){if(error.code!=='SOURCE_UNAVAILABLE')throw error;return {e,source:null};}});
  return s.atomic('v3-extraction-scheduled',()=>{
    const jobs=[],buckets=new Map();
    for(const {e,source}of plans){
      if(!source){s.db.prepare('INSERT OR IGNORE INTO v3_extract_units VALUES(?,?,?,?,?,?,?,?,?,?)').run('unit:'+hash([e.event_id,e.source_id,e.source_revision,version,'source-unavailable']).slice(0,32),e.event_id,e.source_id,e.source_revision,0,0,version,null,'source-unavailable','{}');continue;}
      const units=sourceUnits(e,source);const skip=s.suppressed(source.sourceId)||source.metadata.notPrimaryEvidence===true||isOperationalMaterial(source);
      for(const u of units){
        if(s.db.prepare('SELECT 1 FROM v3_extract_units WHERE unit_id=?').get(u.unitId))continue;
        s.db.prepare('INSERT INTO v3_extract_units VALUES(?,?,?,?,?,?,?,?,?,?)').run(u.unitId,u.eventId,u.sourceId,u.revision,u.offset,u.length,version,null,skip?'no-primary-evidence':'pending',json(u.context));
        if(!skip){const key=u.conversationId;const bucket=buckets.get(key)||[];bucket.push(u);buckets.set(key,bucket);}
      }
    }
    for(const batch of buckets.values()){
      let pending=[],size=0;const flush=()=>{if(!pending.length)return;const jobId=s.enqueue('encode',{parts:pending,historical,extractorVersion:version},{fingerprint:hash([version,pending.map(p=>p.unitId)])});jobs.push(jobId);for(const p of pending)s.db.prepare('UPDATE v3_extract_units SET job_id=? WHERE unit_id=?').run(jobId,p.unitId);pending=[];size=0;};
      for(const unit of batch){if(pending.length&&(pending.length>=6||size+unit.length>6500))flush();pending.push(unit);size+=unit.length;}flush();
    }return {jobs};
  });
}
export function validateV3Ownership(encoded,materials){
  for(const m of encoded.memories){
    if(m.evidence.some(e=>materials.find(p=>p.sourceId===e.sourceId&&p.revision===e.revision)?.metadata.notPrimaryEvidence))fail('SUMMARY_IS_NOT_PRIMARY_EVIDENCE');
    if(m.assertion){const a=m.assertion;for(const e of m.evidence){const p=materials.find(p=>p.sourceId===e.sourceId&&p.revision===e.revision&&e.span.offset>=(p.sourceOffset||0)&&e.span.offset<(p.sourceOffset||0)+p.text.length);if(!p)fail('V3_EVIDENCE_UNIT_MISMATCH');const speaker=p.metadata.forwardedAuthorId||p.metadata.speakerId;if(speaker!==a.speakerId)fail('V3_PER_QUOTE_SPEAKER_MISMATCH');}
      if(a.subjectId&&a.subjectId!==a.speakerId&&!m.metadata.semanticVerified){m.status='candidate';m.confidence=Math.min(.4,m.confidence);}
    }
    const refs=materials.filter(p=>m.evidence.some(e=>e.sourceId===p.sourceId&&e.revision===p.revision));m.metadata={...m.metadata,extractorVersion:EXTRACTOR_VERSION,sourceEventIds:[...new Set(refs.map(p=>p.eventId).filter(Boolean))],facet:clip(m.metadata.claimFacet||m.assertion?.predicate||m.metadata.topic||m.kind,100)};
  }return encoded;
}
export function commitUnitCoverage(s,job,status='complete'){
  if(job)s.db.prepare('UPDATE v3_extract_units SET status=? WHERE job_id=?').run(status,job.job_id);
  for(const p of job?.payload?.parts||[])if(p.unitId)s.db.prepare('UPDATE v3_extract_units SET status=? WHERE unit_id=? AND job_id=?').run(status,p.unitId,job.job_id);
}
export function snapshotMemory(s,id){
  const m=s.get(id,{includeInactive:true});if(!m)return;
  s.db.prepare('INSERT OR IGNORE INTO v3_memory_snapshots VALUES(?,?,?,?)').run(id,m.revision,json(m),s.now());
  const events=m.metadata.sourceEventIds||[];
  for(const e of m.evidence)for(const eventId of events){if(s.db.prepare('SELECT 1 FROM event_sources WHERE event_id=? AND source_id=? AND source_revision=?').get(eventId,e.sourceId,e.revision))s.db.prepare('INSERT OR IGNORE INTO v3_memory_events VALUES(?,?,?,?,?,?)').run(id,m.revision,eventId,e.sourceId,e.revision,json(e.span||{}));}
  s.db.prepare('INSERT OR REPLACE INTO v3_memory_views VALUES(?,?,?,?)').run(id,m.revision,'event',clip([m.gist,m.metadata.facet,...(m.metadata.tags||[])].join(' '),1500));
  if(m.kind==='experience')s.db.prepare('INSERT OR REPLACE INTO v3_memory_views VALUES(?,?,?,?)').run(id,m.revision,'meaning',clip([m.gist,m.metadata.reaction||'',...(m.metadata.tags||[])].join(' '),1500));
}
