import type { SqlDatabase } from "../sql-database.ts";
import { duplicateRepresentativeSql, PRESS_FROM_JOINS, PUBLIC_PRESS_CLAUSES } from "./query.ts";
import { publicNewsClause } from "../platform/public-pin.ts";
import { MAX_SCHEDULE_GAP_HOURS, PRESS_COLLECTION_HOURS_KST, PRESS_SCHEDULE_LABEL } from "./schedule.ts";

// 수집 범위·성공률을 분모와 함께 보여 준다. 등록 기관 수를 수집 성공률로 쓰지 않는다.

const DAY_SECONDS = 24 * 60 * 60;
export const SCHEDULE_NOTE =
  `${PRESS_SCHEDULE_LABEL}에 수집합니다. 이 호스팅은 예약 작업을 실행하지 않아 각 시각이 지난 뒤 사이트에 처음 방문 요청이 들어올 때 수집이 시작되며, 방문이 없으면 다음 방문까지 늦어집니다. 원문 게시 즉시 반영이나 전국 무누락을 뜻하지 않습니다.`;

interface SourceStatusRow {
  readonly source_id: string;
  readonly organization_id: string;
  readonly organization_name: string;
  readonly org_type: string;
  readonly method: string;
  readonly interval_minutes: number;
  readonly verification_status: string;
  readonly approval_status: string;
  readonly technical_status: string;
  readonly enabled: number;
  readonly last_success_at: number | null;
  readonly latest_item_date: string | null;
  readonly registry_version: string;
  readonly window_items: number | null;
  readonly window_oldest: string | null;
  readonly window_newest: string | null;
  readonly window_measured_at: number | null;
}

/**
 * 원천 목록 보유창 평가(T114). 날짜 단위라 시각은 모른다. 보유창이 정기 수집 간격보다 짧거나,
 * 하루 평균 게시 수로 추정한 간격 중 게시 수가 목록 건수에 가까우면 4회 조회만으로 전수 수집을 보장할 수 없다고 표시한다.
 */
export function assessRetention(items: number, oldest: string, newest: string, gapHours: number = MAX_SCHEDULE_GAP_HOURS) {
  if (!items || !oldest || !newest) return { assessment: "UNMEASURED" as const };
  const dateOnly = oldest.length === 10 && newest.length === 10;
  // 날짜만 있으면 두 날짜를 모두 포함한 상한(일수×24시간)으로 잰다. 실제 보유창은 이보다 짧을 수 있다.
  const spanHours = dateOnly
    ? (Math.round((Date.parse(newest + "T00:00:00Z") - Date.parse(oldest + "T00:00:00Z")) / 86_400_000) + 1) * 24
    : Math.max(1, (Date.parse(newest) - Date.parse(oldest)) / 3_600_000);
  const expectedInGap = Math.round((items / spanHours) * gapHours * 10) / 10;
  // 게시가 몰리는 날은 평균의 두 배쯤 될 수 있어, 간격 중 예상 게시 수가 목록 건수의 절반 이상이면 빠듯하다고 본다.
  const assessment = spanHours <= gapHours ? "WINDOW_SHORTER_THAN_GAP" as const : expectedInGap >= items * 0.5 ? "CAPACITY_TIGHT" as const : "WINDOW_COVERS_GAP" as const;
  return {
    assessment, precision: dateOnly ? "date_upper_bound" as const : "timestamp" as const, span_hours: Math.round(spanHours * 10) / 10, items,
    estimated_posts_in_longest_gap: expectedInGap, longest_gap_hours: gapHours,
  };
}

function isoOf(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toISOString() : "";
}

