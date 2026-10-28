/** In-memory loopback fixture. Never imports bridge.js, credentials or stored memories. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {defaultRuntimeTuning,mergeRuntimeTuning,runtimeTuningView} from '../src/runtime-tuning.js';

export async function startRuntimeTuningUiFixture({port=0}={}){
  const html=await readFile(new URL('../public/console.html',import.meta.url));
  let values=defaultRuntimeTuning(),revision=1;const requests=[];
  const context=()=>({profileId:'runtime-ui-fixture',activationEpoch:1,resource:'global:/api/runtime-tuning',revision});
  const effective={appliesTo:'当前本机的所有角色',budget:{limitCny:10,knownCny:2.37,windingDown:false,unknownCost:1,nextResetAt:Date.parse('2026-10-29T00:00:00+08:00')},embedding:{configured:true,model:'fixture-model-512',dimensions:512,serviceHealth:'not-probed',requiresRestart:true,index:{eligible:24,covered:20,missing:4,requiresReindex:true}}};
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');const json=(code,value)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-role-context':encodeURIComponent(JSON.stringify(context()))});res.end(JSON.stringify(value));};
    if(req.method==='GET'&&['/','/console.html'].includes(url.pathname)){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(url.pathname!=='/api/runtime-tuning'){json(404,{ok:false,error:'本地夹具不提供此接口'});return;}
    if(req.method==='GET'){requests.push({method:'GET'});json(200,runtimeTuningView(values,{revision,effective:{...effective,budget:{...effective.budget,limitCny:values.budget.dailySoftLimitCny}}}));return;}
    if(req.method!=='POST'){json(405,{ok:false,error:'method'});return;}
    if(req.headers['x-console-token']!=='fixture-runtime-only'){json(401,{ok:false,error:'仅接受夹具令牌'});return;}
    let text='';try{for await(const chunk of req){text+=chunk;if(text.length>65536)throw Error('payload');}const body=JSON.parse(text),c=JSON.parse(decodeURIComponent(req.headers['x-role-context']||''));requests.push({method:'POST',body});if(c.profileId!==context().profileId||c.activationEpoch!==1||c.resource!==context().resource||c.revision!==revision||body.revision!==revision){json(409,{ok:false,error:'参数版本已变化，夹具草稿保留'});return;}values=mergeRuntimeTuning(values,body.values);revision++;json(200,runtimeTuningView(values,{revision,effective}));}catch{json(400,{ok:false,error:'夹具参数无效'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port+'/?token=fixture-runtime-only#runtime',requests,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const fixture=await startRuntimeTuningUiFixture();console.log(fixture.url);process.once('SIGINT',async()=>{await fixture.close();process.exit(0);});
}
