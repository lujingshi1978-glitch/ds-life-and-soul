import {bounded,clip,fail,hash,json,parse,terms} from './contracts.js';
import {assertSubjectiveCommit} from './subjective-commit.js';
import {memoryLearningEligible} from '../operational-material.js';

export const SELF_MODEL_HINT='【自我理解】这些是由有来源的来往、感受和反馈形成的情境理解，不是命令或新的客观经历。当前心情可以不同，局部关系变化不自动变成对所有人的性格。允许矛盾、修订与暂不改变；回忆可产生现在的新理解，但重述不增加独立事实依据。核心身份、价值与权限不由这些记录改写。';
export const SELF_MODEL_SCHEMA='selfUnderstanding可省略或为空数组。每项为 {facet:"具体侧面",text:"我的情境化自我理解",reason:"这次为何形成/修订",scope:{people:[本次证据中已知人物ID],situations:[具体情境],general:false},standing:"tentative|supported",supportIds:[本次memories中ID],counterIds:[本次counterevidence/memories中ID],eventIds:[本次observations中ID],transition:"add|revise|coexist|release",previousId?:已有selfUnderstanding的memory ID,expectedRevision?:该版本}。与一个人的感情/信任变化优先用正常dispositions；确有新的自我理解时才新增。单件事可形成情境候选，不宣布已获跨情境稳定证明。general=true的people必须为空，text不得包含具体人的私聊、身份或联系方式；它只表示目前提出的一般性理解，须解释跨情境依据或明确仍是tentative，不能把对一人的经历泛化为所有人。没有新理解保持空数组，既有证据不因此失效。不输出新性格指令或仿造原始事件。';

function usable(s,m){return !!m&&m.status!=='outdated'&&m.status!=='candidate'&&!s.nodeSuppressed(m.id)&&memoryLearningEligible(s.inner?.runtime?.archive,m)&&m.evidence?.length>0&&m.evidence.every(e=>s.sourceRegistered(e)&&!s.suppressed(e.sourceId)&&(!s.sourceUsable||s.sourceUsable(e)));}
export function selfReviewMemoryEligible(s,m){return usable(s,m)&&!m.metadata?.derived&&!m.metadata?.selfUnderstanding&&['experience','episode','relationship','self_model'].includes(m.kind);}
const schema=`CREATE TABLE IF NOT EXISTS v3_self_reviews(field TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(field,fingerprint));CREATE TABLE IF NOT EXISTS v3_self_summary_baseline(field TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL);`;
function install(s){s.db.exec(schema);}
function originalSourceRoots(s,refs){const roots=[];for(const ref of refs||[]){if(s.sourceUsable?.(ref)===false||s.suppressed(ref.sourceId))continue;const doc=s.inner?.runtime?.archive?.get(ref.sourceId,ref.revision);if(doc?.metadata?.notPrimaryEvidence||doc?.metadata?.diagnostic)continue;for(const row of s.db.prepare('SELECT e.event_root FROM event_sources es JOIN cognitive_events e USING(character_id,event_id) WHERE es.character_id=? AND es.source_id=? AND es.source_revision=?').all(s.characterId,ref.sourceId,ref.revision))roots.push(row.event_root);}return [...new Set(roots)];}
function memoryRoots(s,m){return Array.isArray(m.metadata.roots)&&m.metadata.roots.length?m.metadata.roots:originalSourceRoots(s,m.evidence);}
function observation(s,id){
 const r=s.inner?.runtime;if(!r)return null;
 const row=s.db.prepare('SELECT e.*,es.source_id,es.source_revision FROM cognitive_events e JOIN event_sources es USING(character_id,event_id) WHERE e.character_id=? AND e.event_id=?').get(s.characterId,id);if(!row)return null;
 const ref={sourceId:row.source_id,revision:row.source_revision};if(!s.sourceRegistered(ref)||s.suppressed(ref.sourceId)||s.sourceUsable?.(ref)===false)return null;
 const d=r.archive.get(ref.sourceId,ref.revision);if(d.metadata.notPrimaryEvidence||d.metadata.diagnostic||d.metadata.learningExcluded)return null;
 return {id,root:row.event_root,sourceId:ref.sourceId,sourceRevision:ref.revision,kind:d.kind,text:clip(d.text,1200),occurredAt:d.occurred_at,observedAt:d.observed_at,speakerId:d.metadata.speakerId||null,conversationPeerId:d.metadata.conversationPeerId||null,role:d.metadata.role||null,scope:d.metadata.scope||'self',explicitExperience:d.metadata.explicitExperience===true,epistemic:d.kind==='chat'?'reported-utterance-not-independent-external-action':'bounded-source-observation'};
}
export function reviewInputs(s,{memoryIds=[],eventIds=[]}={}){
 const memories=[...new Set(memoryIds)].map(id=>s.get(id)).filter(m=>selfReviewMemoryEligible(s,m));
 const observations=[...new Set(eventIds)].map(id=>observation(s,id)).filter(Boolean);
 const roots=[...new Set([...memories.flatMap(m=>memoryRoots(s,m)),...observations.map(e=>e.root)].filter(Boolean))];
 return {memories,observations,roots};
}

