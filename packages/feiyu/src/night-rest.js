import {DatabaseSync} from 'node:sqlite';
import {TransportInbox} from './transport-inbox.js';
import {nightSummaryResult,nightSummaryFailure} from './night-summary-result.js';
import {lifeNightAt} from './energy-policy.js';
import {tuningFor} from './runtime-tuning.js';
export function nightHours(source){const {nightStartHour:start,nightEndHour:end}=tuningFor(source).life;return start===end?'不设固定夜间休眠':String(start).padStart(2,'0')+':00–'+String(end).padStart(2,'0')+':00';}
export function nightClock(at=Date.now(),source) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));
  const {nightStartHour:start,nightEndHour:end}=tuningFor(source).life,night=lifeNightAt(source,at),actualDate=`${p.year}-${p.month}-${p.day}`;
  const date=night&&start>end&&Number(p.hour)>=start?new Date(at+86400000+8*3600000).toISOString().slice(0,10):actualDate;
  return {date,actualDate,night,hours:nightHours(source)};
}
// Transport storage is deliberately separate from character memory: sleeping does not read mail.
export class NightRest {
  constructor(d){this.d=d;this.now=d.now||Date.now;this.db=new DatabaseSync(d.file);this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS nights(day TEXT PRIMARY KEY,status TEXT,report TEXT);`);this.inbox=d.inbox||new TransportInbox(d.file,{db:this.db,now:this.now});if(!d.inbox&&d.file!==':memory:')try{this.inbox.migrateLegacy({nightRestFile:d.file});}catch(error){this.db.close();throw error;}const cols=this.db.prepare('PRAGMA table_info(nights)').all().map(r=>r.name);for(const [name,type]of [['attempts','INTEGER NOT NULL DEFAULT 0'],['retry_at','INTEGER NOT NULL DEFAULT 0'],['last_checked_at','INTEGER NOT NULL DEFAULT 0'],['next_check_at','INTEGER NOT NULL DEFAULT 0']])if(!cols.includes(name))this.db.exec(`ALTER TABLE nights ADD COLUMN ${name} ${type}`);for(const row of this.db.prepare("SELECT day,report FROM nights WHERE status='complete'").all()){try{const result=nightSummaryResult(JSON.parse(row.report));if(result.status!=='complete')this.db.prepare('UPDATE nights SET status=?,retry_at=? WHERE day=?').run(result.status,result.retryable?Math.max(this.now()+120000,result.retryAt||0):0,row.day);}catch{}}
    this.db.exec("CREATE TABLE IF NOT EXISTS night_summary_repairs(day TEXT NOT NULL,revision TEXT NOT NULL,error TEXT NOT NULL,status TEXT NOT NULL,original_attempts INTEGER NOT NULL,original_report TEXT NOT NULL,created_at INTEGER NOT NULL,started_at INTEGER,finished_at INTEGER,result_report TEXT,PRIMARY KEY(day,revision))");
    for(const row of this.db.prepare("SELECT day,report,attempts FROM nights WHERE status='failed'").all()){
      let prior;try{prior=JSON.parse(row.report);}catch{prior={};}
      if(this.grantSummaryRepair(row,prior))continue;
      const result=nightSummaryFailure({message:prior.error||row.report},this.now());
      const repaired=this.d.idempotentSummary===true&&this.d.repairedSummaryErrors?.[prior.error];
      if(row.attempts<3&&(result.retryable||repaired))this.db.prepare("UPDATE nights SET status='deferred',report=?,retry_at=? WHERE day=?").run(repaired?JSON.stringify({...prior,status:'deferred',recovery:'known-error-repaired',repairRevision:repaired,previousFailure:row.report}):row.report,Math.max(this.now()+120000,result.retryAt||0),row.day);
    }
    for(const row of this.db.prepare("SELECT * FROM nights WHERE status IN ('running','interrupted')").all())this.recoverInterrupted(row);
    this.phase=nightClock(this.now(),this.d).night?'settling':'awake';this.running=null;this.prepared=false;}
  recoverInterrupted(row){const safe=this.d.idempotentSummary===true;if(safe&&this.d.recoverSummary){const recovered=this.d.recoverSummary(row.day);if(recovered&&nightSummaryResult(recovered).status==='complete'){this.db.prepare("UPDATE nights SET status='complete',report=?,retry_at=0 WHERE day=?").run(JSON.stringify({...recovered,recovery:'verified-existing-commit-and-empty-work'}),row.day);this.finishRepair(row.day,'recovered',recovered);return;}}const canRetry=safe&&row.attempts<3,report={status:canRetry?'deferred':'partial',recovery:'process-interrupted',previousStatus:row.status,previousReport:row.report,reason:safe?'按当日幂等键核对并恢复；已有提交不重复生成':'旧总结器没有幂等证明，保留中断记录'};this.db.prepare('UPDATE nights SET status=?,report=?,retry_at=? WHERE day=?').run(canRetry?'deferred':safe?'partial':'interrupted',JSON.stringify(report),canRetry?this.now()+120000:0,row.day);this.finishRepair(row.day,'interrupted',report);}
  grantSummaryRepair(row,prior){
    const revision=this.d.exhaustedSummaryRepairs?.[prior.error];
    if(this.d.idempotentSummary!==true||row.attempts<3||prior.error!=='PAYLOAD_TOO_LARGE'||typeof revision!=='string'||!revision.trim()||revision.length>120)return false;
    this.db.exec('BEGIN IMMEDIATE');try{
      const fresh=this.db.prepare("SELECT * FROM nights WHERE day=? AND status='failed' AND attempts>=3").get(row.day);
      if(!fresh){this.db.exec('COMMIT');return false;}
      const inserted=this.db.prepare("INSERT OR IGNORE INTO night_summary_repairs(day,revision,error,status,original_attempts,original_report,created_at) VALUES(?,?,?,'granted',?,?,?)").run(row.day,revision,prior.error,fresh.attempts,fresh.report,this.now()).changes;
      if(inserted)this.db.prepare("UPDATE nights SET status='deferred',report=?,retry_at=? WHERE day=?").run(JSON.stringify({...prior,status:'deferred',recovery:'versioned-repair-granted',repairRevision:revision,previousFailure:fresh.report}),this.now()+120000,row.day);
      this.db.exec('COMMIT');return !!inserted;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  repairGrant(day){return this.db.prepare("SELECT * FROM night_summary_repairs WHERE day=? AND status='granted' ORDER BY created_at LIMIT 1").get(day);}
  canAttempt(row){return row.attempts<3||!!this.repairGrant(row.day);}
  finishRepair(day,status,report){this.db.prepare("UPDATE night_summary_repairs SET status=?,finished_at=?,result_report=? WHERE day=? AND status='running'").run(status,this.now(),JSON.stringify(report),day);}
  close(){this.db.close();}
  blocked(){return nightClock(this.now(),this.d).night||this.phase!=='awake';}
  status(){return {enabled:true,timeZone:'Asia/Shanghai',hours:nightHours(this.d),phase:this.phase,blocked:this.blocked(),pending:this.inbox.count(),lastSummary:this.db.prepare('SELECT * FROM nights ORDER BY day DESC LIMIT 1').get()||null};}
  buffer(kind,peer,event,reason='night-rest'){return this.inbox.buffer(kind,peer,event,event.self_id||this.d.account?.()||'unknown',reason);}
  tick(){if(this.running)return this.running;this.running=this.run().finally(()=>this.running=null);return this.running;}
  async attemptSummary(day){
    const admission=this.d.summaryAdmission?.();
    if(admission?.allowed===false){this.deferCostSummary(day,admission);return;}
    let repairAttempt=false;
    this.db.exec('BEGIN IMMEDIATE');try{
      const row=this.db.prepare('SELECT * FROM nights WHERE day=?').get(day);if(row&&!this.canAttempt(row)){this.db.exec('COMMIT');return;}
      const repair=row&&row.attempts>=3?this.repairGrant(day):null;
      if(repair){repairAttempt=true;this.db.prepare("UPDATE night_summary_repairs SET status='running',started_at=? WHERE day=? AND revision=? AND status='granted'").run(this.now(),day,repair.revision);}
      this.db.prepare("INSERT INTO nights(day,status,report,attempts) VALUES(?,'running','',1) ON CONFLICT(day) DO UPDATE SET status='running',attempts=attempts+1,retry_at=0").run(day);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    try{const report=await this.d.summarize(day,{idempotencyKey:'inner-night:'+day});if(repairAttempt&&(!report?.remaining||!report?.inner))throw Error('NIGHT_REPAIR_PROOF_REQUIRED');const result=nightSummaryResult(report);this.db.prepare('UPDATE nights SET status=?,report=?,retry_at=? WHERE day=?').run(result.status,JSON.stringify(report),!repairAttempt&&result.retryable?Math.max(this.now()+120000,result.retryAt||0):0,day);this.finishRepair(day,'finished',report);}
    catch(e){const result=nightSummaryFailure(e,this.now());this.db.prepare('UPDATE nights SET status=?,report=?,retry_at=? WHERE day=?').run(result.status,JSON.stringify(result),repairAttempt?0:result.retryAt,day);this.finishRepair(day,'finished',result);}
  }
  deferCostSummary(day,admission){
    const old=this.db.prepare('SELECT * FROM nights WHERE day=?').get(day);
    if(old&&!['deferred','partial','interrupted'].includes(old.status))return;
    let previous;try{previous=JSON.parse(old?.report||'null');}catch{}
    const cutoff=previous?.cutoff??this.now(),report={status:'deferred',reason:'daily-soft-limit-wind-down',retryable:true,cutoff,retryAt:admission.nextResetAt||this.now()+60000};
    this.d.deferSummary?.(day,{cutoff});
    this.db.prepare("INSERT INTO nights(day,status,report,attempts,retry_at) VALUES(?,'deferred',?,0,?) ON CONFLICT(day) DO UPDATE SET status='deferred',report=excluded.report,retry_at=excluded.retry_at").run(day,JSON.stringify(report),report.retryAt);
  }
  async resumeDueSummary(day){
    if(this.d.idempotentSummary!==true||this.d.ready&&!this.d.ready()||this.d.summaryReady&&!this.d.summaryReady())return;
    if(this.d.recoverSummary&&(!this.lastRecoveryCheck||this.now()-this.lastRecoveryCheck>=60000)){this.lastRecoveryCheck=this.now();for(const row of this.db.prepare("SELECT day FROM nights WHERE day<=? AND status IN ('deferred','partial') AND next_check_at<=? ORDER BY last_checked_at,day LIMIT 20").all(day,this.now())){
      await new Promise(r=>setImmediate(r));if(!this.d.ready()||this.d.summaryReady&&!this.d.summaryReady())break;
      this.db.prepare('UPDATE nights SET last_checked_at=?,next_check_at=? WHERE day=?').run(this.now(),this.now()+60000,row.day);
      const report=await this.d.recoverSummary(row.day);if(!report)continue;const result=nightSummaryResult(report);
      if(result.status==='complete')this.db.prepare("UPDATE nights SET status='complete',report=?,retry_at=0 WHERE day=?").run(JSON.stringify({...report,recovery:'background-work-finished-after-summary'}),row.day);
      else{
        this.db.prepare('UPDATE nights SET status=?,report=? WHERE day=?').run(result.status,JSON.stringify({...report,recovery:'background-work-still-pending'}),row.day);
        if(report.retryable)this.db.prepare("UPDATE nights SET retry_at=? WHERE day=? AND retry_at=0 AND attempts<3").run(Math.max(this.now()+120000,report.retryAt||0),row.day);
      }
    }}
    const row=this.db.prepare("SELECT day FROM nights WHERE day<=? AND status IN ('deferred','partial') AND retry_at>0 AND retry_at<=? AND (attempts<3 OR EXISTS(SELECT 1 FROM night_summary_repairs r WHERE r.day=nights.day AND r.status='granted')) ORDER BY day LIMIT 1").get(day,this.now());
    if(row)await this.attemptSummary(row.day);
  }
  async run(){
    const clock=nightClock(this.now(),this.d);
    if(clock.night){
      if(!this.prepared){this.phase='settling';await this.d.stop();this.prepared=true;}
      let row=this.db.prepare('SELECT * FROM nights WHERE day=?').get(clock.date);
      if(!row||(['deferred','partial'].includes(row.status)&&row.retry_at>0&&row.retry_at<=this.now()&&this.canAttempt(row))){
        this.phase='summarizing';await this.attemptSummary(clock.date);
      }else if(row.status==='running')this.recoverInterrupted(row);
      else await this.resumeDueSummary(clock.date);
      if(!nightClock(this.now(),this.d).night)return;
      this.phase='sleeping';this.d.sleep();return;
    }
    if(this.phase!=='awake'){this.phase='waking';await this.d.wake();this.phase='awake';this.prepared=false;this.d.open();}
    if(!this.d.ready())return;
    const account=String(this.d.account()||'');if(!account)return;
    if(this.d.drainInbox){await this.d.drainInbox();await this.resumeDueSummary(clock.date);return;}
    // Keep a bounded fair batch durable until the receiver confirms ingestion.
    let changed=false;
    const waiting=new Set();
    for(const r of this.inbox.list(account)){
      const {kind,peer}=r,key=kind+':'+peer;
      if(this.blocked()||!this.d.ready()||String(this.d.account()||'')!==account)return;
      if(waiting.has(key))continue;
      if(!this.d.allowed(key)||!this.d.capacity(key)){waiting.add(key);continue;}
      if(await this.d.ingest(kind,peer,JSON.parse(r.body))){this.inbox.remove(r.id);changed=true;}else waiting.add(key);
    }
    if(changed)this.d.open();
    // Catch up a previous night's interrupted work without closing the daytime
    // inbox or replaying its committed inner delta. The normal attention lane wins.
    await this.resumeDueSummary(clock.date);
  }
}
