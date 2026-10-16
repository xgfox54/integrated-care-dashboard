// 공개 조회: 웹 화면(/care, 위키 사업 상세)과 공개 MCP가 같은 함수를 써서 건수·기준일·출처·상태가 같게 나오게 한다.
// 확정(VERIFIED)되지 않은 사업–기관·사업–법령·사업–정부24 관계는 확정 관계로 돌려주지 않고 대기 건수만 알린다.
import type { SqlDatabase } from "../sql-database.ts";
import { gov24Dto, type Gov24Row } from "../mcp/gov24.ts";
import { compactSearchSql, compactSearchText } from "../mcp/search-text.ts";
import { hydrateGov24Details } from "./gov24-detail-hydration.ts";
import { institutionsPerThousandElderly, type Indicator, type KosisAggregate, legalCodesForRegion, type Observation, regionSeries, type SeriesPoint } from "./kosis.ts";

export type DataState = "COLLECTED" | "NOT_COLLECTED" | "AUTH_REQUIRED" | "SOURCE_ERROR" | "LINK_UNVERIFIED" | "COLLECTING";

export const STATE_LABELS: Readonly<Record<DataState, string>> = {
  COLLECTED: "수집됨", NOT_COLLECTED: "미수집", AUTH_REQUIRED: "미수집(인증키 필요)", SOURCE_ERROR: "원천 장애", LINK_UNVERIFIED: "연결 미확인", COLLECTING: "수집 중",
};

export interface DatasetStatus {
  readonly dataset_key: string;
  readonly provider: string;
  readonly dataset_name: string;
  readonly official_url: string;
  readonly access: string;
  readonly terms: string;
  readonly rate_limit: string;
  readonly update_cycle: string;
  readonly state: DataState;
  readonly state_label: string;
  readonly last_success_at: string | null;
  readonly last_attempt_at: string | null;
  readonly last_status: string | null;
  readonly last_message: string | null;
  readonly scopes: number;
  readonly scopes_succeeded: number;
}

const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const day = (seconds: number | null | undefined) => (seconds ? new Date((seconds + 9 * 3600) * 1000).toISOString().slice(0, 10) : null);

export function stateOf(statuses: readonly (string | null)[], anySuccess: boolean): DataState {
  if (statuses.some((status) => status === "RUNNING")) return anySuccess ? "COLLECTED" : "COLLECTING";
  if (anySuccess) return "COLLECTED";
  if (statuses.some((status) => status === "AUTH_MISSING" || status === "AUTH_FAILED")) return "AUTH_REQUIRED";
  if (statuses.some((status) => status && !["NOT_COLLECTED", "SUCCEEDED", "SUCCEEDED_EMPTY"].includes(status))) return "SOURCE_ERROR";
  return "NOT_COLLECTED";
}

export async function integrationStatus(db: SqlDatabase): Promise<DatasetStatus[]> {
  const datasets = await db.prepare("SELECT dataset_key, provider, dataset_name, official_url, access, terms, rate_limit, update_cycle FROM ext_dataset ORDER BY dataset_key").all<Omit<DatasetStatus, "state" | "state_label" | "last_success_at" | "last_attempt_at" | "last_status" | "last_message" | "scopes" | "scopes_succeeded">>();
  const scopes = await db.prepare("SELECT dataset_key, scope_key, last_status, last_message, last_attempt_at, last_success_at FROM ext_scope_state").all<{ dataset_key: string; scope_key: string; last_status: string; last_message: string | null; last_attempt_at: number | null; last_success_at: number | null }>();
  const running = await db.prepare("SELECT DISTINCT dataset_key FROM ext_run WHERE status = 'RUNNING'").all<{ dataset_key: string }>();
  const runningSet = new Set(running.results.map((row) => row.dataset_key));
  return datasets.results.map((dataset) => {
    const own = scopes.results.filter((scope) => scope.dataset_key === dataset.dataset_key);
    const success = own.filter((scope) => scope.last_success_at);
    const latest = [...own].sort((a, b) => (b.last_attempt_at ?? 0) - (a.last_attempt_at ?? 0))[0];
    const state = stateOf([...own.map((scope) => scope.last_status), ...(runningSet.has(dataset.dataset_key) ? ["RUNNING"] : [])], success.length > 0);
    return {
      ...dataset, state, state_label: STATE_LABELS[state],
      last_success_at: iso(Math.max(0, ...success.map((scope) => scope.last_success_at ?? 0)) || null),
      last_attempt_at: iso(latest?.last_attempt_at ?? null), last_status: latest?.last_status ?? null, last_message: latest?.last_message ?? null,
      scopes: own.length, scopes_succeeded: success.length,
    };
  });
}

