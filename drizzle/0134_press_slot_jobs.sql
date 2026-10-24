CREATE TABLE press_slot_checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), slot_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE press_slot (slot_at INTEGER PRIMARY KEY, captured_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE press_slot_job (
  source_id TEXT NOT NULL REFERENCES press_source(source_id),
  slot_at INTEGER NOT NULL REFERENCES press_slot(slot_at) DEFERRABLE INITIALLY DEFERRED,
  collect_via TEXT NOT NULL CHECK (collect_via IN ('server', 'relay')),
  registry_version TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  hold_reason TEXT NOT NULL DEFAULT '',
  next_retry_at INTEGER,
  retryable INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  closed_at INTEGER,
  close_reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'held')),
  attempt_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, slot_at)
);
--> statement-breakpoint
CREATE INDEX press_slot_job_pending ON press_slot_job(status, slot_at, source_id);
--> statement-breakpoint
CREATE TABLE press_job_attempt (
  run_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES press_source(source_id),
  slot_at INTEGER,
  lease_token TEXT NOT NULL,
  host TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'held', 'abandoned')),
  error_code TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (source_id, slot_at) REFERENCES press_slot_job(source_id, slot_at)
);
--> statement-breakpoint
CREATE INDEX press_job_attempt_running ON press_job_attempt(status, source_id);
--> statement-breakpoint
CREATE TABLE press_write_fence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  valid INTEGER NOT NULL CONSTRAINT press_lease_fence_live CHECK (valid = 1)
);
