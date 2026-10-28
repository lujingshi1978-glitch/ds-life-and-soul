import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=(file,fallback)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fallback;
const write=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);};
export function recoverRoleRename(stateDir,roleDir,{afterStep=()=>{}}={}){
 const journal=path.join(stateDir,'role-rename.json'),op=read(journal,null);if(!op||op.status==='complete')return false;
 for(const name of [op.from,op.to])if(typeof name!=='string'||!/^[\w\u4e00-\u9fff-]+$/.test(name))throw Error('ROLE_RENAME_INVALID');
 const from=path.resolve(roleDir,op.from+'.md'),to=path.resolve(roleDir,op.to+'.md');if(path.dirname(from)!==path.resolve(roleDir)||path.dirname(to)!==path.resolve(roleDir))throw Error('ROLE_RENAME_PATH');
 if(fs.existsSync(from)&&hash(fs.readFileSync(from))!==op.hash)throw Error('ROLE_RENAME_SOURCE_CONFLICT');
 if(fs.existsSync(to)){if(hash(fs.readFileSync(to))!==op.hash)throw Error('ROLE_RENAME_TARGET_CONFLICT');}else{if(!fs.existsSync(from))throw Error('ROLE_RENAME_FILE_MISSING');fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);}afterStep('copied');
 if(fs.existsSync(from))fs.unlinkSync(from);afterStep('source-removed');
 const file=path.join(stateDir,'character-profiles.json'),profiles=read(file,{version:1,profiles:{}}),original=profiles.profiles[op.from],target=profiles.profiles[op.to];
 if(target&&target.id!==op.profile?.id||original&&original.id!==op.profile?.id)throw Error('ROLE_RENAME_IDENTITY_CONFLICT');
 if(op.profile){profiles.profiles[op.to]=op.profile;delete profiles.profiles[op.from];write(file,profiles);}afterStep('registry');
 const currentFile=path.join(stateDir,'current-role.json'),current=read(currentFile,null);if(current?.role===op.from)write(currentFile,{...current,role:op.to});afterStep('current-role');
 write(journal,{...op,status:'complete'});return true;
}
export function renameRoleCatalog(stateDir,roleDir,from,to,{afterStep}={}){
 for(const name of [from,to])if(typeof name!=='string'||!/^[\w\u4e00-\u9fff-]+$/.test(name))throw Error('ROLE_RENAME_INVALID');
 const file=path.join(stateDir,'role-rename.json');recoverRoleRename(stateDir,roleDir);
 const source=path.join(roleDir,from+'.md'),registry=read(path.join(stateDir,'character-profiles.json'),{profiles:{}});if(fs.existsSync(path.join(roleDir,to+'.md'))||registry.profiles[to])throw Error('目标角色已存在');
 write(file,{from,to,profile:registry.profiles[from]||null,hash:hash(fs.readFileSync(source)),status:'pending',at:Date.now()});return recoverRoleRename(stateDir,roleDir,{afterStep});
}
