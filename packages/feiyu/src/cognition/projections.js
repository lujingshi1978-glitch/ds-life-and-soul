import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';
// Materialized views are disposable and always carry their source dependencies.
export function refreshProjections(store,ids){
  const all=store.list({limit:50000}).filter(m=>memoryLearningEligible(store.inner?.runtime?.archive,m)),touched=ids.map(id=>store.get(id)).filter(Boolean),people=new Set(touched.flatMap(m=>m.participants.map(p=>p.entity_id)).filter(id=>!id.startsWith('character:')));
  for(const peer of people){const relevant=all.filter(m=>m.participants.some(p=>p.entity_id===peer)&&m.status==='active'&&!m.metadata.disposition).sort((a,b)=>(['relationship','pattern'].includes(b.kind)?1:0)-(['relationship','pattern'].includes(a.kind)?1:0)||b.recorded_at-a.recorded_at).slice(0,40);
    store.setProjection('portrait',peer,{subjectId:peer,claims:relevant.map(m=>({memoryId:m.id,kind:m.kind,aspect:m.metadata.topic,layer:m.metadata.consolidationLayer,subject:peer,gist:m.gist,epistemic:m.epistemic,speakerId:m.assertion?.speakerId,subjectId:m.assertion?.subjectId,occurredAt:m.occurred_at}))},{dependencies:relevant.map(m=>m.id)});
  }
  const recent=all.filter(m=>m.kind==='experience'&&m.status==='active').slice(0,20);store.setProjection('recent','self',{items:recent.map(m=>({id:m.id,gist:m.gist,at:m.occurred_at}))},{dependencies:recent.map(m=>m.id)});
  return {people:[...people],recent:recent.length};
}
