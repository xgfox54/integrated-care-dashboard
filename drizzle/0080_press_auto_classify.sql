-- 보도자료 복지·비복지 자동분류(운영자 요청 2026-10-06). 학습 판정(lib/press/auto-classify.ts)의 점수와 어떤 학습 상태로 봤는지를 남긴다.
-- auto_score: 복지 쪽 로그 승산(양수면 복지). 확정하지 않은 항목도 추천값으로 화면에 보여 준다. auto_signature: 같은 학습 상태로 다시 보지 않도록 표시.
ALTER TABLE press_item ADD COLUMN auto_score real;
--> statement-breakpoint
ALTER TABLE press_item ADD COLUMN auto_signature text DEFAULT '' NOT NULL;
