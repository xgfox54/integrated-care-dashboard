export const MOHW_BASE_URL = "https://www.mohw.go.kr";
export const MOHW_INTEGRATED_CARE_URL = `${MOHW_BASE_URL}/menu.es?mid=a60600000000`;

export const PUBLIC_API_SEARCH_TERMS = [
  "통합돌봄",
  "의료요양돌봄",
  "방문진료",
  "재택의료",
  "퇴원환자",
  "방문간호",
  "방문요양",
  "병원동행",
  "식사지원",
  "가사지원",
  "이동지원",
  "주거환경개선",
  "긴급돌봄",
  "노인맞춤돌봄",
  "복약관리",
] as const;

export const MOHW_PROVINCES = [
  ["서울특별시", "a60601000000"],
  ["부산광역시", "a60602000000"],
  ["대구광역시", "a60603000000"],
  ["인천광역시", "a60604000000"],
  ["광주광역시", "a60605000000"],
  ["대전광역시", "a60606000000"],
  ["울산광역시", "a60607000000"],
  ["세종특별자치시", "a60608000000"],
  ["강원특별자치도", "a60609000000"],
  ["제주특별자치도", "a60610000000"],
  ["경기도", "a60611000000"],
  ["충청북도", "a60612000000"],
  ["충청남도", "a60613000000"],
  ["전북특별자치도", "a60614000000"],
  ["전라남도", "a60615000000"],
  ["경상북도", "a60616000000"],
  ["경상남도", "a60617000000"],
] as const;

export interface OfficialDocument {
  documentId: string;
  province: string;
  municipality: string;
  title: string;
  publishedAt: string;
  dataAsOf: string;
  detailUrl: string;
  downloadUrl: string;
  fileName: string;
}

export interface ParsedBoardPage {
  totalCount: number;
  documents: OfficialDocument[];
}

export interface PublicWelfareRecord {
  servId: string;
  servNm: string;
  jurOrgNm: string;
  servDgst: string;
  sidoNm: string;
  sggNm: string;
  sprtTrgt: string;
  aplyMthd: string;
  servDtlLink: string;
  lastModYmd: string;
}

export interface OfficialService {
  serviceId: string;
  sido: string;
  sigungu: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  target: string;
  detailTarget: string;
  applicationMethod?: string;
  provider: string;
  type: string;
  serial: string;
  detailUrl: string;
  updatedDate: string;
}

