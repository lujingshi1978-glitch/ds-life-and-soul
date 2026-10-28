// iLink transport adapted from Tencent/openclaw-weixin (MIT), protocol v2.4.10.
// Upstream source/commit/license are recorded in vendor/tencent-weixin/.
import fs from 'node:fs';import path from 'node:path';import {randomBytes,randomUUID,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
export function wechatBase(input='https://ilinkai.weixin.qq.com'){const u=new URL(input);if(u.protocol!=='https:'||u.port||u.username||u.password||!(u.hostname==='ilinkai.weixin.qq.com'||u.hostname.endsWith('.weixin.qq.com')))throw Error('微信 API 主机无效');return u.origin;}
export function wechatScope(id){return 'wechat:'+createHash('sha256').update(String(id)).digest('hex').slice(0,24);}
export function archiveWechatMessage(runtime,source,event){
 const prior=runtime.archive.db.prepare("SELECT * FROM documents WHERE adapter='wechat' AND external_id=? AND kind='chat' AND status='available' ORDER BY revision DESC LIMIT 1").get(source.externalId);
 if(prior){
  const metadata=JSON.parse(prior.metadata);
  for(const key of ['scope','conversationPeerId','role','requestId','sourceMessageId'])if(metadata[key]!==source.metadata[key])throw Error('WECHAT_ARCHIVE_CONFLICT');
  if(prior.body!==source.text)throw Error('WECHAT_ARCHIVE_CONFLICT');
  return runtime.observe({...source,text:prior.body,metadata,occurredAt:prior.occurred_at},event);
 }
 return runtime.observe(source,event);
}
export class WechatChannel{
 constructor({dir,request=fetch,qrImage,respond,ready=()=>false,onConfirmed=()=>{},onOutcome=()=>{},onFinish=()=>{},captureGuard=()=>()=>{},onEvent=()=>{}}){Object.assign(this,{dir,request,qrImage,respond,ready,onConfirmed,onOutcome,onFinish,captureGuard,onEvent});fs.mkdirSync(dir,{recursive:true});this.file=path.join(dir,'account.json');this.account=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null;this.db=new DatabaseSync(path.join(dir,'messages.sqlite'));this.db.exec("CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,peer TEXT,body TEXT,status TEXT,reply TEXT,client_id TEXT,created INTEGER);UPDATE messages SET status='unknown' WHERE status='sending';UPDATE messages SET status='pending' WHERE status='thinking';");this.db.exec("CREATE TABLE IF NOT EXISTS send_receipts(id TEXT PRIMARY KEY,receipt TEXT,created INTEGER)");this.db.exec("CREATE TABLE IF NOT EXISTS archive_outbox(id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT);INSERT OR IGNORE INTO archive_outbox(id) SELECT id FROM messages WHERE status='confirmed'");for(const [name,type] of [['recovered','INTEGER NOT NULL DEFAULT 0'],['binding',"TEXT NOT NULL DEFAULT '{}'"],['account_binding','TEXT']])if(!this.db.prepare('PRAGMA table_info(messages)').all().some(c=>c.name===name))this.db.exec('ALTER TABLE messages ADD COLUMN '+name+' '+type);this.db.prepare("UPDATE messages SET recovered=1 WHERE status IN ('pending','confirmed','failed','unknown','reviewed-no-reply')").run();this.db.exec("CREATE TABLE IF NOT EXISTS outcome_outbox(id TEXT NOT NULL,status TEXT NOT NULL,context TEXT NOT NULL,at INTEGER NOT NULL,recovered INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT,PRIMARY KEY(id,status));");this.db.prepare("UPDATE outcome_outbox SET recovered=1 WHERE archived=0").run();for(const row of this.db.prepare("SELECT * FROM messages WHERE status IN ('confirmed','failed','unknown','reviewed-no-reply')").all())this.queueOutcome(row,row.status,{recovered:true});this.closed=false;this.abort=new AbortController();this.state=this.account?'connecting':'not-connected';this.timer=setInterval(()=>void this.work(),5000);this.timer.unref();if(this.account)void this.monitor();}
 status(){return {connected:!!this.account&&this.state==='connected',state:this.state,ownerBound:!!this.account?.userId,qrImage:this.login?.image||null,loginExpires:this.login?.expires||null,error:this.error||null,features:{text:true,images:false,voice:false,groups:false,moments:false},queue:this.db.prepare('SELECT status,count(*) count FROM messages GROUP BY status').all()};}
 async api(endpoint,body,{base=this.account?.base||'https://ilinkai.weixin.qq.com',token=this.account?.token,get=false,signal,timeout=40000}={}){
  const headers={'iLink-App-Id':'bot','iLink-App-ClientVersion':String((2<<16)|(4<<8)|10)};
  if(!get){Object.assign(headers,{'Content-Type':'application/json',AuthorizationType:'ilink_bot_token','X-WECHAT-UIN':Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')});if(token)headers.Authorization='Bearer '+token;}
  const r=await this.request(wechatBase(base)+'/'+endpoint,{method:get?'GET':'POST',headers,redirect:'error',body:get?undefined:JSON.stringify(body),signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(timeout),...(signal?[signal]:[])])});if(!r.ok)throw Error('微信 API HTTP '+r.status);const text=await r.text();if(text.length>2*1024*1024)throw Error('微信响应过大');return JSON.parse(text.replace(/("(?:message_id|seq)"\s*:\s*)(\d{15,})(?=\s*[,}])/g,'$1"$2"'));
 }
 save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.account),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 async startLogin(){if(this.account&&this.state==='connected')return this.status();if(this.login&&this.login.expires>Date.now())return this.status();const r=await this.api('ilink/bot/get_bot_qrcode?bot_type=3',{local_token_list:[]},{token:null,base:'https://ilinkai.weixin.qq.com'});if(typeof r.qrcode!=='string'||typeof r.qrcode_img_content!=='string')throw Error('微信未返回有效二维码');this.login={code:r.qrcode,image:await this.qrImage(r.qrcode_img_content),base:'https://ilinkai.weixin.qq.com',expires:Date.now()+300000};this.state='waiting-scan';void this.pollLogin();return this.status();}
 verify(code){if(!this.login||!/^\d{4,10}$/.test(String(code)))throw Error('请输入微信显示的校验码');this.login.verify=String(code);return this.status();}
 async pollLogin(){const login=this.login;while(!this.closed&&this.login===login&&Date.now()<login.expires){try{const r=await this.api('ilink/bot/get_qrcode_status?qrcode='+encodeURIComponent(login.code)+(login.verify?'&verify_code='+encodeURIComponent(login.verify):''),null,{get:true,base:login.base});this.state=r.status||'waiting-scan';if(r.status==='confirmed'){if(!r.bot_token||!r.ilink_user_id)throw Error('微信登录凭据不完整');this.account={token:r.bot_token,botId:r.ilink_bot_id,userId:r.ilink_user_id,base:wechatBase(r.baseurl||login.base),cursor:''};this.save();this.login=null;this.state='connected';this.error=null;void this.monitor();return;}if(r.status==='scaned_but_redirect'&&r.redirect_host)login.base=wechatBase(r.redirect_host.startsWith('https://')?r.redirect_host:'https://'+r.redirect_host);if(['expired','verify_code_blocked','binded_redirect'].includes(r.status)){this.login=null;return;}}catch{if(this.closed)return;this.error='微信扫码状态暂未取得，稍后重试';}await new Promise(r=>setTimeout(r,1000));}if(this.login===login){this.login=null;this.state='expired';}}
 ingest(messages,cursor){this.db.exec('BEGIN IMMEDIATE');try{for(const m of messages){if(m.message_type!==1||!m.from_user_id||m.group_id)continue;const text=(m.item_list||[]).filter(i=>i.type===1).map(i=>i.text_item?.text||'').join('\n');const id=String(m.message_id||m.client_id||'');if(!id)continue;const allowed=m.from_user_id===this.account.userId;this.db.prepare('INSERT OR IGNORE INTO messages(id,peer,body,status,reply,client_id,created,account_binding) VALUES(?,?,?,?,NULL,?,?,?)').run(id,String(m.from_user_id),JSON.stringify({text:text.slice(0,12000),contextToken:m.context_token||'',hasMedia:(m.item_list||[]).some(i=>i.type!==1)}),allowed&&text.trim()?'pending':allowed?'unsupported-media':'not-authorized',randomUUID(),Date.now(),this.accountBinding());}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}if(cursor){this.account.cursor=cursor;this.save();}}
 async monitor(){if(this.monitoring||!this.account)return;this.monitoring=true;try{while(!this.closed&&this.account){try{const r=await this.api('ilink/bot/getupdates',{get_updates_buf:this.account.cursor||'',base_info:{channel_version:'2.4.10',bot_agent:'Feiyu/1.0'}});if(r.ret===-14||r.errcode===-14){this.state='login-expired';this.error='微信登录失效，请重新扫码';break;}if((r.ret??0)!==0||(r.errcode??0)!==0)throw Error('微信轮询失败');this.ingest(r.msgs||[],r.get_updates_buf);this.state='connected';this.error=null;await this.work();}catch{if(this.closed)break;this.error='微信收取暂时失败，正在退避重试';await new Promise(r=>setTimeout(r,5000));}}}finally{this.monitoring=false;}}
 accountBinding(){return createHash('sha256').update(JSON.stringify([this.account?.botId||'',this.account?.userId||'',this.account?.base||'https://ilinkai.weixin.qq.com'])).digest('hex');}
 context(row){return {id:row.id,requestId:'wechat:'+row.client_id,scope:wechatScope(row.peer),accountBinding:row.account_binding,at:row.created,recovered:row.recovered===1,...JSON.parse(row.binding||'{}'),signal:this.abort?.signal};}
 queueOutcome(row,status,extra={}){const context={...this.context(row),...extra};delete context.signal;this.db.prepare('INSERT OR IGNORE INTO outcome_outbox(id,status,context,at,recovered) VALUES(?,?,?,?,?)').run(row.id,status,JSON.stringify(context),Date.now(),context.recovered?1:0);}
 async work(){
  if(this.closed||this.working||!this.account||this.state!=='connected'||!this.ready())return;
  this.working=true;let row,context,sendAttempted=false,terminal;
  try{
   await this.flushArchives();
   if(this.closed||!this.account||!this.ready())return;
   row=this.db.prepare("SELECT * FROM messages WHERE status='pending' AND peer=? AND (account_binding IS NULL OR account_binding=?) ORDER BY created LIMIT 1").get(this.account.userId,this.accountBinding());
   if(!row)return;context=this.context(row);const account=this.account,accountIdentity={userId:account.userId,botId:account.botId,token:account.token,base:account.base},guard=this.captureGuard(context);
   if(guard.binding){context={...context,...guard.binding};row.binding=JSON.stringify(guard.binding);this.db.prepare('UPDATE messages SET binding=? WHERE id=?').run(row.binding,row.id);}
   const assert=()=>{this.abort.signal.throwIfAborted();if(this.closed||this.account!==account||this.account?.userId!==row.peer||Object.keys(accountIdentity).some(key=>this.account[key]!==accountIdentity[key])||!this.ready())throw Object.assign(Error('WECHAT_REQUEST_CANCELLED'),{code:'WECHAT_REQUEST_CANCELLED'});guard();};
   assert();const body=JSON.parse(row.body);
   if(!body.contextToken){this.db.prepare("UPDATE messages SET status='missing-context' WHERE id=?").run(row.id);terminal='failed';this.queueOutcome(row,terminal,context);return;}
   this.db.prepare("UPDATE messages SET status='thinking' WHERE id=?").run(row.id);
   const history=this.db.prepare("SELECT body,reply FROM messages WHERE peer=? AND status='confirmed' ORDER BY created DESC LIMIT 20").all(row.peer).reverse().map(m=>({incoming:JSON.parse(m.body).text,reply:m.reply}));
   assert();const reply=await this.respond({...context,text:body.text,history,guard:assert});assert();
   if(reply===null){this.db.prepare("UPDATE messages SET status='reviewed-no-reply',reply=NULL WHERE id=?").run(row.id);terminal='reviewed-no-reply';this.queueOutcome(row,terminal,context);await this.flushArchives();return;}
   if(typeof reply!=='string'||!reply.trim())throw Error('WECHAT_RESPONSE_INVALID');
   this.db.prepare("UPDATE messages SET status='sending',reply=? WHERE id=?").run(reply.slice(0,4000),row.id);
   assert();sendAttempted=true;
   const result=await this.api('ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:row.peer,client_id:row.client_id,message_type:2,message_state:2,context_token:body.contextToken,item_list:[{type:1,text_item:{text:reply.slice(0,4000)}}]},base_info:{channel_version:'2.4.10',bot_agent:'Feiyu/1.0'}});
   // A late, actual receipt remains a fact even if authority changed in flight.
   // The checkpoint prevents further activity; it cannot undo a real delivery.
   let checkpointError;try{assert();}catch(error){checkpointError=error;}
   if(checkpointError){context={...context,recovered:true};row.recovered=1;}
   const receipt=JSON.stringify({ret:result?.ret,errcode:result?.errcode,messageId:result?.message_id,keys:result&&typeof result==='object'?Object.keys(result):[]});
   if(!result||typeof result!=='object'||Array.isArray(result)||(result.ret!==undefined&&result.ret!==0)||(result.errcode!==undefined&&result.errcode!==0)){this.db.prepare('INSERT OR REPLACE INTO send_receipts VALUES(?,?,?)').run(row.id,receipt,Date.now());throw Error('WECHAT_SEND_UNCONFIRMED');}
   this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR REPLACE INTO send_receipts VALUES(?,?,?)').run(row.id,receipt,Date.now());this.db.prepare("UPDATE messages SET status='confirmed',recovered=? WHERE id=?").run(row.recovered||0,row.id);this.db.prepare('INSERT OR IGNORE INTO archive_outbox(id) VALUES(?)').run(row.id);this.queueOutcome(row,'confirmed',context);this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
   terminal='confirmed';if(!checkpointError)await this.flushArchives();
   this.onEvent({type:'wechat-reply',scope:context.scope,id:row.id,requestId:context.requestId,status:'confirmed'});
  }catch(error){
   if(!row)return;const current=this.db.prepare('SELECT status FROM messages WHERE id=?').get(row.id)?.status;
   if(error.code==='STALE_ROLE_EPOCH'){context={...context,recovered:true};row.recovered=1;}
   const cancelled=this.closed||this.abort.signal.aborted||!this.ready()||['WECHAT_REQUEST_CANCELLED','STALE_ROLE_EPOCH'].includes(error.code);
   terminal=current==='confirmed'?'confirmed':current==='reviewed-no-reply'?'reviewed-no-reply':sendAttempted?'unknown':cancelled?'cancelled':'failed';
   const state=terminal==='cancelled'?'pending':terminal;
   this.db.prepare('UPDATE messages SET status=?,recovered=? WHERE id=?').run(state,row.recovered||0,row.id);this.queueOutcome(row,terminal,context);
   this.error=terminal==='confirmed'?'微信已送达，本地归档将在恢复后补记':'微信处理未完成，未核实的发送不会自动重发';
   if(!this.closed)await this.flushArchives();
  }finally{
   try{if(row)await this.onFinish({...context,status:terminal||'cancelled'});}catch{this.error='微信轮次清理失败，请检查本地状态';}
   this.working=false;
  }
 }
 async flushArchives(){
  for(const row of this.db.prepare("SELECT m.*,coalesce(s.created,m.created) delivered_at FROM archive_outbox a JOIN messages m USING(id) LEFT JOIN send_receipts s USING(id) WHERE a.status='pending' AND m.status='confirmed' AND a.retry_at<=? ORDER BY m.created LIMIT 16").all(Date.now())){
   if(this.closed||!this.ready())break;
   try{await this.onConfirmed({...this.context(row),reply:row.reply,at:row.delivered_at});this.db.prepare("UPDATE archive_outbox SET status='complete',error=NULL WHERE id=?").run(row.id);if(this.error?.includes('归档'))this.error=null;}
   catch{this.db.prepare('UPDATE archive_outbox SET attempts=attempts+1,retry_at=?,error=? WHERE id=?').run(Date.now()+5000,'WECHAT_ARCHIVE_FAILED',row.id);this.error='微信已送达，本地归档将在恢复后补记';}
  }
  for(const row of this.db.prepare('SELECT * FROM outcome_outbox WHERE archived=0 AND retry_at<=? ORDER BY at LIMIT 32').all(Date.now())){
   if(this.closed||!this.ready())break;
   try{await this.onOutcome({...JSON.parse(row.context),status:row.status,at:row.at,recovered:row.recovered===1});this.db.prepare('UPDATE outcome_outbox SET archived=1,error=NULL WHERE id=? AND status=?').run(row.id,row.status);}
   catch{this.db.prepare('UPDATE outcome_outbox SET attempts=attempts+1,retry_at=?,error=? WHERE id=? AND status=?').run(Date.now()+5000,'WECHAT_OUTCOME_ARCHIVE_FAILED',row.id,row.status);this.error='微信实际结果将在本地归档恢复后补记';}
  }
 }
 close(){if(this.closing)return this.closing;this.closing=(async()=>{this.closed=true;clearInterval(this.timer);this.abort.abort();while(this.working||this.monitoring)await new Promise(r=>setTimeout(r,50));this.db.close();})();return this.closing;}
}
