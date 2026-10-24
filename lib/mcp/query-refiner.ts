import { REGION_DEFINITIONS } from "../region-statistics.ts";

/** Query interpretation only. This module contains no eligibility rules or official benefit amounts. */
export type WelfareQueryIntent = "overview" | "eligibility" | "benefit" | "amount" | "duration" | "procedure" | "required_documents" | "exception" | "comparison" | "wrong_premise" | "local_scope" | "table" | "legal_basis" | "budget" | "news" | "case_review";

export interface UserQueryAmount {
  raw: string;
  value: number;
  unit: "KRW";
  source: "user_input";
  verified: false;
  role: "premise_to_verify" | "user_condition";
}

export interface RefinedWelfareQuery {
  raw_query: string;
  normalized_query: string;
  /** The first query's terms may be ANDed. Separate search_queries are alternatives, not one AND query. */
  search_query: string;
  search_queries: string[];
  search_tokens: string[];
  /** Explicit positive qualifiers for ranking, not eligibility facts. */
  detail_terms: string[];
  programs: string[];
  excluded_programs: string[];
  subservices: string[];
  region_id: string | null;
  region_source: "explicit" | "program_hint" | "unspecified" | "ambiguous";
  include_ancestor_scope: boolean;
  current_year: number;
  /** Current default is a retrieval preference, never proof that a document applies to that year. */
  year: number | null;
  requested_year: number | null;
  requested_years: number[];
  excluded_years: number[];
  year_source: "explicit" | "relative" | "current_default" | "comparison" | "ambiguous";
  intents: WelfareQueryIntent[];
  amounts: UserQueryAmount[];
  household_size: number | null;
  subject_conditions: string[];
  warnings: string[];
  /** 질문이 요구하는 사실 유형(답변 가능 여부 판정용). 첫 항목이 주 유형이다. */
  fact_types: WelfareFactType[];
  /** 법률 정의·의무·과태료·조문을 묻는 질문. 통합 검색이 내장 법령 도구를 함께 조회한다. */
  legal_intent: boolean;
  /** 답변 근거가 속해야 하는 제도. 명시 제도가 없으면 '수급자' 같은 맥락에서 약하게 추정한다. */
  program_scope: string[];
  program_scope_source: "explicit" | "inferred" | "none";
  /** 질문 대상: 서비스 이용자(beneficiary) 또는 종사자·인력(staff). */
  subject_scope: "beneficiary" | "staff";
  /** 부정·제외·중복 불가 표현. 검색어에서는 빼되 의미는 보존한다. */
  negations: string[];
}

export type WelfareFactType = "definition" | "eligibility" | "amount" | "duration" | "procedure" | "document" | "duplicate_use" | "exception" | "legal_basis" | "location" | "status_check" | "overview";

interface ProgramTerm { name: string; aliases: readonly string[]; queries?: readonly string[] }

