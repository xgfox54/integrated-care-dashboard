// 공식 보도자료 본문·첨부 일시 판독 허가(작업지시서 v5 §23.12, T153·T155). 선택 경로이며 기본은 모두 거절한다.
// 이 모듈은 결정 규칙과 내부 지문 기록만 한다. 실제 판독은 로컬 격리 실행기(factory/hwp-parser/src/ephemeral.mjs)가 하고,
// 본문·조각·raw IR·요약은 어디에도 저장하지 않는다. 지문은 내부 중복 보조용이며 공개 DTO·사실 근거로 쓰지 않는다.
import type { SqlDatabase } from "../sql-database.ts";

export const EPHEMERAL_MAX_TTL_SECONDS = 3600;
export const EPHEMERAL_OUTPUTS = ["classification_codes", "tags", "review_candidates", "fingerprint", "receipt"] as const;
export type EphemeralOutput = (typeof EPHEMERAL_OUTPUTS)[number];
export type EphemeralOperation = "body_read" | "attachment_parse";

export interface EphemeralPolicy {
  readonly source_id: string;
  readonly temporary_text_read_allowed: number;
  readonly temporary_attachment_parse_allowed: number;
  readonly local_classification_allowed: number;
  readonly fingerprint_retention_allowed: number;
  readonly max_bytes: number;
  readonly max_seconds: number;
  readonly ttl_seconds: number;
  readonly allowed_outputs: string;
  readonly purpose: string;
  readonly rights_basis: string;
  readonly approver_ref: string;
  readonly approved_at: number;
  readonly policy_version: number;
}

export interface EphemeralRequest {
  /** PRESS_EPHEMERAL_ANALYSIS_ENABLED. 명시적으로 켠 경우에만 true. */
  readonly featureEnabled: boolean;
  readonly source: { readonly sourceId: string; readonly sourceKind: string; readonly approvalStatus: string; readonly enabled: boolean; readonly allowedHosts: readonly string[] };
  readonly policy: EphemeralPolicy | null;
  readonly operation: EphemeralOperation;
  readonly url: string;
  readonly purpose: string;
  readonly ttlSeconds: number;
  readonly outputs: readonly string[];
  readonly declaredBytes?: number;
}

export type EphemeralDecision =
  | { readonly allowed: true; readonly ttlSeconds: number; readonly maxBytes: number; readonly maxSeconds: number; readonly policyVersion: number; readonly outputs: readonly EphemeralOutput[] }
  | { readonly allowed: false; readonly code: string };

function deny(code: string): EphemeralDecision {
  return { allowed: false, code };
}

/** 허가 판정. 하나라도 빠지면 거절한다(민간 기사 예외 없음). */
export function decideEphemeral(request: EphemeralRequest): EphemeralDecision {
  if (!request.featureEnabled) return deny("FEATURE_DISABLED");
  if (request.source.sourceKind !== "OFFICIAL_PRESS_RELEASE") return deny("SOURCE_KIND_NOT_OFFICIAL");
  if (request.source.approvalStatus !== "POLICY_APPROVED" || !request.source.enabled) return deny("SOURCE_NOT_APPROVED");
  const policy = request.policy;
  if (!policy || policy.source_id !== request.source.sourceId) return deny("POLICY_MISSING");
  if (!policy.purpose.trim() || !policy.rights_basis.trim() || !policy.approver_ref.trim() || !policy.approved_at) return deny("POLICY_INCOMPLETE");
  if (request.operation === "body_read" && policy.temporary_text_read_allowed !== 1) return deny("OPERATION_NOT_ALLOWED");
  if (request.operation === "attachment_parse" && policy.temporary_attachment_parse_allowed !== 1) return deny("OPERATION_NOT_ALLOWED");
  if (!request.purpose.trim() || request.purpose.trim() !== policy.purpose.trim()) return deny("PURPOSE_MISMATCH");
  const policyTtl = Math.min(policy.ttl_seconds, EPHEMERAL_MAX_TTL_SECONDS);
  if (!Number.isInteger(request.ttlSeconds) || request.ttlSeconds <= 0 || request.ttlSeconds > policyTtl) return deny("TTL_NOT_ALLOWED");
  let allowedOutputs: string[];
  try {
    const parsed: unknown = JSON.parse(policy.allowed_outputs);
    allowedOutputs = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch (error) {
    if (error instanceof SyntaxError) return deny("POLICY_INCOMPLETE");
    throw error;
  }
  if (!request.outputs.length) return deny("OUTPUTS_MISSING");
  for (const output of request.outputs) {
    if (!(EPHEMERAL_OUTPUTS as readonly string[]).includes(output) || !allowedOutputs.includes(output)) return deny("OUTPUT_NOT_ALLOWED");
    if (output === "fingerprint" && policy.fingerprint_retention_allowed !== 1) return deny("OUTPUT_NOT_ALLOWED");
    if ((output === "classification_codes" || output === "tags" || output === "review_candidates") && policy.local_classification_allowed !== 1) return deny("OUTPUT_NOT_ALLOWED");
  }
  let url: URL;
  try {
    url = new URL(request.url);
  } catch (error) {
    if (error instanceof TypeError) return deny("URL_INVALID");
    throw error;
  }
  if (url.protocol !== "https:" || !request.source.allowedHosts.includes(url.hostname)) return deny("URL_HOST_NOT_ALLOWED");
  if (request.declaredBytes !== undefined && request.declaredBytes > policy.max_bytes) return deny("TOO_LARGE");
  return { allowed: true, ttlSeconds: request.ttlSeconds, maxBytes: policy.max_bytes, maxSeconds: policy.max_seconds, policyVersion: policy.policy_version, outputs: request.outputs as EphemeralOutput[] };
}

export async function readEphemeralPolicy(db: SqlDatabase, sourceId: string): Promise<EphemeralPolicy | null> {
  return db.prepare("SELECT * FROM press_ephemeral_policy WHERE source_id = ?").bind(sourceId).first<EphemeralPolicy>();
}

export interface FingerprintReceipt {
  readonly item_id: string;
  readonly source_id: string;
  readonly algorithm: string;
  readonly fingerprint: string;
  readonly extraction_scope: string;
  readonly source_version: string;
  readonly policy_version: number;
}

/** 처리 영수증의 지문만 내부 보조 테이블에 남긴다. 지문 보존이 허가되지 않았으면 거절한다. 공개 DTO·근거로 쓰지 않는다. */
export async function recordBodyFingerprint(db: SqlDatabase, receipt: FingerprintReceipt, now: number): Promise<void> {
  const policy = await readEphemeralPolicy(db, receipt.source_id);
  if (!policy || policy.fingerprint_retention_allowed !== 1) throw new Error("FINGERPRINT_RETENTION_NOT_ALLOWED");
  if (policy.policy_version !== receipt.policy_version) throw new Error("POLICY_VERSION_CHANGED");
  if (!/^[a-f0-9]{64}$/.test(receipt.fingerprint)) throw new Error("FINGERPRINT_INVALID");
  await db.prepare(
    "INSERT OR REPLACE INTO press_text_fingerprint (item_id, source_id, algorithm, fingerprint, extraction_scope, source_version, policy_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(receipt.item_id, receipt.source_id, receipt.algorithm, receipt.fingerprint, receipt.extraction_scope.slice(0, 120), receipt.source_version.slice(0, 120), receipt.policy_version, now).run();
}
