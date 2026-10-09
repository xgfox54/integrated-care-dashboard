-- 사업 연결 판정 출처(작업지시서 2026-10-09 D-03). 확인·제외 상태와 별도로 누가(사람·자동 규칙) 마지막으로 정했는지, 어떤 규칙이었는지, 판정 번호를 둔다.
-- 이 단계는 필드만 추가한다. 기존 연결의 상태·공개 여부·근거는 바꾸지 않는다(출처 분류는 0084).
ALTER TABLE cross_domain_link ADD COLUMN decision_origin text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE cross_domain_link ADD COLUMN decision_rule text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE cross_domain_link ADD COLUMN decision_revision integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS cross_domain_link_decision_log (
	log_id integer PRIMARY KEY AUTOINCREMENT,
	link_id text NOT NULL,
	revision integer NOT NULL,
	at integer NOT NULL,
	actor text NOT NULL,
	action text NOT NULL,
	before_status text NOT NULL,
	before_public text NOT NULL,
	before_origin text NOT NULL,
	before_reviewed_at integer,
	after_status text NOT NULL,
	after_public text NOT NULL,
	after_origin text NOT NULL,
	rule_id text DEFAULT '' NOT NULL,
	reason text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cross_domain_link_decision_log_link_idx ON cross_domain_link_decision_log (link_id, revision);
