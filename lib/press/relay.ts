// PC 중계 수집(운영자 승인 2026-10-06). 기관 웹방화벽이 해외 클라우드 서버의 요청을 막는 Source(collect_via = 'relay')는
// 운영자 PC(노트북·데스크톱, 국내 IP)가 정기 시각에 목록 화면과 robots.txt를 받아 그대로 올리고, 서버는 평소 수집과 같은 경로(collectPressSource)로
// 제목·게시일·원문 링크만 뽑아 저장한다. 올린 응답 중 그 Source의 목록 주소와 robots.txt 말고는 쓰지 않는다.
// 두 PC가 동시에 켜져 있으면 먼저 차례를 잡은 PC만 수집한다(app_setting press_relay_claim, 20분). 끝내면 차례를 놓는다.
import type { SqlDatabase } from "../sql-database.ts";
import { collectPressSource, type CollectDeps, type CollectSummary, type FetchResponseLike } from "./collect.ts";
import { crawlerEnabled, requestIntervalSec } from "./operations.ts";
import { listDueSources, readSource } from "./store.ts";
import { readTruncatedItems } from "./title-complete.ts";
import { VERIFIED_RELAY_ROUTES } from "./verified-relay-routes.ts";

export const RELAY_CLAIM_SECONDS = 20 * 60;
const CLAIM_KEY = "press_relay_claim";
const PCS_KEY = "press_relay_pcs";
const MAX_PCS = 6;
// 서버 간헐 실패 게시판을 옮겨(2026-10-09, drizzle/0094) 중계 대상이 90여 곳이라 한 차례에 모두 받도록 늘린다.
const MAX_JOBS = 120;
/** 목록과 함께 받아 올 원문 화면(제목이 줄어 저장된 글) 수. 수집기 1회 보완 건수와 같다. */
const DETAIL_PAGES_PER_JOB = 3;
/** 응답 하나의 최대 크기(바이트). 수집기 상한(2MB)과 같다. */
export const RELAY_MAX_BYTES = 2_000_000;

export interface RelayToken {
  readonly name: string;
  readonly sha256: string;
}

/** 환경변수 PRESS_RELAY_TOKEN_SHA256: "desktop:<sha256 hex>,...". PC 이름마다 다른 토큰을 쓰고, 지우면 그 PC만 막힌다. */
export function parseRelayTokens(value: string | undefined): RelayToken[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
    const [name, sha256] = entry.split(":");
    return name && sha256 && /^[\w-]{1,40}$/.test(name) && /^[0-9a-f]{64}$/.test(sha256) ? [{ name, sha256 }] : [];
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 관리자 화면에서 등록한 수집 PC. 토큰 원문은 등록할 때 한 번만 보여 주고, 서버에는 SHA-256만 남긴다. */
export interface RelayPc extends RelayToken {
  readonly createdAt: number;
  readonly lastSeenAt: number | null;
}

export async function readRelayPcs(db: SqlDatabase): Promise<RelayPc[]> {
  const row = await db.prepare("SELECT value FROM app_setting WHERE key = ?").bind(PCS_KEY).first<{ value: string }>();
  if (!row) return [];
  try {
    const value: unknown = JSON.parse(row.value);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: unknown) => {
      if (typeof item !== "object" || item === null) return [];
      const { name, sha256, createdAt, lastSeenAt } = item as Record<string, unknown>;
      return typeof name === "string" && typeof sha256 === "string" && typeof createdAt === "number"
        ? [{ name, sha256, createdAt, lastSeenAt: typeof lastSeenAt === "number" ? lastSeenAt : null }]
        : [];
    });
  } catch {
    return [];
  }
}

async function writeRelayPcs(db: SqlDatabase, pcs: readonly RelayPc[], nowSeconds: number): Promise<void> {
  await db.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(PCS_KEY, JSON.stringify(pcs), nowSeconds).run();
}

/** PC 이름: 영문·숫자·-·_ 1~40자. */
export function relayPcName(value: unknown): string | null {
  return typeof value === "string" && /^[\w-]{1,40}$/.test(value.trim()) ? value.trim() : null;
}

/** 수집 PC를 등록(같은 이름이면 토큰 재발급)하고 새 토큰 원문을 한 번만 돌려준다. */
export async function registerRelayPc(db: SqlDatabase, name: string, nowSeconds: number): Promise<string | null> {
  const pcs = (await readRelayPcs(db)).filter((pc) => pc.name !== name);
  if (pcs.length >= MAX_PCS) return null;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await writeRelayPcs(db, [...pcs, { name, sha256: await sha256Hex(token), createdAt: nowSeconds, lastSeenAt: null }], nowSeconds);
  return token;
}

