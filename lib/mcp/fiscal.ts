// 재정 도구 4개: 공개(PUBLISHED) snapshot의 재정 관측만 읽는다. 없는 코드·금액·기준일을 만들지 않고,
// 지역은 검증된 재정주체 매핑으로만 해석하며(없으면 MAPPING_REQUIRED), 원천이 없는 모드는 사유와 함께 미가용으로 돌려준다.
import { z } from "zod";

import { executionRate, subtractWon } from "../fiscal/amount.ts";
import {
  chooseSnapshotSet,
  fiscalCatalog,
  fiscalMappings,
  type FiscalMode,
  modeFieldCodes,
  type ProjectFilter,
  projectDto,
  type ProjectRecord,
  publishedSnapshots,
  snapshotProjects,
  snapshotMatchCounts,
  snapshotSummary,
  type SnapshotRow,
} from "../fiscal/query.ts";
import type { SqlDatabase } from "../sql-database.ts";
import { unitNote } from "../fiscal/unit-check.ts";
import { type Basis, type Coverage, decodeCursor, encodeCursor, type Envelope, fingerprint, LIMITS, McpToolError, pageLimit } from "./contract.ts";
import { integratedCareClassVersion } from "../fiscal/classify.ts";
import { INTEGRATED_CARE_NOTE } from "../fiscal/public.ts";
import { activeRevisions, documentLinksForProjects, type RevisionRow, revisionDto, squashName, stageLabel, thousandDifference } from "../fiscal/budget-documents.ts";
import { thousandOf } from "../imports/budget-pack.ts";
import { departmentHistory } from "../fiscal/department-history.ts";

