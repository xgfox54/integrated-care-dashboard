// 상위 경고를 프로젝트 코드·처리 정책으로 옮기고 문서 상태를 정한다(작업지시서 v5 §5.15).
// 표에 없는 새 경고 코드는 허용하지 않고 WF_UNKNOWN_WARNING 검토로 보낸다. 경고가 없다고 원문 보존율 100%라는 뜻은 아니다.

const WARNING_POLICY = {
  TRUNCATED_TABLE: { project: "WF_TRUNCATED_TABLE", action: "block_auto_publish" },
  PARTIAL_PARSE: { project: "WF_PARTIAL_PARSE", action: "block_auto_publish" },
  MALFORMED_XML: { project: "WF_MALFORMED_XML", action: "block_auto_publish" },
  BROKEN_ZIP_RECOVERY: { project: "WF_BROKEN_ZIP_RECOVERY", action: "block_auto_publish" },
  LENIENT_CFB_RECOVERY: { project: "WF_LENIENT_CFB_RECOVERY", action: "block_auto_publish" },
  NEEDS_OCR: { project: "WF_NEEDS_OCR", action: "hold_region" },
  OCR_FAILED: { project: "WF_OCR_FAILED", action: "hold_region" },
  OCR_LOW_CONF: { project: "WF_OCR_LOW_CONF", action: "hold_region" },
  SKIPPED_OLE: { project: "WF_SKIPPED_OLE", action: "hold_region" },
  UNSUPPORTED_ELEMENT: { project: "WF_UNSUPPORTED_ELEMENT", action: "hold_region" },
  SKIPPED_IMAGE: { project: "WF_SKIPPED_IMAGE", action: "review_image" },
  PAGE_BOUNDARY_APPROXIMATE: { project: "WF_PAGE_APPROXIMATE", action: "no_page_citation" },
  HIDDEN_TEXT_FILTERED: { project: "WF_HIDDEN_TEXT_FILTERED", action: "review_omission" },
  DRM_COM_FALLBACK: { project: "WF_COM_POLICY_VIOLATION", action: "fail_policy" },
  COM_EMPTY: { project: "WF_COM_POLICY_VIOLATION", action: "fail_policy" },
  OCR_APPLIED: { project: "WF_UNEXPECTED_OCR", action: "review_unexpected" },
  OCR_FALLBACK: { project: "WF_UNEXPECTED_OCR", action: "review_unexpected" },
};

/** 독립 정답(원본 XML 대조)으로 표 구조 검증 범위를 확인한 형식. 나머지 형식은 결과가 좋아도 구조 검증 통과로 올리지 않는다. */
export const STRUCTURE_VALIDATED_FORMATS = Object.freeze(["hwp", "hwpx"]);

const FAILURE_STATUS = {
  ENCRYPTED: "REQUIRES_AUTHORIZED_COPY",
  DRM_PROTECTED: "REQUIRES_AUTHORIZED_COPY",
  DISTRIBUTION_PROTECTED: "REQUIRES_AUTHORIZED_COPY",
  PROTECTION_UNREADABLE: "FAILED",
  UNSUPPORTED_FORMAT: "UNSUPPORTED",
};

export function failureStatus(code) {
  return FAILURE_STATUS[code] ?? "FAILED";
}

/**
 * context: { format, ocr: {requested, reason, candidate_pages}, ocrPages: number[], extension: {extension, matches}, pageLimit: {maxPages, truncated} }
 * 기존 호출(인자 4개)은 HWP/HWPX 판정과 같다.
 */
