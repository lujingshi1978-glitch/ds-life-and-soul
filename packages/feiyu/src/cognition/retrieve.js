import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';
import {vectorSearch} from './vector-search.js';
import {Worker} from 'node:worker_threads';
import {hash,json,parse,terms,entityId,unit,fail,assertSignal,clip} from './contracts.js';
import {expressionFeedbackApplies,selfUnderstandingApplies} from './memory-activation.js';
import {associativeRecall} from './v3-recall.js';
import {memoryEvidenceOrigin} from './evidence-origin.js';
import {selfUnderstandingModelView} from './model-view.js';
import {tuningFor} from '../runtime-tuning.js';

async function deadline(work,ms,signal){
  const abort=new AbortController(),combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
  let listener;const timer=setTimeout(()=>abort.abort(new Error('RETRIEVAL_DEADLINE')),ms);timer.unref?.();
  const cancelled=new Promise((_,reject)=>{listener=()=>reject(combined.reason||new Error('Aborted'));combined.addEventListener('abort',listener,{once:true});});
  try{assertSignal(combined);const r=await Promise.race([Promise.resolve().then(()=>work(combined)),cancelled]);assertSignal(combined);return r;}finally{clearTimeout(timer);combined.removeEventListener('abort',listener);}
}
function matchTime(m,from,to,at){if(from!=null&&(m.occurred_at??m.recorded_at)<from)return false;if(to!=null&&(m.occurred_at??m.recorded_at)>to)return false;if(at!=null&&((m.valid_from!=null&&m.valid_from>at)||(m.valid_to!=null&&m.valid_to<=at)))return false;return true;}
function similarity(a,b){const aa=new Set(terms(a.gist)),bb=new Set(terms(b.gist));return [...aa].filter(x=>bb.has(x)).length/Math.max(1,Math.sqrt(aa.size*bb.size));}

