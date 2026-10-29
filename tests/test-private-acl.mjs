import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {secureStatePath} from '../packages/feiyu/src/strict-state-acl.mjs';
test('recursive private ACL removes a named explicit principal and refuses profile junctions',{skip:process.platform!=='win32'},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-acl-fixture-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'private'),file=path.join(dir,'child','secret.txt');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture-only');
  assert.equal(secureStatePath(dir).ok,true);
  assert.equal(spawnSync('icacls.exe',[file,'/grant','*S-1-5-32-546:R'],{windowsHide:true}).status,0);
  assert.equal(secureStatePath(dir,{verifyOnly:true}).ok,false);
  assert.equal(secureStatePath(dir).ok,true);assert.equal(secureStatePath(dir,{verifyOnly:true}).ok,true);
  const target=path.join(root,'untouched');fs.mkdirSync(target);const link=path.join(dir,'link');fs.symlinkSync(target,link,'junction');
  assert.equal(secureStatePath(dir).ok,false);assert.equal(secureStatePath(dir,{skipLinks:true}).skippedLinks,1);
  fs.unlinkSync(link);
});
