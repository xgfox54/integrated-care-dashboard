import { manualSourceClarifications } from "./source-clarifications.ts";
import { manualPlainText } from "./plain-text.ts";
import { replacePrivateSymbols } from "../text-symbols.mjs";
import type { SqlDatabase } from "../sql-database.ts";
import { positiveQueryTerms, refineWelfareQuery } from "../mcp/query-refiner.ts";
import { manualSearchText, readableManualRevision } from "./store.ts";
import {
  MANUAL_MAX_EXCERPT, MANUAL_SECTION_PREFIX,
  type ManualCorpusSummary, type ManualOriginalNameBasis, type ManualSearchHit, type ManualSearchOptions,
  type ManualSearchQuery, type ManualSectionDetail, type ManualSectionOptions, type ManualSourceCitation,
} from "./types.ts";

const CANDIDATE_LIMIT = 100;
const STOPWORDS = /^(?:지원|사업|서비스|안내|매뉴얼|업무|원문|기준|대상|조건|처리|관련|주요|신청|절차|방법|금액|얼마|수치|기간|횟수|어떻게|어떤|어느|얼마나|무엇|무엇인지|뭔가요|있는|있으면|있는데|있나요|있는지|있는가|있습니다|있어요|없나요|없습니다|없어요|필요|필요한|가능한|되나요|되는지|하나요|할까요|맞나요|맞죠|정확히|구체적|구체적으로|간단히|알려줘|알려주세요|알려|알려주|설명|정리|설명해줘|정리해줘|자료|정보|항목|항목별|항목별로|사용해줘|섞지|말고|제외하고|빼고|사용하지|마세요|말아줘|주세요|아닌|아니라|관한|대한|내용|확인|확인해줘|확인해주세요|비교|비교해줘|함께|받고|받는|받는데|받았는데|받았|정도|경우|사람|최근|동안|현재|이후|이전|여부|다시|이번|요즘|상황|다음|다른|제가|저는|건가요|전국|서귀포|서귀포시|제주|제주시|제주도|제주특별자치도|지역|범위)$/;
const PARTICLES = /(?:에서는|으로는|으로부터|에서부터|로부터|에게서|에는|에도|로는|에서|으로|까지|부터|에게|이란|이랑|이나요|인지|은|는|을|를|의|이|가|도|만|와|과|에|로)$/;
const SENTENCE_ENDINGS = /(?:하였습니다|하였어요|하였는데요|하였는데|했습니다|했어요|했는데요|했는데|했을때|했을|했던|합니다|해요|하는데요|하는데|하는지|하나요|하려면|하려고|하는|하고|하며|하여|되었습니다|되었어요|되었는데|됐습니다|됐어요|됩니다|되는데|되는지|되나요|되는|되고|받으려면|받으면|받았습니다|받았어요|받았는데|받는|받은|받을|입니다|이었습니다|이에요|예요|중인데|중인|한다면|된다면|한경우|하면요|하면|할때|했다|해서|했|한|할|될|중)$/;
// Scenario amounts, ages and durations are premises, not facts a source must repeat.
// This filter is shared by raw words, refiner details, subservices and fallback core terms.
const NUMERIC_CONDITION = /^(?:(?:약|최소|최대)?\d+(?:(?:천|만|억)?원|년도|개월|인가구|인세대|인분|세대|가구|시간|분|년|월|일|주|세|살|대|인|명|회|회차|개|건|배|퍼센트)?(?:이상|이하|미만|초과|이내|이전|이후|정도|째|간|동안)?|q\d+)$/i;
const GENERIC_DETAILS = ["소득", "재산", "자동차", "공제", "가구", "부양의무자", "청년", "노인", "장애", "근로", "선정", "자격", "신청", "서류", "기간", "횟수", "중복", "예외", "한도", "급여액", "단가", "지원수준", "금액", "본인부담", "증명서", "운영비", "인건비", "장학금", "현황", "연락처", "소재지"];
const FORM_TERMS = ["신청서", "동의서", "계약서", "위임장", "기록지", "통지서", "요청서식", "요청서", "확인서", "증명서", "서식"];
const ANCHOR_GENERIC = new Set(["주민센터", "담당기관", "연락처", "소재지", "사용처", "온라인", "지원금액", "지급방식", "신청기관", "필요서류", "제출서류", "확인기관", "신청경로", "신청방법", "지급방법", "지원대상", "사용방법", "처리절차", "이용방법"]);
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

