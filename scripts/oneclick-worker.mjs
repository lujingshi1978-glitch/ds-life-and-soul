import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import * as deploy from './deploy.mjs';
import {secureStatePath} from '../packages/feiyu/src/strict-state-acl.mjs';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),core=path.join(app,'packages/feiyu');
const yaml=createRequire(new URL('../packages/feiyu/package.json',import.meta.url))('js-yaml');
const readYaml=p=>yaml.load(fs.readFileSync(p,'utf8'));
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=s=>createHash('sha256').update(s).digest('hex');
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});const t=p+'.'+process.pid+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n',{mode:0o600});fs.renameSync(t,p);};
const python=path.join(app,'.bundled/python/python.exe');
function secure(p){const r=secureStatePath(p,{skipLinks:true});if(!r.ok)throw Object.assign(Error('本机数据权限检查失败。'),{code:'PRIVATE_ACL_FAILED'});}
function pythonCheck(){const code='import json,sys,PySide6.QtWidgets,PySide6.QtMultimedia,sounddevice,numpy,faster_whisper,av,huggingface_hub,edge_tts,PIL,docx; print(json.dumps({"ok":sys.version_info[:2]==(3,11),"python":sys.version.split()[0]}))';const r=spawnSync(python,['-I','-c',code],{cwd:app,env:{...process.env,PYTHONPATH:'',PYTHONHOME:''},windowsHide:true,encoding:'utf8',timeout:60000});let v;try{v=JSON.parse(r.stdout.trim());}catch{}if(r.status!==0||!v?.ok)throw Object.assign(Error('随包 Python 或语音/资料组件检查未通过。'),{code:'PYTHON_COMPONENTS_FAILED'});return v;}
async function configure(c){
 if(!c.apiKey)return {saved:false};
 if(typeof c.apiKey!=='string'||c.apiKey.length>8192||/[\s\x00-\x1f]/.test(c.apiKey))throw Object.assign(Error('API Key 格式无效。'),{code:'API_KEY_INVALID'});
 const custom=c.provider==='custom',model=(c.model||'deepseek-flash').trim();
 if(!/^[\w./:@-]{1,150}$/.test(model))throw Object.assign(Error('模型名称格式无效。'),{code:'MODEL_INVALID'});
 let endpoint;
 if(custom){let u;try{u=new URL(c.baseURL||'');}catch{throw Object.assign(Error('请输入有效的 API 地址。'),{code:'API_ENDPOINT_INVALID'});}if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||(u.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Object.assign(Error('自定义 API 地址需为 HTTPS；本机服务可使用 HTTP。'),{code:'API_ENDPOINT_INVALID'});endpoint=u.href.replace(/\/$/,'');}
 const setup=read(path.join(app,'.local/installation.json')),dshHome=setup.dshHome;
 const credentials=path.join(dshHome,'.credentials.yaml');fs.mkdirSync(dshHome,{recursive:true});secure(dshHome);
 let creds=fs.existsSync(credentials)?readYaml(credentials):{version:1,refs:{}};
 // DSH may serialize managed credentials and profile patches as YAML after
 // the first launch. Read its safe data schema and preserve unrelated keys.
 if(!creds||creds.version!==1||(creds.refs!==undefined&&(creds.refs===null||typeof creds.refs!=='object'||Array.isArray(creds.refs))))throw Object.assign(Error('请在模型设置页更新已有凭据。'),{code:'CREDENTIAL_LAYOUT'});creds.refs??={};
 const ref=custom?'FEIYU_MODEL_API_KEY':'DEEPSEEK_API_KEY';creds.refs[ref]=c.apiKey;
 const cfgFile=path.join(core,'config.json'),cfg=read(cfgFile);cfg.dsh.provider=custom?'feiyu-custom':'deepseek-official';cfg.dsh.model=model;
 const profile=path.join(dshHome,'profiles',setup.profile),patch=path.join(profile,'cordis.patch.yml'),journal=path.join(profile,'.feiyu-life-install.json');
 let patches=readYaml(patch);if(!Array.isArray(patches))throw Object.assign(Error('模型配置格式无效，请在模型设置页修复。'),{code:'MODEL_CONFIG_INVALID'});patches=patches.filter(x=>x.oneclickModel!==true);
 // Only add ordinary host configuration; no new tools or permissions.
 const defaultPatch={id:'agent-default-model',config:{provider:cfg.dsh.provider,model:cfg.dsh.model}};
 const prior=patches.find(x=>x.id==='agent-default-model'&&x.oneclickModel===undefined);if(prior)prior.config=defaultPatch.config;else patches.push(defaultPatch);
 if(custom){let providerPatch=patches.find(x=>x.id==='llm-pi-ai');if(!providerPatch){providerPatch={id:'llm-pi-ai',config:{providers:{}}};patches.push(providerPatch);}providerPatch.config??={};providerPatch.config.providers??={};providerPatch.config.providers['feiyu-custom']={displayName:'自定义 API',api:'openai-completions',baseURL:endpoint,apiKeyEnv:ref,models:[{id:cfg.dsh.model,name:cfg.dsh.model,contextWindow:128000,maxTokens:8192,input:['text'],reasoningEfforts:false}]};}
 const targets=[credentials,patch,journal,cfgFile],before=targets.map(p=>fs.existsSync(p)?fs.readFileSync(p):null);
 try{write(credentials,creds);secure(credentials);write(patch,patches);if(fs.existsSync(journal)){const j=read(journal);j.after.patch=fs.readFileSync(patch,'utf8');j.hashes.patch=hash(j.after.patch);write(journal,j);}write(cfgFile,cfg);secure(cfgFile);}catch(e){targets.forEach((p,i)=>{if(before[i]===null){if(fs.existsSync(p))fs.unlinkSync(p);}else fs.writeFileSync(p,before[i],{mode:0o600});});throw e;}
 return {saved:true,provider:cfg.dsh.provider,model:cfg.dsh.model};
}
async function openPage(models=false){await deploy.start({open:!models,client:!models});if(models){const c=read(path.join(app,'.local/installation.json')),log=fs.readFileSync(path.join(app,'.local/logs/dsh.stdout.log'),'utf8'),token=deploy.ownDshLaunchToken(log,c.dshPort);if(!token)throw Error('DSH登录令牌未就绪。');const url='http://127.0.0.1:'+c.dshPort+'/?token='+encodeURIComponent(token)+'#/settings/models';const edge=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Microsoft/Edge/Application/msedge.exe')).find(fs.existsSync);if(!edge)throw Object.assign(Error('未找到系统浏览器，请安装 Edge 后重试。'),{code:'BROWSER_MISSING'});const p=spawn(edge,[url],{detached:true,stdio:'ignore',windowsHide:false});p.unref();}return {ok:true,opened:true};}
async function main(){const [action]=process.argv.slice(2);let raw='';for await(const b of process.stdin)raw+=b;const c=raw.trim()?JSON.parse(raw):{};let value;
 if(action==='setup'){
  if(c.existing){const old=read(path.join(app,'.local/installation.json'));if(!fs.existsSync(old.dshInstall))throw Error('随包 DSH 路径不完整。');value={ok:true,preserved:true};}
  else value=await deploy.install({...deploy.DEFAULTS,...c,voice:c.voice!==false,browser:true,video:false,profile:'feiyu',dshHome:path.join(app,'.local/dsh-home'),dshInstall:path.join(app,'.runtime/dsh/node_modules/@deepseek-ai/dsh')},{skipDependencies:true});
  if(c.apiKey)await configure(c);
 }else if(action==='start')value=await deploy.start({open:c.open===true,client:c.client===true});
 else if(action==='open')value=await openPage();
 else if(action==='models')value=await openPage(true);
 else if(action==='stop')value=deploy.stop();
 else if(action==='status')value=await deploy.doctor();
 else if(action==='configure'){const stopped=deploy.stop();if(!stopped.ok)throw Error('请先停止本实例。');value=await configure(c);}
 else if(action==='self-check'){
  if(Number(process.versions.node.split('.')[0])!==24)throw Error('Node版本不符');
  if(!deploy.coreDependenciesReady())throw Error('核心依赖不完整');
  const s=read(path.join(app,'.local/installation.json'));if(read(path.join(s.dshInstall,'package.json')).version!=='0.2.0-rc.2')throw Error('DSH版本不符');
  const life=await import('../packages/feiyu/scripts/feiyu-dsh.mjs');const profile=life.inspectProfile({dshHome:s.dshHome,profile:s.profile});if(!profile.ok)throw Error('DSH插件档案检查失败');
  const py=pythonCheck();value={ok:true,node:process.version,python:py.python,dsh:'0.2.0-rc.2',profile:true};
 }else throw Error('未知操作');
 process.stdout.write(JSON.stringify({oneclickResult:true,ok:true,value})+'\n');}
main().catch(e=>{process.stdout.write(JSON.stringify({oneclickResult:true,ok:false,code:e.code||'COMPONENT_FAILED',message:e.code?e.message:'组件检查失败。请查看本机诊断或保留快照后重试。'})+'\n');process.exitCode=1;});
