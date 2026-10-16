// 정부24 원천 서비스는 시행사업과의 연결 승인 여부와 별개인 독립 엔터티다.
// 조회는 저장된 공개 레코드만 사용하고, 목록/상세·수정일/적용연도·기관관할/개인자격을 구분한다.
import { databaseIdentity, type SqlDatabase } from "../sql-database.ts";
import { REGION_DEFINITIONS } from "../region-statistics.ts";
import { fingerprint, McpToolError } from "./contract.ts";
import { positiveQueryTerms, type RefinedWelfareQuery } from "./query-refiner.ts";
import { ftsPhrase, searchFtsReady } from "./search-fts.ts";
import { compactSearchSql, compactSearchText } from "./search-text.ts";
import { GOV24_DETAIL_HYDRATION_VERSION, hydrateGov24Details } from "../integrations/gov24-detail-hydration.ts";

export const GOV24_PREFIX = "gov24_service:";
export const GOV24_SOURCE = { title: "행정안전부 대한민국 공공서비스(혜택) 정보", url: "https://www.data.go.kr/data/15113968/openapi.do" };
export type Gov24Row = Record<string, string | number | null>;
const str = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
export const compactWelfareText = compactSearchText;
const sqlCompact = compactSearchSql;
const FIELDS = ["purpose", "target", "criteria", "benefit", "apply_method", "apply_deadline", "required_documents", "reception", "contact"] as const;

export function gov24PublisherScope(row: Gov24Row) {
  const name = str(row.org_name) ?? "";
  if (row.org_type === "중앙행정기관") return { level: "national", region_id: "region:전국", sido: "", sigungu: "", basis: "publisher_jurisdiction_not_personal_eligibility" };
  const province = REGION_DEFINITIONS.find((region) => region.aliases.some((alias) => name === alias || name.startsWith(alias + " ")));
  if (!province) return { level: "unknown", region_id: null, sido: "", sigungu: "", basis: "publisher_scope_unconfirmed" };
  const sourceProvince = province.aliases.find((alias) => name === alias || name.startsWith(alias + " "))!;
  const remainder = name.slice(sourceProvince.length).trim();
  const municipality = /^([^\s]+[시군구])(?:\s|$)/.exec(remainder)?.[1] ?? "";
  const legacyTerritory = province.fullName === "전남광주통합특별시" && sourceProvince !== province.fullName;
  return { level: municipality ? "municipality" : legacyTerritory ? "legacy_province" : "province", region_id: "region:" + province.fullName + (municipality ? "|" + municipality : ""), sido: province.fullName, sigungu: municipality, source_sido: sourceProvince, basis: "publisher_jurisdiction_not_personal_eligibility", ...(legacyTerritory ? { territory_note: "통합 이전 원천 관할입니다. 옛 광역사업을 통합지역 전체로 확대 적용하지 않습니다." } : {}) };
}

export function gov24RegionMatches(row: Gov24Row, regionId: string | null, includeAncestorScope = true): boolean {
  if (!regionId || regionId === "region:전국") return true;
  const scope = gov24PublisherScope(row);
  if (scope.level === "national") return includeAncestorScope;
  const [sido, sigungu = ""] = regionId.replace(/^region:/, "").split("|");
  if (sigungu && scope.level === "legacy_province") return false;
  return scope.sido === sido && (!sigungu || includeAncestorScope && !scope.sigungu || scope.sigungu === sigungu);
}

/** 한 필드 안에서만 연도를 판독한다. 다른 필드의 신청연도나 수정일은 전파하지 않는다. */
export function gov24FieldYearEvidence(text: string, requestedYear: number | null, modifiedAt: string | null = null) {
  const explicit = new Set<number>();
  for (const line of text.split(/\n/)) {
    for (const match of line.matchAll(/(?<!\d)((?:19|20)\d{2})\s*(?:년|(?=[./-]\s*\d{1,2}))/g)) {
      const before = line.slice(Math.max(0, match.index! - 25), match.index);
      const after = line.slice(match.index! + match[0].length, match.index! + match[0].length + 40);
      if (/출생|생년|태어난/.test(before) || /^생|^\s+생(?:$|[\s,.)]|(?:인|으로|에게|에|만|이|은|을|의|과|부터))|출생|부터\s*(?:시행|도입|운영)|시행\s*(?:개시|시작)/.test(after)) continue;
      explicit.add(Number(match[1]));
    }
  }
  const years = [...explicit].sort();
  return { requested_year: requestedYear, explicit_reference_years: years, status: years.length > 1 ? "MULTIPLE_YEARS_REVIEW_REQUIRED" : requestedYear === null ? "NOT_REQUESTED" : years.length === 0 ? "YEAR_UNCONFIRMED" : years.includes(requestedYear) ? "MATCHED" : "YEAR_MISMATCH", source_modified_at: modifiedAt, modified_at_is_effective_year: false };
}

