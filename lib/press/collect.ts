import { classifyTitle } from "./classify.ts";
import { canonicalizeUrl, originIdOf, parsePublicationDate, sha256Hex } from "./normalize.ts";
import { parseBoardProfile, parseHtmlBoard } from "./html-board.ts";
import { parseOpenApiItems, parseOpenApiProfile, withApiKey, type ApiKeyRef } from "./open-api.ts";
import { analyzeRobots, type RobotsAnalysis } from "./robots.ts";
import { blockedBy, crawlerEnabled, readCrawlBlocks, recordRobotsAudit, requestIntervalSec, type CrawlBlock } from "./operations.ts";
import { FeedFormatError, parseRssItems, type PressFeedItem } from "./rss.ts";
import { isPressFetchFailure } from "./fetch.ts";
import { nextCollectionSlot } from "./schedule.ts";
import { completesTitle, extractFullTitle, isTruncatedTitle, readStoredTitles, readTruncatedItems, recordTitleAttempt } from "./title-complete.ts";
import {
  claimCrawlLease, claimHostLease, insertItemStatement, readCrawlState, readExistingTitleHashes, readUrlsHeldElsewhere, releaseCrawlLease,
  releaseHostLease, updateItemStatement, type CrawlState, type PressItemRecord, type PressSource,
} from "./store.ts";
import type { SqlDatabase } from "../sql-database.ts";

// 공식 RSS 한 곳을 증분 수집한다. HTTP 성공만으로 성공으로 치지 않고, 구조 이상(0건·필드 누락)은
// 파서 오류로 보류해 마지막 정상 데이터를 그대로 둔다. 본문 필드는 파서 단계에서 이미 버려진다.

export const USER_AGENT = "IntegratedCareDashboard-PressArchive/1.0";
// 처음 요청 + 재시도 1회. 같은 서버에 요청 간격(3초 이상)을 지키면서 응답 뒤 작업 시간(약 30초) 안에 끝나도록 한다.
const MAX_ATTEMPTS = 2;
const MAX_FEED_BYTES = 2_000_000;
const MAX_REJECTED_RATIO = 0.5;
const MIN_ITEMS_FOR_DRIFT_CHECK = 4;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;
const RETRY_STEP_SECONDS = 30 * 60;
/** 429·5xx 뒤 다음 시도까지 최소 대기(지침 10항 예시 30·60·120·300초 이상). */
const MIN_BACKOFF_SECONDS: readonly number[] = [30, 60, 120, 300];
/** 5xx가 이만큼 잇따르면 그 기관 수집을 SERVER_PAUSE_SECONDS 동안 멈춘다. */
const SERVER_PAUSE_AFTER = 3;
const SERVER_PAUSE_SECONDS = 24 * 3600;
const WRITE_CHUNK = 100;
/** 공백이 의심될 때 더 읽는 쪽 수(2·3쪽). 쪽 사이는 요청 간격만큼 쉬고, 실행이 이 시간을 넘으면 더 읽지 않는다. */
const MAX_BACKFILL_PAGES = 2;
const BACKFILL_DEADLINE_SECONDS = 12;

export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** 읽지 않는 응답의 연결을 해제한다. 메모리 응답·PC 중계에는 생략할 수 있다. */
  discard?(): void;
  text(): Promise<string>;
}
export type PressFetcher = (url: string, headers: Record<string, string>) => Promise<FetchResponseLike>;

export interface CollectDeps {
  readonly fetcher: PressFetcher;
  readonly robotsFetcher?: PressFetcher;
  /** 백그라운드 수집의 전체 통신·대기 마감(Unix 초). 미지정한 수동·PC 중계 실행은 기존 정책을 유지한다. */
  readonly deadlineAt?: number;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly newId: () => string;
  /** Open API Source의 인증키(관리자 저장값). 없으면 그 Source는 KEY_REQUIRED로 막힌다. */
  readonly readApiKey?: (ref: ApiKeyRef) => Promise<string | null>;
  /** PC 중계 수집: PC가 함께 올린 원문 화면 주소만 제목 보완에 쓴다. 없으면 robots·차단 목록이 허용한 원문을 서버가 직접 연다. */
  readonly detailAllowed?: (address: string) => boolean;
}

export interface CollectRequest {
  readonly source: PressSource;
  /** relay: 운영자 PC가 받아 올린 응답으로 처리하는 수집(lib/press/relay.ts). */
  readonly trigger: "scheduled" | "manual" | "relay";
}

export interface RunCounts {
  readonly feedItems: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly rejected: number;
  readonly welfare: number;
  readonly review: number;
  readonly nonWelfare: number;
}

export interface CollectSummary {
  readonly runId: string;
  readonly sourceId: string;
  readonly status: "succeeded" | "not_modified" | "failed" | "skipped_locked" | "skipped_host_busy" | "skipped_disabled" | "skipped_blocked";
  readonly errorCode: string;
  readonly httpStatus: number;
  readonly counts: RunCounts;
  /** 목록이 이전 수집과 겹치지 않으면 GAP_POSSIBLE(사이에 놓친 글이 있을 수 있음). */
  readonly coverageNote?: string;
}

const NO_COUNTS: RunCounts = { feedItems: 0, created: 0, updated: 0, unchanged: 0, rejected: 0, welfare: 0, review: 0, nonWelfare: 0 };

