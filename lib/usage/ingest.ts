// 이용통계 집계기. 검증한 이벤트를 일별 집계표에 더한다. 원시 이벤트 로그는 만들지 않는다.
//
// 중복·재전송 방지: 이벤트마다 먼저 usage_seen_event에 (이벤트 ID, 내용 지문, 이번 요청의 무작위 표식)을 넣는다.
// 이미 있으면 넣지 않는다(ON CONFLICT DO NOTHING). 이어지는 집계 문장은 "그 이벤트 ID의 표식이 이번 요청 것일 때만"
// 실행되므로, 같은 이벤트가 동시에 두 번 와도 한 번만 반영된다. 한 이벤트의 문장들은 같은 D1 batch(트랜잭션)에 묶는다.
//
// 이 모듈은 D1·환경에 직접 기대지 않는다(시험에서 node:sqlite로 같은 SQL을 돌린다).
import {
  ACTIVITY_SLACK_MS,
  MAX_FIRST_REPORT_MS,
  MAX_MEASURE_MS,
  SEARCH_SCOPE_KIND,
  TEMP_STATE_TTL_MS,
  durationBucketSql,
  kstDay,
  msSinceKstMidnight,
  perfBucket,
  shiftDay,
  type EntityKind,
  type FilterKind,
} from "./codes.ts";
import { canonicalEvent, parseUsageEvent, type UsageEvent } from "./schema.ts";

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}

export interface IngestDeps {
  /** 서버 수신 시각(ms). 날짜는 이 값으로 한국시간 기준 계산한다. */
  readonly now: number;
  /** 요청마다 새로 만드는 무작위 표식. */
  nonce(): string;
  /** 사업·제도 키를 통계 ID로 바꾼다. 현재 자료에 없으면 null(거절). */
  resolveEntity(kind: EntityKind, key: string): Promise<number | null>;
  /** 지역·분류 코드가 실제 목록에 있는지. */
  isAllowedFilter(filter: FilterKind, code: string): Promise<boolean>;
}

export interface IngestResult {
  accepted: number;
  duplicate: number;
  rejected: number;
}

const D1_BATCH_LIMIT = 50;
const GUARD = "EXISTS (SELECT 1 FROM usage_seen_event WHERE event_id = ? AND claim = ?)";
const PREV_BUCKET = durationBucketSql("prev_ms");
const LAST_BUCKET = durationBucketSql("last_ms");

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface MeasureState {
  readonly scope: string;
  readonly entityId: number;
  readonly expiresAt: number;
}

interface Context {
  readonly db: SqlDatabase;
  readonly now: number;
  readonly today: string;
  readonly yesterday: string;
  readonly sinceMidnight: number;
  readonly expiresAt: number;
}

function measureScope(event: Extract<UsageEvent, { type: "activity" }>): string {
  return event.tab ? "tab:" + event.tab : "entity:" + event.kind;
}

/** 한 이벤트의 문장 묶음. 첫 문장은 항상 표식(claim) 넣기다. */
function claimStatement(ctx: Context, event: UsageEvent, fingerprint: string, claim: string): SqlStatement {
  return ctx.db
    .prepare("INSERT INTO usage_seen_event (event_id, fp, claim, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING")
    .bind(event.id, fingerprint, claim, ctx.expiresAt);
}

