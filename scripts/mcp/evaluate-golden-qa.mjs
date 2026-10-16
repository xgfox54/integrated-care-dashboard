// 독립 평가기: 검색 회수·근거 존재·컨텍스트 관찰과 최종 답변 정답률을 구분한다.
import { createHash } from "node:crypto";

export const EVALUATION_VERSION = "1.2.0";
export const ANSWER_STATUS = "NOT_EVALUATED";
export const FAQ_PROFILE = "faq_source_observation";
export const GOLDEN_PROFILE = "golden_retrieval";
export const questionSha256 = (question) => createHash("sha256").update(question, "utf8").digest("hex");
export const evaluationProfile = (value) => value?.evaluation_profile ?? (/^(?:WFAQ-\d{3}|MFAQ-[a-f0-9]{12}|FAQ129-\d+)$/.test(value?.id ?? "") ? FAQ_PROFILE : GOLDEN_PROFILE);
const K_VALUES = [1, 3, 5];
const admissibleTypes = new Set(["implementation", "document_program", "government_service", "document", "manual_section", "official_faq"]);
export const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]+/gu, "");
const strings = (value) => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** JSON-RPC 응답, MCP structuredContent, native content[text]를 같은 구조로 읽는다. */
export function unwrapToolResult(input) {
  if (!input) return { ok: false, error: { code: "MISSING_RESPONSE", message: "응답 없음" }, data: null };
  if (input.error && !input.structuredContent) return { ok: false, error: typeof input.error === "string" ? { message: input.error } : input.error, data: null };
  const outer = input.jsonrpc ? input.result : input;
  if (!outer) return { ok: false, error: input.error ?? { code: "INVALID_RPC_RESPONSE" }, data: null };
  let data = outer.structuredContent;
  if (data === undefined && Array.isArray(outer.content)) {
    const text = outer.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    try { data = JSON.parse(text); } catch { data = { text }; }
  }
  data ??= outer;
  if (outer.isError || data?.error) {
    const detail = data?.error && typeof data.error === "object" ? data.error : {};
    return { ok: false, data, error: { ...detail, code: detail.code ?? data?.error_code ?? "MCP_TOOL_ERROR", message: detail.message ?? (typeof data?.error === "string" ? data.error : data?.text) ?? "MCP 도구 오류", retry_after_seconds: data?.retry_after_seconds ?? data?.retry_after ?? detail.retry_after_seconds } };
  }
  return { ok: true, data, error: null };
}

export function validateGolden(qa) {
  if (!qa || !Array.isArray(qa.items) || qa.items.length < 1) throw new Error("테스트셋 items는 1개 이상이어야 합니다.");
  if (qa.count !== undefined && qa.count !== qa.items.length) throw new Error("골든셋 count와 실제 items 수가 다릅니다.");
  const ids = new Set();
  const profile = evaluationProfile(qa);
  if (![FAQ_PROFILE, GOLDEN_PROFILE].includes(profile)) throw new Error("알 수 없는 평가 프로필: " + profile);
  const maxItems = profile === FAQ_PROFILE ? 10000 : 200;
  if (qa.items.length > maxItems) throw new Error(`테스트셋 items는 ${maxItems}개 이하여야 합니다.`);
  for (const item of qa.items) {
    const idPattern = profile === FAQ_PROFILE ? /^(?:WFAQ-\d{3}|MFAQ-[a-f0-9]{12}|FAQ129-\d+)$/ : /^Q\d{3}$/;
    if (!idPattern.test(item.id ?? "") || ids.has(item.id)) throw new Error("문항 ID가 잘못되었거나 중복됩니다: " + item.id);
    if (typeof item.question !== "string" || !item.question.trim()) throw new Error("질문이 없습니다: " + item.id);
    if (profile === FAQ_PROFILE && item.provenance?.question_sha256 !== questionSha256(item.question)) throw new Error("FAQ 질문 SHA가 원문과 다릅니다: " + item.id);
    ids.add(item.id);
  }
  return qa;
}

// 골든셋의 업무영역만 정규화한다. 제품 Query Refiner를 가져오지 않아 평가의 순환 의존을 피한다.
export function expectedProgramNames(item) {
  const aliases = {
    생계지원: ["긴급복지생계지원", "긴급생계", "긴급지원생계", "긴급복지", "긴급복지지원"],
    활동지원: ["장애인활동지원", "장애인활동보조"],
    사회보장급여: ["사회보장급여공통업무", "사회보장급여"],
    신고포상금: ["위기가구신고포상금", "위기가구발굴신고포상금"],
    신설변경: ["사회보장제도신설변경", "사회보장제도신설", "사회보장제도변경"],
    보조금: ["사회복지보조금", "사회복지시설보조금"],
    시설: ["사회복지시설"],
  };
  if (item.expected_section === "식사지원" && /제주가치돌봄/.test(item.question + item.expected_document)) return ["제주가치돌봄"];
  return aliases[item.expected_section] ?? [item.expected_section].filter(Boolean);
}

function programNameMatches(item, label, names) {
  if (item.expected_section === "생계지원") {
    // 포괄적인 긴급복지 제도 카드는 후보지만, 의료·주거 등 다른 하위급여만 있는 제목은 제외한다.
    return (/긴급/.test(label) && /생계/.test(label)) || /긴급복지(?:지원)?(?:사업|제도)?$/.test(label);
  }
  return names.some((name) => name && label.includes(name));
}

export function candidateType(candidate) {
  const id = String(candidate?.id ?? "");
  if (/^manual:/.test(id)) return "manual_section";
  if (/^faq129:/.test(id)) return "official_faq";
  if (/^service:/.test(id)) return "implementation";
  if (/^docprog:/.test(id)) return "document_program";
  if (/^(gov24_service:|gov24:|gov24-|publicservice:|public-service:)/.test(id)) return "government_service";
  if (/^(doc:|document:)/.test(id)) return "document";
  if (/^bl-/.test(id)) return "budget_line";
  if (/^news:/.test(id)) return "news_metadata";
  return candidate?.entity_type ?? "unknown";
}

export const isAdmissibleCandidate = (candidate) => admissibleTypes.has(candidateType(candidate));

function isOfficialUrl(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && (url.hostname === "gov.kr" || url.hostname.endsWith(".gov.kr") || url.hostname.endsWith(".go.kr")); } catch { return false; }
}

