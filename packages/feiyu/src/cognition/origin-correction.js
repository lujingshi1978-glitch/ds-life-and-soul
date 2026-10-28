import {hash,json,fail} from './contracts.js';
import {memoryEvidenceOrigin} from './evidence-origin.js';
import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';

// Host-reviewed reinterpretation. Keep source documents and every old version.
export function correctMemoryOrigin(owner,input={}){
 if(input.kind==='psychology')return correctPsychologyOrigin(owner,input);
 if(input.kind!==undefined&&input.kind!=='memory')fail('INVALID_ORIGIN_CORRECTION');
 const {id,expectedRevision,correctedText,reason,requestId,restoreStatus}=input;
 const r=owner.runtime,s=r.store;
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9:_-]{8,120}$/.test(requestId)||typeof correctedText!=='string'||!correctedText.trim()||[...correctedText].length>800||typeof reason!=='string'||!reason.trim()||[...reason].length>600)fail('INVALID_ORIGIN_CORRECTION');
 if(restoreStatus!==undefined&&!['active','outdated'].includes(restoreStatus))fail('INVALID_ORIGIN_CORRECTION');
 const key='origin-correction:'+hash(requestId),fingerprint=hash([id,expectedRevision,correctedText,reason,...(restoreStatus?[restoreStatus]:[])]);
 const previous=owner.archive.meta(key);if(previous){if(previous.fingerprint!==fingerprint)fail('ORIGIN_CORRECTION_REQUEST_CONFLICT');return {...previous,idempotent:true};}
 const m=s.get(id,{includeInactive:true});if(!m||m.revision!==expectedRevision||m.status==='forgotten')fail('MEMORY_VERSION_CONFLICT');
 const origin=memoryEvidenceOrigin(m,{archive:r.archive,characterId:r.characterId});if(origin.selfActionConfirmed)fail('CONFIRMED_ACTION_REQUIRES_SEPARATE_REVIEW');
 const source=owner.archive.put('origin-correction:'+requestId,m.metadata.scope||'self','provenance-correction',json({memoryId:id,previousRevision:m.revision,correctedText,reason}),{adminVerified:true,notPrimaryEvidence:true,speakerId:r.characterId},r.now(),{historical:true,eventRoot:'origin-correction:'+requestId});
 const result=s.atomic('memory-origin-corrected',()=>{
  const revision=r.lifecycle.revise(id,expectedRevision,{gist:correctedText,detail:correctedText,...(restoreStatus?{status:restoreStatus}:{}),metadata:{...m.metadata,originCorrection:{sourceId:source.sourceId,sourceRevision:source.revision,previousRevision:m.revision,requestId,reason}}});
  for(const ref of m.evidence)if(isOperationalMaterial(r.archive.get(ref.sourceId,ref.revision)))s.db.prepare('DELETE FROM memory_evidence WHERE character_id=? AND memory_id=? AND memory_revision=? AND source_id=? AND source_revision=?').run(r.characterId,id,revision,ref.sourceId,ref.revision);
  for(const dep of s.db.prepare('SELECT parent_id FROM dependencies WHERE child_id=? AND child_revision=?').all(id,revision))if(!memoryLearningEligible(r.archive,s.get(dep.parent_id,{includeInactive:true})))s.db.prepare('DELETE FROM dependencies WHERE child_id=? AND child_revision=? AND parent_id=?').run(id,revision,dep.parent_id);
  s.db.prepare('INSERT OR IGNORE INTO memory_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(r.characterId,id,revision,source.sourceId,source.revision,hash([source.sourceId,source.revision,'origin-correction']),json({}),source.sourceId,'context');
  s.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').run(id,revision);s.v3AfterWrite?.(id);
  const receipt={id,previousRevision:m.revision,revision,sourceId:source.sourceId,sourceRevision:source.revision,status:restoreStatus||m.status,rawSourcesPreserved:true,oldVersionsPreserved:true,fingerprint};owner.archive.meta(key,receipt);return {...receipt,affected:[id]};
 });owner.changed?.();return result;
}

function correctPsychologyOrigin(owner,{id,expectedRevision,expectedMindGeneration,correctedText,reason,requestId,release=false}){
 const r=owner.runtime,s=r.store,i=r.inner,p=i.psyche;
 if(typeof requestId!=='string'||!/^[a-zA-Z0-9:_-]{8,120}$/.test(requestId)||typeof correctedText!=='string'||!correctedText.trim()||[...correctedText].length>600||typeof reason!=='string'||!reason.trim()||[...reason].length>600)fail('INVALID_ORIGIN_CORRECTION');
 if(typeof release!=='boolean')fail('INVALID_ORIGIN_CORRECTION');
 const key='origin-correction:'+hash(requestId),fingerprint=hash(['psychology',id,expectedRevision,expectedMindGeneration,correctedText,reason,...(release?[true]:[])]),previous=owner.archive.meta(key);if(previous){if(previous.fingerprint!==fingerprint)fail('ORIGIN_CORRECTION_REQUEST_CONFLICT');return {...previous,idempotent:true};}
 const old=p.list({includeInactive:true}).find(t=>t.id===id),head=i.head();if(!old||old.revision!==expectedRevision||!['active','quiet'].includes(old.status))fail('MEMORY_VERSION_CONFLICT');if(!Number.isSafeInteger(expectedMindGeneration)||head.generation!==expectedMindGeneration)fail('V3_HEAD_VERSION_CONFLICT');
 const source=owner.archive.put('origin-correction:'+requestId,'self','provenance-correction',json({psychologyId:id,previousRevision:old.revision,correctedText,reason}),{adminVerified:true,notPrimaryEvidence:true,speakerId:r.characterId},r.now(),{historical:true,eventRoot:'origin-correction:'+requestId});
 const result=i.transaction('review',key,head.generation,(commit,prior)=>{
  p.write(id,{...old,text:correctedText,sourceRefs:[...(old.sourceRefs||[]).filter(ref=>!isOperationalMaterial(r.archive.get(ref.sourceId,ref.revision))),{sourceId:source.sourceId,revision:source.revision}],memoryRefs:(old.memoryRefs||[]).filter(ref=>{const m=s.get(ref.id,{includeInactive:true});return m?.revision===ref.revision&&memoryLearningEligible(r.archive,m);}),originCorrection:{sourceId:source.sourceId,previousRevision:old.revision,requestId,reason},uncertainBasis:false,reviewDisposition:'corrected'},release?'released':old.status);
  p.writeProjection({text:'',sourceRefs:[{sourceId:source.sourceId,revision:source.revision}],memoryRefs:[],basisThreadRefs:p.list().map(t=>({id:t.id,revision:t.revision})),invalidation:{kind:'origin-corrected',threadId:id}},'needs-review');
  s.db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('psyche',?,'origin-corrected','complete')").run(id);
  const state=i.writeState(commit,prior,'',{refs:[{sourceId:source.sourceId,sourceRevision:source.revision}],conditions:{recompile:true}}),receipt={id,kind:'psychology',previousRevision:old.revision,revision:old.revision+1,sourceId:source.sourceId,sourceRevision:source.revision,status:release?'released':old.status,rawSourcesPreserved:true,oldVersionsPreserved:true,fingerprint,...state};owner.archive.meta(key,receipt);return receipt;
 });owner.changed?.();return result;
}
