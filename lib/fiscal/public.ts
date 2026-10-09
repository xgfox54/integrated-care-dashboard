// 「복지예산 집행현황」 공개 조회: 화면과 /api/budget이 함께 쓴다. 공개 snapshot이 없거나 모드에 필요한 원천이 없으면
// 숨기거나 추정하지 않고 미가용 사유를 돌려준다.
import type { SqlDatabase } from "../sql-database.ts";
import { readWebPin } from "../platform/public-pin.ts";
import { parseTargetGroup, TARGET_GROUP_DEFINITION_VERSION } from "../target-groups.ts";
import { unitNote } from "./unit-check.ts";
import { cachedBudgetPart, rememberedFor } from "./response-cache.ts";
import { integratedCareClassVersion } from "./classify.ts";
import { availableBudgetParts, budgetPartOf } from "./parts.ts";
import departmentExclusions from "./department-exclusions.json" with { type: "json" };
import { type FiscalMode, FISCAL_MODES, fiscalCatalog, modeFieldCodes, pickSnapshotSet, type ProjectFilter, projectDto, publishedSnapshots, snapshotProjectRows, snapshotRegionSummary, snapshotSummary, type SnapshotRow } from "./query.ts";

export const BUDGET_PAGE_SIZE = 20;
const EXCLUDED_DEPARTMENT_KEYS: readonly string[] = departmentExclusions.departments.map(row => row.fiscal_entity_name + "|" + row.department_code);
/** 단위 대조 문구·분야코드처럼 수집 때만 바뀌는 작은 값을 서버 메모리에 두는 시간. */
const SMALL_MEMO_MS = 10 * 60_000;
// 공개 snapshot 목록(최대 2000행)과 행정단위는 화면 하나가 동시에 보내는 여러 조회가 똑같이 읽는다. D1은 요청을 차례로 처리해
// 동시 조회가 몰리면 몇 초씩 밀린다. 한 줄짜리 변경 신호(공개 snapshot 수·공개 시각 합, 행정단위 정의)를 먼저 읽고
// 신호가 같으면 기억한 목록을 쓴다. 승인·해제·새 공개본·행정단위 변경은 신호가 바뀌어 바로 반영된다(2026-10-09 속도 점검).
const BASE_SIGNAL_SQL =
  "SELECT (SELECT COUNT(*) || ':' || COALESCE(SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END), 0) || ':' || COALESCE(SUM(CASE WHEN status = 'PUBLISHED' THEN published_at ELSE 0 END), 0) FROM fiscal_snapshot) AS snapshots, " +
  "(SELECT COUNT(*) || ':' || COALESCE(group_concat(unit_id || '=' || dept_prefix || '=' || verification_status, ','), '') FROM fiscal_admin_unit) AS units";
// 특별법 제7조제1항(2026-07-01 시행): 광주광역시·전라남도 폐지.
// 원천 코드·과거 예산은 보존하고, 통합 이후 기준일의 선택 목록에서만 종전 본청을 뺀다.
const METRO_MERGER_DATE = "2026-07-01";
const RETIRED_METRO_CODES: ReadonlySet<string> = new Set(["2900000", "4600000"]);
/** full: 조회 결과와 조건 목록 모두(MCP·미리 계산), main: 조회 결과만, filters: 조건 목록만. */
export type BudgetView = "full" | "main" | "filters";
const BUDGET_VIEWS: readonly BudgetView[] = ["full", "main", "filters"];
export const MODE_LABELS: Record<FiscalMode, string> = { integrated_care: "통합돌봄", social_welfare: "사회복지", health: "보건", department: "기관별" };
const MODE_SCOPE: Record<FiscalMode, string> = { integrated_care: "integrated_care", social_welfare: "all_fields", health: "all_fields", department: "all_fields" };

