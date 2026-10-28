-- DESIGN DRAFT ONLY. NOT A MIGRATION, NOT LOADED BY RUNTIME, NOT DEPLOYED.
-- Apply only to a disposable copy AFTER the complete V2 cognition schema.
-- Keep archive-v2.sqlite, sources, memory_nodes/versions and V2 tables intact.
-- No PRAGMA user_version change: the production reader currently requires V2.
-- One database per role; every composite FK also enforces character ownership.
-- Time values use the existing V2 convention: Unix milliseconds, UTC.
PRAGMA foreign_keys = ON;

-- A commit is a proposed application's atomic unit, never an LLM conversation.
-- The service must CAS both manifest revision and mind generation, write this
-- row and the V2 change_outbox in the SAME transaction; no model/network I/O
-- inside that transaction. A conflict invalidates the proposal, not the user.
CREATE TABLE v3_inner_commits (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  commit_id TEXT NOT NULL,
  role_epoch INTEGER NOT NULL CHECK (role_epoch > 0),
  base_cognition_revision INTEGER NOT NULL CHECK (base_cognition_revision >= 0),
  result_cognition_revision INTEGER NOT NULL,
  expected_mind_generation INTEGER NOT NULL CHECK (expected_mind_generation >= 0),
  operation TEXT NOT NULL CHECK (operation IN
    ('bootstrap','experience','reflection','dream','review','rollback','redaction')),
  idempotency_key TEXT NOT NULL,
  compensates_commit_id TEXT,
  decision_summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,commit_id),
  UNIQUE (character_id,idempotency_key),
  FOREIGN KEY (character_id,compensates_commit_id)
    REFERENCES v3_inner_commits(character_id,commit_id),
  CHECK (result_cognition_revision = base_cognition_revision + 1),
  CHECK ((operation = 'rollback' AND compensates_commit_id IS NOT NULL)
    OR (operation <> 'rollback' AND compensates_commit_id IS NULL))
);

-- Generic version identity; typed tables below supply queryable semantics.
-- IDs cannot be nickname-derived. current_revision is an optimistic-CAS head.
CREATE TABLE v3_inner_objects (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  object_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('inner_state','anchor','wish','chapter','concern','relationship_cue','motive','action')),
  current_revision INTEGER NOT NULL CHECK (current_revision > 0),
  status TEXT NOT NULL CHECK (status IN
    ('candidate','active','quiet','paused','resolved','released','contested','superseded','redacted')),
  created_at INTEGER NOT NULL,
  invalidated_at INTEGER,
  PRIMARY KEY (character_id,object_id)
);
CREATE INDEX v3_objects_kind_status ON v3_inner_objects(character_id,kind,status);

CREATE TABLE v3_inner_versions (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  previous_revision INTEGER,
  commit_id TEXT NOT NULL,
  -- body_json stores bounded interpretation summaries, NEVER hidden chain-of-thought.
  body_json TEXT NOT NULL CHECK (json_valid(body_json) AND json_type(body_json) = 'object'),
  content_hash TEXT NOT NULL,
  interpretation TEXT NOT NULL CHECK (interpretation IN
    ('user_defined','observed','reported','model_interpreted','mixed')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  occurred_at INTEGER,
  recorded_at INTEGER NOT NULL,
  valid_from INTEGER,
  valid_to INTEGER,
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id) REFERENCES v3_inner_objects(character_id,object_id),
  FOREIGN KEY (character_id,object_id,previous_revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,commit_id) REFERENCES v3_inner_commits(character_id,commit_id),
  CHECK ((revision = 1 AND previous_revision IS NULL)
    OR (revision > 1 AND previous_revision = revision - 1)),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);

-- Explicit attribution survives cross-friend influence. A person may be the
-- stimulus without being the owner of another person's promise or preference.
CREATE TABLE v3_inner_people (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_revision INTEGER NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN
    ('self','speaker','subject','target','participant','author','forwarder','remembered_person')),
  PRIMARY KEY (character_id,object_id,object_revision,entity_id,role),
  FOREIGN KEY (character_id,object_id,object_revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,entity_id) REFERENCES entities(character_id,entity_id)
);
CREATE INDEX v3_people_lookup ON v3_inner_people(character_id,entity_id,role,object_id);

