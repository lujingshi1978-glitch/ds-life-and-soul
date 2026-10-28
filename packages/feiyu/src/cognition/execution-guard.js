// An intention may be revoked while an adapter is waiting. A genuine late
// receipt still records the effect without reviving the cancelled intention.
export function executionGuard(inner,run){
  const id=run?.executionId;
  return {
    assert(){if(id)inner.assertExecutable(id);},
    starting(){if(id)inner.effectStarting(id);},
    observed(receipt){if(!id||inner.runtime.closed||inner.runtime.closing||inner.store.closed)return;inner.noteActionEffect(id,receipt);const e=inner.db.prepare('SELECT status FROM v3_action_executions WHERE execution_id=?').get(id);if(e?.status==='unknown')inner.actionResult(id,{status:'succeeded',receipt:{lateObserved:true,partial:true,...receipt}});}
  };
}
