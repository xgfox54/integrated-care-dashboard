CREATE TABLE fiscal_scope (
	scope_id text PRIMARY KEY NOT NULL,
	label text NOT NULL,
	mode text NOT NULL,
	definition text NOT NULL,
	access_requirement text NOT NULL,
	classification_basis text NOT NULL,
	approval_status text DEFAULT 'PENDING_REVIEW' NOT NULL,
	approved_at integer,
	policy_note text DEFAULT '' NOT NULL,
	enabled integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE fiscal_collection_run (
	run_id text PRIMARY KEY NOT NULL,
	scope_id text NOT NULL,
	trigger text NOT NULL,
	requested_reference_date text NOT NULL,
	fiscal_year text NOT NULL,
	access_tier text NOT NULL,
	page_size integer NOT NULL,
	contract_version text NOT NULL,
	started_at integer NOT NULL,
	updated_at integer NOT NULL,
	finished_at integer,
	status text NOT NULL,
	total_count integer,
	pages_expected integer,
	next_page integer DEFAULT 1 NOT NULL,
	received_rows integer DEFAULT 0 NOT NULL,
	invalid_rows integer DEFAULT 0 NOT NULL,
	duplicate_rows integer DEFAULT 0 NOT NULL,
	retry_count integer DEFAULT 0 NOT NULL,
	error_code text DEFAULT '' NOT NULL,
	snapshot_id text,
	lease_token text DEFAULT '' NOT NULL,
	lease_expires_at integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX fiscal_collection_run_scope_idx ON fiscal_collection_run (scope_id, requested_reference_date);
--> statement-breakpoint
CREATE INDEX fiscal_collection_run_status_idx ON fiscal_collection_run (status, updated_at);
--> statement-breakpoint
CREATE TABLE fiscal_staging_row (
	run_id text NOT NULL,
	row_key text NOT NULL,
	page integer NOT NULL,
	payload text NOT NULL,
	PRIMARY KEY (run_id, row_key)
);
--> statement-breakpoint
CREATE TABLE fiscal_entity (
	fiscal_entity_id text PRIMARY KEY NOT NULL,
	code_system text NOT NULL,
	code text NOT NULL,
	name text NOT NULL,
	wa_code text NOT NULL,
	wa_name text NOT NULL,
	padm_code text DEFAULT '' NOT NULL,
	first_seen_at integer NOT NULL,
	last_seen_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE fiscal_department (
	fiscal_department_id text PRIMARY KEY NOT NULL,
	fiscal_entity_id text NOT NULL,
	code_system text NOT NULL,
	code text NOT NULL,
	name text,
	first_seen_at integer NOT NULL,
	last_seen_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX fiscal_department_entity_idx ON fiscal_department (fiscal_entity_id);
--> statement-breakpoint
CREATE TABLE fiscal_region_mapping (
	mapping_id text PRIMARY KEY NOT NULL,
	fiscal_entity_id text NOT NULL,
	fiscal_department_id text,
	region_id text NOT NULL,
	organization_id text,
	relation text NOT NULL,
	valid_from text DEFAULT '' NOT NULL,
	valid_to text DEFAULT '' NOT NULL,
	basis text NOT NULL,
	verification_status text NOT NULL
);
--> statement-breakpoint
CREATE INDEX fiscal_region_mapping_region_idx ON fiscal_region_mapping (region_id);
--> statement-breakpoint
CREATE TABLE fiscal_code_version (
	code_system text NOT NULL,
	code text NOT NULL,
	fiscal_year text NOT NULL,
	name text NOT NULL,
	source text NOT NULL,
	first_seen_at integer NOT NULL,
	PRIMARY KEY (code_system, code, fiscal_year, name)
);
--> statement-breakpoint
CREATE TABLE fiscal_project (
	fiscal_project_id text PRIMARY KEY NOT NULL,
	fiscal_year text NOT NULL,
	fiscal_entity_id text NOT NULL,
	account_code text NOT NULL,
	account_name text NOT NULL,
	department_code text NOT NULL,
	dbiz_code text NOT NULL,
	name text NOT NULL,
	field_code text NOT NULL,
	field_name text NOT NULL,
	part_code text NOT NULL,
	part_name text NOT NULL,
	first_seen_at integer NOT NULL,
	last_seen_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX fiscal_project_year_entity_idx ON fiscal_project (fiscal_year, fiscal_entity_id, department_code);
--> statement-breakpoint
CREATE TABLE fiscal_observation (
	observation_id text PRIMARY KEY NOT NULL,
	fiscal_project_id text NOT NULL,
	run_id text NOT NULL,
	reference_date text NOT NULL,
	source_exe_ymd text NOT NULL,
	current_budget_raw text,
	current_budget_krw text,
	public_expenditure_raw text,
	public_expenditure_krw text,
	national_raw text,
	national_krw text,
	province_raw text,
	province_krw text,
	municipal_raw text,
	municipal_krw text,
	other_raw text,
	other_krw text,
	compiled_raw text,
	amount_problems text DEFAULT '[]' NOT NULL,
	source_amount_unit text NOT NULL,
	unit_verification text NOT NULL,
	normalization_rule_id text NOT NULL,
	contract_version text NOT NULL,
	created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX fiscal_observation_project_date_idx ON fiscal_observation (fiscal_project_id, reference_date);
--> statement-breakpoint
CREATE TABLE fiscal_snapshot (
	snapshot_id text PRIMARY KEY NOT NULL,
	scope_id text NOT NULL,
	run_id text NOT NULL,
	fiscal_year text NOT NULL,
	requested_reference_date text NOT NULL,
	effective_reference_date text,
	reference_date_note text DEFAULT '' NOT NULL,
	access_tier text NOT NULL,
	expected_count integer NOT NULL,
	unique_count integer NOT NULL,
	complete integer NOT NULL,
	status text NOT NULL,
	status_reason text DEFAULT '' NOT NULL,
	created_at integer NOT NULL,
	published_at integer
);
--> statement-breakpoint
CREATE INDEX fiscal_snapshot_scope_idx ON fiscal_snapshot (scope_id, status, requested_reference_date);
--> statement-breakpoint
CREATE TABLE fiscal_snapshot_member (
	snapshot_id text NOT NULL,
	fiscal_project_id text NOT NULL,
	observation_id text NOT NULL,
	PRIMARY KEY (snapshot_id, fiscal_project_id)
);
--> statement-breakpoint
INSERT INTO fiscal_scope (scope_id, label, mode, definition, access_requirement, classification_basis, policy_note) VALUES
	('qwgjk:integrated-care-name', '전국 세부사업명 「통합돌봄」 포함 사업', 'integrated_care', '{"dbizNm":"통합돌봄"}', 'SAMPLE_OK',
	 '세부사업명에 「통합돌봄」이 들어간 사업만 모은 사업명 규칙입니다. 공식 분류가 아니며, 이름에 이 말이 없는 통합돌봄 관련 사업은 빠집니다.',
	 '지방재정365 OpenAPI 이용조건: 출처표시, 상업적·비상업적 이용 가능, 변형 등 2차적 저작물 작성 가능(원천 명세). 표본키(페이지당 5건)로 전체 페이지를 받을 수 있는 범위입니다.');
--> statement-breakpoint
INSERT INTO fiscal_scope (scope_id, label, mode, definition, access_requirement, classification_basis, policy_note, enabled) VALUES
	('qwgjk:jeju-full', '제주본청 전체 세출(사회복지·보건·부서별 조회용)', 'all_fields', '{"waLafCd":"4900000"}', 'KEY_REQUIRED',
	 '원천의 분야코드(fld_cd)·부문코드(ane_part_cd)로 사회복지·보건을 구분합니다.',
	 '전체 세출은 표본키(페이지당 5건)로 받기에 너무 커서 발급 인증키가 필요합니다.', 1);
--> statement-breakpoint
INSERT INTO fiscal_region_mapping (mapping_id, fiscal_entity_id, fiscal_department_id, region_id, organization_id, relation, basis, verification_status) VALUES
	('map:lofin-laf-4900000', 'lofin:laf:4900000', NULL, 'region:제주특별자치도', 'org:제주특별자치도', 'jurisdiction',
	 '2026-10-04 QWGJK 응답에서 laf_cd=4900000의 자치단체명이 「제주본청」, 지역명이 「제주」임을 직접 확인', 'VERIFIED');
--> statement-breakpoint
INSERT INTO fiscal_region_mapping (mapping_id, fiscal_entity_id, fiscal_department_id, region_id, organization_id, relation, basis, verification_status) VALUES
	('map:lofin-dept-4900000-4005301', 'lofin:laf:4900000', 'lofin:dept:4900000:4005301', 'region:제주특별자치도|서귀포시', NULL, 'department_candidate',
	 '작업지시서 P7(2026-10-02 대조기록)의 서귀포시 통합돌봄과 부서코드. 원천 응답에 부서명이 없어 공식 부서 자료로 재확인 전이며, 제주본청 재정주체 소속 부서입니다.', 'CANDIDATE');

