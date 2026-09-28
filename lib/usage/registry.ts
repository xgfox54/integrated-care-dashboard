// 이용통계 허용 목록과 통계 ID 등록부(서버 전용).
// - 통합돌봄사업: 현재 운영 자료에 있는 WIKI 키만 받는다. 키가 바뀌어도(보건복지부 문서 재게시, 사업명 변경)
//   같은 지역에서 이름이나 원 서비스 ID가 같고, 예전 키가 현재 자료에서 사라진 후보가 딱 하나면 같은 통계 ID로 잇는다.
//   후보가 여럿이면 잘못 합치지 않도록 새 ID를 만든다.
// - 복지제도: 복지제도100 대장(data/welfare100/usage-registry.json)에 있는 ID만 받는다.
import { getD1 } from "../d1";
import { EMPTY_FILTERS, serviceWikiKey, type ServiceRow } from "../dataset";
import { exportOfficialServices, readLatestRun, readOfficialDatasetSummary } from "../official-query";
import { findOfficialServiceByWikiKey } from "../official-service-query";
import { HOUSEHOLD_ORDER, LIFECYCLE_ORDER, TOPIC_ORDER } from "../welfare100/model";
import { normalizeName, type EntityKind, type FilterKind } from "./codes";

const MEMO_TTL_MS = 10 * 60_000;
const MEMO_LIMIT = 5000;
const WELFARE_SCOPES = new Set(["주요 제도", "중앙부처", "지자체"]);

interface EntityInfo {
  readonly name: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly category: string;
}

interface EntityMatchKeys {
  readonly regionKey: string;
  readonly nameNorm: string;
  readonly serviceNorm: string;
}

export interface WelfareRegistryEntry extends EntityInfo {
  readonly slug: string;
  readonly org: "중앙부처" | "지자체";
  readonly provision: readonly string[];
}

interface WelfareRegistry {
  readonly entries: ReadonlyMap<string, WelfareRegistryEntry>;
  readonly regions: ReadonlySet<string>;
  readonly provisions: ReadonlySet<string>;
}

let welfarePromise: Promise<WelfareRegistry> | null = null;

export function readWelfareRegistry(): Promise<WelfareRegistry> {
  welfarePromise ??= import("../../data/welfare100/usage-registry.json")
    .then((module) => {
      const data = (module as { default: { fields: string[]; items: unknown[][] } }).default;
      const at = (field: string) => data.fields.indexOf(field);
      const [s, n, g, sd, sg, c, pv] = ["s", "n", "g", "sd", "sg", "c", "pv"].map(at);
      const entries = new Map<string, WelfareRegistryEntry>();
      const regions = new Set<string>();
      const provisions = new Set<string>();
      for (const row of data.items) {
        const entry: WelfareRegistryEntry = {
          slug: String(row[s]),
          name: String(row[n]),
          org: row[g] === 0 ? "중앙부처" : "지자체",
          sido: String(row[sd] ?? ""),
          sigungu: String(row[sg] ?? ""),
          category: String(row[c] ?? ""),
          provision: Array.isArray(row[pv]) ? (row[pv] as unknown[]).map(String) : [],
        };
        entries.set(entry.slug, entry);
        if (entry.sido) regions.add(entry.sido);
        if (entry.sido && entry.sigungu) regions.add(entry.sido + "|" + entry.sigungu);
        for (const value of entry.provision) provisions.add(value);
      }
      return { entries, regions, provisions };
    })
    .catch((error: unknown) => {
      welfarePromise = null;
      throw error;
    });
  return welfarePromise;
}

interface CareAllowList {
  readonly regions: ReadonlySet<string>;
  readonly categories: ReadonlySet<string>;
  readonly expiresAt: number;
}

let careAllow: Promise<CareAllowList> | null = null;

function readCareAllowList(): Promise<CareAllowList> {
  const current = careAllow;
  if (current) {
    return current.then((value) => {
      if (value.expiresAt > Date.now()) return value;
      careAllow = null;
      return readCareAllowList();
    });
  }
  const next = readOfficialDatasetSummary().then(({ summary }) => {
    const regions = new Set<string>();
    for (const [sido, sigungus] of Object.entries(summary.sigunguBySido)) {
      regions.add(sido);
      for (const sigungu of sigungus) regions.add(sido + "|" + sigungu);
    }
    for (const sido of Object.keys(summary.regionCounts)) regions.add(sido);
    return { regions, categories: new Set(summary.categories), expiresAt: Date.now() + MEMO_TTL_MS };
  });
  careAllow = next;
  next.catch(() => {
    if (careAllow === next) careAllow = null;
  });
  return next;
}

