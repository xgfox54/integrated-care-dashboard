import { faq129Facts, type Faq129Facts } from "./faq129-facts.ts";
export { faq129Facts, type Faq129Facts } from "./faq129-facts.ts";
// 보건복지상담센터(129) 자주하는 질문을 공식 Q&A 근거 층으로 검색한다.
// 답변은 작성일 기준 안내라서 항상 작성일을 함께 내보내고, 오래되었거나 이전 연도 기준을 인용하면 표시한다.
// 질문 ID·평가 정답을 색인하지 않는다. 원문의 사업명·질문어·답변 조건과 문자 유사도로 순위를 정한다.
import { databaseIdentity, type SqlDatabase } from "../sql-database.ts";
import { detectPrograms, type RefinedWelfareQuery } from "./query-refiner.ts";
import { compactSearchText } from "./search-text.ts";
import { expandedMatch, queryConcepts, rareConcepts, strictTerm } from "./faq129-expansion.ts";
import { buildBm25Index, FAQ129_BM25_MIN, scoreBm25, type Bm25Index } from "./faq129-bm25.ts";
import { faq129Clarification, type Faq129Clarification } from "./faq129-clarifications.ts";
import paraphraseData from "../../data/faq129/paraphrases.json" with { type: "json" };

// 별칭 질문은 문장 전체 유사도에만 쓴다. 단어 일치에 넣으면 "인터넷"·"언제까지" 같은 흔한 말만으로 무관한 질문이 걸린다.
const PARAPHRASES: Readonly<Record<string, readonly string[]>> = paraphraseData.items;
const PARAPHRASE_SIMILARITY_WEIGHT = 0.8;
export { faq129Text, FAQ129_NOTICE, FAQ129_PUBLISHER } from "./faq129-text.ts";

export const FAQ129_PREFIX = "faq129:";
export const FAQ129_LIST_URL = "https://www.129.go.kr/faq/faq00.do";
/** 작성일이 이보다 오래되면 현재 기준과 다를 수 있다고 표시한다. */
export { FAQ129_OUTDATED_DAYS, faq129Freshness, type Faq129Freshness } from "./faq129-freshness.ts";
import { faq129Freshness, type Faq129Freshness } from "./faq129-freshness.ts";
import { faq129Conditions, type Faq129Conditions } from "./faq129-conditions.ts";
import { faq129Rubric } from './faq129-rubric.ts';
export const FAQ129_MIN_SCORE = 45;
const FAQ129_COMMON_TERM_DOCS = 30;
const CACHE_MS = 10 * 60 * 1000;

export type Faq129Plan = Pick<RefinedWelfareQuery, "raw_query" | "programs" | "search_tokens" | "detail_terms" | "subservices"> & Partial<Pick<RefinedWelfareQuery, "program_scope" | "program_scope_source" | "current_year" | "requested_year" | "excluded_years" | "fact_types">>;

interface IndexRow {
  readonly faq_id: string;
  readonly group_name: string | null;
  readonly category: string | null;
  readonly question: string;
  readonly written_date: string;
  readonly views: number;
  readonly source_url: string;
  readonly revision: string;
  readonly aliases: string | null;
  /** 답변 원문(788건 합계 약 19만 자). 색인과 함께 실행 환경에 두어 검색마다 다시 읽지 않는다. */
  readonly answer: string;
  readonly content_sha256: string;
}

interface IndexedFaq extends IndexRow {
  readonly text: string;
  readonly answerText: string;
  readonly questionKey: string;
  readonly bigrams: ReadonlySet<string>;
  readonly programs: readonly string[];
  readonly paraphraseGrams: readonly ReadonlySet<string>[];
}




