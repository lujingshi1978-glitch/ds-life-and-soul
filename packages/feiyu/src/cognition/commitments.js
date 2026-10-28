import {json} from './contracts.js';

// A later chat is not a fulfillment receipt. Bind a transition to one exact
// obligation and keep the old promise as a qualified historical version.
export function reconcileCommitments(runtime,ids){
  const s=runtime.store;
  for(const id of ids){const m=s.get(id),a=m?.assertion;if(!m||!a||!m.metadata.semanticVerified||!['cancelled','fulfilled','disputed'].includes(a.commitmentStatus)||!a.subjectId||!a.targetId)continue;
    if(a.commitmentStatus==='fulfilled'&&a.speakerId===a.subjectId&&!m.evidence.some(e=>runtime.archive.get(e.sourceId,e.revision).metadata.confirmedActionReceipt===true))continue;
    if(a.speakerId!==a.subjectId&&a.speakerId!==a.targetId)continue;
    const possible=s.db.prepare(`SELECT n.memory_id FROM assertions p JOIN memory_nodes n USING(character_id,memory_id) WHERE n.status='active' AND p.character_id=? AND p.subject_id=? AND p.target_id=? AND p.predicate=? AND p.object_json=? AND p.commitment_status='promised' AND n.memory_id<>? AND (? IS NULL OR p.due_at=?) ORDER BY coalesce(n.occurred_at,n.recorded_at) DESC`).all(s.characterId,a.subjectId,a.targetId,a.predicate,json(a.object),id,a.dueAt,a.dueAt).map(row=>s.get(row.memory_id)).filter(old=>old&&(m.occurred_at??m.recorded_at)>=(old.occurred_at??old.recorded_at));
    const obligations=new Set(possible.map(old=>[old.event_root,old.assertion.dueAt].join('@')));
    if(obligations.size!==1){if(possible.length)runtime.lifecycle.revise(id,m.revision,{status:'candidate',metadata:{...m.metadata,unresolvedCommitmentTransition:true}});continue;}
    for(const old of possible){runtime.lifecycle.supersedeWithin(old.id,id,{validTo:m.occurred_at??m.recorded_at});}
    const current=s.get(id);if(current)runtime.lifecycle.revise(id,current.revision,{metadata:{...current.metadata,previousPromises:possible.map(old=>({id:old.id,revision:old.revision})),transitionEvidence:'exact-participants-predicate-object-and-verified-source'}});
  }
}
