// Web reply protocol cross-checked with nekomeow114/dsh-tieba-scroll/lib/tieba.js.
import {socialTarget} from './social-browser.js';
export function tiebaMetadata(html){
 const fid=html.match(/(?:["']?(?:forum_id|fid)["']?\s*[:=]\s*["']?)(\d{1,20})/)?.[1]||html.match(/[?&]fid=(\d+)/)?.[1];
 const raw=html.match(/["'](?:forum_name|fname)["']\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1];let name='';if(raw)try{name=JSON.parse('"'+raw+'"');}catch{}
 if(!name){const encoded=html.match(/[?&]kw=([^&"'<>\s]+)/)?.[1];if(encoded)try{name=decodeURIComponent(encoded.replaceAll('&amp;','&'));}catch{}}
 if(!fid||!name||name.length>100)throw Error('未取得准确吧名和吧ID，未提交回帖');return {fid,name};
}
export function tiebaReplyResult(raw){
 if(Number(raw?.no??raw?.error_code??-1)!==0)return {status:'unknown',verified:false,message:'贴吧未确认回帖成功，请检查登录、验证码或吧内限制'};
 const id=String(raw.data?.pid||raw.data?.post_id||raw.data?.id||'');
 if(raw.data?.is_post_visible===0||!/^\d+$/.test(id))return {status:'unknown',verified:false,message:'贴吧返回受理但可见结果未确认，请到原帖核对，勿重发'};
 return {status:'confirmed',verified:true,comment_id:id};
}
export async function tiebaComment(context,target,text,signal,guard){
 const url=socialTarget('tieba',target),u=new URL(url);if(!/^\/p\/\d+\/?$/.test(u.pathname))throw Error('回帖需要具体贴吧帖子地址');
 if(typeof text!=='string'||!text.trim()||[...text].length>300||/[@＠\r\n]/.test(text))throw Error('贴吧短评应为1至300字单行文字，不@人');
 signal?.throwIfAborted();const page=await context.request.get(url,{timeout:25000});if(new URL(page.url()).hostname!=='tieba.baidu.com')throw Error('贴吧跳转到登录或验证页面，未提交回帖');
 const {fid,name}=tiebaMetadata(await page.text());signal?.throwIfAborted();const token=await context.request.get('https://tieba.baidu.com/dc/common/tbs',{timeout:15000});const auth=await token.json();
 if(Number(auth.is_login)!==1||typeof auth.tbs!=='string'||!auth.tbs)throw Error('贴吧未登录或登录已失效');signal?.throwIfAborted();
 guard?.();signal?.throwIfAborted();const response=await context.request.post('https://tieba.baidu.com/f/commit/post/add',{timeout:25000,headers:{referer:url,'X-Requested-With':'XMLHttpRequest'},form:{ie:'utf-8',kw:name,fid,tid:u.pathname.split('/')[2],tbs:auth.tbs,files:'[]',content:text.trim().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),rich_text:'0',__type__:'reply'}});
 return {...tiebaReplyResult(await response.json()),url};
}