// ---------- 지역 돌봄 수요·자원 ----------
export interface DemandStat {
  readonly org_id: string;
  readonly tbl_id: string;
  readonly tbl_name: string;
  readonly purpose: string;
  readonly table_status: string;
  readonly item_label: string | null;
  readonly unit: string | null;
  readonly population_basis: string | null;
  readonly source_url: string;
  readonly series: readonly SeriesPoint[];
  readonly state: DataState;
  readonly note: string | null;
}

export interface CareDemand {
  readonly region_id: string;
  readonly as_of: string;
  readonly legal_codes: number;
  readonly stats: readonly DemandStat[];
  readonly institutions: { readonly count: number | null; readonly basis_date: string | null; readonly by_group: readonly { readonly group: string; readonly label: string; readonly count: number }[]; readonly state: DataState };
  readonly indicators: readonly Indicator[];
  readonly sources: readonly DatasetStatus[];
}

export const SERVICE_GROUP_LABELS: Readonly<Record<string, string>> = {
  RESIDENTIAL: "입소시설", RESIDENTIAL_DEMENTIA_UNIT: "치매전담실(입소)", HOME_VISIT_CARE: "방문요양", HOME_VISIT_BATH: "방문목욕", HOME_VISIT_NURSING: "방문간호",
  DAY_NIGHT_CARE: "주야간보호", DAY_NIGHT_DEMENTIA_UNIT: "주야간보호 치매전담", SHORT_TERM_CARE: "단기보호", WELFARE_EQUIPMENT: "복지용구", OTHER: "기타",
};

