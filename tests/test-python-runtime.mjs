import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {resolvePython311} from '../scripts/python-runtime.mjs';
const valid=JSON.stringify({major:3,minor:11}),wrong=JSON.stringify({major:3,minor:14});
test('standard Windows Python launcher is used when its actual runtime is 3.11',()=>{
 const calls=[];assert.deepEqual(resolvePython311({platform:'win32',env:{PYLAUNCHER_ALLOW_INSTALL:'1'},run:(file,args,options)=>{calls.push([file,args,options.env]);return valid;}}),['py','-3.11']);assert.equal(calls.length,1);assert.equal(calls[0][2].PYLAUNCHER_ALLOW_INSTALL,undefined);
});
test('vendor-tagged interpreter listing is probed when -3.11 does not resolve',()=>{
 const listed='C:/fixture uv/python.exe',calls=[];
 const chosen=resolvePython311({platform:'win32',env:{},exists:p=>p===listed,run:(cmd,args)=>{calls.push([cmd,args]);if(cmd==='py'&&args[0]==='-3.11')throw Error('missing');if(cmd==='py'&&args[0]==='-0p')return ' -V:Astral/CPython3.11.15 '+listed+'\r\n';if(cmd===listed)return valid;throw Error('unexpected');}});
 assert.deepEqual(chosen,[listed]);assert.equal(calls.length,3);assert(calls[2][1].includes('-I'));
});
test('PATH runtime is version-checked rather than accepting an arbitrary Python',()=>{
 const calls=[];const chosen=resolvePython311({platform:'linux',env:{},run:(cmd,args)=>{calls.push(cmd);return cmd==='python3.11'?wrong:valid;}});assert.deepEqual(chosen,['python3']);assert.deepEqual(calls,['python3.11','python3']);
});
test('explicit interpreter is absolute, present, exact-version and never silently replaced',()=>{
 const file=path.resolve('fixture python/python.exe');assert.deepEqual(resolvePython311({env:{FEIYU_PYTHON:file},exists:()=>true,run:()=>valid}),[file]);let calls=0;
 assert.throws(()=>resolvePython311({env:{FEIYU_PYTHON:file},exists:()=>true,run:()=>{calls++;return wrong;}}),/未自动替换/);assert.equal(calls,1);
 assert.throws(()=>resolvePython311({env:{FEIYU_PYTHON:'relative/python'},exists:()=>true,run:()=>{throw Error('must not run');}}));
});
test('wrong, missing and malformed runtime probes produce a useful fixed error',()=>{
 for(const result of [wrong,'unexpected non-JSON output'])assert.throws(()=>resolvePython311({platform:'linux',env:{},run:()=>result}),/未找到Python 3.11/);
 assert.throws(()=>resolvePython311({platform:'win32',env:{},run:()=>{throw Error('fixture sensitive raw error');}}),e=>/未找到Python 3.11/.test(e.message)&&!e.message.includes('sensitive'));
});
