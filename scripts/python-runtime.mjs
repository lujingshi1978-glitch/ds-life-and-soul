import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const versionScript='import json,sys;print(json.dumps({"major":sys.version_info.major,"minor":sys.version_info.minor}))';
const fail=message=>{throw Error(message);};
// Probe only installed interpreters; never ask the launcher to download one.
// An explicit selection fails closed instead of silently choosing a different Python.
export function resolvePython311({env=process.env,platform=process.platform,run=execFileSync,exists=fs.existsSync}={}){
  const probeEnv={...env};delete probeEnv.PYLAUNCHER_ALLOW_INSTALL;delete probeEnv.PYLAUNCHER_ALWAYS_INSTALL;
  const isAbsolute=platform==='win32'?path.win32.isAbsolute:path.isAbsolute;
  const probe=command=>{
    try{
      const out=run(command[0],[...command.slice(1),'-I','-c',versionScript],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:probeEnv});
      const version=JSON.parse(String(out).trim());return version.major===3&&version.minor===11;
    }catch{return false;}
  };
  if(env.FEIYU_PYTHON){
    const file=env.FEIYU_PYTHON;
    if(!isAbsolute(file)||!exists(file)||!probe([file]))fail('FEIYU_PYTHON须指向可用的Python 3.11解释器绝对路径；本次未自动替换该选择。');
    return [file];
  }
  if(platform==='win32'){
    if(probe(['py','-3.11']))return ['py','-3.11'];
    let list='';try{list=String(run('py',['-0p'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536,stdio:['ignore','pipe','pipe'],env:probeEnv}));}catch{}
    // Launcher listings can include vendor-tagged uv/Astral installations which
    // `py -3.11` does not select. Use the reported path, then verify its version.
    const found=new Set();for(const row of list.split(/\r?\n/)){
      const file=row.match(/([A-Za-z]:[\\/].*[\\/]python\.exe)\s*$/i)?.[1];
      if(!file||!isAbsolute(file)||found.has(file.toLowerCase())||!exists(file))continue;
      found.add(file.toLowerCase());if(probe([file]))return [file];
    }
  }
  for(const file of platform==='win32'?['python3.11','python']:['python3.11','python3'])if(probe([file]))return [file];
  fail('未找到Python 3.11。请安装Python 3.11，或用FEIYU_PYTHON指定其解释器绝对路径；未自动下载Python。');
}
