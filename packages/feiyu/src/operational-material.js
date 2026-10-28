// Raw diagnostic conversations remain searchable resources. They are not lived
// experiences to learn into persona, relationship attitudes or automatic recall.
const MARKER=/(?:心理连贯|原生验收|记忆态度验收|架构实跑|对话理解验收)-[a-f0-9]{8}(?![a-f0-9])/i;
export function isOperationalMaterial(value, metadata={}) {
  const row=typeof value==='object'&&value!==null?value:{};
  const meta={...(row.metadata||{}),...metadata};
  return meta.learningExcluded===true||meta.diagnostic===true||row.learningExcluded===true||row.diagnostic===true||MARKER.test(String(typeof value==='string'?value:row.text??row.plain??row.body??''));
}
export function memoryLearningEligible(archive,memory) {
  if(!memory||isOperationalMaterial(memory.gist,memory.metadata))return false;
  if(!archive||!memory.evidence?.length)return true;
  let found=0,operational=0;
  for(const e of memory.evidence) {
    try {const source=archive.get(e.sourceId??e.source_id,e.revision??e.sourceRevision);found++;if(isOperationalMaterial(source))operational++;}
    catch(error){if(error.code!=='SOURCE_UNAVAILABLE')throw error;}
  }
  if(!operational)return true;
  // A mixed summary cannot launder test material through one real citation.
  // A console-reviewed replacement has its own independent correction source.
  const corrected=memory.metadata?.originCorrection?.sourceId;
  if(corrected)try{const ref=memory.evidence.find(e=>e.sourceId===corrected),source=ref&&archive.get(ref.sourceId,ref.revision);if(source?.kind==='provenance-correction'&&source.metadata.adminVerified===true&&!isOperationalMaterial(source))return true;}catch{}
  return false;
}