// Business names and spelling aliases, not answers or an ID-indexed golden-question lookup.
const PROGRAM_TERMS: readonly ProgramTerm[] = [
  { name: "생계급여", aliases: ["생계급여", "기초생활생계급여", "국민기초생활보장생계급여"] },
  { name: "사회보장급여 공통업무", aliases: ["사회보장급여공통업무", "사회보장급여"] },
  { name: "주거급여", aliases: ["주거급여"] },
  { name: "의료급여", aliases: ["의료급여", "재가의료급여"] },
  { name: "교육급여", aliases: ["교육급여"] },
  { name: "기초연금", aliases: ["기초연금", "기초노령연금"] },
  { name: "청년월세", aliases: ["청년월세한시특별지원", "청년월세지원", "청년월세"], queries: ["청년 월세", "청년월세"] },
  { name: "행복이음", aliases: ["행복이음", "행복e음", "사회보장정보시스템"] },
  { name: "통합돌봄지원정보시스템", aliases: ["통합돌봄지원정보시스템", "통합돌봄정보시스템"] },
  { name: "차상위계층", aliases: ["차상위계층", "차상위확인", "차상위본인부담경감", "차상위"], queries: ["차상위"] },
  { name: "자활", aliases: ["자활사업", "자활근로", "자활"] },
  { name: "장애인 활동지원", aliases: ["장애인활동지원", "장애인활동보조", "장애활동지원", "활동지원"] },
  { name: "발달장애인 지원", aliases: ["발달장애인지원사업", "발달장애인지원", "발달장애인", "발달장애"], queries: ["발달장애"] },
  { name: "노인맞춤돌봄", aliases: ["노인맞춤돌봄서비스", "노인맞춤돌봄", "맞춤돌봄"] },
  { name: "부모급여", aliases: ["부모급여", "영아수당"] },
  { name: "첫만남이용권", aliases: ["첫만남이용권", "첫만남바우처"] },
  { name: "다함께돌봄", aliases: ["다함께돌봄센터", "다함께돌봄"] },
  { name: "긴급복지", aliases: ["긴급복지생계지원", "긴급생계지원", "긴급복지지원", "긴급의료지원", "긴급주거지원", "긴급지원사업", "긴급생계요청", "긴급복지"] },
  { name: "재난적의료비", aliases: ["재난적의료비지원", "재난적의료비"], queries: ["재난적 의료비", "재난적의료비"] },
  { name: "지역사회서비스 투자사업", aliases: ["지역사회서비스투자사업", "지역사회서비스투자", "지역사회서비스", "지투사업"], queries: ["지역사회서비스"] },
  { name: "에너지바우처", aliases: ["에너지바우처"] },
  { name: "일상돌봄", aliases: ["일상돌봄서비스", "일상돌봄"] },
  { name: "가사간병", aliases: ["가사간병방문지원사업", "가사간병방문지원", "가사간병지원", "가사간병"] },
  { name: "의료·요양 통합돌봄", aliases: ["의료요양통합돌봄", "의료요양등지역돌봄", "의료돌봄통합지원", "통합돌봄"], queries: ["통합돌봄"] },
  { name: "기부식품", aliases: ["기부식품제공사업", "기부식품", "푸드뱅크", "푸드마켓"] },
  { name: "그냥드림", aliases: ["그냥드림"] },
  { name: "통합사례관리", aliases: ["통합사례관리", "희망복지지원단"] },
  { name: "노숙인 복지", aliases: ["노숙인복지", "노숙인지원", "노숙인"], queries: ["노숙인"] },
  { name: "지역사회보장협의체", aliases: ["지역사회보장협의체", "지역사회복지협의체", "지사협"] },
  { name: "사회복지관", aliases: ["사회복지관운영", "사회복지관"] },
  { name: "사회보장제도 신설·변경", aliases: ["사회보장제도신설변경", "사회보장제도신설", "사회보장제도변경", "신설변경협의"], queries: ["사회보장제도 신설", "사회보장제도 변경"] },
  { name: "정신건강", aliases: ["정신건강사업", "정신건강"] },
  { name: "모자보건", aliases: ["모자보건"] },
  { name: "사회복지 보조금", aliases: ["사회복지보조금", "지방보조금관리", "지방보조금"], queries: ["보조금"] },
  { name: "제주가치돌봄", aliases: ["제주가치돌봄", "가치돌봄"] },
  { name: "위기가구 신고포상금", aliases: ["위기가구신고포상금", "위기가구발굴포상금"], queries: ["위기가구 포상금"] },
  { name: "노인복지", aliases: ["노인복지"] },
  { name: "사회복지시설", aliases: ["사회복지시설현황", "사회복지시설"] },
  { name: "충혼묘지", aliases: ["충혼묘지"] },
  { name: "온정가게", aliases: ["온정가게"] },
  { name: "식사지원", aliases: ["식사지원", "식사배달", "도시락지원"] },
  { name: "국민기초생활보장", aliases: ["국민기초생활보장", "기초생활보장"] },
  { name: "장애인연금", aliases: ["장애인연금"] },
  { name: "장애수당", aliases: ["장애수당"] },
  { name: "아동수당", aliases: ["아동수당"] },
  { name: "긴급돌봄", aliases: ["긴급돌봄지원", "긴급돌봄"] },
  { name: "응급안전안심서비스", aliases: ["응급안전안심서비스", "응급안전알림서비스", "응급안전안심"] },
  { name: "장기요양 재택의료", aliases: ["장기요양재택의료센터시범사업", "장기요양재택의료시범사업", "장기요양재택의료센터", "장기요양재택의료"], queries: ["장기요양 재택의료"] },
  { name: "노인장기요양보험", aliases: ["노인장기요양보험", "장기요양보험", "장기요양기관", "장기요양급여", "장기요양등급", "장기요양"] },
  { name: "청소년산모 의료비", aliases: ["청소년산모임신출산의료비", "청소년산모의료비", "청소년산모"] },
  { name: "장애인등록", aliases: ["장애인등록증", "장애인등록", "장애등록"] },
  { name: "청년내일저축계좌", aliases: ["청년내일저축계좌", "청년내일저축"] },
  { name: "희망저축계좌", aliases: ["희망저축계좌"] },
  { name: "디딤씨앗통장", aliases: ["디딤씨앗통장", "디딤씨앗"] },
  { name: "치매관리", aliases: ["치매안심센터", "치매관리", "치매환자"] },
  { name: "치매공공후견", aliases: ["치매공공후견"] },
  { name: "암환자 의료비", aliases: ["암환자의료비지원", "암환자의료비", "암환자"] },
  { name: "스포츠바우처", aliases: ["스포츠바우처", "스포츠강좌이용권"] },
  { name: "자살예방", aliases: ["자살예방상담", "자살예방"] },
  { name: "건강검진", aliases: ["일반건강검진", "국가건강검진", "건강검진"] },
  { name: "금연", aliases: ["금연구역", "전자담배", "금연"] },
  { name: "아동복지시설", aliases: ["아동복지시설", "아동양육시설"] },
  { name: "장사", aliases: ["자연장", "봉안당", "장사시설"] },
  { name: "문화누리카드", aliases: ["문화누리카드", "문화누리", "통합문화이용권"], queries: ["문화누리카드", "통합문화이용권"] },
];

