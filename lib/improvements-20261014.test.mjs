import assert from "node:assert/strict";
import test from "node:test";

import { classifySourceTypeLabel, verifiedBusinessTypeRestoration, displayBusinessType } from "./business-type.ts";
import { computeServiceLifecycle, basisFromTitle } from "./service-lifecycle.ts";
import { adminCityScope, adminCitySigunguValues } from "./admin-city.ts";
import { buildRegionProfile, elderlyFor, institutionsForCode, perThousand, regionRows } from "./regional-indicators.ts";
import { assessManualLink } from "./manual-link-type.ts";
import { retryAfterMs, retryDelayMs } from "./retry-policy.ts";
import { fetchOfficialHtml } from "./official-http.ts";
import { blockingFindings, scanSensitiveText } from "./privacy-guard.ts";
import { districtTargets } from "./region-load-order.ts";

const NOW = new Date("2026-10-14T00:00:00Z");
const doc = (title) => ({ documentId: "0084:1489830:1", title, detailUrl: "https://www.mohw.go.kr/x", fileName: "f", publishedAt: "2026-03-26", dataAsOf: "", collectedAt: 1_791_900_000 });
const base = { serviceId: "0084:1489830:1:2:1", type: "전국", subcategory: "방문진료", runCompletedAt: 1_791_900_000, lastSuccessAt: 1_791_950_000, evidence: [], now: NOW };

test("T01 적용연도가 원문에 없으면 미확인이고 수집일을 쓰지 않는다", () => {
  const result = computeServiceLifecycle({ ...base, document: doc("대구광역시 남구 통합돌봄 서비스 메뉴판") });
  assert.equal(result.appliedYear.value, null);
  assert.equal(result.sourceBasis.label, "미확인");
  assert.equal(result.status.value, "확인 불가");
  assert.equal(result.verification.value, "추가 확인 필요");
});

test("T02 공식 종료 근거가 없으면 종료로 바꾸지 않고, 근거가 있을 때만 종료한다", () => {
  const listed = computeServiceLifecycle({ ...base, document: doc("제주특별자치도 통합돌봄 서비스 메뉴판 (26년 7월 기준)") });
  assert.equal(listed.status.value, "운영 중");
  assert.equal(listed.appliedYear.value, 2026);
  const ended = computeServiceLifecycle({ ...base, document: doc("제주특별자치도 통합돌봄 서비스 메뉴판 (26년 7월 기준)"), evidence: [{ status: "종료", evidenceKind: "공고", evidenceTitle: "사업 종료 공고", evidenceUrl: "https://www.jeju.go.kr/a", effectiveOn: "2026-09-30", checkedOn: "2026-10-01", note: "", recordedAt: 1 }] });
  assert.equal(ended.status.value, "종료");
  assert.equal(ended.status.evidence?.url, "https://www.jeju.go.kr/a");
  assert.deepEqual(basisFromTitle("서울특별시 중구 통합돌봄 서비스 메뉴판(26년 3월 기준)입니다."), { year: 2026, month: 3 });
});

test("T03 미분류 정정은 원문 표기 승인 규칙과 검토 원장에 있는 행만 적용한다", () => {
  assert.deepEqual(classifySourceTypeLabel("전국").rule, "approved");
  assert.equal(classifySourceTypeLabel("국가").rule, "proposed");
  assert.equal(classifySourceTypeLabel("연계서비스").rule, "proposed");
  assert.equal(classifySourceTypeLabel("").value, "미분류");
  assert.equal(displayBusinessType("경기도"), "광역");
  assert.equal(verifiedBusinessTypeRestoration("0000:0:0:0:0"), undefined);
});