function activityStatements(
  ctx: Context,
  event: Extract<UsageEvent, { type: "activity" }>,
  claim: string,
  entityId: number,
): SqlStatement[] {
  const { db } = ctx;
  const scope = measureScope(event);
  const tab = event.tab ?? "";
  const statements: SqlStatement[] = [
    db
      .prepare(
        "INSERT INTO usage_temp_measure (measure_id, scope, tab, entity_id, day_started, last_ms, prev_ms, is_new, last_at, claim, expires_at) " +
          "SELECT ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ? WHERE " + GUARD + " " +
          "ON CONFLICT(measure_id) DO UPDATE SET prev_ms = usage_temp_measure.last_ms, last_ms = excluded.last_ms, is_new = 0, " +
          "last_at = excluded.last_at, claim = excluded.claim " +
          "WHERE usage_temp_measure.scope = excluded.scope AND usage_temp_measure.entity_id = excluded.entity_id " +
          "AND usage_temp_measure.expires_at > excluded.last_at AND excluded.last_ms > usage_temp_measure.last_ms " +
          "AND excluded.last_ms - usage_temp_measure.last_ms <= (excluded.last_at - usage_temp_measure.last_at) + ?",
      )
      .bind(event.measure, scope, tab, entityId, ctx.today, event.ms, ctx.now, claim, ctx.expiresAt, event.id, claim, ACTIVITY_SLACK_MS),
  ];
  const mine = "FROM usage_temp_measure WHERE measure_id = ? AND claim = ?";
  // 오늘 몫(자정 이후 경과시간까지)과 어제 몫(자정 전으로 넘친 부분)을 나눠 더한다.
  if (event.tab) {
    statements.push(
      db
        .prepare(
          "INSERT INTO usage_daily_tab (day, tab, active_ms, measures) SELECT ?, tab, MIN(last_ms - prev_ms, ?), is_new " + mine + " " +
            "ON CONFLICT(day, tab) DO UPDATE SET active_ms = active_ms + excluded.active_ms, measures = measures + excluded.measures",
        )
        .bind(ctx.today, ctx.sinceMidnight, event.measure, claim),
    );
    if (ctx.sinceMidnight < MAX_MEASURE_MS) {
      statements.push(
        db
          .prepare(
            "INSERT INTO usage_daily_tab (day, tab, active_ms) SELECT ?, tab, (last_ms - prev_ms) - ? " + mine + " AND last_ms - prev_ms > ? " +
              "ON CONFLICT(day, tab) DO UPDATE SET active_ms = active_ms + excluded.active_ms",
          )
          .bind(ctx.yesterday, ctx.sinceMidnight, event.measure, claim, ctx.sinceMidnight),
      );
    }
  } else {
    statements.push(
      db
        .prepare(
          "INSERT INTO usage_daily_entity (day, entity_id, active_ms, active_views) SELECT ?, entity_id, MIN(last_ms - prev_ms, ?), is_new " + mine + " " +
            "ON CONFLICT(day, entity_id) DO UPDATE SET active_ms = active_ms + excluded.active_ms, active_views = active_views + excluded.active_views",
        )
        .bind(ctx.today, ctx.sinceMidnight, event.measure, claim),
    );
    if (ctx.sinceMidnight < MAX_MEASURE_MS) {
      statements.push(
        db
          .prepare(
            "INSERT INTO usage_daily_entity (day, entity_id, active_ms) SELECT ?, entity_id, (last_ms - prev_ms) - ? " + mine + " AND last_ms - prev_ms > ? " +
              "ON CONFLICT(day, entity_id) DO UPDATE SET active_ms = active_ms + excluded.active_ms",
          )
          .bind(ctx.yesterday, ctx.sinceMidnight, event.measure, claim, ctx.sinceMidnight),
      );
    }
  }
  // 활동시간 구간 분포: 누적값이 다른 구간으로 넘어가면 이전 구간에서 빼고 새 구간에 더한다.
  statements.push(
    db
      .prepare(
        "UPDATE usage_daily_duration SET measures = measures - 1 WHERE (day, scope, bucket) IN (" +
          "SELECT day_started, scope, " + PREV_BUCKET + " " + mine + " AND is_new = 0 AND " + PREV_BUCKET + " <> " + LAST_BUCKET + ")",
      )
      .bind(event.measure, claim),
    db
      .prepare(
        "INSERT INTO usage_daily_duration (day, scope, bucket, measures) SELECT day_started, scope, " + LAST_BUCKET + ", 1 " + mine + " " +
          "AND (is_new = 1 OR " + PREV_BUCKET + " <> " + LAST_BUCKET + ") " +
          "ON CONFLICT(day, scope, bucket) DO UPDATE SET measures = measures + 1",
      )
      .bind(event.measure, claim),
  );
  return statements;
}