const SUBSERVICES: readonly [string, readonly string[]][] = [
  ["식사지원", ["식사지원", "식사배달", "도시락지원"]],
  ["생계지원", ["생계지원", "긴급생계"]],
  ["의료지원", ["의료지원"]],
  ["일시재가", ["일시재가"]],
  ["일상생활지원", ["일상생활지원"]],
  ["동행지원", ["동행지원"]],
  ["운동지도", ["운동지도"]],
  ["방문목욕", ["방문목욕"]],
  ["주거편의", ["주거편의"]],
  ["본인부담경감", ["본인부담경감"]],
  ["주거지원", ["주거지원", "긴급주거"]],
];

interface Mention<T> { value: T; start: number; end: number; excluded?: boolean; relative?: boolean }
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const compact = (text: string): string => text.toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ・.,()[\]{}+/\-_]/g, "");

function compactIndex(text: string): { text: string; positions: number[] } {
  const positions: number[] = [];
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const character = compact(text[i]);
    if (character) { result += character; for (let offset = 0; offset < character.length; offset++) positions.push(i); }
  }
  return { text: result, positions };
}

/** A shortened name must be a phrase, not the middle of another compound noun. */
function shortAliasBoundary(text: string, start: number, end: number): boolean {
  if (start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) return false;
  const suffix = text.slice(end);
  if (!suffix || /^[^\p{L}\p{N}]/u.test(suffix)) return true;
  // Attached particles and neutral service nouns do not change the program name.
  // A different compound ending, such as an item ending in 지원비, remains intact.
  return /^(?:(?:사업|서비스|급여|제도|기관|센터|대상자?|이용자?|신청|시간|사))?(?:(?:에서|으로|부터|까지|에게|한테|처럼|보다|조차|마저|이라도|이라면|이고|인데|이나|이랑|하고|은|는|을|를|이|가|도|만|의|과|와|로|요))*(?=$|[^\p{L}\p{N}])/u.test(suffix);
}

/** Longest-match selection stops a system name being split into its parent program. */
function programMentions(text: string): Mention<ProgramTerm>[] {
  const indexed = compactIndex(text);
  const matches: Mention<ProgramTerm>[] = [];
  for (const term of PROGRAM_TERMS) {
    for (const alias of unique([term.name, ...term.aliases])) {
      const needle = compact(alias);
      const shortened = needle !== compact(term.name) && compact(term.name).endsWith(needle);
      let from = 0;
      for (;;) {
        const at = indexed.text.indexOf(needle, from);
        if (at < 0) break;
        const start = indexed.positions[at], end = indexed.positions[at + needle.length - 1] + 1;
        if (!shortened || shortAliasBoundary(text, start, end)) matches.push({ value: term, start, end });
        from = at + needle.length;
      }
    }
  }
  const chosen: Mention<ProgramTerm>[] = [];
  for (const match of matches.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)) {
    if (!chosen.some((previous) => match.start < previous.end && match.end > previous.start)) chosen.push(match);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

// An exclusion instruction is different from asking for a program's exclusion criteria.
const EXCLUDE_SUFFIX = /^(?:(?:의|을|를|은|는|과|와|도|만|이|가|에|관한|대한|관련|해당|조건|기준|자료|정보|내용|사업|금액|연도|년도|년|것|부분)|[\s,:：·])*?(?:섞지\s*(?:마|말)|혼합하지\s*(?:마|말)|혼동하지\s*(?:마|말)|포함하지\s*(?:마|말)|사용하지\s*(?:마|말)|참고하지\s*(?:마|말)|제외(?:하고|하여|하되|해서|해\s*(?:줘|주세요)?|할)|배제(?:하고|해)|빼고|빼\s*(?:줘|주세요)|말고|아니라|아닌)/;

function classifyExclusions<T>(text: string, mentions: Mention<T>[]): Mention<T>[] {
  const classified = mentions.map((mention, index) => {
    const end = mentions[index + 1]?.start ?? text.length;
    const suffix = text.slice(mention.end, end).split(/[.!?;。！？\n]/, 1)[0];
    const prefix = text.slice(0, mention.start).split(/[.!?;。！？\n]/).at(-1) ?? "";
    return { ...mention, excluded: EXCLUDE_SUFFIX.test(suffix) || /(?:제외|배제)(?:할)?\s*(?:연도|사업|자료)?\s*[:：]\s*$/.test(prefix) };
  });
  // Shared directives: "2024년과 2025년은 제외하고", "주거급여, 부모급여는 빼고".
  for (let index = classified.length - 2; index >= 0; index--) {
    const current = classified[index], next = classified[index + 1];
    if (next.excluded && /^(?:(?:과|와|및|하고|랑)|[\s,·])+$/.test(text.slice(current.end, next.start))) current.excluded = true;
  }
  return classified;
}

/** Reuse the query's exclusion grammar when ranking explicitly named details. */
export function positiveQueryTerms(text: string, terms: readonly string[]): string[] {
  const indexed = compactIndex(text);
  const mentions: Mention<string>[] = [];
  for (const term of unique(terms)) {
    const needle = compact(term);
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = indexed.text.indexOf(needle, from);
      if (at < 0) break;
      mentions.push({ value: term, start: indexed.positions[at], end: indexed.positions[at + needle.length - 1] + 1 });
      from = at + needle.length;
    }
  }
  const disjoint: Mention<string>[] = [];
  for (const mention of mentions.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
    if (!disjoint.some((other) => mention.start < other.end && mention.end > other.start)) disjoint.push(mention);
  }
  return unique(classifyExclusions(text, disjoint.sort((a, b) => a.start - b.start)).filter((mention) => !mention.excluded).map((mention) => mention.value));
}

