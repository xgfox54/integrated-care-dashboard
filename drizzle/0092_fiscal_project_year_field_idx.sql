-- 복지예산 전국 검색 속도(2026-10-09): 회계연도·분야로 그 분야 사업만 먼저 읽는 색인. lib/fiscal/query.ts fieldSearch.
CREATE INDEX IF NOT EXISTS fiscal_project_year_field_idx ON fiscal_project (fiscal_year, field_code);
