const HOSTS={douyin:['douyin.com','www.douyin.com','v.douyin.com','www.iesdouyin.com','iesdouyin.com'],weibo:['weibo.com','www.weibo.com','m.weibo.cn','weibo.cn','t.cn','video.weibo.com']};
export function canonicalShareTarget(platform,input){
 const u=new URL(input);
 if(platform==='douyin'){
  const id=u.pathname.match(/\/(?:share\/)?(?:video|note)\/(\d{6,24})/)?.[1]||u.searchParams.get('modal_id')||u.searchParams.get('aweme_id');
  if(/^\d{6,24}$/.test(id||''))return 'https://www.douyin.com/'+(u.pathname.includes('/note/')?'note/':'video/')+id;
 }else{
  const id=u.pathname.match(/^\/(?:detail|status)\/([\da-zA-Z]{6,24})\/?$/)?.[1]||u.pathname.match(/^\/\d+\/([\da-zA-Z]{6,24})\/?$/)?.[1];
  if(id)return 'https://m.weibo.cn/detail/'+id;
 }
 return null;
}
export async function resolveSocialShare(platform,input,{request=fetch,signal}={}){
 if(!HOSTS[platform])throw Error('不支持的分享平台');
 if(/^\d{6,24}$/.test(String(input)))return platform==='douyin'?'https://www.douyin.com/video/'+input:'https://m.weibo.cn/detail/'+input;
 let current=String(input||'').replaceAll('&amp;','&').match(/https?:\/\/[^\s<>"“”'`]+/i)?.[0]?.replace(/[，。；！）)】]+$/u,'');
 if(!current)throw Error('请提供完整分享链接或包含链接的转发文字');
 for(let i=0;i<6;i++){
  const u=new URL(current);if(!['https:','http:'].includes(u.protocol)||!HOSTS[platform].includes(u.hostname)||u.username||u.password||u.port)throw Error('分享链接跳转到不允许的地址');u.protocol='https:';
  const canonical=canonicalShareTarget(platform,u.href);if(canonical)return canonical;
  const r=await request(u.href,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),headers:{'user-agent':'Mozilla/5.0'}});
  const location=r.headers.get('location');await r.body?.cancel();
  if(![301,302,303,307,308].includes(r.status)||!location)throw Error('分享链接未解析出具体内容，请提供视频或微博原始链接');current=new URL(location,u).href;
 }
 throw Error('分享链接跳转过多');
}
const BASE62='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function weiboNumericId(value){
 const id=String(value);if(/^\d{6,24}$/.test(id))return id;if(!/^[a-zA-Z0-9]{6,24}$/.test(id))throw Error('无效微博ID');
 const parts=[];for(let end=id.length;end>0;end-=4){const part=id.slice(Math.max(0,end-4),end);let n=0;for(const c of part)n=n*62+BASE62.indexOf(c);parts.unshift(String(n));}
 return parts.map((p,i)=>i?p.padStart(7,'0'):p).join('');
}