function extractAmounts(text: string, premise: boolean): { values: UserQueryAmount[]; mentions: Mention<number>[] } {
  const values: UserQueryAmount[] = [], mentions: Mention<number>[] = [];
  // Parse the user's stated amount only. No amount here is accepted as evidence.
  const pattern = /(?<![\d.])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*[억만천백십]\s*(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)?)*)\s*원/g;
  const factors: Record<string, number> = { 억: 100_000_000, 만: 10_000, 천: 1_000, 백: 100, 십: 10 };
  for (const match of text.matchAll(pattern)) {
    let total = 0, group = 0, pending: number | null = null;
    for (const token of match[1].replaceAll(",", "").matchAll(/\d+(?:\.\d+)?|[억만천백십]/g)) {
      const factor = factors[token[0]];
      if (!factor) pending = Number(token[0]);
      else if (factor >= 10_000) { total += (pending !== null || group > 0 ? group + (pending ?? 0) : 1) * factor; group = 0; pending = null; }
      else { group += (pending ?? 1) * factor; pending = null; }
    }
    const value = total + group + (pending ?? 0);
    if (!Number.isFinite(value)) continue;
    values.push({ raw: match[0], value, unit: "KRW", source: "user_input", verified: false, role: premise ? "premise_to_verify" : "user_condition" });
    mentions.push({ value, start: match.index!, end: match.index! + match[0].length });
  }
  return { values, mentions };
}

function extractYears(text: string, currentYear: number, amounts: Mention<number>[]) {
  const mentions: Mention<number>[] = [];
  for (const match of text.matchAll(/(?<!\d)((?:19|20|21)\d{2})(?:\s*년(?:도)?|(?=\s|$|[.,;!?]))/g)) {
    if (!amounts.some((amount) => match.index! >= amount.start && match.index! < amount.end)) mentions.push({ value: Number(match[1]), start: match.index!, end: match.index! + match[0].length });
  }
  for (const match of text.matchAll(/올해|금년도?|작년|지난해|전년도?|내년|다음\s*해/g)) {
    const offset = /작년|지난해|전년/.test(match[0]) ? -1 : /내년|다음/.test(match[0]) ? 1 : 0;
    mentions.push({ value: currentYear + offset, start: match.index!, end: match.index! + match[0].length, relative: true });
  }
  return classifyExclusions(text, mentions.sort((a, b) => a.start - b.start));
}

function boundaryAfter(text: string, end: number): boolean {
  return end === text.length || /^[\s,·.!?;:：()|/-]|^(?:에서|으로|지역|도민|시민|군민|구민|내\s|의\s|에\s|은\s|는\s|과\s|와\s|만(?=\s|$))/.test(text.slice(end));
}

