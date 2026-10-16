/**
 * Reviewable builder for the completed native FAQ 200 observation run.
 * It never calls MCP, changes runtime data, or invents missing results.
 *
 * Execute a copy from a conversation-specific OS tmp directory whose node_modules
 * symlink targets CODEX_PRIMARY_RUNTIME_NODE_MODULES. Use CODEX_PRIMARY_RUNTIME_NODE.
 * Before the first --author invocation, run the Spreadsheets skill's operation marker.
 * Without --author this only validates real input files; it does not create a workbook.
 *
 * Options: --repo DIR [--records PATH] [--summary PATH] [--csv PATH]
 *          [--qa PATH] [--output PATH] [--review-notes PATH] [--author]
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPORT_DIR = "docs/qa/faq-200-20261010";
const FIRST_ROW = 7;
const ROW_COUNT = 200;
const LAST_ROW = FIRST_ROW + ROW_COUNT - 1;
const EXCERPT_LIMIT = 240;
const FONT = "Noto Sans CJK KR";
const SHEETS = { summary: "운영 관찰 요약", detail: "문항별 검토" };
const COLORS = { ink: "#182B3A", muted: "#526272", line: "#D5DEE5", header: "#244B61", blue: "#EAF2F7", amber: "#FFF2D8", red: "#FCE4E4", paper: "#FFFFFF", editable: "#F2F5F7" };
const STATUS_LABELS = {
  RETRIEVED: "검색 및 허용 후보 상세 수신",
  FETCH_PARTIAL: "일부 상세 오류·연결 이상",
  SEARCH_ONLY: "검색 결과만 수신",
  NO_RESULTS: "정상 검색의 반환 0건",
  SEARCH_ERROR: "검색 오류",
  BLOCKED_PRECHECK: "사전 점검에서 중단",
  NOT_RUN: "미실행",
};
const TYPE_LABELS = { manual_section: "매뉴얼 절", implementation: "시행사업", government_service: "정부24", document_program: "문서 사업", document: "문서", budget_line: "예산행·상세 제외", news_metadata: "뉴스·상세 제외" };
const REASONS = {
  ANSWER_KEY_NOT_PROVIDED: "정답키 미제공",
  SEMANTIC_REVIEW_PENDING: "질문과 근거의 의미 적합성 미검수",
  SEARCH_INPUT_PROVENANCE_INCOMPLETE: "실제 검색 입력의 원문 일치 확인 필요",
  CURRENT_RULES_RECHECK_REQUIRED: "현행 기준 재확인 필요",
  REFERENCE_BODY_NOT_CONFIRMED_BY_WORKBOOK_AUTHOR: "질문 원출처의 본문 미확인 표시",
  SEARCH_NOT_SUCCESSFUL: "검색 정상 응답 미확보",
  NO_MATCH_IN_STORED_DATA: "저장 자료에서 검색 후보 미확보",
  NO_MANUAL_SECTION_IN_TOP_5: "원순위 상위 5개에 매뉴얼 절 없음",
  TOP_5_ADMISSIBLE_DETAIL_INCOMPLETE: "상위 5개 허용 후보의 상세 수집 불완전",
  FETCH_LINK_REVIEW_REQUIRED: "검색 후보와 상세 ID·순위 연결 확인 필요",
  MANUAL_SECTION_BODY_PARTIAL: "일부 매뉴얼 상세는 부분 본문",
  MANUAL_BODY_FRAME_UNVERIFIED: "매뉴얼 응답에서 실제 본문 범위 미확인",
};
const REVIEW_STATES = ["미검수", "검토 중", "추가 근거 필요", "검토 메모 있음"];
const HEADERS = [
  "문항 ID", "원질문", "분류 · 평가유형", "검색 상태", "반환 수", "원순위 1~5 후보",
  "매뉴얼 @5", "매뉴얼 본문", "대표 매뉴얼 ID · 조회 수", "대표 매뉴얼 발췌 · 최대 240자",
  "부분 본문 · 대표 응답 범위", "대표 원문명 · Markdown 위치", "출처 연도 · 추론 근거",
  "조회 출처 URL · 한글 표기 · 최대 3개", "원질문 전송", "검수 필요 사유",
  "원파일 평가항목 · 주요 오답 유형", "질문 원출처 · 작성자 확인 수준", "검토 메모 상태", "AI 근거 검토 메모 · 사람 검수 미완료",
  "부분 본문 집계값 (0/1)", "검색 재시도 집계값 (0/1)",
];
const WIDTHS = [104, 440, 150, 142, 74, 440, 92, 96, 295, 360, 225, 360, 285, 440, 125, 335, 325, 355, 126, 400, 125, 135];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const same = (actual, expected, label) => assert(canonical(actual) === canonical(expected), "Input reconciliation failed: " + label);
const exists = async (filename) => { try { await fs.access(filename); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const textCell = (value) => { const text = value == null ? "" : String(value); assert(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(text), "Unsupported spreadsheet control character"); assert(text.length <= 32_000, "A review cell exceeds the Excel text limit"); return /^[=+@-]/.test(text) ? "'" + text : text; };
const column = (index) => { let value = index + 1, out = ""; while (value) { value--; out = String.fromCharCode(65 + value % 26) + out; value = Math.floor(value / 26); } return out; };

function optionsOf(argv) {
  const options = { author: false };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === "--author") { options.author = true; continue; }
    assert(/^--(?:repo|records|summary|csv|qa|output|review-notes)$/.test(key) && argv[index + 1], "Unknown or missing argument: " + key);
    options[key.slice(2)] = argv[++index];
  }
  assert(options.repo, "--repo is required");
  options.repo = path.resolve(options.repo);
  const resolve = (value, fallback) => path.resolve(options.repo, value ?? fallback);
  options.qa = resolve(options.qa, "quality/faq_200_20261010.json");
  options.summary = resolve(options.summary, REPORT_DIR + "/summary.json");
  options.csv = resolve(options.csv, REPORT_DIR + "/results.csv");
  options.output = resolve(options.output, REPORT_DIR + "/faq-200-results.xlsx");
  if (options.records) options.records = resolve(options.records);
  if (options["review-notes"]) options.reviewNotes = resolve(options["review-notes"]);
  return options;
}

async function readBytes(filename) {
  const bytes = await fs.readFile(filename);
  return { bytes, text: (filename.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8") };
}

/** Pure input/model phase. No artifact-tool import or workbook authoring occurs here. */
export async function loadRealInputs(options) {
  const evaluator = await import(pathToFileURL(path.join(options.repo, "scripts/mcp/evaluate-golden-qa.mjs")));
  const qaFile = await readBytes(options.qa), summaryFile = await readBytes(options.summary);
  const qa = evaluator.validateGolden(JSON.parse(qaFile.text));
  const summary = JSON.parse(summaryFile.text);
  assert(qa.items.length === ROW_COUNT && qa.evaluation_profile === "faq_source_observation", "Expected the original FAQ 200 dataset");
  assert(qa.ground_truth?.full_answer_key === "NOT_PROVIDED", "The answer-key policy changed; review this builder before use");
  if (!options.records) {
    for (const basename of ["records.jsonl.gz", "records.jsonl", "input-records.jsonl.gz", "input-records.jsonl"]) {
      const candidate = path.join(options.repo, REPORT_DIR, basename);
      if (await exists(candidate)) { options.records = candidate; break; }
    }
  }
  assert(options.records, "WAITING_FOR_ACTUAL_RESULTS: no completed native records file");
  const recordFile = await readBytes(options.records);
  const lines = recordFile.text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  const inputs = lines.filter((line) => /^WFAQ-\d{3}$/.test(line.id ?? ""));
  assert(inputs.length === ROW_COUNT && new Set(inputs.map((row) => row.id)).size === ROW_COUNT, "All 200 distinct actual FAQ records are required");
  const byId = new Map(inputs.map((row) => [row.id, row]));
  const records = qa.items.map((item) => {
    const input = byId.get(item.id);
    assert(input, "Missing actual record: " + item.id);
    same(input.question, item.question, item.id + " original question");
    same(input.question_sha256, item.provenance.question_sha256, item.id + " question SHA");
    const raw = input.raw ?? input;
    assert(raw.transport === "native_connector", "Actual native transport evidence is required: " + item.id);
    assert(typeof raw.search?.call_id === "string" && raw.search.result !== undefined, "An actual native search attempt is required: " + item.id);
    assert(!["NOT_RUN", "BLOCKED_PRECHECK"].includes(raw.status), "The final 200-question run is not complete: " + item.id);
    const record = evaluator.evaluateRecord(item, raw, { evaluation_profile: qa.evaluation_profile });
    if (input.evaluation_profile) {
      for (const key of ["status", "search_success", "search_result_count", "query_integrity", "candidates", "faq_observation", "fetch_errors", "answer_correctness", "human_review"]) same(input[key], record[key], item.id + "." + key);
    }
    return record;
  });
  same([...byId.keys()].sort(), qa.items.map((item) => item.id).sort(), "dataset ID set");
  const recomputed = evaluator.summarize(records, {
    evaluation_profile: qa.evaluation_profile, expected_ids: qa.items.map((item) => item.id), total_golden_items: qa.items.length,
    start: lines.find((line) => line.kind === "status" && line.phase === "start"),
    end: lines.find((line) => line.kind === "status" && line.phase === "end"),
  });
  for (const key of ["evaluation_profile", "evaluator_version", "selected_items", "total_golden_items", "all_200_items_accounted_for", "all_dataset_items_accounted_for", "full_200_run", "selected_collection_complete", "full_collection_complete", "statuses", "search_execution", "nonempty_search", "faq_observation", "answer_correctness"]) same(summary[key], recomputed[key], "summary." + key);
  assert(["native_connector", "native_records_import"].includes(summary.transport), "The supplied summary is not a native production-record evaluation");
  assert(summary.answer_correctness === "NOT_EVALUATED", "Correctness must remain NOT_EVALUATED");
  assert(summary.human_review === "PENDING" && records.every((record) => record.human_review === "PENDING"), "AI evidence notes must not mark human review complete");
  let csvFile = null;
  if (await exists(options.csv)) {
    csvFile = await readBytes(options.csv);
    same(csvFile.text, evaluator.recordsCsv(records), "results.csv");
  }
  const notes = new Map();
  let notesFile = null;
  if (options.reviewNotes) {
    notesFile = await readBytes(options.reviewNotes);
    const parsed = JSON.parse(notesFile.text);
    assert(Array.isArray(parsed), "Review notes must be an array of {id, status, note}");
    for (const note of parsed) {
      assert(byId.has(note.id) && !notes.has(note.id), "Invalid/duplicate review-note ID");
      assert(REVIEW_STATES.includes(note.status) && typeof note.note === "string", "Invalid review note; do not supply correctness scores");
      notes.set(note.id, note);
    }
  }
  const inputsAudit = [["questions", options.qa, qaFile], ["summary", options.summary, summaryFile], ["records", options.records, recordFile], ...(csvFile ? [["csv", options.csv, csvFile]] : []), ...(notesFile ? [["ai_review_notes", options.reviewNotes, notesFile]] : [])].map(([kind, filename, file]) => ({ kind, path: path.relative(options.repo, filename), bytes: file.bytes.length, sha256: sha256(file.bytes) }));
  return { qa, summary, records, notes, evaluator, inputsAudit, csvReconciled: Boolean(csvFile) };
}