export function assessQuality(raw, tables, documentBlocks, networkAttempts, context = {}) {
  const ocrRequested = context.ocr?.requested === true;
  const warnings = (raw.warnings ?? []).map((warning) => {
    // 프로필이 요청한 OCR이 적용된 것은 이상 징후가 아니라 사람 대조가 필요한 결과다.
    const policy = warning.code === "OCR_APPLIED" && ocrRequested ? { project: "WF_OCR_APPLIED", action: "review_ocr" } : WARNING_POLICY[warning.code] ?? { project: "WF_UNKNOWN_WARNING", action: "review_unknown" };
    return { upstream_code: warning.code ?? null, upstream_message_internal: warning.message ?? "", page: warning.page ?? null, project_code: policy.project, action: policy.action };
  });
  const ocrPages = context.ocrPages ?? [];
  if (ocrPages.length) warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_OCR_VALUES_REVIEW", action: "review_ocr", pages: ocrPages });
  if (context.ocr && !ocrRequested && (context.ocr.candidate_pages ?? []).length) {
    warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_OCR_NOT_RUN", action: "hold_region", reason: context.ocr.reason, pages: context.ocr.candidate_pages });
  }
  if (context.extension && context.extension.matches === false) {
    warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_EXTENSION_MISMATCH", action: "review_unknown", extension: context.extension.extension, detected_format: context.format });
  }
  if (context.pageLimit?.range) {
    // 선언한 쪽 범위만 처리했다: 문서 전체 결과로 쓰지 않도록 범위와 전체 쪽 수를 남긴다(공개 차단 사유는 아님, 범위 검토 대상).
    warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_PAGE_RANGE_DECLARED", action: "review_scope", first_page: context.pageLimit.range.first, last_page: context.pageLimit.range.last, total_pages: context.pageLimit.totalPages });
  }
  if (context.pageLimit?.truncated) {
    warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_PAGE_LIMIT", action: "block_auto_publish", parsed_pages: context.pageLimit.maxPages, total_pages: context.pageLimit.totalPages });
  }
  // images:false 프로필은 그림 바이트를 읽지 않는다. 그림 자리가 있으면 로고인지 중요 안내인지 사람이 확인해야 한다.
  const imageBlocks = documentBlocks.filter((block) => block.type === "image").length;
  if (imageBlocks > 0 && !warnings.some((warning) => warning.project_code === "WF_SKIPPED_IMAGE")) {
    warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_IMAGE_NOT_READ", action: "review_image", count: imageBlocks });
  }
  const tableFlags = tables.flatMap((table) => table.quality_flags.map((flag) => ({ table_id: table.table_id, flag })));
  const structureErrors = tableFlags.filter(({ flag }) => /^(SPAN_OUT_OF_RANGE|SPAN_OVERLAP|TEXT_IN_COVERED_SLOT|MISSING_CELL_SLOT|NESTING_TOO_DEEP|TOO_MANY_SLOTS)/.test(flag));
  const actions = new Set(warnings.map((warning) => warning.action));
  const reasons = [];
  let status = "STRUCTURE_VALIDATED";
  if (networkAttempts > 0) {
    status = "FAILED";
    reasons.push("파싱 중 네트워크 접속 시도가 있었습니다(차단됨).");
  } else if (actions.has("fail_policy")) {
    status = "FAILED";
    reasons.push("COM·Office 자동 실행 경로는 무인 파서 정책 위반입니다.");
  } else if (actions.has("block_auto_publish")) {
    status = "PARTIAL";
    reasons.push(context.pageLimit?.truncated ? "쪽 수 상한(" + context.pageLimit.maxPages + "쪽)까지만 읽었습니다. 뒷부분은 처리하지 않았습니다." : "손상·부분 파싱 경고가 있어 영향 범위 확인 전 자동 공개를 막습니다.");
  } else if (structureErrors.length) {
    status = "NEEDS_REVIEW";
    reasons.push("표 구조 검증 실패(병합 범위·겹침 등)가 있습니다.");
  } else if (actions.has("hold_region") || actions.has("review_unknown") || actions.has("review_unexpected") || actions.has("review_omission") || actions.has("review_image") || actions.has("review_ocr") || actions.has("review_scope")) {
    status = "NEEDS_REVIEW";
    reasons.push("검토가 필요한 경고가 있습니다.");
  }
  if (ocrPages.length) reasons.push("OCR로 읽은 쪽 " + ocrPages.length + "개(" + ocrPages.slice(0, 10).join(", ") + (ocrPages.length > 10 ? " …" : "") + ")는 글자·숫자·금액·날짜를 원문과 대조해야 합니다. OCR 줄 신뢰도는 파서가 제공하지 않습니다.");
  if (context.ocr && !ocrRequested && (context.ocr.candidate_pages ?? []).length) {
    reasons.push("OCR이 필요한 쪽 " + context.ocr.candidate_pages.length + "개를 읽지 않았습니다(" + context.ocr.reason + "). 그 쪽 내용은 결과에 없거나 깨졌을 수 있습니다.");
  }
  if (context.format && !STRUCTURE_VALIDATED_FORMATS.includes(context.format) && status === "STRUCTURE_VALIDATED") {
    status = "NEEDS_REVIEW";
    warnings.push({ upstream_code: null, upstream_message_internal: "", page: null, project_code: "WF_FORMAT_NOT_VALIDATED", action: "review_format", format: context.format });
    reasons.push(context.format.toUpperCase() + " 형식은 독립 정답으로 표 구조를 검증한 범위 밖이라 사람이 원문과 대조해야 합니다.");
  }
  const cells = tables.flatMap((table) => table.cells);
  const valueStates = cells.reduce((counts, cell) => ({ ...counts, [cell.value_state]: (counts[cell.value_state] ?? 0) + 1 }), {});
  const textBlocks = documentBlocks.filter((block) => block.type !== "table");
  if (!tables.length && !textBlocks.some((block) => (block.parsed_text_verbatim ?? "").trim())) {
    if (status === "STRUCTURE_VALIDATED") status = "NEEDS_REVIEW";
    reasons.push("본문·표가 비어 있습니다. 보호 문서·이미지 문서일 수 있어 빈 정상 문서로 보지 않습니다.");
  }
  return {
    status,
    reasons,
    warnings,
    network_attempts: networkAttempts,
    counts: {
      blocks: documentBlocks.length,
      tables: tables.length,
      nested_tables: tables.filter((table) => table.parent_cell_id !== null).length,
      anchor_cells: cells.length,
      covered_slots: cells.reduce((sum, cell) => sum + cell.row_span * cell.col_span - 1, 0),
      value_states: valueStates,
      image_blocks: documentBlocks.filter((block) => block.type === "image").length,
      placeholder_blocks: documentBlocks.filter((block) => block.contains_placeholder).length,
      strike_blocks: documentBlocks.filter((block) => block.contains_strike).length,
    },
    table_flags: tableFlags,
    promotion: {
      auto_publish_allowed: false,
      basis: "파싱·구조 검증은 공개 승인과 다릅니다. 복지 의미 검증과 검토 승인을 거쳐야 합니다.",
      locator_precision: "parsed_structural",
      page_citation_allowed: (raw.metadata?.pageMode ?? "unknown") === "layout" && !warnings.some((warning) => warning.action === "no_page_citation"),
      ocr_values_unverified: ocrPages.length > 0,
    },
    coverage: {
      unit: "document",
      processed: context.pageLimit?.range ? "declared_page_range" : context.pageLimit?.truncated ? "first_pages_only" : "whole_document",
      partial_pages: context.pageLimit?.truncated === true || Boolean(context.pageLimit?.range),
      ...(context.pageLimit?.range ? { page_range: context.pageLimit.range, total_pages: context.pageLimit.totalPages } : {}),
      limits_note: "경고가 없다는 사실이 원문 보존율 100%를 뜻하지 않습니다. 그림 바이트는 저장하지 않습니다(images:false). " +
        (context.format === "pdf" ? (ocrRequested ? "PDF는 텍스트층과 내장 OCR(PP-OCRv5, 로컬) 결과를 함께 씁니다." : "PDF는 텍스트층만 읽었습니다(OCR 미실행).") : context.format === "image" ? "이미지는 내장 OCR(PP-OCRv5, 로컬)로만 읽습니다." : "OLE 개체·그림 속 글은 읽지 않습니다."),
    },
  };
}