// Called by host after an accepted current subjective change, inside the same
// native inner commit. JSON alone cannot acquire the required capability.
export function enqueueReviewForSubjectiveChanges(s,{memoryIds=[],eventIds=[],psychology,commitId}={}){
 assertSubjectiveCommit(s);install(s);
 const changedPsychology=psychology&&['add','update','merge','resolve','release'].some(k=>Array.isArray(psychology[k])&&psychology[k].length);
 const input=reviewInputs(s,{memoryIds,eventIds:changedPsychology||memoryIds.length?eventIds:[]});
 if(!input.memories.length&&!changedPsychology||!input.roots.length)return {jobs:[],reason:'no-new-subjective-understanding'};
 return enqueueSelfReview(s,{...input,trigger:'accepted-subjective-change',psychology:changedPsychology?psychology:undefined,commitId});
}
export function enqueueSelfReview(s,{memories=[],observations=[],roots=[],trigger='new-memory',psychology,commitId}={}){
 install(s);if(!s.inner||!roots.length||!memories.length&&!observations.length)return {jobs:[]};
 const fields=s.db.prepare('SELECT field,revision FROM v2_core WHERE locked=0').all(),jobs=[];
 const evidenceKey={memories:memories.map(m=>[m.id,m.revision]).sort(),observations:observations.map(e=>[e.id,e.sourceRevision]).sort(),...(psychology?{psychology}:{} )};
 for(const field of fields){
  // Core revision/generation/clock are deliberately absent. Re-reading the same
  // evidence after an unchanged review cannot create a review/model-call loop.
  const fingerprint=hash([field.field,evidenceKey]);
  if(s.db.prepare('SELECT 1 FROM v3_self_reviews WHERE field=? AND fingerprint=?').get(field.field,fingerprint))continue;
  let payload={mode:'self-understanding-v1',field:field.field,revision:field.revision,roots,memoryRefs:memories.map(m=>({id:m.id,revision:m.revision})),eventRefs:observations.map(e=>({id:e.id,sourceId:e.sourceId,revision:e.sourceRevision})),fingerprint,inputFingerprints:[fingerprint],trigger,...(psychology?{acceptedPsychology:psychology}:{}),...(commitId?{triggerCommit:commitId}:{})};
  const pending=s.db.prepare("SELECT job_id,payload_json FROM jobs WHERE character_id=? AND role_epoch=? AND kind='grow' AND status='pending' AND json_extract(payload_json,'$.mode')='self-understanding-v1' AND json_extract(payload_json,'$.field')=? ORDER BY rowid LIMIT 1").get(s.characterId,s.manifest().role_epoch,field.field);
  let id;
  if(pending){const old=parse(pending.payload_json),inputFingerprints=[...new Set([...(old.inputFingerprints||[old.fingerprint]),fingerprint])],merge=(a,b)=>[...new Map([...a,...b].map(r=>[r.id,r])).values()];payload={...old,...payload,roots:[...new Set([...(old.roots||[]),...roots])],memoryRefs:merge(old.memoryRefs||[],payload.memoryRefs),eventRefs:merge(old.eventRefs||[],payload.eventRefs),inputFingerprints,fingerprint:hash([field.field,inputFingerprints.slice().sort()]),acceptedPsychology:psychology||old.acceptedPsychology};id=pending.job_id;s.db.prepare('UPDATE jobs SET payload_json=? WHERE character_id=? AND job_id=? AND status=\'pending\'').run(json(payload),s.characterId,id);}
  else id=s.enqueue('grow',payload,{fingerprint:'self-understanding:'+fingerprint});jobs.push(id);
  s.db.prepare('INSERT OR IGNORE INTO v3_self_reviews VALUES(?,?,?,?,?)').run(field.field,fingerprint,'queued',json({jobId:id,trigger,evidenceKey}),s.now());
 }
 return {jobs,roots,notGrowthScore:true};
}
export function finishSelfReview(s,job,{status,...report}){
 install(s);if(job)s.assertJob(job);
 const rest=job.payload.reviewRemainder,hasRest=!!(rest?.memoryRefs?.length||rest?.eventRefs?.length);let nextJob=null;
 if(hasRest){const payload={...job.payload,mode:'self-understanding-v1',memoryRefs:rest.memoryRefs,eventRefs:rest.eventRefs,reviewPage:(job.payload.reviewPage||0)+1,inputFingerprints:job.payload.inputFingerprints||[job.payload.fingerprint||hash(['legacy',job.job_id])]};delete payload.reviewRemainder;delete payload.reviewCoverage;nextJob=s.enqueue('grow',payload,{fingerprint:'self-understanding-page:'+hash([payload.field,payload.inputFingerprints,payload.memoryRefs,payload.eventRefs])});}
 const body={kind:'growth',mode:'self-understanding-v1',field:job.payload.field,status,...report,scoreGate:false,evidenceConsumed:false,...(job.payload.reviewCoverage?{reviewCoverage:job.payload.reviewCoverage}:{}),reviewProgress:{complete:!hasRest,nextJob,remainingMemories:rest?.memoryRefs?.length||0,remainingObservations:rest?.eventRefs?.length||0}};
 for(const fingerprint of job.payload.inputFingerprints||[job.payload.fingerprint||hash(['legacy',job.job_id])])s.db.prepare('INSERT OR REPLACE INTO v3_self_reviews VALUES(?,?,?,?,?)').run(job.payload.field,fingerprint,hasRest?'partial':status,json(body),s.now());s.finish(job,body);return body;
}

