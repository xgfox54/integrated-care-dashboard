// 통합 검색 후보를 출처별 원점수 대신 같은 척도(0~1)로 맞춘 뒤 질문 의도에 따라 섞는다.
// 매뉴얼 FTS 점수(최대 235)와 사업명 일치 점수(20~170)를 그대로 비교하면
// 관련이 약한 매뉴얼 구간이 지역 사업·예산서·보도자료를 항상 밀어낸다.
import { compactSearchText } from "./search-text.ts";
import { detectPrograms, STAFF_TERM_PATTERN, type RefinedWelfareQuery } from "./query-refiner.ts";

export type FusionPlan = Pick<RefinedWelfareQuery, "intents" | "region_id" | "include_ancestor_scope" | "programs" | "search_tokens" | "subservices" | "detail_terms" | "raw_query">
  & Partial<Pick<RefinedWelfareQuery, "program_scope" | "program_scope_source" | "subject_scope" | "legal_intent">>;

export interface FusionCandidate {
  readonly id: string;
  readonly entity_type: string;
  readonly title: string;
  /** 출처 고유 점수. 출처마다 척도가 다르므로 직접 비교하지 않는다. */
  readonly rank: number;
  readonly region_id?: string | null;
  /** 매뉴얼 구간이 속한 문서명·제목 경로. 사업명 포함 여부만 판단하고 응답에는 내보내지 않는다. */
  readonly context?: string;
  /** 본문이 표·이미지 자리표시만 있어 읽을 수 있는 문장이 없으면 false. */
  readonly body_available?: boolean;
  readonly scope_flags?: readonly string[];
  readonly question_similarity?: number;
  readonly question_exact?: boolean;
}

export const MANUAL_SCORE_MAX = 235;
export const SEARCH_RESULT_LIMIT = 20;
/** 상위 8개 안에 들어갈 수 있는 매뉴얼 구간 수. 나머지는 뒤로 보낸다(삭제하지 않음). */
export const MANUAL_TOP_CAP = 4;
const TOP_WINDOW = 8;
const GUARANTEE_POSITION = 2;

