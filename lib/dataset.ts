import { matchesSearch, parseSearch, searchableText } from "./search-terms.ts";
import { restoreVerifiedSourceDistinctions } from "./official-source-restoration.ts";
import { serviceMatchesTarget } from "./target-groups.ts";

export interface ServiceRow {
  id: number;
  serviceId: string;
  sido: string;
  sigungu: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  target: string;
  detailTarget: string;
  applicationMethod: string;
  provider: string;
  type: string;
  serial: string;
  detailUrl: string;
  updatedDate: string;
  searchIndex: string;
}

export interface FilterState {
  sido: string;
  sigungu: string;
  category: string;
  subcategory: string;
  type: string;
  keyword: string;
  /** 결과 정렬. 비우면 검색어가 있을 때 관련도순, 없을 때 지역순(lib/search-terms.ts). */
  sort?: string;
  /** 대상자 묶음 slug(target_group, 예: elderly). 관계성 지도와 같은 정의(lib/target-groups.ts)로 지원대상·세부대상·사업명을 본다. */
  targetGroup?: string;
}

export const SERVICE_CATEGORY_ORDER = [
  "건강관리예방",
  "일상생활돌봄",
  "보건의료",
  "주거복지",
  "장애지원",
  "요양",
  "기타",
] as const;

export const EMPTY_FILTERS: FilterState = {
  sido: "",
  sigungu: "",
  category: "",
  subcategory: "",
  type: "",
  keyword: "",
};

export type DataState = "official" | "syncing" | "empty" | "failed";

export interface DatasetEnvelope {
  state: DataState;
  sourceLabel: string;
  sourceUrl: string;
  fetchedAt: string;
  dataAsOf: string;
  message: string;
  rows: unknown;
}

interface CompactRowsPayload {
  columns?: unknown;
  dictionaries?: unknown;
  rows?: unknown;
}

export function expandCompactRows(payload: CompactRowsPayload): unknown {
  if (!Array.isArray(payload.columns) || !payload.columns.every((value) => typeof value === "string")) {
    return payload.rows;
  }
  if (!Array.isArray(payload.dictionaries) || !Array.isArray(payload.rows)) return payload.rows;

  const columns = payload.columns as string[];
  const dictionaries = payload.dictionaries.map((dictionary) =>
    Array.isArray(dictionary) && dictionary.every((value) => typeof value === "string")
      ? dictionary as string[]
      : null,
  );
  if (dictionaries.length !== columns.length || dictionaries.some((dictionary) => dictionary === null)) {
    return payload.rows;
  }

  return payload.rows.map((entry) => {
    if (!Array.isArray(entry)) return entry;
    const record: Record<string, string> = {};
    columns.forEach((column, columnIndex) => {
      const valueIndex = entry[columnIndex];
      const dictionary = dictionaries[columnIndex];
      record[column] =
        typeof valueIndex === "number" && Number.isInteger(valueIndex) && dictionary
          ? dictionary[valueIndex] ?? ""
          : "";
    });
    return record;
  });
}

function text(source: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

export function collapse(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

const INTEGRATED_PROVINCE_NAME = "전남광주통합특별시";
const INTEGRATED_PROVINCE_ALIASES = new Set([
  INTEGRATED_PROVINCE_NAME,
  "광주광역시",
  "전라남도",
]);

function currentProvinceName(value: string): string {
  return INTEGRATED_PROVINCE_ALIASES.has(value) ? INTEGRATED_PROVINCE_NAME : value;
}

export function normalizeRows(payload: unknown): ServiceRow[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { services?: unknown[] })?.services)
      ? (payload as { services: unknown[] }).services
      : Array.isArray((payload as { data?: unknown[] })?.data)
        ? (payload as { data: unknown[] }).data
        : [];

  const rows: ServiceRow[] = [];
  source.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const row: ServiceRow = restoreVerifiedSourceDistinctions({
      id: index,
      serviceId: text(record, "serviceId", "service_id"),
      sido: currentProvinceName(text(record, "시도", "시·도", "sido")),
      sigungu: text(record, "시군구", "시·군·구", "sigungu"),
      category: text(record, "대분류", "category"),
      subcategory: text(record, "중분류", "subcategory"),
      name: text(record, "사업명", "서비스명", "name"),
      description: text(record, "사업내용", "서비스내용", "description"),
      target: text(record, "지원대상", "target"),
      detailTarget: text(record, "세부대상자", "detailTarget", "detail_target"),
      applicationMethod: text(record, "신청방법", "applicationMethod", "application_method"),
      provider: text(record, "제공기관", "수행기관", "provider"),
      type: text(record, "사업구분", "type").replace(/^경기도$/, "광역"),
      serial: text(record, "연번"),
      detailUrl: text(record, "detailUrl", "detail_url", "원문URL", "출처URL"),
      updatedDate: text(record, "updatedDate", "updated_date", "기준일"),
      searchIndex: "",
    });
    if (!row.sido && !row.sigungu && !row.name) return;
    row.searchIndex = searchableText([
      row.sido,
      row.sigungu,
      row.category,
      row.subcategory,
      row.name,
      row.description,
      row.target,
      row.detailTarget,
      row.applicationMethod,
      row.provider,
      row.type,
    ]);
    rows.push(row);
  });
  return rows;
}

export function municipalityKey(row: Pick<ServiceRow, "sido" | "sigungu">): string {
  return `${row.sido}|${row.sigungu}`;
}

export function municipalityLabel(key: string): string {
  const [sido, sigungu] = key.split("|");
  return [sido, sigungu].filter(Boolean).join(" ");
}

type WikiIdentityRow = Pick<
  ServiceRow,
  "serviceId" | "sido" | "sigungu" | "category" | "subcategory" | "name"
>;

function wikiIdentityPart(value: string): string {
  return value.toLowerCase().replace(/[^0-9가-힣a-z]/g, "");
}

export function serviceWikiKey(row: WikiIdentityRow): string {
  return `service:${[
    row.serviceId,
    row.sido,
    row.sigungu,
    row.category,
    row.subcategory,
    row.name,
  ].map(wikiIdentityPart).join("|")}`;
}

export function serviceWikiHref(
  row: WikiIdentityRow,
): string {
  const params = new URLSearchParams({ service: serviceWikiKey(row) });
  return `/wiki?${params.toString()}`;
}

export function filterRows(rows: ServiceRow[], filters: FilterState): ServiceRow[] {
  const parsed = parseSearch(filters.keyword);
  return rows.filter((row) => {
    if (filters.sido && row.sido !== filters.sido) return false;
    if (filters.sigungu && row.sigungu !== filters.sigungu) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.subcategory && row.subcategory !== filters.subcategory) return false;
    if (filters.type && row.type !== filters.type) return false;
    if (filters.targetGroup && !serviceMatchesTarget(row, filters.targetGroup)) return false;
    if (!matchesSearch(row.searchIndex, parsed)) return false;
    return true;
  });
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "ko"));
}

export function countBy(
  rows: readonly ServiceRow[],
  select: (row: ServiceRow) => string,
): [string, number][] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = select(row) || "미분류";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}