function extractRegion(text: string, programs: Mention<ProgramTerm>[]): { id: string | null; source: RefinedWelfareQuery["region_source"]; mentions: Mention<string>[]; warnings: string[] } {
  const mentions: Mention<string>[] = [];
  for (const region of REGION_DEFINITIONS) {
    const extra = region.id === "jeju" ? ["제주도"] : region.id === "jeonnam_gwangju" ? ["전남", "광주"] : [];
    const aliases = unique([region.fullName, ...region.aliases, region.shortLabel, ...extra]).sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      let from = 0;
      for (;;) {
        const start = text.indexOf(alias, from);
        if (start < 0) break;
        const end = start + alias.length;
        const overlapsProgram = programs.some((program) => start < program.end && end > program.start);
        if (!overlapsProgram && (start === 0 || !/[\p{L}\p{N}]/u.test(text[start - 1])) && boundaryAfter(text, end) && !mentions.some((other) => start < other.end && end > other.start)) mentions.push({ value: `region:${region.fullName}`, start, end });
        from = end;
      }
    }
  }
  // Jeju's administrative cities have an unambiguous province even when the province is omitted.
  for (const match of text.matchAll(/서귀포시?|제주시/g)) {
    if ((match.index! > 0 && /[\p{L}\p{N}]/u.test(text[match.index! - 1])) || !boundaryAfter(text, match.index! + match[0].length)) continue;
    const city = match[0].startsWith("서귀포") ? "서귀포시" : "제주시";
    mentions.push({ value: `region:제주특별자치도|${city}`, start: match.index!, end: match.index! + match[0].length });
  }
  // A city/district is resolved only with its explicit parent. "중구" alone is ambiguous.
  for (const province of [...mentions].filter((mention) => !mention.value.includes("|"))) {
    const city = /^\s*([가-힣]{2,12}(?:시|군|구))(?=\s|$|에서|의\s|에\s)/.exec(text.slice(province.end));
    if (city && !city[1].endsWith("가구")) {
      const start = province.end + city[0].indexOf(city[1]);
      mentions.push({ value: `${province.value}|${city[1]}`, start, end: start + city[1].length });
    }
  }
  const ids = unique(mentions.map((mention) => mention.value));
  const leaves = ids.filter((id) => !ids.some((other) => other.startsWith(id + "|")));
  if (leaves.length > 1) return { id: null, source: "ambiguous", mentions, warnings: ["MULTIPLE_REGIONS_REQUIRE_SEPARATE_RETRIEVAL"] };
  if (leaves.length === 1) return { id: leaves[0], source: "explicit", mentions, warnings: [] };
  if (programs.some((program) => !program.excluded && program.value.name === "제주가치돌봄")) {
    return { id: "region:제주특별자치도", source: "program_hint", mentions, warnings: ["REGION_INFERRED_FROM_PROGRAM_NAME"] };
  }
  if (/(?:^|\s)[가-힣]{1,12}(?:시|군|구)(?:에서|\s+지역)/.test(text)) return { id: null, source: "ambiguous", mentions, warnings: ["REGION_PARENT_UNRESOLVED"] };
  return { id: null, source: "unspecified", mentions, warnings: [] };
}

function extractIntents(text: string): WelfareQueryIntent[] {
  const intents: WelfareQueryIntent[] = [];
  const rules: readonly [WelfareQueryIntent, RegExp][] = [
    ["eligibility", /대상|자격|선정|소득|재산|조건|받을\s*수|적격|부적격/],
    ["benefit", /지원\s*내용|혜택|지원이|지급|급여액/],
    ["amount", /금액|얼마|한도|수치|단가|\d\s*(?:만\s*)?원|지급액|급여액/],
    ["duration", /기간|횟수|언제까지|개월|몇\s*회|몇\s*년/],
    ["procedure", /신청|절차|접수|처리|방법/],
    ["required_documents", /서류|준비물|구비/],
    ["exception", /제외\s*대상|예외|특례|제한|제외\s*조건|중복\s*지원/],
    ["comparison", /비교|차이|달라진|전년\s*대비/],
    ["wrong_premise", /맞죠|맞나요|맞는지|아닌가요|무조건|아무\s*조건\s*없이|거죠|사실인가/],
    ["local_scope", /지역|서귀포|제주시|제주도|광역|지자체|상위\s*범위/],
    ["table", /(?:^|[\s·])표(?:에|의|를|가|\s|$)|각주|행\s*머리글|열\s*머리글/],
    ["legal_basis", /법령|법률|법적|시행령|시행규칙|조문|법적\s*근거/],
    ["budget", /예산|재정|집행액|세출/],
    ["news", /보도자료|뉴스|언론/],
    ["case_review", /검토|판단|확정|정보만으로|더\s*확인|혼자\s*살|인가구/],
  ];
  for (const [intent, expression] of rules) if (expression.test(text)) intents.push(intent);
  return intents.length ? intents : ["overview"];
}

