import assert from "node:assert/strict";
import test from "node:test";

import {
  alignToRepositoryTaxonomy,
  correctFromRepositoryBaseline,
  removeExtractedContinuationFragments,
  repairKnownExtractionFragments,
} from "./official-correction.ts";
import { enrichWithPublicApi } from "./official-enrichment.ts";
import { readMohwSeed } from "./mohw-seed.ts";
import {
  REPOSITORY_BASELINE_COUNT,
  REPOSITORY_CORRECTION_COUNT,
  readRepositoryBaseline,
} from "./repository-baseline.ts";
import { getVerifiedWikiSupplement } from "./wiki-verified-supplements.ts";

function service(overrides = {}) {
  return {
    serviceId: "current:1",
    sido: "강원특별자치도",
    sigungu: "강릉시",
    category: "일상생활돌봄",
    subcategory: "일상생활지원가사지원이동지원",
    name: "1촌 돌봄단",
    description: "역할 수 행",
    target: "노인",
    detailTarget: "",
    provider: "종합사회복지관",
    type: "지역특화",
    serial: "1-1",
    detailUrl: "https://www.mohw.go.kr/current",
    updatedDate: "2026-09",
    ...overrides,
  };
}

test("Given a changed MOHW document When it matches the baseline Then current descriptive fields win", () => {
  const current = service();
  const baseline = service({
    serviceId: "seed:1",
    subcategory: "일상생활지원",
    description: "돌봄활동가 역할 수행",
    serial: "11",
    detailUrl: "https://www.mohw.go.kr/old",
    updatedDate: "2026-07",
  });

  const [corrected] = correctFromRepositoryBaseline([current], [baseline]);

  assert.equal(corrected?.subcategory, "일상생활지원");
  assert.equal(corrected?.description, "역할 수 행");
  assert.equal(corrected?.serial, "1-1");
  assert.equal(corrected?.detailUrl, current.detailUrl);
  assert.equal(corrected?.updatedDate, current.updatedDate);
});

test("Given a specific official category When the baseline says 기타 Then the official category wins", () => {
  const [kept] = correctFromRepositoryBaseline([service({ category: "일상생활돌봄" })], [service({ serviceId: "seed:1", category: "기타" })]);
  assert.equal(kept?.category, "일상생활돌봄");

  const [different] = correctFromRepositoryBaseline([service({ category: "보건의료" })], [service({ serviceId: "seed:1", category: "요양" })]);
  assert.equal(different?.category, "보건의료");
});

test("Given an empty or 기타 official category When the baseline is specific Then the baseline fills it", () => {
  const [fromEtc] = correctFromRepositoryBaseline([service({ category: "기타" })], [service({ serviceId: "seed:1", category: "요양" })]);
  assert.equal(fromEtc?.category, "요양");

  const [fromEmpty] = correctFromRepositoryBaseline([service({ category: " " })], [service({ serviceId: "seed:1", category: "주거복지" })]);
  assert.equal(fromEmpty?.category, "주거복지");
});

test("Given the bundled official seed When corrected Then baseline 기타 no longer hides the official category", () => {
  const seed = readMohwSeed();
  const raw = seed.documents.flatMap((entry) => entry.services);
  const corrected = alignToRepositoryTaxonomy(correctFromRepositoryBaseline(raw, readRepositoryBaseline()), readRepositoryBaseline());
  const etc = corrected.filter((row) => row.category === "기타").length;
  const rawEtc = raw.filter((row) => row.category === "기타").length;
  assert.ok(etc <= rawEtc, `기타 ${etc}건이 원문 기타 ${rawEtc}건보다 많습니다`);
  const daegu = corrected.filter((row) => row.sido === "대구광역시");
  assert.ok(daegu.filter((row) => row.category === "기타").length / daegu.length < 0.3);
});

