import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { database, NOW } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";
import { fuseSearchCandidates, programScopeCheck } from "./mcp/search-fusion.ts";
import { assessAnswerability, lawNameForQuery, parseLawSearchHits, parseLawToc, pickLawArticles, relaxationStages } from "./mcp/search-support.ts";
import { faq129Facts, faq129Freshness, searchFaq129 } from "./mcp/faq129.ts";
import { detailOnlyInTail, manualBodyChars, searchManualSections } from "./manuals/search.ts";
import { advanceManualCorpus } from "./manuals/store.ts";
import { ensureActiveBundle } from "./platform/bundle.ts";

// 129 FAQ 검증에서 드러난 결함의 회귀시험. 시험 문항 ID는 코드가 아니라 이 시험의 설명에만 쓴다.
async function call(db, name, args) {
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), new McpData(db, async () => new Map()), (error) => { throw error; }, { includeLaw: false });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.result, JSON.stringify(body));
  return body.result;
}
const search = async (db, query) => {
  const result = await call(db, "search", { query });
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent ?? result.content));
  return result.structuredContent;
};

for (const question of [
  "(기저귀­조제분유) 신청방법은 어떻게 되나요?",
  "(난임시술비) 신청방법은 어떻게 되나요?",
  "발달장애인 긴급돌봄서비스에서 보호자의 기준이 어떻게 되나요?",
  "자활근로 참여자도 병가 사용이 가능한가요?",
  "노인요양시설의 와상 수급자도 결핵검사를 받아야하나요?",
  "보장시설 수급자도 시설 안에서 서비스 이용이 가능한가요?",
  "긴급생계지원 신청은 어디로 하나요?",
  "긴급의료지원 신청은 언제해야 하나요?",
  "의료급여자도 긴급의료지원을 받을 수 있나요?",
]) {
  test("exact source question outranks lexical ties and inferred scope: " + question, async () => {
    const db = database();
    const expected = db.sqlite.prepare("SELECT faq_id FROM faq_129 WHERE question = ?").get(question);
    assert.ok(expected, "source question must exist");
    const plan = refineWelfareQuery(question, { currentYear: 2026 });
    const direct = await searchFaq129(db, plan, { limit: 4, nowMs: NOW * 1000 });
    assert.equal(direct.hits[0]?.question, question, JSON.stringify(direct.hits.map((hit) => ({ question: hit.question, score: hit.score }))));
    const unified = await search(db, question);
    assert.equal(unified.results.filter((hit) => hit.entity_type === "official_faq")[0]?.id, "faq129:" + expected.faq_id);
    if (plan.program_scope_source === "inferred" && direct.hits[0].programs.length) {
      assert.ok(direct.hits[0].scope_flags.includes("PROGRAM_MISMATCH_INFERRED"));
      const explicit = await searchFaq129(db, { ...plan, program_scope_source: "explicit" }, { limit: 10 });
      assert.ok(!explicit.hits.some((hit) => hit.id === "faq129:" + expected.faq_id), "explicit conflicting scope must still exclude this FAQ");
    }
  });
}

test("unified FAQ projection preserves requested-year flags and warnings", async () => {
  const result = await search(database(), "2030년 기초연금 선정기준액");
  const faqs = result.results.filter((hit) => hit.entity_type === "official_faq");
  assert.ok(faqs.length);
  for (const hit of faqs) {
    assert.ok(hit.scope_flags?.some((flag) => flag === "YEAR_MISMATCH" || flag === "YEAR_UNCONFIRMED"));
    assert.ok(hit.warnings?.some((warning) => warning.startsWith("YEAR_")));
  }
});

test("129 FAQ 마이그레이션은 788건의 질문·답변·작성일·원문 주소를 보존한다", () => {
  const db = database();
  const row = db.sqlite.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT faq_id) AS ids, SUM(written_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') AS dated, SUM(source_url LIKE 'https://www.129.go.kr/%') AS urls, SUM(length(content_sha256) = 64) AS hashes, SUM(length(answer) > 0) AS answers FROM faq_129").get();
  assert.deepEqual({ ...row }, { n: 788, ids: 788, dated: 788, urls: 788, hashes: 788, answers: 788 });
  assert.ok(db.sqlite.prepare("SELECT COUNT(*) AS n FROM faq_129_alias WHERE alias_kind = 'program'").get().n > 100);
});

