import type { FilterState, ServiceRow } from "./dataset.ts";

const CSV_COLUMNS: readonly (readonly [string, keyof ServiceRow])[] = [
  ["시도", "sido"],
  ["시군구", "sigungu"],
  ["대분류", "category"],
  ["중분류", "subcategory"],
  ["사업명", "name"],
  ["사업내용", "description"],
  ["지원대상", "target"],
  ["세부대상자", "detailTarget"],
  ["제공기관", "provider"],
  ["사업구분", "type"],
];

const FORMULA_PREFIX = /^(?:[\u0000-\u001F\u007F]|[\s\u00A0]*[=+\-@])/;

function csvCell(value: string): string {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly ServiceRow[]): string {
  const header = CSV_COLUMNS.map(([label]) => csvCell(label)).join(",");
  const body = rows.map((row) =>
    CSV_COLUMNS.map(([, field]) => csvCell(String(row[field] ?? ""))).join(","),
  );
  return `\uFEFF${[header, ...body].join("\r\n")}`;
}

export function csvFileName(filters: FilterState, today: Date): string {
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("");
  const scope = filters.sigungu || filters.sido || "전국";
  return `전국통합돌봄_사업현황_${scope}_${stamp}.csv`;
}
