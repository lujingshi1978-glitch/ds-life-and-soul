import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DEPENDENCY_GROUPS,MODEL_SOURCE,installVoiceRuntime,inspectVoiceRuntime,voiceLaunchEnvironment,voiceRuntimePaths} from './index.mjs';

const weight=Buffer.from('fixture model; not a real neural network');
const fixtureSource={...MODEL_SOURCE,modelSha256:createHash('sha256').update(weight).digest('hex')};
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'feiyu-voice-runtime-test-'));
  t.after(async()=>{
    const resolved=path.resolve(root),prefix=path.join(os.tmpdir(),'feiyu-voice-runtime-test-');
    assert.ok(resolved.startsWith(prefix),'cleanup must stay inside this test-created temporary directory');
    await fs.rm(resolved,{recursive:true,force:true});
  });
  const paths=voiceRuntimePaths(root),calls=[],downloads=[];
  const run=async(command,args,options)=>{
    calls.push({command,args,phase:options.phase,allowNetwork:options.allowNetwork,env:options.env});
    if (args.includes('venv')) {
      await fs.mkdir(path.dirname(paths.python),{recursive:true});
      await fs.writeFile(paths.python,'fixture executable marker, never executed');
    }
    if (options.phase==='health') return {code:0,stdout:JSON.stringify({ok:true,python:'3.11.fixture',checks:{fixture:{ok:true}},versions:{fixture:'0'}})};
    return {code:0,stdout:'fixture completed'};
  };
  const downloadModel=async({destination,source})=>{
    downloads.push(destination);
    assert.equal(source.repoId,'Systran/faster-whisper-small');
    await fs.writeFile(path.join(destination,'config.json'),'{}');
    await fs.writeFile(path.join(destination,'tokenizer.json'),'{}');
    await fs.writeFile(path.join(destination,'vocabulary.txt'),'fixture vocabulary\n');
    await fs.writeFile(path.join(destination,'model.bin'),weight);
  };
  const options={repoRoot:root,voice:true,pythonCommand:['fixture-python','-3'],run,downloadModel,
    modelSource:fixtureSource,allowFixtureModel:true};
  return {root,paths,calls,downloads,run,downloadModel,options};
}

