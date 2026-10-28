import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';
import {hash,json,parse,assertSignal,fail} from './contracts.js';
import {modelMemoryView,storyAnchors} from './model-view.js';
import {snapshotMemory} from './v3-extraction.js';
import {refreshProjections} from './projections.js';
import {encodeBundle} from './encode.js';
import {validateV3Ownership} from './v3-extraction.js';
import {maskForgottenText} from './forget-mask.js';
import {basisSources} from './basis-sources.js';
import {HISTORY_VERSION} from './v3-history-review.js';
import {correctionTargets,fullyEncoded,settleSourceRepairs} from './source-repair-coverage.js';

// Repair is a durable consumer, not a flag left on an unread queue.
export class MemoryRepair {
  constructor(runtime){this.r=runtime;this.s=runtime.store;this.db=this.s.db;}
  schedule({targets}={}){
    const allowed=targets?new Set(targets):null;if(this.db.prepare("SELECT payload_json FROM jobs WHERE kind='repair-v3' AND status IN ('pending','running')").all().some(j=>!allowed||(parse(j.payload_json).repairs||[]).some(q=>allowed.has(q.kind+'|'+q.target))))return;
    const repairs=this.db.prepare("SELECT * FROM v3_repair_queue WHERE status='pending' ORDER BY rowid").all().filter(q=>!allowed||allowed.has(q.kind+'|'+q.target)).slice(0,4);
    const disputes=this.db.prepare("SELECT id FROM v2_proposals WHERE kind='dispute' AND status='pending' ORDER BY created_at LIMIT 2").all().filter(()=>!allowed);
    if(repairs.length||disputes.length)this.s.enqueue('repair-v3',{repairs,disputes,historical:true},{fingerprint:hash([repairs,disputes,this.s.manifest().cognition_revision])});
  }
  async process(job,signal){
    const repaired=[],reviewed=[],correctionReviews=[];
    for(const item of job.payload.repairs||[]){
      if(item.kind==='psyche'){
        const thread=this.r.inner.psyche.list().find(t=>t.id===item.target);if(!thread){this.db.prepare("UPDATE v3_repair_queue SET status='obsolete' WHERE kind='psyche' AND target=?").run(item.target);continue;}
        const sources=[...new Set([...(thread.reviewSourceIds||[]),...(thread.reviewMemoryIds||[]).flatMap(id=>this.s.get(id,{includeInactive:true})?.evidence.map(e=>e.sourceId)||[])])].filter(id=>{const h=this.db.prepare('SELECT revision FROM v3_source_heads WHERE source_id=?').get(id);try{if(!h)return false;const source=this.r.archive.get(id,h.revision);return source.metadata.notPrimaryEvidence!==true&&!isOperationalMaterial(source);}catch{return false;}});
        const events=sources.flatMap(id=>{const h=this.db.prepare('SELECT revision FROM v3_source_heads WHERE source_id=?').get(id);if(!h)return [];return this.db.prepare('SELECT event_id FROM event_sources WHERE source_id=? AND source_revision=? LIMIT 1').all(id,h.revision).map(e=>e.event_id);}).slice(0,6);
        if(events.length){
          const current=sources.slice(0,6).flatMap(id=>{const h=this.db.prepare('SELECT revision FROM v3_source_heads WHERE source_id=?').get(id);if(!h)return [];try{const d=this.r.archive.get(id,h.revision);return [{sourceId:id,revision:h.revision,speakerId:d.metadata.speakerId,scope:d.metadata.scope,text:d.text.slice(0,800)}];}catch{return [];}});
          const review=this.r.observe({adapter:'inner-evidence-review',externalId:hash([item.target,thread.revision,current.map(d=>[d.sourceId,d.revision])]),kind:'evidence-review',text:'现在重新读到的已更新证据（是资料，不是此刻新来信）：'+json(current),metadata:{speakerId:this.r.characterId,scope:'self',notPrimaryEvidence:true,basisSources:current.map(d=>({sourceId:d.sourceId,revision:d.revision}))}},{kind:'evidence-review',eventRoot:'psyche-review:'+item.target});
          const result=await this.r.inner.reflect({eventIds:[review.eventId,...events].slice(0,8),key:'psyche-repair:'+item.target+':'+thread.revision,kind:'dream',historical:true,basisReview:true,signal,summary:'依据已变化。旧感受当时真实，不等于旧判断如今仍为事实。核对before.psychology中uncertainBasis的线程，允许仍难受或生气，也允许有依据地重新理解，不能用新活动强行覆盖。'});if(result.status==='busy')continue;
        }
        const family=new Set([item.target]),all=this.r.inner.psyche.list({includeInactive:true});let grew=true;while(grew){grew=false;for(const t of all)if(!family.has(t.id)&&(t.mergedFrom||[]).some(id=>family.has(id))){family.add(t.id);grew=true;}}
        for(const after of this.r.inner.psyche.list().filter(t=>family.has(t.id))){const disposition=!events.length?'needs-primary-evidence':after.uncertainBasis?'reviewed-unresolved':'complete';if(after.uncertainBasis)this.r.inner.psyche.write(after.id,{...after,reviewDisposition:disposition},after.status);this.db.prepare("UPDATE v3_repair_queue SET status=? WHERE kind='psyche' AND target=?").run(disposition,after.id);}
        if(!this.r.inner.psyche.list().some(t=>t.id===item.target))this.db.prepare("UPDATE v3_repair_queue SET status='obsolete' WHERE kind='psyche' AND target=?").run(item.target);reviewed.push(item.target);continue;
      }
      assertSignal(signal);const old=this.s.get(item.target,{includeInactive:true});
      if(!old||old.status==='forgotten'){this.db.prepare("UPDATE v3_repair_queue SET status='obsolete' WHERE kind=? AND target=?").run(item.kind,item.target);continue;}
      if(item.reason==='correction-context-unverified'){
        const required=old.evidence.filter(e=>e.role!=='context'),current=required.slice(0,6).map(e=>{const h=this.db.prepare('SELECT revision FROM v3_source_heads WHERE source_id=?').get(e.sourceId);const d=this.r.archive.get(e.sourceId,h?.revision||e.revision);return {sourceId:d.sourceId,revision:d.revision,text:d.text.slice(0,4000),partial:d.text.length>4000,speakerId:d.metadata.speakerId};});
        const verdict=await this.r.model.run('review-correction','核查这条旧提取是否仍被完整的最新资料支持，注意后文的否定、玩笑、撤回与纠错。仅返回 {supported:true|false|null,note:最多400字}，不充分用null，不补造新事实。',{priorInterpretation:{kind:old.kind,gist:old.gist,detail:old.detail},current},signal);assertSignal(signal);if(![true,false,null].includes(verdict.supported)||typeof verdict.note!=='string')fail('INVALID_DISPUTE_VERDICT');
        this.s.atomic('transferred-correction-reviewed',()=>{this.s.assertJob(job);const now=this.s.get(old.id,{includeInactive:true});if(now?.revision!==old.revision)fail('MEMORY_VERSION_CONFLICT');const accepted=verdict.supported===true&&current.length>0&&required.every(e=>current.some(d=>d.sourceId===e.sourceId&&d.revision===e.revision))&&!current.some(d=>d.partial)&&old.evidence.every(e=>this.s.sourceUsable(e));if(accepted)this.r.lifecycle.revise(old.id,old.revision,{status:'active',metadata:{...old.metadata,semanticVerified:true,correctionReviewed:true}});this.db.prepare("UPDATE v3_repair_queue SET status=? WHERE kind='memory' AND target=?").run(accepted||verdict.supported===false?'complete':'reviewed-unresolved',old.id);return {affected:[old.id]};});correctionReviews.push({id:old.id,supported:verdict.supported,note:verdict.note.slice(0,400)});reviewed.push(old.id);continue;
      }
      if(item.reason==='ambiguous-identity'){
        const refs=old.evidence.filter(e=>e.role!=='context'&&this.s.sourceUsable(e)).slice(0,6),versions=this.db.prepare("SELECT DISTINCT gist FROM memory_versions WHERE memory_id=? AND gist<>'' LIMIT 12").all(old.id).map(v=>v.gist);
        const materials=refs.map((e,n)=>{const d=this.r.archive.get(e.sourceId,e.revision),offset=Math.max(0,(e.span?.offset||0)-600);return {ref:'r'+(n+1),sourceId:e.sourceId,revision:e.revision,sourceOffset:offset,text:maskForgottenText(this.s,e.sourceId,e.revision,d.text.slice(offset,offset+2800),offset),outcome:'observed',historical:true,eventRoot:old.event_root,metadata:d.metadata,occurredAt:d.occurred_at,observedAt:d.observed_at,...(n===0?{interpretationsToRecheck:{id:old.id,revision:old.revision,versions,note:'这些是待核对的旧提取文案，不是新证据。原文若有不同事实，按不同facet保留；若只是改写，不制造多个经历。'}}:{})};});
        if(!materials.length){this.db.prepare("UPDATE v3_repair_queue SET status='needs-primary-evidence' WHERE target=?").run(old.id);continue;}
        const encoded=await encodeBundle(this.r.model,materials,signal);assertSignal(signal);validateV3Ownership(encoded,materials);this.s.assertJob(job);
        for(const m of encoded.memories){m.metadata={...m.metadata,historicalReview:true,identityReviewComplete:true};if(m.kind===old.kind&&m.gist===old.gist)m.id=old.id;}
        const result=this.r.commitEncoded(encoded,{job});this.s.atomic('identity-ambiguity-reviewed',()=>{
          const current=this.s.get(old.id,{includeInactive:true});if(current)this.r.lifecycle.revise(old.id,current.revision,{status:encoded.memories.some(m=>m.kind===old.kind&&m.gist===old.gist)?current.status:'candidate',metadata:{...current.metadata,identityReviewComplete:true,replacementIds:result.ids}});
          this.db.prepare("UPDATE v3_repair_queue SET status='complete' WHERE kind='memory' AND target=?").run(old.id);return {affected:[old.id,...result.ids]};
        });return {...result,identityReview:true};
      }
      if(!['partial-forget','parent-revised'].includes(item.reason)){
        const changed=correctionTargets(this.r,old);
        if(changed.length&&changed.every(e=>fullyEncoded(this.r,e))){
          // The latest bytes were already processed in full. Close the work,
          // while keeping the superseded interpretation a candidate.
          this.db.prepare("UPDATE v3_repair_queue SET status='complete' WHERE kind=? AND target=?").run(item.kind,item.target);reviewed.push(item.target);continue;
        }
        // Corrected bytes must be encoded afresh; an old candidate is never
        // promoted by reusing its obsolete quote or by trusting a user report.
        this.r.scheduleEncoding();this.db.prepare('UPDATE v3_repair_queue SET status=? WHERE kind=? AND target=?').run(changed.length?'reextract-scheduled':'needs-primary-evidence',item.kind,item.target);continue;
      }
      const parents=this.db.prepare('SELECT DISTINCT parent_id FROM dependencies WHERE child_id=? AND child_revision=?').all(old.id,old.revision).map(x=>this.s.get(x.parent_id)).filter(x=>x&&x.status==='active'&&memoryLearningEligible(this.r.archive,x));
      if(!parents.length){this.db.prepare("UPDATE v3_repair_queue SET status='no-independent-evidence' WHERE target=?").run(old.id);continue;}
      const result=await this.r.model.run('repair-memory','只根据仍有效的独立证据重建一条解释。旧文本已移除，不补造被删除部分。返回 {gist:最多800字,detail:最多1600字}。不同人的事实保持主体。',{parents:parents.map(modelMemoryView)},signal);assertSignal(signal);
      if(typeof result.gist!=='string'||!result.gist.trim()||[...result.gist].length>800||[...(result.detail||'')].length>1600)fail('INVALID_REPAIR');
      this.s.atomic('partial-memory-rebuilt',()=>{
        this.s.assertJob(job);if(this.s.get(old.id,{includeInactive:true})?.revision!==old.revision||parents.some(p=>this.s.get(p.id)?.revision!==p.revision))fail('MEMORY_VERSION_CONFLICT');
        this.r.lifecycle.revise(old.id,old.revision,{gist:result.gist,detail:result.detail||'',detailState:result.detail?'available':'none',status:'active',metadata:{...old.metadata,repairNeeded:false,storyAnchors:storyAnchors(parents),children:parents.map(p=>p.id)}});
        const refs=[...new Map(parents.flatMap(p=>p.evidence).map(e=>[hash([e.sourceId,e.revision,e.span,e.role]),e])).values()].slice(0,20);
        this.db.prepare('DELETE FROM memory_evidence WHERE memory_id=? AND memory_revision=?').run(old.id,old.revision+1);
        for(const e of refs)this.db.prepare('INSERT INTO memory_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(this.r.characterId,old.id,old.revision+1,e.sourceId,e.revision,hash([e.sourceId,e.revision,e.span,e.role]),json(e.span||{}),e.independenceGroup||e.sourceId,e.role||'supports');
        this.db.prepare('DELETE FROM dependencies WHERE child_id=? AND child_revision=?').run(old.id,old.revision+1);
        for(const p of parents)this.db.prepare('INSERT OR IGNORE INTO dependencies VALUES(?,?,?,?,?)').run(this.r.characterId,old.id,old.revision+1,p.id,p.revision);
        this.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').run(old.id,old.revision+1);this.s.v3AfterWrite?.(old.id);refreshProjections(this.s,[old.id]);this.db.prepare("UPDATE v3_repair_queue SET status='complete' WHERE target=? AND kind='memory'").run(old.id);repaired.push(old.id);return {affected:[old.id]};
      });
    }
    for(const ref of job.payload.disputes||[]){
      const proposal=this.db.prepare("SELECT * FROM v2_proposals WHERE id=? AND status='pending'").get(ref.id);if(!proposal)continue;
      const dispute=parse(proposal.body),m=this.s.get(dispute.memoryId);if(!m){this.db.prepare("UPDATE v2_proposals SET status='obsolete' WHERE id=?").run(ref.id);continue;}
      const evidence=m.evidence.slice(0,6).map(e=>{const d=this.r.archive.get(e.sourceId,e.revision);return {sourceId:e.sourceId,revision:e.revision,text:e.span?.length?d.text.slice(e.span.offset,e.span.offset+Math.min(e.span.length,1000)):d.text.slice(0,1000),speakerId:d.metadata.speakerId};});
      const verdict=await this.r.model.run('review-dispute','用户反馈是待核查意见，不是事实。仅核查给定原文是否支持当前记忆。返回 {supported:true|false|null,note:最多400字}；证据不充分用null。不得从反馈补造替代事实。',{memory:modelMemoryView(m,{runtimeTuning:this.r.runtimeTuning}),dispute,evidence},signal);assertSignal(signal);
      if(![true,false,null].includes(verdict.supported)||typeof verdict.note!=='string')fail('INVALID_DISPUTE_VERDICT');
      this.s.atomic('memory-dispute-reviewed',()=>{this.s.assertJob(job);if(this.s.get(m.id)?.revision!==m.revision)fail('MEMORY_VERSION_CONFLICT');
        if(verdict.supported!==true){this.r.lifecycle.revise(m.id,m.revision,{status:'contested'});this.r.inner.invalidateMemories([m.id]);}
        this.db.prepare('UPDATE v2_proposals SET status=?,body=? WHERE id=?').run(verdict.supported===true?'not-supported-by-evidence':verdict.supported===false?'confirmed-dispute':'needs-evidence',json({...dispute,verdict:{supported:verdict.supported,note:verdict.note.slice(0,400)}}),ref.id);reviewed.push(ref.id);return {affected:[m.id]};
      });
    }
    settleSourceRepairs(this.r);
    return this.s.atomic('memory-repair-complete',()=>{const report={kind:'repair-v3',repaired,reviewed,correctionReviews};this.s.finish(job,report);return {...report,affected:repaired};});
  }
}
