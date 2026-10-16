-- 2026-10-14 작업지시서 §1-1·§4-3: 사업 운영상태 근거 이력과 관리자 감사로그.
-- service_status_evidence는 추가만 하고 고치지 않는다. 새 근거가 들어오면 이전 행에 superseded_at만 기록한다.
CREATE TABLE IF NOT EXISTS service_status_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('운영 중', '종료', '시행 예정', '확인 불가')),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('공고', '사업안내', '기관확인', '법령·고시')),
  evidence_title TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  effective_on TEXT,
  checked_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recorded_at INTEGER NOT NULL,
  superseded_at INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_status_evidence_service_idx ON service_status_evidence (service_id, recorded_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'failed')),
  detail TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admin_audit_log_at_idx ON admin_audit_log (at);