/** 기관유형코드 → 서비스 묶음. 원천 코드표(EXACT)를 먼저, 치매전담실 범위(PREFIX)를 다음으로 본다. 코드표에 없으면 UNCLASSIFIED. */
export const SERVICE_GROUP_SQL = "COALESCE((SELECT t.service_group FROM ltc_service_type t WHERE t.code = s.admin_pttn_cd), (SELECT t.service_group FROM ltc_service_type t WHERE t.code_pattern = 'PREFIX:' || substr(s.admin_pttn_cd, 1, 1) AND CAST(substr(s.admin_pttn_cd, 2) AS INTEGER) BETWEEN 31 AND 99), 'UNCLASSIFIED')";

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export async function careDemand(db: SqlDatabase, regionId: string, asOf: string): Promise<CareDemand> {
  const sources = await integrationStatus(db);
  const ltcSource = sources.find((source) => source.dataset_key === "nhis.ltc_search");
  const kosisSource = sources.find((source) => source.dataset_key === "kosis.stats");
  const codes = await legalCodesForRegion(db, regionId, asOf);
  const codeList = codes.map((code) => code.code);
  let count: number | null = null;
  let basis: string | null = null;
  let byGroup: { group: string; label: string; count: number }[] = [];
  if (ltcSource?.state === "COLLECTED" && codeList.length) {
    const total = await db.prepare("SELECT COUNT(DISTINCT admin_sym) AS n, MAX(last_seen_at) AS seen FROM ltc_institution WHERE presence = 'PRESENT' AND sigungu_code IN (" + placeholders(codeList.length) + ")").bind(...codeList).first<{ n: number; seen: number | null }>();
    count = total?.n ?? 0;
    basis = day(total?.seen ?? null) ?? ltcSource.last_success_at?.slice(0, 10) ?? null;
    const groups = await db.prepare("SELECT " + SERVICE_GROUP_SQL + " AS grp, COUNT(DISTINCT s.admin_sym) AS n FROM ltc_institution_service s JOIN ltc_institution i ON i.admin_sym = s.admin_sym WHERE s.presence = 'PRESENT' AND i.presence = 'PRESENT' AND i.sigungu_code IN (" + placeholders(codeList.length) + ") GROUP BY grp ORDER BY n DESC")
      .bind(...codeList).all<{ grp: string; n: number }>();
    byGroup = groups.results.map((row) => ({ group: row.grp, label: SERVICE_GROUP_LABELS[row.grp] ?? "분류 미확인 코드", count: row.n }));
  }
  const tables = await db.prepare("SELECT org_id, tbl_id, tbl_name, purpose, status, item_label, unit, population_basis, source_url, query_json, note FROM kosis_table ORDER BY purpose").all<{ org_id: string; tbl_id: string; tbl_name: string; purpose: string; status: string; item_label: string | null; unit: string | null; population_basis: string | null; source_url: string; query_json: string | null; note: string | null }>();
  const stats: DemandStat[] = [];
  let elderly: SeriesPoint | null = null;
  let elderlySource = "KOSIS 통계표 확인 전";
  const limitations: string[] = [];
  for (const table of tables.results) {
    if (table.status !== "VERIFIED") {
      stats.push({ org_id: table.org_id, tbl_id: table.tbl_id, tbl_name: table.tbl_name, purpose: table.purpose, table_status: table.status, item_label: table.item_label, unit: table.unit, population_basis: table.population_basis, source_url: table.source_url, series: [], state: kosisSource?.state === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "NOT_COLLECTED", note: "통계표 항목·분류·단위 확인 전이라 수집하지 않았습니다." });
      continue;
    }
    let aggregate: KosisAggregate | null = null;
    try {
      aggregate = (JSON.parse(table.query_json ?? "{}") as { aggregate?: KosisAggregate }).aggregate ?? null;
    } catch {
      aggregate = null;
    }
    const observations = codeList.length ? await db.prepare("SELECT o.org_id, o.tbl_id, o.itm_id, o.region_code, o.region_name, o.class2, o.class2_name, o.period, o.value, o.value_status, o.unit, lc.relation AS relation FROM kosis_observation o JOIN region_code_map km ON km.from_type = 'KOSIS_REGION' AND km.from_code = o.region_code AND km.to_type = 'LEGAL_DONG' AND km.status = 'VERIFIED' AND km.map_id LIKE 'kosis:' || o.org_id || ':' || o.tbl_id || ':%' JOIN region_code_map lc ON lc.from_type = 'LEGAL_DONG' AND lc.from_code = km.to_code AND lc.to_type = 'CONTENT_REGION' AND lc.status = 'VERIFIED' AND (lc.to_code = ? OR lc.to_code LIKE ?) WHERE o.org_id = ? AND o.tbl_id = ?")
      .bind(regionId, regionId.includes("|") ? regionId : regionId + "|%", table.org_id, table.tbl_id).all<Observation>() : { results: [] as Observation[] };
    const series = regionSeries(observations.results, aggregate);
    stats.push({ org_id: table.org_id, tbl_id: table.tbl_id, tbl_name: table.tbl_name, purpose: table.purpose, table_status: table.status, item_label: aggregate?.label ?? table.item_label, unit: table.unit, population_basis: table.population_basis, source_url: table.source_url, series, state: series.length ? "COLLECTED" : observations.results.length ? "LINK_UNVERIFIED" : kosisSource?.state ?? "NOT_COLLECTED", note: table.note });
    if (table.purpose === "ELDERLY_POPULATION") {
      elderly = [...series].reverse().find((point) => point.value !== null) ?? series.at(-1) ?? null;
      elderlySource = "KOSIS " + table.org_id + "/" + table.tbl_id + " " + table.tbl_name;
      if (series.some((point) => point.basis.includes("합산"))) limitations.push("65세 이상 인구는 구 단위 값을 더한 값입니다.");
    }
  }
  const indicator = institutionsPerThousandElderly(count, basis, elderly, elderlySource, limitations);
  return {
    region_id: regionId, as_of: asOf, legal_codes: codeList.length, stats,
    institutions: { count, basis_date: basis, by_group: byGroup, state: !codeList.length ? "LINK_UNVERIFIED" : ltcSource?.state ?? "NOT_COLLECTED" },
    indicators: [indicator], sources: sources.filter((source) => ["nhis.ltc_search", "nhis.ltc_detail", "kosis.stats", "mois.legal_dong"].includes(source.dataset_key)),
  };
}

