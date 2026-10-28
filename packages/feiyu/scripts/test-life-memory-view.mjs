import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLifeMemoryView, LIFE_MEMORY_SQL } from '../src/life-memory-view.js';


const SCHEMA = `
CREATE TABLE character_manifest(singleton INTEGER PRIMARY KEY,character_id TEXT,role_epoch INTEGER,cognition_revision INTEGER);
CREATE TABLE memory_nodes(character_id TEXT,memory_id TEXT,kind TEXT,current_revision INTEGER,status TEXT,detail_state TEXT,epistemic TEXT,event_root TEXT,occurred_at INTEGER,recorded_at INTEGER,invalidated_at INTEGER);
CREATE TABLE memory_versions(character_id TEXT,memory_id TEXT,revision INTEGER,gist TEXT,metadata_json TEXT);
CREATE TABLE memory_evidence(character_id TEXT,memory_id TEXT,memory_revision INTEGER,source_id TEXT,source_revision INTEGER,role TEXT);
CREATE TABLE memory_entities(character_id TEXT,memory_id TEXT,entity_id TEXT,role TEXT);
CREATE TABLE entities(character_id TEXT,entity_id TEXT,namespace TEXT,external_id TEXT,kind TEXT);
CREATE TABLE entity_aliases(character_id TEXT,entity_id TEXT,alias TEXT,source_id TEXT,source_revision INTEGER,valid_to INTEGER);
CREATE TABLE sources(character_id TEXT,source_id TEXT,revision INTEGER,adapter TEXT,source_kind TEXT,status TEXT,privacy_label TEXT);
CREATE TABLE suppression(character_id TEXT,target_type TEXT,target_id TEXT);
`;
function fixture() {
  const db = new DatabaseSync(':memory:'), archiveDb = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  archiveDb.exec(`CREATE TABLE owner(id INTEGER PRIMARY KEY,character_id TEXT);CREATE TABLE documents(source_id TEXT,revision INTEGER,adapter TEXT,kind TEXT,body TEXT,metadata TEXT,observed_at INTEGER,occurred_at INTEGER,status TEXT);CREATE TABLE learning_exclusions(source_id TEXT,revision INTEGER);`);
  const cid = 'character:fixture';
  db.prepare('INSERT INTO character_manifest VALUES(1,?,2,5)').run(cid);
  archiveDb.prepare('INSERT INTO owner VALUES(1,?)').run(cid);
  const binding = { profileId: 'fixture', activationEpoch: 3, transition: false };
  const source = (id, { adapter = 'qq-live-archive', kind = 'chat', scope = 'self', platform, peer, diagnostic = false, revision = 1, status = 'available', at = 10 } = {}) => {
    db.prepare('INSERT INTO sources VALUES(?,?,?,?,?,?,?)').run(cid, id, revision, adapter, kind, status, 'private');
    archiveDb.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run(id, revision, adapter, kind, 'RAW_BODY_MUST_NOT_BE_READ', JSON.stringify({ scope, platform, conversationPeerId: peer, diagnostic }), at, at, status);
  };
  const entity = (id, alias, sid) => {
    const [namespace, ...parts] = id.split(':');
    db.prepare('INSERT INTO entities VALUES(?,?,?,?,?)').run(cid, id, namespace, parts.join(':'), namespace === 'character' ? 'self' : 'person');
    if (alias) db.prepare('INSERT INTO entity_aliases VALUES(?,?,?,?,?,NULL)').run(cid, id, alias, sid, 1);
  };
  const memory = (id, { kind = 'episode', scope = 'self', sourceIds = [], people = [], gist = id, at = 20, status = 'active', revision = 1, metadata = {}, characterId = cid } = {}) => {
    db.prepare('INSERT INTO memory_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(characterId, id, kind, revision, status, 'available', 'interpreted', 'event:' + id, at, at, null);
    db.prepare('INSERT INTO memory_versions VALUES(?,?,?,?,?)').run(characterId, id, revision, gist, JSON.stringify({ ...(scope === null ? {} : { scope }), ...metadata }));
    for (const sid of sourceIds) db.prepare('INSERT INTO memory_evidence VALUES(?,?,?,?,?,?)').run(characterId, id, revision, sid, 1, 'supports');
    for (const id2 of people) db.prepare('INSERT INTO memory_entities VALUES(?,?,?,?)').run(characterId, id, id2, 'participant');
  };
  source('qq', { scope: 'private:101', peer: 'qq:101' });
  source('wechat', { adapter: 'wechat', platform: 'wechat', scope: 'wechat:abc', peer: 'wechat:abc' });
  source('web', { kind: 'web-reading', platform: 'web' });
  source('video', { adapter: 'bili', kind: 'video-subtitles', platform: 'bilibili' });
  source('file', { kind: 'document' });
  source('qzone', { kind: 'post', scope: 'private:101' });
  entity(cid); entity('qq:101', '同名', 'qq'); entity('wechat:abc', '同名', 'wechat');
  memory('qq-memory', { scope: 'private:101', sourceIds: ['qq'], people: ['qq:101'], at: 21 });
  memory('wechat-memory', { scope: 'wechat:abc', sourceIds: ['wechat'], people: ['wechat:abc'], at: 22 });
  memory('web-memory', { sourceIds: ['web'], at: 23 });
  memory('video-memory', { sourceIds: ['video'], at: 24 });
  memory('file-memory', { sourceIds: ['file'], at: 25 });
  memory('mixed-memory', { sourceIds: ['qq', 'web'], people: ['qq:101'], at: 26 });
  memory('qq-feeling', { kind: 'experience', sourceIds: ['qq'], people: ['qq:101'], metadata: { reaction: '有点高兴，也仍有保留' }, at: 27 });
  memory('wechat-relation', { kind: 'relationship', scope: 'wechat:abc', sourceIds: ['wechat'], people: [cid, 'wechat:abc'], metadata: { disposition: { kind: 'attitude', target: 'wechat:abc', facet: '信任', reason: '实际来往', transition: 'coexist' } }, at: 28 });
  const selectOnly = raw => ({ prepare(sql) {
    assert.match(sql.trim(), /^SELECT\b/i, 'view must only prepare SELECT');
    assert.doesNotMatch(sql, /\bbody\b|SELECT\s+\*/i, 'view must not select raw source body or all columns');
    const stmt = raw.prepare(sql);
    return { all: (...args) => stmt.all(...args), get: (...args) => stmt.get(...args) };
  } });
  const runtime = { characterId: cid, store: { db: selectOnly(db) }, archive: { db: selectOnly(archiveDb) } };
  const view = createLifeMemoryView({ runtime, profile: { id: 'fixture', name: '示例角色' }, getBinding: () => ({ ...binding }), authorizeConsole: request => request.console === true });
  const read = (filters = {}, override = {}) => view.read({ console: true, headers: {}, context: { profileId: 'fixture', activationEpoch: 3 }, filters, ...override });
  return { db, archiveDb, cid, binding, memory, source, read, close: () => { db.close(); archiveDb.close(); } };
}
const use = fn => { const f = fixture(); try { fn(f); } finally { f.close(); } };

test('full character view includes self, QQ, WeChat, web, video and files with exact paginated totals', () => use(f => {
  const page = f.read({ limit: 2 });
  assert.equal(page.total, 8); assert.equal(page.items.length, 2); assert.equal(page.nextOffset, 2);
  assert.equal(f.read({ offset: 6, limit: 2 }).nextOffset, null);
  for (const source of ['qq', 'wechat', 'web', 'video', 'file']) assert.ok(page.facets.sources.some(x => x.id === source));
  assert.deepEqual(page.facets.scopes.map(x => x.id).sort(), ['private:101', 'self', 'wechat:abc']);
}));
test('source and scope are independent and mixed-source memory appears in both relevant filters', () => use(f => {
  assert.deepEqual(f.read({ source: 'web' }).items.map(x => x.id).sort(), ['mixed-memory', 'web-memory']);
  assert.equal(f.read({ source: 'web', scope: 'private:101' }).total, 0);
  assert.deepEqual(f.read({ source: 'qq', scope: 'self', person: 'qq:101', query: 'mixed' }).items.map(x => x.id), ['mixed-memory']);
}));
test('same alias does not merge independent QQ and WeChat identities', () => use(f => {
  const people = f.read().facets.people;
  assert.equal(people.length, 2); assert.ok(people.every(p => p.aliases[0] === '同名'));
  assert.deepEqual(f.read({ person: 'wechat:abc' }).items.map(x => x.id).sort(), ['wechat-memory', 'wechat-relation']);
  assert.equal(f.read({ person: '同名' }).total, 0);
}));
test('relationship view contains WeChat attitudes and preserves subjective contradictions', () => use(f => {
  const data = f.read({ view: 'relationships' });
  assert.equal(data.total, 1); assert.equal(data.items[0].disposition.target, 'wechat:abc');
  assert.equal(data.items[0].disposition.transition, 'coexist'); assert.equal(data.items[0].subjective, true);
  assert.equal(data.items[0].disposition.interpretation, 'subjective-not-person-fact');
}));
test('experiences keep feelings distinct from factual summaries', () => use(f => {
  const result = f.read({ view: 'experiences' });
  assert.equal(result.total, 1); assert.equal(result.items[0].feeling, '有点高兴，也仍有保留');
  assert.equal(result.items[0].subjective, true);
}));
test('file and QQ-space classify from actual document kind despite qq-live-archive adapter', () => use(f => {
  assert.equal(f.read({ source: 'file' }).total, 1);
  const qzone = f.read({ view: 'sources', source: 'qzone' }); assert.equal(qzone.total, 1); assert.equal(qzone.items[0].kind, 'post');
}));
test('sources include unprocessed resources with no raw body or fabricated read affordance', () => use(f => {
  f.source('unprocessed', { kind: 'web-reading', platform: 'web' });
  const result = f.read({ view: 'sources' });
  assert.equal(result.total, 7); assert.equal(result.items.find(x => x.id === 'unprocessed').linkedMemoryCount, 0);
  assert.ok(result.items.every(x => x.rawContentAvailable === false));
  assert.ok(!JSON.stringify(result).includes('RAW_BODY_MUST_NOT_BE_READ'));
}));
test('source latest version is explicit and does not count old versions as new sources', () => use(f => {
  f.source('web', { kind: 'web-reading', platform: 'web', revision: 2, at: 99 });
  const result = f.read({ view: 'sources', source: 'web' }); assert.equal(result.total, 1); assert.equal(result.items[0].revision, 2);
  assert.equal(result.items[0].linkedMemoryCount, 2);
}));
test('forgotten, suppressed, deleted and diagnostic material cannot be revived by a filter', () => use(f => {
  f.memory('forgotten', { gist: 'SHOULD_NOT_APPEAR', status: 'forgotten' });
  f.memory('suppressed', { gist: 'SHOULD_NOT_APPEAR' });
  f.db.prepare('INSERT INTO suppression VALUES(?,?,?)').run(f.cid, 'memory', 'suppressed');
  f.source('diag', { diagnostic: true }); f.memory('diagnostic', { sourceIds: ['diag'], gist: 'SHOULD_NOT_APPEAR' });
  f.source('deleted', { status: 'deleted' }); f.memory('deleted-memory', { sourceIds: ['deleted'], gist: 'SHOULD_NOT_APPEAR' });
  assert.equal(f.read().total, 8); assert.ok(!JSON.stringify(f.read()).includes('SHOULD_NOT_APPEAR'));
  assert.equal(f.read({ query: 'SHOULD_NOT_APPEAR' }).total, 0);
}));
test('unknown scope remains unknown rather than being attributed to self or selected QQ peer', () => use(f => {
  f.memory('unscoped', { scope: null, sourceIds: ['web'] });
  assert.deepEqual(f.read({ scope: 'unknown' }).items.map(x => x.id), ['unscoped']);
  assert.equal(f.read({ scope: 'unknown' }).items[0].scope, null);
}));
test('other character memory never crosses into current role even in a shared fixture DB', () => use(f => {
  f.memory('other-character', { characterId: 'character:other', gist: 'OTHER_PRIVATE' });
  assert.equal(f.read().total, 8); assert.ok(!JSON.stringify(f.read()).includes('OTHER_PRIVATE'));
}));
test('agent headers, including empty and differently-cased headers, are rejected', () => use(f => {
  for (const headers of [{ 'x-agent-token': '' }, { 'X-Agent-Call': '1' }, { 'X-Agent-Token': 'secret' }])
    assert.throws(() => f.read({}, { headers }), error => error.statusCode === 403);
  assert.throws(() => f.read({}, { console: false }), error => error.statusCode === 403);
}));
test('role context, activation changes and archive ownership are checked before data reads', () => use(f => {
  assert.throws(() => f.read({}, { context: null }), error => error.statusCode === 428);
  assert.throws(() => f.read({}, { context: { profileId: 'other', activationEpoch: 3 } }), error => error.statusCode === 409);
  f.binding.activationEpoch = 4; assert.throws(() => f.read(), error => error.statusCode === 409); f.binding.activationEpoch = 3;
  f.archiveDb.prepare('UPDATE owner SET character_id=?').run('character:other');
  assert.throws(() => f.read(), error => error.code === 'CHARACTER_MISMATCH');
}));
test('query is literal and bounded; malformed pagination/source is rejected', () => use(f => {
  assert.equal(f.read({ query: "' OR 1=1 --" }).total, 0);
  for (const filters of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { source: 'invented' }, { query: 'x'.repeat(201) }])
    assert.throws(() => f.read(filters), error => error.statusCode === 400);
}));
test('view performs zero SQL writes and prepares no raw document-body queries', () => use(f => {
  const before = [f.db.prepare('SELECT total_changes() AS n').get().n, f.archiveDb.prepare('SELECT total_changes() AS n').get().n];
  for (const view of ['memories', 'experiences', 'relationships', 'sources']) f.read({ view });
  const after = [f.db.prepare('SELECT total_changes() AS n').get().n, f.archiveDb.prepare('SELECT total_changes() AS n').get().n];
  assert.deepEqual(after, before);
  assert.ok(Object.values(LIFE_MEMORY_SQL).every(sql => /^SELECT\b/.test(sql.trim())));
}));
