import {safeFetch} from './safe-fetch.js';
import {biliLinks} from './qq-link-share.js';
export async function resolveBiliVideo(input,fetchPage=safeFetch){
 const text=String(input||'').trim();if(/^BV[0-9A-Za-z]{10}$/.test(text))return text;
 const candidate=biliLinks(text)[0];if(!candidate)throw Error('需要B站视频BV号或链接');let url=new URL(candidate);
 const valid=u=>!u.username&&!u.password&&(!u.port||u.port==='443'||u.port==='80')&&['b23.tv','www.bilibili.com','bilibili.com','m.bilibili.com'].includes(u.hostname);
 if(!valid(url))throw Error('仅支持B站视频链接，不访问任意URL');
 if(url.hostname==='b23.tv'){const r=await fetchPage(url.href,12000,{recoverProxyDns:true});url=new URL(r.url);if(!valid(url)||url.hostname==='b23.tv')throw Error('短链未能解析为B站视频');}
 const bv=/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/.exec(url.pathname)?.[1];if(bv)return bv;
 const aid=/^\/video\/av(\d+)(?:\/|$)/i.exec(url.pathname)?.[1];if(aid){const r=await fetchPage('https://api.bilibili.com/x/web-interface/view?aid='+aid,50000,{recoverProxyDns:true});const d=JSON.parse(r.body);if(d.code===0&&/^BV[0-9A-Za-z]{10}$/.test(d.data?.bvid))return d.data.bvid;}
 throw Error('链接不是可识别的B站视频地址');
}
