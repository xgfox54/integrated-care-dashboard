-- 2026-10-15 MCP 통합검색 D1 공유 캐시(본문 암호화, 10분 만료)와 캐시 계층·사유별 집계·추적 열.
CREATE TABLE IF NOT EXISTS mcp_search_cache (
  cache_key TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL,
  body TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcp_search_cache_expires ON mcp_search_cache (expires_at);
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_hit_memory INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_hit_d1 INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_expired INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_not_stored INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_errors INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_bypass INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_write_ok INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_usage_hourly ADD COLUMN cache_write_errors INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN cache_status TEXT;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN cache_layer TEXT;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN cache_reason TEXT;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN cache_write TEXT;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN instance_id TEXT;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN colo TEXT;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN edge_probe TEXT;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN d1_statements INTEGER;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN d1_rows_read INTEGER;
--> statement-breakpoint
ALTER TABLE mcp_call_traces ADD COLUMN d1_ms INTEGER;
