import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {BiliPerception,perceptionOptions} from './bili-perception.js';
const TOOLS=['bili_check_credential','bili_home_feed','bili_search','bili_subtitle','bili_comments','bili_danmaku','bili_video_info','bili_related_videos','bili_like_video','bili_reply'];
export class BiliAdapter {
 constructor({root,home=path.join(os.homedir(),'.dsh','bili-duty'),log=()=>{},think,ffmpegPath}){Object.assign(this,{root,home,log});this.client=null;this.starting=null;this.perception=new BiliPerception({root,home,think,ffmpegPath});}
 async ensure(){if(this.client)return this.client;if(this.starting)return this.starting;this.starting=(async()=>{
  const plugin=path.join(this.root,'plugins/dsh-bili-scroll'),cfg=JSON.parse(fs.readFileSync(path.join(this.home,'config.json'),'utf8'));
  const {McpClient}=await import(pathToFileURL(path.join(plugin,'lib/mcp.mjs')).href);
  const source=path.join(plugin,'vendor/bilibili-mcp/mcp_server.py'),target=path.join(this.home,'mcp_server.py');if(fs.readFileSync(source,'utf8')!==fs.readFileSync(target,'utf8'))fs.copyFileSync(source,target);
  this.client=new McpClient({command:cfg.pythonPath||path.join(this.home,'.venv','Scripts','python.exe'),args:[target],cwd:this.home,env:{PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',BILI_MCP_TOOLS:TOOLS.join(',')},log:this.log});return this.client;
 })();try{return await this.starting;}finally{this.starting=null;}}
 async call(name,args={},signal,{guard,onSubmit}={}){if(!TOOLS.includes(name))throw Error('B站活动工具不允许');const check=()=>{signal?.throwIfAborted();guard?.();};check();const c=await this.ensure();check();const cancel=()=>this.close();signal?.addEventListener('abort',cancel,{once:true});try{const value=await c.call(name,args,{timeoutMs:60000,signal,guard:check,onSubmit:['bili_like_video','bili_reply'].includes(name)?onSubmit:undefined});signal?.throwIfAborted();if(value?.error)throw Error(String(value.error));return value;}finally{signal?.removeEventListener('abort',cancel);}}
 close(){this.client?.stop();this.client=null;this.perception.close();}
 async check(signal){const r=await this.call('bili_check_credential',{},signal);if(!r.logged_in)throw Error('B站登录不可用，请在现有插件页面重新扫码');return {loggedIn:true};}
 async discover(signal){const r=await this.call('bili_home_feed',{num:20},signal);return r.videos||[];}
 async search(query,signal){if(typeof query!=='string'||!query.trim()||query.length>60||/[\r\n@＠]|https?:|\b\d{7,}\b/.test(query))throw Error('搜索词应为简短公开主题');const r=await this.call('bili_search',{keyword:query,num:12},signal);return r.videos||r.results||[];}
 async related(bvid,signal){return(await this.call('bili_related_videos',{bvid,num:12},signal)).videos||[];}
 async read(item,signal){perceptionOptions(item);const info=await this.call('bili_video_info',{bvid:item.bvid},signal),reads={},errors={};const ops=[['subtitle','bili_subtitle',{}],['comments','bili_comments',{num:20}],['danmaku','bili_danmaku',{num:30}]];
  const results=await Promise.allSettled(ops.map(([,name,args])=>this.call(name,{bvid:item.bvid,...args},signal)));for(let i=0;i<ops.length;i++){const key=ops[i][0],r=results[i];if(r.status==='fulfilled')reads[key]=r.value;else errors[key]=String(r.reason?.message||r.reason).slice(0,200);}signal?.throwIfAborted();
  if((item.start||item.end!=null)&&Array.isArray(reads.subtitle?.timeline)){const s=reads.subtitle,timeline=s.timeline.filter(x=>x.to>(item.start||0)&&x.from<(item.end??Infinity));reads.subtitle={...s,text:timeline.map(x=>x.text).join('\n'),timeline,window:{start:item.start||0,end:item.end??null},partial:true};}
  const resource={platform:'bilibili',bvid:item.bvid,url:'https://www.bilibili.com/video/'+item.bvid,title:info.title||item.title,info,reads,errors,consumption:'subtitle-comments-danmaku-not-video-playback',writesWatchHistory:false,at:Date.now()};
  try{return await this.perception.enrich(resource,item,signal);}catch(error){signal?.throwIfAborted();resource.errors.perception='视频媒体理解未完成；仅保留成功读取的文本证据';return resource;}
 }
 like(bvid,signal,options){return this.call('bili_like_video',{bvid},signal,options);}
 comment(bvid,text,signal,options){return this.call('bili_reply',{bvid,text,rpid:0,root:0},signal,options);}
}