/** 지역·분류 코드가 실제 목록에 있는지. 좌표나 임의 문자열은 모두 거절된다. */
export async function isAllowedUsageFilter(filter: FilterKind, code: string): Promise<boolean> {
  switch (filter) {
    case "care_region":
      return (await readCareAllowList()).regions.has(code);
    case "care_category":
      return (await readCareAllowList()).categories.has(code);
    case "welfare_region":
      return (await readWelfareRegistry()).regions.has(code);
    case "welfare_provision":
      return (await readWelfareRegistry()).provisions.has(code);
    case "welfare_topic":
      return (TOPIC_ORDER as readonly string[]).includes(code);
    case "welfare_lifecycle":
      return (LIFECYCLE_ORDER as readonly string[]).includes(code);
    case "welfare_household":
      return (HOUSEHOLD_ORDER as readonly string[]).includes(code);
    case "welfare_scope":
      return WELFARE_SCOPES.has(code);
    default:
      return false;
  }
}

const memo = new Map<string, { readonly id: number | null; readonly expiresAt: number }>();

function serviceNorm(serviceId: string): string {
  return serviceId.toLowerCase().replace(/[^0-9a-z]/g, "");
}

async function careKeyExists(key: string): Promise<boolean> {
  return (await findOfficialServiceByWikiKey(key)) !== null;
}

/** 키가 바뀐 같은 사업을 찾는다. 예전 키가 모두 현재 자료에서 사라진 후보가 딱 하나일 때만 잇는다. */
async function findCareContinuation(row: ServiceRow, keys: EntityMatchKeys): Promise<number | null> {
  const db = getD1();
  const candidates = await db
    .prepare(
      "SELECT DISTINCT k.entity_id AS entityId FROM usage_entity_key k JOIN usage_entity e ON e.id = k.entity_id " +
        "WHERE k.kind = 'care_program' AND k.region_key = ? AND (k.name_norm = ? OR (k.service_norm = ? AND e.category = ?)) LIMIT 5",
    )
    .bind(keys.regionKey, keys.nameNorm, keys.serviceNorm, row.category)
    .all<{ entityId: number }>();
  const orphaned: number[] = [];
  for (const candidate of candidates.results ?? []) {
    const oldKeys = await db
      .prepare("SELECT source_key AS key FROM usage_entity_key WHERE entity_id = ? LIMIT 8")
      .bind(candidate.entityId)
      .all<{ key: string }>();
    let live = false;
    for (const old of oldKeys.results ?? []) {
      if (await careKeyExists(old.key)) {
        live = true;
        break;
      }
    }
    if (!live) orphaned.push(Number(candidate.entityId));
  }
  return orphaned.length === 1 ? orphaned[0] : null;
}

async function registerEntity(
  kind: EntityKind,
  key: string,
  info: EntityInfo,
  keys: EntityMatchKeys,
  continuation: () => Promise<number | null>,
): Promise<number> {
  const db = getD1();
  const now = Date.now();
  const touch = (entityId: number) =>
    db
      .prepare("UPDATE usage_entity SET name = ?, sido = ?, sigungu = ?, category = ?, status = 'active', last_seen_at = ? WHERE id = ?")
      .bind(info.name, info.sido, info.sigungu, info.category, now, entityId)
      .run();
  const lookup = () =>
    db
      .prepare("SELECT entity_id AS entityId FROM usage_entity_key WHERE kind = ? AND source_key = ?")
      .bind(kind, key)
      .first<{ entityId: number }>();

  const existing = await lookup();
  if (existing) {
    await touch(Number(existing.entityId));
    return Number(existing.entityId);
  }
  let entityId = await continuation();
  let created = false;
  if (entityId === null) {
    const row = await db
      .prepare(
        "INSERT INTO usage_entity (kind, name, sido, sigungu, category, status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?) RETURNING id",
      )
      .bind(kind, info.name, info.sido, info.sigungu, info.category, now, now)
      .first<{ id: number }>();
    if (!row) throw new Error("usage entity insert failed");
    entityId = Number(row.id);
    created = true;
  }
  await db
    .prepare(
      "INSERT INTO usage_entity_key (kind, source_key, entity_id, region_key, name_norm, service_norm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(kind, source_key) DO NOTHING",
    )
    .bind(kind, key, entityId, keys.regionKey, keys.nameNorm, keys.serviceNorm, now)
    .run();
  const mapped = await lookup();
  const finalId = Number(mapped?.entityId ?? entityId);
  if (created && finalId !== entityId) {
    // 같은 키를 다른 요청이 먼저 등록했다. 방금 만든 빈 항목은 지운다.
    await db.prepare("DELETE FROM usage_entity WHERE id = ?").bind(entityId).run();
  } else if (!created) {
    await touch(finalId);
  }
  return finalId;
}