test("Given an empty current field When a unique baseline has content Then the baseline fills the gap", () => {
  const current = service({ description: "", target: "", provider: "" });
  const baseline = service({
    serviceId: "seed:1",
    description: "기준 설명",
    target: "기준 대상",
    provider: "기준 제공기관",
  });

  const [corrected] = correctFromRepositoryBaseline([current], [baseline]);

  assert.equal(corrected?.description, "기준 설명");
  assert.equal(corrected?.target, "기준 대상");
  assert.equal(corrected?.provider, "기준 제공기관");
});

test("Given duplicate baseline names When correction is attempted Then ambiguous services remain unchanged", () => {
  const current = service({ description: "보건복지부 원문", serial: "7" });
  const baselines = [
    service({ serviceId: "seed:1", description: "첫 번째 기준", serial: "1" }),
    service({ serviceId: "seed:2", description: "두 번째 기준", serial: "2" }),
  ];

  const [corrected] = correctFromRepositoryBaseline([current], baselines);

  assert.deepEqual(corrected, current);
});

test("Given a newer official field When the repository field is blank Then current content is preserved", () => {
  const current = service({ description: "현재 공식 설명", target: "현재 공개 대상", provider: "현재 제공기관" });
  const baseline = service({ description: "", target: "", provider: "" });

  const [corrected] = correctFromRepositoryBaseline([current], [baseline]);

  assert.equal(corrected.description, "현재 공식 설명");
  assert.equal(corrected.target, "현재 공개 대상");
  assert.equal(corrected.provider, "현재 제공기관");
});

test("Given a verified parser continuation When official rows are cleaned Then it is removed", () => {
  const continuation = service({
    sido: "강원특별자치도",
    sigungu: "동해시",
    name: "스(보건소)",
    description: "",
    serial: "",
  });
  const validBlankDescription = service({ name: "어르신 안전 하우징", description: "", serial: "28" });
  const unknownBlankDescription = service({ name: "신규 공식 사업", description: "", serial: "" });

  const rows = removeExtractedContinuationFragments([
    continuation,
    validBlankDescription,
    unknownBlankDescription,
  ]);

  assert.deepEqual(rows, [validBlankDescription, unknownBlankDescription]);
});

test("Given a verified split service name When official rows are repaired Then the full name is restored", () => {
  const fragment = service({
    sido: "강원특별자치도",
    sigungu: "평창군",
    name: "업",
    description: "암환자 의료비 지원사업",
    serial: "",
  });

  const [repaired] = repairKnownExtractionFragments([fragment]);

  assert.equal(repaired.name, "암환자 의료비 지원사업");
  assert.equal(repaired.description, fragment.description);
});

test("Given verified Gangneung PDF rows When repaired Then line-wrap artifacts match the source", () => {
  const current = [
    service({
      sido: "강원특별자치도",
      sigungu: "강릉시",
      name: "지 역사회중심재활사 업",
      description: "등록 장애인 방문건강관리 장, 애인식개선 교육 등",
    }),
    service({
      sido: "강원특별자치도",
      sigungu: "강릉시",
      name: "재택의료센터",
      description: "의료진+사회복지사이 가정 방문하여 서비스 통합 제공",
    }),
  ];

  const [rehabilitation, homeCare] = repairKnownExtractionFragments(current);

  assert.equal(rehabilitation.description, "등록 장애인 방문건강관리, 장애인식개선 교육 등");
  assert.equal(homeCare.description, "의료진+사회복지사가 가정 방문하여 서비스 통합 제공");
});

test("Given a verified service summary When dashboard rows are repaired Then it matches the Wiki overview", () => {
  const current = service({
    serviceId: "0083:1489622:1:2:7",
    name: "1촌돌봄단",
    description: "다른 사업의 설명",
  });
  const supplement = getVerifiedWikiSupplement(current.serviceId);

  const [repaired] = repairKnownExtractionFragments([current]);

  assert.ok(supplement);
  assert.equal(repaired.description, supplement.overview);
});