export interface BudgetRequest {
  readonly mode: FiscalMode;
  readonly year: string;
  readonly date: string;
  readonly region: string;
  readonly entity: string;
  readonly department: string;
  readonly account: string;
  readonly q: string;
  readonly page: number;
  readonly view: BudgetView;
  /** 대상자 묶음 slug(target_group). 비우면 조건 없음. */
  readonly targetGroup?: string;
  /** 세부 예산분야(지방재정365 부문코드, lib/fiscal/parts.ts). 비우면 분야 전체. */
  readonly part?: string;
}

export type BudgetParse = { readonly ok: true; readonly request: BudgetRequest } | { readonly ok: false; readonly message: string };

export function parseBudgetRequest(params: URLSearchParams): BudgetParse {
  const value = (key: string, max = 40) => (params.get(key) ?? "").trim().slice(0, max);
  const mode = (value("mode") || "social_welfare") as FiscalMode;
  if (!FISCAL_MODES.includes(mode)) return { ok: false, message: "알 수 없는 조회 모드입니다." };
  const year = value("year");
  const date = value("date");
  if (year && !/^\d{4}$/.test(year)) return { ok: false, message: "회계연도는 네 자리 숫자여야 합니다." };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "기준일은 YYYY-MM-DD 형식이어야 합니다." };
  for (const key of ["region", "department", "account"]) {
    if (value(key) && !/^\d{1,12}$/.test(value(key))) return { ok: false, message: "코드는 숫자 문자열이어야 합니다." };
  }
  const view = (value("view") || "full") as BudgetView;
  if (!BUDGET_VIEWS.includes(view)) return { ok: false, message: "알 수 없는 응답 범위입니다." };
  const entity = value("entity", 60);
  if (entity && !/^(lofin:laf:\d{1,12}|admin:\d{1,12}:\d{1,4})$/.test(entity)) return { ok: false, message: "기관 ID가 올바르지 않습니다." };
  const page = Number.parseInt(value("page") || "1", 10);
  if (params.getAll("target_group").length > 1) return { ok: false, message: "target_group은 한 번만 쓸 수 있습니다." };
  const targetGroup = value("target_group", 48) ? parseTargetGroup(value("target_group", 48)) : "";
  if (targetGroup === null) return { ok: false, message: "알 수 없는 대상자 묶음입니다." };
  if (params.getAll("part").length > 1) return { ok: false, message: "part는 한 번만 쓸 수 있습니다." };
  const partCode = value("part", 8);
  const part = partCode ? budgetPartOf(partCode) : undefined;
  if (partCode && !part) return { ok: false, message: "알 수 없는 예산 분야입니다." };
  if (part && part.mode !== mode) return { ok: false, message: "예산 분야(" + part.name + ")와 조회 분야가 맞지 않습니다." };
  return {
    ok: true,
    request: { mode, year, date, region: value("region"), entity, department: value("department"), account: value("account"), q: value("q", 60), page: Number.isInteger(page) ? Math.min(Math.max(page, 1), 10000) : 1, view, targetGroup, part: part?.code ?? "" },
  };
}

function snapshotMeta(snapshot: SnapshotRow) {
  return {
    snapshot_id: snapshot.snapshot_id,
    scope_label: snapshot.scope_label,
    classification_basis: snapshot.classification_basis,
    fiscal_year: snapshot.fiscal_year,
    requested_reference_date: snapshot.requested_reference_date,
    effective_reference_date: snapshot.effective_reference_date,
    reference_date_note: snapshot.reference_date_note,
    access_tier: snapshot.access_tier,
    expected_count: snapshot.expected_count,
    unique_count: snapshot.unique_count,
    complete: snapshot.complete === 1,
    published_at: snapshot.published_at ? new Date(snapshot.published_at * 1000).toISOString() : null,
  };
}

export const INTEGRATED_CARE_NOTE = "통합돌봄 예산은 통합돌봄 WIKI(보건복지부 통합돌봄 사업안내) 사업명과 같은 지자체 세부사업명이 일치하거나 세부사업명에 「통합돌봄」이 들어간 사업입니다(원천에 부기명이 없어 세부사업명으로 대조). 통합돌봄은 사회복지의 하위 분류라 사회복지 합계에 포함하며, 분야가 보건 등으로 다른 통합돌봄 사업도 사회복지에 넣습니다.";

