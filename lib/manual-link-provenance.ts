import type { TalkRefOriginal } from "./welfare100/catalog-types.ts";

export interface ManualLinkProvenance {
  readonly status: "MISSING" | "INVALID" | "DOCUMENT" | "CONTEXT" | "OCR_REVIEW" | "PAGE" | "PAGE_QUOTE";
  readonly issues: readonly string[];
  readonly quoteVerified: false;
}

/** Checks stored locator shape only; confirming a quotation requires the original page text. */
export function assessManualProvenance(original?: TalkRefOriginal): ManualLinkProvenance {
  if (!original) return { status: "MISSING", issues: [], quoteVerified: false };
  const issues: string[] = [];
  if (!original.file?.trim()) issues.push("원본 파일명 없음");
  if (original.format !== "PDF" && original.format !== "HWPX") issues.push("지원하지 않는 원본 형식");
  if (!Number.isInteger(original.pages) || original.pages < 1) issues.push("전체 쪽 수 오류");
  if (!Number.isInteger(original.page) || original.page < 1 || original.page > original.pages) issues.push("시작 쪽 범위 오류");
  if (original.pageEnd !== undefined && (!Number.isInteger(original.pageEnd) || original.pageEnd < original.page || original.pageEnd > original.pages)) issues.push("끝 쪽 범위 오류");
  if (!["line", "name", "context", "document"].includes(original.basis)) issues.push("위치 대조 근거 오류");
  if (typeof original.ocr !== "boolean") issues.push("OCR 여부 없음");
  if (original.ocrCheckedAt !== undefined && !(original.ocr === true && /^\d{4}-\d{2}-\d{2}$/.test(original.ocrCheckedAt))) issues.push("OCR 대조일 오류");
  if (original.quote !== null && typeof original.quote !== "string") issues.push("발췌문 형식 오류");
  if (issues.length) return { status: "INVALID", issues, quoteVerified: false };
  const status = original.basis === "document" ? "DOCUMENT"
    : original.ocr && !original.ocrCheckedAt ? "OCR_REVIEW"
      : original.basis === "context" ? "CONTEXT"
        : original.quote?.trim() ? "PAGE_QUOTE" : "PAGE";
  return { status, issues, quoteVerified: false };
}
