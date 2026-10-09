import assert from "node:assert/strict";
import test from "node:test";

import { reviewPressClassification } from "./press/admin.ts";
import {
  advanceAutoClassification, assessTitle, loadConsistentModel, modelId, planAutoModelReevaluation, readReevalState, readTrainingRevision,
  stepAutoModelReevaluation, trainTitleModel,
} from "./press/auto-classify.ts";
import { DICTIONARY_VERSION } from "./press/dictionary.ts";
import { NOW, SOURCE_ID, database } from "./press-test-support.mjs";

// D-01·D-02(2026-10-09): 근거가 부족한 학습 판정은 확정하지 않고, 학습자료가 바뀌면 모델 식별자가 바뀌며, 기존 자동확정은 별도로 재평가한다.
// 아래 제목들은 회귀시험용 합성 자료다.

function insert(db, id, title, status, basis, extra = {}) {
  db.sqlite.prepare(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status, duplicate_group_id, auto_signature, auto_score, rule_classification_status, rule_categories) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'org:mohw', '2026-10-01', 'DAY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, SOURCE_ID, id, "https://www.mohw.go.kr/" + id, title, extra.hash ?? "h-" + id, NOW, NOW, extra.categories ?? "[]", status, basis, DICTIONARY_VERSION,
    extra.public ?? (status === "WELFARE" ? "PUBLIC" : "HIDDEN"), extra.group ?? null, extra.signature ?? "", extra.score ?? null, extra.ruleStatus ?? "", extra.ruleCategories ?? "");
}
const row = (db, id) => db.sqlite.prepare("SELECT classification_status AS status, classification_basis AS basis, public_status, auto_score, auto_signature, auto_reason FROM press_item WHERE item_id = ?").get(id);
const welfareTitles = (n, prefix = "w") => Array.from({ length: n }, (_, i) => [prefix + i, "주민 이웃돕기 성금 기탁 " + i]);
const otherTitles = (n, prefix = "n") => Array.from({ length: n }, (_, i) => [prefix + i, "특례시 지원 특별법 제정 촉구 결의대회 " + i]);

test("T01 복지 제목 60건만 학습한 뒤 알려진 특징이 없는 제목은 자동공개하지 않고 사유와 함께 보류한다", async () => {
  const db = database();
  for (const [id, title] of welfareTitles(60)) insert(db, id, title, "WELFARE", "title_rule");
  insert(db, "pending", "청소년 교향악단 모집", "NEEDS_REVIEW", "title_rule");
  await advanceAutoClassification(db, NOW + 10);
  const pending = row(db, "pending");
  assert.deepEqual([pending.status, pending.public_status], ["NEEDS_REVIEW", "HIDDEN"]);
  assert.match(pending.auto_reason, /^CLASS_DATA_SHORT/);
  assert.ok(pending.auto_score > 4, "감사 재현 조건(사전확률 log(61) > 4)이 그대로여도 확정하지 않는다");
});

test("T01 반대 방향 쏠림(비복지만 60건)도 확정하지 않는다", async () => {
  const db = database();
  for (const [id, title] of otherTitles(60)) insert(db, id, title, "NON_WELFARE", "title_rule");
  insert(db, "pending", "청소년 교향악단 모집", "NEEDS_REVIEW", "title_rule");
  await advanceAutoClassification(db, NOW + 10);
  assert.equal(row(db, "pending").status, "NEEDS_REVIEW");
  assert.match(row(db, "pending").auto_reason, /^CLASS_DATA_SHORT/);
});

test("T01 클래스 자료가 충분해도 알려진 특징 0개인 제목은 보류하고, 충분한 근거가 있는 제목은 확정한다", async () => {
  const db = database();
  for (const [id, title] of welfareTitles(40)) insert(db, id, title, "WELFARE", "title_rule");
  for (const [id, title] of otherTitles(40)) insert(db, id, title, "NON_WELFARE", "title_rule");
  insert(db, "unknown", "청소년 교향악단 모집", "NEEDS_REVIEW", "title_rule");
  insert(db, "clear", "특례시 지원 특별법 공포 사업", "NEEDS_REVIEW", "title_rule");
  const result = await advanceAutoClassification(db, NOW + 10);
  assert.equal(row(db, "unknown").status, "NEEDS_REVIEW");
  assert.match(row(db, "unknown").auto_reason, /^KNOWN_FEATURES_ZERO/);
  assert.deepEqual([row(db, "clear").status, row(db, "clear").basis], ["NON_WELFARE", "auto_model"]);
  assert.match(row(db, "clear").auto_reason, /^DECIDED/);
  assert.equal(result.holdReasons.KNOWN_FEATURES_ZERO, 1);
});