function candidateSource(candidate) {
  const entries = candidate?.structured_sources ?? [];
  return entries.find((entry) => entry.origin === "fetch" && entry.source?.source_path)?.source
    ?? entries.find((entry) => entry.source?.source_path)?.source ?? null;
}

/** Match the manual card frame, then slice only its declared Unicode body. */
export function extractManualBody(payload) {
  const metadata = payload?.metadata, source = metadata?.sources?.[0];
  const location = source?.location, excerpt = metadata?.excerpt;
  assert(source && location && excerpt && typeof payload.text === "string", "Manual fetch body frame is missing");
  assert(Number.isInteger(excerpt.returned_chars) && excerpt.returned_chars >= 0 && excerpt.returned_chars <= 8000, "Manual fetch returned_chars is invalid");
  assert(typeof excerpt.truncated === "boolean" && Array.isArray(metadata.warnings) && metadata.warnings.every((warning) => typeof warning === "string"), "Manual fetch footer metadata is invalid");
  const prefix = [
    "문서: " + source.document_title,
    "내부 원문명: " + source.original_name,
    "위치: 파싱 Markdown " + location.start_line + "–" + location.end_line + "행 / " + location.heading_path,
    "연도 표기: " + (source.source_year ?? "미확인") + " (" + source.source_year_basis + ", 적용연도 확인값 아님)",
    "출처: " + source.url,
  ].join("\n") + "\n\n";
  assert(payload.text.startsWith(prefix), "Manual fetch preface changed; review excerpt extraction");
  const remaining = Array.from(payload.text.slice(prefix.length));
  assert(remaining.length >= excerpt.returned_chars, "Manual fetch declared body is longer than its returned text");
  const body = remaining.slice(0, excerpt.returned_chars).join("");
  const continuation = excerpt.truncated ? ["", "이 구간의 본문이 더 있습니다. get_manual_section에 같은 section_id와 next_offset=" + excerpt.next_offset + "을 전달해 이어 읽으세요."] : [];
  const suffix = [...continuation, "", ...metadata.warnings].map((line) => "\n" + line).join("");
  assert(remaining.slice(excerpt.returned_chars).join("") === suffix, "Manual fetch footer changed; review excerpt extraction");
  return body;
}