interface Failure {
  readonly errorCode: string;
  readonly technicalStatus: "ERROR" | "BLOCKED" | "URL_CHANGED" | "PARSER_ERROR";
  readonly httpStatus: number;
  readonly retryAfterSeconds: number;
}

type Fetched = { readonly kind: "ok"; readonly response: FetchResponseLike } | { readonly kind: "failure"; readonly failure: Failure };

function failure(errorCode: string, technicalStatus: Failure["technicalStatus"], httpStatus = 0, retryAfterSeconds = 0): Fetched {
  return { kind: "failure", failure: { errorCode, technicalStatus, httpStatus, retryAfterSeconds } };
}

/** 목록 자리에 CAPTCHA·자동입력 방지 화면이 온 것으로 보이는지. 우회하지 않고 수동 검토로 넘긴다. */
export function looksLikeCaptcha(body: string): boolean {
  return /captcha|recaptcha|hcaptcha|turnstile|자동\s*입력\s*방지|보안\s*문자|로봇이\s*아닙니다/i.test(body.slice(0, 20_000));
}

/** 기관 웹방화벽(WAF) 차단 화면. 해외·클라우드 서버 요청을 막은 경우로, 우회하지 않고 수집을 멈춘다(지침 10항). */
export function looksLikeWafBlock(body: string): boolean {
  return /contrary to the web firewall security polic|web application firewall|웹\s*방화벽|보안\s*정책에\s*(의해|따라)\s*차단/i.test(body.slice(0, 5_000));
}

/** 감사 로그에 남길 요청 주소. 인증키·토큰 같은 쿼리 값은 지운다. */
export function redactUrl(address: string): string {
  try {
    const target = new URL(address);
    for (const name of [...target.searchParams.keys()]) if (/key|token|secret|auth|password/i.test(name)) target.searchParams.set(name, "***");
    return target.toString().replace(/%2A%2A%2A/g, "***");
  } catch (error) {
    if (error instanceof TypeError) return "";
    throw error;
  }
}

function statusFailure(response: FetchResponseLike): Failure | null {
  const status = response.status;
  if (status === 304 || (status >= 200 && status < 300)) return null;
  const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, MAX_BACKOFF_SECONDS) : 0;
  if (status === 429) return { errorCode: "RATE_LIMITED", technicalStatus: "BLOCKED", httpStatus: status, retryAfterSeconds };
  if (status === 401 || status === 403) return { errorCode: "ACCESS_DENIED", technicalStatus: "BLOCKED", httpStatus: status, retryAfterSeconds: 0 };
  if (status === 404 || status === 410 || (status >= 300 && status < 400)) return { errorCode: "URL_CHANGED", technicalStatus: "URL_CHANGED", httpStatus: status, retryAfterSeconds: 0 };
  return { errorCode: "UNEXPECTED_STATUS", technicalStatus: "ERROR", httpStatus: status, retryAfterSeconds: 0 };
}

function sameUrl(location: string | null, endpoint: string): boolean {
  if (!location) return false;
  try {
    return new URL(location, endpoint).toString() === new URL(endpoint).toString();
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function hasCollectionTime(deps: CollectDeps, waitSeconds = 0): boolean {
  return deps.deadlineAt === undefined || deps.now() + waitSeconds < deps.deadlineAt;
}

/**
 * 통신 실패를 원인별로 나눈다(작업지시서 6-3). 응답 대기 시간 초과·DNS·TLS·그 밖의 연결 실패를 모두 NETWORK_ERROR로 적지 않는다.
 * 호스팅 fetch 오류 문구는 표준이 아니어서, 알아볼 수 없는 연결 실패만 NETWORK_ERROR로 남긴다.
 */
export function networkFailureCode(error: unknown, phase: "connect" | "body"): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "TimeoutError" || name === "AbortError") return phase === "body" ? "BODY_READ_TIMEOUT" : "RESPONSE_TIMEOUT";
  if (phase === "body") return "BODY_READ_FAILED";
  const message = error instanceof Error ? error.message : "";
  if (/certificate|tls|ssl|handshake/i.test(message)) return "TLS_ERROR";
  if (/dns|resolve|getaddrinfo|enotfound|name not resolved/i.test(message)) return "DNS_ERROR";
  return "NETWORK_ERROR";
}