/** 서비스 전체의 요약 표시. 실제 선택과 금액표는 field_year_evidence를 사용한다. */
export function gov24YearEvidence(row: Gov24Row, requestedYear: number | null) {
  return gov24FieldYearEvidence([row.name, row.criteria, row.benefit, row.apply_deadline].filter(Boolean).join("\n"), requestedYear, str(row.modified_at));
}

/** 원문이 가구원수·원 단위를 명시한 행만 표로 투영한다. 사용자 질문/골든 정답은 입력받지 않는다. */
export function gov24HouseholdTable(row: Gov24Row, yearInfo = gov24FieldYearEvidence(String(row.benefit ?? ""), null, str(row.modified_at))) {
  const text = str(row.benefit) ?? "";
  const cells: { household_size: number; household_size_operator: "eq" | "gte"; amount_krw: string; payment_period: string; source_quote: string; source_locator: string }[] = [];
  const pattern = /(?:^|[,;○ㆍ·\s])([1-9]\d?)\s*인\s*(?:가구|세대)?\s*(이상)?\s*(?:가구|세대)?\s*[:：\-]?\s*(월)?\s*([\d,]+)\s*원/g;
  for (const [lineIndex, line] of text.split(/\n/).entries()) {
    const matches = [...line.matchAll(pattern)];
    for (const [index, match] of matches.entries()) {
      const amount = match[4].replace(/,/g, "");
      const cellText = line.slice(match.index, matches[index + 1]?.index ?? line.length);
      const monthly = Boolean(match[3]) || /원\s*\/\s*월|월별|매월/.test(cellText);
      const annual = /연\s*1회|연간|년간/.test(cellText);
      const period = monthly && annual ? "MIXED_PERIODS_REVIEW_REQUIRED" : monthly ? "monthly" : annual ? "annual" : "UNCONFIRMED";
      if (/^[1-9]\d{2,9}$/.test(amount)) cells.push({ household_size: Number(match[1]), household_size_operator: match[2] ? "gte" : "eq", amount_krw: amount, payment_period: period, source_quote: cellText.trim(), source_locator: "benefit.line:" + (lineIndex + 1) + ";characters:" + match.index + "-" + (matches[index + 1]?.index ?? line.length) });
    }
  }
  if (!cells.length) return [];
  const duplicate = cells.some((cell, index) => cells.findIndex((other) => other.household_size === cell.household_size) !== index);
  const periods = [...new Set(cells.map((cell) => cell.payment_period))];
  return [{ table_id: GOV24_PREFIX + row.service_id + ":benefit:household", title: String(row.name) + " 가구원수별 지원내용(원문 명시 행)", unit: "KRW", payment_period: periods.length === 1 ? periods[0] : "MIXED_PERIODS_REVIEW_REQUIRED", year: yearInfo.explicit_reference_years.length === 1 ? yearInfo.explicit_reference_years[0] : null, year_evidence: yearInfo, headers: ["가구원수", "금액(원)"], rows: cells, footnotes: text.split(/\n/).filter((line) => /^\s*[※*]/.test(line)).map((line) => line.trim()), footnote_scope: "WHOLE_FIELD_UNMAPPED", source_document: str(row.detail_url), source_locator: "정부24 지원내용(benefit)", source_text: text, verification_status: duplicate ? "AMBIGUOUS_ROWS_REVIEW_REQUIRED" : yearInfo.explicit_reference_years.length > 1 ? "YEAR_SCOPE_REVIEW_REQUIRED" : "SOURCE_EXTRACTED", personal_determination: false }];
}

