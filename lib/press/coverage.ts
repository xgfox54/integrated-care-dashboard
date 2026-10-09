import type { SqlDatabase } from "../sql-database.ts";
import { duplicateRepresentativeSql, PRESS_FROM_JOINS, PUBLIC_PRESS_CLAUSES } from "./query.ts";
import { publicNewsClause } from "../platform/public-pin.ts";
import { MAX_SCHEDULE_GAP_HOURS, PRESS_COLLECTION_HOURS_KST, PRESS_SCHEDULE_LABEL, previousCollectionSlot } from "./schedule.ts";
import { readRelayPcs } from "./relay.ts";
import { COLLECTION_TARGET } from "./operations.ts";
import { readSchedulerSignal } from "./tick.ts";

// 수집 범위·성공률을 분모와 함께 보여 준다. 등록 기관 수를 수집 성공률로 쓰지 않는다.

const DAY_SECONDS = 24 * 60 * 60;
export const SCHEDULE_NOTE =
  `${PRESS_SCHEDULE_LABEL}에 수집합니다. 이 호스팅은 예약 작업을 실행하지 않아, 등록된 수집 PC의 예약 작업이 15분마다 인증된 정기 수집 경로를 불러 각 시각이 지난 기관을 처리합니다(방문 요청은 보조). 수집 PC가 모두 꺼져 있으면 다음 방문이나 PC 실행까지 늦어지며, 그 지연은 아래 스케줄러 신호와 회차별 현황에 드러납니다. 원문 게시 즉시 반영이나 전국 무누락을 뜻하지 않습니다.`;
