// 법령 근거 반입 묶음(welfare-law-bundle-1). 로컬 수집기(factory/law-mcp)가 korean-law-mcp 4.15.6으로 법제처에서 확인한 결과를
// 관리자가 올린다. 기존 4.15.5 묶음도 반입할 수 있다. 이 반입 경로 자체는 법제처를 호출하지 않으며, 실시간 조회(/law)와 분리한다.
// 반입 결과는 모두 후보(CANDIDATE)이며,
// 조문이 존재한다는 확인과 그 조문이 사업의 실제 근거라는 판단은 별개다. 근거 확정은 관리자 검토(VERIFIED)로만 한다.
import { z } from "zod";

import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { sha256Hex } from "./http.ts";

export const LAW_BUNDLE_SCHEMA = "welfare-law-bundle-1";
export const PINNED_LAW_PACKAGE = "korean-law-mcp@4.15.6";
export const SUPPORTED_LAW_PACKAGES = ["korean-law-mcp@4.15.5", PINNED_LAW_PACKAGE] as const;
export const LAW_SOURCE_LABEL = "법제처 국가법령정보 OPEN API(원천) · korean-law-mcp 4.15.6(조회·검증 계층)";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sha = z.string().regex(/^[0-9a-f]{64}$/);

export const LawReferenceSchema = z.object({
  law_name: z.string().min(1).max(200),
  law_kind: z.string().max(60).nullable(),
  law_id: z.string().max(40).nullable(),
  mst: z.string().max(40).nullable(),
  article: z.string().max(40).nullable(),
  promulgated_on: isoDay.nullable(),
  effective_on: isoDay.nullable(),
  version_status: z.enum(["CURRENT", "FUTURE", "PAST", "REPEALED", "UNKNOWN"]),
  article_status: z.enum(["EXISTS", "NOT_FOUND", "NOT_CHECKED", "UNKNOWN"]),
  upcoming_note: z.string().max(600).nullable(),
  official_url: z.string().url().max(600).refine((url) => /^https:\/\/www\.law\.go\.kr\//.test(url), "법제처 국가법령정보센터 주소여야 합니다."),
  text_sha256: sha.nullable(),
});

export const LawItemSchema = z.object({
  candidate_id: z.string().min(1).max(200),
  target_kind: z.enum(["service", "gov24"]),
  target_id: z.string().min(1).max(500),
  target_label: z.string().max(300),
  citation_text: z.string().max(2000),
  source: z.object({ kind: z.enum(["GOV24_FIELD", "MANUAL"]), id: z.string().max(200), field: z.string().max(40) }),
  status: z.enum(["OK", "AUTH_MISSING", "BLOCKED", "ERROR", "NO_CITATION"]),
  message: z.string().max(500).nullable(),
  verify_summary: z.string().max(600).nullable(),
  references: z.array(LawReferenceSchema).max(20),
});

export const LawBundleSchema = z.object({
  schema: z.literal(LAW_BUNDLE_SCHEMA),
  created_at: z.string().max(40),
  query_date: isoDay,
  package: z.enum(SUPPORTED_LAW_PACKAGES),
  server: z.object({ name: z.string().max(80), version: z.string().max(40) }),
  collector_version: z.string().max(40),
  protocol_sha256: sha,
  blocked_count: z.number().int().min(0),
  items: z.array(LawItemSchema).max(5000),
  items_sha256: sha,
}).refine((bundle) => bundle.package === "korean-law-mcp@" + bundle.server.version, {
  message: "패키지 버전과 서버 버전이 일치해야 합니다.",
  path: ["server", "version"],
});

export type LawBundle = z.infer<typeof LawBundleSchema>;
export type LawReference = z.infer<typeof LawReferenceSchema>;

export function referenceId(reference: LawReference, queryDate: string): string {
  return "law:" + [reference.law_id ?? reference.law_name, reference.mst ?? "-", reference.article ?? "-", queryDate].join("|");
}

export interface LawImportReport {
  readonly import_id: string;
  readonly items: number;
  readonly references: number;
  readonly candidate_links: number;
  readonly review_required: number;
  readonly skipped: Readonly<Record<string, number>>;
  readonly duplicate: boolean;
}

export class LawBundleError extends Error {}

/** 묶음 검사(형식·허용 버전·해시) 뒤 반입한다. 같은 묶음은 다시 반입하지 않는다. */
export async function importLawBundle(db: SqlDatabase, raw: string, now: number): Promise<LawImportReport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LawBundleError("JSON 형식이 아닙니다.");
  }
  const result = LawBundleSchema.safeParse(parsed);
  if (!result.success) throw new LawBundleError("묶음 형식 오류: " + result.error.issues.slice(0, 3).map((issue) => issue.path.join(".") + " " + issue.message).join("; "));
  const bundle = result.data;
  const sourceLabel = bundle.package === PINNED_LAW_PACKAGE
    ? LAW_SOURCE_LABEL
    : "법제처 국가법령정보 OPEN API(원천) · korean-law-mcp " + bundle.server.version + "(조회·검증 계층)";
  if ((await sha256Hex(JSON.stringify(bundle.items))) !== bundle.items_sha256) throw new LawBundleError("items_sha256이 내용과 맞지 않습니다(묶음이 바뀌었을 수 있음).");
  const bundleSha = await sha256Hex(raw);
  const importId = "lawimp:" + bundleSha.slice(0, 16);
  const existing = await db.prepare("SELECT import_id FROM law_import WHERE bundle_sha256 = ?").bind(bundleSha).first<{ import_id: string }>();
  if (existing) return { import_id: existing.import_id, items: bundle.items.length, references: 0, candidate_links: 0, review_required: 0, skipped: {}, duplicate: true };
  const statements: SqlStatement[] = [];
  const skipped: Record<string, number> = {};
  let references = 0;
  let links = 0;
  let review = 0;
  for (const item of bundle.items) {
    if (item.status !== "OK") { skipped[item.status] = (skipped[item.status] ?? 0) + 1; continue; }
    for (const reference of item.references) {
      const refId = referenceId(reference, bundle.query_date);
      references += 1;
      statements.push(db.prepare("INSERT OR REPLACE INTO law_reference (ref_id, law_name, law_kind, law_id, law_mst, article, promulgated_on, effective_on, query_date, version_status, article_status, official_url, text_sha256, upcoming_note, retrieved_via, retrieved_at, import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(refId, reference.law_name, reference.law_kind, reference.law_id, reference.mst, reference.article, reference.promulgated_on, reference.effective_on, bundle.query_date, reference.version_status, reference.article_status, reference.official_url, reference.text_sha256, reference.upcoming_note, sourceLabel, bundle.created_at, importId));
      // 이미 확정한 같은 법령(법령ID·조문)의 연결이 다른 버전(MST)을 가리키거나 시행예정 개정이 생겼으면 다시 검토하게 한다.
      if (reference.law_id) {
        const verified = await db.prepare("SELECT l.link_id, r.law_mst FROM program_ext_link l JOIN law_reference r ON r.ref_id = l.source_id WHERE l.source_kind = 'LAW' AND l.target_kind = ? AND l.target_id = ? AND l.status = 'VERIFIED' AND r.law_id = ? AND COALESCE(r.article, '-') = ?")
          .bind(item.target_kind, item.target_id, reference.law_id, reference.article ?? "-").all<{ link_id: string; law_mst: string | null }>();
        for (const row of verified.results) {
          const changed = row.law_mst !== reference.mst;
          if (!changed && !reference.upcoming_note) continue;
          review += 1;
          statements.push(db.prepare("UPDATE program_ext_link SET status = 'REVIEW_REQUIRED', conflict_json = ?, updated_at = ? WHERE link_id = ?")
            .bind(JSON.stringify({ kind: changed ? "LAW_VERSION_CHANGED" : "LAW_UPCOMING_AMENDMENT", previous_mst: row.law_mst, new_mst: reference.mst, upcoming_note: reference.upcoming_note, query_date: bundle.query_date }), now, row.link_id));
        }
      }
      if (reference.version_status === "UNKNOWN" && reference.article_status !== "EXISTS") continue;
      links += 1;
      const evidence = { rule: "law-citation-1", citation_text: item.citation_text.slice(0, 500), source: item.source, article_status: reference.article_status, version_status: reference.version_status, query_date: bundle.query_date, verify_summary: item.verify_summary, retrieved_via: sourceLabel, note: "조문 존재 확인은 근거 관계 확정이 아닙니다." };
      statements.push(db.prepare("INSERT INTO program_ext_link (link_id, source_kind, source_id, target_kind, target_id, target_label, score, evidence_json, status, created_at, updated_at) VALUES (?, 'LAW', ?, ?, ?, ?, NULL, ?, 'CANDIDATE', ?, ?) ON CONFLICT(source_kind, source_id, target_kind, target_id) DO UPDATE SET evidence_json = excluded.evidence_json, updated_at = excluded.updated_at")
        .bind("law:" + refId + "->" + item.target_id, refId, item.target_kind, item.target_id, item.target_label, JSON.stringify(evidence), now, now));
    }
  }
  statements.push(db.prepare("INSERT INTO law_import (import_id, bundle_sha256, package_version, server_name, collector_version, query_date, created_at, imported_at, item_count, blocked_count, report_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(importId, bundleSha, bundle.package, bundle.server.name + "@" + bundle.server.version, bundle.collector_version, bundle.query_date, bundle.created_at, now, bundle.items.length, bundle.blocked_count, JSON.stringify({ references, links, review, skipped })));
  statements.push(db.prepare("INSERT INTO ext_scope_state (dataset_key, scope_key, last_status, last_message, last_attempt_at, last_success_at, last_success_run_id, next_due_at) VALUES ('moleg.law', 'local-bundle', ?, ?, ?, ?, ?, 0) ON CONFLICT(dataset_key, scope_key) DO UPDATE SET last_status = excluded.last_status, last_message = excluded.last_message, last_attempt_at = excluded.last_attempt_at, last_success_at = COALESCE(excluded.last_success_at, ext_scope_state.last_success_at), last_success_run_id = COALESCE(excluded.last_success_run_id, ext_scope_state.last_success_run_id)")
    .bind(references ? "SUCCEEDED" : Object.keys(skipped).includes("AUTH_MISSING") ? "AUTH_MISSING" : "SUCCEEDED_EMPTY", "반입 " + bundle.items.length + "건, 법령 참조 " + references + "건, 차단 " + bundle.blocked_count + "회", now, references ? now : null, references ? importId : null));
  for (let index = 0; index < statements.length; index += 200) await db.batch(statements.slice(index, index + 200));
  return { import_id: importId, items: bundle.items.length, references, candidate_links: links, review_required: review, skipped, duplicate: false };
}

/** 로컬 수집기에 넘길 법령 인용 후보: 확정된 사업–정부24 연결에서 정부24 상세의 법령·자치법규·행정규칙 필드. */
export async function lawCandidates(db: SqlDatabase): Promise<{ readonly generated_at: string; readonly items: readonly { readonly candidate_id: string; readonly target_kind: "service"; readonly target_id: string; readonly target_label: string; readonly citation_text: string; readonly source: { readonly kind: "GOV24_FIELD"; readonly id: string; readonly field: string } }[] }> {
  const rows = await db.prepare("SELECT l.target_id, l.target_label, g.service_id, g.laws, g.ordinances, g.admin_rules FROM program_ext_link l JOIN gov24_service g ON g.service_id = l.source_id WHERE l.source_kind = 'GOV24' AND l.status = 'VERIFIED' AND g.detail_status = 'COLLECTED'")
    .all<{ target_id: string; target_label: string | null; service_id: string; laws: string | null; ordinances: string | null; admin_rules: string | null }>();
  const items = rows.results.flatMap((row) => ([["법령", row.laws], ["자치법규", row.ordinances], ["행정규칙", row.admin_rules]] as const)
    .filter(([, text]) => Boolean(text && text.trim()))
    .map(([field, text]) => ({ candidate_id: row.service_id + ":" + field + ":" + row.target_id, target_kind: "service" as const, target_id: row.target_id, target_label: row.target_label ?? "", citation_text: String(text).slice(0, 2000), source: { kind: "GOV24_FIELD" as const, id: row.service_id, field } })));
  return { generated_at: new Date().toISOString(), items };
}
