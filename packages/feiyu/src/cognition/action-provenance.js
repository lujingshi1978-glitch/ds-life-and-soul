import {json,parse} from './contracts.js';

const CURRENT_ORIGINS=new Set(['foreground','public-reading','occasion','meta-wake','current-observation']);
const CURRENT_EVENTS=new Set(['experience-recorded','perception-observed','action-outcome','interest-cue','occasion-observed','idle-reconsidered','time-review']);
const REVIEW=/dream|histor|backfill|recover|review|compression|repair/i;

function eventSources(inner,eventIds){
  return eventIds.flatMap(eventId=>{
    const event=inner.db.prepare('SELECT * FROM cognitive_events WHERE event_id=? AND character_id=?').get(eventId,inner.runtime.characterId);
    if(!event)return [];
    return inner.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE event_id=?').all(eventId).flatMap(ref=>{
      try{const document=inner.runtime.archive.get(ref.source_id,ref.source_revision),sequence=inner.runtime.archive.db.prepare('SELECT rowid sequence FROM documents WHERE source_id=? AND revision=?').get(ref.source_id,ref.source_revision)?.sequence;return [{event,document,sequence}];}catch{return [];}
    });
  });
}
function retrospective(document){
  const m=document.metadata||{};
  return m.historical===true||m.historicalReview===true||m.recovery===true||m.recovered===true||m.legacy===true||m.reviewedEvents!==undefined||REVIEW.test(document.adapter)||(document.adapter!=='inner-time'&&REVIEW.test(document.kind));
}
function sourceRef(document){return {sourceId:document.sourceId,revision:document.revision,checksum:document.checksum};}

// Only the host's actual observation can make a new proposal current. Memory
// evidence and a model's own "fresh" field never create that qualification.
export function decisionProvenance(inner,{eventIds=[],memoryIds=[],kind='reflection',historical=false,decisionContext}={}){
  const rows=eventSources(inner,eventIds),now=inner.now(),epoch=inner.store.manifest().role_epoch;
  const recalledMemoryRefs=memoryIds.map(id=>inner.store.get(id)).filter(Boolean).map(m=>({id:m.id,revision:m.revision,sources:m.evidence.map(e=>({sourceId:e.sourceId,revision:e.revision}))}));
  const base={version:1,origin:'unknown',executable:false,reason:'no-current-observation',createdAt:now,roleEpoch:epoch,processEpoch:inner.clock.epoch,eventIds:[...new Set(eventIds)],sources:rows.map(r=>sourceRef(r.document)),recalledMemoryRefs,occasionIds:[],expiresAt:now+1800000};
  if(historical||REVIEW.test(kind))return {...base,origin:historical?'historical':kind,reason:'retrospective-only'};
  if(rows.some(r=>retrospective(r.document)))return {...base,origin:'historical',reason:'retrospective-source'};
  if(decisionContext!==undefined&&(!decisionContext||decisionContext.fresh!==true||!CURRENT_ORIGINS.has(decisionContext.origin)||!Array.isArray(decisionContext.eventIds)||!decisionContext.eventIds.length||decisionContext.eventIds.some(id=>!eventIds.includes(id))))return {...base,reason:'invalid-host-context'};
  const selected=decisionContext?rows.filter(r=>decisionContext.eventIds.includes(r.event.event_id)):rows;
  const fresh=selected.filter(({event,document:d,sequence})=>sequence>inner.actionSourceWatermark&&d.status==='available'&&['observed','completed'].includes(event.outcome)&&d.observed_at>=now-1800000&&d.observed_at<=now&&(d.occurred_at==null||d.occurred_at>=now-1800000&&d.occurred_at<=now)&&!inner.store.suppressed(d.sourceId)&&(CURRENT_EVENTS.has(event.kind)||d.kind==='chat')&&(!inner.store.sourceUsable||inner.store.sourceUsable({sourceId:d.sourceId,revision:d.revision})));
  if(!fresh.length)return {...base,origin:rows.length?'recovery':'unknown',reason:'no-current-observation'};
  if(decisionContext?.resourceRef&&!rows.some(r=>r.document.sourceId===decisionContext.resourceRef.sourceId&&r.document.revision===decisionContext.resourceRef.revision||(r.document.metadata.basisSources||[]).some(s=>s.sourceId===decisionContext.resourceRef.sourceId&&s.revision===decisionContext.resourceRef.revision)))return {...base,reason:'resource-outside-current-evidence'};
  const occasions=fresh.flatMap(r=>r.document.metadata.occasion?[r.document.metadata.occasion]:[]),expires=occasions.map(o=>o.expiresAt).filter(Number.isSafeInteger);
  if(expires.some(at=>at<=now))return {...base,origin:'occasion',reason:'occasion-expired'};
  return {...base,origin:decisionContext?.origin||(occasions.length?'occasion':fresh.some(r=>r.document.adapter==='inner-time')?'meta-wake':'current-observation'),executable:true,reason:'current-host-observation',freshEventIds:[...new Set(fresh.map(r=>r.event.event_id))],occasionIds:[...new Set(occasions.map(o=>o.id).filter(id=>typeof id==='string'&&id))],expiresAt:Math.min(base.expiresAt,...expires)};
}

