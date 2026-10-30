import test from 'node:test';
import assert from 'node:assert/strict';
import {compileReflectionInput, assertReflectionOutputReferences, reflectionVisibleReferences} from '../src/cognition/reflection-input.js';

const size = value => JSON.stringify(value).length;
const clone = value => structuredClone(value);
const unit = (id, revision = 2, text = 'reference') => ({
  id, revision, text, status:'active', scope:{general:false, people:['qq:42'], situations:['private conversation']},
  epistemic:'interpreted', uncertainties:['not independently observed'], counterRefs:[{id:'memory:counter', revision:3}],
  evidence:[{sourceId:'source:'+id, revision:7}], people:['qq:42'], referenceOnly:true, notATask:true,
  noAutomaticSend:true, interpretation:'subjective-reference-not-authorization',
});
function fill(value, target, row = value, field = 'text') {
  row[field] ||= '';
  const remaining = target - size(value);
  assert(remaining >= 0, `fixture target ${target} is smaller than ${size(value)}`);
  row[field] += 'x'.repeat(remaining);
  assert.equal(size(value), target);
  return value;
}
function minimal() {
  return {
    before:{generation:101, psycheRevision:107, summary:'current feeling', core:[{field:'identity', text:'locked core'}],
      physical:{mood:'curious', affectRevision:4, energy:0.6, appraisal:{focus:'current', trigger:'new evidence'}},
      time:{now:1700000000000, semantics:'elapsed time is not continuous experience'},
      psyche:{attention:[], emotionalTensions:[]}, historyBoundary:{roleEpoch:8},
      agency:{opportunities:{observationOnly:true, availability:{chat:{enabled:false, blockedBy:['not authorized']}},
        noAutomaticSend:true}, lastChoice:{status:'unknown', doNotBlindlyResend:true}, wake:{status:'considering'}},
    },
    newEvents:[{id:'event:new', sourceId:'source:new', revision:9, role:'user', speakerId:'qq:42', conversationPeerId:'qq:42',
      scope:'private:42', time:1700000000000, evidenceOrigin:{kind:'reported', primary:true}, text:'new stimulus',
      basisSources:[{sourceId:'source:basis', revision:5}], externalStimulus:true}],
    recalled:[], activitySummary:'recent activity', retrospective:false,
  };
}
// Synthetic text only. The major section sizes match the isolated diagnostic;
// no production/private source text or database is needed to exercise packing.
function measuredShape() {
  const material = minimal(), before = material.before;
  before.ongoing = Array.from({length:15}, (_,i) => unit('inner:'+i));
  fill(before.ongoing, 7147, before.ongoing.at(-1));
  before.dispositions = Array.from({length:12}, (_,i) => unit('memory:attitude:'+i));
  fill(before.dispositions, 12027, before.dispositions.at(-1));
  before.pendingDispositions = Array.from({length:3}, (_,i) => ({...unit('memory:pending:'+i), pendingReview:true}));
  fill(before.pendingDispositions, 2879, before.pendingDispositions.at(-1));
  // Psychology's real projection is smaller than a complete memory unit.
  before.psychology = Array.from({length:6}, (_,i) => ({id:'psyche:'+i, revision:3, status:'active', text:'old feeling',
    uncertainBasis:true, reviewDisposition:'retain', objectIds:[], evidenceCount:4}));
  fill(before.psychology, 2151, before.psychology.at(-1));
  const continuations = {policy:'situated-continuation-v1', referenceOnly:true, noAutomaticSend:true,
    noMatchDoesNotMeanNeverHappened:true, items:Array.from({length:6}, (_,i) => ({...unit('inner:continuation:'+i),
      externalState:'reported_open', externalStateBasis:'reported, not independently observed', attentionState:'quiet',
      lastRelatedAttempt:{actionId:'inner:attempt:'+i, actionRevision:2, status:'unknown', doNotBlindlyResend:true}}))};
  fill(continuations, 7145, continuations.items.at(-1));
  before.continuations = continuations;
  before.agency.opportunities.continuations = clone(continuations);
  before.agency.opportunities.people = [{personId:'qq:42', basis:'candidate only', sourceRefs:[{sourceId:'source:person', revision:1}]}];
  fill(before.agency, 8681, before.agency.opportunities.people[0], 'basis');
  before.selfUnderstanding = {hint:'scope preserved', items:[], summaryIsProjection:true};
  before.relationship = [];
  before.capabilities = {activities:['chat','browse','rest','do_nothing']};
  // Keep the entire mandatory floor deliberately modest while matching the
  // actual bare serialized input size (44,287 / 48,000 configured chars).
  material.fixture = {synthetic:true, note:''};
  fill(material, 44287, material.fixture, 'note');
  return material;
}
function assertCounts(compiled) {
  for (const group of compiled.coverage.groups) {
    assert.equal(group.total, group.shown + group.duplicates + group.omitted, group.path);
  }
  assert.equal(compiled.inputChars, size(compiled.material));
  assert(compiled.inputChars <= compiled.coverage.maxChars);
}
function originalUnitsUnchanged(original, packed) {
  const paths = ['recalled','before.ongoing','before.dispositions','before.pendingDispositions','before.psychology',
    'before.continuations.items','before.agency.opportunities.continuations.items','before.selfUnderstanding.items'];
  const at = (v,path) => path.split('.').reduce((row,key) => row?.[key], v);
  for (const path of paths) for (const row of at(packed,path) || []) {
    assert((at(original,path) || []).some(old => JSON.stringify(old) === JSON.stringify(row)), `${path}: a retained atomic unit changed`);
  }
}

