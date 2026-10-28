import {createHash} from 'node:crypto';
import {birthdayClock} from './birthdays.js';
import {holidaysOn} from './friend-occasions.js';
import {lifeNightAt} from './energy-policy.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const blockedReceipts=new Set(['preparing','sending','sent','uncertain','unknown']);
const expiry=day=>Date.parse(day+'T00:00:00+08:00')+86400000;

export function publishOccasionObservation(runtime,source,event){
 const existing=runtime.archive.db.prepare(`SELECT o.payload FROM documents d JOIN outbox o
  ON json_extract(o.payload,'$.sourceId')=d.source_id AND json_extract(o.payload,'$.revision')=d.revision
  WHERE d.adapter='calendar' AND d.external_id=? AND d.kind='calendar-observation' AND d.status='available'
  AND json_extract(o.payload,'$.kind')='occasion-observed' AND json_extract(o.payload,'$.eventRoot')=?
  ORDER BY d.revision LIMIT 1`).get(source.externalId,event.eventRoot);
 if(existing){runtime.reconcile();return JSON.parse(existing.payload);}
 return runtime.observe(source,event);
}

// Calendar facts are opportunities to notice, never instructions or send receipts.
// The contact DB marker and cognitive archive are separate stores. A stable
// externalId/eventRoot makes publication retryable across their commit boundary.
export class OccasionObservations {
 constructor({db,birthdays,holidays,profileId,characterId,ready=()=>true,allowed=()=>true,
  publish,captureGuard=()=>()=>{},now=Date.now,runtimeTuning}){
  if(typeof profileId!=='string'||!profileId||typeof characterId!=='string'||!characterId)fail('OCCASION_IDENTITY_REQUIRED');
  Object.assign(this,{db,birthdays,holidays,profileId,characterId,ready,allowed,publish,captureGuard,now,runtimeTuning});this.running=false;
  db.exec(`CREATE TABLE IF NOT EXISTS occasion_observations(
   occasion_id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,peer_key TEXT NOT NULL,day TEXT NOT NULL,
   status TEXT NOT NULL,payload_json TEXT NOT NULL,event_id TEXT,source_id TEXT,source_revision INTEGER,
   created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,recovered INTEGER NOT NULL DEFAULT 0,error TEXT,
   UNIQUE(profile_id,peer_key,day));`);
  db.prepare("UPDATE occasion_observations SET recovered=1 WHERE profile_id=? AND status IN ('pending','observed')").run(profileId);
 }
 candidates(){
  const clock=birthdayClock(this.now()),rows=new Map();
  for(const birthday of this.birthdays.due())rows.set(String(birthday.qq),{qq:String(birthday.qq),name:birthday.name||'',birthday});
  const directory=this.holidays.directory,enabled=new Set(directory.settings().filter(h=>h.enabled).map(h=>h.id));
  const holidays=holidaysOn(this.now()).filter(h=>enabled.has(h.id));
  if(holidays.length)for(const friend of directory.contacts())if(!rows.has(String(friend.qq)))rows.set(String(friend.qq),{qq:String(friend.qq),name:friend.name||''});
  const hasEvidence=this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='birthday_evidence'").get();
  return [...rows.values()].filter(row=>/^[1-9]\d{4,11}$/.test(row.qq)).map(row=>{
   const key='private:'+row.qq,sources=[];
   if(row.birthday){
    const evidence=hasEvidence?this.db.prepare('SELECT source,evidence,at FROM birthday_evidence WHERE qq=?').get(row.qq):null;
    sources.push({kind:'birthday-calendar',monthDay:row.birthday.month_day,source:evidence?.source||'管理员登记的公历日期',
     evidence:evidence?.evidence||null,recordedAt:evidence?.at??row.birthday.updated_at});
   }
   for(const holiday of holidays)sources.push({kind:'holiday-calendar',id:holiday.id,name:holiday.name,calendar:holiday.calendar,date:holiday.date});
   const id='occasion:'+createHash('sha256').update(JSON.stringify([this.profileId,clock.day,key])).digest('hex');
   return {id,key,qq:row.qq,name:row.name,day:clock.day,expiresAt:expiry(clock.day),
    kind:row.birthday?'birthday':'holiday',sources,occasions:[...(row.birthday?['公历生日']:[]),...holidays.map(h=>h.name)]};
  });
 }
 legacyReceipt(qq,day){
  for(const table of ['birthday_sends','holiday_sends']){
   const receipt=this.db.prepare(`SELECT status,at FROM ${table} WHERE qq=? AND day=?`).get(qq,day);
   if(receipt&&blockedReceipts.has(receipt.status))return {table,status:receipt.status,at:receipt.at};
  }
  return null;
 }
 async tick(){
  if(this.running)return {status:'busy'};
  const now=this.now(),clock=birthdayClock(now);
  this.db.prepare("UPDATE occasion_observations SET status='expired' WHERE profile_id=? AND status='pending' AND expires_at<=?").run(this.profileId,now);
  if(!this.ready()||lifeNightAt(this,now)||typeof this.publish!=='function')return {status:'blocked'};
  this.running=true;let observed=0;
  try{
   const guard=this.captureGuard();
   guard();
   for(const row of this.candidates()){
    guard();if(!this.ready()||!this.allowed(row.key))continue;
    const legacyReceipt=this.legacyReceipt(row.qq,row.day);
    const payload={...row,authority:'world',observedAt:now,...(legacyReceipt?{legacyReceipt}:{})};
    this.db.prepare(`INSERT OR IGNORE INTO occasion_observations(occasion_id,profile_id,peer_key,day,status,payload_json,created_at,expires_at)
     VALUES(?,?,?,?,?,?,?,?)`).run(row.id,this.profileId,row.key,row.day,legacyReceipt?'legacy-receipt-held':'pending',JSON.stringify(payload),now,row.expiresAt);
   }
   // Do not recover missed dates. Pending work from a previous process is
   // explicitly recovery material, so inner intake cannot treat it as new intent.
   const pending=this.db.prepare("SELECT * FROM occasion_observations WHERE profile_id=? AND day=? AND status='pending' ORDER BY created_at,occasion_id").all(this.profileId,clock.day);
   for(const stored of pending){
    guard();if(!this.ready()||lifeNightAt(this,this.now())||birthdayClock(this.now()).day!==stored.day||this.now()>=stored.expires_at||!this.allowed(stored.peer_key))continue;
    const payload=JSON.parse(stored.payload_json),recovery=stored.recovered===1;
    const occasion={id:payload.id,kind:payload.kind,day:payload.day,expiresAt:payload.expiresAt,
     sourceKind:payload.kind==='birthday'?'birthday-calendar':'holiday-calendar'};
    const source={adapter:'calendar',externalId:payload.id,kind:'calendar-observation',occurredAt:stored.created_at,
     text:JSON.stringify({observation:'上海日期与已登记资料相符，出现可留意的场合。',...payload,
      note:'这是日期资料，不是聊天请求或行动命令。可以关心、祝福、延后或不做；没有联系或祝福义务，没有观察到对方当前感受。'}),
     metadata:{speakerId:this.characterId,conversationPeerId:'qq:'+payload.qq,scope:payload.key,authority:'world',
      privacyLabel:'private',notPrimaryEvidence:true,historical:recovery,recovery,occasion}};
    try{
     guard();const result=await this.publish(source,{kind:'occasion-observed',eventRoot:payload.id,outcome:'observed'});guard();
     if(typeof result?.eventId!=='string'||typeof result?.sourceId!=='string'||!Number.isSafeInteger(result.revision)||result.revision<1)fail('OCCASION_RECEIPT_REQUIRED');
     this.db.prepare("UPDATE occasion_observations SET status='observed',event_id=?,source_id=?,source_revision=?,error=NULL WHERE occasion_id=? AND status='pending'")
      .run(result.eventId,result.sourceId,result.revision,payload.id);observed++;
    }catch(error){
     this.db.prepare("UPDATE occasion_observations SET error=? WHERE occasion_id=? AND status='pending'").run(String(error.code||'OCCASION_PUBLICATION_FAILED').slice(0,100),payload.id);
     if(['STALE_ROLE_EPOCH','ROLE_WRITE_CONFLICT'].includes(error.code))throw error;
    }
   }
   return {status:'observed',observed};
  }finally{this.running=false;}
 }
 status(){
  const entries=this.db.prepare('SELECT occasion_id id,peer_key key,day,status,event_id eventId,source_id sourceId,source_revision sourceRevision,recovered,error,expires_at expiresAt FROM occasion_observations WHERE profile_id=? ORDER BY created_at DESC,occasion_id LIMIT 100').all(this.profileId);
  return {selection:'single-inner-current-choice',automaticSend:false,running:this.running,entries};
 }
}
