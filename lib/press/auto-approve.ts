import type { SqlDatabase } from "../sql-database.ts";
import { USER_AGENT, type PressFetcher } from "./collect.ts";
import { blockedBy, readCrawlBlocks, recordRobotsAudit, ROBOTS_RECHECK_SECONDS } from "./operations.ts";
import { analyzeRobots, type RobotsVerdict } from "./robots.ts";

// 운영자 지시(2026-10-04): robots.txt가 수집 경로를 허용하는 Source는 관리자 승인 없이 자동으로 수집한다.
// endpoint 확인(ENDPOINT_VERIFIED)을 마친 Source만 대상이며, 관리자가 해제한 Source(REVOKED)와 공용 게시판 기관은 건드리지 않는다.
// robots.txt가 없거나(404·410, RFC 9309상 제한 없음) 수집 경로를 허용하면 승인한다. 읽지 못하면(차단 화면·5xx) 승인하지 않고 하루 뒤 다시 본다.
// 승인 뒤에도 수집할 때마다 robots.txt를 다시 읽어, 막히면 그 회차는 가져오지 않는다(collect.ts).

const RECHECK_SECONDS = 24 * 3600;
const AUTO_BASIS = "robots.txt 허용 확인 후 자동 승인(운영자 지시 2026-10-04: robots.txt가 허용하는 사이트는 관리자 승인 없이 수집)";
// 기관이 공개한 Open API는 robots.txt 대상이 아니다(게이트웨이가 /robots.txt에 API 오류를 돌려줌). 이용 근거는 활용신청 승인·포털 이용약관이다.
const API_BASIS = "기관 공개 Open API 자동 승인(운영자 지시 2026-10-04: 지자체 보도자료 API를 아카이빙 파이프라인에 추가). 이용 근거는 공공데이터포털 활용신청 승인 또는 서울 열린데이터광장 이용약관이며, 인증키가 없으면 수집하지 않는다.";
export const AUTO_APPROVE_VERDICTS: readonly RobotsVerdict[] = ["ALLOWED", "NO_ROBOTS"];

interface Candidate {
  readonly source_id: string;
  readonly organization_id: string;
  readonly endpoint_url: string;
  readonly adapter: string;
  readonly robots_exempt: string;
}

export interface AutoApprovalResult {
  readonly sourceId: string;
  readonly verdict: RobotsVerdict | "FETCH_FAILED" | "OPEN_API" | "OPERATOR_EXEMPT";
  readonly approved: boolean;
}