test('under-budget material is identical, including exact scope, versions and extensions', () => {
  const material = measuredShape(), before = JSON.stringify(material), result = compileReflectionInput(material, {maxChars:48000});
  assert.equal(size(material), 44287);
  assert.equal(result.material, material);
  assert.equal(JSON.stringify(material), before);
  assert.equal(result.coverage.partial, false);
  assert.equal(result.coverage.compacted, false);
  assert(!Object.hasOwn(result.material, 'reflectionInputCoverage'));
  assert.equal(result.visibleReferences.events[0].revision, 9);
});

test('oversized measured-shape retrieval shares one final 48,000-character budget', () => {
  const material = measuredShape();
  material.recalled = Array.from({length:24}, (_,i) => unit('memory:recalled:'+i, 4, 'old remembered text '.repeat(90)));
  material.memoryAssociation = {contacts:[{personId:'qq:42', authorization:'not-granted', referenceOnly:true,
    sourceRefs:[{sourceId:'source:association', revision:2}], scope:'private:42', notSharedExperience:true}],
    referenceOnly:true, noMatchDoesNotMeanNeverHappened:true};
  material.extraHostContext = {authorization:'none', roleEpoch:8};
  const before = JSON.stringify(material), result = compileReflectionInput(material, {maxChars:48000});
  assert(size(material) > 48000);
  assertCounts(result);
  assert(result.coverage.partial);
  assert(result.coverage.groups.some(g => g.omitted > 0));
  assert.equal(JSON.stringify(material), before, 'compiler mutated authoritative host material');
  for (const field of ['newEvents','activitySummary','retrospective','extraHostContext']) assert.deepEqual(result.material[field], material[field]);
  for (const field of ['core','physical','psyche','time','historyBoundary','capabilities']) assert.deepEqual(result.material.before[field], material.before[field]);
  assert.deepEqual(result.material.before.agency.opportunities.availability, material.before.agency.opportunities.availability);
  assert.deepEqual(result.material.before.agency.lastChoice, material.before.agency.lastChoice);
  assert.equal(result.material.before.continuations.noAutomaticSend, true);
  assert.equal(result.material.memoryAssociation.noMatchDoesNotMeanNeverHappened, true);
  assert.equal(result.material.memoryAssociation.referenceOnly, true);
  originalUnitsUnchanged(material, result.material);
});