export class MemoryRetriever {
  constructor(store,{model,embedding,allowExternalEmbeddings=false,now=Date.now,runtimeTuning=store?.runtimeTuning}={}){Object.assign(this,{store,model,embedding,allowExternalEmbeddings,now,runtimeTuning});this.cache=new Map();}
  eligible(memory){return memoryLearningEligible(this.store.inner?.runtime?.archive||this.archive,memory);}
  async embed(texts,{privateData=true,signal,purpose='search'}={}){
    const e=this.embedding;if(!e)fail('EMBEDDING_NOT_CONFIGURED');
    if(e.remote===true&&privateData&&!this.allowExternalEmbeddings)fail('EXTERNAL_EMBEDDING_NOT_ALLOWED');
    const vectors=await deadline(s=>e.embed(texts,{signal:s,purpose}),purpose==='search'?(e.searchTimeoutMs??700):(e.indexTimeoutMs??15000),signal);
    if(!Array.isArray(vectors)||vectors.length!==texts.length||vectors.some(v=>!Array.isArray(v)||v.length!==e.dimensions||v.some(n=>!Number.isFinite(n))))fail('INVALID_EMBEDDING');return vectors;
  }
  async index(ids,{signal}={}){
    if(!this.embedding)return {indexed:0,degraded:'embedding-not-configured'};
    const current=this.store.db.prepare('SELECT revision,content_hash,vector FROM v2_vectors WHERE memory_id=? AND model=?');
    const rows=[...new Set(ids)].map(id=>this.store.get(id)).filter(Boolean).filter(m=>{const old=current.get(m.id,this.embedding.modelId);if(!old||old.revision!==m.revision||old.content_hash!==m.contentHash)return true;const vector=parse(old.vector);return !Array.isArray(vector)||vector.length!==this.embedding.dimensions||!vector.every(Number.isFinite);});let indexed=0;
    const batchSize=Math.max(1,Math.min(12,this.embedding.batchSize??12));
    for(let i=0;i<rows.length;i+=batchSize){const batch=rows.slice(i,i+batchSize),vectors=await this.embed(batch.map(m=>m.gist+' '+m.detail),{privateData:batch.some(m=>!m.metadata.publicEvidence),signal,purpose:'index'});assertSignal(signal);
      this.store.atomic('vectors-indexed',()=>{for(const [n,m]of batch.entries()){
        const live=this.store.get(m.id);if(!live||live.revision!==m.revision)continue;
        this.store.db.prepare('INSERT OR REPLACE INTO v2_vectors VALUES(?,?,?,?,?)').run(m.id,m.revision,this.embedding.modelId,json(vectors[n]),m.contentHash);
        this.store.db.prepare('INSERT OR REPLACE INTO embedding_registry VALUES(?,?,?,?,?,?,?,?)').run(this.store.characterId,m.id,m.revision,this.embedding.modelId,this.embedding.dimensions,'gist-detail-v1',m.contentHash,'v2_vectors');indexed++;
      }return {affected:batch.map(m=>m.id)};});
    }return {indexed};
  }
  async vector(query,{signal,limit=30,queryVector}={}){
    const v=queryVector||(await this.embed([query],{signal}))[0];
    if(this.store.databaseFile){const hits=await vectorSearch(this.store,v,{embedding:this.embedding,arm:'base',limit,signal});assertSignal(signal);return hits.filter(h=>{const m=this.store.get(h.id);return m?.revision===h.revision&&m.contentHash===h.contentHash;}).map(({id,score})=>({id,score}));}
    const candidates=this.store.inner?this.store.db.prepare(`SELECT e.* FROM v2_vectors e JOIN memory_nodes n ON n.memory_id=e.memory_id AND n.current_revision=e.revision JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision AND v.content_hash=e.content_hash WHERE e.model=? AND n.character_id=? AND n.status IN ('active','contested','outdated','faded') AND NOT EXISTS(SELECT 1 FROM suppression x WHERE x.character_id=n.character_id AND x.target_type='memory' AND x.target_id=n.memory_id) AND NOT EXISTS(SELECT 1 FROM memory_evidence me JOIN suppression x ON x.character_id=n.character_id AND x.target_type='source' AND x.target_id=me.source_id WHERE me.character_id=n.character_id AND me.memory_id=n.memory_id AND me.memory_revision=n.current_revision) LIMIT 50000`).all(this.embedding.modelId,this.store.characterId):this.store.db.prepare('SELECT * FROM v2_vectors WHERE model=? LIMIT 50000').all(this.embedding.modelId).filter(r=>{const m=this.store.get(r.memory_id);return m?.revision===r.revision&&m.contentHash===r.content_hash;});const rows=candidates.map(r=>({id:r.memory_id,vector:parse(r.vector)})).filter(r=>Array.isArray(r.vector)&&r.vector.length===this.embedding.dimensions&&r.vector.every(Number.isFinite));
    if(!rows.length)return [];
    return deadline(s=>new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./vector-worker.js',import.meta.url),{execArgv:[],workerData:{rows,query:v,limit,threshold:this.embedding.similarityThreshold??.35}});
      const stop=()=>{void worker.terminate();reject(s.reason||new Error('Aborted'));};s.addEventListener('abort',stop,{once:true});
      worker.once('message',r=>{s.removeEventListener('abort',stop);resolve(r);});worker.once('error',e=>{s.removeEventListener('abort',stop);reject(e);});
    }),700,signal);
  }
  graph(seeds,{relations,maxVisited=80,maxHops=2}={}){
    const seen=new Set(),out=[],queue=seeds.map(m=>({m,hop:0}));
    while(queue.length&&seen.size<maxVisited){const {m,hop}=queue.shift();if(seen.has(m.id))continue;seen.add(m.id);if(hop)out.push(m);if(hop>=maxHops)continue;
      const edges=this.store.edges(m.id).filter(e=>!relations||relations.includes(e.relation));
      const neighbors=[...edges.map(e=>this.store.get(e.from_id===m.id?e.to_id:e.from_id)),...this.store.members(m.id)].filter(Boolean);
      for(const n of neighbors)if(!seen.has(n.id))queue.push({m:n,hop:hop+1});
    }return out;
  }
  pack(rows,{budgetChars=tuningFor(this).memory.recallBudgetChars,entities,depth='shallow',compact=false,currentInterestsOnly=false,expressionScope,query=''}={}){
    const tuning=tuningFor(this),bundles=[],used=new Set();let chars=0,budgetOmissions=0;
    for(const row of rows){const original=this.store.get(row.id);if(!original||original.revision!==row.revision)continue;const live=original.metadata.duplicateOf?this.store.get(original.metadata.duplicateOf):original;if(!live||!this.eligible(live)||expressionScope&&(!expressionFeedbackApplies(live,expressionScope)||!selfUnderstandingApplies(live,{expressionScope,query}))||used.has(live.id)||currentInterestsOnly&&live.metadata.disposition?.kind==='interest'&&['outdated','candidate'].includes(live.status))continue;
      const relatives=this.store.edges(live.id).filter(e=>['contradicts','supersedes'].includes(e.relation)).map(e=>this.store.get(e.from_id===live.id?e.to_id:e.from_id)).filter(m=>m&&this.eligible(m)&&(!expressionScope||expressionFeedbackApplies(m,expressionScope)&&selfUnderstandingApplies(m,{expressionScope,query}))&&!(currentInterestsOnly&&m.metadata.disposition?.kind==='interest'&&['outdated','candidate'].includes(m.status)));
      let members=[live,...relatives.filter(r=>!used.has(r.id))].map(m=>({id:m.id,revision:m.revision,kind:m.kind,gist:m.gist,epistemic:m.epistemic,status:m.status,occurredAt:m.occurred_at,validFrom:m.valid_from,validTo:m.valid_to,...(m.assertion?{assertion:m.assertion}:{}),evidenceOrigin:memoryEvidenceOrigin(m,{archive:this.store.inner?.runtime?.archive||this.archive,characterId:this.store.characterId}),...(m.metadata.disposition?{disposition:m.metadata.disposition,subjectId:this.store.characterId,interpretation:'subjective-not-person-fact'}:{}),...(m.metadata.selfUnderstanding?{selfUnderstanding:selfUnderstandingModelView(m.metadata.selfUnderstanding),interpretation:'scoped-subjective-self-understanding-not-current-task-or-person-rule'}:{}),participants:m.participants,evidence:m.evidence,detailAvailable:m.detail_state==='available',
        ...(entities?.length?{isCurrentSubject:m.assertion?.subjectId?entities.includes(m.assertion.subjectId):m.participants.some(p=>entities.includes(p.entity_id))}:{}),
        ...(m.status==='outdated'?{limitations:['历史信息，当前状态可能已变化']}:{})}));
      // Conflict/supersession bundles stay indivisible. A smaller item budget
      // omits a whole bundle rather than hiding its counter-evidence member.
      if(used.size+members.length>tuning.memory.maxRecallItems){budgetOmissions++;continue;}
      members=members.map(m=>({...m,gist:clip(m.gist,tuning.text.memoryGistChars),...(m.gist.length>tuning.text.memoryGistChars?{partial:true}:{})}));
      if(compact)members=members.map(m=>({...m,gist:clip(m.gist,Math.min(220,tuning.text.memoryGistChars)),evidence:m.evidence.slice(0,2),evidenceCount:m.evidence.length}));
      let bundle={items:members,conflict:relatives.length>0};let size=json(bundle).length;
      if(size>budgetChars-chars){bundle={...bundle,items:members.map(m=>{
        // Subject and target are already explicit, typed fields on a
        // disposition. Under budget pressure do not repeat those same two
        // actor rows; keep every additional speaker/participant unchanged.
        const participants=m.disposition?m.participants.filter(p=>!(p.role==='subject'&&p.entity_id===m.subjectId||p.role==='target'&&p.entity_id===m.disposition.target)):m.participants;
        return {...m,gist:clip(m.gist,100),...([...m.gist].length>100?{partial:true}:{}),evidence:m.evidence.slice(0,2),...(m.evidence.length>2?{evidenceCount:m.evidence.length,evidencePartial:true}:{}),...(participants.length!==m.participants.length?{participants,attributionFields:['subjectId','disposition.target']}:{} )};
      })};size=json(bundle).length;}
      if(size>budgetChars-chars){budgetOmissions++;continue;}
      chars+=size;bundles.push(bundle);members.forEach(m=>used.add(m.id));
    }return {origin:'memory-not-archive',characterRevision:this.store.manifest().cognition_revision,depth,bundles:bundles.map(b=>({ids:b.items.map(m=>m.id),conflict:b.conflict})),items:bundles.flatMap(b=>b.items),omittedForBudget:budgetOmissions>0,missing:bundles.length?null:budgetOmissions?'相关记忆超过本轮预算，未注入；不表示没有这段经历。':'没有找到足够相关的记忆。精确原话请查档案。',chars};
  }
  async recall(query,{depth='shallow',entities=[],kinds,from,to,at,budgetChars,budgetPolicy,signal,purpose='general',includeCrossContact=true,subjectFilterExplicit=false,implicitSelfId,conversationPeerId,currentInterestsOnly=false,expressionScope}={}){
    if(this.store.inner)return associativeRecall(this,query,{depth,entities,kinds,from,to,at,budgetChars,budgetPolicy,signal,purpose,includeCrossContact,subjectFilterExplicit,implicitSelfId,conversationPeerId,currentInterestsOnly,expressionScope});
    if(typeof query!=='string'||!query.trim()||query.length>1000||!['shallow','deep'].includes(depth))fail('INVALID_RECALL');entities.forEach(entityId);
    if(/验证码|原话|原句|原文|精确(?:时间|数字)|完整链接/.test(query))return {origin:'memory-not-archive',depth,items:[],bundles:[],nextAction:{tool:'qq_search_resources',reason:'精确内容需要查档案，不从记忆大意补全'},degradedChannels:[],chars:0};
    if(purpose==='general'&&/答应|承诺|约好|欠我/.test(query))purpose='promise';if(at===undefined&&/现在|目前|如今/.test(query))at=this.now();
    const tuning=tuningFor(this),configured=depth==='deep'?tuning.memory.deepRecallBudgetChars:tuning.memory.recallBudgetChars;
    const budget=Math.max(1,Math.min(configured,budgetChars||configured)),revision=this.store.manifest().cognition_revision;
    const key=hash([query,depth,entities,kinds,from,to,at,budget,tuning.memory.maxRecallItems,tuning.text.memoryGistChars,purpose,includeCrossContact,expressionScope,revision]),cached=this.cache.get(key);if(cached&&this.now()-cached.at<30000)return structuredClone(cached.result);
    const start=this.now(),degraded=[],pool=new Map(),scores=new Map(),qs=terms(query);
    const permitted=m=>m&&this.eligible(m)&&(!expressionScope||expressionFeedbackApplies(m,expressionScope)&&selfUnderstandingApplies(m,{expressionScope,query}))&&(!kinds||kinds.includes(m.kind))&&matchTime(m,from,to,at)&&(!(purpose==='promise'||!includeCrossContact)||!entities.length||entities.includes(m.assertion?.subjectId));
    const add=(rows,weight)=>rows.filter(permitted).forEach((m,i)=>{pool.set(m.id,m);scores.set(m.id,(scores.get(m.id)||0)+weight/(60+i+1));});
    try{add(this.store.lexical(query,30),1);}catch{degraded.push('lexical-unavailable');}
    if(this.embedding){try{const hits=await this.vector(query,{signal});add(hits.map(h=>this.store.get(h.id)).filter(Boolean),1);}catch(e){assertSignal(signal);degraded.push(e.code||'semantic-unavailable');}}
    else degraded.push('embedding-not-configured');
    if(entities.length){const direct=[];for(const person of entities){const ids=this.store.db.prepare(`SELECT DISTINCT n.memory_id FROM memory_entities e JOIN memory_nodes n USING(character_id,memory_id)
      JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision LEFT JOIN assertions a USING(character_id,memory_id)
      WHERE e.character_id=? AND e.entity_id=? AND n.status IN ('active','contested','outdated','faded')
      AND (? IS NULL OR coalesce(n.occurred_at,n.recorded_at)>=?) AND (? IS NULL OR coalesce(n.occurred_at,n.recorded_at)<=?)
      AND (? IS NULL OR ((n.valid_from IS NULL OR n.valid_from<=?) AND (n.valid_to IS NULL OR n.valid_to>?)))
      AND ((?=1 AND a.speech_act='promise') OR (?=0 AND EXISTS(SELECT 1 FROM json_each(?) q WHERE instr(lower(v.gist),q.value)>0))) ORDER BY n.recorded_at DESC LIMIT 20`).all(this.store.characterId,person,from??null,from??null,to??null,to??null,at??null,at??null,at??null,purpose==='promise'?1:0,purpose==='promise'?1:0,json(qs));for(const row of ids){const m=this.store.get(row.memory_id);if(m)direct.push(m);}}add([...new Map(direct.map(m=>[m.id,m])).values()],1.1);}
    const seeds=[...pool.values()].sort((a,b)=>(scores.get(b.id)||0)-(scores.get(a.id)||0)).slice(0,8);
    add(this.graph(seeds,{relations:purpose==='why'?['causes','supports','abstracts','semantic']:['before','semantic','abstracts','responds_to','contradicts','supersedes',...(purpose==='promise'?['same_entity']:[])]}),.45);
    let selected=[...pool.values()].sort((a,b)=>{
      const access=m=>unit(m.base_strength)*2**(-Math.max(0,this.now()-(m.last_reinforced_at??m.recorded_at))/(86400000*m.half_life_days));
      return (scores.get(b.id)||0)*(.9+.1*access(b))-(scores.get(a.id)||0)*(.9+.1*access(a));
    });
    if(depth==='deep'&&this.model?.available){let queries=0;
      for(let round=0;round<2;round++){
        const plan=await this.model.run('recall-plan','根据问题挑选相关且人物、时间正确的已有ID，可以一条不选。返回 {selectedIds:[],queries:[最多2个补查关键词],missing:[] }。零命中也可改写检索词，不生成新往事。',{query,entities,from,to,purpose,candidates:selected.slice(0,30).map(m=>({id:m.id,gist:m.gist,participants:m.participants,assertion:m.assertion,occurredAt:m.occurred_at}))},signal);
        if(!Array.isArray(plan.selectedIds)||plan.selectedIds.some(id=>!pool.has(id)))fail('INVALID_RECALL_SELECTION');
        selected=plan.selectedIds.map(id=>pool.get(id));
        if(round===1||queries>=2)break;
        const next=(plan.queries||[]).filter(q=>typeof q==='string'&&q.trim()&&q.length<=150).slice(0,2-queries);if(!next.length)break;
        queries+=next.length;let added=false;
        for(const q of next){let hits=[];try{hits=this.store.lexical(q,20).filter(permitted);}catch{if(!degraded.includes('lexical-unavailable'))degraded.push('lexical-unavailable');}for(const m of hits){if(!pool.has(m.id))added=true;pool.set(m.id,m);}selected.push(...hits);}
        selected=[...new Map(selected.map(m=>[m.id,m])).values()].slice(0,30);if(!added)break;
      }
    }
    // Diversity operates only on related candidates; shared evidence alone is not a duplicate.
    const diverse=[];for(const m of selected){if(!permitted(m)||diverse.some(n=>n.kind===m.kind&&similarity(n,m)>.96&&json(n.assertion)===json(m.assertion)))continue;diverse.push(m);}
    const result={...this.pack(diverse,{budgetChars:budget,entities,depth,expressionScope,query}),degradedChannels:degraded,elapsedMs:this.now()-start};
    this.cache.set(key,{at:this.now(),result});if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value);
    this.store.db.prepare('INSERT INTO v2_recall_log VALUES(?,?,?)').run('recall:'+hash([key,this.now(),Math.random()]).slice(0,32),this.now(),json({queryHash:hash(query),depth,ids:result.items.map(m=>m.id),degraded,elapsedMs:result.elapsedMs}));
    return structuredClone(result);
  }
}
