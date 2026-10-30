// Host-only source qualification, not a semantic truth checker. It uses only
// archived source types/ownership, never words that look like action verbs.
const SPEECH_LABEL='角色自述（仅确认说过，不独立证明所叙外部行为）：';
const DETAIL_LABEL='这条来源记录角色当时怎样表达；主观感受和偏好仍是其自身表达，不要求外部行动凭据。它不能独立证实叙述中的真实生活、工具或平台活动。\n';
const clip=(value,n)=>[...String(value??'')].slice(0,n).join('');

// This only decides whether a record reused by its exact ID may be restricted.
// It does not lend the old receipt to a newly reported statement or prove a new
// action. Preserve an existing verified claim with its original usable receipt.
export function shouldRestrictStoredCompletion(runtime,current,incoming){
  const a=current?.assertion,b=incoming?.assertion;
  if(!a||!b||a.commitmentStatus!=='fulfilled'||b.commitmentStatus!=='fulfilled')return false;
  if(['speakerId','subjectId','targetId','predicate','dueAt'].some(k=>(a[k]??null)!==(b[k]??null))||JSON.stringify(a.object)!==JSON.stringify(b.object))return false;
  const independent=current.metadata?.semanticVerified===true&&(current.evidence||[]).some(ref=>{
    let d;try{d=runtime.archive.get(ref.sourceId,ref.revision);}catch{return false;}
    const meta=d.metadata||{};
    if(!['tool-result','activity','action-receipt'].includes(d.kind)||meta.confirmedActionReceipt!==true||meta.speakerId!==runtime.characterId
      ||meta.forwardedAuthorId||meta.providedHistory||meta.quotedTranscript||meta.notPrimaryEvidence||meta.diagnostic||meta.learningExcluded)return false;
    if(runtime.store?.sourceUsable?.(ref)===false||runtime.store?.suppressed?.(ref.sourceId))return false;
    const targetScope=a.targetId?.startsWith('qq:')?'private:'+a.targetId.slice(3):a.targetId;
    if(meta.scope?.startsWith('private:')&&targetScope&&meta.scope!==targetScope)return false;
    if(meta.conversationPeerId&&a.targetId&&meta.conversationPeerId!==a.targetId)return false;
    return true;
  });
  return !independent;
}

export function qualifySelfStatements(runtime,bundle){
  const out=structuredClone(bundle),changes=[];
  for(const [index,m]of (out.memories||[]).entries()){
    const a=m.assertion;
    if(m.kind!=='assertion'||a?.speakerId!==runtime.characterId||a.subjectId!==runtime.characterId)continue;
    const evidence=(m.evidence||[]).filter(e=>!e.role||e.role==='supports');
    if(!evidence.length)continue;
    const sources=evidence.map(e=>runtime.archive.get(e.sourceId,e.revision));
    if(!sources.every(d=>d.kind==='chat'&&d.metadata.role==='assistant'&&d.metadata.speakerId===runtime.characterId&&!d.metadata.forwardedAuthorId))continue;
    // Do not trust a supplied sourceTyping marker to bypass host qualification.
    // Reapplication preserves the same explicit reported proposition.
    const wrapped=a.object&&typeof a.object==='object'&&!Array.isArray(a.object)
      &&Object.hasOwn(a.object,'reportedSpeechContent')
      &&a.object.evidenceQualification==='own-assistant-chat-statement-only'
      &&a.object.externalActionIndependentlyConfirmed===false;
    const content=wrapped?a.object.reportedSpeechContent:a.object;
    m.epistemic='reported';
    const unsupportedFulfilment=a.commitmentStatus==='fulfilled';
    if(unsupportedFulfilment)m.status='candidate';
    m.gist=clip(m.gist.startsWith(SPEECH_LABEL)?m.gist:SPEECH_LABEL+m.gist,800);
    m.detail=clip(String(m.detail||'').startsWith(DETAIL_LABEL)?m.detail:DETAIL_LABEL+(m.detail||''),1600);
    // Promise/proposal/cancellation/dispute/claimed fulfilment keep the exact
    // object, participants, state and due date used by commitment matching.
    // This rule never verifies fulfilment; existing evidence admission and
    // reconcileCommitments still reject a promisor's unsupported completion.
    if(a.speechAct==='statement'&&!a.commitmentStatus)a.object={
      reportedSpeechContent:content,evidenceQualification:'own-assistant-chat-statement-only',
      sourceScope:'owned-assistant-chat',externalActionIndependentlyConfirmed:false
    };
    m.metadata={...m.metadata,...(unsupportedFulfilment?{claimedCompletion:true}:{}),sourceTyping:{kind:'self-statement-only',
      basis:'all-supporting-sources-are-owned-assistant-chat',confirms:'the-role-expressed-this',
      doesNotConfirm:'narrated-external-world-actions-or-habits',subjectiveFeelingAndPreferenceStillValid:true,
      sourceScope:'supporting-evidence-only; context-is-not-independent-action-proof',
      sourceRefs:evidence.map(e=>({sourceId:e.sourceId,revision:e.revision})),
      ...(a.commitmentStatus||a.speechAct!=='statement'?{reportedSpeechContent:structuredClone(content)}:{})}};
    changes.push({index,kind:m.kind,speechAct:a.speechAct,sourceRefs:m.metadata.sourceTyping.sourceRefs});
  }
  return {bundle:out,changes};
}
