export interface VisitorCf {
  readonly country?: string;
  readonly regionCode?: string;
  readonly region?: string;
}

// ISO 3166-2:KR subdivision codes reported by Cloudflare as request.cf.regionCode.
const REGION_CODE_TO_SIDO: Readonly<Record<string, string>> = {
  "11": "서울특별시",
  "26": "부산광역시",
  "27": "대구광역시",
  "28": "인천광역시",
  "29": "전남광주통합특별시",
  "30": "대전광역시",
  "31": "울산광역시",
  "41": "경기도",
  "42": "강원특별자치도",
  "43": "충청북도",
  "44": "충청남도",
  "45": "전북특별자치도",
  "46": "전남광주통합특별시",
  "47": "경상북도",
  "48": "경상남도",
  "49": "제주특별자치도",
  "50": "세종특별자치시",
  "51": "강원특별자치도",
  "52": "전북특별자치도",
};

// English region names used when only request.cf.region is available.
const REGION_NAME_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/seoul/, "서울특별시"],
  [/busan|pusan/, "부산광역시"],
  [/daegu|taegu/, "대구광역시"],
  [/incheon|inchon/, "인천광역시"],
  [/gwangju|kwangju/, "전남광주통합특별시"],
  [/daejeon|taejon/, "대전광역시"],
  [/ulsan/, "울산광역시"],
  [/sejong/, "세종특별자치시"],
  [/gyeonggi|kyonggi/, "경기도"],
  [/gangwon|kangwon/, "강원특별자치도"],
  [/(north|buk).*chung|chung.*(north|buk)/, "충청북도"],
  [/(south|nam).*chung|chung.*(south|nam)/, "충청남도"],
  [/(north|buk).*(jeolla|cholla)|(jeolla|cholla).*(north|buk)/, "전북특별자치도"],
  [/(south|nam).*(jeolla|cholla)|(jeolla|cholla).*(south|nam)/, "전남광주통합특별시"],
  [/(north|buk).*(gyeongsang|kyongsang)|(gyeongsang|kyongsang).*(north|buk)/, "경상북도"],
  [/(south|nam).*(gyeongsang|kyongsang)|(gyeongsang|kyongsang).*(south|nam)/, "경상남도"],
  [/jeju|cheju/, "제주특별자치도"],
];

export function visitorSidoFromCf(cf: VisitorCf | undefined): string | null {
  if (!cf || (cf.country && cf.country !== "KR")) return null;
  const code = (cf.regionCode ?? "").replace(/^KR-/i, "").trim();
  if (REGION_CODE_TO_SIDO[code]) return REGION_CODE_TO_SIDO[code];
  const name = (cf.region ?? "").toLowerCase();
  if (!name) return null;
  return REGION_NAME_PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export async function resolveVisitorSido(
  cf: VisitorCf | undefined,
): Promise<{ readonly sido: string | null; readonly source: "edge" | "none" }> {
  const fromCf = visitorSidoFromCf(cf);
  return fromCf ? { sido: fromCf, source: "edge" } : { sido: null, source: "none" };
}
