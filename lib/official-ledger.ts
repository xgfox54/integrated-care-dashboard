// 원본 행 원장(작업지시서 v5 §10.10, T02·T49). 보건복지부 문서에서 뽑은 모든 행을 '반영 / 반영했으나 미해결 / 이유 있는 제외' 중 하나로 센다.
// 문서별 합계가 '추출 행 = 반영 + 미해결 + 제외'로 맞아야 한다. 분모는 파서가 문서에서 뽑은 행이며 원문 PDF의 시각적 행 수가 아니다.
import type { OfficialService } from "./official-source.ts";

export interface LedgerRow {
  readonly document_id: string;
  readonly extracted: number;
  readonly mapped: number;
  readonly preserved_unresolved: number;
  readonly excluded_unparseable: number;
  readonly excluded_fragment: number;
  /** 저장 행의 service_id가 이 문서 번호로 시작하는 수(근거 문서 추적 가능 행). */
  readonly traced: number;
}

export interface LedgerInput {
  readonly documents: readonly { readonly documentId: string; readonly extracted: number; readonly parsed: number }[];
  readonly removedFragments: readonly OfficialService[];
  readonly finalServices: readonly OfficialService[];
}

function documentOf(serviceId: string, ids: readonly string[]): string | null {
  let best: string | null = null;
  for (const id of ids) if (serviceId.startsWith(id + ":") && (!best || id.length > best.length)) best = id;
  return best;
}

/** 대분류 아래 중분류나 사업구분을 기준 분류표에 맞추지 못한 행은 저장하되 미해결로 센다. */
export const isUnresolved = (service: OfficialService) => !service.subcategory.trim() || !service.type.trim();

export function buildSourceRowLedger(input: LedgerInput): LedgerRow[] {
  const ids = input.documents.map((document) => document.documentId);
  const rows = new Map(input.documents.map((document) => [document.documentId, {
    document_id: document.documentId, extracted: document.extracted, mapped: 0, preserved_unresolved: 0,
    excluded_unparseable: document.extracted - document.parsed, excluded_fragment: 0, traced: 0,
  }]));
  for (const service of input.removedFragments) {
    const id = documentOf(service.serviceId, ids);
    if (id) rows.get(id)!.excluded_fragment += 1;
  }
  for (const service of input.finalServices) {
    const id = documentOf(service.serviceId, ids);
    if (!id) continue;
    const row = rows.get(id)!;
    if (isUnresolved(service)) row.preserved_unresolved += 1;
    else row.mapped += 1;
    row.traced += 1;
  }
  return [...rows.values()];
}

export function ledgerTotals(rows: readonly LedgerRow[]) {
  const sum = (key: keyof Omit<LedgerRow, "document_id">) => rows.reduce((total, row) => total + row[key], 0);
  const extracted = sum("extracted");
  const mapped = sum("mapped");
  const unresolved = sum("preserved_unresolved");
  const unparseable = sum("excluded_unparseable");
  const fragment = sum("excluded_fragment");
  const stored = mapped + unresolved;
  return {
    documents: rows.length, extracted_rows: extracted, mapped, preserved_unresolved: unresolved,
    excluded_with_reason: { UNPARSEABLE_ROW: unparseable, CONTINUATION_FRAGMENT: fragment },
    balanced: extracted === stored + unparseable + fragment,
    unbalanced_documents: rows.filter((row) => row.extracted !== row.mapped + row.preserved_unresolved + row.excluded_unparseable + row.excluded_fragment).map((row) => row.document_id),
    evidence_traceability: { stored_rows: stored, traced_to_source_document: sum("traced"), rate: stored ? Math.round((sum("traced") / stored) * 10000) / 100 : null },
    denominator_note: "분모는 파서가 보건복지부 문서에서 뽑은 행이며, 원문 PDF를 사람이 센 행 수가 아닙니다.",
  };
}
