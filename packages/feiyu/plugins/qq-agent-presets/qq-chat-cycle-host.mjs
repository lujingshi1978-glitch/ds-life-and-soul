import fs from 'node:fs';
import { decodeDialogueEvent } from './dialogue-protocol.mjs';
import { createChatCycles } from './chat-cycle.mjs';
import {publishDialogueContext,clearDialogueContext} from './dialogue-context.mjs';
import {QQ_OUTPUT_FORMAT_RETRY_POLICY} from './output-format-retry.mjs';
export const name='qq-chat-cycle-host';
export const inject=['webServer','sessionController','agents'];
const secret=()=>fs.readFileSync(new URL('../../state/console-token',import.meta.url),'utf8').trim();
export function apply(ctx){
  const controller=createChatCycles({
    resolve:async id=>{
      const live=ctx.agents.get(id);if(live)return live;
      const resumed=await ctx.sessionController.resolveAgent(id);
      return resumed.agent;
    },
    execute:async(request,event)=>{
      const rollback=publishDialogueContext(event);
      try{return await ctx.sessionController.prompt(request,AbortSignal.timeout(30000));}
      catch(error){rollback();throw error;}
    },
  });
  ctx.provide('qqChatCycles',controller);
  // Native Cordis lifetime: unloading this plugin only closes its own cycles.
  ctx.on('session/event',(session,event)=>controller.observe(session.id,event));
  ctx.on('agent/disposed',({agent})=>{controller.close(agent.id);clearDialogueContext(agent.id);});
  ctx.on('dispose',()=>{for(const c of controller.status())clearDialogueContext(c.sessionId);controller.dispose();});
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/qq-chat-cycle/submit',handler:async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||req.headers['sec-fetch-site']==='cross-site')return reply(403,{ok:false,error:'Local bridge only'});
      if(req.method!=='POST')return reply(405,{ok:false,error:'POST required'});
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>6*1024*1024)return reply(413,{ok:false,error:'Too large'});chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!Array.isArray(body.content)||body.content[0]?.type!=='text'||typeof body.requestId!=='string'||body.requestId.length>100)throw Error('Invalid cycle input');
      const event=decodeDialogueEvent(body.content[0].text,secret(),body.sessionId);
      if(!event)throw Error('Signed dialogue event required');
      const value=await controller.submit(event,body.content,body.requestId);
      reply(200,{ok:true,value});
    }catch{reply(400,{ok:false,error:'QQ chat cycle submission rejected'});}
  }}),'qq-chat-cycle.submit');
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/qq-chat-cycle/status',handler:(req,res)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end();return;}
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ok:true,implementation:'independent-chat-cycle',contextPolicy:'single-snapshot-per-cycle-v1',behaviorProtocol:'behavior-frame-v1',runtimeTuningProtocol:'contextual-budgets-v1',affinityPolicy:'affinity-chat-v1',executionBackend:'dsh-session-controller',outputRecovery:{version:'qq-output-v1',scope:'authenticated-qq-chat-v2',requestRetries:QQ_OUTPUT_FORMAT_RETRY_POLICY.maxRetries,retryableCodes:QQ_OUTPUT_FORMAT_RETRY_POLICY.retryableCodes},cycles:controller.status()}));
  }}),'qq-chat-cycle.status');
  console.log('[qq-chat-cycle] independent conversation controller ready');
}