test("Given verified Jeju PDF rows When repaired Then names and descriptions match the source", () => {
  const current = [
    service({
      sido: "제주특별자치도",
      sigungu: "제주특별자치도",
      name: "I CT 융합 방문건강관리사업 (AI I T) o -",
      description: "정기기 제공 대면 사전사후 건강 · , 스크리닝 및 건강 측정 정보 모니터링 등",
    }),
    service({
      sido: "제주특별자치도",
      sigungu: "제주특별자치도",
      name: "이불빨래서비스",
      description: "이불 요 담요 등 대형 세탁이 필, , 요한 섬유제에 대한 세탁 및 건조 서비스 제공",
    }),
    service({
      sido: "제주특별자치도",
      sigungu: "제주특별자치도",
      name: "장기요양통합재가 서비스(가정방문형)",
      description: "방문요양·주야간보호 이용비 지원",
    }),
  ];

  const [iot, laundry, homeCare] = repairKnownExtractionFragments(current);

  assert.equal(iot.name, "ICT 융합 방문건강관리사업(AI-IoT)");
  assert.match(iot.description, /건강측정기기 제공, 대면 사전·사후 건강 스크리닝/);
  assert.match(laundry.description, /이불, 요, 담요 등 대형 세탁이 필요한 섬유제품/);
  assert.match(homeCare.description, /수급자의 욕구·상태를 반영하여 서비스 유형에 따라/);
});

test("Given an unmatched PDF row When taxonomy labels are corrupted Then repository labels are restored", () => {
  const baseline = [
    service({ name: "기준 사업 1", subcategory: "방문진료", type: "전국" }),
    service({ name: "기준 사업 2", subcategory: "기타", type: "미분류" }),
    service({ name: "기준 사업 3", subcategory: "방문진료", type: "지역특화" }),
    service({ name: "기준 사업 4", subcategory: "방문진료", type: "경기도" }),
    service({ name: "기준 사업 5", subcategory: "방문진료", type: "광역" }),
  ];
  const current = service({
    name: "새 공식 사업",
    subcategory: "방문진료국가",
    type: "연계서비스연계서비스",
  });
  const misleading = service({
    name: "분류 단어가 포함된 새 공식 사업",
    subcategory: "방문진료국가",
    type: "경기도와 무관한 신규 분류",
  });

  const [aligned, misleadingAligned] = alignToRepositoryTaxonomy([current, misleading], baseline);

  assert.equal(aligned?.subcategory, "방문진료");
  assert.equal(aligned?.type, "미분류");
  assert.equal(misleadingAligned?.type, "미분류");
});

test("Given duplicate public API names When enrichment is attempted Then ambiguous services remain unchanged", () => {
  const current = service({ description: "", target: "", provider: "" });
  const apiServices = [
    service({ serviceId: "api:1", description: "첫 번째 설명", target: "대상 1" }),
    service({ serviceId: "api:2", description: "두 번째 설명", target: "대상 2" }),
  ];

  const enriched = enrichWithPublicApi([current], apiServices);

  assert.equal(enriched.matches, 0);
  assert.deepEqual(enriched.services[0], current);
});

test("Given a baseline-only identity When current source has content Then only taxonomy is aligned", () => {
  const key = (value) => [value.sido, value.sigungu, value.name]
    .map((part) => part.toLowerCase().replace(/[^0-9가-힣a-z]/g, ""))
    .join("|");
  const baseline = readRepositoryBaseline();
  const seedKeys = new Set(
    readMohwSeed().documents.flatMap((entry) => entry.services).map(key),
  );
  const baselineOnly = baseline.find((candidate) => !seedKeys.has(key(candidate)));

  assert.equal(REPOSITORY_BASELINE_COUNT, 12_104);
  assert.equal(baseline.length, REPOSITORY_CORRECTION_COUNT);
  assert.ok(baselineOnly);
  const current = {
    ...baselineOnly,
    serviceId: "current:baseline-only",
    category: "파싱 대분류",
    description: "파싱 사업내용",
    provider: "파싱 제공기관",
  };
  const [corrected] = correctFromRepositoryBaseline([current], baseline);

  assert.equal(corrected?.category, baselineOnly.category);
  assert.equal(corrected?.description, "파싱 사업내용");
  assert.equal(corrected?.provider, "파싱 제공기관");
});
