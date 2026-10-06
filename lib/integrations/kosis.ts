// KOSIS 통계와 지역별 지표. 통계지역코드는 법정동 시·군·구에 코드·이름이 모두 같을 때만 확정 연결하고,
// 결측·비공개 값은 0으로 바꾸지 않는다. 지표는 분자·분모의 기준시점을 함께 돌려주고 시점·범위가 맞지 않으면 비교 제한을 붙인다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { kosisRegionLink } from "./region-codes.ts";

export interface KosisAggregate {
  /** 합산할 두 번째 분류값(예: 5세 계급 65~69세…100세 이상). 하나라도 없거나 비공개면 합계를 만들지 않는다. */
  readonly class2_codes: readonly string[];
  readonly label: string;
}

/** 수집 뒤 통계표의 지역 분류값을 법정동 시·도·시·군·구에 잇는다(VERIFIED는 코드·이름 동시 일치만). */
export async function mapKosisRegions(db: SqlDatabase, orgId: string, tblId: string, now: number): Promise<number> {
  const regions = await db.prepare("SELECT DISTINCT region_code, region_name FROM kosis_observation WHERE org_id = ? AND tbl_id = ?").bind(orgId, tblId).all<{ region_code: string; region_name: string | null }>();
  const legal = await db.prepare("SELECT DISTINCT code, name FROM region_code WHERE code_type = 'LEGAL_DONG' AND level IN ('SIDO', 'SIGUNGU', 'GENERAL_DISTRICT', 'ADMIN_CITY') AND (valid_to IS NULL OR valid_to > date('now'))").all<{ code: string; name: string }>();
  const statements: SqlStatement[] = [];
  for (const region of regions.results) {
    const link = kosisRegionLink(region.region_code, region.region_name ?? "", legal.results);
    if (!link.legalCode) continue;
    statements.push(db.prepare("INSERT INTO region_code_map (map_id, from_type, from_code, to_type, to_code, relation, valid_from, valid_to, status, basis, basis_url, note, created_at) VALUES (?, 'KOSIS_REGION', ?, 'LEGAL_DONG', ?, 'SAME', NULL, NULL, ?, ?, ?, ?, ?) ON CONFLICT(map_id) DO UPDATE SET status = CASE WHEN region_code_map.reviewed_at IS NULL THEN excluded.status ELSE region_code_map.status END, basis = excluded.basis")
      .bind("kosis:" + orgId + ":" + tblId + ":" + region.region_code + "->" + link.legalCode, region.region_code, link.legalCode, link.status, link.basis, "https://kosis.kr/statHtml/statHtml.do?orgId=" + orgId + "&tblId=" + tblId, (region.region_name ?? "") + " (" + orgId + "/" + tblId + ")", now));
  }
  for (let index = 0; index < statements.length; index += 200) await db.batch(statements.slice(index, index + 200));
  return statements.length;
}

export interface RegionLegalCode {
  readonly code: string;
  readonly relation: string;
}

/** 화면 지역 ID에 확정 연결된, 기준일에 효력 있는 법정동 시·군·구 코드. 시·도 ID면 그 아래 시·군·구까지 포함한다. */
export async function legalCodesForRegion(db: SqlDatabase, regionId: string, asOf: string): Promise<RegionLegalCode[]> {
  const rows = await db.prepare("SELECT DISTINCT from_code AS code, relation FROM region_code_map WHERE from_type = 'LEGAL_DONG' AND to_type = 'CONTENT_REGION' AND (to_code = ? OR to_code LIKE ?) AND status = 'VERIFIED' AND relation IN ('SAME', 'PART_OF') AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?)")
    .bind(regionId, regionId.includes("|") ? regionId : regionId + "|%", asOf, asOf).all<RegionLegalCode>();
  return rows.results;
}

export interface Observation {
  readonly org_id: string;
  readonly tbl_id: string;
  readonly itm_id: string;
  readonly region_code: string;
  readonly region_name: string | null;
  readonly class2: string;
  readonly class2_name: string | null;
  readonly period: string;
  readonly value: string | null;
  readonly value_status: string;
  readonly unit: string | null;
  readonly relation: string;
}

export interface SeriesPoint {
  readonly period: string;
  readonly value: string | null;
  readonly status: string;
  readonly unit: string | null;
  readonly basis: string;
}

/**
 * 한 통계표의 지역 시계열. 시 단위 값(SAME)이 있으면 그것만, 없으면 구 단위(PART_OF)를 모두 더한다(하나라도 없으면 null).
 * aggregate가 있으면 같은 지역·시점의 두 번째 분류값을 더한다(하나라도 결측·비공개면 null과 사유).
 */
