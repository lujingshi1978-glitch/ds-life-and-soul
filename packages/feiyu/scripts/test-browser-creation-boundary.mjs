import {fakeCreator} from './creator-test-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {AppIntegrations} from '../src/app-integrations.js';
const ok=value=>({result:{ok:true,value}});
for(const mode of ['workspace-write','danger-full-access','rpc-failure','command-failure'])test('creation verifies explicit workspace boundary before model admission: '+mode,async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-creation-boundary-'));fs.mkdirSync(path.join(root,'state'));const calls=[];
 const api={sessions:{create:async args=>ok({sessionId:'test-only',agentPreset:args.agentPreset}),selectModel:async()=>{calls.push('model');return ok({});},prompt:async()=>{calls.push('prompt');return ok({});}},callUnary:async(method,args)=>{calls.push(method);if(mode==='rpc-failure')throw Error('offline');if(method==='commands/execute'){assert.equal(args.line,'/permission workspace-write');assert.equal(args.agentId,'test-only');return ok({result:{kind:mode==='command-failure'?'error':'success'}});}assert.equal(method,'session/projections');return ok({values:{permissions:{currentValue:mode}}});},stopSessionWork:async()=>{calls.push('stop');return {};}};
 const app=new AppIntegrations({creatorSandbox:fakeCreator(),root,profileDir:root,cfg:{ownerQQ:'123'},api});app.update({creationEnabled:true});
 t.after(async()=>{await app.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('feiyu-creation-boundary-'));fs.rmSync(root,{recursive:true,force:true});});
 if(mode==='workspace-write'){await app.createCapability('private:123','只写草稿',{guard:()=>{}});assert.deepEqual(calls,['commands/execute','session/projections','model','prompt']);}
 else{await assert.rejects(app.createCapability('private:123','只写草稿',{guard:()=>{}}));assert.equal(calls.includes('model'),false);assert.equal(calls.includes('prompt'),false);assert.equal(app.tasks()[0].status,'failed');}
});
test('bridge browser launch uses fail-closed pinned proxy and has no configured direct bypass',()=>{const text=fs.readFileSync(new URL('../src/app-integrations.js',import.meta.url),'utf8');assert.match(text,/'--proxy-server',egress.server,'--proxy-bypass','<-loopback>'/);assert.match(text,/await \(await this.browserEgress\).close\(\)/);});
