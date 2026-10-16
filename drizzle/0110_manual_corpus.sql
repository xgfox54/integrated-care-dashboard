-- Fixed, deployment-authorized manual corpus. This migration contains schema only.
CREATE TABLE manual_corpus (
  revision TEXT PRIMARY KEY NOT NULL,
  source_repository TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  manifest_created_at INTEGER NOT NULL,
  expected_documents INTEGER NOT NULL CHECK (expected_documents > 0),
  expected_sections INTEGER NOT NULL CHECK (expected_sections > 0),
  batch_count INTEGER NOT NULL CHECK (batch_count > 0),
  next_batch INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  section_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'STAGING' CHECK (status IN ('STAGING','ACTIVE','SUPERSEDED')),
  lease_token TEXT,
  lease_expires_at INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  retry_after INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  activated_at INTEGER
);
--> statement-breakpoint
CREATE TABLE manual_document (
  corpus_revision TEXT NOT NULL REFERENCES manual_corpus(revision),
  document_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  document_year TEXT,
  category TEXT NOT NULL,
  document_type TEXT NOT NULL,
  publisher TEXT NOT NULL,
  edition TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT NOT NULL,
  topic TEXT NOT NULL,
  authority TEXT NOT NULL,
  source_role TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  section_count INTEGER NOT NULL,
  PRIMARY KEY (corpus_revision, document_id),
  UNIQUE (corpus_revision, source_name)
);
--> statement-breakpoint
CREATE TABLE manual_section (
  row_id INTEGER PRIMARY KEY,
  corpus_revision TEXT NOT NULL,
  section_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  title TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  service_names TEXT NOT NULL,
  original_name TEXT NOT NULL,
  upstream_original_name TEXT NOT NULL,
  original_name_basis TEXT NOT NULL CHECK (original_name_basis IN ('explicit_original_file_marker','upstream_metadata','mixed_original_files')),
  original_name_line INTEGER,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_year TEXT,
  source_year_origin TEXT NOT NULL,
  original_search TEXT NOT NULL,
  title_search TEXT NOT NULL,
  heading_search TEXT NOT NULL,
  search_text TEXT NOT NULL,
  UNIQUE (corpus_revision, section_id),
  UNIQUE (corpus_revision, document_id, ordinal),
  FOREIGN KEY (corpus_revision, document_id) REFERENCES manual_document(corpus_revision, document_id)
);
--> statement-breakpoint
CREATE INDEX manual_section_document_idx ON manual_section (corpus_revision, document_id, ordinal);
--> statement-breakpoint
CREATE VIRTUAL TABLE manual_section_fts USING fts5(
  title_search, heading_search, search_text,
  content='manual_section', content_rowid='row_id', tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER manual_section_fts_insert AFTER INSERT ON manual_section BEGIN
  INSERT INTO manual_section_fts(rowid, title_search, heading_search, search_text)
  VALUES (new.row_id, new.title_search, new.heading_search, new.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER manual_section_fts_delete AFTER DELETE ON manual_section BEGIN
  INSERT INTO manual_section_fts(manual_section_fts, rowid, title_search, heading_search, search_text)
  VALUES ('delete', old.row_id, old.title_search, old.heading_search, old.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER manual_section_fts_update AFTER UPDATE ON manual_section BEGIN
  INSERT INTO manual_section_fts(manual_section_fts, rowid, title_search, heading_search, search_text)
  VALUES ('delete', old.row_id, old.title_search, old.heading_search, old.search_text);
  INSERT INTO manual_section_fts(rowid, title_search, heading_search, search_text)
  VALUES (new.row_id, new.title_search, new.heading_search, new.search_text);
END;
--> statement-breakpoint
CREATE TABLE manual_active (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT REFERENCES manual_corpus(revision),
  generation INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
