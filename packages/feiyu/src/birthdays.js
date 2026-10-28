// Role-local calendar facts. Automatic ticks only expose observations; a date
// never grants permission to compose or send a greeting.
import {lifeNightAt} from './energy-policy.js';
export function birthdayClock(now=Date.now()) {
 const d=new Date(now+8*3600000),day=d.toISOString().slice(0,10);
 return {day,monthDay:day.slice(5),hour:d.getUTCHours()};
}
export class Birthdays {
 constructor({db,ready=()=>true,allowed=()=>true,observe,compose,send,lease=()=>({release(){}}),event=()=>{},now=Date.now,table='birthday_sends',runtimeTuning}) {
  if(!['birthday_sends','holiday_sends'].includes(table))throw Error('Invalid greeting table');
  Object.assign(this,{db,ready,allowed,observe,compose,send,lease,event,now,table,runtimeTuning});this.running=false;
  db.exec(`CREATE TABLE IF NOT EXISTS birthdays(qq TEXT PRIMARY KEY,month_day TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS birthday_sends(qq TEXT NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL,text TEXT,error TEXT,at INTEGER NOT NULL,PRIMARY KEY(qq,day));
   CREATE TABLE IF NOT EXISTS holiday_sends(qq TEXT NOT NULL,day TEXT NOT NULL,status TEXT NOT NULL,text TEXT,error TEXT,at INTEGER NOT NULL,PRIMARY KEY(qq,day));`);
  for(const t of ['birthday_sends','holiday_sends']){const columns=db.prepare(`PRAGMA table_info(${t})`).all().map(r=>r.name);for(const name of ['retry_at','attempts'])if(!columns.includes(name))db.exec(`ALTER TABLE ${t} ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);for(const name of ['authority','request_id'])if(!columns.includes(name))db.exec(`ALTER TABLE ${t} ADD COLUMN ${name} TEXT`);}
  // Existing receipts are historical facts, including uncertain outcomes. Do not
  // rewrite them into a new action or resume an old request after a restart.
 }
 set({qq,monthDay,name='',enabled=true}) {
  qq=String(qq||'');if(!/^[1-9]\d{4,11}$/.test(qq)||typeof monthDay!=='string'||!/^\d{2}-\d{2}$/.test(monthDay)||new Date('2000-'+monthDay+'T00:00:00Z').toISOString().slice(5,10)!==monthDay||typeof name!=='string'||name.length>80||typeof enabled!=='boolean')throw Error('请输入有效QQ号和公历生日（月-日）');
  this.db.prepare('INSERT INTO birthdays VALUES(?,?,?,?,?) ON CONFLICT(qq) DO UPDATE SET month_day=excluded.month_day,name=excluded.name,enabled=excluded.enabled,updated_at=excluded.updated_at').run(qq,monthDay,name,enabled?1:0,this.now());
  return this.list();
 }
 list(){return this.db.prepare('SELECT b.*,s.status,s.text,s.error,s.day,s.retry_at,s.attempts,s.authority,s.request_id FROM birthdays b LEFT JOIN birthday_sends s ON b.qq=s.qq AND s.day=? ORDER BY b.month_day,b.qq').all(birthdayClock(this.now()).day);}
 remove(qq){this.db.prepare('DELETE FROM birthdays WHERE qq=?').run(String(qq));}
 due(){const clock=birthdayClock(this.now());return this.list().filter(row=>row.enabled&&row.month_day===clock.monthDay);}
 async tick(){
  if(this.running||!this.ready()||lifeNightAt(this,this.now()))return {status:'blocked'};
  const rows=this.due().filter(row=>this.allowed('private:'+row.qq));
  if(!this.observe)return {status:'observation-only',opportunities:rows.length};
  this.running=true;try{return await this.observe(rows);}finally{this.running=false;}
 }
 // Retained for explicitly authorized management integrations. Production auto
 // scheduling does not call this API; request authority must be current.
 async greetManually({qq,requestId,authority,currentRequest}={}){
  if(authority!=='user'||currentRequest!==true||typeof requestId!=='string'||!requestId.trim()||requestId.length>200)throw Error('CURRENT_ADMINISTRATOR_REQUEST_REQUIRED');
  if(typeof this.compose!=='function'||typeof this.send!=='function')throw Error('MANUAL_GREETING_UNAVAILABLE');
  if(this.running||!this.ready())return;const clock=birthdayClock(this.now());if(lifeNightAt(this,this.now()))return;
  this.running=true;
  try {for(const row of this.due().filter(row=>String(row.qq)===String(qq))){
   const prior=this.db.prepare(`SELECT status,retry_at,attempts FROM ${this.table} WHERE qq=? AND day=?`).get(row.qq,clock.day);
   if(!row.enabled||row.month_day!==clock.monthDay||prior&&(prior.status!=='deferred'||prior.retry_at>this.now())||!this.allowed('private:'+row.qq))continue;
   if(this.table==='birthday_sends'&&this.db.prepare('SELECT 1 FROM holiday_sends WHERE qq=? AND day=?').get(row.qq,clock.day))continue;
   const key='private:'+row.qq,slot=this.lease(key);if(!slot)continue;
   // Reserve before generation so repeated ticks and restarts cannot double-send.
   const claimed=this.db.prepare(`INSERT INTO ${this.table}(qq,day,status,at,attempts,authority,request_id) VALUES(?,?,'preparing',?,1,'user',?) ON CONFLICT(qq,day) DO UPDATE SET status='preparing',attempts=attempts+1,at=excluded.at,authority='user',request_id=excluded.request_id WHERE status='deferred' AND retry_at<=excluded.at`).run(row.qq,clock.day,this.now(),requestId).changes;
   if(!claimed){slot.release();continue;}
   let sending=false;
   try{
    const text=await this.compose({...row,key,day:clock.day,authority:'user',requestId},slot.signal);
    if(slot.signal?.aborted||!this.ready()||!this.allowed(key)||birthdayClock(this.now()).day!==clock.day||lifeNightAt(this,this.now())){this.db.prepare(`DELETE FROM ${this.table} WHERE qq=? AND day=? AND status='preparing'`).run(row.qq,clock.day);continue;}
    if(typeof text!=='string'||!text.trim()||text.length>160)throw Error('生日祝福格式无效');
    this.db.prepare(`UPDATE ${this.table} SET status='sending',text=?,at=? WHERE qq=? AND day=?`).run(text.trim(),this.now(),row.qq,clock.day);sending=true;
    await this.send(key,text.trim(),slot.signal);
    this.db.prepare(`UPDATE ${this.table} SET status='sent',at=? WHERE qq=? AND day=?`).run(this.now(),row.qq,clock.day);
    this.event({kind:this.table==='holiday_sends'?'holiday':'birthday',key,day:clock.day,status:'sent',text:text.trim(),authority:'user',requestId});
   }catch(e){if(!sending&&slot.signal?.aborted){this.db.prepare(`DELETE FROM ${this.table} WHERE qq=? AND day=?`).run(row.qq,clock.day);}else{const code=e.code||e.message,budget=code==='V3_HOURLY_MODEL_BUDGET',transient=budget||['BACKGROUND_ATTENTION_BUSY','BACKGROUND_PREEMPTED','COGNITION_BACKGROUND_BUSY','COGNITION_READSET_STALE','V3_INNER_BUSY','STALE_ROLE_EPOCH'].includes(code),status=sending?'uncertain':transient?'deferred':'failed',retryAt=status==='deferred'?(budget?(Math.floor(this.now()/3600000)+1)*3600000:this.now()+60000):0;this.db.prepare(`UPDATE ${this.table} SET status=?,error=?,at=?,retry_at=?,attempts=max(0,attempts-?) WHERE qq=? AND day=?`).run(status,String(code).slice(0,200),this.now(),retryAt,transient&&!sending?1:0,row.qq,clock.day);this.event({kind:this.table==='holiday_sends'?'holiday':'birthday',key,day:clock.day,status,retryAt,authority:'user',requestId});}}finally{slot.release();}
  }}finally{this.running=false;}
 }
}
