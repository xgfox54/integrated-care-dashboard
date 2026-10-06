import type { SqlDatabase } from "../sql-database.ts";
import { PRESS_CATEGORIES } from "./dictionary.ts";
import { readPendingRelatedGroups } from "./group.ts";
import { crawlerEnabled, guidelineStatus, readCrawlBlocks, readGuidelineReport } from "./operations.ts";

// 관리자 전용: Source 상태·최근 실행, 승인·해제. 인증은 호출하는 API 라우트에서 확인한다.

export type ApprovalAction = "approve" | "revoke";

interface AdminSourceRow {
  readonly source_id: string;
  readonly organization_name: string;
  readonly method: string;
  readonly endpoint_url: string;
  readonly interval_minutes: number;
  readonly verification_status: string;
  readonly verification_note: string;
  readonly endpoint_verified_at: number | null;
  readonly approval_status: string;
  readonly policy_basis: string;
  readonly approved_at: number | null;
  readonly technical_status: string;
  readonly enabled: number;
  readonly last_attempt_at: number | null;
  readonly last_success_at: number | null;
  readonly latest_item_date: string | null;
  readonly consecutive_failures: number | null;
  readonly safe_error: string | null;
  readonly next_due_at: number | null;
  readonly request_interval_sec: number;
  readonly board_name: string;
  readonly copyright_type: string;
  readonly public_nuri_type: string;
  readonly reuse_allowed: number | null;
  readonly collection_hold: string | null;
  readonly hold_until: number | null;
  readonly hold_reason: string | null;
  readonly last_checked_at: number | null;
  readonly robots_decision: string | null;
  readonly robots_rule: string | null;
  readonly item_count: number;
  readonly new_24h: number;
}

interface AdminRunRow {
  readonly run_id: string;
  readonly source_id: string;
  readonly trigger: string;
  readonly started_at: number;
  readonly status: string;
  readonly feed_item_count: number;
  readonly new_count: number;
  readonly updated_count: number;
  readonly welfare_count: number;
  readonly review_count: number;
  readonly non_welfare_count: number;
  readonly rejected_count: number;
  readonly error_code: string;
  readonly coverage_note: string;
}

export interface ReviewQueueRow {
  readonly item_id: string;
  readonly title: string;
  readonly canonical_url: string;
  readonly published_date: string;
  readonly categories: string;
  readonly classification_status: string;
  readonly classification_basis: string;
  readonly rule_classification_status: string;
  readonly reviewed_at: number | null;
  readonly auto_score: number | null;
  readonly organization_name: string;
}

const REVIEW_COLUMNS = "i.item_id, i.title, i.canonical_url, i.published_date, i.categories, i.classification_status, i.classification_basis, i.rule_classification_status, i.reviewed_at, i.auto_score, o.name AS organization_name";
const REVIEW_FROM = "FROM press_item i JOIN press_source s ON s.source_id = i.source_id JOIN press_organization o ON o.organization_id = i.issued_by_org_id WHERE s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1";

/**
 * 2단계 분류: 검토자가 보류 항목을 확정한다. 복지는 15개 분류 중 1~5개, 비복지는 분류 없음.
 * 1단계 규칙 결과(상태·분류)는 처음 한 번만 rule_* 열에 옮겨 두고, 사전 버전은 그대로 둔다. 제목이 바뀌면 수집이 검토를 지운다.
 */
export async function reviewPressClassification(db: SqlDatabase, itemId: string, decision: "WELFARE" | "NON_WELFARE", categories: readonly string[], nowSeconds: number): Promise<"ok" | "invalid" | "not_reviewable"> {
  const known = new Set(PRESS_CATEGORIES.map((category) => category.code));
  const unique = [...new Set(categories)];
  if (decision === "WELFARE" && (unique.length < 1 || unique.length > 5 || unique.some((code) => !known.has(code)))) return "invalid";
  if (decision === "NON_WELFARE" && unique.length) return "invalid";
  const updated = await db.prepare(
    "UPDATE press_item SET rule_classification_status = CASE WHEN rule_classification_status = '' THEN classification_status ELSE rule_classification_status END, " +
      "rule_categories = CASE WHEN rule_categories = '' THEN categories ELSE rule_categories END, classification_status = ?, categories = ?, classification_basis = 'reviewer', reviewed_at = ?, " +
      // 철회된 자료는 다시 공개하지 않는다.
      "public_status = CASE WHEN public_status = 'WITHDRAWN' THEN public_status WHEN ? = 'WELFARE' THEN 'PUBLIC' ELSE 'HIDDEN' END " +
      // 학습 판정(auto_model)으로 확정된 항목도 관리자가 다시 확정할 수 있다.
      "WHERE item_id = ? AND (classification_status = 'NEEDS_REVIEW' OR classification_basis IN ('reviewer', 'auto_model')) RETURNING item_id",
  ).bind(decision, JSON.stringify(unique), nowSeconds, decision, itemId).first<{ item_id: string }>();
  return updated ? "ok" : "not_reviewable";
}

