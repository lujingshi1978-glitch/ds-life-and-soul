import fs from 'node:fs';
import path from 'node:path';
import {safeRoot,fail,assertSignal} from './contracts.js';

export function localEmbedding(config,{fetchImpl=fetch}={}){
  const url=new URL(config.endpoint);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/v1/embeddings')fail('LOCAL_EMBEDDING_ENDPOINT_REQUIRED');
  if(typeof config.token!=='string'||config.token.length<32||typeof config.modelId!=='string'||!Number.isSafeInteger(config.dimensions)||config.dimensions<1)fail('INVALID_EMBEDDING_CONFIG');
  const searchTimeoutMs=config.searchTimeoutMs??700,indexTimeoutMs=config.indexTimeoutMs??15000,batchSize=config.batchSize??12,similarityThreshold=config.similarityThreshold??.35;
  if(!Number.isSafeInteger(searchTimeoutMs)||searchTimeoutMs<100||searchTimeoutMs>5000||!Number.isSafeInteger(indexTimeoutMs)||indexTimeoutMs<1000||indexTimeoutMs>60000||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>12)fail('INVALID_EMBEDDING_CONFIG');
  if(!Number.isFinite(similarityThreshold)||similarityThreshold<0||similarityThreshold>1)fail('INVALID_EMBEDDING_CONFIG');
  return {modelId:config.modelId,dimensions:config.dimensions,remote:false,searchTimeoutMs,indexTimeoutMs,batchSize,similarityThreshold,
    async embed(texts,{signal,purpose='search'}={}){
      assertSignal(signal);if(!Array.isArray(texts)||!texts.length||texts.length>12||texts.some(t=>typeof t!=='string'||!t.trim()||t.length>6000))fail('INVALID_EMBEDDING_INPUT');
      const timeout=AbortSignal.timeout(purpose==='index'?indexTimeoutMs:searchTimeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
      let response;try{response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+config.token},body:JSON.stringify({model:config.modelId,input:texts,purpose}),signal:combined});}catch(e){assertSignal(signal);fail('LOCAL_EMBEDDING_UNAVAILABLE');}
      if(!response.ok)fail(response.status===409?'EMBEDDING_MODEL_MISMATCH':'LOCAL_EMBEDDING_HTTP_ERROR');
      const reader=response.body.getReader();let size=0;const chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)fail('EMBEDDING_RESPONSE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
      let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_EMBEDDING_RESPONSE');}
      if(result.model!==config.modelId||!Array.isArray(result.data)||result.data.length!==texts.length)fail('EMBEDDING_MODEL_MISMATCH');
      const rows=[...result.data].sort((a,b)=>a.index-b.index);if(rows.some((r,i)=>r.index!==i||!Array.isArray(r.embedding)||r.embedding.length!==config.dimensions||r.embedding.some(v=>!Number.isFinite(v))))fail('INVALID_EMBEDDING_RESPONSE');
      return rows.map(r=>r.embedding);
    }};
}
export const EMBEDDING_PROFILES=Object.freeze({
  existing:Object.freeze({label:'保持已有本地模型'}),
  lexical:Object.freeze({label:'词法与关联图，不使用向量'}),
  'bge-small-512':Object.freeze({label:'BGE small 中文 · 512维',model:'BAAI/bge-small-zh-v1.5',dimensions:512,file:'embedding-small-512.local.json'}),
  'bge-large-1024':Object.freeze({label:'BGE large 中文 · 1024维',model:'BAAI/bge-large-zh-v1.5',dimensions:1024,file:'embedding-large-1024.local.json'})
});

// A profile selects a complete model identity and dimension. It never slices,
// pads, projects or renames vectors, downloads a model, or replaces old indexes.
export function embeddingSelection(root,profile='existing'){
  root=safeRoot(root);if(typeof profile!=='string'||!Object.hasOwn(EMBEDDING_PROFILES,profile))fail('INVALID_EMBEDDING_PROFILE');const spec=EMBEDDING_PROFILES[profile];
  if(profile==='lexical')return {config:undefined,status:{profile,configured:false,enabled:false,reason:'lexical-selected',serviceHealth:'not-probed'}};
  const candidates=profile==='existing'?['embedding.local.json']:[spec.file,'embedding.local.json'];
  let mismatch=false;
  for(const name of candidates){
    const file=path.join(root,name);if(!fs.existsSync(file))continue;
    let config;try{config=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{fail('INVALID_EMBEDDING_CONFIG');}
    if(config.enabled!==true)continue;
    if(spec.model&&(typeof config.modelId!=='string'||!config.modelId.startsWith(spec.model+'@')||config.dimensions!==spec.dimensions)){mismatch=true;continue;}
    // Validate local endpoint, authentication and response contract even during
    // status inspection; none of these credential values leave this function.
    const adapter=localEmbedding(config);
    return {config,status:{profile,configured:true,enabled:true,modelId:adapter.modelId,dimensions:adapter.dimensions,serviceHealth:'not-probed',reason:null}};
  }
  return {config:undefined,status:{profile,configured:false,enabled:false,expectedModel:spec.model||null,dimensions:spec.dimensions||null,reason:mismatch?'configured-model-does-not-match-selection':'local-profile-not-configured',serviceHealth:'not-probed',lexicalFallback:true}};
}

export function embeddingCompatibilityStatus(root,{profile='existing',store,activeEmbedding}={}){
  const {status}=embeddingSelection(root,profile),active=activeEmbedding?{modelId:activeEmbedding.modelId,dimensions:activeEmbedding.dimensions}:null;
  const result={...status,active,requiresRestart:!!active&&(active.modelId!==status.modelId||active.dimensions!==status.dimensions)||!active&&status.enabled,keepsExistingMemories:true,keepsOtherModelIndexes:true,version:3};
  if(!store?.db||!status.modelId)return result;
  const eligible=store.db.prepare("SELECT count(*) n FROM memory_nodes WHERE character_id=? AND status IN ('active','contested','outdated','faded')").get(store.characterId).n;
  // Old 512D installations may predate registry bookkeeping. A complete model
  // key, current revision/content hash and actual valid vector are sufficient;
  // registry absence must not falsely report a reusable index as missing.
  const covered=store.db.prepare(`SELECT count(DISTINCT b.memory_id) n FROM v2_vectors b JOIN memory_nodes n ON n.memory_id=b.memory_id AND n.current_revision=b.revision JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id AND v.revision=n.current_revision AND v.content_hash=b.content_hash WHERE n.character_id=? AND b.model=? AND n.status IN ('active','contested','outdated','faded') AND CASE WHEN json_valid(b.vector) THEN json_array_length(b.vector) ELSE 0 END=? AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(b.vector) THEN b.vector ELSE '[]' END) j WHERE j.type NOT IN ('integer','real'))`).get(store.characterId,status.modelId,status.dimensions).n;
  return {...result,index:{eligible,covered,missing:Math.max(0,eligible-covered),requiresReindex:covered<eligible,coverage:'selected-model-current-memory-versions'}};
}

export function loadLocalEmbedding(root,{profile='existing'}={}){const {config}=embeddingSelection(root,profile);return config?localEmbedding(config):undefined;}