export interface InstitutionCard {
  readonly institution_id: string;
  readonly admin_sym: string;
  readonly name: string;
  readonly service_types: readonly { readonly code: string; readonly name: string; readonly group: string }[];
  readonly designated_on: string | null;
  readonly sigungu_code: string | null;
  readonly region_name: string | null;
  readonly presence: string;
  readonly last_seen_on: string | null;
  readonly detail_status: string;
}

/** 기관 목록. 기관을 수집하기 전이거나 지역 연결이 없으면 total은 0이 아니라 null이고 state가 실제 사유다. */
export async function careInstitutions(db: SqlDatabase, regionId: string, asOf: string, options: { readonly group?: string; readonly query?: string; readonly offset: number; readonly limit: number }): Promise<{ readonly total: number | null; readonly items: readonly InstitutionCard[]; readonly state: DataState }> {
  const source = (await integrationStatus(db)).find((row) => row.dataset_key === "nhis.ltc_search");
  if (source?.state !== "COLLECTED") return { total: null, items: [], state: source?.state ?? "NOT_COLLECTED" };
  const codes = (await legalCodesForRegion(db, regionId, asOf)).map((code) => code.code);
  if (!codes.length) return { total: null, items: [], state: "LINK_UNVERIFIED" };
  const where = ["i.presence = 'PRESENT'", "i.sigungu_code IN (" + placeholders(codes.length) + ")"];
  const binds: unknown[] = [...codes];
  if (options.group) {
    where.push("EXISTS (SELECT 1 FROM ltc_institution_service s WHERE s.admin_sym = i.admin_sym AND s.presence = 'PRESENT' AND " + SERVICE_GROUP_SQL + " = ?)");
    binds.push(options.group);
  }
  for (const token of (options.query ?? "").trim().split(/\s+/).filter(Boolean)) {
    // D1 limits LIKE pattern bytes; literal INSTR also keeps % and _ literal.
    where.push("INSTR(" + compactSearchSql("i.admin_nm") + ", ?) > 0");
    binds.push(compactSearchText(token));
  }
  const total = await db.prepare("SELECT COUNT(*) AS n FROM ltc_institution i WHERE " + where.join(" AND ")).bind(...binds).first<{ n: number }>();
  const rows = await db.prepare("SELECT i.admin_sym, i.admin_nm, i.designated_on, i.sigungu_code, i.presence, i.last_seen_at, i.detail_status, (SELECT name FROM region_code r WHERE r.code_type = 'LEGAL_DONG' AND r.code = i.sigungu_code ORDER BY r.valid_from DESC LIMIT 1) AS region_name FROM ltc_institution i WHERE " + where.join(" AND ") + " ORDER BY i.admin_nm, i.admin_sym LIMIT ? OFFSET ?")
    .bind(...binds, options.limit, options.offset).all<{ admin_sym: string; admin_nm: string; designated_on: string | null; sigungu_code: string | null; presence: string; last_seen_at: number; detail_status: string; region_name: string | null }>();
  const syms = rows.results.map((row) => row.admin_sym);
  const services = syms.length ? await db.prepare("SELECT s.admin_sym, s.admin_pttn_cd AS code, COALESCE((SELECT name FROM ltc_service_type t WHERE t.code = s.admin_pttn_cd), (SELECT t.name FROM ltc_service_type t WHERE t.code_pattern = 'PREFIX:' || substr(s.admin_pttn_cd, 1, 1)), '코드표에 없는 유형(' || s.admin_pttn_cd || ')') AS name, " + SERVICE_GROUP_SQL + " AS grp FROM ltc_institution_service s WHERE s.presence = 'PRESENT' AND s.admin_sym IN (" + placeholders(syms.length) + ") ORDER BY s.admin_pttn_cd")
    .bind(...syms).all<{ admin_sym: string; code: string; name: string; grp: string }>() : { results: [] };
  return {
    total: total?.n ?? 0,
    state: "COLLECTED",
    items: rows.results.map((row) => ({
      institution_id: "ltc:" + row.admin_sym, admin_sym: row.admin_sym, name: row.admin_nm,
      service_types: services.results.filter((service) => service.admin_sym === row.admin_sym).map((service) => ({ code: service.code, name: service.name, group: service.grp })),
      designated_on: row.designated_on, sigungu_code: row.sigungu_code, region_name: row.region_name, presence: row.presence, last_seen_on: day(row.last_seen_at), detail_status: row.detail_status,
    })),
  };
}

