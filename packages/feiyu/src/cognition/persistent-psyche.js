import {hash,json,parse,clip,fail,unit,terms,CognitionError} from './contracts.js';
import {basisSources,psycheBasisSnapshot} from './basis-sources.js';
import {tuningFor} from '../runtime-tuning.js';

const uniqueRefs=(rows,key)=>[...new Map(rows.map(row=>[key(row),row])).values()].sort((a,b)=>key(a).localeCompare(key(b)));
const sources=rows=>uniqueRefs(rows,r=>r.sourceId+'@'+r.revision);
const memories=rows=>uniqueRefs(rows,r=>r.id+'@'+r.revision);
const threadRefs=rows=>uniqueRefs(rows,r=>r.id+'@'+r.revision);
const similar=(a,b)=>{const x=new Set(terms(a)),y=new Set(terms(b));return x.size&&y.size?[...x].filter(t=>y.has(t)).length/Math.min(x.size,y.size):0;};
const kind=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
function invalid(path,rule,{code='V3_INVALID_PSYCHOLOGY_DELTA',expected,actual}={}){
  // Diagnostics describe the contract, never the rejected psychological prose.
  const error=new CognitionError(code,`${code}: ${path} ${rule}`);error.details={domain:'psychology',path,rule,...(expected!==undefined?{expected}:{}),...(actual!==undefined?{actual}:{})};throw error;
}
function operation(op,path){if(!op||typeof op!=='object'||Array.isArray(op))invalid(path,'must be an object',{expected:'object',actual:kind(op)});}
function arrayOfIds(value,path){if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!id.trim()))invalid(path,'must be an array of nonempty IDs',{expected:'string[]',actual:kind(value)});}
function prose(text,path,{inherited=false,maxChars=600}={}){if(typeof text!=='string'||!text.trim())invalid(path,'must contain nonempty text',{expected:'nonempty string',actual:kind(text)});if(!inherited&&[...text].length>maxChars)invalid(path,`must contain at most ${maxChars} characters`,{expected:{maxChars},actual:{chars:[...text].length}});}

