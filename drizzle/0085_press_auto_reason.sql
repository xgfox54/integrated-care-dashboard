-- 보도자료 자동분류 근거(작업지시서 2026-10-09 D-01). 이 단계는 열만 추가하고 기존 분류·공개 상태는 바꾸지 않는다(표·트리거는 0086).
-- auto_reason: 학습 판정의 확정 근거 또는 보류 사유(클래스 자료 부족·알려진 특징 0개 등).
ALTER TABLE press_item ADD COLUMN auto_reason text DEFAULT '' NOT NULL;
