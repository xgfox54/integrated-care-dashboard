CREATE TABLE official_source_review (
  source_url TEXT PRIMARY KEY NOT NULL,
  baseline_sha256 TEXT NOT NULL,
  observed_sha256 TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('BASELINE_RECORDED','UNCHANGED','CHANGED','CHECK_FAILED')),
  error_code TEXT
);
