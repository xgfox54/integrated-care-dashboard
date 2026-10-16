// 통합 검색의 보조 판단: 단계별 완화 검색 계획, 법령 질문의 법령명 연결, 답변 가능성(answerability) 판정.
// 질문 ID·정답을 쓰지 않는다. 검색 결과에 실제로 있는 근거 유형·범위 표시·숫자 포함 여부만 본다.
import { detectPrograms, type RefinedWelfareQuery } from "./query-refiner.ts";
import { compactSearchText } from "./search-text.ts";

/** 답변 근거로 볼 수 있는 결과 유형. 통계·예산서·보도자료는 제도 답변의 직접 근거가 아니다. */
export const EVIDENCE_TYPES: ReadonlySet<string> = new Set(["implementation", "gov24_service", "welfare100_service", "document_program", "manual_section", "official_faq", "law"]);

export interface RelaxationStage {
  readonly stage: "program_only" | "core_terms";
  readonly plan: RefinedWelfareQuery;
}

const RELAX_STOP = /^(?:지원|사업|서비스|신청|대상|방법|기준|경우|가능|여부|관련|문의|안내|내용|무엇|어떻게|누구|얼마|언제|어디|받을|있는|하는|되는)$/;

/**
 * 첫 검색에서 근거 후보가 없을 때 쓰는 완화 계획.
 * 1단계: 제도명만 남기고 세부조건을 뺀다. 2단계: 질문의 가장 구체적인(긴) 핵심어 두 개로 다시 찾는다.
 */
export function relaxationStages(plan: RefinedWelfareQuery): RelaxationStage[] {
  const stages: RelaxationStage[] = [];
  if (plan.programs.length && plan.detail_terms.length) {
    const query = plan.search_queries[0] ?? plan.programs[0];
    stages.push({ stage: "program_only", plan: { ...plan, detail_terms: [], subservices: [], search_query: query, search_queries: [query], search_tokens: query.split(/\s+/).slice(0, 5) } });
  }
  const core = [...new Set([...plan.detail_terms, ...plan.search_tokens].flatMap((value) => value.split(/\s+/)))]
    .filter((term) => term.length >= 2 && !RELAX_STOP.test(term) && !plan.programs.some((program) => program.includes(term)))
    .sort((a, b) => b.length - a.length).slice(0, 2);
  if (core.length && core.join(" ") !== plan.search_query) {
    stages.push({ stage: "core_terms", plan: { ...plan, programs: [], subservices: [], detail_terms: core.slice(1), search_query: core.join(" "), search_queries: [core.join(" ")], search_tokens: core } });
  }
  return stages;
}

// 제도·용어 → 법령명. 법률 정의·의무·과태료를 묻는 질문에서 search_law에 넘길 정식 법령명이다.
const LAW_RULES: readonly (readonly [RegExp, string])[] = [
  [/국민기초생활|기초생활\s*보장|생계급여|주거급여|교육급여|수급자/, "국민기초생활 보장법"],
  [/긴급복지|긴급지원/, "긴급복지지원법"],
  [/기초연금/, "기초연금법"],
  [/장애인연금/, "장애인연금법"],
  [/활동지원/, "장애인활동 지원에 관한 법률"],
  [/장기요양/, "노인장기요양보험법"],
  [/의료급여/, "의료급여법"],
  [/금연|흡연|전자담배|담배/, "국민건강증진법"],
  [/장사|자연장|봉안|화장시설|묘지/, "장사 등에 관한 법률"],
  [/치매/, "치매관리법"],
  [/자살/, "자살예방 및 생명존중문화 조성을 위한 법률"],
  [/건강검진/, "건강검진기본법"],
  [/한부모/, "한부모가족지원법"],
  [/아동학대/, "아동학대범죄의 처벌 등에 관한 특례법"],
  [/아동수당|아동복지|아동보호|위탁가정|가정위탁/, "아동복지법"],
  [/모자보건|산후조리|임산부/, "모자보건법"],
  [/감염병|예방접종/, "감염병의 예방 및 관리에 관한 법률"],
  [/정신건강|정신질환/, "정신건강증진 및 정신질환자 복지서비스 지원에 관한 법률"],
  [/응급의료|응급실/, "응급의료에 관한 법률"],
  [/약국|약사|조제|의약품/, "약사법"],
  [/의료인|의료기관|의료법|진료기록|간호사|의사/, "의료법"],
  [/개인정보/, "개인정보 보호법"],
  [/사회복지사|사회복지법인|사회복지시설|사회복지사업/, "사회복지사업법"],
  [/노인복지|경로당|노인학대|노인일자리/, "노인복지법"],
  [/장애인/, "장애인복지법"],
  [/국민건강보험|건강보험료|본인부담/, "국민건강보험법"],
];

