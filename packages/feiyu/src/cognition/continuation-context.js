import {hash,parse,clip,terms,fail,bounded} from './contracts.js';
import {basisSources} from './basis-sources.js';
import {currentTopicCue} from './memory-activation.js';
import {isOperationalMaterial} from '../operational-material.js';

// The event's state, the character's attention, and a delivered action are three
// different things. This is a read view over their existing versioned records.
export const CONTINUATION_STATES=new Set(['unknown','reported_open','reported_progress','reported_improvement','reported_complete','reported_cancelled','observed_complete','observed_cancelled']);
const TERMINAL=new Set(['reported_complete','reported_cancelled','observed_complete','observed_cancelled']);
const SIGNIFICANCE=new Set(['casual','care','commitment','boundary']);
const genericAck=s=>/^(?:ok(?:ay)?|好(?:的|呀)?|嗯(?:嗯)?|行|收到|知道了|谢谢|嗯好)[\s.!！。~～]*$/iu.test(String(s).trim());
const greeting=s=>/^(?:hello|hi|hey|你好|嗨|哈喽|在(?:吗|嘛)?|早(?:上好|安)?|晚好|回来啦?)[\s.!！。?？~～]*$/iu.test(String(s).trim());
const own=(inner,id)=>inner.db.prepare('SELECT o.*,v.body_json,v.recorded_at FROM v3_inner_objects o JOIN v3_inner_versions v USING(character_id,object_id) WHERE o.character_id=? AND o.object_id=? AND v.revision=o.current_revision').get(inner.runtime.characterId,id);
const priorBody=o=>o?.body|| (o?.body_json?parse(o.body_json):{});
const peers=body=>[...new Set([...(body.people||[]),body.personId].filter(x=>typeof x==='string'&&/^(qq:\d+|wechat:[a-f0-9]{24})$/.test(x)))];
function usableSource(inner,sourceId,revision){
 const r=inner.runtime,ref={sourceId,revision};
 if(!r.store.sourceUsable(ref,{historical:true})||r.store.suppressed(sourceId))fail('CONTINUATION_SOURCE_UNAVAILABLE');
 const d=r.archive.get(sourceId,revision);if(d.status&&d.status!=='available'||isOperationalMaterial(d))fail('CONTINUATION_SOURCE_UNAVAILABLE');
 for(const p of basisSources(r,[ref]))if(!r.store.sourceUsable(p,{historical:true})||r.store.suppressed(p.sourceId))fail('CONTINUATION_SOURCE_UNAVAILABLE');
 return d;
}
function eventDocuments(inner,eventId,{current=false}={}){
 const rows=inner.db.prepare('SELECT es.source_id,es.source_revision,e.outcome,e.role_epoch FROM cognitive_events e JOIN event_sources es USING(character_id,event_id) WHERE e.character_id=? AND e.event_id=?').all(inner.runtime.characterId,eventId);
 if(!rows.length)fail('CONTINUATION_EVENT_UNAVAILABLE');
 if(current&&rows.some(r=>r.role_epoch!==inner.store.manifest().role_epoch))fail('CONTINUATION_OLD_ROLE_EVIDENCE');
 return rows.map(r=>({...r,document:usableSource(inner,r.source_id,r.source_revision)}));
}

