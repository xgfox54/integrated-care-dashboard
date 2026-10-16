CREATE TABLE mcp_call_traces (
  call_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  route TEXT NOT NULL,
  tool TEXT NOT NULL,
  failed INTEGER NOT NULL,
  cache TEXT,
  duration_ms INTEGER NOT NULL,
  query_hash TEXT,
  conditions_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX mcp_call_traces_recent ON mcp_call_traces(started_at DESC);
--> statement-breakpoint
CREATE INDEX mcp_call_traces_request ON mcp_call_traces(request_id, started_at DESC);