-- At least one evidence row is REQUIRED BY SERVICE for a committed object.
-- Bootstrap goal uses an archived user instruction, not invented model evidence.
-- Exactly one reference per row, with real FK checks for its pinned revision.
CREATE TABLE v3_inner_evidence (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_revision INTEGER NOT NULL,
  evidence_id TEXT NOT NULL,
  source_id TEXT,
  source_revision INTEGER,
  memory_id TEXT,
  memory_revision INTEGER,
  event_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('supports','contradicts','context','stimulus')),
  span_json TEXT NOT NULL CHECK (json_valid(span_json)),
  independence_group TEXT NOT NULL,
  PRIMARY KEY (character_id,object_id,object_revision,evidence_id),
  FOREIGN KEY (character_id,object_id,object_revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,source_id,source_revision)
    REFERENCES sources(character_id,source_id,revision),
  FOREIGN KEY (character_id,memory_id,memory_revision)
    REFERENCES memory_versions(character_id,memory_id,revision),
  FOREIGN KEY (character_id,event_id) REFERENCES cognitive_events(character_id,event_id),
  CHECK ((source_id IS NOT NULL) + (memory_id IS NOT NULL) + (event_id IS NOT NULL) = 1),
  CHECK ((source_id IS NULL) = (source_revision IS NULL)),
  CHECK ((memory_id IS NULL) = (memory_revision IS NULL))
);
CREATE INDEX v3_evidence_source ON v3_inner_evidence(character_id,source_id,source_revision);
CREATE INDEX v3_evidence_memory ON v3_inner_evidence(character_id,memory_id,memory_revision);

-- Every inner state carries structured continuity. The <=1000-code-point
-- mental_summary is a UI/context projection, never the entire psychological state.
CREATE TABLE v3_inner_states (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  previous_state_id TEXT,
  previous_state_revision INTEGER,
  previous_state_hash TEXT,
  compressed_prior_json TEXT NOT NULL CHECK (json_valid(compressed_prior_json)),
  felt_changes_json TEXT NOT NULL CHECK (json_valid(felt_changes_json)),
  -- IDs/versions of active wishes, concerns, chapters and relation cues.
  continuity_refs_json TEXT NOT NULL CHECK (json_valid(continuity_refs_json)),
  -- Attention, emotional tensions, expectations and ambivalence are interpretable
  -- summaries. They are not token traces, latent activations or internal reasoning.
  attention_json TEXT NOT NULL CHECK (json_valid(attention_json)),
  emotional_tensions_json TEXT NOT NULL CHECK (json_valid(emotional_tensions_json)),
  expectations_json TEXT NOT NULL CHECK (json_valid(expectations_json)),
  mental_summary TEXT NOT NULL CHECK (length(mental_summary) <= 1000),
  based_on_event_watermark TEXT NOT NULL,
  -- Physiological/operational facts remain harness-owned observations. Their
  -- meaning is interpreted here; an LLM cannot rewrite battery/time/budget.
  observed_condition_json TEXT NOT NULL CHECK (json_valid(observed_condition_json)),
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,previous_state_id,previous_state_revision)
    REFERENCES v3_inner_states(character_id,object_id,revision),
  CHECK ((previous_state_id IS NULL AND previous_state_revision IS NULL AND previous_state_hash IS NULL)
    OR (previous_state_id IS NOT NULL AND previous_state_revision IS NOT NULL AND previous_state_hash IS NOT NULL))
);

CREATE TABLE v3_inner_heads (
  character_id TEXT PRIMARY KEY REFERENCES character_manifest(character_id),
  state_id TEXT NOT NULL,
  state_revision INTEGER NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  role_epoch INTEGER NOT NULL CHECK (role_epoch > 0),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (character_id,state_id,state_revision)
    REFERENCES v3_inner_states(character_id,object_id,revision)
);

-- This trigger supplements, but does not replace, UPDATE ... WHERE generation
-- = :expected AND role_epoch = :expected_epoch with exactly-one-row checking.
CREATE TRIGGER v3_inner_head_continuity BEFORE UPDATE ON v3_inner_heads
BEGIN
  SELECT CASE WHEN NEW.character_id <> OLD.character_id
    OR NEW.generation <> OLD.generation + 1
    OR NEW.role_epoch <> (SELECT role_epoch FROM character_manifest WHERE character_id=NEW.character_id)
    THEN RAISE(ABORT,'V3_HEAD_VERSION_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM v3_inner_states s
    JOIN v3_inner_versions p ON p.character_id=OLD.character_id
      AND p.object_id=OLD.state_id AND p.revision=OLD.state_revision
    WHERE s.character_id=NEW.character_id AND s.object_id=NEW.state_id AND s.revision=NEW.state_revision
      AND s.previous_state_id=OLD.state_id AND s.previous_state_revision=OLD.state_revision
      AND s.previous_state_hash=p.content_hash
  ) THEN RAISE(ABORT,'V3_CONTINUITY_PARENT_MISMATCH') END;
