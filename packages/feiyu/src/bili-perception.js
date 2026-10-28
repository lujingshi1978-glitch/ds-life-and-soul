import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {safeFetchBiliMedia} from './safe-fetch.js';
import {selectKeyframeTimestamps} from '../vendor/czx-bilibili/keyframes.js';
const runFile=promisify(execFile);
export function perceptionOptions(p={}){
 const mode=p.mode||'auto';if(!['auto','text','vision','multimodal'].includes(mode))throw Error('视频模式无效');
 const start=Number(p.start??0),end=p.end==null?null:Number(p.end);if(!Number.isFinite(start)||start<0||start>86400||(end!==null&&(!Number.isFinite(end)||end<=start||end-start>120)))throw Error('片段必须为0至120秒，可分段继续读取');
 return{mode,start,end};
}
export function previewPlan(meta,options){
 const s=meta.snapshot||{},times=Array.isArray(s.index)?s.index:[],cols=Number(s.img_x_len),rows=Number(s.img_y_len),width=Number(s.img_x_size),height=Number(s.img_y_size);
 if(![cols,rows,width,height].every(n=>Number.isInteger(n)&&n>0&&n<=8192)||cols*rows>400||!Array.isArray(s.image))return[];
 const end=Math.min(meta.duration,options.end??meta.duration),span=end-options.start;if(span<=0)return[];
 const targets=selectKeyframeTimestamps([],span,3).map(t=>t.time+options.start);if(!targets.length)targets.push(options.start);
 const used=new Set(),out=[];
 for(const time of targets){let best=-1;for(let i=0;i<times.length;i++)if(Number.isFinite(times[i])&&times[i]>=options.start&&times[i]<end&&(best<0||Math.abs(times[i]-time)<Math.abs(times[best]-time)))best=i;
 if(best<0||used.has(best))continue;used.add(best);const sheet=Math.floor(best/(cols*rows)),cell=best%(cols*rows);if(!s.image[sheet])continue;
 out.push({id:'frame:'+out.length,time:times[best],source:'bilibili-preview-sprite',url:s.image[sheet],crop:{x:(cell%cols)*width,y:Math.floor(cell/cols)*height,width,height}});
 }return out;
}
export class BiliPerception{
 constructor({root,home=path.join(os.homedir(),'.dsh/bili-duty'),think,ffmpegPath=process.env.FFMPEG_PATH||'ffmpeg',run=runFile,download=safeFetchBiliMedia}){Object.assign(this,{root,home,think,ffmpegPath,run,download});this.active=new Set();}
 close(){for(const c of this.active)c.abort();}
 async enrich(resource,requested={},parentSignal){
  const options=perceptionOptions(requested),abort=new AbortController();this.active.add(abort);const signal=parentSignal?AbortSignal.any([parentSignal,abort.signal]):abort.signal;
  const out={version:1,mode:options.mode,frames:[],asr:null,errors:{},window:{start:options.start,end:options.end},coverage:'sampled-evidence-not-full-playback'};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-bili-')),worker=path.join(this.root,'scripts/bili-media-source.py');
  const run=async(bin,args,timeout=30000)=>{signal.throwIfAborted();return this.run(bin,args,{signal,timeout,maxBuffer:2*1024*1024,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});};
  try{
   const cfg=JSON.parse(fs.readFileSync(path.join(this.home,'config.json'),'utf8')),python=cfg.pythonPath||path.join(this.home,'.venv/Scripts/python.exe');
   const meta=JSON.parse((await run(python,[worker,'metadata',resource.bvid],35000)).stdout);if(meta.error)throw Error('视频媒体源暂不可用');
   if(options.start>=meta.duration)throw Error('起点超过视频时长');out.duration=meta.duration;out.pages=meta.pages;out.errors={...meta.errors};
   out.window.end=Math.min(meta.duration,options.end??meta.duration);
   if(options.mode!=='text'){
    // No preview/cover masquerades as watched video: sample actual local footage.
    if(meta.videoUrl)try{
      const video=path.join(dir,'video.mp4');fs.writeFileSync(video,await this.download(meta.videoUrl,40*1024*1024));signal.throwIfAborted();
      const span=out.window.end-options.start,targets=selectKeyframeTimestamps([],span,3);if(!targets.length)targets.push({time:0});
      for(const [i,p]of targets.entries()){const time=p.time+options.start,file=path.join(dir,'extract-'+i+'.jpg');await run(this.ffmpegPath,['-v','error','-y','-ss',String(time),'-i',video,'-frames:v','1','-vf',"scale='min(960,iw)':-2",'-q:v','3',file]);const bytes=fs.readFileSync(file);if(bytes.length<=350000)out.frames.push({id:'frame:'+i,time,source:'ffmpeg-video-frame',_image:{mediaType:'image/jpeg',data:bytes.toString('base64'),name:'frame:'+i}});}
    }catch(e){signal.throwIfAborted();out.errors.frames='真实视频抽帧失败，尝试预览帧'+(e.code==='ENOENT'?'：FFmpeg程序未找到':'');}
    if(!out.frames.length){
    const plan=previewPlan(meta,options),sheets=new Map();
    for(const frame of plan){try{
     let sheet=sheets.get(frame.url);if(!sheet){sheet=path.join(dir,'sprite-'+sheets.size+'.jpg');const bytes=await this.download(frame.url,8*1024*1024);signal.throwIfAborted();fs.writeFileSync(sheet,bytes);sheets.set(frame.url,sheet);}
     const file=path.join(dir,frame.id.replace(':','-')+'.jpg'),c=frame.crop;
     await run(this.ffmpegPath,['-v','error','-y','-threads','1','-i',sheet,'-vf',`crop=${c.width}:${c.height}:${c.x}:${c.y},scale='min(640,iw)':-2`,'-frames:v','1','-q:v','7',file]);
     const bytes=fs.readFileSync(file);if(bytes.length>60000)throw Error('关键帧体积过大');out.frames.push({id:frame.id,time:frame.time,source:frame.source,quality:'low-resolution-preview',nativeWidth:c.width,nativeHeight:c.height,_image:{mediaType:'image/jpeg',data:bytes.toString('base64'),name:frame.id}});
    }catch(e){signal.throwIfAborted();out.errors.frames='部分预览帧获取失败'+(e.code==='ENOENT'?'：FFmpeg程序未找到':'');}}
    }
    if(!out.frames.length)out.errors.frames||='没有取得真实视频帧';
    if(out.frames.length&&!this.think)out.errors.vision='视觉模型尚未连接，不能从关键帧推断画面内容';
    if(out.frames.length&&this.think)try{
      const r=await this.think({prompt:'逐张观察附图，只描述确实可见的内容、文字、动作、界面和反差，不根据标题或弹幕补画面，不猜未展示的前后过程。它们是稀疏采样，不是完整视频。只返回JSON {"frames":[{"id":"给定ID","description":"最多200字","confidence":0.8}]}。来源时间：'+JSON.stringify(out.frames.map(({_image,...f})=>f)),images:out.frames.map(f=>f._image)},signal);
      const descriptions=r.data?.frames;if(!Array.isArray(descriptions))throw Error('视觉结果格式无效');
      for(const frame of out.frames){const d=descriptions.find(x=>x.id===frame.id);if(d&&typeof d.description==='string'&&d.description.trim())Object.assign(frame,{description:d.description.slice(0,200),confidence:Math.max(0,Math.min(1,Number(d.confidence)||0))});}
      if(out.frames.some(f=>!f.description))out.errors.vision='部分采样帧没有得到有效视觉描述';
    }catch{signal.throwIfAborted();out.errors.vision='取得关键帧，但视觉模型未成功理解，不能声称看见具体内容';}
   }
   if(!resource.reads?.subtitle?.text?.trim()&&options.mode!=='vision')try{
    if(!meta.audioUrl)throw Error('没有可用音轨');const audio=path.join(dir,'audio.m4a'),clip=path.join(dir,'clip.wav');fs.writeFileSync(audio,await this.download(meta.audioUrl,20*1024*1024));signal.throwIfAborted();
    const end=Math.min(out.window.end,options.start+120);await run(this.ffmpegPath,['-v','error','-y','-ss',String(options.start),'-i',audio,'-t',String(end-options.start),'-ar','16000','-ac','1',clip]);
    const r=JSON.parse((await run(path.join(this.home,'.venv-asr/Scripts/python.exe'),[worker,'asr',clip],90000)).stdout);if(r.error)throw Error('本地ASR不可用');
    out.asr={source:r.source,language:r.language,text:String(r.text||'').slice(0,12000),noRecognizableSpeech:!String(r.text||'').trim(),segments:(r.segments||[]).slice(0,300).map(s=>({...s,from:s.from+options.start,to:s.to+options.start})),window:{start:options.start,end},partial:end<meta.duration||options.start>0};
   }catch{signal.throwIfAborted();out.errors.asr='本地ASR未成功；不能用标题或评论代替音轨内容';}
   for(const frame of out.frames)delete frame._image;
   resource.perception=out;resource.consumption='subtitle-asr-sampled-frames-and-community-evidence';return resource;
  }finally{this.active.delete(abort);fs.rmSync(dir,{recursive:true,force:true});}
 }
}
