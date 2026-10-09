import assert from "node:assert/strict";
import test from "node:test";

import { reviewPressClassification } from "./press/admin.ts";
import { rollbackAutoReevaluation, stepAutoModelReevaluation } from "./press/auto-classify.ts";
import { DICTIONARY_VERSION } from "./press/dictionary.ts";
import { applyLinkRules, rollbackLinkRuleDecisions } from "./platform/link-rules.ts";
import { reviewLink } from "./platform/links.ts";
import { NOW, SOURCE_ID, database } from "./press-test-support.mjs";

// T12(2026-10-09): 격리된 DB(모든 마이그레이션을 적용한 SQLite 복사본)에서 데이터 변경 → 중단·재개 → 이후 사람 수정·철회·신규 자료 → 복구.
// 복구는 이번 작업이 바꾼 행만 되돌리고, 이후 사람 수정·철회·신규 자료는 덮어쓰지 않고 충돌로 남긴다. 합성 자료.

function press(db, id, title, status, basis, extra = {}) {
  db.sqlite.prepare(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status, auto_signature, auto_score, rule_classification_status, rule_categories) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'org:mohw', '2026-10-01', 'DAY', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEEDS_REVIEW', '[]')",
  ).run(id, SOURCE_ID, id, "https://www.mohw.go.kr/" + id, title, "h-" + id, NOW, NOW, extra.categories ?? "[]", status, basis, DICTIONARY_VERSION, extra.public ?? (status === "WELFARE" ? "PUBLIC" : "HIDDEN"), extra.signature ?? "", extra.score ?? null);
}

test("T12 기존 자동확정 재평가: 중단·재개 뒤 복구하면 이번 실행이 바꾼 행만 되돌리고 이후 관리자 확정·철회·신규 자료는 보존한다", async () => {
  const db = database();
  for (let i = 0; i < 40; i += 1) press(db, "w" + i, "주민 이웃돕기 성금 기탁 " + i, "WELFARE", "title_rule");
  for (let i = 0; i < 40; i += 1) press(db, "n" + i, "특례시 지원 특별법 제정 촉구 결의대회 " + i, "NON_WELFARE", "title_rule");
  const old = { signature: "nb2:old", score: 4.2 };
  press(db, "a", "관현악 연주 일정", "WELFARE", "auto_model", { ...old, categories: '["other_welfare"]' });
  press(db, "b", "합창 공연 일정", "WELFARE", "auto_model", { ...old, categories: '["other_welfare"]' });
  press(db, "c", "특례시 지원 특별법 공포 사업", "NON_WELFARE", "auto_model", { ...old, score: -4.2 });
  press(db, "d", "교향악단 정기 공연", "WELFARE", "auto_model", { ...old, categories: '["other_welfare"]' });
  const snapshot = (id) => ({ ...db.sqlite.prepare("SELECT classification_status, classification_basis, public_status, auto_signature, categories FROM press_item WHERE item_id = ?").get(id) });
  const before = Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, snapshot(id)]));

  const first = await stepAutoModelReevaluation(db, NOW + 100, () => "run-1", 2);
  assert.equal(first.status, "STEPPED", "중단(2건만 처리)");
  const resumed = await stepAutoModelReevaluation(db, NOW + 110, () => "unused", 10);
  assert.equal(resumed.status, "DONE", "같은 실행으로 이어서 끝까지");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_auto_reeval_log WHERE run_id = 'run-1' AND outcome = 'applied'").get().n, 4);

  // 이후 변경: 관리자 확정(b), 철회(d), 신규 자료(e).
  assert.equal(await reviewPressClassification(db, "b", "WELFARE", ["other_welfare"], NOW + 200), "ok");
  db.sqlite.exec("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE item_id = 'd'");
  press(db, "e", "새로 들어온 제목", "NEEDS_REVIEW", "title_rule");
  const later = { b: snapshot("b"), e: snapshot("e") };

  const rollback = await rollbackAutoReevaluation(db, "run-1");
  assert.deepEqual([...rollback.conflicts].sort(), ["b"], "관리자 확정 뒤 항목은 되돌리지 않는다");
  assert.equal(rollback.restored, 3);
  assert.deepEqual(snapshot("a"), before.a);
  assert.deepEqual(snapshot("c"), before.c);
  assert.deepEqual({ ...snapshot("d"), public_status: before.d.public_status }, before.d, "철회 외 값은 원래대로");
  assert.equal(snapshot("d").public_status, "WITHDRAWN", "철회는 유지");
  assert.deepEqual(snapshot("b"), later.b);
  assert.deepEqual(snapshot("e"), later.e, "신규 자료는 건드리지 않는다");
});

test("T12 연결 자동 판정 복구: 자동 규칙이 바꾼 연결만 되돌리고, 이후 관리자 판정은 충돌로 남긴다", async () => {
  const db = database();
  db.sqlite.prepare("INSERT OR REPLACE INTO fiscal_region_mapping (mapping_id, fiscal_entity_id, region_id, relation, basis, verification_status) VALUES ('map:jeju', 'lofin:laf:4900000', 'region:제주특별자치도', 'jurisdiction', '시험', 'VERIFIED')").run();
  const fiscal = (id, name) => db.sqlite.prepare("INSERT INTO fiscal_project (fiscal_project_id, fiscal_year, fiscal_entity_id, account_code, account_name, department_code, dbiz_code, name, field_code, field_name, part_code, part_name, first_seen_at, last_seen_at) VALUES (?, '2026', 'lofin:laf:4900000', '100', '일반회계', '1', ?, ?, '080', '사회복지', '081', 'x', 0, 0)").run(id, id, name);
  const link = (id, source, target, fiscalName, programName) => db.sqlite.prepare("INSERT INTO cross_domain_link (link_id, source_type, source_id, target_type, target_id, relation, evidence_json, mapping_version, verification_status, public_status, candidate_basis, created_at) VALUES (?, 'fiscal_project', ?, 'implementation', ?, 'fiscalProjectFor', ?, 'v', 'CANDIDATE', 'HIDDEN', 'x', 1)")
    .run(id, source, target, JSON.stringify({ fiscal_project_name: fiscalName, program_name: programName, region_mapping: "map:jeju" }));
  fiscal("fp:1", "치매안심센터 운영");
  fiscal("fp:2", "노인맞춤돌봄서비스");
  link("l1", "fp:1", "service:1|제주특별자치도|제주특별자치도|a|b|c", "치매안심센터 운영", "치매안심센터");
  link("l2", "fp:2", "service:2|제주특별자치도|제주특별자치도|a|b|c", "노인맞춤돌봄서비스", "노인맞춤돌봄서비스");
  const mark = db.sqlite.prepare("SELECT COALESCE(MAX(log_id), 0) AS id FROM cross_domain_link_decision_log").get().id;
  const applied = await applyLinkRules(db, 100);
  assert.equal(applied.verified, 2);
  assert.equal(await reviewLink(db, "l2", "reject", 200), true);
  const result = await rollbackLinkRuleDecisions(db, mark);
  assert.deepEqual(result.conflicts, ["l2"]);
  const row = (id) => ({ ...db.sqlite.prepare("SELECT verification_status, public_status, decision_origin, reviewed_at FROM cross_domain_link WHERE link_id = ?").get(id) });
  assert.deepEqual(row("l1"), { verification_status: "CANDIDATE", public_status: "HIDDEN", decision_origin: "", reviewed_at: null });
  assert.deepEqual(row("l2"), { verification_status: "REJECTED", public_status: "HIDDEN", decision_origin: "reviewer", reviewed_at: 200 });
});
