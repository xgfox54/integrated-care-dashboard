import assert from "node:assert/strict";
import test from "node:test";

import { assessOfficialDataset, officialIdentityHash } from "./official-quality.ts";
import {
  alignToRepositoryTaxonomy,
  correctFromRepositoryBaseline,
} from "./official-correction.ts";
import { readMohwSeed } from "./mohw-seed.ts";
import { readRepositoryBaseline } from "./repository-baseline.ts";

const benchmark = {
  sourceCount: 100,
  sourceCoverage: {
    category: 100,
    subcategory: 88,
    name: 100,
    description: 98,
    target: 93,
    provider: 78,
    type: 100,
  },
};

function row(index, overrides = {}) {
  return {
    serviceId: String(index),
    sido: "서울특별시",
    sigungu: "중랑구",
    category: "보건의료",
    subcategory: "방문진료",
    name: `사업 ${index}`,
    description: "사업 설명",
    target: "지원 대상",
    detailTarget: "",
    provider: "제공 기관",
    type: "전국",
    serial: String(index),
    detailUrl: "https://www.mohw.go.kr/",
    updatedDate: "2026-06",
    ...overrides,
  };
}

test("Given a benchmark When extracted coverage stays within tolerance Then promotion passes", () => {
  const rows = Array.from({ length: 90 }, (_, index) => row(index, index < 7 ? { target: "" } : {}));
  const report = assessOfficialDataset(rows, benchmark);

  assert.equal(report.passed, true);
  assert.equal(report.rowCount, 90);
});

test("Given a benchmark When rows or core fields collapse Then promotion is blocked", () => {
  const rows = Array.from({ length: 70 }, (_, index) => row(index, { description: "", target: "" }));
  const report = assessOfficialDataset(rows, benchmark);

  assert.equal(report.passed, false);
  assert.match(report.reasons.join(" "), /사업 수|사업내용/);
});

test("Given repository identity hashes When baseline recall falls below the limit Then promotion is blocked", () => {
  const sourceRows = Array.from({ length: 100 }, (_, index) => row(index));
  const rows = [
    ...sourceRows.slice(0, 60),
    ...Array.from({ length: 30 }, (_, index) => row(index + 100)),
  ];
  const report = assessOfficialDataset(rows, {
    ...benchmark,
    sourceIdentityHashes: sourceRows.map(officialIdentityHash),
  });

  assert.equal(report.passed, false);
  assert.equal(report.baselineIdentityMatches, 60);
  assert.equal(report.baselineIdentityRecall, 0.6);
  assert.match(report.reasons.join(" "), /사업명 보존율/);
});

test("Given repository taxonomy When an unknown label remains Then promotion is blocked", () => {
  const rows = Array.from({ length: 90 }, (_, index) => row(index));
  rows[0] = row(0, { subcategory: "파싱오염값", type: "연계서비스연계서비스" });
  const baseline = [
    row(100, { subcategory: "방문진료", type: "전국" }),
    row(101, { subcategory: "기타", type: "미분류" }),
  ];

  const report = assessOfficialDataset(rows, benchmark, baseline);

  assert.equal(report.passed, false);
  assert.equal(report.invalidSubcategoryCount, 1);
  assert.equal(report.invalidTypeCount, 1);
  assert.match(report.reasons.join(" "), /중분류|사업구분/);
});

test("Given repository coverage When unresolved taxonomy grows too far Then promotion is blocked", () => {
  const rows = Array.from({ length: 90 }, (_, index) =>
    row(index, index < 20 ? { subcategory: "", type: "미분류" } : {}),
  );
  const baseline = Array.from({ length: 100 }, (_, index) =>
    row(index + 100, index < 5 ? { subcategory: "", type: "미분류" } : {}),
  );

  const report = assessOfficialDataset(rows, benchmark, baseline);

  assert.equal(report.passed, false);
  assert.match(report.reasons.join(" "), /중분류 채움률|사업구분 미분류율/);
});

test("Given the official MOHW seed When compared with the repository benchmark Then it passes", () => {
  const seed = readMohwSeed();
  const baseline = readRepositoryBaseline();
  const rows = alignToRepositoryTaxonomy(
    correctFromRepositoryBaseline(
      seed.documents.flatMap((entry) => entry.services),
      baseline,
    ),
    baseline,
  );
  const report = assessOfficialDataset(rows, seed.benchmark, baseline);

  assert.equal(seed.documents.length, 230);
  assert.ok(report.rowCount >= Math.ceil(seed.benchmark.sourceCount * 0.88));
  assert.ok(report.baselineIdentityRecall >= 0.7);
  assert.equal(report.invalidSubcategoryCount, 0);
  assert.equal(report.invalidTypeCount, 0);
  assert.ok(report.unclassifiedTypeCount > 0);
  assert.equal(report.passed, true);
});
