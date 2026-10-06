// 연계별 어댑터: 요청 주소 만들기와 응답 해석만 맡는다(저장·재시도는 runner.ts). 필드 이름은 공식 명세 그대로 쓴다.
// - 법정동코드: 공공데이터포털 15077871 StanReginCd/getStanReginCdList(JSON, StanReginCd[0].head / [1].row)
// - 장기요양기관 검색: 15059029 searchLtcInsttService02/getLtcInsttSeachList02(XML, 시도코드 필수)
// - 장기요양기관 상세: 15058856 getLtcInsttDetailInfoService02(일반현황 getGeneralSttusDetailInfoItem02, 협약기관 getConvInsttDetailInfoList02)
// - 정부24 공공서비스: 15113968 api.odcloud.kr/api/gov24/v3(serviceList·serviceDetail)
// - KOSIS: statisticsParameterData.do(method=getList), 통계표별 조회 조건은 관리자가 메타데이터를 확인해 등록한다.
import { classifyDataGoKr, classifyKosis, classifyOdcloud, type Outcome, type Provider } from "./http.ts";
import { xmlItems, xmlNumber } from "./xml.ts";

export const ADAPTER_VERSION = "ext-adapter-1.0.0";

export interface RecordInput {
  readonly recordId: string;
  readonly payload: Readonly<Record<string, string | null>>;
  readonly officialUrl?: string | null;
  readonly dataAsOf?: string | null;
  readonly sourceUpdatedAt?: string | null;
  readonly regionCodeType?: string | null;
  readonly regionCode?: string | null;
}

export interface ParsedPage {
  readonly records: readonly RecordInput[];
  /** 원천이 알린 전체 행 수(걸러낸 행 포함). 모르면 null. */
  readonly total: number | null;
  /** 이 쪽에서 받은 원천 행 수(걸러낸 행 포함). 쪽 누락 판정에 쓴다. */
  readonly rowsReceived: number;
}

export type DatasetKey = "mois.legal_dong" | "nhis.ltc_search" | "nhis.ltc_detail" | "mois.gov24_list" | "mois.gov24_detail" | "kosis.stats";

/** 값에서 줄바꿈·제어문자를 정리한 문자열. 빈 값은 null. */
export function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim();
  return text ? text : null;
}

function pick(source: Readonly<Record<string, unknown>>, fields: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of fields) out[field] = clean(source[field]);
  return out;
}

export function parseFailure(message: string): Outcome {
  return { kind: "PARSE_ERROR", httpStatus: 200, code: null, message, retryAfterSeconds: null };
}

// ---------- 법정동코드 ----------
export const LEGAL_DONG_FIELDS = ["region_cd", "sido_cd", "sgg_cd", "umd_cd", "ri_cd", "locatjumin_cd", "locatjijuk_cd", "locatadd_nm", "locat_order", "locat_rm", "locathigh_cd", "locallow_nm", "adpt_de"] as const;
export const LEGAL_DONG_PAGE = 1000;

export function legalDongUrl(page: number, key: string): string {
  return "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList?ServiceKey=" + key + "&pageNo=" + page + "&numOfRows=" + LEGAL_DONG_PAGE + "&type=json";
}

/** 리(里) 단위는 지역 연결에 쓰지 않으므로 저장하지 않는다(받은 행 수에는 센다). */
export function parseLegalDong(body: string): ParsedPage | Outcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return parseFailure("법정동코드 응답 JSON을 해석하지 못했습니다.");
  }
  const blocks = (parsed as { StanReginCd?: unknown }).StanReginCd;
  if (!Array.isArray(blocks)) return parseFailure("StanReginCd 배열이 없습니다.");
  const head = (blocks.find((block) => block && typeof block === "object" && "head" in block) as { head?: Record<string, unknown>[] } | undefined)?.head ?? [];
  const totalEntry = head.find((entry) => "totalCount" in entry);
  const total = totalEntry ? Number(totalEntry.totalCount) : null;
  const rows = (blocks.find((block) => block && typeof block === "object" && "row" in block) as { row?: Record<string, unknown>[] } | undefined)?.row ?? [];
  const records = rows
    .filter((row) => clean(row.ri_cd) === "00" || clean(row.ri_cd) === null)
    .filter((row) => /^\d{10}$/.test(String(row.region_cd ?? "")))
    .map((row): RecordInput => ({
      recordId: String(row.region_cd),
      payload: pick(row, LEGAL_DONG_FIELDS),
      dataAsOf: null,
      sourceUpdatedAt: clean(row.adpt_de),
      regionCodeType: "LEGAL_DONG",
      regionCode: String(row.region_cd),
    }));
  return { records, total: Number.isFinite(total) ? total : null, rowsReceived: rows.length };
}