async function fetchWithRetry(source: PressSource, state: CrawlState, deps: CollectDeps, intervalSec: number): Promise<Fetched> {
  let requestUrl = source.endpointUrl;
  if (source.adapter === "OpenAPIAdapter") {
    const profile = parseOpenApiProfile(source.adapterProfile);
    if (!profile) return failure("PROFILE_INVALID", "PARSER_ERROR");
    if (profile.keyRef !== "none") {
      const key = deps.readApiKey ? await deps.readApiKey(profile.keyRef) : null;
      if (!key) return failure("KEY_REQUIRED", "BLOCKED");
      requestUrl = withApiKey(source.endpointUrl, key);
    }
  }
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: source.adapter === "HTMLBoardAdapter" ? "text/html" : source.adapter === "OpenAPIAdapter" ? "application/json" : "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
  };
  if (source.adapter !== "OpenAPIAdapter") {
    if (state.etag) headers["if-none-match"] = state.etag;
    if (state.lastModified) headers["if-modified-since"] = state.lastModified;
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (!hasCollectionTime(deps)) return failure("TIME_BUDGET_EXCEEDED", "ERROR");
    const last = attempt === MAX_ATTEMPTS - 1;
    try {
      const response = await deps.fetcher(requestUrl, headers);
      if (response.status < 200 || (response.status >= 300 && response.status !== 304)) response.discard?.();
      // 세션 쿠키를 심으려고 같은 주소로 다시 보내는 3xx는 주소 변경이 아니다. 잠시 뒤 다시 요청한다.
      if (response.status >= 300 && response.status < 400 && sameUrl(response.headers.get("location"), source.endpointUrl)) {
        if (last || !hasCollectionTime(deps, intervalSec * (attempt + 1))) return failure("SAME_URL_REDIRECT", "ERROR", response.status);
        await deps.sleep(intervalSec * 1000 * (attempt + 1));
        continue;
      }
      if (response.status < 500) {
        const bad = statusFailure(response);
        return bad ? { kind: "failure", failure: bad } : { kind: "ok", response };
      }
      if (last || !hasCollectionTime(deps, intervalSec * (attempt + 1))) return failure("SERVER_ERROR", "ERROR", response.status);
    } catch (error) {
      if (!isPressFetchFailure(error)) throw error;
      if (last || !hasCollectionTime(deps, intervalSec * (attempt + 1))) return failure(networkFailureCode(error, "connect"), "ERROR");
    }
    await deps.sleep(intervalSec * 1000 * (attempt + 1));
  }
  return failure("NETWORK_ERROR", "ERROR");
}

/**
 * 제목 칸에 본문 요약·담당 정보가 섞인 것으로 보이는지(2026-10-05 춘천·진안·목포에서 발견). 공식 보도자료 제목은 150자를 넘는 일이 드물고,
 * HTML 주석 조각(-->)이나 「전화번호 + 날짜」를 함께 담지 않는다. 걸리면 그 항목을 저장하지 않는다.
 */
export function suspiciousTitle(title: string): boolean {
  return title.length > MAX_PLAUSIBLE_TITLE || /<!--|-->/.test(title) || (/\d{2,4}-\d{3,4}-\d{4}/.test(title) && /20\d{2}[-.]\d{1,2}[-.]\d{1,2}/.test(title));
}
const MAX_PLAUSIBLE_TITLE = 150;

async function toRecords(
  items: readonly PressFeedItem[], source: PressSource, nowSeconds: number,
): Promise<{ readonly records: PressItemRecord[]; readonly rejected: number }> {
  const records: PressItemRecord[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const item of items) {
    // 본문·담당 정보가 섞인 것으로 보이는 제목은 저장하지 않는다(본문 비저장 원칙). 게시판 프로필을 고칠 때까지 그 항목은 거절로 센다.
    const canonicalUrl = item.title && !suspiciousTitle(item.title) ? canonicalizeUrl(item.link, source.allowedHosts) : null;
    if (!canonicalUrl) {
      rejected += 1;
      continue;
    }
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    const published = parsePublicationDate(item.pubDate, nowSeconds);
    const classification = classifyTitle(item.title);
    records.push({
      itemId: `${source.sourceId}:${(await sha256Hex(canonicalUrl)).slice(0, 32)}`,
      sourceId: source.sourceId,
      originId: await originIdOf(canonicalUrl, item.guid),
      canonicalUrl,
      title: item.title,
      titleHash: (await sha256Hex(item.title)).slice(0, 32),
      organizationId: source.organizationId,
      publishedDate: published.date,
      publishedAt: published.epoch,
      precision: published.precision,
      timestampSemantics: source.adapter === "HTMLBoardAdapter" ? "html_list_date" : source.adapter === "OpenAPIAdapter" ? "api_pubdate" : "rss_pubDate",
      discoveredAt: nowSeconds,
      collectedAt: nowSeconds,
      categories: classification.categories,
      classificationStatus: classification.status,
      basis: classification.basis,
      dictionaryVersion: classification.dictionaryVersion,
      publicStatus: classification.status === "WELFARE" ? "PUBLIC" : "HIDDEN",
    });
  }
  return { records, rejected };
}

async function saveRecords(db: SqlDatabase, records: readonly PressItemRecord[]): Promise<Pick<RunCounts, "created" | "updated" | "unchanged"> & { readonly createdIds: ReadonlySet<string> }> {
  const existing = await readExistingTitleHashes(db, records.map((record) => record.itemId));
  // 목록이 다시 줄인 제목을 줘도, 원문에서 보완해 저장한 전체 제목은 그대로 둔다.
  const shortened = records.filter((record) => existing.has(record.itemId) && existing.get(record.itemId) !== record.titleHash && isTruncatedTitle(record.title));
  const stored = shortened.length ? await readStoredTitles(db, shortened.map((record) => record.itemId)) : new Map<string, string>();
  const fresh = records.filter((record) => !existing.has(record.itemId));
  const heldElsewhere = fresh.length ? await readUrlsHeldElsewhere(db, fresh[0].sourceId, fresh.map((record) => record.canonicalUrl)) : new Set<string>();
  const writes = [];
  let created = 0;
  let updated = 0;
  const createdIds = new Set<string>();
  for (const record of records) {
    const known = existing.get(record.itemId);
    if (known === undefined) {
      // 같은 원문 주소를 다른 Source(같은 기관의 게시판·Open API)가 이미 저장했으면 새로 넣지 않는다.
      if (heldElsewhere.has(record.canonicalUrl)) continue;
      created += 1;
      createdIds.add(record.itemId);
      writes.push(insertItemStatement(db, record));
    } else if (known !== record.titleHash && !completesTitle(stored.get(record.itemId) ?? "", record.title)) {
      updated += 1;
      writes.push(updateItemStatement(db, record));
    }
  }
  for (let start = 0; start < writes.length; start += WRITE_CHUNK) await db.batch(writes.slice(start, start + WRITE_CHUNK));
  return { created, updated, unchanged: records.length - created - updated, createdIds };
}