export const FAQ129_ANSWER_COMPOSITION = "답변 전 condition_checklist의 모든 원문 문단을 순서대로 확인하세요. 질문과 관련된 대상·검사 전제·서류·기관 정의·기간·예외를 빠짐없이 답변에 반영하세요. 신청 절차를 안내할 때 신청자와 대리인의 필수서류를 각각 확인하고, 신청 창구·방법과 온라인 또는 대리신청 제한도 함께 확인하세요. 원문의 모두(AND)와 또는(OR), 필수 절차와 필요시 선택 절차를 구분하고, 괄호·각주에 붙은 예외가 어느 조건에 적용되는지 함께 설명하세요. 기관 명칭에 별도 정의가 있으면 구성 요건을 포함하세요. 문단을 요약하면서 조건을 생략하거나 필수를 선택으로 바꾸지 마세요. 적용 범위나 원문이 모호하면 추정으로 확정하지 말고 불명확한 점과 추가 확인 필요성을 밝혀주세요. 작성일 기준 안내임을 표시하고 답변 끝에 answer_criteria.citation_footer의 원문 URL과 작성일을 함께 인용하세요. 웹 보완자료를 사용해도 실제 읽은 FAQ 원문 출처를 생략하거나 다른 문항 URL로 대체하지 마세요.";

interface Faq129AnswerContext {
  readonly answer_criteria: ReturnType<typeof faq129Rubric>;
  readonly structured_conditions: Faq129Conditions;
  readonly condition_checklist: readonly { readonly source_block: number; readonly text: string }[];
  readonly answer_composition_instructions: string;
}

function faq129AnswerContext(answer: string, faqId: string, contentHash: string, question: string, writtenDate: string, sourceUrl: string, revision: string): Faq129AnswerContext {
  // 문장·괄호를 잘라 조건의 연결 관계를 잃지 않도록 원문 문단 전체를 보존한다.
  return {
    answer_criteria: faq129Rubric({ faq_id: faqId, content_sha256: contentHash, answer, question, written_date: writtenDate, source_url: sourceUrl, revision }),
    structured_conditions: faq129Conditions(faqId, contentHash, answer),
    condition_checklist: answer.split(/\r?\n[\t ]*\r?\n+/).filter((text) => text.trim()).map((text, index) => ({ source_block: index + 1, text })),
    answer_composition_instructions: FAQ129_ANSWER_COMPOSITION,
  };
}



export interface Faq129Hit extends Faq129AnswerContext {
  readonly content_sha256: string;
  readonly authoritative_clarification: Faq129Clarification | null;
  readonly id: string;
  readonly entity_type: "official_faq";
  readonly content_scope: "official_qa_as_of_written_date";
  readonly faq_id: string;
  readonly title: string;
  readonly question: string;
  readonly group: string | null;
  readonly category: string | null;
  readonly written_date: string;
  readonly url: string;
  readonly excerpt: string;
  readonly score: number;
  readonly question_similarity: number;
  readonly question_exact: boolean;
  readonly programs: readonly string[];
  readonly matched_terms: readonly string[];
  readonly freshness: Faq129Freshness;
  readonly scope_flags: readonly string[];
  readonly warnings: readonly string[];
  readonly structured_facts: Faq129Facts;
  readonly revision: string;
  /** DIRECT: 질문어·문장 일치. RELATED: 답변 조건이나 문자 유사도로 찾은 확인 필요 후보. */
  readonly match_quality: "DIRECT" | "RELATED";
}

export interface Faq129SearchResult {
  readonly hits: Faq129Hit[];
  /** 질문 제도와 다른 제도의 FAQ라서 제외한 건수. */
  readonly program_mismatch_excluded: number;
  readonly available: boolean;
}

const indexCache = new WeakMap<object, { at: number; rows: IndexedFaq[] }>();
const bm25Cache = new WeakMap<readonly IndexedFaq[], Bm25Index>();

function bm25For(rows: readonly IndexedFaq[]): Bm25Index {
  const cached = bm25Cache.get(rows);
  if (cached) return cached;
  const built = buildBm25Index(rows.map((row) => ({ question: searchQuestion(row.question), category: row.category, answer: row.answer ?? "" })));
  bm25Cache.set(rows, built);
  return built;
}
const GENERIC = new Set(["지원", "사업", "서비스", "신청", "대상", "방법", "기준", "경우", "가능", "여부", "관련", "문의", "안내", "내용", "무엇", "어떻게", "어디", "누구", "얼마", "언제"]);
const ENDING = /(?:인가요|인지요|일까요|입니까|습니까|합니까|됩니까|한가요|할까요|될까요|되나요|하나요|있나요|없나요|나요|가요|까요|는지|은지|이란|란|요)$/;