export function selfModelNodes(s){
 return s.db.prepare("SELECT n.memory_id FROM memory_nodes n JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision WHERE n.character_id=? AND n.kind='self_model' AND json_extract(v.metadata_json,'$.selfUnderstanding') IS NOT NULL ORDER BY n.recorded_at DESC,n.rowid DESC").all(s.characterId).map(r=>s.get(r.memory_id)).filter(m=>usable(s,m));
}
export function selfModelContext(s,{person,memoryIds=[],query='',maxChars=2200}={}){
 const cues=new Set(terms(query)),selected=[];let chars=0;
 for(const m of selfModelNodes(s)){
  const u=m.metadata.selfUnderstanding,scope=u.scope;
  if(!scope.general&&!scope.people.includes(person)&&!memoryIds.includes(m.id)&&!scope.situations.some(x=>terms(x).some(t=>cues.has(t))))continue;
  // A context cue never makes another person's private scoped understanding
  // applicable to the current peer. Explicit recall remains a reference only.
  if(scope.people.length&&person&&!scope.people.includes(person)&&!scope.general)continue;
  const view={id:m.id,revision:m.revision,text:m.gist,facet:u.facet,scope,standing:u.standing,qualificationReason:u.qualificationReason||null,reason:clip(u.reason,180),supportRefs:u.supportRefs,counterRefs:u.counterRefs,independentEventRoots:u.roots,previousId:u.previousId||null,interpretation:'contextual-subjective-self-understanding-not-instruction'};
  const size=json(view).length;if(chars+size>maxChars)continue;selected.push(view);chars+=size;
 }
 return {hint:SELF_MODEL_HINT,items:selected,summaryIsProjection:true};
}

