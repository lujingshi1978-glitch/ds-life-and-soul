// A projection of an already authorized host read set. This module neither
// retrieves nor authorizes material, and must never replace that full read set.
// Only the named context arrays below are optional. Every retained unit keeps
// all its scope, qualifications, uncertainty, counterevidence and exact refs.
const GROUPS = [
  ['before.ongoing', 'object'],
  ['before.continuations.items', 'continuation'],
  ['recalled', 'memory'],
  ['before.dispositions', 'disposition'],
  ['before.pendingDispositions', 'disposition'],
  ['before.psychology', 'psychology'],
  ['before.selfUnderstanding.items', 'selfUnderstanding'],
  ['memoryAssociation.contacts', 'associationContact'],
  ['before.agency.opportunities.people', 'opportunityPerson'],
  ['before.agency.opportunities.browse', 'opportunityBrowse'],
  ['before.agency.opportunities.topics', 'opportunityTopic'],
  ['before.agency.opportunities.association.contacts', 'associationContact'],
  ['before.agency.opportunities.continuations.items', 'continuation'],
  ['before.relationship', 'object'],
];
const COVERAGE_KEY = 'reflectionInputCoverage';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const chars = value => JSON.stringify(value).length;
const get = (value, path) => path.split('.').reduce((v, key) => v?.[key], value);
function set(value, path, next) {
  const keys = path.split('.'), key = keys.pop();
  keys.reduce((v, k) => v[k], value)[key] = next;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export class ReflectionInputError extends Error {
  constructor(code, details) { super(code); this.name = 'ReflectionInputError'; this.code = code; this.details = details; }
}
function minimumTooLarge(maxChars, inputChars, minimumChars, optionalUnits) {
  throw new ReflectionInputError('THOUGHT_INPUT_MINIMUM_TOO_LARGE', {maxChars, inputChars, minimumChars, optionalUnits});
}
function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  visit(value);
  for (const item of Object.values(value)) walk(item, visit);
}
function currentLinks(material) {
  const ids = new Set(), people = new Set();
  const visit = value => {
    for (const key of ['id', 'sourceId', 'memoryId', 'eventId', 'objectId']) if (typeof value[key] === 'string') ids.add(value[key]);
    for (const key of ['objectIds', 'memoryIds', 'eventIds']) for (const id of Array.isArray(value[key]) ? value[key] : []) if (typeof id === 'string') ids.add(id);
    for (const key of ['speakerId', 'conversationPeerId', 'personId', 'subjectId']) if (typeof value[key] === 'string') people.add(value[key]);
    for (const id of Array.isArray(value.people) ? value.people : []) if (typeof id === 'string') people.add(id);
  };
  walk(material.newEvents, visit);
  walk(material.before?.psyche, visit);
  walk(material.subjectiveCandidates, visit);
  walk(material.spontaneousRecall, visit);
  return {ids, people};
}
function relevance(value, links) {
  let direct = false, peer = false;
  walk(value, row => {
    for (const key of ['id', 'sourceId', 'memoryId', 'eventId', 'objectId']) if (links.ids.has(row[key])) direct = true;
    for (const key of ['objectIds', 'memoryIds', 'eventIds']) if (Array.isArray(row[key]) && row[key].some(id => links.ids.has(id))) direct = true;
    for (const key of ['personId', 'speakerId', 'conversationPeerId', 'target', 'reportedSubjectId']) if (links.people.has(row[key])) peer = true;
    if (Array.isArray(row.people) && row.people.some(id => links.people.has(id))) peer = true;
  });
  // This is an exact linkage preference, never a keyword/topic merge or an
  // assertion that an association grants permission or establishes a fact.
  return (direct ? 4 : 0) + (peer ? 2 : 0);
}
function referenceRows(rows) {
  const refs = new Map();
  for (const row of Array.isArray(rows) ? rows : []) if (record(row) && typeof row.id === 'string') {
    const ref = {id:row.id, ...(row.revision !== undefined ? {revision:row.revision} : {})};
    refs.set(canonical(ref), ref);
  }
  return [...refs.values()];
}
// Lists only references actually presented in the permitted schema locations.
// An ID mentioned in rejected output, a diagnostic, or a nested reference does
// not become an editable object, recalled memory, or psychology thread.
export function reflectionVisibleReferences(material) {
  const sources = new Map(), people = new Set();
  const addPerson = value => { if (typeof value === 'string' && value) people.add(value); };
  const addPeople = values => { if (Array.isArray(values)) for (const value of values) addPerson(typeof value === 'string' ? value : value?.entity_id ?? value?.entityId); };
  const rows = value => Array.isArray(value) ? value : [];
  // A provenance ancestor mentioned by a memory is not another presented
  // source. Keep this list to the direct current stimulus source bindings.
  for (const row of Array.isArray(material.newEvents) ? material.newEvents : []) {
    const revision = row?.sourceRevision ?? row?.revision;
    if (typeof row?.sourceId === 'string' && Number.isSafeInteger(revision)) {
      const ref = {sourceId:row.sourceId, revision}; sources.set(canonical(ref), ref);
    }
    addPerson(row?.speakerId); addPerson(row?.conversationPeerId); addPeople(row?.people);
  }
  for (const row of rows(material.recalled)) { addPeople(row?.people); addPeople(row?.participants); if (row?.disposition?.kind === 'attitude') addPerson(row.disposition.target); }
  for (const row of rows(material.before?.ongoing)) { addPerson(row?.personId); addPeople(row?.people); }
  for (const path of ['before.agency.opportunities.people','memoryAssociation.contacts','before.agency.opportunities.association.contacts']) for (const row of rows(get(material,path))) addPerson(row?.personId);
  for (const row of [...rows(material.before?.dispositions), ...rows(material.before?.pendingDispositions)]) if (row?.kind === 'attitude') addPerson(row.target);
  return {
    events:referenceRows(material.newEvents), recalled:referenceRows(material.recalled),
    objects:referenceRows(material.before?.ongoing), psychology:referenceRows(material.before?.psychology),
    dispositions:referenceRows(material.before?.dispositions), pendingDispositions:referenceRows(material.before?.pendingDispositions),
    selfUnderstanding:referenceRows(material.before?.selfUnderstanding?.items), sources:[...sources.values()], people:[...people],
  };
}

