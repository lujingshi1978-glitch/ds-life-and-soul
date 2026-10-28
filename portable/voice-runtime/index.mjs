import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODEL_SOURCE = Object.freeze({
  repoId: 'Systran/faster-whisper-small',
  revision: '536b0662742c02347bc0e980a01041f333bce120',
  endpoint: 'https://huggingface.co',
  modelSha256: '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671',
  files: Object.freeze(['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt']),
});
export const DEPENDENCY_GROUPS = Object.freeze({
  voice: Object.freeze(['PySide6>=6.5,<7', 'sounddevice==0.5.6', 'numpy>=1.26,<3',
    'faster-whisper==1.2.1', 'av>=13,<19', 'huggingface-hub>=0.34,<3', 'edge-tts>=7.3.1,<8']),
  'media-files': Object.freeze(['Pillow>=10.3,<14', 'python-docx>=1.2,<2']),
  'pdf-agpl': Object.freeze(['PyMuPDF>=1.26,<3']),
});
const MODULES = {
  voice: {'PySide6.QtWidgets':'PySide6', 'PySide6.QtMultimedia':'PySide6', sounddevice:'sounddevice',
    numpy:'numpy', faster_whisper:'faster-whisper', av:'av', huggingface_hub:'huggingface-hub', edge_tts:'edge-tts'},
  'media-files': {PIL:'Pillow', docx:'python-docx'},
  'pdf-agpl': {pymupdf:'PyMuPDF'},
};
const HEALTH_SCRIPT = `import importlib,importlib.metadata,json,sys
checks={};versions={};failure=False
for module,package in json.loads(sys.argv[1]).items():
 try:
  importlib.import_module(module);checks[module]={'ok':True};versions[package]=importlib.metadata.version(package)
 except Exception as error:
  checks[module]={'ok':False,'error':type(error).__name__};failure=True
print(json.dumps({'ok':not failure,'python':sys.version.split()[0],'checks':checks,'versions':versions}))`;

