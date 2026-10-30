import {randomUUID} from 'node:crypto';
import {bounded,unit,fail,json,parse,hash,entityId} from './contracts.js';
import {advanceEnergy,energyPolicy,arousalHint} from '../energy-policy.js';
import {advanceAppraisal} from '../natural-expression.js';
import {updateCoreLineage} from './core-lineage.js';
import {energyExempt,energyContext} from '../energy-context.js';
import {assertSubjectiveCommit} from './subjective-commit.js';
import {tuningFor} from '../runtime-tuning.js';
import {reviewInputs,enqueueSelfReview,applySelfUnderstanding,selfModelProjection,seedSelfModelSummary,finishSelfReview} from './self-model.js';

const count=s=>[...s].length;
export function editSize(a,b){let start=0;const aa=[...a],bb=[...b];while(start<Math.min(aa.length,bb.length)&&aa[start]===bb[start])start++;let end=0;while(end<Math.min(aa.length,bb.length)-start&&aa.at(-1-end)===bb.at(-1-end))end++;return Math.max(aa.length-start-end,bb.length-start-end);}
export class CharacterPolicy {
  constructor(store){this.store=store;store.db.exec('CREATE TABLE IF NOT EXISTS energy_usage(id TEXT PRIMARY KEY,scope TEXT NOT NULL,kind TEXT NOT NULL,cost REAL NOT NULL,exempt INTEGER NOT NULL,at INTEGER NOT NULL)');}
  core(){return this.store.db.prepare('SELECT * FROM v2_core ORDER BY field').all().map(r=>({...r,evidence:parse(r.evidence),locked:!!r.locked}));}
  seed(fields){const s=this.store;return s.atomic('core-seeded',()=>{
    if(this.core().length)fail('CORE_ALREADY_SEEDED');
    const entries=Object.entries(fields);if(!entries.length||entries.length>30)fail('INVALID_CORE');
    if(entries.reduce((n,[,v])=>n+count(v.text),0)>10000)fail('CORE_BUDGET_EXCEEDED');
    for(const [field,v]of entries){s.db.prepare('INSERT INTO v2_core VALUES(?,?,?,1,?)').run(bounded(field,60),bounded(v.text,10000),v.locked===false?0:1,'[]');s.db.prepare('INSERT INTO v2_core_versions VALUES(?,1,?,?,?)').run(field,v.text,'[]',s.now());}
    return {affected:entries.map(([k])=>'core:'+k)};
  });}
  state(){const s=this.store,old=s.projection('state')||{energy:1,arousal:.5,valence:0,psychological:'',energyUpdatedAt:s.now(),behavior:{kind:'idle'}};return {...old,...(s.inner?s.inner.clock.advance(old,s.now()):advanceEnergy(old,s.now(),energyPolicy(s))),...(old.appraisal?{appraisal:advanceAppraisal(old.appraisal,s.now())}:{})};}
  updateState(patch,{actionId,action='tool',expectedRevision,exempt=false,scope='self',energyCost}={}){const s=this.store;return s.atomic('state-updated',()=>{
    if(expectedRevision!==undefined&&expectedRevision!==(s.projection('state')?.revision||0))fail('STATE_VERSION_CONFLICT');
    if(actionId&&s.db.prepare('SELECT 1 FROM v2_actions WHERE id=?').get(actionId))return null;
    const before=this.state(),next={...before};
    for(const k of ['arousal','energy'])if(patch[k]!==undefined)next[k]=unit(patch[k]);
    if(patch.valence!==undefined)next.valence=Math.max(-1,Math.min(1,Number(patch.valence)||0));
    if(patch.psychological!==undefined)next.psychological=bounded(patch.psychological,tuningFor(s).text.psycheChars,{empty:true});
    if(patch.behavior)next.behavior={kind:bounded(patch.behavior.kind,40),...(patch.behavior.target?{target:entityId(patch.behavior.target)}:{}),...(patch.behavior.energyExempt?{energyExempt:true,energyKind:['rest','sleep','dream'].includes(patch.behavior.energyKind)?patch.behavior.energyKind:'idle'}:{})};
    if(actionId){const free=exempt||energyExempt(),policy=energyPolicy(s),cost=free?0:Math.max(0,Number.isFinite(energyCost)?energyCost*policy.actionCostScale:(policy.actions[action]||0));s.db.prepare('INSERT INTO v2_actions VALUES(?,?,?)').run(actionId,action,s.now());next.energy=Math.max(0,next.energy-cost);s.db.prepare('INSERT INTO energy_usage VALUES(?,?,?,?,?,?)').run(actionId,energyContext().scope||scope,action,cost,free?1:0,s.now());}
    next.energyUpdatedAt=s.now();const dependencies=patch.psychological!==undefined?[]:parse(s.db.prepare("SELECT dependency_ids_json FROM projections WHERE character_id=? AND kind='state' AND target_key='self'").get(s.characterId)?.dependency_ids_json||'[]');s.setProjection('state','self',next,{dependencies});s.inner?.clock.checkpoint(next);return {before,after:next,affected:['state']};
  });}
  relationship(peer){entityId(peer);if(this.store.inner)return {subjectId:this.store.characterId,targetId:peer,attitudes:this.store.dispositions?.rows({kind:'attitude',person:peer}).map(m=>this.store.dispositions.view(m))||[],scoring:false};return this.store.projection('relationship',peer)||{affinity:50,notes:[]};}
  setAffinity(peer,affinity,{evidence=[]}={}){if(this.store.inner)fail('RELATIONSHIP_SCORING_RETIRED');entityId(peer);const n=Number(affinity);if(!Number.isFinite(n)||n<0||n>100)fail('INVALID_AFFINITY');return this.store.atomic('relationship-adjusted',()=>{
    if(evidence.some(id=>!this.store.get(id)))fail('EVIDENCE_UNAVAILABLE');const old=this.relationship(peer);this.store.setProjection('relationship',peer,{...old,affinity:n},{dependencies:evidence});this.syncSocialInterest(peer,n,evidence);return {affected:evidence,peer,affinity:n};
  });}
  replyPlan(peer){const affinity=this.relationship(peer).affinity,state=this.state(),e=state.energy;
    if(this.store.inner)return {energy:e,reasoning:'low',recallDepth:'shallow',memoryBudget:tuningFor(this.store).memory.recallBudgetChars,delayMs:0,mayInitiate:true,arousalHint:arousalHint(state),selection:'model-inner-context',expressionChoice:'根据当前事和想法决定长短、条数或沉默；精力是感受条件，不是表达配额'};
    return {affinity,energy:e,reasoning:affinity>=80?'high':affinity>=50?'medium':'low',recallDepth:affinity>=80?'deep':'shallow',memoryBudget:affinity>=80?6000:affinity>=50?2500:1200,
      maxMessages:Math.max(1,Math.floor((affinity>=80?6:affinity>=50?3:1)*(.2+.8*e))),maxCharsPerMessage:Math.round((affinity<20?8:affinity<50?22:60)*(.35+.65*e)),delayMs:Math.round((100-affinity)*100*(1.5-e)),mayInitiate:affinity>=80&&e>.25,arousalHint:arousalHint(state)};
  }
  expressions(){return {text:'',learned:[],revision:this.store.projection('expressions')?.revision||0,retired:true,archiveOnly:true};}
  setExpressions(){fail('EXPRESSION_LIBRARY_RETIRED','独立口头禅词库已停用；表达反馈保留在记忆中。');}
  learnExpressions(){fail('EXPRESSION_LIBRARY_RETIRED');}
  interests(){if(this.store.inner)return (this.store.dispositions?.rows({kind:'interest'})||[]).map(m=>({id:m.id,name:m.metadata.disposition.target,text:m.gist,reason:m.metadata.disposition.reason,lastSeen:m.occurred_at,evidence:m.evidence,origin:m.metadata.disposition.origin}));return this.store.projection('interests')?.items||[];}
  syncSocialInterest(peer,affinity,evidence=[]){if(this.store.inner)return {retired:true};const name='和 '+peer+' 聊天',items=this.interests().filter(i=>i.name!==name);if(affinity>=80)items.push({name,level:'喜欢',anchored:false,lastSeen:this.store.now(),evidence,roots:[],socialPeer:peer});this.store.setProjection('interests','self',{items},{dependencies:items.flatMap(i=>i.evidence)});}
  maintainInterest({name,evidence=[],anchored=false,reaction='like',note='',at=this.store.now()}){if(this.store.inner)fail('DISPOSITION_MODEL_REQUIRED');bounded(name,100);if(evidence.some(id=>!this.store.get(id)))fail('EVIDENCE_UNAVAILABLE');const s=this.store;return s.atomic('interest-maintained',()=>{
    const items=this.interests(),old=items.find(i=>i.name===name),roots=[...new Set(evidence.flatMap(id=>s.get(id)?.metadata.roots||[s.get(id)?.event_root]).filter(Boolean))];
    const combined=[...new Set([...(old?.roots||[]),...roots])],hits=combined.length,negative=['dislike','bored','disappointed','厌烦','不喜欢'].includes(reaction),opinions={...(old?.opinions||{})};for(const root of roots)opinions[root]=negative?-1:1;const score=Object.values(opinions).reduce((sum,x)=>sum+x,0);
    const item={name,anchored:old?.anchored||anchored,level:anchored||old?.anchored?'无法离开':score<0?'不喜欢':score===0&&negative?'淡忘':score>=6?'非常喜欢':score>=3?'喜欢':'心血来潮',opinions,note:clipInterest(note),reaction,roots:combined,lastSeen:at,evidence:[...new Set([...(old?.evidence||[]),...evidence])]};
    const next=[...items.filter(i=>i.name!==name),item].slice(-100);s.setProjection('interests','self',{items:next},{dependencies:next.flatMap(i=>i.evidence)});return {affected:evidence,item};
  });}
  decayInterests(){if(this.store.inner)return {retired:true,reason:'时间影响可访问程度，不按天数删除或改写兴趣'};const s=this.store;return s.atomic('interests-decayed',()=>{const old=this.interests(),items=old.filter(i=>i.anchored||s.now()-i.lastSeen<90*86400000).map(i=>i.anchored?i:{...i,level:s.now()-i.lastSeen>30*86400000?'淡忘':i.level});s.setProjection('interests','self',{items},{dependencies:items.flatMap(i=>i.evidence)});return {before:old,after:items,affected:items.flatMap(i=>i.evidence)};});}
  registerGrowth(memoryId){const s=this.store,m=s.get(memoryId);
    if(s.inner){const input=reviewInputs(s,{memoryIds:[memoryId]});if(!input.memories.length)return null;const apply=()=>({...enqueueSelfReview(s,input),affected:[memoryId]});return s.db.isTransaction?apply():s.atomic('self-understanding-review-scheduled',apply);}
    if(!m||m.kind!=='experience'||m.metadata.derived) return null;
    const impact=Math.round(100*unit(m.metadata.intensity)*unit(m.metadata.lastingness)*m.confidence),roots=[...new Set(m.metadata.roots||[m.event_root])].filter(Boolean);
    // Summaries/abstracts cannot create fresh independent evidence or multiply an event's impact.
    return s.atomic('growth-evidence-recorded',()=>{for(const root of roots){const old=s.db.prepare('SELECT * FROM v2_growth_events WHERE event_root=?').get(root);if(!old||old.impact<impact)s.db.prepare('INSERT OR REPLACE INTO v2_growth_events VALUES(?,?,?,?)').run(root,impact,s.now(),json([memoryId]));}
      const fields=this.core().filter(c=>!c.locked),scheduled=[];
      for(const field of fields){const unused=this.unusedGrowth(field.field);if(unused.reduce((n,r)=>n+r.impact,0)>=60){const fingerprint=hash([field.field,field.revision,unused.map(r=>r.event_root)]);scheduled.push(s.enqueue('grow',{field:field.field,revision:field.revision,roots:unused.map(r=>r.event_root)},{fingerprint}));}}
      return {impact,scheduled,affected:[memoryId]};});
  }
  unusedGrowth(field){return this.store.db.prepare('SELECT * FROM v2_growth_events e WHERE NOT EXISTS(SELECT 1 FROM v2_growth_uses u WHERE u.field=? AND u.event_root=e.event_root)').all(field).filter(r=>parse(r.evidence).some(id=>this.store.get(id)?.kind==='experience'));}
  growthSnapshot(field,roots){const core=this.core().find(c=>c.field===field);if(!core||core.locked)fail('CORE_FIELD_LOCKED');const allowed=this.unusedGrowth(field).filter(r=>roots.includes(r.event_root));const score=allowed.reduce((n,r)=>n+r.impact,0);return {core,score,events:allowed,evidence:[...new Set(allowed.flatMap(r=>parse(r.evidence)))].map(id=>this.store.get(id)).filter(Boolean)};}
  applyGrowth({field,expectedRevision,text,roots,verified=false,expectedEvidence},{job}={}){const s=this.store;const apply=()=>{
    if(s.inner)fail('SELF_UNDERSTANDING_REVIEW_REQUIRED');
    const innerCommit=assertSubjectiveCommit(s);
    if(job)s.assertJob(job);const snap=this.growthSnapshot(field,roots),old=snap.core;if(old.revision!==expectedRevision)fail('CORE_VERSION_CONFLICT');if(snap.score<60)fail('GROWTH_THRESHOLD_NOT_MET');if(!verified)fail('GROWTH_SEMANTIC_VERIFICATION_REQUIRED');
    if(expectedEvidence?.some(ref=>s.get(ref.id)?.revision!==ref.revision))fail('MEMORY_VERSION_CONFLICT');
    bounded(text,10000);const edit=editSize(old.body,text),allowance=Math.min(50,Math.floor(snap.score/10)*5);if(edit>allowance)fail('GROWTH_EDIT_BUDGET_EXCEEDED');
    const weekly=s.db.prepare('SELECT coalesce(sum(edit_chars),0) AS n FROM v2_growth_changes WHERE at>=?').get(s.now()-7*86400000).n;if(weekly+edit>500)fail('GROWTH_WEEKLY_BUDGET_EXCEEDED');
    if(this.core().reduce((n,c)=>n+count(c.field===field?text:c.body),0)>10000)fail('CORE_BUDGET_EXCEEDED');
    const addedEvidence=[...new Set(snap.evidence.map(m=>m.id))],evidence=s.inner?updateCoreLineage(s,field,old.revision,old.body,text,addedEvidence):[...new Set([...old.evidence,...addedEvidence])];s.db.prepare('UPDATE v2_core SET body=?,revision=revision+1,evidence=? WHERE field=?').run(text,json(evidence),field);
    s.db.prepare('INSERT INTO v2_core_versions VALUES(?,?,?,?,?)').run(field,old.revision+1,text,json(evidence),s.now());
    for(const r of snap.events)s.db.prepare('INSERT OR IGNORE INTO v2_growth_uses VALUES(?,?)').run(field,r.event_root);
    s.db.prepare('INSERT INTO v2_growth_changes VALUES(?,?,?,?)').run(randomUUID(),s.now(),field,edit);
    const binding=innerCommit?{innerCommit:innerCommit.commitId,generation:innerCommit.generation}:{};
    if(job)s.finish(job,{kind:'growth',field,before:old.body,after:text,edit,evidence,score:snap.score,...binding});return {field,before:old.body,after:text,edit,affected:evidence,...binding};
  };return s.db.isTransaction?apply():s.atomic('core-growth-applied',apply);}
  applySelfUnderstanding({field,expectedRevision,ops,memoryIds,eventIds,key,verified=false,expectedEvidence=[]},{job}={}){
    const s=this.store;assertSubjectiveCommit(s);if(job)s.assertJob(job);const old=this.core().find(c=>c.field===field);if(!old||old.locked)fail('CORE_FIELD_LOCKED');if(old.revision!==expectedRevision)fail('CORE_VERSION_CONFLICT');if(!verified)fail('GROWTH_SEMANTIC_VERIFICATION_REQUIRED');
    if(expectedEvidence.some(ref=>s.get(ref.id)?.revision!==ref.revision))fail('MEMORY_VERSION_CONFLICT');
    const maxChars=10000-this.core().filter(c=>c.field!==field).reduce((n,c)=>n+count(c.body),0);if(maxChars<0)fail('CORE_BUDGET_EXCEEDED');seedSelfModelSummary(s,old);const ids=applySelfUnderstanding(s,ops,{memoryIds,eventIds,key,field}),projection=selfModelProjection(s,{field,fallback:old.body,maxChars}),text=projection.text;bounded(text,10000,{empty:true});
    const edit=editSize(old.body,text);if(this.core().reduce((n,c)=>n+count(c.field===field?text:c.body),0)>10000)fail('CORE_BUDGET_EXCEEDED');
    if(edit){const evidence=updateCoreLineage(s,field,old.revision,old.body,text,ids);s.db.prepare('UPDATE v2_core SET body=?,revision=revision+1,evidence=? WHERE field=?').run(text,json(evidence),field);s.db.prepare('INSERT INTO v2_core_versions VALUES(?,?,?,?,?)').run(field,old.revision+1,text,json(evidence),s.now());s.db.prepare('INSERT INTO v2_growth_changes VALUES(?,?,?,?)').run(randomUUID(),s.now(),field,edit);}
    return finishSelfReview(s,job,{status:'applied',before:old.body,after:text,summaryChanged:edit>0,summaryProjection:projection,edit,selfUnderstandingIds:ids,affected:ids});
  }
}

function clipInterest(value){return [...String(value||'')].slice(0,300).join('');}