test("T01 임계값 경계와 사전확률만으로 넘는 점수는 확정하지 않는다", () => {
  const base = { groups: { welfare: 50, other: 50 }, totals: { welfare: 100, other: 100 }, vocabulary: 10, signature: "t" };
  const counts = (w, o) => ({ welfare: new Map([["w:가나", w], ["가나", w]]), other: new Map([["w:가나", o], ["가나", o]]) });
  const below = assessTitle({ ...base, docs: { welfare: 10, other: 10 }, counts: counts(6, 0) }, "가나");
  assert.ok(below.score < 4 && below.score > 3.8);
  assert.equal(below.decision, null);
  assert.match(below.reason, /^SCORE_BELOW_THRESHOLD/);
  const above = assessTitle({ ...base, docs: { welfare: 10, other: 10 }, counts: counts(7, 0) }, "가나");
  assert.ok(above.score >= 4);
  assert.equal(above.decision, "WELFARE");
  const priorDriven = assessTitle({ ...base, docs: { welfare: 1000, other: 10 }, counts: counts(2, 1) }, "가나");
  assert.ok(priorDriven.score >= 4 && Math.abs(priorDriven.evidence) < 3);
  assert.equal(priorDriven.decision, null);
  assert.match(priorDriven.reason, /^EVIDENCE_WEAK/);
});

test("T02 같은 기사 묶음·같은 제목이 대량으로 들어와도 독립 학습량은 한 그룹이며, 묶음 안 판정이 엇갈리면 학습에서 뺀다", async () => {
  const db = database();
  for (let i = 0; i < 200; i += 1) insert(db, "dup" + String(i).padStart(3, "0"), "주민 이웃돕기 성금 기탁 대량", "WELFARE", "title_rule", { group: "dg:flood" });
  for (const [id, title] of welfareTitles(29)) insert(db, id, title, "WELFARE", "title_rule");
  for (const [id, title] of otherTitles(30)) insert(db, id, title, "NON_WELFARE", "title_rule");
  insert(db, "same-title-a", "같은 제목 보도자료", "WELFARE", "title_rule", { hash: "same" });
  insert(db, "same-title-b", "같은 제목 보도자료", "WELFARE", "title_rule", { hash: "same" });
  insert(db, "split-a", "엇갈린 묶음 제목", "WELFARE", "title_rule", { group: "dg:split" });
  insert(db, "split-b", "엇갈린 묶음 제목", "NON_WELFARE", "title_rule", { group: "dg:split" });
  const loaded = await loadConsistentModel(db);
  assert.deepEqual(loaded.model.groups, { welfare: 31, other: 30 }, "대량 묶음 1 + 다른 제목 29 + 같은 제목 1");
  assert.equal(loaded.training.rows.length, 61);
  assert.deepEqual(loaded.training.conflicts.map((conflict) => conflict.group), ["dg:split"]);
});

test("T03 행 수가 같은 사람 판정 수정·제목 변경·중복 묶음 변경·삭제는 학습자료 판본과 모델 식별자를 바꾸고 보류 항목을 다시 평가한다", async () => {
  const db = database();
  for (const [id, title] of welfareTitles(30)) insert(db, id, title, "WELFARE", "title_rule");
  for (const [id, title] of otherTitles(30)) insert(db, id, title, "NON_WELFARE", "title_rule");
  insert(db, "human", "관리자 확정 제목", "WELFARE", "reviewer");
  insert(db, "pending", "지역 사업 설명회", "NEEDS_REVIEW", "title_rule");
  await advanceAutoClassification(db, NOW + 10);
  const firstSignature = row(db, "pending").auto_signature;
  assert.equal(firstSignature, modelId(await readTrainingRevision(db)));
  assert.equal((await advanceAutoClassification(db, NOW + 20)).modelChecked, 0, "자료가 그대로면 다시 보지 않는다");

  const countBefore = db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item WHERE classification_basis IN ('reviewer', 'title_rule') AND classification_status IN ('WELFARE', 'NON_WELFARE')").get().n;
  assert.equal(await reviewPressClassification(db, "human", "NON_WELFARE", [], NOW + 30), "ok");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item WHERE classification_basis IN ('reviewer', 'title_rule') AND classification_status IN ('WELFARE', 'NON_WELFARE')").get().n, countBefore, "행 수는 같다");
  const again = await advanceAutoClassification(db, NOW + 40);
  assert.equal(again.modelChecked, 1, "사람 판정 수정 뒤 보류 항목을 다시 평가한다");
  assert.notEqual(row(db, "pending").auto_signature, firstSignature);

  const bumps = [
    ["제목 변경", "UPDATE press_item SET title = '주민 이웃돕기 성금 기탁 수정', title_hash = 'changed' WHERE item_id = 'w0'"],
    ["중복 묶음 변경", "UPDATE press_item SET duplicate_group_id = 'dg:new' WHERE item_id = 'w1'"],
    ["학습 대상에서 빠짐", "UPDATE press_item SET classification_status = 'NEEDS_REVIEW' WHERE item_id = 'w2'"],
    ["삭제", "DELETE FROM press_item WHERE item_id = 'w3'"],
  ];
  for (const [label, sql] of bumps) {
    const before = await readTrainingRevision(db);
    db.sqlite.exec(sql);
    assert.ok(await readTrainingRevision(db) > before, label);
  }
  const stable = await readTrainingRevision(db);
  db.sqlite.exec("UPDATE press_item SET public_status = 'HIDDEN', categories = '[\"women\"]' WHERE item_id = 'w5'");
  db.sqlite.exec("UPDATE press_item SET auto_score = 1.5 WHERE item_id = 'pending'");
  assert.equal(await readTrainingRevision(db), stable, "학습 내용과 무관한 변경은 판본을 올리지 않는다");
});