test("질문 세부어가 구간 끝 소제목에만 있으면 같은 문서의 다음 구간(실제 표)을 잇는다", async () => {
  const filler = "사회복지시설 종사자 인건비는 호봉표와 수당 기준에 따라 매월 지급하며 4대 보험 사업주 부담분과 퇴직적립금을 포함합니다. ".repeat(6);
  assert.equal(detailOnlyInTail(filler + "\n**2) 인건비 지원 연령 기준**\n", ["연령"]), true);
  assert.equal(detailOnlyInTail(filler + "\n**2) 인건비 지원 연령 기준**\n", ["인건비", "연령"]), true, "본문에 흔한 단어가 섞여도 끝에만 있는 세부어로 판단한다");
  assert.equal(detailOnlyInTail("연령 기준을 먼저 설명합니다. " + filler + "\n연령 기준\n", ["연령"]), false, "앞쪽에도 있으면 잇지 않는다");
  const revision = "manual-tail-heading-v1";
  const contents = [
    "## 2. 인건비 지원 기준\n" + filler + "\n**2) 인건비 지원 연령 기준**\n",
    "| 구분 | 상한 |\n|---|---|\n| 시설장 | 65세 |\n| 일반 직원 | 60세 (조리원 65세) |\n기준을 넘어 계속 근무하면 그 비용은 시설이 자체 부담합니다.\n",
  ];
  const doc = { document_id: "doc-tail", source_name: "2026년 사회복지시설 인건비 가이드라인.md", source_path: "source-md/2026년 사회복지시설 인건비 가이드라인.md", sha256: hash(contents.join("")), byte_size: Buffer.byteLength(contents.join("")), document_year: "2026", category: "시험", document_type: "manual", publisher: "원천 기본값", edition: "", effective_from: "", effective_to: "", topic: "사회복지시설", authority: "primary", source_role: "operational_manual", jurisdiction: "national", section_count: 2 };
  const sections = contents.map((content, index) => ({ section_id: "tail-" + index, document_id: doc.document_id, ordinal: index + 1, node_id: "n" + index, title: index ? "표 3" : "2. 인건비 지원 기준", heading_path: "사회복지시설 > 인건비", service_names: "사회복지시설", original_name: doc.source_name, upstream_original_name: doc.source_name, original_name_basis: "explicit_original_file_marker", original_name_line: 1, start_line: index ? 30 : 1, end_line: index ? 36 : 29, content, content_hash: hash(content) }));
  const payloads = [[doc], []].map((documents, index) => ({ schema_version: "manual-corpus-1", revision, batch_index: index, documents, sections: index ? sections : [] }));
  const assets = new Map(payloads.map((batch, index) => ["/__manual_corpus/" + revision + "/batch-" + index + ".json", Buffer.from(JSON.stringify(batch))]));
  const manifest = { schema_version: "manual-corpus-1", revision, source_repository: "https://gitlab.aigov.go.kr/memory365/seoguipowelfare", source_commit: "bdef4e9c16095327302f59b85045267ce9c39e17", created_at: new Date(NOW * 1000).toISOString(), document_count: 1, section_count: 2, batches: [...assets].map(([path, bytes], index) => ({ path, sha256: hash(bytes), bytes: bytes.length, documents: index ? 0 : 1, sections: index ? 2 : 0 })) };
  const db = database();
  db.sqlite.prepare("INSERT INTO official_sync_run(id,trigger,status,started_at,completed_at) VALUES ('tail-run','manual','succeeded',?,?)").run(NOW - 1, NOW);
  for (let step = 0; step < 3; step++) await advanceManualCorpus(db, async (path) => new Uint8Array(assets.get(path)), manifest, { now: () => NOW });
  await ensureActiveBundle(db, NOW + 1);
  // 큰 문서에서는 표 구간이 상위 후보에 들지 못한다. 상위 1건만 고르는 조건으로 그 상황을 재현한다.
  const hits = await searchManualSections(db, refineWelfareQuery("사회복지시설 종사자에 대한 인건비 보조금 지급 연령 상한기준이 있나요?", { currentYear: 2026 }), { revision, limit: 1 });
  assert.equal(hits[0].section_id, "tail-0");
  const table = hits.find((item) => item.section_id === "tail-1");
  assert.ok(table, JSON.stringify(hits.map((item) => item.id)));
  assert.match(table.continued_from, /:tail-0$/);
  assert.match(table.excerpt, /60세/);
});


