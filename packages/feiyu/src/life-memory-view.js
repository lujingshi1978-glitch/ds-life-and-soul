// Read-only management view. No constructors, imports, SQL writes, or model calls.
// Host must retain console-token/Host/Origin checks and supply authorizeConsole.
export const LIFE_MEMORY_SQL = Object.freeze({
  manifest: 'SELECT character_id,role_epoch,cognition_revision FROM character_manifest WHERE singleton=1',
  owner: 'SELECT character_id FROM owner WHERE id=1',
  memories: `SELECT n.memory_id,n.kind,n.current_revision,n.status,n.detail_state,n.epistemic,n.event_root,
    n.occurred_at,n.recorded_at,n.invalidated_at,v.gist,v.metadata_json
    FROM memory_nodes n JOIN memory_versions v ON v.character_id=n.character_id
    AND v.memory_id=n.memory_id AND v.revision=n.current_revision WHERE n.character_id=?
    AND n.status<>'forgotten'
    AND NOT EXISTS(SELECT 1 FROM suppression p WHERE p.character_id=n.character_id
      AND ((p.target_type='memory' AND p.target_id=n.memory_id)
        OR (p.target_type='event_root' AND p.target_id=n.event_root)))
    ORDER BY coalesce(n.occurred_at,n.recorded_at) DESC,n.memory_id DESC`,
  evidence: `SELECT e.memory_id,e.memory_revision,e.source_id,e.source_revision,e.role
    FROM memory_evidence e JOIN memory_nodes n ON n.character_id=e.character_id
    AND n.memory_id=e.memory_id AND n.current_revision=e.memory_revision WHERE e.character_id=?`,
  participants: 'SELECT memory_id,entity_id,role FROM memory_entities WHERE character_id=?',
  entities: 'SELECT entity_id,namespace,external_id,kind FROM entities WHERE character_id=?',
  aliases: `SELECT a.entity_id,a.alias,a.source_id,a.source_revision FROM entity_aliases a
    JOIN sources s ON s.character_id=a.character_id AND s.source_id=a.source_id
    AND s.revision=a.source_revision WHERE a.character_id=? AND a.valid_to IS NULL AND s.status<>'deleted'`,
  registry: 'SELECT source_id,revision,adapter,source_kind,status,privacy_label FROM sources WHERE character_id=?',
  suppression: "SELECT target_id FROM suppression WHERE character_id=? AND target_type='source'",
  documents: `SELECT source_id,revision,adapter,kind,observed_at,occurred_at,status,
    json_extract(metadata,'$.scope') AS scope,json_extract(metadata,'$.platform') AS platform,
    json_extract(metadata,'$.speakerId') AS speaker_id,
    json_extract(metadata,'$.conversationPeerId') AS peer_id,
    json_extract(metadata,'$.diagnostic') AS diagnostic,
    json_extract(metadata,'$.learningExcluded') AS learning_excluded FROM documents`,
  exclusions: 'SELECT source_id,revision FROM learning_exclusions'
});

