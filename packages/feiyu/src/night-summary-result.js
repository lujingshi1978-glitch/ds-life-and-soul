// Completion requires maintenance and an actual inner commit, not just a
// normally resolved Promise. Retrying is bounded by the night coordinator.
export function nightSummaryResult(report){
  if(!report||typeof report!=='object')return {status:'failed',retryable:false};
  const rows=report.outputs||[],nested=[];const collect=(r,depth=0)=>{if(!r||depth>8)return;nested.push(r);if(r.report)collect(r.report,depth+1);};rows.forEach(r=>collect(r));
  const work=report.remaining||{},pending=work.pending>0||work.dirtyTopics>0||work.backingOffDocuments>0||work.unscheduledEvents>0||work.uncoveredUnits>0||work.pendingRepairs>0||work.unindexedDocuments>0,partial=nested.some(r=>r.status==='partial'||r.failedDocs?.length||r.embeddingDegraded)||work.failedDocuments>0;
  const inner=report.inner,failed=nested.some(r=>['failed','model-not-configured'].includes(r.status))||work.failedJobs>0,waiting=nested.some(r=>['deferred','preempted','busy','foreground-busy','sleeping','energy-sleeping','waiting-for-wake'].includes(r.status))||pending,committed=!inner||['applied','already-integrated'].includes(inner.status)||inner.duplicate===true&&!!inner.commitId;
  if(report.status==='failed')return {status:'failed',retryable:false};
  if(!committed||waiting)return {status:committed?'partial':'deferred',retryable:!failed&&(!committed||pending||!failed)&&!work.quarantinedDocuments,retryAt:Math.max(Number(inner?.retryAt)||0,Number(work.retryAt)||0,...nested.map(r=>Number(r.retryAt)||0))};
  if(failed||partial||report.status==='partial')return {status:'partial',retryable:!failed&&partial&&!work.quarantinedDocuments};
  return {status:'complete',retryable:false};
}

export function nightSummaryFailure(error,now=Date.now()){
  const code=String(error?.code||error?.message||error),retryable=['BACKGROUND_ATTENTION_BUSY','BACKGROUND_ATTENTION_PREEMPTED','BACKGROUND_PREEMPTED','FOREGROUND_PREEMPTION','ACTIVITY_LEASE_REVOKED','V3_INNER_BUSY','ENERGY_DEPLETED','V3_HOURLY_MODEL_BUDGET','COGNITION_READSET_STALE','V3_HEAD_VERSION_CONFLICT','AbortError','ABORT_ERR'].some(c=>code.includes(c))||error?.name==='AbortError';
  return {status:retryable?'deferred':'failed',error:code.slice(0,1000),retryable,retryAt:retryable?(code.includes('V3_HOURLY_MODEL_BUDGET')?(Math.floor(now/3600000)+1)*3600000:now+120000):0};
}
