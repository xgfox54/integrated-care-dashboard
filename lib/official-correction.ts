import { restoreReviewedClassifications } from "./source-classifications.ts";
import type { OfficialService } from "./official-source.ts";
import { verifiedBusinessTypeRestoration } from "./business-type.ts";
import { restoreVerifiedSourceDistinctions } from "./official-source-restoration.ts";
import { getVerifiedWikiSupplement } from "./wiki-verified-supplements.ts";

/** 보건복지부 메뉴판의 구체적인 대분류. 원문이 이 가운데 하나면 기준 자료로 덮어쓰지 않는다. */
const SPECIFIC_CATEGORIES = new Set(["일상생활돌봄", "건강관리예방", "보건의료", "주거복지", "요양", "장애지원"]);

function identity(service: Pick<OfficialService, "sido" | "sigungu" | "name">): string {
  return [service.sido, service.sigungu, service.name]
    .map((value) => value.toLowerCase().replace(/[^0-9가-힣a-z]/g, ""))
    .join("|");
}

function taxonomyKey(value: string): string {
  return value.toLowerCase().replace(/[^0-9가-힣a-z]/g, "");
}

function subcategoryKey(value: string): string {
  return taxonomyKey(value).replace(/국가|지자체|구군|부산|수성구|군위군|서구/g, "");
}

function preferCurrent(current: string, baseline: string): string {
  return current.trim() || baseline;
}

const KNOWN_CONTINUATION_FRAGMENTS = new Set([
  "부산광역시|중구|등교육",
  "대전광역시|중구|센터시범사업",
  "대전광역시|유성구|센터시범사업",
  "강원특별자치도|인제군|화",
  "강원특별자치도|평창군|료수가시업사업",
  "강원특별자치도|평창군|사업만성질환관리",
  "강원특별자치도|평창군|저소득층만성질환검",
  "강원특별자치도|평창군|노인안질환의료비지원",
  "강원특별자치도|평창군|암환자의료비지원사",
  "강원특별자치도|태백시|지원",
  "강원특별자치도|동해시|스보건소",
  "강원특별자치도|동해시|달기존사업연계",
  "강원특별자치도|동해시|경로당순회",
  "강원특별자치도|평창군|터",
  "강원특별자치도|속초시|스",
  "충청북도|제천시|3",
]);

const KNOWN_FRAGMENT_REPAIRS = new Map([
  ["강원특별자치도|평창군|사업", "노인안질환 의료비지원사업"],
  ["강원특별자치도|평창군|업", "암환자 의료비 지원사업"],
]);

