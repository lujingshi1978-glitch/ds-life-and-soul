import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const DEFAULT_ROLE='大肥鱼内定性格';
export function characterInitialIntimacy(profile,key,owner,settings={},relationship){
 settings??={};
 if(relationship?.score!==undefined&&Number.isFinite(Number(relationship.score)))return Number(relationship.score);
 const baseline=Number(settings.initialScore??45);
 return profile.id==='legacy-feiyu'&&key==='private:'+owner?Number(settings.ownerInitialScore??70):baseline;
}
export class CharacterProfiles {
 constructor(stateDir){this.root=stateDir;this.file=path.join(stateDir,'character-profiles.json');fs.mkdirSync(stateDir,{recursive:true});const exists=fs.existsSync(this.file);this.data=exists?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,profiles:{}};
  // Original root data belongs to the original character, even when a new card
  // happens to be the first card selected during registry migration.
  if(!exists&&['feiyu-mind.sqlite','contacts.sqlite','social-v2.json','sessions.json'].some(file=>fs.existsSync(path.join(stateDir,file)))){this.data.profiles[DEFAULT_ROLE]={id:'legacy-feiyu',created:Date.now()};this.save();}
 }
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));fs.renameSync(tmp,this.file);}
 resolve(role){const name=role||DEFAULT_ROLE;if(typeof name!=='string'||!name||!/^[\w\u4e00-\u9fff-]+$/.test(name))throw Error('无效角色名');
  if(!this.data.profiles[name]){const original=name===DEFAULT_ROLE&&Object.keys(this.data.profiles).length===0&&!this.data.archived?.length;this.data.profiles[name]={id:original?'legacy-feiyu':randomUUID(),created:Date.now()};this.save();}
  const p=this.data.profiles[name];if(!/^(legacy-feiyu|[a-f0-9-]{36})$/.test(p.id))throw Error('无效角色档案');
  const dir=p.id==='legacy-feiyu'?this.root:path.join(this.root,'characters',p.id);fs.mkdirSync(dir,{recursive:true});return {name,id:p.id,created:p.created,dir};
 }
 rename(from,to){if(this.data.profiles[to])throw Error('目标角色已有独立记忆，不能覆盖');if(this.data.profiles[from]){this.data.profiles[to]=this.data.profiles[from];delete this.data.profiles[from];this.save();}}
 validateCore(profile,content){
  if(typeof content!=='string'||!content.trim()||content.length>10000)throw Error('角色核心需要有效内容，且不能超过10000字');
  const configFile=path.join(path.dirname(this.root),'config.json');if(fs.existsSync(configFile)){const cfg=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,'')),mind=cfg.socialV2?.mind;if(Number(mind?.version)>=2&&mind.v2Root){const id=createHash('sha256').update('character:qq-'+profile.id).digest('hex').slice(0,24),file=path.join(mind.v2Root,'characters',id,'cognition-v2.sqlite');if(fs.existsSync(file)){const db=new DatabaseSync(file,{readOnly:true});try{const extra=db.prepare("SELECT coalesce(sum(length(body)+1),0) n FROM v2_core WHERE field<>'identity'").get().n;if(content.length+extra>10000)throw Error('角色卡与 V2 已有核心成长合计超过10000字');return;}finally{db.close();}}}}
  const file=path.join(profile.dir,'feiyu-mind.sqlite');if(!fs.existsSync(file))return;
  const db=new DatabaseSync(file,{readOnly:true});try{const extra=db.prepare("SELECT coalesce(sum(length(body)+1),0) n FROM mind_core WHERE id<>'identity'").get().n;if(content.length+extra>10000)throw Error('角色卡与已有核心成长合计超过10000字，请先精简角色卡');}finally{db.close();}
 }
 archive(name){if(this.data.profiles[name]){this.data.archived??=[];this.data.archived.push({name,...this.data.profiles[name],archived:Date.now()});delete this.data.profiles[name];this.save();}}
}
