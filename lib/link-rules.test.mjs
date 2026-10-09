import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyLinkRules, judgeLink, planLinkRules } from "./platform/link-rules.ts";
import { reviewLink } from "./platform/links.ts";
import { database } from "./press-test-support.mjs";

// D-03(2026-10-09): 연결 규칙은 적용 범위(재정주체·회계연도·검증 매핑 지역·대상 시·도) 안에서만 확정하고, 사람 판정을 덮어쓰지 않는다.
// 아래 수원 사례는 회귀시험용 합성 자료이며 해당 사업들의 실제 연결 적정성을 판정한 것이 아니다.

const JEJU = { fiscalEntityId: "lofin:laf:4900000", fiscalYear: "2026", mappedSido: "제주특별자치도", targetSido: "제주특별자치도" };

test("연결 자동 판정은 사업명이 처음 맞는 규칙을 쓰되, 그 규칙의 적용 범위 안에서만 확정한다", () => {
  assert.equal(judgeLink("방문건강관리사업", "ICT 융합 방문건강관리사업(AI-IoT)", JEJU).decision, "reject");
  assert.equal(judgeLink("방문건강관리사업", "ICT 융합 방문건강관리사업(방문건강관리사업)", JEJU).decision, "verify");
  assert.equal(judgeLink("중증장애인 활동지원", "중증장애인 상해보험 가입", JEJU).decision, "reject");
  assert.equal(judgeLink("중증장애인 활동지원", "장애인 활동지원 서비스", JEJU).decision, "verify");
  assert.equal(judgeLink("제주형건강주치의 시범사업", "장애인 건강주치의 시범사업", JEJU).decision, "reject");
  assert.equal(judgeLink("여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", JEJU).decision, "verify");
  assert.equal(judgeLink("처음 보는 사업", "장애인 활동지원 서비스", JEJU).kind, "no_rule");
});

test("T05 제주 근거 규칙은 수원·다른 연도·검증 매핑 없는 연결을 확정하지 않는다", () => {
  const suwon = { fiscalEntityId: "lofin:laf:4111000", fiscalYear: "2026", mappedSido: "경기도", targetSido: "경기도" };
  const judged = judgeLink("여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", suwon);
  assert.equal(judged.kind, "out_of_scope");
  assert.match(judged.reason, /재정주체/);
  assert.equal(judgeLink("여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", { ...JEJU, fiscalYear: "2024" }).kind, "out_of_scope");
  assert.equal(judgeLink("여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", { ...JEJU, mappedSido: null }).kind, "out_of_scope");
  assert.equal(judgeLink("여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", { ...JEJU, targetSido: "경기도" }).kind, "out_of_scope", "대상 사업 시·도가 다르면 확정하지 않는다");
  assert.equal(judgeLink("여성장애인 돌봄 지원", "여성장애인 가사도우미 지원").kind, "out_of_scope", "범위를 모르면 확정하지 않는다");
  assert.equal(judgeLink("장애인 보조기기 대여센터 운영", "장애인 보조기기 교부", suwon).kind, "out_of_scope", "다음 규칙으로 넘어가 다른 판정을 내리지 않는다");
});

function fiscal(db, id, entity, year, name) {
  db.sqlite.prepare("INSERT INTO fiscal_project (fiscal_project_id, fiscal_year, fiscal_entity_id, account_code, account_name, department_code, dbiz_code, name, field_code, field_name, part_code, part_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, '100', '일반회계', '1', ?, ?, '080', '사회복지', '081', '기초생활보장', 0, 0)")
    .run(id, year, entity, id, name);
}
function mapping(db, id, entity, region, status = "VERIFIED") {
  db.sqlite.prepare("INSERT OR REPLACE INTO fiscal_region_mapping (mapping_id, fiscal_entity_id, region_id, relation, basis, verification_status) VALUES (?, ?, ?, 'jurisdiction', '시험', ?)").run(id, entity, region, status);
}
function link(db, id, source, target, fiscalName, programName, mappingId, status = "CANDIDATE", extra = {}) {
  db.sqlite.prepare("INSERT INTO cross_domain_link (link_id, source_type, source_id, target_type, target_id, relation, evidence_json, mapping_version, verification_status, public_status, candidate_basis, created_at, reviewed_at, decision_origin) VALUES (?, 'fiscal_project', ?, 'implementation', ?, 'fiscalProjectFor', ?, 'fiscal-program-name-v1', ?, ?, '이름 유사도', 1, ?, ?)")
    .run(id, source, target, JSON.stringify({ fiscal_project_name: fiscalName, program_name: programName, region_mapping: mappingId, ...(extra.evidence ?? {}) }), status, status === "VERIFIED" ? "PUBLIC" : "HIDDEN", extra.reviewedAt ?? null, extra.origin ?? "");
}
const row = (db, id) => db.sqlite.prepare("SELECT verification_status AS status, public_status, decision_origin AS origin, decision_revision AS revision, evidence_json FROM cross_domain_link WHERE link_id = ?").get(id);
const logs = (db) => db.sqlite.prepare("SELECT COUNT(*) AS n FROM cross_domain_link_decision_log").get().n;