export async function careInstitution(db: SqlDatabase, institutionId: string, today: string) {
  const sym = institutionId.replace(/^ltc:/, "");
  if (!/^\d{11}$/.test(sym)) return null;
  const row = await db.prepare("SELECT * FROM ltc_institution WHERE admin_sym = ?").bind(sym).first<Record<string, string | number | null>>();
  if (!row) return null;
  const [services, partners, region, contentRegion] = await Promise.all([
    db.prepare("SELECT s.admin_pttn_cd AS code, s.presence, COALESCE((SELECT name FROM ltc_service_type t WHERE t.code = s.admin_pttn_cd), (SELECT t.name FROM ltc_service_type t WHERE t.code_pattern = 'PREFIX:' || substr(s.admin_pttn_cd, 1, 1)), '코드표에 없는 유형') AS name, " + SERVICE_GROUP_SQL + " AS grp FROM ltc_institution_service s WHERE s.admin_sym = ? ORDER BY s.admin_pttn_cd").bind(sym).all<{ code: string; presence: string; name: string; grp: string }>(),
    db.prepare("SELECT partner_name, agreement_from, agreement_to, presence, last_seen_at FROM ltc_partner WHERE admin_sym = ? ORDER BY agreement_from DESC").bind(sym).all<{ partner_name: string; agreement_from: string; agreement_to: string | null; presence: string; last_seen_at: number }>(),
    db.prepare("SELECT name FROM region_code WHERE code_type = 'LEGAL_DONG' AND code IN (?, ?) ORDER BY CASE code WHEN ? THEN 0 ELSE 1 END, valid_from DESC LIMIT 1").bind(row.legal_dong_code ?? "", row.sigungu_code ?? "", row.legal_dong_code ?? "").first<{ name: string }>(),
    db.prepare("SELECT to_code, relation, status FROM region_code_map WHERE from_type = 'LEGAL_DONG' AND from_code = ? AND to_type = 'CONTENT_REGION' ORDER BY status = 'VERIFIED' DESC LIMIT 1").bind(row.sigungu_code ?? "").first<{ to_code: string; relation: string; status: string }>(),
  ]);
  const partnerState = (partner: { agreement_to: string | null; presence: string }) => partner.presence !== "PRESENT" ? "NOT_SEEN" : partner.agreement_to && partner.agreement_to !== "9999-12-31" && partner.agreement_to < today ? "EXPIRED" : "CURRENT";
  return {
    institution_id: "ltc:" + sym,
    admin_sym: sym,
    id_system: "국민건강보험공단 장기요양기관기호(11자리). 다른 기관 DB의 ID와 같다고 보지 않습니다.",
    name: row.admin_nm,
    address: { legal_dong: region?.name ?? null, detail: row.detail_addr ?? null, post_no: row.post_no ?? null },
    tel: row.tel ?? null,
    designated_on: row.designated_on, registered_on: row.registered_on,
    region: contentRegion ? { region_id: contentRegion.to_code, relation: contentRegion.relation, status: contentRegion.status } : null,
    services: services.results.map((service) => ({ code: service.code, name: service.name, group: service.grp, group_label: SERVICE_GROUP_LABELS[service.grp] ?? "분류 미확인", presence: service.presence })),
    partners: partners.results.map((partner) => ({ name: partner.partner_name, from: partner.agreement_from, to: partner.agreement_to === "9999-12-31" ? null : partner.agreement_to, state: partnerState(partner), last_seen_on: day(partner.last_seen_at) })),
    presence: row.presence,
    detail_status: row.detail_status,
    sources: {
      search: { title: "국민건강보험공단 장기요양기관 검색 서비스", url: "https://www.data.go.kr/data/15059029/openapi.do", last_seen_on: day(Number(row.last_seen_at)) },
      detail: { title: "국민건강보험공단 장기요양기관 시설별 상세조회 서비스", url: "https://www.data.go.kr/data/15058856/openapi.do", fetched_on: day(row.detail_fetched_at === null ? null : Number(row.detail_fetched_at)) },
    },
    notes: ["PRESENT는 마지막 수집일의 검색 목록에 등록되어 있었다는 뜻입니다. 현재 운영 중이라는 검증값이 아니며 detail_status=NOT_COLLECTED이면 운영 상태·주소·연락처 등 상세는 미확인입니다.", "원천의 '실시간' 표기는 정보 갱신 방식을 뜻하며 빈자리·즉시 이용 가능·통합돌봄 참여 확정을 뜻하지 않습니다.", "협약기간이 지난 관계는 '협약기간 종료'로 따로 표시합니다."],
  };
}