export async function removeRelayPc(db: SqlDatabase, name: string, nowSeconds: number): Promise<boolean> {
  const pcs = await readRelayPcs(db);
  const kept = pcs.filter((pc) => pc.name !== name);
  if (kept.length === pcs.length) return false;
  await writeRelayPcs(db, kept, nowSeconds);
  return true;
}

/** 등록된 PC가 수집 목록을 받아 간 시각(관리자 화면 표시용). */
export async function touchRelayPc(db: SqlDatabase, name: string, nowSeconds: number): Promise<void> {
  // 환경변수로 등록된 PC도 기록한다. 전체 토큰 배열을 다시 쓰면 동시 등록·삭제를 덮어쓸 수 있다.
  if (!relayPcName(name)) return;
  await db.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE app_setting.updated_at <= excluded.updated_at")
    .bind("press_pc_seen:" + name, String(nowSeconds), nowSeconds).run();
}

export async function readRelayHeartbeats(db: SqlDatabase): Promise<{ name: string; lastSeenAt: number }[]> {
  const rows = await db.prepare("SELECT key, updated_at FROM app_setting WHERE key LIKE 'press_pc_seen:%'").all<{ key: string; updated_at: number }>();
  return rows.results.map((row) => ({ name: row.key.slice("press_pc_seen:".length), lastSeenAt: row.updated_at }));
}

/** 관리자 화면: 등록 PC(토큰 해시는 빼고), 지금 차례를 잡은 PC, 중계 수집 Source 상태. */
export async function readRelayStatus(db: SqlDatabase, envNames: readonly string[], nowSeconds: number) {
  const [pcs, claim, sources, heartbeats] = await Promise.all([
    readRelayPcs(db),
    readClaim(db),
    db.prepare(
      "SELECT s.source_id, o.name AS organization_name, s.endpoint_url, c.last_success_at, c.last_attempt_at, c.next_due_at, c.safe_error, c.collection_hold " +
        "FROM press_source s JOIN press_organization o ON o.organization_id = s.organization_id LEFT JOIN press_crawl_state c ON c.source_id = s.source_id " +
        "WHERE s.collect_via = 'relay' ORDER BY o.name",
    ).all<Record<string, unknown>>(),
    readRelayHeartbeats(db),
  ]);
  return {
    pcs: [
      ...envNames.map((name) => ({ name, created_at: null, last_seen_at: heartbeats.find((h) => h.name === name)?.lastSeenAt ?? null, managed: "env" as const })),
      ...pcs.map((pc) => ({ name: pc.name, created_at: pc.createdAt, last_seen_at: heartbeats.find((h) => h.name === pc.name)?.lastSeenAt ?? pc.lastSeenAt, managed: "admin" as const })),
    ],
    claim: claim && claim.pc && claim.until > nowSeconds ? { pc: claim.pc, until: claim.until } : null,
    sources: sources.results,
  };
}

function sameText(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return mismatch === 0;
}

/** Authorization: Bearer <토큰>이 등록된 PC 토큰이면 그 PC 이름. */
export async function relayClientName(authorization: string | null, tokens: readonly RelayToken[]): Promise<string | null> {
  const match = /^Bearer\s+([\w-]{32,128})$/.exec(authorization ?? "");
  if (!match || tokens.length === 0) return null;
  const hash = await sha256Hex(match[1]);
  let found: string | null = null;
  for (const token of tokens) if (sameText(hash, token.sha256)) found = token.name;
  return found;
}

interface Claim { readonly pc: string; readonly until: number; readonly storedValue: string }

async function readClaim(db: SqlDatabase): Promise<Claim | null> {
  const row = await db.prepare("SELECT value FROM app_setting WHERE key = ?").bind(CLAIM_KEY).first<{ value: string }>();
  if (!row) return null;
  const empty = { pc: "", until: 0, storedValue: row.value };
  try {
    const value = JSON.parse(row.value) as Partial<Claim>;
    return typeof value.pc === "string" && typeof value.until === "number" && Number.isFinite(value.until)
      ? { pc: value.pc, until: value.until, storedValue: row.value } : empty;
  } catch {
    return empty;
  }
}

