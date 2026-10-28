import {modelMemoryView} from './model-view.js';
import {tuningFor} from '../runtime-tuning.js';
import {hash,assertSignal} from './contracts.js';

// Similarity proposes candidates; only source-grounded adjudication can change facts.
export const LINK_VERSION='hybrid-temporal-v2';
export class MemoryLinks {
  constructor(runtime){this.r=runtime;this.s=runtime.store;this.db=this.s.db;this.db.exec('CREATE TABLE IF NOT EXISTS v3_link_coverage(memory_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,reviewed_at INTEGER NOT NULL)');if(!this.db.prepare('PRAGMA table_info(v3_link_coverage)').all().some(c=>c.name==='algorithm'))this.db.exec("ALTER TABLE v3_link_coverage ADD COLUMN algorithm TEXT NOT NULL DEFAULT 'links-v1'");}
  schedule(ids){
    if(this.db.prepare("SELECT 1 FROM jobs WHERE kind='link-v3' AND status IN ('pending','running')").get())return;
    const nodes=(ids?ids.map(id=>this.s.get(id)):this.db.prepare(`SELECT n.memory_id FROM memory_nodes n LEFT JOIN v3_link_coverage c USING(memory_id) WHERE n.character_id=? AND n.status='active' AND (c.revision IS NULL OR c.revision<>n.current_revision OR c.algorithm<>?) AND NOT EXISTS(SELECT 1 FROM jobs j,json_each(j.payload_json,'$.nodes') x WHERE j.kind='link-v3' AND j.status='failed' AND json_extract(j.payload_json,'$.algorithm')=? AND json_extract(x.value,'$.id')=n.memory_id AND json_extract(x.value,'$.revision')=n.current_revision) ORDER BY n.recorded_at DESC LIMIT 4`).all(this.r.characterId,LINK_VERSION,LINK_VERSION).map(x=>this.s.get(x.memory_id))).filter(Boolean).slice(0,4);
    if(nodes.length)this.s.enqueue('link-v3',{algorithm:LINK_VERSION,nodes:nodes.map(m=>({id:m.id,revision:m.revision}))},{fingerprint:'link-v3:'+hash([LINK_VERSION,nodes.map(m=>[m.id,m.revision])])});
  }
  candidates(m){
    const ids=new Set(),add=rows=>{for(const x of rows)if(x.id!==m.id&&this.s.get(x.id)?.status==='active')ids.add(x.id);};
    // Current valid assertions get their own quota before semantic or person candidates.
    if(m.assertion?.subjectId)add(this.db.prepare(`SELECT a.memory_id id FROM assertions a JOIN memory_nodes n USING(character_id,memory_id) WHERE a.character_id=? AND a.subject_id=? AND a.speaker_id IS ? AND a.target_id IS ? AND a.predicate=? AND a.memory_id<>? AND n.status='active' ORDER BY CASE WHEN n.valid_to IS NULL OR n.valid_to>? THEN 0 ELSE 1 END,coalesce(n.valid_from,n.occurred_at,n.recorded_at) DESC,n.memory_id LIMIT 4`).all(this.r.characterId,m.assertion.subjectId,m.assertion.speakerId??null,m.assertion.targetId??null,m.assertion.predicate,m.id,this.r.now()));
    try{add(this.s.lexical(m.gist+' '+(m.metadata.topic||'')+' '+(Array.isArray(m.metadata.tags)?m.metadata.tags:[]).join(' '),10).filter(x=>x.id!==m.id).slice(0,4));}catch(error){if(error.code!=='ERR_SQLITE_ERROR')throw error;}
    if(m.metadata.topic)add(this.db.prepare(`SELECT n.memory_id id FROM memory_nodes n JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision WHERE n.character_id=? AND n.status='active' AND n.memory_id<>? AND json_extract(v.metadata_json,'$.topic')=? ORDER BY coalesce(n.occurred_at,n.recorded_at) DESC LIMIT 2`).all(this.r.characterId,m.id,m.metadata.topic));
    for(const p of m.participants.slice(0,2))add(this.db.prepare(`SELECT e.memory_id id FROM memory_entities e JOIN memory_nodes n USING(character_id,memory_id) WHERE e.character_id=? AND e.entity_id=? AND e.memory_id<>? AND n.status='active' ORDER BY coalesce(n.occurred_at,n.recorded_at) DESC LIMIT 3`).all(this.r.characterId,p.entity_id,m.id));
    return [...ids].map(id=>this.s.get(id)).filter(Boolean).slice(0,12);
  }
  async collectCandidates(m,signal){const base=this.candidates(m);if(!this.r.retriever.embedding)return base;try{const hits=await this.r.retriever.vector(m.gist.slice(0,500),{signal,limit:8}),extra=hits.map(x=>this.s.get(x.id)).filter(x=>x&&x.id!==m.id&&x.status==='active'&&!base.some(b=>b.id===x.id));return [...base.slice(0,9),...extra.slice(0,3),...base.slice(9)].slice(0,12);}catch(error){assertSignal(signal);return base;}}
  material(m){return {id:m.id,revision:m.revision,gist:m.gist.slice(0,tuningFor(this.r).text.memoryGistChars),assertion:modelMemoryView(m,{runtimeTuning:this.r.runtimeTuning}).assertion,occurredAt:m.occurred_at,validFrom:m.valid_from,validTo:m.valid_to,epistemic:m.epistemic,evidence:m.evidence.filter(e=>e.role!=='context').slice(0,2).map(e=>{const d=this.r.archive.get(e.sourceId,e.revision);return {sourceId:e.sourceId,revision:e.revision,speakerId:d.metadata.forwardedAuthorId||d.metadata.speakerId,text:d.text.slice(e.span.offset,e.span.offset+Math.min(e.span.length,480)),partial:e.span.length>480};})};}
  async process(job,signal){
    let linked=0;
    for(const ref of job.payload.nodes){const m=this.s.get(ref.id);if(!m||m.status!=='active'||m.revision!==ref.revision)continue;const candidates=await this.collectCandidates(m,signal);
      let verdict={links:[]};if(candidates.length)verdict=await this.r.model.run('memory-links','只核对给定原文的关系，不输出推理。返回 {links:[{id:候选记忆id,relation:"semantic|supports|responds_to|supersedes|contradicts|same_claim|causes",quote:新记忆证据逐字子串,otherQuote:候选证据逐字子串}]}，最多3条。same_claim仅用于完全相同的知识或普通陈述被独立证据再次支持，语义/主体/适用条件均一致；同主题不等于同一知识，事件、感受、承诺均不合并。causes仅在角色明确体验原文把旧资料说明为原因时使用，quote必须同时包含明确因果词和otherQuote；否定、猜测或同主题均不够。相同人物不是语义关联。supersedes只用于同一事实后来明确改变；contradicts只用于同一主体同一事实的明确纠错；不同时间的普通经历、不同人的承诺不能互相替代。宁可不关联。历史补录不代表新发生。',{current:this.material(m),candidates:candidates.map(x=>this.material(x))},signal);assertSignal(signal);
      this.s.atomic('v3-links-reviewed',()=>{this.s.assertJob(job);if(this.s.get(m.id)?.revision!==ref.revision)return {affected:[]};
        for(const link of (Array.isArray(verdict.links)?verdict.links:[]).slice(0,3)){const old=candidates.find(x=>x.id===link.id);if(!old||this.s.get(old.id)?.revision!==old.revision||typeof link.quote!=='string'||!link.quote.trim()||typeof link.otherQuote!=='string'||!link.otherQuote.trim())continue;
          if(!this.material(m).evidence.some(e=>e.text.includes(link.quote))||!this.material(old).evidence.some(e=>e.text.includes(link.otherQuote)))continue;
          if(link.relation==='causes'){
            const literal=this.material(m).evidence.map(e=>e.text).join(' '),basis=m.evidence.filter(e=>e.role==='context');
            if(m.kind!=='experience'||!basis.some(e=>old.evidence.some(o=>o.role!=='context'&&o.sourceId===e.sourceId&&o.revision===e.revision))||!/(?:因为|由于|导致|因此|所以|让我|使我)/.test(link.quote)||!link.quote.includes(link.otherQuote)||/(?:不是因为|并非|并不是|没有导致|未导致|无关|不一定|可能因为|也许)/.test(literal)||(old.occurred_at??Infinity)>(m.occurred_at??-Infinity))continue;
            this.s.addEdge(old.id,m.id,'causes',{provenance:'explicit_evidence',confidence:.55,evidence:[...m.evidence,...old.evidence]});
          }else if(link.relation==='same_claim'){
            if(old.kind!==m.kind||!['knowledge','procedure','assertion'].includes(m.kind)||old.metadata.duplicateOf||m.metadata.duplicateOf)continue;
            try{this.r.lifecycle.attachEvidence(old.id,m.id,{verified:true});}catch(error){if(!['INVALID_EVIDENCE_ATTACHMENT','EVIDENCE_ATTACHMENT_CAPACITY'].includes(error.code))throw error;continue;}
          }else if(['supersedes','contradicts'].includes(link.relation)){
            const a=m.assertion,b=old.assertion;if(!a||!b||!a.subjectId||a.subjectId!==b.subjectId||a.speakerId!==b.speakerId||a.targetId!==b.targetId||a.predicate!==b.predicate||a.speechAct==='joke'||b.speechAct==='joke'||m.occurred_at<=old.occurred_at)continue;
            if(m.status!=='active'||a.speechAct==='question'||a.speechAct==='proposal'||a.speechAct==='promise'||b.speechAct==='promise')continue;
            if(link.relation==='contradicts'&&a.speechAct!=='correction')continue;
            const actual=this.s.get(m.id);if(!actual.metadata.semanticVerified)this.r.lifecycle.revise(actual.id,actual.revision,{metadata:{...actual.metadata,semanticVerified:true}});
            this.r.lifecycle.supersedeWithin(old.id,m.id,{correction:link.relation==='contradicts',validTo:m.valid_from??m.occurred_at});
          }else if(['semantic','supports','responds_to'].includes(link.relation))this.s.addEdge(m.id,old.id,link.relation,{provenance:'model_inference',confidence:.7,evidence:[...m.evidence,...old.evidence]});else continue;linked++;
        }
        this.db.prepare('INSERT OR REPLACE INTO v3_link_coverage(memory_id,revision,reviewed_at,algorithm) VALUES(?,?,?,?)').run(m.id,this.s.get(m.id)?.revision??m.revision,this.r.now(),LINK_VERSION);return {affected:[m.id]};
      });
    }
    return this.s.atomic('v3-links-complete',()=>{const report={kind:'link-v3',linked};this.s.finish(job,report);return {...report,affected:[]};});
  }
}