// ---------- 사업 상세: 공식 혜택정보(정부24)·법적 근거 ----------
function keyParts(targetId: string): string[] {
  return targetId.replace(/^service:/, "").split("|");
}

/** 위키 키와 같은 사업(서비스ID·시도·시군구·사업명이 같음) 연결을 찾는다. 분류 보정으로 키 중간이 달라도 같은 사업으로 본다. */
async function linksFor(db: SqlDatabase, kind: "GOV24" | "LAW", targetId: string) {
  const parts = keyParts(targetId);
  const prefix = "service:" + parts.slice(0, 3).join("|") + "|";
  // 앞부분 비교는 LIKE 대신 substr로 한다. 한글이 든 긴 사업 ID를 LIKE 패턴으로 넣으면 D1이 「LIKE or GLOB pattern too complex」로 거절해
  // 사업 상세의 공식 혜택정보가 「불러오지 못했습니다」로 나왔다(2026-10-06 전수점검).
  const rows = await db.prepare("SELECT link_id, source_id, target_id, status, score, evidence_json, conflict_json, reviewed_at, updated_at FROM program_ext_link WHERE source_kind = ? AND target_kind = 'service' AND (target_id = ? OR substr(target_id, 1, ?) = ?)")
    .bind(kind, targetId, [...prefix].length, prefix).all<{ link_id: string; source_id: string; target_id: string; status: string; score: number | null; evidence_json: string; conflict_json: string | null; reviewed_at: number | null; updated_at: number }>();
  return rows.results.filter((row) => row.target_id === targetId || keyParts(row.target_id).at(-1) === parts.at(-1));
}