function countClasses(records: readonly PressItemRecord[]): Pick<RunCounts, "welfare" | "review" | "nonWelfare"> {
  const count = (status: string) => records.filter((record) => record.classificationStatus === status).length;
  return { welfare: count("WELFARE"), review: count("NEEDS_REVIEW"), nonWelfare: count("NON_WELFARE") };
}

async function recordRun(
  db: SqlDatabase, request: CollectRequest, run: { readonly id: string; readonly startedAt: number; readonly finishedAt: number },
  outcome: { readonly status: string; readonly errorCode: string; readonly httpStatus: number; readonly counts: RunCounts; readonly coverageNote?: string },
  audit: RunAudit,
): Promise<void> {
  const c = outcome.counts;
  await db.prepare(
    "INSERT INTO press_collection_run (run_id, source_id, trigger, started_at, finished_at, status, http_status, feed_item_count, new_count, updated_count, unchanged_count, rejected_count, welfare_count, review_count, non_welfare_count, error_code, coverage_note, " +
      "requested_url, robots_status, response_size, elapsed_ms, parser_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    run.id, request.source.sourceId, request.trigger, run.startedAt, run.finishedAt, outcome.status, outcome.httpStatus,
    c.feedItems, c.created, c.updated, c.unchanged, c.rejected, c.welfare, c.review, c.nonWelfare, outcome.errorCode, outcome.coverageNote ?? "",
    redactUrl(request.source.endpointUrl), audit.robotsStatus, audit.responseSize, Date.now() - audit.startedMs,
    outcome.status === "succeeded" ? "OK " + c.feedItems + "건" : outcome.status === "not_modified" ? "NOT_MODIFIED" : outcome.errorCode || outcome.status.toUpperCase(),
  ).run();
}

/** 감사 로그(지침 34항)에 덧붙이는 값. 인증키·쿠키는 남기지 않는다. */
interface RunAudit {
  robotsStatus: string;
  responseSize: number;
  readonly startedMs: number;
}

interface Hold {
  readonly kind: "ACCESS_DENIED" | "AUTH_REQUIRED" | "MANUAL_REVIEW" | "SERVER_PAUSED";
  readonly reason: string;
  readonly until: number | null;
}

/** 자동 수집을 멈춰야 하는 실패(지침 10항): 403·401은 관리자 확인 전까지, CAPTCHA는 수동 검토, 5xx 반복은 하루 쉰다. */
function holdFor(bad: Failure, failures: number, nowSeconds: number, relay: boolean): Hold | null {
  if (bad.errorCode === "ACCESS_DENIED") {
    return bad.httpStatus === 401
      ? { kind: "AUTH_REQUIRED", reason: "HTTP 401: 로그인·인증이 필요한 경로라 수집하지 않습니다.", until: null }
      : { kind: "ACCESS_DENIED", reason: "HTTP 403: 기관 서버가 접근을 거부해 자동 수집을 멈췄습니다. 반복 요청하지 않으며 관리자가 확인 뒤 다시 켭니다.", until: null };
  }
  // 서버 요청이 웹방화벽에 막히면 멈추지 않고 PC 중계 수집으로 넘긴다(collectOnce). PC(국내 IP)로도 막히면 그때 멈춘다.
  if (bad.errorCode === "WAF_BLOCKED" && relay) return { kind: "ACCESS_DENIED", reason: "기관 웹방화벽이 수집 서버(해외 클라우드) 요청을 차단했습니다. 우회하지 않고 자동 수집을 멈췄으며 관리자가 확인 뒤 다시 켭니다.", until: null };
  if (bad.errorCode === "CAPTCHA_DETECTED") return { kind: "MANUAL_REVIEW", reason: "목록 대신 CAPTCHA·자동입력 방지 화면이 왔습니다. 우회하지 않고 수동 검토합니다.", until: null };
  if (bad.errorCode === "SERVER_ERROR" && failures >= SERVER_PAUSE_AFTER) {
    return { kind: "SERVER_PAUSED", reason: "서버 오류(5xx)가 " + failures + "회 잇따라 하루 동안 수집을 멈춥니다.", until: nowSeconds + SERVER_PAUSE_SECONDS };
  }
  return null;
}