export function saveActionProvenance(inner,action,provenance){
  inner.db.prepare('INSERT INTO v3_action_provenance VALUES(?,?,?,?,?,?,?)').run(inner.runtime.characterId,action.id,action.revision,provenance.origin,provenance.executable?1:0,provenance.reason,json(provenance));
}
export function actionProvenance(inner,id,revision){
  const row=inner.db.prepare('SELECT * FROM v3_action_provenance WHERE character_id=? AND action_id=? AND revision=?').get(inner.runtime.characterId,id,revision);
  if(!row)return null;const body=parse(row.body_json);return {...body,origin:row.origin,executable:row.executable===1,reason:row.reason};
}
export function actionIsCurrent(inner,action,{claimed=false}={}){
  if(!action||action.character_id!==inner.runtime.characterId)return false;
  const p=actionProvenance(inner,action.object_id,action.revision),object=inner.object(action.object_id),now=inner.now();
  if(!p?.executable||!CURRENT_ORIGINS.has(p.origin)||p.processEpoch!==inner.clock.epoch||p.roleEpoch!==inner.store.manifest().role_epoch||!object||object.current_revision!==action.revision||object.status!=='active'||object.invalidated_at||action.based_on_role_epoch!==p.roleEpoch||!claimed&&(p.expiresAt<=now||action.expires_at<=now||(action.not_before||0)>now))return false;
  if(!Array.isArray(p.sources)||!p.sources.length||!Array.isArray(p.freshEventIds)||!p.freshEventIds.length)return false;
  for(const ref of p.sources){try{const d=inner.runtime.archive.get(ref.sourceId,ref.revision),latest=inner.runtime.archive.db.prepare('SELECT max(revision) revision FROM documents WHERE source_id=?').get(ref.sourceId);if(d.status!=='available'||d.checksum!==ref.checksum||latest.revision!==ref.revision||inner.store.suppressed(ref.sourceId)||inner.store.sourceUsable&&!inner.store.sourceUsable(ref))return false;}catch{return false;}}
  return true;
}