function manualExcerpt(record, candidate, evaluator) {
  if (!candidate) return "미조회";
  const detail = record.raw.fetched.find((entry) => entry.id === candidate.id);
  const parsed = evaluator.unwrapToolResult(detail?.result ?? detail?.response ?? detail);
  if (!parsed.ok) return "상세 수신 실패";
  let text = extractManualBody(parsed.data);
  if (!text.trim()) return "수신 본문은 빈 문자열입니다.";
  text = text.replace(/<\/?(?:table|thead|tbody|tfoot|tr|td|th|span|p|br|div|strong|em|sup|sub|ul|ol|li|h[1-6])\b[^>]*>/gi, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/[\t\r\n ]+/g, " ").trim();
  const chars = Array.from(text);
  return chars.slice(0, EXCERPT_LIMIT).join("") + (chars.length > EXCERPT_LIMIT ? " …" : "");
}

function sourceLocation(source) {
  if (!source) return "대표 매뉴얼 출처 미확보";
  const location = source.location ?? {};
  const marker = source.original_name_basis === "explicit_original_file_marker" ? "명시 원본파일 표제" : source.original_name_basis === "mixed_original_files" ? "여러 원본파일 혼합" : "원천 메타데이터";
  return [source.original_name ?? "내부 원문명 미기록", "문서: " + (source.document_title ?? "미기록"),
    (location.basis === "parsed_markdown_lines" ? "Markdown " : "위치 ") + (location.start_line ?? "?") + "–" + (location.end_line ?? "?") + "행 / PDF 쪽 미확인",
    "원문명 근거: " + marker + (source.original_name_line != null ? " · " + source.original_name_line + "행" : ""),
    source.content_sha256 ? "본문 SHA-256: " + source.content_sha256 : "본문 해시 미기록"].join("\n");
}

function sourceYears(source) {
  if (!source) return "대표 매뉴얼 연도 미확보";
  const origin = { original_name: "내부 원문명", document_name: "합본 파일명", unknown: "미확인" }[source.source_year_origin] ?? source.source_year_origin ?? "미기록";
  return ["합본 파일명 연도: " + (source.document_year ?? "미확인"),
    "원천 표기 연도: " + (source.source_year ?? "미확인") + " / " + origin,
    "추론 근거: " + (source.source_year_basis ?? "미기록"),
    "적용연도: " + (source.applicable_year == null ? "미확인" : String(source.applicable_year) + " (명시 필드값, 별도 확인 필요)")].join("\n");
}