END;

CREATE TABLE v3_inner_intake (
  character_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  state_id TEXT NOT NULL,
  state_revision INTEGER NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,event_id),
  FOREIGN KEY (character_id,event_id) REFERENCES cognitive_events(character_id,event_id),
  FOREIGN KEY (character_id,state_id,state_revision)
    REFERENCES v3_inner_states(character_id,object_id,revision)
);

-- Stable anchors are normally explicit user choices. Evolution is a proposal;
-- locked anchors cannot be altered by a dream/model commit without user consent.
CREATE TABLE v3_inner_anchors (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('identity','core_wish','value','boundary')),
  text TEXT NOT NULL,
  locked INTEGER NOT NULL CHECK (locked IN (0,1)),
  authority TEXT NOT NULL CHECK (authority IN ('user','reviewed_growth')),
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision)
);

CREATE TABLE v3_inner_wishes (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  anchor_id TEXT,
  anchor_revision INTEGER,
  wish_text TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  horizon TEXT NOT NULL CHECK (horizon IN ('enduring','seasonal','emerging')),
  -- Wishes are directions, not productivity KPIs or compulsory social obligations.
  revisit_conditions_json TEXT NOT NULL CHECK (json_valid(revisit_conditions_json)),
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,anchor_id,anchor_revision)
    REFERENCES v3_inner_anchors(character_id,object_id,revision),
  CHECK ((anchor_id IS NULL) = (anchor_revision IS NULL))
);

CREATE TABLE v3_life_chapters (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  wish_id TEXT NOT NULL,
  wish_revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  personal_meaning TEXT NOT NULL,
  narrative_so_far TEXT NOT NULL,
  open_questions_json TEXT NOT NULL CHECK (json_valid(open_questions_json)),
  possible_continuations_json TEXT NOT NULL CHECK (json_valid(possible_continuations_json)),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,wish_id,wish_revision)
    REFERENCES v3_inner_wishes(character_id,object_id,revision),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE v3_open_concerns (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  concern_kind TEXT NOT NULL CHECK (concern_kind IN
    ('curiosity','care','promise','unfinished_conversation','creative_interest','tension','expectation')),
  title TEXT NOT NULL,
  personal_meaning TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open','quiet','paused','resolved','released','contested')),
  last_changed_at INTEGER NOT NULL,
  -- Eligible for reconsideration only. This timestamp NEVER authorizes a send.
  reconsider_after INTEGER,
  continuation_conditions_json TEXT NOT NULL CHECK (json_valid(continuation_conditions_json)),
  release_conditions_json TEXT NOT NULL CHECK (json_valid(release_conditions_json)),
  resolution_summary TEXT,
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision)
);
CREATE INDEX v3_concerns_reconsider ON v3_open_concerns(character_id,state,reconsider_after);

CREATE TABLE v3_relationship_cues (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  -- An exact entity key, not an interchangeable display name or intimacy bucket.
  person_id TEXT NOT NULL,
  cue_kind TEXT NOT NULL CHECK (cue_kind IN
    ('shared_story','shared_interest','interaction_habit','unfinished_topic','repair','trust','boundary','care')),
  personal_meaning TEXT NOT NULL,
  known_facts_json TEXT NOT NULL CHECK (json_valid(known_facts_json)),
  uncertain_interpretation_json TEXT NOT NULL CHECK (json_valid(uncertain_interpretation_json)),
  last_confirmed_at INTEGER,
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,person_id) REFERENCES entities(character_id,entity_id)
);
CREATE INDEX v3_relationship_person ON v3_relationship_cues(character_id,person_id,cue_kind);

