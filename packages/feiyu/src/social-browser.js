import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {collectXhsNoteImages} from './xhs-note-images.js';

export const SOCIAL_ORIGINS={zhihu:'https://www.zhihu.com',youtube:'https://www.youtube.com',xiaohongshu:'https://www.xiaohongshu.com',weibo:'https://weibo.com',tieba:'https://tieba.baidu.com',douyin:'https://www.douyin.com'};
export function socialTarget(platform,input){
 const hosts={bilibili:['www.bilibili.com','bilibili.com','b23.tv'],zhihu:['zhihu.com','www.zhihu.com','zhuanlan.zhihu.com'],youtube:['www.youtube.com','youtube.com','youtu.be'],xiaohongshu:['www.xiaohongshu.com','xiaohongshu.com'],weibo:['weibo.com','www.weibo.com','m.weibo.cn'],tieba:['tieba.baidu.com','www.tieba.com'],douyin:['www.douyin.com','douyin.com']};
 if(!Object.hasOwn(hosts,platform))throw Error('不支持的平台');let value=String(input||'').trim();
 if(platform==='youtube'&&/^[\w-]{11}$/.test(value))value='https://www.youtube.com/watch?v='+value;
 if(platform==='douyin'&&/^\d{6,24}$/.test(value))value='https://www.douyin.com/video/'+value;
 if(platform==='tieba'&&/^\d{6,24}$/.test(value))value='https://tieba.baidu.com/p/'+value;
 if(platform==='weibo'&&/^\d{6,24}$/.test(value))value='https://m.weibo.cn/detail/'+value;
 let u;try{u=new URL(value);}catch{throw Error('请提供该平台的完整内容链接或有效ID');}
 if(u.protocol!=='https:'||u.port||u.username||u.password||!hosts[platform].includes(u.hostname))throw Error('内容链接不属于指定平台');
 return u.href;
}

