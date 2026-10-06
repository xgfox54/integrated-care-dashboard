// 행정코드 정비: 법정동코드·행정동코드·통계지역코드·재정기관코드를 서로 다른 체계로 다룬다.
// 원칙: 코드는 적용기간(생성일 포함 ~ 폐지일 미포함)과 근거 출처를 함께 보관하고, 현재 코드로 과거 코드를 덮어쓰지 않는다.
// 법정동코드만으로 행정조직·재정기관 관계를 확정하지 않는다(재정기관은 fiscal_region_mapping, 통계지역은 별도 대응표).

export type RegionCodeType = "LEGAL_DONG" | "ADMIN_DONG" | "KOSIS_REGION" | "LOFIN_LAF" | "CONTENT_REGION";
export type RegionLevel = "SIDO" | "SIGUNGU" | "GENERAL_DISTRICT" | "ADMIN_CITY" | "EMD" | "RI";
export type MappingRelation = "SAME" | "PART_OF" | "PREDECESSOR" | "SUCCESSOR";
export type MappingStatus = "VERIFIED" | "CANDIDATE" | "UNVERIFIED";

/**
 * 법정동 시·도 코드와 정식 명칭. 행정표준코드관리시스템 법정동코드목록조회 화면의 시·도 선택 목록(2026-10-05 조회)과
 * 같은 화면의 폐지 포함 검색(광주광역시·전라남도 폐지일 2026-07-01, 전남광주통합특별시 생성일 2026-07-01)을 근거로 한다.
 */
export const LEGAL_SIDO: Readonly<Record<string, { readonly name: string; readonly contentSido: string; readonly validTo?: string; readonly validFrom?: string }>> = {
  "11": { name: "서울특별시", contentSido: "서울특별시" },
  "12": { name: "전남광주통합특별시", contentSido: "전남광주통합특별시", validFrom: "2026-07-01" },
  "26": { name: "부산광역시", contentSido: "부산광역시" },
  "27": { name: "대구광역시", contentSido: "대구광역시" },
  "28": { name: "인천광역시", contentSido: "인천광역시" },
  "29": { name: "광주광역시", contentSido: "전남광주통합특별시", validTo: "2026-07-01" },
  "30": { name: "대전광역시", contentSido: "대전광역시" },
  "31": { name: "울산광역시", contentSido: "울산광역시" },
  "36": { name: "세종특별자치시", contentSido: "세종특별자치시" },
  "41": { name: "경기도", contentSido: "경기도" },
  "43": { name: "충청북도", contentSido: "충청북도" },
  "44": { name: "충청남도", contentSido: "충청남도" },
  "46": { name: "전라남도", contentSido: "전남광주통합특별시", validTo: "2026-07-01" },
  "47": { name: "경상북도", contentSido: "경상북도" },
  "48": { name: "경상남도", contentSido: "경상남도" },
  "49": { name: "제주도", contentSido: "제주특별자치도", validTo: "2006-07-01" },
  "50": { name: "제주특별자치도", contentSido: "제주특별자치도" },
  "51": { name: "강원특별자치도", contentSido: "강원특별자치도" },
  "52": { name: "전북특별자치도", contentSido: "전북특별자치도" },
};

/** 화면(보건복지부 사업안내)에서 시·군·구 칸에 시·도 이름을 쓰는 광역 단위. 행정시·세종은 시·도 단위로 연결한다. */
const SIDO_ONLY_CONTENT: ReadonlySet<string> = new Set(["제주특별자치도", "세종특별자치시"]);

export interface LegalCodeParts {
  readonly sido: string;
  readonly sgg: string;
  readonly umd: string;
  readonly ri: string;
}

export function isLegalCode(code: string): boolean {
  return /^\d{10}$/.test(code);
}

export function splitLegalCode(code: string): LegalCodeParts {
  if (!isLegalCode(code)) throw new Error("법정동코드는 숫자 10자리여야 합니다.");
  return { sido: code.slice(0, 2), sgg: code.slice(2, 5), umd: code.slice(5, 8), ri: code.slice(8, 10) };
}

/** 시·도(2)+시·군·구(3) 두 칸만 받은 원천(장기요양기관 API 등)을 10자리 시·군·구 코드로 만든다. */
export function sigunguCodeOf(sidoCd: string, sggCd: string): string | null {
  if (!/^\d{2}$/.test(sidoCd) || !/^\d{3}$/.test(sggCd)) return null;
  return sidoCd + sggCd + "00000";
}

/** 코드와 정식 명칭으로 단위를 정한다. 「창원시 의창구」처럼 시 이름 뒤에 구가 붙으면 일반구(행정구), 제주 아래 시는 행정시다. */
export function legalLevel(code: string, fullName: string): RegionLevel {
  const parts = splitLegalCode(code);
  if (parts.sgg === "000" && parts.umd === "000" && parts.ri === "00") return "SIDO";
  if (parts.umd !== "000") return parts.ri === "00" ? "EMD" : "RI";
  const words = fullName.trim().split(/\s+/);
  const local = words.slice(1);
  if (local.length >= 2 && local[0]?.endsWith("시") && /구$/.test(local[1] ?? "")) return "GENERAL_DISTRICT";
  if ((parts.sido === "50" || parts.sido === "49") && local[0]?.endsWith("시")) return "ADMIN_CITY";
  return "SIGUNGU";
}

/** 날짜 문자열(YYYYMMDD 또는 YYYY-MM-DD)을 YYYY-MM-DD로. 형식이 아니면 null. */
export function isoDate(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  return match ? match[1] + "-" + match[2] + "-" + match[3] : null;
}