class RuntimeFailure extends Error {
  constructor(code, phase) {super(code); this.code = code; this.phase = phase;}
}
const exists = async file => {try {await fs.access(file); return true;} catch {return false;}};
async function jsonFile(file) {
  try {
    const stat=await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size>16*1024*1024) return null;
    return JSON.parse(await fs.readFile(file,'utf8'));
  } catch {return null;}
}
async function writeJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2)+'\n', {mode:0o600, flag:'wx'});
  await fs.rename(temporary, file);
}
async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
function selectedGroups(options) {
  const groups = [...new Set([...(options.voice === true ? ['voice'] : []), ...(options.groups || [])])];
  if (groups.some(group => !Object.hasOwn(DEPENDENCY_GROUPS, group))) throw new RuntimeFailure('UNKNOWN_DEPENDENCY_GROUP', 'selection');
  return groups;
}
export function voiceRuntimePaths(repoRoot, platform = process.platform) {
  if (!repoRoot || !path.isAbsolute(repoRoot)) throw new RuntimeFailure('ABSOLUTE_REPO_ROOT_REQUIRED', 'paths');
  const root = path.resolve(repoRoot), mediaRoot = path.join(root, 'work', 'integration-runtime', 'media');
  const venv = path.join(mediaRoot, '.venv');
  return {repoRoot:root, mediaRoot, venv,
    python: platform === 'win32' ? path.join(venv,'Scripts','python.exe') : path.join(venv,'bin','python'),
    manifest:path.join(mediaRoot,'voice-runtime.json'), lock:path.join(mediaRoot,'.voice-install.lock'),
    model:path.join(root,'.local','models','whisper-small'), modelParent:path.join(root,'.local','models'),
    hfHome:path.join(root,'.local','huggingface'), hfCache:path.join(root,'.local','huggingface','hub'),
    localAsr:path.join(HERE,'local-asr.py')};
}
async function guardPaths(paths) {
  // Refuse reparse/symlink parents rather than silently writing outside repoRoot.
  for (const target of [paths.mediaRoot, paths.venv, paths.modelParent, paths.model, paths.hfHome]) {
    let current = paths.repoRoot;
    for (const segment of path.relative(paths.repoRoot,target).split(path.sep).filter(Boolean)) {
      current = path.join(current,segment);
      try {if ((await fs.lstat(current)).isSymbolicLink()) throw new RuntimeFailure('SYMLINK_RUNTIME_PATH', 'paths');}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
  }
}
export function voiceLaunchEnvironment(repoRoot, {clientConfigPath, platform=process.platform} = {}) {
  const paths = voiceRuntimePaths(repoRoot,platform);
  const value = {FEIYU_MEDIA_PYTHON:paths.python, FEIYU_ASR_MODEL:paths.model,
    FEIYU_ASR_SCRIPT:paths.localAsr, PYTHONUTF8:'1'};
  if (clientConfigPath) {
    if (!path.isAbsolute(clientConfigPath)) throw new RuntimeFailure('ABSOLUTE_CLIENT_CONFIG_REQUIRED','paths');
    value.FEIYU_HOTKEY_CONFIG = clientConfigPath;
  }
  return value;
}
function isolatedEnv(paths, {network=false} = {}) {
  return {...process.env, PYTHONPATH:'', PYTHONHOME:'', PYTHONUTF8:'1', PYTHONDONTWRITEBYTECODE:'1',
    HF_HOME:paths.hfHome, HF_HUB_CACHE:paths.hfCache, HF_ENDPOINT:'https://huggingface.co',
    HF_TOKEN:'', HUGGING_FACE_HUB_TOKEN:'', HUGGINGFACE_TOKEN:'', HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',
    HF_HUB_DISABLE_TELEMETRY:'1', HF_HUB_DISABLE_XET:'1', HF_HUB_OFFLINE:network?'0':'1',
    TRANSFORMERS_OFFLINE:network?'0':'1', PIP_CONFIG_FILE:process.platform==='win32'?'NUL':'/dev/null',
    PIP_INDEX_URL:'https://pypi.org/simple', PIP_EXTRA_INDEX_URL:'', PIP_TRUSTED_HOST:'',
    PIP_NO_INPUT:'1', PIP_DISABLE_PIP_VERSION_CHECK:'1'};
}
export async function runProcess(command, args, {cwd,env,timeoutMs=300000}={}) {
  return new Promise((resolve,reject) => {
    const child = spawn(command,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let stdout='', stderr='', overflow=false;
    const collect = key => chunk => {if (key==='out') stdout+=chunk; else stderr+=chunk;
      if (stdout.length+stderr.length>2*1024*1024) {overflow=true; child.kill();}};
    child.stdout.on('data',collect('out')); child.stderr.on('data',collect('err'));
    const timer=setTimeout(()=>child.kill(),timeoutMs);
    child.once('error',error=>{clearTimeout(timer);reject(new RuntimeFailure(error.code==='ENOENT'?'PYTHON_NOT_FOUND':'PROCESS_START_FAILED','process'));});
    child.once('close',(code,signal)=>{clearTimeout(timer); resolve({code:overflow?-2:code??-1,stdout,stderr,signal});});
  });
}
async function checked(run, command, args, options) {
  let result;
  try {result=await run(command,args,{...options,capture:true});} catch {throw new RuntimeFailure('PROCESS_START_FAILED',options.phase);}
  // Adapters that throw on nonzero status may return only {stdout}.
  const code=result?.code ?? result?.exitCode ?? (typeof result?.stdout==='string'?0:undefined);
  if (code !== 0) throw new RuntimeFailure('PROCESS_FAILED',options.phase);
  return result;
}
async function inspectModel(directory, source, {verifyHashes=true}={}) {
  const manifest=await jsonFile(path.join(directory,'feiyu-model.json'));
  if (!manifest || manifest.version!==1 || manifest.status!=='ready') return {ready:false,status:'missing-or-incomplete'};
  if (manifest.source?.repoId!==source.repoId || manifest.source?.revision!==source.revision || manifest.source?.modelSha256!==source.modelSha256) return {ready:false,status:'source-mismatch'};
  const files=[];
  for (const name of source.files) {
    let stat;
    try {stat=await fs.lstat(path.join(directory,name));} catch {return {ready:false,status:'missing-file',file:name};}
    const record=manifest.files?.find(file=>file.name===name);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || !record || stat.size!==record.size) return {ready:false,status:'invalid-file',file:name};
    if (verifyHashes && await hashFile(path.join(directory,name))!==record.sha256) return {ready:false,status:'hash-mismatch',file:name};
    files.push({name,size:stat.size,sha256:record.sha256});
  }
  if (files.find(file=>file.name==='model.bin')?.sha256!==source.modelSha256) return {ready:false,status:'model-checksum-mismatch'};
  return {ready:true,status:'ready',integrity:verifyHashes?'sha256-verified':'manifest-and-size',files,source:manifest.source};
}
export async function inspectVoiceRuntime(options={}) {
  const paths=voiceRuntimePaths(options.repoRoot,options.platform), run=options.run||runProcess;
  const groups=selectedGroups({...options,voice:true}), source=options.modelSource||MODEL_SOURCE;
  try {await guardPaths(paths);} catch {return {ready:false,runtimeReady:false,cacheReady:false,status:'unsafe-path',paths};}
  const prior=await jsonFile(paths.manifest);
  const cache=await inspectModel(paths.model,source,{verifyHashes:options.verifyHashes!==false});
  let runtime={ok:false,status:'python-missing'};
  if (await exists(paths.python)) {
    try {
      const modules=Object.assign({},...groups.map(group=>MODULES[group]));
      const result=await checked(run,paths.python,['-B','-I','-c',HEALTH_SCRIPT,JSON.stringify(modules)],
        {cwd:paths.repoRoot,env:isolatedEnv(paths),timeoutMs:60000,phase:'health',allowNetwork:false});
      runtime=JSON.parse(result.stdout);
      if (!runtime || typeof runtime.ok!=='boolean') throw new Error('bad health');
    } catch {runtime={ok:false,status:'dependency-check-failed'};}
  }
  return {ready:runtime.ok===true&&cache.ready,runtimeReady:runtime.ok===true,cacheReady:cache.ready,
    status:runtime.ok===true&&cache.ready?'ready':prior?.status==='failed'?'failed':'not-ready',
    runtime,cache,manifest:prior,paths,
    launchEnv:voiceLaunchEnvironment(paths.repoRoot,{clientConfigPath:options.clientConfigPath,platform:options.platform})};
}
export async function downloadOfficialModel({python,destination,paths,run=runProcess}) {
  return checked(run,python,['-B',path.join(HERE,'download-model.py'),destination],
    {cwd:paths.repoRoot,env:isolatedEnv(paths,{network:true}),timeoutMs:30*60*1000,phase:'model-download',allowNetwork:true});
}
async function sealModel(directory, source) {
  const files=[];
  for (const name of source.files) {
    if (path.basename(name)!==name) throw new RuntimeFailure('INVALID_MODEL_FILENAME','model-verify');
    const file=path.join(directory,name),stat=await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size===0) throw new RuntimeFailure('MODEL_FILE_INVALID','model-verify');
    if (name.endsWith('.json')) {
      const parsed=await jsonFile(file);
      if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new RuntimeFailure('MODEL_JSON_INVALID','model-verify');
    }
    files.push({name,size:stat.size,sha256:await hashFile(file)});
  }
  if (files.find(file=>file.name==='model.bin')?.sha256!==source.modelSha256) throw new RuntimeFailure('MODEL_CHECKSUM_MISMATCH','model-verify');
  const manifest={version:1,status:'ready',createdAt:new Date().toISOString(),source:{...source},files};
  await writeJson(path.join(directory,'feiyu-model.json'),manifest);
  return manifest;
}
export async function installVoiceRuntime(options={}) {
  const groups=selectedGroups(options);
  if (!groups.includes('voice')) return {status:'skipped',ready:false,reason:'voice-not-selected',installedGroups:[]};
  const paths=voiceRuntimePaths(options.repoRoot,options.platform), run=options.run||runProcess;
  const source=options.modelSource||MODEL_SOURCE, downloadModel=options.downloadModel||downloadOfficialModel;
  // The modelSource seam exists for synthetic fixture tests. A production install
  // always uses the fixed official source unless the caller explicitly replaces it.
  if (options.modelSource && options.allowFixtureModel!==true) throw new RuntimeFailure('MODEL_SOURCE_OVERRIDE_REQUIRES_FIXTURE_OPT_IN','selection');
  await guardPaths(paths);
  if (!(await exists(paths.repoRoot))) throw new RuntimeFailure('REPO_ROOT_MISSING','paths');
  await fs.mkdir(paths.mediaRoot,{recursive:true});
  let lock;
  try {lock=await fs.open(paths.lock,'wx',0o600);} catch {return {status:'busy',ready:false,reason:'installation-lock',paths};}
  let stage='start';
  const manifest={version:1,status:'installing',startedAt:new Date().toISOString(),installedGroups:groups,
    dependencies:Object.fromEntries(groups.map(group=>[group,DEPENDENCY_GROUPS[group]])),fixture:options.allowFixtureModel===true};
  try {
    await writeJson(paths.manifest,manifest);
    if (!(await exists(paths.python))) {
      stage='venv';
      const base=options.pythonCommand|| (process.platform==='win32'?['py','-3']:['python3']);
      const command=Array.isArray(base)?base[0]:base, prefix=Array.isArray(base)?base.slice(1):[];
      await checked(run,command,[...prefix,'-m','venv',paths.venv],
        {cwd:paths.repoRoot,env:isolatedEnv(paths),timeoutMs:180000,phase:stage,allowNetwork:false});
      if (!(await exists(paths.python))) throw new RuntimeFailure('VENV_PYTHON_MISSING',stage);
    }
    stage='dependencies';
    const requirements=[...new Set(groups.flatMap(group=>DEPENDENCY_GROUPS[group]))];
    await checked(run,paths.python,['-m','pip','install','--disable-pip-version-check','--no-input','--index-url','https://pypi.org/simple','--timeout','30','--retries','1','--progress-bar','off',...(process.platform==='win32'?['--constraint',path.join(HERE,'constraints-voice-windows-py311.txt')]:[]),...requirements],
      {cwd:paths.repoRoot,env:isolatedEnv(paths,{network:true}),timeoutMs:15*60*1000,phase:stage,allowNetwork:true});
    let cache=await inspectModel(paths.model,source);
    if (!cache.ready) {
      stage='model-download';
      await fs.mkdir(paths.modelParent,{recursive:true});
      await fs.mkdir(paths.hfCache,{recursive:true});
      const staging=path.join(paths.modelParent,`.whisper-small-staging-${randomUUID()}`);
      await fs.mkdir(staging);
      await downloadModel({python:paths.python,destination:staging,paths,run,source});
      stage='model-verify';
      await sealModel(staging,source);
      // Preserve a pre-existing incomplete directory rather than deleting data.
      if (await exists(paths.model)) await fs.rename(paths.model,`${paths.model}.previous-${randomUUID()}`);
      await fs.rename(staging,paths.model);
      cache=await inspectModel(paths.model,source);
      if (!cache.ready) throw new RuntimeFailure('MODEL_CACHE_NOT_READY',stage);
    }
    stage='health';
    const health=await inspectVoiceRuntime({...options,groups,verifyHashes:true});
    if (!health.ready) throw new RuntimeFailure('RUNTIME_HEALTH_NOT_READY',stage);
    manifest.status='ready';manifest.completedAt=new Date().toISOString();manifest.runtime=health.runtime;
    manifest.model={source:{...source},files:cache.files};
    await writeJson(paths.manifest,manifest);
    return {...health,status:'ready',installedGroups:groups,manifest};
  } catch (error) {
    manifest.status='failed';manifest.failedAt=new Date().toISOString();
    manifest.failure={phase:error.phase||stage,code:error instanceof RuntimeFailure?error.code:'INSTALLATION_FAILED'};
    await writeJson(paths.manifest,manifest);
    return {status:'failed',ready:false,failure:manifest.failure,paths,manifest};
  } finally {
    await lock.close();
    await fs.unlink(paths.lock).catch(()=>{});
  }
}
