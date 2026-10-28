import {energyPolicy,lifeNightAt} from '../energy-policy.js';
import {energyExempt} from '../energy-context.js';

export class WakeEnergy {
 constructor(owner){this.owner=owner;this.r=owner.runtime;this.i=this.r.inner;const old=this.i.meta('wakeEnergyV1')||{};this.state={...old,sleeping:old.sleeping===true||(this.r.store.projection('state')?.energy??1)<=0,wakes:old.wakes||{},lastWakes:old.lastWakes||{},intervalMs:old.intervalMs||energyPolicy(this.r).wakeIntervalMs};this.syncPolicy();this.save();this.settle();}
 syncPolicy(){const policy=energyPolicy(this.r),oldInterval=this.state.intervalMs;if(oldInterval!==policy.wakeIntervalMs){for(const [lane,deadline]of Object.entries(this.state.wakes)){const previous=this.state.lastWakes[lane]??deadline-oldInterval;this.state.wakes[lane]=previous+policy.wakeIntervalMs;}this.state.intervalMs=policy.wakeIntervalMs;}return policy;}
 save(){this.i.meta('wakeEnergyV1',this.state);}
 settle(){
  const policy=this.syncPolicy(),now=this.r.now(),p=this.r.policy.state(),active=[...this.owner.behaviors.values()],ordinary=active.some(b=>!b.energyExempt&&b.kind!=='sleep');
  const was=this.state.sleeping;if(p.energy<=0)this.state.sleeping=true;
  if(this.state.sleeping&&p.energy>=policy.wakeEnergy&&now-(this.state.since??now)>=policy.minimumSleepMs&&!lifeNightAt(this.r,now))this.state.sleeping=false;
  if(this.state.sleeping&&!this.state.since)this.state.since=now;if(!this.state.sleeping)this.state.since=null;
  // Finish the currently running bounded action; never cut a reply in half.
  if(!ordinary){const admin=active.at(-1);if(admin?.energyExempt){const kind=this.state.sleeping?'sleep':lifeNightAt(this.r,now)?'sleep':'idle';if(p.behavior.energyKind!==kind)this.r.policy.updateState({behavior:{kind:admin.kind,target:p.behavior.target,energyExempt:true,energyKind:kind}});}
   else {const kind=this.state.sleeping||lifeNightAt(this.r,now)?'sleep':'idle';if(p.behavior.kind!==kind||now-(this.state.checkpointAt||0)>=15000)this.r.policy.updateState({behavior:{kind}});}}
  if(was!==this.state.sleeping){this.state.changedAt=now;this.owner.onEnergySleep?.(this.state.sleeping);}
  this.state.checkpointAt=now;this.save();return this.status();
 }
 blocked(scope){return !energyExempt()&&!this.owner.isAdminScope(scope)&&(this.state.sleeping||this.r.policy.state().energy<=0);}
 claim(lane){if(energyExempt())return {accepted:true,exempt:true};this.settle();if(this.blocked())return {accepted:false,status:'energy-sleeping',retryAt:this.status().retryAt};const now=this.r.now(),previous=this.state.wakes[lane]||0;if(previous>now)return {accepted:false,status:'waiting-for-wake',retryAt:previous};this.state.lastWakes[lane]=now;this.state.wakes[lane]=now+this.state.intervalMs;this.save();return {accepted:true,exempt:false};}
 status(){const policy=this.syncPolicy(),p=this.r.policy.state(),now=this.r.now(),need=Math.max(0,policy.wakeEnergy-p.energy),recovery=need===0?0:policy.sleepPerHour>0?Math.ceil(need/policy.sleepPerHour*3600000):null,retryAt=this.state.sleeping&&recovery!==null?Math.max(now+recovery,(this.state.since??now)+policy.minimumSleepMs):null;return {policy:'wake-and-energy-v1',hourlyModelLimit:null,energy:p.energy,sleeping:this.state.sleeping,wakeEnergy:policy.wakeEnergy,minimumSleepMs:policy.minimumSleepMs,intervalMs:this.state.intervalMs,nextWakes:this.state.wakes,administratorExempt:true,rates:{idle:policy.idlePerHour,rest:policy.restPerHour,sleep:policy.sleepPerHour,active:-policy.awakePerHour},actionCosts:policy.actions,retryAt};}
}

export function retireHourlyLimits(inner){
 if(inner.meta('hourlyLimitsRetiredV1'))return;
 inner.store.atomic('hourly-limits-retired',()=>{
  inner.db.prepare("DELETE FROM v3_runtime_meta WHERE key='modelBudgetBlockedUntil'").run();
  let resumed=0;for(const row of inner.db.prepare("SELECT j.job_id,r.report_json FROM jobs j JOIN maintenance_reports r USING(character_id,job_id) WHERE j.status='pending' AND j.role_epoch=?").all(inner.store.manifest().role_epoch)){let report;try{report=JSON.parse(row.report_json);}catch{continue;}if(/V3_(?:HOURLY|BACKGROUND)_MODEL_BUDGET/.test(report.error||'')){inner.db.prepare('UPDATE jobs SET retry_at=0 WHERE job_id=?').run(row.job_id);resumed++;}}
  const m=inner.meta('psycheMaintenanceV1');if(m&&/V3_(?:HOURLY|BACKGROUND)_MODEL_BUDGET/.test(m.reason||''))inner.meta('psycheMaintenanceV1',{...m,retryAt:0,reason:null,status:m.jobId?'queued':'continuing'});
  inner.meta('hourlyLimitsRetiredV1',{at:inner.now(),resumed,preserveUsageHistory:true});return {affected:[]};
 });
}
