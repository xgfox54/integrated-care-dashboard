// 공개 재정 조회. 공개(PUBLISHED)된 불변 snapshot만 읽고, 금액은 10진 문자열로 돌려준다.
// 합계는 고유 재정 관측행을 먼저 집계하며(다른 도메인과 JOIN 후 합산하지 않음), 결측은 0으로 채우지 않는다.
import type { SqlDatabase } from "../sql-database.ts";
import { reconcileFunding, executionRate, subtractWon } from "./amount.ts";
import { CONTRACT_VERSION, QWGJK_ENDPOINT } from "./qwgjk.ts";
import { unitVerificationSql } from "./unit-check.ts";

export type FiscalMode = "integrated_care" | "social_welfare" | "health" | "department";
export const FISCAL_MODES: readonly FiscalMode[] = ["social_welfare", "integrated_care", "health", "department"];
/** 원천 분야명. 코드값은 연도별 코드표(fiscal_code_version)에서 이 이름으로 찾는다. */
const MODE_FIELD_NAME: Partial<Record<FiscalMode, string>> = { social_welfare: "사회복지", health: "보건" };
export const DEFAULT_FALLBACK_DAYS = 7;

export interface SnapshotRow {
  readonly snapshot_id: string;
  readonly scope_id: string;
  readonly fiscal_year: string;
  readonly requested_reference_date: string;
  readonly effective_reference_date: string | null;
  readonly reference_date_note: string;
  readonly access_tier: string;
  readonly expected_count: number;
  readonly unique_count: number;
  readonly complete: number;
  readonly published_at: number | null;
  readonly scope_label: string;
  readonly mode: string;
  readonly classification_basis: string;
}

export interface ProjectFilter {
  readonly waCode?: string;
  readonly entityId?: string;
  /** 행정시·행정구(제주시·창원시 의창구 등): 상위 재정주체의 부서코드 앞자리로 고른다(fiscal_admin_unit). 앞자리가 여럿이면 쉼표로 잇는다(예: "2005,2120"). */
  readonly adminUnit?: { readonly entityId: string; readonly deptPrefix: string };
  readonly departmentCodes?: readonly string[];
  readonly accountCodes?: readonly string[];
  readonly fieldCodes?: readonly string[];
  /**
   * 통합돌봄 분류(fiscal_project_class): "only"는 통합돌봄으로 분류된 사업만, "include"는 분야코드 조건에 더해 통합돌봄 사업도 넣는다
   * (통합돌봄은 사회복지의 하위 분류라 사회복지 합계에 포함. 2026-10-05 운영자 지시).
   */
  readonly integratedCare?: "only" | "include";
  readonly projectIds?: readonly string[];
  readonly query?: string;
}

export interface ProjectRecord {
  readonly fiscal_project_id: string;
  readonly fiscal_year: string;
  readonly fiscal_entity_id: string;
  readonly entity_name: string;
  readonly wa_code: string;
  readonly wa_name: string;
  readonly account_code: string;
  readonly account_name: string;
  readonly department_code: string;
  readonly dbiz_code: string;
  readonly name: string;
  readonly field_code: string;
  readonly field_name: string;
  readonly part_code: string;
  readonly part_name: string;
  readonly observation_id: string;
  readonly reference_date: string;
  readonly source_exe_ymd: string;
  readonly current_budget_krw: string | null;
  readonly public_expenditure_krw: string | null;
  readonly national_krw: string | null;
  readonly province_krw: string | null;
  readonly municipal_krw: string | null;
  readonly other_krw: string | null;
  readonly current_budget_raw: string | null;
  readonly public_expenditure_raw: string | null;
  readonly amount_problems: string;
  readonly source_amount_unit: string;
  readonly unit_verification: string;
  readonly normalization_rule_id: string;
  readonly contract_version: string;
  readonly integrated_care_match: string | null;
}

const SNAPSHOT_COLUMNS =
  "s.snapshot_id, s.scope_id, s.fiscal_year, s.requested_reference_date, s.effective_reference_date, s.reference_date_note, s.access_tier, s.expected_count, s.unique_count, s.complete, s.published_at, " +
  "c.label AS scope_label, c.mode, c.classification_basis";
