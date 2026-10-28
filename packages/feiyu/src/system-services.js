import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';

export const serviceIds=['snowluma','dsh','bridge','voice','openbiliclaw','pet','watchdog'];
export function localPort(value,fallback){const url=new URL(value||`http://127.0.0.1:${fallback}`);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('统一启动只管理本机服务');return Number(url.port)||(value?(url.protocol==='https:'?443:80):fallback);}
export function serviceDefinitions(root,cfg){
 const upstream=path.join(root,'__external_onebot_not_bundled__');
 const npm=process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming');
 return [
  {id:'snowluma',name:'QQ 上游',port:5099,entry:path.join(upstream,'index.mjs'),cwd:upstream,url:'http://127.0.0.1:5099/'},
  {id:'dsh',name:'DSH',port:localPort(cfg.dsh?.baseUrl,3080),entry:cfg.dsh?.installRoot?path.join(cfg.dsh.installRoot,'lib/bin.js'):path.join(npm,'npm','node_modules','@deepseek-ai','dsh','lib','bin.js'),cwd:path.resolve(root,'../..'),args:['--profile',cfg.dsh?.profile||'feiyu','--port',String(localPort(cfg.dsh?.baseUrl,3081)),'--host','127.0.0.1','--no-open'],url:new URL(cfg.dsh?.baseUrl||'http://127.0.0.1:3080/').origin+'/'},
  {id:'bridge',name:'肥鱼生活台',port:Number(cfg.consolePort)||3100,entry:path.join(root,'scripts','bridge-supervisor.mjs'),cwd:root,url:`http://127.0.0.1:${Number(cfg.consolePort)||3100}/`},
  {id:'openbiliclaw',name:'多网站来源',port:8420,entry:path.join(root,'scripts/start-openbiliclaw.mjs'),cwd:root,url:'http://127.0.0.1:8420/'},
  {id:'pet',name:'语音与透明聊天窗',entry:path.join(root,'scripts/start-hotkey.mjs'),cwd:root,lock:path.join(root,'state/desktop-pet.lock')},
  {id:'voice',name:'语音守护',entry:path.join(root,'scripts','voice-watchdog.mjs'),cwd:root,lock:path.join(root,'state','voice-watchdog.lock')},
  {id:'watchdog',name:'系统守护',entry:path.join(root,'scripts','system-watchdog.mjs'),cwd:root,lock:path.join(root,'state','system-watchdog.lock')},
 ];
}
export function portOpen(port){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};socket.setTimeout(600,()=>finish(false));socket.on('connect',()=>finish(true));socket.on('error',()=>finish(false));});}
export function lockAlive(file){try{const pid=Number(fs.readFileSync(file,'utf8').trim());if(!Number.isSafeInteger(pid)||pid<=0)return false;process.kill(pid,0);return true;}catch{return false;}}
export async function systemStatus(root,cfg){return Promise.all(serviceDefinitions(root,cfg).map(async d=>({id:d.id,name:d.name,url:d.url||null,port:d.port||null,installed:fs.existsSync(d.entry),running:d.port?await portOpen(d.port):lockAlive(d.lock)})));}
export function detachedNode(root,entry,args=[],cwd=root,id='system'){
 if(id==='watchdog'&&process.platform==='win32'){
  if(/["\r\n]/.test(entry+process.execPath))throw Error('无效的系统路径');const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const command="$ErrorActionPreference='Stop';$s=New-CimInstance -CimClass (Get-CimClass Win32_ProcessStartup) -ClientOnly -Property @{ShowWindow=[uint16]0};$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine="+quote('"'+process.execPath+'" "'+entry+'"')+';CurrentDirectory='+quote(cwd)+";ProcessStartupInformation=$s};if($r.ReturnValue -ne 0){throw ('Persistent host start failed: '+$r.ReturnValue)};[Console]::WriteLine([int]$r.ProcessId)";
  const pid=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',command],{windowsHide:true,encoding:'utf8',timeout:30000}).trim());if(!Number.isSafeInteger(pid)||pid<1)throw Error('独立系统守护启动失败');return pid;
 }
 const state=path.join(root,'state');fs.mkdirSync(state,{recursive:true});
 const out=fs.openSync(path.join(state,`${id}.stdout.log`),'a'),err=fs.openSync(path.join(state,`${id}.stderr.log`),'a');
 try{const child=spawn(process.execPath,[entry,...args],{cwd,detached:true,windowsHide:true,stdio:['ignore',out,err]});child.unref();return child.pid;}finally{fs.closeSync(out);fs.closeSync(err);}
}
export async function startServices(root,cfg,selected=serviceIds){
 if(!Array.isArray(selected)||!selected.length||selected.some(id=>!serviceIds.includes(id)))throw Error('无效服务');
 const results=[];
 for(const d of serviceDefinitions(root,cfg).filter(d=>selected.includes(d.id))){
  if(d.id==='snowluma'){results.push({id:d.id,status:'external',message:'OneBot服务须用户自行准备，本包不自动部署或启动'});continue;}
  const running=d.port?await portOpen(d.port):lockAlive(d.lock);
  if(running){results.push({id:d.id,status:'running'});continue;}
  if(!fs.existsSync(d.entry)){results.push({id:d.id,status:'missing',message:'未找到已安装的程序'});continue;}
  const state=path.join(root,'state');fs.mkdirSync(state,{recursive:true});const guard=path.join(state,`system-start-${d.id}.lock`);
  try{fs.writeFileSync(guard,JSON.stringify({pid:process.pid,at:Date.now()}),{flag:'wx'});}catch(e){
    if(e.code!=='EEXIST')throw e;
    let alive=false;try{const old=JSON.parse(fs.readFileSync(guard,'utf8'));process.kill(old.pid,0);alive=Date.now()-old.at<45000;}catch{}
    if(alive){results.push({id:d.id,status:'starting'});continue;}
    try{fs.unlinkSync(guard);fs.writeFileSync(guard,JSON.stringify({pid:process.pid,at:Date.now()}),{flag:'wx'});}catch{results.push({id:d.id,status:'starting'});continue;}
  }
  try{
    const pid=detachedNode(root,d.entry,d.args,d.cwd,d.id);
    for(let i=0;i<60;i++){if(d.port?await portOpen(d.port):lockAlive(d.lock))break;await new Promise(r=>setTimeout(r,250));}
    results.push({id:d.id,status:(d.port?await portOpen(d.port):lockAlive(d.lock))?'running':'starting',pid});
  }finally{try{fs.unlinkSync(guard);}catch{}}
 }
 return results;
}
export function commonSettings(cfg){return {sessionCwd:cfg.sessionCwd||'',ownerQQ:String(cfg.ownerQQ||''),provider:cfg.dsh?.provider||'deepseek-official',model:cfg.dsh?.model||'deepseek-flash',voiceEnabled:cfg.socialV2?.voice?.enabled===true&&cfg.socialV2?.voice?.tts?.enabled===true,voiceProvider:cfg.socialV2?.voice?.tts?.provider||'edge-tts',dsVoice:cfg.socialV2?.voice?.tts?.dsVoice||'mira'};}
export function applyCommonSettings(cfg,body){
 const fields=['sessionCwd','voiceEnabled','voiceProvider','dsVoice'];if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))throw Error('包含不支持的设置');
 const next=structuredClone(cfg);
 if(body.sessionCwd!==undefined){if(typeof body.sessionCwd!=='string'||!path.isAbsolute(body.sessionCwd)||!fs.existsSync(body.sessionCwd)||!fs.statSync(body.sessionCwd).isDirectory())throw Error('工作区必须是已存在的绝对目录');next.sessionCwd=path.resolve(body.sessionCwd);}
 next.socialV2??={};next.socialV2.voice??={};next.socialV2.voice.tts??={};
 const voice=next.socialV2.voice.tts;
 if(body.voiceEnabled!==undefined){if(typeof body.voiceEnabled!=='boolean')throw Error('语音开关无效');voice.enabled=body.voiceEnabled;next.socialV2.voice.enabled=body.voiceEnabled;}
 if(body.voiceProvider!==undefined){if(!['deepseek-official','edge-tts','qwen3-tts'].includes(body.voiceProvider))throw Error('语音引擎无效');voice.provider=body.voiceProvider;}
 if(body.dsVoice!==undefined){if(typeof body.dsVoice!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(body.dsVoice))throw Error('音色标识无效');voice.dsVoice=body.dsVoice;}
 return next;
}