export function regionSeries(observations: readonly Observation[], aggregate: KosisAggregate | null): SeriesPoint[] {
  const byPeriod = new Map<string, Observation[]>();
  for (const row of observations) {
    const list = byPeriod.get(row.period) ?? [];
    list.push(row);
    byPeriod.set(row.period, list);
  }
  const points: SeriesPoint[] = [];
  for (const [period, rows] of [...byPeriod].sort(([a], [b]) => a.localeCompare(b))) {
    const same = rows.filter((row) => row.relation === "SAME");
    const chosen = same.length ? same : rows;
    const regionCodes = [...new Set(chosen.map((row) => row.region_code))];
    let total = 0;
    let status = "OK";
    let unit: string | null = null;
    for (const regionCode of regionCodes) {
      const regionRows = chosen.filter((row) => row.region_code === regionCode);
      const wanted = aggregate ? aggregate.class2_codes : [regionRows[0]?.class2 ?? ""];
      for (const code of wanted) {
        const row = regionRows.find((entry) => entry.class2 === code);
        if (!row) { status = "MISSING"; continue; }
        unit = row.unit ?? unit;
        if (row.value_status !== "OK" || row.value === null) { status = row.value_status; continue; }
        total += Number(row.value);
      }
    }
    points.push({ period, value: status === "OK" ? String(Math.round(total * 1000) / 1000) : null, status, unit, basis: same.length ? "단일 지역 값" : regionCodes.length > 1 ? "구 단위 " + regionCodes.length + "곳 합산" : "포함 지역 값" });
  }
  return points;
}

export interface Indicator {
  readonly id: string;
  readonly label: string;
  readonly value: string | null;
  readonly unit: string;
  readonly formula: string;
  readonly numerator: { readonly label: string; readonly value: number | null; readonly basis_date: string | null; readonly source: string };
  readonly denominator: { readonly label: string; readonly value: string | null; readonly period: string | null; readonly source: string };
  readonly limitations: readonly string[];
  readonly reason: string | null;
}

/** 월 차이(YYYY-MM-DD와 YYYYMM 또는 YYYY). 계산할 수 없으면 null. */
export function monthsBetween(isoDay: string, period: string): number | null {
  const day = /^(\d{4})-(\d{2})/.exec(isoDay);
  const per = /^(\d{4})(\d{2})?/.exec(period);
  if (!day || !per) return null;
  const a = Number(day[1]) * 12 + Number(day[2]);
  const b = Number(per[1]) * 12 + (per[2] ? Number(per[2]) : 12);
  return Math.abs(a - b);
}

/** 고령인구 1천 명당 장기요양기관 수. 분자는 기관기호 기준 고유 기관 수, 분모는 65세 이상 인구의 최근 완전한 시점. */
export function institutionsPerThousandElderly(institutionCount: number | null, institutionBasisDate: string | null, elderly: SeriesPoint | null, elderlySource: string, extraLimitations: readonly string[] = []): Indicator {
  const limitations = [...extraLimitations, "통계로 본 지역 규모 비교용이며 실제 통합돌봄 신청자·대상자 수가 아닙니다.", "장기요양기관 수는 지정 기관 수이며 빈자리·이용 가능 여부를 뜻하지 않습니다."];
  const base = {
    id: "ltc_institutions_per_1000_elderly",
    label: "고령인구 1천 명당 장기요양기관 수",
    unit: "곳/천 명",
    formula: "장기요양기관 수(기관기호 기준, 서비스 유형 중복 제외) ÷ 65세 이상 인구 × 1,000",
    numerator: { label: "장기요양기관 수", value: institutionCount, basis_date: institutionBasisDate, source: "국민건강보험공단 장기요양기관 검색 서비스(공공데이터포털 15059029)" },
    denominator: { label: "65세 이상 인구", value: elderly?.value ?? null, period: elderly?.period ?? null, source: elderlySource },
  };
  if (institutionCount === null || !institutionBasisDate) return { ...base, value: null, limitations, reason: "장기요양기관 미수집" };
  if (!elderly) return { ...base, value: null, limitations, reason: "65세 이상 인구 통계 미수집 또는 통계표 확인 전" };
  if (elderly.value === null) return { ...base, value: null, limitations, reason: "65세 이상 인구 값이 " + elderly.status + "(결측·비공개)라 계산하지 않았습니다." };
  const population = Number(elderly.value);
  if (!(population > 0)) return { ...base, value: null, limitations, reason: "분모가 0이거나 올바르지 않습니다." };
  const gap = monthsBetween(institutionBasisDate, elderly.period);
  const timing = gap !== null && gap > 6 ? ["분자 기준일(" + institutionBasisDate + ")과 분모 기준시점(" + elderly.period + ") 차이가 " + gap + "개월입니다. 비교에 주의하세요."] : [];
  return { ...base, value: (Math.round((institutionCount / population) * 1000 * 100) / 100).toFixed(2), limitations: [...timing, ...limitations], reason: null };
}