const PROJECT_COLUMNS =
  "p.fiscal_project_id, p.fiscal_year, p.fiscal_entity_id, e.name AS entity_name, e.wa_code, e.wa_name, p.account_code, p.account_name, p.department_code, p.dbiz_code, p.name, " +
  "p.field_code, p.field_name, p.part_code, p.part_name, o.observation_id, o.reference_date, o.source_exe_ymd, o.current_budget_krw, o.public_expenditure_krw, o.national_krw, o.province_krw, " +
  "o.municipal_krw, o.other_krw, o.current_budget_raw, o.public_expenditure_raw, o.amount_problems, o.source_amount_unit, " + unitVerificationSql("o") + " AS unit_verification, o.normalization_rule_id, o.contract_version, " +
  "(SELECT c.basis || '|' || COALESCE(c.service_name, '') FROM fiscal_project_class c WHERE c.fiscal_project_id = p.fiscal_project_id AND c.class = 'integrated_care') AS integrated_care_match";
const INTEGRATED_CARE_SQL = "p.fiscal_project_id IN (SELECT fiscal_project_id FROM fiscal_project_class WHERE class = 'integrated_care')";
const PROJECT_JOINS =
  "FROM fiscal_snapshot_member m JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id JOIN fiscal_observation o ON o.observation_id = m.observation_id " +
  "JOIN fiscal_entity e ON e.fiscal_entity_id = p.fiscal_entity_id";

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, (char) => "\\" + char);
}