const PROGRAM_TYPES = new Set(["implementation", "gov24_service", "document_program", "welfare100_service"]);
/** 제도 범위를 검사하는 근거 유형. 통계·예산·보도자료는 제도 답변 근거가 아니라서 검사하지 않는다. */
const SCOPED_TYPES = new Set(["implementation", "gov24_service", "document_program", "welfare100_service", "manual_section", "official_faq"]);
export type ScopeFlag = "PROGRAM_MISMATCH" | "PROGRAM_MISMATCH_INFERRED" | "EMPTY_SOURCE_BODY";
// 서식·목차·파일 표지처럼 본문 근거가 아닌 구간 제목.
const NOISE_TITLE = [
  /^\[\s*\]/, /\[\s*\]\s*결정/, /^원본\s*파일\s*:/, /^[ivxlcdmⅰ-ⅻⅠ-Ⅻ]+\s*[╷|│]/i, /^부록\s*\d*$/, /^별지\s*(제\s*)?\d*/,
  /신청\s*\(?변경\)?\s*서$/, /^(신구\s*대조표|목\s*차|차\s*례)$/, /^[\s\d.)(-]*$/,
  /별지\s*제?\s*\d+\s*호\s*서식/, /^[A-Z0-9 &.,'-]{4,}$/,
];
const FORM_REQUEST = /서식|양식|신청서|별지|작성\s*예시/;
// 질문 의도를 나타내는 일반어. 세부조건 가산에서 빼야 다른 제도의 "구비서류"·"신청" 구간이 앞서지 않는다.
const GENERIC_DETAIL_TERMS: ReadonlySet<string> = new Set(["서류", "구비서류", "신청", "신청서", "방법", "대상", "대상자", "기준", "절차", "금액", "여부", "가능", "조건", "자격", "기간", "문의", "예산", "안내", "지원"]);

export function isNoiseManualTitle(title: string): boolean {
  const plain = title.replace(/^\[매뉴얼\]\s*/, "").trim();
  // "서비스"·"돌봄"처럼 3글자 이하 제목은 목차 조각이라 질문과의 관련을 판단할 수 없다.
  return compactSearchText(plain).length <= 3 || NOISE_TITLE.some((pattern) => pattern.test(plain));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** 사업명 일치 점수(welfareRelevance 기반)를 0~1로 옮긴다. 20점은 이름은 다르지만 본문·분류가 일치한 후보다. */
function programQuality(rank: number): number {
  if (rank >= 150) return 1;
  if (rank >= 120) return 0.92;
  if (rank >= 105) return 0.85;
  if (rank >= 90) return 0.78;
  if (rank >= 60) return 0.6;
  if (rank >= 20) return 0.45;
  return 0.25;
}

function baseQuality(candidate: FusionCandidate): number {
  switch (candidate.entity_type) {
    case "manual_section": return clamp(candidate.rank / MANUAL_SCORE_MAX);
    case "implementation": case "gov24_service": case "document_program": case "welfare100_service": return programQuality(candidate.rank);
    case "welfare_statistic": return candidate.rank >= 100 ? 0.95 : 0.2;
    case "budget_line": return 0.55;
    case "press_release": return 0.5;
    // 작성일 기준 Q&A라서 같은 제도의 공식 서비스 상세보다 약간 낮게 둔다.
    case "official_faq": return 0.92 * clamp(candidate.rank / 100);
    case "law": return 0.62;
    default: return 0.3;
  }
}

function queryTerms(plan: FusionPlan): { readonly core: string[]; readonly details: string[] } {
  const compact = (values: readonly string[]) => [...new Set(values.map(compactSearchText).filter((value) => value.length >= 2))];
  // 사업명 "장애인 활동지원"은 단어별로 나눠 제목이 사업명의 얼마를 담는지 본다.
  const core = compact([...plan.programs, ...plan.search_tokens, ...plan.subservices].flatMap((value) => value.split(/\s+/)));
  return { core, details: compact(plan.detail_terms).filter((term) => !core.includes(term) && !GENERIC_DETAIL_TERMS.has(term)) };
}

/** 제목이 담은 사업명 단어의 비율(글자 수 가중). 긴 단어(활동지원)가 흔한 짧은 단어(장애인)보다 더 구체적이라고 본다. */
function coreCoverage(title: string, core: readonly string[]): number {
  if (!core.length) return 1;
  const total = core.reduce((sum, term) => sum + term.length, 0);
  return core.filter((term) => title.includes(term)).reduce((sum, term) => sum + term.length, 0) / total;
}

function regionBonus(candidate: FusionCandidate, plan: FusionPlan): number {
  if (!plan.region_id || plan.region_id === "region:전국" || !candidate.region_id || !PROGRAM_TYPES.has(candidate.entity_type)) return 0;
  if (candidate.region_id === plan.region_id) return 0.2;
  const [province] = plan.region_id.split("|");
  // 요청 시·군·구의 상위 시·도 사업(제주특별자치도 → 서귀포시 등)은 상속 범위로 본다.
  return plan.include_ancestor_scope && candidate.region_id === province ? 0.14 : 0;
}

function intentWeight(entityType: string, plan: FusionPlan): number {
  const intents = new Set(plan.intents);
  const local = intents.has("local_scope") && Boolean(plan.region_id) && plan.region_id !== "region:전국";
  switch (entityType) {
    case "budget_line": return intents.has("budget") ? 1.6 : 0.6;
    case "press_release": return intents.has("news") ? 1.7 : 0.5;
    case "manual_section": return (intents.has("budget") || intents.has("news")) ? 0.8 : local ? 0.9 : 1;
    case "law": return plan.legal_intent ? 1.25 : 0.6;
    default: return 1;
  }
}

/**
 * 후보가 질문 제도와 다른 제도의 근거인지 본다. 후보 제목·문서명에서 제도를 찾지 못하면 판단하지 않는다(UNKNOWN).
 * 질문에서 제도를 추정만 한 경우(예: 수급자 → 국민기초생활보장)는 약한 불일치로 표시한다.
 */
export function programScopeCheck(candidate: Pick<FusionCandidate, "entity_type" | "title" | "context">, plan: FusionPlan): "MATCH" | "MISMATCH" | "UNKNOWN" {
  const scope = plan.program_scope ?? [];
  if (!scope.length || !SCOPED_TYPES.has(candidate.entity_type)) return "UNKNOWN";
  const found = detectPrograms(candidate.title.replace(/^\[[^\]]+\]\s*/, "") + " " + (candidate.context ?? ""));
  if (!found.length) return "UNKNOWN";
  return found.some((program) => scope.includes(program)) ? "MATCH" : "MISMATCH";
}

export function scopeFlags(candidate: FusionCandidate, plan: FusionPlan): ScopeFlag[] {
  const flags: ScopeFlag[] = [];
  if (programScopeCheck(candidate, plan) === "MISMATCH") flags.push(plan.program_scope_source === "inferred" ? "PROGRAM_MISMATCH_INFERRED" : "PROGRAM_MISMATCH");
  if (candidate.body_available === false) flags.push("EMPTY_SOURCE_BODY");
  return flags;
}

export function fusedScore(candidate: FusionCandidate, plan: FusionPlan): number {
  const { core, details } = queryTerms(plan);
  const title = compactSearchText(candidate.title.replace(/^\[[^\]]+\]\s*/, ""));
  // 매뉴얼 구간 제목은 사업명을 반복하지 않는 경우가 많아("단독가구·부부1인 수급가구") 문서명·제목 경로도 보되,
  // 여러 제도를 묶은 문서에서 다른 제도 구간이 같은 점수를 받지 않도록 제목 자체의 포함 비율도 함께 반영한다.
  const titleCoverage = coreCoverage(title, core);
  const coverage = candidate.context === undefined ? titleCoverage : 0.4 * titleCoverage + 0.6 * coreCoverage(title + compactSearchText(candidate.context), core);
  const detailHits = details.filter((term) => title.includes(term)).length;
  let score = baseQuality(candidate);
  if (candidate.entity_type === "manual_section") {
    // 제목이 사업명을 덜 담을수록 낮춘다. 사업명이 전혀 없으면 본문 우연 일치일 가능성이 높다.
    score *= 0.7 + 0.3 * coverage;
    if (isNoiseManualTitle(candidate.title) && !FORM_REQUEST.test(plan.raw_query)) score *= 0.6;
    // 질문의 구체적 세부조건(단독가구·선정기준액 등)은 같은 사업을 다루는 구간에서 크게 가산한다.
    score += Math.min(2, detailHits) * 0.15 * (coverage >= 0.5 ? 1 : coverage);
  } else {
    score += Math.min(2, detailHits) * 0.08;
  }
  score += regionBonus(candidate, plan);
  if (candidate.entity_type === "official_faq") score += 0.25 * clamp(candidate.question_similarity ?? 0) + (candidate.question_exact ? 0.2 : 0);
  // 종사자 질문은 인력·자격 구간을, 그 밖의 질문은 기존 순서를 따른다.
  if (plan.subject_scope === "staff" && STAFF_TERM_PATTERN.test(candidate.title)) score += 0.08;
  for (const flag of scopeFlags(candidate, plan)) {
    // 다른 제도의 근거는 상위에서 밀어낸다(삭제하지 않고 표시한다). 빈 본문은 승격하지 않는다.
    score *= flag === "PROGRAM_MISMATCH" ? 0.35 : flag === "PROGRAM_MISMATCH_INFERRED" ? (candidate.entity_type === "official_faq" ? 0.9 : 0.7) : 0.3;
  }
  // 정렬은 상한 없이 하고(1.0 동점 방지), 응답의 relevance_score만 0~100으로 자른다.
  return Math.max(0, score * intentWeight(candidate.entity_type, plan));
}

