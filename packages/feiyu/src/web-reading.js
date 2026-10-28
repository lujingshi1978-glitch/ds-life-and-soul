import fs from 'node:fs';
import path from 'node:path';
import {safeFetch} from './safe-fetch.js';

export async function fetchReadablePage(url, request=safeFetch, {offset=0}={}){
 const result=await request(url,180000,{recoverProxyDns:true});
 if(result.statusCode<200||result.statusCode>=300)throw Object.assign(Error('网页返回HTTP '+result.statusCode),{httpStatus:result.statusCode});
 if(!Number.isSafeInteger(offset)||offset<0||offset>2000000)throw Error('READ_OFFSET_INVALID');
 const decode=s=>s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'');
 const html=result.body,title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');
 const links=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].slice(0,80).flatMap(m=>{try{const u=new URL(decode(m[1]),result.url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?[{title:decode(m[2].replace(/<[^>]*>/g,'')).slice(0,100),url:u.href}]:[];}catch{return [];}});
 const text=decode(html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(?:p|div|li|h[1-6]|section|article)>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
 if(text.length<40)throw Error('网页没有取得可用正文，可能依赖脚本或登录');
 const window=text.slice(offset,offset+24000),providedRange={start:offset,end:Math.min(text.length,offset+24000),totalChars:text.length,truncated:offset+24000<text.length};if(!window)throw Error('READ_OFFSET_PAST_END');
 return {content:[{type:'text',text:JSON.stringify({url:result.url,title,text:window,links,providedRange,httpStatus:result.statusCode,source:'public-http-fallback',note:'浏览器读取失败后的公开页面正文；未执行页面脚本，不代表看到图片或视频。'})}]};
}

// MCP may return a snapshot file link instead of its contents. The chat agent
// cannot open host files; inline only snapshots produced in this profile.
export function inlineSnapshots(response, outputDir, cwd=process.cwd()) {
 if(!(response.content||[]).some(p=>p.type==='text'&&/\[Snapshot\]\(/.test(p.text)))return response;
 const root=fs.realpathSync(outputDir);
 return {...response,content:(response.content||[]).map(part=>{
  if(part.type!=='text')return part;
  const text=part.text.replace(/\[Snapshot\]\(([^)]+\.ya?ml)\)/g,(link,file)=>{
   try{const absolute=fs.realpathSync(path.resolve(cwd,file));const relative=path.relative(root,absolute);
    if(relative.startsWith('..')||path.isAbsolute(relative)||fs.statSync(absolute).size>2*1024*1024)return '[页面快照不可读取]';
    return fs.readFileSync(absolute,'utf8').slice(0,24000);
   }catch{return '[页面快照读取失败，请再次snapshot]';}
  });return {...part,text:text.slice(0,30000)};
 })};
}

export function qzoneTarget({target,uin,tid}={}, defaultUin) {
 let owner=uin==='self'?'self':uin||defaultUin, id=tid||'';
 if(target){const url=new URL(target);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!/(^|\.)qzone\.qq\.com$/.test(url.hostname))throw Error('需要QQ空间分享地址');
  const route=url.pathname+url.hash;
  owner=url.searchParams.get('uin')||route.match(/(?:^|\/)(\d{5,12})(?:\/|$)/)?.[1]||owner;
  id=url.searchParams.get('tid')||url.searchParams.get('cellid')||route.match(/(?:mood|detail)\/([a-zA-Z0-9_-]+)/)?.[1]||id;
 }
 if(owner!=='self'&&!/^\d{5,12}$/.test(String(owner)))throw Error('空间QQ号无效');
 if(id&&!/^[\w-]{1,120}$/.test(id))throw Error('动态ID无效');
 return {uin:String(owner),tid:id};
}
