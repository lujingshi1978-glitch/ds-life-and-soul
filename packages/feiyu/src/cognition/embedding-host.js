import fs from 'node:fs';import path from 'node:path';import {execFile} from 'node:child_process';import {fileURLToPath} from 'node:url';import {safeRoot} from './contracts.js';
import {embeddingHostBudget} from './embedding-launch-config.js';
// Product startup hook: only the explicitly configured local V2 sidecar is managed.
export function embeddingRuntimeMatchesProfile(runtime,profile='existing'){
 if(profile==='lexical')return false;if(profile==='existing')return true;
 const specs={'bge-small-512':['BAAI/bge-small-zh-v1.5@',512],'bge-large-1024':['BAAI/bge-large-zh-v1.5@',1024]},spec=specs[profile];if(!spec)return false;
 try{const model=JSON.parse(fs.readFileSync(path.join(safeRoot(runtime),'model/manifest.json'),'utf8'));return typeof model.modelId==='string'&&model.modelId.startsWith(spec[0])&&model.dimensions===spec[1];}catch{return false;}
}
export function ensureEmbeddingHost({root,runtime,profile='existing',timeoutMs,startupTimeoutMs}){root=safeRoot(root);runtime=safeRoot(runtime);if(!embeddingRuntimeMatchesProfile(runtime,profile))return Promise.reject(Object.assign(new Error('EMBEDDING_RUNTIME_PROFILE_MISMATCH'),{code:'EMBEDDING_RUNTIME_PROFILE_MISMATCH'}));const budget=embeddingHostBudget({timeoutMs,startupTimeoutMs});return new Promise((resolve,reject)=>{
  execFile(process.execPath,[fileURLToPath(new URL('../../scripts/start-cognition-embedding.mjs',import.meta.url)),'--runtime',runtime,'--root',root,'--startup-timeout-ms',String(budget.startupTimeoutMs)],{windowsHide:true,timeout:budget.timeoutMs,maxBuffer:16000},(error,stdout)=>{if(error){reject(new Error('V2_LOCAL_EMBEDDING_START_FAILED'));return;}try{const r=JSON.parse(stdout);resolve({ready:r.ready,dimensions:r.dimensions,endpoint:r.endpoint});}catch{reject(new Error('V2_LOCAL_EMBEDDING_STATUS_INVALID'));}});
});}
