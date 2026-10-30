// Cheap, bounded host facts for expression. This view does not run actions,
// reconcile state, search memory, or infer that an internal wish was executed.
export const ACTIVITY_FACTS_HINT='【活动事实与联想】心情、兴趣、记忆里的意图和行动候选，可以自然聊起、联想或表达想做；它们不证明正在做或已经做过。当前行为以宿主活动记录为准；started只表示尝试中，成功效果以实际回执及其覆盖范围为准，读到片段不等于完整看过。没有活动事实材料时保留未知，不为闲聊编造正在/最近看过、收藏、做过的活动。未命中也不等于从未发生；相似的新计划不等于同一件旧事，不凭相近记忆纠正对方为没提过。无需每次解释证据，可正常接话、聊感受和好奇。';
const parse=s=>{try{return JSON.parse(s)||{};}catch{return {};}};
const oneOf=(v,allowed)=>allowed.includes(v)?v:'unknown';
const kinds=['chat','bili','qzone','web','browse','read','learn','rest','sleep','dream','organize','idle','do_nothing'];
export function activityFacts(owner,scope){
 const r=owner.runtime,db=r?.store?.db,a=r?.archive?.db,cid=r?.characterId,now=r?.now?.()??Date.now();
 const result={version:1,observedAt:now,coverage:'当前角色、当前窗口或self的近期有界宿主记录；不是完整活动史。无记录保留未知，不证明从未发生。',current:{status:'unknown',operations:[],storedHostLabel:'unknown',storedLabelIsExternalEffectProof:false},proposals:[],executions:[],confirmedReturns:[]};
 if(!db||!a||!cid||db.prepare('SELECT character_id FROM character_manifest WHERE singleton=1').get()?.character_id!==cid||a.prepare('SELECT character_id FROM owner WHERE id=1').get()?.character_id!==cid)return result;
 const has=name=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),person=scope?.startsWith('private:')?'qq:'+scope.slice(8):null;
 result.current={status:'host-observed',operations:[...(owner.behaviors?.values?.()||[])].filter(b=>b.scope===scope||b.scope==='self').slice(-3).map(b=>({kind:oneOf(b.kind,kinds),startedAt:b.startedAt,qualification:'宿主中的进行中操作；尚不证明外部效果或完整读取'})),storedHostLabel:oneOf(owner.store?.state?.().behavior?.kind,kinds),storedLabelIsExternalEffectProof:false};
 if(has('v3_action_proposals')&&has('v3_inner_objects')){
  const ps=db.prepare(`SELECT p.object_id,p.revision,p.action_kind,p.status,p.expires_at,o.invalidated_at,o.status object_status,x.revision invalidation_revision FROM v3_action_proposals p
   JOIN v3_inner_objects o ON o.character_id=p.character_id AND o.object_id=p.object_id
   LEFT JOIN v3_inner_invalidations x ON x.object_id=p.object_id AND x.revision=p.revision
   WHERE p.character_id=? AND (p.target_person_id IS NULL OR p.target_person_id=?) ORDER BY p.rowid DESC LIMIT 3`).all(cid,person);
  result.proposals=ps.map(p=>({id:p.object_id,revision:p.revision,kind:p.action_kind,status:p.invalidated_at||p.invalidation_revision?'invalidated':p.status,objectStatus:p.object_status,expired:p.expires_at<=now,qualification:'仅保存了候选/选择，不据此声称执行'}));
 }
 if(has('v3_action_executions')&&has('v3_action_proposals')){
  const es=db.prepare(`SELECT e.execution_id,e.status,e.started_at,e.finished_at,e.receipt_json,p.action_kind,o.invalidated_at,x.revision invalidation_revision FROM v3_action_executions e
   JOIN v3_action_proposals p ON p.character_id=e.character_id AND p.object_id=e.action_id AND p.revision=e.action_revision
   JOIN v3_inner_objects o ON o.character_id=e.character_id AND o.object_id=e.action_id
   LEFT JOIN v3_inner_invalidations x ON x.object_id=e.action_id AND x.revision=e.action_revision
   WHERE e.character_id=? AND (p.target_person_id IS NULL OR p.target_person_id=?) ORDER BY e.rowid DESC LIMIT 4`).all(cid,person);
  result.executions=es.map(e=>{const receipt=parse(e.receipt_json).receipt,hasReceipt=!!receipt&&typeof receipt==='object'&&Object.keys(receipt).length>0&&!receipt.redacted&&receipt.ok!==false&&!['unknown','failed','cancelled'].includes(receipt.status),confirmed=e.status==='succeeded'&&hasReceipt&&!e.invalidated_at&&!e.invalidation_revision;
   return {id:e.execution_id,kind:e.action_kind,status:e.status,startedAt:e.started_at,finishedAt:e.finished_at,hasUsableConfirmation:confirmed,qualification:confirmed?'仅确认此项宿主执行回执；未给出读取内容或完整播放证明':e.status==='claimed'||e.status==='started'?'已领取/尝试中，结果未确认':'无可用的成功效果证明'};});
 }
 // Content extent comes only from the existing native perception receipt.
 // No raw receipt, URL, title, excerpt or another peer's private data is copied.
 const observations=a.prepare(`SELECT source_id,revision,observed_at,body FROM documents WHERE status='available' AND adapter='tool-perception' AND kind='tool-result'
  AND json_extract(metadata,'$.speakerId')=? AND json_extract(metadata,'$.explicitObservation')=1 AND json_extract(metadata,'$.scope') IN (?, 'self') ORDER BY observed_at DESC LIMIT 6`).all(cid,scope);
 for(const d of observations){const ref={sourceId:d.source_id,revision:d.revision};if(r.store.suppressed?.(ref.sourceId)||r.store.sourceUsable?.(ref)===false)continue;let actual;try{actual=r.archive.get(ref.sourceId,ref.revision);}catch{continue;}if(actual.metadata.learningExcluded||actual.metadata.diagnostic)continue;
  const b=parse(d.body),ch=b.channels||{},frames=Number.isSafeInteger(ch.sampledFrames)&&ch.sampledFrames>0?ch.sampledFrames:0;
  result.confirmedReturns.push({...ref,observedAt:d.observed_at,kind:'native-perception-return',hasContent:!!(typeof b.excerpt==='string'&&b.excerpt.trim()||ch.subtitle||frames||ch.visualInterpretation||ch.asr),coverage:{subtitle:ch.subtitle===true,sampledFrames:frames,visualInterpretation:ch.visualInterpretation===true,asr:ch.asr===true,textExcerpt:typeof b.excerpt==='string'&&!!b.excerpt.trim(),fullVideoPlayback:false},hasLimitations:Array.isArray(b.limitations)&&b.limitations.length>0,qualification:'该来源回执范围内实际返回过内容；只能据已读原文指认对象，不由此补全整页、整部视频或宣称当前仍在看'});
 }
 return result;
}
