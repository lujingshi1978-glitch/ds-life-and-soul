// Real staged bridge HTTP routes; all files and databases are synthetic temp fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { createLifeMemoryView } from '../src/life-memory-view.js';

async function fixture(t, { enabled = true } = {}) {
  const h = await bridgeHarness({ config: { socialV2: { mind: { enabled, version: 3 } } }, globals: { createLifeMemoryView } });
  h.setMode('reserved2');
  const runtime = h.mindSystem?.runtime;
  const add = (id, { adapter, kind, scope, platform, person, memoryKind = 'episode', disposition, at }) => {
    const ref = runtime.observe({ adapter, externalId: id, kind, text: 'RAW_SOURCE_BODY_' + id,
      occurredAt: at, metadata: { scope, platform, speakerId: person || runtime.characterId, conversationPeerId: person, privacyLabel: 'private' } },
    { kind: 'resource-observed', eventRoot: 'fixture:' + id, outcome: 'observed' });
    runtime.store.addNodes([{ id: 'fixture-memory:' + id, kind: memoryKind, gist: '记录 ' + id,
      occurredAt: at, epistemic: 'interpreted', evidence: [{ sourceId: ref.sourceId, revision: ref.revision }],
      participants: person ? [{ entityId: person, role: 'participant' }] : [],
      metadata: { scope, ...(disposition ? { disposition } : {}), ...(memoryKind === 'experience' ? { reaction: '明确的感受 ' + id } : {}) } }]);
    return ref;
  };
  if (runtime) {
    const qq = add('qq', { adapter: 'qq', kind: 'chat', scope: 'private:101', person: 'qq:101', at: 1000 });
    const wechat = add('wechat', { adapter: 'wechat', kind: 'chat', scope: 'wechat:aaaaaaaaaaaaaaaaaaaaaaaa', platform: 'wechat', person: 'wechat:aaaaaaaaaaaaaaaaaaaaaaaa', at: 2000 });
    add('web', { adapter: 'qq-live-archive', kind: 'web-reading', scope: 'self', platform: 'web', at: 3000 });
    add('video', { adapter: 'bili', kind: 'video-subtitles', scope: 'self', at: 4000 });
    add('file', { adapter: 'qq-live-archive', kind: 'document', scope: 'self', at: 5000 });
    add('feeling', { adapter: 'wechat', kind: 'chat', scope: 'wechat:aaaaaaaaaaaaaaaaaaaaaaaa', platform: 'wechat', person: 'wechat:aaaaaaaaaaaaaaaaaaaaaaaa', memoryKind: 'experience', at: Date.now() });
    add('relation', { adapter: 'wechat', kind: 'chat', scope: 'wechat:aaaaaaaaaaaaaaaaaaaaaaaa', platform: 'wechat', person: 'wechat:aaaaaaaaaaaaaaaaaaaaaaaa', memoryKind: 'relationship',
      disposition: { kind: 'attitude', target: 'wechat:aaaaaaaaaaaaaaaaaaaaaaaa', reason: '真实相处', facet: '信任', transition: 'coexist' }, at: 7000 });
    runtime.store.alias('qq:101', '同名', qq);
    runtime.store.alias('wechat:aaaaaaaaaaaaaaaaaaaaaaaa', '同名', wechat);
  }
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await h.close(); });
  const context = () => h.roleWrites.snapshot('/api/mind/view');
  const request = async (path = '/api/mind/view', { token = true, roleContext = context(), headers = {} } = {}) => {
    const res = await fetch(base + path, { headers: { ...(token ? { 'x-console-token': 'fixture-console-token' } : {}),
      ...(roleContext ? { 'x-role-context': encodeURIComponent(JSON.stringify(roleContext)) } : {}), ...headers } });
    return { status: res.status, body: await res.json() };
  };
  return { h, runtime, request, context };
}

test('new full-character route needs no QQ key, preserves source filters and exact paged totals', async t => {
  const { request } = await fixture(t);
  const page = await request('/api/mind/view?limit=2');
  assert.equal(page.status, 200); assert.equal(page.body.total, 7); assert.equal(page.body.items.length, 2); assert.equal(page.body.nextOffset, 2);
  const last = await request('/api/mind/view?offset=6&limit=2'); assert.equal(last.body.total, 7); assert.equal(last.body.nextOffset, null);
  for (const source of ['qq', 'wechat', 'web', 'video', 'file']) assert.ok(page.body.facets.sources.some(s => s.id === source));
  assert.equal((await request('/api/mind/view?source=file')).body.total, 1);
  assert.equal((await request('/api/mind/view?scope=self&source=qq')).body.total, 0);
  assert.equal((await request('/api/mind/view?person=wechat%3Aaaaaaaaaaaaaaaaaaaaaaaaa')).body.total, 3);
});

test('old QQ-specific overview rejects invalid keys exactly as before', async t => {
  const { request } = await fixture(t);
  for (const key of ['wechat:aaaaaaaaaaaaaaaaaaaaaaaa', 'self', 'not-a-key']) {
    const result = await request('/api/mind/overview?key=' + encodeURIComponent(key));
    assert.equal(result.status, 400); assert.equal(result.body.error, '无效对象');
  }
});

