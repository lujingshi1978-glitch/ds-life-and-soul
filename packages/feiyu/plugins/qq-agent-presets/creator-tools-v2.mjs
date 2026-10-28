import path from 'node:path';import {CreatorSandbox} from './creator-runtime-v2.mjs';
export const name='feiyu-creator-tools';export const inject=['tools'];
export const CREATOR_TOOL_NAMES=Object.freeze(['creator_status','creator_list','creator_read','creator_write','creator_search','creator_exec','creator_fetch','creator_dependency']);
const string={type:'string'},integer={type:'integer'};
export function apply(ctx,config={}){
 const root=config.root||path.resolve(import.meta.dirname,'../..'),sandbox=new CreatorSandbox({root}),allowed=new Set(CREATOR_TOOL_NAMES);
 ctx.tools.restrict({allow:[]});ctx.tools.presentAs('native');ctx.tools.guard(exec=>allowed.has(exec.name)?undefined:'CREATOR_TOOL_NOT_AVAILABLE: this session has only confined creator tools');
 const definitions=[
  ['creator_status','Inspect this isolated workspace and available developer runtimes; no host state.',{},[],async(cwd,args,signal)=>sandbox.exclusive(cwd,signal,b=>{const m=sandbox.assertRuntime();return {workspace:b.cwd,boundary:'windows-lpac-private-workspace',node:m.nodeVersion,programs:['node','cmd',...(m.powershell?['powershell']:[]),...(m.python?['python']:[])],publicPackages:m.availablePackages,reference:'reference',hostCredentialsAccessible:false,directNetwork:false,automaticInstall:false};})],
  ['creator_list','List paths inside the current draft workspace.',{path:string},[],(cwd,args,signal)=>sandbox.list(cwd,args,signal)],
  ['creator_read','Read a bounded text window inside the current draft or its read-only source reference.',{path:string,offset:integer,limit:integer},['path'],(cwd,args,signal)=>sandbox.read(cwd,args,signal)],
  ['creator_write','Create or replace a UTF-8 draft file inside this workspace. reference is read-only.',{path:string,text:string},['path','text'],(cwd,args,signal)=>sandbox.write(cwd,args,signal)],
  ['creator_search','Find a literal string in workspace source files. Does not search host files.',{text:string,path:string},['text'],(cwd,args,signal)=>sandbox.search(cwd,args,signal)],
  ['creator_exec','Run code, tests or local developer commands under Windows LPAC. Node subprocesses and tests are supported. program is node, cmd, powershell or python from creator_status. For cmd use args ["/d","/s","/c","command"]. No host credentials, private files, direct network or escalation.',{program:{type:'string',enum:['node','cmd','powershell','python']},args:{type:'array',items:string},path:string,timeoutMs:integer},['program'],(cwd,args,signal)=>sandbox.exec(cwd,args,signal)],
  ['creator_fetch','Read a public HTTP(S) document through the host safe fetcher; private addresses and redirects to them are blocked. Optional path saves the public text inside this workspace.',{url:string,path:string},['url'],(cwd,args,signal)=>sandbox.fetch(cwd,args,signal)],
  ['creator_dependency','Copy public SDK packages already present in the sanitized runtime cache into this workspace. No global installation or credential access.',{name:string},['name'],(cwd,args,signal)=>sandbox.dependency(cwd,args,signal)],
 ];
 // Register on the exact agent layer. A standing-preset allow:[] correctly
 // removes inherited/global tools, including registrations on that standing
 // layer itself; agent-local capabilities are deliberately exempt.
 const installed=new WeakSet();ctx.on('agent/created',({agent})=>{if(installed.has(agent))return;installed.add(agent);
 for(const [tool,description,properties,required,run]of definitions)agent.ctx.tools.register({name:tool,description,parameters:{type:'object',properties,required,additionalProperties:false},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async(args,exec)=>{
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!Object.hasOwn(properties,key))||required.some(key=>!Object.hasOwn(args,key)))throw Error('CREATOR_ARGUMENTS_INVALID');
  const session=exec?.agent?.session,cwd=session?.header?.cwd;if(typeof cwd!=='string')throw Error('CREATOR_SESSION_REQUIRED');sandbox.authorizeSession(cwd,session.id);exec.signal?.throwIfAborted();return run(cwd,args,exec.signal);
 }});
 });
}