function shiftDate(date: string, days: number): string {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function publishedSnapshots(db: SqlDatabase, options: { fiscalYear?: string; scopeMode?: string; limit?: number; snapshotIds?: readonly string[] | null } = {}): Promise<SnapshotRow[]> {
  const clauses = ["s.status = 'PUBLISHED'"];
  const binds: unknown[] = [];
  if (options.fiscalYear) {
    clauses.push("s.fiscal_year = ?");
    binds.push(options.fiscalYear);
  }
  if (options.scopeMode) {
    clauses.push("c.mode = ?");
    binds.push(options.scopeMode);
  }
  // 통합 공개본에 고정된 snapshot만 본다(현재도 PUBLISHED여야 함: 승인 해제는 즉시 반영).
  if (options.snapshotIds) {
    if (!options.snapshotIds.length) return [];
    clauses.push("s.snapshot_id IN (" + marks(options.snapshotIds.length) + ")");
    binds.push(...options.snapshotIds);
  }
  return (await db.prepare(
    "SELECT " + SNAPSHOT_COLUMNS + " FROM fiscal_snapshot s JOIN fiscal_scope c ON c.scope_id = s.scope_id WHERE " + clauses.join(" AND ") +
      " ORDER BY s.requested_reference_date DESC, s.created_at DESC LIMIT ?",
  ).bind(...binds, options.limit ?? 60).all<SnapshotRow>()).results;
}

export interface SnapshotChoice {
  readonly snapshot: SnapshotRow | null;
  readonly requested_reference_date: string | null;
  readonly fallback_used: boolean;
  readonly reason: string | null;
}

/** 요청일 이하에서 가장 가까운 공개 snapshot(기본 7일 이내). 요청일이 없으면 최신 공개본. */
export async function chooseSnapshot(db: SqlDatabase, scopeMode: string, fiscalYear: string | undefined, referenceDate: string | undefined, fallbackDays = DEFAULT_FALLBACK_DAYS, snapshotIds: readonly string[] | null = null): Promise<SnapshotChoice> {
  const candidates = await publishedSnapshots(db, { fiscalYear, scopeMode, snapshotIds });
  if (!referenceDate) {
    return { snapshot: candidates[0] ?? null, requested_reference_date: null, fallback_used: false, reason: candidates[0] ? null : "NO_PUBLISHED_SNAPSHOT" };
  }
  const earliest = shiftDate(referenceDate, -fallbackDays);
  const match = candidates.find((snapshot) => snapshot.requested_reference_date <= referenceDate && snapshot.requested_reference_date >= earliest) ?? null;
  return {
    snapshot: match,
    requested_reference_date: referenceDate,
    fallback_used: Boolean(match && match.requested_reference_date !== referenceDate),
    reason: match ? null : "NO_SNAPSHOT_WITHIN_FALLBACK_WINDOW",
  };
}


export interface SnapshotSetChoice {
  /** 범위(scope)마다 하나씩 고른 공개 snapshot. 기준일이 최신인 것이 먼저 온다. */
  readonly snapshots: readonly SnapshotRow[];
  readonly requested_reference_date: string | null;
  readonly fallback_used: boolean;
  readonly reason: string | null;
}

/**
 * 같은 조회 모드의 범위가 여러 개일 때(광역별 전체 세출 등) 범위마다 snapshot을 하나씩 고른다.
 * 요청일이 없으면 범위별 최신 공개본, 있으면 범위별로 요청일 이하 7일 안의 가장 가까운 공개본이다. 범위마다 기준일이 다를 수 있다.
 */
export async function chooseSnapshotSet(db: SqlDatabase, scopeMode: string, fiscalYear: string | undefined, referenceDate: string | undefined, fallbackDays = DEFAULT_FALLBACK_DAYS, snapshotIds: readonly string[] | null = null): Promise<SnapshotSetChoice> {
  return pickSnapshotSet(await publishedSnapshots(db, { fiscalYear, scopeMode, snapshotIds, limit: 400 }), fiscalYear, referenceDate, fallbackDays);
}

/** chooseSnapshotSet의 고르기 단계. candidates는 publishedSnapshots 순서(기준일·생성 시각 내림차순)여야 한다. */
export function pickSnapshotSet(candidates: readonly SnapshotRow[], fiscalYear: string | undefined, referenceDate: string | undefined, fallbackDays = DEFAULT_FALLBACK_DAYS): SnapshotSetChoice {
  const earliest = referenceDate ? shiftDate(referenceDate, -fallbackDays) : "";
  const picked = new Map<string, SnapshotRow>();
  for (const snapshot of candidates) {
    if (picked.has(snapshot.scope_id)) continue;
    if (referenceDate && (snapshot.requested_reference_date > referenceDate || snapshot.requested_reference_date < earliest)) continue;
    picked.set(snapshot.scope_id, snapshot);
  }
  // 회계연도를 정하지 않으면 가장 최근 회계연도의 범위만 합친다(연도가 다른 금액을 섞지 않음).
  const latestYear = [...picked.values()].reduce((year, snapshot) => (snapshot.fiscal_year > year ? snapshot.fiscal_year : year), "");
  const snapshots = [...picked.values()].filter((snapshot) => fiscalYear || snapshot.fiscal_year === latestYear);
  return {
    snapshots,
    requested_reference_date: referenceDate ?? null,
    fallback_used: Boolean(referenceDate && snapshots.some((snapshot) => snapshot.requested_reference_date !== referenceDate)),
    reason: snapshots.length ? null : referenceDate ? "NO_SNAPSHOT_WITHIN_FALLBACK_WINDOW" : "NO_PUBLISHED_SNAPSHOT",
  };
}

/** 모드가 요구하는 분야코드. 해당 연도 코드표에 이름이 없으면 null(추정하지 않음). */
export async function modeFieldCodes(db: SqlDatabase, mode: FiscalMode, fiscalYear: string): Promise<string[] | null> {
  const name = MODE_FIELD_NAME[mode];
  if (!name) return [];
  const rows = (await db.prepare("SELECT DISTINCT code FROM fiscal_code_version WHERE code_system = 'LOFIN_FIELD' AND fiscal_year = ? AND name = ?").bind(fiscalYear, name).all<{ code: string }>()).results;
  return rows.length ? rows.map((row) => row.code) : null;
}

/** 공개 snapshot 하나 또는 여러 개(광역별 전체 세출 범위를 합쳐 읽을 때). */
export type SnapshotKey = string | readonly string[];

function projectWhere(snapshot: SnapshotKey, filter: ProjectFilter): { where: string; binds: unknown[] } {
  const ids = typeof snapshot === "string" ? [snapshot] : [...snapshot];
  const clauses = [ids.length === 1 ? "m.snapshot_id = ?" : "m.snapshot_id IN (" + marks(ids.length) + ")"];
  const binds: unknown[] = [...ids];
  const inList = (column: string, values: readonly string[] | undefined) => {
    if (!values?.length) return;
    clauses.push(column + " IN (" + marks(values.length) + ")");
    binds.push(...values);
  };
  if (filter.waCode) {
    clauses.push("e.wa_code = ?");
    binds.push(filter.waCode);
  }
  if (filter.entityId) {
    clauses.push("p.fiscal_entity_id = ?");
    binds.push(filter.entityId);
  }
  if (filter.adminUnit) {
    const prefixes = filter.adminUnit.deptPrefix.split(",").map((prefix) => prefix.trim()).filter(Boolean);
    clauses.push("p.fiscal_entity_id = ? AND (" + prefixes.map(() => "substr(p.department_code, 1, ?) = ?").join(" OR ") + ")");
    binds.push(filter.adminUnit.entityId, ...prefixes.flatMap((prefix) => [prefix.length, prefix]));
  }
  inList("p.department_code", filter.departmentCodes);
  inList("p.account_code", filter.accountCodes);
  if (filter.fieldCodes?.length) {
    const fields = "p.field_code IN (" + marks(filter.fieldCodes.length) + ")";
    clauses.push(filter.integratedCare === "include" ? "(" + fields + " OR " + INTEGRATED_CARE_SQL + ")" : fields);
    binds.push(...filter.fieldCodes);
  }
  if (filter.integratedCare === "only") clauses.push(INTEGRATED_CARE_SQL);
  inList("p.fiscal_project_id", filter.projectIds);
  for (const token of (filter.query ?? "").split(/\s+/).filter(Boolean).slice(0, 5)) {
    clauses.push("p.name LIKE ? ESCAPE '\\'");
    binds.push("%" + escapeLike(token) + "%");
  }
  return { where: clauses.join(" AND "), binds };
}

export async function snapshotProjectRows(db: SqlDatabase, snapshotId: SnapshotKey, filter: ProjectFilter, offset: number, limit: number): Promise<ProjectRecord[]> {
  const { where, binds } = projectWhere(snapshotId, filter);
  // 정렬·OFFSET에는 관측행 키만 싣고, 단위 검증·분류와 상세 열은 선택된 페이지에서만 읽는다.
  // 안쪽 JOIN은 그대로 두어 누락 참조 제외와 여러 snapshot의 동일 사업 관측행 수를 보존한다.
  const order = "e.wa_code, p.fiscal_entity_id, p.department_code, p.dbiz_code";
  const rows = await db.prepare("WITH page AS MATERIALIZED (SELECT m.fiscal_project_id, m.observation_id " + PROJECT_JOINS + " WHERE " + where + " ORDER BY " + order + " LIMIT ? OFFSET ?) " +
      "SELECT " + PROJECT_COLUMNS + " FROM page JOIN fiscal_project p ON p.fiscal_project_id = page.fiscal_project_id " +
      "JOIN fiscal_observation o ON o.observation_id = page.observation_id JOIN fiscal_entity e ON e.fiscal_entity_id = p.fiscal_entity_id ORDER BY " + order)
    .bind(...binds, limit, offset).all<ProjectRecord>();
  return rows.results;
}

export async function snapshotProjects(db: SqlDatabase, snapshotId: SnapshotKey, filter: ProjectFilter, offset: number, limit: number): Promise<{ rows: ProjectRecord[]; total: number }> {
  const { where, binds } = projectWhere(snapshotId, filter);
  const [total, rows] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total " + PROJECT_JOINS + " WHERE " + where).bind(...binds).first<{ total: number }>(),
    snapshotProjectRows(db, snapshotId, filter, offset, limit),
  ]);
  return { rows, total: total?.total ?? 0 };
}