function extentLabel(record, candidate) {
  if (!record.faq_observation.manual_sections_fetched) return "미조회";
  const partial = record.faq_observation.manual_section_body_partial;
  const ext = candidate?.body_extent;
  const lines = [partial ? "부분 응답 포함" : "부분 응답 관찰 없음"];
  if (ext) lines.push("대표: offset " + (ext.offset ?? "미기록") + " · 수신 " + (ext.returned_chars ?? "?") + "/" + (ext.total_chars ?? "?") + "자",
    "next_offset: " + (ext.next_offset ?? "없음") + " · truncated: " + (ext.truncated == null ? "미기록" : ext.truncated));
  return lines.join("\n");
}

function observedUrls(record, representative) {
  const candidates = representative ? [representative, ...record.candidates.filter((candidate) => candidate.id !== representative.id)] : record.candidates;
  const seen = new Set(), urls = [];
  for (const candidate of candidates) for (const url of candidate.fetched_source_urls ?? []) {
    if (!seen.has(url)) { seen.add(url); urls.push({ rank: candidate.rank, url }); }
  }
  const readableUrl = (url) => { try { return decodeURI(url); } catch { return url; } };
  return urls.length ? urls.slice(0, 3).map((entry) => entry.rank + "위: " + readableUrl(entry.url)).join("\n") + (urls.length > 3 ? "\n추가 " + (urls.length - 3) + "개는 원시 기록 참조" : "") : "정상 상세의 출처 URL 미확보";
}

export function searchRetryObservation(record) {
  const attempts = Array.isArray(record.raw?.attempts) ? record.raw.attempts : [];
  if (attempts.length <= 1) return null;
  const first = attempts[0];
  let firstObservation = null;
  if (first.outcome === "NATIVE_RESULT_NOT_RECOVERED") firstObservation = "첫 기록: 응답 미회수 · 실제 전송 미확인";
  else if (first.outcome === "NATIVE_EXCEPTION") firstObservation = "첫 기록: native 호출 예외" + (first.error?.code != null ? " [" + first.error.code + "]" : "");
  else if (first.outcome === "TOOL_ERROR" || first.error?.code != null) firstObservation = "첫 기록 오류 코드: " + (first.error?.code ?? "미기록");
  else if (first.outcome === "SUCCESS") firstObservation = "첫 기록: 정상 응답";
  return ["검색 재시도 이력: 기록된 시도 " + attempts.length + "회", firstObservation,
    "최초 응답·예외 이력은 원시 기록에 보존", "미회수 기록은 실제 전송 확인이 아님"].filter(Boolean).join("\n");
}

export function reviewModel(input) {
  return input.records.map((record) => {
    const observation = record.faq_observation;
    const manualFetched = record.candidates.filter((candidate) => candidate.type === "manual_section" && candidate.fetched);
    const representative = manualFetched.find((candidate) => candidate.body_present) ?? manualFetched[0] ?? null;
    const source = candidateSource(representative);
    const note = input.notes.get(record.id);
    const candidateText = record.candidates.length ? record.candidates.map((candidate) => `${candidate.rank}위 [${TYPE_LABELS[candidate.type] ?? candidate.type}] ${candidate.title ?? "제목 미기록"}\n${candidate.admissible_source ? candidate.fetched ? "상세 수신" : candidate.fetch_attempted ? "상세 오류" : "상세 미조회" : "상세 수집 대상 제외"}`).join("\n") : record.search_success ? "반환 후보 없음" : "검색 응답 미확보";
    const sourceRef = record.source_reference ?? {};
    const values = [
      record.id, record.question, [record.category, record.evaluation_type].filter(Boolean).join("\n"), record.status,
      record.search_result_count ?? "미확인", candidateText,
      observation.manual_section_at[5] == null ? "검색 미확인" : observation.manual_section_at[5] ? "관찰" : "미관찰",
      manualFetched.length ? observation.manual_section_body_present ? "있음" : "없음" : "미조회",
      representative ? `${representative.rank}위 · ${representative.id}\n상위 5개 중 매뉴얼 상세 수신 ${manualFetched.length}개` : "정상 매뉴얼 상세 없음",
      manualExcerpt(record, representative, input.evaluator), extentLabel(record, representative), sourceLocation(source), sourceYears(source),
      observedUrls(record, representative), record.query_integrity.status,
      [...observation.review_required_reasons.map((reason) => REASONS[reason] ?? reason), searchRetryObservation(record)].filter(Boolean).join("\n"),
      [record.evaluation_criteria, record.major_error_type ? "주의할 오답: " + record.major_error_type : null].filter(Boolean).join("\n"),
      [sourceRef.title ?? "제목 미기록", "작성자 확인 수준: " + (sourceRef.confirmation_level ?? "미기록"), "현행 기준 재확인: " + (sourceRef.current_rules_recheck_required ?? "미기록"), sourceRef.url ?? "URL 미기록"].join("\n"),
      note?.status ?? "미검수", note?.note ?? "",
      observation.manual_section_body_partial ? 1 : 0,
      Array.isArray(record.raw?.attempts) && record.raw.attempts.length > 1 ? 1 : 0,
    ].map((value) => typeof value === "number" ? value : textCell(value));
    return { id: record.id, values, representativeId: representative?.id ?? null, representativeRank: representative?.rank ?? null };
  });
}