export function gov24Dto(row: Gov24Row, requestedYear: number | null = null) {
  const fresh = row.detail_status === "COLLECTED" && String(row.detail_modified_at ?? "") === String(row.modified_at ?? "");
  const year = gov24YearEvidence(row, requestedYear);
  const fieldYears = Object.fromEntries(FIELDS.map((field) => [field, gov24FieldYearEvidence(String(row[field] ?? ""), requestedYear, str(row.modified_at))])) as Record<(typeof FIELDS)[number], ReturnType<typeof gov24FieldYearEvidence>>;
  const id = GOV24_PREFIX + row.service_id;
  const source = { ...GOV24_SOURCE, evidence_id: id, kind: fresh ? "GOV24_SERVICE_DETAIL" : "GOV24_SERVICE_LIST", service_id: String(row.service_id), service_name: String(row.name), publisher: str(row.org_name), url: str(row.detail_url) ?? GOV24_SOURCE.url, source_modified_at: str(row.modified_at), collected_at: row.last_seen_at ? new Date(Number(row.last_seen_at) * 1000).toISOString() : null, detail_collected_at: row.detail_fetched_at ? new Date(Number(row.detail_fetched_at) * 1000).toISOString() : null, verification_status: "OFFICIAL_API_COLLECTED", effective_year: null, effective_year_basis: "FIELD_SPECIFIC_ONLY" };
  return { id, entity_type: "gov24_service", service_id: String(row.service_id), name: String(row.name), org_name: str(row.org_name), org_type: str(row.org_type), field: str(row.field), support_type: str(row.support_type),
    purpose: str(row.purpose), target: str(row.target), criteria: str(row.criteria), benefit: str(row.benefit), apply_method: str(row.apply_method), apply_deadline: str(row.apply_deadline), required_documents: fresh ? str(row.required_documents) : null, reception: str(row.reception), contact: str(row.contact),
    online_url: fresh ? str(row.online_url) : null, detail_url: source.url, detail_status: fresh ? "COLLECTED" : row.detail_status === "COLLECTED" ? "STALE" : String(row.detail_status ?? "NOT_COLLECTED"), content_scope: fresh ? "official_service_detail" : "official_service_list", presence: String(row.presence), publisher_scope: gov24PublisherScope(row), year_evidence: year, field_year_evidence: fieldYears, structured_tables: gov24HouseholdTable(row, fieldYears.benefit), source,
    detail_hydration: { status: str(row.detail_hydration_status) ?? "NOT_CHECKED", reason: str(row.detail_hydration_reason), record_id: str(row.detail_hydration_record_id), record_hash: str(row.detail_hydration_record_hash), run_id: str(row.detail_hydration_run_id), version: str(row.detail_hydration_version) },
    personal_determination: false, warnings: [...(!fresh ? ["정부24 목록 정보입니다. 최신 상세정보·구비서류가 모두 확보되었다는 뜻이 아닙니다."] : []), ...(year.status === "YEAR_MISMATCH" ? ["본문 적용연도가 요청 연도와 다릅니다. 요청 연도의 수치·자격 근거로 사용하지 마세요."] : year.status === "YEAR_UNCONFIRMED" ? ["본문에서 요청 연도의 적용 여부가 확인되지 않습니다. 수정일을 적용연도로 해석하지 마세요."] : year.status === "MULTIPLE_YEARS_REVIEW_REQUIRED" ? ["여러 연도 기준이 함께 있습니다. 원문에서 요청 연도에 해당하는 항목을 확인하세요."] : []), "발행기관 관할은 개인별 신청자격이나 전국 공통 적용의 확정 근거가 아닙니다."] };
}
export type Gov24Service = ReturnType<typeof gov24Dto>;

export async function getGov24Service(db: SqlDatabase, id: string, requestedYear: number | null = null): Promise<Gov24Service> {
  if (!/^gov24_service:[A-Za-z0-9_-]{1,80}$/.test(id)) throw new McpToolError("GOV24_ID_INVALID", "정부24 ID는 search가 반환한 gov24_service:<서비스ID>를 사용하세요.");
  const row = await db.prepare("SELECT * FROM gov24_service WHERE service_id = ? AND presence = 'PRESENT'").bind(id.slice(GOV24_PREFIX.length)).first<Gov24Row>();
  if (!row) throw new McpToolError("NOT_FOUND", "현재 수집된 정부24 목록에 이 서비스가 없습니다. 사업 폐지나 지원 불가를 의미하지 않습니다.");
  return gov24Dto((await hydrateGov24Details(db, [row]))[0], requestedYear);
}

// 정부24 상태 집계(전체 COUNT·변경 이력)는 검색마다 필요하지만 자주 바뀌지 않는다. 실행 환경 안에서 60초 재사용한다.
const gov24StateCache = new WeakMap<object, { at: number; value: Awaited<ReturnType<typeof readGov24DatasetState>> }>();
const GOV24_STATE_TTL_MS = 60_000;