async function finishFailure(
  db: SqlDatabase, request: CollectRequest, state: CrawlState, token: string, bad: Failure, nowSeconds: number,
): Promise<void> {
  // 실패하면 30분씩 늘려 다시 시도하되 다음 정기 시각을 넘기지 않는다. 서버가 Retry-After를 주면 그보다 앞당기지 않는다.
  // 429·5xx는 30·60·120·300초 이상 기다린다(지침 10항).
  const failures = state.consecutiveFailures + 1;
  const untilNextSlot = nextCollectionSlot(nowSeconds) - nowSeconds;
  const retry = Math.min(RETRY_STEP_SECONDS * failures, untilNextSlot);
  const minimum = bad.errorCode === "RATE_LIMITED" || bad.errorCode === "SERVER_ERROR" ? MIN_BACKOFF_SECONDS[Math.min(failures - 1, MIN_BACKOFF_SECONDS.length - 1)] : 0;
  const delay = Math.min(Math.max(bad.retryAfterSeconds, retry, minimum), MAX_BACKOFF_SECONDS);
  const hold = holdFor(bad, failures, nowSeconds, request.trigger === "relay");
  await db.batch([
    db.prepare(
      "UPDATE press_crawl_state SET consecutive_failures = consecutive_failures + 1, safe_error = ?, next_due_at = ?, last_checked_at = ?, lease_token = '', lease_expires_at = 0 WHERE source_id = ? AND lease_token = ?",
    ).bind(bad.errorCode, nowSeconds + delay, nowSeconds, request.source.sourceId, token),
    ...(hold ? [db.prepare("UPDATE press_crawl_state SET collection_hold = ?, hold_until = ?, hold_reason = ? WHERE source_id = ?").bind(hold.kind, hold.until, hold.reason, request.source.sourceId)] : []),
    db.prepare("UPDATE press_source SET technical_status = ? WHERE source_id = ?").bind(bad.technicalStatus, request.source.sourceId),
  ]);
}

async function finishSuccess(
  db: SqlDatabase, request: CollectRequest, state: CrawlState, token: string,
  result: { readonly latestDate: string; readonly feedItems: number; readonly response: FetchResponseLike; readonly changed: boolean; readonly window?: { readonly oldest: string; readonly newest: string; readonly items: number }; readonly lastSeenPostId?: string },
  nowSeconds: number,
): Promise<void> {
  const latestDate = result.latestDate > state.latestItemDate ? result.latestDate : state.latestItemDate;
  await db.batch([
    db.prepare(
      "UPDATE press_crawl_state SET last_success_at = ?, latest_item_date = ?, etag = ?, last_modified = ?, last_item_count = ?, consecutive_failures = 0, safe_error = '', next_due_at = ?, last_checked_at = ?, " +
        "last_seen_post_id = CASE WHEN ? = '' THEN last_seen_post_id ELSE ? END, collection_hold = '', hold_until = NULL, hold_reason = '', lease_token = '', lease_expires_at = 0 WHERE source_id = ? AND lease_token = ?",
    ).bind(
      nowSeconds, latestDate, result.response.headers.get("etag") ?? state.etag, result.response.headers.get("last-modified") ?? state.lastModified,
      result.changed ? result.feedItems : state.lastItemCount, nextCollectionSlot(nowSeconds), nowSeconds, result.lastSeenPostId ?? "", result.lastSeenPostId ?? "", request.source.sourceId, token,
    ),
    db.prepare("UPDATE press_source SET technical_status = 'NORMAL' WHERE source_id = ?").bind(request.source.sourceId),
    // 원천 목록 보유창(이번에 받은 1쪽 목록의 가장 오래된·최신 게시일과 건수). 304이면 이전 측정을 둔다.
    ...(result.window ? [db.prepare("UPDATE press_crawl_state SET window_items = ?, window_oldest = ?, window_newest = ?, window_measured_at = ? WHERE source_id = ?").bind(result.window.items, result.window.oldest, result.window.newest, nowSeconds, request.source.sourceId)] : []),
  ]);
}

/** Source의 Adapter에 맞는 파서로 목록을 읽는다. HTML 게시판 설정이 잘못되면 파서 오류로 보류한다. */
function parseSourceItems(source: PressSource, body: string): PressFeedItem[] {
  if (source.adapter === "RSSAdapter") return parseRssItems(body);
  if (source.adapter === "OpenAPIAdapter") {
    const apiProfile = parseOpenApiProfile(source.adapterProfile);
    if (!apiProfile) throw new FeedFormatError("PROFILE_INVALID");
    return parseOpenApiItems(body, apiProfile);
  }
  const profile = source.adapter === "HTMLBoardAdapter" ? parseBoardProfile(source.adapterProfile) : null;
  if (!profile) throw new FeedFormatError("PROFILE_INVALID");
  return parseHtmlBoard(body, profile);
}

type RobotsCheck = (address: string) => "ALLOWED" | "DISALLOWED" | "UNREADABLE";

/** 한 번 수집할 때 원문을 열어 제목을 보완하는 최대 건수. 같은 기관 요청 간격을 지키며 실행 시간 안에서만 연다. */
const TITLE_FIX_PER_RUN = 3;

async function completeTruncatedTitles(
  db: SqlDatabase, source: PressSource, deps: CollectDeps, check: { readonly intervalSec: number; readonly allowed: (address: string) => boolean },
): Promise<number> {
  let completed = 0;
  for (const item of await readTruncatedItems(db, source.sourceId, TITLE_FIX_PER_RUN, deps.now())) {
    if (!check.allowed(item.canonical_url)) continue;
    if (!hasCollectionTime(deps, check.intervalSec + 7)) break;
    await deps.sleep(check.intervalSec * 1000);
    let full: string | null = null;
    try {
      const response = await deps.fetcher(item.canonical_url, { "user-agent": USER_AGENT, accept: "text/html" });
      if (response.status === 200) full = extractFullTitle(await response.text(), item.title);
      else response.discard?.();
    } catch (error) {
      if (!isPressFetchFailure(error)) throw error;
    }
    await recordTitleAttempt(db, item, full, deps.now());
    if (full) completed += 1;
  }
  return completed;
}