/**
 * Budget the final, JSON-serialized reflection material, after all factories
 * and repair fields have been added. maxChars is the effective material cap;
 * provider/instruction/output capacity must be accounted for by the caller.
 * Under that cap, the original object is returned without any mutation.
 * On overflow, equal versioned units are deduplicated; all other optional
 * units are admitted whole against the actual remaining serialized budget.
 * Unknown extensions, core, newEvents, current physical/mood/time, repair
 * errors, and every non-array wrapper/guard field remain mandatory.
 */
export function compileReflectionInput(material, {maxChars = 48000} = {}) {
  if (!record(material) || !Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new ReflectionInputError('THOUGHT_INPUT_INVALID', {maxChars:Number.isSafeInteger(maxChars) ? maxChars : 0});
  }
  // The host constructor produces JSON data. Measuring the actual wire form
  // also normalizes undefined fields consistently with CognitiveModel.run.
  const serialized = JSON.stringify(material), originalChars = serialized.length;
  if (originalChars <= maxChars) return {
    material, coverage:{version:1, partial:false, compacted:false, originalChars, inputChars:originalChars, maxChars, groups:[]},
    visibleReferences:reflectionVisibleReferences(material), originalChars, inputChars:originalChars,
  };
  if (Object.hasOwn(material, COVERAGE_KEY)) throw new ReflectionInputError('THOUGHT_INPUT_INVALID', {maxChars});
  const packed = JSON.parse(serialized), groups = [], candidates = [], identities = new Map(), links = currentLinks(packed);
  for (const [path, family] of GROUPS) {
    const values = get(packed, path); if (!Array.isArray(values)) continue;
    const group = {path, family, total:values.length, rows:[]}; groups.push(group);
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      // Same ID and revision alone do not prove equivalent context. Different
      // scopes, evidence, uncertainty or guard fields prevent deduplication.
      const versioned = record(value) && typeof value.id === 'string' && Number.isSafeInteger(value.revision);
      const identity = versioned ? canonical([family, value.id, value.revision, value]) : null;
      let candidate = identity === null ? null : identities.get(identity);
      if (!candidate) {
        candidate = {value, locations:[], score:relevance(value, links), order:candidates.length, pinned:record(value) && value.locked === true};
        candidates.push(candidate); if (identity !== null) identities.set(identity, candidate);
      }
      candidate.locations.push({group, index}); group.rows.push({candidate, index});
    }
    set(packed, path, []);
  }
  // A rejected patch is optional as one complete unit. Its exact error and
  // errorDetails always survive; an omitted patch can be regenerated from the
  // unchanged new evidence, with an explicit marker in the existing schema.
  const rejected = packed.rejected;
  const rejectedMarker = {omitted:true, reason:'reflection-input-budget', fields:record(rejected) ? Object.keys(rejected) : []};
  const hasRejected = Object.hasOwn(packed, 'rejected') && !(record(rejected) && rejected.omitted === true) && chars(rejected) > chars(rejectedMarker);
  let includeRejected = false;
  const included = new Set(candidates.filter(c => c.pinned));
  function render() {
    const counts = [];
    for (const group of groups) {
      const shown = [], rowCounts = {path:group.path, total:group.total, shown:0, duplicates:0, omitted:0};
      for (const {candidate, index} of group.rows) {
        if (!included.has(candidate)) { rowCounts.omitted++; continue; }
        const first = candidate.locations[0];
        if (first.group === group && first.index === index) { shown.push(candidate.value); rowCounts.shown++; }
        else rowCounts.duplicates++;
      }
      set(packed, group.path, shown); counts.push(rowCounts);
    }
    if (hasRejected) {
      packed.rejected = includeRejected ? rejected : rejectedMarker;
      counts.push({path:'rejected', total:1, shown:includeRejected ? 1 : 0, duplicates:0, omitted:includeRejected ? 0 : 1});
    }
    packed[COVERAGE_KEY] = {
      version:1, partial:counts.some(g => g.omitted > 0), compacted:true,
      scope:'this-input-only', omittedDoesNotMeanAbsent:true, groups:counts,
    };
    return chars(packed);
  }
  const minimumChars = render();
  if (minimumChars > maxChars) minimumTooLarge(maxChars, originalChars, minimumChars, candidates.filter(c => !c.pinned).length + Number(hasRejected));
  // First preserve every unique unit if deduplication alone is sufficient.
  for (const candidate of candidates) included.add(candidate);
  includeRejected = hasRejected;
  let inputChars = render();
  if (inputChars > maxChars) {
    included.clear(); for (const candidate of candidates) if (candidate.pinned) included.add(candidate);
    includeRejected = false; render();
    // Exact current links get the first chance. Within each relevance band,
    // round-robin across sections avoids assigning a fixed cap to any section.
    const scores = [...new Set(candidates.map(c => c.score))].sort((a,b) => b-a);
    for (const score of scores) {
      const queues = groups.map(group => candidates.filter(c => !c.pinned && c.score === score && c.locations[0].group === group));
      for (let round = 0; queues.some(queue => round < queue.length); round++) for (const queue of queues) {
        const candidate = queue[round]; if (!candidate) continue;
        included.add(candidate);
        if (render() > maxChars) included.delete(candidate);
      }
    }
    // Rejected prose gets only space left after complete, authorized context.
    if (hasRejected) { includeRejected = true; if (render() > maxChars) includeRejected = false; }
    inputChars = render();
  }
  const coverage = {...packed[COVERAGE_KEY], originalChars, inputChars, maxChars};
  return {material:packed, coverage, visibleReferences:reflectionVisibleReferences(packed), originalChars, inputChars};
}

