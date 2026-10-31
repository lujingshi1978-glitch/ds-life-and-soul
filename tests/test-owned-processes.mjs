import {test} from 'node:test';import assert from 'node:assert/strict';
import {identityHash,snapshotOwned,stopOwned,creationTime} from '../scripts/owned-processes.mjs';
const row=(id,parent,time,extra={})=>({ProcessId:id,ParentProcessId:parent,ExecutablePath:'D:\\isolated\\node.exe',CommandLine:'node isolated-worker.mjs',CreationDate:`/Date(${time})/`,...extra});
const root=row(900,5,5000),record={id:'isolated-dsh',pid:900,identityHash:identityHash(root)};
function backend(rows){const killed=[];return {killed,inspect:id=>rows.find(r=>r.ProcessId===id)||null,list:()=>rows,terminate:r=>{killed.push(r.pid);return 'stopped';}};}
test('Windows legacy and ISO creation times parse',()=>{assert.equal(creationTime('/Date(5000)/'),5000);assert.equal(creationTime('1970-01-01T00:00:05Z'),5000);assert.equal(creationTime('invalid'),null);});
test('older foreign protected process with recycled parent PID is excluded',()=>{const b=backend([root,row(11,900,1000,{ExecutablePath:null,CommandLine:null}),row(12,11,2000)]);const r=stopOwned([record],{backend:b});assert.equal(r.ok,true);assert.deepEqual(b.killed,[900]);});
test('real descendants stop deepest first',()=>{const b=backend([root,row(901,900,5100),row(902,901,5200)]);const r=stopOwned([record],{backend:b});assert.equal(r.ok,true);assert.deepEqual(b.killed,[902,901,900]);});
test('same PID with different full identity is not terminated',()=>{const b=backend([row(900,5,8000)]);const r=stopOwned([record],{backend:b});assert.equal(r.ok,false);assert.deepEqual(b.killed,[]);});
test('unreadable genuine later child fails closed',()=>{const b=backend([root,row(901,900,5100,{ExecutablePath:null,CommandLine:null})]);const r=snapshotOwned([record],{backend:b});assert.equal(r.unverified.length,1);assert.deepEqual(r.owned.map(x=>x.pid),[900]);});
test('changed identity immediately before kill is never stopped',()=>{let n=0;const b=backend([root]);b.inspect=()=>++n>2?row(900,5,9000):root;const r=stopOwned([record],{backend:b});assert.equal(r.ok,false);assert.deepEqual(b.killed,[]);});
test('already exited process clears without killing another process',()=>{const b=backend([]);const r=stopOwned([record],{backend:b});assert.equal(r.ok,true);assert.deepEqual(b.killed,[]);});
