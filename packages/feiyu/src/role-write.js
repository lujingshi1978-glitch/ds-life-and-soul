import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const error=(code,statusCode)=>Object.assign(new Error(code),{statusCode});
export class RoleWriteCoordinator{
 constructor(file,profile){this.profile=profile;this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS control_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS role_resources(profile TEXT NOT NULL,resource TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(profile,resource));CREATE TABLE IF NOT EXISTS card_outbox(name TEXT PRIMARY KEY,body TEXT NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL,error TEXT,base_hash TEXT);`);if(!this.db.prepare('PRAGMA table_info(card_outbox)').all().some(c=>c.name==='base_hash'))this.db.exec('ALTER TABLE card_outbox ADD COLUMN base_hash TEXT');this.db.prepare("INSERT INTO control_meta VALUES('activation',1) ON CONFLICT(key) DO UPDATE SET value=value+1").run();this.activation=this.db.prepare("SELECT value FROM control_meta WHERE key='activation'").get().value;}
 snapshot(resource,{content}={}){return {profileId:this.profile.id,activationEpoch:this.activation,resource,revision:content===undefined?(this.db.prepare('SELECT revision FROM role_resources WHERE profile=? AND resource=?').get(this.profile.id,resource)?.revision||0):digest(content)};}
 assertActivation(context,{transition=false}={}){if(!context)throw error('ROLE_WRITE_CONTEXT_REQUIRED',428);if(transition||context.profileId!==this.profile.id||context.activationEpoch!==this.activation)throw error('ROLE_WRITE_CONFLICT',409);}
 assert(context,resource,{content,transition=false}={}){if(!context)throw error('ROLE_WRITE_CONTEXT_REQUIRED',428);const current=this.snapshot(resource,{content});if(transition||Object.keys(current).some(k=>context[k]!==current[k]))throw error('ROLE_WRITE_CONFLICT',409);return current;}
 touch(resource){this.db.prepare('INSERT INTO role_resources VALUES(?,?,1) ON CONFLICT(profile,resource) DO UPDATE SET revision=revision+1').run(this.profile.id,resource);}
 versions(){return Object.fromEntries(this.db.prepare('SELECT resource,revision FROM role_resources WHERE profile=?').all(this.profile.id).map(r=>[r.resource,r.revision]));}
 commitCard(name,body,context,{read,write,project}){this.assert(context,'card:'+name,{content:read(name)});this.db.prepare("INSERT INTO card_outbox(name,body,hash,status,error,base_hash) VALUES(?,?,?,'pending',NULL,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body,hash=excluded.hash,base_hash=excluded.base_hash,status='pending',error=NULL").run(name,body,digest(body),context.revision);return this.flushCard(name,{read,write,project});}
 flushCard(name,{read,write,project}){const r=this.db.prepare("SELECT * FROM card_outbox WHERE name=? AND status='pending'").get(name);if(!r)return {applied:true};try{if(read){const live=digest(read(name));if(live!==r.hash&&live!==r.base_hash){this.db.prepare("UPDATE card_outbox SET status='conflict',error='CARD_FILE_CONFLICT' WHERE name=?").run(name);return {applied:false,pending:true,conflict:true};}}write(name,r.body);project?.(name,r.body);this.db.prepare("UPDATE card_outbox SET status='applied',error=NULL WHERE name=? AND hash=?").run(name,r.hash);return {applied:true,version:r.hash};}catch(e){this.db.prepare('UPDATE card_outbox SET error=? WHERE name=?').run(String(e.code||e.message).slice(0,160),name);return {applied:false,pending:true};}}
 recover(handlers){for(const r of this.db.prepare("SELECT name FROM card_outbox WHERE status='pending'").all())this.flushCard(r.name,handlers);}
 pending(){return this.db.prepare("SELECT count(*) n FROM card_outbox WHERE status<>'applied'").get().n;}
 close(){this.db.close();}
}
// Console writes default to character-owned. Machine tools use their session grant.
export function consoleResource(path){
 if(/^\/api\/(?:runtime-tuning|system\/(?:settings|start|login)|apps\/settings|access|config|mode|voice\/settings)/.test(path))return 'global:'+path;
 if(path.startsWith('/api/roles/'))return 'catalog';
 return path.replace(/\/(?:adjust|evaluate|learn|reject|confirm-use|memory-clear|update|save|clear|delete|config|status)$/,'').replace('/api/socialV2','/api');
}
