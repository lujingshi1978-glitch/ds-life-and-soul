import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {CharacterCognition} from '../src/cognition/service.js';import {buildTrace,createLifeTraceView} from '../src/life-trace-view.js';
const base=path.resolve(import.meta.dirname,'../../../.local/test-data');fs.mkdirSync(base,{recursive:true});
function fixture(t,text='这是一段可核对的原始聊天。<script>不执行任何脚本</script>'){
 const root=fs.mkdtempSync(path.join(base,'source-reader-')),r=new CharacterCognition({root,characterId:'character:source-reader',embedding:null});r.policy.seed({identity:{text:'隔离测试角色。'}});r.enableInner();r.model.think=()=>{throw Error('MODEL_FORBIDDEN');};
 t.after(async()=>{await r.close();const target=path.resolve(root);assert.ok(target.startsWith(base+path.sep)&&path.basename(target).startsWith('source-reader-'));fs.rmSync(target,{recursive:true,force:true});});
 const source={adapter:'source-reader-fixture',externalId:'a',kind:'chat',text,metadata:{scope:'private:101'}},e=r.observe(source,{kind:'experience-recorded',eventRoot:'source-reader-a',outcome:'observed'});const read=extra=>buildTrace(r,{mode:'source',type:'source',id:e.sourceId,revision:e.revision,...extra});return {r,e,source,read,text};
}
test('graph keeps raw text out; explicit pinned source read returns only the requested sanitized page and never writes',t=>{
 const {r,e,read,text}=fixture(t),before=r.store.db.prepare('SELECT total_changes() n').get().n,ab=r.archive.db.prepare('SELECT total_changes() n').get().n;
 const g=buildTrace(r,{type:'source',id:e.sourceId,revision:e.revision});assert.ok(g.nodes[0].readable);assert.ok(!JSON.stringify(g).includes(text));const v=read();assert.equal(v.available,true);assert.equal(v.text,text);assert.equal(v.revision,e.revision);assert.equal(v.readOnly,true);assert.equal(v.modelCalls,0);assert.equal(r.store.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(r.archive.db.prepare('SELECT total_changes() n').get().n,ab);
});
test('credential redaction happens before paging, including quoted JSON credentials crossing a page boundary',t=>{
 const {read}=fixture(t,'a'.repeat(193)+' api_'+'key:"HIDDEN_VALUE_WITH_SPACES keep secret" '+ 'b'.repeat(300)+' Bearer HIDDEN_BEARER '+ 'c'.repeat(300)+' sk-'+'or-v1-TESTTOKEN1234567890123456789012345678');let offset=0,all='';do{const v=read({textChars:200,textOffset:offset});all+=v.text;offset=v.nextOffset;}while(offset!==null);assert.ok(all.includes('[凭据已隐藏]'));for(const canary of ['HIDDEN_VALUE','keep secret','HIDDEN_BEARER','TESTTOKEN'])assert.ok(!all.includes(canary));
});
test('reads exact historical versions; missing revision cannot silently become latest',t=>{
 const {r,e,source,read}=fixture(t,'旧版本原文');r.observe({...source,text:'新版本原文'},{kind:'experience-recorded',eventRoot:'source-reader-a',outcome:'observed'});assert.equal(read().text,'旧版本原文');assert.equal(read({revision:2}).text,'新版本原文');assert.equal(read({revision:999}).available,false);for(const revision of [undefined,null,0,''])assert.throws(()=>read({revision}));
});
for(const restriction of ['deleted','suppression','diagnostic','learning-excluded','exclusion-record'])test('re-reading '+restriction+' source never reuses previously readable bytes',t=>{
 const {r,e,read,text}=fixture(t);assert.equal(read().available,true);if(restriction==='deleted')r.archive.erase(e.sourceId);if(restriction==='suppression')r.store.db.prepare('INSERT INTO suppression VALUES(?,?,?,?,?)').run(r.characterId,'source',e.sourceId,'fixture',Date.now());if(restriction==='diagnostic'||restriction==='learning-excluded')r.archive.db.prepare('UPDATE documents SET metadata=json_set(metadata,?,1) WHERE source_id=?').run(restriction==='diagnostic'?'$.diagnostic':'$.learningExcluded',e.sourceId);if(restriction==='exclusion-record')r.archive.db.prepare('INSERT INTO learning_exclusions VALUES(?,?,?,?,?)').run(e.sourceId,e.revision,'fixture','fixture',Date.now());const v=read();assert.equal(v.available,false);assert.equal(v.text,'');assert.ok(!JSON.stringify(v).includes(text));
});
test('withdrawn parent source blocks derived raw text even when the derived document remains stored',t=>{
 const {r,e}=fixture(t),derived=r.observe({adapter:'source-reader-fixture',externalId:'derived',kind:'web-reading',text:'DERIVED_PRIVATE_CANARY',metadata:{basisSources:[{sourceId:e.sourceId,revision:e.revision}]}},{kind:'experience-recorded',eventRoot:'derived',outcome:'observed'}),q={mode:'source',type:'source',id:derived.sourceId,revision:derived.revision};assert.equal(buildTrace(r,q).available,true);r.archive.erase(e.sourceId);const v=buildTrace(r,q);assert.equal(v.available,false);assert.ok(!JSON.stringify(v).includes('DERIVED_PRIVATE_CANARY'));
});
test('forgotten spans stay masked in an otherwise readable source',t=>{
 const {r,e,read}=fixture(t,'保留开头 PRIVATE_ERASE_CANARY 保留结尾'),offset='保留开头 '.length;r.store.db.prepare('INSERT INTO v3_forget_spans VALUES(?,?,?,?,?)').run(e.sourceId,e.revision,offset,'PRIVATE_ERASE_CANARY'.length,'memory:test');const v=read();assert.equal(v.available,true);assert.equal(v.redacted,true);assert.ok(v.text.includes('保留结尾'));assert.ok(!v.text.includes('PRIVATE_ERASE_CANARY'));
});
test('raw source mode retains console, role epoch, character and bounds checks',t=>{
 const {r,e}=fixture(t),profile={id:'fixture'},binding={profileId:'fixture',activationEpoch:7,transition:false},view=createLifeTraceView({runtime:r,profile,getBinding:()=>binding,authorizeConsole:req=>req.console===true}),q={mode:'source',type:'source',id:e.sourceId,revision:e.revision},request={console:true,context:binding,filters:q};assert.equal(view.read(request).available,true);for(const req of [{...request,console:false},{...request,headers:{'x-agent-call':'1'}},{...request,context:{...binding,activationEpoch:6}},{...request,filters:{...q,textChars:99999}}])assert.throws(()=>view.read(req));
});
