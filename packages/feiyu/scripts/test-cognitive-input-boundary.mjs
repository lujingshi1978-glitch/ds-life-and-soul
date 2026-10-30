import test from 'node:test';
import assert from 'node:assert/strict';
import {CognitiveModel, cognitiveInputLimit, withCognitiveBudget} from '../src/cognition/model.js';

const receipt = {disposed:true, transcriptPersisted:false};
const materialOfSize = n => ({text:'x'.repeat(n-JSON.stringify({text:''}).length)});
function fixture(options = {}, think) {
  const calls = [], reservations = [], recorded = [];
  const budget = {reserve:(purpose,inputChars) => {reservations.push({purpose,inputChars}); return {hour:5};}, receipt:value => recorded.push(value)};
  const model = new CognitiveModel(async input => {calls.push(input); return think ? think(input, calls.length) : {data:{ok:true},receipt};}, options);
  model.budget = budget;
  return {model, calls, reservations, recorded, budget};
}

test('runtime tuning supplies the effective cap even when constructor cap is larger', async () => {
  const f = fixture({maxInputChars:48000, runtimeTuning:{text:{thoughtInputChars:2000}}});
  assert.equal(cognitiveInputLimit(f.model), 2000);
  await assert.rejects(f.model.run('boundary', 'instructions', materialOfSize(2001)), error => {
    assert.equal(error.code, 'COGNITIVE_INPUT_TOO_LARGE');
    assert.deepEqual(error.details, {purpose:'boundary', inputChars:2001, limitChars:2000, instructionChars:12});
    return true;
  });
  assert.equal(f.calls.length, 0); assert.equal(f.reservations.length, 0); assert.equal(f.recorded.length, 0); assert.equal(f.model.receipts.length, 0);
});

test('runtime tuning can raise a constructor cap; its live effective value is measured per call', async () => {
  let cap = 3000;
  const f = fixture({maxInputChars:2000, runtimeTuning:() => ({text:{thoughtInputChars:cap}})});
  assert.equal(cognitiveInputLimit(f.model), 3000);
  await f.model.run('boundary', '', materialOfSize(3000));
  cap = 4000;
  await f.model.run('boundary', '', materialOfSize(4000));
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.model.receipts.map(row => row.materialLimitChars), [3000,4000]);
  assert.deepEqual(f.reservations.map(row => row.inputChars), [3000,4000]);
});

test('without runtime tuning the exact constructor cap is accepted and the next character fails before a charge', async () => {
  const f = fixture({maxInputChars:100});
  assert.equal(cognitiveInputLimit(f.model), 100);
  assert.deepEqual(await f.model.run('boundary', 'system', materialOfSize(100)), {ok:true});
  await assert.rejects(f.model.run('boundary', 'system', materialOfSize(101)), {code:'COGNITIVE_INPUT_TOO_LARGE'});
  assert.equal(f.calls.length, 1); assert.equal(f.reservations.length, 1);
  assert.equal(f.model.receipts[0].materialChars, 100);
  assert.equal(f.model.receipts[0].materialLimitChars, 100);
});

test('the material cap is separate from instructions; budget and receipt total both exactly', async () => {
  const f = fixture({maxInputChars:100}), instructions = 'system text '.repeat(80);
  const material = materialOfSize(100), expected = JSON.stringify(material).length + instructions.length;
  await f.model.run('boundary-accounting', instructions, material);
  assert.deepEqual(f.calls[0].material, material);
  assert(f.calls[0].system.endsWith(instructions));
  assert.deepEqual(f.reservations, [{purpose:'boundary-accounting', inputChars:expected}]);
  assert.equal(f.model.receipts[0].materialChars, 100);
  assert.equal(f.model.receipts[0].instructionChars, instructions.length);
  assert.equal(f.model.receipts[0].inputChars, expected);
  assert.equal(f.model.receipts[0].budgetHour, 5);
  assert.equal(f.recorded[0], f.model.receipts[0]);
});