/**
 * 보도자료 한 건 공개 철회(개인정보 혼입·잘못된 게시 등). 원문 주소로 막아, 같은 주소의 모든 Source 항목을 숨기고
 * 나중에 다시 수집되거나 제목이 바뀌어도 공개로 돌아가지 않게 한다. 해제 기능은 두지 않는다.
 */
export async function withdrawPressItem(db: SqlDatabase, target: string, reason: string, nowSeconds: number): Promise<number> {
  const text = reason.trim().slice(0, 200);
  if (!text) throw new Error("REASON_REQUIRED");
  const item = await db.prepare("SELECT canonical_url FROM press_item WHERE item_id = ? OR canonical_url = ? LIMIT 1").bind(target, target).first<{ canonical_url: string }>();
  const url = item?.canonical_url ?? (/^https:\/\//.test(target) ? target : null);
  if (!url) throw new Error("ITEM_NOT_FOUND");
  const results = await db.batch([
    db.prepare("INSERT OR REPLACE INTO press_item_block (canonical_url, reason, blocked_at) VALUES (?, ?, ?)").bind(url, text, nowSeconds),
    db.prepare("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE canonical_url = ?").bind(url),
  ]);
  const changes = (results[1] as { changes?: number; meta?: { changes?: number } } | undefined);
  return changes?.changes ?? changes?.meta?.changes ?? 0;
}

/** 분류 검토 화면 전용(가벼운 조회): 검토 대기·최근 확정·최근 자동 판정과 분류 현황. 수집처·robots 기록은 읽지 않는다. */
export async function readReviewQueue(db: SqlDatabase, limit = 100) {
  const [queue, total, reviewed, autoRecent, stats] = await Promise.all([
    db.prepare("SELECT " + REVIEW_COLUMNS + " " + REVIEW_FROM + " AND i.classification_status = 'NEEDS_REVIEW' ORDER BY i.published_date DESC, i.item_id LIMIT ?").bind(limit).all<ReviewQueueRow>(),
    db.prepare("SELECT COUNT(*) AS n " + REVIEW_FROM + " AND i.classification_status = 'NEEDS_REVIEW'").first<{ n: number }>(),
    db.prepare("SELECT " + REVIEW_COLUMNS + " " + REVIEW_FROM + " AND i.classification_basis = 'reviewer' ORDER BY i.reviewed_at DESC LIMIT 20").all<ReviewQueueRow>(),
    db.prepare("SELECT " + REVIEW_COLUMNS + " " + REVIEW_FROM + " AND i.classification_basis = 'auto_model' ORDER BY i.reviewed_at DESC, i.item_id LIMIT 40").all<ReviewQueueRow>(),
    db.prepare("SELECT classification_basis AS basis, classification_status AS status, COUNT(*) AS n FROM press_item GROUP BY classification_basis, classification_status").all<{ basis: string; status: string; n: number }>(),
  ]);
  return { review_queue: queue.results, review_total: Number(total?.n ?? 0), reviewed: reviewed.results, auto_recent: autoRecent.results, classification_stats: stats.results };
}

export async function readAdminPress(db: SqlDatabase) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const [sources, runs, queue, reviewed, blocks, pendingGroups, enabled, crawlBlocks, audits, changes, report] = await Promise.all([
    db.prepare(
      "SELECT s.source_id, o.name AS organization_name, s.method, s.endpoint_url, s.interval_minutes, s.verification_status, s.verification_note, s.endpoint_verified_at, " +
        "s.approval_status, s.policy_basis, s.approved_at, s.technical_status, s.enabled, c.last_attempt_at, c.last_success_at, c.latest_item_date, c.consecutive_failures, c.safe_error, c.next_due_at, " +
        "s.request_interval_sec, s.board_name, s.copyright_type, s.public_nuri_type, s.reuse_allowed, c.collection_hold, c.hold_until, c.hold_reason, c.last_checked_at, " +
        "(SELECT a.decision FROM press_robots_audit a WHERE a.source_id = s.source_id ORDER BY a.checked_at DESC LIMIT 1) AS robots_decision, " +
        "(SELECT a.robots_rule FROM press_robots_audit a WHERE a.source_id = s.source_id ORDER BY a.checked_at DESC LIMIT 1) AS robots_rule, " +
        "(SELECT COUNT(*) FROM press_item i WHERE i.source_id = s.source_id) AS item_count, " +
        "(SELECT COUNT(*) FROM press_item i WHERE i.source_id = s.source_id AND i.discovered_at >= " + (nowSeconds - 86_400) + ") AS new_24h " +
        "FROM press_source s JOIN press_organization o ON o.organization_id = s.organization_id LEFT JOIN press_crawl_state c ON c.source_id = s.source_id " +
        "ORDER BY CASE WHEN o.org_type = 'CENTRAL' THEN 0 WHEN s.verification_status = 'ENDPOINT_VERIFIED' THEN 1 ELSE 2 END, o.name",
    ).all<AdminSourceRow>(),
    db.prepare(
      "SELECT run_id, source_id, trigger, started_at, status, feed_item_count, new_count, updated_count, welfare_count, review_count, non_welfare_count, rejected_count, error_code, coverage_note, " +
        "requested_url, robots_status, response_size, elapsed_ms, parser_result, http_status " +
        "FROM press_collection_run ORDER BY started_at DESC LIMIT 20",
    ).all<AdminRunRow>(),
    db.prepare("SELECT " + REVIEW_COLUMNS + " " + REVIEW_FROM + " AND i.classification_status = 'NEEDS_REVIEW' ORDER BY i.published_date DESC, i.item_id LIMIT 50").all<ReviewQueueRow>(),
    db.prepare("SELECT " + REVIEW_COLUMNS + " " + REVIEW_FROM + " AND i.classification_basis = 'reviewer' ORDER BY i.reviewed_at DESC LIMIT 20").all<ReviewQueueRow>(),
    db.prepare("SELECT canonical_url, reason, blocked_at FROM press_item_block ORDER BY blocked_at DESC LIMIT 20").all<{ canonical_url: string; reason: string; blocked_at: number }>(),
    readPendingRelatedGroups(db),
    crawlerEnabled(db),
    readCrawlBlocks(db),
    db.prepare(
      "SELECT a.domain, a.target_path, a.organization_id, o.name AS organization_name, a.source_id, a.http_status, a.robots_rule, a.decision, a.decision_reason, a.checked_at, a.changed_at " +
        "FROM press_robots_audit a LEFT JOIN press_organization o ON o.organization_id = a.organization_id ORDER BY a.decision, o.name, a.domain LIMIT 600",
    ).all<Record<string, unknown>>(),
    db.prepare("SELECT change_id, domain, target_path, changed_at, old_decision, new_decision, diff FROM press_robots_change ORDER BY changed_at DESC LIMIT 20").all<Record<string, unknown>>(),
    readGuidelineReport(db, nowSeconds),
  ]);
  const withStatus = sources.results.map((row) => ({
    ...row,
    guideline_status: guidelineStatus({
      method: row.method, approvalStatus: row.approval_status, enabled: row.enabled === 1, technicalStatus: row.technical_status,
      safeError: row.safe_error ?? "", hold: row.collection_hold ?? "", robotsDecision: row.robots_decision ?? null,
    }),
  }));
  return {
    sources: withStatus, runs: runs.results, review_queue: queue.results, reviewed: reviewed.results, item_blocks: blocks.results, pending_groups: pendingGroups,
    crawler_enabled: enabled, crawl_blocks: crawlBlocks, robots_audits: audits.results, robots_changes: changes.results, guideline_report: report,
  };
}