// 대화형 종결어는 검색어가 아니다. 반복 적용해 "부과되나요"→"부과", "서비스인가요"→"서비스"로 줄인다.
const QUESTION_ENDING = /(?:인가요|인지요|일까요|입니까|습니까|합니까|됩니까|한가요|할까요|될까요|되나요|하나요|있나요|없나요|인가|인지|나요|가요|까요|는지|은지|할지|될지|해야|하면|되면|돼요|되요|해요|에요|예요|이에요|이죠|죠|이라는|라는|이라면|라면|이란|란)$/;
function stripQuestionEnding(word: string): string {
  let current = word;
  for (let i = 0; i < 3; i++) {
    const next = current.replace(QUESTION_ENDING, "");
    if (next === current) break;
    // 끝말만으로 된 단어("있나요", "하나요")는 검색어에서 뺀다.
    if (next.length < 2) return "";
    current = next;
  }
  return current;
}
// 의문사는 질문 유형 판별에만 쓰고 필수 검색어로 쓰지 않는다.
const QUESTION_WORDS = /^(?:누구|누가|무엇|뭔가|뭐|무슨|어디|어디로|어디서|어디에|언제|얼마|얼마나|어떻게|어떤|어느|왜|몇)$/;
// 의미 없는 일반어·가능 여부 표현. 부정 의미는 negations 필드로 보존한다.
const SEARCH_NOISE = /^(?:가능|가능한|불가|불가능|여부|경우|결과|꼭|반드시|모든|있다|없다|되다|하다|받다|받을|받으려면|하려면|사용|이용|해당|관련|대해|대한|위한|통해|같은|다른|이후|이전|현재|지금)$/;