test('oversized material never charges an explicitly selected budget or invokes the adapter', async () => {
  const f = fixture({maxInputChars:30}), externalCharges = [];
  const explicit = {reserve:(...args) => {externalCharges.push(args); return {};}};
  await assert.rejects(withCognitiveBudget(explicit, () => f.model.run('boundary', 'instructions', materialOfSize(31))), {code:'COGNITIVE_INPUT_TOO_LARGE'});
  assert.deepEqual(externalCharges, []); assert.deepEqual(f.reservations, []); assert.deepEqual(f.calls, []);
});

test('syntax-format retry retains the complete original read set rather than recapturing the slim material', async () => {
  const fullReadSet = {generation:8, roleEpoch:3, sources:[{sourceId:'source:omitted-host-only', revision:19}],
    objects:[{id:'inner:omitted-host-only',revision:12}], authorizationRevision:6};
  const validations = []; let captures = 0;
  const f = fixture({maxInputChars:1000}, (_input,call) => {
    if (call === 1) throw new SyntaxError('mock malformed JSON');
    return {data:{ok:true}, receipt};
  });
  f.model.captureReadSet = () => {captures++; return {incorrect:'the model projection is not the host read set'};};
  f.model.validateReadSet = readSet => {assert.equal(readSet, fullReadSet); validations.push(readSet);};
  const material = {before:{ongoing:[]}, newEvents:[], recalled:[]}, instructions = 'original instructions';
  assert.deepEqual(await f.model.run('boundary-retry', instructions, material, undefined, {originalReadSet:fullReadSet}), {ok:true});
  assert.equal(captures, 0);
  assert.equal(f.calls.length, 2); assert(validations.length >= 4);
  assert.deepEqual(f.calls[0].material, material); assert.deepEqual(f.calls[1].material, material);
  assert(f.calls[1].system.includes(instructions)); assert(f.calls[1].system.length > f.calls[0].system.length);
  assert.equal(f.reservations.length, 2);
  assert.equal(f.model.receipts[0].materialChars, JSON.stringify(material).length);
  assert(f.model.receipts[0].instructionChars > instructions.length);
  assert.equal(f.model.receipts[0].inputChars, f.reservations[1].inputChars);
});

test('a withdrawn omitted source blocks a format retry before another charge or adapter invocation', async () => {
  const fullReadSet = {sources:[{sourceId:'source:omitted-host-only',revision:4}]};
  let stale = false, captures = 0;
  const f = fixture({maxInputChars:1000}, () => {stale = true; throw new SyntaxError('mock malformed JSON');});
  f.model.captureReadSet = () => {captures++; return fullReadSet;};
  f.model.validateReadSet = readSet => {
    assert.equal(readSet, fullReadSet);
    if (stale) throw Object.assign(new Error('COGNITION_READSET_STALE'), {code:'COGNITION_READSET_STALE'});
  };
  await assert.rejects(f.model.run('boundary-retry', 'instructions', {before:{ongoing:[]},recalled:[]}), {code:'COGNITION_READSET_STALE'});
  assert.equal(captures, 1); assert.equal(f.calls.length, 1); assert.equal(f.reservations.length, 1); assert.equal(f.model.receipts.length, 0);
});

test('a source change during the retry is detected against the same full host set on response', async () => {
  const fullReadSet = {sources:[{sourceId:'source:omitted-host-only',revision:4}], authorizationRevision:7};
  let stale = false, captures = 0;
  const f = fixture({maxInputChars:1000}, (_input,call) => {
    if (call === 1) throw new SyntaxError('mock malformed JSON');
    stale = true; return {data:{ok:true},receipt};
  });
  f.model.captureReadSet = () => {captures++; return fullReadSet;};
  f.model.validateReadSet = readSet => {
    assert.equal(readSet, fullReadSet);
    if (stale) throw Object.assign(new Error('COGNITION_READSET_STALE'), {code:'COGNITION_READSET_STALE'});
  };
  await assert.rejects(f.model.run('boundary-retry', 'instructions', {before:{ongoing:[]},recalled:[]}), {code:'COGNITION_READSET_STALE'});
  assert.equal(captures, 1); assert.equal(f.calls.length, 2); assert.equal(f.reservations.length, 2);
});
