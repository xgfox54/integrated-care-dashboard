// 네 모듈(지식·재정·보도자료·연결)의 통합 공개본(작업지시서 v5 §24.4). 공개본은 불변이며 활성 포인터를 CAS로 바꾼다.
// 각 모듈은 따로 갱신되고, 공개 조회(웹 MCP)는 요청 시작 때 활성 공개본 하나를 골라 끝까지 그 구성요소만 쓴다.
// 공개 차단·승인 해제 같은 현재 정책은 공개본에 고정하지 않고 응답 직전에 다시 적용한다.
import { documentComponent } from "../imports/public.ts";
import { sha256Hex } from "../press/normalize.ts";
import type { SqlDatabase } from "../sql-database.ts";

export const BUNDLE_SCHEMA_VERSION = "1.0";

export interface ComponentState {
  readonly id: string | null;
  readonly status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  readonly detail: Record<string, unknown>;
}

export interface Components {
  readonly knowledge: ComponentState;
  readonly fiscal: ComponentState;
  readonly news: ComponentState;
  readonly links: ComponentState;
  readonly documents: ComponentState;
}

export interface BundleRow {
  readonly bundle_id: string;
  readonly bundle_schema_version: string;
  readonly components_key: string;
  readonly knowledge_snapshot_id: string | null;
  readonly fiscal_snapshot_id: string | null;
  readonly news_snapshot_id: string | null;
  readonly link_snapshot_id: string | null;
  readonly components_json: string;
  readonly compatibility_report: string;
  readonly status: string;
  readonly created_at: number;
  readonly activated_at: number | null;
}

/** 지금 각 모듈의 최신 공개 가능 상태를 읽는다(쓰기 없음). */
export async function readComponents(db: SqlDatabase): Promise<Components> {
  const [run, fiscal, news, links, documents] = await Promise.all([
    db.prepare(
      "SELECT id, completed_at, COALESCE((SELECT MAX(data_as_of) FROM official_source_document WHERE sync_run_id = official_sync_run.id), '') AS data_as_of " +
        "FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1",
    ).first<{ id: string; completed_at: number; data_as_of: string }>(),
    db.prepare("SELECT snapshot_id, scope_id, requested_reference_date, complete FROM fiscal_snapshot WHERE status = 'PUBLISHED' ORDER BY snapshot_id").all<{ snapshot_id: string; scope_id: string; requested_reference_date: string; complete: number }>(),
    db.prepare(
      "SELECT MAX(s.registry_version) AS registry_version, MAX(i.discovered_at) AS watermark, COUNT(*) AS items, GROUP_CONCAT(DISTINCT i.dictionary_version) AS dictionaries " +
        "FROM press_item i JOIN press_source s ON s.source_id = i.source_id WHERE i.public_status = 'PUBLIC' AND s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1",
    ).first<{ registry_version: string | null; watermark: number | null; items: number; dictionaries: string | null }>(),
    db.prepare("SELECT COUNT(*) AS verified, MAX(reviewed_at) AS watermark FROM cross_domain_link WHERE verification_status = 'VERIFIED' AND public_status = 'PUBLIC'").first<{ verified: number; watermark: number | null }>(),
    documentComponent(db),
  ]);
  const fiscalIds = fiscal.results.map((row) => row.snapshot_id);
  return {
    knowledge: run
      ? { id: "kg:" + run.id, status: "AVAILABLE", detail: { sync_run_id: run.id, collected_at: run.completed_at, source_data_as_of: run.data_as_of } }
      : { id: null, status: "UNAVAILABLE", detail: { reason: "성공한 공식자료 수집이 없음" } },
    fiscal: fiscalIds.length
      ? { id: "fiscal:" + (await sha256Hex(fiscalIds.join(","))).slice(0, 16), status: fiscal.results.every((row) => row.complete === 1) ? "AVAILABLE" : "PARTIAL", detail: { snapshot_ids: fiscalIds, reference_dates: [...new Set(fiscal.results.map((row) => row.requested_reference_date))] } }
      : { id: null, status: "UNAVAILABLE", detail: { reason: "공개 승인된 재정 snapshot이 없음" } },
    news: news?.items
      ? {
        id: "news:" + news.registry_version + ":" + news.watermark,
        status: "PARTIAL",
        detail: { registry_version: news.registry_version, discovered_watermark: news.watermark, public_items: news.items, dictionary_versions: (news.dictionaries ?? "").split(",").filter(Boolean).sort() },
      }
      : { id: null, status: "UNAVAILABLE", detail: { reason: "공개 승인된 보도자료가 없음" } },
    links: links?.verified
      ? { id: "links:" + links.verified + ":" + links.watermark, status: "PARTIAL", detail: { verified_links: links.verified, reviewed_watermark: links.watermark } }
      : { id: null, status: "UNAVAILABLE", detail: { reason: "검토된 사업–재정–보도자료 연결이 없음(후보만 있거나 없음)" } },
    documents,
  };
}