interface SearchPlan {
  readonly groups: string[][];
  readonly regionId: string | null;
  readonly core: string[];
  readonly details: string[];
  readonly questionTerms: readonly string[];
  readonly questionPhrase: string | null;
  readonly intents: string[];
  readonly amountQuery: boolean;
  readonly eligibilityQuery: boolean;
  readonly excluded: string[];
  readonly excludedYears: string[];
  readonly requestedYears: string[];
  readonly named: boolean;
  readonly minimumCore: number;
  readonly indexPenalty: number;
  readonly directoryBoost: number;
  readonly formPenalty: number;
  readonly yearWeight: number;
  readonly fts: string | null;
}

interface SectionRow {
  readonly row_id: number;
  readonly corpus_revision: string;
  readonly section_id: string;
  readonly document_id: string;
  readonly title: string;
  readonly heading_path: string;
  readonly original_name: string;
  readonly upstream_original_name: string;
  readonly original_name_basis: ManualOriginalNameBasis;
  readonly original_name_line: number | null;
  readonly start_line: number;
  readonly end_line: number;
  readonly source_year: string | null;
  readonly source_year_origin: ManualSourceCitation["source_year_origin"];
  readonly content_hash: string;
  readonly source_name: string;
  readonly source_path: string;
  readonly document_sha256: string;
  readonly document_year: string | null;
  readonly publisher: string;
  readonly authority: string;
  readonly source_role: string;
  readonly jurisdiction: string;
}

interface CandidateRow extends SectionRow {
  readonly rank_value: number;
  readonly fts_rank: number;
}

function normalizedTerm(value: string): string {
  const stripped = value.trim().normalize("NFKC").replace(PARTICLES, "").replace(SENTENCE_ENDINGS, "");
  return manualSearchText(stripped.length >= 2 ? stripped : value);
}

function term(value: string): string {
  const result = normalizedTerm(value);
  return result.length >= 2 && result.length <= 80 && !STOPWORDS.test(result) && !NUMERIC_CONDITION.test(result) ? result : "";
}

function rawDetailTerms(text: string): string[] {
  const nouns = text.normalize("NFKC").split(/[^\p{L}\p{N}]+/u).map(term).filter(Boolean);
  return positiveQueryTerms(text, unique(nouns));
}

/** Query words and generic retrieval synonyms only; this planner contains no question IDs, answers or benefit rules. */
function planSearch(query: ManualSearchQuery): SearchPlan | null {
  const named = Boolean(query.programs?.length);
  // Also remove numeric noun phrases before generic substring expansion (e.g. 3인가구).
  const detailText = query.raw_query.normalize("NFKC").replace(/[\p{L}\p{N}]+/gu, (word) => NUMERIC_CONDITION.test(normalizedTerm(word)) ? " " : word);
  const allowed = (values: readonly string[]) => unique(values.map(term).filter(Boolean));
  let groups = named
    ? [...(query.search_queries ?? []), ...(query.programs ?? [])].map((value) => allowed(value.split(/\s+/)))
    : [allowed(query.search_tokens)];
  groups = groups.filter((group) => group.length > 0).slice(0, 12);
  groups = groups.filter((group, index) => !groups.some((other, otherIndex) => otherIndex !== index && other.every((word) => group.includes(word)) && (other.length < group.length || otherIndex < index)));
  if (!groups.length) return null;
  const core = unique(groups.flat()).slice(0, 20);
  const details = allowed([
    ...(query.detail_terms ?? []), ...rawDetailTerms(detailText), ...(query.subservices ?? []),
    ...positiveQueryTerms(detailText, GENERIC_DETAILS),
  ]).filter((word) => !core.some((key) => key.includes(word)) && !groups.some((group) => group.join("").includes(word))).slice(0, 12);
  const questionTerms = rawDetailTerms(detailText).filter((word) => !core.includes(word)).slice(0, 24);
  const phrase = manualSearchText(query.raw_query);
  const numericPremise = query.raw_query.normalize("NFKC").split(/[^\p{L}\p{N}]+/u).some((word) => NUMERIC_CONDITION.test(normalizedTerm(word)));
  const questionPhrase = !numericPremise && !(query.excluded_programs?.length || query.excluded_years?.length) && phrase.length >= 12 && phrase.length <= 256 ? phrase : null;
  const positive = positiveQueryTerms(detailText, ["금액", "얼마", "급여액", "한도", "단가", "소득", "재산", "자격", "대상", "선정", "신청", "서류", "기간", "횟수", "현황", "연락처", "소재지"]);
  const has = (values: readonly string[]) => positive.some((word) => values.includes(word));
  const moneyPhrases = query.raw_query.match(/\d[\d,.]*\s*(?:(?:천|만|억)\s*)?원/g) ?? [];
  const confirmsMoney = /맞(?:죠|나요|습니까|는지)|정확한가/.test(query.raw_query) &&
    positiveQueryTerms(query.raw_query, moneyPhrases).length > 0;
  const amountQuery = has(["금액", "얼마", "급여액", "한도", "단가"]) || confirmsMoney;
  const eligibilityQuery = has(["자격", "대상", "선정"]);
  const directoryQuery = has(["현황", "연락처", "소재지"]);
  const intents = unique([
    ...(amountQuery ? ["금액", "급여액", "지원액", "지원수준", "단가", "지원기준", "한도"] : []),
    ...(has(["소득", "재산", "자격", "대상", "선정"]) ? ["선정", "자격", "소득", "재산", "대상"] : []),
    ...(has(["신청", "서류"]) ? ["신청", "서류", "제출", "접수"] : []),
    ...(has(["기간", "횟수"]) ? ["기간", "횟수", "지원기간"] : []),
    ...(directoryQuery ? ["연락처", "전화번호", "소재지", "주소", "시설명", "기관명"] : []),
  ]).map(manualSearchText);
  const minimumCore = named ? 1 : Math.min(2, core.length);
  const useFts = named ? groups.every((group) => group.some((word) => word.length >= 3)) : core.filter((word) => word.length < 3).length < minimumCore;
  // Every term is normalized to letters/numbers and still quoted; caller text never becomes FTS syntax.
  const fts = useFts ? unique([...core, ...details]).filter((word) => word.length >= 3).map((word) => '"' + word + '"').join(" OR ") : null;
  return {
    groups, core, details, questionTerms, questionPhrase, intents, amountQuery, eligibilityQuery, named, minimumCore, fts: fts || null,
    regionId: query.region_id ?? null,
    excluded: unique((query.excluded_programs ?? []).map(manualSearchText).filter(Boolean)).slice(0, 12),
    excludedYears: unique((query.excluded_years ?? []).filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2199).map(String)),
    requestedYears: unique((query.requested_years?.length ? query.requested_years : query.year ? [query.year] : []).filter((year) => Number.isInteger(year) && year >= 1900 && year <= 2199).map(String)),
    indexPenalty: directoryQuery ? 0 : intents.length ? 80 : 45,
    directoryBoost: directoryQuery ? 20 : 0,
    formPenalty: positiveQueryTerms(query.raw_query, [...FORM_TERMS, "서류", "양식"]).length ? 0 : 24,
    yearWeight: query.requested_years?.length ? 20 : 4,
  };
}