test('voice must be explicitly selected; default call creates nothing and runs nothing',async t=>{
  const f=await fixture(t);
  const result=await installVoiceRuntime({repoRoot:f.root,run:()=>assert.fail('must not run'),downloadModel:()=>assert.fail('must not download')});
  assert.equal(result.status,'skipped');
  assert.deepEqual(await fs.readdir(f.root),[]);
});
test('read-only inspection of a clean root never creates files or starts Python',async t=>{
  const f=await fixture(t);
  const result=await inspectVoiceRuntime({repoRoot:f.root,run:()=>assert.fail('missing Python cannot be started')});
  assert.equal(result.ready,false);
  assert.equal(result.runtimeReady,false);
  assert.equal(result.cacheReady,false);
  assert.deepEqual(await fs.readdir(f.root),[]);
});
test('explicit install orders venv, pip, model, hashes, health; writes complete ready manifest',async t=>{
  const f=await fixture(t),result=await installVoiceRuntime(f.options);
  assert.equal(result.ready,true);
  assert.equal(result.status,'ready');
  assert.deepEqual(f.calls.map(call=>call.phase),['venv','dependencies','health']);
  assert.deepEqual(f.calls[0].args.slice(0,3),['-3','-m','venv']);
  assert.equal(f.calls[0].allowNetwork,false);
  assert.equal(f.calls[1].allowNetwork,true);
  assert.equal(f.calls[2].allowNetwork,false);
  assert.equal(f.downloads.length,1);
  const manifest=JSON.parse(await fs.readFile(f.paths.manifest,'utf8'));
  assert.equal(manifest.status,'ready');
  assert.equal(manifest.fixture,true);
  assert.equal(manifest.model.files.length,4);
  assert.ok(manifest.model.files.every(file=>file.size>0&&/^[a-f0-9]{64}$/.test(file.sha256)));
  assert.equal(manifest.runtime.python,'3.11.fixture');
  assert.equal(await fs.stat(f.paths.model).then(()=>true),true);
});
test('repeat install reuses complete cache and existing shared Python',async t=>{
  const f=await fixture(t);
  await installVoiceRuntime(f.options);
  f.calls.length=0;
  const result=await installVoiceRuntime(f.options);
  assert.equal(result.ready,true);
  assert.deepEqual(f.calls.map(call=>call.phase),['dependencies','health']);
  assert.equal(f.downloads.length,1);
});
test('deployment run adapter may return only stdout and receives capture:true',async t=>{
  const f=await fixture(t),normal=f.options.run;
  f.options.run=async(command,args,options)=>{
    assert.equal(options.capture,true);
    const result=await normal(command,args,options);
    return {stdout:result.stdout};
  };
  assert.equal((await installVoiceRuntime(f.options)).ready,true);
});
test('official downloader stage uses fixed repository and revision, never user auth',async t=>{
  const f=await fixture(t);
  process.env.HF_TOKEN='fixture-private-token';
  process.env.HF_ENDPOINT='https://fixture.invalid';
  t.after(()=>{delete process.env.HF_TOKEN;delete process.env.HF_ENDPOINT;});
  await installVoiceRuntime(f.options);
  for(const call of f.calls) {
    assert.equal(call.env.HF_TOKEN,'');
    assert.equal(call.env.HF_ENDPOINT,'https://huggingface.co');
    assert.equal(call.env.HF_HUB_DISABLE_IMPLICIT_TOKEN,'1');
    assert.ok(call.env.HF_HOME.startsWith(f.root));
  }
  assert.equal(MODEL_SOURCE.revision,'536b0662742c02347bc0e980a01041f333bce120');
  assert.match(MODEL_SOURCE.modelSha256,/^[a-f0-9]{64}$/);
});
test('failed pip records redacted failure and never downloads; retry can recover',async t=>{
  const f=await fixture(t),normal=f.options.run;
  f.options.run=async(command,args,options)=>options.phase==='dependencies'?{code:1,stdout:'private token never emitted',stderr:'https://private.invalid/?secret=123'}:normal(command,args,options);
  const failed=await installVoiceRuntime(f.options);
  assert.equal(failed.status,'failed');
  assert.equal(failed.failure.phase,'dependencies');
  assert.equal(f.downloads.length,0);
  const raw=await fs.readFile(f.paths.manifest,'utf8');
  assert.ok(!raw.includes('private.invalid')&&!raw.includes('secret=123'));
  f.options.run=normal;
  assert.equal((await installVoiceRuntime(f.options)).ready,true);
});
test('incomplete or checksum-wrong download never becomes ready cache',async t=>{
  for(const mode of ['missing-tokenizer','wrong-checksum']) {
    const f=await fixture(t);
    f.options.downloadModel=async args=>{
      await f.downloadModel(args);
      if(mode==='missing-tokenizer') await fs.unlink(path.join(args.destination,'tokenizer.json'));
      else await fs.writeFile(path.join(args.destination,'model.bin'),'wrong fixture bytes');
    };
    const result=await installVoiceRuntime(f.options);
    assert.equal(result.status,'failed');
    const inspection=await inspectVoiceRuntime({...f.options});
    assert.equal(inspection.cacheReady,false);
    assert.equal(inspection.status,'failed');
  }
});
test('hash inspection detects equal-length cache tampering',async t=>{
  const f=await fixture(t);
  await installVoiceRuntime(f.options);
  await fs.writeFile(path.join(f.paths.model,'model.bin'),Buffer.alloc(weight.length,0));
  const result=await inspectVoiceRuntime(f.options);
  assert.equal(result.runtimeReady,true);
  assert.equal(result.cacheReady,false);
  assert.equal(result.cache.status,'hash-mismatch');
});
test('incomplete pre-existing model is preserved before ready replacement',async t=>{
  const f=await fixture(t);
  await fs.mkdir(f.paths.model,{recursive:true});
  await fs.writeFile(path.join(f.paths.model,'personal-marker.txt'),'fixture-old-data');
  assert.equal((await installVoiceRuntime(f.options)).ready,true);
  const previous=(await fs.readdir(f.paths.modelParent)).find(name=>name.startsWith('whisper-small.previous-'));
  assert.ok(previous);
  assert.equal(await fs.readFile(path.join(f.paths.modelParent,previous,'personal-marker.txt'),'utf8'),'fixture-old-data');
});
test('concurrent lock reports busy without overwriting state',async t=>{
  const f=await fixture(t);
  await fs.mkdir(f.paths.mediaRoot,{recursive:true});
  await fs.writeFile(f.paths.lock,'fixture existing lock');
  const result=await installVoiceRuntime(f.options);
  assert.equal(result.status,'busy');
  assert.equal(f.calls.length,0);
  assert.equal(await fs.readFile(f.paths.lock,'utf8'),'fixture existing lock');
});
test('default voice excludes opt-in document and AGPL PDF packages',async t=>{
  const f=await fixture(t);
  await installVoiceRuntime(f.options);
  const pip=f.calls.find(call=>call.phase==='dependencies').args;
  assert.ok(pip.some(arg=>arg.startsWith('av>')));
  for(const name of ['Pillow','python-docx','PyMuPDF']) assert.ok(!pip.some(arg=>arg.startsWith(name)));
  assert.ok(DEPENDENCY_GROUPS['pdf-agpl'][0].startsWith('PyMuPDF'));
});
test('explicit optional groups are installed only when requested',async t=>{
  const f=await fixture(t);
  await installVoiceRuntime({...f.options,groups:['media-files','pdf-agpl']});
  const pip=f.calls.find(call=>call.phase==='dependencies').args;
  for(const name of ['Pillow','python-docx','PyMuPDF']) assert.ok(pip.some(arg=>arg.startsWith(name)));
});
test('launch environment gives shared Python and explicit local model/config',()=>{
  const root=path.resolve('fixture-repo'),config=path.join(root,'.local','client.json');
  const env=voiceLaunchEnvironment(root,{clientConfigPath:config,platform:'win32'});
  assert.equal(env.FEIYU_MEDIA_PYTHON,path.join(root,'work','integration-runtime','media','.venv','Scripts','python.exe'));
  assert.equal(env.FEIYU_ASR_MODEL,path.join(root,'.local','models','whisper-small'));
  assert.equal(env.FEIYU_HOTKEY_CONFIG,config);
  assert.ok(env.FEIYU_ASR_SCRIPT.endsWith(path.join('voice-runtime','local-asr.py')));
  assert.ok(voiceRuntimePaths(root,'linux').python.endsWith(path.join('bin','python')));
});
