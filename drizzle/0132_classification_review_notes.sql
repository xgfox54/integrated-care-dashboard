CREATE TABLE classification_review_note (
  review_id TEXT PRIMARY KEY, service_id TEXT NOT NULL, field TEXT NOT NULL CHECK(field IN ('type','subcategory')),
  expected_name TEXT NOT NULL, expected_updated_date TEXT NOT NULL, original_sha256 TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('ADDITIONAL_SOURCE_REQUIRED','EVIDENCE_SUBMITTED')),
  evidence_url TEXT NOT NULL, evidence_location TEXT NOT NULL, evidence_quote TEXT NOT NULL,
  reason TEXT NOT NULL, reviewed_at TEXT NOT NULL, reviewer_role TEXT NOT NULL CHECK(reviewer_role='authenticated_admin')
);
--> statement-breakpoint
CREATE INDEX classification_review_note_source ON classification_review_note(service_id,field,reviewed_at);
--> statement-breakpoint
CREATE TRIGGER classification_review_note_immutable_update BEFORE UPDATE ON classification_review_note BEGIN SELECT RAISE(ABORT,'REVIEW_HISTORY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER classification_review_note_immutable_delete BEFORE DELETE ON classification_review_note BEGIN SELECT RAISE(ABORT,'REVIEW_HISTORY_IMMUTABLE'); END;
