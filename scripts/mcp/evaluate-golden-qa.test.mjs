import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRecord, recordsCsv, snapshotConsistency, summarize, unwrapToolResult, validateGolden } from "./evaluate-golden-qa.mjs";
import { parseArgs, PublicMcpClient } from "./run-golden-qa.mjs";

const item = { id: "Q175", question: "2026년 긴급복지 4인가구가 200만원 맞죠?", expected_document: "18.[매뉴얼-긴급복지] 2026년 긴급복지지원 안내.md", expected_section: "생계지원", expected_year: "2026", category: "wrong_premise", jurisdiction: "national", must_include: ["1,994,600원"], must_not_include: ["200만원"], expected_numbers: ["1,994,600원"] };
const tool = (value) => ({ structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }], isError: false });
const raw = (hits, entries = []) => ({ search: { result: tool({ results: hits }) }, fetched: entries });
const program = { id: "gov24:1", title: "긴급복지 생계지원", url: "https://www.gov.kr/1" };
const detail = (text, extras = {}) => ({ id: program.id, result: tool({ ...program, text, metadata: { sources: [{ title: "2026년 긴급복지지원 사업안내", url: "https://www.mohw.go.kr/test" }] }, ...extras }) });

test("HTTP JSON-RPC와 native text-only 결과를 모두 파싱하고 429를 0건으로 바꾸지 않는다", () => {
  assert.equal(unwrapToolResult({ jsonrpc: "2.0", result: tool({ results: [] }) }).ok, true);
  assert.deepEqual(unwrapToolResult({ content: [{ type: "text", text: '{"results":[]}' }] }).data.results, []);
  const error = unwrapToolResult({ isError: true, structuredContent: { error: "slow", error_code: "RATE_LIMITED", retry_after_seconds: 24 } });
  assert.equal(error.ok, false); assert.equal(error.error.retry_after_seconds, 24);
  const row = evaluateRecord(item, { search: { result: { isError: true, structuredContent: { error: "slow", error_code: "RATE_LIMITED" } } }, fetched: [] });
  assert.equal(row.status, "SEARCH_ERROR"); assert.equal(row.search_result_count, null); assert.equal(row.program_recall_at[5], null);
});

test("예산서·보도자료에서 사업명이 보여도 기대 복지사업 회수로 집계하지 않는다", () => {
  const row = evaluateRecord(item, raw([{ id: "bl-1", title: "긴급복지 생계지원 예산" }, { id: "news:1", title: "긴급복지 생계지원 확대" }]));
  assert.equal(row.program_recall_at[1], false); assert.equal(row.program_recall_at[5], false);
});

test("생계지원 후보에 긴급복지의 다른 하위급여만 있는 제목은 포함하지 않는다", () => {
  for (const title of ["긴급복지 의료지원", "긴급복지 주거지원", "긴급복지 교육지원"]) assert.equal(evaluateRecord(item, raw([{ ...program, title }])).program_recall_at[5], false);
  for (const title of ["긴급복지지원", "서귀포시 긴급복지 지원사업", "긴급복지 지원(생계비)"]) assert.equal(evaluateRecord(item, raw([{ ...program, title }])).program_recall_at[5], true);
});

test("관찰 가능한 순위·근거·수치는 계산하지만 정답률과 적용연도 판정은 수행하지 않는다", () => {
  const row = evaluateRecord(item, raw([{ id: "service:other", title: "노인맞춤돌봄" }, program], [detail("2026년 4인 가구: 1,994,600원/월. 200만원이라는 전제는 정확하지 않습니다.")]));
  assert.equal(row.program_recall_at[1], false); assert.equal(row.program_recall_at[3], true);
  assert.equal(row.context.evidence_present, true); assert.equal(row.context.numeric_status, "EXPECTED_NUMBERS_OBSERVED");
  assert.equal(row.context.year_status, "EXPECTED_YEAR_OBSERVED"); assert.deepEqual(row.context.premise_tokens_observed, ["200만원"]);
  assert.equal(row.answer_correctness, "NOT_EVALUATED"); assert.equal(row.context.year_applicability, "NOT_EVALUATED"); assert.equal(row.human_review, "PENDING");
});