/**
 * 수집할 때마다 robots.txt를 다시 읽고 점검 기록(press_robots_audit)을 남긴다. 수집 경로가 명시적으로 막혀 있으면 가져오지 않는다(우회 없음).
 * 읽을 수 없으면(401·5xx·HTML·시간 초과) CHECK_ERROR로 기록하고 등록 때 내린 판단을 유지해 진행한다(지침 5·32항: robots는 유일한 기준이 아닌 운영 참고값).
 * 한 번 읽어 같은 실행의 다음 쪽에도 쓴다.
 */
async function loadRobots(db: SqlDatabase, source: PressSource, deps: CollectDeps): Promise<{ readonly check: RobotsCheck; readonly analysis: RobotsAnalysis }> {
  const origin = new URL(source.endpointUrl).origin;
  let status: number | null = null;
  let body = "";
  try {
    const response = await (deps.robotsFetcher ?? deps.fetcher)(origin + "/robots.txt", { "user-agent": USER_AGENT, accept: "text/plain" });
    status = response.status;
    body = await response.text();
  } catch (error) {
    if (!isPressFetchFailure(error)) throw error;
    status = null;
  }
  const endpoint = new URL(source.endpointUrl);
  const analysis = analyzeRobots(status, body, USER_AGENT, endpoint.pathname + endpoint.search);
  await recordRobotsAudit(db, {
    address: source.endpointUrl, organizationId: source.organizationId, sourceId: source.sourceId, httpStatus: status, body, userAgent: USER_AGENT, analysis, nowSeconds: deps.now(), newId: deps.newId,
  });
  const check: RobotsCheck = (address) => {
    const target = new URL(address);
    const verdict = analyzeRobots(status, body, USER_AGENT, target.pathname + target.search).verdict;
    // 운영자 예외 Source(근거가 robots_exempt에 남아 있음)는 막힌 경로도 수집한다. 점검 기록에는 원래 판정을 그대로 남긴다.
    if (verdict === "DISALLOWED" && source.robotsExempt) return "ALLOWED";
    return verdict === "NO_ROBOTS" ? "ALLOWED" : verdict;
  };
  return { check, analysis };
}

interface Backfill {
  readonly recovered: boolean;
  readonly feedItems: number;
  readonly rejected: number;
  readonly records: readonly PressItemRecord[];
  readonly saved: Pick<RunCounts, "created" | "updated" | "unchanged">;
}

/**
 * 제한 backfill: HTML 게시판에 다음 쪽 주소 틀이 있으면 2·3쪽을 차례로 읽는다. 어느 쪽의 맨 아래 글이 이미 알던 글이면
 * 지난 수집과 이어진 것이므로 멈춘다(복구). 오류·차단·빈 쪽이면 더 읽지 않고 공백 가능으로 남긴다.
 */
async function backfillPages(
  db: SqlDatabase, source: PressSource, deps: CollectDeps, robots: RobotsCheck, pace: { readonly intervalSec: number; readonly startedAt: number; readonly blocks: readonly CrawlBlock[] },
): Promise<Backfill | null> {
  const profile = source.adapter === "HTMLBoardAdapter" ? parseBoardProfile(source.adapterProfile) : null;
  if (!profile?.page) return null;
  const records: PressItemRecord[] = [];
  const saved = { created: 0, updated: 0, unchanged: 0 };
  let feedItems = 0;
  let rejected = 0;
  for (let page = 2; page <= 1 + MAX_BACKFILL_PAGES; page += 1) {
    const address = profile.page.replace("{page}", String(page));
    if (new URL(address).host !== new URL(source.endpointUrl).host || robots(address) === "DISALLOWED" || blockedBy(pace.blocks, address)) break;
    if (deps.now() - pace.startedAt > BACKFILL_DEADLINE_SECONDS || !hasCollectionTime(deps, pace.intervalSec + 7)) break;
    await deps.sleep(pace.intervalSec * 1000);
    let items: PressFeedItem[];
    try {
      const response = await deps.fetcher(address, { "user-agent": USER_AGENT, accept: "text/html" });
      if (response.status !== 200) {
        response.discard?.();
        break;
      }
      items = parseHtmlBoard(await response.text(), profile);
    } catch (error) {
      if (isPressFetchFailure(error)) break;
      throw error;
    }
    const converted = await toRecords(items, source, deps.now());
    const oldest = converted.records.at(-1);
    if (!oldest) break;
    const { createdIds, ...counts } = await saveRecords(db, converted.records);
    feedItems += items.length;
    rejected += converted.rejected;
    records.push(...converted.records);
    saved.created += counts.created;
    saved.updated += counts.updated;
    saved.unchanged += counts.unchanged;
    if (!createdIds.has(oldest.itemId)) return { recovered: true, feedItems, rejected, records, saved };
  }
  return { recovered: false, feedItems, rejected, records, saved };
}

