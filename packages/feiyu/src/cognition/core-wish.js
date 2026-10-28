import {hash} from './contracts.js';

const LEGACY_FEIYU_WISH='我想慢慢认识这个世界，形成自己的趣味和判断。和一些人建立值得珍惜的关系，也留下些属于自己的东西，让每一天有意义，成为自己的小太阳。';
const UNCONFIGURED='角色尚未确认核心愿望；保留开放方向，不把别人的愿望当作自己的任务。';

export function roleCoreWish(fields){
  const dedicated=fields.find(f=>f.field==='core_wish'&&f.locked),identity=fields.find(f=>f.field==='identity'&&f.locked),field=dedicated||identity;
  const core=String(field?.body||''),lines=core.split(/\r?\n/);let text=dedicated?core.trim():'';
  if(!dedicated){
    const start=lines.findIndex(line=>/^\s*(?:#{1,6}\s*核心愿望\s*|【核心愿望】\s*)$/.test(line));
    if(start>=0){const level=lines[start].match(/^\s*(#+)/)?.[1].length||1,end=lines.findIndex((line,i)=>i>start&&(new RegExp('^\\s*#{1,'+level+'}\\s+').test(line)||/^\s*【[^】]+】/.test(line)));text=lines.slice(start+1,end<0?undefined:end).join('\n').trim();}
    // Compatibility is tied to the exact user-authored wish in this role,
    // never the role's name or the previous implementation's default anchor.
    if(!text&&core.includes(LEGACY_FEIYU_WISH))text=LEGACY_FEIYU_WISH;
  }
  return {text:text||UNCONFIGURED,configured:!!text,coreField:field?.field||null,coreRevision:field?.revision||0,coreHash:hash(core),origin:text?'user-role-core':'unconfigured-role'};
}