export const BUDGET_NOTES = [
  "예산현액·지출액은 지방재정365 「세부사업별 세출현황」의 공개값이며, 내부 실시간 전표나 최종 수혜기관의 실제 집행액이 아닙니다.",
  "차액(미지출액)은 예산현액에서 공개 지출액을 뺀 값으로 집행가능잔액·불용액이 아닙니다.",
  "집행률은 공개 지출액 ÷ 예산현액이며 사업 완료율이나 성과가 아닙니다. 예산현액이 0이거나 확인되지 않으면 표시하지 않습니다.",
];

/** 여러 범위(광역별 전체 세출)를 합쳐 보여 줄 때의 기준 설명. 범위가 하나면 그 snapshot 그대로다. */
function snapshotSetMeta(snapshots: readonly SnapshotRow[]) {
  const first = snapshots[0];
  if (snapshots.length === 1) return snapshotMeta(first);
  const dates = [...new Set(snapshots.map((snapshot) => snapshot.requested_reference_date))].sort();
  return {
    ...snapshotMeta(first),
    snapshot_id: first.snapshot_id,
    scope_label: "광역·기초 자치단체 전체 세출(광역 " + snapshots.length + "개 지역 범위 합산)",
    requested_reference_date: dates[dates.length - 1],
    effective_reference_date: dates.length === 1 ? dates[0] : null,
    reference_date_note: dates.length === 1
      ? first.reference_date_note
      : "광역 지역마다 기준일이 다릅니다(" + dates[0] + " ~ " + dates[dates.length - 1] + "). 큰 범위는 주 1회 받으며 지역별 기준일은 범위 목록에 있습니다.",
    expected_count: snapshots.reduce((sum, snapshot) => sum + snapshot.expected_count, 0),
    unique_count: snapshots.reduce((sum, snapshot) => sum + snapshot.unique_count, 0),
    complete: snapshots.every((snapshot) => snapshot.complete === 1),
  };
}

interface AdminUnitRow { readonly unit_id: string; readonly name: string; readonly unit_type: string; readonly parent_entity_id: string; readonly dept_prefix: string; readonly region_name: string; readonly verification_status: string }

async function adminUnits(db: SqlDatabase): Promise<AdminUnitRow[]> {
  return (await db.prepare("SELECT unit_id, name, unit_type, parent_entity_id, dept_prefix, region_name, verification_status FROM fiscal_admin_unit WHERE verification_status = 'VERIFIED' ORDER BY unit_id").all<AdminUnitRow>()).results;
}