/** 스케줄러 신호가 이 시간(초)보다 오래되면 지연으로 표시한다(PC 예약 간격 15분의 두 배). */
const SCHEDULER_STALE_SECONDS = 30 * 60;

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
  readonly collect_via: string | null;
  readonly last_attempt_at: number | null;
  readonly next_due_at: number | null;
  readonly safe_error: string | null;
  readonly collection_hold: string | null;
  readonly hold_until: number | null;
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
    // 운영자가 수집 제외로 정한 기관(2026-10-09, 보도자료를 파일 묶음으로만 게시하는 곳 등)은 대상 기관 수에서 뺀다.
    db.prepare("SELECT org_type, COUNT(*) AS total FROM press_organization WHERE lifecycle_status = 'ACTIVE' AND " + COLLECTION_TARGET + " GROUP BY org_type ORDER BY org_type")
      .all<{ org_type: string; total: number }>(),
    db.prepare(
      "SELECT s.source_id, s.organization_id, o.name AS organization_name, o.org_type, s.method, s.interval_minutes, s.verification_status, s.approval_status, s.technical_status, s.enabled, " +
        "c.last_success_at, c.latest_item_date, s.registry_version, c.window_items, c.window_oldest, c.window_newest, c.window_measured_at, " +
        "s.collect_via, c.last_attempt_at, c.next_due_at, c.safe_error, c.collection_hold, c.hold_until FROM press_source s JOIN press_organization o ON o.organization_id = s.organization_id " +
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
  const [signal, pcs] = await Promise.all([readSchedulerSignal(db), readRelayPcs(db)]);
  const slotAt = previousCollectionSlot(nowSeconds);
  const held = (row: SourceStatusRow) => Boolean(row.collection_hold) && !(row.hold_until !== null && row.hold_until <= nowSeconds);
  // 회차별 현황(작업지시서 11-F): 24시간 안에 한 번 성공했다고 네 회차를 모두 정상으로 보지 않는다.
  const slotStatus = (via: string) => {
    const group = active.filter((row) => (row.collect_via ?? "server") === via);
    const succeeded = group.filter((row) => (row.last_success_at ?? 0) >= slotAt).length;
    const failed = group.filter((row) => (row.last_success_at ?? 0) < slotAt && (row.last_attempt_at ?? 0) >= slotAt && !held(row)).length;
    const onHold = group.filter((row) => (row.last_success_at ?? 0) < slotAt && held(row)).length;
    return { sources: group.length, succeeded, failed, held: onHold, not_run: group.length - succeeded - failed - onHold };
  };
  const dueServer = active.filter((row) => (row.collect_via ?? "server") === "server" && (row.next_due_at ?? 0) <= nowSeconds && !held(row));
  const dueRelay = active.filter((row) => row.collect_via === "relay" && (row.next_due_at ?? 0) <= nowSeconds && !held(row));
  const oldest = (group: readonly SourceStatusRow[]) => group.length ? Math.min(...group.map((row) => row.next_due_at ?? 0)) : null;
  // 기관 기준 지표(작업지시서 11-D·E). 승인 소스가 여러 개인 기관은 한 번만 세고, 다른 소스의 오류를 숨기지 않는다.
  const byOrg = new Map<string, SourceStatusRow[]>();
  for (const row of active) byOrg.set(row.organization_id, [...(byOrg.get(row.organization_id) ?? []), row]);
  const success24h = [...byOrg.entries()].filter(([, group]) => group.some((row) => (row.last_success_at ?? 0) >= since)).map(([id]) => id);
  const currentNormal = [...byOrg.entries()].filter(([, group]) => group.every((row) => row.technical_status === "NORMAL" && !held(row) && (row.last_success_at ?? 0) >= since)).map(([id]) => id);
  const lastPcSeen = pcs.reduce<number | null>((latest, pc) => (pc.lastSeenAt && (!latest || pc.lastSeenAt > latest) ? pc.lastSeenAt : latest), null);
  const scheduler = {
    mode: "pc_scheduler_with_request_fallback",
    measured_at: isoOf(nowSeconds),
    last_signal_at: signal ? isoOf(signal.lastTickAt) : "",
    last_signal_by: signal?.by ?? "",
    last_signal_status: signal?.status ?? "NEVER",
    last_work_at: signal?.lastWorkAt ? isoOf(signal.lastWorkAt) : "",
    stale: !signal || nowSeconds - signal.lastTickAt > SCHEDULER_STALE_SECONDS,
    stale_after_minutes: SCHEDULER_STALE_SECONDS / 60,
    relay_pcs: pcs.map((pc) => ({ name: pc.name, last_seen_at: isoOf(pc.lastSeenAt) })),
    relay_pc_last_seen_at: isoOf(lastPcSeen),
    server_due_backlog: dueServer.length,
    server_oldest_due_at: isoOf(oldest(dueServer)),
    relay_due_backlog: dueRelay.length,
    relay_oldest_due_at: isoOf(oldest(dueRelay)),
    note: "수집 PC가 모두 꺼져 있으면 정기 수집 신호가 멈추고 대기열이 쌓입니다. 이때 수집은 방문 요청 때만 1곳씩 진행되며, 이는 정상 완료가 아닙니다.",
  };
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
      approved_active_organizations: byOrg.size,
      organizations_success_24h: success24h.length,
      organizations_current_normal: currentNormal.length,
      organizations_success_24h_but_current_error: success24h.filter((id) => !currentNormal.includes(id)).length,
      denominator_note: "대상기관 수에 대한 검증·정상수집 기관의 비율이며 전국 수집률이 아닙니다.",
    },
    runs_24h: { total: runs?.total ?? 0, succeeded: runs?.succeeded ?? 0, gap_possible: runs?.gaps ?? 0, gap_recovered: runs?.recovered ?? 0 },
    items: { public_total: publicItems, post_count: publicItems, display_total: displayItems, related_group_count: relatedGroups, release_group_count: releaseGroups, discovered_24h: newItems, latest_published_date: latest?.latest ?? "" },
    // 기관별 게시판 조사 상태(작업지시서 다섯 분류). 등록 기관 수는 수집 성공률이 아니다.
    survey: {
      registry_version: survey.results[0]?.version ?? "",
      by_category: Object.fromEntries(survey.results.map((row) => [row.survey_category, row.total])),
      categories: { endpoint_confirmed: "실제 endpoint 확인", shared_board: "공용 게시판", no_independent_board: "독립 게시판 없음", access_blocked: "접근 차단", unconfirmed: "미확인", operator_excluded: "수집 제외(운영자 결정)" },
    },
    retention: {
      note: "원천 목록(RSS·게시판 1쪽)은 최근 일부만 보여 줍니다. 보유창이 정기 수집 간격(" + MAX_SCHEDULE_GAP_HOURS + "시간)보다 짧거나 빠듯한 Source는 하루 4회 조회만으로 전수 수집을 보장하지 않으며, 그 사이 놓친 글은 GAP_POSSIBLE로 기록하고 HTML 게시판은 다음 쪽을 더 읽어 보충합니다. GDELT 등 외부 기사 목록은 쓰지 않습니다.",
      at_risk_sources: active.filter((row) => ["WINDOW_SHORTER_THAN_GAP", "CAPACITY_TIGHT"].includes(assessRetention(row.window_items ?? 0, row.window_oldest ?? "", row.window_newest ?? "").assessment)).map((row) => row.source_id),
    },
    schedule: {
      mode: scheduler.mode, slots_kst: PRESS_COLLECTION_HOURS_KST.map((hour) => `${String(hour).padStart(2, "0")}:00`), label: PRESS_SCHEDULE_LABEL, note: SCHEDULE_NOTE,
      current_slot: { slot_at: isoOf(slotAt), server: slotStatus("server"), relay: slotStatus("relay") },
      scheduler,
    },
    sources: rows.map((row) => ({
      source_id: row.source_id, organization_id: row.organization_id, organization_name: row.organization_name, organization_type: row.org_type,
      method: row.method, verification_status: row.verification_status,
      approval_status: row.approval_status, technical_status: row.technical_status, enabled: row.enabled === 1,
      last_success_at: isoOf(row.last_success_at), latest_item_date: row.latest_item_date ?? "",
      retention_window: { oldest_date: row.window_oldest || null, newest_date: row.window_newest || null, measured_at: isoOf(row.window_measured_at), ...assessRetention(row.window_items ?? 0, row.window_oldest ?? "", row.window_newest ?? "") },
    })),
  };
}