const year = z.number().int().min(2000).max(2100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다.");
const id = z.string().min(1).max(100);
const bundle = z.string().max(120).optional();
const cursor = z.string().max(400).optional();
const limit = z.number().int().min(1).max(LIMITS.listMax).optional();
const period = z.object({
  fiscal_year: year,
  observation_date: date.optional(),
  document_revision_id: id.optional(),
  account_id: id.optional(),
  scope: z.enum(["total", "general_account", "special_account", "fund"]).optional(),
}).strict();

export const FISCAL_TOOL_SHAPES = {
  get_fiscal_catalog: {
    catalog_type: z.enum(["fiscal_entity", "department", "account", "classification", "available_reference_date", "budget_document", "department_history"]),
    fiscal_year: year.optional(),
    region_id: z.string().max(80).optional(),
    fiscal_entity_id: id.optional(),
    release_bundle_id: bundle,
    cursor,
    limit,
  },
  find_budget_projects: {
    fiscal_year: year,
    mode: z.enum(["social_welfare", "health", "integrated_care", "department"]),
    fiscal_entity_id: id.optional(),
    department_ids: z.array(id).max(LIMITS.arrayMax).optional(),
    account_ids: z.array(id).max(LIMITS.arrayMax).optional(),
    region_id: z.string().max(80).optional(),
    query: z.string().max(LIMITS.queryMax).optional(),
    reference_date: date.optional(),
    include_summary: z.boolean().optional(),
    release_bundle_id: bundle,
    cursor,
    limit,
  },
  get_budget_execution: {
    fiscal_project_ids: z.array(id).min(1).max(LIMITS.fiscalIdsMax),
    fiscal_year: year,
    reference_date: date.optional(),
    fallback_policy: z.enum(["exact", "latest_before"]).optional(),
    release_bundle_id: bundle,
  },
  compare_budget_periods: {
    // 셋 중 하나만: 지방재정365 재정사업 ID, 예산서 세부사업 행 ID(budget_line_id), 예산서 세부사업명 검색어(문서 단계 비교 전용).
    project_selection: z.object({
      fiscal_project_ids: z.array(id).min(1).max(LIMITS.fiscalIdsMax).optional(),
      budget_line_ids: z.array(id).min(1).max(LIMITS.fiscalIdsMax).optional(),
      detail_project_query: z.string().min(1).max(LIMITS.queryMax).optional(),
    }).strict(),
    left: period,
    right: period,
    comparison_basis: z.enum(["same_reference_date", "year_end", "document_stage"]),
    release_bundle_id: bundle,
  },
} as const;

type Shapes = typeof FISCAL_TOOL_SHAPES;
type Args<K extends keyof Shapes> = z.objectOutputType<Shapes[K], z.ZodTypeAny>;
type Make = <T>(payload: T, options: { basis?: Basis; coverage: Coverage; warnings?: string[]; evidence?: readonly unknown[]; nextCursor?: string | null; truncated?: boolean }) => Envelope<T>;

const MODE_SCOPE: Record<FiscalMode, string> = { integrated_care: "integrated_care", social_welfare: "all_fields", health: "all_fields", department: "all_fields" };
const SOURCE_GAP = "지방재정365 세부사업별 세출현황의 공개값입니다. 내부 실시간 장부·원인행위·최종 수혜기관 집행이 아닙니다.";

/** 공개된 재정 snapshot 구성요소 ID. 없으면 null. */
export async function fiscalComponent(db: SqlDatabase): Promise<string | null> {
  const snapshots = await publishedSnapshots(db, { limit: 5 });
  return snapshots.length ? "fiscal:" + fingerprint(snapshots.map((snapshot) => snapshot.snapshot_id)) : null;
}

function snapshotCoverage(snapshot: SnapshotRow, extra: Record<string, unknown> = {}): Coverage {
  return {
    scope: snapshot.scope_label,
    complete: snapshot.complete === 1,
    gaps: [snapshot.classification_basis, SOURCE_GAP],
    snapshot_id: snapshot.snapshot_id,
    access_tier: snapshot.access_tier,
    source_total_count: snapshot.expected_count,
    reference_date_note: snapshot.reference_date_note,
    ...extra,
  };
}

/** 여러 범위를 합친 응답의 기준일. 범위마다 기준일이 다르면 하나로 대표하지 않고 null로 둔다(범위별 날짜는 coverage.snapshot_set). */
function setBasis(snapshots: readonly SnapshotRow[], requested: string | null): Basis {
  const dates = [...new Set(snapshots.map((snapshot) => snapshot.effective_reference_date))];
  return { requested_reference_date: requested, effective_reference_date: dates.length === 1 ? dates[0] ?? null : null, news_date_basis: null };
}

/** 실제로 쓴 snapshot 범위 전체를 출처로 밝힌다. 하나면 기존 형식, 여러 개면 범위별 기준일·원천 건수를 snapshot_set으로 모두 돌려준다. */
function setCoverage(snapshots: readonly SnapshotRow[], extra: Record<string, unknown> = {}, matches: Map<string, number> | null = null): Coverage {
  if (snapshots.length === 1) return snapshotCoverage(snapshots[0], { ...extra, ...(matches ? { matching_rows: matches.get(snapshots[0].snapshot_id) ?? 0 } : {}) });
  const dates = snapshots.map((snapshot) => snapshot.effective_reference_date).filter((value): value is string => Boolean(value)).sort();
  const tiers = [...new Set(snapshots.map((snapshot) => snapshot.access_tier))];
  return {
    scope: "여러 범위 결합(" + snapshots.length + "개)",
    complete: snapshots.every((snapshot) => snapshot.complete === 1),
    gaps: [...new Set(snapshots.map((snapshot) => snapshot.classification_basis)), SOURCE_GAP],
    snapshot_id: null,
    snapshot_set: snapshots.map((snapshot) => ({
      snapshot_id: snapshot.snapshot_id, scope: snapshot.scope_label, requested_reference_date: snapshot.requested_reference_date,
      effective_reference_date: snapshot.effective_reference_date, complete: snapshot.complete === 1, source_total_count: snapshot.expected_count,
      ...(matches ? { matching_rows: matches.get(snapshot.snapshot_id) ?? 0 } : {}),
    })),
    access_tier: tiers.length === 1 ? tiers[0] : "mixed",
    source_total_count: snapshots.reduce((sum, snapshot) => sum + snapshot.expected_count, 0),
    effective_reference_date_range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    reference_date_note: dates.length && dates[0] !== dates[dates.length - 1]
      ? "범위마다 기준일이 다릅니다. 항목별 기준일은 각 항목의 evidence와 snapshot_set을 보세요."
      : "결합한 범위의 기준일이 같습니다.",
    ...extra,
  };
}

/** 기관·부서·회계·검색어로 좁힌 조회면, 그 조건에 맞는 행이 있는 범위만 출처로 남긴다(맞는 행이 없으면 전체 범위를 그대로 둔다). */
async function usedSnapshots(db: SqlDatabase, snapshots: readonly SnapshotRow[], filter: ProjectFilter): Promise<{ used: readonly SnapshotRow[]; matches: Map<string, number> | null }> {
  const narrowed = Boolean(filter.entityId || filter.adminUnit || filter.departmentCodes?.length || filter.accountCodes?.length || filter.projectIds?.length || filter.query?.trim());
  if (snapshots.length < 2 || !narrowed) return { used: snapshots, matches: null };
  const matches = await snapshotMatchCounts(db, snapshots.map((snapshot) => snapshot.snapshot_id), filter);
  const used = snapshots.filter((snapshot) => matches.has(snapshot.snapshot_id));
  return { used: used.length ? used : snapshots, matches };
}

/** 지역 ID를 검증된 재정주체로 바꾼다. 검증 매핑이 없으면 상위 자치단체로 대체하지 않고 거절한다. */
async function entitiesForRegion(db: SqlDatabase, regionId: string): Promise<{ entityIds: string[]; candidates: string[] }> {
  const mappings = await fiscalMappings(db, regionId);
  const verified = mappings.filter((mapping) => mapping.verification_status === "VERIFIED" && mapping.relation === "jurisdiction");
  const candidates = mappings.filter((mapping) => mapping.verification_status !== "VERIFIED").map((mapping) => mapping.mapping_id + ": " + mapping.basis);
  if (!verified.length) {
    throw new McpToolError("MAPPING_REQUIRED", "이 지역에 검증된 재정주체 매핑이 없습니다. 상위 자치단체 전체를 이 지역 값으로 대신하지 않습니다." + (candidates.length ? " 확인 전 후보: " + candidates.join(" / ") : ""));
  }
  return { entityIds: verified.map((mapping) => mapping.fiscal_entity_id), candidates };
}

function departmentCode(value: string): string {
  const match = /^lofin:dept:\d+:(\d+)$/.exec(value);
  if (match) return match[1];
  if (/^\d{1,12}$/.test(value)) return value;
  throw new McpToolError("DEPARTMENT_ID_INVALID", "부서 ID는 get_fiscal_catalog(catalog_type=\"department\")가 돌려준 id 또는 숫자 부서코드여야 합니다.");
}

async function noSnapshot(make: Make, mode: string, reason: string | null) {
  const keyScope = mode === "all_fields";
  return make({
    status: "UNAVAILABLE",
    reason_code: keyScope ? "KEY_REQUIRED" : reason ?? "NO_PUBLISHED_SNAPSHOT",
    message: keyScope
      ? "사회복지·보건·부서별 조회는 자치단체 전체 세출 수집이 필요하며, 지방재정365 발급 인증키 등록 전이라 제공하지 않습니다."
      : "요청한 회계연도·기준일 범위에 공개된 재정 snapshot이 없습니다. get_fiscal_catalog(catalog_type=\"available_reference_date\")로 가용 기준일을 확인하세요.",
    items: [],
  }, { coverage: { scope: "fiscal", complete: false, gaps: ["공개 snapshot 없음"] }, warnings: ["빈 결과는 예산·지출이 0이라는 뜻이 아닙니다."] });
}

export async function getFiscalCatalog(db: SqlDatabase, args: Args<"get_fiscal_catalog">, make: Make, pin: readonly string[] | null = null) {
  const fiscalYear = args.fiscal_year ? String(args.fiscal_year) : undefined;
  const snapshots = await publishedSnapshots(db, { fiscalYear, snapshotIds: pin });
  const size = pageLimit(args.limit);
  const bound = fingerprint(["catalog", args.catalog_type, fiscalYear ?? "", args.region_id ?? "", args.fiscal_entity_id ?? "", snapshots.map((snapshot) => snapshot.snapshot_id)]);
  const offset = decodeCursor(args.cursor, bound);
  if (args.catalog_type === "department_history") {
    // 부서코드 연도별 관측 이력·연도 사이 사업 이관(T94). 재정주체 하나를 골라야 한다(전국 전체는 너무 큼).
    if (!args.fiscal_entity_id) throw new McpToolError("FISCAL_ENTITY_REQUIRED", "department_history는 fiscal_entity_id가 필요합니다.");
    const history = await departmentHistory(db, args.fiscal_entity_id, pin);
    if (!history) return make(null, { coverage: { scope: "department_history", complete: false, gaps: ["이 재정주체의 공개 자료 없음"] } });
    return make(history, {
      coverage: { scope: "department_history", complete: true, gaps: [], fiscal_years: history.fiscal_years },
      warnings: [history.basis, "원천은 부서명을 제공하지 않아 부서코드만 돌려줍니다."],
    });
  }
  if (args.catalog_type === "budget_document") {
    // 관리자가 승인·공개한 예산서 편성 단계 목록. 문서 단계 비교(compare_budget_periods, comparison_basis=document_stage)의 document_revision_id를 여기서 고른다.
    if (args.region_id) throw new McpToolError("INPUT_CONFLICT", "budget_document 목록은 fiscal_entity_id·fiscal_year로만 거릅니다.");
    const rows = (await activeRevisions(db, { entityId: args.fiscal_entity_id, year: fiscalYear })).map(revisionDto);
    const page = rows.slice(offset, offset + size);
    const next = offset + page.length < rows.length ? encodeCursor(offset + page.length, bound) : null;
    return make(page, {
      coverage: { scope: "published_budget_documents", complete: next === null, gaps: rows.length ? [] : ["조건에 맞는 공개 예산서 없음"] },
      warnings: ["예산서 금액은 그 문서 편성 단계(본예산·추경 등)의 값이며 단위는 문서 표시(천원)입니다. 문서마다 수록 범위(국·과)가 scope에 있습니다. 지방재정365 기준일 예산현액과 섞지 마세요."],
      nextCursor: next,
    });
  }
  if (args.catalog_type === "available_reference_date") {
    // 기관(또는 지역)을 지정하면 그 재정주체의 행이 실제로 들어 있는 snapshot만 돌려준다.
    let entityId = args.fiscal_entity_id;
    if (args.region_id) {
      const { entityIds } = await entitiesForRegion(db, args.region_id);
      if (entityId && !entityIds.includes(entityId)) throw new McpToolError("INPUT_CONFLICT", "fiscal_entity_id가 region_id의 검증된 재정주체가 아닙니다.");
      entityId = entityId ?? entityIds[0];
    }
    const matches = entityId && snapshots.length ? await snapshotMatchCounts(db, snapshots.map((snapshot) => snapshot.snapshot_id), { entityId }) : null;
    const listed = matches ? snapshots.filter((snapshot) => matches.has(snapshot.snapshot_id)) : snapshots;
    const items = listed.map((snapshot) => ({
      snapshot_id: snapshot.snapshot_id, scope: snapshot.scope_label, mode: snapshot.mode, fiscal_year: snapshot.fiscal_year,
      requested_reference_date: snapshot.requested_reference_date, effective_reference_date: snapshot.effective_reference_date, complete: snapshot.complete === 1, access_tier: snapshot.access_tier,
      ...(matches ? { fiscal_entity_rows: matches.get(snapshot.snapshot_id) ?? 0 } : {}),
    }));
    const page = items.slice(offset, offset + size);
    const next = offset + page.length < items.length ? encodeCursor(offset + page.length, bound) : null;
    return make(page, {
      coverage: { scope: matches ? "published_fiscal_snapshots_with_entity" : "published_fiscal_snapshots", complete: next === null, gaps: items.length ? [] : [matches ? "이 재정주체의 행이 든 공개 snapshot 없음" : "공개 snapshot 없음"], ...(entityId ? { fiscal_entity_id: entityId } : {}) },
      warnings: matches ? ["이 재정주체의 행이 들어 있는 공개 snapshot만 보여 줍니다. 전국 통합돌봄처럼 여러 기관을 담은 범위도 이 기관 행이 있으면 포함됩니다(fiscal_entity_rows)."] : [],
      nextCursor: next,
    });
  }
  // 광역별 전체 세출 범위가 여러 개면 범위마다 최신 공개본을 합쳐 목록을 만든다(웹 화면과 같은 규칙).
  const fullSet = (await chooseSnapshotSet(db, "all_fields", fiscalYear, undefined, undefined, pin)).snapshots;
  const snapshot = fullSet[0] ?? snapshots[0];
  if (!snapshot) return noSnapshot(make, "integrated_care", null);
  const catalogIds = fullSet.length ? fullSet.map((item) => item.snapshot_id) : [snapshot.snapshot_id];
  const filter: ProjectFilter = { entityId: args.fiscal_entity_id };
  let warnings: string[] = [];
  if (args.region_id) {
    const { entityIds, candidates } = await entitiesForRegion(db, args.region_id);
    if (args.fiscal_entity_id && !entityIds.includes(args.fiscal_entity_id)) throw new McpToolError("INPUT_CONFLICT", "fiscal_entity_id가 region_id의 검증된 재정주체가 아닙니다.");
    Object.assign(filter, { entityId: args.fiscal_entity_id ?? entityIds[0] });
    warnings = candidates.length ? ["확인 전 하위 매핑 후보가 있습니다: " + candidates.join(" / ")] : [];
  }
  const rows = await fiscalCatalog(db, catalogIds, args.catalog_type, filter);
  const page = rows.slice(offset, offset + size);
  const next = offset + page.length < rows.length ? encodeCursor(offset + page.length, bound) : null;
  const { used, matches } = await usedSnapshots(db, fullSet.length ? fullSet : [snapshot], filter);
  return make(page, {
    basis: setBasis(used, null),
    coverage: setCoverage(used, { note: "목록은 이 snapshot 범위에 나타난 값만이며 해당 재정주체의 전체 부서·회계 목록이 아닙니다." }, matches),
    warnings: args.catalog_type === "department" ? ["원천은 부서명을 제공하지 않아 부서코드만 돌려줍니다.", ...warnings] : warnings,
    nextCursor: next,
  });
}

export async function findBudgetProjects(db: SqlDatabase, args: Args<"find_budget_projects">, make: Make, pin: readonly string[] | null = null) {
  const mode = args.mode as FiscalMode;
  // 웹과 같은 규칙: 통합돌봄 분류를 마쳤으면 통합돌봄은 전체 세출 가운데 분류된 사업, 사회복지는 사회복지 분야 + 통합돌봄 사업.
  const classVersion = await integratedCareClassVersion(db);
  const scopeMode = mode === "integrated_care" && classVersion ? "all_fields" : MODE_SCOPE[mode];
  const choice = await chooseSnapshotSet(db, scopeMode, String(args.fiscal_year), args.reference_date, undefined, pin);
  const snapshot = choice.snapshots[0];
  if (!snapshot) return noSnapshot(make, scopeMode, choice.reason);
  const snapshotIds = choice.snapshots.map((item) => item.snapshot_id);
  const filter: { -readonly [K in keyof ProjectFilter]: ProjectFilter[K] } = {
    entityId: args.fiscal_entity_id,
    departmentCodes: args.department_ids?.map(departmentCode),
    accountCodes: args.account_ids,
    query: args.query,
    integratedCare: mode === "integrated_care" ? (classVersion ? "only" : undefined) : mode === "social_welfare" && classVersion ? "include" : undefined,
  };
  if (mode === "department" && !filter.departmentCodes?.length) throw new McpToolError("DEPARTMENT_REQUIRED", "mode=department는 department_ids가 필요합니다.");
  if (mode === "social_welfare" || mode === "health") {
    const codes = await modeFieldCodes(db, mode, snapshot.fiscal_year);
    if (!codes) throw new McpToolError("CODE_TABLE_MISSING", "해당 연도 원천 분야코드표에서 이 모드의 분야를 확인하지 못했습니다.");
    filter.fieldCodes = codes;
  }
  const warnings = [await unitNote(db, snapshotIds)];
  if (args.region_id) {
    const { entityIds, candidates } = await entitiesForRegion(db, args.region_id);
    if (filter.entityId && !entityIds.includes(filter.entityId)) throw new McpToolError("INPUT_CONFLICT", "fiscal_entity_id가 region_id의 검증된 재정주체가 아닙니다.");
    filter.entityId = filter.entityId ?? entityIds[0];
    if (candidates.length) warnings.push("확인 전 하위 매핑 후보는 적용하지 않았습니다: " + candidates.join(" / "));
  }
  if (choice.fallback_used) warnings.push("요청 기준일(" + choice.requested_reference_date + ") 자료가 없는 범위는 그 이전 가장 가까운 공개본을 썼습니다.");
  const { used, matches } = await usedSnapshots(db, choice.snapshots, filter);
  if (used.length > 1) {
    const dates = [...new Set(used.map((item) => item.requested_reference_date))].sort();
    warnings.push("광역 지역별 전체 세출 범위 " + used.length + "개를 합쳤습니다" + (dates.length > 1 ? "(지역마다 기준일이 다름: " + dates[0] + " ~ " + dates[dates.length - 1] + ")" : "") + ". 범위별 출처·기준일은 coverage.snapshot_set에 있습니다.");
  }
  const size = pageLimit(args.limit);
  const bound = fingerprint(["projects", snapshotIds, filter]);
  const offset = decodeCursor(args.cursor, bound);
  const [{ rows, total }, summary] = await Promise.all([
    snapshotProjects(db, snapshotIds, filter, offset, size),
    args.include_summary ? snapshotSummary(db, snapshotIds, filter) : Promise.resolve(null),
  ]);
  const next = offset + rows.length < total ? encodeCursor(offset + rows.length, bound) : null;
  const careBasis = classVersion && (mode === "integrated_care" || mode === "social_welfare") ? INTEGRATED_CARE_NOTE : null;
  // 공개 예산서(편성 단계 문서)에 같은 재정주체·연도·회계·세부사업명 행이 있으면 그 단계 ID와 BudgetLine ID를 붙인다(금액은 문서 단계 값).
  const links = await documentLinksForProjects(db, rows);
  if (links.size) warnings.push("budget_documents는 관리자가 승인한 공개 예산서의 편성 단계 금액(천원 표시)입니다. 지방재정365 예산현액(기준일 현액)과 뜻이 달라 대신 쓰지 않으며, 세부사업명으로 맞춘 결과입니다.");
  return make({ mode, items: rows.map((row) => ({ ...projectDto(row), budget_documents: links.get(row.fiscal_project_id) ?? [] })), summary, classification_basis: mode === "integrated_care" && careBasis ? careBasis : used[0].classification_basis, ...(careBasis ? { integrated_care_basis: careBasis } : {}) }, {
    basis: setBasis(used, choice.requested_reference_date),
    coverage: setCoverage(used, { total_count: total, fallback_used: choice.fallback_used }, matches),
    warnings,
    evidence: rows.slice(0, 5).map((row) => projectDto(row).evidence),
    nextCursor: next,
  });
}

async function observationFor(db: SqlDatabase, projectIds: readonly string[], fiscalYear: string, referenceDate: string | undefined, windowDays: number, pin: readonly string[] | null) {
  const snapshots = await publishedSnapshots(db, { fiscalYear, snapshotIds: pin });
  const earliest = referenceDate ? new Date(Date.parse(referenceDate + "T00:00:00Z") - windowDays * 86_400_000).toISOString().slice(0, 10) : "";
  const usable = snapshots.filter((snapshot) => !referenceDate || (snapshot.requested_reference_date <= referenceDate && snapshot.requested_reference_date >= earliest));
  const found = new Map<string, { row: ProjectRecord; snapshot: SnapshotRow }>();
  for (const snapshot of usable) {
    const missing = projectIds.filter((projectId) => !found.has(projectId));
    if (!missing.length) break;
    const { rows } = await snapshotProjects(db, snapshot.snapshot_id, { projectIds: missing }, 0, missing.length);
    for (const row of rows) found.set(row.fiscal_project_id, { row, snapshot });
  }
  return found;
}

export async function getBudgetExecution(db: SqlDatabase, args: Args<"get_budget_execution">, make: Make, pin: readonly string[] | null = null) {
  const policy = args.fallback_policy ?? "latest_before";
  const ids = [...new Set(args.fiscal_project_ids)];
  const found = await observationFor(db, ids, String(args.fiscal_year), args.reference_date, policy === "exact" ? 0 : 7, pin);
  const items = ids.map((projectId) => {
    const hit = found.get(projectId);
    return hit
      ? { ...projectDto(hit.row), snapshot_id: hit.snapshot.snapshot_id, requested_reference_date: args.reference_date ?? null, effective_reference_date: hit.snapshot.effective_reference_date, fallback_used: Boolean(args.reference_date && hit.snapshot.requested_reference_date !== args.reference_date) }
      : { fiscal_project_id: projectId, status: "NOT_FOUND", reason: "요청 연도·기준일 범위의 공개 snapshot에 이 재정사업이 없습니다." };
  });
  const dates = new Set([...found.values()].map((hit) => hit.snapshot.requested_reference_date));
  return make(items, {
    basis: { requested_reference_date: args.reference_date ?? null, effective_reference_date: dates.size === 1 ? [...found.values()][0].snapshot.effective_reference_date : null, news_date_basis: null },
    coverage: { scope: "requested_fiscal_projects", complete: found.size === ids.length, gaps: found.size === ids.length ? [] : ["일부 재정사업을 찾지 못했습니다."], fallback_policy: policy },
    warnings: [await unitNote(db, [...found.values()].map((hit) => hit.snapshot.snapshot_id)), ...(dates.size > 1 ? ["항목마다 기준일이 다릅니다. 서로 다른 날의 값을 하나의 합계로 묶지 마세요."] : [])],
  });
}

type YearMapping = {
  readonly basis: "same_entity_account_project_code";
  readonly left_fiscal_project_id: string | null;
  readonly right_fiscal_project_id: string | null;
  readonly candidates_in_other_year: number;
  readonly checks: { readonly department_same: boolean | null; readonly classification_same: boolean | null; readonly name_same: boolean | null };
};

interface ProjectKeyRow {
  readonly fiscal_project_id: string;
  readonly fiscal_year: string;
  readonly fiscal_entity_id: string;
  readonly account_code: string;
  readonly department_code: string;
  readonly dbiz_code: string;
  readonly name: string;
  readonly field_code: string;
  readonly part_code: string;
}

const PROJECT_KEY_COLUMNS = "fiscal_project_id, fiscal_year, fiscal_entity_id, account_code, department_code, dbiz_code, name, field_code, part_code";

/** 연도 간 짝: 요청 ID의 연도 반대편에서 같은 재정주체·회계·세부사업코드 사업을 찾고, 부서·분류가 같고 후보가 하나일 때만 비교한다. */
async function crossYearPairs(db: SqlDatabase, ids: readonly string[], leftYear: string, rightYear: string) {
  const own = new Map((await db.prepare("SELECT " + PROJECT_KEY_COLUMNS + " FROM fiscal_project WHERE fiscal_project_id IN (" + ids.map(() => "?").join(", ") + ")").bind(...ids).all<ProjectKeyRow>()).results.map((row) => [row.fiscal_project_id, row]));
  return Promise.all(ids.map(async (requested) => {
    const row = own.get(requested);
    const none = { requested, leftId: null as string | null, rightId: null as string | null, mapping: null as YearMapping | null };
    if (!row) return { ...none, blocked: "PROJECT_NOT_FOUND" };
    if (row.fiscal_year !== leftYear && row.fiscal_year !== rightYear) return { ...none, blocked: "PROJECT_YEAR_OUTSIDE_COMPARISON" };
    const otherYear = row.fiscal_year === leftYear ? rightYear : leftYear;
    const candidates = (await db.prepare("SELECT " + PROJECT_KEY_COLUMNS + " FROM fiscal_project WHERE fiscal_year = ? AND fiscal_entity_id = ? AND account_code = ? AND dbiz_code = ? LIMIT 5")
      .bind(otherYear, row.fiscal_entity_id, row.account_code, row.dbiz_code).all<ProjectKeyRow>()).results;
    const match = candidates.length === 1 ? candidates[0] : null;
    const leftRow = row.fiscal_year === leftYear ? row : match;
    const rightRow = row.fiscal_year === leftYear ? match : row;
    const mapping: YearMapping = {
      basis: "same_entity_account_project_code",
      left_fiscal_project_id: leftRow?.fiscal_project_id ?? null,
      right_fiscal_project_id: rightRow?.fiscal_project_id ?? null,
      candidates_in_other_year: candidates.length,
      checks: {
        department_same: match ? match.department_code === row.department_code : null,
        classification_same: match ? match.field_code === row.field_code && match.part_code === row.part_code : null,
        name_same: match ? match.name === row.name : null,
      },
    };
    const blocked = candidates.length === 0 ? "UNMATCHED_IN_OTHER_YEAR"
      : candidates.length > 1 ? "AMBIGUOUS_MATCH"
      : !mapping.checks.classification_same ? "CLASSIFICATION_CHANGED"
      : !mapping.checks.department_same ? "DEPARTMENT_CHANGED_UNVERIFIED"
      : null;
    return { requested, leftId: leftRow?.fiscal_project_id ?? null, rightId: rightRow?.fiscal_project_id ?? null, mapping, blocked };
  }));
}

export async function compareBudgetPeriods(db: SqlDatabase, args: Args<"compare_budget_periods">, make: Make, pin: readonly string[] | null = null) {
  const selections = [args.project_selection.fiscal_project_ids, args.project_selection.budget_line_ids, args.project_selection.detail_project_query].filter((item) => item !== undefined).length;
  if (selections !== 1) throw new McpToolError("INPUT_INVALID", "project_selection에는 fiscal_project_ids·budget_line_ids·detail_project_query 가운데 하나만 넣습니다.");
  if (args.comparison_basis === "document_stage" || args.left.document_revision_id || args.right.document_revision_id) return compareDocumentStages(db, args, make);
  if (!args.project_selection.fiscal_project_ids) throw new McpToolError("INPUT_INVALID", "기준일·연말 비교는 fiscal_project_ids로 고릅니다(budget_line_ids·detail_project_query는 예산서 단계 비교 전용).");
  if (args.left.account_id || args.right.account_id || (args.left.scope && args.left.scope !== "total") || (args.right.scope && args.right.scope !== "total")) {
    throw new McpToolError("SCOPE_FILTER_NOT_AVAILABLE", "회계·범위 조건은 재정사업 ID에 이미 포함되어 있어 따로 지정할 수 없습니다.");
  }
  const ids = [...new Set(args.project_selection.fiscal_project_ids)];
  const leftYear = String(args.left.fiscal_year);
  const rightYear = String(args.right.fiscal_year);
  // 연도가 다르면 재정사업 ID(연도 포함)가 달라 같은 ID로 맞출 수 없다. 같은 재정주체·회계·세부사업코드로 상대 연도 사업을 찾는다.
  const pairs = leftYear === rightYear
    ? ids.map((projectId) => ({ requested: projectId, leftId: projectId, rightId: projectId, mapping: null as YearMapping | null, blocked: null as string | null }))
    : await crossYearPairs(db, ids, leftYear, rightYear);
  const side = (period: Args<"compare_budget_periods">["left"], wanted: readonly string[]) =>
    observationFor(db, wanted, String(period.fiscal_year), period.observation_date ?? (args.comparison_basis === "year_end" ? period.fiscal_year + "-12-31" : undefined), args.comparison_basis === "year_end" ? 7 : 0, pin);
  const [left, right] = await Promise.all([
    side(args.left, [...new Set(pairs.flatMap((pair) => (pair.leftId ? [pair.leftId] : [])))]),
    side(args.right, [...new Set(pairs.flatMap((pair) => (pair.rightId ? [pair.rightId] : [])))]),
  ]);
  const items = pairs.map(({ requested: projectId, leftId, rightId, mapping, blocked }) => {
    if (blocked) return { fiscal_project_id: projectId, comparable: false, reason: blocked, mapping, note: "자료에서 빠졌거나 코드가 바뀌었다고 사업 신설·종료로 확정하지 않습니다." };
    const a = leftId ? left.get(leftId) : undefined;
    const b = rightId ? right.get(rightId) : undefined;
    if (!a || !b) {
      return { fiscal_project_id: projectId, comparable: false, reason: !a && !b ? "양쪽 모두 자료 없음" : !a ? "왼쪽 기간 자료 없음" : "오른쪽 기간 자료 없음", mapping, note: "자료에서 빠졌다고 사업 폐지·신설로 확정하지 않습니다." };
    }
    const budgetChange = subtractWon(b.row.current_budget_krw, a.row.current_budget_krw);
    const expenditureChange = subtractWon(b.row.public_expenditure_krw, a.row.public_expenditure_krw);
    const growth = budgetChange !== null && a.row.current_budget_krw !== null ? executionRate(budgetChange, a.row.current_budget_krw) : { value: null, reason: "BUDGET_UNKNOWN" as const };
    return {
      fiscal_project_id: projectId, name: b.row.name, comparable: true, mapping,
      left: { reference_date: a.snapshot.effective_reference_date, snapshot_id: a.snapshot.snapshot_id, current_budget_krw: a.row.current_budget_krw, public_expenditure_krw: a.row.public_expenditure_krw },
      right: { reference_date: b.snapshot.effective_reference_date, snapshot_id: b.snapshot.snapshot_id, current_budget_krw: b.row.current_budget_krw, public_expenditure_krw: b.row.public_expenditure_krw },
      current_budget_change_krw: budgetChange,
      current_budget_change_pct: growth.value,
      current_budget_change_pct_null_reason: growth.reason ?? null,
      net_reported_expenditure_change_krw: expenditureChange,
    };
  });
  return make(items, {
    coverage: { scope: "requested_fiscal_projects", complete: items.every((item) => item.comparable), gaps: [], comparison_basis: args.comparison_basis },
    warnings: [
      "지출액은 기준일까지의 누적 공개값이라, 두 날짜의 차이는 그 기간 개별 지출 거래의 합계가 아니라 보고값의 순변동입니다(정정·환입으로 음수일 수 있음).",
      ...(leftYear === rightYear ? [] : ["연도 간 비교는 같은 재정주체·회계·세부사업코드로 맞춘 결과입니다. 코드가 같아도 같은 사업이라는 확인은 아니며, 부서·분류가 바뀌었거나 후보가 여럿이면 비교하지 않습니다. 편성단계는 양쪽 모두 지방재정365 세출현황(예산현액)입니다."]),
      await unitNote(db, [...left.values(), ...right.values()].map((hit) => hit.snapshot.snapshot_id)),
    ],
  });
}

/**
 * 예산서 편성 단계끼리 비교(작업지시서 v5 §22.7·22.8, T90). 양쪽 모두 공개된 예산서 단계여야 하고, 기준일 현액(지방재정365)과 섞지 않는다.
 * 같은 재정주체·회계인지, 회계연도가 문서와 같은지 먼저 확인한다. 대상은 재정사업 ID·예산서 세부사업 행 ID·세부사업명 검색어 가운데 하나로 고르고,
 * 세부사업명(같은 이름이 여럿이면 부서·단위사업까지)으로 짝을 짓는다. 문서 범위 밖이거나 이름이 바뀐 경우 폐지·신설로 확정하지 않는다.
 * 오른쪽이 추경이고 「기정예산액」 칸이 있으면, 왼쪽 단계 금액과 오른쪽 기정예산액이 같은지도 알려 준다(사이에 다른 변경이 있었는지 판단 근거).
 */
async function compareDocumentStages(db: SqlDatabase, args: Args<"compare_budget_periods">, make: Make) {
  if (args.comparison_basis !== "document_stage") throw new McpToolError("MIXED_BASIS", "document_revision_id를 쓰는 비교는 comparison_basis=document_stage여야 합니다.");
  if (!args.left.document_revision_id || !args.right.document_revision_id) {
    throw new McpToolError("DOCUMENT_REVISION_REQUIRED", "예산서 단계 비교는 양쪽 모두 document_revision_id가 필요합니다. 예산서 단계 금액과 지방재정365 기준일 현액은 뜻이 달라 한 비교로 묶지 않습니다. 단계 목록은 get_fiscal_catalog(catalog_type=budget_document)에 있습니다.");
  }
  if (args.left.observation_date || args.right.observation_date) throw new McpToolError("MIXED_BASIS", "예산서 단계 비교에는 observation_date(기준일)를 함께 쓸 수 없습니다.");
  if (args.left.account_id || args.right.account_id || (args.left.scope && args.left.scope !== "total") || (args.right.scope && args.right.scope !== "total")) {
    throw new McpToolError("SCOPE_FILTER_NOT_AVAILABLE", "회계·범위는 예산서 단계에 이미 정해져 있어 따로 지정할 수 없습니다.");
  }
  if (args.left.document_revision_id === args.right.document_revision_id) throw new McpToolError("INPUT_CONFLICT", "같은 편성 단계끼리는 비교하지 않습니다.");
  const revisions = await activeRevisions(db, { revisionIds: [args.left.document_revision_id, args.right.document_revision_id] });
  const left = revisions.find((row) => row.revision_id === args.left.document_revision_id);
  const right = revisions.find((row) => row.revision_id === args.right.document_revision_id);
  if (!left || !right) throw new McpToolError("NOT_FOUND", "공개 중인 예산서 단계가 아닙니다: " + [!left ? args.left.document_revision_id : "", !right ? args.right.document_revision_id : ""].filter(Boolean).join(", "));
  if (String(args.left.fiscal_year) !== left.fiscal_year || String(args.right.fiscal_year) !== right.fiscal_year) throw new McpToolError("INPUT_CONFLICT", "fiscal_year가 예산서 단계의 회계연도와 다릅니다.");
  const blocked = !left.fiscal_entity_id || left.fiscal_entity_id !== right.fiscal_entity_id ? "DIFFERENT_FISCAL_ENTITY"
    : left.account_code !== right.account_code ? "DIFFERENT_ACCOUNT"
    : null;
  if (blocked) {
    return make({ comparable: false, reason: blocked, left: revisionDto(left), right: revisionDto(right), items: [] }, {
      coverage: { scope: "document_stage", complete: false, gaps: [blocked === "DIFFERENT_ACCOUNT" ? "두 문서의 회계가 다릅니다." : "두 문서의 재정주체가 같다는 확인이 없습니다."], comparison_basis: "document_stage" },
      warnings: ["비교 조건이 맞지 않아 금액을 비교하지 않았습니다."],
    });
  }
  type OutlineLine = { line_id: string; line_no: number; parent_line_no: number | null; level: string; name: string; amount_thousand_krw: string | null; previous_amount_thousand_krw: string | null; change_amount_thousand_krw: string | null; page: number | null };
  type Detail = OutlineLine & { department: string; unit: string };
  const detailsOf = async (revision: RevisionRow): Promise<Detail[]> => {
    const rows = (await db.prepare("SELECT line_id, line_no, parent_line_no, level, name, amount_thousand_krw, previous_amount_thousand_krw, change_amount_thousand_krw, page FROM budget_line WHERE import_id = ? AND revision_id = ? AND level IN ('department', 'policy', 'unit', 'detail_project')")
      .bind(revision.import_id, revision.revision_id).all<OutlineLine>()).results;
    const byNo = new Map(rows.map((row) => [row.line_no, row]));
    const up = (row: OutlineLine, level: string) => { let at: OutlineLine | undefined = row; while (at && at.level !== level) at = at.parent_line_no === null ? undefined : byNo.get(at.parent_line_no); return at?.name ?? ""; };
    return rows.filter((row) => row.level === "detail_project").map((row) => ({ ...row, department: up(row, "department"), unit: up(row, "unit") }));
  };
  const [leftDetails, rightDetails] = await Promise.all([detailsOf(left), detailsOf(right)]);
  type Target = { key: string; name: string; department?: string; unit?: string; fiscal_project_id?: string; budget_line_id?: string; problem?: string };
  const selection = args.project_selection;
  const warnings: string[] = [];
  let targets: Target[];
  if (selection.fiscal_project_ids) {
    const ids = [...new Set(selection.fiscal_project_ids)];
    const projects = (await db.prepare("SELECT fiscal_project_id, fiscal_entity_id, account_code, name FROM fiscal_project WHERE fiscal_project_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(ids)).all<{ fiscal_project_id: string; fiscal_entity_id: string; account_code: string; name: string }>()).results;
    const byId = new Map(projects.map((row) => [row.fiscal_project_id, row]));
    targets = ids.map((projectId) => {
      const project = byId.get(projectId);
      if (!project) return { key: projectId, name: "", fiscal_project_id: projectId, problem: "재정사업 ID를 찾지 못함" };
      if (project.fiscal_entity_id !== left.fiscal_entity_id || project.account_code !== left.account_code) return { key: projectId, name: project.name, fiscal_project_id: projectId, problem: "문서와 재정주체 또는 회계가 다른 사업" };
      return { key: projectId, name: project.name, fiscal_project_id: projectId };
    });
  } else if (selection.budget_line_ids) {
    const all = new Map([...leftDetails, ...rightDetails].map((row) => [row.line_id, row]));
    targets = [...new Set(selection.budget_line_ids)].map((lineId) => {
      const line = all.get(lineId);
      return line ? { key: lineId, name: line.name, department: line.department, unit: line.unit, budget_line_id: lineId } : { key: lineId, name: "", budget_line_id: lineId, problem: "두 단계 문서의 세부사업 행 ID가 아님" };
    });
  } else {
    const tokens = (selection.detail_project_query ?? "").split(/\s+/).filter(Boolean).slice(0, 5);
    const seen = new Set<string>();
    targets = [];
    for (const line of [...leftDetails, ...rightDetails]) {
      const key = squashName(line.department) + "|" + squashName(line.unit) + "|" + squashName(line.name);
      if (!tokens.every((token) => line.name.includes(token)) || seen.has(key)) continue;
      seen.add(key);
      targets.push({ key, name: line.name, department: line.department, unit: line.unit });
    }
    if (targets.length > LIMITS.fiscalIdsMax) {
      warnings.push("검색어에 맞는 세부사업이 " + targets.length + "건이라 앞 " + LIMITS.fiscalIdsMax + "건만 비교했습니다. 검색어를 좁혀 주세요.");
      targets = targets.slice(0, LIMITS.fiscalIdsMax);
    }
  }
  /** 이름으로 찾고, 여럿이면 부서·단위사업까지 같은 것만 남긴다. */
  const pick = (details: readonly Detail[], target: Target): Detail[] => {
    const named = details.filter((row) => squashName(row.name) === squashName(target.name));
    if (named.length <= 1 || !target.department) return named;
    const sameDept = named.filter((row) => squashName(row.department) === squashName(target.department ?? ""));
    if (sameDept.length <= 1) return sameDept;
    return sameDept.filter((row) => squashName(row.unit) === squashName(target.unit ?? ""));
  };
  const rightDto = revisionDto(right);
  const preColumn = rightDto.previous_column === "pre_revision_budget";
  const items = targets.map((target) => {
    const base = { ...(target.fiscal_project_id ? { fiscal_project_id: target.fiscal_project_id } : {}), ...(target.budget_line_id ? { budget_line_id: target.budget_line_id } : {}), name: target.name, ...(target.department ? { department: target.department, unit: target.unit } : {}) };
    if (target.problem) return { ...base, comparable: false, reason: target.problem };
    const a = pick(leftDetails, target);
    const b = pick(rightDetails, target);
    if (a.length > 1 || b.length > 1) return { ...base, comparable: false, reason: "문서 안에 같은 이름 세부사업이 여럿(자동 선택 안 함)" };
    if (!a.length || !b.length) {
      return { ...base, comparable: false, reason: !a.length && !b.length ? "양쪽 문서 범위에 없음" : !a.length ? "왼쪽 문서 범위에 없음" : "오른쪽 문서 범위에 없음", right_pre_revision_amount_thousand_krw: !a.length && b.length && preColumn ? b[0].previous_amount_thousand_krw : null, note: "문서 범위(수록한 국·과) 밖이거나 이름이 바뀐 경우일 수 있어 폐지·신설로 확정하지 않습니다." };
    }
    const change = thousandDifference(b[0].amount_thousand_krw, a[0].amount_thousand_krw);
    const baseAmount = thousandOf(a[0].amount_thousand_krw);
    const preRevision = preColumn ? b[0].previous_amount_thousand_krw : null;
    return {
      ...base, comparable: true,
      left: { budget_line_id: a[0].line_id, amount_thousand_krw: a[0].amount_thousand_krw, page: a[0].page },
      right: { budget_line_id: b[0].line_id, amount_thousand_krw: b[0].amount_thousand_krw, pre_revision_amount_thousand_krw: preRevision, document_change_thousand_krw: preColumn ? b[0].change_amount_thousand_krw : null, page: b[0].page },
      change_thousand_krw: change,
      change_pct: change !== null && baseAmount ? Math.round((change / baseAmount) * 10000) / 100 : null,
      change_pct_null_reason: change === null ? "AMOUNT_MISSING" : baseAmount ? null : "BASE_ZERO",
      left_equals_right_pre_revision: preRevision === null ? null : thousandDifference(preRevision, a[0].amount_thousand_krw) === 0,
    };
  });
  const stageNote = left.fiscal_year === right.fiscal_year
    ? stageLabel(left.stage, left.supplementary_round) + " → " + stageLabel(right.stage, right.supplementary_round) + "(같은 회계연도의 편성 단계 비교)"
    : left.fiscal_year + "년 " + stageLabel(left.stage, left.supplementary_round) + " ↔ " + right.fiscal_year + "년 " + stageLabel(right.stage, right.supplementary_round) + "(연도가 다른 문서 비교)";
  return make({ comparable: true, stage_relation: stageNote, left: revisionDto(left), right: rightDto, unit: "천원(문서 표시 단위)", items }, {
    coverage: { scope: "document_stage", complete: items.every((item) => item.comparable), gaps: [], comparison_basis: "document_stage", left_scope: left.scope_text, right_scope: right.scope_text },
    warnings: [
      "예산서 단계 금액끼리의 비교입니다. 지방재정365 예산현액·지출액(기준일 값)과 섞지 않았습니다.",
      "세부사업명으로 맞춘 결과이며(같은 이름이 여럿이면 부서·단위사업까지), 이름이 같아도 사업 내용이 같다는 확인은 아닙니다.",
      ...(preColumn ? ["오른쪽 문서의 기정예산액은 그 추경 직전까지 확정된 금액입니다. 왼쪽 단계 금액과 다르면 사이에 다른 추경·변경이 있었을 수 있습니다. 추경 사업명세서는 바뀐 사업만 싣기 때문에 오른쪽에 없는 사업은 변경이 없었을 수 있습니다."] : []),
      ...warnings,
    ],
  });
}