export function installActionProvenance(inner){
  inner.actionSourceWatermark=inner.runtime.archive.db.prepare('SELECT coalesce(max(rowid),0) sequence FROM documents').get().sequence;
  inner.db.exec(`CREATE TABLE IF NOT EXISTS v3_action_provenance(character_id TEXT NOT NULL,action_id TEXT NOT NULL,revision INTEGER NOT NULL,origin TEXT NOT NULL,executable INTEGER NOT NULL CHECK(executable IN (0,1)),reason TEXT NOT NULL,body_json TEXT NOT NULL CHECK(json_valid(body_json)),PRIMARY KEY(character_id,action_id,revision),FOREIGN KEY(character_id,action_id,revision) REFERENCES v3_action_proposals(character_id,object_id,revision));`);
  const migrate=()=>{
    for(const row of inner.db.prepare('SELECT a.*,v.commit_id,c.operation FROM v3_action_proposals a JOIN v3_inner_versions v ON v.object_id=a.object_id AND v.revision=a.revision JOIN v3_inner_commits c ON c.commit_id=v.commit_id LEFT JOIN v3_action_provenance p ON p.action_id=a.object_id AND p.revision=a.revision WHERE p.action_id IS NULL').all()){
      const state=inner.db.prepare('SELECT observed_condition_json FROM v3_inner_states WHERE object_id IN (SELECT object_id FROM v3_inner_versions WHERE commit_id=?) ORDER BY rowid DESC LIMIT 1').get(row.commit_id),conditions=parse(state?.observed_condition_json||'{}');
      const refs=inner.db.prepare('SELECT source_id,source_revision,memory_id,memory_revision,event_id FROM v3_inner_evidence WHERE object_id=? AND object_revision=?').all(row.object_id,row.revision),eventIds=[...new Set(refs.map(r=>r.event_id).filter(Boolean))],rows=eventSources(inner,eventIds),sources=new Map(rows.map(r=>[r.document.sourceId+'@'+r.document.revision,sourceRef(r.document)]));
      const addSource=(id,revision)=>{try{const d=inner.runtime.archive.get(id,revision);sources.set(id+'@'+revision,sourceRef(d));}catch{sources.set(id+'@'+revision,{sourceId:id,revision,unavailable:true});}};
      for(const ref of refs){if(ref.source_id)addSource(ref.source_id,ref.source_revision);if(ref.memory_id)for(const e of inner.db.prepare('SELECT source_id,source_revision FROM memory_evidence WHERE memory_id=? AND memory_revision=?').all(ref.memory_id,ref.memory_revision))addSource(e.source_id,e.source_revision);}
      const origin=row.operation==='dream'?'dream':conditions.historical||rows.some(r=>retrospective(r.document))?'historical':'legacy-unknown',body={version:1,origin,executable:false,reason:'legacy-needs-current-reselection',createdAt:inner.now(),roleEpoch:row.based_on_role_epoch,processEpoch:null,eventIds,sources:[...sources.values()],evidenceRefs:refs,occasionIds:[],expiresAt:row.expires_at,migrated:true};
      saveActionProvenance(inner,{id:row.object_id,revision:row.revision},body);
    }
    for(const row of inner.db.prepare('SELECT * FROM v3_action_provenance WHERE executable=1').all()){
      const body=parse(row.body_json);if(body.processEpoch===inner.clock.epoch)continue;
      inner.db.prepare('UPDATE v3_action_provenance SET executable=0,reason=?,body_json=? WHERE action_id=? AND revision=?').run('recovery-needs-current-reselection',json({...body,executable:false,reason:'recovery-needs-current-reselection',recoveredAt:inner.now()}),row.action_id,row.revision);
    }
    const revoke=inner.db.prepare("SELECT a.* FROM v3_action_proposals a WHERE a.status IN ('proposed','selected','held')").all().filter(p=>!actionIsCurrent(inner,p));
    for(const row of revoke){if(row.status==='selected')inner.cancelExecutions([row.object_id],'proposal-origin-not-current');else inner.db.prepare("UPDATE v3_action_proposals SET status='held' WHERE object_id=? AND revision=? AND status='proposed'").run(row.object_id,row.revision);}
    inner.meta('actionProvenanceVersion',1);return {affected:[]};
  };
  return inner.db.isTransaction?migrate():inner.store.atomic('action-provenance-migrated',migrate);
}
