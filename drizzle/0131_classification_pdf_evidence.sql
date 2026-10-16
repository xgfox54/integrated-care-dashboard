ALTER TABLE official_classification_restoration ADD COLUMN original_pdf_sha256 TEXT;
--> statement-breakpoint
ALTER TABLE official_classification_restoration ADD COLUMN verification_method TEXT NOT NULL DEFAULT 'synap_glyph';