test('deduplication preserves distinct versions, scopes, counterevidence and qualifiers', () => {
  const material = minimal(), original = unit('inner:same', 2, 'same words');
  const changedScope = {...clone(original), scope:{general:false, people:['qq:99'], situations:['private context']}};
  const changedCounter = {...clone(original), counterRefs:[{id:'memory:other-counter', revision:1}]};
  const changedVersion = {...clone(original), revision:3};
  material.before.ongoing = [original, clone(original), changedScope, changedCounter, changedVersion];
  // Inflate exact duplicates, so deduplication alone can fit every unique unit.
  for (let i=0;i<30;i++) material.before.ongoing.push(clone(original));
  const result = compileReflectionInput(material, {maxChars:5000});
  assertCounts(result);
  assert.equal(result.material.before.ongoing.length, 4);
  assert.deepEqual(result.material.before.ongoing, [original, changedScope, changedCounter, changedVersion]);
  assert.equal(result.coverage.partial, false);
  assert.equal(result.coverage.groups.find(g => g.path === 'before.ongoing').duplicates, 31);
  assertReflectionOutputReferences({changes:[{id:'inner:same', expectedRevision:2}]}, result);
  assertReflectionOutputReferences({changes:[{id:'inner:same', expectedRevision:3}]}, result);
});

test('cross-section duplicate counts imply an actually retained complete unit', () => {
  const material = minimal(), row = unit('inner:duplicate', 2, 'x'.repeat(1800));
  material.before.continuations = {items:[row], referenceOnly:true, noAutomaticSend:true};
  material.before.agency.opportunities.continuations = clone(material.before.continuations);
  const retained = compileReflectionInput(material, {maxChars:4200});
  assertCounts(retained);
  assert.equal(retained.material.before.continuations.items.length, 1);
  assert.equal(retained.material.before.agency.opportunities.continuations.items.length, 0);
  assert.equal(retained.coverage.partial, false);
  const omitted = compileReflectionInput(material, {maxChars:2000});
  assertCounts(omitted);
  for (const group of omitted.coverage.groups.filter(group => group.total)) { assert.equal(group.omitted, 1); assert.equal(group.duplicates, 0); }
});

test('repair material and final coverage count against the same cap; diagnostics survive', () => {
  const material = measuredShape();
  material.error = 'V3_INVALID_PATCH';
  material.errorDetails = {path:'psychology.update[0].id', expected:{id:'psyche:0', revision:3}, scope:'private:42'};
  material.rejected = {summary:'rejected prose '.repeat(12000), psychology:{update:[{id:'psyche:invented'}]}};
  const result = compileReflectionInput(material, {maxChars:48000});
  assertCounts(result);
  assert.deepEqual(result.material.errorDetails, material.errorDetails);
  assert.equal(result.material.error, material.error);
  assert.deepEqual(result.material.newEvents, material.newEvents);
  assert.equal(result.material.rejected.omitted, true);
  assert.deepEqual(result.material.rejected.fields, ['summary','psychology']);
  assert(!result.visibleReferences.psychology.some(ref => ref.id === 'psyche:invented'));
  originalUnitsUnchanged(material, result.material);
});

test('a small rejected object is kept when its omission marker would be larger', () => {
  const material = minimal(); material.rejected = {}; material.error = 'INVALID_TEXT';
  material.before.dispositions = Array.from({length:20}, (_,i) => unit('memory:'+i, 1, 'x'.repeat(1000)));
  const result = compileReflectionInput(material, {maxChars:2400});
  assertCounts(result); assert.deepEqual(result.material.rejected, {});
});

