// Original minimal OneBot 11 forward WebSocket transport. No upstream SDK
// code is used. Compatibility names keep the existing Feiyu bridge import small.
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';

function fault(code, action, retcode) {
  // Never attach raw socket errors, URLs, credentials, params or remote wording.
  const error = new Error(code + (action ? ` (${action})` : ''));
  error.code = code;
  if(action)error.action=action;
  if(Number.isSafeInteger(retcode))error.retcode=retcode;
  return error;
}

export function validateOneBotUrl(value) {
  let url;
  try { if(typeof value!=='string'||value.trim()!==value||/[\x00-\x20\x7f]/.test(value))throw Error();url = new URL(value); } catch { throw fault('ONEBOT_ENDPOINT_INVALID'); }
  if(!['ws:','wss:'].includes(url.protocol) || !['127.0.0.1','[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash)throw fault('ONEBOT_ENDPOINT_DENIED');
  // Preserve spelling because the bridge compares bot.url with its config
  // before deciding whether a token refresh needs a reconnect.
  return value;
}

export function validateOneBotHttpUrl(value){
  let u;try{if(typeof value!=='string'||value.trim()!==value||/[\x00-\x20\x7f]/.test(value))throw Error();u=new URL(value);}catch{throw fault('ONEBOT_HTTP_ENDPOINT_INVALID');}
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw fault('ONEBOT_HTTP_ENDPOINT_DENIED');return u.origin;
}

// Explicit switches always win. Older installations predate the switch and
// already opted in by configuring their gateway; a fresh empty config does not.
export function configuredOneBotEnabled(settings){
  if(settings?.enabled!==undefined)return settings.enabled===true;
  return typeof settings?.wsUrl==='string'&&settings.wsUrl.trim().length>0;
}

export function text(value) { return {type:'text',data:{text:String(value??'')}}; }
const message = value => value && typeof value==='object' && !Array.isArray(value) && typeof value.type==='string' ? [value] : value;
const bounded = (value,fallback,min,max) => Number.isSafeInteger(value)&&value>=min&&value<=max?value:fallback;

export class SnowLumaWebSocketClient extends EventEmitter {
  #url; #token; #attempt=null; #launch=null; #closing=Promise.resolve();
  #desired=false; #generation=0; #retryTimer=null; #retryCount=0; #refreshQueued=false;
  #pending=new Map(); #options;
  constructor(options={}) {
    super();
    this.#url=validateOneBotUrl(options.url??'ws://127.0.0.1:3001/');
    this.#token=this.#validateToken(options.accessToken);
    this.#options={
      enabled:options.enabled!==false,
      reconnect:options.reconnect===true,
      reconnectMinMs:bounded(options.reconnectMinMs,500,5,30000),
      reconnectMaxMs:bounded(options.reconnectMaxMs,30000,5,300000),
      maxReconnectAttempts:bounded(options.maxReconnectAttempts,20,0,1000),
      requestTimeoutMs:bounded(options.requestTimeoutMs,30000,5,600000),
      connectTimeoutMs:bounded(options.connectTimeoutMs,10000,10,120000),
      maxPending:bounded(options.maxPending,256,1,4096),
      maxPayloadBytes:bounded(options.maxPayloadBytes,16*1024*1024,1024,64*1024*1024),
    };
  }
  get url(){return this.#url;}
  set url(value){const next=validateOneBotUrl(value);if(next!==this.#url){this.#url=next;this.#queueRefresh();}}
  get accessToken(){return this.#token;}
  set accessToken(value){const next=this.#validateToken(value);if(next!==this.#token){this.#token=next;this.#queueRefresh();}}
  get connected(){return this.#attempt?.socket?.readyState===WebSocket.OPEN;}
  get pendingCount(){return this.#pending.size;}
  #validateToken(value){if(value==null||value==='')return undefined;if(typeof value!=='string'||value.length>8192||/[\x00-\x20\x7f]/.test(value))throw fault('ONEBOT_TOKEN_INVALID');return value;}

  #notify(event,...args){
    // Event handlers must not create unhandled rejected promises or crash the
    // transport. Raw errors are never re-emitted to a loggable error listener.
    for(const listener of this.rawListeners(event)){
      try{Promise.resolve(listener.apply(this,args)).catch(()=>{if(event!=='error')this.#notify('error',fault('ONEBOT_LISTENER_ERROR'));});}
      catch{if(event!=='error')this.#notify('error',fault('ONEBOT_LISTENER_ERROR'));}
    }
  }
  #clearRetry(){if(this.#retryTimer){clearTimeout(this.#retryTimer);this.#retryTimer=null;}}
  #queueRefresh(){
    if(this.#refreshQueued)return;this.#refreshQueued=true;
    queueMicrotask(()=>{
      this.#refreshQueued=false;const active=this.#attempt;
      if(this.#desired&&active&&(active.url!==this.#url||active.token!==this.#token)){
        this.close(1000,'configuration-update');this.connect();
      }
      else if(this.#desired&&!active&&!this.#launch){this.#retryCount=0;this.connect();}
    });
  }

  connect(){
    if(!this.#options.enabled)return Promise.resolve({disabled:true});
    this.#desired=true;this.#clearRetry();
    if(this.#attempt)return this.#attempt.promise;
    if(this.#launch)return this.#launch;
    const generation=this.#generation;
    const promise=this.#closing.then(()=>{
      if(!this.#desired||generation!==this.#generation)throw fault('ONEBOT_CLOSED');
      return this.#start();
    });
    this.#launch=promise;
    // Existing bridge token-refresh calls connect() without awaiting it.
    promise.catch(()=>{}).finally(()=>{if(this.#launch===promise)this.#launch=null;});
    return promise;
  }
  #start(){
    let resolve,reject;
    const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
    const attempt={url:this.#url,token:this.#token,promise,resolve,reject,opened:false,retired:false,socket:null};
    this.#attempt=attempt;
    try{
      const socket=new WebSocket(attempt.url,{
        headers:attempt.token?{Authorization:`Bearer ${attempt.token}`}:{},
        handshakeTimeout:this.#options.connectTimeoutMs,
        maxPayload:this.#options.maxPayloadBytes,
        perMessageDeflate:false,followRedirects:false,
      });
      attempt.socket=socket;
      socket.on('open',()=>{
        if(this.#attempt!==attempt||attempt.retired)return;
        attempt.opened=true;this.#retryCount=0;attempt.resolve(this);this.#notify('open');
      });
      socket.on('message',(data,binary)=>{if(this.#attempt===attempt&&!attempt.retired)this.#receive(data,binary);});
      socket.on('error',()=>{if(this.#attempt===attempt&&!attempt.retired)this.#notify('error',fault('ONEBOT_CONNECTION_ERROR'));});
      socket.on('close',(code)=>{
        if(attempt.retired)return;
        if(this.#attempt!==attempt)return;
        this.#attempt=null;
        attempt.reject(fault('ONEBOT_CONNECTION_CLOSED'));
        this.#rejectPending('ONEBOT_DISCONNECTED');
        this.#notify('close',{code,reason:'connection-closed'});
        this.#scheduleRetry();
      });
    }catch{
      this.#attempt=null;attempt.reject(fault('ONEBOT_CONNECTION_ERROR'));
      this.#notify('error',fault('ONEBOT_CONNECTION_ERROR'));this.#scheduleRetry();
    }
    return promise;
  }
  #scheduleRetry(){
    if(!this.#desired||!this.#options.reconnect||this.#retryTimer)return;
    if(this.#retryCount>=this.#options.maxReconnectAttempts){this.#notify('error',fault('ONEBOT_RECONNECT_EXHAUSTED'));return;}
    const delay=Math.min(this.#options.reconnectMaxMs,this.#options.reconnectMinMs*2**Math.min(this.#retryCount,20));
    this.#retryCount++;
    this.#retryTimer=setTimeout(()=>{this.#retryTimer=null;if(this.#desired)this.connect();},delay);
    this.#retryTimer.unref();
  }
  close(code=1000,reason='client-close'){
    if(!Number.isInteger(code)||!(code===1000||(code>=1001&&code<=1014&&![1004,1005,1006].includes(code))||(code>=3000&&code<=4999))
      ||typeof reason!=='string'||Buffer.byteLength(reason)>123)throw fault('ONEBOT_CLOSE_INVALID');
    this.#desired=false;this.#generation++;this.#clearRetry();this.#launch=null;this.#retryCount=0;
    this.#rejectPending('ONEBOT_CLOSED');
    const attempt=this.#attempt;this.#attempt=null;
    if(!attempt)return this.#closing;
    attempt.retired=true;attempt.reject(fault('ONEBOT_CLOSED'));
    const socket=attempt.socket;
    if(!socket){this.#notify('close',{code,reason:'client-close'});return this.#closing;}
    this.#closing=new Promise(resolve=>{
      let settled=false,timer;
      const done=()=>{
        if(settled)return;settled=true;clearTimeout(timer);
        this.#notify('close',{code,reason:'client-close'});resolve();
      };
      socket.once('close',done);
      timer=setTimeout(()=>{socket.terminate();},1000);timer.unref();
      if(socket.readyState===WebSocket.CLOSED)done();
      else if(socket.readyState===WebSocket.CONNECTING)socket.terminate();
      else socket.close(code,reason);
    });
    return this.#closing;
  }

  #settle(echo,error,value){const pending=this.#pending.get(echo);if(!pending)return;this.#pending.delete(echo);clearTimeout(pending.timer);pending.signal?.removeEventListener('abort',pending.abort);if(error)pending.reject(error);else pending.resolve(value);}
  #rejectPending(code){for(const echo of this.#pending.keys())this.#settle(echo,fault(code));}
  #receive(data,binary){
    let packet;
    try{if(binary)throw Error();packet=JSON.parse(data.toString());if(!packet||typeof packet!=='object'||Array.isArray(packet))throw Error();}
    catch{this.#notify('error',fault('ONEBOT_PROTOCOL_ERROR'));return;}
    if(typeof packet.post_type==='string'){
      this.#notify('event',packet);
      if(packet.post_type==='message'&&packet.message_type==='private')this.#notify('private-message',packet);
      if(packet.post_type==='message'&&packet.message_type==='group')this.#notify('group-message',packet);
      if(packet.post_type==='notice'&&typeof packet.notice_type==='string')this.#notify('notice:'+packet.notice_type,packet);
      return;
    }
    if(typeof packet.echo!=='string'||!this.#pending.has(packet.echo))return;
    const action=this.#pending.get(packet.echo).action;
    if(packet.status!=='ok'||packet.retcode!==0){
      this.#settle(packet.echo,fault(packet.status==='async'?'ONEBOT_ASYNC_UNCONFIRMED':'ONEBOT_API_FAILED',action,packet.retcode));
      return;
    }
    this.#settle(packet.echo,null,packet);
  }

  request(action,params={},options={}){
    if(!this.#options.enabled)return Promise.reject(fault('ONEBOT_DISABLED'));
    if(typeof action!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(action))return Promise.reject(fault('ONEBOT_ACTION_INVALID'));
    if(!params||typeof params!=='object'||Array.isArray(params))return Promise.reject(fault('ONEBOT_PARAMS_INVALID',action));
    const signal=options?.signal;
    if(signal?.aborted)return Promise.reject(fault('ONEBOT_ABORTED',action));
    const socket=this.#attempt?.socket;
    if(!this.connected||!socket)return Promise.reject(fault('ONEBOT_NOT_CONNECTED',action));
    if(this.#pending.size>=this.#options.maxPending)return Promise.reject(fault('ONEBOT_REQUEST_LIMIT',action));
    const echo=randomUUID();let body;
    try{body=JSON.stringify({action,params,echo});if(Buffer.byteLength(body)>this.#options.maxPayloadBytes)throw Error();}
    catch{return Promise.reject(fault('ONEBOT_PARAMS_INVALID',action));}
    return new Promise((resolve,reject)=>{
      const timeout=bounded(options.timeoutMs,this.#options.requestTimeoutMs,5,600000);
      const pending={action,resolve,reject,signal,abort:()=>this.#settle(echo,fault('ONEBOT_ABORTED',action)),timer:null};
      pending.timer=setTimeout(()=>this.#settle(echo,fault('ONEBOT_REQUEST_TIMEOUT',action)),timeout);
      this.#pending.set(echo,pending);
      signal?.addEventListener('abort',pending.abort,{once:true});
      // Cancellation can race serialization/subscription. It never retries a send.
      if(signal?.aborted){pending.abort();return;}
      socket.send(body,error=>{if(error)this.#settle(echo,fault('ONEBOT_SEND_FAILED',action));});
    });
  }
  async raw(action,params={},options={}){return (await this.request(action,params,options)).data;}
  sendPrivateMessage(userId,value){return this.raw('send_private_msg',{user_id:userId,message:message(value)});}
  sendGroupMessage(groupId,value){return this.raw('send_group_msg',{group_id:groupId,message:message(value)});}
  getLoginInfo(){return this.raw('get_login_info',{});}
  getGroupMemberInfo(groupId,userId,noCache=false){return this.raw('get_group_member_info',{group_id:groupId,user_id:userId,no_cache:noCache});}
  getGroupMemberList(groupId){return this.raw('get_group_member_list',{group_id:groupId});}
  getMessage(messageId){return this.raw('get_msg',{message_id:messageId});}
  getImage(options){return this.raw('get_image',typeof options==='string'?{file:options}:options);}
  fetchFaceEntity(){return Promise.reject(fault('ONEBOT_UNSUPPORTED_API','fetchFaceEntity'));}
  onPrivateMessage(listener){return this.on('private-message',listener);}
  onGroupMessage(listener){return this.on('group-message',listener);}
  onNotice(type,listener){return this.on('notice:'+type,listener);}
  onEvent(listener){return this.on('event',listener);}
  onBotStatus(listener){return this.onNotice('bot_status',listener);}
}
