import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeHarness} from './audit-bridge-harness.mjs';
import {PublicReading} from '../src/cognition/public-reading.js';

// The real bridge runs inside the existing VM harness. DSH and OneBot peers
// are in-memory recorders, all state is temporary, and no real model is used.
async function fixture(t) {
  const h = await bridgeHarness({config:{
    ownerQQ:123, allow:{private:['123','200'], groups:[]},
    socialV2:{enabled:true, mind:{enabled:true, version:3},
      proactive:{enabled:true, ownerOnly:false}, sticker:{enabled:false}},
  }});
  h.setMode('reserved2'); h.setReady(true); h.setQQConnected(true);
  h.socialV2.paused = false;
  t.after(() => h.close());
  return h;
}
const flush = () => new Promise(resolve => setTimeout(resolve, 80));
const outbound = h => h.calls.http.filter(call => call.url.endsWith('/send_private_msg'));
const execution = (r, actionId) => r.store.db.prepare('SELECT * FROM v3_action_executions WHERE action_id=? ORDER BY rowid DESC LIMIT 1').get(actionId);

function choose(h) {
  const r = h.mindSystem.runtime;
  r.store.ensureEntity('qq:123');
  const event = r.observe({adapter:'agency-native-isolation', externalId:'fresh-observation', kind:'post',
    text:'合成公开材料：一段透明小鱼的观察。', occurredAt:r.now(),
    metadata:{scope:'self', speakerId:r.characterId, explicitObservation:true, privacyLabel:'public'}},
  {kind:'perception-observed'});
  const result = r.inner.apply({summary:'这个小发现让我想到那位聊过海洋的朋友。', changes:[],
    decision:{kind:'chat', personId:'qq:123', intent:'想分享刚看到的透明小鱼这个小发现'}},
  {expectedGeneration:r.inner.head().generation, eventIds:[event.eventId], key:event.eventId});
  return {result, event};
}

function assertNativeTarget(h, person, text) {
  assert.equal(h.calls.prompts.length, 1);
  const prompt = h.calls.prompts[0], key = 'private:' + person.slice(3);
  assert.equal(prompt.sessionId, h.state.sessions[key]);
  assert.match(prompt.content.filter(part => part.type === 'text').map(part => part.text).join('\n'), text);
  assert.equal(h.getSocialV2State(key).innerAction?.actionId,
    h.mindSystem.runtime.inner.meta('proactiveChatDispatchV1').actionId);
  assert.equal(outbound(h).length, 0, 'accepting a native turn is not a delivered QQ message');
}

async function confirmFakeDelivery(h, actionId, message) {
  const r = h.mindSystem.runtime;
  assert.equal(execution(r, actionId).status, 'claimed');
  const sent = await h.sendMessagesV2('private:123', [message], []);
  assert.equal(outbound(h).length, 1);
  assert.equal(String(outbound(h)[0].body.user_id), '123');
  assert.equal(execution(r, actionId).status, 'started', 'a started send is not successful until the delivery journal acknowledges its receipt');
  h.recordSentMessagesV2('private:123', sent);
  assert.equal(execution(r, actionId).status, 'succeeded');
  assert.equal(r.inner.meta('proactiveChatDispatchV1').status, 'sent');
  assert.equal(h.getSocialV2State('private:123').innerAction, null);
  await h.dispatchProactiveIntentV3();
  h.mindSystem.changed();
  await flush();
  assert.equal(h.calls.prompts.length, 1);
  assert.equal(outbound(h).length, 1, 'completed intent must not be replayed');
}

test('a selected concrete intent reaches one native turn and one confirmed fake QQ delivery', async t => {
  const h = await fixture(t), {result} = choose(h), r = h.mindSystem.runtime;
  assert.equal(result.actionKind, 'chat');
  const proposal = r.inner.activityCandidate('chat');
  assert.equal(proposal.target_person_id, 'qq:123');
  assert.equal(r.inner.actionProvenance(proposal.object_id, proposal.revision).executable, true);
  assert.equal(outbound(h).length, 0);
  const dispatch = await h.dispatchProactiveIntentV3();
  assert.equal(dispatch.status, 'submitted');
  assert.equal(dispatch.actionId, result.actionId);
  assertNativeTarget(h, 'qq:123', /透明小鱼/);
  await h.dispatchProactiveIntentV3();
  await flush();
  assert.equal(h.calls.prompts.length, 1);
  await confirmFakeDelivery(h, result.actionId, '刚看到一种透明小鱼，想起你之前聊的海洋。');
  assert.equal(h.getSocialV2State('private:123').proactiveTimer, null);
});

