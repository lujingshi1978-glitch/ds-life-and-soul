// Chromium must not resolve a second time after the host's public-address check.
// This loopback proxy pins every upstream TCP connection to a checked numeric IP.
// TLS remains end to end; it does not decrypt traffic or retain bodies/headers.
import http from 'node:http';import net from 'node:net';
import {validateFetchUrl,isPrivateIp} from './safe-fetch.js';
export async function createBrowserEgress({validate=validateFetchUrl,connect=options=>net.connect(options),timeoutMs=10000}={}){
 const sockets=new Set();let closed=false;
 const track=s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));s.on('error',()=>{});s.setTimeout(timeoutMs,()=>s.destroy());return s;};
 async function dial(raw){
  if(closed)throw Error('EGRESS_CLOSED');const {url,addresses}=await validate(raw,{recoverProxyDns:true});
  if(closed||!['http:','https:'].includes(url.protocol)||url.username||url.password||!addresses?.length||addresses.some(isPrivateIp))throw Error('EGRESS_DENIED');
  const port=Number(url.port||(url.protocol==='https:'?443:80));let last;
  for(const host of addresses){try{return await new Promise((resolve,reject)=>{
   if(closed)return reject(Error('EGRESS_CLOSED'));const upstream=track(connect({host,port}));
   const timer=setTimeout(()=>{upstream.destroy();reject(Error('EGRESS_CONNECT_TIMEOUT'));},timeoutMs);
   upstream.once('connect',()=>{clearTimeout(timer);resolve({url,upstream});});upstream.once('error',e=>{clearTimeout(timer);reject(e);});upstream.once('close',()=>{clearTimeout(timer);reject(Error('EGRESS_CONNECT_CLOSED'));});
  });}catch(e){last=e;}}throw last||Error('EGRESS_UNREACHABLE');
 }
 const server=http.createServer(async(req,res)=>{
  let upstream;try{
   if(!/^http:\/\//i.test(req.url))throw Error('ABSOLUTE_HTTP_REQUIRED');
   const result=await dial(req.url);upstream=result.upstream;const url=result.url;
   if(req.destroyed){upstream.destroy();return;}
   const headers={...req.headers,host:url.host};for(const key of ['proxy-authorization','proxy-connection','connection','keep-alive','upgrade','te','trailer','transfer-encoding',...String(headers.connection||'').toLowerCase().split(',').map(x=>x.trim())])delete headers[key];
   const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>upstream;
   const outgoing=http.request({hostname:url.hostname,port:url.port||80,method:req.method,path:url.pathname+url.search,headers,agent},response=>{
    const clean={...response.headers};for(const key of ['connection','keep-alive','upgrade','proxy-authenticate','proxy-authorization',...String(clean.connection||'').toLowerCase().split(',').map(x=>x.trim())])delete clean[key];
    res.writeHead(response.statusCode,clean);response.pipe(res);
   });outgoing.on('error',()=>{upstream.destroy();if(!res.headersSent)res.writeHead(502);res.end();});
   req.on('aborted',()=>outgoing.destroy());res.on('close',()=>{outgoing.destroy();agent.destroy();});req.pipe(outgoing);
  }catch{upstream?.destroy();if(!res.headersSent)res.writeHead(403);res.end();}
 });
 server.on('connection',track);server.on('clientError',(_,socket)=>socket.destroy());
 server.on('connect',async(req,client,head)=>{let upstream;try{
  if(!/^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):[0-9]{1,5}$/.test(req.url))throw Error('CONNECT_AUTHORITY_INVALID');
  const result=await dial('https://'+req.url);upstream=result.upstream;
  if(client.destroyed){upstream.destroy();return;}client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
 }catch{upstream?.destroy();client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}});
 server.on('upgrade',(_,socket)=>socket.destroy());server.headersTimeout=10000;server.requestTimeout=30000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {server:'http://127.0.0.1:'+server.address().port,async close(){closed=true;for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}};
}