const BUDGET_QUERY_STOPWORDS: ReadonlySet<string> = new Set(["예산", "재정", "세출", "집행", "집행액", "본예산", "추경", "추가경정예산", "편성", "금액", "얼마", "현황", "내역", "사업", "관련"]);

/**
 * 예산서 행 이름 검색어. 의도어("예산")와 이미 필터로 쓰는 지역명은 빼고,
 * 예산서 사업명이 "용인 강소기업…"처럼 시·군·구 접미사 없이 적히는 점을 반영한다.
 * 남는 단어가 없으면 빈 문자열(예산서 후보를 고르지 않음)을 돌려준다.
 */
export function budgetReferenceQuery(plan: Pick<RefinedWelfareQuery, "programs" | "search_tokens">, region: { readonly sido: string; readonly sigungu: string }): string {
  const regionNames = new Set([region.sido, region.sigungu].filter(Boolean));
  // 질문에 실제로 쓴 검색어를 쓴다. 정규화된 공식 사업명("의료·요양 통합돌봄")은 예산서 행 이름과 다르게 적히는 경우가 많다.
  const source = plan.search_tokens.length ? plan.search_tokens : plan.programs;
  const terms = [...new Set(source.flatMap((value) => value.split(/\s+/)))]
    .filter((term) => term && !BUDGET_QUERY_STOPWORDS.has(term) && !regionNames.has(term))
    .map((term) => /^[가-힣]{2,3}[시군구]$/.test(term) ? term.slice(0, -1) : term);
  return [...new Set(terms)].slice(0, 5).join(" ");
}

