import { assessManualLink } from "../manual-link-type.ts";
import { assessManualProvenance } from "../manual-link-provenance.ts";
import type { TalkRef, TalkRefOriginal } from "./catalog-types.ts";

export type OriginalLocatorStatus = "DOCUMENT" | "PAGE_QUOTE" | "PAGE_ONLY" | "APPROXIMATE" | "UNRESOLVED";

export function originalLocatorStatus(original?: TalkRefOriginal): OriginalLocatorStatus {
  const provenance = assessManualProvenance(original);
  switch (provenance.status) {
    case "DOCUMENT": return "DOCUMENT";
    case "PAGE_QUOTE": return "PAGE_QUOTE";
    case "PAGE": return "PAGE_ONLY";
    case "CONTEXT": return "APPROXIMATE";
    case "MISSING":
    case "INVALID":
    case "OCR_REVIEW": return "UNRESOLVED";
  }
}

/** Shared by the web and MCP. Linking a document never verifies its quote or current applicability. */
export function manualReferenceEvidence(ref: TalkRef, programName: string) {
  const link = assessManualLink(ref, programName);
  return {
    link_type: link.type,
    link_label: link.label,
    link_confirmed: link.confirmed,
    link_basis: link.basis,
    title_year_note: link.yearNote,
    original_locator_status: link.provenance.status,
    original_locator_issues: link.provenance.issues,
    original_quote_verified: link.provenance.quoteVerified,
    effective_period_verified: false,
  };
}

export function summarizeManualReferences(refs: readonly TalkRef[], programName: string) {
  const assessed = refs.map((ref) => manualReferenceEvidence(ref, programName));
  return {
    total_reference_count: assessed.length,
    confirmed_reference_count: assessed.filter((ref) => ref.link_confirmed).length,
    candidate_reference_count: assessed.filter((ref) => !ref.link_confirmed).length,
    quote_verified_reference_count: assessed.filter((ref) => ref.original_quote_verified).length,
    count_unit: "REFERENCE_ENTRY" as const,
  };
}

export function originalEvidenceNote(original?: TalkRefOriginal): string {
  if (assessManualProvenance(original).status === "OCR_REVIEW") return "OCR로 읽은 발췌와 저장된 위치입니다. 원본 PDF의 쪽과 인용문 대조가 필요합니다. 현재 적용기간은 별도 확인해야 합니다.";
  const status = originalLocatorStatus(original);
  if (status === "UNRESOLVED") return "원본 파일·쪽 위치 미확인. 저장된 파싱본은 원본과 대조가 필요합니다.";
  if (status === "DOCUMENT") return "전용 자료 파일 전체에 대한 연결입니다. 개별 쪽·인용문이나 현재 적용기준을 검증한 것은 아닙니다.";
  if (status === "APPROXIMATE") return "앞뒤 문장으로 추정한 위치입니다. 쪽과 인용문을 원본에서 확인해야 합니다.";
  return "저장된 쪽 위치와 파싱 발췌입니다. 인용문 원본 대조 및 현재 적용기간은 별도 확인이 필요합니다." + (original?.ocr ? original.ocrCheckedAt
    ? " OCR 자료이며 " + original.ocrCheckedAt + "에 원본 PDF 화면과 같은 쪽임을 대조했습니다. 띄어쓰기 등 글자는 원본과 다를 수 있습니다."
    : " OCR 인식 오류 가능성이 있습니다." : "");
}
