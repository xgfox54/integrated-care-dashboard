import type { SqlDatabase, SqlStatement } from "../sql-database.ts";

// 보도자료 아카이브의 DB 접근. 공개 저장 항목은 제목·기관·게시일·원문 링크·분류뿐이다.

export const LEASE_SECONDS = 120;
const ID_CHUNK = 80;

export interface PressSource {
  readonly sourceId: string;
  readonly organizationId: string;
  readonly method: string;
  readonly adapter: string;
  readonly adapterProfile: string;
  readonly endpointUrl: string;
  readonly allowedHosts: readonly string[];
  readonly intervalMinutes: number;
  readonly approvalStatus: string;
  readonly enabled: boolean;
  readonly policyVersion: number;
  /** 같은 기관 서버에 보내는 요청 사이 최소 간격(초). 지침 기본 3초, 기관별로 늘릴 수 있다. */
  readonly requestIntervalSec: number;
  /** 운영자가 robots.txt 예외로 수집하도록 지시한 근거. 비어 있으면 robots.txt 차단을 따른다. */
  readonly robotsExempt: string;
  /** server: 서버가 직접 요청. relay: 기관 웹방화벽 때문에 운영자 PC가 목록 화면을 받아 올린다(lib/press/relay.ts). */
  readonly collectVia: "server" | "relay";
}

interface SourceRow {
  readonly source_id: string;
  readonly organization_id: string;
  readonly method: string;
  readonly adapter: string;
  readonly adapter_profile: string;
  readonly endpoint_url: string;
  readonly allowed_hosts: string;
  readonly interval_minutes: number;
  readonly approval_status: string;
  readonly enabled: number;
  readonly policy_version: number;
  readonly request_interval_sec: number | null;
  readonly robots_exempt: string | null;
  readonly collect_via: string | null;
}

const SOURCE_COLUMNS =
  "s.source_id, s.organization_id, s.method, s.adapter, s.adapter_profile, s.endpoint_url, s.allowed_hosts, s.interval_minutes, s.approval_status, s.enabled, s.policy_version, s.request_interval_sec, s.robots_exempt, s.collect_via";

function parseHosts(json: string): readonly string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((host): host is string => typeof host === "string") : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function toSource(row: SourceRow): PressSource {
  return {
    sourceId: row.source_id,
    organizationId: row.organization_id,
    method: row.method,
    adapter: row.adapter,
    adapterProfile: row.adapter_profile,
    endpointUrl: row.endpoint_url,
    allowedHosts: parseHosts(row.allowed_hosts),
    intervalMinutes: row.interval_minutes,
    approvalStatus: row.approval_status,
    enabled: row.enabled === 1,
    policyVersion: row.policy_version,
    requestIntervalSec: Math.max(3, row.request_interval_sec ?? 3),
    robotsExempt: row.robots_exempt ?? "",
    collectVia: row.collect_via === "relay" ? "relay" : "server",
  };
}

export async function readSource(db: SqlDatabase, sourceId: string): Promise<PressSource | null> {
  const row = await db.prepare(`SELECT ${SOURCE_COLUMNS} FROM press_source s WHERE s.source_id = ?`).bind(sourceId).first<SourceRow>();
  return row ? toSource(row) : null;
}

/**
 * 승인되고 켜진 Source 중 수집 시각이 지났고 다른 실행이 잡고 있지 않은 것.
 * 수집 보류(403·401 접근 거부, CAPTCHA·기관 요청 수동 검토)는 관리자가 풀 때까지, 5xx 반복 일시 중지는 hold_until까지 빠진다.
 */
export async function listDueSources(db: SqlDatabase, nowSeconds: number, limit: number, via: "server" | "relay" = "server"): Promise<PressSource[]> {
  const result = await db.prepare(
    `SELECT ${SOURCE_COLUMNS} FROM press_source s LEFT JOIN press_crawl_state c ON c.source_id = s.source_id ` +
      "WHERE s.collect_via = '" + via + "' AND s.enabled = 1 AND s.approval_status = 'POLICY_APPROVED' AND COALESCE(c.next_due_at, 0) <= ? AND COALESCE(c.lease_expires_at, 0) < ? " +
      "AND (COALESCE(c.collection_hold, '') = '' OR (c.hold_until IS NOT NULL AND c.hold_until <= ?)) " +
      "ORDER BY COALESCE((SELECT MIN(j.slot_at) FROM press_slot_job j WHERE j.source_id = s.source_id AND j.status <> 'succeeded' AND j.retryable = 1 AND j.closed_at IS NULL), 9223372036854775807), COALESCE(c.next_due_at, 0), s.source_id LIMIT ?",
  ).bind(nowSeconds, nowSeconds, nowSeconds, limit).all<SourceRow>();
  return result.results.map(toSource);
}