async function count(db: SqlDatabase, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function readPressCoverage(db: SqlDatabase, nowSeconds: number) {
  const since = nowSeconds - DAY_SECONDS;
  const publicWhere = [...PUBLIC_PRESS_CLAUSES, publicNewsClause("i")].join(" AND ");
  const displayWhere = publicWhere + " AND (i.duplicate_group_id IS NULL OR i.item_id = (" + duplicateRepresentativeSql("i") + "))";
  const [types, sources, runs] = await Promise.all([
    db.prepare("SELECT org_type, COUNT(*) AS total FROM press_organization WHERE lifecycle_status = 'ACTIVE' GROUP BY org_type ORDER BY org_type")
      .all<{ org_type: string; total: number }>(),
    db.prepare(
      "SELECT s.source_id, s.organization_id, o.name AS organization_name, o.org_type, s.method, s.interval_minutes, s.verification_status, s.approval_status, s.technical_status, s.enabled, " +
        "c.last_success_at, c.latest_item_date, s.registry_version, c.window_items, c.window_oldest, c.window_newest, c.window_measured_at FROM press_source s JOIN press_organization o ON o.organization_id = s.organization_id " +
        "LEFT JOIN press_crawl_state c ON c.source_id = s.source_id ORDER BY s.source_id",
    ).all<SourceStatusRow>(),
    db.prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('succeeded', 'not_modified') THEN 1 ELSE 0 END) AS succeeded, SUM(CASE WHEN coverage_note = 'GAP_POSSIBLE' THEN 1 ELSE 0 END) AS gaps, SUM(CASE WHEN coverage_note = 'GAP_RECOVERED' THEN 1 ELSE 0 END) AS recovered FROM press_collection_run WHERE started_at >= ?",
    ).bind(since).first<{ total: number; succeeded: number | null; gaps: number | null; recovered: number | null }>(),
  ]);
  const [publicItems, newItems, latest, survey, relatedGroups, releaseGroups, displayItems] = await Promise.all([
    // 화면 목록과 같은 조건(광역 보도자료의 시·군·구 재게시 제외)으로 센다.
    count(db, "SELECT COUNT(*) AS total " + PRESS_FROM_JOINS + " WHERE " + publicWhere),
    count(db, "SELECT COUNT(*) AS total " + PRESS_FROM_JOINS + " WHERE " + displayWhere + " AND i.discovered_at >= ?", since),
    db.prepare("SELECT MAX(i.published_date) AS latest " + PRESS_FROM_JOINS + " WHERE " + displayWhere).first<{ latest: string | null }>(),
    db.prepare("SELECT survey_category, COUNT(*) AS total, MAX(registry_version) AS version FROM press_org_survey GROUP BY survey_category").all<{ survey_category: string; total: number; version: string }>(),
    count(db, "SELECT COUNT(DISTINCT i.related_group_id) AS total FROM press_item i JOIN press_source s ON s.source_id = i.source_id WHERE i.related_group_id IS NOT NULL AND i.public_status = 'PUBLIC' AND s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1"),
    count(db, "SELECT COUNT(*) AS total FROM (SELECT i.duplicate_group_id FROM press_item i JOIN press_source s ON s.source_id = i.source_id WHERE i.duplicate_group_id IS NOT NULL AND i.public_status = 'PUBLIC' AND s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1 GROUP BY i.duplicate_group_id HAVING COUNT(*) >= 2)"),
    count(db, "SELECT COUNT(*) AS total " + PRESS_FROM_JOINS + " WHERE " + displayWhere),
  ]);
  const rows = sources.results;
  const targetOrganizations = types.results.reduce((sum, row) => sum + row.total, 0);
  const verified = new Set(rows.filter((row) => row.verification_status === "ENDPOINT_VERIFIED").map((row) => row.organization_id));
  const active = rows.filter((row) => row.approval_status === "POLICY_APPROVED" && row.enabled === 1);
  const normal = new Set(active.filter((row) => row.technical_status === "NORMAL" && (row.last_success_at ?? 0) >= since).map((row) => row.organization_id));
  return {
    registry_version: rows[0]?.registry_version ?? "",
    targets: { organizations: targetOrganizations, by_type: Object.fromEntries(types.results.map((row) => [row.org_type, row.total])), basis: "시드(대시보드 자료 기준, 공식 행정기관 코드 목록으로 검증되지 않음)" },
    coverage: {
      registered_sources: rows.length,
      reviewed_organizations: new Set(rows.map((row) => row.organization_id)).size,
      sources_by_verification: rows.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.verification_status]: (counts[row.verification_status] ?? 0) + 1 }), {}),
      endpoint_verified_organizations: verified.size,
      approved_active_sources: active.length,
      normal_organizations_24h: normal.size,
      denominator_note: "대상기관 수에 대한 검증·정상수집 기관의 비율이며 전국 수집률이 아닙니다.",
    },
    runs_24h: { total: runs?.total ?? 0, succeeded: runs?.succeeded ?? 0, gap_possible: runs?.gaps ?? 0, gap_recovered: runs?.recovered ?? 0 },
    items: { public_total: publicItems, post_count: publicItems, display_total: displayItems, related_group_count: relatedGroups, release_group_count: releaseGroups, discovered_24h: newItems, latest_published_date: latest?.latest ?? "" },
    // 기관별 게시판 조사 상태(작업지시서 다섯 분류). 등록 기관 수는 수집 성공률이 아니다.
    survey: {
      registry_version: survey.results[0]?.version ?? "",
      by_category: Object.fromEntries(survey.results.map((row) => [row.survey_category, row.total])),
      categories: { endpoint_confirmed: "실제 endpoint 확인", shared_board: "공용 게시판", no_independent_board: "독립 게시판 없음", access_blocked: "접근 차단", unconfirmed: "미확인" },
    },
    retention: {
      note: "원천 목록(RSS·게시판 1쪽)은 최근 일부만 보여 줍니다. 보유창이 정기 수집 간격(" + MAX_SCHEDULE_GAP_HOURS + "시간)보다 짧거나 빠듯한 Source는 하루 4회 조회만으로 전수 수집을 보장하지 않으며, 그 사이 놓친 글은 GAP_POSSIBLE로 기록하고 HTML 게시판은 다음 쪽을 더 읽어 보충합니다. GDELT 등 외부 기사 목록은 쓰지 않습니다.",
      at_risk_sources: active.filter((row) => ["WINDOW_SHORTER_THAN_GAP", "CAPACITY_TIGHT"].includes(assessRetention(row.window_items ?? 0, row.window_oldest ?? "", row.window_newest ?? "").assessment)).map((row) => row.source_id),
    },
    schedule: { mode: "request_driven", slots_kst: PRESS_COLLECTION_HOURS_KST.map((hour) => `${String(hour).padStart(2, "0")}:00`), label: PRESS_SCHEDULE_LABEL, note: SCHEDULE_NOTE },
    sources: rows.map((row) => ({
      source_id: row.source_id, organization_id: row.organization_id, organization_name: row.organization_name, organization_type: row.org_type,
      method: row.method, verification_status: row.verification_status,
      approval_status: row.approval_status, technical_status: row.technical_status, enabled: row.enabled === 1,
      last_success_at: isoOf(row.last_success_at), latest_item_date: row.latest_item_date ?? "",
      retention_window: { oldest_date: row.window_oldest || null, newest_date: row.window_newest || null, measured_at: isoOf(row.window_measured_at), ...assessRetention(row.window_items ?? 0, row.window_oldest ?? "", row.window_newest ?? "") },
    })),
  };
}
