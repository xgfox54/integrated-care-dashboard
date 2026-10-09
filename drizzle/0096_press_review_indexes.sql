-- 관리자 보도자료 분류 검토 화면(2026-10-09 속도 점검): 검토 대기 목록과 최근 판정 목록을 색인으로 바로 읽는다(lib/press/admin.ts readReviewQueue).
CREATE INDEX IF NOT EXISTS press_item_review_status_idx ON press_item (classification_status, published_date);
CREATE INDEX IF NOT EXISTS press_item_review_basis_idx ON press_item (classification_basis, reviewed_at);