export async function readBudget(db: SqlDatabase, request: BudgetRequest) {
  // 웹도 MCP처럼 활성 통합 공개본의 재정 snapshot만 본다(공개본이 없으면 공개 승인된 전체).
  // 공개 상태·분류 버전·공개 snapshot 목록·행정단위는 서로 기다릴 필요가 없어 한꺼번에 읽는다(승인 해제는 이 조회로 매번 바로 반영).
  const signal = await db.prepare(BASE_SIGNAL_SQL).first<{ snapshots: string; units: string }>();
  const [pin, classVersion, published, units] = await Promise.all([
    readWebPin(db),
    integratedCareClassVersion(db),
    rememberedFor(db, "base:published:" + (signal?.snapshots ?? ""), SMALL_MEMO_MS, () => publishedSnapshots(db, { limit: 2000 })),
    rememberedFor(db, "base:units:" + (signal?.units ?? ""), SMALL_MEMO_MS, () => adminUnits(db)),
  ]);
  // 사회복지·보건은 원천(지방재정365) 분야코드 그대로만 고른다. 세부사업명으로 만든 통합돌봄 분류는 섞지 않는다(2026-10-06 운영자 지시).
  const scopeOf = (mode: FiscalMode) => (mode === "integrated_care" && classVersion ? "all_fields" : MODE_SCOPE[mode]);
  const integratedCare = request.mode === "integrated_care" && classVersion ? "only" as const : undefined;
  // chooseSnapshotSet과 같은 규칙(범위 모드·회계연도·공개본 고정, 모드마다 최대 400개)으로 이미 읽은 목록에서 고른다.
  const choose = (mode: FiscalMode, date: string | undefined) => pickSnapshotSet(
    published.filter((snapshot) => snapshot.mode === scopeOf(mode) && (!request.year || snapshot.fiscal_year === request.year) && (!pin.fiscalSnapshotIds || pin.fiscalSnapshotIds.includes(snapshot.snapshot_id))).slice(0, 400),
    request.year || undefined,
    date,
  );
  const modes = FISCAL_MODES.map((mode) => ({ id: mode, label: MODE_LABELS[mode], available: choose(mode, undefined).snapshots.length > 0 }));
  const choice = choose(request.mode, request.date || undefined);
  const snapshotIds = choice.snapshots.map((snapshot) => snapshot.snapshot_id);
  const careNote = classVersion && request.mode === "integrated_care" ? [INTEGRATED_CARE_NOTE] : [];
  const unitNoteText = rememberedFor(db, "unit-note:" + snapshotIds.join(","), SMALL_MEMO_MS, () => unitNote(db, snapshotIds));
  const baseOf = async () => ({ mode: request.mode, modes, notes: [...BUDGET_NOTES, ...careNote, await unitNoteText], release_bundle_id: pin.bundleId });
  const emptyFilters = { regions: [], entities: [], departments: [], accounts: [], parts: [] };
  if (!choice.snapshots.length) {
    if (request.view === "filters") return { mode: request.mode, filters: emptyFilters };
    const keyScope = scopeOf(request.mode) === "all_fields";
    return {
      ...(await baseOf()),
      snapshot: null,
      snapshot_set: [],
      unavailable: {
        code: keyScope ? "KEY_REQUIRED" : choice.reason ?? "NO_PUBLISHED_SNAPSHOT",
        message: keyScope
          ? MODE_LABELS[request.mode] + " 조회는 자치단체 전체 세출 자료가 필요합니다. 표본키로는 받을 수 없어 지방재정365 발급 인증키 등록 뒤 제공됩니다."
          : request.date
            ? "요청한 기준일과 그 이전 7일 안에 공개된 자료가 없습니다. 다른 날짜로 조회해 주세요."
            : "아직 공개된 수집 자료가 없습니다. 수집 범위가 관리자 검토·승인을 기다리고 있습니다.",
      },
      requested_reference_date: choice.requested_reference_date,
      fallback_used: false,
      summary: null, items: [], total: 0, page: 1, size: BUDGET_PAGE_SIZE, filters: emptyFilters,
    };
  }
  const snapshot = choice.snapshots[0];
  // 고른 snapshot의 회계연도가 하나일 때만 기관 색인 조건으로 쓴다(lib/fiscal/query.ts ProjectFilter.fiscalYear).
  const fiscalYear = new Set(choice.snapshots.map((row) => row.fiscal_year)).size === 1 ? snapshot.fiscal_year : undefined;
  const fieldCodesOf = (mode: FiscalMode) => rememberedFor(db, "field-codes:" + mode + ":" + snapshot.fiscal_year, SMALL_MEMO_MS, () => modeFieldCodes(db, mode, snapshot.fiscal_year));
  // 세부 예산분야 목록은 사회복지·보건 두 분야의 부문을 함께 본다(같은 전체 세출 snapshot). 부서에 보건 사업이 있으면 보건의료도 보인다.
  const partFieldCodes = [...((await fieldCodesOf("social_welfare")) ?? []), ...((await fieldCodesOf("health")) ?? [])];
  const catalogReferenceDate = request.date || choice.snapshots.reduce((latest, row) => row.requested_reference_date > latest ? row.requested_reference_date : latest, "");
  const setMeta = choice.snapshots.map((item) => ({ scope_label: item.scope_label, requested_reference_date: item.requested_reference_date, complete: item.complete === 1, expected_count: item.expected_count }));
  const unit = request.entity.startsWith("admin:") ? units.find((row) => row.unit_id === request.entity) ?? null : null;
  // 무거운 집계는 같은 공개본·조건·행정단위 정의면 결과가 같으므로 저장해 다시 쓴다(response-cache.ts).
  const cacheBase = { snapshotIds, classVersion, excludedDepartmentKeys: EXCLUDED_DEPARTMENT_KEYS, units: units.map((row) => [row.unit_id, row.name, row.unit_type, row.dept_prefix]) };
  const cachedFilters = (fieldCodes?: readonly string[]) =>
    cachedBudgetPart(db, { ...cacheBase, part: "filters-v7", catalogReferenceDate, region: request.region, entity: request.entity, department: request.department, fieldCodes: fieldCodes ?? null, partFieldCodes, integratedCare: integratedCare ?? null }, async () => {
      // 지역·기관 목록과 전국 사업 수는 고른 지역·기관·부서와 무관하다. 조건마다 다시 세지 않도록 따로 저장한다.
      const national = await cachedBudgetPart(db, { ...cacheBase, part: "filters-national-v1", catalogReferenceDate, fieldCodes: fieldCodes ?? null, integratedCare: integratedCare ?? null }, () => nationalFilterParts(db, snapshotIds, fieldCodes, integratedCare));
      return filterOptions(db, snapshotIds, request, units, catalogReferenceDate, national, fieldCodes, integratedCare, partFieldCodes, fiscalYear);
    });
  // 화면은 조회 결과(view=main)와 조건 목록(view=filters)을 따로 받는다. 쪽을 넘길 때 큰 조건 목록을 다시 보내지 않기 위해서다.
  const filtersFor = async (fieldCodes?: readonly string[]) => (request.view === "main" ? {} : { filters: await cachedFilters(fieldCodes) });
  let fieldCodes: string[] | undefined;
  if (request.mode === "social_welfare" || request.mode === "health") {
    const codes = await fieldCodesOf(request.mode);
    if (!codes) {
      if (request.view === "filters") return { mode: request.mode, filters: emptyFilters };
      const head = { ...(await baseOf()), snapshot: snapshotSetMeta(choice.snapshots), snapshot_set: setMeta, requested_reference_date: choice.requested_reference_date, fallback_used: choice.fallback_used };
      return { ...head, unavailable: { code: "CODE_TABLE_MISSING", message: "해당 연도 원천 분야코드표에서 「" + MODE_LABELS[request.mode] + "」 분야를 확인하지 못했습니다." }, summary: null, items: [], total: 0, page: 1, size: BUDGET_PAGE_SIZE, filters: emptyFilters };
    }
    fieldCodes = codes;
  }
  if (request.view === "filters") return { mode: request.mode, filters: await cachedFilters(fieldCodes) };
  const head = { ...(await baseOf()), snapshot: snapshotSetMeta(choice.snapshots), snapshot_set: setMeta, requested_reference_date: choice.requested_reference_date, fallback_used: choice.fallback_used };
  if (request.entity.startsWith("admin:") && !unit) {
    return { ...head, unavailable: { code: "UNKNOWN_ADMIN_UNIT", message: "확인된 행정시·행정구가 아닙니다." }, summary: null, items: [], total: 0, page: 1, size: BUDGET_PAGE_SIZE, ...(await filtersFor()) };
  }
  // 기관별: 자치단체(광역·기초) 또는 행정시를 하나 골라 그 기관의 전체 세출을 본다(부서코드로 더 좁힐 수 있음).
  if (request.mode === "department" && !request.entity && !request.department) {
    return { ...head, unavailable: { code: "ENTITY_REQUIRED", message: "기관별 조회는 지역과 기관(광역·기초 자치단체, 제주시·서귀포시 같은 행정시 또는 창원시 의창구 같은 행정구)을 골라야 합니다. 기관 예산 전체가 복지예산 전체라는 뜻은 아닙니다." }, summary: null, items: [], total: 0, page: 1, size: BUDGET_PAGE_SIZE, ...(await filtersFor(fieldCodes)) };
  }
  const filter: ProjectFilter = {
    waCode: request.region || undefined,
    entityId: request.entity && !unit ? request.entity : undefined,
    fiscalYear,
    adminUnit: unit ? { entityId: unit.parent_entity_id, deptPrefix: unit.dept_prefix } : undefined,
    departmentCodes: request.department ? [request.department] : undefined,
    excludedDepartmentKeys: EXCLUDED_DEPARTMENT_KEYS,
    accountCodes: request.account ? [request.account] : undefined,
    fieldCodes,
    partCodes: request.part ? [request.part] : undefined,
    integratedCare,
    query: request.q || undefined,
    targetGroup: request.targetGroup || undefined,
  };
  const offset = (request.page - 1) * BUDGET_PAGE_SIZE;
  // 주의: 캐시 열쇠의 part는 저장 구역 이름(summary·rows)이다. 세부 예산분야는 budgetPart로 따로 싣는다.
  const queryKey = { ...cacheBase, mode: request.mode, region: request.region, entity: request.entity, department: request.department, account: request.account, budgetPart: request.part ?? "", q: request.q, targetGroup: request.targetGroup ?? "", targetGroupVersion: TARGET_GROUP_DEFINITION_VERSION, fieldCodes: fieldCodes ?? null, integratedCare: integratedCare ?? null };
  const [summary, { rows }, filters, regionsSummary] = await Promise.all([
    cachedBudgetPart(db, { ...queryKey, part: "summary" }, () => snapshotSummary(db, snapshotIds, filter)),
    cachedBudgetPart(db, { ...queryKey, part: "rows", page: request.page }, async () => {
      const page = await snapshotProjectRows(db, snapshotIds, filter, offset, BUDGET_PAGE_SIZE);
      return { rows: page.map(projectDto) };
    }),
    filtersFor(fieldCodes),
    // 광역 선택·지도·순위는 같은 공개본·분야의 전국 집계이며 상세 조회 조건과 독립적이다.
    cachedBudgetPart(db, { ...cacheBase, part: "regions", mode: request.mode, fieldCodes: fieldCodes ?? null, integratedCare: integratedCare ?? null }, () => snapshotRegionSummary(db, snapshotIds, { excludedDepartmentKeys: EXCLUDED_DEPARTMENT_KEYS, fieldCodes, integratedCare })),
  ]);
  return {
    ...head,
    unavailable: null,
    summary,
    regions_summary: regionsSummary,
    items: rows,
    total: summary.matching_rows,
    page: request.page,
    size: BUDGET_PAGE_SIZE,
    ...filters,
  };
}

