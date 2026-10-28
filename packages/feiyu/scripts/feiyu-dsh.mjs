// Shared by the one-click launcher and fixture tests. Importing never installs,
// starts DSH, reads credentials, sends messages or changes a running process.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const CORE_BUNDLES = Object.freeze(['qq-mode-console', 'qq-agent-presets', 'qq-contact-memory', 'qq-intimacy-judge', 'qq-qzone-review', 'feiyu-life']);
export const OPTIONAL_BUNDLES = Object.freeze(['dsh-bili-scroll', 'dsh-read-animation']);
const digest = value => createHash('sha256').update(value).digest('hex');
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
const samePath = (a,b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const serialize = value => JSON.stringify(value, null, 2) + '\n'; // JSON is valid YAML.
const atomic = (file, content) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, content, {flag:'wx'}); try { fs.renameSync(tmp,file); } finally { if(fs.existsSync(tmp))fs.unlinkSync(tmp); } };

export function profilePaths({dshHome, profile = 'feiyu'}) {
  if (!dshHome || !path.isAbsolute(dshHome)) throw new Error('Explicit absolute dshHome required');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profile) || ['node_modules','con','nul','prn','aux'].includes(profile.toLowerCase())) throw new Error('Invalid profile name');
  const dir = path.join(dshHome, 'profiles', profile);
  if(fs.existsSync(dir)&&fs.lstatSync(dir).isSymbolicLink())throw new Error('Profile directory must not be a link');
  return {dir, manifest:path.join(dir,'package.json'), patch:path.join(dir,'cordis.patch.yml'), journal:path.join(dir,'.feiyu-life-install.json')};
}

function selectedBundles(bundleRoot, optional) {
  if (!path.isAbsolute(bundleRoot)) throw new Error('Explicit absolute bundleRoot required');
  if (!Array.isArray(optional) || optional.some(x=>!OPTIONAL_BUNDLES.includes(x))) throw new Error('Unknown optional bundle');
  return [...CORE_BUNDLES, ...new Set(optional)].map(name=>{
    const directory=path.join(bundleRoot,'plugins',name), pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
    if(pkg.name!==name || !pkg.dsh?.bundle?.patch)throw new Error(`Not a native DSH bundle: ${name}`);
    const patches=Array.isArray(pkg.dsh.bundle.patch)?pkg.dsh.bundle.patch:[pkg.dsh.bundle.patch];
    for(const file of patches){const resolved=path.resolve(directory,file);if(!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())throw new Error(`Missing bundle patch: ${name}`);}
    return {name,directory};
  });
}

export function createMcpEntries(bundleRoot, nodePath=process.execPath) {
  if(!path.isAbsolute(nodePath)||!fs.existsSync(nodePath))throw new Error('Installed Node executable required');
  return [
    ['mcp-snowluma','snowluma','mcp-snowluma-safe.js',725000],
    ['mcp-feiyu-apps','feiyu-apps','mcp-feiyu-apps.js',195000],
    ['mcp-web-search-safe','web-search-safe','mcp-web-search-safe.js',null],
  ].map(([id,serverName,file,timeout])=>{
    const script=path.join(bundleRoot,'src',file);
    if(!fs.existsSync(script))throw new Error(`Missing MCP source: ${file}`);
    return {id,name:'@deepseek-ai/dsh-mcp-client',config:{serverName,transport:'stdio',command:nodePath,args:[script],env:{FEIYU_BRIDGE_URL:process.env.FEIYU_BRIDGE_URL||'http://127.0.0.1:3100'},...(timeout?{toolCallTimeoutMs:timeout}:{})}};
  });
}

