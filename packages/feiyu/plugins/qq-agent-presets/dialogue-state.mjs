// One character has one continuous state. Preserve source identity on switching.
export function dialogueState(state, scope) {
  if (!state) return null;
  return {
    version: state.version, affectRevision: state.affectRevision,
    appraisal:state.appraisal, mood: state.mood, affectScope:state.affectScope??null, valence: state.valence, arousal: state.arousal, energy: state.energy,
    psychological: state.psychological, psychologicalScope:state.psychologicalScope??null,
    psychologicalNote:'这是肥鱼连续的当前感受；来源见psychologicalScope，未知来源不归给当前对象。其他好友引发的感受不是当前好友的言行。',
    behavior:state.behavior, attention: scope, updated: state.updated,manualAdjustment:state.manualAdjustment??null,
    ...(state.pendingInnerIntegration?{pendingInnerIntegration:state.pendingInnerIntegration}:{}),
    ...(Array.isArray(state.dispositionChanges)?{dispositionChanges:state.dispositionChanges}:{}),
  };
}