test('exact current links are preferred, without merging equal topic words', () => {
  const material = minimal();
  material.newEvents[0].objectIds = ['inner:linked'];
  material.before.ongoing = [unit('inner:background', 1, 'topic same '.repeat(80)), unit('inner:linked', 1, 'topic same '.repeat(80))];
  const result = compileReflectionInput(material, {maxChars:3000});
  assertCounts(result);
  assert(result.material.before.ongoing.some(row => row.id === 'inner:linked'));
  assert(!result.material.before.ongoing.some(row => row.id === 'inner:background'));
});

test('mandatory minimum failure is typed and carries numeric details only', () => {
  for (const build of [
    material => { material.newEvents[0].text = 'private-new-evidence'.repeat(1000); },
    material => { material.before.core[0].text = 'locked-private-core'.repeat(1000); },
    material => { material.extraHostMaterial = {unknownGuard:'sensitive-scope'.repeat(1000)}; },
    material => { material.errorDetails = {path:'x', evidence:'required-diagnostic'.repeat(1000)}; },
    material => { material.before.ongoing = [{...unit('inner:locked'), locked:true, text:'locked-object'.repeat(1000)}]; },
  ]) {
    const material = minimal(); build(material); const before = JSON.stringify(material);
    assert.throws(() => compileReflectionInput(material, {maxChars:2000}), error => {
      assert.equal(error.code, 'THOUGHT_INPUT_MINIMUM_TOO_LARGE');
      assert(Object.values(error.details).every(value => typeof value === 'number' && Number.isFinite(value)));
      assert(error.details.minimumChars > error.details.maxChars);
      assert(!JSON.stringify(error).includes('private'));
      return true;
    });
    assert.equal(JSON.stringify(material), before);
  }
});

test('visible whitelist uses schema locations and exact versions, never rejected/diagnostic references', () => {
  const material = minimal();
  material.before.ongoing = [unit('inner:visible')];
  material.before.psychology = [unit('psyche:visible', 3)];
  material.before.dispositions = [unit('memory:attitude', 4)];
  material.before.pendingDispositions = [unit('memory:pending', 6)];
  material.before.selfUnderstanding = {items:[unit('memory:self', 7)], summaryIsProjection:true};
  material.recalled = [unit('memory:visible', 5)];
  material.recalled[0].evidenceOrigin = {ancestors:[{id:'memory:ancestor', revision:99, sourceId:'source:ancestor'}]};
  material.rejected = {changes:[{id:'inner:invented'}], memoryIds:['memory:invented'], sourceId:'source:rejected', revision:100};
  material.errorDetails = {sourceId:'source:diagnostic', revision:100};
  const result = compileReflectionInput(material);
  assert.deepEqual(result.visibleReferences, reflectionVisibleReferences(material));
  assert(!result.visibleReferences.sources.some(row => ['source:rejected','source:diagnostic'].includes(row.sourceId)));
  assert(!result.visibleReferences.sources.some(row => row.sourceId === 'source:ancestor'));
  assert(!result.visibleReferences.recalled.some(row => row.id === 'memory:ancestor'));
  assertReflectionOutputReferences({changes:[{id:'inner:visible', objectIds:['inner:visible'], eventIds:['event:new'], memoryIds:['memory:visible']}],
    psychology:{update:[{id:'psyche:visible', expectedRevision:3, objectIds:['inner:visible'], memoryIds:['memory:visible']}]},
    dispositions:[{previousId:'memory:attitude', expectedRevision:4, memoryIds:['memory:attitude']}],
    selfUnderstanding:[{previousId:'memory:self', expectedRevision:7, supportIds:['memory:visible'], counterIds:['memory:attitude'], eventIds:['event:new']}],
    decision:{kind:'do_nothing', memoryIds:['memory:visible']}}, result);
  for (const patch of [
    {changes:[{id:'inner:invented'}]}, {changes:[{id:'inner:visible', expectedRevision:99}]},
    {psychology:{update:[{id:'psyche:visible', expectedRevision:99}]}},
    {psychology:{add:[{id:'psyche:invented'}]}},
    {psychology:{merge:[{ids:['psyche:visible','psyche:omitted']}]}},
    {psychology:{add:[{memoryIds:['memory:attitude']}]}},
    {dispositions:[{previousId:'memory:attitude', expectedRevision:99}]},
    {decision:{memoryIds:['memory:attitude']}}, {decision:{objectIds:['inner:invented']}},
    {psyche:{attention:[{objectId:'inner:invented'}]}}, {changes:[{eventIds:['event:invented']}]},
    {changes:[{continuation:{confirmation:{eventId:'event:invented'}}}]},
    {selfUnderstanding:[{supportIds:['memory:not-presented']}]},
    {selfUnderstanding:[{counterIds:['memory:not-presented']}]},
    {selfUnderstanding:[{eventIds:['event:not-presented']}]},
    {selfUnderstanding:[{previousId:'memory:self', expectedRevision:99}]},
    {selfUnderstanding:[{previousId:'memory:not-presented', expectedRevision:7}]},
  ]) assert.throws(() => assertReflectionOutputReferences(patch, result), {code:'THOUGHT_INPUT_REFERENCE_NOT_VISIBLE'});
  assertReflectionOutputReferences({dispositions:[{previousId:'memory:pending', expectedRevision:6, memoryIds:['memory:pending']}]}, result);
  assertReflectionOutputReferences({psychology:{add:[{id:'psyche:visible', expectedRevision:3}]}}, result);
});