// This plan is concrete and side-effect-free. The caller can show it before apply.
export function planProfile({root,bundleRoot=root,dshHome,profile='feiyu',optional=[],mcp=true,nodePath=process.execPath,bridgeUrl='http://127.0.0.1:3100'}) {
  const locations=profilePaths({dshHome,profile});
  if(fs.existsSync(locations.journal))throw new Error('Already managed; call inspectProfile or uninstallProfile first');
  const bundles=selectedBundles(bundleRoot,optional), oldManifest=read(locations.manifest), oldPatch=read(locations.patch);
  const pkg=oldManifest?JSON.parse(oldManifest):{name:`dsh-profile-${profile}`,private:true,dependencies:{},dsh:{profile:{bundles:[]}}};
  const patches=oldPatch?yaml.load(oldPatch):[];
  if(!Array.isArray(patches))throw new Error('Existing profile patch must be a YAML array');
  pkg.dependencies??={};pkg.dsh??={};pkg.dsh.profile??={};pkg.dsh.profile.bundles??=[];
  if(!Array.isArray(pkg.dsh.profile.bundles))throw new Error('Invalid profile bundle list');
  const links=[];
  for(const {name,directory} of bundles){
    if(Object.hasOwn(pkg.dependencies,name)||pkg.dsh.profile.bundles.includes(name))throw new Error(`Existing unmanaged bundle conflicts: ${name}`);
    const link=path.join(locations.dir,'node_modules',name);
    if(fs.existsSync(link)||fs.lstatSync(path.dirname(link),{throwIfNoEntry:false})?.isSymbolicLink())throw new Error(`Existing plugin link conflicts: ${name}`);
    links.push({link,target:fs.realpathSync(directory)});
    pkg.dependencies[name]=`link:${directory.replaceAll('\\','/')}`;
  }
  for(const name of ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app',...bundles.map(b=>b.name)])if(!pkg.dsh.profile.bundles.includes(name))pkg.dsh.profile.bundles.push(name);
  const inserts=mcp?createMcpEntries(bundleRoot,nodePath):[];
  for(const entry of inserts)entry.config.env.FEIYU_BRIDGE_URL=bridgeUrl;
  const existingIds=new Set(patches.flatMap(p=>p.insert??[]).map(p=>p.id));
  if(inserts.some(p=>existingIds.has(p.id)))throw new Error('Existing MCP entries conflict');
  if(inserts.length)patches.push({insert:inserts});
  const u=new URL(bridgeUrl);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid local bridge URL');
  patches.push({id:'feiyu-life',config:{bridgeUrl:u.origin}});
  // Bili is carried as an optional capability; no daily browsing or social writes.
  if(optional.includes('dsh-bili-scroll'))patches.push({id:'bili-scroll',config:{enabled:false,peakValley:false,autoComment:false,dmMode:'off',dmUid:0,replyToComments:false}});
  return {schemaVersion:1,profile,locations,bundleRoot,optional,mcp,links,bundles:bundles.map(b=>b.name),before:{manifest:oldManifest,patch:oldPatch},after:{manifest:serialize(pkg),patch:serialize(patches)},restartRequired:true};
}

export function installProfile(options) {
  const p=planProfile(options);
  fs.mkdirSync(p.locations.dir,{recursive:true});
  const lock=path.join(p.locations.dir,'.feiyu-life-install.lock');
  fs.writeFileSync(lock,String(process.pid),{flag:'wx'});
  const created=[];
  try{
    if(read(p.locations.manifest)!==p.before.manifest||read(p.locations.patch)!==p.before.patch)throw new Error('Profile changed during planning');
    fs.mkdirSync(path.join(p.locations.dir,'node_modules'),{recursive:true});
    for(const link of p.links){fs.symlinkSync(link.target,link.link,process.platform==='win32'?'junction':'dir');created.push(link);}
    // Write recovery journal before replacing configuration.
    const journal={...p,hashes:{manifest:digest(p.after.manifest),patch:digest(p.after.patch)}};
    fs.writeFileSync(p.locations.journal,serialize(journal),{flag:'wx',mode:0o600});
    atomic(p.locations.manifest,p.after.manifest);atomic(p.locations.patch,p.after.patch);
    return {ok:true,profile:p.profile,bundles:p.bundles,restartRequired:true,processesStarted:false};
  }catch(error){
    // Roll back only bytes written by this attempt and exact links it created.
    for(const key of ['manifest','patch'])if(read(p.locations[key])===p.after[key]){if(p.before[key]===null)fs.unlinkSync(p.locations[key]);else atomic(p.locations[key],p.before[key]);}
    for(const link of created.reverse())if(fs.lstatSync(link.link,{throwIfNoEntry:false})?.isSymbolicLink()&&samePath(fs.realpathSync(link.link),link.target))fs.unlinkSync(link.link);
    if(fs.existsSync(p.locations.journal))fs.unlinkSync(p.locations.journal);
    throw error;
  }finally{fs.unlinkSync(lock);}
}

export function inspectProfile(options) {
  const p=profilePaths(options), raw=read(p.journal);
  if(!raw)return {ok:false,installed:false,reason:'not-managed'};
  const journal=JSON.parse(raw), changed=[];
  for(const key of ['manifest','patch'])if(digest(read(p[key])??'')!==journal.hashes[key])changed.push(key);
  for(const link of journal.links){try{if(!fs.lstatSync(link.link).isSymbolicLink()||!samePath(fs.realpathSync(link.link),link.target))changed.push('link:'+path.basename(link.link));}catch{changed.push('link:'+path.basename(link.link));}}
  return {ok:changed.length===0,installed:true,profile:journal.profile,bundles:journal.bundles,changed,restartRequired:true};
}

export function uninstallProfile(options) {
  const p=profilePaths(options), health=inspectProfile(options);
  if(!health.installed)return {ok:true,removed:false};
  if(!health.ok)throw new Error('Profile changed since installation; automatic uninstall refused: '+health.changed.join(', '));
  const journal=JSON.parse(read(p.journal));
  // Never delete runtime data, role cards, dependencies or another plugin.
  for(const key of ['manifest','patch']){if(journal.before[key]===null)fs.unlinkSync(p[key]);else atomic(p[key],journal.before[key]);}
  for(const link of journal.links)fs.unlinkSync(link.link);
  fs.unlinkSync(p.journal);
  return {ok:true,removed:true,restartRequired:true,processesStopped:false,dataRemoved:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [action,root,home,profile='feiyu']=process.argv.slice(2), options={bundleRoot:root?path.resolve(root):undefined,dshHome:home?path.resolve(home):undefined,profile};
  try{const run={plan:planProfile,install:installProfile,status:inspectProfile,uninstall:uninstallProfile}[action];if(!run)throw new Error('Usage: node scripts/feiyu-dsh.mjs plan|install|status|uninstall <bundle-root> <dsh-home> [profile]');const result=run(options);console.log(JSON.stringify(action==='plan'?{profile:result.profile,bundles:result.bundles,optional:result.optional,restartRequired:true}:result,null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
