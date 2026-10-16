CREATE TABLE official_review_completion (
  review_id TEXT PRIMARY KEY,
  faq_id TEXT NOT NULL REFERENCES faq_129(faq_id),
  source_url TEXT NOT NULL REFERENCES official_source_review(source_url),
  faq_content_sha256 TEXT NOT NULL,
  guidance_revision TEXT NOT NULL,
  observed_sha256 TEXT NOT NULL,
  observed_content_sha256 TEXT NOT NULL,
  comparison_algorithm TEXT NOT NULL,
  source_checked_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('GUIDANCE_UNCHANGED','FOLLOW_UP_REQUIRED')),
  evidence_quote TEXT NOT NULL,
  evidence_location TEXT NOT NULL,
  reason TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  review_due_at TEXT NOT NULL,
  reviewer_role TEXT NOT NULL CHECK(reviewer_role = 'authenticated_admin')
);
--> statement-breakpoint
CREATE INDEX official_review_completion_faq ON official_review_completion(faq_id, reviewed_at DESC);
--> statement-breakpoint
CREATE TRIGGER official_review_completion_no_update BEFORE UPDATE ON official_review_completion BEGIN SELECT RAISE(ABORT, 'REVIEW_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER official_review_completion_no_delete BEFORE DELETE ON official_review_completion BEGIN SELECT RAISE(ABORT, 'REVIEW_HISTORY_IMMUTABLE'); END;