test("질문 숫자·생성시각·URL 연도·다른 사업 컨텍스트로 검사 기준을 충족하지 않는다", () => {
  const row = evaluateRecord(item, { ...raw([program], [detail("지원 안내\n출처: 2026년 지침 https://www.mohw.go.kr/2026/1994600", { generated_at: "2026-01-01", metadata: { query: item.question } })]), question: item.question });
  assert.equal(row.context.numeric_status, "EXPECTED_NUMBERS_MISSING"); assert.equal(row.context.year_status, "YEAR_NOT_EXPLICIT");
  const unrelated = evaluateRecord(item, raw([{ id: "service:a", title: "노인맞춤돌봄" }], [{ id: "service:a", result: tool({ title: "노인맞춤돌봄", text: "2026 1994600" }) }]));
  assert.equal(unrelated.context.numeric_status, "CONTEXT_UNAVAILABLE");
});

test("구조화 fallback은 query_plan·evidence_resolution·unknowns의 질문 숫자와 요청연도를 읽지 않는다", () => {
  const value = { ...program, benefit: null, query_plan: { raw_query: "2026년 1,994,600원 맞죠?", requested_year: 2026, current_year: 2026 }, evidence_resolution: { alternatives: [{ benefit: "2026년 1,994,600원" }] }, eligibility: { unknowns: ["2026년 1,994,600원인지 미확인"] } };
  const row = evaluateRecord(item, raw([program], [{ id: program.id, result: tool(value) }]));
  assert.equal(row.context.numeric_status, "EXPECTED_NUMBERS_MISSING"); assert.equal(row.context.year_status, "YEAR_NOT_EXPLICIT");
});

test("예산·뉴스 출처 파일명이 기대 문서와 같아도 문서 회수나 수치 컨텍스트로 승격하지 않는다", () => {
  for (const id of ["bl-test", "news:test"]) {
    const row = evaluateRecord(item, raw([{ id, title: program.title }], [{ id, result: tool({ text: "2026년 1,994,600원", metadata: { sources: [{ title: item.expected_document, url: "https://www.mohw.go.kr/source" }] } }) }]));
    assert.equal(row.document_recall_at[5], false); assert.equal(row.context.numeric_status, "CONTEXT_UNAVAILABLE"); assert.equal(row.context.year_status, "CONTEXT_UNAVAILABLE");
  }
});

test("숫자의 부분 문자열 일치는 배제하고 여러 연도가 함께 나타나면 별도로 표시한다", () => {
  const row = evaluateRecord(item, raw([program], [detail("2025년과 2026년 자료. 11,994,600원")]));
  assert.equal(row.context.numeric_status, "EXPECTED_NUMBERS_MISSING");
  assert.equal(row.context.year_status, "EXPECTED_AND_OTHER_YEARS_OBSERVED");
});

test("2026원 단가는 연도가 아니며 년·날짜·연도 필드가 있을 때만 연도로 관찰한다", () => {
  const currency = evaluateRecord(item, raw([program], [detail("지원금 단가 2026원, 사업번호 2026")]));
  assert.equal(currency.context.year_status, "YEAR_NOT_EXPLICIT");
  for (const text of ["2026년 기준", "시행일 2026-01-01", "적용연도: 2026"]) assert.equal(evaluateRecord(item, raw([program], [detail(text)])).context.year_status, "EXPECTED_YEAR_OBSERVED");
});