/** 필터에 맞는 행이 실제로 들어 있는 snapshot과 그 행 수. 응답의 출처 범위를 결과와 맞추는 데 쓴다. */
export async function snapshotMatchCounts(db: SqlDatabase, snapshotId: SnapshotKey, filter: ProjectFilter): Promise<Map<string, number>> {
  const { where, binds } = projectWhere(snapshotId, filter);
  const rows = (await db.prepare("SELECT m.snapshot_id AS snapshot_id, COUNT(*) AS matching " + PROJECT_JOINS + " WHERE " + where + " GROUP BY m.snapshot_id")
    .bind(...binds).all<{ snapshot_id: string; matching: number }>()).results;
  return new Map(rows.map((row) => [row.snapshot_id, row.matching]));
}

/** 필터에 맞는 전체 범위의 합계. 예산현액·지출액이 모두 있는 행만 같은 분모·분자로 더한다. */
export async function snapshotSummary(db: SqlDatabase, snapshotId: SnapshotKey, filter: ProjectFilter) {
  const { where, binds } = projectWhere(snapshotId, filter);
  const row = await db.prepare(
    "SELECT COUNT(*) AS total, " +
      "SUM(CASE WHEN o.current_budget_krw IS NOT NULL AND o.public_expenditure_krw IS NOT NULL THEN 1 ELSE 0 END) AS comparable, " +
      "CAST(SUM(CASE WHEN o.current_budget_krw IS NOT NULL AND o.public_expenditure_krw IS NOT NULL THEN CAST(o.current_budget_krw AS INTEGER) END) AS TEXT) AS budget, " +
      "CAST(SUM(CASE WHEN o.current_budget_krw IS NOT NULL AND o.public_expenditure_krw IS NOT NULL THEN CAST(o.public_expenditure_krw AS INTEGER) END) AS TEXT) AS expenditure, " +
      "COUNT(DISTINCT p.fiscal_entity_id) AS entities " + PROJECT_JOINS + " WHERE " + where,
  ).bind(...binds).first<{ total: number; comparable: number | null; budget: string | null; expenditure: string | null; entities: number }>();
  const comparable = row?.comparable ?? 0;
  const budget = comparable ? row?.budget ?? null : null;
  const expenditure = comparable ? row?.expenditure ?? null : null;
  const rate = executionRate(expenditure, budget);
  return {
    aggregation_scope: "all_matching_rows_in_snapshot",
    matching_rows: row?.total ?? 0,
    included_rows: comparable,
    excluded_rows: (row?.total ?? 0) - comparable,
    excluded_reason: "예산현액 또는 지출액을 원 단위 정수로 확인할 수 없는 행",
    fiscal_entities: row?.entities ?? 0,
    current_budget_krw: budget,
    public_expenditure_krw: expenditure,
    unspent_difference_krw: subtractWon(budget, expenditure),
    execution_rate_pct: rate.value,
    execution_rate_null_reason: rate.reason ?? null,
  };
}