// Source admission is deterministic; interpretation remains explicitly reported.
// No word in a quotation is used to automatically infer a terminal outcome.
export function validateContinuationPatch(inner,change,{eventIds=[],previous}={}){
 const old=previous|| (change.id?inner.object(change.id):null),before=priorBody(old);let value=change.continuation;
 if(value===undefined)return;
 // The read view uses reportedSubjectId. Accept that exact presentation alias,
 // never an arbitrary new field or a new authority. Optional null means absent;
 // reported outcomes still require the exact current speaker/quote below.
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  value={...value};const alias=value.reportedSubjectId;
  if(Object.hasOwn(value,'reportedSubjectId')){if(alias!=null&&value.subjectId!=null&&alias!==value.subjectId)fail('CONTINUATION_SUBJECT_CONFLICT');if(alias!=null&&value.subjectId==null)value.subjectId=alias;delete value.reportedSubjectId;}
  if(value.subjectId===null)delete value.subjectId;
 }
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['externalState','subjectId','significance','revisitWhen','confirmation'].includes(k)))fail('INVALID_CONTINUATION');
 if(change.kind!=='concern'&&change.kind!=='chapter')fail('CONTINUATION_KIND_REQUIRED');
 if(value.externalState!==undefined&&!CONTINUATION_STATES.has(value.externalState))fail('INVALID_CONTINUATION_STATE');
 if(value.subjectId!==undefined&&(typeof value.subjectId!=='string'||!peers({...before,...change}).includes(value.subjectId)))fail('CONTINUATION_REPORT_SUBJECT_REQUIRED');
 if(value.significance!==undefined&&!SIGNIFICANCE.has(value.significance))fail('INVALID_CONTINUATION_SIGNIFICANCE');
 if(value.revisitWhen!==undefined)bounded(value.revisitWhen,300,{empty:true});
 const normalized={...(before.continuation||{}),...value},state=value.externalState??before.continuation?.externalState??'unknown';normalized.externalState=state;
 if(state==='unknown'){delete normalized.confirmation;return normalized;}
 // Reusing a validated old state requires no invented new confirmation. A
 // source correction/withdrawal is checked by context materialization below.
 if(before.continuation?.externalState===state&&JSON.stringify(value.confirmation??before.continuation?.confirmation)===JSON.stringify(before.continuation?.confirmation)){eventDocuments(inner,before.continuation.confirmation.eventId);return normalized;}
 const confirmation=value.confirmation;
 if(!confirmation||typeof confirmation!=='object'||Array.isArray(confirmation)||Object.keys(confirmation).some(k=>!['eventId','quote'].includes(k)))fail('CONTINUATION_CONFIRMATION_REQUIRED');
 if(!eventIds.includes(confirmation.eventId))fail('CONTINUATION_CURRENT_CONFIRMATION_REQUIRED');
 const quote=bounded(confirmation.quote,600),documents=eventDocuments(inner,confirmation.eventId,{current:true}),people=peers({...before,...change}),subject=normalized.subjectId||change.personId||before.personId||(people.length===1?people[0]:null);
 if(state.startsWith('reported_')){
  if(!subject||!people.includes(subject))fail('CONTINUATION_REPORT_SUBJECT_REQUIRED');normalized.subjectId=subject;
  const source=documents.find(({document:d})=>{const m=d.metadata||{},scope=subject.startsWith('qq:')?'private:'+subject.slice(3):subject;return d.kind==='chat'&&m.role==='user'&&m.speakerId===subject&&m.scope===scope&&(!m.conversationPeerId||m.conversationPeerId===m.speakerId)&&!m.providedHistory&&!m.quotedTranscript&&!m.forwardedAuthorId&&d.text.includes(quote);});
  if(!source)fail('CONTINUATION_PERSON_REPORT_REQUIRED');
  // An acknowledgement may mean "a little better" in a care exchange. It
  // cannot by itself confirm that a project/promise was finished or cancelled.
  if(genericAck(quote)&&state!=='reported_improvement')fail('CONTINUATION_ACK_NOT_OUTCOME');
  if(state==='reported_improvement'&&genericAck(quote)&&!['care','tension'].includes(change.concernKind||before.concernKind))fail('CONTINUATION_ACK_CONTEXT_REQUIRED');
 }else{
  // A successful unrelated read/send does not complete the tracked event.
  const source=documents.find(({document:d,outcome})=>{const m=d.metadata||{},receipt=m.continuationOutcome;return outcome==='completed'&&receipt&&receipt.objectId===(change.id||old?.object_id)&&receipt.objectRevision===old?.current_revision&&receipt.externalState===state&&m.explicitObservation===true&&d.text.includes(quote);});
  if(!source)fail('CONTINUATION_BOUND_RECEIPT_REQUIRED');
 }
 return normalized;
}

// A later psychological update may retain the old reported outcome. Carry its
// exact event dependency into the new object version so withdrawal stays visible
// to native lineage traversal, not just this derived view.
export function continuationEvidenceRefs(inner,body,refs=[]){
 const eventId=body.continuation?.confirmation?.eventId;if(!eventId)return refs;
 eventDocuments(inner,eventId);return refs.some(r=>r.eventId===eventId)?refs:[...refs,{eventId}];
}