const SECTION_SELECT = `s.row_id, s.corpus_revision, s.section_id, s.document_id, s.title, s.heading_path,
  s.original_name, s.upstream_original_name, s.original_name_basis, s.original_name_line,
  s.start_line, s.end_line, s.source_year, s.source_year_origin, s.content_hash,
  d.source_name, d.source_path, d.sha256 AS document_sha256, d.document_year,
  d.publisher, d.authority, d.source_role, d.jurisdiction`;
const DOCUMENT_JOIN = "JOIN manual_document d ON d.corpus_revision = s.corpus_revision AND d.document_id = s.document_id";


// 검색어는 manualSearchText로 글자·숫자만 남긴 값이다. 후보 행마다 json_each로 JSON을 다시 펼치지 않도록
// SQL 문자열로 펼쳐 넣는다(점수식은 같다). 글자·숫자 외 문자가 있으면 SQL에 넣지 않고 실패시킨다.
const SAFE_TERM = /^[\p{L}\p{N}]+$/u;
function literal(value: string): string {
  if (!SAFE_TERM.test(value)) throw new Error("manual search term is not normalized");
  return "'" + value + "'";
}
const countIn = (column: string, words: readonly string[]) => words.length ? "(" + words.map((word) => "(instr(" + column + ", " + literal(word) + ") > 0)").join(" + ") + ")" : "0";
const anyIn = (column: string, words: readonly string[]) => words.length ? "(" + words.map((word) => "instr(" + column + ", " + literal(word) + ") > 0").join(" OR ") + ")" : "0";
const allIn = (column: string, words: readonly string[]) => words.length ? "(" + words.map((word) => "instr(" + column + ", " + literal(word) + ") > 0").join(" AND ") + ")" : "1";
const anyFieldOf = (word: string) => "(instr(s.title_search, " + literal(word) + ") > 0 OR instr(s.heading_search, " + literal(word) + ") > 0 OR instr(s.search_text, " + literal(word) + ") > 0)";

