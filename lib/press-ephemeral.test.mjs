// 내부 지문 기록(§23.12·23.13, T155): 지문 보존 허가가 없으면 거절하고, 공개 보도자료 응답에는 지문이 없다.
import assert from "node:assert/strict";
import test from "node:test";

import { recordBodyFingerprint } from "./press/ephemeral.ts";
import { McpData } from "./mcp/data.ts";
import { toPressDto } from "./press/query.ts";
import { NOW, SOURCE_ID, database } from "./press-test-support.mjs";

const receipt = { item_id: SOURCE_ID + ":1", source_id: SOURCE_ID, algorithm: "sha256-nfc-ws-collapse-v1", fingerprint: "a".repeat(64), extraction_scope: "paragraph_text+table_cell_text", source_version: "post-1", policy_version: 1 };

test("정책 행이 없거나 지문 보존이 허가되지 않으면 지문을 남기지 않는다", async () => {
  const db = database();
  await assert.rejects(recordBodyFingerprint(db, receipt, NOW), /FINGERPRINT_RETENTION_NOT_ALLOWED/);
  db.sqlite.prepare("INSERT INTO press_ephemeral_policy (source_id, temporary_attachment_parse_allowed, fingerprint_retention_allowed, policy_version) VALUES (?, 1, 0, 1)").run(SOURCE_ID);
  await assert.rejects(recordBodyFingerprint(db, receipt, NOW), /FINGERPRINT_RETENTION_NOT_ALLOWED/);
  db.sqlite.prepare("UPDATE press_ephemeral_policy SET fingerprint_retention_allowed = 1, policy_version = 2 WHERE source_id = ?").run(SOURCE_ID);
  await assert.rejects(recordBodyFingerprint(db, receipt, NOW), /POLICY_VERSION_CHANGED/, "판독 뒤 정책이 바뀌면 받지 않는다");
  await recordBodyFingerprint(db, { ...receipt, policy_version: 2 }, NOW);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_text_fingerprint").get().n, 1);
});

test("공개 보도자료 조회·DTO에는 지문이 나오지 않는다", async () => {
  const db = database();
  db.sqlite.prepare("UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1 WHERE source_id = ?").run(SOURCE_ID);
  db.sqlite.prepare("INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) VALUES (?, ?, '1', 'https://www.mohw.go.kr/a', '통합돌봄 안내', 'h', 'org:mohw', '2026-10-01', 'DAY', ?, ?, '[]', 'WELFARE', 'title_rule', 'd', 'PUBLIC')").run(receipt.item_id, SOURCE_ID, NOW, NOW);
  db.sqlite.prepare("INSERT INTO press_ephemeral_policy (source_id, fingerprint_retention_allowed, policy_version) VALUES (?, 1, 1)").run(SOURCE_ID);
  await recordBodyFingerprint(db, receipt, NOW);
  const row = await new McpData(db, async () => new Map()).newsItem(receipt.item_id);
  assert.ok(row, "공개 보도자료로 조회된다");
  const dto = JSON.stringify(toPressDto(row));
  assert.ok(!dto.includes("a".repeat(64)) && !dto.includes("fingerprint"));
});