/** 광역 지역(원천 지역코드)별 세부사업 수·합계. 화면 지도와 상위 지역 목록에 쓴다(금액 합은 snapshotSummary와 같은 규칙). */
export async function snapshotRegionSummary(db: SqlDatabase, snapshotId: SnapshotKey, filter: ProjectFilter) {
  const { where, binds } = projectWhere(snapshotId, filter);
  const rows = (await db.prepare(
    "SELECT e.wa_code AS code, MAX(e.wa_name) AS name, COUNT(*) AS projects, COUNT(DISTINCT p.fiscal_entity_id) AS entities, " +
      "SUM(CASE WHEN o.current_budget_krw IS NOT NULL AND o.public_expenditure_krw IS NOT NULL THEN 1 ELSE 0 END) AS comparable, " +
      "CAST(SUM(CASE WHEN o.current_budget_krw IS NOT NULL AND o.public_expenditure_krw IS NOT NULL THEN CAST(o.current_budget_krw AS INTEGER) END) AS TEXT) AS budget, " +
      "CAST(SUM(CASE WHEN o.current_budget_krw IS NOT NULL AND o.public_expenditure_krw IS NOT NULL THEN CAST(o.public_expenditure_krw AS INTEGER) END) AS TEXT) AS expenditure " +
      PROJECT_JOINS + " WHERE " + where + " GROUP BY e.wa_code ORDER BY e.wa_code",
  ).bind(...binds).all<{ code: string; name: string; projects: number; entities: number; comparable: number; budget: string | null; expenditure: string | null }>()).results;
  return rows.map((row) => {
    const budget = row.comparable ? row.budget : null;
    const expenditure = row.comparable ? row.expenditure : null;
    return {
      code: String(row.code), name: String(row.name), projects: row.projects, fiscal_entities: row.entities,
      current_budget_krw: budget, public_expenditure_krw: expenditure, execution_rate_pct: executionRate(expenditure, budget).value,
    };
  });
}