function inlineSearchSql(plan: SearchPlan, minimumCore: number, fts: boolean): string {
  const years = (values: readonly string[]) => values.map((year) => literal(year)).join(", ");
  const groupOriginal = plan.groups.length ? "(" + plan.groups.map((group) => allIn("s.original_search", group)).join(" OR ") + ")" : "0";
  const fields = [
    countIn("s.title_search", plan.core) + " AS core_title",
    groupOriginal + " AS core_original",
    countIn("s.heading_search", plan.core) + " AS core_heading",
    countIn("s.search_text", plan.core) + " AS core_body",
    countIn("s.title_search", plan.details) + " AS detail_title",
    countIn("s.heading_search", plan.details) + " AS detail_heading",
    countIn("s.search_text", plan.details) + " AS detail_body",
    countIn("s.title_search", plan.questionTerms) + " AS question_title",
    countIn("s.search_text", plan.questionTerms) + " AS question_body",
    (plan.questionPhrase ? "CASE WHEN instr(s.search_text, " + literal(plan.questionPhrase) + ") > 0 THEN 80 ELSE 0 END" : "0") + " AS question_phrase_boost",
    countIn("s.title_search", plan.intents) + " AS intent_title",
    countIn("s.search_text", plan.intents) + " AS intent_body",
    (plan.amountQuery ? "CASE WHEN " + anyIn("s.title_search", ["지원금액", "지원액", "지급액", "급여액", "단가", "지원기준"]) + " OR ((instr(s.content, '| ---') > 0 OR instr(s.content, '<table') > 0) AND " + anyIn("s.search_text", ["지원금액", "지원액", "지급액", "급여액", "단가"]) + ") THEN 16 ELSE 0 END" : "0") + " AS amount_table_boost",
    // 금액 질문에서는 제목이 긴 개별 특례에 밀리지 않도록 일반 급여 현황표도 확보한다.
    (plan.amountQuery ? "CASE WHEN (instr(s.content, '| ---') > 0 OR instr(s.content, '<table') > 0) AND " + anyIn("s.title_search", ["급여현황", "급여수준", "지원금액", "지원수준"]) + " THEN 36 ELSE 0 END" : "0") + " AS amount_overview_boost",
    (plan.eligibilityQuery ? "CASE WHEN " + anyIn("s.title_search", ["선정기준", "수급자기준", "지원대상"]) + " THEN 24 ELSE 0 END" : "0") + " AS eligibility_heading_boost",
    (plan.requestedYears.length ? "CASE WHEN s.source_year IN (" + years(plan.requestedYears) + ") THEN " + plan.yearWeight + " ELSE 0 END" : "0") + " AS year_preference",
    "CASE WHEN d.authority = 'index' OR d.source_role = 'facility_directory' THEN " + plan.indexPenalty + " ELSE 0 END AS index_penalty",
    "CASE WHEN d.source_role = 'facility_directory' THEN " + plan.directoryBoost + " ELSE 0 END AS directory_boost",
    "CASE WHEN " + anyIn("s.title_search", FORM_TERMS.map(manualSearchText)) + " THEN " + plan.formPenalty + " ELSE 0 END AS form_penalty",
    "CASE WHEN s.title_search IN ('목차','차례','표목차','그림목차') THEN 24 ELSE 0 END AS contents_penalty",
    (fts ? "bm25(manual_section_fts, 7.0, 3.0, 1.0)" : "0") + " AS fts_rank",
  ];
  const score = "140 + 12 * min(core_title,1) + 28 * min(core_original,1) + 8 * min(core_heading,1) + 8 * min(core_body,1) + 14 * min(detail_title,2) + 8 * min(detail_heading,2) + 6 * min(detail_body,3) + 4 * question_title + 2 * question_body + question_phrase_boost + 8 * min(intent_title,1) + 4 * min(intent_body,1) + min(24,max(0,-fts_rank)) + amount_table_boost + amount_overview_boost + eligibility_heading_boost + year_preference + directory_boost - index_penalty - contents_penalty - form_penalty";
  const coverage = plan.named
    ? (plan.groups.length ? "(" + plan.groups.map((group) => "(" + group.map(anyFieldOf).join(" AND ") + ")").join(" OR ") + ")" : "0")
    : (plan.core.length ? "(" + plan.core.map((word) => "(" + anyFieldOf(word) + ")").join(" + ") + ")" : "0") + " >= " + minimumCore;
  const excluded = plan.excluded.length
    ? "(NOT (" + anyIn("s.original_search", plan.excluded) + " OR " + anyIn("s.title_search", plan.excluded) + ") OR " + anyIn("s.original_search", plan.core) + " OR " + anyIn("s.title_search", plan.core) + ")"
    : "1";
  return "SELECT candidate.*, (" + score + ") AS rank_value FROM (SELECT " + SECTION_SELECT + ", " + fields.join(", ") +
    " FROM " + (fts ? "manual_section_fts JOIN manual_section s ON s.row_id = manual_section_fts.rowid" : "manual_section s") + " " + DOCUMENT_JOIN +
    " WHERE s.corpus_revision = ? " + (fts ? "AND manual_section_fts MATCH ? " : "") +
    "AND " + coverage +
    (plan.excludedYears.length ? " AND (s.source_year IS NULL OR s.source_year NOT IN (" + years(plan.excludedYears) + "))" : "") +
    ((plan.regionId && !["region:전국", "region:제주특별자치도", "region:제주특별자치도|서귀포시"].includes(plan.regionId)) ? " AND d.jurisdiction <> 'seogwipo'" : "") +
    " AND " + excluded +
    ") candidate ORDER BY rank_value DESC, fts_rank ASC, document_id, section_id LIMIT " + CANDIDATE_LIMIT;
}

