const disabled = () => ({ status: 'disabled', enabled: false });
function unavailable() {
  const error = new Error('Knowledge is disabled because character cognition is disabled');
  error.code = 'KNOWLEDGE_DISABLED';
  throw error;
}

// Implements the knowledge interface without constructing a store, model, or timer.
export class DisabledKnowledge {
  get running() { return null; }
  entries() { return []; }
  list(_options = {}) { return { ...disabled(), entries: [], total: 0, nextOffset: null }; }
  read(_scope, _id) { return null; }
  match(_scope, _cues, _options = {}) { return []; }
  pack(_entries, _budget = 2200) { return { ...disabled(), entries: [], chars: 0 }; }
  stats() { return { ...disabled(), implementation: 'cognition-disabled', entries: [], jobs: [], fts: false, vectors: false }; }
  migrate(_entries) { return { ...disabled(), imported: 0 }; }
  context(_scope, _cues, _budget) { return ''; }
  async recall(_scope, _body = {}) { return { ...disabled(), source: 'knowledge-disabled', entries: [], items: [] }; }
  enqueue(_scope, _input, _options = {}) { return unavailable(); }
  job(_scope, id) { return { ...disabled(), id, result: null, error: 'KNOWLEDGE_DISABLED' }; }
  jobs() { return []; }
  reject(_id) { return unavailable(); }
  confirmUse(_input, _evidence) { return unavailable(); }
  maintain() { return disabled(); }
  async work(_options = {}) { return disabled(); }
  scheduleConsolidation(_scope) { return disabled(); }
  close() {}
  async process(_job, _signal) { return unavailable(); }
}