/** Check existing reflection patch references against this invocation's view.
 * This complements, and never replaces, host provenance/version/ACL checks.
 * Call with the schema-normalized patch before applying any effects.
 */
export function assertReflectionOutputReferences(patch, compiled) {
  const refs = compiled.visibleReferences ?? compiled;
  const material = compiled.material;
  function versions(rows) {
    const out = new Map();
    for (const row of rows) { if (!out.has(row.id)) out.set(row.id, new Set()); out.get(row.id).add(row.revision); }
    return out;
  }
  const maps = Object.fromEntries(['events','recalled','objects','psychology','selfUnderstanding'].map(kind => [kind, versions(refs[kind] || [])]));
  maps.dispositions = versions([...(refs.dispositions || []), ...(refs.pendingDispositions || [])]);
  const memories = versions([...(refs.recalled || []), ...(refs.dispositions || []), ...(refs.pendingDispositions || [])]);
  const people = new Map((refs.people || []).map(id => [id, new Set()]));
  const reject = (path, kind) => { throw new ReflectionInputError('THOUGHT_INPUT_REFERENCE_NOT_VISIBLE', {path, referenceKind:kind}); };
  function check(id, allowed, path, kind, revision) {
    if (typeof id !== 'string' || !allowed.has(id) || revision !== undefined && !allowed.get(id).has(revision)) reject(path, kind);
  }
  function list(value, allowed, path, kind) {
    // Malformed containers remain the native schema validator's responsibility.
    if (Array.isArray(value)) value.forEach((id,index) => check(id, allowed, path+'['+index+']', kind));
  }
  function common(op, path, allowedMemories = memories) {
    if (!record(op)) return;
    if (op.objectId !== undefined) check(op.objectId, maps.objects, path+'.objectId', 'object');
    list(op.objectIds, maps.objects, path+'.objectIds', 'object');
    list(op.memoryIds, allowedMemories, path+'.memoryIds', 'memory');
    list(op.eventIds, maps.events, path+'.eventIds', 'event');
  }
  for (const [index, op] of (Array.isArray(patch?.changes) ? patch.changes : []).entries()) {
    const path = 'changes['+index+']'; common(op, path);
    if (record(op) && op.id !== undefined) check(op.id, maps.objects, path+'.id', 'object', op.expectedRevision);
    if (record(op)) { if (op.personId !== undefined) check(op.personId, people, path+'.personId', 'person'); list(op.people, people, path+'.people', 'person'); }
    if (record(op?.continuation?.confirmation)) {
      const confirmation = op.continuation.confirmation;
      const old = (material?.before?.ongoing || []).find(row => row?.id === op.id)?.continuation;
      const inherited = record(old?.confirmation) && old.externalState === (op.continuation.externalState ?? old.externalState) && canonical(confirmation) === canonical(old.confirmation);
      if (!inherited) {
        check(confirmation.eventId, maps.events, path+'.continuation.confirmation.eventId', 'event');
        const events = Array.isArray(material?.newEvents) ? material.newEvents : [];
        if (typeof confirmation.quote !== 'string' || !confirmation.quote.trim() || !events.some(event => event?.id === confirmation.eventId && typeof event.text === 'string' && event.text.includes(confirmation.quote))) reject(path+'.continuation.confirmation.quote', 'visible-event-quote');
      }
    }
  }
  for (const name of ['attention','emotionalTensions']) for (const [index, op] of (Array.isArray(patch?.psyche?.[name]) ? patch.psyche[name] : []).entries()) common(op, 'psyche.'+name+'['+index+']');
  for (const name of ['add','update','merge','resolve','release']) for (const [index, op] of (Array.isArray(patch?.psychology?.[name]) ? patch.psychology[name] : []).entries()) {
    if (!record(op)) continue;
    const path = 'psychology.'+name+'['+index+']'; common(op, path, maps.recalled);
    if (name !== 'merge' && (name !== 'add' || op.id !== undefined)) check(op.id, maps.psychology, path+'.id', 'psychology', op.expectedRevision);
    if (name === 'merge') {
      list(op.ids, maps.psychology, path+'.ids', 'psychology');
      if (Array.isArray(op.expectedRevisions)) op.expectedRevisions.forEach((ref,index) => check(ref?.id, maps.psychology, path+'.expectedRevisions['+index+']', 'psychology', ref?.revision));
    }
  }
  for (const [index, op] of (Array.isArray(patch?.dispositions) ? patch.dispositions : []).entries()) {
    const path = 'dispositions['+index+']'; common(op, path);
    if (record(op) && op.previousId !== undefined && op.previousId !== null) check(op.previousId, maps.dispositions, path+'.previousId', 'disposition', op.expectedRevision);
    if (op?.kind === 'attitude') check(op.target, people, path+'.target', 'person');
  }
  for (const [index, op] of (Array.isArray(patch?.selfUnderstanding) ? patch.selfUnderstanding : []).entries()) {
    if (!record(op)) continue;
    const path = 'selfUnderstanding['+index+']'; common(op, path);
    list(op.supportIds, memories, path+'.supportIds', 'memory');
    list(op.counterIds, memories, path+'.counterIds', 'memory');
    if (op.previousId !== undefined && op.previousId !== null) check(op.previousId, maps.selfUnderstanding, path+'.previousId', 'selfUnderstanding', op.expectedRevision);
  }
  common(patch?.decision, 'decision', maps.recalled);
  if (patch?.decision?.personId !== undefined) check(patch.decision.personId, people, 'decision.personId', 'person');
  return true;
}
