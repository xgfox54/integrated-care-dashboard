import assert from "node:assert/strict";
import test from "node:test";
import { database, NOW } from "./press-test-support.mjs";
import { claimRelayJobs } from "./press/relay.ts";

const sourceId = "src:busan:press";
function failedSource(overrides = {}) {
  const db = database();
  db.sqlite.prepare("UPDATE press_source SET enabled = 1, approval_status = 'POLICY_APPROVED', technical_status = 'ERROR', collect_via = 'server' WHERE source_id = ?").run(sourceId);
  db.sqlite.prepare("INSERT INTO press_crawl_state (source_id, consecutive_failures, safe_error, next_due_at) VALUES (?, 22, 'NETWORK_ERROR', ?) ON CONFLICT(source_id) DO UPDATE SET consecutive_failures = 22, safe_error = 'NETWORK_ERROR', next_due_at = excluded.next_due_at").run(sourceId, NOW + 10800);
  for (const [column, value] of Object.entries(overrides)) {
    const table = ["enabled", "approval_status", "endpoint_url"].includes(column) ? "press_source" : "press_crawl_state";
    db.sqlite.prepare(`UPDATE ${table} SET ${column} = ? WHERE source_id = ?`).run(value, sourceId);
  }
  return db;
}

test("검증된 서버 반복 실패는 등록 PC 작업으로 넘어가되 실패 이력을 보존한다", async () => {
  // Given: approved, locally verified Busan with repeated hosted failures and a future retry.
  const db = failedSource();
  try {
    // When: the registered PC claims collection work.
    const result = await claimRelayJobs(db, "laptop", NOW);
    // Then: actual relay work is available, without concealing the prior failure.
    assert.ok(result.jobs.some((job) => job.sourceId === sourceId));
    const state = db.sqlite.prepare("SELECT consecutive_failures, safe_error FROM press_crawl_state WHERE source_id = ?").get(sourceId);
    assert.equal(state.consecutive_failures, 22);
    assert.equal(state.safe_error, "NETWORK_ERROR");
  } finally { db.sqlite.close(); }
});

for (const [name, overrides] of [
  ["승인 대기", { approval_status: "PENDING_PERMISSION" }],
  ["중지", { enabled: 0 }],
  ["서버 보류", { collection_hold: "SERVER_PAUSED", hold_until: NOW + 3600 }],
  ["접근 차단", { collection_hold: "BLOCKED" }],
  ["진행 중 잠금", { lease_expires_at: NOW + 120 }],
  ["새 주소", { endpoint_url: "https://www.busan.go.kr/another-feed.rss" }],
  ["일시 실패", { consecutive_failures: 1 }],
  ["서버 오류", { safe_error: "SERVER_ERROR" }],
]) {
  test(`${name} 상태는 중계 전환으로 우회하지 않는다`, async () => {
    // Given: a source outside the verified recovery conditions.
    const db = failedSource(overrides);
    try {
      // When: a PC requests work.
      const result = await claimRelayJobs(db, "laptop", NOW);
      // Then: no route mutation or work assignment for that source.
      assert.ok(!result.jobs.some((job) => job.sourceId === sourceId));
      assert.equal(db.sqlite.prepare("SELECT collect_via FROM press_source WHERE source_id = ?").get(sourceId).collect_via, "server");
    } finally { db.sqlite.close(); }
  });
}

test("이미 전환된 중계의 다음 예정 시각은 반복 claim으로 당기지 않는다", async () => {
  // Given: an existing relay source awaiting its normal schedule.
  const db = failedSource();
  db.sqlite.prepare("UPDATE press_source SET collect_via = 'relay' WHERE source_id = ?").run(sourceId);
  try {
    // When: the PC requests work early.
    const result = await claimRelayJobs(db, "laptop", NOW);
    // Then: retry timing remains unchanged.
    assert.ok(!result.jobs.some((job) => job.sourceId === sourceId));
    assert.equal(db.sqlite.prepare("SELECT next_due_at FROM press_crawl_state WHERE source_id = ?").get(sourceId).next_due_at, NOW + 10800);
  } finally { db.sqlite.close(); }
});