/** 질문에 법령명이 직접 있으면 그대로, 없으면 제도·용어 규칙으로 법령명을 정한다. 찾지 못하면 null. */
export function lawNameForQuery(plan: Pick<RefinedWelfareQuery, "normalized_query" | "programs">): string | null {
  const explicit = /([가-힣]{2,20}(?:\s?[가-힣]{1,10}){0,3}법(?:률)?)(?=\s|에|상|의|은|는|$|[?,.])/.exec(plan.normalized_query);
  if (explicit && !/^(?:방법|불법|위법|적법|편법|합법)$/.test(explicit[1]) && !/방법$/.test(explicit[1])) return explicit[1].replace(/\s+/g, " ").trim();
  const text = plan.programs.join(" ") + " " + plan.normalized_query;
  return LAW_RULES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

export interface LawSearchHit { readonly name: string; readonly law_id: string; readonly mst: string; readonly current: boolean }

/** get_law_text 목차("제2조 정의 제3조 ...")에서 조문 번호와 제목을 읽는다. */
export function parseLawToc(text: string): { article: string; title: string }[] {
  const toc = text.slice(text.indexOf("목차") >= 0 ? text.indexOf("목차") : 0);
  const items: { article: string; title: string }[] = [];
  for (const match of toc.matchAll(/(제\d{1,4}조(?:의\d{1,3})?)\s+([^제\n]{0,40}?)(?=\s+제\d{1,4}조|\n|$)/g)) {
    items.push({ article: match[1], title: match[2].trim() });
  }
  return items;
}

/**
 * 질문에 맞는 조문을 고른다. 정의 질문은 '정의' 조(없으면 질문어가 제목인 조), 그 밖에는 질문어·의도어가 제목과 겹치는 조.
 * 조문 원문 확인을 돕는 후보이며 해석·적용을 판정하지 않는다.
 */
export function pickLawArticles(toc: readonly { article: string; title: string }[], plan: Pick<RefinedWelfareQuery, "fact_types" | "detail_terms" | "search_tokens" | "normalized_query">, limit = 2): string[] {
  const compact = (value: string) => value.replace(/[\s·ᆞㆍ]/g, "");
  const words = [...new Set([...plan.detail_terms, ...plan.search_tokens].flatMap((value) => value.split(/\s+/)).map(compact).filter((value) => value.length >= 2))];
  const intentWords = [
    ...(/과태료/.test(plan.normalized_query) ? ["과태료"] : []), ...(/벌칙|처벌/.test(plan.normalized_query) ? ["벌칙"] : []),
    ...(/금연구역|흡연/.test(plan.normalized_query) ? ["금연"] : []), ...(/열람|사본|송부|전송/.test(plan.normalized_query) ? ["열람", "송부", "기록"] : []),
    ...(/종류/.test(plan.normalized_query) ? ["종류"] : []), ...(/신고/.test(plan.normalized_query) ? ["신고"] : []),
  ];
  const scored = toc.map((item, index) => {
    const title = compact(item.title);
    let score = words.filter((word) => title.includes(word) || word.includes(title) && title.length >= 2).length * 2 + intentWords.filter((word) => title.includes(word)).length * 3;
    // 과태료·벌칙을 묻는 질문은 제재 조문을 먼저 둔다.
    if (/과태료|벌칙/.test(title) && intentWords.some((word) => title.includes(word))) score += 2;
    if (plan.fact_types.includes("definition") && /^정의$/.test(title)) score += 4;
    return { item, score, index };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((entry) => entry.item.article);
}

/** korean-law-mcp search_law의 텍스트 결과에서 법령명·법령ID·MST를 읽는다. */
export function parseLawSearchHits(text: string): LawSearchHit[] {
  const hits: LawSearchHit[] = [];
  for (const match of text.matchAll(/^\s*\d+\.\s+([^\n]+?)\s*\n\s*-\s*법령ID:\s*(\S+)\s*\n\s*-\s*MST:\s*(\d+)/gm)) {
    hits.push({ name: match[1].replace(/\s*\[[^\]]*\]\s*$/, "").trim(), law_id: match[2], mst: match[3], current: !/연혁|과거/.test(match[1]) });
  }
  return hits;
}

export type Answerability = "SUPPORTED" | "PARTIAL" | "INSUFFICIENT" | "CONFLICT";

// 근거 발췌문이 해당 사실 유형을 담는지 보는 표지어. 정답 판정이 아니라 '그 종류의 문장이 있는가'만 본다.
const FACT_SIGNALS: Readonly<Record<string, RegExp>> = {
  definition: /말한다|이란|정의|뜻|의미|해당하는\s*자|를\s*말함/,
  eligibility: /대상|자격|기준|이하|이상|해당|선정|요건/,
  amount: /\d[\d,.]*\s*(?:천원|만원|억원|원|%|퍼센트)|본인부담|지원금액|단가/,
  duration: /\d+\s*(?:일|개월|년|주|시간)|이내|까지|기간|기한|유효/,
  procedure: /신청|접수|방문|온라인|제출|처리|절차|신고/,
  document: /서류|증명서|신청서|사본|확인서|통장|신분증|등본/,
  duplicate_use: /중복|병행|동시|함께\s*(?:받|이용)|제외/,
  exception: /다만|단,|예외|제외|불가|할\s*수\s*없|아니한다|않는다/,
  legal_basis: /법\s*제?\s*\d*\s*조|법률|시행령|시행규칙|조례|고시/,
  location: /주민센터|읍[·ㆍ]?면[·ㆍ]?동|보건소|센터|시[·ㆍ]?군[·ㆍ]?구|기관|누리집|홈페이지|☎|\d{2,4}-\d{3,4}-\d{4}|1[0-9]{3}/,
  status_check: /조회|확인|잔액|내역|열람/,
  overview: /./,
};
const NUMBER_FACT = /\d[\d,.]*\s*(?:천원|만원|억원|원|%|퍼센트|일|개월|년|주|시간|세|살|명|회)/g;

export interface AnswerabilityInput {
  readonly plan: Pick<RefinedWelfareQuery, "fact_types" | "legal_intent" | "program_scope" | "warnings"> & Partial<Pick<RefinedWelfareQuery, "requested_year" | "excluded_years" | "search_tokens" | "detail_terms">>;
  readonly results: readonly { readonly entity_type: string; readonly relevance_score: number; readonly title?: string; readonly scope_flags?: readonly string[]; readonly excerpt?: string; readonly freshness?: { readonly status: string }; readonly applicable_year?: number | string | null; readonly sources?: readonly { readonly applicable_year?: number | string | null; readonly document_title?: string; readonly original_name?: string; readonly location?: { readonly heading_path?: string } }[] }[];
  readonly relaxed: boolean;
  readonly legalStatus: string;
  /** 일부 출처 조회가 실패했으면 true(UPSTREAM_ERROR). */
  readonly sourceErrors?: boolean;
}

export interface AnswerabilityResult {
  readonly answerability: Answerability;
  readonly coverage: {
    readonly fact_types: readonly string[];
    readonly evidence_candidates: number;
    readonly evidence_types: readonly string[];
    readonly program_scope: readonly string[];
    readonly program_scope_matched: boolean | null;
    readonly covered_programs: readonly string[];
    readonly matched_detail_terms: readonly string[];
    readonly unmatched_detail_terms: readonly string[];
    readonly numeric_evidence_seen: boolean | null;
    readonly numeric_facts_found: number;
    readonly required_fact_types: readonly string[];
    readonly covered_fact_types: readonly string[];
    readonly legal_source: string;
    readonly requested_year: number | null;
    readonly year_matched_evidence_candidates: number;
    readonly year_unconfirmed_evidence_candidates: number;
    readonly year_mismatched_evidence_candidates: number;
  };
  readonly reason_codes: readonly string[];
}

/**
 * 검색 결과만으로 답변 근거가 갖춰졌는지 표시한다. SUPPORTED도 '근거 후보가 갖춰짐'이며 정답 판정이 아니다.
 * 다른 제도 근거·빈 본문 구간은 근거 수에서 뺀다.
 */
export function assessAnswerability(input: AnswerabilityInput): AnswerabilityResult {
  const { plan, results } = input;
  const top = results.slice(0, 6);
  const blockedFlags = ["PROGRAM_MISMATCH", "EMPTY_SOURCE_BODY", "REGION_MISMATCH", "YEAR_MISMATCH", "YEAR_EXCLUDED", "RELATED_CANDIDATE"];
  const blocked = (item: AnswerabilityInput["results"][number]) => (item.scope_flags ?? []).some((flag) => blockedFlags.includes(flag));
  const evidence = top.filter((item) => EVIDENCE_TYPES.has(item.entity_type) && !blocked(item));
  const reasons = new Set<string>();
  for (const flag of blockedFlags) if (top.some((item) => item.scope_flags?.includes(flag))) reasons.add(flag);
  const requestedYear = plan.requested_year ?? null;
  const needsApplicableYear = plan.fact_types.some((type) => type === "amount" || type === "duration" || type === "eligibility");
  const dated = evidence.map((item) => {
    const applicable = [item.applicable_year, ...(item.sources ?? []).map((source) => source.applicable_year)].filter((year) => year !== null && year !== undefined).map(Number).filter(Number.isInteger);
    const years = [...new Set([...applicable, ...[...(item.excerpt ?? "").matchAll(/(?<!\d)(20\d{2})\s*년/g)].map((match) => Number(match[1]))])];
    const excluded = years.some((year) => plan.excluded_years?.includes(year));
    const status = excluded ? "YEAR_EXCLUDED" : requestedYear === null ? "NOT_REQUESTED" : !years.length ? "YEAR_UNCONFIRMED"
      : years.length !== 1 || years[0] !== requestedYear ? "YEAR_MISMATCH" : needsApplicableYear && !applicable.includes(requestedYear) ? "YEAR_UNCONFIRMED" : "MATCHED";
    if (status.startsWith("YEAR_")) reasons.add(status);
    return { item, status };
  });
  const applicableEvidence = dated.filter(({ item, status }) => (status === "MATCHED" || status === "NOT_REQUESTED") && (!item.freshness || item.freshness.status === "CURRENT")).map(({ item }) => item);
  if (!evidence.length) reasons.add("COVERAGE_GAP");
  if (top.some((item) => (item.scope_flags ?? []).some((flag) => flag.startsWith("PROGRAM_MISMATCH")))) reasons.add("PROGRAM_MISMATCH");
  if (top.some((item) => (item.scope_flags ?? []).includes("EMPTY_SOURCE_BODY"))) reasons.add("EMPTY_SOURCE_BODY");
  if (evidence.some((item) => item.freshness && item.freshness.status !== "CURRENT")) reasons.add("OUTDATED_OR_CONFLICTING_SOURCE");
  if (input.relaxed) reasons.add("QUERY_RELAXED");
  const withText = applicableEvidence.filter((item) => typeof item.excerpt === "string");
  const evidenceText = withText.map((item) => item.excerpt!).join("\n");
  const numericNeeded = plan.fact_types.some((type) => type === "amount" || type === "duration");
  const numericSeen = numericNeeded ? withText.some((item) => /\d/.test(item.excerpt!)) : null;
  const numericFacts = new Set(evidenceText.match(NUMBER_FACT) ?? []).size;
  // 발췌문이 없는 공식 상세(정부24·사업 카드·법령)는 상세 조회 대상이므로 사실 유형을 덮은 것으로 보지 않는다.
  const covered = plan.fact_types.filter((type) => type === "legal_basis" ? applicableEvidence.some((item) => item.entity_type === "law") || FACT_SIGNALS.legal_basis.test(evidenceText) : (FACT_SIGNALS[type] ?? /./).test(evidenceText));
  for (const type of plan.fact_types) if (!covered.includes(type)) reasons.add("MISSING_" + type.toUpperCase());
  if (numericNeeded && !numericSeen) reasons.add("NUMERIC_EVIDENCE_NOT_SEEN");
  const evidencePrograms = new Set(applicableEvidence.flatMap((item) => detectPrograms([item.title, item.excerpt, ...(item.sources ?? []).flatMap((source) => [source.document_title, source.original_name, source.location?.heading_path])].filter(Boolean).join(" "))));
  const coveredPrograms = plan.program_scope.filter((program) => evidencePrograms.has(program));
  const scopeMatched = plan.program_scope.length ? coveredPrograms.length === plan.program_scope.length : null;
  if (scopeMatched === false) reasons.add("PROGRAM_COVERAGE_GAP");
  const lawFound = results.some((item) => item.entity_type === "law");
  if (plan.legal_intent && !lawFound) reasons.add(input.legalStatus === "DISABLED" ? "LEGAL_SOURCE_DISABLED" : input.legalStatus === "NOT_CONFIGURED" ? "LEGAL_SOURCE_NOT_CONFIGURED" : "LEGAL_SOURCE_NOT_FOUND");
  const conflict = plan.warnings.some((warning) => warning.startsWith("CONFLICTING_"));
  if (conflict) reasons.add("CONFLICTING_CONSTRAINTS");
  if (input.sourceErrors) reasons.add("UPSTREAM_ERROR");
  const strong = applicableEvidence.some((item) => item.relevance_score >= 55);
  // 제도명이 없는 질문은 '기한·금액·서류' 같은 사실 유형어 말고 주제어(가상·미등록 등)가 근거에 있어야 충분하다고 본다.
  const subjects = plan.program_scope.length ? [] : (plan.search_tokens ?? []).map(compactSearchText)
    .filter((term) => term.length >= 2 && !Object.entries(FACT_SIGNALS).some(([type, pattern]) => type !== "overview" && pattern.test(term)));
  const subjectFound = !subjects.length || applicableEvidence.some((item) => {
    const text = compactSearchText([item.title, item.excerpt].filter(Boolean).join(" "));
    return subjects.some((term) => text.includes(term));
  });
  if (!subjectFound) reasons.add("SUBJECT_NOT_FOUND");
  const detailTerms = [...new Set((plan.detail_terms ?? []).map(compactSearchText))].filter((term) => term.length >= 2 && !/\d/.test(term) && !RELAX_STOP.test(term));
  const sourceText = compactSearchText(applicableEvidence.map((item) => [item.title, item.excerpt, ...(item.sources ?? []).map((source) => source.location?.heading_path)].filter(Boolean).join(' ')).join(' '));
  const matchedDetails = detailTerms.filter((term) => sourceText.includes(term));
  const unmatchedDetails = detailTerms.filter((term) => !sourceText.includes(term));
  const detailsUnconfirmed = detailTerms.length > 0 && (plan.program_scope.length > 0 ? unmatchedDetails.length > 0 : matchedDetails.length === 0);
  if (detailsUnconfirmed) reasons.add("INSUFFICIENT_DETAIL_EVIDENCE");
  const legalOk = !plan.legal_intent || lawFound || evidence.some((item) => item.entity_type === "official_faq" || item.entity_type === "manual_section");
  const factsCovered = plan.fact_types.every((type) => covered.includes(type));
  const answerability: Answerability = conflict ? "CONFLICT" : !evidence.length ? "INSUFFICIENT"
    : strong && subjectFound && !detailsUnconfirmed && scopeMatched !== false && numericSeen !== false && legalOk && factsCovered && !input.relaxed && !input.sourceErrors ? "SUPPORTED" : "PARTIAL";
  return {
    answerability,
    coverage: {
      fact_types: plan.fact_types, evidence_candidates: evidence.length, evidence_types: [...new Set(evidence.map((item) => item.entity_type))],
      program_scope: plan.program_scope, program_scope_matched: scopeMatched, covered_programs: coveredPrograms, matched_detail_terms: matchedDetails, unmatched_detail_terms: unmatchedDetails, numeric_evidence_seen: numericSeen, numeric_facts_found: numericFacts,
      required_fact_types: plan.fact_types, covered_fact_types: covered, legal_source: input.legalStatus,
      requested_year: requestedYear, year_matched_evidence_candidates: dated.filter(({ status }) => status === "MATCHED").length,
      year_unconfirmed_evidence_candidates: dated.filter(({ status }) => status === "YEAR_UNCONFIRMED").length,
      year_mismatched_evidence_candidates: dated.filter(({ status }) => status === "YEAR_MISMATCH").length,
    },
    reason_codes: [...reasons],
  };
}

/** 저장 자료에서 근거를 찾지 못했을 때 확인할 공식 경로. */
export function suggestedSources(plan: Pick<RefinedWelfareQuery, "legal_intent" | "fact_types">): { name: string; url: string; use: string }[] {
  return [
    { name: "보건복지상담센터 129 자주하는 질문", url: "https://www.129.go.kr/faq/faq00.do", use: "search_faq 도구로 수록본을 먼저 확인" },
    { name: "보건복지부", url: "https://www.mohw.go.kr", use: "공식 사업안내·공고·정책 자료 원문" },
    { name: "복지로 복지서비스", url: "https://www.bokjiro.go.kr", use: "제도별 지원대상·신청방법 원문" },
    ...(plan.legal_intent ? [{ name: "국가법령정보센터", url: "https://www.law.go.kr", use: "공식 웹 원문의 해당 조문·시행일 확인" }] : []),
    ...(plan.fact_types.includes("procedure") || plan.fact_types.includes("document") ? [{ name: "정부24 보조금24", url: "https://www.gov.kr", use: "신청 경로·구비서류" }] : []),
  ];
}

export const WEB_SEARCH_FALLBACK_INSTRUCTIONS = "MCP 저장 자료에서 직접 근거를 찾지 못하거나 상세 조회 후에도 필요한 조건·금액·지역·적용연도·충돌이 해결되지 않으면, 사용 가능한 웹검색 도구로 공식 자료를 찾아 답변을 이어가세요. 검색 결과가 없다는 이유로 사업이 없다고 답하거나 웹검색 여부를 다시 묻지 마세요. web_search_fallback의 next_action·queries·preferred_sources를 참고하되 원질문, 포함·제외 사업·연도 및 지역 조건을 유지하세요. 먼저 관련 MCP 상세와 이어 읽기를 확인하고, 보건복지부·129·복지로·정부24·해당 지자체·공식 사업기관·국가법령정보센터·공식 통계기관의 원문을 우선 검색하세요. 검색 결과 제목·요약만으로 답하지 말고 본문과 적용연도·대상·예외·단위를 확인하세요. 웹에서 확인한 근거는 MCP 저장 자료와 구분해 기관·원문 링크·자료 작성/수정일·적용연도를 표시하고, 확인일을 공표일로 쓰지 마세요. 웹자료와 저장 원문이 충돌하면 차이와 확인 범위를 설명하며 해결되지 않은 조건을 단정하지 마세요. 웹검색 도구가 없거나 공식 원문을 열 수 없으면 그 한계와 공식 링크·문의처를 안내하세요. 발견한 웹자료가 MCP DB에 저장되었다고 표현하지 마세요. 출처 URL은 도구나 공식 원문에서 받은 전체 주소를 그대로 인용하세요. 조회 매개변수·파일명·percent-encoding을 임의 재구성하거나 생략하지 말고 질문마다 주장과 실제 링크 대상이 일치하는지 확인하세요. 자료의 기준연도는 제목·직접 본문·표·각주를 함께 대조하고 검색 색인이나 캐시의 연도를 현행 원문의 연도로 단정하지 마세요. 게시일·시행일·수정일이 표시되지 않으면 미확인으로 적으세요. 닫히거나 이전된 출처의 검색 요약만 읽은 경우 그 한계를 표시하고 열람 가능한 공식 원문으로 보완하세요. 신청 자격·서류를 요약할 때 명시된 제외조건과 조건부 면제 각주를 함께 안내하세요.";

export function webSearchFallback(plan: RefinedWelfareQuery, assessment: Pick<AnswerabilityResult, "answerability" | "reason_codes">) {
  const clarify = (!plan.search_tokens.length && !plan.region_id) || assessment.reason_codes.includes("CONFLICTING_CONSTRAINTS");
  const missing = assessment.answerability === "INSUFFICIENT";
  const nextAction = clarify ? "CLARIFY_QUERY" : missing ? "WEB_SEARCH_OFFICIAL"
    : assessment.answerability === "SUPPORTED" ? "READ_MCP_DETAILS" : "READ_MCP_DETAILS_THEN_WEB_IF_NEEDED";
  const legal = plan.legal_intent || assessment.reason_codes.some(code => code.startsWith("LEGAL_SOURCE_"));
  const scope = [plan.region_id?.replace(/^region:/, "").replace(/\|/g, " "), plan.requested_year ? String(plan.requested_year) + "년" : null].filter(Boolean).join(" ");
  const query = [plan.search_query, ...plan.detail_terms, scope].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const queries = clarify ? [] : [...new Set([plan.raw_query, query + " site:go.kr", query + " site:bokjiro.go.kr",
    ...(legal ? [query + " site:law.go.kr"] : [])])];
  return {
    policy: "official_web_evidence_when_mcp_insufficient_v1",
    next_action: nextAction,
    reason_codes: assessment.reason_codes,
    queries,
    constraints: { region_id: plan.region_id, requested_years: plan.requested_years, excluded_years: plan.excluded_years, programs: plan.program_scope, excluded_programs: plan.excluded_programs },
    preferred_sources: suggestedSources({ ...plan, legal_intent: legal }),
    performed_by: "HOST_ASSISTANT" as const,
    requires_available_web_tool: true,
    database_write: false,
    instructions: WEB_SEARCH_FALLBACK_INSTRUCTIONS,
  };
}