export async function programPublicInfo(db: SqlDatabase, targetId: string, options: { readonly includeLaw?: boolean } = {}) {
  const sources = await integrationStatus(db);
  const govSource = sources.find((source) => source.dataset_key === "mois.gov24_list");
  const lawSource = sources.find((source) => source.dataset_key === "moleg.law");
  const [govLinks, lawLinks] = await Promise.all([linksFor(db, "GOV24", targetId), options.includeLaw === false ? Promise.resolve([]) : linksFor(db, "LAW", targetId)]);
  const verifiedGov = govLinks.filter((link) => link.status === "VERIFIED");
  const services = verifiedGov.length ? await db.prepare("SELECT * FROM gov24_service WHERE presence = 'PRESENT' AND service_id IN (" + placeholders(verifiedGov.length) + ")").bind(...verifiedGov.map((link) => link.source_id)).all<Gov24Row>() : { results: [] };
  const hydratedServices = await hydrateGov24Details(db, services.results);
  const verifiedLaw = lawLinks.filter((link) => link.status === "VERIFIED");
  const laws = verifiedLaw.length ? await db.prepare("SELECT * FROM law_reference WHERE ref_id IN (" + placeholders(verifiedLaw.length) + ")").bind(...verifiedLaw.map((link) => link.source_id)).all<Record<string, string | null>>() : { results: [] };
  const govState: DataState = services.results.length ? "COLLECTED" : verifiedGov.length ? "NOT_COLLECTED" : govLinks.length ? "LINK_UNVERIFIED" : govSource?.state === "COLLECTED" ? "LINK_UNVERIFIED" : govSource?.state ?? "NOT_COLLECTED";
  const lawState: DataState = verifiedLaw.length ? "COLLECTED" : lawLinks.length ? "LINK_UNVERIFIED" : lawSource?.state ?? "NOT_COLLECTED";
  return {
    target_id: targetId,
    gov24: {
      state: govState, state_label: STATE_LABELS[govState],
      pending_candidates: govLinks.filter((link) => link.status === "CANDIDATE" || link.status === "REVIEW_REQUIRED").length,
      verified_links_without_present_source: verifiedGov.filter((link) => !services.results.some((row) => row.service_id === link.source_id)).length,
      last_collected_at: govSource?.last_success_at ?? null,
      services: hydratedServices.map((row) => {
        const link = verifiedGov.find((entry) => entry.source_id === row.service_id);
        return {
          ...gov24Dto(row), id_system: "정부24 공공서비스 서비스ID",
          modified_at: row.modified_at, collected_on: day(Number(row.last_seen_at)),
          conflicts: link?.conflict_json ? JSON.parse(link.conflict_json) as unknown : null, reviewed_on: day(link?.reviewed_at ?? null),
          verified_link_id: link?.link_id ?? null,
        };
      }),
    },
    legal_basis: {
      state: options.includeLaw === false ? "DISABLED" : lawState, state_label: options.includeLaw === false ? "MCP 제공 중지" : STATE_LABELS[lawState],
      pending_candidates: lawLinks.filter((link) => link.status === "CANDIDATE" || link.status === "REVIEW_REQUIRED").length,
      references: laws.results.map((row) => ({
        law_name: row.law_name, law_kind: row.law_kind, law_id: row.law_id, version_id: row.law_mst, article: row.article, promulgated_on: row.promulgated_on, effective_on: row.effective_on,
        query_date: row.query_date, version_status: row.version_status, article_status: row.article_status, official_url: row.official_url, upcoming_note: row.upcoming_note, retrieved_via: row.retrieved_via,
      })),
      note: options.includeLaw === false ? "법령 데이터는 보존되어 있으며 MCP에서 조회할 수 없습니다." : "관리자가 근거로 확인한 연결만 보입니다. 조문 인용 확인은 법률 해석의 정확성을 보장하지 않습니다.",
    },
  };
}