function fallbackTerms(text: string, removed: readonly Mention<unknown>[]): string[] {
  const catalogWords = new Set(['복지', '복지사업', '복지제도', '복지서비스', '제도', '목록', '사업목록', '조회', '검색']);
  const characters = text.split("");
  for (const mention of removed) for (let index = mention.start; index < mention.end; index++) characters[index] = " ";
  const stopwords = /^(?:알려(?:줘|주세요|주십시오)|정리해(?:줘|주세요)|설명해(?:줘|주세요)|검색해(?:줘|주세요)|찾아(?:줘|주세요)|간단히|원문|기준|대상|조건|업무|처리|관련|주요|지원내용|신청|절차|방법|금액|한도|얼마|수치|기간|횟수|예외|제외대상|특례|표|항목별로|있는|있으면|필요한|어떻게|어떤|돼|되나요|뭐야|맞죠|맞나요|부탁해|부탁드립니다|그리고|자료|정보|내용|사업|서비스|사용해줘|섞지|말고|지역|범위|맞춰|대신|모두|전부|아닌|아니라|아니고|않는|아닙니다|줘|주세요|주십시오|마세요|말아줘|말아주세요)$/;
  const exclusionWords = /^(?:(?:제외|배제)(?:해(?:줘|주세요|주십시오)?|하고|하여|하되|해서|할)?|빼(?:고|줘|주세요)|(?:섞지|혼합하지|혼동하지|포함하지|사용하지|참고하지)(?:마|마세요|말고|말아줘|말아주세요)?)$/;
  const particles = /(?<=[가-힣]{2})(?:에서는|으로는|에서|으로|까지|부터|에게|이란|이랑|이나|이나요|은|는|을|를|의|이|가|도|만|와|과)$/;
  return unique(characters.join("").split(/[\s.,!?;:：·()[\]{}'"“”‘’「」『』<>《》]+/).map(stripQuestionEnding).map((word) => catalogWords.has(word) ? "" : word.replace(particles, "")).filter((word) => (word.length >= 2 || word === "밥") && !catalogWords.has(word) && !stopwords.test(word) && !exclusionWords.test(word) && !QUESTION_WORDS.test(word) && !SEARCH_NOISE.test(word) && !/^\d+$/.test(word))).slice(0, 5);
}

/** 사실 유형 판별. 답변 가능 여부와 근거 충족도 판정에 쓴다. */
function extractFactTypes(text: string): WelfareFactType[] {
  const rules: readonly [WelfareFactType, RegExp][] = [
    ["definition", /이란|란\s*(?:무엇|뭐)|(?:무엇|뭐)(?:인가|이에|예요|야)|뜻|정의|누구를\s*말|누구(?:인가|예요|야)|어떤\s*(?:서비스|제도|사업)/],
    ["legal_basis", /법(?:에서|령|률|적|상)|조문|과태료|처벌|위반|의무|시행일|신고의무|금지/],
    ["duration", /기간|언제|며칠|소요|얼마나\s*걸|유효|개월|기한|시기/],
    ["amount", /얼마|금액|지급액|급여액|지원금|한도|단가|\d\s*(?:만\s*)?원|%|본인부담률/],
    ["document", /서류|확인서|증명서|구비|제출|발급/],
    ["duplicate_use", /중복|같이\s*받|함께\s*받|동시에|병행/],
    ["exception", /예외|제외|불가|안\s*되|제한/],
    ["status_check", /잔액|조회|확인(?:은|하|할|방법)|결과(?:를|는)?\s*확인|진행\s*상황/],
    ["location", /어디(?:로|에|서)?|기관은|센터는|신청처|접수처/],
    ["procedure", /신청|절차|방법|접수|어떻게|재발급|발급받/],
    ["eligibility", /대상|자격|받을\s*수|해당되|조건|소득|재산|선정|기준|연령|나이|상한|하한/],
  ];
  let found = rules.filter(([, expression]) => expression.test(text)).map(([type]) => type);
  // "신청대상은 누구인가요"처럼 대상을 묻는 질문은 정의 질문이 아니다.
  if (found.includes("eligibility") && !/이란|란\s*(?:무엇|뭐)|뜻|정의/.test(text)) found = found.filter((type) => type !== "definition");
  return found.length ? found : ["overview"];
}

const NEGATION = /(?:불가능|불가|아닌가요|아닌지|아니|않|안\s*되|제외|중복\s*불가|금지)/g;
const STAFF_TERMS = /생활지원사|전담사회복지사|종사자|사회복지사|요양보호사|직원|인력|간호사|조리원|시설장|활동지원사/;
/** 종사자·인력 대상 질문과 근거를 구분할 때 쓴다. */
export const STAFF_TERM_PATTERN = STAFF_TERMS;

/** 문서명·제목 경로·본문에서 제도명을 찾는다(검색 후보의 제도 범위 판별용). */
export function detectPrograms(text: string): string[] {
  return unique(programMentions(text.normalize("NFKC")).map((mention) => mention.value.name));
}

export function refineWelfareQuery(query: string, options: { currentYear?: number } = {}): RefinedWelfareQuery {
  const text = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  const currentYear = Number.isInteger(options.currentYear) && options.currentYear! >= 1900 && options.currentYear! <= 2199
    ? options.currentYear! : new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();
  const intents = extractIntents(text);
  const amounts = extractAmounts(text, intents.includes("wrong_premise"));
  const yearMentions = extractYears(text, currentYear, amounts.mentions);
  const excludedYears = unique(yearMentions.filter((mention) => mention.excluded).map((mention) => mention.value));
  const positiveYears = unique(yearMentions.filter((mention) => !mention.excluded).map((mention) => mention.value));
  const conflictingYears = positiveYears.some((year) => excludedYears.includes(year));
  const requestedYears = positiveYears.filter((year) => !excludedYears.includes(year));
  const warnings: string[] = [];
  let year: number | null = requestedYears.length === 1 ? requestedYears[0] : requestedYears.length > 1 || excludedYears.includes(currentYear) ? null : currentYear;
  let yearSource: RefinedWelfareQuery["year_source"] = requestedYears.length > 1 ? intents.includes("comparison") ? "comparison" : "ambiguous" : requestedYears.length ? yearMentions.some((mention) => mention.relative && !mention.excluded) ? "relative" : "explicit" : "current_default";
  if (conflictingYears) { year = null; yearSource = "ambiguous"; warnings.push("CONFLICTING_YEAR_CONSTRAINTS"); }
  if (requestedYears.length > 1) warnings.push("MULTIPLE_YEARS_REQUIRE_SEPARATE_RETRIEVAL");
  if (year === null && !requestedYears.length) { yearSource = "ambiguous"; warnings.push("NO_UNAMBIGUOUS_TARGET_YEAR"); }
  const mentions = classifyExclusions(text, programMentions(text));
  const excludedPrograms = unique(mentions.filter((mention) => mention.excluded).map((mention) => mention.value.name));
  const positiveMentions = mentions.filter((mention) => !mention.excluded);
  if (positiveMentions.some((mention) => excludedPrograms.includes(mention.value.name))) warnings.push("CONFLICTING_PROGRAM_CONSTRAINTS");
  const allowedMentions = positiveMentions.filter((mention) => !excludedPrograms.includes(mention.value.name));
  // A named subservice stays attached to its program instead of becoming an unrelated nationwide query.
  const namedPrograms = unique(allowedMentions.map((mention) => mention.value.name));
  const programs = namedPrograms.length > 1 ? namedPrograms.filter((program) => program !== "식사지원") : namedPrograms;
  const region = extractRegion(text, mentions);
  warnings.push(...region.warnings);
  if (region.id && !intents.includes("local_scope")) intents.push("local_scope");
  const positiveText = text.split("");
  for (const mention of mentions.filter((mention) => mention.excluded)) for (let index = mention.start; index < mention.end; index++) positiveText[index] = " ";
  const compactPositive = compact(positiveText.join(""));
  const subservices = unique(SUBSERVICES.filter(([, aliases]) => aliases.some((alias) => compactPositive.includes(compact(alias)))).map(([name]) => name));
  const queries: string[] = [];
  for (const name of programs) {
    const term = allowedMentions.find((mention) => mention.value.name === name)!.value;
    const baseQueries = term.queries ?? [term.name.replaceAll("·", " ")];
    queries.push(...baseQueries);
    for (const mention of allowedMentions.filter((item) => item.value.name === name)) {
      const literal = text.slice(mention.start, mention.end).replace(/['"“”‘’]/g, "").trim();
      // 별도 검색어가 정해진 제도와 제도명의 줄임말은 제외한다(예: 문화누리 → 문화누리카드).
      if (literal && !term.queries && !compact(term.name).includes(compact(literal)) && !baseQueries.some((base) => compact(base) === compact(literal))) queries.push(literal);
    }
    for (const subservice of subservices) if (!baseQueries.some((base) => compact(base).includes(compact(subservice)))) queries.push(`${baseQueries[0]} ${subservice}`);
  }
  // Excluding a known program does not exclude an independently named, unknown
  // topic later in the request. Remove named spans and reuse the polarity rules.
  if (!queries.length) queries.push(positiveQueryTerms(text, fallbackTerms(text, [...mentions, ...yearMentions, ...region.mentions, ...amounts.mentions])).join(" "));
  const searchQueries = unique(queries.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean)).slice(0, 8);
  const detailTerms = positiveQueryTerms(text, [...fallbackTerms(text, [...mentions, ...yearMentions, ...region.mentions, ...amounts.mentions]), "증명서", "확인서", "틀니", "임플란트", "장학금", "냉난방비", "인건비", "운영비", "설치비", "기능보강"])
    .map((term) => stripQuestionEnding(term).replace(/(?<=[가-힣]{2})(?:에서는|으로는|에서|으로|까지|부터|에게|은|는|을|를|의|이|가|도|만|와|과|및)$/, "").replace(/(?<=[가-힣]{2})(?:에|되|하)$/, ""))
    .filter((term) => term.length >= 2 && !QUESTION_WORDS.test(term) && !SEARCH_NOISE.test(term))
    .filter((term) => !/^(?:지원|사업|서비스|센터|시설|수급자|수급권자|발급|참여|이용|운영|지원대상|선정기준|제외하고|빼고)$/.test(term)).slice(0, 12);
  if (!searchQueries.length) warnings.push(mentions.length ? "NO_INCLUDED_PROGRAM" : "NO_SEARCH_TERMS");
  const household = /(?<!\d)(\d{1,2})\s*인\s*가구/.exec(text);
  const conditions = unique([...text.matchAll(/\d{1,3}\s*세(?:\s*(?:이상|이하|미만|초과))?|\d{1,2}\s*인\s*가구|혼자\s*살[고는]?|(?:월\s*)?소득|금융\s*재산|재산|자동차|장애\s*등록|독거|한부모|수급자/g)].map((match) => match[0]));
  return {
    raw_query: query, normalized_query: text, search_query: searchQueries[0] ?? "", search_queries: searchQueries,
    search_tokens: searchQueries[0]?.split(/\s+/).filter(Boolean).slice(0, 5) ?? [],
    detail_terms: detailTerms,
    programs, excluded_programs: excludedPrograms, subservices,
    region_id: region.id, region_source: region.source,
    include_ancestor_scope: !/(?:상위|광역|전국)(?:\s*(?:사업|범위|자료))?\s*(?:제외|빼고)|해당\s*(?:시군구|시·군·구|행정시|시군|지역)\s*만/.test(text),
    current_year: currentYear, year, requested_year: requestedYears.length === 1 && !conflictingYears ? requestedYears[0] : null,
    requested_years: requestedYears, excluded_years: excludedYears, year_source: yearSource,
    intents, amounts: amounts.values, household_size: household && Number(household[1]) > 0 ? Number(household[1]) : null,
    subject_conditions: conditions, warnings: unique(warnings),
    fact_types: extractFactTypes(text),
    legal_intent: /법(?:에서|령|률|적|상)|조문|과태료|처벌|위반|의무|시행일|신고의무|이란|란\s*(?:무엇|뭐)|누구를\s*말|정의|(?:꼭|반드시|의무적으로)\s*(?:\S+\s*)?(?:받아야|해야|하여야)|(?:받아야|하여야)\s*(?:하나요|하는지|합니까)|(?:발급|제공|열람|전송|교부)(?:할|받을|해\s*줄)\s*수\s*있/.test(text),
    program_scope: programs.length ? programs : /(?<![가-힣])(?:기초생활\s*)?수급(?:자|권자|가구)/.test(text) && !/기초연금|장애인연금|장애수당|의료급여|주거급여|교육급여|생계급여/.test(text) ? ["국민기초생활보장"] : [],
    program_scope_source: programs.length ? "explicit" : /(?<![가-힣])(?:기초생활\s*)?수급(?:자|권자|가구)/.test(text) && !/기초연금|장애인연금|장애수당|의료급여|주거급여|교육급여|생계급여/.test(text) ? "inferred" : "none",
    subject_scope: STAFF_TERMS.test(text) ? "staff" : "beneficiary",
    negations: unique([...text.matchAll(NEGATION)].map((match) => match[0].replace(/\s+/g, " "))),
  };
}
