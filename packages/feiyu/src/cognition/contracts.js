import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

export class CognitionError extends Error {
  constructor(code,message=code){super(message);this.name='CognitionError';this.code=code;}
}
export const fail=(code,message)=>{throw new CognitionError(code,message);};
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function bounded(value,max=1000,{empty=false}={}){
  if(typeof value!=='string'||(!empty&&!value.trim())||[...value].length>max)fail('INVALID_TEXT');
  return value.trim();
}
export function unit(value,fallback=.5){return Number.isFinite(value)?Math.max(0,Math.min(1,value)):fallback;}
export function id(value){return bounded(value,180);}
export function entityId(value){if(typeof value!=='string'||! /^(?:qq:\d+|wechat:[a-f0-9]{24}|bili:\d+|character:[\w-]+|topic:[\w-]+)$/.test(value))fail('INVALID_ENTITY');return value;}
export function json(value,max=250000){const s=JSON.stringify(value);if(!s||s.length>max)fail('PAYLOAD_TOO_LARGE');return s;}
// Local SQL membership selectors contain IDs, never model or job material.
// A character's accumulated history may exceed the per-payload text budget.
export function sqlIds(values){if(!Array.isArray(values)||values.some(v=>typeof v!=='string'||!v||v.length>180))fail('INVALID_ID_SET');return JSON.stringify([...new Set(values)]);}
export function parse(value){return typeof value==='string'?JSON.parse(value):value;}
export function unique(values){return [...new Set(values)];}
export function terms(text){
  const s=String(text).normalize('NFKC').toLowerCase(),out=s.match(/[a-z0-9_]{2,}/g)||[];
  for(const p of s.match(/[\p{Script=Han}]+/gu)||[]){const a=[...p];for(const n of [2,3])for(let i=0;i+n<=a.length;i++)out.push(a.slice(i,i+n).join(''));if(a.length===1)out.push(p);}
  return unique(out).slice(0,1000);
}
export function cosine(a,b){if(!Array.isArray(a)||a.length!==b?.length||!a.length)return 0;let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]**2;y+=b[i]**2;}return x&&y?d/Math.sqrt(x*y):0;}
export function clip(text,max){return [...String(text??'')].slice(0,max).join('');}
export const NODE_KINDS=new Set(['episode','assertion','experience','relationship','knowledge','procedure','self_model','topic','pattern']);
export const LIVE_STATUSES=new Set(['active','contested','outdated','faded']);
export function safeRoot(input){
  if(!input||!path.isAbsolute(input))fail('EXPLICIT_V2_ROOT_REQUIRED');
  const root=path.resolve(input),project=fileURLToPath(new URL('../../',import.meta.url));
  const forbidden=[path.join(project,'state'),path.join(os.homedir(),'.dsh')];
  let ancestor=root;while(!fs.existsSync(ancestor)){const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}
  const resolved=fs.existsSync(ancestor)?path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,root)):root;
  for(const denied of forbidden){const p=fs.existsSync(denied)?fs.realpathSync(denied):denied;const relative=path.relative(p,resolved);if(relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative)))fail('V1_DIRECTORY_FORBIDDEN');}
  for(let p=root;;p=path.dirname(p)){
    if(['contacts.sqlite','feiyu-mind.sqlite','current-role.json'].some(name=>fs.existsSync(path.join(p,name))))fail('V1_DIRECTORY_FORBIDDEN');
    if(path.dirname(p)===p)break;
  }
  return root;
}
export function characterDirectory(root,characterId){
  bounded(characterId,100);root=safeRoot(root);
  fs.mkdirSync(root,{recursive:true});const marker=path.join(root,'.cognition-v2-root.json');
  if(!fs.existsSync(marker))try{fs.writeFileSync(marker,json({format:'feiyu-cognition-v2',version:2}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  if(parse(fs.readFileSync(marker,'utf8')).format!=='feiyu-cognition-v2')fail('ROOT_FORMAT_MISMATCH');
  const dir=path.join(root,'characters',hash(characterId).slice(0,24));fs.mkdirSync(dir,{recursive:true});safeRoot(dir);
  for(const filename of ['archive-v2.sqlite','cognition-v2.sqlite']){const file=path.join(dir,filename);if(fs.existsSync(file)){const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||stat.nlink>1)fail('LINKED_DATABASE_FORBIDDEN');}}
  return dir;
}
export function assertSignal(signal){signal?.throwIfAborted();}
export function isNight(at){return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(at))<8;}
export function evidenceKey(e){return `${e.sourceId}@${e.revision}`;}
