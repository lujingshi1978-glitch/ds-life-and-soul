// Native API first. The alternative route uses this bot's existing Qzone login;
// cookies stay in memory and are never written to the contact database or prompts.
export async function readQzoneMonthList(raw,uin,pos,num=20,request=fetch){
 try{return await raw('get_qzone_msg_list',{target_uin:Number(uin),pos,num});}
 catch(nativeError){
  const auth=await raw('get_cookies',{domain:'qzone.qq.com'});
  const cookie=auth?.cookies;if(typeof cookie!=='string'||!cookie)throw Error('空间登录Cookie不可用');
  const cookies=Object.fromEntries(cookie.split(';').map(p=>{const i=p.indexOf('=');return [p.slice(0,i).trim(),p.slice(i+1).trim()];}));
  const skey=cookies.p_skey||cookies.skey;if(!skey)throw Error('空间登录缺少有效签名');
  let hash=5381;for(const c of skey)hash+=(hash<<5)+c.charCodeAt(0);
  const query=new URLSearchParams({uin:String(uin),ftype:'0',sort:'0',pos:String(pos),num:String(num),replynum:'100',g_tk:String(hash&0x7fffffff),code_version:'1',format:'json',need_private_comment:'1'});
  const response=await request('https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?'+query,{headers:{Cookie:cookie,Referer:'https://user.qzone.qq.com/'+uin},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Error('空间备用读取失败 HTTP '+response.status);
  const body=await response.text();let data;try{data=JSON.parse(body);}catch{throw Error('空间备用响应不是JSON，需要检查登录状态');}
  if(Number(data.code)!==0||!Array.isArray(data.msglist))throw Error('空间动态未完整读取：'+String(data.message||'登录/权限或上游响应异常').slice(0,120));
  return {total:Number(data.total??data.msglist.length),msglist:data.msglist.map(p=>({tid:String(p.tid??''),content:String(p.content??''),time:Number(p.created_time)||0,comment_num:Number(p.cmtnum)||0,images:(p.pic??[]).map(i=>i.url3||i.url2||i.url1||i.smallurl).filter(Boolean)}))};
 }
}