function guaranteedTypes(plan: FusionPlan): ((candidate: FusionCandidate) => boolean)[] {
  const intents = new Set(plan.intents);
  const rules: ((candidate: FusionCandidate) => boolean)[] = [];
  if (intents.has("budget")) rules.push((candidate) => candidate.entity_type === "budget_line");
  if (intents.has("news")) rules.push((candidate) => candidate.entity_type === "press_release");
  // 법률 정의·의무·과태료 질문은 조문 원문 후보를 3위 안에 둔다.
  if (plan.legal_intent) rules.push((candidate) => candidate.entity_type === "law");
  if (intents.has("local_scope") && plan.region_id && plan.region_id !== "region:전국") {
    rules.push((candidate) => PROGRAM_TYPES.has(candidate.entity_type) && regionBonus(candidate, plan) > 0);
  }
  return rules;
}

/**
 * 같은 척도로 정렬하고 다음을 보장한다.
 * - 같은 제목의 매뉴얼 구간 중복 제거(가장 높은 것만 유지)
 * - 상위 8개 안 매뉴얼 구간은 최대 4개
 * - 예산·보도자료·지역 질문은 해당 종류의 최상위 후보를 3위 안에 둔다
 */
export function fuseSearchCandidates<T extends FusionCandidate>(candidates: readonly T[], plan: FusionPlan, limit = SEARCH_RESULT_LIMIT): (Omit<T, "rank" | "context"> & { relevance_score: number; scope_flags?: string[] })[] {
  const scored = candidates.map((candidate) => ({ candidate, score: fusedScore(candidate, plan) }))
    .sort((a, b) => b.score - a.score || b.candidate.rank - a.candidate.rank || a.candidate.id.localeCompare(b.candidate.id));
  const seenIds = new Set<string>();
  const seenManualTitles = new Set<string>();
  const unique = scored.filter(({ candidate }) => {
    if (seenIds.has(candidate.id)) return false;
    seenIds.add(candidate.id);
    if (candidate.entity_type !== "manual_section") return true;
    const key = compactSearchText(candidate.title.replace(/^\[[^\]]+\]\s*/, ""));
    if (seenManualTitles.has(key)) return false;
    seenManualTitles.add(key);
    return true;
  });
  // 상위 창의 매뉴얼 상한: 넘치는 매뉴얼은 창 뒤로 보낸다.
  const top: typeof unique = [], overflow: typeof unique = [];
  let manualsInTop = 0;
  for (const item of unique) {
    const isManual = item.candidate.entity_type === "manual_section";
    if (top.length < TOP_WINDOW && (!isManual || manualsInTop < MANUAL_TOP_CAP)) {
      top.push(item);
      if (isManual) manualsInTop += 1;
    } else overflow.push(item);
  }
  const ordered = [...top, ...overflow];
  // 보장할 종류가 여러 개여도 모두 3위 안에 들도록 2위·3위부터 채운다(1위는 점수 그대로).
  const rules = guaranteedTypes(plan);
  let slot = Math.max(1, GUARANTEE_POSITION - (rules.length - 1));
  for (const rule of rules) {
    const index = ordered.findIndex((item) => rule(item.candidate));
    if (index < 0) continue;
    if (index > slot) ordered.splice(slot, 0, ...ordered.splice(index, 1));
    slot += 1;
  }
  return ordered.slice(0, limit).map(({ candidate, score }) => {
    const { rank: _rank, context: _context, ...rest } = candidate;
    const flags = [...new Set([...(candidate.scope_flags ?? []), ...scopeFlags(candidate, plan)])];
    return { ...rest, relevance_score: Math.round(clamp(score) * 100), ...(flags.length ? { scope_flags: flags } : {}) };
  });
}