function fixture() {
  const db = database();
  fiscal(db, "fp:2026:4111000:100:1:SW", "lofin:laf:4111000", "2026", "여성장애인 돌봄 지원");
  fiscal(db, "fp:2026:4900000:100:1:JJ", "lofin:laf:4900000", "2026", "여성장애인 돌봄 지원");
  mapping(db, "map:test-suwon", "lofin:laf:4111000", "region:경기도|수원시");
  mapping(db, "map:test-jeju", "lofin:laf:4900000", "region:제주특별자치도");
  link(db, "suwon", "fp:2026:4111000:100:1:SW", "service:1|경기도|수원시|장애지원|돌봄|여성장애인가사도우미지원", "여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", "map:test-suwon");
  link(db, "jeju", "fp:2026:4900000:100:1:JJ", "service:2|제주특별자치도|제주특별자치도|장애지원|돌봄|여성장애인가사도우미지원", "여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", "map:test-jeju");
  return db;
}

test("T05·T06 사람이 제외한 수원 연결은 자동 규칙을 반복 실행해도 제외로 남고, 범위가 맞는 제주 연결만 확정된다", async () => {
  const db = fixture();
  assert.equal(await reviewLink(db, "suwon", "reject", 100), true);
  const first = await applyLinkRules(db, 200);
  assert.deepEqual([row(db, "suwon").status, row(db, "suwon").public_status, row(db, "suwon").origin], ["REJECTED", "HIDDEN", "reviewer"]);
  assert.doesNotMatch(row(db, "suwon").evidence_json, /제주 사업 공고/);
  assert.deepEqual([row(db, "jeju").status, row(db, "jeju").public_status, row(db, "jeju").origin], ["VERIFIED", "PUBLIC", "auto_rule"]);
  assert.equal(JSON.parse(row(db, "jeju").evidence_json).auto_review.scope_id, "scope:jeju-laf-4900000:2025-2026");
  assert.deepEqual([first.verified, first.protected_reviewer, first.conflicts.length], [1, 1, 0]);
  const logCount = logs(db);
  assert.equal(logCount, 2, "사람 판정 1건 + 자동 판정 1건");
  const again = await applyLinkRules(db, 300);
  assert.deepEqual([again.verified, again.rejected, again.reverted, again.unchanged], [0, 0, 0, 1], "다시 돌려도 바꿀 것이 없다");
  assert.equal(logs(db), logCount, "이력이 늘지 않는다");
  assert.equal(row(db, "jeju").revision, 1);
});

test("T05 사람 판정이 없는 수원 후보는 제주 근거로 확정되지 않고 후보로 남는다", async () => {
  const db = fixture();
  const plan = await planLinkRules(db);
  assert.deepEqual(plan.changes.map((change) => change.link_id), ["jeju"]);
  assert.equal(plan.out_of_scope_candidates, 1);
  await applyLinkRules(db, 200);
  assert.deepEqual([row(db, "suwon").status, row(db, "suwon").public_status, row(db, "suwon").origin], ["CANDIDATE", "HIDDEN", ""]);
});

