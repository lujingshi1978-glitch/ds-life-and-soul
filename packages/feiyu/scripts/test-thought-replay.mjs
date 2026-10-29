import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTokenLedger} from '../src/token-ledger.js';
import {ThoughtUsageReader} from '../src/thought-meter.js';

const usage={inputTokens:100,outputTokens:20};
const row=(n,extra={})=>({id:'thought-fixture-'+n,at:1700000000000+n,model:'deepseek-flash',provider:'deepseek-official',purpose:'后台思考',usage,...extra});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feiyu-thought-replay-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {file:path.join(dir,'usage.jsonl'),journal:path.join(dir,'thought.jsonl')};}

test('repeated cold journal replay never re-bills evicted immutable thoughts or rewrites the ledger',t=>{
  const f=fixture(t),records=Array.from({length:48},(_,n)=>row(n));
  fs.writeFileSync(f.journal,records.map(r=>JSON.stringify(r)+'\n').join(''));
  let ledger=createTokenLedger({file:f.file,maxLines:4});
  for(const r of records)assert.equal(ledger.ingestThoughtUsage(r),true);
  ledger.compact();const bytes=fs.readFileSync(f.file),before=ledger.summary().totals;
  for(let boot=0;boot<3;boot++){
    ledger=createTokenLedger({file:f.file,maxLines:4});let added=0;
    const reader=new ThoughtUsageReader(f.journal,r=>{if(ledger.ingestThoughtUsage(r))added++;});
    assert.equal(reader.drain(),48);assert.equal(reader.drain(),0);assert.equal(added,0);
    assert.deepEqual(ledger.summary().totals,before);assert.deepEqual(fs.readFileSync(f.file),bytes);
  }
  const next=row(49);fs.appendFileSync(f.journal,JSON.stringify(next)+'\n');
  const reader=new ThoughtUsageReader(f.journal,r=>ledger.ingestThoughtUsage(r));reader.drain();
  assert.equal(ledger.ingestThoughtUsage(next),false);assert.notDeepEqual(ledger.summary().totals,before);
});

test('immutable replay protection does not discard new ordinary-session steps or retries',t=>{
  const f=fixture(t),ledger=createTokenLedger({file:f.file,maxLines:2});
  const event=(step,seq,type='assistant/message',extra={})=>({sessionId:'session-fixture',event:{type,seq,time:1700000000000+seq,data:{turn:1,step,usage,...extra}}});
  for(let n=1;n<=3;n++)assert.equal(ledger.ingestEvent(event(n,n)),true);
  // A lower sequence may fill a previously unseen gap; per-session maxSeq is
  // not a general deduplication key for ordinary mutable sessions.
  assert.equal(ledger.ingestEvent(event(4,0)),true);
  ledger.ingestEvent(event(3,5,'llm/retry-started',{retry:1}));
  assert.equal(ledger.ingestEvent(event(3,6)),true);
  assert.equal(ledger.ingestThoughtUsage(row(1)),true);
  assert.equal(ledger.ingestThoughtUsage({id:'session-fixture',usage}),false);
});

test('journal tail, UTF-8 splits, append and truncation retain unseen records without re-billing seen UUIDs',t=>{
  const f=fixture(t),ledger=createTokenLedger({file:f.file,maxLines:1}),text=JSON.stringify(row(1,{purpose:'记忆整理'}));
  const bytes=Buffer.from(text+'\n'),split=bytes.indexOf(Buffer.from('忆'))+1;
  fs.writeFileSync(f.journal,bytes.subarray(0,split));let added=0;
  const reader=new ThoughtUsageReader(f.journal,r=>{if(ledger.ingestThoughtUsage(r))added++;});
  assert.equal(reader.drain(),0);fs.appendFileSync(f.journal,bytes.subarray(split));assert.equal(reader.drain(),1);assert.equal(added,1);
  fs.appendFileSync(f.journal,JSON.stringify(row(2))+'\n');reader.drain();assert.equal(added,2);
  fs.writeFileSync(f.journal,JSON.stringify(row(1))+'\n');reader.drain();assert.equal(added,2);
  fs.appendFileSync(f.journal,'null\n[]\nfalse\n"noise"\n{broken\n'+JSON.stringify(row(3))+'\n');reader.drain();assert.equal(added,3);
});