test("T05·T06 서귀포시는 도 단위 사업을 나누지 않고 전용·공통·미확인으로 구분한다", () => {
  const rows = [
    { sido: "제주특별자치도", sigungu: "제주특별자치도", name: "제주가치돌봄", description: "일상생활지원", provider: "도", category: "일상생활돌봄", type: "지역특화" },
    { sido: "제주특별자치도", sigungu: "제주특별자치도", name: "서귀포 온정가게", description: "", provider: "", category: "일상생활돌봄", type: "지역특화" },
    { sido: "서울특별시", sigungu: "중랑구", name: "x", description: "", provider: "", category: "요양", type: "전국" },
  ];
  assert.deepEqual(adminCitySigunguValues("제주특별자치도", "서귀포시"), ["서귀포시", "제주특별자치도"]);
  assert.equal(adminCityScope(rows[0], "서귀포시"), "도 공통");
  assert.equal(adminCityScope(rows[1], "서귀포시"), "적용범위 미확인");
  const sgw = buildRegionProfile(rows, "제주특별자치도|서귀포시");
  const jejuCity = buildRegionProfile(rows, "제주특별자치도|제주시");
  assert.equal(sgw.rows.length, 2);
  assert.deepEqual(sgw.scopeCounts, { "행정시 전용": 0, "도 공통": 1, "적용범위 미확인": 1 });
  assert.equal(jejuCity.rows.length, sgw.rows.length);
  assert.equal(regionRows(rows, "서울특별시|중랑구").length, 1);
  assert.deepEqual(districtTargets({ 제주특별자치도: ["제주특별자치도", "제주시", "서귀포시"] }), []);
});

test("T07 고령인구가 연결되지 않은 지역은 지표를 0이 아니라 null로 둔다", () => {
  assert.equal(elderlyFor("제주특별자치도", "서귀포시")?.value, 45029);
  assert.equal(elderlyFor("제주특별자치도", "서귀포시")?.period, "2026-09");
  assert.equal(elderlyFor("없는도", "없는군"), null);
  assert.equal(perThousand(10, null), null);
  assert.equal(perThousand(65, 45029), 1.44);
  assert.equal(institutionsForCode("4111000000", { "4111100000": 3, "4111300000": 2, "4113100000": 9 }), 5);
});

test("T08·T09 단순 언급은 연결 후보이고, 매뉴얼 제목 연도와 자료 연도가 다르면 불일치를 표시한다", () => {
  const mention = assessManualLink({ key: "21", title: "[매뉴얼-노인] 2026년 노인보건복지사업안내", heading: "1. 개요", match: "관련 언급" }, "노인맞춤돌봄서비스");
  assert.equal(mention.type, "CANDIDATE");
  assert.equal(mention.confirmed, false);
  const heading = assessManualLink({ key: "21", title: "[매뉴얼-노인] 2025년 노인보건복지사업안내", heading: "3. 노인맞춤돌봄서비스", match: "제도명 일치" }, "노인맞춤돌봄서비스", 2026);
  assert.equal(heading.type, "B");
  assert.match(heading.yearNote ?? "", /연도 불일치/);
});

test("T11 429·일시 오류는 지수 백오프로 재시도하고 Retry-After를 우선한다", async () => {
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(retryDelayMs(1, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000 }, 2000), 2000);
  assert.equal(retryDelayMs(1, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000 }, 60_000), null);
  const delay = retryDelayMs(3, { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000 }, null, () => 1);
  assert.equal(delay, 2000);
  let calls = 0;
  const waits = [];
  const result = await fetchOfficialHtml("https://example.invalid/a", async () => {
    calls += 1;
    return calls === 1 ? new Response("", { status: 429, headers: { "retry-after": "1" } }) : new Response("ok", { status: 200 });
  }, undefined, async (ms) => { waits.push(ms); });
  assert.equal(result.text, "ok");
  assert.deepEqual(waits, [1000]);
  await assert.rejects(fetchOfficialHtml("https://example.invalid/b", async () => new Response("", { status: 429, headers: { "retry-after": "3600" } }), undefined, async () => {}), /HTTP 429/);
});


test("T14 주민등록번호·카드번호가 든 반입 자료는 공개를 막는다", () => {
  const findings = scanSensitiveText("대상자 900101-2345678, 카드 4111 1111 1111 1111, 문의 064-760-1234");
  assert.deepEqual(blockingFindings(findings).map((finding) => finding.kind).sort(), ["주민등록번호", "카드번호"]);
  assert.deepEqual(blockingFindings(scanSensitiveText("예산 2026-0001234, 사업코드 123456-7")), []);
});