function excludedSectionYear(row: Pick<SectionRow, "title" | "heading_path">, plan: SearchPlan): boolean {
  if (!plan.excludedYears.length) return false;
  const years = (text: string) => [...text.matchAll(/(?<!\d)((?:19|20|21)\d{2}|\d{2})\s*년/g)].map((match) => match[1].length === 2 ? "20" + match[1] : match[1]);
  const titleYears = years(row.title);
  const explicit = titleYears.length ? titleYears : years(row.heading_path);
  return explicit.length > 0 && explicit.every((year) => plan.excludedYears.includes(year));
}

function sourceCitation(row: SectionRow, corpus: ManualCorpusSummary): ManualSourceCitation {
  const url = corpus.source_repository.replace(/\/$/, "") + "/-/blob/" + corpus.source_commit + "/" + row.source_path.split("/").map(encodeURIComponent).join("/") + "#L" + row.start_line + "-" + row.end_line;
  return {
    source_repository: corpus.source_repository, source_commit: corpus.source_commit, source_path: row.source_path,
    url, url_kind: "repository_parsed_copy", official_url: null, document_title: row.source_name,
    original_name: row.original_name, upstream_original_name: row.upstream_original_name,
    original_name_basis: row.original_name_basis, original_name_line: row.original_name_line,
    document_year: row.document_year, document_year_basis: row.document_year ? "filename_inferred" : "unknown",
    source_year: row.source_year, source_year_basis: row.source_year ? "filename_inferred" : "unknown", source_year_origin: row.source_year_origin,
    applicable_year: null, publisher: row.publisher, publisher_verified: false, authority: row.authority, authority_verified: false,
    source_role: row.source_role, jurisdiction: row.jurisdiction, jurisdiction_verified: false,
    location: { basis: "parsed_markdown_lines", start_line: row.start_line, end_line: row.end_line, heading_path: replacePrivateSymbols(row.heading_path), physical_page: null, physical_page_verified: false },
    content_sha256: row.content_hash, document_sha256: row.document_sha256,
  };
}

function warningsOf(row: SectionRow): string[] {
  return [
    ...manualSourceClarifications(row.document_id, row.document_sha256, row.section_id, row.content_hash).map(item => item.status + ": " + item.warning),
    "파싱본 근거 후보입니다. 파일명 연도·기관·관할 메타데이터는 적용연도나 개인 자격의 확인값이 아닙니다.",
    "위치는 Markdown 줄 번호입니다. PDF 물리 쪽수와 이미지 본문은 확인되지 않았습니다.",
    ...(row.original_name_basis === "mixed_original_files" ? ["여러 내부 원본 파일을 포함한 구간으로 단일 출처 연도를 지정하지 않았습니다."] : []),
    ...(row.authority === "index" || row.source_role === "facility_directory" ? ["시설·기관 목록입니다. 금액·급여 자격의 근거로 해석하지 마세요."] : []),
    ...(row.source_year && row.document_year && row.source_year !== row.document_year ? ["내부 원문명의 연도와 합본 파일명의 연도가 다릅니다."] : []),
  ];
}

function plainExcerpt(content: string, needles: readonly string[]): string {
  const plain = manualPlainText(content);
  // Preserve the exact plain-text excerpt; the normalized copy only locates matching words.
  let normalized = "";
  const positions: number[] = [];
  for (let index = 0; index < plain.length; index++) {
    const character = manualSearchText(plain[index]);
    normalized += character;
    for (let part = 0; part < character.length; part++) positions.push(index);
  }
  const matches = needles.map((needle) => normalized.indexOf(needle)).filter((index) => index >= 0);
  const at = matches.length ? positions[Math.min(...matches)] : 0;
  const start = Math.max(0, at - 80);
  return (start ? "…" : "") + Array.from(plain.slice(start)).slice(0, 280).join("") + (Array.from(plain.slice(start)).length > 280 ? "…" : "");
}

