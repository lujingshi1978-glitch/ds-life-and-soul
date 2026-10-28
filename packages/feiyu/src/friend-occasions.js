import {Birthdays,birthdayClock} from './birthdays.js';
export const HOLIDAYS=[
 ['new-year','元旦','solar','01-01'],['new-year-eve','除夕','eve',''],['spring','春节','lunar','1-1'],['lantern','元宵节','lunar','1-15'],
 ['labour','劳动节','solar','05-01'],['dragon-boat','端午节','lunar','5-5'],['qixi','七夕','lunar','7-7'],['mid-autumn','中秋节','lunar','8-15'],
 ['national','国庆节','solar','10-01'],['double-nine','重阳节','lunar','9-9'],['christmas','圣诞节','solar','12-25'],
].map(([id,name,calendar,date])=>({id,name,calendar,date}));
const lunarFormat=new Intl.DateTimeFormat('en-u-ca-chinese',{month:'numeric',day:'numeric',timeZone:'Asia/Shanghai'});
export function lunarDay(now){const p=Object.fromEntries(lunarFormat.formatToParts(new Date(now)).map(x=>[x.type,x.value]));return p.month+'-'+p.day;}
export function holidaysOn(now){const c=birthdayClock(now),l=lunarDay(now),tomorrow=lunarDay(now+86400000);return HOLIDAYS.filter(h=>h.calendar==='solar'?h.date===c.monthDay:h.calendar==='lunar'?h.date===l:tomorrow==='1-1');}
export function explicitBirthday(text,at){
 // Only explicit first-person self reports, not greetings or mentions of others.
 const s=String(text).trim();if(s.length>240||/农历|阴历|闰|不是|并不|假如|假设|开玩笑|我(?:妈|爸|朋友|同学|对象|哥|姐|弟|妹)/.test(s))return null;
 let m=s.match(/^(?:我的?生日(?:是|在|为|[:：])?\s*)(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/)
  ||s.match(/^我(?:是)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?\s*(?:的?生日|出生|生的)/);
 if(m)return String(+m[1]).padStart(2,'0')+'-'+String(+m[2]).padStart(2,'0');
 if(/^(?:今天(?:是)?我(?:的)?生日|我今天(?:过)?生日)[！!。呀啊啦~～\s]*$/.test(s))return birthdayClock(at).monthDay;
 return null;
}
export function profileBirthday(p){
 const month=Number(p?.birthday_month??p?.birth_month),day=Number(p?.birthday_day??p?.birth_day);
 if(month&&day)return String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
 const v=p?.birthday??p?.birthdate??p?.birth_date;if(typeof v!=='string')return null;
 const m=v.match(/^(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);return m?String(+m[1]).padStart(2,'0')+'-'+String(+m[2]).padStart(2,'0'):null;
}
export class FriendOccasions {
 constructor({birthdays,readFriends,readProfile,now=Date.now,event=()=>{}}){Object.assign(this,{birthdays,db:birthdays.db,readFriends,readProfile,now,event});this.syncing=false;
  this.db.exec(`CREATE TABLE IF NOT EXISTS birthday_friends(qq TEXT PRIMARY KEY,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,checked_at INTEGER NOT NULL DEFAULT 0,error TEXT);
   CREATE TABLE IF NOT EXISTS birthday_evidence(qq TEXT PRIMARY KEY,source TEXT NOT NULL,evidence TEXT NOT NULL,at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS holiday_settings(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE IF NOT EXISTS occasion_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 }
 contacts(){return this.db.prepare('SELECT f.*,b.month_day,b.enabled,e.source FROM birthday_friends f LEFT JOIN birthdays b ON b.qq=f.qq LEFT JOIN birthday_evidence e ON e.qq=f.qq WHERE f.active=1 ORDER BY f.name,f.qq').all();}
 settings(){return HOLIDAYS.map(h=>({...h,enabled:this.db.prepare('SELECT enabled FROM holiday_settings WHERE id=?').get(h.id)?.enabled!==0}));}
 configure(id,enabled){if(!HOLIDAYS.some(h=>h.id===id)||typeof enabled!=='boolean')throw Error('节日设置无效');this.db.prepare('INSERT INTO holiday_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled').run(id,enabled?1:0);}
 remember(qq,monthDay,name,source,evidence,at=this.now()){
  // A manual date or earlier confirmed date must not be silently overwritten.
  const old=this.db.prepare('SELECT month_day FROM birthdays WHERE qq=?').get(String(qq));if(old)return false;
  try{this.birthdays.set({qq:String(qq),monthDay,name:String(name||'').slice(0,80)});}catch{return false;}
  this.db.prepare('INSERT OR REPLACE INTO birthday_evidence VALUES(?,?,?,?)').run(String(qq),source,String(evidence).slice(0,240),at);return true;
 }
 observe(key,text,at){const qq=String(key).replace(/^private:/,'');const f=this.db.prepare('SELECT * FROM birthday_friends WHERE qq=? AND active=1').get(qq);if(!f)return;const date=explicitBirthday(text,at);if(date)this.remember(qq,date,f.name,'本人聊天自述',text,at);}
 async sync({force=false}={}){
  const last=Number(this.db.prepare("SELECT value FROM occasion_meta WHERE key='synced'").get()?.value)||0;if(this.syncing||(!force&&this.now()-last<86400000))return;
  this.syncing=true;try{
   const friends=await this.readFriends();if(!Array.isArray(friends))throw Error('好友列表无效');
   this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE birthday_friends SET active=0').run();for(const f of friends){const qq=String(f.user_id);if(!/^[1-9]\d{4,11}$/.test(qq))continue;this.db.prepare("INSERT INTO birthday_friends(qq,name) VALUES(?,?) ON CONFLICT(qq) DO UPDATE SET name=excluded.name,active=1").run(qq,String(f.remark||f.nickname||qq).slice(0,80));}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
   for(const f of this.contacts()){
    try{const p=await this.readProfile(f.qq),date=profileBirthday(p);if(date)this.remember(f.qq,date,f.name,'QQ公开资料',JSON.stringify({birthday:date}));this.db.prepare('UPDATE birthday_friends SET checked_at=?,error=NULL WHERE qq=?').run(this.now(),f.qq);}catch(e){this.db.prepare('UPDATE birthday_friends SET checked_at=?,error=? WHERE qq=?').run(this.now(),String(e.message).slice(0,160),f.qq);}
    // Scan only this friend's own messages; raw text remains in chat archive.
    for(const r of this.db.prepare("SELECT body,at FROM chat_records WHERE qq=? AND role='user' AND body LIKE '%生日%' ORDER BY at DESC LIMIT 200").all(f.qq))this.observe('private:'+f.qq,r.body,r.at);
   }
   this.db.prepare("INSERT OR REPLACE INTO occasion_meta VALUES('synced',?)").run(String(this.now()));
   this.event({kind:'birthday-sync',total:this.contacts().length,known:this.contacts().filter(c=>c.month_day).length});
  }finally{this.syncing=false;}
 }
}
export class HolidayGreetings extends Birthdays {
 constructor(options,directory){super({...options,table:'holiday_sends'});this.directory=directory;}
 list(){const c=birthdayClock(this.now()),active=new Set(this.directory.settings().filter(h=>h.enabled).map(h=>h.id)),holidays=holidaysOn(this.now()).filter(h=>active.has(h.id));if(!holidays.length)return [];
  return this.directory.contacts().filter(f=>!this.db.prepare('SELECT 1 FROM birthday_sends WHERE qq=? AND day=?').get(f.qq,c.day)).map(f=>({...f,month_day:c.monthDay,enabled:1,occasions:holidays.map(h=>h.name),status:this.db.prepare('SELECT status FROM holiday_sends WHERE qq=? AND day=?').get(f.qq,c.day)?.status}));
 }
 due(){return this.list();}
}