export async function resolveXhsTarget(input,{request=fetch}={}){
 const match=String(input||'').replaceAll('&amp;','&').match(/https?:\/\/[^\s<>"“”]+/i);if(!match)throw Error('请提供小红书笔记链接或分享文本');let current=match[0].replace(/[，。；！）)]+$/u,'');
 for(let i=0;i<6;i++){
  let u;try{u=new URL(current);}catch{throw Error('小红书链接格式错误');}
  const host=u.hostname;if(u.username||u.password||u.port||!['xiaohongshu.com','www.xiaohongshu.com','xhslink.com','www.xhslink.com'].includes(host)||!['http:','https:'].includes(u.protocol))throw Error('小红书分享链接跳转到不允许的地址');u.protocol='https:';
  if(['xiaohongshu.com','www.xiaohongshu.com'].includes(host)){if(!/^\/(?:explore|discovery\/item|search_result)\/[a-f0-9]{24}\/?$/i.test(u.pathname))throw Error('请提供具体的小红书笔记链接');u.hostname='www.xiaohongshu.com';return socialTarget('xiaohongshu',u.href);}
  const r=await request(u.href,{redirect:'manual',signal:AbortSignal.timeout(12000)});if(![301,302,303,307,308].includes(r.status))throw Error('小红书短链接未返回有效跳转，请复制完整笔记分享链接');const next=r.headers.get('location');await r.body?.cancel();if(!next)throw Error('小红书短链接缺少跳转地址');current=new URL(next,u).href;
 }
 throw Error('小红书分享链接跳转过多');
}

export class SocialBrowser{
 async tiebaRead(target,action,signal){
  const url=socialTarget('tieba',target);signal?.throwIfAborted();
  const context=this.syncPlatform?await this.syncPlatform('tieba'):await this.open({headed:false}),page=await context.newPage();
  const stop=()=>void page.close().catch(()=>{});signal?.addEventListener('abort',stop,{once:true});
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
   const result=await page.evaluate(()=>({title:document.title,url:location.href,posts:[...document.querySelectorAll('.l_post')].slice(0,30).map(p=>({author:p.querySelector('.p_author_name')?.textContent?.trim(),content:p.querySelector('.d_post_content')?.textContent?.trim(),replies:[...p.querySelectorAll('.lzl_content_main')].slice(0,20).map(r=>r.textContent.trim())})).filter(p=>p.content),threads:[...document.querySelectorAll('a.j_th_tit')].slice(0,20).map(a=>({title:a.textContent.trim(),url:a.href}))}));
   if(!result.posts.length&&!result.threads.length)throw Error('贴吧页面没有取得帖子正文，可能需要登录或验证');
   return {...result,source:'rendered-tieba-page',coverage:action==='comments'?'当前页可见楼层及展开的跟评':'当前页正文；未展开的跟评不包含在内'};
  }finally{signal?.removeEventListener('abort',stop);await page.close().catch(()=>{});}
 }
 async weiboPage(target,action,signal){const url=socialTarget('weibo',target),ctx=this.syncPlatform?await this.syncPlatform('weibo'):await this.open({headed:false}),page=await ctx.newPage();const stop=()=>void page.close().catch(()=>{});signal?.addEventListener('abort',stop,{once:true});try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});await page.locator('article.weibo-main .weibo-text').first().waitFor({timeout:12000});if(!page.url().includes(new URL(url).pathname))throw Error('微博页面未停留在指定内容');if(action==='comments'){const comments=await page.locator('.m-text-box > h3').allTextContents();return {url:page.url(),comments:comments.filter(t=>t.trim()).slice(0,20),coverage:'当前可见评论，未声明完整评论列表'};}return {url:page.url(),text:(await page.locator('article.weibo-main .weibo-text').first().innerText()).slice(0,20000),author:await page.locator('.m-text-cut').first().innerText(),coverage:'目标微博网页实际渲染正文，不含视频画面'};}finally{signal?.removeEventListener('abort',stop);await page.close().catch(()=>{});}}
 async weiboRead(target,action,signal){
  const url=socialTarget('weibo',target),id=new URL(url).pathname.split('/').filter(Boolean).at(-1);
  if(!/^[a-zA-Z0-9]{6,24}$/.test(id||''))throw Error('需要具体微博链接');
  const ctx=this.syncPlatform?await this.syncPlatform('weibo'):await this.open({headed:false});
  signal?.throwIfAborted();
  const endpoint=action==='comments'?'https://weibo.com/ajax/statuses/buildComments?is_reload=1&id='+id+'&count=10&is_show_bulletin=2&is_mix=0&fetch_level=0':'https://weibo.com/ajax/statuses/show?id='+id;
  const response=await ctx.request.get(endpoint,{timeout:25000});signal?.throwIfAborted();
  let result;try{result=await response.json();}catch{return this.weiboPage(url,action,signal);}
  if(result.ok===0||!(result.data||result.id||result.idstr))return this.weiboPage(url,action,signal);
  const d=result.data||result;
  if(action==='comments')return {url,comments:Array.isArray(d)?d:d.data||[],coverage:'微博实际返回的评论'};
  if(String(d.idstr||d.id)!==id&&d.bid!==id&&d.mblogid!==id)throw Error('微博返回内容与请求对象不一致');
  return {url,id:String(d.idstr||d.id),author:d.user?.screen_name,text:d.text,createdAt:d.created_at,images:(d.pics||[]).map(p=>p.large?.url||p.url),retweet:d.retweeted_status?{author:d.retweeted_status.user?.screen_name,text:d.retweeted_status.text}:null,coverage:'目标微博正文和附带转发文字'};
 }
 async youtubeFeed(signal){
  signal?.throwIfAborted();const context=this.syncPlatform?await this.syncPlatform('youtube'):await this.open({headed:false}),page=await context.newPage();const stop=()=>void page.close().catch(()=>{});signal?.addEventListener('abort',stop,{once:true});
  try{await page.goto(SOCIAL_ORIGINS.youtube+'/',{waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>!!window.ytInitialData?.contents,{},{timeout:10000});
   const result=await page.evaluate(()=>{const tabs=window.ytInitialData?.contents?.twoColumnBrowseResultsRenderer?.tabs||[],contents=(tabs.find(t=>t.tabRenderer?.selected)||tabs[0])?.tabRenderer?.content?.richGridRenderer?.contents||[],items=[];
    for(const item of contents){const c=item.richItemRenderer?.content,v=c?.videoRenderer,l=c?.lockupViewModel,id=v?.videoId||(l?.contentType==='LOCKUP_CONTENT_TYPE_VIDEO'?l.contentId:null);if(!/^[\w-]{11}$/.test(id||''))continue;items.push({video_id:id,url:'https://www.youtube.com/watch?v='+id,title:v?.title?.runs?.map(r=>r.text).join('')||l?.metadata?.lockupMetadataViewModel?.title?.content||'',channel:v?.ownerText?.runs?.map(r=>r.text).join('')||''});if(items.length>=5)break;}
    return {items,personalized:window.ytcfg?.get?.('LOGGED_IN')===true,source:'rendered-home-recommendations'};});if(!result.items.length)throw Error('YouTube 首页没有取得真实推荐');return result;
  }finally{signal?.removeEventListener('abort',stop);await page.close().catch(()=>{});}
 }
 async zhihuArticle(target,action,signal){
  const url=socialTarget('zhihu',target);if(!/^https:\/\/zhuanlan\.zhihu\.com\/p\/\d+(?:[/?#]|$)/.test(url))throw Error('知乎文章地址无效');
  signal?.throwIfAborted();const context=this.syncPlatform?await this.syncPlatform('zhihu'):await this.open({headed:false}),page=await context.newPage();
  const stop=()=>void page.close().catch(()=>{});signal?.addEventListener('abort',stop,{once:true});
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});await page.locator('.Post-RichTextContainer, .Post-RichText, .RichContent-inner').first().waitFor({timeout:15000});
   if(action==='comments'){const comments=await page.locator('.CommentContent, .CommentItemV2-content, [class*="CommentItem"] [class*="RichText"]').allTextContents();if(!comments.length)throw Error('文章评论区未取得可见正文，不能认定没有评论');return {url,comments:comments.slice(0,20),coverage:'当前页面可见文章评论'};}
   return {url,title:await page.locator('h1').first().innerText(),text:(await page.locator('.Post-RichTextContainer, .Post-RichText, .RichContent-inner').first().innerText()).slice(0,20000),coverage:'文章正文'};
  }finally{signal?.removeEventListener('abort',stop);await page.close().catch(()=>{});}
 }
 async noteImages(target,{imageOffset=0,imageCount=3}={},signal){
  const offset=Number(imageOffset),count=Number(imageCount);
  if(!Number.isInteger(offset)||offset<0||offset>99||!Number.isInteger(count)||count<1||count>3)throw Error('图片按0起始索引分批，每批1至3张');
  signal?.throwIfAborted();const url=await resolveXhsTarget(target),noteId=new URL(url).pathname.split('/').filter(Boolean).at(-1);
  const context=this.syncPlatform?await this.syncPlatform('xiaohongshu'):await this.open({headed:false}),page=await context.newPage();let imagePage;
  const stop=()=>{void page.close().catch(()=>{});void imagePage?.close().catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});
  try{
   signal?.throwIfAborted();await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
   await page.locator('#noteContainer').waitFor({state:'visible',timeout:12000});
   const assets=await page.evaluate(collectXhsNoteImages,noteId);
   if(assets.kind==='video')return {kind:'video',frames:[]};
   if(!assets.urls.length)throw Error('笔记正文未取得可用配图，不能根据文字猜图');
   imagePage=await context.newPage();await imagePage.setContent('<html><body style="margin:0;background:white"><img style="display:block;max-width:1280px;max-height:1800px;object-fit:contain"></body></html>');
   const frames=[],errors=[];
   for(const [i,sourceUrl]of assets.urls.slice(offset,offset+count).entries()){
    signal?.throwIfAborted();const index=offset+i;
    try{
     await imagePage.locator('img').evaluate((img,src)=>{img.src=src;},sourceUrl);
     await imagePage.waitForFunction(src=>{const img=document.querySelector('img');return img?.src===src&&img.complete&&img.naturalWidth>0;},sourceUrl,{timeout:15000});
     const dimensions=await imagePage.locator('img').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));
     let bytes;for(const quality of [85,65,45]){bytes=await imagePage.locator('img').screenshot({type:'jpeg',quality,timeout:8000});if(bytes.length<=750000)break;}
     if(bytes.length>750000)throw Error('配图超过视觉预算');
     frames.push({index:index+1,source:'xiaohongshu-note-image',sourceUrl,...dimensions,image:{mediaType:'image/jpeg',data:bytes.toString('base64'),name:'image:'+(index+1)}});
    }catch{signal?.throwIfAborted();errors.push({index:index+1,error:'该配图未成功解码或截图'});}
   }
   if(!frames.length&&offset<assets.urls.length)throw Error('笔记配图读取失败，不能声称看过图片');
   return {kind:'images',totalImages:assets.urls.length,imageOffset:offset,nextImageOffset:offset+count<assets.urls.length?offset+count:null,frames,errors};
  }finally{signal?.removeEventListener('abort',stop);await Promise.allSettled([page.close(),imagePage?.close()]);}
 }
 async videoFrames(platform,target,signal){
  signal?.throwIfAborted();
  const context=this.syncPlatform?await this.syncPlatform(platform):await this.open({headed:false}),page=await context.newPage();
  const stop=()=>void page.close().catch(()=>{});signal?.addEventListener('abort',stop,{once:true});
  try{signal?.throwIfAborted();
   await page.goto(socialTarget(platform,target),{waitUntil:'domcontentloaded',timeout:40000});
   const videoSelector=platform==='douyin'?'.xgplayer video':'video';await page.locator(videoSelector).first().waitFor({state:'attached',timeout:12000});const index=await page.locator(videoSelector).evaluateAll(vs=>{let best=0,score=-1;vs.forEach((v,i)=>{const r=v.getBoundingClientRect(),s=(v.readyState>=2?1000000:0)+r.width*r.height;if(s>score){best=i;score=s;}});return best;});const video=page.locator(videoSelector).nth(index);
   await video.evaluate(v=>{v.muted=true;v.play().catch(()=>{});});
   await video.evaluate(v=>new Promise((resolve,reject)=>{if(v.readyState>=2&&v.videoWidth>=320)return resolve();const timer=setTimeout(()=>reject(Error('视频未加载真实画面')),15000);v.addEventListener('loadeddata',()=>{clearTimeout(timer);v.videoWidth>=320?resolve():reject(Error('视频分辨率不足'));},{once:true});}));
   const info=await video.evaluate(v=>({width:v.videoWidth,height:v.videoHeight,duration:Number.isFinite(v.duration)?v.duration:null}));
   const frames=[];
   for(const fraction of [.15,.5,.8]){
    if(info.duration&&info.duration>2){const time=Math.min(info.duration-.5,info.duration*fraction);await video.evaluate((v,t)=>{v.currentTime=t;},time);await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.seeking&&v.readyState>=2;},{},{timeout:8000});}
    const time=await video.evaluate(v=>v.currentTime);let bytes;try{const encoded=await video.evaluate(v=>{const c=document.createElement('canvas'),scale=Math.min(1,1280/Math.max(v.videoWidth,v.videoHeight));c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);if(c.width<128||c.height<128)throw Error('视频画面分辨率不足');c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.85).split(',')[1];});bytes=Buffer.from(encoded,'base64');}catch{await video.evaluate(v=>{Object.assign(v.style,{position:'fixed',left:'0px',top:'0px',width:'540px',height:'720px',zIndex:'2147483647',opacity:'1',visibility:'visible'});});const box=await video.boundingBox();if(!box||box.width<128||box.height<128)throw Error('视频只有缩略图，未取得真实画面');bytes=await video.screenshot({type:'jpeg',quality:85,timeout:8000});}
    if(bytes.length>750000)throw Error('视频画面超过视觉预算');frames.push({time,source:'browser-video-element',...info,image:{mediaType:'image/jpeg',data:bytes.toString('base64'),name:'frame:'+frames.length}});
    if(!info.duration)break;
   }
   return frames;
  }finally{signal?.removeEventListener('abort',stop);await page.close().catch(()=>{});}
 }
 constructor({root,profileDir}){this.runtime=path.resolve(root,'../../work/integration-runtime/social');this.profileDir=path.join(profileDir,'social-browser');this.extension=path.join(this.runtime,'opencli-extension');this.playwrightPath=path.resolve(root,'../../work/integration-runtime/browser/node_modules/playwright/index.mjs');this.context=null;this.headed=false;}
 async executablePath(){const {chromium}=await import(pathToFileURL(this.playwrightPath).href);const expected=chromium.executablePath();if(fs.existsSync(expected))return expected;const cache=path.join(process.env.LOCALAPPDATA||'', 'ms-playwright'),candidates=fs.existsSync(cache)?fs.readdirSync(cache).filter(n=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1])).map(n=>path.join(cache,n,'chrome-win64/chrome.exe')):[];const found=candidates.find(p=>fs.existsSync(p));if(!found)throw Error('专用Chromium未安装');return found;}
 async open({headed=false}={}){
  if(this.context&&this.headed===headed)return this.context;if(this.opening)return this.opening;
  this.opening=(async()=>{await this.close();const {chromium}=await import(pathToFileURL(this.playwrightPath).href);fs.mkdirSync(this.profileDir,{recursive:true});
   const executablePath=await this.executablePath();
   this.context=await chromium.launchPersistentContext(this.profileDir,{executablePath,headless:!headed,args:['--disable-extensions-except='+this.extension,'--load-extension='+this.extension],acceptDownloads:false,viewport:{width:1200,height:850}});this.headed=headed;
   this.context.on('close',()=>{this.context=null;this.contextId=null;});
   // Route OpenCLI to this role's extension instance, never whichever personal profile is connected.
   let worker=this.context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'));
   if(!worker)worker=await this.context.waitForEvent('serviceworker',{timeout:15000});
   for(let i=0;i<30;i++){this.contextId=await worker.evaluate(async()=> (await chrome.storage.local.get('opencli_context_id_v1')).opencli_context_id_v1);if(this.contextId)break;await new Promise(r=>setTimeout(r,150));}
   if(!this.contextId)throw Error('OpenCLI浏览器配置未就绪');return this.context;
  })();try{return await this.opening;}finally{this.opening=null;}
 }
 async login(platform,{done=false}={}){const ctx=await this.open({headed:!done});if(!done){const page=await ctx.newPage();await page.goto(SOCIAL_ORIGINS[platform],{waitUntil:'domcontentloaded',timeout:45000});}return {status:done?'background':'login-window',platform};}
 async cookies(platform){const ctx=await this.open({headed:this.headed});return ctx.cookies(SOCIAL_ORIGINS[platform]);}
 async loggedIn(platform){const cookies=await this.cookies(platform);const names={zhihu:['z_c0'],youtube:['SAPISID','__Secure-3PAPISID'],weibo:['SUB'],tieba:['BDUSS'],douyin:['sessionid','sessionid_ss'],xiaohongshu:['web_session']}[platform]||[];return cookies.some(c=>names.includes(c.name)&&(!c.expires||c.expires<0||c.expires>Date.now()/1000));}
 async close(){const ctx=this.context;this.context=null;this.contextId=null;if(ctx)await ctx.close().catch(()=>{});}
}