/** 본문으로 읽을 수 있는 글자 수. 제목 줄·이미지·HTML 태그·표 구분선·원본 파일 표지는 세지 않는다. */
export const MANUAL_BODY_MIN_CHARS = 30;
export function manualBodyChars(content: string): number {
  const text = content.replace(/!\[[^\]]*\]\([^\n]+\)/g, " ").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
    .split("\n").filter((line) => !/^\s*#{1,6}\s/.test(line) && !/^\s*원본\s*파일\s*:/.test(line)).join(" ");
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

// 고정 revision의 단어 빈도는 바뀌지 않으므로 실행 환경 안에서 재사용한다(최대 5천 단어).
const termFrequencyCache = new Map<string, number>();
const TERM_CACHE_LIMIT = 5000;

async function rarestQueryTerm(db: SqlDatabase, revision: string, core: readonly string[], details: readonly string[]): Promise<string | null> {
  // An unregistered topic must not disappear behind common words such as an application
  // or a payment. Use the pinned corpus itself to choose a specific, observed core term.
  // Trigrams support only >=3 characters; two-character-only queries retain their path.
  // Only a longer form of an existing core noun may add a required term. Other case
  // details remain ranking signals and cannot replace the question's original subject.
  const extendedCore = details.filter((word) => core.some((key) => word.length > key.length && word.includes(key)));
  const words = unique([...core, ...extendedCore]).filter((word) => word.length >= 3 && !ANCHOR_GENERIC.has(word)).slice(0, 32);
  if (!words.length) return null;
  const key = (word: string) => revision + "\u0000" + word;
  const missing = words.filter((word) => !termFrequencyCache.has(key(word)));
  const fetched = missing.length ? (await db.prepare(`SELECT t.value AS term, (
      SELECT COUNT(*) FROM manual_section_fts
      JOIN manual_section s ON s.row_id = manual_section_fts.rowid
      WHERE s.corpus_revision = ? AND manual_section_fts MATCH ('"' || t.value || '"')
    ) AS frequency FROM json_each(?) t`).bind(revision, JSON.stringify(missing)).all<{ term: string; frequency: number }>()).results : [];
  for (const row of fetched) {
    if (termFrequencyCache.size >= TERM_CACHE_LIMIT) termFrequencyCache.delete(termFrequencyCache.keys().next().value!);
    termFrequencyCache.set(key(row.term), row.frequency);
  }
  const frequencies = words.map((term) => ({ term, frequency: termFrequencyCache.get(key(term)) ?? 0 }));
  // Zero-frequency fragments may be conjugation residue; do not make them a required source fact.
  const observed = frequencies.filter((row) => row.frequency > 0)
    .sort((a, b) => a.frequency - b.frequency || b.term.length - a.term.length || a.term.localeCompare(b.term));
  // A sole trigram must not displace a valid combination of shorter Korean subjects.
  return observed.length >= 2 ? observed[0].term : null;
}

/** Read only. Empty pins fail closed, staging never participates, and corpus activation is not called here. */
export async function searchManualSections(db: SqlDatabase, query: ManualSearchQuery | string, options: ManualSearchOptions = {}): Promise<ManualSearchHit[]> {
  const refined = typeof query === "string" ? refineWelfareQuery(query) : query;
  const plan = planSearch(refined);
  if (!plan || options.revision === "") return [];
  const corpus = await readableManualRevision(db, options.revision);
  if (!corpus) return [];
  const anchor = plan.named ? null : await rarestQueryTerm(db, corpus.revision, plan.core, plan.details);
  // The anchor is a required FTS term before SQL LIMIT, not a bonus after candidate truncation.
  const fulltext = anchor ? '"' + anchor + '"' : plan.fts;
  const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(20, options.limit!)) : 10;
  // A specific later detail plus any original core term is sufficient; two incidental
  // opening words are not also required. Core-only searches still need their prior coverage.
  const minimumCore = anchor && !plan.core.includes(anchor) ? 1 : plan.minimumCore;
  const candidates = (await db.prepare(inlineSearchSql(plan, minimumCore, Boolean(fulltext))).bind(corpus.revision, ...(fulltext ? [fulltext] : [])).all<CandidateRow>()).results;
  const selected = candidates.filter((row) => Number.isFinite(row.rank_value) && row.rank_value > 0 && !excludedSectionYear(row, plan))
    .sort((a, b) => b.rank_value - a.rank_value || a.fts_rank - b.fts_rank || a.section_id.localeCompare(b.section_id)).slice(0, limit);
  if (!selected.length) return [];
  // Fetch bodies only for the bounded final selection; candidate ranking never transfers full manuals.
  const bodies = (await db.prepare("SELECT row_id, content FROM manual_section WHERE corpus_revision = ? AND row_id IN (SELECT value FROM json_each(?))")
    .bind(corpus.revision, JSON.stringify(selected.map((row) => row.row_id))).all<{ row_id: number; content: string }>()).results;
  const contents = new Map(bodies.map((row) => [row.row_id, row.content]));
  const hits: ManualSearchHit[] = selected.map((row) => {
    const content = contents.get(row.row_id) ?? "";
    const bodyChars = manualBodyChars(content);
    return {
      id: MANUAL_SECTION_PREFIX + corpus.revision + ":" + row.section_id, entity_type: "manual_section", content_scope: "parsed_manual_section",
      revision: corpus.revision, section_id: row.section_id, document_id: row.document_id, title: replacePrivateSymbols(row.title || row.heading_path || row.original_name),
      excerpt: plainExcerpt(content, plan.details.length ? plan.details : plan.core),
      score: Math.max(0, Math.min(235, Math.round(row.rank_value))), body_chars: bodyChars, body_available: bodyChars >= MANUAL_BODY_MIN_CHARS,
      sources: [sourceCitation(row, corpus)], warnings: [...warningsOf(row), ...(bodyChars < MANUAL_BODY_MIN_CHARS ? ["EMPTY_SOURCE_BODY: 이 구간은 제목·표·이미지 자리표시만 있어 본문 근거로 쓸 수 없습니다. 같은 문서의 인접 구간이나 원문을 확인하세요."] : [])],
    };
  });
  // 표 제목·이미지 캡션만 있는 구간, 또는 질문 세부어가 구간 끝의 소제목에만 있는 구간은 실제 표·본문이 다음 구간으로
  // 잘려 있는 경우가 많다(예: "인건비 지원 연령 기준" 소제목 뒤의 연령표). 같은 문서의 바로 다음 구간을 이어 붙인다.
  const seen = new Set(hits.map((hit) => hit.section_id));
  const continuation = selected.slice(0, 6).map((row) => {
    const content = contents.get(row.row_id) ?? "";
    return { row, reason: manualBodyChars(content) < MANUAL_BODY_MIN_CHARS ? "empty" as const : detailOnlyInTail(content, plan.details) ? "tail" as const : null };
  }).filter((item) => item.reason !== null).slice(0, 4);
  for (const { row, reason } of continuation) {
    const next = await db.prepare("SELECT " + SECTION_SELECT + ", s.content FROM manual_section s " + DOCUMENT_JOIN + " WHERE s.corpus_revision = ? AND s.document_id = ? AND s.start_line > ? ORDER BY s.start_line LIMIT 1")
      .bind(corpus.revision, row.document_id, row.start_line).first<SectionRow & { content: string }>();
    // 합본 문서에서는 다음 구간이 다른 원본 파일일 수 있다. 같은 원본 파일 안에서만 잇는다.
    if (!next || excludedSectionYear(next, plan) || (next.source_year !== null && plan.excludedYears.includes(next.source_year)) || seen.has(next.section_id) || next.original_name !== row.original_name || manualBodyChars(next.content) < MANUAL_BODY_MIN_CHARS) continue;
    seen.add(next.section_id);
    hits.push({
      id: MANUAL_SECTION_PREFIX + corpus.revision + ":" + next.section_id, entity_type: "manual_section", content_scope: "parsed_manual_section",
      revision: corpus.revision, section_id: next.section_id, document_id: next.document_id, title: replacePrivateSymbols(next.title || next.heading_path || next.original_name),
      excerpt: plainExcerpt(next.content, plan.details.length ? plan.details : plan.core),
      score: Math.max(0, Math.min(235, Math.round(row.rank_value) - 4)), body_chars: manualBodyChars(next.content), body_available: true,
      continued_from: MANUAL_SECTION_PREFIX + corpus.revision + ":" + row.section_id,
      sources: [sourceCitation(next, corpus)], warnings: [...warningsOf(next), reason === "empty"
        ? "앞 구간(" + (row.title || row.heading_path) + ")의 본문이 비어 같은 문서의 다음 구간을 이어 붙였습니다."
        : "앞 구간(" + (row.title || row.heading_path) + ")은 질문 세부어가 끝부분 소제목에만 있어 같은 문서의 다음 구간을 이어 붙였습니다."],
    });
  }
  return hits;
}

