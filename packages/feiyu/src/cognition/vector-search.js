import {Worker} from 'node:worker_threads';
import {assertSignal} from './contracts.js';
// The SQLite read, JSON decoding and scoring all run off the event loop.
export function vectorSearch(store,query,{embedding,arm='base',viewVersion,limit=30,signal,filters}={}){
 assertSignal(signal);const timeout=embedding.searchTimeoutMs??700;
 return new Promise((resolve,reject)=>{let settled=false,timer;const worker=new Worker(new URL('./vector-search-worker.js',import.meta.url),{execArgv:[],workerData:{file:store.databaseFile,characterId:store.characterId,model:embedding.modelId,dimensions:embedding.dimensions,arm,viewVersion,query,limit,filters,threshold:embedding.similarityThreshold??(arm==='base'?.35:.2)}});
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();if(error)reject(error);else resolve(result);};
  const abort=()=>finish(signal.reason||new Error('Aborted'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  timer=setTimeout(()=>finish(Object.assign(new Error('RETRIEVAL_DEADLINE'),{code:'RETRIEVAL_DEADLINE'})),timeout);timer.unref?.();
  worker.once('message',r=>r.error?finish(Object.assign(new Error(r.error),{code:r.error})):finish(null,r.hits));worker.once('error',e=>finish(e));worker.once('exit',code=>{if(!settled)finish(Object.assign(new Error('VECTOR_WORKER_EXIT'),{code:'VECTOR_WORKER_EXIT'}));});
 });
}
