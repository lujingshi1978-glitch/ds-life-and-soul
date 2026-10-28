import {randomUUID} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';
import {feedCandidates} from './multi-site-activity.js';
// Feiyu chooses actual tool calls. Harness enforces platform coverage and dryRun.
export class SocialSelfTest{
 constructor({social,think,core,ready,file,onReport=()=>{}}){Object.assign(this,{social,think,core,ready,file,onReport});this.running=false;this.report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;if(this.report?.status==='running')this.report.status='interrupted';}
 status(){return {running:this.running,report:this.report};}
 async run({platforms}={}){
  if(platforms&&(!Array.isArray(platforms)||!platforms.length||platforms.some(id=>!this.social.status().some(p=>p.id===id))))throw Error('自测平台无效');
  if(this.running)throw Error('自测正在进行');this.running=true;
  const report=this.report={id:randomUUID(),startedAt:Date.now(),status:'running',externalWrites:0,platforms:[]};
  const save=()=>{fs.writeFileSync(this.file,JSON.stringify(report,null,2));const dir=path.join(path.dirname(this.file),'social-self-tests');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,report.id+'.json'),JSON.stringify(report,null,2));};save();
  try{
   for(const cap of this.social.status().filter(p=>!platforms||platforms.includes(p.id))){
    if(!this.ready())throw Error('系统休眠或暂停，自测已停止');
    const row={platform:cap.id,reads:{},preflight:{},toolCalls:[]};report.platforms.push(row);
    try{row.login=(await this.social.check(cap.id)).login;}catch{row.login='unavailable';}
    if(row.login!=='ready'){row.blocked='需要登录；没有执行互动';save();continue;}
    let candidates=[],collectionId;const evidence=[];
    for(let round=0;round<3;round++){
     const required=round===0?cap.read.filter(a=>['feed','search','collections'].includes(a)):round===1?cap.read.filter(a=>['read','comments'].includes(a)):cap.write;
     if(!required.length)continue;
     const decision=await this.think({core:this.core(),prompt:'你是肥鱼，管理员让你自己检查网站工具能否用。这是实际诊断，不是假装上网。只返回JSON {calls:[{action:动作,params:{query:搜索词,target:目标,text:预检查文字,collectionId:收藏夹ID}}]}。本批需要测试：'+JSON.stringify({platform:cap.id,required,candidates:candidates.slice(0,2),collectionId,previous:row.reads,evidence:evidence.map(e=>({action:e.action,result:JSON.stringify(e.result).slice(0,5500)}))})+'。按需要逐项调用，目标必须来自实际候选。评论、点赞等全部是dryRun预检查，不会真实发送。不可把预检查成功说成发布成功。缺目标可省略，结果会标为未测。每批最多8次。'},AbortSignal.timeout(190000));
     const planned=decision.data?.calls;if(!Array.isArray(planned))throw Error('自测工具计划格式无效');const calls=[...planned,...required.filter(a=>!planned.some(c=>c.action===a)).map(action=>({action,params:{},coverageRepair:true}))];
     for(const call of calls.slice(0,8)){
      if(!required.includes(call.action)||row.toolCalls.some(t=>t.action===call.action))continue;
      const action=call.action,writing=cap.write.includes(action),p={...call.params};
      if(p.target){const match=knownTarget(cap.id,p.target,candidates);if(match)p.target=match;}
      if(p.target&&!candidates.some(c=>c.url===p.target)&&!(['subscribe','unsubscribe'].includes(action)&&p.target==='https://www.youtube.com/@YouTube')){row[writing?'preflight':'reads'][action]={status:'skipped',reason:'目标不来自本轮真实资料'};continue;}
      if(action==='search'&&!p.query)p.query='猫';
      if(['subscribe','unsubscribe'].includes(action)&&!p.target)p.target=candidates.find(c=>/\/(?:channel|@)/.test(new URL(c.url).pathname))?.url;
      if(['read','comments',...cap.write.filter(a=>a!=='post')].includes(action)&&!p.target){if(!candidates[0])continue;p.target=candidates[0].url;}
      if(action==='favorite'&&cap.id==='zhihu'){if(!collectionId)continue;p.collectionId=collectionId;}
      if(action==='reply'&&(!p.commentId||!p.userId))continue;
      if(writing){p.dryRun=true;p.text='工具连接预检查，不发送';}
      const started=Date.now();row.toolCalls.push({action,mode:writing?'dryRun':'read',origin:call.coverageRepair?'coverage-repair':'feiyu'});
      try{
       const result=writing?await this.social.act(cap.id,action,p):await this.social.read(cap.id,action,{...p,mode:action==='read'?'auto':'text'});
       if(writing){if(result.sent!==false)throw Error('预检查边界失效');row.preflight[action]={status:result.status,sent:false};}
       else{row.reads[action]={status:'passed',ms:Date.now()-started,resourceId:result.resourceId,perception:result.perception?{available:result.perception.available,coverage:result.perception.coverage}:undefined};if(['feed','search','read'].includes(action)){candidates.push(...feedCandidates(result.result,cap.id));if(cap.id==='zhihu')candidates.sort((a,b)=>Number(/\/answer\//.test(b.url))-Number(/\/answer\//.test(a.url)));}if(action==='collections'){const find=v=>{if(Array.isArray(v))return v.map(find).find(Boolean);if(v&&typeof v==='object'){if(/^\d+$/.test(String(v.id||v.collection_id||'')))return String(v.id||v.collection_id);return Object.values(v).map(find).find(Boolean);}};collectionId=find(result.result);}evidence.push({action,result:result.result,perception:result.perception});}
      }catch(e){row[writing?'preflight':'reads'][action]={status:'failed',error:String(e.message).slice(0,140)};}
      save();
     }
     for(const action of required)if(!row[round===2?'preflight':'reads'][action])row[round===2?'preflight':'reads'][action]={status:'not-tested',reason:'缺少真实目标/所需参数或本轮未调用'};
    }
    save();
   }
   const r=await this.think({core:this.core(),json:false,prompt:'你是肥鱼。你刚才实际调用工具检查了网站，向管理员简短返回结果，最多450字。逐站说可用、缺登录、失败或未测。互动只有预检查，不能说已经发布或点赞。不要编造通过项，不输出内部推理。以下是实际工具回执：'+JSON.stringify(report.platforms)},AbortSignal.timeout(190000));
   report.reply=String(r.data).slice(0,2000);report.status='complete';report.finishedAt=Date.now();save();await this.onReport(report);return report;
  }catch(e){report.status='failed';report.error=String(e.message).slice(0,180);save();throw e;}finally{this.running=false;}
 }
}

export function knownTarget(platform,input,candidates){
 try{const key=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return null;const hosts={xiaohongshu:['www.xiaohongshu.com','xiaohongshu.com'],youtube:['www.youtube.com','youtube.com','youtu.be'],zhihu:['www.zhihu.com','zhihu.com','zhuanlan.zhihu.com'],bilibili:['www.bilibili.com','bilibili.com','b23.tv'],weibo:['weibo.com','www.weibo.com','m.weibo.cn'],douyin:['www.douyin.com','douyin.com']}[platform]||[];if(!hosts.includes(u.hostname))return null;return platform==='xiaohongshu'?u.pathname.split('/').filter(Boolean).at(-1):platform==='youtube'?(u.searchParams.get('v')||u.pathname):u.pathname.replace(/\/$/,'');};const wanted=key(input);return wanted?candidates.find(c=>key(c.url)===wanted)?.url:null;}catch{return null;}
}
