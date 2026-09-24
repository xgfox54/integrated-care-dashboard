import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { repairExtractionSpacing } from "./official-spacing.ts";

const CORRECTIONS = JSON.parse(
  readFileSync(new URL("../data/official-spacing-corrections.json", import.meta.url), "utf8"),
);

test("PDF line wrapping spaces are removed from service names and descriptions", () => {
  const [service] = repairExtractionSpacing([
    {
      serviceId: "0083:1489622:1:1:4",
      sido: "강원특별자치도",
      sigungu: "강릉시",
      category: "보건의료",
      subcategory: "방문진료",
      name: "의료취약지 원격협 진",
      description: "원격협진 진료 원내처방 서비 스 및 보건교육",
      target: "노인",
      detailTarget: "",
      provider: "보건소",
      type: "전국",
      serial: "4",
      detailUrl: "https://www.mohw.go.kr/board.es?list_no=1489622",
      updatedDate: "2026-04",
    },
  ]);

  assert.equal(service.name, "의료취약지 원격협진");
  assert.equal(service.description, "원격협진 진료 원내처방 서비스 및 보건교육");
});

test("spacing repair keeps every non-whitespace source character", () => {
  const [service] = repairExtractionSpacing([
    {
      serviceId: "0083:1489622:1:1:6",
      sido: "강원특별자치도",
      sigungu: "강릉시",
      category: "건강관리예방",
      subcategory: "장애인",
      name: "지 역사회중심재활사 업",
      description: "등록 장애인 방문건강관리, 장애인식개선 교육 등",
      target: "장애인",
      detailTarget: "",
      provider: "보건소",
      type: "전국",
      serial: "6",
      detailUrl: "https://www.mohw.go.kr/board.es?list_no=1489622",
      updatedDate: "2026-04",
    },
  ]);

  assert.equal(service.name, "지역사회중심재활사업");
  assert.equal(service.name.replace(/\s+/g, ""), "지 역사회중심재활사 업".replace(/\s+/g, ""));
});

test("every generated correction preserves the official character stream", () => {
  for (const field of ["name", "description"]) {
    for (const [before, after] of Object.entries(CORRECTIONS[field])) {
      assert.notEqual(before, after);
      assert.equal(after.replace(/\s+/g, ""), before.replace(/\s+/g, ""));
    }
  }
  assert.equal(Object.keys(CORRECTIONS.name).length, 1_407);
  assert.equal(Object.keys(CORRECTIONS.description).length, 3_376);
});
