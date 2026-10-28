-- Additive operational ledgers; base V2 user_version remains readable.
CREATE TABLE IF NOT EXISTS v3_runtime_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v3_memory_snapshots(memory_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,recorded_at INTEGER NOT NULL,PRIMARY KEY(memory_id,revision));
CREATE TABLE IF NOT EXISTS v3_extract_units(unit_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,start INTEGER NOT NULL,length INTEGER NOT NULL,extractor_version TEXT NOT NULL,job_id TEXT,status TEXT NOT NULL,context_json TEXT NOT NULL,UNIQUE(event_id,source_id,source_revision,start,extractor_version));
CREATE INDEX IF NOT EXISTS v3_units_event ON v3_extract_units(event_id,status);
CREATE TABLE IF NOT EXISTS v3_memory_events(memory_id TEXT NOT NULL,memory_revision INTEGER NOT NULL,event_id TEXT NOT NULL,source_id TEXT NOT NULL,source_revision INTEGER NOT NULL,span_json TEXT NOT NULL,PRIMARY KEY(memory_id,memory_revision,event_id,source_id,span_json));
CREATE TABLE IF NOT EXISTS v3_effects(experience_id TEXT NOT NULL,effect_kind TEXT NOT NULL,state_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(experience_id,effect_kind));
CREATE TABLE IF NOT EXISTS v3_clock_intervals(id TEXT PRIMARY KEY,start INTEGER NOT NULL,finish INTEGER NOT NULL,kind TEXT NOT NULL,quality TEXT NOT NULL,CHECK(finish>=start));
CREATE TABLE IF NOT EXISTS v3_clock_checkpoint(id INTEGER PRIMARY KEY CHECK(id=1),wall_at INTEGER NOT NULL,epoch TEXT NOT NULL,mono REAL NOT NULL,kind TEXT NOT NULL,energy REAL NOT NULL);
CREATE TABLE IF NOT EXISTS v3_reconsider(id TEXT PRIMARY KEY,kind TEXT NOT NULL,object_id TEXT,object_revision INTEGER,due_at INTEGER NOT NULL,expires_at INTEGER,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS v3_reconsider_due ON v3_reconsider(status,due_at);
CREATE TABLE IF NOT EXISTS v3_budget(hour INTEGER PRIMARY KEY,calls INTEGER NOT NULL,input_chars INTEGER NOT NULL,output_chars INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS v3_usage(id TEXT PRIMARY KEY,at INTEGER NOT NULL,purpose TEXT NOT NULL,input_hash TEXT NOT NULL,receipt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v3_episode_coverage(topic TEXT NOT NULL,memory_id TEXT NOT NULL,revision INTEGER NOT NULL,summary_id TEXT,PRIMARY KEY(topic,memory_id));
CREATE TABLE IF NOT EXISTS v3_history_jobs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,revision INTEGER NOT NULL,sequence INTEGER NOT NULL,status TEXT NOT NULL,job_ids TEXT NOT NULL,error TEXT,UNIQUE(source_id,revision));
CREATE TABLE IF NOT EXISTS v3_memory_views(memory_id TEXT NOT NULL,revision INTEGER NOT NULL,view_kind TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(memory_id,revision,view_kind));
