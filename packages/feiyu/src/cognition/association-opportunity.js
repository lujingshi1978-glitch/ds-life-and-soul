import {createHash} from 'node:crypto';
import {conversationAssociations,associationSources} from './stimulus-recall.js';
import {memoryLearningEligible} from '../operational-material.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// A validated stimulus makes an opportunity different. It is never authority to
// contact someone and never promotes a recalled source into a new experience.
// Call on the host path before agencyWakePlan; it performs no model or writes.
export function withAssociationOpportunity(runtime,opportunities){
 if(!opportunities||opportunities.degraded||runtime.store?.characterId!==runtime.characterId||runtime.archive?.characterId!==runtime.characterId)return opportunities;
 const state=runtime.inner?.meta('stimulusRecallV1');
 if(!state||state.status!=='recalled'||!Array.isArray(state.triggerEventIds))return opportunities;
 const epoch=runtime.store.manifest().role_epoch,events=[];
 for(const id of [...new Set(state.triggerEventIds)].slice(0,12)){
  const event=runtime.store.db.prepare('SELECT role_epoch,kind FROM cognitive_events WHERE character_id=? AND event_id=?').get(runtime.characterId,id);
  if(!event||event.role_epoch!==epoch||['archive-imported','idle-reconsidered','time-review','psyche-review'].includes(event.kind))continue;
  const refs=runtime.store.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE character_id=? AND event_id=?').all(runtime.characterId,id);
  const valid=refs.some(ref=>{
   const basis={sourceId:ref.source_id,revision:ref.source_revision};
   const qualified=associationSources(runtime,[basis],{current:true});if(!qualified.length)return false;
   const source=qualified.find(q=>q.ref.sourceId===basis.sourceId&&q.ref.revision===basis.revision)?.source,m=source?.metadata||{};
   if(m.speakerId?.startsWith('character:')&&m.speakerId!==runtime.characterId)return false;
   return source?.kind==='chat'?m.role==='user'&&/^private:\d+$/.test(m.scope||'')&&m.speakerId==='qq:'+m.scope.slice(8):m.explicitObservation===true||['web-reading','internet','post','homepage'].includes(source?.kind);
  });
  if(valid)events.push(id);
 }
 if(!events.length)return opportunities;
 const memoryRefs=[...new Set(state.memoryIds||[])].slice(0,20).flatMap(id=>{const m=runtime.store.get(id);return m&&memoryLearningEligible(runtime.archive,m)&&associationSources(runtime,m.evidence||[]).length?[{id,revision:m.revision}]:[];});
 const contacts=conversationAssociations(runtime,memoryRefs.map(r=>r.id));
 if(!memoryRefs.length)return opportunities;
 const association={kind:'current-stimulus-reference',eventIds:events.sort(),memoryRefs,contacts,referenceOnly:true,authorization:'not-granted-by-association'};
 const body={...opportunities,association};
 return {...body,hasConcrete:true,fingerprint:hash([opportunities.fingerprint,association])};
}
