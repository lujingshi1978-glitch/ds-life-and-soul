import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {safeRoot} from '../src/cognition/contracts.js';
import {embeddingLaunchConfig,embeddingStartupBudget} from '../src/cognition/embedding-launch-config.js';

const options={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw Error('Expected --option value');options[process.argv[i].slice(2)]=process.argv[i+1];}
if(!options.runtime||!options.root)throw Error('Explicit --runtime and --root required');
const runtime=safeRoot(options.runtime),root=safeRoot(options.root),startupTimeoutMs=embeddingStartupBudget(options['startup-timeout-ms']);
fs.mkdirSync(runtime,{recursive:true});fs.mkdirSync(root,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(runtime,'model','manifest.json'),'utf8'));
const serverConfigFile=path.join(runtime,'server.local.json');
const existing=fs.existsSync(serverConfigFile)?JSON.parse(fs.readFileSync(serverConfigFile,'utf8')):null;
const config=embeddingLaunchConfig({runtime,manifest,existing,port:options.port,threads:options.threads,searchTimeoutMs:options['search-timeout-ms'],indexTimeoutMs:options['index-timeout-ms'],batchSize:options['batch-size'],similarityThreshold:options['similarity-threshold'],tokenFactory:()=>randomBytes(32).toString('hex')}),port=config.port;
fs.writeFileSync(serverConfigFile,JSON.stringify(config,null,2),{mode:0o600});
async function health(){try{const response=await fetch(`http://127.0.0.1:${port}/health`,{headers:{authorization:'Bearer '+config.token},signal:AbortSignal.timeout(2000),redirect:'error'});if(!response.ok)throw Error('Existing port rejected authentication');const data=await response.json();if(data.model!==manifest.modelId||data.dimensions!==manifest.dimensions)throw Error('Existing embedding service model mismatch');return data;}catch(e){if(e.cause?.code==='ECONNREFUSED')return null;throw e;}}
let data=await health(),child;
if(!data){
  const python=options.python||path.join(runtime,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
  if(!path.isAbsolute(python)||!fs.existsSync(python))throw Error('Isolated Python runtime missing');
  const script=fileURLToPath(new URL('./cognition-v2-embedding-server.py',import.meta.url));
  const stdout=fs.openSync(path.join(runtime,'server.stdout.log'),'a'),stderr=fs.openSync(path.join(runtime,'server.stderr.log'),'a');
  try{child=spawn(python,[script,'--config',serverConfigFile],{cwd:runtime,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});child.unref();}finally{fs.closeSync(stdout);fs.closeSync(stderr);}
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  fs.writeFileSync(path.join(runtime,'server.pid.json'),JSON.stringify({pid:child.pid,script,configFile:serverConfigFile,port,model:manifest.modelId},null,2));
  const startupAt=Date.now();
  while(Date.now()-startupAt<startupTimeoutMs){await delay(500);data=await health();if(data)break;}
  if(!data)throw Error('Embedding startup timed out; inspect V2 runtime server.stderr.log');
}
const embedding={enabled:true,endpoint:`http://127.0.0.1:${port}/v1/embeddings`,modelId:manifest.modelId,dimensions:manifest.dimensions,searchTimeoutMs:config.searchTimeoutMs,indexTimeoutMs:config.indexTimeoutMs,batchSize:config.batchSize,similarityThreshold:config.similarityThreshold,token:config.token};
// Separate local profiles preserve both complete embedding identities. Choosing
// 512D later can reuse its existing bucket without overwriting a 1024D token.
const profileFile=manifest.dimensions===512&&manifest.modelId.startsWith('BAAI/bge-small-zh-v1.5@')?'embedding-small-512.local.json':manifest.dimensions===1024&&manifest.modelId.startsWith('BAAI/bge-large-zh-v1.5@')?'embedding-large-1024.local.json':null;
if(profileFile)fs.writeFileSync(path.join(root,profileFile),JSON.stringify(embedding,null,2),{mode:0o600});
fs.writeFileSync(path.join(root,'embedding.local.json'),JSON.stringify(embedding,null,2),{mode:0o600});
console.log(JSON.stringify({ready:true,root,model:data.model,dimensions:data.dimensions,endpoint:embedding.endpoint,remote:false},null,2));