// allow: SIZE_OK — 실행권·체크포인트·감사 기록의 순서를 보존하는 기존 수집 상태기계. 변경은 통신 경계에 한정한다.
async function collectOnce(db: SqlDatabase, request: CollectRequest, deps: CollectDeps, token: string, runId: string): Promise<CollectSummary> {
  const { source } = request;
  const startedAt = deps.now();
  const intervalSec = requestIntervalSec(source.requestIntervalSec);
  const audit: RunAudit = { robotsStatus: "", responseSize: 0, startedMs: Date.now() };
  const state = await readCrawlState(db, source.sourceId);
  const finishWith = async (summary: Omit<CollectSummary, "runId" | "sourceId">): Promise<CollectSummary> => {
    await recordRun(db, request, { id: runId, startedAt, finishedAt: deps.now() }, { ...summary, status: summary.status }, audit);
    return { runId, sourceId: source.sourceId, ...summary };
  };
  const fail = async (bad: Failure, counts: RunCounts = NO_COUNTS): Promise<CollectSummary> => {
    await finishFailure(db, request, state, token, bad, deps.now());
    return finishWith({ status: "failed", errorCode: bad.errorCode, httpStatus: bad.httpStatus, counts });
  };

  // 관리자 차단 목록(도메인·경로, 지침 35항)에 걸리면 요청하지 않고 다음 정기 시각으로 넘긴다.
  const blocks = await readCrawlBlocks(db);
  if (blockedBy(blocks, source.endpointUrl)) {
    await db.prepare("UPDATE press_crawl_state SET next_due_at = ?, last_checked_at = ? WHERE source_id = ? AND lease_token = ?")
      .bind(nextCollectionSlot(startedAt), startedAt, source.sourceId, token).run();
    return finishWith({ status: "skipped_blocked", errorCode: "CRAWL_BLOCKED", httpStatus: 0, counts: NO_COUNTS });
  }
  const robotsResult = await loadRobots(db, source, deps);
  const robots = robotsResult.check;
  audit.robotsStatus = robotsResult.analysis.decision + (source.robotsExempt && robotsResult.analysis.verdict === "DISALLOWED" ? " (OPERATOR_EXEMPT)" : "");
  if (robots(source.endpointUrl) === "DISALLOWED") {
    return fail({ errorCode: "ROBOTS_DISALLOWED", technicalStatus: "BLOCKED", httpStatus: 0, retryAfterSeconds: 0 });
  }
  // robots.txt를 읽은 같은 서버에 바로 이어 요청하지 않는다(지침 9항: 같은 기관 다음 요청까지 3초 이상).
  if (!hasCollectionTime(deps, intervalSec)) return fail({ errorCode: "TIME_BUDGET_EXCEEDED", technicalStatus: "ERROR", httpStatus: 0, retryAfterSeconds: 0 });
  await deps.sleep(intervalSec * 1000);
  const fetched = await fetchWithRetry(source, state, deps, intervalSec);
  if (fetched.kind === "failure") return fail(fetched.failure);
  const { response } = fetched;
  if (response.status === 304) {
    await finishSuccess(db, request, state, token, { latestDate: "", feedItems: 0, response, changed: false }, deps.now());
    return finishWith({ status: "not_modified", errorCode: "", httpStatus: 304, counts: NO_COUNTS });
  }
  if (Number.parseInt(response.headers.get("content-length") ?? "0", 10) > MAX_FEED_BYTES) {
    response.discard?.();
    return fail({ errorCode: "FEED_TOO_LARGE", technicalStatus: "PARSER_ERROR", httpStatus: response.status, retryAfterSeconds: 0 });
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (!isPressFetchFailure(error)) throw error;
    return fail({ errorCode: networkFailureCode(error, "body"), technicalStatus: "ERROR", httpStatus: response.status, retryAfterSeconds: 0 });
  }
  audit.responseSize = new TextEncoder().encode(body).length;
  if (looksLikeWafBlock(body)) {
    const blocked = await fail({ errorCode: "WAF_BLOCKED", technicalStatus: "BLOCKED", httpStatus: response.status, retryAfterSeconds: 0 });
    // 서버(해외 클라우드)가 막힌 것이면 이 Source를 PC 중계 수집으로 돌리고 다음 PC 수집 때 바로 가져오게 한다(운영자 승인 2026-10-06).
    // 인증키 API는 PC에 키를 전달하지 않으므로 중계로 자동 전환하지 않는다.
    if (request.trigger !== "relay" && (source.adapter !== "OpenAPIAdapter" || parseOpenApiProfile(source.adapterProfile)?.keyRef === "none")) {
      await db.batch([
        db.prepare("UPDATE press_source SET collect_via = 'relay' WHERE source_id = ?").bind(source.sourceId),
        db.prepare("UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = ?").bind(source.sourceId),
      ]);
    }
    return blocked;
  }
  const captcha = { errorCode: "CAPTCHA_DETECTED", technicalStatus: "BLOCKED", httpStatus: response.status, retryAfterSeconds: 0 } as const;
  let feedItems: PressFeedItem[];
  try {
    feedItems = parseSourceItems(source, body);
  } catch (error) {
    // 키가 틀리거나 만료된 것은 구조 이상이 아니라 접근 차단이다.
    if (error instanceof FeedFormatError) {
      if (looksLikeCaptcha(body)) return fail(captcha);
      return fail({ errorCode: error.code, technicalStatus: error.code === "API_KEY_INVALID" ? "BLOCKED" : "PARSER_ERROR", httpStatus: response.status, retryAfterSeconds: 0 });
    }
    // 파서의 예상하지 못한 예외는 통신 오류가 아니라 파서 오류다(작업지시서 6-3). 마지막 정상 데이터는 그대로 둔다.
    if (error instanceof Error) return fail({ errorCode: "PARSER_ERROR", technicalStatus: "PARSER_ERROR", httpStatus: response.status, retryAfterSeconds: 0 });
    throw error;
  }
  if (feedItems.length === 0 && looksLikeCaptcha(body)) return fail(captcha);
  const { records, rejected } = await toRecords(feedItems, source, deps.now());
  const driftCode = feedItems.length === 0
    ? "FEED_EMPTY"
    : feedItems.length >= MIN_ITEMS_FOR_DRIFT_CHECK && rejected / feedItems.length > MAX_REJECTED_RATIO ? "FEED_FIELD_DRIFT" : "";
  if (driftCode) return fail({ errorCode: driftCode, technicalStatus: "PARSER_ERROR", httpStatus: response.status, retryAfterSeconds: 0 }, { ...NO_COUNTS, feedItems: feedItems.length, rejected });

  // 저장이 실패하면 성공 시각·기준점을 옮기지 않고 DB_WRITE_FAILED로 남긴다. 이미 들어간 항목은 item_id가 같아 재시도해도 중복되지 않는다.
  let stored: Awaited<ReturnType<typeof saveRecords>>;
  try {
    stored = await saveRecords(db, records);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return fail({ errorCode: "DB_WRITE_FAILED", technicalStatus: "ERROR", httpStatus: response.status, retryAfterSeconds: 0 }, { ...NO_COUNTS, feedItems: feedItems.length, rejected });
  }
  const { createdIds, ...saved } = stored;
  const gap = gapPossible(records, createdIds, state.lastSuccessAt > 0);
  const backfill = gap ? await backfillPages(db, source, deps, robots, { intervalSec, startedAt, blocks }) : null;
  const coverageNote = !gap ? "" : backfill?.recovered ? "GAP_RECOVERED" : "GAP_POSSIBLE";
  const extra = backfill ?? { feedItems: 0, rejected: 0, records: [], saved: { created: 0, updated: 0, unchanged: 0 } };
  const titlesCompleted = await completeTruncatedTitles(db, source, deps, {
    intervalSec, allowed: deps.detailAllowed ?? ((address) => robots(address) !== "DISALLOWED" && blockedBy(blocks, address) === null),
  });
  const latestDate = records.reduce((latest, record) => (record.publishedDate > latest ? record.publishedDate : latest), "");
  // 모든 글에 게시 시각이 있으면 시각으로, 아니면 날짜로 보유창을 잰다.
  const timed = records.every((record) => record.publishedAt !== null);
  const marks = (timed ? records.map((record) => new Date((record.publishedAt as number) * 1000).toISOString()) : records.map((record) => record.publishedDate)).filter(Boolean).sort();
  const window = marks.length ? { oldest: marks[0], newest: marks[marks.length - 1], items: records.length } : undefined;
  await finishSuccess(db, request, state, token, { latestDate, feedItems: feedItems.length, response, changed: true, window, lastSeenPostId: records[0]?.originId ?? "" }, deps.now());
  return finishWith({
    status: "succeeded", errorCode: "", httpStatus: response.status,
    counts: {
      feedItems: feedItems.length + extra.feedItems, rejected: rejected + extra.rejected,
      created: saved.created + extra.saved.created, updated: saved.updated + extra.saved.updated + titlesCompleted, unchanged: saved.unchanged + extra.saved.unchanged,
      ...countClasses([...records, ...extra.records]),
    },
    coverageNote,
  });
}