function reevalFixture() {
  const db = database();
  for (const [id, title] of welfareTitles(40)) insert(db, id, title, "WELFARE", "title_rule");
  for (const [id, title] of otherTitles(40)) insert(db, id, title, "NON_WELFARE", "title_rule");
  const old = { signature: "nb2:press-dict:61:1", score: 4.11, ruleStatus: "NEEDS_REVIEW", ruleCategories: "[]" };
  insert(db, "a-keep", "특례시 지원 특별법 공포 사업", "NON_WELFARE", "auto_model", old);
  insert(db, "b-flip", "주민 이웃돕기 성금 전달 행사", "NON_WELFARE", "auto_model", { ...old, score: -4.2 });
  insert(db, "c-review", "관현악 연주 일정", "WELFARE", "auto_model", { ...old, categories: '["other_welfare"]', public: "PUBLIC" });
  insert(db, "d-review", "교향악단 정기 공연", "WELFARE", "auto_model", { ...old, categories: '["other_welfare"]', public: "PUBLIC" });
  insert(db, "e-review", "합창 공연 일정", "WELFARE", "auto_model", { ...old, categories: '["other_welfare"]', public: "PUBLIC" });
  insert(db, "f-withdrawn", "청소년 교향악단 단원 모집", "WELFARE", "auto_model", { ...old, public: "WITHDRAWN" });
  insert(db, "g-reviewer", "청소년 오케스트라 모집", "WELFARE", "reviewer");
  return db;
}

test("T04 기존 자동확정 dry-run은 유지·분류 변경·검토 전환을 나누고, 관리자 확정·철회 자료는 대상에서 뺀다", async () => {
  const db = reevalFixture();
  const plan = await planAutoModelReevaluation(db);
  const actions = Object.fromEntries(plan.rows.map((item) => [item.item_id, item.action]));
  assert.deepEqual(actions, { "a-keep": "keep", "b-flip": "direction_changed", "c-review": "to_review", "d-review": "to_review", "e-review": "to_review" });
  assert.equal(plan.protectedWithdrawn, 1);
  assert.ok(plan.protectedReviewer >= 1);
  assert.equal(row(db, "c-review").status, "WELFARE", "dry-run은 쓰지 않는다");
  const flip = plan.rows.find((item) => item.item_id === "b-flip");
  assert.deepEqual([flip.before.status, flip.modelDecision, flip.after.status, flip.after.public_status], ["NON_WELFARE", "WELFARE", "NEEDS_REVIEW", "HIDDEN"], "방향이 바뀌는 사례도 전환표에 넣되 자동으로 뒤집지 않고 검토로 보낸다");
  assert.match(flip.reason, /^MODEL_DIRECTION_CHANGED/);
});