function bigrams(text: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index + 1 < text.length; index++) result.add(text.slice(index, index + 2));
  return result;
}

/** 질문 문장끼리의 bigram Dice 계수(0~1). 어미·괄호 표기는 미리 뺀다. */
function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function searchQuestion(question: string): string {
  // 공식 FAQ 제목의 확인된 오타만 검색용으로 정규화하며 반환 원문은 그대로 둔다.
  return question.replace(/긴급셍계지원/g, "긴급생계지원");
}

function questionKey(question: string): string {
  return compactSearchText(searchQuestion(question).replace(/[?？!.。'"“”‘’]/g, "").replace(/\s+/g, " ").trim().split(" ").map((word) => word.replace(ENDING, "")).join(""));
}

async function loadIndex(db: SqlDatabase, nowMs: number): Promise<IndexedFaq[] | null> {
  const cached = indexCache.get(databaseIdentity(db));
  if (cached && nowMs - cached.at < CACHE_MS) return cached.rows;
  let rows: IndexRow[];
  let aliasRows: { faq_id: string; alias: string }[];
  try {
    // 상관 하위질의 대신 평면 조회 두 번으로 읽고 메모리에서 묶는다(격리 실행 환경마다 첫 요청 비용을 줄인다).
    const [faqResult, aliasResult] = await Promise.all([
      db.prepare("SELECT faq_id, group_name, category, question, written_date, views, source_url, revision, NULL AS aliases, answer, content_sha256 FROM faq_129").all<IndexRow>(),
      db.prepare("SELECT faq_id, alias FROM faq_129_alias").all<{ faq_id: string; alias: string }>(),
    ]);
    rows = faqResult.results;
    aliasRows = aliasResult.results;
  } catch (error) {
    // 마이그레이션 전 환경만 미가용으로 본다. 다른 DB 오류는 빈 결과로 바꾸지 않는다.
    if (error instanceof Error && /no such table/i.test(error.message)) return null;
    throw error;
  }
  const aliasMap = new Map<string, string[]>();
  for (const alias of aliasRows) aliasMap.set(alias.faq_id, [...(aliasMap.get(alias.faq_id) ?? []), alias.alias]);
  const indexed = rows.map((base) => {
    const row = { ...base, aliases: (aliasMap.get(base.faq_id) ?? []).join(" ") || null };
    const key = questionKey(row.question);
    const question = searchQuestion(row.question);
    const programs = detectPrograms(question + " " + (row.aliases ?? ""));
    const paraphrases = PARAPHRASES[row.faq_id] ?? [];
    return { ...row, text: compactSearchText([question, row.category ?? "", row.aliases ?? ""].join(" ")), answerText: compactSearchText(row.answer ?? ""), questionKey: key, bigrams: bigrams(key), programs,
      paraphraseGrams: paraphrases.map((paraphrase) => bigrams(questionKey(paraphrase))) };
  });
  indexCache.set(databaseIdentity(db), { at: nowMs, rows: indexed });
  return indexed;
}


function planTerms(plan: Faq129Plan): { readonly programs: string[]; readonly terms: string[]; readonly weakLength: number } {
  const programs = [...new Set(plan.programs.map(compactSearchText).filter((value) => value.length >= 2))];
  const words = [...plan.search_tokens, ...plan.detail_terms, ...plan.subservices].flatMap((value) => value.split(/\s+/)).map(compactSearchText);
  // 사업명 단어는 programHit에서 이미 셌다. 다시 세면 사업명만 언급한 FAQ가 모두 만점을 받는다.
  const programWords = new Set(plan.programs.flatMap((value) => value.split(/\s+/)).map(compactSearchText));
  const candidates = [...new Set(words)].filter((term) => term.length >= 2 && !GENERIC.has(term) && !programWords.has(term) && !programs.some((program) => program.includes(term)));
  // 뜻이 약한 활용형은 일치어로 쓰지 않되, 질문의 일부이므로 일치율 분모에는 남긴다.
  const terms = [...new Set(candidates.flatMap((term) => strictTerm(term, GENERIC) ?? []))];
  const weakLength = candidates.filter((term) => strictTerm(term, GENERIC) === null).reduce((sum, term) => sum + term.length, 0);
  return { programs, terms, weakLength };
}

function excerptOf(answer: string): string {
  const plain = answer.replace(/\s+/g, " ").trim();
  return Array.from(plain).length > 360 ? Array.from(plain).slice(0, 360).join("") + "…" : plain;
}

export async function searchFaq129(db: SqlDatabase, plan: Faq129Plan, options: { readonly limit?: number; readonly nowMs?: number } = {}): Promise<Faq129SearchResult> {
  const nowMs = options.nowMs ?? Date.now();
  const index = await loadIndex(db, nowMs);
  if (!index) return { hits: [], program_mismatch_excluded: 0, available: false };
  const { programs, terms, weakLength } = planTerms(plan);
  const scope = (plan.program_scope ?? []).filter(Boolean);
  const queryKey = questionKey(plan.raw_query);
  const queryGrams = bigrams(queryKey);
  const concepts = queryConcepts(plan.raw_query, plan.programs);
  const definitionQuery = plan.fact_types?.includes("definition") && concepts.length === 0;
  const rare = rareConcepts(concepts, index.map((row) => row.text + row.answerText));
  // 흔한 질문어(전체 FAQ의 약 4% 이상에 나오는 말)만 맞고 나머지 질문어가 빠지면 주제가 다른 FAQ일 가능성이 크다.
  const termDocs = new Map(terms.map((term) => [term, index.filter((row) => row.text.includes(term) || row.answerText.includes(term)).length]));
  const commonTerm = (term: string) => (termDocs.get(term) ?? 0) >= FAQ129_COMMON_TERM_DOCS;
  let mismatched = 0;
  const scored: { row: IndexedFaq; score: number; matched: string[]; similarity: number; exact: boolean; inferredMismatch: boolean; strict: boolean; related?: boolean }[] = [];
  const eligible = new Map<IndexedFaq, boolean>();
  for (const row of index) {
    const scopeMismatch = Boolean(scope.length && row.programs.length && !row.programs.some((program) => scope.includes(program)));
    if (scopeMismatch && plan.program_scope_source !== "inferred") {
      // 질문 제도와 다른 제도의 FAQ는 비슷한 문장이어도 근거로 쓰지 않는다.
      if (dice(queryGrams, row.bigrams) >= 0.3 || terms.some((term) => row.text.includes(term))) mismatched += 1;
      continue;
    }
    const programHit = programs.length ? programs.some((program) => row.text.includes(program) || row.programs.some((name) => compactSearchText(name) === program)) : null;
    if (programHit === false) continue;
    // 제도 자체의 뜻을 묻는 경우에만 정의 FAQ를 우선한다. 별도 세부 조건이 있는 질문에는 적용하지 않는다.
    const definitionMatch = definitionQuery && programHit === true
      && /무엇|뭔가|뭐예요|어떤\s*(?:제도|사업|서비스)/.test(row.question)
      && queryConcepts(row.question, row.programs).length === 0;
    eligible.set(row, scopeMismatch);
    const matched = terms.filter((term) => row.text.includes(term));
    const total = terms.reduce((sum, term) => sum + term.length, weakLength);
    const coverage = total ? matched.reduce((sum, term) => sum + term.length, 0) / total : 0;
    const similarity = Math.max(dice(queryGrams, row.bigrams), ...row.paraphraseGrams.map((grams) => PARAPHRASE_SIMILARITY_WEIGHT * dice(queryGrams, grams)));
    // 사업명 일치만으로는 기준점(45)에 못 미친다. 질문의 세부어가 맞거나 문장이 비슷해야 후보가 된다.
    const lexical = terms.length ? 100 * ((programHit === null ? 0.2 : 0.4) + 0.6 * coverage) : 0;
    const strictScore = Math.max(lexical, 100 * Math.min(1, similarity * 1.15));
    const onlyCommon = matched.length < terms.length && matched.every(commonTerm);
    const strict = strictScore >= FAQ129_MIN_SCORE && (similarity >= 0.45 || (coverage >= 0.34 && !onlyCommon));
    // 다르게 표현한 질문: 어간·행정 용어로 넓혀 맞추되, 절반 이상은 질문·분야·별칭에서 맞아야 한다.
    const expanded = expandedMatch(concepts, row.text, row.answerText, programHit === true);
    const relaxed = expanded !== null && concepts.length >= 2 && expanded.questionCoverage >= 0.5 && expanded.coverage >= 0.5
      && (expanded.questionMatches + (programHit ? 1 : 0) >= 2 || expanded.questionStems.some((stem) => rare.has(stem)))
      && !expanded.unmatched.some((stem) => rare.has(stem));
    // 제목에서 주제가 확인되고 답변이 세부 조건을 대부분 담으면 일반적인 제목의 FAQ도 후보로 남긴다.
    const bodySupported = concepts.length >= 3 && expanded.questionMatches >= 2
      && expanded.coverage >= 0.5 && expanded.matched.length / concepts.length >= 0.8
      && expanded.matched.length > expanded.questionStems.length
      && !expanded.unmatched.some((stem) => rare.has(stem));
    if (!strict && !relaxed && !bodySupported && !definitionMatch) continue;
    // 문자 일치도 있는 후보에서 행정 용어로 넓혀 찾은 세부 조건의 점수가 사라지지 않도록 한다.
    const expandedScore = FAQ129_MIN_SCORE + 35 * expanded.coverage + 5 * (programHit ? 1 : 0);
    const additionalQuestionMatch = expanded.questionStems.some(stem => !matched.some(term => term.includes(stem) || stem.includes(term)));
    const useExpandedScore = !strict || (relaxed && additionalQuestionMatch);
    const score = Math.max(strict ? strictScore : 0, useExpandedScore ? expandedScore : 0, definitionMatch ? 90 : 0);
    if (relaxed || bodySupported) matched.push(...expanded.matched.filter((term) => !matched.includes(term)));
    // 드문 질문어를 FAQ 질문에서 맞힌 넓힌 일치는 흔한 말만 맞은 정확 일치와 같은 단계에서 점수로 겨룬다.
    const firstTier = strict || definitionMatch || (relaxed && expanded.questionStems.some((stem) => rare.has(stem)));
    const related = bodySupported && !strict && !relaxed;
    scored.push({ row, score: related ? Math.min(50, score) : score, matched, similarity, exact: queryKey === row.questionKey, inferredMismatch: scopeMismatch, strict: firstTier, related });
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.strict) - Number(a.strict) || b.score - a.score || b.similarity - a.similarity || Number(a.inferredMismatch) - Number(b.inferredMismatch) || b.row.written_date.localeCompare(a.row.written_date) || a.row.faq_id.localeCompare(b.row.faq_id));
  const limit = Math.max(1, Math.min(10, options.limit ?? 5));
  if (scored.length === 0) {
    // 직접 일치가 없을 때만 질문·답변 문자 조각 유사도로 관련 후보를 찾는다. 점수는 50을 넘지 않아 단독으로 '근거 충분'이 되지 않는다.
    const scores = scoreBm25(bm25For(index), plan.raw_query);
    const taken = new Set(scored.map(({ row }) => row));
    const extra = index.map((row, position) => ({ row, bm25: scores[position] ?? 0 }))
      .filter(({ row, bm25 }) => bm25 >= FAQ129_BM25_MIN && eligible.has(row) && !taken.has(row))
      .sort((a, b) => b.bm25 - a.bm25 || a.row.faq_id.localeCompare(b.row.faq_id));
    for (const { row, bm25 } of extra.slice(0, limit - scored.length)) {
      scored.push({ row, score: Math.min(50, bm25), matched: [], similarity: dice(queryGrams, row.bigrams), exact: false, inferredMismatch: eligible.get(row) ?? false, strict: false, related: true });
    }
  }
  const top = scored.slice(0, limit);
  if (!top.length) return { hits: [], program_mismatch_excluded: mismatched, available: true };
  return {
    available: true,
    program_mismatch_excluded: mismatched,
    hits: top.map(({ row, score, matched, similarity, exact, inferredMismatch, related }) => {
      const answer = row.answer ?? "";
      const freshness = faq129Freshness(row.written_date, answer, nowMs, plan.current_year, plan);
      const scopeFlags = freshness.reasons.filter((reason) => reason.startsWith("YEAR_"));
      if (inferredMismatch) scopeFlags.push("PROGRAM_MISMATCH_INFERRED");
      const flagWarnings = scopeFlags.map((flag) => flag + (flag === "PROGRAM_MISMATCH_INFERRED" ? ": 질문에서 추정한 제도와 FAQ 제도가 다릅니다. 실제 질문 제도를 확인하세요." : ": FAQ 원문이 요청한 적용연도 범위를 확인하지 못합니다."));
      if (related) scopeFlags.push("RELATED_CANDIDATE");
      return {
        id: FAQ129_PREFIX + row.faq_id, entity_type: "official_faq", content_scope: "official_qa_as_of_written_date",
        faq_id: row.faq_id, title: row.question, question: row.question, group: row.group_name, category: row.category,
        ...faq129AnswerContext(answer, row.faq_id, row.content_sha256, row.question, row.written_date, row.source_url, row.revision),
        authoritative_clarification: faq129Clarification(row.faq_id, row.content_sha256),
        written_date: row.written_date, url: row.source_url, excerpt: excerptOf(answer), score: Math.round(Math.min(100, score)),
        question_similarity: similarity, question_exact: exact,
        programs: row.programs, matched_terms: matched, freshness, scope_flags: scopeFlags, content_sha256: row.content_sha256,
        warnings: [...flagWarnings,
          ...(related ? ["RELATED_CANDIDATE: 답변 본문의 조건 또는 문자 유사도로 찾은 관련 후보입니다. 원문이 질문에 맞는지 확인하고, 맞지 않으면 근거로 쓰지 마세요."] : [])],
        match_quality: related ? "RELATED" : "DIRECT", structured_facts: faq129Facts(answer), revision: row.revision,
      };
    }),
  };
}

export interface Faq129Detail extends Faq129AnswerContext {
  readonly authoritative_clarification: Faq129Clarification | null;
  readonly id: string;
  readonly faq_id: string;
  readonly question: string;
  readonly answer: string;
  readonly group: string | null;
  readonly category: string | null;
  readonly written_date: string;
  readonly views: number;
  readonly url: string;
  readonly revision: string;
  readonly content_sha256: string;
  readonly aliases: readonly { alias: string; kind: string }[];
  readonly freshness: Faq129Freshness;
  readonly structured_facts: Faq129Facts;
}

export async function getFaq129(db: SqlDatabase, id: string, nowMs = Date.now()): Promise<Faq129Detail | null> {
  const match = /^faq129:(\d{1,10})$/.exec(id.trim());
  if (!match) return null;
  let row: { faq_id: string; question: string; answer: string; group_name: string | null; category: string | null; written_date: string; views: number; source_url: string; revision: string; content_sha256: string } | null;
  try {
    row = await db.prepare("SELECT faq_id, question, answer, group_name, category, written_date, views, source_url, revision, content_sha256 FROM faq_129 WHERE faq_id = ?").bind(match[1]).first();
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) return null;
    throw error;
  }
  if (!row) return null;
  const aliases = (await db.prepare("SELECT alias, alias_kind AS kind FROM faq_129_alias WHERE faq_id = ? ORDER BY alias_kind, alias").bind(row.faq_id).all<{ alias: string; kind: string }>()).results;
  return {
    id: FAQ129_PREFIX + row.faq_id, faq_id: row.faq_id, question: row.question, answer: row.answer, group: row.group_name, category: row.category,
    written_date: row.written_date, views: row.views, url: row.source_url, revision: row.revision, content_sha256: row.content_sha256, aliases,
    freshness: faq129Freshness(row.written_date, row.answer, nowMs), structured_facts: faq129Facts(row.answer),
    ...faq129AnswerContext(row.answer, row.faq_id, row.content_sha256, row.question, row.written_date, row.source_url, row.revision),
    authoritative_clarification: faq129Clarification(row.faq_id, row.content_sha256),
  };
}