export interface CrawlState {
  readonly lastSuccessAt: number;
  readonly latestItemDate: string;
  readonly etag: string;
  readonly lastModified: string;
  readonly lastItemCount: number;
  readonly consecutiveFailures: number;
  /** 수집 보류 종류(ACCESS_DENIED·AUTH_REQUIRED·MANUAL_REVIEW·SERVER_PAUSED). 일시 중지가 끝났으면 빈 문자열. */
  readonly hold: string;
}

interface StateRow {
  readonly last_success_at: number;
  readonly latest_item_date: string;
  readonly etag: string;
  readonly last_modified: string;
  readonly last_item_count: number;
  readonly consecutive_failures: number;
  readonly collection_hold: string;
  readonly hold_until: number | null;
}

export async function readCrawlState(db: SqlDatabase, sourceId: string): Promise<CrawlState> {
  const row = await db.prepare(
    "SELECT last_success_at, latest_item_date, etag, last_modified, last_item_count, consecutive_failures, collection_hold, hold_until FROM press_crawl_state WHERE source_id = ?",
  ).bind(sourceId).first<StateRow>();
  const hold = row?.collection_hold ?? "";
  return {
    lastSuccessAt: row?.last_success_at ?? 0,
    latestItemDate: row?.latest_item_date ?? "",
    etag: row?.etag ?? "",
    lastModified: row?.last_modified ?? "",
    lastItemCount: row?.last_item_count ?? 0,
    consecutiveFailures: row?.consecutive_failures ?? 0,
    hold: hold && !(row?.hold_until && row.hold_until <= Math.floor(Date.now() / 1000)) ? hold : "",
  };
}

/** Source 하나를 한 번에 한 실행만 수집하도록 짧은 실행권을 잡는다. */
export async function claimCrawlLease(db: SqlDatabase, sourceId: string, token: string, nowSeconds: number): Promise<boolean> {
  const claimed = await db.prepare(
    "INSERT INTO press_crawl_state (source_id, last_attempt_at, lease_token, lease_expires_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(source_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at " +
      "WHERE press_crawl_state.lease_expires_at < ? RETURNING lease_token",
  ).bind(sourceId, nowSeconds, token, nowSeconds + LEASE_SECONDS, nowSeconds).first<{ lease_token: string }>();
  return claimed?.lease_token === token;
}

/** 같은 호스트(기관 사이트)를 동시에 두 실행이 부르지 않게 하는 실행권. Source가 달라도 호스트가 같으면 한 번에 하나만. */
export async function claimHostLease(db: SqlDatabase, host: string, token: string, nowSeconds: number): Promise<boolean> {
  const claimed = await db.prepare(
    "INSERT INTO press_host_lease (host, lease_token, lease_expires_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(host) DO UPDATE SET lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at WHERE press_host_lease.lease_expires_at < ? RETURNING lease_token",
  ).bind(host, token, nowSeconds + LEASE_SECONDS, nowSeconds).first<{ lease_token: string }>();
  return claimed?.lease_token === token;
}

/** 실행권을 돌려주되 cooldownUntil(마지막 요청 + 요청 간격)까지는 같은 호스트의 다음 실행이 잡지 못하게 한다(지침: 같은 기관 3초 이상 간격). */
export async function releaseHostLease(db: SqlDatabase, host: string, token: string, cooldownUntil = 0): Promise<void> {
  await db.prepare("UPDATE press_host_lease SET lease_token = '', lease_expires_at = ? WHERE host = ? AND lease_token = ?").bind(cooldownUntil, host, token).run();
}

export async function releaseCrawlLease(db: SqlDatabase, sourceId: string, token: string): Promise<void> {
  await db.prepare(
    "UPDATE press_crawl_state SET lease_token = '', lease_expires_at = 0 WHERE source_id = ? AND lease_token = ?",
  ).bind(sourceId, token).run();
}

