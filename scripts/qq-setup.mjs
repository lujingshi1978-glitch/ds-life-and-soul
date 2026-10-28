// Optional OneBot11 setup. Only get_login_info/get_status are used for probing.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';

export function createQqPrompts({input=process.stdin,output=process.stdout}={}){
  let muted=false;
  const sink=new Writable({write(chunk,_encoding,callback){if(!muted)output.write(chunk);callback();}});
  const rl=createInterface({input,output:sink,terminal:true});
  return {
    ask:async(label,previous='')=>(await rl.question(label+(previous?' ['+previous+']':'')+': ')).trim()||previous,
    secret:async(label,previous='')=>{output.write(label+': ');muted=true;try{return (await rl.question(''))||previous;}finally{muted=false;output.write('\n');}},
    close:()=>{rl.close();sink.end();},
  };
}

const fail=code=>{throw Object.assign(new Error(code),{code});};
const account=value=>{const text=String(value??'').trim();if(!/^[1-9]\d{4,14}$/.test(text)||!Number.isSafeInteger(Number(text)))fail('QQ_ACCOUNT_INVALID');return Number(text);};
export function accountList(value){
  const values=Array.isArray(value)?value:String(value??'').trim().split(/[\s,，;；]+/).filter(Boolean);
  if(values.length>1000)fail('QQ_SCOPE_TOO_LARGE');
  return [...new Set(values.map(account))];
}
export function localEndpoint(value,kind){
  let url;try{url=new URL(value);}catch{fail('QQ_ENDPOINT_INVALID');}
  if(typeof value!=='string'||value.trim()!==value||/[\x00-\x20\x7f]/.test(value)||url.protocol!==(kind==='ws'?'ws:':'http:')||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')fail('QQ_ENDPOINT_LOCAL_ROOT_REQUIRED');
  return url.origin;
}
export function normalizeQqSetup(input){
  if(!input||typeof input!=='object')fail('QQ_SETUP_INVALID');
  const token=input.accessToken??'';
  if(typeof token!=='string'||token.length>8192||/[\x00-\x20\x7f]/.test(token)||!token)fail('QQ_TOKEN_REQUIRED');
  const ownerQQ=account(input.ownerQQ),privateIds=accountList(input.privateIds),groupIds=accountList(input.groupIds);
  return {wsUrl:localEndpoint(input.wsUrl,'ws'),httpUrl:localEndpoint(input.httpUrl,'http'),accessToken:token,ownerQQ,privateIds:[...new Set([ownerQQ,...privateIds])],groupIds};
}
const resultData=value=>{if(!value||value.status!=='ok'||value.retcode!==0||!value.data||typeof value.data!=='object')fail('QQ_API_REJECTED');return value.data;};
function loginIdentity(login,status){
  const id=account(login.user_id);
  if(status.online!==true)fail('QQ_ACCOUNT_OFFLINE');
  return id;
}
async function httpProbe(c,{fetchImpl=fetch,timeoutMs=5000}={}){
  const rows=[];
  for(const action of ['get_login_info','get_status']){
    let response;try{response=await fetchImpl(c.httpUrl+'/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.accessToken},body:'{}',redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch{fail('QQ_HTTP_UNAVAILABLE');}
    if(response.status===401||response.status===403)fail('QQ_HTTP_AUTH_FAILED');
    if(!response.ok)fail('QQ_HTTP_API_FAILED');
    // Limit gateway-controlled response size; never log its contents.
    const reader=response.body?.getReader();if(!reader)fail('QQ_HTTP_INVALID_RESPONSE');let size=0,text='';const decoder=new TextDecoder();
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)fail('QQ_HTTP_RESPONSE_TOO_LARGE');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
    let value;try{value=JSON.parse(text);}catch{fail('QQ_HTTP_INVALID_RESPONSE');}rows.push(resultData(value));
  }
  return loginIdentity(...rows);
}
async function wsProbe(c,{WebSocket,timeoutMs=5000}){
  return new Promise((resolve,reject)=>{
    let socket,timer,settled=false;const rows=[],pending=new Map();
    const finish=(code,id)=>{if(settled)return;settled=true;clearTimeout(timer);if(socket){socket.removeAllListeners();socket.on('error',()=>{});socket.terminate();}code?reject(Object.assign(new Error(code),{code})):resolve(id);};
    try{socket=new WebSocket(c.wsUrl,{headers:{Authorization:'Bearer '+c.accessToken},followRedirects:false,maxPayload:65536,handshakeTimeout:timeoutMs});}catch{return finish('QQ_WS_UNAVAILABLE');}
    timer=setTimeout(()=>finish('QQ_WS_TIMEOUT'),timeoutMs);
    socket.on('error',()=>finish('QQ_WS_UNAVAILABLE'));
    socket.on('unexpected-response',(_req,res)=>{res.destroy();finish([401,403].includes(res.statusCode)?'QQ_WS_AUTH_FAILED':'QQ_WS_HANDSHAKE_FAILED');});
    socket.on('close',()=>finish('QQ_WS_CLOSED'));
    socket.on('open',()=>{const echo=randomUUID();pending.set(echo,0);socket.send(JSON.stringify({action:'get_login_info',params:{},echo}));});
    socket.on('message',raw=>{
      let value;try{value=JSON.parse(String(raw));}catch{return finish('QQ_WS_INVALID_RESPONSE');}
      if(!pending.has(value?.echo))return; // Ignore ordinary events; never retain them.
      const index=pending.get(value.echo);pending.delete(value.echo);
      try{rows[index]=resultData(value);if(index===0){const echo=randomUUID();pending.set(echo,1);socket.send(JSON.stringify({action:'get_status',params:{},echo}));}else finish(null,loginIdentity(...rows));}catch(e){finish(e.code||'QQ_WS_INVALID_RESPONSE');}
    });
  });
}
export async function probeQqGateway(input,{WebSocket,fetchImpl=fetch,timeoutMs=5000}={}){
  const c=normalizeQqSetup(input);if(!WebSocket){const require=createRequire(new URL('../packages/feiyu/package.json',import.meta.url));try{WebSocket=require('ws');}catch{fail('QQ_INSTALL_FIRST');}}
  const [ws,http]=await Promise.allSettled([wsProbe(c,{WebSocket,timeoutMs}),httpProbe(c,{fetchImpl,timeoutMs})]);
  for(const row of [ws,http])if(row.status==='rejected')fail(row.reason?.code||'QQ_PROBE_FAILED');
  if(ws.value!==http.value)fail('QQ_GATEWAYS_DIFFERENT_ACCOUNTS');
  return {ok:true,websocket:true,http:true,authenticated:true,loggedIn:true,matchingAccount:true,readOnlyActions:['get_login_info','get_status']};
}
export function mergeQqConfig(current,input){
  const c=normalizeQqSetup(input);if(!current||typeof current!=='object'||Array.isArray(current))fail('QQ_CONFIG_INVALID');
  const denyPrivate=new Set(accountList(current.deny?.private)),denyGroups=new Set(accountList(current.deny?.groups));
  if(c.privateIds.some(id=>denyPrivate.has(id))||c.groupIds.some(id=>denyGroups.has(id)))fail('QQ_SCOPE_DENIED');
  return {...current,ownerQQ:c.ownerQQ,snowluma:{...current.snowluma,enabled:true,wsUrl:c.wsUrl,httpUrl:c.httpUrl,accessToken:c.accessToken,followDiscoveredEndpoint:false,homeDir:''},allow:{...current.allow,private:c.privateIds,groups:c.groupIds},allowAllWhenEmpty:false};
}
export async function saveQqConfig({root,input,expectedBytes,probe=probeQqGateway,isRunning=async()=>false}){
  const file=path.join(root,'packages/feiyu/config.json');
  if(!fs.existsSync(file))fail('QQ_INSTALL_FIRST');
  const before=fs.readFileSync(file);if(expectedBytes&&!before.equals(expectedBytes))fail('QQ_CONFIG_CHANGED');
  let current;try{current=JSON.parse(before);}catch{fail('QQ_CONFIG_INVALID');}const next=mergeQqConfig(current,input);
  if(await isRunning())fail('QQ_STOP_FIRST');
  const checked=await probe(input);if(checked?.ok!==true)fail('QQ_PROBE_FAILED');
  if(await isRunning())fail('QQ_STOP_FIRST');
  if(!fs.readFileSync(file).equals(before))fail('QQ_CONFIG_CHANGED');
  const backupDir=path.join(root,'.local/qq-setup-backups');fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
  const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
  fs.writeFileSync(path.join(backupDir,id+'.json'),before,{flag:'wx',mode:0o600});
  const temp=file+'.qq-'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});if(!fs.readFileSync(file).equals(before))fail('QQ_CONFIG_CHANGED');fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return {ok:true,saved:true,restartRequired:true,privateCount:next.allow.private.length,groupCount:next.allow.groups.length,proactiveEnabled:current.socialV2?.proactive?.enabled===true,backupCreated:true,probe:checked};
}
export const QQ_ERRORS={
  QQ_ACCOUNT_INVALID:'QQ号或群号应为有效的数字编号；仅桌面使用的占位管理员1不能用于QQ接入。',QQ_SCOPE_TOO_LARGE:'聊天范围过大，请分批在生活台管理。',QQ_ENDPOINT_INVALID:'连接地址格式无效。',QQ_ENDPOINT_LOCAL_ROOT_REQUIRED:'请填写本机根地址，例如 ws://127.0.0.1:3001 和 http://127.0.0.1:3000；不填反向地址、查询串或公网地址。',QQ_TOKEN_REQUIRED:'请先在网关设置非空连接令牌，再在这里输入同一令牌。',QQ_INSTALL_FIRST:'请先运行启动肥鱼完成安装，再配置QQ。',QQ_STOP_FIRST:'肥鱼仍在运行，请先用 stop.cmd 停止本包，再运行QQ接入向导；不需要退出QQ网关。',QQ_CONFIG_CHANGED:'配置已被其他窗口修改，本次未覆盖，请重新打开向导核对。',QQ_SCOPE_DENIED:'所选对象在已有黑名单中；本次不移除黑名单，请在生活台先核对。',QQ_ACCOUNT_OFFLINE:'网关可访问，但QQ账号尚未在线，请先在网关中登录。',QQ_GATEWAYS_DIFFERENT_ACCOUNTS:'HTTP与WebSocket连接到了不同账号，请核对两个服务属于同一个QQ。',QQ_HTTP_AUTH_FAILED:'HTTP令牌不匹配，请核对网关HTTP服务端的令牌。',QQ_WS_AUTH_FAILED:'WebSocket令牌不匹配，请核对正向WS服务端的令牌。',QQ_HTTP_UNAVAILABLE:'HTTP服务不可用或超时，请确认端口和HTTP服务端已开启。',QQ_WS_UNAVAILABLE:'WebSocket无法连接，请确认选择了正向WS服务端并核对端口。',QQ_WS_TIMEOUT:'WebSocket查询超时，请确认该地址同时支持API与事件，而非仅事件端口。',QQ_API_REJECTED:'网关未成功返回标准OneBot11查询结果，请检查实现的兼容性。',
};
export const qqErrorMessage=e=>QQ_ERRORS[e?.code]||'QQ接入检查未通过，本次未保存；请核对服务类型、登录状态与端口。错误代码：'+(/^[A-Z0-9_]+$/.test(e?.code||'')?e.code:'QQ_SETUP_FAILED');