// ---------- 장기요양기관 검색 ----------
export const LTC_SEARCH_FIELDS = ["longTermAdminSym", "adminPttnCd", "adminNm", "siDoCd", "siGunGuCd", "longTermPeribRgtDt", "stpRptDt"] as const;
export const LTC_PAGE = 100;

export function ltcSearchUrl(sidoCd: string, page: number, key: string): string {
  return "https://apis.data.go.kr/B550928/searchLtcInsttService02/getLtcInsttSeachList02?serviceKey=" + key + "&siDoCd=" + encodeURIComponent(sidoCd) + "&pageNo=" + page + "&numOfRows=" + LTC_PAGE;
}

/** 한 기관이 서비스 유형마다 따로 나온다. 행 식별자는 기관기호+기관유형코드이고, 기관 수는 기관기호로 센다. */
export function parseLtcSearch(body: string): ParsedPage | Outcome {
  if (!body.trim().startsWith("<")) return parseFailure("장기요양기관 검색 응답이 XML이 아닙니다.");
  const items = xmlItems(body);
  const records = items
    .filter((item) => /^\d{11}$/.test(item.longTermAdminSym ?? "") && /^[A-Z0-9]{3}$/.test(item.adminPttnCd ?? ""))
    .map((item): RecordInput => ({
      recordId: (item.longTermAdminSym ?? "") + ":" + (item.adminPttnCd ?? ""),
      payload: pick(item, LTC_SEARCH_FIELDS),
      regionCodeType: "LEGAL_DONG",
      regionCode: /^\d{2}$/.test(item.siDoCd ?? "") && /^\d{3}$/.test(item.siGunGuCd ?? "") ? (item.siDoCd ?? "") + (item.siGunGuCd ?? "") + "00000" : null,
    }));
  if (records.length !== items.length) return parseFailure("기관기호·기관유형코드 형식이 명세와 다른 행이 있습니다.");
  return { records, total: xmlNumber(body, "totalCount"), rowsReceived: items.length };
}

// ---------- 장기요양기관 상세(일반현황·협약기관) ----------
export const LTC_GENERAL_FIELDS = ["longTermAdminSym", "adminPttnCd", "adminNm", "hmPostNo", "siDoCd", "siGunGuCd", "HDongCd", "BDongCd", "riCd", "detailAddr", "roadNmCd", "gunmulMlno", "gunmulSlno", "fl", "locTelNo_1", "locTelNo_2", "locTelNo_3", "longTermPeribRgtDt", "stpRptDt"] as const;
export const LTC_PARTNER_FIELDS = ["longTermAdminSym", "yoyangNm", "adptFrDt", "adptToDt"] as const;

export function ltcGeneralUrl(sym: string, pttn: string, key: string): string {
  return "https://apis.data.go.kr/B550928/getLtcInsttDetailInfoService02/getGeneralSttusDetailInfoItem02?serviceKey=" + key + "&longTermAdminSym=" + encodeURIComponent(sym) + "&adminPttnCd=" + encodeURIComponent(pttn);
}

export function ltcPartnerUrl(sym: string, key: string): string {
  return "https://apis.data.go.kr/B550928/getLtcInsttDetailInfoService02/getConvInsttDetailInfoList02?serviceKey=" + key + "&longTermAdminSym=" + encodeURIComponent(sym) + "&pageNo=1&numOfRows=100";
}

export function parseLtcGeneral(body: string, sym: string): ParsedPage | Outcome {
  const items = xmlItems(body);
  // 활용가이드: 전화번호 필드 이름이 명세(locTelNo1)와 예제(locTelNo_1)에서 다르다. 둘 다 받는다.
  const item = items.find((entry) => entry.longTermAdminSym === sym);
  if (!item) return { records: [], total: 0, rowsReceived: items.length };
  const normalized: Record<string, string> = { ...item };
  for (const index of [1, 2, 3]) normalized["locTelNo_" + index] = item["locTelNo_" + index] ?? item["locTelNo" + index] ?? "";
  return { records: [{ recordId: sym + ":general", payload: pick(normalized, LTC_GENERAL_FIELDS), regionCodeType: "LEGAL_DONG", regionCode: legalFromGeneral(normalized) }], total: 1, rowsReceived: items.length };
}