export async function gov24DatasetState(db: SqlDatabase) {
  const cached = gov24StateCache.get(databaseIdentity(db));
  if (cached && Date.now() - cached.at < GOV24_STATE_TTL_MS) return cached.value;
  const value = await readGov24DatasetState(db);
  gov24StateCache.set(databaseIdentity(db), { at: Date.now(), value });
  return value;
}

async function readGov24DatasetState(db: SqlDatabase) {
  const row = await db.prepare("SELECT COUNT(*) AS services, SUM(CASE WHEN detail_status = 'COLLECTED' AND COALESCE(detail_modified_at, '') = COALESCE(modified_at, '') THEN 1 ELSE 0 END) AS current_details, MAX(last_seen_at) AS last_collected, MAX(detail_fetched_at) AS last_detail, MAX(modified_at) AS last_modified, MAX(list_run_id) AS list_run FROM gov24_service WHERE presence = 'PRESENT'").first<Record<string, string | number | null>>();
  const change = await db.prepare("SELECT COUNT(*) AS changes, MAX(changed_at) AS watermark FROM ext_record_change WHERE dataset_key IN ('mois.gov24_list','mois.gov24_detail')").first<Record<string, number | null>>();
  return { revision: "gov24:" + fingerprint([row, change, GOV24_DETAIL_HYDRATION_VERSION]), status: row?.services ? "AVAILABLE" : "NOT_COLLECTED", services: Number(row?.services ?? 0), current_details: Number(row?.current_details ?? 0), latest_collection_at: row?.last_collected ? new Date(Number(row.last_collected) * 1000).toISOString() : null, snapshot_policy: "CURRENT_STORED_DATA_NOT_RELEASE_PINNED", note: "정부24는 독립 갱신 자료입니다. 회귀시험은 공개본 ID와 이 revision이 모두 같은지 확인해야 합니다. 상세 건수는 목록 건수와 다릅니다." };
}

type SearchPlan = Pick<RefinedWelfareQuery, "search_queries" | "programs" | "excluded_programs"> & Partial<Pick<RefinedWelfareQuery, "raw_query" | "region_id" | "detail_terms">>;
const CERTIFICATE_TERMS = ["증명서", "확인서", "증명발급", "증빙발급"];

// These spelling forms affect retrieval only; they never establish a verified
// relationship or let a child benefit replace its parent policy's evidence.
function policyNameKey(name: string): string {
  const repeated = /^([^()]+)\(([^()]*)\)\s*$/.exec(name.normalize("NFKC"));
  const plain = repeated && compactWelfareText(repeated[1]) === compactWelfareText(repeated[2]) ? repeated[1] : name;
  const key = compactWelfareText(plain).replace(/(?:지원사업|지원서비스|서비스|사업|지원)$/, "");
  // Government24's official parent-policy label, not a narrower benefit item.
  return key === "주거급여맞춤형급여" ? "주거급여" : key;
}

function explicitTitleDetail(name: string, plan: SearchPlan): boolean {
  const title = compactWelfareText(name);
  const queries = [...plan.programs, ...plan.search_queries].map(compactWelfareText).filter(Boolean);
  return queries.some((query) => title.includes(query)) && (plan.detail_terms ?? []).some((term) => title.includes(compactWelfareText(term)));
}

export function welfareCandidateNotes(name: string, plan: SearchPlan): string[] {
  const title = compactWelfareText(name), question = plan.raw_query ?? "";
  const notes: string[] = [];
  if (/(?:증명서|확인서)/.test(title) && !positiveQueryTerms(question, CERTIFICATE_TERMS).length) notes.push("CERTIFICATE_NOT_REQUESTED");
  const operationTerms = ["냉난방비", "인건비", "운영비", "설치비", "기능보강"];
  if (/(?:센터|시설)/.test(title) && operationTerms.some((term) => title.includes(term)) && !positiveQueryTerms(question, operationTerms).length) notes.push("FACILITY_OPERATION_NOT_REQUESTED");
  if (plan.programs.some((program) => program === "행복이음" || program === "통합돌봄지원정보시스템") && /장학금/.test(title) && !positiveQueryTerms(question, ["장학금", "장학"]).length) notes.push("SYSTEM_NAME_OVERLAP_REVIEW_REQUIRED");
  return notes;
}

