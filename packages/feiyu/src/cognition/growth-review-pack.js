import {fail} from './contracts.js';

// Packing is a model view only. Full memories and the pending remainder stay
// persisted. No sentence is cut to look like a complete piece of evidence.
export function packGrowthReview(material,{primaryIds,maxInputChars=48000,maxOutputChars=24000}={}){
 const primary=new Set(primaryIds||material.memories.map(m=>m.id)),memories=material.memories.filter(m=>primary.has(m.id)),observations=material.observations||[],b=material.before;
 const before={generation:b.generation,summary:b.summary,psycheRevision:b.psycheRevision,psychology:b.psychology,psyche:b.psyche,time:b.time,physical:{energy:b.physical?.energy,valence:b.physical?.valence,arousal:b.physical?.arousal,mood:b.physical?.mood,affectRevision:b.physical?.affectRevision},ongoing:(b.ongoing||[]).map(o=>({id:o.id,revision:o.revision,kind:o.kind,status:o.status,title:o.title,people:o.people,personId:o.personId})),ongoingReferencesOnly:true};
 const cap=Math.max(0,maxInputChars-Math.min(maxOutputChars,Math.floor(maxInputChars/2))-512),view={...material,before,memories:[],observations:[],counterevidence:[],selfUnderstanding:[]},size=()=>JSON.stringify(view).length;
 if(size()>cap)fail('GROWTH_FIXED_CONTEXT_EXCEEDS_BUDGET');
 const add=(key,item)=>{view[key].push(item);if(size()>cap){view[key].pop();return false;}return true;};
 for(const old of material.selfUnderstanding||[])if(JSON.stringify(view.selfUnderstanding).length<cap/5)add('selfUnderstanding',old);
 const remainingMemories=[],remainingObservations=[];let mi=0,ei=0;
 while(mi<memories.length||ei<observations.length){if(mi<memories.length){const m=memories[mi++];if(!add('memories',m))remainingMemories.push(m.id);}if(ei<observations.length){const e=observations[ei++];if(!add('observations',e))remainingObservations.push(e.id);}}
 if(!view.memories.length&&!view.observations.length)fail('GROWTH_EVIDENCE_ITEM_EXCEEDS_BUDGET');
 for(const m of material.counterevidence||[]){if(!add('memories',m))continue;if(!add('counterevidence',m))view.memories.pop();}
 view.reviewCoverage={inputMemories:memories.length,inputObservations:observations.length,shownMemories:view.memories.filter(m=>primary.has(m.id)).length,shownObservations:view.observations.length,remainingMemories:remainingMemories.length,remainingObservations:remainingObservations.length,omittedCounterevidence:(material.counterevidence||[]).length-view.counterevidence.length,omittedPreviousUnderstandings:(material.selfUnderstanding||[]).length-view.selfUnderstanding.length,notAnExhaustiveLifeReview:true,instruction:'仅依据本页完整材料形成可修订理解；未提供不等于不存在，剩余输入持久排队，不把局部样本宣称为稳定普遍性格。ongoing只给ID与标题，不据此改写未提供的正文。'};
 if(JSON.stringify(view).length>maxInputChars-Math.min(maxOutputChars,Math.floor(maxInputChars/2)))fail('GROWTH_PACK_BUDGET_EXCEEDED');
 return {material:view,remainingMemories,remainingObservations,shownMemoryIds:[...view.memories,...view.counterevidence,...view.selfUnderstanding].map(m=>m.id),shownEventIds:view.observations.map(e=>e.id),maxMaterialChars:cap};
}