const VERIFIED_SOURCE_FIELD_REPAIRS = new Map<string, Partial<OfficialService>>([
  [
    "강원특별자치도|강릉시|재택의료센터",
    { description: "의료진+사회복지사가 가정 방문하여 서비스 통합 제공" },
  ],
  [
    "강원특별자치도|강릉시|지역사회중심재활사업",
    { description: "등록 장애인 방문건강관리, 장애인식개선 교육 등" },
  ],
  [
    "강원특별자치도|강릉시|주거불편개선기동처리반",
    { description: "소규모 주거 불편사항(전기, 상수도 집수리 등) 해소, 기동처리반 운영 지원" },
  ],
  [
    "강원특별자치도|강릉시|초록기억시나미카페",
    { description: "지역 밀착형 치매카페 운영으로 어르신 인지건강 개선 프로그램, 소모임 활동지원 등 커뮤니티 공간 제공" },
  ],
  [
    "강원특별자치도|강릉시|마을돌봄터",
    { description: "마을단위 건강돌봄 거점역할 공유공간 운영, 나눔마켓 운영" },
  ],
  [
    "강원특별자치도|강릉시|장애인주택개조사업",
    { description: "주택 내 편의시설, 안전장치 설치 및 개선 등 지원" },
  ],
  [
    "강원특별자치도|강릉시|케어안심주택",
    { description: "주거 불안 퇴원환자, 통합돌봄 대상자에게 중간집(단기임대) 형태 주거지 지원" },
  ],
  [
    "강원특별자치도|강릉시|호스피스완화의료",
    { description: "생애말기 환자 호스피스(증상 완화, 임종준비 등)" },
  ],
  [
    "제주특별자치도|제주특별자치도|ict융합방문건강관리사업aiito",
    {
      name: "ICT 융합 방문건강관리사업(AI-IoT)",
      description: "(AI-IoT) 블루투스 기반의 건강측정기기 제공, 대면 사전·사후 건강 스크리닝 및 건강측정 정보 모니터링 등",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|ict융합방문건강관리사업aiiot",
    {
      name: "ICT 융합 방문건강관리사업(AI-IoT)",
      description: "(AI-IoT) 블루투스 기반의 건강측정기기 제공, 대면 사전·사후 건강 스크리닝 및 건강측정 정보 모니터링 등",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|ict융합방문건강관리사업방문건강관리사업",
    {
      name: "ICT 융합 방문건강관리사업(방문건강관리사업)",
      description: "의료취약계층의 건강문제 파악, 맞춤형 방문건강관리, 만성질환 관리 및 합병증 예방을 위한 혈압·혈당 등 건강측정 등",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|ict활용의료취약지원격협진사업",
    {
      name: "ICT 활용 의료취약지 원격협진 사업",
      description: "화상장비(웹캠, 전자기기 등)를 활용하여 의사(자문의료기관)와 의료인(지역보건의료기관) 간 원격협진 서비스 제공",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|가정용입원용호스피스",
    {
      name: "가정용·입원용 호스피스",
      description: "호스피스 클리닉 운영, 말기 환자를 위한 완화의료 서비스 제공",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|건강안심주거환경개선사업",
    {
      name: "건강안심 주거환경 개선사업",
      description: "낙상 예방, 문턱 제거, 도배·장판 교체 등 주거환경 개선 시공",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|고혈압당뇨병등록관리사업",
    {
      name: "고혈압·당뇨병 등록관리사업",
      description: "고혈압·당뇨병 환자 의료비 지원(등록비, 진료비, 약제비) 및 관리",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|낙상예방재가환경지원",
    { description: "낙상 위험이 높은 장기요양 수급자 대상 낙상예방 생활편의·위생품목을 생애 100만원 한도 내 지원" },
  ],
  [
    "제주특별자치도|제주특별자치도|노인맞춤돌봄서비스",
    { description: "안전·안부 확인, 생활교육, 사회참여 프로그램, 일상생활지원 및 특화서비스 제공" },
  ],
  [
    "제주특별자치도|제주특별자치도|노인생활안전사고예방지원",
    { description: "성인용 보행기, 안전손잡이, 미끄럼방지패드(매트, 양말) 지원" },
  ],
  [
    "제주특별자치도|제주특별자치도|대청소및정리수납서비스",
    { description: "주거공간 개선 및 정리수납(옷장, 주방, 냉장고 등 정리, 생활폐기물 정리 등)" },
  ],
  [
    "제주특별자치도|제주특별자치도|독거노인장애인응급안전안심서비스",
    { name: "독거노인·장애인 응급안전안심서비스" },
  ],
  [
    "제주특별자치도|제주특별자치도|돌봄가족을위한돌봄공백해소일시재가지원사업",
    { description: "가사·일상생활 지원(취사, 생필품 구매, 청소, 세탁 등), 신변 활동지원(식사 도움, 설거지, 옷 갈아입히기, 외출 동행 등)" },
  ],
  [
    "제주특별자치도|제주특별자치도|방문복약지도사업",
    { description: "지역사회 약사가 가정을 방문하여 대면 복약지도 등 제공" },
  ],
  [
    "제주특별자치도|제주특별자치도|시각장애인플러스지원센터운영",
    {
      name: "시각장애인플러스 지원센터 운영",
      description: "외출 시 이동지원으로 이동권 확보 및 생활 편의 제공",
    },
  ],
  [
    "제주특별자치도|제주특별자치도|안전생활환경조성사업",
    { description: "화재예방, 위생, 편의 개선 등에 필요한 서비스 제공(경사로 설치, 조명 개선, 마당 평탄화 등 낙상예방 관련 설치 등)" },
  ],
  [
    "제주특별자치도|제주특별자치도|이불빨래서비스",
    { description: "이불, 요, 담요 등 대형 세탁이 필요한 섬유제품의 세탁 및 건조 서비스 제공(1가구 연 4회)" },
  ],
  [
    "제주특별자치도|제주특별자치도|일시재가지원사업",
    { description: "가사·일상생활 지원(취사, 생필품 구매, 청소, 세탁 등), 신변 활동지원(식사 도움, 설거지, 옷 갈아입히기, 외출 동행 등)" },
  ],
  [
    "제주특별자치도|제주특별자치도|일차의료만성질환관리사업",
    { description: "개인별 건강상태에 따른 고혈압·당뇨병 관리계획 수립, 의료전문가(의사 또는 케어코디네이터)를 통한 교육·상담 제공" },
  ],
  [
    "제주특별자치도|제주특별자치도|일차의료방문진료수가시범사업",
    { description: "의사(한의사)가 직접 방문하여 진료·의료서비스 제공" },
  ],
  [
    "제주특별자치도|제주특별자치도|장기요양재택의료센터",
    { description: "다학제 팀이 수급자 가정을 방문하여 방문진료·간호, 지역사회 자원 연계 등 의료·요양 통합서비스 제공" },
  ],
  [
    "제주특별자치도|제주특별자치도|장기요양통합재가서비스가정방문형",
    { description: "사례관리(급여관리 업무, 사례관리 회의 등)를 통해 수급자의 욕구·상태를 반영하여 서비스 유형에 따라 다양한 재가급여를 복합적으로 제공" },
  ],
  [
    "제주특별자치도|제주특별자치도|장애인병원동행서비스",
    { description: "병원 동행이 필요한 장애인에게 편안한 동행서비스 지원" },
  ],
  [
    "제주특별자치도|제주특별자치도|장애인보조기기교부",
    { description: "수동휠체어, 욕창 예방방석 등 장애인 보조기기 46종 지원" },
  ],
  [
    "제주특별자치도|제주특별자치도|저소득노인진료비노인건강진단",
    { name: "저소득 노인 진료비(노인 건강진단)" },
  ],
  [
    "제주특별자치도|제주특별자치도|제주가치돌봄",
    { description: "일상생활지원, 식사지원, 동행지원, 운동지도, 주거편의 등 5개 분야 서비스 제공" },
  ],
  [
    "제주특별자치도|제주특별자치도|제주지역장애인보건의료센터",
    { description: "장애인 통합관리 서비스 제공(사례관리), 보건의료기관 접근 및 이용 보장, 장애인 의료기관 이동 지원 사업 연계 등" },
  ],
  [
    "제주특별자치도|제주특별자치도|제주형장애인지역사회통합돌봄사업",
    { description: "단기자립생활체험주택, 찾아가는 재활서비스, 1인 가구 자립지원 연계서비스(자격증 강좌, 주거 스타일링) 등" },
  ],
  [
    "제주특별자치도|제주특별자치도|지역사회중심재활사업",
    { description: "재활서비스(재활운동실 운영, 방문재활서비스, 조기적응 프로그램 등) 제공, 연계병원 퇴원관리 상담 활동 등" },
  ],
  [
    "제주특별자치도|제주특별자치도|찾아가는건강돌봄서비스어르신안심주택",
    { name: "찾아가는 건강돌봄서비스(어르신안심주택)" },
  ],
  [
    "제주특별자치도|제주특별자치도|퇴원환자단기집중서비스",
    { description: "퇴원환자 단기집중(일상회복 패키지) 지원: 영양지원(월 10만원), 가사지원(월 32시간), 동행지원(월 12시간)" },
  ],
  [
    "제주특별자치도|제주특별자치도|퇴원환자이동및병원동행지원사업",
    { description: "퇴원 시 이동, 병원 동행 등 전 과정 동행지원" },
  ],
  [
    "제주특별자치도|제주특별자치도|푸드마켓푸드뱅크",
    { name: "푸드마켓·푸드뱅크" },
  ],
]);

function continuationKey(service: OfficialService): string {
  return [service.sido, service.sigungu, service.name]
    .map((value) => value.replace(/[^0-9가-힣a-z]/gi, ""))
    .join("|");
}

export function repairKnownExtractionFragments(
  services: readonly OfficialService[],
): readonly OfficialService[] {
  return services.map((service) => {
    const name = KNOWN_FRAGMENT_REPAIRS.get(continuationKey(service));
    const named = name ? { ...service, name } : service;
    const sourceRepair = VERIFIED_SOURCE_FIELD_REPAIRS.get(identity(named));
    const repaired = sourceRepair ? { ...named, ...sourceRepair } : named;
    const verified = getVerifiedWikiSupplement(repaired.serviceId);
    return restoreVerifiedSourceDistinctions(verified ? { ...repaired, description: verified.overview } : repaired);
  });
}

export function removeExtractedContinuationFragments(
  services: readonly OfficialService[],
): readonly OfficialService[] {
  return services.filter(
    (service) => !KNOWN_CONTINUATION_FRAGMENTS.has(continuationKey(service)),
  );
}

function repositorySubcategory(
  service: OfficialService,
  counts: ReadonlyMap<string, number>,
  candidates: readonly (readonly [string, number])[],
): string {
  if (counts.has(service.subcategory)) return service.subcategory;
  const unnumbered = service.subcategory.replace(/^\s*\d{1,2}[.)]?\s*/, "");
  if (unnumbered !== service.subcategory && counts.has(unnumbered)) return unnumbered;

  const valueKey = subcategoryKey(unnumbered);
  if (valueKey.length >= 2) {
    const exact = candidates.find(([value]) => subcategoryKey(value) === valueKey);
    if (exact) return exact[0];

    const contained = candidates.filter(([value]) => {
      const candidateKey = subcategoryKey(value);
      return (
        valueKey.length >= 3 &&
        candidateKey.length >= 3 &&
        (valueKey.includes(candidateKey) || candidateKey.includes(valueKey))
      );
    });
    if (new Set(contained.map(([value]) => subcategoryKey(value))).size === 1) {
      return contained[0]?.[0] ?? "";
    }
  }
  return "";
}

function repositoryType(value: string, allowed: ReadonlySet<string>): string {
  if (allowed.has(value)) return value;
  if (allowed.has("미분류")) return "미분류";
  return "";
}

export function correctFromRepositoryBaseline(
  services: readonly OfficialService[],
  baselineServices: readonly OfficialService[],
): readonly OfficialService[] {
  const byIdentity = new Map<string, OfficialService | null>();
  for (const service of baselineServices) {
    const key = identity(service);
    byIdentity.set(key, byIdentity.has(key) ? null : service);
  }
  return services.map((service) => {
    const baseline = byIdentity.get(identity(service));
    if (!baseline) return restoreVerifiedSourceDistinctions(service);
    return restoreVerifiedSourceDistinctions({
      ...service,
      category: SPECIFIC_CATEGORIES.has(service.category.trim())
        ? service.category
        : baseline.category.trim() || service.category,
      subcategory: baseline.subcategory.trim() || service.subcategory,
      name: preferCurrent(service.name, baseline.name),
      description: preferCurrent(service.description, baseline.description),
      target: preferCurrent(service.target, baseline.target),
      detailTarget: preferCurrent(service.detailTarget, baseline.detailTarget),
      provider: preferCurrent(service.provider, baseline.provider),
      type: baseline.type.trim() || service.type,
      serial: preferCurrent(service.serial, baseline.serial),
    });
  });
}

export function alignToRepositoryTaxonomy(
  services: readonly OfficialService[],
  baselineServices: readonly OfficialService[],
): readonly OfficialService[] {
  const subcategoryCounts = new Map<string, number>();
  const types = new Set<string>();
  for (const service of baselineServices) {
    subcategoryCounts.set(
      service.subcategory,
      (subcategoryCounts.get(service.subcategory) ?? 0) + 1,
    );
    if (service.type) types.add(service.type);
  }
  const subcategoryCandidates = [...subcategoryCounts]
    .filter(([value, count]) => count >= 4 && subcategoryKey(value).length >= 2)
    .sort(
      (left, right) =>
        subcategoryKey(right[0]).length - subcategoryKey(left[0]).length || right[1] - left[1],
    );
  return services.map((service) => restoreReviewedClassifications({
    ...service,
    subcategory: repositorySubcategory(service, subcategoryCounts, subcategoryCandidates),
    type: verifiedBusinessTypeRestoration(service.serviceId)?.type ?? repositoryType(service.type, types),
  }));
}