/**
 * 조회 조건 목록. 지역·기관 목록은 지금 공개본에 사업이 없는 기관도 기준일에 존속하는 알려진 자치단체는 보여 주고(사업 수 0),
 * 확인된 행정시(제주시·서귀포시 등)는 상위 자치단체 아래에 함께 넣는다.
 */
interface NationalFilterParts {
  readonly known: readonly { id: string; name: string; code: string; region_code: string; region_name: string }[];
  readonly counted: readonly Record<string, unknown>[];
  readonly publishedEntities: readonly Record<string, unknown>[];
}

async function nationalFilterParts(db: SqlDatabase, snapshotIds: readonly string[], fieldCodes?: readonly string[], integratedCare?: "only" | "include"): Promise<NationalFilterParts> {
  const [known, counted, publishedEntities] = await Promise.all([
    db.prepare("SELECT fiscal_entity_id AS id, name, code, wa_code AS region_code, wa_name AS region_name FROM fiscal_entity ORDER BY wa_code, code").all<{ id: string; name: string; code: string; region_code: string; region_name: string }>(),
    fiscalCatalog(db, snapshotIds, "fiscal_entity", { fieldCodes, integratedCare, excludedDepartmentKeys: EXCLUDED_DEPARTMENT_KEYS }),
    fiscalCatalog(db, snapshotIds, "fiscal_entity", {}),
  ]);
  return { known: known.results, counted, publishedEntities };
}