const TAIL_CHARS = 120;

/** 질문 세부어 가운데 하나라도 구간 본문의 마지막 TAIL_CHARS 글자 안에서 처음 나타나는지 본다(끝 소제목에만 있는 세부어). */
export function detailOnlyInTail(content: string, details: readonly string[]): boolean {
  const normalized = manualSearchText(content);
  if (!details.length || normalized.length <= TAIL_CHARS * 2) return false;
  const tailStart = normalized.length - TAIL_CHARS;
  const positions = details.map((word) => normalized.indexOf(word)).filter((index) => index >= 0);
  return positions.some((index) => index >= tailStart);
}

export const searchManuals = searchManualSections;

/** A section locator never resolves arbitrary paths, document-wide downloads or unpublished revisions. */
export async function getManualSection(db: SqlDatabase, id: string, options: ManualSectionOptions = {}): Promise<ManualSectionDetail | null> {
  const match = /^manual:([a-z0-9][a-z0-9._-]{0,99}):([A-Za-z0-9][A-Za-z0-9._-]{0,119})$/.exec(id);
  if (!match || options.revision === "" || options.revision !== undefined && options.revision !== match[1]) return null;
  const corpus = await readableManualRevision(db, match[1]);
  if (!corpus) return null;
  const offset = Number.isSafeInteger(options.offset) && options.offset! >= 0 ? options.offset! : 0;
  const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(MANUAL_MAX_EXCERPT, options.limit!)) : MANUAL_MAX_EXCERPT;
  // SQLite substr/length count Unicode code points, so long tables retain exact text across calls.
  const row = await db.prepare(`SELECT ${SECTION_SELECT}, substr(s.content, ?, ?) AS text, length(s.content) AS total_chars FROM manual_section s ${DOCUMENT_JOIN} WHERE s.corpus_revision = ? AND s.section_id = ?`)
    .bind(offset + 1, limit, corpus.revision, match[2]).first<SectionRow & { text: string; total_chars: number }>();
  if (!row) return null;
  const returned = Array.from(row.text).length;
  const next = offset + returned < row.total_chars ? offset + returned : null;
  return {
    id, entity_type: "manual_section", content_scope: "parsed_manual_section", revision: corpus.revision,
    section_id: row.section_id, document_id: row.document_id, title: replacePrivateSymbols(row.title || row.heading_path || row.original_name),
    text: replacePrivateSymbols(row.text), offset, returned_chars: returned, total_chars: row.total_chars, next_offset: next, truncated: next !== null,
    image_content_available: false, sources: [sourceCitation(row, corpus)], warnings: warningsOf(row),
  };
}

