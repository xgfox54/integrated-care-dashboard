-- 보도자료 학습자료 판본·재평가 기록(작업지시서 2026-10-09 D-02). 0085(열 추가)와 나눠, 이 파일은 모두 IF NOT EXISTS라 다시 실행해도 결과가 같다.
-- 학습자료 판본: 학습 대상 행(판정 WELFARE·NON_WELFARE, 근거 reviewer·title_rule)의 판정·제목·근거·중복 묶음이 바뀌거나 행이 생기고 없어지면 1씩 오른다.
-- 같은 트랜잭션 안의 트리거라 사람 판정 변경과 판본 갱신이 따로 실패하지 않는다. 모델 식별자에 이 값을 넣는다.
CREATE TABLE IF NOT EXISTS press_training_revision (
	id integer PRIMARY KEY NOT NULL CHECK (id = 1),
	revision integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO press_training_revision (id, revision) VALUES (1, 1);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS press_training_rev_update AFTER UPDATE OF title, title_hash, title_key, classification_status, classification_basis, duplicate_group_id ON press_item
WHEN ((OLD.classification_status IN ('WELFARE', 'NON_WELFARE') AND OLD.classification_basis IN ('reviewer', 'title_rule'))
   OR (NEW.classification_status IN ('WELFARE', 'NON_WELFARE') AND NEW.classification_basis IN ('reviewer', 'title_rule')))
 AND (OLD.title IS NOT NEW.title OR OLD.title_hash IS NOT NEW.title_hash OR OLD.title_key IS NOT NEW.title_key OR OLD.classification_status IS NOT NEW.classification_status
   OR OLD.classification_basis IS NOT NEW.classification_basis OR OLD.duplicate_group_id IS NOT NEW.duplicate_group_id)
BEGIN
	UPDATE press_training_revision SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS press_training_rev_insert AFTER INSERT ON press_item
WHEN NEW.classification_status IN ('WELFARE', 'NON_WELFARE') AND NEW.classification_basis IN ('reviewer', 'title_rule')
BEGIN
	UPDATE press_training_revision SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS press_training_rev_delete AFTER DELETE ON press_item
WHEN OLD.classification_status IN ('WELFARE', 'NON_WELFARE') AND OLD.classification_basis IN ('reviewer', 'title_rule')
BEGIN
	UPDATE press_training_revision SET revision = revision + 1 WHERE id = 1;
END;
--> statement-breakpoint
-- 기존 자동확정(auto_model) 재평가 기록: 실행·항목마다 이전 값·결과(applied·conflict)를 남겨 복구와 중단 재개 검증에 쓴다.
CREATE TABLE IF NOT EXISTS press_auto_reeval_log (
	log_id integer PRIMARY KEY AUTOINCREMENT,
	run_id text NOT NULL,
	item_id text NOT NULL,
	model_id text NOT NULL,
	at integer NOT NULL,
	action text NOT NULL,
	outcome text NOT NULL,
	before_status text NOT NULL,
	before_public text NOT NULL,
	before_score real,
	before_signature text NOT NULL,
	before_categories text DEFAULT '[]' NOT NULL,
	after_status text NOT NULL,
	after_public text NOT NULL,
	after_score real,
	reason text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS press_auto_reeval_log_run_idx ON press_auto_reeval_log (run_id, item_id);