// Current-console login: OpenCLI owns the browser connection; no personal profile files are read.
export class ConsoleSocialBrowser extends SocialBrowser {
 constructor(options){super(options);this.bindingFile=path.join(options.profileDir,'social','console-browser.json');this.consolePort=options.consolePort||3100;this.request=options.request||this.daemonRequest.bind(this);this.externalProfile=null;try{this.externalProfile=JSON.parse(fs.readFileSync(this.bindingFile,'utf8')).contextId;}catch{}}
 async daemonRequest(endpoint,body,retried=false){try{const r=await fetch('http://127.0.0.1:19825'+endpoint,{method:body?'POST':'GET',headers:{'X-OpenCLI':'1','content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();return await r.json();}catch{if(endpoint==='/status'&&!retried){const entry=path.join(this.runtime,'node_modules/@jackwener/opencli/dist/src/daemon.js');if(fs.existsSync(entry)){const child=spawn(process.execPath,[entry],{cwd:this.runtime,windowsHide:true,detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref();await new Promise(r=>setTimeout(r,1000));return this.daemonRequest(endpoint,body,true);}}throw Object.assign(Error('当前浏览器未连接 OpenCLI 扩展，请安装后点击完成登录'),{code:'BROWSER_EXTENSION_REQUIRED'});}}
 async command(contextId,action,args={}){const result=await this.request('/command',{id:'feiyu_'+Date.now()+'_'+Math.random().toString(16).slice(2),contextId,action,...(action==='cookies'?{session:'feiyu-login-state',surface:'browser'}:{}),...args});if(!result.ok)throw Object.assign(Error('当前浏览器扩展请求失败，请重新检查连接'),{code:'BROWSER_EXTENSION_REQUIRED'});return result.data;}
 async consoleProfile({bind=false}={}){
  const status=await this.request('/status'),profiles=(status.profiles||[]).filter(p=>p.extensionConnected!==false);let matches=[];
  // Reuse only the explicitly bound, connected browser; closing the console tab is harmless.
  if(!bind&&this.externalProfile&&profiles.some(p=>p.contextId===this.externalProfile)){this.contextId=this.externalProfile;return this.contextId;}
  for(const p of profiles){const tabs=await this.command(p.contextId,'chrome-call',{chromeMethod:'tabs.query',chromeArgs:[{url:['http://127.0.0.1:'+this.consolePort+'/*','http://localhost:'+this.consolePort+'/*']}]});if(Array.isArray(tabs)&&tabs.length)matches.push(p.contextId);}
  if(matches.length!==1)throw Object.assign(Error(matches.length>1?'多个浏览器打开了生活台，请只保留准备登录的浏览器再重试':'请在生活台所在浏览器安装并启用 OpenCLI 扩展'),{code:'BROWSER_EXTENSION_REQUIRED'});
  if(!bind&&this.externalProfile!==matches[0])throw Object.assign(Error('请先点击打开登录，再点击完成登录，绑定当前浏览器'),{code:'BROWSER_EXTENSION_REQUIRED'});
  if(bind){this.externalProfile=matches[0];fs.mkdirSync(path.dirname(this.bindingFile),{recursive:true});fs.writeFileSync(this.bindingFile,JSON.stringify({contextId:this.externalProfile,at:Date.now()}),{mode:0o600});}
  this.contextId=matches[0];return matches[0];
 }
 async prepareOpenCli(){await this.consoleProfile();}
 async login(platform,{done=false}={}){if(!Object.hasOwn(SOCIAL_ORIGINS,platform))throw Error('不支持的平台');let setupRequired=false,message='登录页已在生活台所在浏览器打开，完成后点击完成登录';try{await this.consoleProfile({bind:true});}catch(e){if(e.code!=='BROWSER_EXTENSION_REQUIRED')throw e;setupRequired=true;message=e.message;}return {platform,status:setupRequired?'extension-required':done?'connected':'login-tab',url:SOCIAL_ORIGINS[platform],browser:'console',setupRequired,message};}
 async cookies(platform){if(!Object.hasOwn(SOCIAL_ORIGINS,platform))throw Error('不支持的平台');const contextId=await this.consoleProfile();const rows=await this.command(contextId,'cookies',{url:SOCIAL_ORIGINS[platform]});return (rows||[]).map(c=>({...c,expires:c.expirationDate??-1,sameSite:'Lax'}));}
 async syncPlatform(platform){const cookies=await this.cookies(platform);const ctx=await super.open({headed:false});const domain=new URL(SOCIAL_ORIGINS[platform]).hostname.replace(/^www\./,'');const retained=(await ctx.cookies()).filter(c=>!(c.domain.replace(/^\./,'')===domain||c.domain.endsWith('.'+domain)));const safe=[...retained,...cookies].filter(c=>c.name&&c.domain&&typeof c.value==='string').map(({name,value,domain,path,expires,httpOnly,secure,sameSite})=>({name,value,domain,path:path||'/',...(Number.isFinite(expires)&&expires>0?{expires}:{}),httpOnly:!!httpOnly,secure:!!secure,sameSite:['Strict','Lax','None'].includes(sameSite)?sameSite:'Lax'}));await ctx.clearCookies();if(safe.length)await ctx.addCookies(safe);return ctx;}
}

// Adapted from Lazily01/douyin-cli (MIT): visible comment editor + real input + send button.
// Desired-state likes replace its toggling behavior; a timeout after send is never retried.
export class DouyinActions{
 constructor(browser){this.browser=browser;}
 async run(action,target,text='',signal,guard,onSubmit){
  const check=()=>{signal?.throwIfAborted();guard?.();};check();
  const ctx=this.browser.syncPlatform?await this.browser.syncPlatform('douyin'):await this.browser.open({headed:this.browser.headed}),page=await ctx.newPage();let submitted=false;const stop=()=>{if(!submitted)void page.close().catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});
  try{check();await page.goto(action==='feed'?SOCIAL_ORIGINS.douyin:socialTarget('douyin',target),{waitUntil:'domcontentloaded',timeout:45000});check();
   if(action==='feed'){await page.locator('a[href*="/video/"]').first().waitFor({timeout:12000}).catch(()=>{});return {items:await page.locator('a[href*="/video/"]').evaluateAll(nodes=>nodes.slice(0,12).map(a=>({url:a.href,title:a.innerText||a.getAttribute('aria-label')||'推荐视频'})))};}
   if(action==='read'||action==='comments'){await page.locator('[data-e2e="video-desc"], [data-e2e="comment-list"], .comment-item').first().waitFor({timeout:12000}).catch(()=>{});return {url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,14000),source:'visible-page',partial:true};}
   if(action==='comment'){
    let editor=page.locator('[data-e2e="comment-input"] [contenteditable="true"], .comment-input-inner-container [contenteditable="true"], [data-e2e="comment-input"] textarea').first();
    if(!await editor.isVisible()){const tab=page.getByText(/^评论(?:\s|\(|（|$)/).first();if(await tab.isVisible())await tab.click();}
    await editor.waitFor({state:'visible',timeout:12000});await editor.fill(text);
    const send=page.locator('[data-e2e="comment-post"], .comment-input-inner-container [class*="send"], [data-e2e="comment-input"] [class*="send"]').first();
    await send.waitFor({state:'visible',timeout:5000});check();onSubmit?.();submitted=true;await send.click();
    const result=page.locator('[data-e2e="comment-list"], .comment-list, [class*="comment-item"]');
    await result.filter({hasText:text}).first().waitFor({state:'visible',timeout:10000});return {status:'confirmed',verified:true,url:page.url(),message:'评论已在页面出现'};
   }
   const favorite=['favorite','unfavorite'].includes(action),desired=!['unlike','unfavorite'].includes(action),selector=favorite?'[data-e2e="video-player-collect"], [data-e2e="note-collect"]':'[data-e2e="video-player-digg"], [data-e2e="note-digg"]';
   const button=page.locator(selector).first();await button.waitFor({state:'visible',timeout:12000});
   const state=await button.getAttribute('data-e2e-state'),pressed=await button.getAttribute('aria-pressed');
   function decode(s,p){if(p==='true'||p==='false')return p==='true';if(!s)return null;if(/un|no|false|inactive/.test(s))return false;if(/digged|collected|active|true/.test(s))return true;return null;}
   const before=decode(state,pressed);if(before===null)throw Error('无法确认当前点赞/收藏状态，未点击');if(before===desired)return {status:'confirmed',verified:true,unchanged:true,url:page.url()};
   check();onSubmit?.();submitted=true;await button.click();await page.waitForFunction(({selector,desired})=>{const e=document.querySelector(selector),p=e?.getAttribute('aria-pressed'),s=e?.getAttribute('data-e2e-state')||'';if(p==='true'||p==='false')return(p==='true')===desired;return s!==''&&(!/un|no|false|inactive/.test(s)&&/digged|collected|active|true/.test(s))===desired;},{selector,desired},{timeout:8000});
   return {status:'confirmed',verified:true,url:page.url()};
  }catch(e){if(submitted)return {status:'unknown',verified:false,message:'已尝试发送或点击，但未核实结果；请查看原页面，勿重试',url:page.url()};throw e;}finally{signal?.removeEventListener('abort',stop);await page.close().catch(()=>{});}
 }
}