function searchStatements(
  ctx: Context,
  event: Extract<UsageEvent, { type: "search" }>,
  claim: string,
  matchedEntityId: number | null,
): SqlStatement[] {
  const { db } = ctx;
  const statements = [
    // 검색 상세 열람이 먼저 도착해 '대기' 상태로 있으면 실행 정보를 채우고, 이미 실행으로 센 검색이면 건드리지 않는다.
    db
      .prepare(
        "INSERT INTO usage_temp_search (search_id, day, scope, status, results, match, executed, converted, claim, expires_at) " +
          "SELECT ?, ?, ?, ?, ?, ?, 1, 0, ?, ? WHERE " + GUARD + " " +
          "ON CONFLICT(search_id) DO UPDATE SET day = excluded.day, scope = excluded.scope, status = excluded.status, " +
          "results = excluded.results, match = excluded.match, executed = 1, claim = excluded.claim " +
          "WHERE usage_temp_search.executed = 0 AND usage_temp_search.expires_at > ?",
      )
      .bind(event.search, ctx.today, event.scope, event.status, event.results, event.match, claim, ctx.expiresAt, event.id, claim, ctx.now),
    db
      .prepare(
        "INSERT INTO usage_daily_search (day, scope, status, results, match, searches, converted) " +
          "SELECT day, scope, status, results, match, 1, CASE WHEN status = 'ok' THEN converted ELSE 0 END " +
          "FROM usage_temp_search WHERE search_id = ? AND claim = ? " +
          "ON CONFLICT(day, scope, status, results, match) DO UPDATE SET searches = searches + 1, converted = converted + excluded.converted",
      )
      .bind(event.search, claim),
  ];
  if (matchedEntityId !== null) {
    statements.push(
      db
        .prepare(
          "INSERT INTO usage_daily_entity (day, entity_id, search_matches) SELECT ?, ?, 1 FROM usage_temp_search WHERE search_id = ? AND claim = ? " +
            "ON CONFLICT(day, entity_id) DO UPDATE SET search_matches = search_matches + 1",
        )
        .bind(ctx.today, matchedEntityId, event.search, claim),
    );
  }
  return statements;
}

function entityViewStatements(
  ctx: Context,
  event: Extract<UsageEvent, { type: "entity_view" }>,
  claim: string,
  entityId: number,
): SqlStatement[] {
  const { db } = ctx;
  const viaSearch = event.route === "search" && event.search ? 1 : 0;
  const statements = [
    db
      .prepare(
        "INSERT INTO usage_daily_entity (day, entity_id, views, search_opens) SELECT ?, ?, 1, ? WHERE " + GUARD + " " +
          "ON CONFLICT(day, entity_id) DO UPDATE SET views = views + 1, search_opens = search_opens + excluded.search_opens",
      )
      .bind(ctx.today, entityId, viaSearch, event.id, claim),
    db
      .prepare(
        "INSERT INTO usage_daily_route (day, kind, route, views) SELECT ?, ?, ?, 1 WHERE " + GUARD + " " +
          "ON CONFLICT(day, kind, route) DO UPDATE SET views = views + 1",
      )
      .bind(ctx.today, event.kind, event.route, event.id, claim),
  ];
  if (viaSearch && event.search) {
    // 검색 1건당 전환은 한 번만: 아직 전환 전인 검색만 전환으로 바꾼다. 검색 기록이 아직 없으면 '대기'로 만든다.
    statements.push(
      db
        .prepare(
          "INSERT INTO usage_temp_search (search_id, day, executed, converted, claim, expires_at) SELECT ?, ?, 0, 1, ?, ? WHERE " + GUARD + " " +
            "ON CONFLICT(search_id) DO UPDATE SET converted = 1, claim = excluded.claim " +
            "WHERE usage_temp_search.converted = 0 AND usage_temp_search.expires_at > ?",
        )
        .bind(event.search, ctx.today, claim, ctx.expiresAt, event.id, claim, ctx.now),
      db
        .prepare(
          "INSERT INTO usage_daily_search (day, scope, status, results, match, searches, converted) " +
            "SELECT day, scope, status, results, match, 0, 1 FROM usage_temp_search " +
            "WHERE search_id = ? AND claim = ? AND executed = 1 AND status = 'ok' " +
            "ON CONFLICT(day, scope, status, results, match) DO UPDATE SET converted = converted + 1",
        )
        .bind(event.search, claim),
    );
  }
  return statements;
}

