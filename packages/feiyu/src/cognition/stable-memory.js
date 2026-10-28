import {hash,json} from './contracts.js';
// A quote is evidence; one quote can support different propositions.
function signatures(r){
 const evidence=(r.evidence||[]).filter(e=>e.role!=='context');if(!evidence.length||evidence.some(e=>!e.span?.length))return [];
 const refs=evidence.map(e=>[e.sourceId,e.revision,e.span.offset,e.span.length,e.role||'supports']).sort((a,b)=>json(a).localeCompare(json(b)));
 const semantic=r.assertion||r.metadata?.knowledgeEntry?.concept||(['knowledge','procedure'].includes(r.kind)?r.gist:null),scope=r.kind==='pattern'?[r.eventRoot||r.event_root,r.metadata?.consolidationLevel]:null;
 const facet=r.metadata?.claimFacet||(['knowledge','procedure','assertion','pattern'].includes(r.kind)?null:r.gist);
 return [hash(['claim-v2',r.kind,semantic,scope,facet,refs]),hash(['literal-claim-v2',r.kind,semantic,scope,r.gist,refs])];
}
export function installStableMemory(runtime){
 const s=runtime.store,db=s.db;db.exec('CREATE TABLE IF NOT EXISTS v3_claim_identity(signature TEXT PRIMARY KEY,memory_id TEXT NOT NULL)');
 s.registerClaim=m=>{if(m&&m.status!=='forgotten')for(const key of signatures(m))db.prepare('INSERT OR IGNORE INTO v3_claim_identity VALUES(?,?)').run(key,m.id);};
 if(runtime.inner.meta('stableIdentityBackfill')!==2){for(const m of s.list({includeInactive:true,limit:50000}))s.registerClaim(m);runtime.inner.meta('stableIdentityBackfill',2);}
 s.resolveClaim=record=>{
  if(record.id)return record;const keys=signatures(record);if(!keys.length)return record;
  const existing=keys.map(key=>db.prepare('SELECT memory_id FROM v3_claim_identity WHERE signature=?').get(key)).find(Boolean);
  const id=existing?.memory_id||'memory:'+keys[0].slice(0,32),old=s.get(id,{includeInactive:true});
  for(const key of keys)db.prepare('INSERT OR IGNORE INTO v3_claim_identity VALUES(?,?)').run(key,id);
  if(old&&old.status!=='forgotten'&&!record.metadata?.basisUnavailable&&(old.gist!==record.gist||old.detail!==(record.detail||''))){
   const status=['candidate','contested'].includes(old.status)&&!record.metadata?.semanticVerified?old.status:old.status==='active'&&record.status==='candidate'?old.status:record.status||old.status;
   runtime.lifecycle.revise(id,old.revision,{gist:record.gist,detail:record.detail||'',detailState:record.detail?'available':'none',metadata:{...old.metadata,...record.metadata},status});
  }return {...record,id};
 };
}
export function queueAmbiguousOldMerges(runtime){
 const s=runtime.store;let count=0;for(const m of s.list({kinds:['episode','relationship','experience'],limit:50000})){
  if(m.revision<2||!m.metadata.extractorVersion||m.metadata.claimFacet||m.metadata.identityReviewComplete)continue;
  const versions=s.db.prepare("SELECT DISTINCT gist FROM memory_versions WHERE memory_id=? AND gist<>''").all(m.id);if(versions.length<2)continue;
  s.db.prepare("INSERT OR IGNORE INTO v3_repair_queue VALUES('memory',?,'ambiguous-identity','pending')").run(m.id);count++;
 }return {queued:count};
}