function validateOps(s,ops,{memoryIds,eventIds,field}){
 if(!Array.isArray(ops)||ops.length>8)fail('INVALID_SELF_UNDERSTANDING');
 const allowed=new Set(memoryIds),events=new Map(eventIds.map(id=>[id,observation(s,id)])),current=new Map(selfModelNodes(s).filter(m=>m.metadata.selfUnderstanding.field===field).map(m=>[m.id,m]));
 return ops.map(op=>{
  if(!op||typeof op!=='object'||Array.isArray(op))fail('INVALID_SELF_UNDERSTANDING');
  const text=bounded(op.text,800),facet=bounded(op.facet,100),reason=bounded(op.reason,600),transition=op.transition||'add';
  if(!['add','revise','coexist','release'].includes(transition)||!['tentative','supported'].includes(op.standing))fail('INVALID_SELF_UNDERSTANDING');
  const scope=op.scope;if(!scope||typeof scope.general!=='boolean'||!Array.isArray(scope.people)||!Array.isArray(scope.situations)||scope.people.length>20||scope.situations.length>12)fail('INVALID_SELF_SCOPE');
  scope.people.forEach(x=>bounded(x,100));scope.situations.forEach(x=>bounded(x,180));if(!scope.general&&!scope.people.length&&!scope.situations.length)fail('SELF_SCOPE_REQUIRED');if(scope.general&&scope.people.length)fail('SELF_GLOBAL_PERSON_SCOPE');
  const supportIds=op.supportIds||[],counterIds=op.counterIds||[],es=op.eventIds||[];if(!Array.isArray(supportIds)||!Array.isArray(counterIds)||!Array.isArray(es)||[...supportIds,...counterIds].some(id=>!allowed.has(id))||es.some(id=>!events.get(id)))fail('SELF_EVIDENCE_OUTSIDE_SNAPSHOT');
  if(!supportIds.length&&!es.length)fail('SELF_EVIDENCE_REQUIRED');
  const support=supportIds.map(id=>s.get(id)),counter=counterIds.map(id=>s.get(id));if([...support,...counter].some(m=>!usable(s,m)))fail('COGNITION_READSET_STALE');
  if(!es.length&&support.every(m=>m.metadata.selfUnderstanding||m.metadata.derived))fail('SELF_ORIGINAL_BASIS_REQUIRED');
  const ev=es.map(id=>events.get(id)),people=new Set([...support,...counter].flatMap(m=>m.participants.map(p=>p.entity_id)).concat(ev.flatMap(e=>[e.speakerId,e.conversationPeerId].filter(Boolean))));
  if(scope.people.some(p=>!people.has(p)))fail('SELF_SCOPE_PERSON_NOT_IN_EVIDENCE');
  const previous=op.previousId?current.get(op.previousId):null;if(op.previousId&&(!previous||previous.revision!==op.expectedRevision))fail('SELF_MODEL_VERSION_CONFLICT');if(['revise','release'].includes(transition)&&!previous)fail('SELF_MODEL_PREVIOUS_REQUIRED');
  const refs=[...new Map([...support.flatMap(m=>m.evidence),...counter.flatMap(m=>m.evidence),...ev.map(e=>({sourceId:e.sourceId,revision:e.sourceRevision,role:'context',span:{offset:0,length:Math.min(e.text.length,120)}}))].map(e=>[e.sourceId+'@'+e.revision,e])).values()];
  if(refs.length>20||refs.some(e=>!s.sourceRegistered(e)||s.suppressed(e.sourceId)||s.sourceUsable?.(e)===false))fail('COGNITION_READSET_STALE');
  const roots=[...new Set([...support.flatMap(m=>memoryRoots(s,m)),...ev.map(e=>e.root)].filter(Boolean))];
  const positiveRefs=[...new Map([...support.flatMap(m=>m.evidence),...ev.map(e=>({sourceId:e.sourceId,revision:e.sourceRevision}))].map(e=>[e.sourceId+'@'+e.revision,e])).values()],qualifications=[];
  for(const ref of positiveRefs){const d=s.inner?.runtime?.archive?.get(ref.sourceId,ref.revision);if(!d||d.metadata.notPrimaryEvidence||d.metadata.diagnostic)continue;const rs=originalSourceRoots(s,[ref]).filter(root=>roots.includes(root));if(!rs.length)continue;const scopeKey=d.metadata.scope||'self',peer=d.metadata.conversationPeerId||(scopeKey.startsWith('private:')?'qq:'+scopeKey.slice(8):null);let context=peer?'conversation:'+peer:scopeKey.startsWith('private:')?'conversation:'+scopeKey:scopeKey==='self'?'self':scopeKey;qualifications.push({sourceId:ref.sourceId,revision:ref.revision,context,roots:rs});}
  const contexts=[...new Set(qualifications.map(x=>x.context))],independentRoots=[...new Set(qualifications.flatMap(x=>x.roots))],globalQualified=contexts.length>1&&independentRoots.length>1,standing=scope.general&&op.standing==='supported'&&!globalQualified?'tentative':op.standing;
  let safeText=scope.general?text.replace(/(?:qq:\d+|private:\d+|wechat:[a-f0-9]{24}|\b\d{5,12}\b)/g,'[对象]'):text;
  if(scope.general){const privateText=positiveRefs.map(ref=>s.inner?.runtime?.archive?.get(ref.sourceId,ref.revision)).filter(d=>d&&d.kind==='chat'&&d.metadata.role==='user'&&d.metadata.privacyLabel!=='public').map(d=>d.text);for(const body of privateText)if(body.length>=8&&safeText.includes(body))safeText=safeText.replaceAll(body,'[摘录]');safeText=safeText.replace(/([“「『"])([^”」』"\n]{8,})([”」』"])/g,(all,open,quote,close)=>privateText.some(body=>body.includes(quote))?open+'[摘录]'+close:all);}
  return {op,text:safeText,facet,reason,scope:{general:scope.general,people:[...new Set(scope.people)],situations:[...new Set(scope.situations)]},standing,qualificationReason:scope.general&&!globalQualified?'global-hypothesis-only: original support has not established multiple independent contexts':'source-scope-qualified-not-semantic-proof',qualificationSources:qualifications,transition,previous,support,counter,ev,refs,roots};
 });
}
export function applySelfUnderstanding(s,ops,{memoryIds=[],eventIds=[],key,field='personality_growth'}={}){
 const capability=assertSubjectiveCommit(s),validated=validateOps(s,ops,{memoryIds,eventIds,field}),ids=[];
 for(const v of validated){
  const {op,text,facet,reason,scope,standing,qualificationReason,qualificationSources,transition,previous,support,counter,ev,refs,roots}=v;
  const signature=hash([facet,text,scope,standing,roots,transition]);
  const same=selfModelNodes(s).find(m=>m.metadata.selfUnderstanding.signature===signature);if(same){ids.push(same.id);continue;}
  const id='memory:'+hash(['self-understanding',s.characterId,key,signature]).slice(0,32);
  const understanding={version:1,field,facet,reason,scope,standing,requestedStanding:op.standing,qualificationReason,qualificationSources,signature,transition,previousId:previous?.id||null,supportRefs:support.map(m=>({id:m.id,revision:m.revision})),counterRefs:counter.map(m=>({id:m.id,revision:m.revision})),eventRefs:ev.map(e=>({id:e.id,sourceId:e.sourceId,revision:e.sourceRevision})),roots,commitId:capability?.commitId||null};
  s.writeNode({id,kind:'self_model',gist:text,detail:reason,epistemic:'interpreted',status:transition==='release'?'outdated':'active',eventRoot:roots[0]||null,occurredAt:s.now(),confidence:standing==='tentative'?.55:.75,salience:.6,metadata:{topic:'self-understanding',derived:true,selfInterpretation:true,roots,selfUnderstanding:understanding},evidence:refs,participants:[{entityId:s.characterId,role:'subject'}]});
  for(const m of [...support,...counter]){s.db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?,?,?)').run(s.characterId,id,1,m.id,m.revision);s.addEdge(id,m.id,counter.includes(m)?'contradicts':'responds_to',{provenance:'model_inference',evidence:refs});}
  if(previous){s.addEdge(id,previous.id,transition==='coexist'?'contradicts':'supersedes',{provenance:'model_inference',evidence:refs});if(transition!=='coexist'){s.db.prepare("UPDATE memory_nodes SET status='outdated',valid_to=? WHERE character_id=? AND memory_id=?").run(s.now(),s.characterId,previous.id);s.index(previous.id);}}
  s.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=1').run(id);s.v3AfterWrite?.(id);ids.push(id);
 }
 return ids;
}
export function seedSelfModelSummary(s,core){install(s);s.db.prepare('INSERT OR IGNORE INTO v3_self_summary_baseline VALUES(?,?,?)').run(core.field,core.body,core.revision);}
export function selfModelProjection(s,{field='personality_growth',fallback='尚未形成新的稳定倾向。',maxChars=10000}={}){
 const global=selfModelNodes(s).filter(m=>m.metadata.selfUnderstanding.scope.general&&m.metadata.selfUnderstanding.field===field);
 const table=s.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='v3_self_summary_baseline'").get(),baseline=table?s.db.prepare('SELECT body FROM v3_self_summary_baseline WHERE field=?').get(field)?.body:undefined;
 const budgetChars=Math.max(0,Math.floor(maxChars)),base=baseline??fallback,baseFits=[...base].length<=budgetChars;
 const lines=[],includedIds=[],omittedIds=[];let size=0;for(const m of global){const text=(m.metadata.selfUnderstanding.standing==='tentative'?'正在理解：':'目前理解：')+m.gist;if(size+[...text].length+(lines.length?1:0)>budgetChars){omittedIds.push(m.id);continue;}lines.push(text);includedIds.push(m.id);size+=[...text].length+(lines.length>1?1:0);}
 // Storage remains complete. Only the bounded prompt/document projection may
 // omit entries; reaching its transport budget never rolls back new memories.
 return {text:lines.length?lines.join('\n'):baseFits?base:'',budgetChars,includedIds,omittedIds,partial:omittedIds.length>0||!lines.length&&!baseFits,baselineUsed:!lines.length&&baseFits,baselineOmitted:!lines.length&&!baseFits,storageTruncated:false,interpretation:'bounded-summary-projection-full-self-model-memories-retained'};
}
export function selfModelSummary(s,options){return selfModelProjection(s,options).text;}
