import type { SqlDatabase } from "../sql-database.ts";
import { sha256Hex } from "./normalize.ts";
import type { RobotsAnalysis, RobotsDecision } from "./robots.ts";

// 보도자료 수집 지침(2026-10-05) 운영 장치: 전체 수집 스위치, 도메인·경로 차단 목록, robots.txt 점검 기록·변경 이력, 지침 상태값.

export const GLOBAL_CRAWLER_KEY = "GLOBAL_CRAWLER_ENABLED";
/** 같은 기관 서버에 다음 요청까지 기다리는 최소 시간(지침 8·9항: 3초, 기관별로 더 늘릴 수 있음). */
export const MIN_REQUEST_INTERVAL_SEC = 3;
/** robots.txt 재확인 주기(지침 31항). 수집 중인 Source는 수집할 때마다 다시 읽는다. */
export const ROBOTS_RECHECK_SECONDS = 7 * 24 * 3600;
const MAX_ROBOTS_TEXT = 64_000;
const MAX_DIFF = 4_000;

export function requestIntervalSec(configured: number | null | undefined): number {
  return Math.max(MIN_REQUEST_INTERVAL_SEC, Math.min(60, Number.isFinite(configured) ? Number(configured) : MIN_REQUEST_INTERVAL_SEC));
}

/** 관리자 전체 수집 스위치. 기록이 없으면 켜짐. */
export async function crawlerEnabled(db: SqlDatabase): Promise<boolean> {
  const row = await db.prepare("SELECT value FROM press_crawler_setting WHERE key = ?").bind(GLOBAL_CRAWLER_KEY).first<{ value: string }>();
  return row?.value !== "false";
}