export function welfareRelevance(name: string, plan: SearchPlan): number {
  const title = compactWelfareText(name);
  const queries = [...new Set([...plan.programs, ...plan.search_queries].map(compactWelfareText).filter(Boolean))];
  if (plan.excluded_programs.some((program) => policyNameKey(name) === policyNameKey(program))) return -100;
  const policyKey = policyNameKey(name);
  const exact = queries.some((query) => title === query || policyKey && policyKey === policyNameKey(query));
  let score = exact ? 120 : queries.some((query) => title.startsWith(query)) ? 105 : queries.some((query) => title.includes(query)) ? 90 : 20;
  const notes = welfareCandidateNotes(name, plan);
  if (notes.length) score -= notes.includes("SYSTEM_NAME_OVERLAP_REVIEW_REQUIRED") ? 60 : 40;
  if (!notes.length && explicitTitleDetail(name, plan)) score += 48;
  if (/(?:증명서|확인서)/.test(title) && positiveQueryTerms(plan.raw_query ?? "", CERTIFICATE_TERMS).length) score += 40;
  return score;
}

export function gov24SearchRelevance(service: Pick<Gov24Service, "name" | "org_type" | "detail_status" | "publisher_scope">, plan: SearchPlan): number {
  const sourceBonus = service.detail_status === "COLLECTED" ? 2 : 0;
  const centralBonus = service.org_type === "중앙행정기관" ? 4 : 0;
  const regionBonus = plan.region_id && plan.region_id !== "region:전국" && service.publisher_scope.region_id === plan.region_id ? 12 : 0;
  return welfareRelevance(service.name, plan) + sourceBonus + centralBonus + regionBonus;
}

