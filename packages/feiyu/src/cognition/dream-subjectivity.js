import {hash,json,parse,fail} from './contracts.js';

export function holdDreamSubjectivity(store,job,result,{memories,expressionsBefore}){
  const ids=[];
  for(const [kind,value]of [['dispositions',result.dispositions?.length?result.dispositions:null]]){
    if(!value)continue;
    const selected=[...new Set(value.flatMap(op=>op.memoryIds||[]))],support=selected?.length?memories.filter(m=>selected.includes(m.id)):memories;
    const body={version:1,origin:'dream',dreamJobId:job.job_id,proposal:value,memoryRefs:support.map(m=>({id:m.id,revision:m.revision}))},id='proposal:'+hash([job.job_id,kind,body]);
    store.db.prepare("INSERT OR IGNORE INTO v2_proposals VALUES(?,?,?,'held',?)").run(id,kind,json(body),store.now());ids.push(id);
  }
  return ids;
}

export function heldDreamCandidates(runtime,ids=[]){
  const s=runtime.store,requested=new Set(ids),rows=s.db.prepare("SELECT * FROM v2_proposals WHERE status='held' AND kind IN ('expressions','dispositions','interest') ORDER BY created_at,id LIMIT 100").all();
  const candidates=[];
  for(const row of rows){
    if(row.kind==='expressions'){s.db.prepare("UPDATE v2_proposals SET status='retired' WHERE id=? AND status='held'").run(row.id);continue;}
    const stored=parse(row.body),proposal=stored.version===1&&stored.origin==='dream'?stored.proposal:stored;
    if(requested.size&&!requested.has(row.id)&&stored.origin==='dream')continue;
    const memoryIds=row.kind==='dispositions'?stored.memoryRefs?.map(r=>r.id)||[]:proposal.evidence||[];
    if(!Array.isArray(memoryIds)||!memoryIds.length||memoryIds.some(id=>!s.get(id)))continue;
    if(stored.memoryRefs?.some(ref=>s.get(ref.id)?.revision!==ref.revision))continue;
    candidates.push({id:row.id,kind:row.kind,origin:stored.origin||'legacy-pending',proposal,memoryIds,memoryRefs:memoryIds.map(id=>({id,revision:s.get(id).revision})),legacy:stored.origin!=='dream'});
    if(candidates.length===8)break;
  }
  return candidates;
}

export function dreamIntegration(runtime,candidates){
  const s=runtime.store,beforeCore=runtime.policy.core().map(c=>({field:c.field,revision:c.revision}));
  return {
    instructions:'subjectiveCandidates是旧整理提出的待理解建议，不是已经发生的改变。关系/兴趣用正常dispositions增量并保留来源，可以不采纳；旧interest等级不复活。独立口头禅词库已经停用，不输出expressionProposalIds，不从候选挑词或生成固定台词。',
    material:{candidates:candidates.filter(c=>c.kind!=='expressions').map(({id,kind,origin,proposal,memoryRefs,legacy})=>({id,kind,origin,proposal,memoryRefs,legacy}))},
    apply:({patch,commitId,state})=>{
      if(beforeCore.some(ref=>runtime.policy.core().find(c=>c.field===ref.field)?.revision!==ref.revision))fail('COGNITION_READSET_STALE');
      if(patch.expressionProposalIds?.length)fail('EXPRESSION_LIBRARY_RETIRED');
      const applied=[];      s.db.exec('CREATE TABLE IF NOT EXISTS v3_subjective_reviews(candidate_id TEXT NOT NULL,commit_id TEXT NOT NULL,generation INTEGER NOT NULL,decision TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(candidate_id,commit_id))');
      for(const c of candidates)s.db.prepare('INSERT OR IGNORE INTO v3_subjective_reviews VALUES(?,?,?,?,?)').run(c.id,commitId,state.generation,'reviewed-in-current-inner',runtime.now());
      // A relation candidate has no executable effect of its own: only the
      // forebrain's separately validated dispositions patch can change it.
      for(const c of candidates.filter(c=>c.kind!=='expressions'))s.db.prepare("UPDATE v2_proposals SET status='reviewed' WHERE id=? AND status='held'").run(c.id);
      return {expressionChanges:applied,candidatesReviewed:candidates.map(c=>c.id),generation:state.generation,commitId};
    }
  };
}