test("T04 재평가는 중단·재개해도 대상을 한 번씩만 처리하고, 처리 중 관리자 확정·철회·학습자료 변경을 보호한다", async () => {
  const db = reevalFixture();
  let counter = 0;
  const newId = () => "run-" + (++counter);
  const first = await stepAutoModelReevaluation(db, NOW + 100, newId, 2);
  assert.deepEqual([first.status, first.processed, first.state.cursor], ["STEPPED", 2, "b-flip"]);
  // 중단된 사이 관리자가 남은 대상 하나를 확정하고, 다른 하나는 철회한다.
  assert.equal(await reviewPressClassification(db, "d-review", "WELFARE", ["culture_leisure"].filter(() => false).concat(["other_welfare"]), NOW + 110), "ok");
  db.sqlite.exec("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE item_id = 'e-review'");
  // 관리자 확정은 학습자료를 바꾸므로 실행 중 모델이 달라진다 → 멈추고 아무것도 쓰지 않는다.
  const changed = await stepAutoModelReevaluation(db, NOW + 120, newId, 2);
  assert.equal(changed.status, "MODEL_CHANGED");
  assert.equal(row(db, "c-review").status, "WELFARE");
  // 운영자가 새 실행으로 다시 시작(이전 실행 기록은 남는다).
  const state = await readReevalState(db);
  db.sqlite.prepare("UPDATE app_setting SET value = ? WHERE key = 'press_auto_reeval'").run(JSON.stringify({ ...state, done: true }));
  let step;
  do step = await stepAutoModelReevaluation(db, NOW + 130, newId, 2); while (step.status === "STEPPED");
  assert.equal(step.status, "DONE");
  const perRun = db.sqlite.prepare("SELECT run_id, item_id, COUNT(*) AS n FROM press_auto_reeval_log WHERE outcome = 'applied' GROUP BY run_id, item_id").all();
  assert.ok(perRun.every((item) => item.n === 1), "한 실행 안에서 같은 항목을 두 번 적용하지 않는다");
  const byRun = {};
  for (const item of perRun) (byRun[item.run_id] ??= []).push(item.item_id);
  assert.deepEqual(byRun["run-1"], ["a-keep", "b-flip"]);
  assert.deepEqual(byRun["run-2"], ["a-keep", "c-review"], "새 모델로 시작한 실행은 아직 학습 판정으로 남은 항목만 다시 본다(검토로 보낸 항목·관리자 확정·철회 제외)");
  assert.deepEqual([row(db, "a-keep").status, row(db, "b-flip").status, row(db, "b-flip").public_status], ["NON_WELFARE", "NEEDS_REVIEW", "HIDDEN"]);
  const pendingAgain = await advanceAutoClassification(db, NOW + 150);
  assert.equal(row(db, "b-flip").status, "NEEDS_REVIEW", "방향이 바뀐 항목은 사람이 확정할 때까지 자동 판정하지 않는다");
  assert.ok(pendingAgain.modelChecked >= 0);
  assert.deepEqual([row(db, "c-review").status, row(db, "c-review").basis, row(db, "c-review").public_status], ["NEEDS_REVIEW", "title_rule", "HIDDEN"]);
  assert.deepEqual([row(db, "d-review").basis, row(db, "d-review").status], ["reviewer", "WELFARE"], "처리 중 관리자 확정을 보존한다");
  assert.deepEqual([row(db, "e-review").public_status, row(db, "e-review").basis], ["WITHDRAWN", "auto_model"], "처리 중 철회를 보존한다");
  assert.deepEqual([row(db, "f-withdrawn").public_status, row(db, "f-withdrawn").auto_signature], ["WITHDRAWN", "nb2:press-dict:61:1"]);
  assert.equal(row(db, "g-reviewer").basis, "reviewer");
  const rerun = await stepAutoModelReevaluation(db, NOW + 140, newId, 2);
  assert.deepEqual([rerun.status, rerun.processed], ["DONE", 0], "같은 모델로 다시 돌려도 중복 적용하지 않는다");
});

test("T04 읽은 뒤 바뀐 항목은 충돌로 건너뛰고 이전 값을 기록한다", async () => {
  const db = reevalFixture();
  const batch = db.batch.bind(db);
  let injected = false;
  db.batch = async (statements) => {
    if (!injected && statements.some((statement) => statement.sql.startsWith("UPDATE press_item SET auto_score"))) {
      injected = true;
      db.sqlite.exec("UPDATE press_item SET title = '바뀐 제목', title_hash = 'changed' WHERE item_id = 'a-keep'");
    }
    return batch(statements);
  };
  const step = await stepAutoModelReevaluation(db, NOW + 100, () => "run-x", 10);
  assert.equal(step.state.counts.conflict, 1);
  const log = db.sqlite.prepare("SELECT outcome, before_status, before_signature FROM press_auto_reeval_log WHERE item_id = 'a-keep'").get();
  assert.deepEqual({ ...log }, { outcome: "conflict", before_status: "NON_WELFARE", before_signature: "nb2:press-dict:61:1" });
  assert.equal(row(db, "a-keep").auto_signature, "nb2:press-dict:61:1");
});

test("모델 학습은 그룹 표시가 없는 이전 호출 방식도 그대로 받는다", () => {
  const model = trainTitleModel([{ title: "이웃돕기 성금", welfare: true, weight: 1 }, { title: "특별법 제정", welfare: false, weight: 1 }], "t");
  assert.deepEqual(model.groups, { welfare: 1, other: 1 });
});