function seedConversation(r) {
  const source = r.observe({adapter:'agency-native-memory', externalId:'ocean-friend', kind:'chat',
    text:'之前和朋友聊过透明小鱼的海洋观察。', metadata:{scope:'private:123', speakerId:'qq:123',
      conversationPeerId:'qq:123', role:'user'}}, {kind:'archive-imported', eventRoot:'ocean-friend'});
  const memoryId = r.store.addNodes([{kind:'episode', gist:'qq:123聊过透明小鱼的海洋观察。',
    eventRoot:'ocean-friend', evidence:[{sourceId:source.sourceId, revision:source.revision}],
    participants:[{entityId:'qq:123', role:'speaker'}, {entityId:r.characterId, role:'participant'}]}]).ids[0];
  return {source, memoryId};
}

test('actual reading recalls a particular conversation and its chat choice reaches native dispatch and a fake receipt', async t => {
  const h = await fixture(t), r = h.mindSystem.runtime;
  h.getSocialV2State('private:123');
  const {memoryId} = seedConversation(r);
  let modelCalls = 0;
  r.model.think = async input => {
    modelCalls++;
    assert.ok(input.material.recalled.some(memory => memory.id === memoryId));
    const contact = input.material.memoryAssociation.contacts.find(row => row.personId === 'qq:123');
    assert.ok(contact);
    assert.ok(contact.memoryIds.includes(memoryId));
    assert.ok(contact.sourceRefs.length);
    return {data:{summary:'新的透明小鱼观察让我想到那段来往，想告诉他这个小发现。', changes:[], psychology:{},
      feeling:{mood:'好奇', valence:0.3, arousal:0.5, appraisal:{focus:'刚读到的海洋材料', trigger:'真实公开阅读'}},
      publicReaction:{summary:'实际读到了透明小鱼的海洋观察。', feeling:'有点新奇。', like:false, comment:null, topic:null},
      decision:{kind:'chat', personId:'qq:123', intent:'刚读到透明小鱼的新观察，想分享给你', memoryIds:[memoryId]}},
      receipt:{disposed:true, transcriptPersisted:false}};
  };
  const text = '海洋观察：透明小鱼在浅海中缓慢游动。';
  const ref = h.mindSystem.archive.put('agency-native-reading', 'self', 'web-reading', text, {privacyLabel:'public'});
  await new PublicReading(h.mindSystem).appraise({ref,
    item:{platform:'bilibili', url:'https://www.bilibili.com/video/BV1234567890', title:'透明小鱼的海洋观察'},
    text, coverage:{text:true}});
  await flush();
  assert.equal(modelCalls, 1, 'one forebrain integration, without a separate forced-sharing model');
  const proposal = r.store.db.prepare("SELECT * FROM v3_action_proposals WHERE action_kind='chat' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(proposal.target_person_id, 'qq:123');
  assert.equal(r.inner.actionProvenance(proposal.object_id, proposal.revision).origin, 'public-reading');
  assertNativeTarget(h, 'qq:123', /透明小鱼/);
  await confirmFakeDelivery(h, proposal.object_id, '刚读到透明小鱼的新观察，想起我们聊过的那段。');
});

test('withdrawing the selected source before native dispatch prevents any fake outbound action', async t => {
  const h = await fixture(t), r = h.mindSystem.runtime, {event, result} = choose(h);
  r.archive.erase(event.sourceId);
  assert.equal(r.inner.activityCandidate('chat'), null);
  const dispatch = await h.dispatchProactiveIntentV3();
  assert.equal(dispatch.status, 'no-intent');
  assert.equal(h.calls.prompts.length, 0);
  assert.equal(outbound(h).length, 0);
  assert.equal(execution(r, result.actionId), undefined);
});
