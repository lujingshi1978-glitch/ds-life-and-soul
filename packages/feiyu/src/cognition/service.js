import {lifeNightAt} from '../energy-policy.js';
import {withEnergyContext,jobEnergyContext} from '../energy-context.js';
import {tuningFor} from '../runtime-tuning.js';
import {modelMetadataView} from './model-view.js';
import {isOperationalMaterial,memoryLearningEligible} from '../operational-material.js';
import {reconcileHistoricalInnerStatuses} from './inner-impact.js';
import {installNightScopes} from './night-scope.js';
import {reconcileBasisDependencies,basisSources} from './basis-sources.js';
import {settleSourceRepairs} from './source-repair-coverage.js';
import {sourceTextFormat} from './structured-spans.js';
import {reconcileCommitments} from './commitments.js';
import {maskForgottenText} from './forget-mask.js';
import {SemanticNetwork} from './semantic-network.js';
import {installStableMemory} from './stable-memory.js';
import {InterestObservations} from './interest-observations.js';
import {MemoryRepair} from './repair.js';
import {installConsistency,reconcileSourceClosure,reconcileMemoryProvenance} from './consistency.js';
import {installDreamFollowup,processDreamFollowup,finishCommittedDream} from './v3-dream-followup.js';
import {installNightReviews} from './night-review.js';
import {ArchiveVectors} from './v3-archive-vectors.js';
import {recoverV3Jobs} from './v3-recovery.js';
import {MemoryLinks} from './v3-links.js';
import {randomUUID} from 'node:crypto';
import {characterDirectory,entityId,hash,json,parse,fail,assertSignal,isNight,bounded,clip} from './contracts.js';
import {CognitionArchive} from './archive.js';
import {CognitionStore} from './store.js';
import {CognitiveModel} from './model.js';
import {MemoryRetriever} from './retrieve.js';
import {MemoryLifecycle} from './lifecycle.js';
import {CognitiveAttention} from './attention.js';
import {CharacterPolicy} from './policy.js';
import {ContextCompiler} from './context.js';
import {Consolidator} from './consolidate.js';
import {encodeBundle,validateEncoded,splitEvents} from './encode.js';
import {refreshProjections} from './projections.js';
import {loadLocalEmbedding} from './embedding.js';
import {MultiViewIndex} from './v3-views.js';
import {HistoricalReview} from './v3-history-review.js';
import {InnerLife} from './inner-life.js';
import {DispositionMemory} from './dispositions.js';
import {scheduleV3Encoding,validateV3Ownership,commitUnitCoverage,snapshotMemory} from './v3-extraction.js';
import {qualifySelfStatements,shouldRestrictStoredCompletion} from './self-statement-source-typing.js';