test("search는 129 FAQ를 official_faq로 작성일·신선도·숫자 사실과 함께 주고 fetch로 원문을 읽는다", async () => {
  const db = database();
  const result = await search(db, "재난적의료비 지원 신청 후 지급결정까지는 얼마나 소요되나요?");
  const faq = result.results.find((item) => item.entity_type === "official_faq");
  assert.ok(faq, JSON.stringify(result.results.map((item) => item.title)));
  assert.match(faq.title, /작성일 \d{4}-\d{2}-\d{2}/);
  assert.match(faq.written_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(["CURRENT", "OUTDATED_OR_CONFLICTING_SOURCE"].includes(faq.freshness.status));
  assert.equal(result.faq_layer.available, true);
  const fetched = (await call(db, "fetch", { id: faq.id })).structuredContent;
  assert.equal(fetched.metadata.entity_type, "official_faq");
  assert.match(fetched.text, /작성일: \d{4}-\d{2}-\d{2}/);
  assert.match(fetched.text, /보건복지상담센터\(129\)/);
  const direct = (await call(db, "search_faq", { query: "재난적의료비 지급결정 소요기간" })).structuredContent;
  assert.ok(direct.results.length > 0 && direct.results.every((hit) => hit.written_date && hit.structured_facts));
});

test("FAQ 신선도는 작성 1년 경과와 이전 연도 기준 인용을 OUTDATED_OR_CONFLICTING_SOURCE로 표시한다", () => {
  const now = Date.parse("2026-10-11T00:00:00+09:00");
  assert.equal(faq129Freshness("2026-09-01", "2026년 기준 월 100만원", now).status, "CURRENT");
  assert.deepEqual(faq129Freshness("2025-06-01", "안내", now).reasons, ["WRITTEN_OVER_1_YEAR_AGO"]);
  assert.deepEqual(faq129Freshness("2026-02-01", "2025년 기준 금액은 월 30만원", now).reasons, ["ANSWER_CITES_PRIOR_YEAR"]);
  const facts = faq129Facts("2026년 기준 월 340천원, 만 7세 미만, 30일 이내 신청, 본인부담 10%, 문의 02-123-4567, 「아동복지법」");
  assert.deepEqual(facts.amounts, ["340천원"]);
  assert.deepEqual(facts.durations, ["30일 이내"]);
  assert.deepEqual(facts.ages, ["만 7세 미만"]);
  assert.deepEqual(facts.percents, ["10%"]);
  assert.deepEqual(facts.phones, ["02-123-4567"]);
  assert.deepEqual(facts.laws, ["아동복지법"]);
});


test("FAQ completeness blocks preserve unseen long source paragraphs, lists and parentheses without inference", async () => {
  const db = database();
  const answer = "일반 안내. ".repeat(120) + "\n\n신청인은 A 또는 B를 충족하고 C를 모두 충족해야 합니다.\n(단, 예외 X는 B에만 적용하며 A는 제외하지 않습니다.)\n\n기관이란 검사와 치료가 모두 가능한 곳입니다.\n① 확인서 필수\n② 번역은 필요시 제출\n\n" + "마지막 안내. ".repeat(100);
  db.sqlite.prepare("UPDATE faq_129 SET answer = ?, content_sha256 = ? WHERE faq_id = '7170'").run(answer, hash(answer));
  const detail = (await call(db, "get_faq", { id: "faq129:7170" })).structuredContent;
  assert.ok(detail.condition_checklist?.length, "source paragraphs must remain visible beyond the search excerpt");
  assert.deepEqual(detail.condition_checklist, answer.split("\n\n").map((text, index) => ({ source_block: index + 1, text })));
  assert.equal(detail.answer, answer);
  assert.equal(detail.content_sha256, hash(answer));
});


test("질문 끝말·따옴표·괄호 표기를 검색어에서 빼고 사업명·별칭은 남긴다", () => {
  const cases = [
    ["'응급안전안심서비스'는 어떤 서비스인가요?", "응급안전안심서비스"],
    ["'자연장'이란 무엇인가요?", "자연장"],
    ["긴급의료지원 신청은 언제해야 하나요?", "긴급의료지원"],
    ["긴급주거지원 신청대상은 누구인가요?", "긴급주거지원"],
    ["긴급의료지원 신청대상은 누구인가요?", "긴급의료지원"],
    ["긴급의료지원 신청은 어디로 하나요?", "긴급의료지원"],
    ["(영아수당) 영아수당은 무엇인가요?", "영아수당"],
    ["(청소년산모의료비) 사용은 언제까지 가능한가요?", "청소년산모 의료비"],
  ];
  for (const [question, expected] of cases) {
    const plan = refineWelfareQuery(question, { currentYear: 2026 });
    assert.ok(plan.search_queries.includes(expected), question + " → " + JSON.stringify(plan.search_queries));
    for (const term of [...plan.search_queries, ...plan.detail_terms]) assert.doesNotMatch(term, /인가요|하나요|무엇|['"“”‘’?]/, question + " → " + term);
  }
  assert.equal(refineWelfareQuery("긴급의료지원 신청은 언제해야 하나요?", { currentYear: 2026 }).fact_types[0], "duration");
  assert.deepEqual(refineWelfareQuery("모든 약국에서 환자의 개인정보 수집이용 동의서를 꼭 받아야 하나요?", { currentYear: 2026 }).legal_intent, true);
});

test("근거가 없으면 빈 성공 대신 COVERAGE_GAP·INSUFFICIENT와 추천 출처를 돌려준다", async () => {
  const db = database();
  const result = await search(db, "가상의 미등록 지원제도 신청 기한은 언제인가요?");
  assert.equal(result.retrieval_status, "COVERAGE_GAP");
  assert.equal(result.answerability, "INSUFFICIENT");
  assert.ok(result.reason_codes.includes("COVERAGE_GAP"));
  assert.ok(result.suggested_sources.length >= 2);
  assert.equal(result.web_search_fallback.next_action, "WEB_SEARCH_OFFICIAL");
  assert.equal(result.web_search_fallback.database_write, false);
  assert.ok(Array.isArray(result.query_relaxation));
  assert.ok(result.warnings.some((warning) => warning.startsWith("COVERAGE_GAP")));
});

test("같은 질문 20회 반복(약국 개인정보 동의서)에서도 오류가 없고 법령 조회 상태를 숨기지 않는다", async () => {
  const db = database();
  for (let index = 0; index < 20; index++) {
    const result = await search(db, "모든 약국에서 환자의 개인정보 수집이용 동의서를 꼭 받아야 하나요?");
    assert.ok(["CANDIDATES_FOUND", "COVERAGE_GAP", "REFERENCE_ONLY"].includes(result.retrieval_status));
    assert.equal(result.legal_lookup.status, "DISABLED");
    assert.equal(result.legal_lookup.law_query, null);
    assert.ok(result.reason_codes.includes("LEGAL_SOURCE_DISABLED"));
    assert.equal(result.source_errors, undefined);
  }
});

test("저장소 과부하는 빈 결과나 INTERNAL_ERROR가 아니라 재시도 가능한 DATA_SOURCE_BUSY로 알린다", async () => {
  const db = database();
  const busy = { ...db, prepare: () => { throw new Error("D1_ERROR: Database is overloaded. Requests queued for too long."); } };
  const logged = [];
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "기초연금 신청방법" } } }),
  }), new McpData(busy, async () => new Map()), (error, tool) => { logged.push(tool); }, { includeLaw: false });
  const body = await response.json();
  assert.equal(body.result.isError, true);
  const payload = body.result.structuredContent;
  assert.equal(payload.error.code, "DATA_SOURCE_BUSY");
  assert.match(payload.error.request_id, /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(payload), /overloaded|D1_ERROR/);
  assert.ok(logged.some((tool) => tool.startsWith("search#")));
});

