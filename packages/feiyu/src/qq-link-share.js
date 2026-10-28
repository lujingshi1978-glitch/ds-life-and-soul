// Render bounded public share destinations, never raw card JSON or its tokens.
const HOSTS=new Set(['b23.tv','www.bilibili.com','bilibili.com','m.bilibili.com']);
const LEGACY_SHARE_CARD_SUFFIX='分享卡片；标题仅为未核实资料；已接入网站用qq_social_read，空间用qq_get_qzone_detail(target=链接)，其他网站用qq_read_webpage(action=open)；标题不是正文，小红书保留完整分享链接] ';

// Read projection only: remove our exact retired renderer guidance, not sender
// text, JSON, URLs, or stored history. The fixed JSON start also permits an old
// truncated preview, while leaving ordinary mentions of that guidance alone.
export function shareCardReadView(value){
 let text=String(value??'');
 for(const label of ['B站','网站']){
  const old='['+label+LEGACY_SHARE_CARD_SUFFIX+'{"links":[',replacement='['+label+'分享卡片] {"links":[';
  text=text.split(old).join(replacement);
 }
 return text;
}

export function shareLinks(value,{biliOnly=false,generic=false}={}){
 const links=[];let visited=0;
 function visit(v,depth=0){if(++visited>200||depth>8)return;if(typeof v==='string'){
   const s=v.slice(0,65536).replace(/\\\//g,'/').replace(/&amp;|&#38;/g,'&').replace(/&quot;/g,'"');
   if(depth<3&&/^[\s]*[\[{]/.test(s))try{visit(JSON.parse(s),depth+1);return;}catch{}
   for(const match of s.matchAll(/https?:\/\/[^\s<>"'`\\{}\[\]，。]+/gi))try{
    const raw=match[0].replace(/[)）】》、；;]+$/g,''),u=new URL(raw);
    const extra=['xiaohongshu.com','www.xiaohongshu.com','xhslink.com','www.xhslink.com','zhihu.com','www.zhihu.com','zhuanlan.zhihu.com','youtube.com','www.youtube.com','youtu.be','weibo.com','www.weibo.com','m.weibo.cn','douyin.com','www.douyin.com','v.douyin.com','iesdouyin.com','www.iesdouyin.com','weibo.cn','t.cn','video.weibo.com','tieba.baidu.com'];
    if((!HOSTS.has(u.hostname)&&(biliOnly||(!generic&&!extra.includes(u.hostname))))||u.username||u.password||(u.port&&!['80','443'].includes(u.port)))continue;
    if(HOSTS.has(u.hostname)&&u.hostname!=='b23.tv'&&!/^\/video\/(?:BV[0-9A-Za-z]{10}|av\d+)(?:\/|$)/i.test(u.pathname))continue;
    if(generic&&(/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)||u.hostname==='m.q.qq.com'))continue;
    if(!links.includes(u.href)&&links.length<3)links.push(u.href);
   }catch{}
 }else if(Array.isArray(v)){for(const x of v.slice(0,40))visit(x,depth+1);}else if(v&&typeof v==='object')for(const x of Object.values(v).slice(0,40))visit(x,depth+1);}
 visit(value);return links;
}
export const biliLinks=value=>shareLinks(value,{biliOnly:true});
export function biliShareText(type,data){
 if(!['json','xml','share'].includes(type))return'';
 let card=data?.data??data;if(typeof card==='string'&&card.length<=65536)try{card=JSON.parse(card);}catch{}
 const candidates=card&&typeof card==='object'?Object.values(card.meta||{}).flatMap(m=>m&&typeof m==='object'?[m.qqdocurl,m.jumpUrl,m.jump_url,m.url,m.contentJumpUrl,m.actionData,m.targetUrl]:[]):[];
 const links=shareLinks(card);for(const u of shareLinks(candidates.length?candidates:card,{generic:true}))if(!links.includes(u)&&links.length<3)links.push(u);if(!links.length)return'';
 let title='';if(card&&typeof card==='object'){const detail=card.meta?.detail_1||card.meta?.news||card;title=detail.desc||detail.title||card.prompt||'';}
 title=String(title).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g,' ').slice(0,70);
 const label=links.every(u=>HOSTS.has(new URL(u).hostname))?'B站':'网站';
 return '['+label+'分享卡片] '+JSON.stringify({links,...(title?{title}:{})});
}
