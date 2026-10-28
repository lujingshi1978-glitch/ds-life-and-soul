import {monitorChildHttp} from '../src/http-liveness.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {portOpen,lockAlive} from '../src/system-services.js';
const root=fileURLToPath(new URL('../',import.meta.url)),state=path.join(root,'state'),lock=path.join(state,'bridge-supervisor.lock');
fs.mkdirSync(state,{recursive:true});
const journal=value=>fs.appendFileSync(path.join(state,'bridge-supervisor.jsonl'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,...value})+'\n');
try{fs.writeFileSync(lock,String(process.pid),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(lockAlive(lock))process.exit(0);fs.unlinkSync(lock);try{fs.writeFileSync(lock,String(process.pid),{flag:'wx'});}catch{process.exit(0);}}
let stopping=false,child;
journal({event:'started',parentPid:process.ppid});
process.on('exit',code=>journal({event:'exit',code}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill();});
try{while(!stopping){
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
 if(await portOpen(Number(cfg.consolePort)||3100)){await new Promise(r=>setTimeout(r,5000));continue;}
 const code=await new Promise(resolve=>{child=spawn(process.execPath,[path.join(root,'src','bridge.js')],{cwd:root,windowsHide:true,stdio:'inherit'});const ownedChild=child;const health=monitorChildHttp(ownedChild,{url:'http://127.0.0.1:'+(Number(cfg.consolePort)||3100)+'/health/live',isCurrent:()=>!stopping&&child===ownedChild,onStatus:status=>{fs.writeFileSync(path.join(state,'bridge-http-health.json'),JSON.stringify(status));if(!status.ok)journal({event:'http-liveness-failed',...status});},onUnresponsive:status=>{journal({event:'http-liveness-restart',...status});ownedChild.kill();}});journal({event:'child-started',childPid:child.pid});child.once('error',e=>{health.close();journal({event:'child-error',error:e.code||e.message});resolve(1);});child.once('exit',(code,signal)=>{health.close();journal({event:'child-exit',code,signal});resolve(code);});});
 child=null;if(code===2)await new Promise(r=>setTimeout(r,5000));else if(!stopping)await new Promise(r=>setTimeout(r,3000));
}}finally{try{if(fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}catch{}}
