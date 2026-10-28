-- Runtime V2 schema. Applied only inside a marked, isolated V2 character directory.
-- One cognitive database per character. No live database is modified by this file.
-- Semantic validation, authorization, CAS updates, tombstone propagation and
-- atomic event ingestion must be implemented by CharacterCognition.
PRAGMA foreign_keys = ON;

CREATE TABLE character_manifest (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  character_id TEXT NOT NULL UNIQUE,
  role_epoch INTEGER NOT NULL CHECK (role_epoch > 0),
  cognition_revision INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 2
);

-- Registry of immutable source versions. The bytes remain in the archive.
-- A content edit must append a new revision, never update the old locator/hash.
CREATE TABLE sources (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  source_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  checksum TEXT NOT NULL,
  locator_json TEXT NOT NULL CHECK (json_valid(locator_json)),
  observed_at INTEGER NOT NULL,
  occurred_at INTEGER,
  privacy_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','disputed','deleted')),
  PRIMARY KEY (character_id, source_id, revision),
  UNIQUE (character_id, adapter, source_kind, external_id, revision)
);

CREATE TABLE cognitive_events (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  event_id TEXT NOT NULL,
  event_root TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  role_epoch INTEGER NOT NULL,
  kind TEXT NOT NULL,
  occurred_at INTEGER,
  recorded_at INTEGER NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('observed','requested','started','completed','failed','cancelled')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (character_id, event_id),
  UNIQUE (character_id, idempotency_key)
);
CREATE INDEX event_roots ON cognitive_events(character_id, event_root);

CREATE TABLE event_sources (
  character_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  PRIMARY KEY (character_id, event_id, source_id, source_revision),
  FOREIGN KEY (character_id,event_id) REFERENCES cognitive_events(character_id,event_id),
  FOREIGN KEY (character_id,source_id,source_revision)
    REFERENCES sources(character_id,source_id,revision)
);

CREATE TABLE entities (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  entity_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (character_id, entity_id),
  UNIQUE (character_id, namespace, external_id)
);

-- Alias equality does not establish identity. Cross-platform bindings are
-- separately verified; the application must not merge entities by alias alone.
CREATE TABLE entity_aliases (
  character_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  valid_from INTEGER,
  valid_to INTEGER,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  PRIMARY KEY (character_id,entity_id,alias,source_id,source_revision),
  FOREIGN KEY (character_id,entity_id) REFERENCES entities(character_id,entity_id),
  FOREIGN KEY (character_id,source_id,source_revision)
    REFERENCES sources(character_id,source_id,revision)
);

CREATE TABLE memory_nodes (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  memory_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('episode','assertion','experience','relationship','knowledge','procedure','self_model','topic','pattern')),
  current_revision INTEGER NOT NULL CHECK (current_revision > 0),
  detail_state TEXT NOT NULL CHECK (detail_state IN ('available','gist_only','none')),
  epistemic TEXT NOT NULL CHECK (epistemic IN ('observed','reported','interpreted','hypothetical')),
  status TEXT NOT NULL CHECK (status IN
    ('candidate','active','contested','outdated','faded','forgotten','superseded')),
  event_root TEXT,
  occurred_at INTEGER,
  recorded_at INTEGER NOT NULL,
  valid_from INTEGER,
  valid_to INTEGER,
  invalidated_at INTEGER,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  salience REAL NOT NULL CHECK (salience BETWEEN 0 AND 1),
  base_strength REAL NOT NULL CHECK (base_strength BETWEEN 0 AND 1),
  half_life_days REAL NOT NULL CHECK (half_life_days > 0),
  last_reinforced_at INTEGER,
  PRIMARY KEY (character_id,memory_id),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX memory_time ON memory_nodes(character_id,kind,occurred_at);
CREATE INDEX memory_status ON memory_nodes(character_id,status,kind);

-- Content revisions preserve interpretation history. A forget/redaction must
-- remove prohibited content from all revisions and exported/audit projections.
CREATE TABLE memory_versions (
  character_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  gist TEXT NOT NULL,
  detail TEXT,
  content_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,memory_id,revision),
  FOREIGN KEY (character_id,memory_id) REFERENCES memory_nodes(character_id,memory_id)
);

CREATE TABLE memory_evidence (
  character_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  memory_revision INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  evidence_key TEXT NOT NULL,
  span_json TEXT NOT NULL CHECK (json_valid(span_json)),
  independence_group TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('supports','contradicts','context')),
  PRIMARY KEY (character_id,memory_id,memory_revision,evidence_key),
  FOREIGN KEY (character_id,memory_id,memory_revision)
    REFERENCES memory_versions(character_id,memory_id,revision),
  FOREIGN KEY (character_id,source_id,source_revision)
    REFERENCES sources(character_id,source_id,revision)
);

CREATE TABLE memory_entities (
  character_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('speaker','subject','target','participant','author','forwarder')),
  PRIMARY KEY (character_id,memory_id,entity_id,role),
  FOREIGN KEY (character_id,memory_id) REFERENCES memory_nodes(character_id,memory_id),
  FOREIGN KEY (character_id,entity_id) REFERENCES entities(character_id,entity_id)
);
CREATE INDEX entity_memories ON memory_entities(character_id,entity_id,role,memory_id);