test("문서 회수는 기대 파일명의 출처 존재를 엄격히 확인한다", () => {
  const row = evaluateRecord(item, raw([program], [detail("2026 1,994,600원", { metadata: { sources: [{ title: item.expected_document, url: "https://www.mohw.go.kr/source" }] } })]));
  assert.equal(row.document_recall_at[1], true);
  assert.equal(evaluateRecord(item, raw([program], [detail("2026 1,994,600원")])).document_recall_at[1], false);
});

test("상위5 중 미조회 상세는 문서 미관찰로 남기고 사업 후보 관찰과 구분한다", () => {
  const hits = [program, { ...program, id: "gov24_service:2" }, { ...program, id: "gov24_service:3" }, { ...program, id: "gov24_service:4" }];
  const row = evaluateRecord(item, raw(hits, [detail("지원내용만 있음")]));
  assert.equal(row.program_recall_at[5], true); assert.equal(row.document_recall_at[1], false);
  assert.equal(row.document_recall_at[3], null); assert.equal(row.document_recall_at[5], null);
  assert.equal(row.document_observation_complete_at[1], true); assert.equal(row.document_observation_complete_at[5], false);
});

test("gov24_service와 출처가 본문에만 있는 문서 계약도 읽되 수정일·근거 제목은 적용연도로 세지 않는다", () => {
  const hit = { id: "gov24_service:1", title: "긴급복지 생계지원", entity_type: "gov24_service" };
  const row = evaluateRecord(item, raw([hit], [{ id: hit.id, result: tool({ ...hit, text: "지원내용: 1,994,600원 (근거: 2026년 사업 안내, 블록 1)\n원천 수정일: 2026-08-11\n출처: " + item.expected_document + " https://www.mohw.go.kr/source" }) }]));
  assert.equal(row.program_recall_at[1], true); assert.equal(row.document_recall_at[1], true);
  assert.equal(row.context.evidence_present, true); assert.equal(row.context.numeric_status, "EXPECTED_NUMBERS_OBSERVED");
  assert.equal(row.context.year_status, "YEAR_NOT_EXPLICIT");
});

test("지역식사지원 질문은 제주가치돌봄 후보를 찾아야 한다", () => {
  const q = { ...item, id: "Q188", question: "서귀포에서 제주가치돌봄 식사지원 업무 기준", expected_section: "식사지원", expected_document: "2026년 제주가치돌봄.md", expected_numbers: [] };
  const unrelated = evaluateRecord(q, raw([{ id: "service:1", title: "서울 노인 식사지원" }]));
  assert.equal(unrelated.program_recall_at[5], false);
  const related = evaluateRecord(q, raw([{ id: "gov24:650000001135", title: "제주가치돌봄" }]));
  assert.equal(related.program_recall_at[5], true); assert.equal(related.context.numeric_status, "RUBRIC_NOT_SPECIFIED");
});

test("서버·정부24 개정이 바뀌면 공개본 ID가 같아도 검사 중 변경으로 판정한다", () => {
  const snap = (version, revision) => ({ at: "2026-10-10", dataset_status: tool({ release_bundle_id: "same", server_version: version, data: { gov24: { revision } } }), integration_status: tool({ data: { datasets: [] } }) });
  assert.equal(snapshotConsistency(snap("1", "a"), snap("2", "a")).status, "CHANGED_DURING_RUN");
  assert.equal(snapshotConsistency(snap("1", "a"), snap("1", "b")).status, "CHANGED_DURING_RUN");
  const old = { dataset_status: tool({ release_bundle_id: "same" }) };
  assert.equal(snapshotConsistency(old, old).status, "PARTIAL_IDENTITY_ONLY");
});

