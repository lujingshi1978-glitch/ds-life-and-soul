import {fail,hash,json} from './contracts.js';
import {dependentSources} from './basis-sources.js';
import {invalidateSourceClosure} from './consistency.js';

// Explicit console repair of known diagnostic receipts. Original bytes and
// versions remain available for audit, while learning permission is separate.
export function excludeDiagnosticMaterial(owner,{sourceRefs,reason,requestId}={}){
 const r=owner.runtime,s=r.store,a=r.archive;
 if(!Array.isArray(sourceRefs)||!sourceRefs.length||sourceRefs.length>80||typeof reason!=='string'||!reason.trim()||reason.length>600||typeof requestId!=='string'||!/^[a-zA-Z0-9:_-]{8,120}$/.test(requestId))fail('INVALID_DIAGNOSTIC_EXCLUSION');
 const fingerprint=hash([sourceRefs,reason]),key='diagnostic-exclusion:'+requestId,prior=owner.archive.meta(key);if(prior){if(prior.fingerprint!==fingerprint)fail('DIAGNOSTIC_EXCLUSION_CONFLICT');return {...prior,idempotent:true};}
 const chatIds=[];
 for(const ref of sourceRefs){const d=a.get(ref.sourceId,ref.revision);if(d.checksum!==ref.expectedChecksum)fail('DIAGNOSTIC_SOURCE_CONFLICT');const ownReceipt=d.metadata.speakerId===r.characterId&&(d.kind==='tool-result'&&d.metadata.explicitObservation===true||d.kind==='experience'&&d.metadata.explicitExperience===true);if(!owner.isAdminScope(d.metadata.scope)||!(d.metadata.operatorInstruction===true||d.kind==='chat'&&d.metadata.role==='assistant'||ownReceipt))fail('DIAGNOSTIC_SOURCE_NOT_ADMIN_RECEIPT');const alias=d.metadata.legacyResourceId;if(d.kind==='chat'&&alias?.startsWith('chat:')){const id=alias.slice(5);if(!owner.contacts.db.prepare("SELECT 1 FROM chat_records WHERE id=? AND role='assistant'").get(id))fail('DIAGNOSTIC_CHAT_UNAVAILABLE');chatIds.push(id);}}
 const refs=dependentSources(r,sourceRefs.map(({sourceId,revision})=>({sourceId,revision})));if(refs.length>1000)fail('DIAGNOSTIC_EXCLUSION_TOO_LARGE');
 a.db.exec('BEGIN IMMEDIATE');try{for(const ref of refs)a.db.prepare('INSERT OR IGNORE INTO learning_exclusions VALUES(?,?,?,?,?)').run(ref.sourceId,ref.revision,requestId,reason,r.now());a.db.exec('COMMIT');}catch(error){a.db.exec('ROLLBACK');throw error;}
 const contacts=owner.contacts.db;contacts.exec('BEGIN IMMEDIATE');try{for(const id of chatIds)owner.contacts.excludeDiagnostic(id,{requestId,reason});contacts.exec('COMMIT');}catch(error){contacts.exec('ROLLBACK');throw error;}
 // A metadata-only revision preserves the original transcript and makes the
 // exclusion survive ordinary contact synchronization and restart.
 for(const id of chatIds)owner.archive.chat(contacts.prepare('SELECT * FROM chat_records WHERE id=?').get(id));
 const result=s.atomic('diagnostic-sources-excluded',()=>{const invalidated=invalidateSourceClosure(r,refs,'diagnostic-source-excluded');const receipt={requestId,fingerprint,sourceRefs:refs,chatIds,invalidated,rawSourcesPreserved:true,rawChatBytesPreserved:true,oldVersionsPreserved:true};owner.archive.meta(key,receipt);return {...receipt,affected:invalidated.affected};});owner.changed?.();return result;
}