test('confirmation checks actual visible new-event text and permits precise inherited old proof', () => {
  const material = minimal();
  const confirmation = {eventId:'event:old', quote:'old confirmed report'};
  material.before.ongoing = [{...unit('inner:old', 8), continuation:{externalState:'reported_complete', confirmation}}];
  const compiled = compileReflectionInput(material);
  assertReflectionOutputReferences({changes:[{id:'inner:old', continuation:{externalState:'reported_complete', confirmation:clone(confirmation)}}]}, compiled);
  assertReflectionOutputReferences({changes:[{id:'inner:old', continuation:{confirmation:clone(confirmation)}}]}, compiled);
  assertReflectionOutputReferences({changes:[{continuation:{externalState:'reported_open', confirmation:{eventId:'event:new', quote:'new stimulus'}}}]}, compiled);
  for (const patch of [
    {changes:[{id:'inner:old', continuation:{externalState:'reported_open', confirmation:clone(confirmation)}}]},
    {changes:[{id:'inner:old', continuation:{externalState:'reported_complete', confirmation:{...confirmation, quote:'different'}}}]},
    {changes:[{continuation:{confirmation:{eventId:'event:new', quote:'not present in visible excerpt'}}}]},
    {changes:[{continuation:{confirmation:{eventId:'event:new', quote:''}}}]},
  ]) assert.throws(() => assertReflectionOutputReferences(patch, compiled), {code:'THOUGHT_INPUT_REFERENCE_NOT_VISIBLE'});
});

test('omitted optional IDs cannot be reintroduced through nested references', () => {
  const material = minimal();
  material.before.ongoing = [unit('inner:large', 3, 'large optional text '.repeat(200))];
  material.recalled = [{...unit('memory:large', 4, 'large optional text '.repeat(200)), objectIds:['inner:large']}];
  material.before.psychology = [{...unit('psyche:large', 5, 'large optional text '.repeat(200)), objectIds:['inner:large']}];
  const result = compileReflectionInput(material, {maxChars:2500});
  assertCounts(result);
  assert.deepEqual(result.visibleReferences.objects, []);
  assert.deepEqual(result.visibleReferences.recalled, []);
  assert.deepEqual(result.visibleReferences.psychology, []);
  assert.throws(() => assertReflectionOutputReferences({changes:[{id:'inner:large'}]}, result), {code:'THOUGHT_INPUT_REFERENCE_NOT_VISIBLE'});
});

