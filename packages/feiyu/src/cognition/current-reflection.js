// Current feelings must not wait behind a morning's archive replay. This is a
// scheduling preference, never an activity or emotional choice for the model.
export const CURRENT_REFLECTION_MS=2*3600000;
export function reflectionIsHistorical(runtime,ids){
 const latest=runtime.store.db.prepare('SELECT max(occurred_at) at FROM cognitive_events WHERE event_id IN (SELECT value FROM json_each(?))').get(JSON.stringify(ids)).at||0;
 return latest<(runtime.inner.meta('currentAffectEvidenceAt')||runtime.inner.meta('lastCurrentReflectionAt')||0);
}
export function hasCurrentReflection(runtime){
 return currentReflectionJobs(runtime).length>0;
}

// Classification changes scheduling only. Historical/consumed jobs remain in
// the normal queue; a time watermark is never evidence that all facts were read.
export function classifyReflectionJob(runtime,job){
 const current=reason=>({state:'current',reason});let payload,ids;
 try{
  payload=job.payload||JSON.parse(job.payload_json||'{}');const supplied=payload.eventIds??[];
  if(payload.behavior?.startedAt!=null&&(!Number.isSafeInteger(payload.behavior.startedAt)||payload.behavior.startedAt>runtime.now()))return current('unknown-behavior-time');
  if(!Array.isArray(supplied)||supplied.length>64||supplied.some(id=>typeof id!=='string'||!id))return current('unknown-event-set');
  for(const id of supplied)if(!runtime.store.db.prepare('SELECT 1 FROM cognitive_events WHERE character_id=? AND event_id=?').get(runtime.characterId,id))return current('missing-event');
  ids=payload.behavior?.startedAt?roundReflectionEvents(runtime.owner||{runtime},payload.behavior,supplied):orderedRoundEvents(runtime,supplied);
  if(!ids.length)return current('empty-event-set');
  for(const id of new Set([...supplied,...ids])){
   const event=runtime.store.db.prepare('SELECT occurred_at FROM cognitive_events WHERE character_id=? AND event_id=?').get(runtime.characterId,id);
   if(!event||!Number.isSafeInteger(event.occurred_at)||event.occurred_at<0||event.occurred_at>runtime.now())return current('unknown-event-time');
   const refs=runtime.store.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE event_id=?').all(id);
   if(!refs.length)return current('unknown-event-source');
   for(const ref of refs){const source={sourceId:ref.source_id,revision:ref.source_revision},doc=runtime.archive.get(source.sourceId,source.revision);if(doc.status!=='available'||runtime.store.suppressed(source.sourceId)||runtime.store.sourceUsable&&!runtime.store.sourceUsable(source,{historical:true}))return current('unavailable-event-source');if(!Number.isSafeInteger(doc.occurred_at)||doc.occurred_at<0||doc.occurred_at>runtime.now())return current('unknown-source-time');}
  }
  if(ids.every(id=>runtime.store.db.prepare('SELECT 1 FROM v3_inner_intake WHERE event_id=?').get(id)))return {state:'processed',reason:'exact-events-already-integrated'};
  if(reflectionIsHistorical(runtime,ids))return {state:'historical',reason:'resolved-evidence-is-retrospective'};
  return current('unintegrated-current-evidence');
 }catch{return current('unresolved-evidence');}
}

export function currentReflectionJobs(runtime,{includeDeferred=false}={}){
 const now=runtime.now(),rows=runtime.store.db.prepare("SELECT job_id,kind,retry_at,payload_json FROM jobs WHERE character_id=? AND role_epoch=? AND kind='reflect' AND status='pending' AND (?=1 OR coalesce(retry_at,0)<=?) AND json_extract(payload_json,'$.behavior.startedAt')>=? ORDER BY CASE WHEN coalesce(retry_at,0)<=? THEN 0 ELSE 1 END,coalesce(json_extract(payload_json,'$.behavior.startedAt'),0) DESC,rowid DESC LIMIT 65").all(runtime.characterId,runtime.store.manifest().role_epoch,includeDeferred?1:0,now,now-CURRENT_REFLECTION_MS,now);
 return rows.flatMap((row,index)=>{const classification=index>=64?{state:'current',reason:'classification-budget-exceeded'}:classifyReflectionJob(runtime,row);return classification.state==='current'?[{...row,classification}]:[];});
}
export function orderedRoundEvents(runtime,ids){
 const unique=[...new Set(ids)];if(!unique.length)return [];
 return runtime.store.db.prepare('SELECT event_id FROM cognitive_events WHERE character_id=? AND event_id IN (SELECT value FROM json_each(?)) ORDER BY rowid DESC LIMIT 12').all(runtime.characterId,JSON.stringify(unique)).reverse().map(r=>r.event_id);
}
// Configuration is context, not an occurrence caused by the current I/O round.
// A first self-read can otherwise pick up an old, never-intaken migration and
// make the whole decision retrospective. Keep that source in its original
// archive/background path; do not mark it integrated or strip ordinary history.
export function currentRoundTriggerIds(runtime,behavior,ids){
 if(!['chat','web','bili','qzone'].includes(behavior?.kind))return ids;
 return ids.filter(id=>{
  const event=runtime.store.db.prepare('SELECT kind FROM cognitive_events WHERE character_id=? AND event_id=?').get(runtime.characterId,id);
  if(event?.kind==='configuration-imported')return false;
  const refs=runtime.store.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE character_id=? AND event_id=?').all(runtime.characterId,id);
  if(!refs.length)return true;
  const config=refs.map(ref=>{try{const d=runtime.archive.get(ref.source_id,ref.source_revision);return d.kind==='configuration'||['inner-config','disposition-migration'].includes(d.adapter);}catch{return false;}});
  return !config.every(Boolean);
 });
}
export function roundReflectionEvents(owner,behavior,ids){
 // Repair already queued rounds as well as new ones. Old payloads accidentally
 // retained twelve inputs and truncated every subsequently sent reply.
 const end=behavior.endedAt||Math.min(owner.runtime.now(),behavior.startedAt+20*60000);
 const following=owner.runtime.store.db.prepare("SELECT min(json_extract(payload_json,'$.behavior.startedAt')) at FROM jobs WHERE kind='reflect' AND coalesce(json_extract(payload_json,'$.behavior.eventScope'),json_extract(payload_json,'$.behavior.scope'))=? AND json_extract(payload_json,'$.behavior.startedAt')>?").get(behavior.eventScope||behavior.scope,behavior.startedAt)?.at;
 const rows=owner.runtime.store.db.prepare('SELECT e.event_id,s.source_id,s.source_revision,e.occurred_at FROM cognitive_events e JOIN event_sources s USING(character_id,event_id) WHERE e.rowid>? AND e.occurred_at>=? AND e.occurred_at<=? ORDER BY e.rowid DESC LIMIT 200').all(behavior.eventWatermark||0,behavior.startedAt,Math.min(end,following?following-1:end));
 const extra=rows.filter(r=>{try{const d=owner.runtime.archive.get(r.source_id,r.source_revision);return d.metadata.scope===(behavior.eventScope||behavior.scope);}catch{return false;}}).map(r=>r.event_id);
 return orderedRoundEvents(owner.runtime,currentRoundTriggerIds(owner.runtime,behavior,[...ids,...extra]));
}
