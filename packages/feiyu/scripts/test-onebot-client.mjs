import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocketServer} from 'ws';
import {SnowLumaWebSocketClient as Client,text,validateOneBotUrl} from '../src/onebot-client.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let i=0;i<200;i++){if(check())return;await wait(5);}assert.fail('fixture condition timed out');}
async function fixture(t,handler=()=>{},options={}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const seen=[],headers=[],sockets=[],clients=[];
  server.on('connection',(socket,req)=>{headers.push(req.headers);sockets.push(socket);socket.on('error',()=>{});socket.on('message',bytes=>{const p=JSON.parse(bytes.toString());seen.push(p);handler(socket,p);});});
  const url=`ws://127.0.0.1:${server.address().port}/`;
  t.after(async()=>{await Promise.all(clients.map(c=>c.close()));for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
  const make=extra=>{const client=new Client({url,requestTimeoutMs:100,reconnectMinMs:10,reconnectMaxMs:20,...options,...extra});clients.push(client);return client;};
  return {server,seen,headers,sockets,url,make};
}
const reply=(socket,p,data={fixture:true})=>socket.send(JSON.stringify({status:'ok',retcode:0,data,echo:p.echo}));
const fails=code=>error=>error.code===code;

test('literal loopback boundary, token validation, text segment and no implicit connection',async()=>{
  for(const url of ['ws://example.com/','wss://8.8.8.8/','ws://localhost/','http://127.0.0.1/','ws://user:pass@127.0.0.1/','ws://127.0.0.1/?access_token=secret'])assert.throws(()=>validateOneBotUrl(url),/ONEBOT_ENDPOINT/);
  assert.equal(validateOneBotUrl('ws://[::1]:3001/'),'ws://[::1]:3001/');
  assert.equal(new Client({url:'ws://127.0.0.1:3001'}).url,'ws://127.0.0.1:3001');
  const client=new Client();assert.equal(client.connected,false);assert.throws(()=>{client.accessToken='bad\ntoken';},/ONEBOT_TOKEN_INVALID/);
  await assert.rejects(client.raw('get_login_info',{}),fails('ONEBOT_NOT_CONNECTED'));
  assert.deepEqual(text('literal [CQ:image]'),{type:'text',data:{text:'literal [CQ:image]'}});
  await client.close();
});

test('one in-flight connect, opaque echo correlation and request-envelope/raw-data compatibility',async t=>{
  const f=await fixture(t,(s,p)=>setTimeout(()=>reply(s,p,{action:p.action}),p.action==='slow'?20:0));const c=f.make({accessToken:'fixture-header-only'});
  const a=c.connect(),b=c.connect();assert.equal(a,b);await a;assert.equal(f.sockets.length,1);
  assert.equal(f.headers[0].authorization,'Bearer fixture-header-only');assert.equal(f.headers[0]['sec-websocket-protocol'],undefined);
  const [slow,fast]=await Promise.all([c.raw('slow'),c.request('fast')]);assert.equal(slow.action,'slow');assert.equal(fast.status,'ok');assert.equal(fast.data.action,'fast');
  assert.notEqual(f.seen[0].echo,f.seen[1].echo);assert(!JSON.stringify(f.seen).includes('fixture-header-only'));assert.equal(c.pendingCount,0);
});

test('standard convenience methods map their exact OneBot parameters',async t=>{
  const f=await fixture(t,(s,p)=>reply(s,p,p.params));const c=f.make();await c.connect();
  await c.sendPrivateMessage(1,text('private'));await c.sendGroupMessage(2,[text('group')]);await c.getLoginInfo();await c.getGroupMemberInfo(2,1);await c.getGroupMemberList(2);await c.getMessage(3);await c.getImage({file:'fixture.png'});
  assert.deepEqual(f.seen.map(p=>p.action),['send_private_msg','send_group_msg','get_login_info','get_group_member_info','get_group_member_list','get_msg','get_image']);
  assert.deepEqual(f.seen[0].params,{user_id:1,message:[text('private')]});assert.deepEqual(f.seen[3].params,{group_id:2,user_id:1,no_cache:false});assert.deepEqual(f.seen[5].params,{message_id:3});assert.deepEqual(f.seen[6].params,{file:'fixture.png'});
  await assert.rejects(c.fetchFaceEntity(1),fails('ONEBOT_UNSUPPORTED_API'));assert.equal(f.seen.length,7);
});

test('event routing preserves packets and contains asynchronous listener failures',async t=>{
  const f=await fixture(t);const c=f.make(),all=[],privateEvents=[],group=[],notify=[],status=[],errors=[];
  c.onEvent(e=>all.push(e));c.onPrivateMessage(e=>privateEvents.push(e));c.onGroupMessage(e=>group.push(e));c.onNotice('notify',e=>notify.push(e));c.onBotStatus(e=>status.push(e));c.on('error',e=>errors.push(e));
  c.onPrivateMessage(async()=>{throw Error('fixture-DO_NOT_LEAK_FIXTURE_SECRET');});await c.connect();
  for(const p of [{post_type:'message',message_type:'private',user_id:1},{post_type:'message',message_type:'group',group_id:2},{post_type:'notice',notice_type:'notify',sub_type:'poke'},{post_type:'notice',notice_type:'bot_status',sub_type:'online'},{post_type:'meta_event',meta_event_type:'heartbeat',status:{good:true}}])f.sockets[0].send(JSON.stringify(p));
  await until(()=>all.length===5&&errors.length===1);assert.equal(privateEvents.length,1);assert.equal(group.length,1);assert.equal(notify.length,1);assert.equal(status.length,1);assert.equal(all[4].status.good,true);assert.equal(errors[0].message,'ONEBOT_LISTENER_ERROR');
});

test('failure/async responses reject without leaking remote wording or parameters',async t=>{
  const f=await fixture(t,(s,p)=>s.send(JSON.stringify({status:p.action==='queued'?'async':'failed',retcode:p.action==='queued'?1:1404,wording:'fixture-DO_NOT_LEAK_FIXTURE_SECRET',data:{token:'fixture-DO_NOT_LEAK_FIXTURE_SECRET'},echo:p.echo})));const c=f.make();await c.connect();
  await assert.rejects(c.raw('missing',{token:'fixture-DO_NOT_LEAK_FIXTURE_SECRET'}),e=>e.code==='ONEBOT_API_FAILED'&&e.retcode===1404&&!JSON.stringify(e).includes('fixture-DO_NOT_LEAK_FIXTURE_SECRET')&&!e.message.includes('fixture-DO_NOT_LEAK_FIXTURE_SECRET'));
  await assert.rejects(c.request('queued'),fails('ONEBOT_ASYNC_UNCONFIRMED'));assert.equal(c.pendingCount,0);
});

test('timeout, AbortSignal and pending limits settle exactly once without replay',async t=>{
  const f=await fixture(t);const c=f.make({requestTimeoutMs:25,maxPending:1});await c.connect();
  const timeout=c.raw('no_reply');await assert.rejects(c.raw('excess'),fails('ONEBOT_REQUEST_LIMIT'));await assert.rejects(timeout,fails('ONEBOT_REQUEST_TIMEOUT'));
  const abort=new AbortController(),request=c.raw('cancelled',{}, {signal:abort.signal});abort.abort();await assert.rejects(request,fails('ONEBOT_ABORTED'));assert.equal(c.pendingCount,0);
  await wait(10);assert.equal(f.seen.filter(p=>p.action==='no_reply').length,1);assert.equal(f.seen.filter(p=>p.action==='cancelled').length,1);
});

test('disconnect cancels pending actions and reconnects once without replaying requests',async t=>{
  const f=await fixture(t);const c=f.make({reconnect:true});await c.connect();
  const pending=c.raw('no_replay');await until(()=>f.seen.length===1);f.sockets[0].terminate();await assert.rejects(pending,fails('ONEBOT_DISCONNECTED'));
  await until(()=>f.sockets.length===2&&c.connected);await wait(40);assert.equal(f.sockets.length,2);assert.equal(f.seen.length,1);assert.equal(c.pendingCount,0);
});

test('token/url hot updates and bridge close→connect pattern serialize physical sockets',async t=>{
  const f=await fixture(t);const c=f.make({accessToken:'fixture-old',reconnect:true});await c.connect();
  c.accessToken='fixture-new';await until(()=>f.headers.length===2&&c.connected);assert.equal(f.headers[1].authorization,'Bearer fixture-new');
  c.accessToken='fixture-third';c.url=f.url;c.close(1000,'token-refresh');const a=c.connect(),b=c.connect();assert.equal(a,b);await a;
  await wait(50);assert.equal(f.headers.length,3);assert.equal(f.headers[2].authorization,'Bearer fixture-third');assert.equal([...f.server.clients].filter(s=>s.readyState===1).length,1);
});

test('explicit close cancels pending calls and stops automatic reconnect; later connect is allowed',async t=>{
  const f=await fixture(t);const c=f.make({reconnect:true});await c.connect();const pending=c.raw('close_pending');await until(()=>f.seen.length===1);
  const closed=c.close(1000,'fixture-close');await assert.rejects(pending,fails('ONEBOT_CLOSED'));await closed;await wait(60);assert.equal(f.sockets.length,1);assert.equal(c.connected,false);assert.equal(c.pendingCount,0);
  await c.connect();assert.equal(f.sockets.length,2);assert.equal(c.connected,true);assert.throws(()=>c.close(1000.5),/ONEBOT_CLOSE_INVALID/);
});

test('malformed incoming packets are sanitized and cannot consume a pending echo',async t=>{
  const f=await fixture(t);const c=f.make();const errors=[];c.on('error',e=>errors.push(e));await c.connect();
  f.sockets[0].send('invalid fixture-DO_NOT_LEAK_FIXTURE_SECRET');await until(()=>errors.length===1);assert.equal(errors[0].message,'ONEBOT_PROTOCOL_ERROR');
  f.sockets[0].send(JSON.stringify({echo:'unsolicited',status:'ok',retcode:0,data:{}}));await wait(5);assert.equal(c.pendingCount,0);assert.equal(c.connected,true);
});

test('connection refusal has bounded retries and diagnostic errors contain no token',async t=>{
  const f=await fixture(t),port=f.server.address().port;await new Promise(resolve=>f.server.close(resolve));
  const c=f.make({url:`ws://127.0.0.1:${port}/`,accessToken:'fixture-DO_NOT_LEAK_FIXTURE_SECRET',reconnect:true,maxReconnectAttempts:2,connectTimeoutMs:50});
  const errors=[],closes=[];c.on('error',e=>errors.push(e));c.on('close',e=>closes.push(e));await assert.rejects(c.connect(),/ONEBOT_CONNECTION/);
  await until(()=>errors.some(e=>e.code==='ONEBOT_RECONNECT_EXHAUSTED'));assert.equal(closes.length,3);await wait(50);assert.equal(closes.length,3);assert(!JSON.stringify(errors).includes('fixture-DO_NOT_LEAK_FIXTURE_SECRET'));
  c.accessToken='fixture-updated-after-exhaustion';await until(()=>closes.length>=4);await c.close();
});