function header(range) { range.format.fill = COLORS.header; range.format.font = { name: FONT, size: 10, bold: true, color: COLORS.paper }; range.format.wrapText = true; range.format.verticalAlignment = "center"; }
function writeMerged(sheet, address, value, bold = false) { const range = sheet.getRange(address); range.merge(); sheet.getRange(address.split(":")[0]).values = [[textCell(value)]]; range.format.wrapText = true; range.format.font = { name: FONT, size: 10, bold, color: COLORS.ink }; }
function formula(sheet, address, expression) { sheet.getRange(address).formulas = [[expression]]; sheet.getRange(address).setNumberFormat("#,##0"); }
function estimatedLines(value, width) { return String(value ?? "").split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).reduce((sum, char) => sum + (/[^\u0000-\u007F]/.test(char) ? 13.4 : 7.4), 0) / (width - 16))), 0); }

async function assertAuthoringEnvironment() {
  const expectedNode = process.env.CODEX_PRIMARY_RUNTIME_NODE;
  assert(expectedNode && await fs.realpath(process.execPath) === await fs.realpath(expectedNode), "Use CODEX_PRIMARY_RUNTIME_NODE");
  const directory = path.dirname(fileURLToPath(import.meta.url));
  assert(directory.startsWith(path.resolve(os.tmpdir()) + path.sep), "Execute the builder copy in a conversation-specific OS tmp directory");
  same(await fs.readlink(path.join(directory, "node_modules")), process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "tmp node_modules runtime symlink");
}

