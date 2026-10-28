import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';import {once} from 'node:events';
import {normalizeQqSetup,accountList,mergeQqConfig,probeQqGateway,saveQqConfig,qqErrorMessage,createQqPrompts} from '../scripts/qq-setup.mjs';
import {PassThrough,Writable} from 'node:stream';
const require=createRequire(new URL('../packages/feiyu/package.json',import.meta.url)),{WebSocket,WebSocketServer}=require('ws');
const input={wsUrl:'ws://127.0.0.1:3001',httpUrl:'http://127.0.0.1:3000',accessToken:'fixture-gateway-token',ownerQQ:100001,privateIds:[100002],groupIds:[100003]};
const base=()=>({ownerQQ:100001,snowluma:{enabled:false,accessToken:'fixture-old-token',custom:'retain'},allow:{private:[100009],groups:[]},deny:{private:[100008],groups:[]},allowAllWhenEmpty:false,socialV2:{proactive:{enabled:false},mind:{version:3}},core:'fixture core',custom:{keep:true}});
async function gateway(t,options={}){
 const calls=[],httpServer=http.createServer((req,res)=>{calls.push({transport:'http',action:req.url.slice(1),token:req.headers.authorization});req.resume();if(options.redirect){res.writeHead(302,{location:'http://127.0.0.1:1/never'});return res.end();}if(req.headers.authorization!=='Bearer '+input.accessToken){res.writeHead(401);return res.end();}if(options.slow)return;const login=req.url==='/get_login_info';res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',retcode:0,data:login?{user_id:options.httpId||100010}:{online:options.online!==false}}));});
 await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));
 const wsServer=new WebSocketServer({host:'127.0.0.1',port:0,verifyClient:info=>info.req.headers.authorization==='Bearer '+(options.wsToken||input.accessToken)});await once(wsServer,'listening');
 wsServer.on('connection',socket=>{socket.on('message',raw=>{const v=JSON.parse(raw);calls.push({transport:'ws',action:v.action});if(options.slow)return;socket.send(JSON.stringify({post_type:'message',raw_message:'fixture incoming event must not be retained'}));socket.send(JSON.stringify({status:'ok',retcode:0,echo:v.echo,data:v.action==='get_login_info'?{user_id:options.wsId||100010}:{online:options.online!==false}}));});});
 t.after(async()=>{for(const c of wsServer.clients)c.terminate();await new Promise(r=>wsServer.close(r));httpServer.closeAllConnections();await new Promise(r=>httpServer.close(r));});
 return {config:{...input,wsUrl:'ws://127.0.0.1:'+wsServer.address().port,httpUrl:'http://127.0.0.1:'+httpServer.address().port},calls};
}
function storage(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-qq-setup-')),file=path.join(root,'packages/feiyu/config.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(base()));t.after(()=>{const actual=fs.realpathSync(root);assert.equal(path.dirname(actual).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());assert(path.basename(actual).startsWith('feiyu-qq-setup-'));fs.rmSync(actual,{recursive:true,force:true});});return {root,file,bytes:fs.readFileSync(file)};}
test('local endpoints and explicit account scope are normalized without widening permissions',()=>{
 const c=normalizeQqSetup({...input,privateIds:'100002，100002;100004'});assert.deepEqual(c.privateIds,[100001,100002,100004]);assert.deepEqual(accountList(''),[]);
 for(const url of ['ws://example.com:3001','ws://localhost:3001','ws://127.0.0.1:3001/event','ws://127.0.0.1:3001/?access_token=fixture','ws://name:pass@127.0.0.1:3001','http://127.0.0.1:3001'])assert.throws(()=>normalizeQqSetup({...input,wsUrl:url}));
 for(const ownerQQ of [1,0,'all','100001\nextra',9007199254740992])assert.throws(()=>normalizeQqSetup({...input,ownerQQ}));
 for(const accessToken of ['', 'bad token', 'fixture\nsecret'])assert.throws(()=>normalizeQqSetup({...input,accessToken}));
});
test('merging retains core, memory settings, blacklist, custom gateway fields and proactive switch',()=>{
 const old=base(),next=mergeQqConfig(old,input);assert.equal(next.snowluma.enabled,true);assert.equal(next.snowluma.custom,'retain');assert.equal(next.snowluma.followDiscoveredEndpoint,false);assert.equal(next.snowluma.homeDir,'');assert.deepEqual(next.allow,{private:[100001,100002],groups:[100003]});assert.equal(next.allowAllWhenEmpty,false);for(const key of ['deny','socialV2','core','custom'])assert.deepEqual(next[key],old[key]);assert.equal(old.snowluma.enabled,false);
 assert.throws(()=>mergeQqConfig(old,{...input,privateIds:[100008]}),{code:'QQ_SCOPE_DENIED'});
});
test('real HTTP and WS probe checks same online account using only read actions',async t=>{
 const f=await gateway(t),result=await probeQqGateway(f.config,{WebSocket});assert.equal(result.ok,true);assert.deepEqual(f.calls.map(x=>x.action).sort(),['get_login_info','get_login_info','get_status','get_status']);assert(f.calls.filter(x=>x.transport==='http').every(x=>x.token==='Bearer '+input.accessToken));assert(!JSON.stringify(result).includes(input.accessToken));assert(!JSON.stringify(result).includes('incoming event'));
});
for(const [label,options,code] of [['offline',{online:false},'QQ_ACCOUNT_OFFLINE'],['different account',{httpId:100011},'QQ_GATEWAYS_DIFFERENT_ACCOUNTS'],['WS token',{wsToken:'fixture-another-token'},'QQ_WS_AUTH_FAILED'],['HTTP redirect',{redirect:true},'QQ_HTTP_UNAVAILABLE'],['timeout',{slow:true},'QQ_WS_TIMEOUT']])test('probe rejects '+label,async t=>{
 const f=await gateway(t,options);await assert.rejects(probeQqGateway(f.config,{WebSocket,timeoutMs:options.slow?100:2000}),{code});assert(f.calls.every(x=>['get_login_info','get_status'].includes(x.action)));
});
test('HTTP token failure is distinct and no save occurs',async t=>{
 const f=await gateway(t),config={...f.config,accessToken:'fixture-wrong-token'};await assert.rejects(probeQqGateway(config,{WebSocket,timeoutMs:1000}),e=>['QQ_WS_AUTH_FAILED','QQ_HTTP_AUTH_FAILED'].includes(e.code));
});
test('successful save backs up exact bytes, changes only selected gateway and scope fields',async t=>{
 const f=storage(t),g=await gateway(t);const result=await saveQqConfig({root:f.root,input:g.config,expectedBytes:f.bytes});assert.equal(result.saved,true);assert.equal(result.proactiveEnabled,false);const next=JSON.parse(fs.readFileSync(f.file));assert.deepEqual(next,mergeQqConfig(base(),g.config));const files=fs.readdirSync(path.join(f.root,'.local/qq-setup-backups'));assert.equal(files.length,1);assert.deepEqual(fs.readFileSync(path.join(f.root,'.local/qq-setup-backups',files[0])),f.bytes);assert(!JSON.stringify(result).includes(input.accessToken));
});
test('failed probe never writes configuration or creates backup',async t=>{
 const f=storage(t);await assert.rejects(saveQqConfig({root:f.root,input,expectedBytes:f.bytes,probe:async()=>{throw Object.assign(new Error('fixture secret raw error'),{code:'QQ_ACCOUNT_OFFLINE'});}}),{code:'QQ_ACCOUNT_OFFLINE'});assert.deepEqual(fs.readFileSync(f.file),f.bytes);assert.equal(fs.existsSync(path.join(f.root,'.local')),false);
});
test('running bridge is refused before networking',async t=>{
 const f=storage(t);let calls=0;await assert.rejects(saveQqConfig({root:f.root,input,isRunning:async()=>true,probe:async()=>{calls++;return {ok:true};}}),{code:'QQ_STOP_FIRST'});assert.equal(calls,0);assert.deepEqual(fs.readFileSync(f.file),f.bytes);
});
test('external edit during probing and stale draft are preserved',async t=>{
 const f=storage(t),edited=Buffer.from('{"external":"fixture edit"}');await assert.rejects(saveQqConfig({root:f.root,input,probe:async()=>{fs.writeFileSync(f.file,edited);return {ok:true};}}),{code:'QQ_CONFIG_CHANGED'});assert.deepEqual(fs.readFileSync(f.file),edited);await assert.rejects(saveQqConfig({root:f.root,input,expectedBytes:f.bytes}),{code:'QQ_CONFIG_CHANGED'});assert.equal(fs.existsSync(path.join(f.root,'.local')),false);
});
test('failure messages never echo raw gateway error or credentials',()=>{const message=qqErrorMessage({code:'QQ_WS_UNAVAILABLE',message:input.accessToken});assert(!message.includes(input.accessToken));assert(!qqErrorMessage({code:'raw-'+input.accessToken}).includes(input.accessToken));});
test('interactive secret is never echoed and later visible questions still work',async()=>{
 const source=new PassThrough();let shown='';const output=new Writable({write(chunk,_encoding,callback){shown+=chunk;callback();}}),p=createQqPrompts({input:source,output});
 try{const secret=p.secret('Token');source.write(input.accessToken+'\r');assert.equal(await secret,input.accessToken);const visible=p.ask('Owner');source.write('100001\r');assert.equal(await visible,'100001');assert(!shown.includes(input.accessToken));assert(shown.includes('100001'));const keep=p.secret('Token','fixture-old-token');source.write('\r');assert.equal(await keep,'fixture-old-token');assert(!shown.includes('fixture-old-token'));}finally{p.close();source.end();output.end();}
});
