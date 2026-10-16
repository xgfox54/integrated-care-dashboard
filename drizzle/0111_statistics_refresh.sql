-- Statistics-only storage. Existing service, fiscal, news and law data are untouched.
-- Three MOIS datasets share one complete JSON publication; no partial month is exposed.
CREATE TABLE statistics_refresh_scope (
  scope_id TEXT PRIMARY KEY NOT NULL,
  result_json TEXT,
  previous_json TEXT,
  revision TEXT,
  latest_period TEXT,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  error_code TEXT,
  stage_json TEXT,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE statistics_refresh_worker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lease_token TEXT,
  lease_expires_at INTEGER,
  active_scope TEXT,
  last_wake_at INTEGER,
  host_state_json TEXT NOT NULL DEFAULT '{}'
);