async function authorWorkbook(options, input, model) {
  await assertAuthoringEnvironment();
  const { Workbook, SpreadsheetFile, FileBlob } = await import("@oai/artifact-tool");
  const workbook = Workbook.create();
  const summary = workbook.worksheets.add(SHEETS.summary), detail = workbook.worksheets.add(SHEETS.detail);
  for (const sheet of [summary, detail]) { sheet.showGridLines = false; sheet.tabColor = COLORS.header; }
  detail.getRange(`A1:V${LAST_ROW}`).format.font = { name: FONT, size: 10, color: COLORS.ink };
  detail.getRange(`A1:V${LAST_ROW}`).format.verticalAlignment = "top";
  for (let index = 0; index < WIDTHS.length; index++) detail.getRange(`${column(index)}1:${column(index)}${LAST_ROW}`).format.columnWidthPx = WIDTHS[index];
  writeMerged(detail, "A2:H2", "FAQ 200 — 문항별 운영 관찰·검수", true);
  detail.getRange("A2:H2").format.font.size = 16;
  detail.getRange("A2:T2").format.borders = { bottom: { style: "thin", color: COLORS.header } };
  writeMerged(detail, "A3:H3", "원순위 1~5를 유지합니다. 매뉴얼·본문·출처의 존재는 의미 적합성이나 정답 판정이 아닙니다.");
  writeMerged(detail, "A4:H4", "S·T열은 검토 메모 관리용입니다. 입력된 AI 근거 검토는 정답 채점·사람 검수 완료가 아니며, 전 200문항 human_review=PENDING입니다.");
  writeMerged(detail, "I3:T3", "대표 매뉴얼은 원순위 상위 5개 중 정상 수신된 첫 매뉴얼 본문입니다. 발췌는 수신 본문 앞 240자이며 HTML 태그·공백만 읽기 쉽게 정리했습니다.");
  writeMerged(detail, "I4:T4", "부분 응답은 상위 5개의 모든 매뉴얼 상세를 관찰합니다. URL의 %인코딩은 한글로 표시합니다. 적용연도·PDF 물리 쪽·질문 원출처 본문은 별도 확인이 필요합니다.");
  writeMerged(detail, "U3:V4", "집계용 원자료 열: 1=관찰, 0=미관찰. 설명문과 별도로 집계하며 질문 행과 함께 정렬됩니다.");
  detail.getRange("A6:V6").values = [HEADERS];
  detail.getRange(`A${FIRST_ROW}:V${LAST_ROW}`).values = model.map((row) => row.values);
  const table = detail.tables.add(`A6:V${LAST_ROW}`, true, "FaqReviewTable");
  table.showFilterButton = true;
  header(detail.getRange("A6:V6"));
  detail.getRange("A6:V6").format.rowHeightPx = 42;
  detail.getRange(`A${FIRST_ROW}:V${LAST_ROW}`).format.wrapText = true;
  detail.getRange(`E${FIRST_ROW}:E${LAST_ROW}`).setNumberFormat("#,##0");
  for (const letter of ["A", "D", "E", "G", "H", "O", "S"]) detail.getRange(`${letter}${FIRST_ROW}:${letter}${LAST_ROW}`).format.horizontalAlignment = letter === "E" ? "right" : "left";
  detail.getRange(`S${FIRST_ROW}:T${LAST_ROW}`).format.fill = COLORS.editable;
  detail.getRange(`U${FIRST_ROW}:V${LAST_ROW}`).setNumberFormat("0");
  detail.getRange(`U${FIRST_ROW}:V${LAST_ROW}`).format.fill = "#F4F6F8";
  detail.getRange(`U${FIRST_ROW}:V${LAST_ROW}`).format.font.color = COLORS.muted;
  detail.getRange(`S${FIRST_ROW}:S${LAST_ROW}`).dataValidation = { rule: { type: "list", values: REVIEW_STATES } };
  detail.getRange(`D${FIRST_ROW}:D${LAST_ROW}`).conditionalFormats.add("containsText", { text: "ERROR", format: { fill: COLORS.red, font: { color: "#922323", bold: true } } });
  detail.getRange(`D${FIRST_ROW}:D${LAST_ROW}`).conditionalFormats.add("containsText", { text: "PARTIAL", format: { fill: COLORS.amber, font: { color: "#735013" } } });
  detail.getRange(`K${FIRST_ROW}:K${LAST_ROW}`).conditionalFormats.add("containsText", { text: "부분 응답 포함", format: { fill: COLORS.amber, font: { color: "#735013" } } });
  detail.getRange(`O${FIRST_ROW}:O${LAST_ROW}`).conditionalFormats.add("containsText", { text: "MISMATCH", format: { fill: COLORS.red, font: { color: "#922323", bold: true } } });
  const rowLayoutChecks = [];
  for (let index = 0; index < model.length; index++) {
    const lines = Math.max(...model[index].values.map((value, col) => estimatedLines(value, WIDTHS[col])));
    if (lines * 17 + 20 > 530) rowLayoutChecks.push({ id: model[index].id, estimated_lines: lines, capped_height_px: 530 });
    detail.getRange(`A${FIRST_ROW + index}:V${FIRST_ROW + index}`).format.rowHeightPx = Math.min(530, Math.max(118, lines * 17 + 20));
  }
  detail.getRange("A1:T1").format.rowHeightPx = 10;
  detail.getRange("A2:T2").format.rowHeightPx = 32;
  detail.getRange("A3:T4").format.rowHeightPx = 30;
  detail.getRange("A5:T5").format.rowHeightPx = 10;
  detail.freezePanes.freezeRows(6); detail.freezePanes.freezeColumns(1);

  summary.getRange("A1:H42").format.font = { name: FONT, size: 10, color: COLORS.ink };
  summary.getRange("A1:H42").format.verticalAlignment = "center";
  for (const [letter, width] of Object.entries({ A: 270, B: 76, C: 76, D: 305, E: 18, F: 142, G: 72, H: 245 })) summary.getRange(letter + "1:" + letter + "42").format.columnWidthPx = width;
  writeMerged(summary, "A2:H2", "FAQ 200 — 운영 검색·근거 검토", true);
  summary.getRange("A2:H2").format.font.size = 16;
  summary.getRange("A2:H2").format.borders = { bottom: { style: "thin", color: COLORS.header } };
  writeMerged(summary, "A3:H3", "정답키 미제공 · 최종 답변 정답률 미평가 · 의미 적합성은 별도 검수", true);
  summary.getRange("A3:H3").format.font.color = "#735013";
  const s = input.summary, start = s.consistency?.start ?? {}, end = s.consistency?.end ?? {};
  const pair = (first, last) => first && first === last ? first + " (시작=종료)" : (first ?? "미기록") + " → " + (last ?? "미기록");
  for (const [row, label, value] of [
    [5, "데이터셋 · 실제 기록", input.qa.dataset_id + " / " + input.records.length + "문항"],
    [6, "검사 시각 (UTC)", (s.started_at ?? "미기록") + " → " + (s.completed_at ?? "미기록")],
    [7, "서버 버전 · 실행 경로", pair(start.server_version, end.server_version) + " / " + s.transport],
    [8, "공개본", pair(start.release_bundle_id, end.release_bundle_id)],
    [9, "매뉴얼 revision", pair(start.manual_revision, end.manual_revision)],
    [10, "검사 일관성 · 실행 ID", (s.consistency?.status ?? "UNKNOWN") + " / " + (s.run_id ?? "미기록")],
  ]) { summary.getRange("A" + row).values = [[label]]; summary.getRange("A" + row).format.font.bold = true; writeMerged(summary, `B${row}:H${row}`, value); }
  summary.getRange("A12:D12").values = [["관찰 문항 수", "관찰 수", "분모", "해석 · 분모"]]; header(summary.getRange("A12:D12"));
  const ref = (letter) => `'${SHEETS.detail}'!$${letter}$${FIRST_ROW}:$${letter}$${LAST_ROW}`;
  const count = (letter, value) => `COUNTIF(${ref(letter)},"${value}")`;
  const successFormula = ["RETRIEVED", "FETCH_PARTIAL", "SEARCH_ONLY", "NO_RESULTS"].map((status) => count("D", status)).join("+");
  const fetchedManualFormula = count("H", "있음") + "+" + count("H", "없음");
  const metrics = [
    { row: 13, label: "원문 ID·질문 기록", expression: `COUNTA(${ref("A")})`, expected: 200, denominator: 200, note: "원 질문 200개와 ID·SHA 대조" },
    { row: 14, label: "실제 검색 입력의 원문 일치", expression: count("O", "VERIFIED"), expected: s.faq_observation.question_preservation.count, denominator: 200, note: "검색에 전송된 원문·공백·줄바꿈" },
    { row: 15, label: "검색 정상 응답 (최종)", expression: successFormula, expected: s.search_execution.count, denominator: 200, note: "최종 응답 기준; 최초 오류·재시도는 P열" },
    { row: 16, label: "정상 검색에서 결과 1개 이상", expression: count("E", ">0"), expected: s.nonempty_search.count, denominator: s.search_execution.count, note: "분모: 정상 검색 문항" },
    { row: 17, label: "원순위 상위 5개에 매뉴얼 절", expression: count("G", "관찰"), expected: s.faq_observation.manual_section_at[5].count, denominator: s.search_execution.count, note: "제목·자료형 관찰; 의미 판정 아님" },
    { row: 18, label: "매뉴얼 상세 수신 문항", expression: fetchedManualFormula, expected: input.records.filter((record) => record.faq_observation.manual_sections_fetched > 0).length, denominator: 200, note: "첫 상세 응답을 정상 수신한 문항" },
    { row: 19, label: "수신 매뉴얼 본문 존재", expression: count("H", "있음"), expected: s.faq_observation.manual_section_body_presence.count, denominator: s.faq_observation.manual_section_body_presence.denominator, note: "분모: 매뉴얼 상세를 받은 문항" },
    { row: 20, label: "부분 매뉴얼 본문 응답 포함", expression: `COUNTIF(${ref("U")},1)`, expected: s.faq_observation.manual_section_body_partial.count, denominator: s.faq_observation.manual_section_body_partial.denominator, note: "truncated=true 또는 offset>0" },
    { row: 21, label: "검토 메모 없음", expression: `COUNTBLANK(${ref("T")})`, expected: model.filter((row) => row.values[19] === "").length, denominator: 200, note: "메모 유무만 집계; 사람 검수는 전부 PENDING" },
    { row: 22, label: "검색 재시도 기록 문항", expression: `COUNTIF(${ref("V")},1)`, expected: input.records.filter((record) => searchRetryObservation(record) !== null).length, denominator: 200, note: "기록된 시도 >1; 미회수는 실제 전송 미확인" },
  ];
  for (const metric of metrics) { summary.getRange(`A${metric.row}:D${metric.row}`).values = [[metric.label, null, metric.denominator, metric.note]]; formula(summary, "B" + metric.row, "=" + metric.expression); }
  summary.getRange("A13:D22").format.wrapText = true;
  summary.getRange("B13:C22").setNumberFormat("#,##0");
  summary.getRange("B13:C22").format.horizontalAlignment = "right";
  summary.getRange("F12:H12").values = [["검색 상태 (최종)", "문항 수", "상태 설명"]]; header(summary.getRange("F12:H12"));
  const statusMetrics = Object.entries(STATUS_LABELS).map(([status, label], index) => ({ row: 13 + index, status, label }));
  for (const metric of statusMetrics) { summary.getRange(`F${metric.row}:H${metric.row}`).values = [[metric.status, null, metric.label]]; formula(summary, "G" + metric.row, "=" + count("D", metric.status)); }
  summary.getRange("F13:H19").format.wrapText = true;
  summary.getRange("G13:G19").format.horizontalAlignment = "right";
  writeMerged(summary, "F21:H22", "정답률: 미평가\n검증된 정답키가 제공되지 않았습니다.", true);
  summary.getRange("F21:H22").format.fill = COLORS.amber;
  const instructions = [
    [24, "검토 방법 · AI 메모", "검색 상태·부분 응답을 필터링하고 원질문과 후보의 업무 대상을 비교합니다. S·T열의 입력 메모는 AI 근거 검토이며 정답 채점·사람 검수 완료가 아닙니다. 전 200문항 human_review=PENDING을 유지합니다."],
    [26, "매뉴얼 읽기 범위", "발췌는 정상 수신한 첫 매뉴얼 본문의 앞 240자입니다. 긴 절의 표·각주가 후반에 있으면 이 파일만으로 확인할 수 없습니다. next_offset으로 추가 본문을 확인해야 합니다."],
    [28, "연도·출처 해석", "합본·내부 원문명에서 읽은 연도는 filename_inferred입니다. 적용연도 확인값이 아니며 Markdown 줄 번호도 PDF 물리 쪽수가 아닙니다. 저장소 파싱본 URL과 공식 발행기관 URL은 구분합니다."],
    [30, "질문 원출처와 평가항목", "원 질문 파일의 평가항목·오답 유형·확인 수준을 그대로 보존했습니다. 원출처의 목록 URL·제목 일치는 FAQ 본문 전체 확보나 현행 기준 검증을 뜻하지 않습니다."],
    [32, "집계 해석", "관찰 수와 분모는 실제 기록에서 재계산하고 summary.json과 대조했습니다. 후보 존재·본문 존재·URL 존재를 정답률로 환산하지 않습니다. 정답·지원자격·금액·예외·적용 시점은 별도 검수 대상입니다."],
  ];
  for (const [row, label, body] of instructions) { summary.getRange("A" + row).values = [[label]]; summary.getRange("A" + row).format.font.bold = true; writeMerged(summary, `B${row}:H${row + 1}`, body); }
  writeMerged(summary, "A35:H36", "입력 파일: " + input.inputsAudit.map((entry) => entry.path).join(" | "));
  writeMerged(summary, "A37:H38", "기록 SHA-256: " + input.inputsAudit.find((entry) => entry.kind === "records").sha256 + "\n질문 원문 SHA-256: " + input.inputsAudit.find((entry) => entry.kind === "questions").sha256);
  writeMerged(summary, "A40:H41", "세부 원응답·모든 출처·수신 본문의 범위 정보는 함께 제공한 records 및 JSON/CSV에 보존되어 있습니다. 이 Excel은 검토용 요약이며 200개 상세 본문 전체를 복제하지 않습니다.");
  summary.getRange("A35:H41").format.font.color = COLORS.muted;
  summary.getRange("A1:H42").format.rowHeightPx = 27;
  summary.getRange("A1:H1").format.rowHeightPx = 10;
  summary.getRange("A2:H2").format.rowHeightPx = 35;
  summary.getRange("A3:H3").format.rowHeightPx = 30;
  summary.getRange("A12:H12").format.rowHeightPx = 32;
  summary.getRange("A13:H22").format.rowHeightPx = 43;
  summary.getRange("A24:H33").format.rowHeightPx = 27;
  summary.getRange("A35:H36").format.rowHeightPx = 29;
  summary.freezePanes.freezeRows(3);

  // Recalculate once after all values/formulas/styles are complete.
  await workbook.recalculate();
  const metricChecks = metrics.map((metric) => ({ label: metric.label, actual: summary.getRange("B" + metric.row).values[0][0], expected: metric.expected }));
  assert(metricChecks.every((check) => canonical(check.actual) === canonical(check.expected)), "Workbook metric mismatch: " + JSON.stringify(metricChecks.filter((check) => canonical(check.actual) !== canonical(check.expected))));
  for (const metric of statusMetrics) same(summary.getRange("G" + metric.row).values[0][0], s.statuses[metric.status] ?? 0, "Workbook status " + metric.status);
  same(detail.getRange(`A${FIRST_ROW}:B${LAST_ROW}`).values, input.qa.items.map((item) => [item.id, item.question]), "Workbook question preservation");
  const inspection = await workbook.inspect({ kind: "table", range: `${SHEETS.summary}!A12:H22`, include: "values,formulas", tableMaxRows: 12, tableMaxCols: 8, maxChars: 16000 });
  const formulaErrors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 30 } });
  const summaryValues = summary.getRange("A1:H42").values.flat();
  assert(!summaryValues.some((value) => typeof value === "string" && /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)/.test(value)), "Spreadsheet formula error");
  const previewDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "previews");
  await fs.mkdir(previewDir, { recursive: true });
  const previewSpecs = [
    [SHEETS.summary, "A1:H42", "summary.png"],
    [SHEETS.detail, "A1:H9", "detail-left.png"],
    [SHEETS.detail, "I6:N9", "detail-evidence.png"],
    [SHEETS.detail, "O6:T9", "detail-review.png"],
  ];
  const previews = [];
  for (const [sheetName, range, basename] of previewSpecs) {
    const rendered = await workbook.render({ sheetName, range, scale: 1.5, format: "png" });
    const filename = path.join(previewDir, basename);
    await fs.writeFile(filename, new Uint8Array(await rendered.arrayBuffer()));
    previews.push(filename);
  }
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(options.output);
  const roundTrip = await SpreadsheetFile.importXlsx(await FileBlob.load(options.output));
  const importedDetail = roundTrip.worksheets.getItem(SHEETS.detail);
  same(importedDetail.getRange(`A${FIRST_ROW}:B${LAST_ROW}`).values, input.qa.items.map((item) => [item.id, item.question]), "Exported XLSX question preservation");
  same(importedDetail.getRange(`D${FIRST_ROW}:E${LAST_ROW}`).values, model.map((row) => row.values.slice(3, 5)), "Exported XLSX statuses/counts");
  same(importedDetail.getRange(`U${FIRST_ROW}:V${LAST_ROW}`).values, model.map((row) => row.values.slice(20, 22)), "Exported XLSX structured observation flags");
  const importedSummary = roundTrip.worksheets.getItem(SHEETS.summary);
  for (const metric of metrics) same(importedSummary.getRange("B" + metric.row).values[0][0], metric.expected, "Exported XLSX metric " + metric.label);
  const outputBytes = await fs.readFile(options.output);
  const audit = {
    schema_version: "faq-review-workbook-1", status: "GENERATED_AWAITING_VISUAL_REVIEW", at: new Date().toISOString(),
    output: { path: path.relative(options.repo, options.output), bytes: outputBytes.length, sha256: sha256(outputBytes) },
    inputs: input.inputsAudit, builder_sha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
    runtime: { node: process.version, bundle: process.env.CODEX_PRIMARY_RUNTIME_BUNDLE_VERSION ?? null, authoring_library: "@oai/artifact-tool" },
    records: model.length, original_ids_questions_verified: 200, native_search_attempts_verified: 200,
    summary_reconciled: true, csv_reconciled: input.csvReconciled, exported_values_verified: true,
    correctness: "NOT_EVALUATED", answer_key: "NOT_PROVIDED", semantic_review: "NOT_AUTOMATICALLY_EVALUATED", human_review: "PENDING",
    review_notes_scope: "AI_EVIDENCE_REVIEW_NOT_HUMAN_REVIEW_COMPLETION_OR_ANSWER_SCORING",
    representative_policy: "FIRST_FETCHED_MANUAL_BODY_WITHIN_ORIGINAL_TOP_5", excerpt_max_code_points: EXCERPT_LIMIT,
    structured_count_columns: { U: "raw faq_observation.manual_section_body_partial ? 1 : 0", V: "raw.attempts.length > 1 ? 1 : 0" },
    metric_checks: metricChecks, row_height_caps: rowLayoutChecks,
    source_url_display: "decodeURI of recorded URL; reserved URL delimiters preserved; exact encoded strings remain in raw records",
    previews, inspections: { summary: inspection, formula_errors: formulaErrors },
  };
  const auditPath = path.join(path.dirname(options.output), "workbook-build-audit.json");
  await fs.writeFile(auditPath, JSON.stringify(audit, null, 2) + "\n");
  return { status: audit.status, output: options.output, audit: auditPath, previews, rows: model.length, sha256: audit.output.sha256 };
}

async function main(argv) {
  const options = optionsOf(argv);
  const input = await loadRealInputs(options);
  const model = reviewModel(input);
  if (!options.author) return { status: "REAL_INPUTS_VALIDATED_NO_WORKBOOK_CREATED", records: model.length, csv_reconciled: input.csvReconciled, inputs: input.inputsAudit };
  return authorWorkbook(options, input, model);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1; });
}