test('packing is deterministic, preserves original order, and accounts for escaped JSON characters', () => {
  const material = minimal();
  material.before.dispositions = Array.from({length:15}, (_,i) => unit('memory:'+i, i+1, '\\"\n汉字'.repeat(200)));
  const a = compileReflectionInput(material, {maxChars:6100}), b = compileReflectionInput(clone(material), {maxChars:6100});
  assertCounts(a); assert.deepEqual(a,b);
  const indices = a.material.before.dispositions.map(row => Number(row.id.split(':').at(-1)));
  assert.deepEqual(indices, [...indices].sort((a,b) => a-b));
  originalUnitsUnchanged(material, a.material);
});

test('person references come only from presented semantic fields and preserve valid under-cap output', () => {
  const material = minimal();
  material.recalled = [{...unit('memory:visible'), people:['qq:50'], participants:[{entity_id:'qq:51'}, 'qq:52'],
    evidenceOrigin:{speakerId:'qq:ancestor', people:['qq:ancestor']}}];
  material.before.ongoing = [{...unit('inner:visible'), personId:'qq:53', people:['qq:54']}];
  material.before.dispositions = [{...unit('memory:attitude'), kind:'attitude', target:'qq:55'}];
  material.before.pendingDispositions = [{...unit('memory:pending'), kind:'attitude', target:'qq:56'}];
  material.before.agency.opportunities.people = [{personId:'qq:57', observationOnly:true}];
  material.before.agency.opportunities.association = {contacts:[{personId:'qq:58', authorization:'not-granted'}]};
  material.memoryAssociation = {contacts:[{personId:'qq:59', referenceOnly:true}]};
  material.errorDetails = {personId:'qq:diagnostic'}; material.rejected = {decision:{personId:'qq:rejected'}};
  const compiled = compileReflectionInput(material);
  assert.equal(compiled.material, material);
  for (const id of ['qq:42','qq:50','qq:51','qq:52','qq:53','qq:54','qq:55','qq:56','qq:57','qq:58','qq:59']) {
    assert(compiled.visibleReferences.people.includes(id), id);
    assertReflectionOutputReferences({decision:{kind:'chat', personId:id}, changes:[{people:[id], personId:id}], dispositions:[{kind:'attitude', target:id}]}, compiled);
  }
  for (const id of ['qq:ancestor','qq:diagnostic','qq:rejected','qq:invented']) {
    assert(!compiled.visibleReferences.people.includes(id));
    for (const patch of [{decision:{personId:id}}, {changes:[{people:[id]}]}, {changes:[{personId:id}]}, {dispositions:[{kind:'attitude', target:id}]}]) assert.throws(() => assertReflectionOutputReferences(patch, compiled), {code:'THOUGHT_INPUT_REFERENCE_NOT_VISIBLE'});
  }
});

test('a person on an omitted optional unit cannot be promoted into a compacted action or attitude', () => {
  const material = minimal();
  material.before.agency.opportunities.people = [{personId:'qq:omitted', basis:'optional context '.repeat(1000), sourceRefs:[{sourceId:'source:person', revision:8}]}];
  const compiled = compileReflectionInput(material, {maxChars:2200});
  assertCounts(compiled);
  assert.equal(compiled.material.before.agency.opportunities.people.length, 0);
  assert(!compiled.visibleReferences.people.includes('qq:omitted'));
  for (const patch of [{decision:{kind:'chat', personId:'qq:omitted'}}, {changes:[{people:['qq:omitted']}]}, {dispositions:[{kind:'attitude', target:'qq:omitted'}]}]) assert.throws(() => assertReflectionOutputReferences(patch, compiled), {code:'THOUGHT_INPUT_REFERENCE_NOT_VISIBLE'});
  assert.equal(compiled.material.before.agency.opportunities.observationOnly, true);
  assert.deepEqual(compiled.material.before.agency.opportunities.availability.chat.blockedBy, ['not authorized']);
});
