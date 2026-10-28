import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {synthesizeEdgeSpeech} from './edge-speech.js';
import {mediaPython} from './portable-paths.js';
const run=promisify(execFile);
export function validatePetWave(data){
 if(typeof data!=='string'||data.length>2700000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Error('录音格式或大小无效');
 const b=Buffer.from(data,'base64');if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('需要WAV录音');
 let format=null,size=0;for(let p=12;p+8<=b.length;){const n=b.readUInt32LE(p+4),tag=b.toString('ascii',p,p+4);if(p+8+n>b.length)throw Error('录音未完整上传');if(tag==='fmt '&&n>=16)format={codec:b.readUInt16LE(p+8),channels:b.readUInt16LE(p+10),rate:b.readUInt32LE(p+12),bits:b.readUInt16LE(p+22)};if(tag==='data')size+=n;p+=8+n+(n%2);}
 if(!format||format.codec!==1||format.channels!==1||format.rate!==16000||format.bits!==16||size<3200||size>1920000)throw Error('录音须为16kHz单声道PCM，0.1至60秒');return b;
}
export function petAudioHandlers({root,settings,library}){
 return {transcribe:async({audio},signal)=>{const b=validatePetWave(audio),dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-pet-asr-'));try{const file=path.join(dir,'input.wav');fs.writeFileSync(file,b);const python=mediaPython(root);let r;try{r=await run(python,[path.join(root,'scripts/local-asr.py'),file],{windowsHide:true,signal,timeout:120000,maxBuffer:1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});}catch(e){const type=String(e.stdout||'').match(/"error"\s*:\s*"([A-Za-z0-9_]+)"/)?.[1];throw Error(type==='ModuleNotFoundError'?'本地语音识别组件缺失，请修复Whisper运行环境':type==='LocalEntryNotFoundError'?'本地语音识别模型未完整下载':e.killed?'语音识别超时，请说短一些':'本地语音识别失败'+(type?'（'+type+'）':''));}const result=JSON.parse(r.stdout);if(!result.text?.trim())throw Error('没有识别到说话内容');return {text:result.text.trim(),source:'local-whisper-asr'};}finally{fs.rmSync(dir,{recursive:true,force:true});}},
 speech:async({text},signal)=>{if(typeof text!=='string'||!text.trim()||text.length>500)throw Error('每段朗读需要1至500字');signal.throwIfAborted();const dir=library(),name=await synthesizeEdgeSpeech(text,settings(),dir);signal.throwIfAborted();const bytes=fs.readFileSync(path.join(dir,name));return {audio:bytes.toString('base64'),format:name.endsWith('.wav')?'wav':'mp3'};}};
}