/** robots.txt를 읽어 판정하고 점검 기록을 남긴다. 연결하지 못하면 FETCH_FAILED. */
export async function checkRobots(
  db: SqlDatabase, address: string, fetcher: PressFetcher, nowSeconds: number, ids: { readonly organizationId: string | null; readonly sourceId: string | null },
): Promise<RobotsVerdict | "FETCH_FAILED"> {
  const target = new URL(address);
  let status: number | null = null;
  let body = "";
  try {
    const response = await fetcher(target.origin + "/robots.txt", { "user-agent": USER_AGENT, accept: "text/plain" });
    status = response.status;
    body = await response.text();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  const analysis = analyzeRobots(status, body, USER_AGENT, target.pathname + target.search);
  await recordRobotsAudit(db, { address, ...ids, httpStatus: status, body, userAgent: USER_AGENT, analysis, nowSeconds, newId: () => crypto.randomUUID() });
  return status === null ? "FETCH_FAILED" : analysis.verdict;
}

/** 승인 대기 Source를 limit곳까지 골라 robots.txt를 보고, 허용이면 승인한다. */
export async function autoApproveRobotsAllowed(db: SqlDatabase, fetcher: PressFetcher, nowSeconds: number, limit = 3): Promise<AutoApprovalResult[]> {
  const candidates = await db.prepare(
    "SELECT s.source_id, s.organization_id, s.endpoint_url, s.adapter, s.robots_exempt FROM press_source s LEFT JOIN press_auto_approval a ON a.source_id = s.source_id " +
      "WHERE s.verification_status = 'ENDPOINT_VERIFIED' AND s.approval_status NOT IN ('POLICY_APPROVED', 'REVOKED') " +
      "AND NOT EXISTS (SELECT 1 FROM press_org_survey v WHERE v.organization_id = s.organization_id AND v.survey_category = 'shared_board') " +
      "AND (a.checked_at IS NULL OR a.checked_at <= ?) ORDER BY COALESCE(a.checked_at, 0), s.source_id LIMIT ?",
  ).bind(nowSeconds - RECHECK_SECONDS, limit).all<Candidate>();
  const blocks = await readCrawlBlocks(db);
  const results: AutoApprovalResult[] = [];
  for (const candidate of candidates.results) {
    const openApi = candidate.adapter === "OpenAPIAdapter";
    // 관리자 차단 목록에 걸린 수집처는 robots.txt도 요청하지 않고 승인하지 않는다.
    const blocked = blockedBy(blocks, candidate.endpoint_url) !== null;
    // 운영자가 robots.txt 예외로 수집하라고 지시한 Source(근거가 robots_exempt에 있음)는 robots.txt로 막지 않는다(운영자 지시 2026-10-05).
    const exempt = !blocked && !openApi && candidate.robots_exempt !== "";
    const verdict = blocked ? "FETCH_FAILED" : openApi ? "OPEN_API" : exempt ? "OPERATOR_EXEMPT" : await checkRobots(db, candidate.endpoint_url, fetcher, nowSeconds, { organizationId: candidate.organization_id, sourceId: candidate.source_id });
    const allowed = !blocked && (verdict === "OPEN_API" || verdict === "OPERATOR_EXEMPT" || (verdict !== "FETCH_FAILED" && AUTO_APPROVE_VERDICTS.includes(verdict)));
    const statements = [
      db.prepare("INSERT INTO press_auto_approval (source_id, checked_at, verdict, approved_at) VALUES (?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET checked_at = excluded.checked_at, verdict = excluded.verdict, approved_at = COALESCE(excluded.approved_at, press_auto_approval.approved_at)")
        .bind(candidate.source_id, nowSeconds, verdict, allowed ? nowSeconds : null),
    ];
    if (allowed) {
      statements.push(db.prepare(
        "UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1, approved_at = ?, policy_version = policy_version + 1, policy_basis = ? " +
          "WHERE source_id = ? AND verification_status = 'ENDPOINT_VERIFIED' AND approval_status NOT IN ('POLICY_APPROVED', 'REVOKED')",
      ).bind(nowSeconds, openApi ? API_BASIS : exempt ? candidate.robots_exempt : AUTO_BASIS, candidate.source_id));
    }
    await db.batch(statements);
    results.push({ sourceId: candidate.source_id, verdict, approved: allowed });
  }
  return results;
}

/**
 * robots.txt 전수 점검(지침 20·30·31항): 등록 기관의 보도자료 경로(없으면 홈페이지)를 7일마다 다시 확인해 6종 분류를 남긴다.
 * 수집 중인 Source는 수집할 때마다 따로 다시 읽는다. 차단 목록에 걸린 도메인은 요청하지 않는다. 한 번에 limit곳만 본다.
 */
export async function advanceRobotsAudit(db: SqlDatabase, fetcher: PressFetcher, nowSeconds: number, limit = 1): Promise<number> {
  const rows = (await db.prepare(
    "SELECT v.organization_id, COALESCE(NULLIF(v.endpoint_url, ''), v.homepage_url) AS address FROM press_org_survey v " +
      "WHERE COALESCE(NULLIF(v.endpoint_url, ''), v.homepage_url, '') LIKE 'http%' ORDER BY v.organization_id",
  ).all<{ organization_id: string; address: string }>()).results;
  const audits = new Map((await db.prepare("SELECT domain, target_path, checked_at FROM press_robots_audit").all<{ domain: string; target_path: string; checked_at: number }>()).results
    .map((row) => [row.domain + row.target_path, row.checked_at]));
  const blocks = await readCrawlBlocks(db);
  const due = rows
    .map((row) => {
      try {
        const target = new URL(row.address);
        return { ...row, key: target.host.toLowerCase() + target.pathname + target.search };
      } catch (error) {
        if (error instanceof TypeError) return null;
        throw error;
      }
    })
    .filter((row): row is { organization_id: string; address: string; key: string } => row !== null && !blockedBy(blocks, row.address) && (audits.get(row.key) ?? 0) <= nowSeconds - ROBOTS_RECHECK_SECONDS)
    .sort((a, b) => (audits.get(a.key) ?? 0) - (audits.get(b.key) ?? 0))
    .slice(0, limit);
  for (const row of due) await checkRobots(db, row.address, fetcher, nowSeconds, { organizationId: row.organization_id, sourceId: null });
  return due.length;
}