-- A motive is a tentative interpretation, not an immediate external command.
CREATE TABLE v3_inner_motives (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  from_state_id TEXT NOT NULL,
  from_state_revision INTEGER NOT NULL,
  motive_kind TEXT NOT NULL CHECK (motive_kind IN
    ('share','care','explore','learn','create','repair','rest','stay_with_feeling','decline')),
  what_draws_me TEXT NOT NULL,
  candidate_person_id TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  decision TEXT NOT NULL CHECK (decision IN ('consider','pursue','hold','release')),
  valid_until INTEGER,
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,from_state_id,from_state_revision)
    REFERENCES v3_inner_states(character_id,object_id,revision),
  FOREIGN KEY (character_id,candidate_person_id) REFERENCES entities(character_id,entity_id)
);

CREATE TABLE v3_action_proposals (
  character_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  motive_id TEXT NOT NULL,
  motive_revision INTEGER NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind IN
    ('chat','browse','read','learn','comment','like','create_draft','rest','do_nothing')),
  target_person_id TEXT,
  adapter TEXT,
  target_locator_json TEXT NOT NULL CHECK (json_valid(target_locator_json)),
  bounded_intent TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('proposed','selected','held','rejected','executing','completed','failed','unknown','cancelled','superseded')),
  based_on_mind_generation INTEGER NOT NULL CHECK (based_on_mind_generation > 0),
  based_on_role_epoch INTEGER NOT NULL CHECK (based_on_role_epoch > 0),
  not_before INTEGER,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,object_id,revision),
  FOREIGN KEY (character_id,object_id,revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,motive_id,motive_revision)
    REFERENCES v3_inner_motives(character_id,object_id,revision),
  FOREIGN KEY (character_id,target_person_id) REFERENCES entities(character_id,entity_id),
  CHECK (not_before IS NULL OR expires_at >= not_before)
);
CREATE INDEX v3_action_candidates ON v3_action_proposals(character_id,status,expires_at);

-- The harness owns these gates. An LLM cannot mark its own permission as passed.
-- Required gates are authorization, sleep_window, recipient_refusal, budget,
-- attention_lane and capability_ready; additional gates are allowed by enum.
CREATE TABLE v3_action_checks (
  character_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_revision INTEGER NOT NULL,
  check_run_id TEXT NOT NULL,
  gate TEXT NOT NULL CHECK (gate IN
    ('authorization','sleep_window','recipient_refusal','budget','attention_lane','capability_ready','source_validity','target_attribution')),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail','unknown')),
  policy_revision TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  valid_until INTEGER NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  PRIMARY KEY (character_id,action_id,action_revision,check_run_id,gate),
  FOREIGN KEY (character_id,action_id,action_revision)
    REFERENCES v3_action_proposals(character_id,object_id,revision),
  CHECK (valid_until >= checked_at)
);

-- External send results have their own state machine. CAS/lease claims and
-- globally single attention lane remain harness duties. Unknown is NOT retryable
-- until an adapter reconciles a real receipt; local idempotency is insufficient.
CREATE TABLE v3_action_executions (
  character_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_revision INTEGER NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  idempotency_key TEXT NOT NULL,
  check_run_id TEXT NOT NULL,
  claimed_mind_generation INTEGER NOT NULL,
  claimed_role_epoch INTEGER NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','started','succeeded','failed','unknown','cancelled')),
  started_at INTEGER,
  finished_at INTEGER,
  external_receipt TEXT,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  PRIMARY KEY (character_id,execution_id),
  UNIQUE (character_id,action_id,action_revision,attempt),
  UNIQUE (character_id,idempotency_key),
  FOREIGN KEY (character_id,action_id,action_revision)
    REFERENCES v3_action_proposals(character_id,object_id,revision),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE v3_experience_outcomes (
  character_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  outcome_kind TEXT NOT NULL CHECK (outcome_kind IN
    ('abstained','delivered','replied','read','no_reply_observed','enjoyed','disappointed','learned','rested','failed','unknown')),
  -- Perceived meanings must not be presented as the recipient's mental facts.
  observation_summary TEXT NOT NULL,
  interpretation_summary TEXT,
  interpretation_confidence REAL CHECK (interpretation_confidence BETWEEN 0 AND 1),
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (character_id,outcome_id),
  FOREIGN KEY (character_id,execution_id) REFERENCES v3_action_executions(character_id,execution_id),
  FOREIGN KEY (character_id,event_id) REFERENCES cognitive_events(character_id,event_id)
);

-- Dream transcript is ephemeral. Persist input provenance, bounded conclusions,
-- reviewed patches and coverage, not a hidden thinking transcript or raw CoT.
CREATE TABLE v3_dream_reviews (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  review_id TEXT NOT NULL,
  role_epoch INTEGER NOT NULL,
  base_cognition_revision INTEGER NOT NULL,
  base_mind_generation INTEGER NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN
    ('sleep_entry','meaningful_change','unresolved_tension','manual')),
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','reviewed','applied','conflicted','failed','cancelled')),
  input_refs_json TEXT NOT NULL CHECK (json_valid(input_refs_json)),
  findings_summary TEXT NOT NULL,
  proposed_patch_json TEXT NOT NULL CHECK (json_valid(proposed_patch_json)),
  validation_json TEXT NOT NULL CHECK (json_valid(validation_json)),
  applied_commit_id TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (character_id,review_id),
  UNIQUE (character_id,input_fingerprint),
  FOREIGN KEY (character_id,applied_commit_id) REFERENCES v3_inner_commits(character_id,commit_id),
  CHECK ((status = 'applied' AND applied_commit_id IS NOT NULL)
    OR (status <> 'applied' AND applied_commit_id IS NULL))
);

