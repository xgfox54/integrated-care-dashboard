import assert from "node:assert/strict";
import test from "node:test";

import { reviewPressClassification } from "./press/admin.ts";
import { advanceAutoClassification, trainTitleModel, welfareLogOdds } from "./press/auto-classify.ts";
import { classifyTitle } from "./press/classify.ts";
import { DICTIONARY_VERSION } from "./press/dictionary.ts";
import { NOW, SOURCE_ID, database } from "./press-test-support.mjs";

test("2단계 제목 단서: 복지 단서만 있으면 복지, 비복지 단서만 있으면 비복지, 대상 집단 말만 있으면 검토", () => {
  assert.deepEqual(classifyTitle("새마을부녀회, 추석맞이 이웃돕기 성품 기탁").categories, ["other_welfare"]);
  assert.equal(classifyTitle("새마을부녀회, 추석맞이 이웃돕기 성품 기탁").status, "WELFARE");
  assert.equal(classifyTitle("부산시, 세계디자인수도 국제공모전 개최").status, "NON_WELFARE");
  assert.equal(classifyTitle("청년 정책 아이디어 모집").status, "NEEDS_REVIEW");
  assert.equal(classifyTitle("청년 창업 지원센터 입주기업 모집").status, "NON_WELFARE");
  assert.ok(classifyTitle("구미형 청년월세 지원 추가 모집").categories.includes("young_adult"));
  assert.ok(classifyTitle("광명여성새로일하기센터, 여성 취업 교육").categories.includes("women"));
  assert.equal(classifyTitle("영양군, 서울광장서 고추 축제 개막").status, "NON_WELFARE", "지명 영양군은 복지 단서가 아니다");
  assert.equal(classifyTitle("양평군청 직장운동경기부 유도 동메달 획득").status, "NON_WELFARE", "경기부의 '기부'를 기부로 보지 않는다");
  assert.equal(classifyTitle("강원특별자치도, 농업재해 예방 및 정책보험지원").status, "NON_WELFARE");
  assert.equal(classifyTitle("농가 취약계층 긴급복지 지원").status, "WELFARE", "명확한 복지 내용은 농업 단서만으로 숨기지 않는다");
});

test("학습 판정은 확신이 큰 쪽으로 기운다", () => {
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => ({ title: "이웃돕기 성금 기탁 " + index, welfare: true, weight: 1 })),
    ...Array.from({ length: 20 }, (_, index) => ({ title: "특례시 지원 특별법 제정 촉구 " + index, welfare: false, weight: 1 })),
  ];
  const model = trainTitleModel(rows, "t");
  assert.ok(welfareLogOdds(model, "주민 이웃돕기 성금 전달") > 4);
  assert.ok(welfareLogOdds(model, "특례시 특별법 공포") < -4);
});

function insert(db, id, title, status, basis, version = DICTIONARY_VERSION) {
  db.sqlite.prepare(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
      "VALUES (?, ?, ?, ?, ?, 'h', 'org:mohw', '2026-10-01', 'DAY', ?, ?, '[]', ?, ?, ?, ?)",
  ).run(id, SOURCE_ID, id, "https://www.mohw.go.kr/" + id, title, NOW, NOW, status, basis, version, status === "WELFARE" ? "PUBLIC" : "HIDDEN");
}

test("배경 자동분류: 옛 사전 항목은 다시 분류하고, 검토 대기는 학습 판정으로 확정·추천하며, 관리자가 다시 바꿀 수 있다", async () => {
  const db = database();
  for (let index = 0; index < 30; index += 1) insert(db, "w" + index, "주민 이웃돕기 성금 기탁 " + index, "WELFARE", "title_rule");
  for (let index = 0; index < 30; index += 1) insert(db, "n" + index, "특례시 지원 특별법 제정 촉구 결의대회 " + index, "NON_WELFARE", "title_rule");
  insert(db, "old", "제21회 임산부의 날 기념행사", "NON_WELFARE", "title_rule", "press-dict-2026-10-04");
  insert(db, "pending-non", "특례시 지원 특별법 공포 사업", "NEEDS_REVIEW", "title_rule");
  insert(db, "pending-mixed", "지역 사업 설명회", "NEEDS_REVIEW", "title_rule");
  insert(db, "pending-old", "특례시 지원 특별법 공포 사업 안내", "NEEDS_REVIEW", "title_rule", "press-dict-2026-10-04");
  insert(db, "kept", "관리자가 정한 항목", "NON_WELFARE", "reviewer");

  const result = await advanceAutoClassification(db, NOW + 10);
  const row = (id) => db.sqlite.prepare("SELECT classification_status AS status, classification_basis AS basis, categories, public_status, auto_score, auto_signature FROM press_item WHERE item_id = ?").get(id);
  assert.equal(result.reclassified, 2);
  const oldAfterFirst = row("pending-old");
  assert.deepEqual([row("old").status, row("old").public_status, row("old").categories], ["WELFARE", "PUBLIC", '["women"]'], "새 사전의 '여성' 분야로 다시 분류된다");
  assert.equal(row("pending-non").status, "NON_WELFARE");
  assert.equal(row("pending-non").basis, "auto_model");
  assert.ok(row("pending-non").auto_score < -4);
  assert.equal(row("kept").basis, "reviewer", "관리자 확정은 건드리지 않는다");
  const mixed = row("pending-mixed");
  if (mixed.status === "NEEDS_REVIEW") assert.notEqual(mixed.auto_signature, "", "확정하지 못한 항목도 추천값을 남긴다");

  const again = await advanceAutoClassification(db, NOW + 20);
  assert.equal(again.modelChecked, 0, "같은 학습 상태로 다시 보지 않는다");
  assert.equal(again.reclassified, 0);
  assert.deepEqual([row("pending-old").status, row("pending-old").basis], [oldAfterFirst.status, oldAfterFirst.basis], "다음 차례의 사전 재분류가 학습 판정 결과를 되돌리지 않는다");
  assert.equal(await reviewPressClassification(db, "pending-non", "WELFARE", ["other_welfare"], NOW + 30), "ok", "학습 판정 결과를 관리자가 다시 확정할 수 있다");
  assert.deepEqual([row("pending-non").basis, row("pending-non").public_status], ["reviewer", "PUBLIC"]);
});
