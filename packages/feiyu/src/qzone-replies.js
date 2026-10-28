import {createHash} from 'node:crypto';

// Protocol reference: Gu-Heping/onebot-qzone/doc/feeds3-parser.md.
// A nested reply must bind to a freshly read comment ID and its actual author.
export function createQzoneReplies(d){
 const state=d.load()||{attempts:{}};state.attempts??={};let busy=false;
 return {async reply({uin,tid,commentId,text,pos=0},guard){
  if(busy)throw Error('空间回复正在发送，请稍等');
  if(!/^\d{5,12}$/.test(String(uin))||!/^\w[\w-]{0,119}$/.test(String(tid))||!/^\w[\w-]{0,119}$/.test(String(commentId)))throw Error('空间回复目标无效');
  if(typeof text!=='string'||!text.trim()||/[\r\n]/.test(text))throw Error('回复不能为空或包含换行');
  text=text.trim();d.checkText(text);guard();
  const fingerprint=createHash('sha256').update(JSON.stringify([String(uin),tid,commentId,text])).digest('hex');
  if(state.attempts[fingerprint])return {...state.attempts[fingerprint],duplicate:true,note:'已有发送记录，不重复提交；unknown需到原动态核对'};
  busy=true;try{
   const detail=await d.raw('get_qzone_msg_detail',{target_uin:Number(uin),tid,pos:Math.max(0,Math.min(1000,Number(pos)||0)),num:100});guard();
   const comment=(detail.comments||[]).find(c=>String(c.comment_id)===String(commentId));
   if(!comment||!/^\d{5,12}$/.test(String(comment.uin)))throw Error('未在实时评论页找到该评论，请重新读取并确认commentId和pos');
   const auth=await d.raw('get_cookies',{domain:'qzone.qq.com'}),cookie=auth?.cookies;
   if(typeof cookie!=='string'||/[\r\n]/.test(cookie))throw Error('空间登录不可用');
   const cookies=Object.fromEntries(cookie.split(';').map(p=>{const i=p.indexOf('=');return [p.slice(0,i).trim(),p.slice(i+1).trim()]})),skey=cookies.p_skey||cookies.skey;
   if(!skey)throw Error('空间登录签名不可用');let hash=5381;for(const ch of skey)hash+=(hash<<5)+ch.charCodeAt(0);
   const self=String(d.self());if(!/^\d{5,12}$/.test(self))throw Error('QQ尚未连接');
   const body=new URLSearchParams({qzreferrer:'https://user.qzone.qq.com/'+self,inCharset:'utf-8',outCharset:'utf-8',hostUin:String(uin),format:'json',ref:'feeds',topicId:uin+'_'+tid+'__1',feedsType:'100',private:'0',paramstr:'2',uin:self,content:text,plat:'qzone',source:'ic',platformid:'52',commentId:String(comment.comment_id),commentUin:String(comment.uin)});
   guard();const attempt={at:Date.now(),uin:String(uin),tid,commentId:String(commentId),status:'unknown'};
   // Persist before POST: timeout, process exit, or ambiguous response never retries.
   state.attempts[fingerprint]=attempt;d.save(state);
   try{const response=await (d.request||fetch)('https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk='+(hash&0x7fffffff),{method:'POST',headers:{Cookie:cookie,'content-type':'application/x-www-form-urlencoded',Referer:'https://user.qzone.qq.com/'+uin},body:body.toString(),redirect:'error',signal:AbortSignal.timeout(20000)});
    const result=await response.json();const id=result.commentid??result.commentId;
    if(response.ok&&Number(result.code)===0&&(!result.subcode||Number(result.subcode)===0)&&id!==undefined&&String(id))Object.assign(attempt,{status:'confirmed',replyId:String(id)});
    else if(result.code!==undefined&&Number(result.code)!==0)attempt.status='rejected';
   }catch{/* Result unknown; never retry the POST. */}
   d.save(state);d.onEvent?.({type:'qzone-comment-reply',...attempt});
   return {...attempt,note:attempt.status==='confirmed'?'平台已返回回复ID':attempt.status==='rejected'?'平台拒绝了回复，未自动重试':'结果未确认，请在原动态核对，不要重发'};
  }finally{busy=false;}
 }};
}