function actionStatements(ctx: Context, event: Extract<UsageEvent, { type: "action" }>, claim: string): SqlStatement[] {
  const { db } = ctx;
  const dailyAction = (outcome: string, guard: string, guardValues: unknown[], ms: number | undefined) =>
    db
      .prepare(
        "INSERT INTO usage_daily_action (day, action, outcome, dest, count, ms_sum, ms_count) SELECT ?, ?, ?, ?, 1, ?, ? WHERE " + guard + " " +
          "ON CONFLICT(day, action, outcome, dest) DO UPDATE SET count = count + 1, ms_sum = ms_sum + excluded.ms_sum, ms_count = ms_count + excluded.ms_count",
      )
      .bind(ctx.today, event.action, outcome, event.dest ?? "", ms ?? 0, ms === undefined ? 0 : 1, ...guardValues);

  if (event.outcome === "click") return [dailyAction("click", GUARD, [event.id, claim], undefined)];

  const op = event.op ?? "";
  const opGuard = "EXISTS (SELECT 1 FROM usage_temp_op WHERE op_id = ? AND claim = ?)";
  const opFreshGuard = "EXISTS (SELECT 1 FROM usage_temp_op WHERE op_id = ? AND claim = ? AND fresh = 1)";
  if (event.outcome === "start") {
    return [
      db
        .prepare(
          "INSERT INTO usage_temp_op (op_id, action, state, fresh, claim, expires_at) SELECT ?, ?, 'start', 1, ?, ? WHERE " + GUARD + " " +
            "ON CONFLICT(op_id) DO NOTHING",
        )
        .bind(op, event.action, claim, ctx.expiresAt, event.id, claim),
      dailyAction("start", opGuard, [op, claim], undefined),
    ];
  }
  const statements = [
    // 끝 소식이 시작보다 먼저 오면 시작도 함께 센다(fresh = 1). 이미 끝난 작업의 두 번째 끝 소식은 무시한다.
    db
      .prepare(
        "INSERT INTO usage_temp_op (op_id, action, state, fresh, claim, expires_at) SELECT ?, ?, ?, 1, ?, ? WHERE " + GUARD + " " +
          "ON CONFLICT(op_id) DO UPDATE SET state = excluded.state, fresh = 0, claim = excluded.claim " +
          "WHERE usage_temp_op.state = 'start' AND usage_temp_op.action = excluded.action AND usage_temp_op.expires_at > ?",
      )
      .bind(op, event.action, event.outcome, claim, ctx.expiresAt, event.id, claim, ctx.now),
    dailyAction("start", opFreshGuard, [op, claim], undefined),
    dailyAction(event.outcome, opGuard, [op, claim], event.ms),
  ];
  if (event.outcome === "failure") {
    statements.push(
      db
        .prepare(
          "INSERT INTO usage_daily_error (day, op, code, count) SELECT ?, ?, ?, 1 WHERE " + opGuard + " " +
            "ON CONFLICT(day, op, code) DO UPDATE SET count = count + 1",
        )
        .bind(ctx.today, event.action, event.error ?? "unknown", op, claim),
    );
  }
  return statements;
}

