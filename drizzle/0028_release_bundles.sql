CREATE TABLE platform_release_bundle (
	bundle_id text PRIMARY KEY NOT NULL,
	bundle_schema_version text NOT NULL,
	components_key text NOT NULL,
	knowledge_snapshot_id text,
	fiscal_snapshot_id text,
	news_snapshot_id text,
	link_snapshot_id text,
	components_json text NOT NULL,
	compatibility_report text NOT NULL,
	status text NOT NULL,
	created_at integer NOT NULL,
	activated_at integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX platform_release_bundle_key_idx ON platform_release_bundle (components_key);
--> statement-breakpoint
CREATE TABLE platform_active_bundle (
	id integer PRIMARY KEY NOT NULL CHECK (id = 1),
	bundle_id text,
	revision integer DEFAULT 0 NOT NULL,
	updated_at integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO platform_active_bundle (id, bundle_id, revision, updated_at) VALUES (1, NULL, 0, 0);
--> statement-breakpoint
CREATE TABLE cross_domain_link (
	link_id text PRIMARY KEY NOT NULL,
	source_type text NOT NULL,
	source_id text NOT NULL,
	target_type text NOT NULL,
	target_id text NOT NULL,
	relation text NOT NULL,
	source_component_id text,
	evidence_json text DEFAULT '{}' NOT NULL,
	mapping_version text NOT NULL,
	effective_from text DEFAULT '' NOT NULL,
	effective_to text DEFAULT '' NOT NULL,
	verification_status text DEFAULT 'CANDIDATE' NOT NULL,
	public_status text DEFAULT 'HIDDEN' NOT NULL,
	candidate_basis text NOT NULL,
	created_at integer NOT NULL,
	reviewed_at integer
);
--> statement-breakpoint
CREATE INDEX cross_domain_link_source_idx ON cross_domain_link (source_type, source_id);
--> statement-breakpoint
CREATE INDEX cross_domain_link_target_idx ON cross_domain_link (target_type, target_id);
--> statement-breakpoint
CREATE UNIQUE INDEX cross_domain_link_pair_idx ON cross_domain_link (source_type, source_id, relation, target_type, target_id);