test('whole-character overview does not create the default QQ conversation or call intimacy.ensure', async t => {
  const { h, request } = await fixture(t);
  const conversationCount = h.socialV2.conversations.size;
  const result = await request('/api/mind/view?view=overview');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.scope, 'all'); assert.ok(result.body.state); assert.ok(result.body.innerV3); assert.ok(result.body.core);
  assert.equal(result.body.totals.memories, 7); assert.equal(result.body.totals.experiences, 1);
  assert.equal(h.socialV2.conversations.size, conversationCount);
  assert.equal(Object.hasOwn(result.body, 'key'), false); assert.equal(Object.hasOwn(result.body, 'intimacy'), false);
  assert.ok(result.body.experiences.some(x => x.scope.startsWith('wechat:')));
  assert.ok(result.body.activities.some(x => x.scope === 'self'));
});

test('console authentication remains mandatory and every agent-header form is rejected', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('/api/mind/view', { token: false })).status, 401, 'retain existing console authentication status');
  for (const headers of [{ 'X-Agent-Call': '1' }, { 'X-Agent-Token': '' }, { 'x-agent-token': 'invalid' }]) {
    assert.equal((await request('/api/mind/view', { headers })).status, 403);
    assert.equal((await request('/api/mind/view?view=overview', { headers })).status, 403);
  }
});

test('missing/stale role context and projection/activation changes fail without changing the data', async t => {
  const { h, request, context } = await fixture(t);
  assert.equal((await request('/api/mind/view', { roleContext: null })).status, 428);
  assert.equal((await request('/api/mind/view', { roleContext: { ...context(), profileId: 'other' } })).status, 409);
  assert.equal((await request('/api/mind/view', { roleContext: { ...context(), activationEpoch: 0 } })).status, 409);
  const oldPending = h.roleWrites.pending; h.roleWrites.pending = () => 1;
  assert.equal((await request('/api/mind/view')).status, 503); h.roleWrites.pending = oldPending;
  const core = h.mindSystem.store.core; const activation = h.roleWrites.activation;
  h.mindSystem.store.core = () => { const value = core.call(h.mindSystem.store); h.roleWrites.activation++; return value; };
  assert.equal((await request('/api/mind/view?view=overview')).status, 409);
  h.mindSystem.store.core = core; h.roleWrites.activation = activation;
});

test('disabled mind or unavailable V3 returns a real 503', async t => {
  const { h, request } = await fixture(t, { enabled: false });
  assert.equal(h.mindSystem, null); assert.equal((await request('/api/mind/view')).status, 503);
});

test('a cognition revision change while overview is assembled rejects the mixed snapshot', async t => {
  const { h, runtime, request } = await fixture(t), core = h.mindSystem.store.core;
  // Simulate an external writer only in this synthetic fixture. The view itself
  // never performs this mutation; it must detect that its read was superseded.
  h.mindSystem.store.core = () => {
    const value = core.call(h.mindSystem.store);
    runtime.store.db.prepare('UPDATE character_manifest SET cognition_revision=cognition_revision+1 WHERE singleton=1').run();
    return value;
  };
  try {
    const result = await request('/api/mind/view?view=overview');
    assert.equal(result.status, 409); assert.equal(result.body.error, 'MEMORY_VIEW_CHANGED');
  } finally { h.mindSystem.store.core = core; }
});

test('V2-only runtime cannot pretend to be the new V3 whole-character view', async t => {
  const { h, request } = await fixture(t); h.mindSystem.isV3 = false;
  try { assert.equal((await request('/api/mind/view?view=overview')).status, 503); }
  finally { h.mindSystem.isV3 = true; }
});

test('real HTTP list and overview prepare only SELECT, read no raw body and leave SQLite counts unchanged', async t => {
  const { runtime, request } = await fixture(t);
  const databases = [runtime.store.db, runtime.archive.db];
  const before = databases.map(db => db.prepare('SELECT total_changes() n').get().n);
  const originals = databases.map(db => ({ db, prepare: db.prepare, exec: db.exec }));
  for (const { db, prepare } of originals) {
    db.prepare = function(sql) {
      assert.match(sql.trim(), /^SELECT\b/i, 'route attempted a non-SELECT statement: ' + sql.slice(0, 140));
      if (db === runtime.archive.db) assert.doesNotMatch(sql, /\bbody\b|SELECT\s+\*/i, 'raw source body queried');
      return prepare.call(this, sql);
    };
    db.exec = () => { throw Error('route attempted SQL exec'); };
  }
  try {
    for (const view of ['memories', 'relationships', 'experiences', 'sources', 'overview']) {
      const result = await request('/api/mind/view?view=' + view);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.sourceContentIncluded, false);
      assert.equal(JSON.stringify(result.body).includes('RAW_SOURCE_BODY'), false);
    }
  } finally { for (const { db, prepare, exec } of originals) { db.prepare = prepare; db.exec = exec; } }
  assert.deepEqual(databases.map(db => db.prepare('SELECT total_changes() n').get().n), before);
});

test('legacy overview block retains the reviewed export baseline', () => {
  const current = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
  const begin = current.indexOf("        if (url.pathname === '/api/mind/overview'");
  const end = current.indexOf("        if(url.pathname==='/api/mind/state/adjust'", begin);
  assert.ok(begin >= 0 && end > begin);
  assert.equal(createHash('sha256').update(current.slice(begin, end)).digest('hex'), '159198202058005a77855662bc96d1f726341e727abce2c66dab6a5634379958');
});
