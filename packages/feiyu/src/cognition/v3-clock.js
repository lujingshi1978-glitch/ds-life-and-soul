import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {energyPolicy,energyBehavior,energyRate,lifeNightAt} from '../energy-policy.js';

const HOUR=3600000;
export class LifeClock {
  constructor(store,{now=store.now,mono=()=>performance.now(),epoch=randomUUID()}={}){Object.assign(this,{store,now,mono,epoch});}
  advance(state,at=this.now()){
    const policy=energyPolicy(this.store),since=state.energyUpdatedAt??at,delta=at-since,checkpoint=this.store.db.prepare('SELECT * FROM v3_clock_checkpoint WHERE id=1').get();
    const sameEpoch=checkpoint?.epoch===this.epoch,monoDelta=sameEpoch?this.mono()-checkpoint.mono:null;
    const anomaly=delta<0||(sameEpoch&&Math.abs((at-checkpoint.wall_at)-monoDelta)>120000);
    if(anomaly)return {energy:state.energy,energyUpdatedAt:at,timeQuality:'discontinuous',unobservedMs:Math.max(0,delta)};
    const covered=sameEpoch&&delta<=600000;let energy=state.energy??.7,sleepMs=0,awakeMs=0;
    // Calendar segments split at UTC hours; Shanghai boundaries are whole UTC hours.
    const capped=Math.min(delta,72*HOUR);let cursor=at-capped;
    while(cursor<at){const end=Math.min(at,(Math.floor(cursor/HOUR)+1)*HOUR),span=end-cursor;
      const sleeping=['sleep','dream'].includes(energyBehavior(state))||(!covered&&lifeNightAt(this.store,cursor));
      if(sleeping)sleepMs+=span;else awakeMs+=span;cursor=end;}
    const rate=covered?energyRate(energyBehavior(state),policy):policy.idlePerHour;
    energy+=Math.min(sleepMs,covered?sleepMs:12*HOUR)/HOUR*policy.sleepPerHour;
    energy+=Math.min(awakeMs,covered?awakeMs:2*HOUR)/HOUR*rate;
    return {energy:Math.max(0,Math.min(1,energy)),energyUpdatedAt:at,timeQuality:covered?'observed':'estimated-gap',unobservedMs:covered?0:delta};
  }
  checkpoint(state){const at=this.now(),old=this.store.db.prepare('SELECT * FROM v3_clock_checkpoint WHERE id=1').get();
    if(old&&at>=old.wall_at&&at-old.wall_at>0)this.store.db.prepare('INSERT INTO v3_clock_intervals VALUES(?,?,?,?,?)').run(randomUUID(),old.wall_at,at,old.epoch===this.epoch&&at-old.wall_at<=600000?old.kind:'offline',old.epoch===this.epoch&&at-old.wall_at<=600000?'observed':'estimated-gap');
    this.store.db.prepare('INSERT OR REPLACE INTO v3_clock_checkpoint VALUES(1,?,?,?,?,?)').run(at,this.epoch,this.mono(),state.behavior?.kind||'idle',state.energy);
  }
  envelope(){const at=this.now(),parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));const previous=this.store.db.prepare('SELECT * FROM v3_clock_checkpoint WHERE id=1').get();
    return {at,timeZone:'Asia/Shanghai',local:`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,resting:lifeNightAt(this.store,at),sinceLastObservedMs:previous?Math.max(0,at-previous.wall_at):null,continuity:previous?.epoch===this.epoch?'current-process':'returned-or-new',offlineIsNotLivedExperience:true};}
}
