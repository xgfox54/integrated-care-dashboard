import assert from "node:assert/strict";
import test from "node:test";

import { createWikiArticle } from "./wiki-article.ts";
import { getVerifiedWikiSupplement } from "./wiki-verified-supplements.ts";

function row(overrides = {}) {
  return {
    id: 1,
    serviceId: "service-1",
    sido: "인천광역시",
    sigungu: "부평구",
    category: "보건의료",
    subcategory: "퇴원환자지원연계",
    name: "퇴원환자 지역사회 연계사업",
    description: "퇴원환자를 지역 통합돌봄체계로 연계해 필요한 의료·돌봄서비스를 지원합니다.",
    target: "퇴원 이후 의료·돌봄 연계가 필요한 대상자",
    detailTarget: "65세 이상 노인 및 장애인",
    applicationMethod: "주소지 행정복지센터 방문",
    provider: "부평구와 협약 의료기관",
    type: "지역특화",
    serial: "1",
    detailUrl: "https://www.mohw.go.kr/board.es?list_no=1",
    updatedDate: "2026-03",
    searchIndex: "",
    ...overrides,
  };
}

test("wiki article exposes source-based core fields and public support conditions", () => {
  const article = createWikiArticle(row({ description: "퇴원환자를\n지역사회 서비스에 연계합니다." }));

  assert.equal(article.name, "퇴원환자 지역사회 연계사업");
  assert.equal(article.overview, "퇴원환자를 지역사회 서비스에 연계합니다.");
  assert.match(article.content, /^인천광역시 부평구에서 제공하는 퇴원환자 지역사회 연계사업입니다\./);
  assert.match(article.content, /\n\n퇴원환자를 지역사회 서비스에 연계합니다\.$/);
  assert.match(article.content, /제공기관은 부평구와 협약 의료기관입니다/);
  assert.equal(article.category, "보건의료 · 퇴원환자지원연계");
  assert.equal(article.type, "지역특화");
  assert.doesNotMatch(article.content, /제공 지역은|사업 분야는|사업구분은/);
  assert.equal(article.applicationConditions, "퇴원 이후 의료·돌봄 연계가 필요한 대상자\n65세 이상 노인 및 장애인");
  assert.equal(article.conditionsBasis, "보건복지부 원자료의 지원대상 기준");
  assert.equal(article.contentStatus, "official-row");
  assert.doesNotMatch(article.overview, /[\r\n]/);
});

test("wiki overview preserves the complete dashboard summary", () => {
  const description = "사업내용 ".repeat(30).trim();

  const article = createWikiArticle(row({ description }));

  assert.equal(article.overview, description);
});

test("wiki article omits application conditions when no public support criteria exist", () => {
  const article = createWikiArticle(row({ target: "해당 없음", detailTarget: "-" }));
  assert.equal("applicationConditions" in article, false);
});

test("wiki article discloses unavailable source content instead of fabricating details", () => {
  const article = createWikiArticle(row({ description: "", target: "", detailTarget: "", provider: "" }));
  assert.equal(article.contentStatus, "unavailable");
  assert.match(article.overview, /공개 원자료에서 요약 설명을 확인할 수 없습니다/);
  assert.match(article.content, /상세 사업내용을 확인할 수 없습니다/);
  assert.doesNotMatch(article.content, /제공기관은/);
});

test("verified official supplement fills a blank source row with traceable public content", () => {
  const supplement = getVerifiedWikiSupplement("0085:1489600:1:2:15");
  const article = createWikiArticle(row({
    serviceId: "0085:1489600:1:2:15",
    name: "식사배달사업",
    description: "",
    target: "",
    detailTarget: "",
  }), { verifiedSupplement: supplement });

  assert.equal(article.contentStatus, "verified-supplement");
  assert.match(article.content, /주 1회 밑반찬/);
  assert.match(article.applicationConditions ?? "", /만 65세 이상/);
  assert.equal(article.supplement?.publisher, "김포시청");
  assert.match(article.supplement?.url ?? "", /^https:\/\/m\.gimpo\.go\.kr\//);
});

test("verified official supplement replaces a nonblank source description when the table row is misassigned", () => {
  const supplement = {
    serviceIds: ["service-1"],
    overview: "검증된 사업개요",
    content: "검증된 사업내용",
    eligibility: "검증된 지원대상",
    sourceTitle: "검증자료",
    publisher: "공공기관",
    url: "https://example.go.kr/verified",
    verifiedOn: "2026-09-21",
  };

  const article = createWikiArticle(row({
    description: "다른 사업에 배정되어야 할 원자료 설명",
  }), { verifiedSupplement: supplement });

  assert.equal(article.contentStatus, "verified-supplement");
  assert.equal(article.overview, supplement.overview);
  assert.ok(article.content.endsWith(`\n\n${supplement.content}`));
  assert.doesNotMatch(article.content, /다른 사업에 배정되어야 할 원자료 설명/);
  assert.equal(article.applicationConditions, supplement.eligibility);
  assert.equal(article.supplement, supplement);
});

test("wiki formats a name-only description without repeating it or mixing in classification", () => {
  const article = createWikiArticle(row({
    sido: "강원특별자치도", sigungu: "고성군", name: "가스안전 장치 설치",
    description: "가스안전장치 설치지원.", provider: "한국가스안전공사",
    category: "주거복지", subcategory: "주거공간개선", type: "전국",
  }));
  assert.equal(article.content, "강원특별자치도 고성군에서 제공하는 가스안전장치 설치지원 사업입니다. 제공기관은 한국가스안전공사입니다.");
  assert.equal(article.category, "주거복지 · 주거공간개선");
  assert.equal(article.type, "전국");
});

test("wiki uses the common introduction for exact-match supplements without inventing missing metadata", () => {
  const article = createWikiArticle(row({
    sido: "", sigungu: "", name: "돌봄지원", description: "", provider: "-",
    category: "-", subcategory: "해당 없음", type: "",
  }), { exactMatchSummary: "방문 돌봄을 지원합니다." });
  assert.equal(article.content, "전국에서 제공하는 돌봄지원 사업입니다.\n\n방문 돌봄을 지원합니다.");
  assert.equal(article.category, "");
  assert.equal(article.type, "");
});