function exactEvidence(inner,row){
 const refs=inner.db.prepare('SELECT source_id,source_revision,event_id,memory_id,memory_revision FROM v3_inner_evidence WHERE character_id=? AND object_id=? AND object_revision=?').all(inner.runtime.characterId,row.object_id,row.current_revision),out=[];
 for(const ref of refs){
  if(ref.memory_id){const m=inner.store.get(ref.memory_id);if(!m||m.revision!==ref.memory_revision||inner.store.nodeSuppressed(m.id))fail('CONTINUATION_MEMORY_UNAVAILABLE');for(const s of m.evidence)usableSource(inner,s.sourceId,s.revision);out.push({memoryId:m.id,revision:m.revision});}
  else if(ref.source_id){usableSource(inner,ref.source_id,ref.source_revision);out.push({sourceId:ref.source_id,revision:ref.source_revision});}
  else if(ref.event_id){eventDocuments(inner,ref.event_id);out.push({eventId:ref.event_id});}
 }
 if(!out.length)fail('CONTINUATION_EVIDENCE_REQUIRED');return out;
}
function relatedActionHistory(inner){
 // Read the bounded native history once per view. A model-selected candidate,
 // cancelled attempt, unknown receipt and confirmed delivery remain distinct.
 const rows=inner.db.prepare("SELECT a.object_id,a.revision,a.status proposal_status,a.target_person_id,v.body_json,m.body_json motive_body,e.execution_id,e.status execution_status,e.finished_at,e.started_at,v.recorded_at FROM v3_action_proposals a JOIN v3_inner_versions v ON v.character_id=a.character_id AND v.object_id=a.object_id AND v.revision=a.revision LEFT JOIN v3_inner_versions m ON m.character_id=a.character_id AND m.object_id=a.motive_id AND m.revision=a.motive_revision LEFT JOIN v3_action_executions e ON e.character_id=a.character_id AND e.action_id=a.object_id AND e.action_revision=a.revision WHERE a.character_id=? AND a.action_kind='chat' ORDER BY coalesce(e.finished_at,e.started_at,v.recorded_at) DESC LIMIT 1000").all(inner.runtime.characterId),history=new Map();
 for(const a of rows){const ids=[...new Set([...(parse(a.body_json).objectIds||[]),...(a.motive_body?parse(a.motive_body).objectIds||[]:[])])],status=a.execution_status||a.proposal_status,record={actionId:a.object_id,actionRevision:a.revision,executionId:a.execution_id||null,targetPersonId:a.target_person_id,at:a.finished_at||a.started_at||a.recorded_at,status,deliveryConfirmed:status==='succeeded',...(status==='unknown'?{doNotBlindlyResend:true}:{}),meaning:status==='succeeded'?'a related action was delivered; its reference does not prove this exact topic was mentioned':status==='unknown'?'delivery is unknown; do not infer it was not sent or recreate an equivalent send':'a candidate/attempt is not evidence that this topic was mentioned'};
  for(const id of ids){if(!history.has(id))history.set(id,{attempt:record,delivery:null});if(status==='succeeded'&&!history.get(id).delivery)history.get(id).delivery=record;}
 }return history;
}