async function filterOptions(db: SqlDatabase, snapshotIds: readonly string[], request: BudgetRequest, units: readonly AdminUnitRow[], catalogReferenceDate: string, national: NationalFilterParts, fieldCodes?: readonly string[], integratedCare?: "only" | "include", partFieldCodes: readonly string[] = [], fiscalYear?: string) {
  const unit = units.find((row) => row.unit_id === request.entity);
  const scope = {
    excludedDepartmentKeys: EXCLUDED_DEPARTMENT_KEYS,
    waCode: request.region || undefined,
    entityId: request.entity && !unit ? request.entity : undefined,
    fiscalYear,
    adminUnit: unit ? { entityId: unit.parent_entity_id, deptPrefix: unit.dept_prefix } : undefined,
    fieldCodes,
    integratedCare,
  };
  const departmentScope = { ...scope, departmentCodes: request.department ? [request.department] : undefined };
  const { known, counted, publishedEntities } = national;
  const [departments, accounts, classifications] = await Promise.all([
    fiscalCatalog(db, snapshotIds, "department", scope),
    fiscalCatalog(db, snapshotIds, "account", departmentScope),
    // 세부 예산분야: 고른 지역·기관·부서에 사업이 있는 부문만(사회복지·보건 두 분야).
    fiscalCatalog(db, snapshotIds, "classification", { ...departmentScope, fieldCodes: partFieldCodes.length ? partFieldCodes : fieldCodes, integratedCare: undefined }),
  ]);
  const knownEntities = known.filter((entity) => catalogReferenceDate < METRO_MERGER_DATE || !RETIRED_METRO_CODES.has(entity.code));
  const knownEntityIds = new Set(knownEntities.map((entity) => entity.id));
  const counts = new Map(counted.map((row) => [String(row.id), Number(row.project_count)]));
  const regions = new Map<string, string>();
  for (const entity of knownEntities) regions.set(String(entity.region_code), String(entity.region_name));
  const entities: { id: string; name: string; region_code: string; kind: "local_government" | "admin_unit"; project_count: number; parent_entity_id: string | null }[] = [];
  for (const entity of knownEntities) {
    if (request.region && entity.region_code !== request.region) continue;
    entities.push({ id: entity.id, name: entity.name, region_code: String(entity.region_code), kind: "local_government", project_count: counts.get(entity.id) ?? 0, parent_entity_id: null });
    for (const child of units.filter((row) => row.parent_entity_id === entity.id)) {
      entities.push({ id: child.unit_id, name: child.name + (child.unit_type === "ADMIN_DISTRICT" ? "(행정구)" : "(행정시)"), region_code: String(entity.region_code), kind: "admin_unit", project_count: -1, parent_entity_id: entity.id });
    }
  }
  return {
    regions: [...regions.entries()].map(([code, name]) => ({ code, name })),
    entities,
    known_local_governments: knownEntities.length,
    published_local_governments: publishedEntities.filter((entity) => knownEntityIds.has(String(entity.id))).length,
    departments: departments.map((department) => {
      const entityId = String(department.fiscal_entity_id);
      const code = String(department.code);
      const matches = units.filter((child) => child.parent_entity_id === entityId && child.dept_prefix.split(",").some((prefix) => code.startsWith(prefix.trim())));
      const owner = matches.length === 1 ? matches[0] : undefined;
      return { code, fiscal_entity_name: String(department.fiscal_entity_name), project_count: Number(department.project_count), region_code: String(department.region_code), entity_id: owner?.unit_id ?? entityId };
    }),
    accounts: accounts.map((account) => ({ code: String(account.code), name: String(account.name) })),
    parts: availableBudgetParts(classifications.reduce((counts, row) => counts.set(String(row.part_code), (counts.get(String(row.part_code)) ?? 0) + Number(row.project_count)), new Map<string, number>())),
  };
}