export async function relatedManualApplicationSections(db: SqlDatabase, section: ManualSectionDetail): Promise<ManualSectionDetail[]> {
  const source = section.sources[0];
  if (section.offset !== 0 || source.original_name_basis === "mixed_original_files" ||
      !/대리인|대리신청|대리 신청|신청권자/.test(section.title + " " + section.text)) return [];
  const candidates = await db.prepare(`WITH candidates AS (
    SELECT s.section_id, s.start_line,
      CASE WHEN instr(s.search_text, '필수제출서류') > 0 OR instr(s.search_text, '신청구비서류') > 0 THEN 1 ELSE 0 END AS documents_topic
    FROM manual_section s
    WHERE s.corpus_revision = ? AND s.document_id = ? AND s.original_name = ?
      AND s.original_name_basis != 'mixed_original_files' AND s.source_year IS ? AND s.section_id != ?
      AND s.start_line BETWEEN ? AND ?
      AND (instr(s.search_text, '필수제출서류') > 0 OR instr(s.search_text, '신청구비서류') > 0
        OR (instr(s.search_text, '온라인') > 0 AND instr(s.search_text, '대리신청') > 0))
    ), ranked AS (
      SELECT section_id, start_line, documents_topic,
        row_number() OVER (PARTITION BY documents_topic ORDER BY abs(start_line - ?), start_line, section_id) AS topic_rank
      FROM candidates
    ) SELECT section_id FROM ranked ORDER BY topic_rank, documents_topic DESC, start_line, section_id LIMIT 3`)
    .bind(section.revision, section.document_id, source.original_name, source.source_year, section.section_id,
      Math.max(1, source.location.start_line - 400), source.location.end_line + 400, source.location.end_line)
    .all<{ section_id: string }>();
  const results = await Promise.all((candidates.results ?? []).map((row) =>
    getManualSection(db, `${MANUAL_SECTION_PREFIX}${section.revision}:${row.section_id}`, { revision: section.revision, limit: 3_000 })));
  return results.filter((item): item is ManualSectionDetail => item !== null);
}