CREATE TABLE assertions (
  character_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  speaker_id TEXT,
  subject_id TEXT,
  target_id TEXT,
  predicate TEXT NOT NULL,
  object_json TEXT NOT NULL CHECK (json_valid(object_json)),
  speech_act TEXT NOT NULL CHECK (speech_act IN
    ('statement','question','joke','proposal','promise','correction')),
  commitment_status TEXT CHECK (commitment_status IN
    ('proposal','promised','fulfilled','cancelled','disputed')),
  due_at INTEGER,
  PRIMARY KEY (character_id,memory_id),
  FOREIGN KEY (character_id,memory_id) REFERENCES memory_nodes(character_id,memory_id),
  FOREIGN KEY (character_id,speaker_id) REFERENCES entities(character_id,entity_id),
  FOREIGN KEY (character_id,subject_id) REFERENCES entities(character_id,entity_id),
  FOREIGN KEY (character_id,target_id) REFERENCES entities(character_id,entity_id)
);

CREATE TABLE memory_edges (
  character_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN
    ('semantic','before','same_entity','responds_to','causes','supports','contradicts','supersedes','abstracts')),
  provenance TEXT NOT NULL CHECK (provenance IN ('deterministic','explicit_evidence','model_inference')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (character_id,from_id,to_id,relation),
  FOREIGN KEY (character_id,from_id) REFERENCES memory_nodes(character_id,memory_id),
  FOREIGN KEY (character_id,to_id) REFERENCES memory_nodes(character_id,memory_id),
  CHECK (from_id <> to_id)
);
CREATE INDEX edges_reverse ON memory_edges(character_id,to_id,relation);

-- A topic/episode can group many memories with distinct roles, without
-- requiring a separate graph service or losing the original participants.
CREATE TABLE memory_members (
  character_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_role TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight BETWEEN 0 AND 1),
  PRIMARY KEY (character_id,container_id,member_id,member_role),
  FOREIGN KEY (character_id,container_id) REFERENCES memory_nodes(character_id,memory_id),
  FOREIGN KEY (character_id,member_id) REFERENCES memory_nodes(character_id,memory_id),
  CHECK (container_id <> member_id)
);

CREATE TABLE suppression (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  target_type TEXT NOT NULL CHECK (target_type IN ('source','memory','event_root')),
  target_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,target_type,target_id)
);

-- More detailed DAG validation and dependency propagation are service duties.
CREATE TABLE dependencies (
  character_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  child_revision INTEGER NOT NULL,
  parent_id TEXT NOT NULL,
  parent_revision INTEGER NOT NULL,
  PRIMARY KEY (character_id,child_id,child_revision,parent_id,parent_revision),
  FOREIGN KEY (character_id,child_id,child_revision)
    REFERENCES memory_versions(character_id,memory_id,revision),
  FOREIGN KEY (character_id,parent_id,parent_revision)
    REFERENCES memory_versions(character_id,memory_id,revision),
  CHECK (child_id <> parent_id)
);

CREATE TABLE projections (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  based_on_cognition_revision INTEGER NOT NULL,
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  dependency_ids_json TEXT NOT NULL CHECK (json_valid(dependency_ids_json)),
  PRIMARY KEY (character_id,kind,target_key)
);

CREATE TABLE jobs (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic_id TEXT,
  input_fingerprint TEXT NOT NULL,
  role_epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed','cancelled')),
  lease_owner TEXT,
  lease_until INTEGER,
  retry_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (character_id,job_id),
  UNIQUE (character_id,kind,input_fingerprint)
);

-- Persistent change events invalidate caches and feed projection/index workers.
CREATE TABLE change_outbox (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  cognition_revision INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  affected_ids_json TEXT NOT NULL CHECK (json_valid(affected_ids_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,cognition_revision,sequence)
);

CREATE TABLE consumer_watermarks (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  consumer TEXT NOT NULL,
  watermark_json TEXT NOT NULL CHECK (json_valid(watermark_json)),
  PRIMARY KEY (character_id,consumer)
);

CREATE TABLE maintenance_reports (
  character_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK (json_valid(report_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,job_id),
  FOREIGN KEY (character_id,job_id) REFERENCES jobs(character_id,job_id)
);

-- Derived FTS content must be pre-tokenized with the same CJK term builder.
-- Recall always joins back to live nodes and reapplies suppression and revision.
CREATE VIRTUAL TABLE recall_fts USING fts5(
  character_id UNINDEXED, memory_id UNINDEXED, revision UNINDEXED, terms
);

-- Embedding indexes are optional, asynchronous and rebuildable. This registry
-- makes provider/model changes observable rather than silently mixing vectors.
CREATE TABLE embedding_registry (
  character_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  memory_revision INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0),
  preprocessing_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  index_locator TEXT NOT NULL,
  PRIMARY KEY (character_id,memory_id,memory_revision,model_id,preprocessing_version),
  FOREIGN KEY (character_id,memory_id,memory_revision)
    REFERENCES memory_versions(character_id,memory_id,revision)
);

-- This file intentionally omits credentials, tools, account permissions and
-- transport mailboxes: they remain controlled by the harness/bridge.