export function createLifeMemoryView({ runtime, profile, getBinding, authorizeConsole }) {
  if (!runtime?.store?.db || !runtime?.archive?.db || !profile?.id ||
      typeof getBinding !== 'function' || typeof authorizeConsole !== 'function') throw Error('MEMORY_VIEW_HOST_REQUIRED');
  const db = runtime.store.db, archiveDb = runtime.archive.db;
  const fail = (code, statusCode = 400) => { throw Object.assign(Error(code), { code, statusCode }); };
  const parse = value => { try { const x = JSON.parse(value); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; } };
  const string = value => typeof value === 'string' && value.trim() ? value : null;
  const refKey = (id, revision) => id + '@' + revision;
  const families = { desktop: '桌面与语音', qq: 'QQ', wechat: '微信', web: '网页与公开平台', video: '视频资料', file: '文件与附件', qzone: 'QQ空间', learning: '学习资料', other: '其他来源' };
  const sourceFamily = source => {
    if(source.platform==='desktop'||String(source.scope||'').startsWith('pet:'))return 'desktop';
    const platform = String(source.platform || '').toLowerCase(), kind = String(source.kind || '').toLowerCase(), adapter = String(source.adapter || '').toLowerCase();
    if (/file|attachment|pdf|docx|document-read/.test(kind) || kind === 'document' || /^(file|local-file)/.test(adapter)) return 'file';
    if (platform === 'qzone' || /qzone|contact-post|qq-post/.test(kind) || adapter === 'qq-live-archive' && kind === 'post') return 'qzone';
    if (/wechat/.test(platform + ' ' + adapter) || String(source.scope || '').startsWith('wechat:')) return 'wechat';
    if (/video|subtitle|sampled-frame|asr/.test(kind) || ['bilibili', 'youtube', 'douyin', 'bili'].includes(platform) || adapter === 'bili') return 'video';
    if (/learn|knowledge-material/.test(kind)) return 'learning';
    if (/web|browser|internet|social-read/.test(kind) || platform && !['qq', 'qzone'].includes(platform)) return 'web';
    if (adapter === 'qq' || platform === 'qq' || /^(private|group):/.test(source.scope || '') && /chat|message|qq/.test(kind + ' ' + adapter)) return 'qq';
    return 'other';
  };
  const authorize = request => {
    const headers = Object.fromEntries(Object.entries(request?.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (Object.hasOwn(headers, 'x-agent-token') || Object.hasOwn(headers, 'x-agent-call')) fail('CONSOLE_ADMIN_ONLY', 403);
    if (authorizeConsole(request) !== true) fail('CONSOLE_ADMIN_ONLY', 403);
    const binding = getBinding();
    let context = request?.context;
    if (!context && typeof headers['x-role-context'] === 'string') {
      try { context = JSON.parse(decodeURIComponent(headers['x-role-context'])); } catch {}
    }
    if (!context) fail('ROLE_READ_CONTEXT_REQUIRED', 428);
    if (!binding || binding.transition || context.profileId !== profile.id || binding.profileId !== profile.id ||
        context.activationEpoch !== binding.activationEpoch || !Number.isSafeInteger(binding.activationEpoch)) fail('ROLE_READ_CONFLICT', 409);
    const manifest = db.prepare(LIFE_MEMORY_SQL.manifest).get();
    const owner = archiveDb.prepare(LIFE_MEMORY_SQL.owner).get();
    if (manifest?.character_id !== runtime.characterId || owner?.character_id !== runtime.characterId) fail('CHARACTER_MISMATCH', 409);
    return { profileId: profile.id, activationEpoch: binding.activationEpoch, characterId: manifest.character_id,
      roleEpoch: manifest.role_epoch, cognitionRevision: manifest.cognition_revision };
  };
  const normalize = input => {
    const f = input || {}, view = f.view || 'memories';
    if (!['memories', 'experiences', 'relationships', 'sources'].includes(view)) fail('MEMORY_VIEW_INVALID');
    const checked = (value, max = 200) => {
      if (value == null || value === '' || value === 'all') return 'all';
      if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('MEMORY_FILTER_INVALID');
      return value;
    };
    const source = checked(f.source, 30);
    if (source !== 'all' && !Object.hasOwn(families, source)) fail('MEMORY_SOURCE_INVALID');
    const offset = f.offset == null ? 0 : Number(f.offset), limit = f.limit == null ? 20 : Number(f.limit);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('MEMORY_PAGE_INVALID');
    const query = f.query == null ? '' : f.query;
    if (typeof query !== 'string' || query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) fail('MEMORY_FILTER_INVALID');
    return { view, source, scope: checked(f.scope), person: checked(f.person), kind: checked(f.kind, 40), query: query.trim(), offset, limit };
  };
  function read(request = {}) {
    const binding = authorize(request), filters = normalize(request.filters), characterId = binding.characterId;
    const registry = new Map(db.prepare(LIFE_MEMORY_SQL.registry).all(characterId).map(row => [refKey(row.source_id, row.revision), row]));
    const suppressed = new Set(db.prepare(LIFE_MEMORY_SQL.suppression).all(characterId).map(row => row.target_id));
    const exclusions = new Set(archiveDb.prepare(LIFE_MEMORY_SQL.exclusions).all().map(row => refKey(row.source_id, row.revision)));
    const sources = new Map();
    for (const row of archiveDb.prepare(LIFE_MEMORY_SQL.documents).all()) {
      const key = refKey(row.source_id, row.revision), registered = registry.get(key);
      const blocked = row.status === 'deleted' || registered?.status === 'deleted' || suppressed.has(row.source_id) ||
        row.diagnostic === 1 || row.learning_excluded === 1 || exclusions.has(key);
      const source = { sourceId: row.source_id, revision: row.revision, adapter: row.adapter, kind: row.kind,
        platform: string(row.platform), scope: string(row.scope), status: row.status,
        at: row.occurred_at ?? row.observed_at, observedAt: row.observed_at,
        speakerId: string(row.speaker_id), peerId: string(row.peer_id), blocked };
      source.family = sourceFamily(source); sources.set(key, source);
    }
    const entities = db.prepare(LIFE_MEMORY_SQL.entities).all(characterId);
    const aliases = new Map();
    for (const row of db.prepare(LIFE_MEMORY_SQL.aliases).all(characterId)) {
      if (suppressed.has(row.source_id) || sources.get(refKey(row.source_id, row.source_revision))?.blocked) continue;
      if (!aliases.has(row.entity_id)) aliases.set(row.entity_id, new Set());
      aliases.get(row.entity_id).add(row.alias);
    }
    const peopleByMemory = new Map(), evidenceByMemory = new Map();
    for (const row of db.prepare(LIFE_MEMORY_SQL.participants).all(characterId)) {
      if (!peopleByMemory.has(row.memory_id)) peopleByMemory.set(row.memory_id, []);
      peopleByMemory.get(row.memory_id).push({ id: row.entity_id, role: row.role });
    }
    for (const row of db.prepare(LIFE_MEMORY_SQL.evidence).all(characterId)) {
      if (!evidenceByMemory.has(row.memory_id)) evidenceByMemory.set(row.memory_id, []);
      evidenceByMemory.get(row.memory_id).push({ sourceId: row.source_id, revision: row.source_revision,
        evidenceRole: row.role, source: sources.get(refKey(row.source_id, row.source_revision)) || null });
    }
    const memories = [];
    for (const row of db.prepare(LIFE_MEMORY_SQL.memories).all(characterId)) {
      const meta = parse(row.metadata_json), evidence = evidenceByMemory.get(row.memory_id) || [];
      // Suppression and diagnostic boundaries are never reversed by a management filter.
      if (meta.diagnostic || meta.learningExcluded || evidence.some(e => suppressed.has(e.sourceId) || e.source?.blocked)) continue;
      const disposition = meta.disposition && typeof meta.disposition === 'object' ? meta.disposition : null;
      const memory = { id: row.memory_id, revision: row.current_revision, kind: row.kind, status: row.status,
        detailState: row.detail_state, epistemic: row.epistemic, gist: row.gist,
        at: row.occurred_at ?? row.recorded_at, recordedAt: row.recorded_at,
        scope: string(meta.scope), invalidated: row.invalidated_at != null,
        subjective: ['experience', 'relationship'].includes(row.kind) || disposition !== null,
        disposition: disposition ? { kind: disposition.kind, target: disposition.target, facet: disposition.facet,
          reason: disposition.reason, preference: disposition.preference || null, transition: disposition.transition,
          previousId: disposition.previousId || null, interpretation: 'subjective-not-person-fact' } : null,
        people: peopleByMemory.get(row.memory_id) || [], evidenceCount: evidence.length,
        sources: evidence.map(e => ({ sourceId: e.sourceId, revision: e.revision, evidenceRole: e.evidenceRole,
          adapter: e.source?.adapter || registry.get(refKey(e.sourceId, e.revision))?.adapter || null,
          kind: e.source?.kind || registry.get(refKey(e.sourceId, e.revision))?.source_kind || null,
          family: e.source?.family || 'other', platform: e.source?.platform || null,
          scope: e.source?.scope || null, status: e.source?.status || 'unavailable' })) };
      if (row.kind === 'experience') { memory.subject = row.gist; memory.feeling = string(meta.reaction) || row.gist; }
      memories.push(memory);
    }
    const viewMemories = memories.filter(m => filters.view === 'experiences' ? m.kind === 'experience'
      : filters.view === 'relationships' ? m.kind === 'relationship' || m.disposition?.kind === 'attitude' : true);
    let base;
    if (filters.view === 'sources') {
      // Build each source's associations once. A memory can cite more than one
      // version of the same source; linkedMemoryCount still counts it only once.
      // This preserves the former filter semantics without a sources × memories scan.
      const associations = new Map();
      for (const memory of memories) {
        for (const sourceId of new Set(memory.sources.map(source => source.sourceId))) {
          if (!associations.has(sourceId)) associations.set(sourceId, { count: 0, people: new Set() });
          const linked = associations.get(sourceId); linked.count++;
          for (const person of memory.people) linked.people.add(person.id);
        }
      }
      // One latest version per actual source, including unprocessed resources.
      const latest = new Map();
      for (const source of sources.values()) if (!latest.has(source.sourceId) || latest.get(source.sourceId).revision < source.revision) latest.set(source.sourceId, source);
      base = [...latest.values()].filter(source => !source.blocked).map(source => {
        const linked = associations.get(source.sourceId);
        const ids = new Set([source.speakerId, source.peerId, ...(linked?.people || [])].filter(Boolean));
        return { id: source.sourceId, sourceId: source.sourceId, revision: source.revision, kind: source.kind,
          adapter: source.adapter, family: source.family, platform: source.platform, scope: source.scope,
          status: source.status, at: source.at, observedAt: source.observedAt, linkedMemoryCount: linked?.count || 0,
          people: [...ids].map(id => ({ id, role: 'source-associated' })), rawContentAvailable: false };
      }).sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || b.id.localeCompare(a.id));
    } else base = viewMemories;
    const scopeCounts = new Map(), sourceCounts = new Map(), personCounts = new Map(), kindCounts = new Map();
    for (const item of base) {
      kindCounts.set(item.kind, (kindCounts.get(item.kind) || 0) + 1);
      const scope = item.scope || 'unknown'; scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + 1);
      const familiesInItem = new Set(item.family ? [item.family] : item.sources.map(source => source.family));
      for (const family of familiesInItem) sourceCounts.set(family, (sourceCounts.get(family) || 0) + 1);
      for (const id of new Set(item.people.map(p => p.id))) personCounts.set(id, (personCounts.get(id) || 0) + 1);
    }
    const people = entities.filter(entity => entity.kind !== 'self' && personCounts.has(entity.entity_id)).map(entity => ({
      id: entity.entity_id, namespace: entity.namespace, externalId: entity.external_id,
      aliases: [...(aliases.get(entity.entity_id) || [])], count: personCounts.get(entity.entity_id) }));
    const knownPeople = new Set(people.map(p => p.id));
    for (const [id, n] of personCounts) if (!knownPeople.has(id) && id !== characterId) people.push({ id, namespace: id.split(':')[0], externalId: null, aliases: [], count: n });
    const query = filters.query.toLocaleLowerCase('en-US');
    const filtered = base.filter(item => (filters.scope === 'all' || (filters.scope === 'unknown' ? !item.scope : item.scope === filters.scope))
      && (filters.person === 'all' || item.people.some(p => p.id === filters.person) || item.disposition?.target === filters.person)
      && (filters.source === 'all' || item.family === filters.source || item.sources?.some(source => source.family === filters.source))
      && (filters.kind === 'all' || item.kind === filters.kind)
      && (!query || [item.gist, item.feeling, item.disposition?.reason, item.disposition?.target,
        item.kind, item.adapter, item.platform, item.scope].filter(Boolean).join(' ').toLocaleLowerCase('en-US').includes(query)));
    const after = authorize(request);
    if (JSON.stringify(after) !== JSON.stringify(binding)) fail('MEMORY_VIEW_CHANGED', 409);
    const total = filtered.length, next = filters.offset + filters.limit;
    return { ok: true, view: filters.view, profile: { id: profile.id, name: profile.name }, binding, filters,
      items: filtered.slice(filters.offset, next), total, offset: filters.offset, nextOffset: next < total ? next : null,
      facets: { sources: [...sourceCounts].map(([id, n]) => ({ id, label: families[id] || id, count: n })),
        scopes: [...scopeCounts].map(([id, n]) => ({ id, label: id === 'self' ? '自己' : id === 'unknown' ? '归属未记录' : id, count: n })),
        people, kinds: [...kindCounts].map(([id, n]) => ({ id, count: n })),
        basis: 'unfiltered-current-view', countsMean: 'distinct-visible-items-not-page-length' },
      readOnly: true, sourceContentIncluded: false };
  }
  return Object.freeze({ read, assertContext: authorize });
}