/** 구성요소 조합의 호환성 검사. blocking이 있으면 활성화하지 않고 이전 공개본을 유지한다. */
export function compatibilityReport(components: Components): { readonly blocking: readonly string[]; readonly notes: readonly string[] } {
  const blocking: string[] = [];
  const notes: string[] = [];
  if (!components.knowledge.id) blocking.push("knowledge 구성요소가 없어 공개본을 만들 수 없음");
  for (const [name, component] of Object.entries(components)) {
    if (component.status === "UNAVAILABLE") notes.push(name + " 미가용: " + String(component.detail.reason ?? ""));
    if (component.status === "PARTIAL") notes.push(name + " 부분 범위");
  }
  if (components.links.id && !components.fiscal.id) blocking.push("재정 구성요소 없이 재정 연결을 공개할 수 없음");
  return { blocking, notes };
}

export async function readActiveBundle(db: SqlDatabase): Promise<BundleRow | null> {
  return db.prepare("SELECT b.* FROM platform_active_bundle a JOIN platform_release_bundle b ON b.bundle_id = a.bundle_id WHERE a.id = 1").first<BundleRow>();
}

export async function readBundle(db: SqlDatabase, bundleId: string): Promise<BundleRow | null> {
  return db.prepare("SELECT * FROM platform_release_bundle WHERE bundle_id = ?").bind(bundleId).first<BundleRow>();
}

/**
 * 구성요소가 바뀌었으면 새 불변 공개본을 만들고, 기대한 활성 revision일 때만 포인터를 바꾼다(CAS).
 * 다른 실행이 먼저 바꿨으면 그 결과를 기준으로 한 번 더 계산한다(늦은 게시가 새 버전을 덮어쓰지 않게).
 */
export async function ensureActiveBundle(db: SqlDatabase, nowSeconds: number): Promise<{ readonly bundle: BundleRow | null; readonly changed: boolean; readonly blocking: readonly string[] }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pointer = await db.prepare("SELECT bundle_id, revision, hold_reason FROM platform_active_bundle WHERE id = 1").first<{ bundle_id: string | null; revision: number; hold_reason: string | null }>();
    // 관리자가 이전 공개본으로 되돌려 보류 중이면 새 공개본으로 넘어가지 않는다.
    if (pointer?.hold_reason) return { bundle: await readActiveBundle(db), changed: false, blocking: ["관리자 보류: " + pointer.hold_reason] };
    const components = await readComponents(db);
    const ids = { knowledge: components.knowledge.id, fiscal: components.fiscal.id, news: components.news.id, links: components.links.id, documents: components.documents.id };
    const key = (await sha256Hex(JSON.stringify(ids))).slice(0, 24);
    const active = await readActiveBundle(db);
    if (active && active.components_key === key) return { bundle: active, changed: false, blocking: [] };
    const report = compatibilityReport(components);
    if (report.blocking.length) return { bundle: active, changed: false, blocking: report.blocking };
    const bundleId = "rb_" + key;
    await db.prepare(
      "INSERT OR IGNORE INTO platform_release_bundle (bundle_id, bundle_schema_version, components_key, knowledge_snapshot_id, fiscal_snapshot_id, news_snapshot_id, link_snapshot_id, components_json, compatibility_report, status, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)",
    ).bind(bundleId, BUNDLE_SCHEMA_VERSION, key, ids.knowledge, ids.fiscal, ids.news, ids.links, JSON.stringify(components), JSON.stringify(report), nowSeconds).run();
    await db.prepare("UPDATE platform_active_bundle SET bundle_id = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?")
      .bind(bundleId, nowSeconds, pointer?.revision ?? 0).run();
    const after = await db.prepare("SELECT bundle_id, revision FROM platform_active_bundle WHERE id = 1").first<{ bundle_id: string | null; revision: number }>();
    if (after?.bundle_id === bundleId && after.revision === (pointer?.revision ?? 0) + 1) {
      await db.batch([
        db.prepare("UPDATE platform_release_bundle SET status = 'superseded' WHERE status = 'active' AND bundle_id <> ?").bind(bundleId),
        db.prepare("UPDATE platform_release_bundle SET status = 'active', activated_at = COALESCE(activated_at, ?) WHERE bundle_id = ?").bind(nowSeconds, bundleId),
      ]);
      return { bundle: await readBundle(db, bundleId), changed: true, blocking: [] };
    }
    // 경쟁에서 졌다: 새 활성 상태를 기준으로 다시 계산한다.
  }
  return { bundle: await readActiveBundle(db), changed: false, blocking: [] };
}



export interface BundleListItem {
  readonly bundle_id: string;
  readonly status: string;
  readonly created_at: number;
  readonly activated_at: number | null;
  readonly knowledge_snapshot_id: string | null;
  readonly fiscal_snapshot_id: string | null;
  readonly news_snapshot_id: string | null;
  readonly link_snapshot_id: string | null;
  /** 비어 있으면 이 공개본으로 되돌릴 수 있다. */
  readonly restore_blockers: readonly string[];
}