export interface PressItemRecord {
  readonly itemId: string;
  readonly sourceId: string;
  readonly originId: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly titleHash: string;
  readonly organizationId: string;
  readonly publishedDate: string;
  readonly publishedAt: number | null;
  readonly precision: string;
  readonly timestampSemantics: string;
  readonly discoveredAt: number;
  readonly collectedAt: number;
  readonly categories: readonly string[];
  readonly classificationStatus: string;
  readonly basis: string;
  readonly dictionaryVersion: string;
  readonly publicStatus: string;
}

/** 이미 저장된 항목의 제목 해시. 제목이 바뀐 항목만 갱신하기 위해 쓴다. */
export async function readExistingTitleHashes(db: SqlDatabase, itemIds: readonly string[]): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (let start = 0; start < itemIds.length; start += ID_CHUNK) {
    const chunk = itemIds.slice(start, start + ID_CHUNK);
    const marks = chunk.map(() => "?").join(", ");
    const result = await db.prepare(`SELECT item_id, title_hash FROM press_item WHERE item_id IN (${marks})`)
      .bind(...chunk).all<{ item_id: string; title_hash: string }>();
    for (const row of result.results) hashes.set(row.item_id, row.title_hash);
  }
  return hashes;
}

/** 주소 정정 뒤에도 같은 Source의 기존 게시물 ID를 사용해 중복 저장을 막는다. */
export async function readExistingItemIdsByUrl(db: SqlDatabase, sourceId: string, urls: readonly string[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let start = 0; start < urls.length; start += ID_CHUNK) {
    const chunk = urls.slice(start, start + ID_CHUNK);
    const rows = await db.prepare(`SELECT canonical_url, item_id FROM press_item WHERE source_id = ? AND canonical_url IN (${chunk.map(() => "?").join(", ")})`)
      .bind(sourceId, ...chunk).all<{ readonly canonical_url: string; readonly item_id: string }>();
    for (const row of rows.results) ids.set(row.canonical_url, row.item_id);
  }
  return ids;
}

/** 다른 Source가 이미 같은 원문 주소로 저장한 보도자료(같은 기관의 게시판과 Open API 등). 먼저 본 Source의 항목 하나만 둔다. */
export async function readUrlsHeldElsewhere(db: SqlDatabase, sourceId: string, urls: readonly string[]): Promise<Set<string>> {
  const held = new Set<string>();
  for (let start = 0; start < urls.length; start += ID_CHUNK) {
    const chunk = urls.slice(start, start + ID_CHUNK);
    const marks = chunk.map(() => "?").join(", ");
    const result = await db.prepare(`SELECT DISTINCT canonical_url FROM press_item WHERE canonical_url IN (${marks}) AND source_id <> ?`)
      .bind(...chunk, sourceId).all<{ canonical_url: string }>();
    for (const row of result.results) held.add(row.canonical_url);
  }
  return held;
}

export function insertItemStatement(db: SqlDatabase, item: PressItemRecord): SqlStatement {
  return db.prepare(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, published_at, publication_precision, timestamp_semantics, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
      // 공개 철회한 원문 주소는 다시 수집돼도 철회 상태로 넣는다.
      "SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM press_item_block b WHERE b.canonical_url = ?) THEN 'WITHDRAWN' ELSE ? END",
  ).bind(
    item.itemId, item.sourceId, item.originId, item.canonicalUrl, item.title, item.titleHash, item.organizationId,
    item.publishedDate, item.publishedAt, item.precision, item.timestampSemantics, item.discoveredAt, item.collectedAt,
    JSON.stringify(item.categories), item.classificationStatus, item.basis, item.dictionaryVersion, item.canonicalUrl, item.publicStatus,
  );
}

export function updateItemStatement(db: SqlDatabase, item: PressItemRecord): SqlStatement {
  return db.prepare(
    "UPDATE press_item SET title = ?, title_hash = ?, title_version = title_version + 1, categories = ?, classification_status = ?, classification_basis = ?, dictionary_version = ?, " +
      "public_status = CASE WHEN public_status = 'WITHDRAWN' OR EXISTS (SELECT 1 FROM press_item_block b WHERE b.canonical_url = press_item.canonical_url) THEN 'WITHDRAWN' ELSE ? END, " +
      "collected_at = ?, rule_classification_status = '', rule_categories = '', reviewed_at = NULL WHERE item_id = ?",
  ).bind(
    item.title, item.titleHash, JSON.stringify(item.categories), item.classificationStatus, item.basis,
    item.dictionaryVersion, item.publicStatus, item.collectedAt, item.itemId,
  );
}