function legalFromGeneral(item: Readonly<Record<string, string>>): string | null {
  const parts = [item.siDoCd, item.siGunGuCd, item.BDongCd, item.riCd ?? "00"];
  return /^\d{2}$/.test(parts[0] ?? "") && /^\d{3}$/.test(parts[1] ?? "") && /^\d{3}$/.test(parts[2] ?? "") && /^\d{2}$/.test(parts[3] || "00") ? (parts[0] ?? "") + (parts[1] ?? "") + (parts[2] ?? "") + (parts[3] || "00") : null;
}

export function parseLtcPartners(body: string, sym: string): ParsedPage | Outcome {
  const items = xmlItems(body).filter((item) => item.longTermAdminSym === sym && item.yoyangNm);
  const total = xmlNumber(body, "totalCount");
  return {
    records: items.map((item): RecordInput => ({ recordId: sym + ":partner:" + (item.yoyangNm ?? "") + ":" + (item.adptFrDt ?? ""), payload: pick(item, LTC_PARTNER_FIELDS) })),
    total,
    rowsReceived: items.length,
  };
}

// ---------- 정부24 공공서비스 ----------
export const GOV24_LIST_FIELDS = ["서비스ID", "지원유형", "서비스명", "서비스목적요약", "지원대상", "선정기준", "지원내용", "신청방법", "신청기한", "상세조회URL", "소관기관코드", "소관기관명", "부서명", "소관기관유형", "사용자구분", "서비스분야", "접수기관", "전화문의", "등록일시", "수정일시"] as const;
export const GOV24_DETAIL_FIELDS = ["서비스ID", "지원유형", "서비스명", "서비스목적", "신청기한", "지원대상", "선정기준", "지원내용", "신청방법", "구비서류", "접수기관명", "문의처", "온라인신청사이트URL", "수정일시", "소관기관명", "행정규칙", "자치법규", "법령"] as const;
export const GOV24_PAGE = 500;

export function gov24ListUrl(page: number, key: string): string {
  return "https://api.odcloud.kr/api/gov24/v3/serviceList?page=" + page + "&perPage=" + GOV24_PAGE + "&returnType=JSON&serviceKey=" + key;
}

export function gov24DetailUrl(serviceId: string, key: string): string {
  return "https://api.odcloud.kr/api/gov24/v3/serviceDetail?page=1&perPage=1&returnType=JSON&" + encodeURIComponent("cond[서비스ID::EQ]") + "=" + encodeURIComponent(serviceId) + "&serviceKey=" + key;
}

function odcloudData(body: string): { readonly data: Record<string, unknown>[]; readonly total: number | null } | null {
  try {
    const parsed = JSON.parse(body) as { data?: unknown; totalCount?: unknown; matchCount?: unknown };
    if (!Array.isArray(parsed.data)) return null;
    const total = Number(parsed.matchCount ?? parsed.totalCount);
    return { data: parsed.data as Record<string, unknown>[], total: Number.isFinite(total) ? total : null };
  } catch {
    return null;
  }
}

export function parseGov24List(body: string): ParsedPage | Outcome {
  const parsed = odcloudData(body);
  if (!parsed) return parseFailure("정부24 목록 응답을 해석하지 못했습니다.");
  const records = parsed.data.filter((row) => clean(row["서비스ID"])).map((row): RecordInput => ({
    recordId: String(clean(row["서비스ID"])),
    payload: pick(row, GOV24_LIST_FIELDS),
    officialUrl: clean(row["상세조회URL"]),
    sourceUpdatedAt: clean(row["수정일시"]),
  }));
  return { records, total: parsed.total, rowsReceived: parsed.data.length };
}

export function parseGov24Detail(body: string, serviceId: string): ParsedPage | Outcome {
  const parsed = odcloudData(body);
  if (!parsed) return parseFailure("정부24 상세 응답을 해석하지 못했습니다.");
  const row = parsed.data.find((entry) => clean(entry["서비스ID"]) === serviceId);
  if (!row) return { records: [], total: 0, rowsReceived: parsed.data.length };
  return { records: [{ recordId: serviceId + ":detail", payload: pick(row, GOV24_DETAIL_FIELDS), sourceUpdatedAt: clean(row["수정일시"]) }], total: 1, rowsReceived: parsed.data.length };
}