export interface RelayJob {
  readonly sourceId: string;
  readonly endpointUrl: string;
  readonly robotsUrl: string;
  readonly accept: string;
  readonly intervalSec: number;
  /** 제목이 줄어 저장된 글의 원문 주소. PC가 목록과 함께 받아 올리면 서버가 전체 제목을 찾는다(예전 수집기는 무시해도 된다). */
  readonly detailUrls: readonly string[];
}

/** 수집 차례를 잡고 지금 받아 올 목록을 돌려준다. 다른 PC가 차례를 잡고 있으면 빈 목록과 그 PC 이름. */
export async function claimRelayJobs(db: SqlDatabase, pc: string, nowSeconds: number): Promise<{ readonly jobs: readonly RelayJob[]; readonly busyBy: string | null }> {
  if (!(await crawlerEnabled(db))) return { jobs: [], busyBy: null };
  const { ensurePressSlots } = await import('./jobs.ts');
  await ensurePressSlots(db, nowSeconds);
  const claim = await readClaim(db);
  if (claim && claim.pc && claim.pc !== pc && claim.until > nowSeconds) return { jobs: [], busyBy: claim.pc };
  // 인증키는 서버 저장소에서만 사용할 수 있다. 잘못 중계로 넘어가 KEY_REQUIRED가 된 API만 복구한다.
  // 접근 제한·관리자 보류·실행 중 lease는 해제하지 않으며 과거 시도/키 값은 건드리지 않는다.
  const serverApi = "SELECT s.source_id FROM press_source s JOIN press_crawl_state c ON c.source_id = s.source_id " +
    "WHERE s.adapter = 'OpenAPIAdapter' AND s.collect_via = 'relay' AND s.enabled = 1 AND s.approval_status = 'POLICY_APPROVED' " +
    "AND c.safe_error = 'KEY_REQUIRED' AND c.collection_hold = '' AND c.lease_expires_at <= ? " +
    "AND json_extract(CASE WHEN json_valid(s.adapter_profile) THEN s.adapter_profile ELSE '{}' END, '$.keyRef') IN ('data_go_kr', 'seoul_open_data')";
  await db.batch([
    db.prepare("UPDATE press_crawl_state SET next_due_at = ? WHERE source_id IN (" + serverApi + ")").bind(nowSeconds, nowSeconds),
    db.prepare("UPDATE press_source SET collect_via = 'server' WHERE source_id IN (" + serverApi + ")").bind(nowSeconds),
  ]);
  // Only the authenticated existing PC workflow can recover these verified routes. Keep failure audits intact.
  const endpoints = VERIFIED_RELAY_ROUTES.map((route) => `(s.source_id = ? AND s.endpoint_url = ? AND c.consecutive_failures >= ${route.length === 3 ? route[2] : 5})`).join(" OR ");
  const values = VERIFIED_RELAY_ROUTES.flatMap(([id, endpoint]) => [id, endpoint]);
  const eligible = "SELECT s.source_id FROM press_source s JOIN press_crawl_state c ON c.source_id = s.source_id " +
    "WHERE s.collect_via = 'server' AND s.approval_status = 'POLICY_APPROVED' AND s.enabled = 1 " +
    "AND c.collection_hold = '' AND c.lease_expires_at <= ? " +
    // 통신 실패를 원인별로 나누기 전(2026-10-09)에는 아래 네 가지가 모두 NETWORK_ERROR였다. 같은 회복 대상을 유지한다.
    "AND c.safe_error IN ('NETWORK_ERROR', 'RESPONSE_TIMEOUT', 'BODY_READ_TIMEOUT', 'BODY_READ_FAILED', 'DNS_ERROR', 'TLS_ERROR', 'FEED_EMPTY') AND (" + endpoints + ")";
  // D1 batch is transactional: schedule one recovery attempt, then switch the same eligible sources.
  await db.batch([
    db.prepare("UPDATE press_crawl_state SET next_due_at = ? WHERE source_id IN (" + eligible + ")")
      .bind(nowSeconds, nowSeconds, ...values),
    db.prepare("UPDATE press_source SET collect_via = 'relay' WHERE source_id IN (" + eligible + ")")
      .bind(nowSeconds, ...values),
  ]);
  const due = await listDueSources(db, nowSeconds, MAX_JOBS, "relay");
  if (due.length === 0) return { jobs: [], busyBy: null };
  // 읽었던 값이 그대로일 때만 확보한다. 동시 요청과 만료 후 인계도 한 SQL에서 승자를 정한다.
  const acquired = await db.prepare(
    "INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at " +
      "WHERE app_setting.value = ? RETURNING value",
  ).bind(CLAIM_KEY, JSON.stringify({ pc, until: nowSeconds + RELAY_CLAIM_SECONDS }), nowSeconds, claim?.storedValue ?? null).first<{ value: string }>();
  if (!acquired) {
    const current = await readClaim(db);
    return { jobs: [], busyBy: current?.pc && current.until > nowSeconds ? current.pc : null };
  }
  return {
    busyBy: null,
    jobs: await Promise.all(due.map(async (source) => ({
      sourceId: source.sourceId,
      endpointUrl: source.endpointUrl,
      robotsUrl: new URL(source.endpointUrl).origin + "/robots.txt",
      accept: source.adapter === "HTMLBoardAdapter" ? "text/html" : "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
      intervalSec: requestIntervalSec(source.requestIntervalSec),
      detailUrls: (await readTruncatedItems(db, source.sourceId, DETAIL_PAGES_PER_JOB, nowSeconds)).map((item) => item.canonical_url),
    }))),
  };
}

