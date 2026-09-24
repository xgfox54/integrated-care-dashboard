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

const LOOKUP_TIMEOUT_MS = 1500;
const LOOKUP_CACHE_LIMIT = 2000;
const lookupCache = new Map<string, string | null>();

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

// Public IP geolocation services, tried in order when Cloudflare has no region.
const IP_LOOKUPS: readonly (readonly [string, (ip: string) => Promise<VisitorCf | null>])[] = [
  ["ip-api.com", async (ip) => {
    const data = await getJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,region,regionName`);
    if (!data || data.status !== "success") return null;
    return { country: text(data.countryCode), regionCode: text(data.region), region: text(data.regionName) };
  }],
  ["ipwho.is", async (ip) => {
    const data = await getJson(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,region,region_code`);
    if (!data || data.success === false) return null;
    return { country: text(data.country_code), regionCode: text(data.region_code), region: text(data.region) };
  }],
  ["freeipapi.com", async (ip) => {
    const data = await getJson(`https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}`);
    if (!data) return null;
    return { country: text(data.countryCode), region: text(data.regionName) };
  }],
];

async function lookupIp(ip: string, attempts: string[]): Promise<string | null> {
  if (lookupCache.has(ip)) return lookupCache.get(ip) ?? null;
  for (const [name, lookup] of IP_LOOKUPS) {
    try {
      const found = await lookup(ip);
      attempts.push(`${name}: ${found ? `${found.country ?? ""} ${found.regionCode ?? ""} ${found.region ?? ""}` : "no answer"}`);
      if (!found) continue;
      const sido = visitorSidoFromCf(found);
      if (sido || (found.country && found.country !== "KR")) {
        if (lookupCache.size >= LOOKUP_CACHE_LIMIT) lookupCache.clear();
        lookupCache.set(ip, sido);
        return sido;
      }
    } catch (error) {
      attempts.push(`${name}: ${error instanceof Error ? error.name : "error"}`);
    }
  }
  return null;
}

export async function resolveVisitorSido(
  cf: VisitorCf | undefined,
  ip: string,
  country: string,
): Promise<{ sido: string | null; source: "cloudflare" | "ip-lookup" | "none"; attempts: string[] }> {
  const attempts: string[] = [];
  const fromCf = visitorSidoFromCf(cf);
  if (fromCf) return { sido: fromCf, source: "cloudflare", attempts };
  if (!ip || (country && country !== "KR")) return { sido: null, source: "none", attempts: [`skipped: ip=${ip ? "yes" : "no"} country=${country}`] };
  const fromIp = await lookupIp(ip, attempts);
  return { sido: fromIp, source: fromIp ? "ip-lookup" : "none", attempts };
}
