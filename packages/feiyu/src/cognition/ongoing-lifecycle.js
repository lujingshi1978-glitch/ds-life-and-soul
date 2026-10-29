import {hash,parse} from './contracts.js';

// A derived attention index, never a deletion or rewrite of source memories,
// feelings, action proposals, receipts or their immutable versions.
export function ensureOngoingSchema(inner){inner.db.exec(`CREATE TABLE IF NOT EXISTS v3_ongoing_lifecycle(object_id TEXT PRIMARY KEY,scope TEXT NOT NULL,canonical_id TEXT,reason TEXT NOT NULL,identity_key TEXT,updated_at INTEGER NOT NULL)`);}
const text=value=>String(value??'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const sorted=value=>[...new Set((Array.isArray(value)?value:[]).filter(x=>typeof x==='string'))].sort();
const semantic=body=>({title:text(body.title),meaning:text(body.meaning),personId:body.personId||null,people:sorted(body.people),objectIds:sorted(body.objectIds),motiveKind:body.motiveKind||null,concernKind:body.concernKind||null,cueKind:body.cueKind||null,decision:body.decision||null,importance:body.importance??null,intensity:body.intensity??null,feeling:body.feeling??null,knownFacts:body.knownFacts||[],uncertainties:body.uncertainties||[],expectation:body.expectation||null,reconsiderAfter:body.reconsiderAfter??null,expectedOutcome:body.expectedOutcome||null,nextStep:body.nextStep||null,chapterId:body.chapterId||null,wishId:body.wishId||null});
const historicalSemantic=body=>{const s=semantic(body);delete s.decision;return hash(s);};
function subjects(inner,id,body,refs){
 const people=sorted([...(body.people||[]),...(body.personId?[body.personId]:[])]),scopes=new Set();let unknown=false;
 const read=(sourceId,revision)=>{try{const d=inner.runtime.archive.get(sourceId,revision),m=d.metadata||{};if(m.scope)scopes.add(m.scope);if(m.conversationPeerId)scopes.add('peer:'+m.conversationPeerId);}catch{unknown=true;}};
 const evidence=refs||inner.db.prepare('SELECT source_id,source_revision,event_id,memory_id,memory_revision FROM v3_inner_evidence WHERE object_id=? AND object_revision=(SELECT current_revision FROM v3_inner_objects WHERE object_id=?)').all(id,id);
 for(const r of evidence){if(r.sourceId||r.source_id)read(r.sourceId||r.source_id,r.sourceRevision||r.source_revision);const e=r.eventId||r.event_id;if(e)for(const s of inner.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE event_id=?').all(e))read(s.source_id,s.source_revision);const m=r.memoryId||r.memory_id;if(m)for(const s of inner.db.prepare('SELECT source_id,source_revision FROM memory_evidence WHERE memory_id=? AND memory_revision=?').all(m,r.memoryRevision||r.memory_revision))read(s.source_id,s.source_revision);}
 // With no subject/scope evidence there is no safe automatic equivalence.
 return !unknown&&(people.length||scopes.size)?{people,scopes:[...scopes].sort()}:null;
}
export function ongoingIdentity(inner,kind,body,{id,refs,status='active'}={}){
 if(body.locked||!['wish','chapter','concern','motive','relationship_cue'].includes(kind))return null;
 const subject=subjects(inner,id,body,refs);if(!subject)return null;
 const evidence=body.concernKind==='promise'?(refs||inner.db.prepare('SELECT source_id,source_revision,event_id,memory_id,memory_revision FROM v3_inner_evidence WHERE object_id=? AND object_revision=(SELECT current_revision FROM v3_inner_objects WHERE object_id=?)').all(id,id)).map(r=>r.eventId||r.event_id||((r.memoryId||r.memory_id)?'memory:'+(r.memoryId||r.memory_id)+'@'+(r.memoryRevision||r.memory_revision):'source:'+(r.sourceId||r.source_id)+'@'+(r.sourceRevision||r.source_revision))).sort():null;
 return hash({kind,status,body:semantic(body),subject,commitmentEvidence:evidence});
}
export function markActionMotive(inner,id){inner.db.prepare("INSERT INTO v3_ongoing_lifecycle VALUES(?,'action-history',NULL,'decision-is-action-history',NULL,?) ON CONFLICT(object_id) DO UPDATE SET scope='action-history',canonical_id=NULL,reason=excluded.reason,identity_key=NULL,updated_at=excluded.updated_at").run(id,inner.now());}

export function refreshOngoingLifecycle(inner){
 const db=inner.db,rows=db.prepare("SELECT o.*,v.body_json FROM v3_inner_objects o JOIN v3_inner_versions v ON v.object_id=o.object_id AND v.revision=o.current_revision WHERE o.kind IN ('wish','chapter','concern','motive','relationship_cue') AND o.status IN ('active','quiet','paused','contested') ORDER BY o.created_at,o.object_id").all(),existing=new Map(db.prepare('SELECT * FROM v3_ongoing_lifecycle').all().map(r=>[r.object_id,r])),plan=new Map(existing);
 const generated=new Map();for(const r of db.prepare('SELECT p.motive_id,v.body_json FROM v3_action_proposals p JOIN v3_inner_versions v ON v.object_id=p.motive_id AND v.revision=p.motive_revision').all()){if(!generated.has(r.motive_id))generated.set(r.motive_id,new Set());generated.get(r.motive_id).add(historicalSemantic(parse(r.body_json)));}
 for(const r of rows){const body=parse(r.body_json);if(r.kind==='motive'&&(body.lifetime==='action'||generated.get(r.object_id)?.has(historicalSemantic(body))))plan.set(r.object_id,{object_id:r.object_id,scope:'action-history',canonical_id:null,reason:'decision-is-action-history',identity_key:null});}
 const groups=new Map();for(const r of rows){if(plan.has(r.object_id))continue;const key=ongoingIdentity(inner,r.kind,parse(r.body_json),{id:r.object_id,status:r.status});if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 for(const [key,group]of groups)if(group.length>1){const canonical=group[0].object_id;for(const r of group.slice(1))plan.set(r.object_id,{object_id:r.object_id,scope:'alias',canonical_id:canonical,reason:'same-subject-and-exact-content',identity_key:key});}
 const changed=[...plan.values()].filter(r=>{const old=existing.get(r.object_id);return !old||['scope','canonical_id','reason','identity_key'].some(k=>(old[k]??null)!==(r[k]??null));});
 if(changed.length){const own=!db.isTransaction;if(own)db.exec('BEGIN IMMEDIATE');try{const put=db.prepare('INSERT INTO v3_ongoing_lifecycle VALUES(?,?,?,?,?,?) ON CONFLICT(object_id) DO UPDATE SET scope=excluded.scope,canonical_id=excluded.canonical_id,reason=excluded.reason,identity_key=excluded.identity_key,updated_at=excluded.updated_at');for(const r of changed)put.run(r.object_id,r.scope,r.canonical_id,r.reason,r.identity_key,inner.now());if(own)db.exec('COMMIT');}catch(e){if(own)db.exec('ROLLBACK');throw e;}}
 return ongoingLifecycleStatus(inner);
}
export function ongoingLifecycleStatus(inner){const rows=inner.db.prepare('SELECT scope,count(*) count FROM v3_ongoing_lifecycle GROUP BY scope').all();return {policy:'ongoing-lifecycle-v1',actionHistory:rows.find(r=>r.scope==='action-history')?.count||0,aliases:rows.find(r=>r.scope==='alias')?.count||0,sourceHistoryPreserved:true};}
export function ongoingContinuation(inner,kind,body,refs){
 const key=ongoingIdentity(inner,kind,body,{refs,status:body.status||'active'});if(!key)return null;
 return inner.objects({kind,limit:2000}).find(o=>ongoingIdentity(inner,kind,o.body,{id:o.object_id,status:o.status})===key)||null;
}