test("다른 제도의 근거는 PROGRAM_MISMATCH로 표시하고 같은 제도 근거보다 뒤로 보낸다", () => {
  const explicit = refineWelfareQuery("기초생활보장 수급자 이자소득 소득인정액 반영 기준", { currentYear: 2026 });
  assert.ok(explicit.program_scope.length > 0, JSON.stringify(explicit.program_scope));
  const pension = { id: "manual:r:pension", entity_type: "manual_section", title: "[매뉴얼] 이자소득 공제 기준", rank: 230, context: "2026년 장애인연금 사업안내 소득인정액" };
  const basic = { id: "manual:r:basic", entity_type: "manual_section", title: "[매뉴얼] 이자소득 반영 기준", rank: 190, context: "2026년 국민기초생활보장사업안내 소득인정액" };
  assert.equal(programScopeCheck(pension, explicit), "MISMATCH");
  assert.equal(programScopeCheck(basic, explicit), "MATCH");
  const fused = fuseSearchCandidates([pension, basic], explicit);
  assert.deepEqual(fused.map((item) => item.id), ["manual:r:basic", "manual:r:pension"]);
  assert.deepEqual(fused[1].scope_flags, ["PROGRAM_MISMATCH"]);
  // 질문에 '수급자'만 있으면 제도를 추정만 하므로 약한 불일치로 표시한다.
  const inferred = refineWelfareQuery("수급자가 이자소득이 있을 경우 소득으로 반영하나요?", { currentYear: 2026 });
  assert.equal(inferred.program_scope_source, "inferred");
  assert.deepEqual(fuseSearchCandidates([pension], inferred)[0].scope_flags, ["PROGRAM_MISMATCH_INFERRED"]);
  // 다른 제도 근거만 있으면 답변 근거가 없다고 판정한다.
  const only = assessAnswerability({ plan: explicit, results: fuseSearchCandidates([pension], explicit), relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.equal(only.answerability, "INSUFFICIENT");
  assert.ok(only.reason_codes.includes("PROGRAM_MISMATCH"));
});

test("종사자 질문은 인력·자격 구간을, 장기요양 장려금 질문은 다른 제도 종사자 구간을 앞세우지 않는다", () => {
  const staff = refineWelfareQuery("노인맞춤돌봄서비스 수행기관의 생활지원사 자격기준이 있나요?", { currentYear: 2026 });
  assert.equal(staff.subject_scope, "staff");
  const agency = { id: "manual:r:agency", entity_type: "manual_section", title: "[매뉴얼] 수행기관 선정기준", rank: 205, context: "2026 노인맞춤돌봄서비스 사업안내" };
  const worker = { id: "manual:r:worker", entity_type: "manual_section", title: "[매뉴얼] 생활지원사 자격기준", rank: 200, context: "2026 노인맞춤돌봄서비스 사업안내" };
  assert.equal(fuseSearchCandidates([agency, worker], staff)[0].id, "manual:r:worker");
  const bonus = refineWelfareQuery("장기요양기관 종사자에게 지급되는 장기근속 장려금이란 무엇인가요?", { currentYear: 2026 });
  const other = { id: "manual:r:other", entity_type: "manual_section", title: "[매뉴얼] 종사자 관리", rank: 225, context: "2026 장애인활동지원 사업안내" };
  const own = { id: "manual:r:own", entity_type: "manual_section", title: "[매뉴얼] 장기근속 장려금", rank: 185, context: "2026 노인장기요양보험 사업안내" };
  const fused = fuseSearchCandidates([other, own], bonus);
  assert.equal(fused[0].id, "manual:r:own");
  assert.ok(fused[1].scope_flags?.includes("PROGRAM_MISMATCH"));
});

test("근거 충족도: 금액·예외를 묻는데 발췌문에 그 사실이 없으면 SUPPORTED가 아니다", () => {
  const plan = refineWelfareQuery("기초연금 단독가구 선정기준액은 얼마인가요?", { currentYear: 2026 });
  const noNumber = assessAnswerability({ plan, results: [{ entity_type: "manual_section", relevance_score: 90, excerpt: "선정기준액은 매년 고시합니다." }], relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.equal(noNumber.answerability, "PARTIAL");
  assert.ok(noNumber.reason_codes.includes("MISSING_AMOUNT"));
  const withNumber = assessAnswerability({ plan, results: [{ entity_type: "manual_section", relevance_score: 90, title: "기초연금 선정기준액", excerpt: "단독가구 선정기준액은 월 2,470,000원입니다." }], relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.equal(withNumber.answerability, "SUPPORTED");
  assert.ok(withNumber.coverage.numeric_facts_found >= 1);
  const dup = refineWelfareQuery("스포츠바우처와 다른 바우처를 중복이용 가능한가요?", { currentYear: 2026 });
  const noException = assessAnswerability({ plan: dup, results: [{ entity_type: "official_faq", relevance_score: 90, excerpt: "스포츠강좌 이용권은 월 11만원을 지원합니다." }], relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.notEqual(noException.answerability, "SUPPORTED");
  assert.ok(noException.reason_codes.includes("MISSING_DUPLICATE_USE"));
  const empty = assessAnswerability({ plan, results: [{ entity_type: "manual_section", relevance_score: 90, excerpt: "", scope_flags: ["EMPTY_SOURCE_BODY"] }], relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.equal(empty.answerability, "INSUFFICIENT");
  const conflict = assessAnswerability({ plan: { ...plan, warnings: ["CONFLICTING_YEAR_CONSTRAINTS"] }, results: [{ entity_type: "manual_section", relevance_score: 90, excerpt: "월 2,470,000원" }], relaxed: false, legalStatus: "NOT_REQUIRED" });
  assert.equal(conflict.answerability, "CONFLICT");
});

test("완화 검색은 제도명만 → 핵심어 순서로 단계와 검색어를 남긴다", () => {
  const stages = relaxationStages(refineWelfareQuery("재난적의료비 지원 신청 후 지급결정까지는 얼마나 소요되나요?", { currentYear: 2026 }));
  assert.deepEqual(stages.map((stage) => stage.stage), ["program_only", "core_terms"]);
  assert.equal(stages[0].plan.detail_terms.length, 0);
  assert.ok(stages[1].plan.search_tokens.length >= 1 && stages[1].plan.programs.length === 0);
});

test("법령 의도 질문은 정식 법령명으로 연결하고 법령 검색 결과의 MST를 읽는다", () => {
  const law = (question) => lawNameForQuery(refineWelfareQuery(question, { currentYear: 2026 }));
  assert.equal(law("의료인이란 누구인가요?"), "의료법");
  assert.equal(law("금연구역에서 전자담배를 피울 경우 과태료가 부과되나요?"), "국민건강증진법");
  assert.equal(law("진료기록 사본을 다른 병원에 전송할 수 있나요?"), "의료법");
  assert.equal(law("아동복지시설의 종류는 법에서 어떻게 정하나요?"), "아동복지법");
  assert.equal(law("'자연장'이란 무엇인가요?"), "장사 등에 관한 법률");
  assert.equal(law("국민건강증진법에서 금연구역 지정 의무는?"), "국민건강증진법");
  const hits = parseLawSearchHits("검색 결과 (총 2건):\n\n1. 의료법 [현행]\n   - 법령ID: 001788\n   - MST: 265311\n   - 공포일: 20240101\n2. 의료법 시행령\n   - 법령ID: 002023\n   - MST: 265312\n   - 공포일: 20240101\n");
  assert.deepEqual(hits.map((hit) => [hit.name, hit.mst]), [["의료법", "265311"], ["의료법 시행령", "265312"]]);
});

test("다른 제도 FAQ는 비슷한 문장이어도 FAQ 근거에서 제외한다", async () => {
  const db = database();
  const plan = refineWelfareQuery("부모급여 신청은 어디서 하나요?", { currentYear: 2026 });
  const result = await searchFaq129(db, plan, { limit: 10 });
  for (const hit of result.hits) assert.ok(hit.programs.length === 0 || hit.programs.some((program) => plan.program_scope.includes(program)), hit.question);
});

test("법령 의도 질문은 법령 후보를 3위 안에 둔다", () => {
  const plan = refineWelfareQuery("'자연장'이란 무엇인가요?", { currentYear: 2026 });
  const manuals = [1, 2, 3, 4].map((index) => ({ id: "manual:r:m" + index, entity_type: "manual_section", title: "[매뉴얼] 자연장 안내 " + index, rank: 230 - index, context: "장사업무 안내" }));
  const law = { id: "law:1:제2조", entity_type: "law", title: "[법령] 장사 등에 관한 법률", rank: 100 };
  const ids = fuseSearchCandidates([...manuals, law], plan).map((item) => item.id);
  assert.ok(ids.indexOf("law:1:제2조") <= 2, JSON.stringify(ids));
});

test("조문을 지정하지 않은 법령 질문은 목차에서 정의·과태료 등 맞는 조문을 고른다", () => {
  const toc = parseLawToc("법령명: 국민건강증진법\n목차 (총 40개 조문) 제1조 목적 제2조 정의 제9조 금연을 위한 조치 제9조의2 담배에 관한 경고문구 등 표시 제31조 벌칙 제34조 과태료 제35조");
  assert.deepEqual(toc.slice(0, 3), [{ article: "제1조", title: "목적" }, { article: "제2조", title: "정의" }, { article: "제9조", title: "금연을 위한 조치" }]);
  const fine = refineWelfareQuery("금연구역에서 전자담배를 피울 경우 과태료가 부과되나요?", { currentYear: 2026 });
  assert.deepEqual(pickLawArticles(toc, fine), ["제34조", "제9조"]);
  const medToc = parseLawToc("목차 제1조 목적 제2조 의료인 제3조 의료기관 제21조 기록 열람 등 제21조의2 진료기록의 송부 등");
  assert.equal(pickLawArticles(medToc, refineWelfareQuery("의료인이란 누구인가요?", { currentYear: 2026 }))[0], "제2조");
  assert.equal(pickLawArticles(medToc, refineWelfareQuery("진료기록 사본을 다른 병원에 전송할 수 있나요?", { currentYear: 2026 }))[0], "제21조의2");
});

const hash = (text) => createHash("sha256").update(text).digest("hex");
function emptyBodyPack() {
  const revision = "manual-empty-body-v1";
  const contents = [
    "## 표 3. 긴급생계지원 지원금액\n![표](table-3.png)\n",
    "| 가구원수 | 1인 | 2인 |\n|---|---|---|\n| 긴급생계지원 지원금액 | 730,500원 | 1,205,000원 |\n긴급생계지원은 원칙적으로 1개월 지원하며 예외적으로 연장할 수 있습니다.\n",
  ];
  const doc = { document_id: "doc-empty", source_name: "2026년 긴급복지지원사업안내.md", source_path: "source-md/2026년 긴급복지지원사업안내.md", sha256: hash(contents.join("")), byte_size: Buffer.byteLength(contents.join("")), document_year: "2026", category: "시험", document_type: "manual", publisher: "원천 기본값", edition: "", effective_from: "", effective_to: "", topic: "긴급복지", authority: "primary", source_role: "operational_manual", jurisdiction: "national", section_count: 2 };
  const sections = contents.map((content, index) => ({ section_id: "empty-" + index, document_id: doc.document_id, ordinal: index + 1, node_id: "n" + index, title: index ? "긴급생계지원 금액표 본문" : "표 3. 긴급생계지원 지원금액", heading_path: "긴급복지 > 생계지원", service_names: "긴급복지", original_name: doc.source_name, upstream_original_name: doc.source_name, original_name_basis: "explicit_original_file_marker", original_name_line: 1, start_line: index ? 3 : 1, end_line: index ? 6 : 2, content, content_hash: hash(content) }));
  const payloads = [[doc], []].map((documents, index) => ({ schema_version: "manual-corpus-1", revision, batch_index: index, documents, sections: index ? sections : [] }));
  const assets = new Map(payloads.map((batch, index) => ["/__manual_corpus/" + revision + "/batch-" + index + ".json", Buffer.from(JSON.stringify(batch))]));
  const manifest = { schema_version: "manual-corpus-1", revision, source_repository: "https://gitlab.aigov.go.kr/memory365/seoguipowelfare", source_commit: "bdef4e9c16095327302f59b85045267ce9c39e17", created_at: new Date(NOW * 1000).toISOString(), document_count: 1, section_count: 2, batches: [...assets].map(([path, bytes], index) => ({ path, sha256: hash(bytes), bytes: bytes.length, documents: index ? 0 : 1, sections: index ? 2 : 0 })) };
  return { manifest, loader: async (path) => new Uint8Array(assets.get(path)) };
}

test("표·이미지만 있는 매뉴얼 구간은 EMPTY_SOURCE_BODY로 강등하고 같은 문서의 다음 본문 구간을 잇는다", async () => {
  assert.equal(manualBodyChars("## 표 3. 지원금액\n![표](a.png)\n<br>"), 0);
  assert.ok(manualBodyChars("| 1인 | 730,500원 |\n긴급생계지원은 원칙적으로 1개월 지원하며 예외적으로 연장할 수 있습니다.") >= 30);
  const db = database();
  db.sqlite.prepare("INSERT INTO official_sync_run(id,trigger,status,started_at,completed_at) VALUES ('empty-run','manual','succeeded',?,?)").run(NOW - 1, NOW);
  const { manifest, loader } = emptyBodyPack();
  for (let step = 0; step < 3; step++) await advanceManualCorpus(db, loader, manifest, { now: () => NOW });
  await ensureActiveBundle(db, NOW + 1);
  const result = await search(db, "긴급생계지원 지원금액 표");
  const manuals = result.results.filter((item) => item.entity_type === "manual_section");
  const empty = manuals.find((item) => item.id.endsWith(":empty-0"));
  const body = manuals.find((item) => item.id.endsWith(":empty-1"));
  assert.ok(empty && body, JSON.stringify(manuals.map((item) => item.id)));
  assert.deepEqual(empty.scope_flags, ["EMPTY_SOURCE_BODY"]);
  assert.equal(empty.body_available, false);
  assert.equal(body.body_available, true);
  assert.ok(manuals.indexOf(body) < manuals.indexOf(empty), "빈 본문 구간을 본문 구간보다 앞세우지 않는다");
  assert.match(body.excerpt, /730,500원/);
});


test("requested year requires explicit applicable evidence rather than filename years", () => {
  const assess = (requested_year, hit) => assessAnswerability({ plan: { fact_types: ["amount"], program_scope: [], legal_intent: false, warnings: [], requested_year }, results: [{ entity_type: "manual_section", relevance_score: 90, ...hit }], relaxed: false, legalStatus: "NOT_REQUIRED" });
  for (const year of [2025, 2030]) {
    const result = assess(year, { excerpt: "2026년 월 349,700원 지급", sources: [{ source_year: "2026", source_year_basis: "filename_inferred", applicable_year: null }] });
    assert.notEqual(result.answerability, "SUPPORTED");
    assert.ok(result.reason_codes.includes("YEAR_MISMATCH"));
    assert.equal(result.coverage.requested_year, year);
    assert.equal(result.coverage.year_matched_evidence_candidates, 0);
  }
  const unknown = assess(2026, { excerpt: "월 349,700원 지급", sources: [{ source_year: "2026", source_year_basis: "filename_inferred", applicable_year: null }] });
  assert.notEqual(unknown.answerability, "SUPPORTED");
  assert.ok(unknown.reason_codes.includes("YEAR_UNCONFIRMED"));
  assert.notEqual(assess(2026, { excerpt: "2026년 월 349,700원 지급" }).answerability, "SUPPORTED");
  assert.equal(assess(2026, { excerpt: "월 349,700원 지급", sources: [{ applicable_year: 2026 }] }).answerability, "SUPPORTED");
});

test("SUPPORTED requires all requested facts and excludes stale, failed, and wrong-scope evidence", () => {
  const input = { plan: { fact_types: ["amount", "procedure"], program_scope: [], legal_intent: false, warnings: [] }, results: [{ entity_type: "official_faq", relevance_score: 90, excerpt: "월 349,700원 지급" }], relaxed: false, legalStatus: "NOT_REQUIRED" };
  assert.notEqual(assessAnswerability(input).answerability, "SUPPORTED");
  assert.deepEqual(assessAnswerability(input).coverage.covered_fact_types, ["amount"]);
  const full = { ...input, results: [{ ...input.results[0], excerpt: "월 349,700원 지급. 주민센터 방문 신청" }] };
  assert.equal(assessAnswerability(full).answerability, "SUPPORTED");
  assert.notEqual(assessAnswerability({ ...full, sourceErrors: true }).answerability, "SUPPORTED");
  assert.notEqual(assessAnswerability({ ...full, results: [{ ...full.results[0], freshness: { status: "OUTDATED_OR_CONFLICTING_SOURCE" } }] }).answerability, "SUPPORTED");
  for (const flag of ["REGION_MISMATCH", "YEAR_MISMATCH", "YEAR_EXCLUDED"]) {
    const result = assessAnswerability({ ...full, results: [{ ...full.results[0], scope_flags: [flag] }] });
    assert.equal(result.answerability, "INSUFFICIENT");
    assert.ok(result.reason_codes.includes(flag));
  }
});

test("historical FAQ search preserves candidates with requested and excluded year warnings", async () => {
  const db = database();
  const result = (await call(db, "search_faq", { query: "2021년 기초연금 선정기준액" })).structuredContent;
  assert.equal(result.query_plan.requested_year, 2021);
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every((hit) => hit.freshness.status !== "CURRENT"));
  assert.ok(result.results.some((hit) => hit.scope_flags.includes("YEAR_MISMATCH")));
  assert.ok(result.warnings.some((warning) => warning.includes("YEAR_MISMATCH")));
  const plan = { ...refineWelfareQuery("기초연금 선정기준액", { currentYear: 2026 }), excluded_years: [2026] };
  const excluded = await searchFaq129(db, plan, { nowMs: Date.parse("2026-10-11T00:00:00+09:00") });
  assert.ok(excluded.hits.some((hit) => hit.scope_flags.includes("YEAR_EXCLUDED")));
});

test("multi-program question cannot claim complete scope from only one program", () => {
  const plan = refineWelfareQuery("장애인활동지원과 노인장기요양을 동시에 받을 수 있나요?", { currentYear: 2026 });
  assert.equal(plan.program_scope.length, 2);
  const results = [{ entity_type: "manual_section", relevance_score: 90, title: "노인장기요양 안내", excerpt: "노인장기요양 중복 이용은 제외합니다." }];
  const assess = (items) => assessAnswerability({ plan, results: items, relaxed: false, legalStatus: "NOT_REQUIRED" });
  const partial = assess(results);
  assert.equal(partial.coverage.program_scope_matched, false);
  assert.notEqual(partial.answerability, "SUPPORTED");
  assert.ok(partial.reason_codes.includes("PROGRAM_COVERAGE_GAP"));
  assert.equal(partial.coverage.covered_programs.length, 1);
  const complete = assess([...results, { entity_type: "manual_section", relevance_score: 90, excerpt: "동시 이용 제외", sources: [{ document_title: "장애인활동지원 사업안내" }] }]);
  assert.equal(complete.coverage.program_scope_matched, true);
  assert.equal(complete.coverage.covered_programs.length, 2);
});

test("an application deadline year cannot confirm benefit amount applicability", () => {
  const input = { plan: { fact_types: ["amount"], program_scope: [], legal_intent: false, warnings: [], requested_year: 2030 }, results: [{ entity_type: "manual_section", relevance_score: 90, excerpt: "2030년까지 신청 가능합니다. 월 349,700원 지급.", sources: [{ applicable_year: null }] }], relaxed: false, legalStatus: "NOT_REQUIRED" };
  const result = assessAnswerability(input);
  assert.notEqual(result.answerability, "SUPPORTED");
  assert.ok(result.reason_codes.includes("YEAR_UNCONFIRMED"));
  assert.equal(result.coverage.year_matched_evidence_candidates, 0);
  assert.equal(assessAnswerability({ ...input, results: [{ ...input.results[0], sources: [{ applicable_year: 2030 }] }] }).answerability, "SUPPORTED");
});

