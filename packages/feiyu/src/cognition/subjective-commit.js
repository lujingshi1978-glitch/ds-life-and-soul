import {fail} from './contracts.js';

const active=new WeakMap();

// A host callback can commit a subjective projection only while the same
// SQLite transaction has committed its current inner generation. JSON/model
// output cannot manufacture this process-local capability.
export function withinSubjectiveCommit(inner,commitId,generation,operation){
  if(!inner.db.isTransaction||inner.head().generation!==generation||!inner.db.prepare('SELECT 1 FROM v3_inner_commits WHERE character_id=? AND commit_id=?').get(inner.runtime.characterId,commitId))fail('INNER_SUBJECTIVE_COMMIT_REQUIRED');
  const old=active.get(inner.store);active.set(inner.store,{commitId,generation});
  try{const result=operation();if(result&&typeof result.then==='function')fail('INNER_SYNCHRONOUS_COMMIT_REQUIRED');return result;}finally{if(old)active.set(inner.store,old);else active.delete(inner.store);}
}
export function assertSubjectiveCommit(store){
  if(!store.inner)return;
  const capability=active.get(store);
  if(!store.db.isTransaction||!capability||store.inner.head().generation!==capability.generation)fail('INNER_SUBJECTIVE_COMMIT_REQUIRED');
  return capability;
}