export interface BundlePointer {
  readonly bundle_id: string | null;
  readonly revision: number;
  readonly updated_at: number;
  readonly hold_reason: string | null;
  readonly held_at: number | null;
}

export async function readBundlePointer(db: SqlDatabase): Promise<BundlePointer | null> {
  return db.prepare("SELECT bundle_id, revision, updated_at, hold_reason, held_at FROM platform_active_bundle WHERE id = 1").first<BundlePointer>();
}

/** 되돌리기 전 확인: 고정한 사업 수집 실행의 자료와 재정 snapshot이 아직 남아 공개 상태여야 한다. 보도자료는 철회·승인 해제가 언제나 바로 적용된다. */
async function restoreBlockers(db: SqlDatabase, bundle: BundleRow): Promise<string[]> {
  const blockers: string[] = [];
  if (bundle.knowledge_snapshot_id) {
    const runId = bundle.knowledge_snapshot_id.slice(3);
    const row = await db.prepare("SELECT 1 AS present FROM official_service_snapshot WHERE sync_run_id = ? LIMIT 1").bind(runId).first<{ present: number }>();
    if (!row) blockers.push("사업 수집 자료가 이미 정리됨(" + runId + ")");
  }
  const parsed = JSON.parse(bundle.components_json) as { fiscal?: { detail?: { snapshot_ids?: unknown } } };
  const rawIds = parsed.fiscal?.detail?.snapshot_ids;
  const ids = Array.isArray(rawIds) ? rawIds.filter((id): id is string => typeof id === "string") : [];
  if (ids.length) {
    const row = await db.prepare("SELECT COUNT(*) AS total FROM fiscal_snapshot WHERE status = 'PUBLISHED' AND snapshot_id IN (" + ids.map(() => "?").join(", ") + ")").bind(...ids).first<{ total: number }>();
    if ((row?.total ?? 0) < ids.length) blockers.push("재정 snapshot 일부가 더 이상 공개 상태가 아님");
  }
  return blockers;
}

export async function listBundles(db: SqlDatabase, limit = 10): Promise<BundleListItem[]> {
  const rows = (await db.prepare("SELECT * FROM platform_release_bundle ORDER BY created_at DESC, bundle_id LIMIT ?").bind(limit).all<BundleRow>()).results;
  return Promise.all(rows.map(async (row) => ({
    bundle_id: row.bundle_id, status: row.status, created_at: row.created_at, activated_at: row.activated_at ?? null,
    knowledge_snapshot_id: row.knowledge_snapshot_id, fiscal_snapshot_id: row.fiscal_snapshot_id, news_snapshot_id: row.news_snapshot_id, link_snapshot_id: row.link_snapshot_id,
    restore_blockers: await restoreBlockers(db, row),
  })));
}

/**
 * 관리자 되돌리기: 활성 포인터를 이전 공개본으로 바꾸고(CAS) 보류를 건다. 보류 중에는 배경 갱신이 새 공개본으로 넘어가지 않는다.
 * 공개본 행은 불변이라 고친 것이 아니라 가리키는 대상만 바뀐다.
 */
export async function rollbackActiveBundle(db: SqlDatabase, bundleId: string, reason: string, nowSeconds: number): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const target = await readBundle(db, bundleId);
  if (!target) return { ok: false, message: "공개본을 찾지 못했습니다." };
  const pointer = await readBundlePointer(db);
  if (pointer?.bundle_id === bundleId) return { ok: false, message: "이미 활성 공개본입니다." };
  const blockers = await restoreBlockers(db, target);
  if (blockers.length) return { ok: false, message: "되돌릴 수 없습니다: " + blockers.join(", ") };
  await db.prepare("UPDATE platform_active_bundle SET bundle_id = ?, revision = revision + 1, updated_at = ?, hold_reason = ?, held_at = ? WHERE id = 1 AND revision = ?")
    .bind(bundleId, nowSeconds, reason.trim().slice(0, 200) || "관리자 되돌리기", nowSeconds, pointer?.revision ?? 0).run();
  const after = await readBundlePointer(db);
  if (after?.bundle_id !== bundleId) return { ok: false, message: "다른 갱신과 겹쳤습니다. 다시 시도하세요." };
  await db.batch([
    db.prepare("UPDATE platform_release_bundle SET status = 'superseded' WHERE status = 'active' AND bundle_id <> ?").bind(bundleId),
    db.prepare("UPDATE platform_release_bundle SET status = 'active', activated_at = ? WHERE bundle_id = ?").bind(nowSeconds, bundleId),
  ]);
  return { ok: true };
}

/** 보류를 풀고 곧바로 현재 구성요소로 공개본을 다시 맞춘다. */
export async function releaseBundleHold(db: SqlDatabase, nowSeconds: number) {
  await db.prepare("UPDATE platform_active_bundle SET hold_reason = NULL, held_at = NULL, updated_at = ? WHERE id = 1").bind(nowSeconds).run();
  return ensureActiveBundle(db, nowSeconds);
}
