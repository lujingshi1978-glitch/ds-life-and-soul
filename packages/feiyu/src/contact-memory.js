import {IMAGE_MEMORY_PROMPT} from './media-conversation.js';
import {normalizeQzoneDetail} from './qzone.js';
const MONTH=30*86400000;
export function publicHomepage(raw){
 const out={};for(const k of ['user_id','nickname','remark','sex','age','long_nick','qq_level','qid','customStatusDescInfo'])if(raw?.[k]!==undefined)out[k]=typeof raw[k]==='string'?raw[k].slice(0,1500):raw[k];
 if(!(Number(out.age)>0))delete out.age;if(out.sex==='unknown')delete out.sex;
 return {...out,source:'SnowLuma QQ公开资料卡',scope:'仅上游实际返回字段，不代表完整空间网页'};
}
export function createContactMemory(d){
 const db=d.store,preparing=new Map(),syncing=new Map();let working=false,syncRunning=false;
 let monthBackoffUntil=Number(db.db.prepare("SELECT value FROM contact_meta WHERE key='month-backoff-until'").get()?.value)||0;
 async function refreshHomepage(key){try{const profile=await d.readHomepage(key.slice(8));if(!d.allowed(key))throw Error('联系人已撤权');db.homepage(key,publicHomepage(profile));}catch(e){db.homepage(key,null,String(e.message).slice(0,300));}return db.getHomepage(key);}
 async function syncMonth(key){
  if(syncing.has(key))return syncing.get(key);
  if(Date.now()<monthBackoffUntil)throw Error('月动态列表接口暂缓重试，保留已归档动态；好友动态首页仍继续更新');
  const promise=(async()=>{
   if(!d.allowed(key))throw Error('联系人已撤权');
   const cutoff=Date.now()-MONTH,seen=new Set();let complete=false;
   try{
    let offset=0;
    for(let page=0;page<500;page++){
     if(!d.allowed(key)||!d.ready())throw Error('动态同步已暂停或撤权');
     const data=await d.readPosts(key.slice(8),offset,20);
     if(!Array.isArray(data?.msglist))throw Error('动态列表缺失，不能标记为完整');
     const list=data.msglist;if(!list.length){complete=true;break;}
     let reachedOld=false,added=0;
     for(const p of list){
      const at=Number(p.time)*1000;if(!Number.isFinite(at)||!at)throw Error('动态缺少发表时间');
      if(at<cutoff){reachedOld=true;continue;}
      if(!p.tid||seen.has(String(p.tid)))continue;seen.add(String(p.tid));added++;
      const old=db.post(key,p.tid);let comments=old?JSON.parse(old.comments_json):[];
      if(!old||old.body!==String(p.content??'')||old.comment_count!==Number(p.comment_num||0)){
       const detail=normalizeQzoneDetail(await d.readDetail(key.slice(8),String(p.tid),0),{uin:key.slice(8),tid:p.tid});comments=detail.comments;
      }
      db.upsertPost(key,{tid:p.tid,at,text:String(p.content??''),commentCount:p.comment_num,comments});
      for(const [i,url]of(p.images??[]).entries())if(typeof url==='string'&&/^https?:\/\//.test(url))db.enqueue(`post-image:${key}:${p.tid}:${i}`,key,'image',{target:'post',tid:String(p.tid),media:{kind:'image',url}});
     }
     offset+=list.length;
     if((reachedOld&&list.every(p=>Number(p.time)*1000<cutoff))||(Number.isFinite(Number(data.total))&&offset>=Number(data.total))){complete=true;break;}
     if(!added)throw Error('上游分页重复，月动态同步不完整');
    }
    if(!complete)throw Error('动态超过单次安全分页范围，同步尚未完整');
    db.sync(key,{complete:true});return {ok:true,count:db.posts(key).length};
   }catch(e){db.sync(key,{complete:false,error:String(e.message).slice(0,300)});if(/HTTP 50[1234]|status code: 50[1234]|-10000|使用人数过多|429/.test(e.message)){monthBackoffUntil=Date.now()+1800000;db.db.prepare('INSERT OR REPLACE INTO contact_meta VALUES(?,?)').run('month-backoff-until',String(monthBackoffUntil));}throw e;}
  })();syncing.set(key,promise);try{return await promise;}finally{syncing.delete(key);}
 }
 async function prepare(key,stage,{foregroundBudgetMs}={}){
  if(preparing.has(key)){
   const task=preparing.get(key);if(foregroundBudgetMs===undefined)return task;
   let timer;try{return await Promise.race([task,new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,foregroundBudgetMs));})]);}finally{clearTimeout(timer);}
  }
  const run=(async()=>{
   const user=db.user(key);if(user.prepared_stage===stage)return;
   await refreshHomepage(key);
   const sync=db.syncStatus(key);if((!sync||Date.now()-sync.at>300000)&&!(sync?.next_retry_at>Date.now())&&Date.now()>=monthBackoffUntil){
    const task=syncMonth(key).catch(e=>d.log('[contact-memory] 月动态读取失败',key,e.message));
    if(foregroundBudgetMs===undefined)await task;
   }
   db.prepared(key,stage);
  })();preparing.set(key,run);
  const completed=run.finally(()=>{if(preparing.get(key)===run)preparing.delete(key);});
  if(foregroundBudgetMs===undefined)return completed;
  let timer;try{return await Promise.race([completed,new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,foregroundBudgetMs));})]);}finally{clearTimeout(timer);}
 }
 // Compatibility delivery only: portraits are projections of cognition memory.
 // Missing cognition never falls back to the retired portrait model worker.
 function queuePortrait(stage){
  if(!/^private:\d+$/.test(stage?.key)||!d.allowed(stage.key))return {status:'disabled',reason:'contact-not-allowed'};
  if(typeof d.cognition?.queueStage!=='function')return {status:'disabled',reason:'cognition-projection-required'};
  d.cognition.queueStage(stage);return {status:'queued',source:'cognition-projection'};
 }
 function queuePostPortrait(key,post){
  if(!/^private:\d+$/.test(key)||!d.allowed(key))return {status:'disabled',reason:'contact-not-allowed'};
  if(typeof d.cognition?.queuePost!=='function')return {status:'disabled',reason:'cognition-projection-required'};
  d.cognition.queuePost(key,post);return {status:'queued',source:'cognition-projection'};
 }
 async function work(){
  if(working)return;
  db.db.prepare("UPDATE contact_jobs SET status='cancelled',payload='{}',error='retired: handled by V3 cognition projections' WHERE kind='portrait' AND status IN ('pending','running')").run();
  if(!d.ready())return;const job=db.nextJob();if(!job)return;const key='private:'+job.qq;if(!d.allowed(key)){db.db.prepare("UPDATE contact_jobs SET status='cancelled',payload='{}' WHERE id=?").run(job.id);return;}
  working=true;db.startJob(job.id);
  try{
   const p=JSON.parse(job.payload);
   if(job.kind==='image'){
    const images=await d.images([p.media]);if(!images.some(x=>x.type==='image'))throw Error('图片无法读取，未编造描述');
    const raw=await d.analyze(IMAGE_MEMORY_PROMPT,images);
    if(!d.allowed(key)||!d.ready())throw Error('图片处理期间已暂停或撤权');db.imageResult(job,raw);
   }else throw Error('未知记忆任务');
   db.finishJob(job.id);
  }catch(e){if(['BACKGROUND_ATTENTION_BUSY','BACKGROUND_PREEMPTED','V3_HOURLY_MODEL_BUDGET'].includes(e.code||e.message)||e.name==='AbortError'){db.db.prepare("UPDATE contact_jobs SET status='pending',attempts=max(0,attempts-1),retry_at=?,error=? WHERE id=?").run(e.code==='V3_HOURLY_MODEL_BUDGET'?(Math.floor(Date.now()/3600000)+1)*3600000:Date.now()+15000,String(e.code||e.message).slice(0,200),job.id);}else db.failJob(job,e);d.log('[contact-memory] 任务失败',job.id,e.message);}finally{working=false;}
 }
 async function syncAll(){if(syncRunning||!d.ready()||Date.now()<monthBackoffUntil)return;syncRunning=true;try{for(const key of db.keys()){if(!d.ready()||Date.now()<monthBackoffUntil)break;if(d.allowed(key)&&!(db.syncStatus(key)?.next_retry_at>Date.now()))try{await syncMonth(key);}catch(e){d.log('[contact-memory] 动态抓取失败',key,e.message);}}}finally{syncRunning=false;}}
 return {prepare,syncMonth,syncAll,work,queuePortrait,queuePostPortrait,refreshHomepage};
}