export function continuationContext(inner,{person,query='',memoryIds=[],limit=6}={}){
 const db=inner.db,topic=currentTopicCue(query),cues=new Set(terms(topic.query||query)),recalled=new Set(memoryIds),items=[],actionHistory=relatedActionHistory(inner);
 const rows=db.prepare("SELECT o.*,v.body_json,v.recorded_at,l.scope lifecycle_scope FROM v3_inner_objects o JOIN v3_inner_versions v ON v.character_id=o.character_id AND v.object_id=o.object_id AND v.revision=o.current_revision LEFT JOIN v3_ongoing_lifecycle l ON l.object_id=o.object_id WHERE o.character_id=? AND o.kind IN ('concern','chapter') AND o.status IN ('active','quiet','paused','contested') AND o.invalidated_at IS NULL AND l.object_id IS NULL ORDER BY v.recorded_at DESC LIMIT 2000").all(inner.runtime.characterId);
 for(const row of rows){const body=parse(row.body_json),people=peers(body),same=person&&people.includes(person);if(person&&!same)continue;
  const configured=body.continuation||{},state=CONTINUATION_STATES.has(configured.externalState)?configured.externalState:'unknown',significance=configured.significance||(body.concernKind==='promise'?'commitment':body.cueKind==='boundary'?'boundary':body.concernKind==='care'?'care':'casual'),critical=['commitment','boundary'].includes(significance);
  const related=terms((body.title||'')+' '+(body.meaning||'')).some(t=>cues.has(t)),greet=same&&greeting(query);let evidence;try{evidence=exactEvidence(inner,row);if(configured.confirmation?.eventId)eventDocuments(inner,configured.confirmation.eventId);}catch{continue;}
  if(configured.confirmation?.eventId&&!evidence.some(r=>r.eventId===configured.confirmation.eventId))evidence.push({eventId:configured.confirmation.eventId});
  const linked=evidence.some(r=>r.memoryId&&recalled.has(r.memoryId))||(body.memoryIds||[]).some(id=>recalled.has(id));
  // A changed subject does not reactivate an ordinary old thread. Important
  // commitments remain inspectable as background, with no obligation to ask.
  if(topic.changed&&!critical)continue;
  if(person&&query.trim()&&!related&&!linked&&!greet&&!critical)continue;
  if(['quiet','paused'].includes(row.status)&&!related&&!linked&&!(greet&&significance==='care')&&!critical)continue;
  const history=actionHistory.get(row.object_id),delivery=history?.delivery||null,attempt=history?.attempt||null;
  items.push({id:row.object_id,revision:row.current_revision,kind:row.kind,subject:clip(body.title||'',180),meaning:clip(body.meaning||'',250),people,externalState:state,reportedSubjectId:configured.subjectId||null,externalStateBasis:state==='unknown'?'no confirmed external outcome':state.startsWith('reported_')?'the person reported this; not independently observed':'exact host-bound operation receipt',attentionState:row.status,significance,revisitWhen:clip(configured.revisitWhen||'',300),uncertainties:(body.uncertainties||[]).map(x=>clip(x,160)).slice(0,4),lastRelatedDelivery:delivery,lastRelatedAttempt:attempt,evidence,referenceOnly:true,notATask:true,mayConsider:!topic.changed&&(related||linked||greet||!query.trim()),outcomeKnown:TERMINAL.has(state),use:TERMINAL.has(state)?'react to the known reported/observed outcome; do not ask again as unfinished':row.status==='quiet'||row.status==='paused'?'background; only reconsider if naturally relevant':'optional continuation; a missing outcome is not a duty to investigate',priority:(linked?3:0)+(related?2:0)+(greet&&significance==='care'?2:0)+(critical?1:0)});
 }
 items.sort((a,b)=>b.priority-a.priority);const selected=items.slice(0,Math.max(0,Math.min(30,limit))).map(({priority,...x})=>x);
 return {policy:'situated-continuation-v1',items:selected,fingerprint:hash({person:person||null,query:String(query).trim(),items:selected}),referenceOnly:true,noAutomaticSend:true,noMatchDoesNotMeanNeverHappened:true};
}

export const CONTINUATION_HINT='continuations是有来源的旧牵挂，不是待办列表。externalState只描述外部事情目前知道到哪一步，attentionState描述我是否仍在意，两者分开；quiet/paused/released不等于事情完成。关心可以在重逢或新联想时顺口提及一次，对方换题、忙或只简短应声可以收住。重要承诺与边界保留，不按时间自动解决；不要求把旧事聊完才能接新话。lastRelatedDelivery只证明关联行动实际交付，候选、取消或未知回执不算问过；lastRelatedAttempt保留最近候选/尝试，unknown表示发送是否到达未知，不能当成没发过而换个行动重复发送；行动引用也不证明台词一定提到此事。changes中的concern/chapter可附continuation:{externalState:"unknown|reported_open|reported_progress|reported_improvement|reported_complete|reported_cancelled|observed_complete|observed_cancelled",subjectId:"多人物时明确是哪位本人",significance:"casual|care|commitment|boundary",revisitWhen:"哪类真实新信息或机会值得再想起",confirmation:{eventId:"本轮本人新话或宿主回执的event id",quote:"原文中确实存在的短句"}}。不确定就unknown；本人说法标reported，不冒充客观完成。OK在明确的关心语境下可理解为暂时好转，不能把创赛、承诺或其他事情顺便标完成。自己的建议不等于对方决定；观测完成只认精确绑定该对象版本的宿主回执。是否提及、联系或行动仍由本轮自由选择，发起联系继续服从原有权限和近况边界。';