test("시작·종료가 같아도 중간 search/fetch가 다른 식별자를 보이면 실행 중 변경을 표시한다", () => {
  const snapshot = { dataset_status: tool({ release_bundle_id: "same", server_version: "1.2.0", data: { gov24: { revision: "revision-a" } } }) };
  const record = evaluateRecord(item, { search: { result: tool({ results: [], release_bundle_id: "same", server_version: "1.2.1", gov24_revision: "revision-b" }) } });
  const result = snapshotConsistency(snapshot, snapshot, [record]);
  assert.equal(result.status, "CHANGED_DURING_RUN"); assert.deepEqual(result.search_server_versions, ["1.2.1"]);
  assert.deepEqual(result.response_gov24_revisions, ["revision-b"]); assert.equal(result.search_identity_coverage.gov24_revision, 1);
});

test("200개 모두 기록해도 미실행·인증차단이면 전체 검사 완료라고 표시하지 않는다", () => {
  const rows = Array.from({ length: 200 }, (_, index) => evaluateRecord({ ...item, id: "Q" + String(index + 1).padStart(3, "0") }, { status: "BLOCKED_PRECHECK", search: { error: { http_status: 401 } } }));
  const summary = summarize(rows);
  assert.equal(summary.all_200_items_accounted_for, true); assert.equal(summary.full_200_run, false);
  assert.equal(summary.search_execution.count, 0); assert.equal(summary.nonempty_search.rate, null);
  assert.equal(summary.answer_correctness, "NOT_EVALUATED");
  const wrongIds = Array.from({ length: 200 }, (_, i) => evaluateRecord({ ...item, id: "Q" + String(i + 101).padStart(3, "0") }, raw([])));
  assert.equal(summarize(wrongIds).all_200_items_accounted_for, false); assert.equal(summarize(wrongIds).full_200_run, false);
});

test("골든 중복·count 불일치·옵션 오류를 거절하고 CSV 수식을 중화한다", () => {
  assert.throws(() => validateGolden({ count: 2, items: [item] }));
  assert.throws(() => validateGolden({ items: [item, item] }));
  assert.throws(() => parseArgs(["--concurrency", "0"]));
  assert.throws(() => parseArgs(["--endpoint", "https://user:secret@example.com/mcp"]));
  const row = evaluateRecord({ ...item, question: "=1+1" }, raw([]));
  assert.ok(recordsCsv([row]).includes("'=1+1"));
});

test("HTTP401은 재시도하거나 토큰을 보내지 않으며 도구 쓰기 호출을 허용하지 않는다", async () => {
  let calls = 0;
  const client = new PublicMcpClient({ endpoint: "https://example.com/mcp", retries: 2, minIntervalMs: 0, timeoutMs: 1000 }, async (_url, options) => { calls++; assert.equal(options.headers.authorization, undefined); return new Response("Unauthorized", { status: 401 }); });
  const result = await client.tool("search", { query: "생계급여" });
  assert.equal(calls, 1); assert.equal(result.error.http_status, 401);
  await assert.rejects(() => client.tool("delete_dataset", {}));
});

test("응답 수신 시간초과를 요청별 제한 안에 오류로 기록한다", async () => {
  const client = new PublicMcpClient({ endpoint: "https://example.com/mcp", retries: 0, minIntervalMs: 0, timeoutMs: 15 }, async (_url, options) => new Promise((_, reject) => { const keepAlive = setTimeout(() => reject(new Error("test timeout")), 100); options.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true }); }));
  const result = await client.tool("search", { query: "생계급여" });
  assert.equal(result.error.code, "TimeoutError"); assert.equal(result.attempts.length, 1);
});

test("60초를 초과하는 Retry-After는 기다리지 않고 재시도 한도 오류로 보존한다", async () => {
  let calls = 0;
  const client = new PublicMcpClient({ endpoint: "https://example.com/mcp", retries: 2, minIntervalMs: 0, timeoutMs: 1000 }, async () => { calls++; return new Response("slow", { status: 429, headers: { "retry-after": "120" } }); });
  const result = await client.tool("search", { query: "생계급여" });
  assert.equal(calls, 1); assert.equal(result.error.code, "RATE_LIMITED"); assert.ok(result.attempts[0].retry_delay_ms > 60_000);
});
