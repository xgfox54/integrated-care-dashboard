import type { SqlDatabase } from "../sql-database.ts";
import { CATEGORY_LABELS } from "./dictionary.ts";
import { REGION_DEFINITIONS } from "../region-statistics.ts";
import { publicNewsClause } from "../platform/public-pin.ts";
import { parseTargetGroup, targetGroupSql } from "../target-groups.ts";

// 공개 조회. 승인된 Source의 복지 분류 자료만 돌려주고, 본문 성격의 필드는 DTO에 없다.

export const PRESS_SCHEMA_VERSION = "2.1";
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
const MAX_TOKENS = 5;
const MAX_TEXT = 100;
const ORG_TYPES: ReadonlySet<string> = new Set([
  "CENTRAL", "METROPOLITAN", "BASIC_CITY", "BASIC_COUNTY", "AUTONOMOUS_DISTRICT", "ADMINISTRATIVE_CITY", "GENERAL_DISTRICT",
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PressSearch {
  readonly q: string;
  readonly category: string;
  readonly organizationId: string;
  readonly organizationType: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly from: string;
  readonly to: string;
  readonly page: number;
  readonly size: number;
  /** items: 게시물 단위(API 생략 기본). verified_groups: 검토자가 확정한 동일 자료 묶음은 대표 1건만. */
  readonly groupMode: "items" | "verified_groups";
  readonly duplicateGroupId: string;
  /** 시·군·구를 고른 경우 그 시 아래 일반구·행정시 발행기관까지 넣는다. */
  readonly includeDescendants: boolean;
  /** 게시일을 확인하지 못한 항목만. 기간 조건과 함께 쓰지 않는다. */
  readonly dateUnknown: boolean;
  /** 게시일 정렬: newest(기본) 또는 oldest. */
  readonly sort: "newest" | "oldest";
  /** 대상자 묶음 slug(target_group). 제목에 묶음 낱말 중 하나가 들어간 보도자료(관계성 지도 집계와 같은 정의). */
  readonly targetGroup?: string;
}

export type PressSearchParse =
  | { readonly ok: true; readonly search: PressSearch }
  | { readonly ok: false; readonly message: string };

function bounded(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? "").trim().slice(0, MAX_TEXT);
}

function integerIn(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function flag(params: URLSearchParams, key: string): boolean {
  const value = bounded(params, key);
  return value === "1" || value === "true";
}

/** 같은 광역을 가리키는 이름들(전남광주통합특별시 = 광주광역시·전라남도 등). */
export function pressSidoAliases(sido: string): readonly string[] {
  return REGION_DEFINITIONS.find((region) => region.aliases.some((alias) => alias === sido))?.aliases ?? [sido];
}

export function parsePressSearch(params: URLSearchParams): PressSearchParse {
  const category = bounded(params, "category");
  const organizationType = bounded(params, "organization_type");
  const from = bounded(params, "from");
  const to = bounded(params, "to");
  if (category && !(category in CATEGORY_LABELS)) return { ok: false, message: "알 수 없는 분야입니다." };
  if (organizationType && !ORG_TYPES.has(organizationType)) return { ok: false, message: "알 수 없는 기관 유형입니다." };
  if ((from && !DATE_PATTERN.test(from)) || (to && !DATE_PATTERN.test(to))) return { ok: false, message: "날짜는 YYYY-MM-DD 형식이어야 합니다." };
  if (from && to && from > to) return { ok: false, message: "시작일이 종료일보다 늦습니다." };
  const regionBasis = bounded(params, "region_basis");
  if (regionBasis && regionBasis !== "publisher_jurisdiction") return { ok: false, message: "본문을 보관하지 않아 내용상 지역 기준은 제공하지 않습니다. 발행기관 관할(publisher_jurisdiction)로 찾아 주세요." };
  const dateUnknown = flag(params, "date_unknown");
  if (dateUnknown && (from || to)) return { ok: false, message: "게시일 미확인 항목은 기간 조건과 함께 찾을 수 없습니다." };
  const groupMode = bounded(params, "group_mode") || "items";
  if (groupMode !== "items" && groupMode !== "verified_groups") return { ok: false, message: "group_mode는 items 또는 verified_groups여야 합니다." };
  const duplicateGroupId = bounded(params, "duplicate_group_id");
  if (duplicateGroupId && groupMode === "verified_groups") return { ok: false, message: "묶음 구성원 조회는 group_mode=items와 함께 써야 합니다." };
  const sort = bounded(params, "sort") || "newest";
  if (sort !== "newest" && sort !== "oldest") return { ok: false, message: "sort는 newest 또는 oldest여야 합니다." };
  if (params.getAll("target_group").length > 1) return { ok: false, message: "target_group은 한 번만 쓸 수 있습니다." };
  const targetGroupRaw = bounded(params, "target_group");
  const targetGroup = targetGroupRaw ? parseTargetGroup(targetGroupRaw) : "";
  if (targetGroup === null) return { ok: false, message: "알 수 없는 대상자 묶음입니다." };
  return {
    ok: true,
    search: {
      q: bounded(params, "q"), category, organizationType, from, to,
      organizationId: bounded(params, "organization_id"), sido: bounded(params, "sido"), sigungu: bounded(params, "sigungu"),
      page: integerIn(params.get("page"), 1, 1, 1000),
      size: integerIn(params.get("size"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
      groupMode, duplicateGroupId, includeDescendants: flag(params, "include_descendants"), dateUnknown, sort, targetGroup,
    },
  };
}

export function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 광역자치단체 보도자료를 소속 시·군·구(기초·자치구·일반구·행정시)가 같은 제목으로 다시 올린 글은 공개 조회에서 숨긴다(2026-10-05 운영자 지시:
 * 같은 글을 두 번 보지 않게 광역 보도자료만 보여 줌). 판단: 같은 관련 묶음(다른 기관이 가까운 날 같은 정규화 제목으로 낸 글)에
 * 같은 시·도의 광역자치단체 공개 글이 있으면 숨긴다. 다른 시·도 광역이나 중앙부처 글과 제목이 같은 경우는 숨기지 않는다. 저장된 글은 지우지 않는다.
 */
export function metroRepostClause(item: string, org: string): string {
  return "NOT (" + org + ".org_type NOT IN ('METROPOLITAN', 'CENTRAL') AND " + item + ".related_group_id IS NOT NULL AND EXISTS (" +
    "SELECT 1 FROM press_item mr JOIN press_source mrs ON mrs.source_id = mr.source_id JOIN press_organization mro ON mro.organization_id = mr.issued_by_org_id " +
    "WHERE mr.related_group_id = " + item + ".related_group_id AND mr.item_id <> " + item + ".item_id AND mr.public_status = 'PUBLIC' " +
    "AND mrs.approval_status = 'POLICY_APPROVED' AND mrs.enabled = 1 AND " + publicNewsClause("mr") + " AND mro.org_type = 'METROPOLITAN' AND mro.sido = " + org + ".sido))";
}

/** 공개 조회가 언제나 거는 조건: 공개 상태 항목, 정책 승인·활성 Source, 광역 보도자료의 시·군·구 재게시 제외. MCP·공개본도 같은 조건을 쓴다(PRESS_FROM_JOINS 필요). */
export const PUBLIC_PRESS_CLAUSES: readonly string[] = ["i.public_status = 'PUBLIC'", "s.approval_status = 'POLICY_APPROVED'", "s.enabled = 1", metroRepostClause("i", "o")];

function buildFilter(search: PressSearch): { readonly where: string; readonly binds: unknown[] } {
  // 웹은 활성 통합 공개본의 보도자료 경계까지만 본다(MCP와 같은 공개본).
  const clauses = [...PUBLIC_PRESS_CLAUSES, publicNewsClause("i")];
  const binds: unknown[] = [];
  for (const token of search.q.split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS)) {
    clauses.push("i.title LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(token)}%`);
  }
  if (search.targetGroup) {
    const target = targetGroupSql(search.targetGroup, ["i.title"]);
    clauses.push(target.sql);
    binds.push(...target.values);
  }
  const equals: readonly (readonly [string, string])[] = [
    ["i.issued_by_org_id = ?", search.organizationId], ["o.org_type = ?", search.organizationType],
  ];
  for (const [clause, value] of equals) {
    if (!value) continue;
    clauses.push(clause);
    binds.push(value);
  }
  // 지역은 발행기관의 관할로만 찾는다. 시·도는 그 안의 모든 발행기관, 시·군·구는 그 기관(하위 포함을 켜면 그 시 아래 일반구·행정시도).
  if (search.sido) {
    const aliases = pressSidoAliases(search.sido);
    clauses.push("o.sido IN (" + aliases.map(() => "?").join(", ") + ")");
    binds.push(...aliases);
  }
  if (search.sigungu) {
    clauses.push(search.includeDescendants ? "(o.sigungu = ? OR o.parent_id IN (SELECT p.organization_id FROM press_organization p WHERE p.sigungu = ? AND p.sido = o.sido))" : "o.sigungu = ?");
    binds.push(...(search.includeDescendants ? [search.sigungu, search.sigungu] : [search.sigungu]));
  }
  if (search.dateUnknown) clauses.push("i.published_date = ''");
  if (search.category) {
    clauses.push("EXISTS (SELECT 1 FROM json_each(i.categories) WHERE value = ?)");
    binds.push(search.category);
  }
  if (search.from) {
    clauses.push("i.published_date >= ?");
    binds.push(search.from);
  }
  if (search.to) {
    clauses.push("i.published_date <> '' AND i.published_date <= ?");
    binds.push(search.to);
  }
  if (search.duplicateGroupId) {
    clauses.push("i.duplicate_group_id = ?");
    binds.push(search.duplicateGroupId);
  }
  if (search.groupMode === "verified_groups") clauses.push("(i.duplicate_group_id IS NULL OR i.item_id = (" + duplicateRepresentativeSql("i") + "))");
  return { where: clauses.join(" AND "), binds };
}

export interface PressItemRow {
  readonly item_id: string;
  readonly title: string;
  readonly canonical_url: string;
  readonly published_date: string;
  readonly published_at: number | null;
  readonly publication_precision: string;
  readonly discovered_at: number;
  readonly categories: string;
  readonly classification_basis: string;
  readonly org_id: string;
  readonly org_name: string;
  readonly org_type: string;
  readonly org_sido: string;
  readonly org_sigungu: string;
  readonly registry_version: string;
  readonly related_group_id?: string | null;
  readonly related_count?: number | null;
  readonly duplicate_group_id?: string | null;
  readonly duplicate_count?: number | null;
  readonly duplicate_representative?: string | null;
}

function isoOf(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

function categoryIds(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

export function toPressDto(row: PressItemRow) {
  return {
    schema_version: PRESS_SCHEMA_VERSION,
    article_id: row.item_id,
    press_release_id: row.item_id,
    source_kind: "OFFICIAL_PRESS_RELEASE",
    document_kind: "PRESS_RELEASE",
    // 양평 목록의 별도 '새글' 아이콘이 합쳐져 저장된 이전 항목도 원문 제목으로 표시한다.
    title: /^https:\/\/www\.yp21\.go\.kr\//.test(row.canonical_url) ? row.title.replace(/\s+새글$/, "") : row.title,
    // 발행기관 판단 근거: 승인 Source는 모두 한 기관이 단독으로 쓰는 공식 게시판이라 게시판 주인을 발행기관으로 본다.
    // 공용 게시판은 발행기관 판별 규칙이 생기기 전에는 승인하지 않는다(T146). 재게시 판별은 하지 않아 reposted_by는 비워 둔다.
    issued_by: { organization_id: row.org_id, name: row.org_name, type: row.org_type, basis: "source_owner_single_publisher_board", reposted_by: null },
    published_at: isoOf(row.published_at),
    published_date: row.published_date || null,
    publication_precision: row.publication_precision,
    discovered_at: isoOf(row.discovered_at),
    original_url: row.canonical_url,
    publisher_region: { sido: row.org_sido, sigungu: row.org_sigungu },
    category_ids: categoryIds(row.categories),
    classification_basis: row.classification_basis,
    content_scope: "metadata_only",
    source_registry_version: row.registry_version,
    // 관련 묶음: 서로 다른 기관의 같은 정규화 제목(3일 안). 같은 보도자료로 확정한 것이 아니며, 공개 중인 구성원 수만 보인다.
    related_group: row.related_group_id && (row.related_count ?? 0) >= 2
      ? { group_id: row.related_group_id, public_member_count: row.related_count, basis: "identical_normalized_title_within_3_days_different_publishers", verified_same_release: Boolean(row.duplicate_group_id && (row.duplicate_count ?? 0) >= 2) }
      : null,
    // 검증된 동일 자료 묶음: 대표 1건과 다른 공식 출처 수. 공개 중인 구성원만 세고, 대표는 확인된 원 발행 출처 → 이른 게시일 → ID 순.
    duplicate_group: row.duplicate_group_id && (row.duplicate_count ?? 0) >= 2
      ? { duplicate_group_id: row.duplicate_group_id, representative_article_id: row.duplicate_representative ?? null, is_representative: row.duplicate_representative === row.item_id, public_member_count: row.duplicate_count, other_sources_count: (row.duplicate_count ?? 1) - 1, basis: "reviewer_verified_same_release" }
      : null,
  };
}

export const PRESS_FROM_JOINS =
  "FROM press_item i JOIN press_source s ON s.source_id = i.source_id JOIN press_organization o ON o.organization_id = i.issued_by_org_id";

/** 공개 중인(승인·활성 Source의 PUBLIC) 관련 묶음 구성원 수. 숨김·미승인 구성원과 광역 보도자료의 시·군·구 재게시는 세지 않는다. */
export const RELATED_COLUMNS =
  "i.related_group_id, (SELECT COUNT(*) FROM press_item g JOIN press_source gs ON gs.source_id = g.source_id JOIN press_organization go ON go.organization_id = g.issued_by_org_id " +
    "WHERE g.related_group_id = i.related_group_id AND g.public_status = 'PUBLIC' AND gs.approval_status = 'POLICY_APPROVED' AND gs.enabled = 1 AND " + publicNewsClause("g") + " AND " + metroRepostClause("g", "go") + ") AS related_count, " +
  "i.duplicate_group_id, (SELECT COUNT(*) FROM press_item d JOIN press_source ds ON ds.source_id = d.source_id WHERE d.duplicate_group_id = i.duplicate_group_id AND d.public_status = 'PUBLIC' AND ds.approval_status = 'POLICY_APPROVED' AND ds.enabled = 1 AND " + publicNewsClause("d") + ") AS duplicate_count, " +
  "(" + duplicateRepresentativeSql("i") + ") AS duplicate_representative";

/** 묶음 대표: 공개 목록에 남는 구성원 가운데 확인된 원 발행 출처 → 이른 게시일 → ID 순. 숨겨진 재게시는 후보에서 제외한다. */
export function duplicateRepresentativeSql(alias: string): string {
  return "SELECT d.item_id FROM press_item d JOIN press_source ds ON ds.source_id = d.source_id JOIN press_organization dorg ON dorg.organization_id = d.issued_by_org_id LEFT JOIN press_duplicate_group pg ON pg.group_id = d.duplicate_group_id " +
    "WHERE d.duplicate_group_id = " + alias + ".duplicate_group_id AND d.public_status = 'PUBLIC' AND ds.approval_status = 'POLICY_APPROVED' AND ds.enabled = 1 AND " + publicNewsClause("d") + " AND " + metroRepostClause("d", "dorg") + " " +
    "ORDER BY (d.item_id = pg.original_item_id) DESC, CASE WHEN d.published_date = '' THEN 1 ELSE 0 END, d.published_date, d.item_id LIMIT 1";
}

/** 지도·지역 선택·목록 옆 필터용: 공개 게시물 수를 발행기관 관할(시·도, 시·군·구, 기관 유형)·발행기관·분야별로 센다. */
export async function readPressRegions(db: SqlDatabase) {
  const where = [...PUBLIC_PRESS_CLAUSES, publicNewsClause("i")].join(" AND ");
  const [rows, organizations, categories] = await Promise.all([
    db.prepare("SELECT o.sido, o.sigungu, o.org_type, COUNT(*) AS total " + PRESS_FROM_JOINS + " WHERE " + where + " GROUP BY o.sido, o.sigungu, o.org_type ORDER BY o.sido, o.sigungu")
      .all<{ sido: string; sigungu: string; org_type: string; total: number }>().then((result) => result.results),
    db.prepare("SELECT o.organization_id, o.name, o.org_type, o.sido, COUNT(*) AS total " + PRESS_FROM_JOINS + " WHERE " + where + " GROUP BY o.organization_id ORDER BY total DESC, o.name")
      .all<{ organization_id: string; name: string; org_type: string; sido: string; total: number }>().then((result) => result.results),
    db.prepare("SELECT c.value AS category, COUNT(*) AS total " + PRESS_FROM_JOINS + ", json_each(i.categories) c WHERE " + where + " GROUP BY c.value")
      .all<{ category: string; total: number }>().then((result) => result.results),
  ]);
  const bySido: Record<string, number> = {};
  for (const row of rows) if (row.sido) bySido[row.sido] = (bySido[row.sido] ?? 0) + row.total;
  const byOrgType: Record<string, number> = {};
  for (const row of rows) byOrgType[row.org_type] = (byOrgType[row.org_type] ?? 0) + row.total;
  return {
    region_basis: "publisher_jurisdiction",
    count_unit: "public_post",
    by_sido: bySido,
    by_organization_type: byOrgType,
    by_category: Object.fromEntries(categories.map((row) => [row.category, row.total])),
    by_organization: organizations.map((row) => ({ organization_id: row.organization_id, name: row.name, organization_type: row.org_type, sido: row.sido, count: row.total })),
    areas: rows.filter((row) => row.sigungu).map((row) => ({ sido: row.sido, sigungu: row.sigungu, organization_type: row.org_type, count: row.total })),
    central_count: rows.filter((row) => !row.sido).reduce((sum, row) => sum + row.total, 0),
  };
}

export async function searchPress(db: SqlDatabase, search: PressSearch) {
  const { where, binds } = buildFilter(search);
  const total = await db.prepare(`SELECT COUNT(*) AS total ${PRESS_FROM_JOINS} WHERE ${where}`).bind(...binds).first<{ total: number }>();
  const rows = await db.prepare(
    "SELECT i.item_id, i.title, i.canonical_url, i.published_date, i.published_at, i.publication_precision, i.discovered_at, i.categories, i.classification_basis, " +
      "o.organization_id AS org_id, o.name AS org_name, o.org_type, o.sido AS org_sido, o.sigungu AS org_sigungu, s.registry_version, " + RELATED_COLUMNS + " " +
      `${PRESS_FROM_JOINS} WHERE ${where} ORDER BY ${search.sort === "oldest" ? "CASE WHEN i.published_date = '' THEN 1 ELSE 0 END, i.published_date, i.published_at, i.item_id" : "i.published_date DESC, i.published_at DESC, i.item_id"} LIMIT ? OFFSET ?`,
  ).bind(...binds, search.size, (search.page - 1) * search.size).all<PressItemRow>();
  const bundle = await db.prepare("SELECT bundle_id FROM platform_active_bundle WHERE id = 1").first<{ bundle_id: string | null }>();
  return {
    schema_version: PRESS_SCHEMA_VERSION,
    release_bundle_id: bundle?.bundle_id ?? null,
    items: rows.results.map(toPressDto),
    total_count: total?.total ?? 0,
    group_mode: search.groupMode,
    region_basis: "publisher_jurisdiction",
    result_unit: search.groupMode === "verified_groups" ? "verified_group_or_item" : "item",
    page: search.page,
    size: search.size,
  };
}

/** 공개 목록과 같은 조건(buildFilter)의 건수. 관계성 지도 집계가 클릭 목록과 같은 수를 보이도록 쓴다. */
export async function countPress(db: SqlDatabase, search: PressSearch): Promise<number> {
  const { where, binds } = buildFilter(search);
  const total = await db.prepare(`SELECT COUNT(*) AS total ${PRESS_FROM_JOINS} WHERE ${where}`).bind(...binds).first<{ total: number }>();
  return Number(total?.total ?? 0);
}