function simpleStatements(ctx: Context, event: UsageEvent, claim: string): SqlStatement[] {
  const { db } = ctx;
  switch (event.type) {
    case "page_view":
      return [
        db
          .prepare("INSERT INTO usage_daily_page (day, page, views) SELECT ?, ?, 1 WHERE " + GUARD + " ON CONFLICT(day, page) DO UPDATE SET views = views + 1")
          .bind(ctx.today, event.page, event.id, claim),
        db
          .prepare(
            "INSERT INTO usage_daily_screen (day, screen, views) SELECT ?, ?, 1 WHERE " + GUARD + " ON CONFLICT(day, screen) DO UPDATE SET views = views + 1",
          )
          .bind(ctx.today, event.screen, event.id, claim),
      ];
    case "tab_view":
      return [
        db
          .prepare(
            "INSERT INTO usage_daily_tab (day, tab, initial_views, selected_views) SELECT ?, ?, ?, ? WHERE " + GUARD + " " +
              "ON CONFLICT(day, tab) DO UPDATE SET initial_views = initial_views + excluded.initial_views, selected_views = selected_views + excluded.selected_views",
          )
          .bind(ctx.today, event.tab, event.entry === "initial" ? 1 : 0, event.entry === "selected" ? 1 : 0, event.id, claim),
      ];
    case "filter":
      return [
        db
          .prepare(
            "INSERT INTO usage_daily_filter (day, filter, code, uses) SELECT ?, ?, ?, 1 WHERE " + GUARD + " " +
              "ON CONFLICT(day, filter, code) DO UPDATE SET uses = uses + 1",
          )
          .bind(ctx.today, event.filter, event.code, event.id, claim),
      ];
    case "perf":
      return [
        db
          .prepare(
            "INSERT INTO usage_daily_perf (day, metric, page, bucket, count, value_sum) SELECT ?, ?, ?, ?, 1, ? WHERE " + GUARD + " " +
              "ON CONFLICT(day, metric, page, bucket) DO UPDATE SET count = count + 1, value_sum = value_sum + excluded.value_sum",
          )
          .bind(ctx.today, event.metric, event.page ?? "", perfBucket(event.metric, event.value), event.value, event.id, claim),
      ];
    case "error":
      return [
        db
          .prepare(
            "INSERT INTO usage_daily_error (day, op, code, count) SELECT ?, ?, ?, 1 WHERE " + GUARD + " ON CONFLICT(day, op, code) DO UPDATE SET count = count + 1",
          )
          .bind(ctx.today, event.op, event.code, event.id, claim),
      ];
    default:
      return [];
  }
}

async function readSeen(db: SqlDatabase, ids: readonly string[], now: number): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const result = await db
    .prepare("SELECT event_id, fp FROM usage_seen_event WHERE event_id IN (" + placeholders(ids.length) + ") AND expires_at > ?")
    .bind(...ids, now)
    .all<{ event_id: string; fp: string }>();
  return new Map((result.results ?? []).map((row) => [row.event_id, row.fp]));
}

async function readMeasures(db: SqlDatabase, ids: readonly string[]): Promise<Map<string, MeasureState>> {
  if (ids.length === 0) return new Map();
  const result = await db
    .prepare("SELECT measure_id, scope, entity_id, expires_at FROM usage_temp_measure WHERE measure_id IN (" + placeholders(ids.length) + ")")
    .bind(...ids)
    .all<{ measure_id: string; scope: string; entity_id: number; expires_at: number }>();
  return new Map(
    (result.results ?? []).map((row) => [row.measure_id, { scope: row.scope, entityId: Number(row.entity_id), expiresAt: Number(row.expires_at) }]),
  );
}

