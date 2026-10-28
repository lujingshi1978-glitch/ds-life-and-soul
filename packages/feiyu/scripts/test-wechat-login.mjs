import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {renderWechatQr} from '../src/wechat-qr.js';import {WechatChannel} from '../src/wechat-channel.js';
const png=value=>{assert.match(value,/^data:image\/png;base64,/);const bytes=Buffer.from(value.split(',')[1],'base64');assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),280);assert.equal(bytes.readUInt32BE(20),280);};
test('core QR dependency generates a real PNG without optional WeChat runtime',async()=>{png(await renderWechatQr('https://fixture.invalid/wechat-login'));});
test('bad QR data and missing component return bounded messages without module paths',async()=>{
 for(const input of ['',null,'x'.repeat(8193)])await assert.rejects(renderWechatQr(input),{code:'WECHAT_QR_INVALID'});
 await assert.rejects(renderWechatQr('fixture',{loadQr:async()=>{throw Error('Cannot find module fixture-private-path');}}),e=>e.code==='WECHAT_QR_UNAVAILABLE'&&!e.message.includes('private-path')&&e.message.includes('修复核心依赖'));
 await assert.rejects(renderWechatQr('fixture',{loadQr:async()=>({default:{toDataURL:()=>{throw Error('fixture raw token');}}})}),e=>e.code==='WECHAT_QR_RENDER_FAILED'&&!e.message.includes('raw token'));
});
test('login flow uses the real default renderer, reuses valid QR and stops without social sends',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-wechat-login-'));const calls=[];
 const request=async(url,options)=>{
  const u=new URL(url);calls.push(u.pathname);assert.equal(u.hostname,'ilinkai.weixin.qq.com');
  if(u.pathname==='/ilink/bot/get_bot_qrcode')return new Response(JSON.stringify({qrcode:'fixture-login-code',qrcode_img_content:'https://fixture.invalid/wechat-login'}));
  if(u.pathname==='/ilink/bot/get_qrcode_status')return new Promise((resolve,reject)=>{const abort=()=>reject(Object.assign(Error('fixture cancelled'),{name:'AbortError'}));if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});});
  throw Error('Unexpected WeChat action');
 };
 const channel=new WechatChannel({dir,request});
 try{const first=await channel.startLogin();png(first.qrImage);assert.equal(first.state,'waiting-scan');assert.equal(first.connected,false);const second=await channel.startLogin();assert.equal(second.qrImage,first.qrImage);assert.equal(calls.filter(x=>x.endsWith('get_bot_qrcode')).length,1);assert(!calls.some(x=>x.endsWith('sendmessage')));assert.equal(fs.existsSync(path.join(dir,'account.json')),false);}
 finally{await channel.close();const resolved=fs.realpathSync(dir);assert.equal(path.dirname(resolved).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());assert(path.basename(resolved).startsWith('feiyu-wechat-login-'));fs.rmSync(resolved,{recursive:true,force:true});}
});
