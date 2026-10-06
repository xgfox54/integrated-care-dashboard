// 문서 수집 파싱 프로필(작업지시서 v5 §5.11, 2026-10-05 kordoc 4.18.13 다형식 개편).
// 작업 명세는 옵션을 고르지 못한다. password·filePath·사용자 OCR 함수(외부 OCR·LLM 전송 경로)·callback·formulaOcr(원격 모델)는 쓰지 않는다.
import { createHash } from "node:crypto";

export const PROFILE_ID = "document-ingest";
/** 기존 작업 명세(HWP/HWPX 시절)의 프로필 ID. 같은 프로필로 처리하고 manifest에 요청 ID를 남긴다. */
export const LEGACY_PROFILE_IDS = Object.freeze(["hwp-ingest"]);
export const PROFILE_VERSION = "2.0.0";
export const ADAPTER_VERSION = "welfare-doc-adapter-2.0.0";
export const CONTRACT = "welfare-document-v1";
export const CONTRACT_VERSION = "1.1.0";

/** 모든 형식 공통 옵션. kordoc 4.18.13 ParseOptions(dist/index.d.ts)에서 확인한 이름만 쓴다. */
export const BASE_OPTIONS = Object.freeze({
  layoutTables: "keep",
  keepTrailingEmptyCols: true,
  keepEmptyParagraphs: true,
  classifyTables: true,
  dedupeRunningHeaders: false,
  includeFieldPlaceholders: false,
  scriptTags: true,
  plain: false,
  images: false,
  inlineImages: false,
  ocr: false,
  formulaOcr: false,
});

/**
 * 형식별 덧붙임. PDF는 1차로 OCR 없이 텍스트층·표 구조를 읽고, OCR이 필요한 쪽·그림 영역이 있을 때만 2차로 내장 OCR(ocr:true)을 켠다
 * (kordoc이 OCR 쪽은 통째로 바꾸고 텍스트 쪽은 그림 영역만 덧붙여 같은 글이 두 번 나오지 않게 한다).
 * 이미지는 텍스트층이 없어 OCR만 가능하다. pages는 실행 때 상한(maxPages)으로 채운다.
 */
export const FORMAT_OPTIONS = Object.freeze({
  pdf: Object.freeze({ tables: true, removeHeaderFooter: true }),
  image: Object.freeze({ ocr: true }),
});

/** OCR 정책: 내장 PP-OCRv5(로컬 ONNX)만. 외부 OCR·LLM 제공자 함수는 넘기지 않는다. */
export const OCR_POLICY = Object.freeze({ engine: "kordoc-builtin-ppocrv5", provider_function: false, formula_ocr: false, two_pass_pdf: true });

/** 하위 호환: 예전 이름. 공통 옵션과 같다. */
export const PROFILE_OPTIONS = BASE_OPTIONS;

/** 형식에 맞는 kordoc 옵션. 이 함수 밖에서 옵션을 만들지 않는다. */
export function optionsFor(format, { maxPages, ocr = false, pageRange = null } = {}) {
  const options = { ...BASE_OPTIONS, ...(FORMAT_OPTIONS[format] ?? {}) };
  if (format === "pdf") {
    options.ocr = ocr;
    if (pageRange) options.pages = pageRange.first + "-" + pageRange.last;
    else if (maxPages) options.pages = "1-" + maxPages;
  }
  return options;
}

/** 키를 정렬한 JSON. 해시·parse_id 계산에만 쓴다. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

export const OPTIONS_HASH = sha256Hex(canonicalJson({ base: BASE_OPTIONS, formats: FORMAT_OPTIONS, ocr_policy: OCR_POLICY }));
