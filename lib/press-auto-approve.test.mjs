import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { autoApproveRobotsAllowed } from "./press/auto-approve.ts";
import { NOW, database, response } from "./press-test-support.mjs";

const rows = (db, sql) => db.sqlite.prepare(sql).all();

function seed(db) {
  db.sqlite.exec("DELETE FROM press_source");
  const insert = db.sqlite.prepare("INSERT INTO press_source (source_id, organization_id, method, adapter, homepage_url, endpoint_url, allowed_hosts, verification_status, verification_note, approval_status, policy_basis, enabled, registry_version) VALUES (?, 'org:mohw', 'HTML', 'HTMLBoardAdapter', ?, ?, '[]', ?, '', 'PENDING_PERMISSION', '', 0, 'test')");
  insert.run("src:allow", "https://allow.go.kr/", "https://allow.go.kr/board/list.do", "ENDPOINT_VERIFIED");
  insert.run("src:none", "https://none.go.kr/", "https://none.go.kr/board/list.do", "ENDPOINT_VERIFIED");
  insert.run("src:deny", "https://deny.go.kr/", "https://deny.go.kr/board/list.do", "ENDPOINT_VERIFIED");
  insert.run("src:blocked", "https://blocked.go.kr/", "https://blocked.go.kr/board/list.do", "ENDPOINT_VERIFIED");
  insert.run("src:unverified", "https://new.go.kr/", "https://new.go.kr/board/list.do", "DISCOVERED");
}

const fetcher = async (url) => {
  if (url.startsWith("https://allow.go.kr")) return response(200, "User-agent: *\nDisallow: /admin/");
  if (url.startsWith("https://none.go.kr")) return response(404);
  if (url.startsWith("https://deny.go.kr")) return response(200, "User-agent: *\nDisallow: /board/");
  if (url.startsWith("https://blocked.go.kr")) return response(403, "<html>blocked</html>");
  throw new TypeError("unexpected " + url);
};

test("robots.txt가 허용하거나 없는 endpoint 확인 Source만 자동 승인하고, 막힘·읽기 실패·미확인·관리자 해제는 승인하지 않는다", async () => {
  const db = database();
  seed(db);
  const results = await autoApproveRobotsAllowed(db, fetcher, NOW, 10);
  assert.deepEqual(results.map((r) => [r.sourceId, r.verdict, r.approved]).sort(), [
    ["src:allow", "ALLOWED", true], ["src:blocked", "UNREADABLE", false], ["src:deny", "DISALLOWED", false], ["src:none", "NO_ROBOTS", true],
  ]);
  assert.deepEqual(rows(db, "SELECT source_id FROM press_source WHERE approval_status = 'POLICY_APPROVED' AND enabled = 1 ORDER BY source_id").map((r) => r.source_id), ["src:allow", "src:none"]);
  assert.match(rows(db, "SELECT policy_basis FROM press_source WHERE source_id = 'src:allow'")[0].policy_basis, /robots\.txt 허용/);
  // 하루 안에는 같은 Source를 다시 묻지 않는다.
  assert.deepEqual(await autoApproveRobotsAllowed(db, fetcher, NOW + 60, 10), []);
  // 관리자가 해제한 Source는 하루가 지나도 다시 자동 승인하지 않는다.
  assert.equal(await setPressApproval(db, "src:allow", "revoke", NOW + 120), true);
  const later = await autoApproveRobotsAllowed(db, fetcher, NOW + 2 * 86400, 10);
  assert.ok(!later.some((r) => r.sourceId === "src:allow"));
  assert.equal(rows(db, "SELECT approval_status FROM press_source WHERE source_id = 'src:allow'")[0].approval_status, "REVOKED");
});
