import {basisSources} from './basis-sources.js';
import {queryRelevance} from './recall-relevance.js';
import {terms,clip} from './contracts.js';
import {tuningFor} from '../runtime-tuning.js';

// Read a bounded retained detail only when the current cue needs it. A larger
// budget cannot turn another person's private source into disclosable text.
export function contextDetail(runtime,m,{scope,query}={}){
 if(runtime.store.characterId!==runtime.characterId||runtime.archive.characterId!==runtime.characterId)return {};
 const live=runtime.store.get(m.id);if(!live||live.revision!==m.revision||runtime.store.nodeSuppressed(m.id))return {};m=live;
 if(!m.detail||m.detail_state!=='available'||!query)return {};
 const match=queryRelevance(m,query),gistTerms=new Set(terms(m.gist));if(!match.matchedTerms.some(t=>!gistTerms.has(t)))return {};
 let refs;try{refs=basisSources(runtime,(m.evidence||[]).map(e=>({sourceId:e.sourceId,revision:e.revision})));if(!refs.length)return {};for(const ref of refs){const source=runtime.archive.get(ref.sourceId,ref.revision),meta=source.metadata||{};if(runtime.store.suppressed(ref.sourceId)||!runtime.store.sourceUsable(ref,{historical:true})||runtime.archive.learningExcluded(ref.sourceId,ref.revision))return {};if(meta.privacyLabel!=='public'&&meta.scope!==scope&&!(meta.scope==='self'&&(meta.speakerId===runtime.characterId||source.adapter==='tool-perception'&&meta.explicitObservation===true)))return {};}}catch{return {}}
 const detail=clip(m.detail,tuningFor(runtime).memory.detailChars);return {detail,detailPartial:detail!==m.detail,detailOrigin:'retained-memory-detail-not-new-experience'};
}