-- Dependency graph spans V3 interpretations + pinned V2 memories/sources.
-- All derived states, cues, prompts and summaries must be invalidated when a
-- parent is corrected/forgotten. DAG cycle checks and recursive invalidation are
-- mandatory service work; this DDL only checks local/reference integrity.
CREATE TABLE v3_inner_dependencies (
  character_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  child_revision INTEGER NOT NULL,
  dependency_id TEXT NOT NULL,
  parent_inner_id TEXT,
  parent_inner_revision INTEGER,
  parent_memory_id TEXT,
  parent_memory_revision INTEGER,
  parent_source_id TEXT,
  parent_source_revision INTEGER,
  relation TEXT NOT NULL CHECK (relation IN
    ('continues','compresses','stimulated_by','derived_from','supports','contradicts','revises','resolves')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  valid_from INTEGER NOT NULL,
  invalidated_at INTEGER,
  PRIMARY KEY (character_id,child_id,child_revision,dependency_id),
  FOREIGN KEY (character_id,child_id,child_revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,parent_inner_id,parent_inner_revision)
    REFERENCES v3_inner_versions(character_id,object_id,revision),
  FOREIGN KEY (character_id,parent_memory_id,parent_memory_revision)
    REFERENCES memory_versions(character_id,memory_id,revision),
  FOREIGN KEY (character_id,parent_source_id,parent_source_revision)
    REFERENCES sources(character_id,source_id,revision),
  CHECK ((parent_inner_id IS NOT NULL) + (parent_memory_id IS NOT NULL) + (parent_source_id IS NOT NULL) = 1),
  CHECK ((parent_inner_id IS NULL) = (parent_inner_revision IS NULL)),
  CHECK ((parent_memory_id IS NULL) = (parent_memory_revision IS NULL)),
  CHECK ((parent_source_id IS NULL) = (parent_source_revision IS NULL)),
  CHECK (parent_inner_id IS NULL OR child_id <> parent_inner_id OR child_revision <> parent_inner_revision)
);
CREATE INDEX v3_dependency_inner_reverse ON v3_inner_dependencies(character_id,parent_inner_id,parent_inner_revision);
CREATE INDEX v3_dependency_memory_reverse ON v3_inner_dependencies(character_id,parent_memory_id,parent_memory_revision);
CREATE INDEX v3_dependency_source_reverse ON v3_inner_dependencies(character_id,parent_source_id,parent_source_revision);

-- Rebuildable projection, never an independent psychological source of truth.
CREATE TABLE v3_inner_projections (
  character_id TEXT NOT NULL REFERENCES character_manifest(character_id),
  projection_kind TEXT NOT NULL CHECK (projection_kind IN
    ('mental_summary','context_slice','life_overview','relationship_overview')),
  target_key TEXT NOT NULL,
  based_on_mind_generation INTEGER NOT NULL,
  based_on_cognition_revision INTEGER NOT NULL,
  input_refs_json TEXT NOT NULL CHECK (json_valid(input_refs_json)),
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  valid_until INTEGER,
  invalidated_at INTEGER,
  PRIMARY KEY (character_id,projection_kind,target_key)
);

-- No scheduler/permission defaults, no bootstrap INSERTs, no full-table migration
-- and no table/column replacements are executed by this draft.