function evidenceOf(payload) {
  const found = [];
  function walk(value, inEvidence = false) {
    if (typeof value === "string") {
      if (inEvidence && /^https?:\/\//.test(value)) found.push(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => walk(item, inEvidence)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) walk(item, inEvidence || /^(sources?|evidence|source_url|sourceUrl|official_url|source_links)$/.test(key));
  }
  walk(payload);
  if (isOfficialUrl(payload?.url)) found.push(payload.url);
  // 문서 사업 fetch는 출처를 본문에만 싣는 이전 계약도 지원한다.
  for (const line of String(payload?.text ?? "").split(/\r?\n/).filter((value) => /^(출처|원문)\s*:/.test(value.trim()))) {
    found.push(...(line.match(/https?:\/\/[^\s<>"「」]+/g) ?? []));
  }
  return [...new Set(found)].filter((value) => /^https?:\/\/[^\s]+$/.test(value));
}

const isManualCard = (payload) => payload?.metadata?.entity_type === "manual_section" || /^manual:/.test(payload?.id ?? "");

/** 매뉴얼 카드의 메타데이터·이어읽기 안내를 제외하고 실제 수신 본문만 추출한다. */
export function extractManualFetchBody(payload) {
  const metadata = payload?.metadata, source = metadata?.sources?.[0];
  const location = source?.location, excerpt = metadata?.excerpt;
  const requireFrame = (condition, message) => { if (!condition) throw new Error(message); };
  requireFrame(source && location && excerpt && typeof payload?.text === "string", "Manual fetch body frame is missing");
  requireFrame([source.document_title, source.original_name, source.source_year_basis, source.url, location.heading_path].every((value) => typeof value === "string"), "Manual fetch preface metadata is invalid");
  requireFrame(Number.isInteger(location.start_line) && Number.isInteger(location.end_line) && location.start_line >= 1 && location.end_line >= location.start_line, "Manual fetch line location is invalid");
  requireFrame(Number.isInteger(excerpt.returned_chars) && excerpt.returned_chars >= 0 && excerpt.returned_chars <= 8000, "Manual fetch returned_chars is invalid");
  requireFrame(Number.isInteger(excerpt.offset) && Number.isInteger(excerpt.total_chars) && excerpt.offset >= 0 && excerpt.total_chars >= excerpt.offset + excerpt.returned_chars, "Manual fetch body extent is invalid");
  const more = excerpt.offset + excerpt.returned_chars < excerpt.total_chars;
  requireFrame(excerpt.truncated === more && excerpt.next_offset === (more ? excerpt.offset + excerpt.returned_chars : null), "Manual fetch continuation metadata is invalid");
  requireFrame(Array.isArray(metadata.warnings) && metadata.warnings.every((warning) => typeof warning === "string"), "Manual fetch footer metadata is invalid");
  const prefix = [
    "문서: " + source.document_title,
    "내부 원문명: " + source.original_name,
    "위치: 파싱 Markdown " + location.start_line + "–" + location.end_line + "행 / " + location.heading_path,
    "연도 표기: " + (source.source_year ?? "미확인") + " (" + source.source_year_basis + ", 적용연도 확인값 아님)",
    "출처: " + source.url,
  ].join("\n") + "\n\n";
  requireFrame(payload.text.startsWith(prefix), "Manual fetch preface does not match its source metadata");
  const remaining = Array.from(payload.text.slice(prefix.length));
  requireFrame(remaining.length >= excerpt.returned_chars, "Manual fetch declared body exceeds its returned text");
  const body = remaining.slice(0, excerpt.returned_chars).join("");
  const continuation = excerpt.truncated ? ["", "이 구간의 본문이 더 있습니다. get_manual_section에 같은 section_id와 next_offset=" + excerpt.next_offset + "을 전달해 이어 읽으세요."] : [];
  const suffix = [...continuation, "", ...metadata.warnings].map((line) => "\n" + line).join("");
  requireFrame(remaining.slice(excerpt.returned_chars).join("") === suffix, "Manual fetch footer does not match its metadata");
  return body;
}

/** 검색어·응답 생성일·출처 URL·매뉴얼 카드 표제의 연도는 본문 관찰에 넣지 않는다. */
function businessText(payload) {
  if (isManualCard(payload) && typeof payload?.text === "string") {
    try { return extractManualFetchBody(payload); } catch { return ""; }
  }
  if (typeof payload?.text === "string") return payload.text.split(/\r?\n/).filter((line) => !/^(출처|원문|생성시각|수집시각|원천\s*수정일|자료\s*수정일)\s*:/.test(line.trim())).map((line) => line.replace(/\(근거\s*:[^)]*\)/g, "")).join("\n");
  // 새로운 메타데이터 필드가 추가되어도 질문·추론 설명이 본문으로 섞이지 않도록 허용목록을 쓴다.
  const fields = new Set(["name", "title", "purpose", "overview", "content", "description", "target", "criteria", "benefit", "apply_method", "apply_deadline", "required_documents", "reception", "contact", "application_conditions", "selection_criteria", "application_method"]);
  const containers = new Set(["data", "program", "eligibility"]);
  function read(value, inBusinessField = false) {
    if (typeof value === "string" || typeof value === "number") return inBusinessField ? String(value) : "";
    if (Array.isArray(value)) return value.map((item) => read(item, inBusinessField)).join("\n");
    if (!value || typeof value !== "object") return "";
    return Object.entries(value).filter(([key]) => fields.has(key) || containers.has(key)).map(([key, item]) => read(item, fields.has(key))).join("\n");
  }
  return read(payload?.data ?? payload);
}

function observeYears(text) {
  const years = [
    ...text.matchAll(/(?<!\d)(20\d{2})(?=\s*년)/g),
    ...text.matchAll(/(?<!\d)(20\d{2})(?=\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}(?!\d))/g),
    ...text.matchAll(/(?:기준\s*연도|적용\s*연도|사업\s*연도|연도)\s*[:：]?\s*(20\d{2})(?!\d)/g),
  ].map((match) => match[1]);
  return [...new Set(years)].sort();
}

function observeNumbers(expected, text) {
  const normalized = text.replace(/[,\s]/g, "");
  return expected.map((value) => {
    const literal = String(value).replace(/[,\s]/g, "");
    const number = literal.match(/[+-]?\d+(?:\.\d+)?/)?.[0];
    const escaped = (number ?? literal).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { expected: value, observed: Boolean(escaped && new RegExp("(?<![\\d.])" + escaped + "(?![\\d.])").test(normalized)) };
  });
}

function sourceEntries(payload, origin) {
  const paths = [
    ["sources", payload?.sources], ["source", payload?.source],
    ["metadata.sources", payload?.metadata?.sources], ["metadata.source", payload?.metadata?.source],
    ["data.sources", payload?.data?.sources], ["evidence", payload?.evidence],
  ];
  return paths.flatMap(([path, value]) => value == null ? [] : Array.isArray(value) ? value.map((source, index) => ({ origin, path: `${path}[${index}]`, source })) : [{ origin, path, source: value }]);
}

function sourceFieldObservations(entries, pattern, includeNull = false) {
  const found = [];
  function walk(value, path, entry) {
    if (!value || typeof value !== "object") return;
    for (const [key, field] of Object.entries(value)) {
      const next = path ? path + "." + key : key;
      if (pattern.test(key) && (includeNull || (field !== null && field !== "" && !(Array.isArray(field) && !field.length)))) found.push({ origin: entry.origin, path: next, value: field });
      if (field && typeof field === "object") walk(field, next, entry);
    }
  }
  for (const entry of entries) walk(entry.source, entry.path, entry);
  return found;
}

function sourceUrls(entries) {
  const result = sourceFieldObservations(entries, /^(url|source_url|sourceUrl|official_url|canonical_url|download_url)$/).flatMap((entry) => strings(entry.value));
  for (const entry of entries) if (typeof entry.source === "string" && /^https?:\/\//.test(entry.source)) result.push(entry.source);
  return [...new Set(result.filter((value) => /^https?:\/\/[^\s]+$/.test(value)))];
}

function bodyObservation(payload) {
  const explicit = [
    ["body", payload?.body], ["content", payload?.content], ["section_text", payload?.section_text],
    ["data.body", payload?.data?.body], ["data.content", payload?.data?.content],
    ["metadata.body", payload?.metadata?.body], ["metadata.section_text", payload?.metadata?.section_text],
  ].find(([, value]) => typeof value === "string" && value.trim());
  if (explicit) return { field: explicit[0], text: explicit[1], basis: "EXPLICIT_BODY_FIELD" };
  if (isManualCard(payload)) {
    try { return { field: "text", text: extractManualFetchBody(payload), basis: "MANUAL_BODY_FROM_VERIFIED_CARD_FRAME" }; }
    catch (error) { return { field: "text", text: "", basis: "MANUAL_CARD_FRAME_UNVERIFIED", error: { code: "MANUAL_CARD_FRAME_UNVERIFIED", message: error.message } }; }
  }
  if (typeof payload?.text === "string") return { field: "text", text: businessText(payload), basis: "FETCH_TEXT_NOT_VERIFIED_AS_APPLICABLE_POLICY" };
  return { field: "structured_business_fields", text: businessText(payload), basis: "BUSINESS_FIELD_ALLOWLIST" };
}

function evaluateFaqRecord(item, raw) {
  let search = unwrapToolResult(raw?.search?.result ?? raw?.search);
  if (search.ok && !Array.isArray(search.data?.results)) search = { ...search, ok: false, error: { code: "INVALID_SEARCH_RESPONSE", message: "검색 응답에 results 배열이 없습니다." } };
  const hits = search.ok && Array.isArray(search.data?.results) ? search.data.results : [];
  const selected = hits.slice(0, 5);
  const fetchLinkErrors = [];
  const details = new Map();
  let fetchErrors = 0;
  for (const entry of raw?.fetched ?? []) {
    const rank = selected.findIndex((hit) => hit.id === entry.id) + 1;
    const parsed = unwrapToolResult(entry.result ?? entry.response ?? entry);
    const responseId = parsed.data?.id ?? parsed.data?.data?.id;
    const code = !rank ? "FETCH_OUTSIDE_TOP_5" : entry.rank !== undefined && entry.rank !== rank ? "FETCH_RANK_MISMATCH" : details.has(entry.id) ? "DUPLICATE_FETCH_ID" : parsed.ok && responseId === undefined ? "FETCH_ID_MISSING" : parsed.ok && responseId !== entry.id ? "FETCH_ID_MISMATCH" : null;
    if (code) { fetchLinkErrors.push({ code, id: entry.id, rank: entry.rank ?? null, response_id: responseId ?? null }); continue; }
    if (!parsed.ok) fetchErrors += 1;
    details.set(entry.id, { ...entry, parsed });
  }
  fetchErrors += fetchLinkErrors.length;
  const candidates = selected.map((hit, index) => {
    const type = candidateType(hit), admissible = admissibleTypes.has(type);
    const detail = details.get(hit.id);
    const fetched = Boolean(detail?.parsed.ok);
    const payload = fetched ? detail.parsed.data : null;
    const sources = admissible ? [...sourceEntries(hit, "search"), ...sourceEntries(payload, "fetch")] : [];
    const fetchedSources = sources.filter((entry) => entry.origin === "fetch");
    const urls = sourceUrls(sources);
    const fetchUrls = [...new Set([...sourceUrls(fetchedSources), ...(payload && admissible ? evidenceOf(payload) : [])])];
    const locations = sourceFieldObservations(sources, /^(file|filename|source_file|source_path|document_id|section_id|section_path|section_title|heading|heading_path|headings|page|page_start|page_end|start_page|end_page|line|line_start|line_end|start_line|end_line|paragraph|block|block_index|source_locator|locator|anchor|section_index)$/);
    const sourceYears = sourceFieldObservations(sources, /^(year|years|reference_year|reference_years|effective_year|effective_years|applicable_year|application_year|source_year|document_year|year_evidence|year_status|effective_year_basis|document_year_basis|source_year_basis|source_year_origin)$/, true);
    const sourceDates = sourceFieldObservations(sources, /^(published_at|publication_date|written_at|modified_at|source_modified_at|updated_at|collected_at|fetched_at)$/);
    const titles = sourceFieldObservations(sources, /^(title|document_title|source_title|filename|source_file)$/).flatMap((entry) => strings(entry.value));
    const body = payload && admissible ? bodyObservation(payload) : null;
    const bodyExtent = payload && admissible ? Object.fromEntries(["offset", "returned_chars", "total_chars", "next_offset", "truncated", "image_content_available"].map((key) => [key, payload[key] ?? payload.metadata?.[key] ?? payload.metadata?.excerpt?.[key] ?? null])) : null;
    return {
      rank: index + 1, id: hit.id, title: hit.title, type, admissible_source: admissible,
      fetched, fetch_attempted: Boolean(detail),
      body_present: body && !body.error ? Boolean(body.text.trim()) : null,
      body_field: body?.field ?? null,
      body_observation_error: body?.error ?? null,
      body_extent: bodyExtent,
      structured_sources: sources, source_locations: locations,
      source_urls: [...new Set([...urls, ...fetchUrls])], fetched_source_urls: fetchUrls,
      reference_source_url_observed: item.source?.url ? [...urls, ...fetchUrls].includes(item.source.url) : null,
      reference_source_title_observed: item.source?.title ? titles.includes(item.source.title) : null,
      year_provenance: {
        body_year_mentions: body ? observeYears(body.text) : [], body_field: body?.field ?? null,
        body_basis: body?.basis ?? null, source_year_fields: sourceYears, source_date_fields: sourceDates,
        applicability: "NOT_EVALUATED",
      },
    };
  });
  const admitted = candidates.filter((hit) => hit.admissible_source);
  const fetchedCandidates = admitted.filter((hit) => hit.fetched);
  const manual = candidates.filter((hit) => hit.type === "manual_section");
  const manualFetched = manual.filter((hit) => hit.fetched);
  const sourceUrlsObserved = [...new Set(admitted.flatMap((hit) => hit.source_urls))];
  const fetchedUrls = [...new Set(fetchedCandidates.flatMap((hit) => hit.fetched_source_urls))];
  const blocked = raw?.status === "BLOCKED_PRECHECK" || [401, 403].includes(search.error?.http_status);
  const status = raw?.status === "NOT_RUN" ? "NOT_RUN" : blocked ? "BLOCKED_PRECHECK" : !search.ok ? "SEARCH_ERROR" : fetchErrors ? "FETCH_PARTIAL" : !hits.length ? "NO_RESULTS" : !fetchedCandidates.length ? "SEARCH_ONLY" : "RETRIEVED";
  const observedAt = (predicate) => Object.fromEntries(K_VALUES.map((k) => [k, search.ok ? candidates.slice(0, k).some(predicate) : null]));
  const missingDetails = admitted.filter((hit) => !hit.fetched).map((hit) => hit.id);
  const reviewReasons = [item.reference_answer ? "REFERENCE_ANSWER_SEMANTIC_REVIEW_PENDING" : "ANSWER_KEY_NOT_PROVIDED", "SEMANTIC_REVIEW_PENDING"];
  if (item.reference_review?.risks?.length) reviewReasons.push("REFERENCE_ANSWER_QUARANTINED", ...item.reference_review.risks);
  const sentQuery = raw?.search?.arguments?.query;
  const queryIntegrity = {
    expected_sha256: item.provenance?.question_sha256 ?? questionSha256(item.question),
    sent_sha256: typeof sentQuery === "string" ? questionSha256(sentQuery) : null,
    status: typeof sentQuery !== "string" ? "NOT_RECORDED" : sentQuery === item.question ? "VERIFIED" : "MISMATCH",
  };
  if (queryIntegrity.status !== "VERIFIED") reviewReasons.push("SEARCH_INPUT_PROVENANCE_INCOMPLETE");
  if (item.source?.current_rules_recheck_required === "필요") reviewReasons.push("CURRENT_RULES_RECHECK_REQUIRED");
  if (!item.reference_answer && item.source?.confirmation_level !== "본문확인") reviewReasons.push("REFERENCE_BODY_NOT_CONFIRMED_BY_WORKBOOK_AUTHOR");
  if (!search.ok) reviewReasons.push("SEARCH_NOT_SUCCESSFUL");
  else if (!hits.length) reviewReasons.push("NO_MATCH_IN_STORED_DATA");
  if (!manual.length) reviewReasons.push("NO_MANUAL_SECTION_IN_TOP_5");
  if (missingDetails.length) reviewReasons.push("TOP_5_ADMISSIBLE_DETAIL_INCOMPLETE");
  if (fetchLinkErrors.length) reviewReasons.push("FETCH_LINK_REVIEW_REQUIRED");
  if (manualFetched.some((hit) => hit.body_observation_error)) reviewReasons.push("MANUAL_BODY_FRAME_UNVERIFIED");
  if (manualFetched.some((hit) => hit.body_extent?.truncated === true || (hit.body_extent?.offset ?? 0) > 0)) reviewReasons.push("MANUAL_SECTION_BODY_PARTIAL");
  return {
    schema_version: "1.1", evaluator_version: EVALUATION_VERSION, evaluation_profile: FAQ_PROFILE,
    id: item.id, question: item.question, question_sha256: questionSha256(item.question),
    query_integrity: queryIntegrity,
    category: item.category, difficulty: item.difficulty, evaluation_type: item.evaluation_type,
    source_reference: item.source ?? null, evaluation_criteria: item.evaluation_criteria ?? null,
    major_error_type: item.major_error_type ?? null, question_provenance: item.provenance ?? null,
    ...(item.reference_answer ? { reference_answer: item.reference_answer, reference: item.reference,
      raw_question: item.raw_question, reference_contextual_question: item.reference_contextual_question,
      reference_year: item.expected_year ?? null, review_status: item.review_status,
      benchmark_group: item.benchmark_group, rubric: item.rubric ?? null } : {}),
    ...(item.reference_review ? { reference_review: item.reference_review,
      reference_answer_usable: item.reference_answer_usable, retrieval_probe_eligible: item.retrieval_probe_eligible } : {}),
    ...(item.reference_supplement ? { reference_supplement: item.reference_supplement } : {}),
    status, search_success: search.ok, search_result_count: search.ok ? hits.length : null,
    search_error: search.error, fetch_errors: fetchErrors, fetch_link_errors: fetchLinkErrors,
    candidates, program_recall_at: Object.fromEntries(K_VALUES.map((k) => [k, null])),
    document_recall_at: Object.fromEntries(K_VALUES.map((k) => [k, null])),
    document_observation_complete_at: Object.fromEntries(K_VALUES.map((k) => [k, null])),
    expected_document: null, expected_section: null, expected_year: null, expected_program_names: [],
    faq_observation: {
      selection_policy: "RAW_SEARCH_RANK_1_TO_5_ADMISSIBLE_ONLY", semantic_relevance: "NOT_EVALUATED",
      admissible_candidate_count: admitted.length, excluded_candidate_count: candidates.length - admitted.length,
      admissible_details_fetched: fetchedCandidates.length, missing_admissible_detail_ids: missingDetails,
      all_admissible_details_fetched: search.ok ? admitted.length > 0 ? missingDetails.length === 0 && !fetchLinkErrors.length : null : null,
      manual_section_at: observedAt((hit) => hit.type === "manual_section"),
      manual_sections_fetched: manualFetched.length,
      manual_section_body_present: manualFetched.some((hit) => hit.body_present === true),
      manual_section_body_partial: manualFetched.some((hit) => hit.body_extent?.truncated === true || (hit.body_extent?.offset ?? 0) > 0),
      fetched_body_present: fetchedCandidates.some((hit) => hit.body_present === true),
      source_urls: sourceUrlsObserved, fetched_source_urls: fetchedUrls,
      source_location_present: admitted.some((hit) => hit.source_locations.length > 0),
      fetched_source_location_present: fetchedCandidates.some((hit) => hit.source_locations.some((location) => location.origin === "fetch")),
      reference_source_url_observed_at: item.source?.url ? observedAt((hit) => hit.reference_source_url_observed === true) : Object.fromEntries(K_VALUES.map((k) => [k, null])),
      reference_source_title_observed_at: item.source?.title ? observedAt((hit) => hit.reference_source_title_observed === true) : Object.fromEntries(K_VALUES.map((k) => [k, null])),
      year_provenance: {
        reference_written_at: item.source?.written_at ?? null,
        reference_date_role: "FAQ_PUBLICATION_DATE_NOT_POLICY_APPLICABILITY",
        candidates: admitted.map((hit) => ({ id: hit.id, rank: hit.rank, ...hit.year_provenance })),
        applicability: "NOT_EVALUATED",
      },
      review_required: true, review_required_reasons: reviewReasons,
    },
    context: {
      relevant_documents_fetched: null, evidence_urls: [], evidence_present: null,
      expected_numbers: [], numeric_status: "RUBRIC_NOT_SPECIFIED", observed_years: [],
      expected_year_observed: null, year_status: "RUBRIC_NOT_SPECIFIED",
      must_include_observed: [], premise_tokens_observed: [], semantic_correctness: "NOT_EVALUATED",
      year_applicability: "NOT_EVALUATED", units_and_conditions: "NOT_EVALUATED",
    },
    answer_correctness: ANSWER_STATUS, human_review: "PENDING", latency_ms: raw?.latency_ms ?? null,
    attempts: raw?.attempts?.length ?? raw?.search?.attempts?.length ?? (raw ? 1 : 0), raw,
  };
}

export function evaluateRecord(item, raw, options = {}) {
  if (evaluationProfile(options.evaluation_profile ? options : item) === FAQ_PROFILE) return evaluateFaqRecord(item, raw);
  const search = unwrapToolResult(raw?.search?.result ?? raw?.search);
  const hits = search.ok && Array.isArray(search.data?.results) ? search.data.results : [];
  const fetched = (raw?.fetched ?? []).map((entry) => ({ ...entry, parsed: unwrapToolResult(entry.result ?? entry.response ?? entry) }));
  const names = expectedProgramNames(item).map(normalize);
  const document = normalize(item.expected_document);
  const ranked = hits.slice(0, 5).map((hit, index) => {
    const detail = fetched.find((entry) => entry.id === hit.id);
    const payload = detail?.parsed.ok ? detail.parsed.data : null;
    const label = normalize(payload?.title ?? hit.title);
    const type = candidateType(hit);
    const admissibleSource = admissibleTypes.has(type);
    const programCandidate = admissibleSource && programNameMatches(item, label, names);
    const documented = payload ? [...strings(payload?.metadata?.sources), ...strings(payload?.evidence), ...strings(payload?.data?.sources), ...String(payload.text ?? "").split(/\r?\n/).filter((line) => /^(출처|원문)\s*:/.test(line.trim())), ...(["document", "manual_section"].includes(type) ? [payload.title] : [])] : [];
    const documentCandidate = Boolean(admissibleSource && document && documented.some((value) => normalize(value).includes(document)));
    return { rank: index + 1, id: hit.id, title: hit.title, type, admissible_source: admissibleSource, program_candidate: programCandidate, expected_document_observed: documentCandidate, fetched: Boolean(detail?.parsed.ok) };
  });
  const relevantPayloads = fetched.filter((entry) => entry.parsed.ok && ranked.some((hit) => hit.id === entry.id && (hit.program_candidate || hit.expected_document_observed))).map((entry) => entry.parsed.data);
  const text = relevantPayloads.map(businessText).join("\n");
  const evidence = [...new Set(relevantPayloads.flatMap(evidenceOf))];
  const expectedNumbers = Array.isArray(item.expected_numbers) ? item.expected_numbers : [];
  const numbers = observeNumbers(expectedNumbers, text);
  const years = observeYears(text);
  const expectedYear = item.expected_year ? String(item.expected_year) : null;
  const failedFetches = fetched.filter((entry) => !entry.parsed.ok).length;
  const blocked = raw?.status === "BLOCKED_PRECHECK" || [401, 403].includes(search.error?.http_status);
  const status = raw?.status === "NOT_RUN" ? "NOT_RUN" : blocked ? "BLOCKED_PRECHECK" : !search.ok ? "SEARCH_ERROR" : !hits.length ? "NO_RESULTS" : failedFetches ? "FETCH_PARTIAL" : !fetched.length ? "SEARCH_ONLY" : "RETRIEVED";
  const recall = (predicate) => Object.fromEntries([1, 3, 5].map((k) => [k, search.ok ? ranked.slice(0, k).some(predicate) : null]));
  const documentComplete = Object.fromEntries([1, 3, 5].map((k) => [k, search.ok ? ranked.slice(0, k).every((hit) => !hit.admissible_source || hit.fetched) : null]));
  const documentRecall = Object.fromEntries([1, 3, 5].map((k) => [k, !search.ok ? null : ranked.slice(0, k).some((hit) => hit.expected_document_observed) ? true : documentComplete[k] ? false : null]));
  return {
    schema_version: "1.0", evaluator_version: EVALUATION_VERSION,
    id: item.id, question: item.question, category: item.category, jurisdiction: item.jurisdiction,
    expected_document: item.expected_document, expected_section: item.expected_section, expected_year: expectedYear,
    expected_program_names: expectedProgramNames(item), status,
    search_success: search.ok, search_result_count: search.ok ? hits.length : null,
    search_error: search.error, fetch_errors: failedFetches,
    program_recall_at: recall((hit) => hit.program_candidate),
    document_recall_at: documentRecall,
    document_observation_complete_at: documentComplete,
    candidates: ranked,
    context: {
      relevant_documents_fetched: relevantPayloads.length,
      evidence_urls: evidence, evidence_present: evidence.length > 0,
      official_domain_evidence_urls: evidence.filter(isOfficialUrl),
      expected_numbers: numbers,
      numeric_status: !expectedNumbers.length ? "RUBRIC_NOT_SPECIFIED" : !text ? "CONTEXT_UNAVAILABLE" : numbers.every((item) => item.observed) ? "EXPECTED_NUMBERS_OBSERVED" : "EXPECTED_NUMBERS_MISSING",
      observed_years: years, expected_year_observed: expectedYear ? years.includes(expectedYear) : null,
      year_status: !expectedYear ? "RUBRIC_NOT_SPECIFIED" : !text ? "CONTEXT_UNAVAILABLE" : years.includes(expectedYear) ? (years.some((year) => year !== expectedYear) ? "EXPECTED_AND_OTHER_YEARS_OBSERVED" : "EXPECTED_YEAR_OBSERVED") : years.length ? "OTHER_YEARS_ONLY" : "YEAR_NOT_EXPLICIT",
      must_include_observed: (item.must_include ?? []).map((value) => ({ value, observed: normalize(text).includes(normalize(value)) })),
      premise_tokens_observed: (item.must_not_include ?? []).filter((value) => normalize(text).includes(normalize(value))),
      semantic_correctness: "NOT_EVALUATED", year_applicability: "NOT_EVALUATED", units_and_conditions: "NOT_EVALUATED",
    },
    answer_correctness: ANSWER_STATUS, human_review: "PENDING",
    latency_ms: raw?.latency_ms ?? null,
    attempts: raw?.attempts?.length ?? raw?.search?.attempts?.length ?? (raw ? 1 : 0),
    raw,
  };
}

function revisionFields(value, path = "", found = {}) {
  if (!value || typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value)) {
    const next = path ? path + "." + key : key;
    if (/gov24|public_service/i.test(next) && /revision|snapshot|component|version/i.test(key) && ["string", "number"].includes(typeof item)) found[next] = item;
    else if (item && typeof item === "object") revisionFields(item, next, found);
  }
  return found;
}

export function statusIdentity(snapshot) {
  const dataset = unwrapToolResult(snapshot?.dataset_status).data;
  const integration = unwrapToolResult(snapshot?.integration_status).data;
  const init = snapshot?.initialize?.result ?? snapshot?.initialize;
  const gov24 = (integration?.data?.datasets ?? []).filter((row) => /gov24/.test(row.dataset_key ?? "")).map((row) => ({ dataset_key: row.dataset_key, state: row.state, last_success_at: row.last_success_at, scopes: row.scopes, scopes_succeeded: row.scopes_succeeded }));
  const revisions = { ...revisionFields(dataset), ...revisionFields(integration) };
  return {
    at: snapshot?.at ?? null,
    release_bundle_id: dataset?.release_bundle_id ?? dataset?.data?.release_bundle?.release_bundle_id ?? null,
    server_version: dataset?.server_version ?? dataset?.data?.server_version ?? init?.serverInfo?.version ?? null,
    gov24_revision: Object.keys(revisions).length ? revisions : null,
    gov24_status_fingerprint: gov24.length ? hash(gov24) : null,
    gov24_status: gov24,
    manual_revision: dataset?.manual_revision ?? dataset?.data?.manuals?.revision ?? (typeof dataset?.components?.manuals === "string" ? dataset.components.manuals.replace(/^manuals:/, "") : null),
    manual_status: dataset?.data?.manuals ?? null,
    deployment_label: snapshot?.deployment_label ?? null,
  };
}

export function snapshotConsistency(start, end, records = []) {
  const a = statusIdentity(start), b = statusIdentity(end);
  const compare = (x, y) => x == null || y == null ? "UNKNOWN" : JSON.stringify(x) === JSON.stringify(y) ? "SAME" : "CHANGED";
  const searchPayloads = records.map((record) => unwrapToolResult(record.raw?.search?.result ?? record.raw?.search).data).filter(Boolean);
  const fetchPayloads = records.flatMap((record) => (record.raw?.fetched ?? []).map((entry) => unwrapToolResult(entry.result ?? entry).data).filter(Boolean));
  const bundleIds = new Set(fetchPayloads.map((value) => value?.metadata?.release_bundle_id ?? value?.release_bundle_id).filter(Boolean));
  const searchBundles = new Set(searchPayloads.map((value) => value?.release_bundle_id).filter(Boolean));
  const searchVersions = new Set(searchPayloads.map((value) => value?.server_version).filter(Boolean));
  const fetchVersions = new Set(fetchPayloads.map((value) => value?.metadata?.server_version ?? value?.server_version).filter(Boolean));
  const manualRevisions = new Set([...searchPayloads.map((value) => value?.manual_revision), ...searchPayloads.flatMap((value) => (value?.results ?? []).filter((hit) => candidateType(hit) === "manual_section").map((hit) => hit.revision)), ...fetchPayloads.map((value) => value?.metadata?.manual_revision ?? value?.manual_revision)].filter(Boolean));
  const responseRevisions = new Set([...searchPayloads.map((value) => value?.gov24_revision), ...fetchPayloads.map((value) => value?.metadata?.gov24_revision ?? value?.gov24_revision)].filter(Boolean));
  const expectedRevisions = new Set(Object.entries(a.gov24_revision ?? {}).filter(([key]) => /revision$/i.test(key)).map(([, value]) => value));
  const fields = { release_bundle: compare(a.release_bundle_id, b.release_bundle_id), server_version: compare(a.server_version, b.server_version), gov24_revision: compare(a.gov24_revision, b.gov24_revision), gov24_status: compare(a.gov24_status_fingerprint, b.gov24_status_fingerprint) };
  if (a.manual_revision || b.manual_revision || manualRevisions.size) fields.manual_revision = compare(a.manual_revision, b.manual_revision);
  const versions = new Set([...searchVersions, ...fetchVersions]);
  const during = new Set([...bundleIds, ...searchBundles]).size > 1 || (a.release_bundle_id && [...bundleIds, ...searchBundles].some((id) => id !== a.release_bundle_id)) || versions.size > 1 || (a.server_version && [...versions].some((version) => version !== a.server_version)) || responseRevisions.size > 1 || (expectedRevisions.size && [...responseRevisions].some((revision) => !expectedRevisions.has(revision))) || manualRevisions.size > 1 || (a.manual_revision && [...manualRevisions].some((revision) => revision !== a.manual_revision));
  return { start: a, end: b, ...fields, fetched_release_bundle_ids: [...bundleIds], search_release_bundle_ids: [...searchBundles], search_server_versions: [...searchVersions], fetch_server_versions: [...fetchVersions], response_gov24_revisions: [...responseRevisions], response_manual_revisions: [...manualRevisions], search_identity_coverage: { responses: searchPayloads.length, release_bundle_id: searchPayloads.filter((value) => value?.release_bundle_id).length, server_version: searchPayloads.filter((value) => value?.server_version).length, gov24_revision: searchPayloads.filter((value) => value?.gov24_revision).length, manual_revision: searchPayloads.filter((value) => value?.manual_revision).length }, fetch_identity_coverage: { attachments: fetchPayloads.length, server_version: fetchPayloads.filter((value) => value?.metadata?.server_version ?? value?.server_version).length, manual_revision: fetchPayloads.filter((value) => value?.metadata?.manual_revision ?? value?.manual_revision).length }, status: during || Object.values(fields).includes("CHANGED") ? "CHANGED_DURING_RUN" : Object.values(fields).every((value) => value === "SAME") ? "CONSISTENT" : fields.release_bundle === "SAME" ? "PARTIAL_IDENTITY_ONLY" : "UNKNOWN" };
}

const metric = (count, denominator) => ({ count, denominator, rate: denominator ? count / denominator : null });
export function summarize(records, options = {}) {
  const searchOk = records.filter((record) => record.search_success);
  const profile = options.evaluation_profile ?? records.find((row) => row.evaluation_profile)?.evaluation_profile ?? GOLDEN_PROFILE;
  if (records.some((row) => (row.evaluation_profile ?? GOLDEN_PROFILE) !== profile)) throw new Error("다른 평가 프로필의 기록을 한 집계에 합칠 수 없습니다.");
  const expectedIds = options.expected_ids ?? Array.from({ length: 200 }, (_, i) => (profile === FAQ_PROFILE ? "WFAQ-" : "Q") + String(i + 1).padStart(3, "0"));
  const allIdsAccounted = records.length === expectedIds.length && new Set(expectedIds).size === expectedIds.length && new Set(records.map((row) => row.id)).size === expectedIds.length && expectedIds.every((id) => records.some((row) => row.id === id));
  const completeGoldenIds = expectedIds.length === 200 && allIdsAccounted;
  const counts = {};
  for (const record of records) counts[record.status] = (counts[record.status] ?? 0) + 1;
  const numeric = records.filter((record) => record.context.expected_numbers.length);
  const perCategory = {};
  for (const category of new Set(records.map((record) => record.category))) {
    const group = records.filter((record) => record.category === category);
    perCategory[category] = { total: group.length, search_success: group.filter((record) => record.search_success).length, program_recall_at_5: metric(group.filter((record) => record.program_recall_at[5] === true).length, group.length) };
  }
  const summary = {
    schema_version: "1.0", evaluator_version: EVALUATION_VERSION,
    evaluation_profile: profile,
    run_id: options.run_id ?? null, transport: options.transport ?? null, endpoint: options.endpoint ?? null,
    started_at: options.start?.at ?? null, completed_at: options.end?.at ?? new Date().toISOString(),
    total_golden_items: options.total_golden_items ?? records.length, selected_items: records.length,
    all_200_items_accounted_for: completeGoldenIds,
    all_dataset_items_accounted_for: allIdsAccounted,
    full_200_run: completeGoldenIds && records.every((row) => !["NOT_RUN", "BLOCKED_PRECHECK"].includes(row.status)),
    full_dataset_run: allIdsAccounted && records.every((row) => !["NOT_RUN", "BLOCKED_PRECHECK"].includes(row.status)),
    statuses: counts,
    search_execution: metric(searchOk.length, records.length),
    nonempty_search: metric(searchOk.filter((record) => record.search_result_count > 0).length, searchOk.length),
    program_recall_at: Object.fromEntries([1, 3, 5].map((k) => [k, metric(records.filter((record) => record.program_recall_at[k] === true).length, records.length)])),
    document_recall_at: Object.fromEntries([1, 3, 5].map((k) => [k, metric(records.filter((record) => record.document_recall_at[k] === true).length, records.length)])),
    document_recall_unknown_at: Object.fromEntries([1, 3, 5].map((k) => [k, metric(records.filter((record) => record.document_recall_at[k] === null).length, records.length)])),
    document_observation_complete_at: Object.fromEntries([1, 3, 5].map((k) => [k, metric(records.filter((record) => record.document_observation_complete_at?.[k] === true).length, records.length)])),
    evidence_presence: metric(records.filter((record) => record.context.evidence_present).length, records.length),
    expected_numbers_context_presence: metric(numeric.filter((record) => record.context.numeric_status === "EXPECTED_NUMBERS_OBSERVED").length, numeric.length),
    expected_year_context_presence: metric(records.filter((record) => record.context.expected_year_observed === true).length, records.filter((record) => record.expected_year).length),
    consistency: snapshotConsistency(options.start, options.end, records),
    categories: perCategory,
    answer_correctness: ANSWER_STATUS, human_review: "PENDING",
    methodological_limits: [
      "프로그램 recall은 상위 결과 제목의 독립 별칭 일치 관찰이다. 사업 동일성·적용 자격·정답을 확정하지 않는다.",
      "문서 recall은 골든셋 expected_document 파일명이 출처에 나타나는지 엄격히 확인한다. 다른 공식 근거가 같은 사실을 제공하는 경우는 별도 검토한다.",
      "상위 후보 중 상세 미조회·오류가 있고 기대 문서도 관찰되지 않았다면 문서 recall은 null(미관찰)이다. 후보 제목의 사업명 관찰과 별도로 집계한다.",
      "숫자와 연도는 기대 업무에 해당하는 fetch 컨텍스트에서만 관찰하며, 검색 질문·생성 시각으로 충족하지 않는다.",
      "숫자 존재가 단위·가구원수·적용연도·예외의 정확성을 입증하지 않는다. must_not_include는 정정 문장 오판을 막기 위해 관찰만 남긴다.",
      "예산서 행과 보도자료 메타데이터는 기대 복지사업 회수로 집계하지 않는다.",
      "오류·미실행을 성공한 0건 조회와 구분한다. 전체 문항 대비 회수율 분모에는 포함하되 정답률로 해석하지 않는다.",
      "최종 자연어 답변을 생성하거나 채점하지 않았다. 정답률은 미평가이며 사람 검수가 필요하다.",
      "시작/종료 공개본·서버 버전·정부24 revision을 비교한다. 미노출 revision은 동일하다고 추정하지 않는다.",
    ],
  };
  if (profile === FAQ_PROFILE) {
    const unavailable = () => ({ status: "NOT_EVALUATED", count: null, denominator: 0, rate: null, reason: "FAQ_SOURCE_FILE_DOES_NOT_PROVIDE_VERIFIED_ANSWER_KEY" });
    const byK = () => Object.fromEntries(K_VALUES.map((k) => [k, unavailable()]));
    const withCandidates = searchOk.filter((row) => row.faq_observation.admissible_candidate_count > 0);
    const withDetails = searchOk.filter((row) => row.faq_observation.admissible_details_fetched > 0);
    const withManualDetails = searchOk.filter((row) => row.faq_observation.manual_sections_fetched > 0);
    const observed = (rows, predicate) => metric(rows.filter(predicate).length, rows.length);
    summary.schema_version = "1.1";
    summary.program_recall_at = byK(); summary.document_recall_at = byK();
    summary.document_recall_unknown_at = byK(); summary.document_observation_complete_at = byK();
    summary.evidence_presence = unavailable(); summary.expected_numbers_context_presence = unavailable(); summary.expected_year_context_presence = unavailable();
    summary.categories = Object.fromEntries(Object.entries(perCategory).map(([category, value]) => [category, { total: value.total, search_success: value.search_success, answer_correctness: "NOT_EVALUATED" }]));
    summary.faq_observation = {
      selection_policy: "RAW_SEARCH_RANK_1_TO_5_ADMISSIBLE_ONLY", semantic_relevance: "NOT_EVALUATED",
      successful_searches: searchOk.length,
      question_preservation: observed(records, (row) => row.query_integrity.status === "VERIFIED"),
      question_input_not_recorded: records.filter((row) => row.query_integrity.status === "NOT_RECORDED").length,
      question_input_mismatches: records.filter((row) => row.query_integrity.status === "MISMATCH").length,
      questions_with_admissible_candidates: withCandidates.length,
      questions_with_fetched_admissible_details: withDetails.length,
      all_admissible_details_fetched: observed(withCandidates, (row) => row.faq_observation.all_admissible_details_fetched === true),
      manual_section_at: Object.fromEntries(K_VALUES.map((k) => [k, observed(searchOk, (row) => row.faq_observation.manual_section_at[k] === true)])),
      manual_section_body_presence: observed(withManualDetails, (row) => row.faq_observation.manual_section_body_present),
      manual_section_body_partial: observed(withManualDetails, (row) => row.faq_observation.manual_section_body_partial),
      fetched_body_presence: observed(withDetails, (row) => row.faq_observation.fetched_body_present),
      fetched_source_url_presence: observed(withDetails, (row) => row.faq_observation.fetched_source_urls.length > 0),
      fetched_source_location_presence: observed(withDetails, (row) => row.faq_observation.fetched_source_location_present),
      reference_source_url_observed_at: Object.fromEntries(K_VALUES.map((k) => [k, observed(searchOk.filter((row) => row.source_reference?.url), (row) => row.faq_observation.reference_source_url_observed_at[k] === true)])),
      reference_source_title_observed_at: Object.fromEntries(K_VALUES.map((k) => [k, observed(searchOk.filter((row) => row.source_reference?.title), (row) => row.faq_observation.reference_source_title_observed_at[k] === true)])),
      fetched_body_year_mentions: observed(withDetails, (row) => row.faq_observation.year_provenance.candidates.some((candidate) => candidate.body_year_mentions.length > 0)),
      source_year_provenance: observed(searchOk, (row) => row.faq_observation.year_provenance.candidates.some((candidate) => candidate.source_year_fields.length > 0)),
      unique_top_5_admissible_ids: new Set(records.flatMap((row) => row.candidates.filter((candidate) => candidate.admissible_source).map((candidate) => candidate.id))).size,
      unique_fetched_admissible_ids: new Set(records.flatMap((row) => row.candidates.filter((candidate) => candidate.admissible_source && candidate.fetched).map((candidate) => candidate.id))).size,
      unique_manual_section_ids_fetched: new Set(records.flatMap((row) => row.candidates.filter((candidate) => candidate.type === "manual_section" && candidate.fetched).map((candidate) => candidate.id))).size,
      fetch_link_errors: records.reduce((count, row) => count + row.fetch_link_errors.length, 0),
      review_required: records.filter((row) => row.faq_observation.review_required).length,
      reference_confirmation_levels: Object.fromEntries([...new Set(records.map((row) => row.source_reference?.confirmation_level ?? "UNSPECIFIED"))].map((level) => [level, records.filter((row) => (row.source_reference?.confirmation_level ?? "UNSPECIFIED") === level).length])),
    };
    summary.full_200_run = summary.full_200_run && records.every((row) => row.query_integrity.status === "VERIFIED");
    summary.full_dataset_run = summary.full_dataset_run && records.every((row) => row.query_integrity.status === "VERIFIED");
    summary.selected_collection_complete = records.length > 0 && records.every((row) => row.search_success && row.query_integrity.status === "VERIFIED" && row.fetch_errors === 0 && row.faq_observation.missing_admissible_detail_ids.length === 0);
    summary.full_collection_complete = allIdsAccounted && summary.selected_collection_complete;
    summary.reference_answers_pending_review = records.filter((row) => row.reference_answer).length;
    summary.benchmark_groups = Object.fromEntries([...new Set(records.map((row) => row.benchmark_group ?? "legacy_faq"))].map((group) => {
      const rows = records.filter((row) => (row.benchmark_group ?? "legacy_faq") === group);
      return [group, { selected_items: rows.length, search_success: rows.filter((row) => row.search_success).length,
        reference_answers_pending_review: rows.filter((row) => row.reference_answer).length, answer_correctness: ANSWER_STATUS }];
    }));
    summary.methodological_limits = [
      "FAQ 파일은 질문·평가항목·주요 오답 유형·출처를 제공하지만 검증된 정답 본문·금액 정답표는 제공하지 않는다. 정답·사업 recall·기대 금액·적용연도는 NOT_EVALUATED이며 0점으로 변환하지 않는다.",
      "원문 문항 ID와 질문 SHA를 확인한다. 데이터셋에 저장된 질문의 줄바꿈·공백을 유지하고 평가항목을 실제 search 질문에 덧붙이지 않는다. 매뉴얼 FAQ의 저장 질문에는 추출 단계의 사업·FAQ 문맥이 포함되어 있다.",
      "상세 관찰은 검색 원순위 1~5위의 허용 사업·문서·manual_section·official_faq에 한정한다. 예산·뉴스 후보는 원순위에 남기고 뒤 후보를 끌어올리지 않는다.",
      "manual_section 존재·본문 존재·출처 위치·URL/제목 일치는 자료 관찰이다. 질문과의 의미적 관련성, 지원자격, 금액, 답변 정정의 정확성을 확정하지 않는다.",
      "매뉴얼 상세의 offset·returned_chars·total_chars·next_offset·truncated를 보존한다. 첫 상세 응답 수집을 매뉴얼 전체 본문이나 PDF 전체 표 확보라고 부르지 않는다.",
      "매뉴얼 카드의 표제·내부 원문명·파일명 추정 연도·출처·이어읽기 안내·경고를 본문에서 제외한다. 정확한 카드 프레임과 Unicode 수신 길이를 검증할 수 없으면 본문 관찰을 미확인으로 남긴다.",
      "출처 URL/제목 일치는 검색 또는 상세의 명시적 source 필드만 사용한다. 같은 목록 URL을 공유하는 다른 FAQ가 있어 URL 일치만으로 개별 FAQ 본문 확보를 확정하지 않는다.",
      "FAQ 작성일·원천 메타데이터 연도·본문 연도 언급은 경로를 나눠 보존한다. 질문·query_plan·수집시각에서 적용연도 정답을 만들지 않는다.",
      "본문확인/제목확인/검색발췌확인은 파일 작성자의 표시다. 전 문항 현행 기준 재확인 필요 및 사람 검수 PENDING을 유지한다.",
      "정상 빈 검색, 오류, 미실행, 상세 연결 오류를 구분한다. 서버·공개본·정부24 및 매뉴얼 revision 변경은 CHANGED_DURING_RUN으로 기록하며 미노출 버전은 추정하지 않는다.",
    ];
  }
  return summary;
}

export function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function recordsCsv(records) {
  if (records.some((row) => row.evaluation_profile === FAQ_PROFILE)) {
    const fields = ["id", "question", "question_sha256", "category", "difficulty", "evaluation_type", "status", "search_result_count", "manual_section_at_5", "manual_sections_fetched", "fetched_body_present", "fetched_source_url_count", "fetched_source_location_present", "reference_url_observed_at_5", "reference_title_observed_at_5", "reference_confirmation_level", "reference_current_rules_recheck", "review_required_reasons", "answer_correctness", "human_review"];
    const rows = records.map((row) => [row.id, row.question, row.question_sha256, row.category, row.difficulty, row.evaluation_type, row.status, row.search_result_count, row.faq_observation.manual_section_at[5], row.faq_observation.manual_sections_fetched, row.faq_observation.fetched_body_present, row.faq_observation.fetched_source_urls.length, row.faq_observation.fetched_source_location_present, row.faq_observation.reference_source_url_observed_at[5], row.faq_observation.reference_source_title_observed_at[5], row.source_reference?.confirmation_level, row.source_reference?.current_rules_recheck_required, row.faq_observation.review_required_reasons.join("; "), row.answer_correctness, row.human_review]);
    return "\uFEFF" + [fields, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  const fields = ["id", "question", "category", "jurisdiction", "status", "search_result_count", "program_recall_at_1", "program_recall_at_3", "program_recall_at_5", "document_recall_at_5", "evidence_present", "numeric_context_status", "year_context_status", "answer_correctness", "human_review"];
  const rows = records.map((row) => [row.id, row.question, row.category, row.jurisdiction, row.status, row.search_result_count, row.program_recall_at[1], row.program_recall_at[3], row.program_recall_at[5], row.document_recall_at[5], row.context.evidence_present, row.context.numeric_status, row.context.year_status, row.answer_correctness, row.human_review]);
  return "\uFEFF" + [fields, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function renderReport(summary, records) {
  const fmt = (value) => `${value.count}/${value.denominator}` + (value.rate == null ? " (미평가)" : ` (${(value.rate * 100).toFixed(1)}%)`);
  const safe = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  if (summary.evaluation_profile === FAQ_PROFILE) {
    const faq = summary.faq_observation;
    return [
      `# 복지정보MCP FAQ ${summary.total_golden_items}문항 운영 관찰 평가`, "",
      "**최종 답변 정답률: NOT_EVALUATED. 확정 정답키: 미제공. 사람 검수: PENDING.**", "",
      `- 데이터셋: ${summary.benchmark?.dataset_id ?? "미기록"} / ${summary.benchmark?.version ?? "미기록"}`,
      `- 데이터셋 SHA-256: ${summary.benchmark?.sha256 ?? summary.golden?.sha256 ?? "미기록"}`,
      `- 검사 시작: ${summary.started_at ?? "미기록"}`, `- 검사 종료: ${summary.completed_at}`,
      `- 실행 경로: ${summary.transport ?? "미기록"}`, `- 문항: ${summary.selected_items}/${summary.total_golden_items}`,
      `- 전체 데이터셋 ID 집합 일치: ${summary.all_dataset_items_accounted_for}; 전체 문항 실행: ${summary.full_dataset_run}`,
      `- 원문 답변 후보가 있는 검수 대기 문항: ${summary.reference_answers_pending_review ?? 0}개`,
      `- 서버: ${summary.consistency.start.server_version ?? "미노출"} → ${summary.consistency.end.server_version ?? "미노출"}`,
      `- 공개본: ${summary.consistency.start.release_bundle_id ?? "미노출"} → ${summary.consistency.end.release_bundle_id ?? "미노출"}`,
      `- 매뉴얼 revision: ${summary.consistency.start.manual_revision ?? "미노출"} → ${summary.consistency.end.manual_revision ?? "미노출"}`,
      `- 실행 일관성: ${summary.consistency.status}`, "",
      "## 관찰 결과", "",
      "아래 비율은 호출·자료 관찰이며 답변 정답률이 아니다. 지표마다 분모를 표시한다.", "",
      "| 관찰 항목 | 결과 |", "|---|---|",
      `| 선택 문항의 검색 정상 응답 | ${fmt(summary.search_execution)} |`,
      `| 선택 문항의 실제 search 입력 원문·SHA 일치 | ${fmt(faq.question_preservation)} |`,
      `| 정상 검색 중 결과가 있는 문항 | ${fmt(summary.nonempty_search)} |`,
      ...K_VALUES.map((k) => `| 정상 검색 중 manual_section 원순위 상위 ${k}개 관찰 | ${fmt(faq.manual_section_at[k])} |`),
      `| 허용 후보가 있는 문항의 상위 5위 상세 첫 응답 수집 완료 | ${fmt(faq.all_admissible_details_fetched)} |`,
      `| 매뉴얼 상세를 받은 문항 중 본문 존재 | ${fmt(faq.manual_section_body_presence)} |`,
      `| 매뉴얼 상세를 받은 문항 중 부분 본문 응답 | ${fmt(faq.manual_section_body_partial)} |`,
      `| 허용 상세를 받은 문항 중 출처 URL 존재 | ${fmt(faq.fetched_source_url_presence)} |`,
      `| 허용 상세를 받은 문항 중 출처 위치 존재 | ${fmt(faq.fetched_source_location_presence)} |`,
      `| 정상 검색 중 FAQ 원출처 URL을 상위 5위 출처에서 관찰 | ${fmt(faq.reference_source_url_observed_at[5])} |`,
      `| 정상 검색 중 FAQ 원문 제목을 상위 5위 출처에서 관찰 | ${fmt(faq.reference_source_title_observed_at[5])} |`,
      `| 상세를 받은 문항 중 본문의 연도 언급 관찰 | ${fmt(faq.fetched_body_year_mentions)} |`,
      `| 정상 검색 중 출처 메타데이터 연도 필드 존재 | ${fmt(faq.source_year_provenance)} |`,
      "| 기대 사업·문서·금액·적용연도 정답 판정 | NOT_EVALUATED — 검증된 정답키 미제공 |",
      `| 검수 필요 | ${faq.review_required}/${summary.selected_items} |`, "",
      `고유 허용 후보 ID ${faq.unique_top_5_admissible_ids}개, 고유 정상 상세 ID ${faq.unique_fetched_admissible_ids}개, 이 중 manual_section 상세 ID ${faq.unique_manual_section_ids_fetched}개다. 상세 연결 오류는 ${faq.fetch_link_errors}개다. 고유 ID 수를 실제 호출 횟수로 바꾸어 표시하지 않는다.`, "",
      "## 상태별 문항 수", "", "| 상태 | 문항 수 |", "|---|---:|",
      ...Object.entries(summary.statuses).map(([key, count]) => `| ${key} | ${count} |`), "",
      "## 판정의 한계", "", ...summary.methodological_limits.map((value) => "- " + value), "",
      "## 문항별 관찰", "",
      "| ID | 질문 | 상태 | 반환 수 | manual @5 | 정상 매뉴얼 상세 | 출처 위치 | 확인 수준(파일 표시) | 검수 |",
      "|---|---|---|---:|---|---:|---|---|---|",
      ...records.map((row) => `| ${row.id} | ${safe(row.question)} | ${row.status} | ${row.search_result_count ?? "미실행"} | ${row.faq_observation.manual_section_at[5] ?? "미평가"} | ${row.faq_observation.manual_sections_fetched} | ${row.faq_observation.fetched_source_location_present} | ${safe(row.source_reference?.confirmation_level)} | PENDING |`), "",
      "표의 질문은 읽기 편의를 위해 줄바꿈만 공백으로 표시했다. 실제 검색 입력과 records.jsonl·results.csv에는 원래 질문과 줄바꿈을 보존한다. 출처 위치·연도 provenance·평가항목·오답 유형·검수 필요 사유는 문항별 기록에 있으며 원 응답도 그대로 보존한다.", "",
    ].join("\n");
  }
  return [
    "# 복지정보MCP 골든 QA 검색·근거 회귀평가", "",
    "**최종 답변 정답률: 미평가(NOT_EVALUATED). 사람 검수: PENDING.**", "",
    `- 검사 시작: ${summary.started_at ?? "기록 없음"}`,
    `- 검사 종료: ${summary.completed_at}`,
    `- 실행 경로: ${summary.transport ?? "기록 없음"}`,
    `- 대상: ${summary.endpoint ?? "native connector"}`,
    `- 문항: ${summary.selected_items}/${summary.total_golden_items}; 전체 200문항 검사: ${summary.full_200_run}`,
    `- 공개본: ${summary.consistency.start.release_bundle_id ?? "미확인"} → ${summary.consistency.end.release_bundle_id ?? "미확인"}`,
    `- 서버 버전: ${summary.consistency.start.server_version ?? "미노출"} → ${summary.consistency.end.server_version ?? "미노출"}`,
    `- 검사 중 자료 일관성: ${summary.consistency.status}`, "",
    "## 검사 결과", "",
    "| 항목 | 결과 |", "|---|---|",
    `| 검색 호출 성공 | ${fmt(summary.search_execution)} |`,
    `| 성공 검색 중 1건 이상 반환 | ${fmt(summary.nonempty_search)} |`,
    ...[1, 3, 5].map((k) => `| 기대 사업명 후보 recall@${k} | ${fmt(summary.program_recall_at[k])} |`),
    ...[1, 3, 5].map((k) => `| 기대 문서명 recall@${k} | ${fmt(summary.document_recall_at[k])} |`),
    ...[1, 3, 5].map((k) => `| 기대 문서명 recall@${k} 미관찰 | ${fmt(summary.document_recall_unknown_at[k])} |`),
    `| 관련 컨텍스트에 근거 URL 존재 | ${fmt(summary.evidence_presence)} |`,
    `| 수치 기준이 있는 문항의 기대 숫자 관찰 | ${fmt(summary.expected_numbers_context_presence)} |`,
    `| 관련 컨텍스트에서 기대 연도 관찰 | ${fmt(summary.expected_year_context_presence)} |`, "",
    "## 상태별 문항 수", "", "| 상태 | 문항 수 |", "|---|---:|",
    ...Object.entries(summary.statuses).map(([key, value]) => `| ${key} | ${value} |`), "",
    "## 판정의 한계", "", ...summary.methodological_limits.map((value) => "- " + value), "",
    "## 문항별 기록", "", "| ID | 질문 | 상태 | 반환 수 | 사업 후보 @5 | 근거 URL | 수치 관찰 | 연도 관찰 |", "|---|---|---|---:|---|---|---|---|",
    ...records.map((row) => `| ${row.id} | ${safe(row.question)} | ${row.status} | ${row.search_result_count ?? "미실행"} | ${row.program_recall_at[5] ?? "미평가"} | ${row.context.evidence_present} | ${row.context.numeric_status} | ${row.context.year_status} |`), "",
    "각 문항의 원 응답과 재시도 이력은 records.jsonl, 수치 요약은 summary.json에 보존했다.", "",
  ].join("\n");
}