export function projectDto(row: ProjectRecord) {
  const rate = executionRate(row.public_expenditure_krw, row.current_budget_krw);
  return {
    fiscal_project_id: row.fiscal_project_id,
    fiscal_year: row.fiscal_year,
    name: row.name,
    fiscal_entity: { fiscal_entity_id: row.fiscal_entity_id, name: row.entity_name, region_code: row.wa_code, region_name: row.wa_name },
    department_code: row.department_code,
    department_name: null,
    account: { code: row.account_code, name: row.account_name },
    source_project_code: row.dbiz_code,
    classification: { field_code: row.field_code, field_name: row.field_name, part_code: row.part_code, part_name: row.part_name, basis: "원천 분야·부문 코드" },
    reference_date: row.reference_date,
    current_budget_krw: row.current_budget_krw,
    public_expenditure_krw: row.public_expenditure_krw,
    unspent_difference_krw: subtractWon(row.current_budget_krw, row.public_expenditure_krw),
    execution_rate_pct: rate.value,
    execution_rate_null_reason: rate.reason ?? null,
    funding_reported: {
      national_krw: row.national_krw, province_krw: row.province_krw, municipal_krw: row.municipal_krw, other_krw: row.other_krw,
      ...reconcileFunding(row.current_budget_krw, { national: row.national_krw, province: row.province_krw, municipal: row.municipal_krw, other: row.other_krw }),
      source_fields: { national_krw: "bdg_ntep", province_krw: "capep", municipal_krw: "sggep", other_krw: "etc_amt" },
      note: "원천의 국비·시도비·시군구비·기타 칸 그대로입니다. 합계가 예산현액과 같을 때만 완전으로 표시하고, 차이는 어느 재원에도 나누지 않습니다. 「기타」는 더 나누지 않으며 기금·균특 등 세부 재원은 예산서 원문이 있어야 확인됩니다.",
    },
    amount_unit: row.source_amount_unit,
    amount_precision: "integer_krw",
    unit_verification: row.unit_verification,
    amount_problems: JSON.parse(row.amount_problems) as string[],
    // 통합돌봄 분류 근거: 통합돌봄 WIKI 사업명과 세부사업명 일치(wiki_name_match) 또는 세부사업명에 「통합돌봄」 포함(name_keyword).
    integrated_care: row.integrated_care_match
      ? { basis: row.integrated_care_match.split("|")[0], wiki_service_name: row.integrated_care_match.split("|").slice(1).join("|") || null }
      : null,
    evidence: {
      evidence_id: row.observation_id,
      source: "지방재정365 세부사업별 세출현황(QWGJK)",
      source_url: QWGJK_ENDPOINT,
      source_fields: { current_budget_krw: "bdg_cash_amt", public_expenditure_krw: "ep_amt" },
      source_raw_values: { bdg_cash_amt: row.current_budget_raw, ep_amt: row.public_expenditure_raw },
      normalization_rule_id: row.normalization_rule_id,
      contract_version: row.contract_version || CONTRACT_VERSION,
    },
  };
}

export async function fiscalCatalog(db: SqlDatabase, snapshotId: SnapshotKey, type: string, filter: ProjectFilter) {
  const { where, binds } = projectWhere(snapshotId, filter);
  const queries: Record<string, string> = {
    fiscal_entity: "SELECT p.fiscal_entity_id AS id, e.name, e.code, e.wa_code AS region_code, e.wa_name AS region_name, COUNT(*) AS project_count " + PROJECT_JOINS + " WHERE " + where + " GROUP BY p.fiscal_entity_id ORDER BY e.wa_code, e.code",
    department: "SELECT 'lofin:dept:' || e.code || ':' || p.department_code AS id, p.department_code AS code, e.name AS fiscal_entity_name, COUNT(*) AS project_count " + PROJECT_JOINS + " WHERE " + where + " GROUP BY p.fiscal_entity_id, p.department_code ORDER BY e.code, p.department_code",
    account: "SELECT p.account_code AS code, p.account_name AS name, COUNT(*) AS project_count " + PROJECT_JOINS + " WHERE " + where + " GROUP BY p.account_code, p.account_name ORDER BY p.account_code",
    classification: "SELECT p.field_code, p.field_name, p.part_code, p.part_name, COUNT(*) AS project_count " + PROJECT_JOINS + " WHERE " + where + " GROUP BY p.field_code, p.field_name, p.part_code, p.part_name ORDER BY p.field_code, p.part_code",
  };
  const sql = queries[type];
  if (!sql) return [];
  return (await db.prepare(sql).bind(...binds).all<Record<string, unknown>>()).results;
}

export async function fiscalMappings(db: SqlDatabase, regionId?: string) {
  const sql = "SELECT mapping_id, fiscal_entity_id, fiscal_department_id, region_id, organization_id, relation, basis, verification_status FROM fiscal_region_mapping" +
    (regionId ? " WHERE region_id = ?" : "") + " ORDER BY mapping_id";
  const statement = regionId ? db.prepare(sql).bind(regionId) : db.prepare(sql);
  return (await statement.all<{ mapping_id: string; fiscal_entity_id: string; fiscal_department_id: string | null; region_id: string; organization_id: string | null; relation: string; basis: string; verification_status: string }>()).results;
}

export async function latestRuns(db: SqlDatabase, limit = 10) {
  return (await db.prepare(
    "SELECT r.run_id, r.scope_id, r.trigger, r.requested_reference_date, r.access_tier, r.status, r.total_count, r.pages_expected, r.next_page, r.received_rows, r.error_code, r.started_at, r.finished_at, r.snapshot_id " +
      "FROM fiscal_collection_run r ORDER BY r.started_at DESC LIMIT ?",
  ).bind(limit).all<Record<string, unknown>>()).results;
}