export async function searchGov24Services(db: SqlDatabase, plan: RefinedWelfareQuery, limit = 8): Promise<Gov24Service[]> {
  const variants = [...new Set(plan.search_queries.map(compactWelfareText).filter(Boolean))].slice(0, 6);
  if (!variants.length) return [];
  // 정규화 검색어는 gov24_search(0113 마이그레이션 트리거)에 미리 저장한다. 없는 행만 원래 식으로 계산한다.
  const name = "COALESCE(c.name_c, " + sqlCompact("g.name") + ")";
  const content = "COALESCE(c.content_c, " + sqlCompact("g.name || ' ' || COALESCE(g.purpose,'') || ' ' || COALESCE(g.target,'') || ' ' || COALESCE(g.criteria,'') || ' ' || COALESCE(g.benefit,'')") + ")";
  const clauses = variants.map(() => `instr(${content}, ?) > 0`);
  const nameClauses = variants.map(() => `instr(${name}, ?) > 0`);
  // Match the JS spelling equivalences before the bounded candidate read.
  const exactNames = [...new Set(variants.flatMap((variant) => {
    const key = policyNameKey(variant);
    const forms = [variant, key, key + "사업", key + "지원", key + "서비스", key + "지원사업", key + "지원서비스"];
    return [...forms, ...forms.map((form) => form + form), ...(key === "주거급여" ? ["주거급여맞춤형급여"] : [])];
  }).filter(Boolean))];
  // 변형이 모두 3글자 이상이면 전문 인덱스 후보에서 출발한다. instr 조건은 그대로 남아 최종 판정을 한다.
  const ftsTerms = variants.map(ftsPhrase);
  const useFts = ftsTerms.every((term) => term !== null) && await searchFtsReady(db, "gov24_search");
  const from = useFts ? "gov24_search c CROSS JOIN gov24_service g ON g.service_id = c.service_id" : "gov24_service g LEFT JOIN gov24_search c ON c.service_id = g.service_id";
  const where = [...(useFts ? ["c.rowid IN (SELECT rowid FROM gov24_search_fts WHERE gov24_search_fts MATCH ?)"] : []), "presence = 'PRESENT'", "(" + clauses.join(" OR ") + ")"];
  const binds: unknown[] = [...(useFts ? [ftsTerms.join(" OR ")] : []), ...variants];
  const preferredOrganizations: string[] = [];
  // 지역은 SQL에서 먼저 좁힌다. 중앙기관과 같은 시·도 발행 자료만 후보로 읽는다.
  if (plan.region_id && plan.region_id !== "region:전국") {
    const [province, municipality = ""] = plan.region_id.slice(7).split("|");
    const aliases = REGION_DEFINITIONS.find((region) => region.fullName === province)?.aliases ?? [province];
    const regions: string[] = plan.include_ancestor_scope ? ["org_type = '중앙행정기관'"] : [];
    for (const alias of aliases) {
      const oldMergedProvince = province === "전남광주통합특별시" && alias !== province;
      if (!municipality || plan.include_ancestor_scope && !oldMergedProvince) { regions.push("org_name = ?"); binds.push(alias); }
      const prefix = alias + " " + municipality;
      preferredOrganizations.push(municipality ? prefix : alias);
      if (municipality) { regions.push("org_name = ? OR substr(org_name,1,?) = ?"); binds.push(prefix, prefix.length + 1, prefix + " "); }
      else { regions.push("substr(org_name,1,?) = ?"); binds.push(prefix.length, prefix); }
    }
    where.push("(" + regions.join(" OR ") + ")");
  }
  const requestedDetails = (plan.detail_terms ?? []).map(compactWelfareText).filter(Boolean);
  const detailGuards: string[] = [];
  if (!positiveQueryTerms(plan.raw_query, CERTIFICATE_TERMS).length) detailGuards.push("instr(" + name + ", '증명서') = 0 AND instr(" + name + ", '확인서') = 0");
  const operationTerms = ["냉난방비", "인건비", "운영비", "설치비", "기능보강"];
  if (!positiveQueryTerms(plan.raw_query, operationTerms).length) detailGuards.push("NOT ((instr(" + name + ", '센터') > 0 OR instr(" + name + ", '시설') > 0) AND (" + operationTerms.map((term) => "instr(" + name + ", '" + term + "') > 0").join(" OR ") + "))");
  if (plan.programs.some((program) => program === "행복이음" || program === "통합돌봄지원정보시스템") && !positiveQueryTerms(plan.raw_query, ["장학금", "장학"]).length) detailGuards.push("instr(" + name + ", '장학금') = 0");
  const detailOrder = requestedDetails.length ? "CASE WHEN EXISTS (SELECT 1 FROM json_each(?) d WHERE instr(" + name + ", d.value) > 0) AND (" + nameClauses.join(" OR ") + ")" + (detailGuards.length ? " AND (" + detailGuards.join(") AND (") + ")" : "") + " THEN 0 ELSE 1 END, " : "";
  const regionalOrder = preferredOrganizations.length ? "CASE WHEN org_name IN (SELECT value FROM json_each(?)) THEN 0 ELSE 1 END, " : "";
  const rows = await db.prepare("SELECT g.* FROM " + from + " WHERE " + where.join(" AND ") + " ORDER BY " + detailOrder + "CASE WHEN " + name + " IN (SELECT value FROM json_each(?)) THEN 0 WHEN (" + nameClauses.join(" OR ") + ") THEN 1 ELSE 2 END, " + regionalOrder + "CASE WHEN org_type = '중앙행정기관' THEN 0 ELSE 1 END, g.name, g.service_id LIMIT 80")
    .bind(...binds, ...(requestedDetails.length ? [JSON.stringify(requestedDetails), ...variants] : []), JSON.stringify(exactNames), ...variants, ...(preferredOrganizations.length ? [JSON.stringify(preferredOrganizations)] : [])).all<Gov24Row>();
  const selected = rows.results.filter((row) => gov24RegionMatches(row, plan.region_id, plan.include_ancestor_scope))
    .filter((row) => !plan.excluded_programs.some((excluded) => policyNameKey(String(row.name)) === policyNameKey(excluded)))
    .map((row) => ({ row, rank: gov24SearchRelevance({ name: String(row.name), org_type: str(row.org_type), detail_status: row.detail_status === "COLLECTED" && String(row.detail_modified_at ?? "") === String(row.modified_at ?? "") ? "COLLECTED" : "STALE", publisher_scope: gov24PublisherScope(row) }, plan) }))
    .sort((a, b) => b.rank - a.rank || String(a.row.service_id).localeCompare(String(b.row.service_id)))
    .slice(0, limit).map((item) => item.row);
  return (await hydrateGov24Details(db, selected)).map((row) => gov24Dto(row, plan.year));
}

export function gov24Text(service: Gov24Service): string {
  const labels: Record<string, string> = { purpose: "사업목적", target: "지원대상", criteria: "선정기준", benefit: "지원내용", apply_method: "신청방법", apply_deadline: "신청기간", required_documents: "구비서류", reception: "접수기관", contact: "문의처" };
  return ["사업명: " + service.name, "소관기관: " + service.org_name, ...FIELDS.filter((field) => service[field]).map((field) => labels[field] + ": " + service[field]), "출처: " + service.source.url, "원천 수정일: " + (service.source.source_modified_at ?? "미확인"), ...service.warnings].join("\n");
}