/** 이 PC가 잡은 차례를 놓는다. */
export async function releaseRelayClaim(db: SqlDatabase, pc: string, nowSeconds: number): Promise<void> {
  const claim = await readClaim(db);
  if (claim?.pc === pc) {
    await db.prepare("UPDATE app_setting SET value = ?, updated_at = ? WHERE key = ? AND value = ?")
      .bind(JSON.stringify({ pc: "", until: 0 }), nowSeconds, CLAIM_KEY, claim.storedValue).run();
  }
}

export interface RelayResponse {
  readonly url: string;
  /** 0이면 연결 실패(시간 초과·인증서 오류 등). */
  readonly status: number;
  readonly contentType?: string;
  readonly bodyBase64?: string;
  readonly retryAfterSeconds?: number;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function relayFetcher(responses: ReadonlyMap<string, RelayResponse>) {
  return async (url: string): Promise<FetchResponseLike> => {
    const uploaded = responses.get(url);
    // PC가 받지 않은 주소(2·3쪽 등)는 없는 것으로 본다. 서버는 기관에 직접 요청하지 않는다.
    if (!uploaded) return new Response(null, { status: 404 });
    if (uploaded.status === 0) throw new Error("PC에서 연결하지 못했습니다.");
    const nullBody = [101, 204, 205, 304].includes(uploaded.status);
    const bytes = !nullBody && uploaded.bodyBase64 ? decodeBase64(uploaded.bodyBase64) : null;
    if (bytes && bytes.length > RELAY_MAX_BYTES) throw new Error("응답이 너무 큽니다.");
    const headers = new Headers();
    if (uploaded.contentType) headers.set('content-type', uploaded.contentType);
    if (uploaded.retryAfterSeconds !== undefined) headers.set('retry-after', String(uploaded.retryAfterSeconds));
    return new Response(bytes, { status: uploaded.status, headers });
  };
}

/** 유효한 차례를 가진 PC의 응답만 처리한다. 중계 대상이 아니거나 승인되지 않은 Source면 null. */
export async function processRelayResult(
  db: SqlDatabase, pc: string, sourceId: string, uploaded: readonly RelayResponse[], deps: Pick<CollectDeps, "now" | "newId">,
): Promise<CollectSummary | null> {
  const source = await readSource(db, sourceId);
  if (!source || source.collectVia !== "relay" || !source.enabled || source.approvalStatus !== "POLICY_APPROVED") return null;
  const robotsUrl = new URL(source.endpointUrl).origin + "/robots.txt";
  const details = (await readTruncatedItems(db, sourceId, DETAIL_PAGES_PER_JOB, deps.now())).map((item) => item.canonical_url);
  const allowed = new Set([source.endpointUrl, robotsUrl, ...details]);
  const responses = new Map(uploaded.filter((item) => allowed.has(item.url)).map((item) => [item.url, item]));
  if (!responses.has(source.endpointUrl)) return null;
  const claim = await readClaim(db);
  if (!claim || claim.pc !== pc || claim.until <= deps.now()) return null;
  return collectPressSource(db, { source, trigger: "relay" }, {
    fetcher: relayFetcher(responses),
    now: deps.now,
    newId: deps.newId,
    // 요청 간격은 PC가 지킨다. 서버는 올린 응답을 바로 처리한다.
    sleep: async () => undefined,
    // 원문 제목 보완은 PC가 함께 올린 원문 화면으로만 한다. 서버는 기관에 직접 요청하지 않는다.
    detailAllowed: (address) => details.includes(address) && responses.has(address),
  }).then((summary) => ({ ...summary, relayPc: pc }));
}