/** 이벤트 한 건을 문장 묶음으로 바꾼다. 거절이면 null. */
async function planEvent(
  ctx: Context,
  event: UsageEvent,
  claim: string,
  fingerprint: string,
  deps: IngestDeps,
  measures: Map<string, MeasureState>,
): Promise<SqlStatement[] | null> {
  const head = claimStatement(ctx, event, fingerprint, claim);
  switch (event.type) {
    case "entity_view": {
      const entityId = await deps.resolveEntity(event.kind, event.key);
      if (entityId === null) return null;
      return [head, ...entityViewStatements(ctx, event, claim, entityId)];
    }
    case "activity": {
      let entityId = 0;
      if (event.kind && event.key) {
        const resolved = await deps.resolveEntity(event.kind, event.key);
        if (resolved === null) return null;
        entityId = resolved;
      }
      const scope = measureScope(event);
      const known = measures.get(event.measure);
      if (known) {
        if (known.expiresAt <= ctx.now || known.scope !== scope || known.entityId !== entityId) return null;
      } else if (event.ms > MAX_FIRST_REPORT_MS) {
        return null;
      }
      measures.set(event.measure, { scope, entityId, expiresAt: known?.expiresAt ?? ctx.expiresAt });
      return [head, ...activityStatements(ctx, event, claim, entityId)];
    }
    case "search": {
      let matched: number | null = null;
      if (event.match === "matched" && event.key) {
        matched = await deps.resolveEntity(SEARCH_SCOPE_KIND[event.scope], event.key);
        if (matched === null) return null;
      }
      return [head, ...searchStatements(ctx, event, claim, matched)];
    }
    case "filter":
      if (!(await deps.isAllowedFilter(event.filter, event.code))) return null;
      return [head, ...simpleStatements(ctx, event, claim)];
    case "action":
      return [head, ...actionStatements(ctx, event, claim)];
    default:
      return [head, ...simpleStatements(ctx, event, claim)];
  }
}

/** 검증·중복 제거 후 집계에 반영한다. 반환값은 건수만 담는다(요청 내용은 담지 않는다). */
export async function ingestUsageEvents(db: SqlDatabase, rawEvents: readonly unknown[], deps: IngestDeps): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, duplicate: 0, rejected: 0 };
  const events: UsageEvent[] = [];
  for (const raw of rawEvents) {
    const event = parseUsageEvent(raw);
    if (event) events.push(event);
    else result.rejected += 1;
  }
  if (events.length === 0) return result;

  const now = deps.now;
  const today = kstDay(now);
  const ctx: Context = {
    db,
    now,
    today,
    yesterday: shiftDay(today, -1),
    sinceMidnight: msSinceKstMidnight(now),
    expiresAt: now + TEMP_STATE_TTL_MS,
  };
  const fingerprints = await Promise.all(events.map((event) => sha256Hex(canonicalEvent(event))));
  const seen = await readSeen(db, [...new Set(events.map((event) => event.id))], now);
  const measures = await readMeasures(db, [
    ...new Set(events.flatMap((event) => (event.type === "activity" ? [event.measure] : []))),
  ]);

  const groups: SqlStatement[][] = [];
  const planned = new Map<string, string>();
  for (const [index, event] of events.entries()) {
    const fingerprint = fingerprints[index];
    const earlier = seen.get(event.id) ?? planned.get(event.id);
    if (earlier !== undefined) {
      if (earlier === fingerprint) result.duplicate += 1;
      else result.rejected += 1;
      continue;
    }
    const claim = deps.nonce();
    const statements = await planEvent(ctx, event, claim, fingerprint, deps, measures);
    if (!statements) {
      result.rejected += 1;
      continue;
    }
    planned.set(event.id, fingerprint);
    groups.push(statements);
    result.accepted += 1;
  }
  if (groups.length === 0) return result;

  groups[groups.length - 1].push(
    db
      .prepare(
        "INSERT INTO app_setting (key, value, updated_at) VALUES ('usage_last_ingest_at', ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(String(now), Math.floor(now / 1000)),
  );
  // 한 이벤트의 문장은 같은 batch(트랜잭션)에 넣고, batch 하나는 50문장을 넘기지 않는다.
  let batch: SqlStatement[] = [];
  for (const group of groups) {
    if (batch.length > 0 && batch.length + group.length > D1_BATCH_LIMIT) {
      await db.batch(batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length > 0) await db.batch(batch);
  return result;
}

