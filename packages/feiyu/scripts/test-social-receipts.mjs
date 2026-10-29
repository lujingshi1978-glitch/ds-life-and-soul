import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {SocialPlatforms} from '../src/social-platforms.js';
test('unresolved writes survive midnight, restart and URL aliases, while another target remains available',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-social-receipt-')),realNow=Date.now;let now=Date.parse('2026-10-29T12:00:00Z'),submitted=0,p;
 Date.now=()=>now;const make=()=>new SocialPlatforms({root:path.join(dir,'packages/feiyu'),profileDir:dir,browser:{prepareOpenCli:async()=>{},loggedIn:async()=>true,close:async()=>{},contextId:'synthetic'},runner:async()=>{submitted++;throw Error('synthetic timeout after submit');}});
 try{
  p=make();p.update('youtube',{enabled:true,writesEnabled:true});const params={target:'https://www.youtube.com/watch?v=abcdefghijk',text:'synthetic comment'};
  assert.equal((await p.act('youtube','comment',params)).status,'unknown');assert.equal(submitted,1);now+=86400000;
  assert.equal((await p.act('youtube','comment',params)).unresolved,true);assert.equal(submitted,1);
  await p.close();p=make();assert.equal((await p.act('youtube','comment',{...params,target:'https://youtu.be/abcdefghijk'})).unresolved,true);assert.equal(submitted,1);
  assert.equal((await p.act('youtube','comment',{...params,dryRun:true})).status,'blocked');assert.equal(submitted,1);
  p.db.prepare('UPDATE social_actions SET operation_key=NULL').run();now+=86400000;
  assert.equal((await p.act('youtube','comment',{...params,target:'https://www.youtube.com/shorts/abcdefghijk'})).unresolved,true);assert.equal(submitted,1,'legacy unknown row remains blocked across dates and aliases');
  await p.act('youtube','comment',{...params,target:'https://www.youtube.com/watch?v=lmnopqrstuv'});assert.equal(submitted,2,'different actual target is not a retry');
 }finally{await p?.close();Date.now=realNow;fs.rmSync(dir,{recursive:true,force:true});}
});

test('confirmed operations retain day policy and cancellation before submission remains retryable',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-social-cancel-')),realNow=Date.now;let now=Date.parse('2026-10-29T12:00:00Z'),submitted=0;
 Date.now=()=>now;const p=new SocialPlatforms({root:path.join(dir,'packages/feiyu'),profileDir:dir,browser:{prepareOpenCli:async()=>{},loggedIn:async()=>true,close:async()=>{},contextId:'synthetic'},runner:async()=>{submitted++;return {status:'confirmed',verified:true};}});
 try{p.update('youtube',{enabled:true,writesEnabled:true});const params={target:'https://www.youtube.com/watch?v=abcdefghijk',text:'synthetic confirmed'};const cancelled=await p.act('youtube','comment',{...params,guard:()=>{throw Error('fixture revoked before submit');}});assert.equal(cancelled.status,'cancelled');assert.equal(submitted,0);assert.equal((await p.act('youtube','comment',params)).status,'confirmed');assert.equal(submitted,1);assert.equal((await p.act('youtube','comment',params)).duplicate,true);assert.equal(submitted,1);now+=86400000;await p.act('youtube','comment',params);assert.equal(submitted,2);}finally{await p.close();Date.now=realNow;fs.rmSync(dir,{recursive:true,force:true});}
});
