-- 공식 원본 SHA-256이 일치하는 예산서에서 확인한 부서 표기로 메타데이터를 정정한다.
-- 물리 157쪽(인쇄 149쪽)의 생애주기별 통합돌봄사업 원문 부서: 서귀포시주민복지과.
UPDATE budget_document
SET title = REPLACE(title, '서귀포시통합돌봄과', '서귀포시주민복지과')
WHERE document_id = 'doc:budget-jeju-2026-4005301-initial-welfare'
  AND raw_sha256 = 'd7b2a7e82c2b569deeaf918f339b0e3cd6a71847b654adb15845177a2326d690';
--> statement-breakpoint
UPDATE budget_revision
SET scope_text = REPLACE(scope_text, '서귀포시통합돌봄과', '서귀포시주민복지과(원문 표기, 현행 부서명·조직 이력은 별도 확인)')
WHERE document_id = 'doc:budget-jeju-2026-4005301-initial-welfare'
  AND EXISTS (
    SELECT 1 FROM budget_document d
    WHERE d.import_id = budget_revision.import_id AND d.document_id = budget_revision.document_id
      AND d.raw_sha256 = 'd7b2a7e82c2b569deeaf918f339b0e3cd6a71847b654adb15845177a2326d690'
  );