// A host-owned runtime. No production configuration, timers, live QQ client or V1 store is imported.
export class CharacterCognition {
  constructor({root,characterId,think,embedding,allowExternalEmbeddings=false,now=Date.now,modelOptions={},runtimeTuning}){
    entityId(characterId);if(!characterId.startsWith('character:'))fail('CHARACTER_ID_REQUIRED');
    Object.assign(this,{root,characterId,now,runtimeTuning});this.dir=characterDirectory(root,characterId);const embeddingProfile=tuningFor(this).memory.embeddingProfile;if(embeddingProfile==='lexical')embedding=null;else if(embedding===undefined)embedding=loadLocalEmbedding(root,{profile:embeddingProfile});else if(embedding&&embeddingProfile!=='existing'){const expected=embeddingProfile==='bge-small-512'?{model:'BAAI/bge-small-zh-v1.5@',dimensions:512}:{model:'BAAI/bge-large-zh-v1.5@',dimensions:1024};if(typeof embedding.modelId!=='string'||!embedding.modelId.startsWith(expected.model)||embedding.dimensions!==expected.dimensions)fail('EMBEDDING_PROFILE_MISMATCH');}this.closed=false;this.closing=false;this.grants=new WeakMap();this.pending=new Set();
    this.archive=new CognitionArchive(this.dir,characterId,{now});
    try{this.store=new CognitionStore(this.dir,characterId,{now});this.store.runtimeTuning=runtimeTuning;}catch(e){this.archive.close();throw e;}
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS v2_event_parts(event_id TEXT NOT NULL,part INTEGER NOT NULL,job_id TEXT NOT NULL,PRIMARY KEY(event_id,part));CREATE TABLE IF NOT EXISTS v2_model_calls(id TEXT PRIMARY KEY,at INTEGER NOT NULL,purpose TEXT NOT NULL,receipt TEXT NOT NULL);`);
    this.model=new CognitiveModel(think,{...modelOptions,runtimeTuning,onReceipt:receipt=>this.store.db.prepare('INSERT INTO v2_model_calls VALUES(?,?,?,?)').run(randomUUID(),now(),receipt.purpose,json(receipt))});this.retriever=new MemoryRetriever(this.store,{model:this.model,embedding,allowExternalEmbeddings,now,runtimeTuning});this.retriever.archive=this.archive;this.lifecycle=new MemoryLifecycle(this.store);this.attention=new CognitiveAttention();this.policy=new CharacterPolicy(this.store);
    this.model.characterId=characterId;
    this.context=new ContextCompiler(this);this.consolidator=new Consolidator(this);this.reconcile();
  }
  assertOpen(){if(this.closed||this.closing)fail('CLOSED');}
  enableInner(){if(this.inner)return this.inner;installNightScopes(this);this.inner=new InnerLife(this);installConsistency(this);installStableMemory(this);if(this.inner.meta('basisDependenciesVersion')!==1)this.store.atomic('basis-dependencies-reconciled',()=>{const result=reconcileBasisDependencies(this);this.inner.meta('basisDependenciesVersion',1);return {...result,affected:[]};});this.interestObservations=new InterestObservations(this);this.model.budget=this.inner;this.views=new MultiViewIndex(this.retriever);this.retriever.views=this.views;this.historyReview=new HistoricalReview(this);this.links=new MemoryLinks(this);this.archiveVectors=new ArchiveVectors(this);this.semanticNetwork=new SemanticNetwork(this);this.repairs=new MemoryRepair(this);this.store.v3AfterWrite=id=>{this.store.refreshSourceDependencies(id);snapshotMemory(this.store,id);this.store.registerClaim?.(this.store.get(id,{includeInactive:true}));};recoverV3Jobs(this);installNightReviews(this);installDreamFollowup(this);reconcileSourceClosure(this);reconcileMemoryProvenance(this);settleSourceRepairs(this);reconcileHistoricalInnerStatuses(this);this.dispositions=new DispositionMemory(this);this.store.dispositions=this.dispositions;this.dispositions.migrate();this.inner.schedulePsychologyCompression();return this.inner;}
  openConversation(peer,{admin=false}={}){this.assertOpen();entityId(peer);const handle=Object.freeze({});this.grants.set(handle,{peer,admin:admin===true,epoch:this.store.manifest().role_epoch});return handle;}
  grant(handle,{admin=false}={}){this.assertOpen();const g=this.grants.get(handle);if(!g||g.epoch!==this.store.manifest().role_epoch)fail('INVALID_CONVERSATION_CAPABILITY');if(admin&&!g.admin)fail('ADMIN_REQUIRED');return g;}
  reconcile(){let count=0;for(;;){const batch=this.archive.pending(100);if(!batch.length)break;for(const row of batch){const e=row.envelope;const tombstone=this.archive.db.prepare("SELECT status FROM documents WHERE source_id=? AND revision=?").get(e.sourceId,e.revision);if(tombstone?.status==='deleted'){this.archive.ack(row.id);count++;continue;}this.store.receive(e,this.archive.get(e.sourceId,e.revision));this.archive.ack(row.id);count++;}}return count;}
  observe(source,event){this.assertOpen();const envelope=this.archive.append(source,event);this.reconcile();return {...envelope,buffered:lifeNightAt(this,this.now())};}
  materials(job){return job.payload.parts.filter(p=>!this.store.suppressed(p.sourceId)).flatMap((p,i)=>{const row=this.archive.db.prepare('SELECT status FROM documents WHERE source_id=? AND revision=?').get(p.sourceId,p.revision);if(!row||row.status==='deleted'||this.store.sourceUsable&&!this.store.sourceUsable({sourceId:p.sourceId,revision:p.revision},{historical:job.payload.historical===true||p.historical===true}))return [];const r=this.archive.get(p.sourceId,p.revision);if(isOperationalMaterial(r))return [];return [{ref:'r'+(i+1),sourceId:p.sourceId,revision:p.revision,textFormat:sourceTextFormat(r.text),text:maskForgottenText(this.store,p.sourceId,p.revision,r.text.slice(p.offset,p.offset+p.length),p.offset),sourceOffset:p.offset,eventId:p.eventId,unitId:p.unitId,context:p.context?{...p.context,text:maskForgottenText(this.store,p.sourceId,p.revision,p.context.text||'',p.context.sourceOffset||0)}:undefined,eventRoot:p.eventRoot,outcome:p.outcome,historical:job.payload.historical===true||p.historical===true,metadata:r.metadata,occurredAt:r.occurred_at,observedAt:r.observed_at}];});}
  scheduleEncoding({before}={}){this.assertOpen();if(lifeNightAt(this,this.now())&&!Number.isSafeInteger(before))return {buffered:true,jobs:[]};this.reconcile();const s=this.store;
    if(this.inner)return scheduleV3Encoding(this,{before,historical:Number.isSafeInteger(before)});
    return s.atomic('encoding-scheduled',()=>{
      const events=s.db.prepare(`SELECT e.*,es.source_id,es.source_revision FROM cognitive_events e JOIN event_sources es USING(character_id,event_id)
        WHERE e.character_id=? AND (? IS NULL OR e.recorded_at<=?) AND NOT EXISTS(SELECT 1 FROM v2_event_parts p WHERE p.event_id=e.event_id) ORDER BY e.recorded_at,e.rowid`).all(this.characterId,before??null,before??null);
      const parts=[];for(const e of events){if(s.suppressed(e.source_id)){const skipped=s.enqueue('encode',{parts:[]},{fingerprint:'suppressed:'+e.event_id});s.db.prepare("UPDATE jobs SET status='complete',payload_json='{}' WHERE job_id=?").run(skipped);s.db.prepare('INSERT INTO v2_event_parts VALUES(?,0,?)').run(e.event_id,skipped);continue;}const r=this.archive.get(e.source_id,e.source_revision);for(let offset=0,part=0;offset<Math.max(1,r.text.length);offset+=3000,part++)parts.push({eventId:e.event_id,part,sourceId:e.source_id,revision:e.source_revision,offset,length:Math.min(3000,r.text.length-offset),eventRoot:e.event_root,outcome:e.outcome});}
      // Group within a bounded input budget; all parts are durable and eventually encoded.
      const batches=splitEvents(parts.map(p=>({...p,sizeHint:' '.repeat(p.length)})),{maxEvents:8,maxChars:8000}),jobs=[];
      for(const batch of batches){const refs=batch.map(({sizeHint,...p})=>p),jobId=s.enqueue('encode',{parts:refs},{fingerprint:hash(refs)});jobs.push(jobId);for(const p of refs)s.db.prepare('INSERT INTO v2_event_parts VALUES(?,?,?)').run(p.eventId,p.part,jobId);}
      return jobs.length?{jobs}:null;
    })||{jobs:[]};
  }
  retainValidated(bundle,materials,{verified=new Set(),job}={}){
    const encoded=validateEncoded(bundle,materials,{verified});return this.commitEncoded(encoded,{job});
  }
  commitEncoded(encoded,{job}={}){const s=this.store;const report=s.atomic('experience-bundle-retained',()=>{
    if(job)s.assertJob(job);const qualification=qualifySelfStatements(this,encoded);encoded=qualification.bundle;
    const ownSpeech=new Set(qualification.changes.map(c=>encoded.memories[c.index]));
    const ids=encoded.memories.filter(r=>!this.inner||!r.evidence.some(e=>e.span?.length&&s.db.prepare('SELECT 1 FROM v3_forget_spans WHERE source_id=? AND revision=? AND offset<? AND offset+length>? LIMIT 1').get(e.sourceId,e.revision,e.span.offset+e.span.length,e.span.offset))).map(r=>{
      const scopes=[...new Set(r.evidence.map(e=>this.archive.get(e.sourceId,e.revision).metadata.scope).filter(Boolean))];r.metadata={...r.metadata,...(scopes.length?{scope:scopes.length===1?scopes[0]:'self',sourceScopes:scopes}:{})};
      if(r.kind==='experience')for(const basis of this.inner?basisSources(this,r.evidence):r.evidence.flatMap(e=>this.archive.get(e.sourceId,e.revision).metadata.basisSources||[])){if(!s.sourceRegistered(basis)||s.suppressed(basis.sourceId)||s.sourceUsable?.(basis)===false&&!r.metadata?.historicalReview&&!job?.payload?.historical)fail('EVIDENCE_UNAVAILABLE');if(r.evidence.length<20&&!r.evidence.some(ref=>ref.sourceId===basis.sourceId&&ref.revision===basis.revision))r.evidence.push({...basis,role:'context',independenceGroup:r.eventRoot});}
      const id=s.writeNode(r);
      // Claim deduplication deliberately keeps a prior active node when a later
      // generic extraction is merely tentative. A host-typed unsupported own
      // completion is a stronger source restriction and must survive that reuse.
      if(ownSpeech.has(r)&&r.assertion?.commitmentStatus==='fulfilled'&&r.metadata.claimedCompletion){
        const current=s.get(id);if(current&&shouldRestrictStoredCompletion(this,current,r))this.lifecycle.revise(id,current.revision,{status:'candidate',metadata:{...current.metadata,claimedCompletion:true,sourceTyping:r.metadata.sourceTyping}});
      }
      return id;
    });
    if(this.inner)reconcileCommitments(this,ids);
    for(const id of ids){const current=s.get(id);if(!current)continue;const peers=new Set(current.participants.filter(p=>!p.entity_id.startsWith('character:')).map(p=>p.entity_id));for(const peer of peers){const related=s.db.prepare('SELECT DISTINCT memory_id FROM memory_entities WHERE character_id=? AND entity_id=? AND memory_id<>? ORDER BY rowid DESC LIMIT 3').all(this.characterId,peer,id);for(const row of related)if(s.get(row.memory_id))s.addEdge(id,row.memory_id,'same_entity',{provenance:'deterministic',evidence:[]});}}
    if(this.inner){for(const id of ids)snapshotMemory(s,id);commitUnitCoverage(s,job);}
    const projections=refreshProjections(s,ids);const body={kind:'encode',summary:encoded.summary,ids,projections};if(job)s.finish(job,body);return {...body,affected:ids};
    },{epoch:job?.role_epoch});
    if(this.inner)settleSourceRepairs(this);
    this.interestObservations?.flush();this.links?.schedule(report.ids);if(!job?.payload?.historical)for(const id of report.ids)this.policy.registerGrowth(id);return report;
  }
  async runNext({signal,allowNightDream=true,historicalBefore,kinds,scope}={}){
    this.assertOpen();if(scope)await (scope.prepareAsync?scope.prepareAsync({signal}):scope.prepare());else{this.repairs?.schedule();this.semanticNetwork?.schedule();}const recovered=finishCommittedDream(this,scope?.jobIds(),signal);if(recovered)return recovered;const spending=this.dailyCostBudget?.admit();if(spending?.allowed===false)return {status:'daily-cost-winding-down',retryAt:spending.nextResetAt};if(!this.model.available&&!this.retriever.embedding)return {status:'model-not-configured'};
    if(lifeNightAt(this,this.now())&&!allowNightDream)return {status:'sleeping'};
    const lease=await this.attention.acquire('organize',null,{background:true,signal});if(!lease)return {status:'foreground-busy'};
    const task=this.worker(lease,{historicalBefore,kinds,scope});this.pending.add(task);try{return await task;}finally{this.pending.delete(task);}
  }
  async worker(lease,{historicalBefore,kinds,scope}={}){let job,heartbeat;try{
    const spending=this.dailyCostBudget?.admit();if(spending?.allowed===false)return {status:'daily-cost-winding-down',retryAt:spending.nextResetAt};
    const budgetBlocked=this.inner?.budgetExhausted();job=this.store.claim({recordedBefore:scope?undefined:historicalBefore,jobIds:scope?.jobIds(),kinds:kinds&&this.model.available&&!budgetBlocked?kinds:!this.model.available||budgetBlocked?['embed','embed-views','archive-embed-v3','link-local-v3']:lifeNightAt(this,this.now())?(Number.isSafeInteger(historicalBefore)?['encode','dream','grow','embed','embed-views','link-v3','archive-embed-v3','inner-dream-v3','history-v3','link-local-v3','repair-v3','review']:['dream','grow','embed','embed-views','link-v3','archive-embed-v3','inner-dream-v3','history-v3','link-local-v3','repair-v3']):['encode','dream','grow','embed','embed-views','link-v3','archive-embed-v3','inner-dream-v3','history-v3','link-local-v3','repair-v3',...Object.keys(this.jobHandlers||{})]});if(!job)return budgetBlocked?{status:'energy-sleeping',retryAt:this.owner?.life?.status().retryAt||this.now()+60000}:{status:'idle'};
    return await withEnergyContext({...jobEnergyContext(this,job),costStartedAt:this.now()},async()=>{
    if(scope)job.payload.nightDay=scope.day;this.onJob?.(job);
    if(lifeNightAt(this,this.now())&&!Number.isSafeInteger(historicalBefore)&&job.kind==='encode'){this.store.release(job,{aborted:true,error:'night-buffer'});return {status:'sleeping'};}
    heartbeat=setInterval(()=>{try{this.store.heartbeat(job);}catch(e){lease.abort.abort(e);}},30000);heartbeat.unref?.();
    let report;
    if(job.kind==='encode'){const materials=this.materials(job),bundle=materials.length?await encodeBundle(this.model,materials,lease.signal):{summary:'输入已被遗忘或删除，跳过提炼',memories:[]};lease.assert();if(this.inner)validateV3Ownership(bundle,materials);report=this.commitEncoded(bundle,{job});
      try{await this.retriever.index(report.ids,{signal:lease.signal});}catch(e){assertSignal(lease.signal);report.embeddingDegraded=e.code||'index-unavailable';this.scheduleEmbedding();}
    }else if(job.kind==='repair-v3')report=await this.repairs.process(job,lease.signal);
    else if(job.kind==='link-local-v3')report=this.semanticNetwork.process(job,lease.signal);
    else if(job.kind==='link-v3')report=await this.links.process(job,lease.signal);
    else if(job.kind==='archive-embed-v3')report=await this.archiveVectors.process(job,lease.signal);
    else if(job.kind==='inner-dream-v3')report=await processDreamFollowup(this,job,lease.signal);
    else if(job.kind==='history-v3')report=await this.historyReview.process(job,lease.signal);
    else if(job.kind==='embed-views'){report=await this.views.index(job.payload.ids,{signal:lease.signal});lease.assert();this.store.atomic('v3-views-job-complete',()=>{this.store.finish(job,report);return {affected:job.payload.ids};});}
    else if(job.kind==='dream')report=await this.consolidator.dream(job,lease.signal);
    else if(job.kind==='grow')report=await this.consolidator.grow(job,lease.signal);
    else if(job.kind==='embed'){report=await this.retriever.index(job.payload.ids,{signal:lease.signal});lease.assert();this.store.atomic('embedding-backfill-complete',()=>{this.store.finish(job,{kind:'embed',...report});return {affected:job.payload.ids};},{epoch:job.role_epoch});}
    else if(this.jobHandlers?.[job.kind])report=await this.jobHandlers[job.kind](job,lease.signal);
    else fail('UNKNOWN_JOB_KIND');
    return {status:'complete',jobId:job.job_id,report};
    });}catch(e){if(e.code==='DAILY_SOFT_LIMIT_WIND_DOWN'){if(job&&!this.store.closed)this.store.release(job,{aborted:true,error:e.code});return {status:'daily-cost-winding-down',jobId:job?.job_id,error:e.code,retryAt:e.retryAt||this.dailyCostBudget?.status().nextResetAt};}const error=e.code==='ERR_SQLITE_ERROR'?'ERR_SQLITE_ERROR: '+e.message:e.code||e.message;if(job&&!this.store.closed)this.store.release(job,{aborted:lease.signal.aborted||['ENERGY_DEPLETED','V3_HOURLY_MODEL_BUDGET','V3_BACKGROUND_MODEL_BUDGET','COGNITION_READSET_STALE','V3_HEAD_VERSION_CONFLICT','MEMORY_VERSION_CONFLICT','V3_INNER_BUSY'].includes(e.code),error});return {status:['ENERGY_DEPLETED','V3_HOURLY_MODEL_BUDGET','V3_BACKGROUND_MODEL_BUDGET'].includes(e.code)?'deferred':lease.signal.aborted||['COGNITION_READSET_STALE','V3_HEAD_VERSION_CONFLICT','MEMORY_VERSION_CONFLICT','V3_INNER_BUSY'].includes(e.code)?'preempted':'failed',jobId:job?.job_id,error,...(['ENERGY_DEPLETED','V3_HOURLY_MODEL_BUDGET','V3_BACKGROUND_MODEL_BUDGET'].includes(e.code)?{retryAt:this.owner?.life?.status().retryAt||this.now()+60000}:{})};}
    finally{clearInterval(heartbeat);lease.release();}
  }
  async runMaintenance({limit=20,signal,historicalBefore,kinds,scope}={}){this.assertOpen();const out=[];for(let i=0;i<Math.min(1000,limit);i++){assertSignal(signal);const r=await this.runNext({signal,historicalBefore,kinds,scope});out.push(r);if(r.status!=='complete')break;}return out;}
  async withActivity(kind,handle,fn,{signal}={}){
    const g=this.grant(handle);this.dailyCostBudget?.assertStart({foreground:kind==='chat'});if(lifeNightAt(this,this.now()))fail('NIGHT_ACTIONS_CLOSED');
    if(!['chat','bili','qzone','learn'].includes(kind))fail('INVALID_ACTIVITY');
    const lease=await this.attention.acquire(kind,g.peer,{signal});const task=(async()=>{
      try{lease.assert();this.grant(handle);if(lifeNightAt(this,this.now()))fail('NIGHT_ACTIONS_CLOSED');this.policy.updateState({behavior:{kind,target:g.peer}},{actionId:lease.id,action:kind==='learn'?'tool':kind});
        // Host must assert this lease immediately before every externally visible effect.
        const stageId=lease.id,context=await this.context.compile(g.peer,{stageId,signal:lease.signal});lease.assert();
        return await fn({signal:lease.signal,stageId,context,assert:()=>{lease.assert();this.grant(handle);if(lifeNightAt(this,this.now()))fail('NIGHT_ACTIONS_CLOSED');},append:m=>this.context.append(stageId,m),compile:query=>this.context.compile(g.peer,{stageId,query,signal:lease.signal})});
      }finally{this.context.discard(lease.id);if(!this.store.closed)this.policy.updateState({behavior:{kind:lifeNightAt(this,this.now())?'sleep':'idle'}});lease.release();}
    })();this.pending.add(task);try{return await task;}finally{this.pending.delete(task);}
  }
  recall(handle,query,options={}){const g=this.grant(handle);bounded(query,1000);const explicit=[...query.matchAll(/\b(?:qq|bili):\d+\b|\bcharacter:[\w-]+\b|\bwechat:[a-f0-9]{24}\b/g)].map(m=>m[0]),quoted=[...query.matchAll(/[“「]([^”」]{1,100})[”」]/g)].flatMap(m=>this.store.resolveAlias(m[1]));
    if(!options.entities&&!explicit.length&&new Set(quoted).size>1)return Promise.resolve({origin:'memory-not-archive',items:[],bundles:[],ambiguousEntities:[...new Set(quoted)],nextAction:{kind:'clarify-person',reason:'同名不代表同一人，请确认稳定账号ID'},degradedChannels:[]});
    return this.retriever.recall(query,{...options,subjectFilterExplicit:options.entities!==undefined||explicit.length>0||quoted.length>0,implicitSelfId:options.entities===undefined&&!explicit.length&&!quoted.length?this.characterId:undefined,entities:explicit.length?explicit:options.entities||(quoted.length?quoted:[g.peer])});}
  expand(handle,memoryId,{offset=0,limit}={}){this.grant(handle);const m=this.store.get(memoryId);if(!m)fail('MEMORY_UNAVAILABLE');if(!Number.isSafeInteger(offset)||offset<0||limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1))fail('INVALID_MEMORY_PAGE');const tuning=tuningFor(this),detail=String(m.detail||''),chars=[...detail],cap=Math.min(tuning.memory.detailChars,limit??tuning.memory.detailChars),next=offset+cap<chars.length?offset+cap:null,gist=clip(m.gist,tuning.text.memoryGistChars);return {origin:'memory-not-archive',...m,metadata:{...modelMetadataView(m.metadata),...(m.metadata.expressionFeedback?{expressionFeedback:m.metadata.expressionFeedback}:{}),...(m.metadata.protected?{protected:true}:{})},gist,detail:chars.slice(offset,offset+cap).join(''),gistTotalChars:[...m.gist].length,detailTotalChars:chars.length,detailOffset:offset,nextDetailOffset:next,partial:[...gist].length<[...m.gist].length||offset>0||next!==null,...(next!==null?{nextAction:{tool:'qq_memory_expand',reason:'当前仅提供一页记忆细节；继续阅读不会恢复已遗忘的信息',memoryId:m.id,offset:next}}:{})};}
  searchArchive(handle,query){this.grant(handle);return this.archive.search(query);}
  readArchive(handle,sourceId,revision,options={}){this.grant(handle);return this.archive.read(sourceId,revision,{...options,maxChars:tuningFor(this).memory.resourceReadChars});}
  feedback(handle,{memoryId,note}){const g=this.grant(handle),m=this.store.get(memoryId);if(!m)fail('MEMORY_UNAVAILABLE');bounded(note,600);return this.store.atomic('memory-disputed',()=>{
    const proposalId='dispute:'+hash([g.peer,memoryId,note]);this.store.db.prepare('INSERT OR IGNORE INTO v2_proposals VALUES(?,?,?,?,?)').run(proposalId,'dispute',json({memoryId,note,speakerId:g.peer}),'pending',this.now());return {proposalId,status:'pending-verification',affected:[memoryId]};
  });}
  recordExperience(handle,{summary,reaction,evidence,intensity=.5,lastingness=.5,applyState=true}){
    const g=this.grant(handle);bounded(summary,800);bounded(reaction,600);if(!Array.isArray(evidence)||!evidence.length||evidence.length>8)fail('EVIDENCE_REQUIRED');
    const roots=[];for(const ref of evidence){if(!this.store.sourceRegistered(ref)||this.store.suppressed(ref.sourceId))fail('EVIDENCE_UNAVAILABLE');
      const event=this.store.db.prepare("SELECT e.event_root FROM event_sources s JOIN cognitive_events e USING(character_id,event_id) WHERE s.character_id=? AND source_id=? AND source_revision=? AND outcome IN ('observed','completed') LIMIT 1").get(this.characterId,ref.sourceId,ref.revision);if(!event)fail('UNPERCEIVED_OR_FAILED_EVENT');roots.push(event.event_root);}
    const basisSources=evidence.map(e=>({sourceId:e.sourceId,revision:e.revision}));
    const scope=g.peer==='qq:0'?'self':g.peer.replace('qq:','private:');
    const record=this.observe({adapter:'self-experience',externalId:hash([roots,summary,reaction]),kind:'experience',text:summary+'\n当时感受：'+reaction,metadata:{speakerId:this.characterId,explicitExperience:true,privacyLabel:'private',basisSources,intensity,lastingness,conversationPeerId:g.peer,scope}},
      {kind:'experience-recorded',eventRoot:roots[0],outcome:'observed'});
    if(applyState&&!this.inner){this.policy.updateState({psychological:reaction});this.store.atomic('state-evidence-attached',()=>{const state=this.store.projection('state');this.store.setProjection('state','self',{...state,psychologicalScope:scope,psychologicalUpdated:this.now(),affectRevision:(state.affectRevision||0)+1},{dependencies:basisSources.map(r=>'source:'+r.sourceId)});return {affected:basisSources.map(r=>r.sourceId)};});}return {...record,status:'queued-for-encoding'};
  }
  async evaluateRelationship(handle,evidence,{signal}={}){
    if(this.inner)fail('RELATIONSHIP_SCORING_RETIRED');
    const g=this.grant(handle),rows=evidence.map(id=>this.store.get(id));if(!rows.length||rows.length>30||rows.some(m=>!m||!m.participants.some(p=>p.entity_id===g.peer)))fail('RELATIONSHIP_EVIDENCE_MISMATCH');
    const fingerprint=hash([g.peer,rows.map(m=>[m.id,m.revision])]),key='relationship:'+fingerprint,prior=this.store.db.prepare('SELECT body FROM v2_proposals WHERE id=?').get(key);if(prior)return parse(prior.body);
    const verdict=await this.model.run('relationship','根据角色性格和这些带归属的互动判断亲密度变化，只返回 {rating:"大幅下降/小幅下降/不变/小幅上升/大幅上升中的一个",note:"简短关系理解"}。对外部服务失败不惩罚网友。',{personality:this.policy.core().map(c=>({field:c.field,text:c.body})),peer:g.peer,evidence:rows.map(m=>({id:m.id,gist:m.gist,assertion:m.assertion,participants:m.participants}))},signal);
    this.grant(handle);if(rows.some(m=>this.store.get(m.id)?.revision!==m.revision))fail('MEMORY_VERSION_CONFLICT');const delta={'大幅下降':-5,'小幅下降':-2,'不变':0,'小幅上升':2,'大幅上升':5}[verdict.rating];if(delta===undefined)fail('INVALID_RELATIONSHIP_RATING');bounded(verdict.note,400);
    return this.store.atomic('relationship-evaluated',()=>{const old=this.policy.relationship(g.peer),affinity=Math.max(0,Math.min(100,old.affinity+delta)),result={rating:verdict.rating,note:verdict.note,affinity,evidence};this.store.setProjection('relationship',g.peer,{affinity,notes:[...(old.notes||[]),verdict.note].slice(-8)},{dependencies:evidence});this.policy.syncSocialInterest(g.peer,affinity,evidence);this.store.db.prepare('INSERT INTO v2_proposals VALUES(?,?,?,?,?)').run(key,'relationship',json(result),'applied',this.now());return result;});
  }
  async learn(handle,{question,material},readWeb,{signal}={}){
    this.grant(handle);bounded(question,1000);bounded(material,4000);if(typeof readWeb!=='function')fail('LEARNING_READER_NOT_CONFIGURED');
    return this.withActivity('learn',handle,async stage=>{
      const pages=await readWeb({question,material,signal:stage.signal});stage.assert();if(!Array.isArray(pages)||pages.length>4)fail('INVALID_LEARNING_SOURCES');const docs=[];
      for(const page of pages){bounded(page.url,2000);bounded(page.text,6000);if(!/^https?:\/\//.test(page.url))fail('INVALID_LEARNING_URL');const e=this.observe({adapter:'learning-reader',externalId:hash(page.url),kind:'web-reading',text:page.text,metadata:{privacyLabel:'public',sourceUrl:page.url}},{eventRoot:page.independenceGroup||'web:'+hash(page.url),outcome:'observed'});docs.push(e);}
      return {status:'queued-for-encoding',sources:docs};
    },{signal});
  }
  retryFailed(handle,jobId){this.grant(handle,{admin:true});return this.store.atomic('job-retried',()=>{const r=this.store.db.prepare("UPDATE jobs SET status='pending',retry_at=0,attempts=0 WHERE job_id=? AND role_epoch=? AND status='failed'").run(jobId,this.store.manifest().role_epoch);return {retried:r.changes};});}
  scheduleEmbedding(){this.views?.schedule();if(!this.retriever.embedding)return null;const s=this.store,model=this.retriever.embedding.modelId;return s.atomic('embedding-backfill-scheduled',()=>{
    const active=s.db.prepare("SELECT job_id FROM jobs WHERE kind='embed' AND status IN ('pending','running') LIMIT 1").get();if(active)return {jobId:active.job_id};
    const rows=s.db.prepare(`SELECT n.memory_id,n.current_revision,v.content_hash FROM memory_nodes n JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision
      LEFT JOIN v2_vectors e ON e.memory_id=n.memory_id AND e.model=? WHERE n.character_id=? AND n.status IN ('active','contested','outdated','faded') AND (e.memory_id IS NULL OR e.revision<>n.current_revision OR e.content_hash<>v.content_hash OR CASE WHEN json_valid(e.vector) THEN json_array_length(e.vector) ELSE 0 END<>?) LIMIT 48`).all(model,this.characterId,this.retriever.embedding.dimensions).filter(r=>s.get(r.memory_id));
    if(!rows.length)return null;return {jobId:s.enqueue('embed',{ids:rows.map(r=>r.memory_id)},{fingerprint:hash([model,rows])})};
  });}
  coreHistory(handle,field){this.grant(handle,{admin:true});bounded(field,60);return this.store.db.prepare('SELECT * FROM v2_core_versions WHERE field=? ORDER BY revision DESC').all(field).map(r=>({...r,evidence:parse(r.evidence),redacted:!r.body}));}
  restoreCore(handle,{field,targetRevision,expectedRevision}){this.grant(handle,{admin:true});const s=this.store;return s.atomic('core-restored-by-admin',()=>{
    const current=this.policy.core().find(c=>c.field===field),prior=s.db.prepare('SELECT * FROM v2_core_versions WHERE field=? AND revision=?').get(field,targetRevision);if(!current||current.locked)fail('CORE_FIELD_LOCKED');if(expectedRevision!==current.revision)fail('CORE_VERSION_CONFLICT');if(!prior?.body||parse(prior.evidence).some(id=>!s.get(id)))fail('CORE_HISTORY_UNAVAILABLE');
    if(this.policy.core().reduce((n,c)=>n+[...(c.field===field?prior.body:c.body)].length,0)>10000)fail('CORE_BUDGET_EXCEEDED');
    s.db.prepare('UPDATE v2_core SET body=?,revision=revision+1,evidence=? WHERE field=?').run(prior.body,prior.evidence,field);s.db.prepare('INSERT INTO v2_core_versions VALUES(?,?,?,?,?)').run(field,current.revision+1,prior.body,prior.evidence,this.now());
    const result={field,fromRevision:current.revision,toRevision:current.revision+1,restoredFrom:targetRevision,evidence:parse(prior.evidence)};s.db.prepare('INSERT INTO v2_proposals VALUES(?,?,?,?,?)').run('admin-restore:'+randomUUID(),'core-restore',json(result),'applied',this.now());return result;
  });}
  async tick({limit=10,signal}={}){
    this.assertOpen();if(lifeNightAt(this,this.now())){if(!this.attention.active)this.policy.updateState({behavior:{kind:'sleep'}});this.consolidator.schedule();}
    else{if(!this.attention.active&&this.policy.state().behavior.kind==='sleep')this.policy.updateState({behavior:{kind:'idle'}});this.scheduleEncoding();this.consolidator.applyProposals();this.consolidator.schedule();}
    this.scheduleEmbedding();return this.runMaintenance({limit,signal});
  }
  start({intervalMs=30000,onError=()=>{}}={}){
    this.assertOpen();if(this.timer)fail('WORKER_ALREADY_STARTED');let busy=false;this.workerAbort=new AbortController();const tick=async()=>{if(busy||this.closing)return;busy=true;try{await this.tick({signal:this.workerAbort.signal});}catch(e){if(!this.workerAbort.signal.aborted)onError(e);}finally{busy=false;}};
    this.timer=setInterval(tick,Math.max(1000,intervalMs));this.timer.unref?.();void tick();return ()=>{clearInterval(this.timer);this.timer=null;this.workerAbort.abort();};
  }
  forget(handle,id,revision,{eraseArchive=false}={}){this.grant(handle,{admin:true});const r=this.lifecycle.forget(id,revision);if(eraseArchive)for(const source of r.sourceIds)this.archive.erase(source);this.retriever.cache.clear();return {...r,archivePreserved:!eraseArchive};}
  rotateEpoch(handle){this.grant(handle,{admin:true});this.attention.active?.abort.abort(new Error('ROLE_EPOCH_CHANGED'));return this.store.atomic('role-epoch-rotated',()=>{this.store.db.prepare('UPDATE character_manifest SET role_epoch=role_epoch+1').run();this.store.db.prepare("UPDATE jobs SET status='cancelled',lease_owner=NULL WHERE status IN ('running','pending')").run();this.context.live.clear();return {roleEpoch:this.store.manifest().role_epoch};});}
  status(){return {characterId:this.characterId,directory:this.dir,manifest:this.store.manifest(),state:this.policy.state(),attention:this.attention.status(),jobs:this.store.db.prepare('SELECT status,count(*) AS count FROM jobs GROUP BY status').all(),dirtyTopics:this.store.db.prepare('SELECT * FROM v2_dirty WHERE watermark>processed').all(),coverage:this.store.db.prepare("SELECT count(*) AS parts,sum(CASE WHEN j.status='complete' THEN 1 ELSE 0 END) AS completed FROM v2_event_parts p JOIN jobs j USING(job_id)").get(),memoryCounts:this.store.db.prepare('SELECT kind,status,count(*) AS count FROM memory_nodes GROUP BY kind,status').all(),modelConfigured:this.model.available,embeddingConfigured:!!this.retriever.embedding,modelReceipts:this.store.db.prepare('SELECT receipt FROM v2_model_calls ORDER BY at DESC LIMIT 20').all().map(r=>parse(r.receipt)),reports:this.store.reports(10)};}
  async close(){if(this.closed)return;if(this.closing)return this.closePromise;this.closing=true;clearInterval(this.timer);this.workerAbort?.abort();this.closePromise=(async()=>{this.attention.close();await Promise.allSettled([...this.pending]);this.store.close();this.archive.close();this.closed=true;})();return this.closePromise;}
}