test("T06 자동 작업이 계획을 읽은 뒤 사람이 제외하면 늦게 도착한 자동 쓰기가 사람 판정을 덮어쓰지 않는다", async () => {
  const db = fixture();
  const plan = await planLinkRules(db);
  assert.equal(await reviewLink(db, "jeju", "reject", 150), true);
  const result = await applyLinkRules(db, 200, plan);
  assert.deepEqual(result.conflicts, ["jeju"]);
  assert.deepEqual([row(db, "jeju").status, row(db, "jeju").public_status, row(db, "jeju").origin], ["REJECTED", "HIDDEN", "reviewer"]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM cross_domain_link_decision_log WHERE actor = 'auto_rule'").get().n, 0, "실패한 자동 쓰기는 이력을 남기지 않는다");
});

test("자동 규칙이 범위 밖에 확정했던 연결은 후보(비공개)로 되돌리고, 출처 불명 자료는 그대로 둔다", async () => {
  const db = fixture();
  link(db, "suwon-auto", "fp:2026:4111000:100:1:SW", "service:3|경기도|수원시|장애지원|돌봄|여성장애인가사도우미지원2", "여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", "map:test-suwon", "VERIFIED", { origin: "auto_rule", reviewedAt: 90 });
  link(db, "suwon-legacy", "fp:2026:4111000:100:1:SW", "service:4|경기도|수원시|장애지원|돌봄|여성장애인가사도우미지원3", "여성장애인 돌봄 지원", "여성장애인 가사도우미 지원", "map:test-suwon", "VERIFIED", { origin: "legacy_unknown", reviewedAt: 90 });
  const plan = await planLinkRules(db);
  const revert = plan.changes.find((change) => change.link_id === "suwon-auto");
  assert.equal(revert.kind, "revert_to_candidate");
  assert.match(revert.reason, /적용 범위 밖/);
  assert.equal(plan.protected_legacy_unknown, 1);
  await applyLinkRules(db, 200, plan);
  assert.deepEqual([row(db, "suwon-auto").status, row(db, "suwon-auto").public_status, row(db, "suwon-auto").origin], ["CANDIDATE", "HIDDEN", ""]);
  assert.deepEqual([row(db, "suwon-legacy").status, row(db, "suwon-legacy").public_status, row(db, "suwon-legacy").origin], ["VERIFIED", "PUBLIC", "legacy_unknown"]);
  const log = db.sqlite.prepare("SELECT before_status, before_public, before_origin, before_reviewed_at, after_status FROM cross_domain_link_decision_log WHERE link_id = 'suwon-auto'").get();
  assert.deepEqual({ ...log }, { before_status: "VERIFIED", before_public: "PUBLIC", before_origin: "auto_rule", before_reviewed_at: 90, after_status: "CANDIDATE" }, "복구에 필요한 이전 값을 남긴다");
});

test("T07 기존 연결 출처 분류(0084)는 상태·공개·근거·검토 시각을 바꾸지 않고, 다시 실행해도 결과가 같다", () => {
  const db = fixture();
  const autoEvidence = { auto_review: { rule_version: "jeju-link-rules-2026-10-05", decision: "verify", reason: "x", previous_status: "CANDIDATE", at: 500 } };
  link(db, "legacy-auto", "fp:2026:4900000:100:1:JJ", "service:5|제주특별자치도|제주특별자치도|a|b|c", "치매안심센터 운영", "치매안심센터", "map:test-jeju", "VERIFIED", { reviewedAt: 500, evidence: autoEvidence });
  link(db, "legacy-human-after-auto", "fp:2026:4900000:100:1:JJ", "service:6|제주특별자치도|제주특별자치도|a|b|c", "치매안심센터 운영", "치매안심센터", "map:test-jeju", "REJECTED", { reviewedAt: 900, evidence: autoEvidence });
  link(db, "legacy-no-trace", "fp:2026:4900000:100:1:JJ", "service:7|제주특별자치도|제주특별자치도|a|b|c", "치매안심센터 운영", "치매안심센터", "map:test-jeju", "REJECTED", { reviewedAt: 400 });
  const snapshot = () => db.sqlite.prepare("SELECT link_id, verification_status, public_status, evidence_json, reviewed_at FROM cross_domain_link ORDER BY link_id").all().map((item) => ({ ...item }));
  const before = snapshot();
  const sql = readFileSync(new URL("../drizzle/0084_link_decision_origin_backfill.sql", import.meta.url), "utf8");
  const run = () => { for (const statement of sql.split("--> statement-breakpoint")) if (statement.trim()) db.sqlite.exec(statement); };
  run();
  const origins = () => Object.fromEntries(db.sqlite.prepare("SELECT link_id, decision_origin FROM cross_domain_link").all().map((item) => [item.link_id, item.decision_origin]));
  const first = origins();
  assert.deepEqual([first["legacy-auto"], first["legacy-human-after-auto"], first["legacy-no-trace"], first.jeju], ["auto_rule", "legacy_unknown", "legacy_unknown", ""]);
  run();
  assert.deepEqual(origins(), first);
  assert.deepEqual(snapshot(), before, "출처 표시만 채우고 상태·공개·근거·검토 시각은 그대로");
});