export function boundedPageCount(totalCount: number, pageSize: number, maximum = Infinity): number {
  const count = Math.max(1, Math.ceil(Math.max(0, totalCount) / pageSize));
  if (count > maximum) {
    throw new Error(`수집 결과가 안전 수집 한도(${maximum}쪽)를 넘었습니다.`);
  }
  return count;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absoluteMohwUrl(value: string): string {
  return value ? new URL(decodeHtml(value), MOHW_BASE_URL).toString() : "";
}

export function dataAsOfFromTitle(title: string): string {
  const fourDigit = title.match(/(20\d{2})\s*년\s*(1[0-2]|0?[1-9])\s*월\s*기준/);
  if (fourDigit) return `${fourDigit[1]}-${String(Number(fourDigit[2])).padStart(2, "0")}`;
  const twoDigit = title.match(/(?:^|\D)(\d{2})\s*년\s*(1[0-2]|0?[1-9])\s*월\s*기준/);
  if (twoDigit) return `20${twoDigit[1]}-${String(Number(twoDigit[2])).padStart(2, "0")}`;
  return "";
}

export function municipalityFromTitle(title: string, province: string): string {
  if (province === "제주특별자치도") {
    // 광역 메뉴판의 기존 원본 식별값은 유지한다. 단, 행정시가 제목에 명시되면 그 지역을
    // 보존하여 제주시 자료가 서귀포시에도 적용되는 광역 자료로 들어가지 않게 한다.
    const cities = [...new Set([...title.matchAll(/(?:^|[^가-힣])(서귀포시|제주시)(?=$|[^가-힣])/g)].map((match) => match[1]))];
    return cities.length === 1 ? cities[0] : province;
  }
  if (province === "세종특별자치시") return province;
  const exactRest = title.replace(province, "").trim();
  const exact = exactRest.match(/^([가-힣·]+(?:시|군|구))/)?.[1];
  if (exact) return exact;
  return [...title.matchAll(/([가-힣·]+(?:시|군|구))/g)]
    .map((match) => match[1] ?? "")
    .find((name) => name && name !== province) ?? "";
}

export function parseMohwBoardPage(
  html: string,
  province: string,
  boardUrl: string,
): ParsedBoardPage {
  const totalMatch = html.match(/총\s*게시물\s*<b[^>]*>([\d,]+)<\/b>/i);
  const totalCount = Number((totalMatch?.[1] ?? "0").replaceAll(",", ""));
  const documents: OfficialDocument[] = [];

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1] ?? "";
    const listNo = row.match(/[?&](?:amp;)?list_no=(\d+)/i)?.[1] ?? "";
    const titleHtml = row.match(/class=["']txt_title["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
    const title = plainText(titleHtml);
    if (!listNo || !title) continue;

    const publishedAt = plainText(
      row.match(/<td[^>]*data-label=["']등록일["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "",
    ).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
    const detailHref = row.match(/href=["']([^"']*act=view[^"']*list_no=\d+[^"']*)["']/i)?.[1] ?? "";
    const downloadHref = row.match(/href=["']([^"']*boardDownload\.es[^"']*)["']/i)?.[1] ?? "";
    const fileName = plainText(
      row.match(/class=["']file-name["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "",
    );
    const decodedDownloadHref = decodeHtml(downloadHref);
    const bid =
      new URL(boardUrl).searchParams.get("bid") ??
      decodedDownloadHref.match(/[?&]bid=(\d+)/)?.[1] ??
      "";
    const seq = decodedDownloadHref.match(/[?&]seq=(\d+)/)?.[1] ?? "1";

    documents.push({
      documentId: `${bid}:${listNo}:${seq}`,
      province,
      municipality: municipalityFromTitle(title, province),
      title,
      publishedAt,
      dataAsOf: dataAsOfFromTitle(title),
      detailUrl: absoluteMohwUrl(detailHref),
      downloadUrl: absoluteMohwUrl(downloadHref),
      fileName,
    });
  }

  return { totalCount: Number.isFinite(totalCount) ? totalCount : 0, documents };
}

const RELEVANCE_PATTERN =
  /통합돌봄|통합지원|의료요양돌봄|돌봄|재가|방문진료|재택의료|퇴원환자|방문간호|방문요양|병원동행|식사지원|가사지원|이동지원|주거환경개선|긴급돌봄|노인맞춤돌봄|복약관리/;

export function isIntegratedCareRecord(record: PublicWelfareRecord): boolean {
  return RELEVANCE_PATTERN.test(
    [record.servNm, record.servDgst, record.sprtTrgt, record.aplyMthd].join(" "),
  );
}

function classify(record: PublicWelfareRecord): { category: string; subcategory: string } {
  const text = [record.servNm, record.servDgst].join(" ");
  if (/방문진료|재택의료|방문간호|건강|의료|재활|복약|퇴원/.test(text)) {
    return { category: "보건의료", subcategory: /복약/.test(text) ? "복약관리" : "방문의료·건강" };
  }
  if (/주거|집수리|환경개선/.test(text)) {
    return { category: "주거지원", subcategory: "주거환경" };
  }
  if (/식사|도시락|영양/.test(text)) {
    return { category: "일상생활", subcategory: "식사지원" };
  }
  if (/가사|목욕|동행|이동/.test(text)) {
    return { category: "일상생활", subcategory: /동행|이동/.test(text) ? "이동지원" : "가사지원" };
  }
  if (/긴급|응급|안전/.test(text)) {
    return { category: "안전지원", subcategory: "긴급·안전" };
  }
  return { category: "요양·돌봄", subcategory: /치매/.test(text) ? "치매돌봄" : "돌봄서비스" };
}

export function toOfficialService(record: PublicWelfareRecord): OfficialService {
  const classification = classify(record);
  const fallbackId = [record.sidoNm, record.sggNm, record.servNm, record.jurOrgNm].join("|");
  return {
    serviceId: record.servId || fallbackId,
    sido: record.sidoNm,
    sigungu: record.sggNm,
    category: classification.category,
    subcategory: classification.subcategory,
    name: record.servNm,
    description: record.servDgst,
    target: record.sprtTrgt,
    detailTarget: "",
    applicationMethod: record.aplyMthd,
    provider: record.jurOrgNm,
    type: "공공 API",
    serial: record.servId,
    detailUrl: record.servDtlLink,
    updatedDate: record.lastModYmd,
  };
}