export interface CodeRecord {
  readonly code: string;
  readonly name: string;
  /** 생성일(포함). 모르면 null. */
  readonly validFrom: string | null;
  /** 폐지일(미포함). 현행이거나 모르면 null. */
  readonly validTo: string | null;
}

/** 기준일에 효력이 있던 코드인가. 생성일과 폐지일이 같은 코드(같은 날 생기고 없어짐)는 어느 날에도 효력이 없다. */
export function validOn(record: CodeRecord, asOf: string): boolean {
  if (record.validFrom && asOf < record.validFrom) return false;
  if (record.validTo && asOf >= record.validTo) return false;
  if (record.validFrom && record.validTo && record.validFrom >= record.validTo) return false;
  return true;
}

/** 명칭 끝부분(예: 「용지동」, 「창원시 의창구」)이 같은 코드 중 기준일에 효력이 있던 것. 여러 개면 모두 돌려준다(임의로 하나를 고르지 않음). */
export function resolveByNameAsOf(records: readonly CodeRecord[], nameSuffix: string, asOf: string): CodeRecord[] {
  const wanted = nameSuffix.trim();
  return records.filter((record) => (record.name === wanted || record.name.endsWith(" " + wanted)) && validOn(record, asOf));
}

export interface ContentLink {
  readonly regionId: string;
  readonly relation: MappingRelation;
  readonly status: MappingStatus;
  readonly note: string;
}

/**
 * 법정동 시·군·구(또는 시·도) 코드를 화면 지역 ID(region:<시·도>|<시·군·구>)에 잇는다.
 * - 일반구는 소속 시에, 제주 행정시·세종은 시·도 단위에 PART_OF로 잇는다(자치구·기초자치단체와 구분).
 * - 폐지된 광주광역시·전라남도 코드는 통합 이후 화면 지역의 이전 코드(PREDECESSOR)로 두되, 같은 이름의 구·군이 그대로 이어졌는지는 확인 전이라 CANDIDATE.
 */
export function contentLinkForLegal(code: string, fullName: string): ContentLink | null {
  const parts = splitLegalCode(code);
  const sido = LEGAL_SIDO[parts.sido];
  if (!sido) return null;
  const level = legalLevel(code, fullName);
  if (level === "EMD" || level === "RI") return null;
  const legacy = Boolean(sido.validTo);
  const words = fullName.trim().split(/\s+/).slice(1);
  if (level === "SIDO") {
    return { regionId: "region:" + sido.contentSido, relation: legacy ? "PREDECESSOR" : "SAME", status: legacy ? "CANDIDATE" : "VERIFIED", note: legacy ? sido.name + "(" + sido.validTo + " 폐지)의 관할은 " + sido.contentSido + "로 이어졌습니다." : "시·도 정식 명칭 일치" };
  }
  if (legacy && SIDO_ONLY_CONTENT.has(sido.contentSido)) {
    return { regionId: "region:" + sido.contentSido, relation: "PREDECESSOR", status: "CANDIDATE", note: sido.name + " 폐지(" + sido.validTo + ") 이전 코드" };
  }
  if (SIDO_ONLY_CONTENT.has(sido.contentSido)) {
    const note = level === "ADMIN_CITY" ? "행정시(기초자치단체 아님). 보건복지부 사업안내는 " + sido.contentSido + " 단위로만 수록" : "시·도 단위로만 수록되는 광역 단위";
    return { regionId: "region:" + sido.contentSido, relation: level === "ADMIN_CITY" ? "PART_OF" : "SAME", status: "VERIFIED", note };
  }
  const city = level === "GENERAL_DISTRICT" ? words[0] ?? "" : words.join(" ");
  if (!city) return null;
  const regionId = "region:" + sido.contentSido + "|" + city;
  if (legacy) return { regionId, relation: "PREDECESSOR", status: "CANDIDATE", note: sido.name + " 폐지(" + sido.validTo + ") 이전 코드. 통합 뒤 같은 이름의 구·군으로 이어졌는지 확인 전" };
  if (level === "GENERAL_DISTRICT") return { regionId, relation: "PART_OF", status: "VERIFIED", note: "일반구(행정구). 자치구가 아니므로 소속 시(" + city + ")에 포함" };
  return { regionId, relation: "SAME", status: "VERIFIED", note: "법정동 시·군·구 명칭 일치" };
}

/** 통계지역코드(KOSIS 분류값)를 법정동 시·군·구에 잇는 규칙. 코드와 이름이 모두 같을 때만 확정하고 나머지는 후보로 둔다. */
export function kosisRegionLink(kosisCode: string, kosisName: string, legal: readonly { readonly code: string; readonly name: string }[]): { readonly legalCode: string | null; readonly status: MappingStatus; readonly basis: string } {
  const name = kosisName.trim();
  const padded = /^\d{2}$/.test(kosisCode) ? kosisCode + "00000000" : /^\d{5}$/.test(kosisCode) ? kosisCode + "00000" : kosisCode;
  const byCode = legal.find((row) => row.code === padded);
  if (byCode && (byCode.name === name || byCode.name.endsWith(" " + name))) return { legalCode: byCode.code, status: "VERIFIED", basis: "SAME_CODE_SAME_NAME" };
  const byName = legal.filter((row) => row.name === name || row.name.endsWith(" " + name));
  if (byName.length === 1) return { legalCode: byName[0]?.code ?? null, status: "CANDIDATE", basis: "NAME_ONLY" };
  return { legalCode: null, status: "UNVERIFIED", basis: byName.length > 1 ? "NAME_AMBIGUOUS" : "NO_MATCH" };
}
