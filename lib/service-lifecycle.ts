import { PUBLIC_KNOWLEDGE_RUN_SQL } from "./platform/public-pin.ts";

export const OPERATING_STATUSES = ["운영 중", "종료", "시행 예정", "확인 불가"] as const;
export type OperatingStatus = (typeof OPERATING_STATUSES)[number];
export const EVIDENCE_KINDS = ["공고", "사업안내", "기관확인", "법령·고시"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type VerificationStatus = "확인 완료" | "추가 확인 필요" | "확인 불가";

const MENU_BASIS_FRESH_MONTHS = 12;

export interface SourceDocumentFacts {
  readonly documentId: string;
  readonly title: string;
  readonly detailUrl: string;
  readonly fileName: string;
  readonly publishedAt: string;
  readonly dataAsOf: string;
  readonly collectedAt: number | null;
}

export interface StatusEvidence {
  readonly status: OperatingStatus;
  readonly evidenceKind: EvidenceKind;
  readonly evidenceTitle: string;
  readonly evidenceUrl: string;
  readonly effectiveOn: string | null;
  readonly checkedOn: string;
  readonly note: string;
  readonly recordedAt: number;
}

export interface LifecycleInput {
  readonly serviceId: string;
  readonly type: string | null;
  readonly subcategory: string | null;
  readonly document: SourceDocumentFacts | null;
  readonly runCompletedAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly evidence: readonly StatusEvidence[];
  readonly now: Date;
}

export interface ServiceLifecycle {
  readonly serviceId: string;
  readonly sourceBasis: { readonly label: string; readonly year: number | null; readonly month: number | null; readonly origin: "원문 표제" | "없음" };
  readonly appliedYear: { readonly value: number | null; readonly basis: string };
  readonly sourceCheckedAt: string | null;
  readonly lastCollectedAt: string | null;
  readonly status: { readonly value: OperatingStatus; readonly asOf: string | null; readonly basis: string; readonly evidence: { readonly title: string; readonly url: string; readonly kind: string } | null };
  readonly verification: { readonly value: VerificationStatus; readonly reasons: readonly string[] };
  readonly source: { readonly title: string; readonly url: string; readonly documentId: string; readonly fileName: string; readonly publishedAt: string } | null;
  readonly history: readonly StatusEvidence[];
}

export function basisFromTitle(title: string): { readonly year: number; readonly month: number } | null {
  const match = title.match(/(?:^|[^0-9])(\d{2}|20\d{2})\s*년\s*(\d{1,2})\s*월\s*기준/);
  if (!match) return null;
  const year = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

const iso = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toISOString() : null);

export function computeServiceLifecycle(input: LifecycleInput): ServiceLifecycle {
  const basis = input.document ? basisFromTitle(input.document.title) : null;
  const sourceBasis = basis
    ? { label: basis.year + "년 " + basis.month + "월 기준", year: basis.year, month: basis.month, origin: "원문 표제" as const }
    : { label: "미확인", year: null, month: null, origin: "없음" as const };
  const appliedYear = basis
    ? { value: basis.year, basis: "보건복지부 메뉴판 표제의 기준연월(" + sourceBasis.label + "). 사업 개별 시행연도는 원문에 따로 적혀 있지 않습니다." }
    : { value: null, basis: "원문 표제에 기준연월이 없어 적용연도를 확인하지 못했습니다. 수집일을 적용연도로 쓰지 않습니다." };

  const active = input.evidence.find((entry) => entry.status !== "확인 불가" || entry.evidenceUrl) ?? null;
  let status: ServiceLifecycle["status"];
  if (active) {
    const pending = active.status === "시행 예정" && active.effectiveOn !== null && active.effectiveOn <= input.now.toISOString().slice(0, 10);
    status = {
      value: pending ? "확인 불가" : active.status,
      asOf: active.checkedOn,
      basis: pending ? "시행 예정일이 지났지만 시행 여부 근거가 새로 등록되지 않았습니다." : active.evidenceKind + " 근거로 관리자가 등록한 상태입니다.",
      evidence: { title: active.evidenceTitle, url: active.evidenceUrl, kind: active.evidenceKind },
    };
  } else if (basis && monthsBetween(basis, input.now) <= MENU_BASIS_FRESH_MONTHS) {
    status = {
      value: "운영 중",
      asOf: basis.year + "-" + String(basis.month).padStart(2, "0"),
      basis: "보건복지부 통합돌봄 서비스 메뉴판(" + sourceBasis.label + ")에 제공 서비스로 실려 있습니다. 그 이후 변동은 원문으로 확인하세요.",
      evidence: input.document ? { title: input.document.title, url: input.document.detailUrl, kind: "사업안내" } : null,
    };
  } else {
    status = {
      value: "확인 불가",
      asOf: null,
      basis: basis ? "원문 기준연월이 " + MENU_BASIS_FRESH_MONTHS + "개월보다 오래되어 현재 운영 여부를 확인하지 못했습니다." : "원문에 기준연월이 없어 운영 여부를 확인하지 못했습니다.",
      evidence: null,
    };
  }

  const reasons: string[] = [];
  if (!input.document) reasons.push("수록 원문 문서를 찾지 못했습니다.");
  if (input.document && !basis) reasons.push("원문 표제에 기준연월이 없습니다.");
  if (input.type === "미분류" || input.type === "") reasons.push("사업구분이 원문 대조 전(미분류)입니다.");
  if (input.subcategory !== null && !input.subcategory.trim()) reasons.push("중분류가 원문 분류표와 매핑되지 않았습니다.");
  const verification: ServiceLifecycle["verification"] = !input.document
    ? { value: "확인 불가", reasons }
    : { value: reasons.length ? "추가 확인 필요" : "확인 완료", reasons };

  return {
    serviceId: input.serviceId,
    sourceBasis,
    appliedYear,
    sourceCheckedAt: iso(input.document?.collectedAt ?? input.runCompletedAt),
    lastCollectedAt: iso(input.lastSuccessAt),
    status,
    verification,
    source: input.document ? { title: input.document.title, url: input.document.detailUrl, documentId: input.document.documentId, fileName: input.document.fileName, publishedAt: input.document.publishedAt } : null,
    history: input.evidence,
  };
}

function monthsBetween(basis: { readonly year: number; readonly month: number }, now: Date): number {
  return (now.getUTCFullYear() - basis.year) * 12 + (now.getUTCMonth() + 1 - basis.month);
}

export function isOfficialServiceId(value: string): boolean {
  return /^\d{4}:\d{1,9}:\d{1,3}:\d{1,3}:[0-9A-Za-z-]{1,12}$/.test(value);
}

function missingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

export async function readStatusEvidence(db: D1Database, serviceId: string): Promise<StatusEvidence[]> {
  try {
    const rows = await db.prepare(
      "SELECT status, evidence_kind, evidence_title, evidence_url, effective_on, checked_on, note, recorded_at FROM service_status_evidence WHERE service_id = ? AND superseded_at IS NULL ORDER BY recorded_at DESC LIMIT 20",
    ).bind(serviceId).all<{ status: OperatingStatus; evidence_kind: EvidenceKind; evidence_title: string; evidence_url: string; effective_on: string | null; checked_on: string; note: string; recorded_at: number }>();
    return rows.results.map((row) => ({
      status: row.status, evidenceKind: row.evidence_kind, evidenceTitle: row.evidence_title, evidenceUrl: row.evidence_url,
      effectiveOn: row.effective_on, checkedOn: row.checked_on, note: row.note, recordedAt: row.recorded_at,
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

export async function readServiceLifecycle(db: D1Database, serviceId: string, now = new Date()): Promise<ServiceLifecycle | null> {
  const documentId = serviceId.split(":").slice(0, 3).join(":");
  const [service, document, run, evidence] = await Promise.all([
    db.prepare("SELECT type, subcategory FROM official_service_snapshot WHERE sync_run_id = " + PUBLIC_KNOWLEDGE_RUN_SQL + " AND service_id = ? LIMIT 1").bind(serviceId).first<{ type: string; subcategory: string }>(),
    db.prepare("SELECT document_id, title, detail_url, file_name, published_at, data_as_of, collected_at FROM official_source_document WHERE sync_run_id = " + PUBLIC_KNOWLEDGE_RUN_SQL + " AND document_id = ? LIMIT 1").bind(documentId).first<{ document_id: string; title: string; detail_url: string; file_name: string; published_at: string; data_as_of: string; collected_at: number }>(),
    db.prepare("SELECT (SELECT completed_at FROM official_sync_run WHERE id = " + PUBLIC_KNOWLEDGE_RUN_SQL + ") AS public_completed, (SELECT MAX(completed_at) FROM official_sync_run WHERE status = 'succeeded') AS last_success").first<{ public_completed: number | null; last_success: number | null }>(),
    readStatusEvidence(db, serviceId),
  ]);
  if (!service && !document) return null;
  return computeServiceLifecycle({
    serviceId,
    type: service?.type ?? null,
    subcategory: service?.subcategory ?? null,
    document: document ? { documentId: document.document_id, title: document.title, detailUrl: document.detail_url, fileName: document.file_name, publishedAt: document.published_at, dataAsOf: document.data_as_of, collectedAt: normalizeSeconds(document.collected_at) } : null,
    runCompletedAt: normalizeSeconds(run?.public_completed ?? null),
    lastSuccessAt: normalizeSeconds(run?.last_success ?? null),
    evidence,
    now,
  });
}

function normalizeSeconds(value: number | null): number | null {
  if (!value) return null;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

