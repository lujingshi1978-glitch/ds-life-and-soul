import {tuningFor} from './runtime-tuning.js';

const DAY=86400000,OFFSET=8*3600000;
export function beijingDayWindow(at=Date.now()){
 if(!Number.isSafeInteger(at)||at<0)throw new TypeError('Invalid usage timestamp');
 const start=Math.floor((at+OFFSET)/DAY)*DAY-OFFSET;
 return {day:new Date(start+OFFSET).toISOString().slice(0,10),from:start,to:start+DAY,timeZone:'Asia/Shanghai'};
}

/** A scheduling preference. It never aborts an in-flight request or grants an action. */
export class DailyCostBudget {
 constructor({source,settings,readSpending=()=>null,now=Date.now}={}){Object.assign(this,{source,settings,readSpending,now});this.reached=null;}
 status(){
  const at=this.now(),window=beijingDayWindow(at),config=this.settings?.()??tuningFor(this.source).budget;
  const limit=config.dailySoftLimitCny,grace=config.windDownGraceMs;
  let usage,error=null;try{usage=this.readSpending({at});if(usage&&typeof usage.then==='function'){void usage.catch(()=>{});usage=null;error='asynchronous-usage-unavailable';}}catch{error='usage-unavailable';}
  const known=usage?.currency==='CNY'&&Number.isFinite(usage.knownCny)&&usage.knownCny>=0?usage.knownCny:null;
  const enabled=Number.isFinite(limit)&&limit>0,hit=enabled&&known!==null&&known>=limit;
  if(this.reached&&(this.reached.day!==window.day||!enabled||limit>this.reached.limit&&(!hit)))this.reached=null;
  if(hit&&!this.reached)this.reached={day:window.day,at,limit};
  if(this.reached&&hit)this.reached.limit=limit;
  const budgetUnknown=enabled&&(known===null||usage?.unknownCost===true||!!error||!!usage?.error),windingDown=enabled&&this.reached?.day===window.day;
  return {policy:'daily-cost-soft-limit-v1',...window,enabled,limitCny:enabled?limit:0,knownCny:known,estimatedFromConfiguredPrices:true,unknownCost:known===null||usage?.unknownCost===true,unknownSamples:usage?.unknownSamples??null,unattributedHistory:usage?.unattributedHistory===true,error:error||usage?.error||null,mode:budgetUnknown?'budget-unknown':windingDown?'winding-down':enabled?'normal':'disabled',budgetUnknown,backgroundPaused:!!windingDown||budgetUnknown,windingDown:!!windingDown,reachedAt:windingDown?this.reached.at:null,graceEndsAt:windingDown?this.reached.at+grace:null,nextResetAt:window.to,foregroundRepliesAllowed:true,abortInflight:false};
 }
 admit({foreground=false,finishing=false,startedAt}={}){
  const status=this.status(),continued=finishing===true&&Number.isSafeInteger(startedAt)&&startedAt<=status.reachedAt&&this.now()<=status.graceEndsAt;
  return {...status,allowed:!status.backgroundPaused||foreground===true||continued,reason:status.budgetUnknown?'daily-budget-unknown':status.windingDown?'daily-soft-limit-wind-down':null,retryAt:status.backgroundPaused?status.nextResetAt:null,finishCurrent:!!continued};
 }
 assertStart(options){const verdict=this.admit(options);if(!verdict.allowed){const error=new Error(verdict.budgetUnknown?'已设置费用软上限，但费用数据暂不可核实；暂停新的自主活动，仍可回复来信。':'今日费用已达到软上限，当前活动收尾后暂缓新的自主活动。');error.code='DAILY_SOFT_LIMIT_WIND_DOWN';error.retryAt=verdict.nextResetAt;throw error;}return verdict;}
}
