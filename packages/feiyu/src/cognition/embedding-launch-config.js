import path from 'node:path';
import {createHash} from 'node:crypto';

// Pure launch selection: importing this module never starts a process or writes configuration.
export function embeddingLaunchConfig({runtime,manifest,existing=null,port,threads,searchTimeoutMs,indexTimeoutMs,batchSize,similarityThreshold,tokenFactory}){
  if(!manifest||typeof manifest.modelId!=='string'||!manifest.modelId.trim()||!Number.isSafeInteger(manifest.dimensions)||manifest.dimensions<1)throw Error('Invalid embedding model manifest');
  const selectedPort=Number(port??existing?.port??3114);
  if(!Number.isInteger(selectedPort)||selectedPort<1024||selectedPort>65535)throw Error('Invalid port');
  const selectedThreads=Number(threads??existing?.threads??2);
  if(!Number.isInteger(selectedThreads)||selectedThreads<1||selectedThreads>4)throw Error('Invalid threads');
  const numeric=(value,fallback,min,max,label)=>{const n=Number(value??fallback);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid '+label);return n;};
  const searchBudget=numeric(searchTimeoutMs??existing?.searchTimeoutMs,700,100,5000,'search timeout');
  const indexBudget=numeric(indexTimeoutMs??existing?.indexTimeoutMs,15000,1000,60000,'index timeout');
  const selectedBatch=numeric(batchSize??existing?.batchSize,12,1,12,'batch size');
  const thresholdInput=similarityThreshold??existing?.similarityThreshold??.35;
  const threshold=typeof thresholdInput==='string'&&thresholdInput.trim()?Number(thresholdInput):thresholdInput;
  if(typeof threshold!=='number'||!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('Invalid similarity threshold');
  const modelDirectory=path.join(runtime,'model');
  const fingerprint=createHash('sha256').update(JSON.stringify([
    manifest.format,manifest.modelId,manifest.dimensions,manifest.maxTokens,
    manifest.pooling,manifest.normalize,manifest.queryInstruction,
    Object.entries(manifest.files||{}).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>[name,value.sha256])
  ])).digest('hex');
  if(existing&&(existing.port!==selectedPort||existing.modelDirectory!==modelDirectory||
    (existing.modelId!==undefined&&existing.modelId!==manifest.modelId)||
    (existing.dimensions!==undefined&&existing.dimensions!==manifest.dimensions)||
    (existing.modelFingerprint!==undefined&&existing.modelFingerprint!==fingerprint)))throw Error('Existing runtime configuration differs; use a separate runtime directory');
  const token=existing?.token??tokenFactory?.();
  if(typeof token!=='string'||token.length<32)throw Error('Invalid embedding runtime token');
  return {...existing,modelDirectory,port:selectedPort,threads:selectedThreads,searchTimeoutMs:searchBudget,indexTimeoutMs:indexBudget,batchSize:selectedBatch,similarityThreshold:threshold,token,modelId:manifest.modelId,dimensions:manifest.dimensions,modelFingerprint:fingerprint};
}

export function embeddingStartupBudget(value=120000){
  const timeout=Number(value);
  if(!Number.isSafeInteger(timeout)||timeout<60000||timeout>600000)throw Error('Invalid startup timeout');
  return timeout;
}

export function embeddingHostBudget({timeoutMs=150000,startupTimeoutMs}={}){
  const startup=embeddingStartupBudget(startupTimeoutMs),outer=Number(timeoutMs);
  if(!Number.isSafeInteger(outer)||outer<1)throw Error('Invalid host timeout');
  return {startupTimeoutMs:startup,timeoutMs:Math.max(outer,startup+15000)};
}
