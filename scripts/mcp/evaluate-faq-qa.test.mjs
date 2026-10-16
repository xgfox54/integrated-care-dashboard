import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { candidateType, evaluateRecord, FAQ_PROFILE, recordsCsv, renderReport, snapshotConsistency, summarize, validateGolden } from "./evaluate-golden-qa.mjs";
import { loadBenchmark, main, parseArgs, validateInputQuestion } from "./run-golden-qa.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const faqPath = path.join(ROOT, "quality/faq_200_20261010.json");
const faqText = await readFile(faqPath, "utf8");
const faq = JSON.parse(faqText);
const q = faq.items[2];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const tool = (value) => ({ structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }], isError: false });
const manual = { id: "manual:revision-a:section-1", title: "입원과 생계급여", entity_type: "manual_section" };
const source = { title: q.source.title, url: q.source.url, filename: "guide.md", section_id: "section-1", heading_path: ["급여", "입원"], line_start: 20, line_end: 29, reference_year: 2026, revision: "revision-a" };
const fetchEntry = (hit = manual, extra = {}, rank = 1) => ({ id: hit.id, rank, result: tool({ id: hit.id, title: hit.title, body: "의료급여 자격과 입원일수를 확인합니다.", metadata: { sources: [source], manual_revision: "revision-a" }, ...extra }) });
const raw = (item, hits = [], fetched = []) => ({ id: item.id, question: item.question, search: { arguments: { query: item.question }, result: tool({ results: hits, manual_revision: "revision-a" }) }, fetched });
const summaryOf = (rows) => summarize(rows, { evaluation_profile: FAQ_PROFILE, expected_ids: faq.items.map((item) => item.id), total_golden_items: 200 });
const fixture = async (t) => { const dir = await mkdtemp(path.join(os.tmpdir(), "faq-qa-test-")); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test("기본 active FAQ는 200개 WFAQ ID·질문 SHA·원셀 줄바꿈을 모두 보존하며 기존 골든은 별도 선택된다", async () => {
  const active = await loadBenchmark(parseArgs([]));
  assert.equal(active.filename, faqPath); assert.equal(active.profile, FAQ_PROFILE);
  assert.equal(active.sha256, hash(faqText)); assert.equal(active.golden.count, 200);
  assert.deepEqual(active.golden.items.map((item) => item.id), Array.from({ length: 200 }, (_, i) => `WFAQ-${String(i + 1).padStart(3, "0")}`));
  const provenance = JSON.parse(await readFile(path.join(ROOT, "quality/faq_200_20261010.provenance.json"), "utf8"));
  assert.equal(provenance.source.sha256_before, provenance.source.sha256_after);
  assert.equal(provenance.dataset.sha256, active.sha256);
  let newlineCount = 0;
  for (const item of active.golden.items) {
    const original = provenance.records.find((entry) => entry.id === item.id);
    assert.ok(original);
    assert.equal(item.question, original.question_row_cells.find((cell) => cell.column === "E").value);
    assert.equal(item.provenance.question_sha256, hash(item.question));
    if (item.question.includes("\n")) newlineCount++;
  }
  assert.equal(newlineCount, 158);
  const old = await loadBenchmark(parseArgs(["--golden", path.join(ROOT, "quality/golden_qa_v1.4.0.json")]));
  assert.equal(old.golden.items.length, 200); assert.equal(old.golden.items[0].id, "Q001");
  assert.equal(old.profile, "golden_retrieval"); assert.equal(old.selection, "explicit_golden_argument");
});

test("FAQ 원문의 줄바꿈 변경·ID 재작성·개수 불일치를 거절한다", () => {
  validateGolden(faq);
  const changed = structuredClone(faq); changed.items[2].question = q.question.replaceAll("\n", " ");
  assert.throws(() => validateGolden(changed), /SHA/);
  const renamed = structuredClone(faq); renamed.items[0].id = "Q001";
  assert.throws(() => validateGolden(renamed), /ID/);
  assert.throws(() => validateGolden({ ...faq, count: 199 }), /count/);
  assert.throws(() => validateGolden({ ...faq, items: [...faq.items.slice(0, 199), faq.items[0]] }), /중복/);
});

test("FAQ native 입력은 실제 query 원문을 요구하고 평가항목·출처 추가나 줄바꿈 손실을 거절한다", () => {
  validateInputQuestion(q, raw(q), FAQ_PROFILE);
  assert.throws(() => validateInputQuestion(q, { question: q.question, search: { result: tool({ results: [] }) } }, FAQ_PROFILE), /arguments.query/);
  assert.throws(() => validateInputQuestion(q, { ...raw(q), search: { arguments: { query: q.question + " " + q.evaluation_criteria } } }, FAQ_PROFILE), /실제 search 입력/);
  assert.throws(() => validateInputQuestion(q, { ...raw(q), search: { arguments: { query: q.question.replaceAll("\n", " ") } } }, FAQ_PROFILE), /실제 search 입력/);
  validateInputQuestion({ id: "Q001", question: "질문" }, { question: "질문" }, "golden_retrieval");
});

test("FAQ의 미제공 정답키는 0%가 아니라 null·NOT_EVALUATED이며 실제 매뉴얼 관찰과 분리한다", () => {
  const row = evaluateRecord(q, raw(q, [manual], [fetchEntry()]));
  assert.equal(row.evaluation_profile, FAQ_PROFILE); assert.equal(row.query_integrity.status, "VERIFIED");
  assert.equal(row.program_recall_at[5], null); assert.equal(row.document_recall_at[5], null);
  assert.equal(row.context.evidence_present, null); assert.equal(row.context.numeric_status, "RUBRIC_NOT_SPECIFIED");
  assert.equal(row.context.year_status, "RUBRIC_NOT_SPECIFIED"); assert.equal(row.expected_year, null);
  assert.equal(row.faq_observation.manual_section_at[5], true); assert.equal(row.faq_observation.manual_section_body_present, true);
  const summary = summaryOf([row]);
  for (const metric of [summary.program_recall_at[5], summary.document_recall_at[5], summary.evidence_presence, summary.expected_numbers_context_presence, summary.expected_year_context_presence]) {
    assert.equal(metric.status, "NOT_EVALUATED"); assert.equal(metric.count, null); assert.equal(metric.denominator, 0); assert.equal(metric.rate, null);
  }
  assert.equal(summary.faq_observation.manual_section_at[5].count, 1);
  assert.equal(row.answer_correctness, "NOT_EVALUATED"); assert.equal(row.human_review, "PENDING");
  assert.equal(summary.faq_observation.review_required, 1);
  assert.ok(renderReport(summary, [row]).includes("확정 정답키: 미제공"));
});

test("structured sources 원형·절/행 위치·출처 URL을 보존하고 제목/URL 일치를 정답으로 승격하지 않는다", () => {
  const row = evaluateRecord(q, raw(q, [{ ...manual, source: { ...source, section_id: "search-section" } }], [fetchEntry()]));
  const hit = row.candidates[0];
  assert.deepEqual(hit.structured_sources.find((entry) => entry.origin === "fetch").source, source);
  assert.ok(hit.source_locations.some((entry) => entry.path === "metadata.sources[0].line_start" && entry.value === 20));
  assert.ok(hit.source_locations.some((entry) => entry.origin === "search" && entry.value === "search-section"));
  assert.equal(row.faq_observation.fetched_source_location_present, true);
  assert.equal(row.faq_observation.reference_source_url_observed_at[5], true);
  assert.equal(row.faq_observation.reference_source_title_observed_at[5], true);
  assert.equal(row.faq_observation.semantic_relevance, "NOT_EVALUATED");
  assert.equal(row.evaluation_criteria, q.evaluation_criteria); assert.equal(row.major_error_type, q.major_error_type);
});

test("출처 작성일·query_plan·수집일은 본문 적용연도가 되지 않으며 연도 provenance를 분리한다", () => {
  const metadata = { sources: [{ url: q.source.url, reference_year: 2025, published_at: "2026-10-10" }], query_plan: { year: 2026, query: "2026년 1,994,600원" }, generated_at: "2026-10-10" };
  const row = evaluateRecord(q, raw(q, [manual], [fetchEntry(manual, { metadata, body: "입원일수를 확인하세요.", text: "2026년 1994600원이라는 질문이 입력됨" })]));
  const years = row.candidates[0].year_provenance;
  assert.deepEqual(years.body_year_mentions, []);
  assert.deepEqual(years.source_year_fields.map((entry) => entry.value), [2025]);
  assert.deepEqual(years.source_date_fields.map((entry) => entry.value), ["2026-10-10"]);
  assert.equal(years.applicability, "NOT_EVALUATED");
  assert.equal(row.faq_observation.year_provenance.reference_written_at, q.source.written_at);
  assert.equal(row.expected_year, null); assert.deepEqual(row.context.expected_numbers, []);
});

test("실제 매뉴얼 인용 스키마의 추정 연도·물리페이지 미확인·부분 본문을 그대로 남긴다", () => {
  const citation = { source_repository: "https://example.test/repo", source_commit: "abc", source_path: "manuals/2026-guide.md", url: "https://example.test/repo/manuals/2026-guide.md", url_kind: "repository_parsed_copy", official_url: null, document_title: "2026 안내", original_name: "2026 안내.pdf", document_year: "2026", document_year_basis: "filename_inferred", source_year: "2026", source_year_basis: "filename_inferred", source_year_origin: "original_name", applicable_year: null, publisher_verified: false, authority_verified: false, jurisdiction_verified: false, location: { basis: "parsed_markdown_lines", start_line: 31, end_line: 102, heading_path: "절차 > 신청", physical_page: null, physical_page_verified: false } };
  const row = evaluateRecord(q, raw(q, [{ ...manual, sources: [citation] }], [fetchEntry(manual, { body: undefined, text: "접수처와 신청 절차", metadata: { sources: [citation], excerpt: { offset: 0, returned_chars: 8000, total_chars: 9200, next_offset: 8000, truncated: true }, image_content_available: false } })]));
  assert.deepEqual(row.candidates[0].structured_sources.find((entry) => entry.origin === "fetch").source, citation);
  assert.ok(row.candidates[0].source_locations.some((entry) => entry.path === "metadata.sources[0].location.start_line" && entry.value === 31));
  assert.ok(row.candidates[0].year_provenance.source_year_fields.some((entry) => entry.path === "metadata.sources[0].document_year_basis" && entry.value === "filename_inferred"));
  assert.ok(row.candidates[0].year_provenance.source_year_fields.some((entry) => entry.path === "metadata.sources[0].applicable_year" && entry.value === null));
  assert.equal(row.candidates[0].body_extent.truncated, true);
  assert.equal(row.faq_observation.manual_section_body_partial, true);
  assert.ok(row.faq_observation.review_required_reasons.includes("MANUAL_SECTION_BODY_PARTIAL"));
  assert.equal(row.context.year_applicability, "NOT_EVALUATED");
});

test("원순위 6위 매뉴얼과 예산·뉴스를 상위5 본문·출처 근거로 끌어올리지 않는다", () => {
  const hits = Array.from({ length: 5 }, (_, i) => ({ id: i % 2 ? `news:${i}` : `bl-${i}`, title: q.source.title, entity_type: "manual_section", source }));
  hits.push(manual);
  const row = evaluateRecord(q, raw(q, hits, [fetchEntry(manual, {}, 6), fetchEntry(hits[0])]));
  assert.equal(candidateType(hits[0]), "budget_line");
  assert.equal(row.faq_observation.manual_section_at[5], false);
  assert.equal(row.faq_observation.manual_sections_fetched, 0);
  assert.equal(row.faq_observation.fetched_body_present, false);
  assert.equal(row.faq_observation.reference_source_url_observed_at[5], false);
  assert.deepEqual(row.faq_observation.source_urls, []);
  assert.ok(row.fetch_link_errors.some((error) => error.code === "FETCH_OUTSIDE_TOP_5"));
});

test("상세의 응답 ID나 원 순위가 다르면 그 상세를 근거로 집계하지 않는다", () => {
  for (const entry of [fetchEntry(manual, { id: "manual:revision-a:other" }), fetchEntry(manual, { id: undefined }), fetchEntry(manual, {}, 3)]) {
    const row = evaluateRecord(q, raw(q, [manual], [entry]));
    assert.equal(row.status, "FETCH_PARTIAL"); assert.equal(row.faq_observation.manual_sections_fetched, 0);
    assert.equal(row.fetch_link_errors.length, 1);
    assert.equal(summaryOf([row]).selected_collection_complete, false);
  }
});

test("정상 빈 검색·호출 오류·미조회 상세를 분리하고 없는 자료에 완료 판정을 만들지 않는다", () => {
  const empty = evaluateRecord(q, raw(q));
  assert.equal(empty.status, "NO_RESULTS"); assert.equal(empty.search_result_count, 0);
  assert.equal(empty.faq_observation.all_admissible_details_fetched, null);
  assert.equal(summaryOf([empty]).faq_observation.manual_section_body_presence.rate, null);
  const error = evaluateRecord(q, { ...raw(q), search: { arguments: { query: q.question }, result: { isError: true, structuredContent: { error: "Connection failed", error_code: "UNAVAILABLE" } } } });
  assert.equal(error.status, "SEARCH_ERROR"); assert.equal(error.search_result_count, null);
  assert.equal(error.faq_observation.manual_section_at[5], null);
  const missingResults = evaluateRecord(q, { ...raw(q), search: { arguments: { query: q.question }, result: tool({ text: "응답 형식이 다릅니다." }) } });
  assert.equal(missingResults.status, "SEARCH_ERROR"); assert.equal(missingResults.search_error.code, "INVALID_SEARCH_RESPONSE"); assert.equal(missingResults.search_result_count, null);
  const unfetched = evaluateRecord(q, raw(q, [manual]));
  assert.equal(unfetched.status, "SEARCH_ONLY"); assert.equal(unfetched.faq_observation.all_admissible_details_fetched, false);
  assert.equal(summaryOf([unfetched]).selected_collection_complete, false);
});

test("실제 FAQ ID 집합과 원문 입력으로 전체 완료를 검증하고 Q200 검사 및 다른 프로필과 혼합하지 않는다", () => {
  const rows = faq.items.map((item) => evaluateRecord(item, raw(item)));
  const result = summaryOf(rows);
  assert.equal(result.all_200_items_accounted_for, true); assert.equal(result.full_200_run, true);
  assert.equal(result.full_collection_complete, true); assert.equal(result.answer_correctness, "NOT_EVALUATED");
  const wrong = rows.map((row, i) => ({ ...row, id: `WFAQ-${String(i + 101).padStart(3, "0")}` }));
  assert.equal(summaryOf(wrong).all_200_items_accounted_for, false);
  assert.equal(summaryOf(rows.slice(0, 199)).full_200_run, false);
  const missingInput = rows.map((row) => ({ ...row, query_integrity: { ...row.query_integrity, status: "NOT_RECORDED" } }));
  assert.equal(summaryOf(missingInput).full_200_run, false);
  assert.throws(() => summaryOf([...rows.slice(0, 199), evaluateRecord({ id: "Q001", question: "질문" }, raw({ id: "Q001", question: "질문" }))]), /프로필/);
});

test("같은 공개본에서도 manual revision 또는 상세 서버 버전 변경을 검출하며 미노출 버전은 추정하지 않는다", () => {
  const snapshot = (revision) => ({ dataset_status: tool({ release_bundle_id: "bundle", server_version: "1.4.0", components: { manuals: "manuals:" + revision }, data: { manuals: { revision }, gov24: { revision: "gov-a" } } }) });
  const start = snapshot("revision-a");
  assert.equal(snapshotConsistency(start, snapshot("revision-b")).status, "CHANGED_DURING_RUN");
  const record = evaluateRecord(q, raw(q, [manual], [fetchEntry(manual, { metadata: { sources: [source], manual_revision: "revision-b" } })]));
  const mixed = snapshotConsistency(start, start, [record]);
  assert.equal(mixed.status, "CHANGED_DURING_RUN"); assert.deepEqual(mixed.fetch_server_versions, []);
  assert.equal(mixed.fetch_identity_coverage.server_version, 0);
  const otherServer = evaluateRecord(q, raw(q, [manual], [fetchEntry(manual, { metadata: { sources: [source], server_version: "1.5.0" } })]));
  assert.equal(snapshotConsistency(start, start, [otherServer]).status, "CHANGED_DURING_RUN");
});

test("FAQ CSV와 JSON은 질문 줄바꿈·검수 기준을 유지하고 원천 작성일을 기대연도 열로 만들지 않는다", () => {
  const row = evaluateRecord(q, raw(q, [manual], [fetchEntry()]));
  const csv = recordsCsv([row]);
  assert.ok(csv.includes('"' + q.question + '"'));
  assert.ok(csv.includes("NOT_EVALUATED")); assert.ok(csv.includes("reference_confirmation_level"));
  assert.ok(!csv.includes("program_recall_at_5"));
  assert.equal(JSON.parse(JSON.stringify(row)).question, q.question);
});

test("기본 FAQ로 native 원 응답을 오프라인 평가하고 데이터셋 SHA·부분 실행·원문을 저장한다", async (t) => {
  const dir = await fixture(t), input = path.join(dir, "input.jsonl"), output = path.join(dir, "result");
  const selected = faq.items.slice(0, 3);
  await writeFile(input, selected.map((item) => JSON.stringify({ kind: "record", ...raw(item) })).join("\n") + "\n");
  const previousExitCode = process.exitCode;
  try { await main(["--records-input", input, "--limit", "3", "--output", output], { fetcher: () => { throw new Error("offline must not fetch"); } }); }
  finally { process.exitCode = previousExitCode; }
  const summary = JSON.parse(await readFile(path.join(output, "summary.json"), "utf8"));
  const records = (await readFile(path.join(output, "records.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(summary.benchmark.selection, "active_manifest"); assert.equal(summary.benchmark.sha256, hash(faqText));
  assert.equal(summary.selected_items, 3); assert.equal(summary.full_200_run, false); assert.equal(summary.selected_collection_complete, true);
  assert.deepEqual(records.map((row) => row.question), selected.map((item) => item.question));
  assert.equal(records[2].query_integrity.status, "VERIFIED");
  assert.equal(summary.program_recall_at[5].rate, null); assert.equal(summary.answer_correctness, "NOT_EVALUATED");
});

test("HTTP FAQ 실행도 원문만 전송하고 원순위 1~5위의 허용 ID만 상세 조회한다", async (t) => {
  const dir = await fixture(t), calls = [], first = faq.items[0];
  const other = { id: "doc:approved", title: "승인 문서" };
  const hits = [{ id: "news:one", title: "뉴스" }, manual, other, { id: "unknown:one", title: "무관" }, { id: "bl-one", title: "예산" }, { ...manual, id: "manual:revision-a:sixth" }];
  const fetcher = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    let result;
    if (request.method === "initialize") result = { serverInfo: { name: "test", version: "1.4.0" } };
    else if (request.params.name === "search") result = tool({ results: hits, manual_revision: "revision-a" });
    else if (request.params.name === "fetch") result = tool({ id: request.params.arguments.id, body: "원문 구간", metadata: { sources: [source], manual_revision: "revision-a" } });
    else if (request.params.name === "get_dataset_status") result = tool({ release_bundle_id: "bundle", server_version: "1.4.0", data: { manuals: { revision: "revision-a" } } });
    else result = tool({ data: { datasets: [] } });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const previousExitCode = process.exitCode;
  try { await main(["--endpoint", "https://example.test/mcp", "--limit", "1", "--min-interval-ms", "0", "--output", dir], { fetcher }); }
  finally { process.exitCode = previousExitCode; }
  assert.deepEqual(calls.filter((call) => call.params?.name === "search").map((call) => call.params.arguments), [{ query: first.question }]);
  assert.deepEqual(calls.filter((call) => call.params?.name === "fetch").map((call) => call.params.arguments.id), [manual.id, other.id]);
  const row = JSON.parse((await readFile(path.join(dir, "records.jsonl"), "utf8")).trim());
  assert.deepEqual(row.raw.fetched.map((entry) => entry.rank), [2, 3]);
  assert.deepEqual(row.candidates.map((entry) => entry.id), hits.slice(0, 5).map((entry) => entry.id));
});