export async function setCrawlerEnabled(db: SqlDatabase, enabled: boolean, nowSeconds: number): Promise<void> {
  await db.prepare("INSERT INTO press_crawler_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(GLOBAL_CRAWLER_KEY, enabled ? "true" : "false", nowSeconds).run();
}

export interface CrawlBlock {
  readonly kind: "DOMAIN" | "PATH";
  readonly pattern: string;
  readonly reason: string;
  readonly created_at: number;
}

export async function readCrawlBlocks(db: SqlDatabase): Promise<CrawlBlock[]> {
  return (await db.prepare("SELECT kind, pattern, reason, created_at FROM press_crawl_block ORDER BY kind, pattern").all<CrawlBlock>()).results;
}

/** 도메인 패턴은 그 호스트와 하위 호스트, 경로 패턴은 "/로 시작하는 경로 앞부분"(모든 호스트) 또는 "호스트/경로 앞부분". */
export function normalizeBlockPattern(kind: CrawlBlock["kind"], raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/^https?:\/\//, "");
  if (!value || value.length > 300 || /\s/.test(value)) return null;
  if (kind === "DOMAIN") return /^[a-z0-9.-]+(:\d+)?$/.test(value.replace(/\/+$/, "")) ? value.replace(/\/+$/, "") : null;
  return value.startsWith("/") || /^[a-z0-9.-]+(:\d+)?\//.test(value) ? value : null;
}

/** 이 주소를 막는 차단 항목. 없으면 null. */
export function blockedBy(blocks: readonly CrawlBlock[], address: string): CrawlBlock | null {
  const target = new URL(address);
  const host = target.host.toLowerCase();
  const path = (target.pathname + target.search).toLowerCase();
  return blocks.find((block) => block.kind === "DOMAIN"
    ? host === block.pattern || host.endsWith("." + block.pattern) || target.hostname.toLowerCase() === block.pattern
    : block.pattern.startsWith("/") ? path.startsWith(block.pattern) : (host + path).startsWith(block.pattern)) ?? null;
}

export async function addCrawlBlock(db: SqlDatabase, kind: CrawlBlock["kind"], pattern: string, reason: string, nowSeconds: number): Promise<boolean> {
  const normalized = normalizeBlockPattern(kind, pattern);
  if (!normalized) return false;
  await db.prepare("INSERT INTO press_crawl_block (kind, pattern, reason, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind, pattern) DO UPDATE SET reason = excluded.reason")
    .bind(kind, normalized, reason.trim().slice(0, 300) || "관리자 차단", nowSeconds).run();
  return true;
}

export async function removeCrawlBlock(db: SqlDatabase, kind: CrawlBlock["kind"], pattern: string): Promise<void> {
  await db.prepare("DELETE FROM press_crawl_block WHERE kind = ? AND pattern = ?").bind(kind, pattern).run();
}

/** 두 robots.txt의 줄 단위 차이(빠진 줄 -, 생긴 줄 +). */
export function robotsDiff(before: string, after: string): string {
  const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const oldLines = lines(before);
  const newLines = lines(after);
  const removed = oldLines.filter((line) => !newLines.includes(line)).map((line) => "- " + line);
  const added = newLines.filter((line) => !oldLines.includes(line)).map((line) => "+ " + line);
  return [...removed, ...added].join("\n").slice(0, MAX_DIFF);
}

export interface RobotsAuditInput {
  readonly address: string;
  readonly organizationId: string | null;
  readonly sourceId: string | null;
  readonly httpStatus: number | null;
  readonly body: string;
  readonly userAgent: string;
  readonly analysis: RobotsAnalysis;
  readonly nowSeconds: number;
  readonly newId: () => string;
}

/** robots.txt 점검 결과를 남기고, 내용(해시)이나 판정이 바뀌었으면 이전 내용과의 차이를 변경 이력으로 남긴다. 읽지 못한 회차는 이전 원문을 지우지 않는다. */
export async function recordRobotsAudit(db: SqlDatabase, input: RobotsAuditInput): Promise<{ readonly changed: boolean; readonly previous: RobotsDecision | null }> {
  const target = new URL(input.address);
  const domain = target.host.toLowerCase();
  const targetPath = target.pathname + target.search;
  const readable = input.analysis.decision !== "CHECK_ERROR";
  const text = readable && input.analysis.decision !== "NO_ROBOTS" ? input.body.slice(0, MAX_ROBOTS_TEXT) : "";
  const hash = readable ? (text ? (await sha256Hex(text)).slice(0, 32) : "none") : "";
  const previous = await db.prepare("SELECT robots_hash, robots_text, decision FROM press_robots_audit WHERE domain = ? AND target_path = ?")
    .bind(domain, targetPath).first<{ robots_hash: string; robots_text: string; decision: RobotsDecision }>();
  const changed = Boolean(previous && readable && previous.robots_hash && (previous.robots_hash !== hash || previous.decision !== input.analysis.decision));
  const statements = [
    db.prepare(
      "INSERT INTO press_robots_audit (domain, target_path, organization_id, source_id, robots_url, checked_at, http_status, robots_hash, robots_text, user_agent, robots_rule, decision, decision_reason, changed_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(domain, target_path) DO UPDATE SET organization_id = COALESCE(excluded.organization_id, press_robots_audit.organization_id), " +
        "source_id = COALESCE(excluded.source_id, press_robots_audit.source_id), checked_at = excluded.checked_at, http_status = excluded.http_status, user_agent = excluded.user_agent, " +
        "robots_hash = CASE WHEN excluded.robots_hash = '' THEN press_robots_audit.robots_hash ELSE excluded.robots_hash END, " +
        "robots_text = CASE WHEN excluded.robots_hash = '' THEN press_robots_audit.robots_text ELSE excluded.robots_text END, " +
        "robots_rule = excluded.robots_rule, decision = excluded.decision, decision_reason = excluded.decision_reason, " +
        "changed_at = CASE WHEN ? = 1 THEN excluded.checked_at ELSE press_robots_audit.changed_at END",
    ).bind(domain, targetPath, input.organizationId, input.sourceId, target.origin + "/robots.txt", input.nowSeconds, input.httpStatus ?? 0, hash, text, input.userAgent,
      input.analysis.rule, input.analysis.decision, input.analysis.reason, changed ? 1 : 0),
  ];
  if (changed && previous) {
    statements.push(db.prepare(
      "INSERT INTO press_robots_change (change_id, domain, target_path, changed_at, old_hash, new_hash, old_decision, new_decision, diff) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(input.newId(), domain, targetPath, input.nowSeconds, previous.robots_hash, hash, previous.decision, input.analysis.decision, robotsDiff(previous.robots_text, text)));
  }
  await db.batch(statements);
  return { changed, previous: previous?.decision ?? null };
}

/** 지침 29항 기관 상태값. 저장된 기술 상태·보류·robots 판정·수집 방식에서 계산한다(수집 가능 여부를 robots 하나로 정하지 않음). */
export type GuidelineStatus = "ACTIVE" | "ROBOTS_PARTIAL" | "ROBOTS_BLOCKED" | "API_ONLY" | "RSS_ONLY" | "TEMPORARY_ERROR" | "ACCESS_DENIED" | "PARSER_ERROR" | "SITE_CHANGED" | "MANUAL_REVIEW";

export function guidelineStatus(input: {
  readonly method: string; readonly approvalStatus: string; readonly enabled: boolean; readonly technicalStatus: string;
  readonly safeError: string; readonly hold: string; readonly robotsDecision: string | null;
}): GuidelineStatus {
  if (input.hold === "ACCESS_DENIED" || input.hold === "AUTH_REQUIRED") return "ACCESS_DENIED";
  if (input.hold === "MANUAL_REVIEW") return "MANUAL_REVIEW";
  if (input.hold === "SERVER_PAUSED") return "TEMPORARY_ERROR";
  if (input.approvalStatus !== "POLICY_APPROVED" || !input.enabled) return "MANUAL_REVIEW";
  if (input.robotsDecision === "BLOCK_ALL") return "MANUAL_REVIEW";
  if (input.robotsDecision === "TARGET_BLOCKED" || input.safeError === "ROBOTS_DISALLOWED") return "ROBOTS_BLOCKED";
  if (["FEED_EMPTY", "FEED_FIELD_DRIFT", "URL_CHANGED"].includes(input.safeError) || input.technicalStatus === "URL_CHANGED") return "SITE_CHANGED";
  if (input.safeError === "ACCESS_DENIED") return "ACCESS_DENIED";
  if (["KEY_REQUIRED", "API_KEY_INVALID"].includes(input.safeError)) return "MANUAL_REVIEW";
  if (input.technicalStatus === "PARSER_ERROR") return "PARSER_ERROR";
  if (input.technicalStatus === "ERROR" || input.technicalStatus === "BLOCKED") return "TEMPORARY_ERROR";
  if (input.method === "OPEN_API") return "API_ONLY";
  if (input.method === "RSS") return "RSS_ONLY";
  return input.robotsDecision === "ALLOW_PARTIAL" ? "ROBOTS_PARTIAL" : "ACTIVE";
}

/** 지침 42항 결과 보고 통계. 기관 수는 등록 기관(시드) 기준이며, robots 분류는 기관마다 가장 최근 점검 하나로 센다. */
export async function readGuidelineReport(db: SqlDatabase, nowSeconds: number) {
  const one = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;
  const active = "s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1";
  const [targets, boards, normal, robots, methods, failures, items, deduped, welfare, audited] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM press_organization WHERE lifecycle_status = 'ACTIVE'"),
    one("SELECT COUNT(DISTINCT organization_id) AS n FROM press_source WHERE verification_status = 'ENDPOINT_VERIFIED'"),
    one("SELECT COUNT(DISTINCT s.organization_id) AS n FROM press_source s JOIN press_crawl_state c ON c.source_id = s.source_id WHERE " + active + " AND s.technical_status = 'NORMAL' AND c.last_success_at >= ?", nowSeconds - 86_400),
    db.prepare("SELECT decision, COUNT(*) AS n FROM (SELECT organization_id, decision, MAX(checked_at) AS checked FROM press_robots_audit WHERE organization_id IS NOT NULL GROUP BY organization_id) GROUP BY decision").all<{ decision: string; n: number }>(),
    db.prepare("SELECT s.method, COUNT(DISTINCT s.organization_id) AS n FROM press_source s WHERE " + active + " GROUP BY s.method").all<{ method: string; n: number }>(),
    db.prepare(
      "SELECT CASE WHEN COALESCE(c.collection_hold, '') <> '' THEN c.collection_hold ELSE COALESCE(NULLIF(c.safe_error, ''), s.technical_status) END AS reason, COUNT(DISTINCT s.organization_id) AS n " +
        "FROM press_source s LEFT JOIN press_crawl_state c ON c.source_id = s.source_id WHERE " + active + " AND (s.technical_status <> 'NORMAL' OR COALESCE(c.collection_hold, '') <> '') GROUP BY reason ORDER BY n DESC",
    ).all<{ reason: string; n: number }>(),
    one("SELECT COUNT(*) AS n FROM press_item"),
    one("SELECT COUNT(DISTINCT COALESCE(duplicate_group_id, related_group_id, item_id)) AS n FROM press_item"),
    one("SELECT COUNT(*) AS n FROM press_item WHERE classification_status = 'WELFARE'"),
    one("SELECT COUNT(DISTINCT organization_id) AS n FROM press_robots_audit WHERE organization_id IS NOT NULL"),
  ]);
  const robotsCount = Object.fromEntries(robots.results.map((row) => [row.decision, row.n])) as Record<string, number>;
  const methodCount = Object.fromEntries(methods.results.map((row) => [row.method, row.n])) as Record<string, number>;
  return {
    target_organizations: targets,
    board_confirmed_organizations: boards,
    normal_organizations_24h: normal,
    robots: {
      audited_organizations: audited, not_yet_audited: Math.max(0, targets - audited),
      allow_all: robotsCount.ALLOW_ALL ?? 0, allow_partial: robotsCount.ALLOW_PARTIAL ?? 0, target_blocked: robotsCount.TARGET_BLOCKED ?? 0,
      block_all: robotsCount.BLOCK_ALL ?? 0, no_robots: robotsCount.NO_ROBOTS ?? 0, check_error: robotsCount.CHECK_ERROR ?? 0,
    },
    api_organizations: methodCount.OPEN_API ?? 0,
    rss_organizations: methodCount.RSS ?? 0,
    html_organizations: methodCount.HTML ?? 0,
    failed_organizations: failures.results.reduce((sum, row) => sum + row.n, 0),
    failure_reasons: failures.results,
    total_items: items,
    deduplicated_items: deduped,
    welfare_items: welfare,
    note: "robots 분류는 운영 참고값이며 수집 가능 여부를 단독으로 정하지 않습니다(지침 32항). 정상 수집은 최근 24시간 안에 성공한 기관입니다.",
  };
}