async function resolveCare(key: string): Promise<number | null> {
  const row = await findOfficialServiceByWikiKey(key);
  if (!row) return null;
  const keys: EntityMatchKeys = {
    regionKey: row.sido + "|" + row.sigungu,
    nameNorm: normalizeName(row.name),
    serviceNorm: serviceNorm(row.serviceId),
  };
  const info: EntityInfo = { name: row.name, sido: row.sido, sigungu: row.sigungu, category: row.category };
  return registerEntity("care_program", key, info, keys, () => findCareContinuation(row, keys));
}

async function resolveWelfare(slug: string): Promise<number | null> {
  const entry = (await readWelfareRegistry()).entries.get(slug);
  if (!entry) return null;
  const keys: EntityMatchKeys = {
    regionKey: entry.org === "중앙부처" ? "중앙부처" : entry.sido + "|" + entry.sigungu,
    nameNorm: normalizeName(entry.name),
    serviceNorm: slug.toLowerCase(),
  };
  const info: EntityInfo = {
    name: entry.name,
    sido: entry.org === "중앙부처" ? "중앙부처" : entry.sido,
    sigungu: entry.sigungu,
    category: entry.category,
  };
  return registerEntity("welfare_policy", slug, info, keys, async () => null);
}

/** 사업·제도 키 → 통계 ID. 현재 자료에 없으면 null. */
export async function resolveUsageEntity(kind: EntityKind, key: string): Promise<number | null> {
  const cacheKey = kind + ":" + key;
  const now = Date.now();
  const hit = memo.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.id;
  const id = kind === "care_program" ? await resolveCare(key) : await resolveWelfare(key);
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(cacheKey, { id, expiresAt: now + MEMO_TTL_MS });
  return id;
}

/**
 * 통계 ID의 현재 목록 포함 여부(active/inactive)를 갱신한다. 운영 자료나 복지제도 대장이 바뀐 뒤 한 번만 계산한다.
 * 비활성이어도 지난 통계는 그대로 남는다.
 */
export async function refreshUsageEntityStatuses(): Promise<void> {
  const db = getD1();
  const [run, welfare] = await Promise.all([readLatestRun(true), readWelfareRegistry()]);
  if (!run) return;
  const marker = run.id + ":" + welfare.entries.size;
  const done = await db.prepare("SELECT value FROM app_setting WHERE key = 'usage_entity_checked'").first<{ value: string }>();
  if (done?.value === marker) return;

  const liveKeys = new Set((await exportOfficialServices(EMPTY_FILTERS)).map((row) => serviceWikiKey(row)));
  const mapped = await db
    .prepare("SELECT entity_id AS entityId, kind, source_key AS key FROM usage_entity_key")
    .all<{ entityId: number; kind: string; key: string }>();
  const active = new Set<number>();
  for (const row of mapped.results ?? []) {
    const live = row.kind === "care_program" ? liveKeys.has(row.key) : welfare.entries.has(row.key);
    if (live) active.add(Number(row.entityId));
  }
  await db.batch([
    db
      .prepare(
        "UPDATE usage_entity SET status = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 'active' ELSE 'inactive' END",
      )
      .bind(JSON.stringify([...active])),
    db
      .prepare(
        "INSERT INTO app_setting (key, value, updated_at) VALUES ('usage_entity_checked', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(marker, Math.floor(Date.now() / 1000)),
  ]);
}

