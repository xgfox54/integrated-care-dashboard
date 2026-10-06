import type { SqlDatabase } from "../sql-database.ts";

// 웹 조회도 MCP처럼 활성 통합 공개본(platform_active_bundle) 하나에 고정한다(작업지시서 T11: 웹과 MCP가 서로 다른 릴리스를 섞어 보이지 않게).
// 공개본이 아직 없을 때(첫 배포 직후 등)만 최신 공개 자료를 쓴다. 승인 해제·철회 같은 공개 상태 변경은 고정과 무관하게 바로 반영한다.

const ACTIVE_BUNDLE_FROM = "FROM platform_active_bundle pa JOIN platform_release_bundle pb ON pb.bundle_id = pa.bundle_id WHERE pa.id = 1";

/** 활성 공개본이 가리키는 사업(지식) 수집 실행 ID. 공개본이 없으면 NULL. */
export const ACTIVE_KNOWLEDGE_RUN_ID_SQL = "(SELECT substr(pb.knowledge_snapshot_id, 4) " + ACTIVE_BUNDLE_FROM + ")";

/** 웹이 읽을 사업 수집 실행: 활성 공개본의 실행(자료가 남아 있을 때), 없으면 최근 성공 실행. */
export const PUBLIC_KNOWLEDGE_RUN_SQL =
  "(SELECT COALESCE((SELECT r.id FROM official_sync_run r WHERE r.id = " + ACTIVE_KNOWLEDGE_RUN_ID_SQL + " AND r.status = 'succeeded' " +
  "AND EXISTS (SELECT 1 FROM official_service_snapshot x WHERE x.sync_run_id = r.id)), " +
  "(SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1)))";

/** 공식 보도자료: 활성 공개본의 발견 시각 경계까지만. 공개본에 보도자료가 없으면 0(아무것도 없음), 공개본 자체가 없으면 경계 없음. */
export function publicNewsClause(alias: string): string {
  return alias + ".discovered_at <= COALESCE((SELECT COALESCE(json_extract(pb.components_json, '$.news.detail.discovered_watermark'), 0) " + ACTIVE_BUNDLE_FROM + "), 9007199254740991)";
}

export interface WebPin {
  readonly bundleId: string | null;
  /** null이면 공개본이 없어 재정 snapshot을 고정하지 않는다. */
  readonly fiscalSnapshotIds: readonly string[] | null;
}

export async function readWebPin(db: SqlDatabase): Promise<WebPin> {
  const row = await db.prepare("SELECT pb.bundle_id, pb.components_json " + ACTIVE_BUNDLE_FROM).first<{ bundle_id: string; components_json: string }>();
  if (!row) return { bundleId: null, fiscalSnapshotIds: null };
  const parsed = JSON.parse(row.components_json) as { fiscal?: { detail?: { snapshot_ids?: unknown } } };
  const ids = parsed.fiscal?.detail?.snapshot_ids;
  return { bundleId: row.bundle_id, fiscalSnapshotIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [] };
}