/** 승인은 실제 endpoint 확인을 마친 Source만 받는다. 해제하면 공개 목록에서 즉시 빠진다. */
export async function setPressApproval(db: SqlDatabase, sourceId: string, action: ApprovalAction, nowSeconds: number): Promise<boolean> {
  const statement = action === "approve"
    ? db.prepare(
      "UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1, approved_at = ?, policy_version = policy_version + 1 WHERE source_id = ? AND verification_status = 'ENDPOINT_VERIFIED' " +
        // 공용 게시판(여러 기관이 함께 쓰는 게시판)은 게시판 주인을 발행기관으로 확정할 수 없어 승인하지 않는다.
        "AND NOT EXISTS (SELECT 1 FROM press_org_survey v WHERE v.organization_id = press_source.organization_id AND v.survey_category = 'shared_board') RETURNING source_id",
    ).bind(nowSeconds, sourceId)
    : db.prepare(
      "UPDATE press_source SET approval_status = 'REVOKED', enabled = 0, policy_version = policy_version + 1 WHERE source_id = ? RETURNING source_id",
    ).bind(sourceId);
  return (await statement.first<{ source_id: string }>()) !== null;
}

/** 수집 보류 해제(403·401·CAPTCHA·5xx 일시 중지·기관 요청 검토 뒤 관리자가 다시 켬). 바로 다음 차례에 수집 대상이 된다. */
export async function resumePressHold(db: SqlDatabase, sourceId: string, nowSeconds: number): Promise<boolean> {
  const row = await db.prepare(
    "UPDATE press_crawl_state SET collection_hold = '', hold_until = NULL, hold_reason = '', next_due_at = ? WHERE source_id = ? AND collection_hold <> '' RETURNING source_id",
  ).bind(nowSeconds, sourceId).first<{ source_id: string }>();
  return row !== null;
}

/** 기관의 공식 수집 중단 요청 등으로 관리자가 수집을 보류한다(지침 36항, MANUAL_REVIEW). */
export async function holdPressSource(db: SqlDatabase, sourceId: string, reason: string, nowSeconds: number): Promise<boolean> {
  const row = await db.prepare(
    "INSERT INTO press_crawl_state (source_id, collection_hold, hold_reason, last_checked_at) SELECT source_id, 'MANUAL_REVIEW', ?, ? FROM press_source WHERE source_id = ? " +
      "ON CONFLICT(source_id) DO UPDATE SET collection_hold = 'MANUAL_REVIEW', hold_until = NULL, hold_reason = excluded.hold_reason RETURNING source_id",
  ).bind(reason.trim().slice(0, 300) || "관리자 수집 보류", nowSeconds, sourceId).first<{ source_id: string }>();
  return row !== null;
}