// Background feelings keep their own history. The present inner voice is one
// separately versioned, model-integrated projection, never a string collage.
export class PersistentPsyche{
  constructor(inner){this.i=inner;this.db=inner.db;this.db.exec(`CREATE TABLE IF NOT EXISTS v3_psyche_threads(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS v3_psyche_versions(id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS v3_psyche_projection_current(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS v3_psyche_projection_versions(id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(id,revision));
    CREATE TABLE IF NOT EXISTS v3_psyche_projection_lineage(revision INTEGER PRIMARY KEY,parent_revision INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS psyche_projection_parent ON v3_psyche_projection_lineage(parent_revision);
    CREATE TABLE IF NOT EXISTS v3_psyche_projection_dependencies(revision INTEGER NOT NULL,kind TEXT NOT NULL,target_id TEXT NOT NULL,target_revision INTEGER NOT NULL,observation_json TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(revision,kind,target_id,target_revision));
    CREATE INDEX IF NOT EXISTS psyche_projection_evidence ON v3_psyche_projection_dependencies(kind,target_id,target_revision);`);
    if(!this.db.prepare('PRAGMA table_info(v3_psyche_projection_dependencies)').all().some(c=>c.name==='observation_json')){this.db.exec("ALTER TABLE v3_psyche_projection_dependencies ADD COLUMN observation_json TEXT NOT NULL DEFAULT '{}'");inner.meta('psycheProjectionIndexedRevision',0);}
    if(!inner.meta('psycheVersionBindingsV2')){
      let exact=0,unresolved=0;
      const states=this.db.prepare('SELECT v.body_json,c.rowid commit_sequence FROM v3_inner_states s JOIN v3_inner_versions v ON v.object_id=s.object_id AND v.revision=s.revision JOIN v3_inner_commits c ON c.commit_id=v.commit_id ORDER BY s.rowid').all().map(r=>({...parse(r.body_json),commitSequence:r.commit_sequence}));
      for(const version of this.db.prepare('SELECT * FROM v3_psyche_versions').all()){
        const body=parse(version.body);if(!body.objectIds?.length||body.objectRefs&&!body.unversionedObjectIds?.length)continue;
        const state=states.find(s=>(s.psychologyThreads||[]).some(t=>t.id===version.id&&t.revision===version.revision));
        const refs=body.objectIds.map(id=>body.objectRefs?.find(r=>r.id===id)||state?.continuity?.find(r=>r.id===id)||(state?this.db.prepare('SELECT v.object_id id,v.revision FROM v3_inner_versions v JOIN v3_inner_commits c ON c.commit_id=v.commit_id WHERE v.object_id=? AND c.rowid<=? ORDER BY c.rowid DESC,v.revision DESC LIMIT 1').get(id,state.commitSequence):null)).filter(Boolean);
        body.objectRefs=refs;body.unversionedObjectIds=body.objectIds.filter(id=>!refs.some(r=>r.id===id));exact+=refs.length;unresolved+=body.unversionedObjectIds.length;
        this.db.prepare('UPDATE v3_psyche_versions SET body=? WHERE id=? AND revision=?').run(json(body),version.id,version.revision);
        this.db.prepare('UPDATE v3_psyche_threads SET body=? WHERE id=? AND revision=?').run(json(body),version.id,version.revision);
      }
      inner.meta('psycheVersionBindingsV2',{exact,unresolved});
    }
    for(const table of ['v3_psyche_threads','v3_psyche_versions'])this.db.prepare(`UPDATE ${table} SET body=json_remove(body,'$.resolutionReason') WHERE status='merged' AND json_type(body,'$.resolutionReason') IS NOT NULL`).run();
    for(const t of this.list({includeInactive:true})){
      let refs=t.sourceRefs||[];try{refs=basisSources(this.i.runtime,refs);}catch{}
      const memories=new Set((t.memoryRefs||[]).map(m=>m.id)),sources=new Set(refs.map(s=>s.sourceId));
      for(const id of t.objectIds||[])for(const e of this.db.prepare('SELECT e.memory_id,e.source_id FROM v3_inner_evidence e JOIN v3_inner_objects o ON o.object_id=e.object_id AND o.current_revision=e.object_revision WHERE e.object_id=?').all(id)){if(e.memory_id)memories.add(e.memory_id);if(e.source_id)sources.add(e.source_id);}
      for(const id of memories)for(const e of this.db.prepare('SELECT DISTINCT source_id FROM memory_evidence WHERE memory_id=?').all(id))sources.add(e.source_id);
      const body={...t,sourceRefs:refs,reviewMemoryIds:(t.reviewMemoryIds||[]).filter(id=>memories.has(id)),reviewSourceIds:(t.reviewSourceIds||[]).filter(id=>sources.has(id))};
      if(json([body.sourceRefs,body.reviewMemoryIds,body.reviewSourceIds])!==json([t.sourceRefs||[],t.reviewMemoryIds||[],t.reviewSourceIds||[]]))this.write(t.id,body,t.status);
    }
    const indexed=inner.meta('psycheProjectionIndexedRevision')||0;for(const row of this.db.prepare('SELECT revision,body FROM v3_psyche_projection_versions WHERE revision>? ORDER BY revision').all(indexed))this.indexProjection(row.revision,parse(row.body));
  }
  list({includeInactive=false}={}){return this.db.prepare('SELECT * FROM v3_psyche_threads ORDER BY updated_at DESC,id').all().filter(r=>includeInactive||['active','quiet'].includes(r.status)).map(r=>({...parse(r.body),id:r.id,revision:r.revision,status:r.status,updatedAt:r.updated_at}));}
  write(id,body,status='active'){
    const {id:unusedId,revision:unusedRevision,status:unusedStatus,updatedAt:unusedUpdatedAt,...clean}=body;body=clean;
    body.objectRefs??=(body.objectIds||[]).map(id=>({id,revision:this.i.object(id)?.current_revision})).filter(r=>r.revision);
    const old=this.db.prepare('SELECT * FROM v3_psyche_threads WHERE id=?').get(id),before=old?parse(old.body):null,at=this.i.now();
    // Evidence bookkeeping and re-reading cannot make an old feeling new.
    const feltChanged=!before||['text','kind','importance','intensity'].some(k=>before[k]!==body[k]);
    body.feltAt=!before?(body.feltAt??body.createdAt??at):feltChanged?at:(before.feltAt??before.createdAt??old.updated_at);
    if(old&&old.status===status&&json(before)===json(body))return id;
    const revision=(old?.revision||0)+1;
    this.db.prepare('INSERT OR REPLACE INTO v3_psyche_threads VALUES(?,?,?,?,?)').run(id,revision,status,json(body),at);
    this.db.prepare('INSERT INTO v3_psyche_versions VALUES(?,?,?,?,?)').run(id,revision,status,json(body),at);return id;
  }
  current({includeInvalid=false}={}){
    const row=this.db.prepare("SELECT * FROM v3_psyche_projection_current WHERE id='current'").get();if(!row)return null;
    const value={...parse(row.body),revision:row.revision,status:row.status,updatedAt:row.updated_at};
    if(row.status!=='valid')return includeInvalid?{...value,text:''}:null;
    return value;
  }
  writeProjection(body,status='valid'){
    const old=this.db.prepare("SELECT * FROM v3_psyche_projection_current WHERE id='current'").get();
    body={...body,sourceRefs:sources(body.sourceRefs||[]),memoryRefs:memories(body.memoryRefs||[]),basisThreadRefs:threadRefs(body.basisThreadRefs||[])};
    body.basisSnapshot=psycheBasisSnapshot(this.i.runtime,body);
    if(old&&old.status===status&&json(parse(old.body))===json(body))return this.current({includeInvalid:true});
    const revision=(old?.revision||0)+1,at=this.i.now();
    if(body.previousProjectionRevision!==undefined&&(!Number.isInteger(body.previousProjectionRevision)||body.previousProjectionRevision>=revision||!this.db.prepare("SELECT 1 FROM v3_psyche_projection_versions WHERE id='current' AND revision=?").get(body.previousProjectionRevision)))fail('V3_INVALID_PSYCHOLOGY_LINEAGE');
    this.db.prepare('INSERT OR REPLACE INTO v3_psyche_projection_current VALUES(?,?,?,?,?)').run('current',revision,status,json(body),at);
    this.db.prepare('INSERT INTO v3_psyche_projection_versions VALUES(?,?,?,?,?)').run('current',revision,status,json(body),at);
    this.indexProjection(revision,body);
    return this.current({includeInvalid:true});
  }
  indexProjection(revision,body){
    const add=(kind,id,version,observation={})=>{if(id&&Number.isInteger(version))this.db.prepare("INSERT INTO v3_psyche_projection_dependencies VALUES(?,?,?,?,?) ON CONFLICT(revision,kind,target_id,target_revision) DO UPDATE SET observation_json=excluded.observation_json WHERE observation_json='{}'").run(revision,kind,id,version,json(observation));};
    if(Number.isInteger(body.previousProjectionRevision))this.db.prepare('INSERT OR REPLACE INTO v3_psyche_projection_lineage VALUES(?,?)').run(revision,body.previousProjectionRevision);
    const index=evidence=>{const snapshot=psycheBasisSnapshot(this.i.runtime,evidence);for(const ref of snapshot.sources)add('source',ref.sourceId,ref.revision,evidence.basisSnapshot?.sources?.find(s=>s.sourceId===ref.sourceId&&s.revision===ref.revision)||ref);for(const ref of snapshot.memories)add('memory',ref.id,ref.revision,evidence.basisSnapshot?.memories?.find(m=>m.id===ref.id&&m.revision===ref.revision)||ref);for(const ref of evidence.objectRefs||[])add('inner',ref.id,ref.revision);};
    index(body);for(const ref of body.basisThreadRefs||[]){add('psyche',ref.id,ref.revision);const row=this.db.prepare('SELECT body FROM v3_psyche_versions WHERE id=? AND revision=?').get(ref.id,ref.revision);if(row)index(parse(row.body));}
    this.i.meta('psycheProjectionIndexedRevision',Math.max(this.i.meta('psycheProjectionIndexedRevision')||0,revision));
  }
  projectionDescendants(revisions){
    if(!revisions.length)return new Set();return new Set(this.db.prepare('WITH RECURSIVE affected(revision) AS (SELECT value FROM json_each(?) UNION SELECT l.revision FROM v3_psyche_projection_lineage l JOIN affected a ON l.parent_revision=a.revision) SELECT revision FROM affected').all(JSON.stringify(revisions)).map(r=>r.revision));
  }
  evidence(refs){const sources=[],memories=[];for(const ref of refs){if(ref.sourceId)sources.push({sourceId:ref.sourceId,revision:ref.sourceRevision});if(ref.memoryId)memories.push({id:ref.memoryId,revision:ref.memoryRevision});if(ref.eventId)for(const e of this.db.prepare('SELECT source_id,source_revision FROM event_sources WHERE event_id=?').all(ref.eventId))sources.push({sourceId:e.source_id,revision:e.source_revision});}return {sourceRefs:basisSources(this.i.runtime,sources),memoryRefs:[...new Map(memories.map(m=>[m.id+'@'+m.revision,m])).values()]};}
  preflight(patch,refs){
    // The actual delta validator runs before an explicit experience is archived.
    // Roll back all preview rows; no observer, model, file or event is invoked.
    this.db.exec('SAVEPOINT psyche_validate');try{this.apply(patch,refs);}finally{this.db.exec('ROLLBACK TO psyche_validate; RELEASE psyche_validate');}
  }
  apply(patch,refs,{basisReview=false}={}){
    if(patch.summary!==undefined&&(typeof patch.summary!=='string'||[...patch.summary].length>tuningFor(this.i.runtime).text.psycheChars&&patch.summary!==this.compile()))fail('V3_SUMMARY_TOO_LONG');
    const evidence=this.evidence(refs),delta=patch.psychology,beforeThreads=new Map(this.list({includeInactive:true}).map(t=>[t.id,t.revision]));
    if(delta!==undefined&&delta!==null){
      operation(delta,'psychology');
      if(delta.merge!==undefined&&(!Array.isArray(delta.merge)||delta.merge.length>4))invalid('psychology.merge','must contain at most 4 merge operations',{expected:{type:'array',maxItems:4},actual:{type:kind(delta.merge),items:Array.isArray(delta.merge)?delta.merge.length:null}});
      for(const [index,op]of (delta.merge||[]).entries()){
        const opPath=`psychology.merge[${index}]`;operation(op,opPath);arrayOfIds(op.ids,opPath+'.ids');
        if(op.ids.length<2||op.ids.length>8||new Set(op.ids).size!==op.ids.length)invalid(opPath+'.ids','must contain 2 to 8 distinct thread IDs',{expected:{minItems:2,maxItems:8,unique:true},actual:{items:op.ids.length,distinct:new Set(op.ids).size}});
        if(typeof op.reason!=='string'||!op.reason.trim())invalid(opPath+'.reason','must explain why these feelings can be integrated',{expected:'nonempty string',actual:kind(op.reason)});prose(op.text,opPath+'.text',{maxChars:tuningFor(this.i.runtime).text.psycheThreadChars});
        const old=op.ids.map(id=>this.list().find(t=>t.id===id));if(old.some(t=>!t))invalid(opPath+'.ids','must reference active or quiet background threads',{code:'V3_UNKNOWN_PSYCHOLOGY_THREAD',expected:'IDs from before.psychology / the current maintenance batch',actual:{unknownCount:old.filter(t=>!t).length}});
        if(op.expectedRevisions!==undefined&&(!Array.isArray(op.expectedRevisions)||op.expectedRevisions.length!==op.ids.length||old.some(t=>op.expectedRevisions.find(r=>r?.id===t.id)?.revision!==t.revision)))invalid(opPath+'.expectedRevisions','must match each exact selected thread revision',{code:'V3_PSYCHOLOGY_VERSION_CONFLICT',expected:old.map(t=>({id:t.id,revision:t.revision}))});
        const body={text:op.text,kind:op.kind||'integrated-feeling',importance:Math.max(...old.map(t=>t.importance)),intensity:Math.max(...old.map(t=>t.intensity)),createdAt:Math.min(...old.map(t=>t.createdAt)),reason:clip(op.reason,300),objectIds:[...new Set(old.flatMap(t=>t.objectIds||[]))],objectRefs:old.flatMap(t=>t.objectRefs||[]),sourceRefs:[...new Map(old.flatMap(t=>t.sourceRefs||[]).map(x=>[x.sourceId+'@'+x.revision,x])).values()],memoryRefs:[...new Map(old.flatMap(t=>t.memoryRefs||[]).map(x=>[x.id+'@'+x.revision,x])).values()],mergedFrom:op.ids};
        body.uncertainBasis=old.some(t=>t.uncertainBasis);body.reviewMemoryIds=[...new Set(old.flatMap(t=>t.reviewMemoryIds||[]))];body.reviewSourceIds=[...new Set(old.flatMap(t=>t.reviewSourceIds||[]))];
        body.reviewDisposition=old.some(t=>t.uncertainBasis&&(!t.reviewDisposition||t.reviewDisposition==='pending'))?'pending':old.some(t=>t.reviewDisposition==='reviewed-unresolved')?'reviewed-unresolved':'needs-primary-evidence';
        const mergedId=this.write('psyche:'+hash([op.ids,op.text]).slice(0,28),body);for(const t of old)this.write(t.id,{...t,mergedInto:mergedId},'merged');
        if(body.uncertainBasis)this.db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('psyche',?,'evidence-changed',?)").run(mergedId,body.reviewDisposition);
      }
      for(const key of ['add','update','resolve','release'])if(delta[key]!==undefined&&(!Array.isArray(delta[key])||delta[key].length>8))invalid('psychology.'+key,'must contain at most 8 operations',{expected:{type:'array',maxItems:8},actual:{type:kind(delta[key]),items:Array.isArray(delta[key])?delta[key].length:null}});
      const operations=['add','update','resolve','release'].flatMap(key=>(delta[key]||[]).map((op,index)=>({op,path:`psychology.${key}[${index}]`,operation:key})));
      for(const entry of operations){
        const {path:opPath}=entry;operation(entry.op,opPath);const op={...entry.op,...(['resolve','release'].includes(entry.operation)?{operation:entry.operation}:{})};
        if((op.id!==undefined||entry.operation!=='add')&&(typeof op.id!=='string'||!op.id.trim()))invalid(opPath+'.id','must identify the existing selected background thread',{code:'V3_UNKNOWN_PSYCHOLOGY_THREAD',expected:'nonempty thread ID from before.psychology / the current maintenance batch',actual:kind(op.id)});
        const old=op.id?this.list().find(t=>t.id===op.id):null;if(op.id&&!old)invalid(opPath+'.id','must reference an active or quiet background thread',{code:'V3_UNKNOWN_PSYCHOLOGY_THREAD',expected:'ID from before.psychology / the current maintenance batch'});
        if(op.expectedRevision!==undefined&&(!old||old.revision!==op.expectedRevision))invalid(opPath+'.expectedRevision','must match the selected thread revision',{code:'V3_PSYCHOLOGY_VERSION_CONFLICT',expected:old?.revision??null});
        if(old&&(typeof op.reason!=='string'||!op.reason.trim()))invalid(opPath+'.reason','must explain the real change or why the feeling can be released',{code:'V3_PSYCHOLOGY_CHANGE_REASON_REQUIRED',expected:'nonempty string',actual:kind(op.reason)});
        const text=op.text??old?.text;prose(text,opPath+'.text',{inherited:!!old&&(op.text===undefined||op.text===old.text),maxChars:tuningFor(this.i.runtime).text.psycheThreadChars});
        const objectIds=op.objectIds??old?.objectIds??[];arrayOfIds(objectIds,opPath+'.objectIds');for(const id of objectIds)if(!this.i.object(id))invalid(opPath+'.objectIds','must reference known inner objects',{code:'V3_UNKNOWN_OBJECT',expected:'inner: object IDs from before.ongoing'});
        for(const key of ['memoryIds','eventIds'])if(op[key]!==undefined)arrayOfIds(op[key],opPath+'.'+key);
        const selected=(op.memoryIds||op.eventIds)?refs.filter(r=>op.memoryIds?.includes(r.memoryId)||op.eventIds?.includes(r.eventId)):refs;
        if((op.memoryIds||[]).some(id=>!refs.some(r=>r.memoryId===id))||(op.eventIds||[]).some(id=>!refs.some(r=>r.eventId===id)))invalid(opPath,'must select evidence from this integration input',{code:'V3_UNKNOWN_PSYCHOLOGY_EVIDENCE',expected:'memoryIds from recalled and eventIds from newEvents'});
        const used=this.evidence(selected),reviewed=old?.uncertainBasis&&((basisReview&&used.sourceRefs.some(s=>(old.sourceRefs||[]).some(p=>p.sourceId===s.sourceId)&&this.i.runtime.archive.get(s.sourceId,s.revision).metadata.notPrimaryEvidence!==true))||used.sourceRefs.some(s=>(old.sourceRefs||[]).some(p=>p.sourceId===s.sourceId&&s.revision>p.revision))||used.memoryRefs.some(m=>this.i.store.edges(m.id).some(e=>['supersedes','contradicts'].includes(e.relation)&&e.from_id===m.id&&(old.reviewMemoryIds||[]).includes(e.to_id))));
        const body={...old,text,...(old&&op.reason&&(!old.uncertainBasis||reviewed)?{uncertainBasis:false,reviewDisposition:'resolved',reviewMemoryIds:[],reviewSourceIds:[]}:{}),kind:op.kind||old?.kind||'feeling',importance:unit(op.importance,old?.importance??.6),intensity:unit(op.intensity,old?.intensity??.5),objectIds,objectRefs:objectIds.map(id=>({id,revision:this.i.object(id).current_revision})),reason:clip(op.reason||'真实经历引起的感受',300),createdAt:old?.createdAt||this.i.now(),sourceRefs:[...new Map([...(old?.sourceRefs||[]),...used.sourceRefs].map(x=>[x.sourceId+'@'+x.revision,x])).values()],memoryRefs:[...new Map([...(old?.memoryRefs||[]),...used.memoryRefs].map(x=>[x.id+'@'+x.revision,x])).values()]};
        const same=!op.id&&this.list().find(t=>t.text===body.text&&t.kind===body.kind&&json(sources(t.sourceRefs||[]))===json(sources(body.sourceRefs||[]))&&json(memories(t.memoryRefs||[]))===json(memories(body.memoryRefs||[]))&&json(t.objectIds||[])===json(body.objectIds||[]));
        if(!same)this.write(op.id||'psyche:'+hash([text,evidence,this.i.now()]).slice(0,28),body,op.operation==='resolve'?'resolved':op.operation==='release'?'released':'active');
      }
    }
    // A summary from an old queue or a foreground turn updates only the
    // coherent present voice. Background feelings require an explicit delta.
    if(patch.summary!==undefined){
      if(typeof patch.summary!=='string'||[...patch.summary].length>tuningFor(this.i.runtime).text.psycheChars&&patch.summary!==this.compile())fail('V3_SUMMARY_TOO_LONG');
      const prior=this.current(),changed=this.list({includeInactive:true}).filter(t=>beforeThreads.get(t.id)!==t.revision),basis=changed.filter(t=>t.status!=='redacted');
      const tuning=tuningFor(this.i.runtime),selected=this.background({limit:tuning.text.psycheContextThreads,maxChars:tuning.text.psycheContextChars}),direct={text:patch.summary.trim(),sourceRefs:sources(evidence.sourceRefs),memoryRefs:memories(evidence.memoryRefs),basisThreadRefs:threadRefs([...basis,...selected].map(t=>({id:t.id,revision:t.revision})))};
      if(!(prior&&!basis.length&&direct.text===prior.text&&json(direct.sourceRefs)===json(prior.sourceRefs)&&json(direct.memoryRefs)===json(prior.memoryRefs)&&json(direct.basisThreadRefs)===json(prior.basisThreadRefs)))this.writeProjection({...direct,...(prior?{previousProjectionRevision:prior.revision}:{})});
    }
    return this.compile();
  }
  attended({query='',limit=8,attentionIds=[]}={}){
    const now=this.i.now(),cues=new Set(terms(query)),hints=parse(this.i.head()?.attention_json||'[]'),ids=new Set([...attentionIds,...hints.flatMap(h=>[h.threadId,h.objectId].filter(Boolean))]);
    const hintedText=hints.map(h=>h.focus||'').join(' '),candidates=this.list().filter(t=>t.text).map(t=>{
      const explicit=ids.has(t.id)||(t.objectIds||[]).some(id=>ids.has(id)),fresh=Math.exp(-Math.max(0,now-(t.feltAt??t.createdAt??t.updatedAt??now))/172800000),queryMatch=terms(t.text).some(w=>cues.has(w));
      const processNote=/^(?:audit|debug|verification|maintenance|technical-boundary)$/i.test(t.kind||'');
      return {...t,score:unit(t.importance,.5)*.25+unit(t.intensity,.5)*.15+fresh*.3+(explicit?.7:0)+(queryMatch?.3:0)+similar(t.text,hintedText)*.15-(processNote?.2:0)};
    });
    const selected=[];while(candidates.length&&selected.length<Math.max(0,Math.min(64,limit))){
      candidates.sort((a,b)=>(b.score-Math.max(0,...selected.map(t=>similar(t.text,b.text)))*.42)-(a.score-Math.max(0,...selected.map(t=>similar(t.text,a.text)))*.42)||(b.feltAt??b.createdAt??0)-(a.feltAt??a.createdAt??0)||a.id.localeCompare(b.id));
      selected.push(candidates.shift());
    }return selected;
  }
  background({query='',limit=8,maxChars=1800,attentionIds=[],attentionOnly=false}={}){
    const selectedIds=new Set([...attentionIds,...parse(this.i.head()?.attention_json||'[]').flatMap(t=>[t.threadId,t.objectId].filter(Boolean))]);
    const out=[];let count=0;for(const row of this.attended({query,limit:Math.max(limit,32),attentionIds})){
      if(attentionOnly&&(row.status!=='active'||!selectedIds.has(row.id)&&!(row.objectIds||[]).some(id=>selectedIds.has(id))))continue;
      const size=[...row.text].length;if(count+size>maxChars)continue;out.push(row);count+=size;if(out.length>=limit)break;
    }return out;
  }
  maintenanceBatch({limit=16,cursor=null,offset=0}={}){
    if(cursor!==null&&typeof cursor!=='string')fail('V3_INVALID_PSYCHOLOGY_CURSOR');
    const rows=this.list().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),start=cursor?rows.findIndex(t=>t.id>cursor):Math.max(0,Number.isInteger(offset)?offset:0),remaining=start<0?[]:rows.slice(start),threads=remaining.slice(0,Math.max(1,Math.min(64,limit))),hasMore=remaining.length>threads.length;
    return {threads,total:rows.length,hasMore,nextCursor:hasMore?threads.at(-1)?.id||cursor:null,fingerprint:this.pressure().fingerprint};
  }
  pressure(){const rows=this.list(),chars=rows.reduce((n,t)=>n+[...t.text].length,0),projection=this.current({includeInvalid:true}),tuning=tuningFor(this.i.runtime);return {threads:rows.length,chars,softThreadLimit:tuning.text.psycheBackgroundThreads,softCharLimit:tuning.text.psycheBackgroundChars,needsCompression:rows.length>tuning.text.psycheBackgroundThreads||chars>tuning.text.psycheBackgroundChars,needsProjectionReview:projection?projection.status!=='valid':rows.length>0,projectionRevision:projection?.revision||0,fingerprint:hash(rows.map(t=>[t.id,t.text,t.status,t.kind,t.importance,t.intensity,t.sourceRefs,t.memoryRefs,t.uncertainBasis,t.reviewDisposition]).sort((a,b)=>a[0].localeCompare(b[0])))};}
  compile(){
    const row=this.db.prepare("SELECT status FROM v3_psyche_projection_current WHERE id='current'").get();if(row)return this.current()?.text||'';
    // A legacy installation has no projection yet. Preserve one complete old
    // view until the model integrates it; never concatenate or cut sentences.
    const head=this.i.head()?.mental_summary;if(head)return head;
    return this.list().find(t=>!t.uncertainBasis&&t.text)?.text||'';
  }
  invalidate(memoryIds,sourceIds,objectVersions,{redact=false,memoryRefs,sourceRefs}={}){
    const original=this.list({includeInactive:true}),byId=new Map(original.map(t=>[t.id,t]));
    const impacted=t=>t.memoryRefs?.some(m=>memoryIds.includes(m.id)&&(!memoryRefs||memoryRefs.some(r=>r.id===m.id&&r.revision===m.revision)))||t.sourceRefs?.some(s=>sourceIds.includes(s.sourceId)&&(!sourceRefs||sourceRefs.some(r=>r.sourceId===s.sourceId&&r.revision===s.revision)))||(t.objectRefs||[]).some(r=>objectVersions.some(o=>o.id===r.id&&o.revision===r.revision));
    const projectionRow=this.db.prepare("SELECT * FROM v3_psyche_projection_current WHERE id='current'").get(),projection=projectionRow?parse(projectionRow.body):null;
    const threadAffected=new Set(original.filter(impacted).map(t=>t.id)),seeds=new Set(),find=(kind,id,revision)=>{for(const row of this.db.prepare('SELECT revision FROM v3_psyche_projection_dependencies WHERE kind=? AND target_id=? AND (? IS NULL OR target_revision=?)').all(kind,id,revision??null,revision??null))seeds.add(row.revision);};
    for(const id of memoryIds){const exact=memoryRefs?.filter(r=>r.id===id);if(exact?.length)for(const ref of exact)find('memory',id,ref.revision);else find('memory',id);}
    for(const id of sourceIds){const exact=sourceRefs?.filter(r=>r.sourceId===id);if(exact?.length)for(const ref of exact)find('source',id,ref.revision);else find('source',id);}
    for(const ref of objectVersions)find('inner',ref.id,ref.revision);
    const projectionAffected=this.projectionDescendants([...seeds]);
    // Historical versions stay available for audit except explicit forgetting.
    // An invalid present projection is withheld until a model re-integrates it.
    if(redact)for(const row of this.db.prepare('SELECT * FROM v3_psyche_projection_versions').all())if(projectionAffected.has(row.revision))this.db.prepare("UPDATE v3_psyche_projection_versions SET body='{}',status='redacted' WHERE id=? AND revision=?").run(row.id,row.revision);
    if(projection&&projectionAffected.has(projectionRow.revision))this.writeProjection({...projection,text:'',invalidation:{kind:redact?'forgotten':'evidence-changed',memoryIds:[...new Set(memoryIds)],sourceIds:[...new Set(sourceIds)]}},redact?'redacted':'needs-review');
    else if(!projection&&threadAffected.size){
      // Disable legacy fallback as soon as its provenance changes.
      this.writeProjection({text:'',sourceRefs:[],memoryRefs:[],basisThreadRefs:[],invalidation:{kind:redact?'forgotten':'evidence-changed',memoryIds:[...new Set(memoryIds)],sourceIds:[...new Set(sourceIds)]}},redact?'redacted':'needs-review');
    }
    const restore=new Map(),seen=new Set();
    // Historical redaction does not mutate the independently revised current thread.
    if(redact)for(const v of this.db.prepare('SELECT * FROM v3_psyche_versions').all())if(impacted(parse(v.body)))this.db.prepare("UPDATE v3_psyche_versions SET body='{}',status='redacted' WHERE id=? AND revision=?").run(v.id,v.revision);
    const independent=t=>{if(seen.has(t.id))return;seen.add(t.id);for(const id of t.mergedFrom||[]){const c=byId.get(id);if(c?.status!=='merged')continue;if(impacted(c))independent(c);else if(c.text)restore.set(id,c);}};
    if(redact)for(const t of original)if(['active','quiet'].includes(t.status)&&impacted(t))independent(t);
    const affected=[];for(const t of original)if(impacted(t)){
      if(['active','quiet'].includes(t.status))affected.push(t.id);this.write(t.id,{...t,text:redact?'':t.text,uncertainBasis:!redact,reviewDisposition:redact?'redacted':'pending',reviewMemoryIds:[...new Set([...(t.reviewMemoryIds||[]),...memoryIds.filter(id=>(t.memoryRefs||[]).some(m=>m.id===id))])],reviewSourceIds:[...new Set([...(t.reviewSourceIds||[]),...sourceIds.filter(id=>(t.sourceRefs||[]).some(s=>s.sourceId===id))])],reason:redact?'相关内容已遗忘':'依据变化，感受本身仍真实，等待重新理解'},redact?'redacted':t.status);
      if(!redact&&['active','quiet'].includes(t.status))this.db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('psyche',?,'evidence-changed','pending')").run(t.id);

    }
    for(const t of restore.values()){const {mergedInto,resolutionReason,...body}=t;this.write(t.id,{...body,reason:body.reason||'保留独立感受'},'active');if(t.uncertainBasis)this.db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('psyche',?,'evidence-changed',?)").run(t.id,t.reviewDisposition||'pending');}
    return affected;
  }
}
