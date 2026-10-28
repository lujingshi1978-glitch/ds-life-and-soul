import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
export class BehaviorHistory {
 constructor(file){this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS behavior_events(id TEXT PRIMARY KEY,at INTEGER NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,body TEXT NOT NULL);CREATE INDEX IF NOT EXISTS behavior_time ON behavior_events(at);CREATE TABLE IF NOT EXISTS behavior_imports(source TEXT PRIMARY KEY,at INTEGER NOT NULL);');}
 add(kind,body,{id=randomUUID(),at=Date.now(),scope='system'}={}){this.db.prepare('INSERT OR IGNORE INTO behavior_events VALUES(?,?,?,?,?)').run(id,at,kind,scope,String(body).slice(0,16000));}
 importFile(file,kind,sanitize=x=>x){
  if(!fs.existsSync(file)||this.db.prepare('SELECT 1 FROM behavior_imports WHERE source=?').get(file))return;
  const stat=fs.statSync(file);let i=0;this.db.exec('BEGIN IMMEDIATE');
  try{for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    if(!line.trim())continue;let at=stat.mtimeMs,scope='system',body=line,exact=false;
    try{const r=JSON.parse(line),t=r.at||r.ts||r.time;const parsed=typeof t==='number'?t:Date.parse(t);if(Number.isFinite(parsed)){at=parsed;exact=true;}scope=r.key||scope;body=JSON.stringify(r);}catch{}
    const id=(exact?'import-dated:':'import:')+createHash('sha256').update(file+'\0'+i+++'\0'+line).digest('hex');this.add(kind,sanitize(body),{id,at:Math.floor(at),scope});
   }this.db.prepare('INSERT INTO behavior_imports VALUES(?,?)').run(file,Date.now());this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 list({contacts,mind,intimacies=[],kind='all',scope='',query='',offset=0,limit=40,sanitize=x=>x}){
  if(!['all','system','chat','tool','activity','memory','dream','intimacy','knowledge'].includes(kind))throw Error('未知历史类型');
  limit=Math.max(1,Math.min(100,Number(limit)||40));offset=Math.max(0,Math.min(100000,Number(offset)||0));const take=offset+limit+1,items=[];
  const like='%'+String(query).replace(/[\\%_]/g,'\\$&')+'%';
  const match=(body,actualScope)=>String(body).includes(query)&&(!scope||actualScope===scope);
  if(['all','system','tool','activity','intimacy','knowledge'].includes(kind))items.push(...this.db.prepare("SELECT id,at,kind,scope,body FROM behavior_events WHERE (?='all' OR kind=?) AND (?='' OR scope=?) AND body LIKE ? ESCAPE '\\' ORDER BY at DESC,id DESC LIMIT ?").all(kind,kind,scope,scope,like,take));
  if(contacts&&['all','chat'].includes(kind))items.push(...contacts.db.prepare("SELECT id,at,'chat' kind,'private:'||qq scope,role||'：'||body||CASE WHEN media_json<>'[]' THEN ' [图片资料] '||media_json ELSE '' END body FROM chat_records WHERE (?='' OR 'private:'||qq=?) AND (body||media_json) LIKE ? ESCAPE '\\' ORDER BY at DESC,id DESC LIMIT ?").all(scope,scope,like,take).map(r=>({...r,id:'chat:'+r.id})));
  if(mind&&['all','memory'].includes(kind)){
   items.push(...mind.db.prepare("SELECT id,at,'memory' kind,CASE WHEN target LIKE 'private:%' THEN target ELSE coalesce((SELECT scope FROM mind_memories WHERE id=target),'system') END scope,operation||' · '||target||' · '||metadata body FROM mind_changes WHERE operation<>'dream-report' AND (operation||' · '||target||' · '||metadata) LIKE ? ESCAPE '\\' AND (?='' OR scope=?) ORDER BY at DESC,id DESC LIMIT ?").all(like,scope,scope,take).map(r=>({...r,id:'memory:'+r.id})));
   items.push(...mind.db.prepare("SELECT id,at,'memory' kind,scope,'写入记忆 · '||kind||' · '||gist body FROM mind_memories WHERE (?='' OR scope=?) AND gist LIKE ? ESCAPE '\\' ORDER BY at DESC,id DESC LIMIT ?").all(scope,scope,like,take).map(r=>({...r,id:'memory-created:'+r.id})));
  }
  if(mind&&['all','dream','memory'].includes(kind)){
   const jobs=mind.db.prepare("SELECT j.id,j.created at,CASE WHEN j.kind='dream' THEN 'dream' ELSE 'memory' END kind,j.scope,j.kind||' · '||j.status||coalesce(' · '||j.error,'') body,j.status,j.kind jobKind,coalesce(r.body,g.body) reportBody FROM mind_jobs j LEFT JOIN mind_dream_reports r ON r.id=j.id LEFT JOIN mind_growth_reports g ON g.id=j.id WHERE (?='' OR j.scope=?) AND (?='all' OR CASE WHEN j.kind='dream' THEN 'dream' ELSE 'memory' END=?) AND (j.kind||' · '||j.status||coalesce(' · '||j.error,'')||coalesce(r.body,g.body,CASE WHEN j.kind='dream' AND j.status='complete' THEN '旧任务未保存具体整理报告，不能还原当时内容。' ELSE '' END)) LIKE ? ESCAPE '\\' ORDER BY j.created DESC,j.id DESC LIMIT ?").all(scope,scope,kind,kind,like,take);
   for(const r of jobs){
    if(r.kind==='dream'||r.jobKind==='growth'){
     const report=r.reportBody?{body:r.reportBody}:null;
     r.body+='\n'+(report?'本轮整理结果（非内部推理）\n'+JSON.stringify(JSON.parse(report.body),null,2):r.status==='complete'?'旧任务未保存具体整理报告，不能还原当时内容。':'尚无完成报告。');
    }
    const {reportBody,jobKind,...row}=r;items.push({...row,id:'job:'+r.id});
   }
  }
  if(contacts&&['all','activity'].includes(kind))items.push(...contacts.db.prepare("SELECT id,created_at at,'activity' kind,'private:'||qq scope,kind||' · '||status||coalesce(' · '||error,'') body FROM contact_jobs WHERE (?='' OR 'private:'||qq=?) AND (kind||' · '||status||coalesce(' · '||error,'')) LIKE ? ESCAPE '\\' ORDER BY created_at DESC,id DESC LIMIT ?").all(scope,scope,like,take).map(r=>({...r,id:'contact-job:'+r.id})));
  if(['all','intimacy'].includes(kind))for(const entry of intimacies)for(const e of entry.evaluations||[]){const body=`${e.change} · ${e.before} → ${e.after}`;if(match(body,entry.key))items.push({id:'intimacy:'+entry.key+':'+e.stageId,at:e.at,kind:'intimacy',scope:entry.key,body});}
  const unique=[...new Map(items.map(r=>[r.id,r])).values()];unique.sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));return {items:unique.slice(offset,offset+limit).map(r=>({...r,body:sanitize(r.body)})),offset,nextOffset:unique.length>offset+limit?offset+limit:null};
 }
 close(){this.db.close();}
}