/**
 * 이전 수집과 목록이 이어지는지 본다. 목록은 최신 글이 위에 오고 고정 공지는 맨 위에 붙으므로,
 * 맨 아래(가장 오래된) 글이 이번에 처음 본 글이면 그 아래로 놓친 글이 있을 수 있다(GAP_POSSIBLE).
 */
export function gapPossible(records: readonly PressItemRecord[], createdIds: ReadonlySet<string>, hadSuccess: boolean): boolean {
  const oldest = records.at(-1);
  return hadSuccess && oldest !== undefined && createdIds.has(oldest.itemId);
}

/** 수집 한 번. 다른 실행이 같은 Source를 잡고 있으면 아무것도 하지 않는다. */
export async function collectPressSource(db: SqlDatabase, request: CollectRequest, deps: CollectDeps): Promise<CollectSummary> {
  const token = deps.newId();
  const runId = deps.newId();
  // 관리자 전체 수집 스위치(GLOBAL_CRAWLER_ENABLED=false)면 어떤 요청도 보내지 않는다.
  if (!(await crawlerEnabled(db))) return { runId, sourceId: request.source.sourceId, status: "skipped_disabled", errorCode: "CRAWLER_DISABLED", httpStatus: 0, counts: NO_COUNTS };
  if (!(await claimCrawlLease(db, request.source.sourceId, token, deps.now()))) {
    return { runId, sourceId: request.source.sourceId, status: "skipped_locked", errorCode: "", httpStatus: 0, counts: NO_COUNTS };
  }
  const host = new URL(request.source.endpointUrl).hostname;
  try {
    if (!(await claimHostLease(db, host, token, deps.now()))) {
      return { runId, sourceId: request.source.sourceId, status: "skipped_host_busy", errorCode: "", httpStatus: 0, counts: NO_COUNTS };
    }
    try {
      return await collectOnce(db, request, deps, token, runId);
    } finally {
      await releaseHostLease(db, host, token, deps.now() + requestIntervalSec(request.source.requestIntervalSec));
    }
  } finally {
    await releaseCrawlLease(db, request.source.sourceId, token);
  }
}