// ---------- KOSIS ----------
export interface KosisQuery {
  readonly itmId: string;
  readonly objL1: string;
  readonly objL2?: string;
  readonly objL3?: string;
  readonly prdSe: string;
  readonly newEstPrdCnt: number;
}

export const KOSIS_FIELDS = ["ORG_ID", "TBL_ID", "TBL_NM", "ITM_ID", "ITM_NM", "UNIT_NM", "C1", "C1_NM", "C1_OBJ_NM", "C2", "C2_NM", "C2_OBJ_NM", "C3", "C3_NM", "PRD_SE", "PRD_DE", "DT", "LST_CHN_DE"] as const;

export function kosisDataUrl(orgId: string, tblId: string, query: KosisQuery, key: string): string {
  const params = new URLSearchParams({ method: "getList", format: "json", jsonVD: "Y", orgId, tblId, itmId: query.itmId, objL1: query.objL1, prdSe: query.prdSe, newEstPrdCnt: String(query.newEstPrdCnt) });
  if (query.objL2) params.set("objL2", query.objL2);
  if (query.objL3) params.set("objL3", query.objL3);
  return "https://kosis.kr/openapi/Param/statisticsParameterData.do?apiKey=" + key + "&" + params.toString();
}

export function kosisMetaUrl(orgId: string, tblId: string, type: "TBL" | "ITM" | "PRD", key: string): string {
  return "https://kosis.kr/openapi/statisticsData.do?method=getMeta&type=" + type + "&apiKey=" + key + "&format=json&jsonVD=Y&orgId=" + encodeURIComponent(orgId) + "&tblId=" + encodeURIComponent(tblId);
}

export type KosisValueStatus = "OK" | "NOT_AVAILABLE" | "SUPPRESSED" | "UNKNOWN" | "MISSING";

/** KOSIS 수치 기호를 0으로 바꾸지 않는다: '-'(자료 없음), 'x'(비밀보호), '…'(미상), 빈 값(결측). */
export function kosisValue(raw: string | null): { readonly value: string | null; readonly status: KosisValueStatus } {
  const text = (raw ?? "").trim();
  if (!text) return { value: null, status: "MISSING" };
  if (text === "-") return { value: null, status: "NOT_AVAILABLE" };
  if (/^x$/i.test(text)) return { value: null, status: "SUPPRESSED" };
  if (text === "…" || text === "...") return { value: null, status: "UNKNOWN" };
  const numeric = text.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(numeric) ? { value: numeric, status: "OK" } : { value: null, status: "UNKNOWN" };
}

export function parseKosisData(body: string): ParsedPage | Outcome {
  let rows: unknown;
  try {
    rows = JSON.parse(body);
  } catch {
    return parseFailure("KOSIS 응답 JSON을 해석하지 못했습니다.");
  }
  if (!Array.isArray(rows)) return parseFailure("KOSIS 응답이 배열이 아닙니다.");
  const records = (rows as Record<string, unknown>[]).map((row): RecordInput => ({
    recordId: [row.ITM_ID, row.C1, row.C2 ?? "", row.C3 ?? "", row.PRD_DE].map((part) => String(part ?? "")).join("|"),
    payload: pick(row, KOSIS_FIELDS),
    dataAsOf: clean(row.PRD_DE),
    sourceUpdatedAt: clean(row.LST_CHN_DE),
    regionCodeType: "KOSIS_REGION",
    regionCode: clean(row.C1),
  }));
  return { records, total: records.length, rowsReceived: records.length };
}

export function classifierFor(provider: Provider): (status: number, contentType: string, body: string, retryAfter: number | null) => Outcome {
  if (provider === "DATA_GO_KR") return classifyDataGoKr;
  if (provider === "ODCLOUD") return (status, _type, body, retryAfter) => classifyOdcloud(status, body, retryAfter);
  return (status, _type, body, retryAfter) => classifyKosis(status, body, retryAfter);
}

export function isOutcome(value: ParsedPage | Outcome): value is Outcome {
  return "kind" in value;
}
