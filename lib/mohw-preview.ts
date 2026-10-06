import { fetchOfficialHtml } from "./official-http.ts";
import type { OfficialDocument, OfficialService } from "./official-source.ts";
import {
  parseSynapPreviewLocation,
  parseSynapTablePage,
  synapPageCount,
} from "./mohw-table.ts";

const PAGE_CONCURRENCY = 3;
const CATEGORY_NAMES = [
  "일상생활돌봄",
  "건강관리예방",
  "보건의료",
  "주거복지",
  "요양",
  "장애지원",
  "기타",
] as const;

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) result[index] = await task(value);
    }
  });
  await Promise.all(workers);
  return result;
}

function previewUrl(document: OfficialDocument): string {
  const [bid, listNo, seq] = document.documentId.split(":");
  if (!bid || !listNo || !seq || !/^\d+$/.test(`${bid}${listNo}${seq}`)) {
    throw new Error(`보건복지부 문서 식별자가 올바르지 않습니다(${document.documentId}).`);
  }
  const query = new URLSearchParams({ bid, list_no: listNo, seq });
  return `https://www.mohw.go.kr/attachPreview.es?${query.toString()}`;
}

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function cleanName(value: string): string {
  return value.replace(/(\d)\s+(?=\d)/g, "$1").replace(/\s+/g, " ").trim();
}

function categoryFor(service: OfficialService): string {
  const value = compact(service.category);
  const exact = CATEGORY_NAMES.find((category) => value.includes(category));
  if (exact) return exact;
  const text = compact(`${service.subcategory} ${service.name} ${service.description}`);
  if (/장애/.test(text)) return "장애지원";
  if (/주거|집수리|환경개선/.test(text)) return "주거복지";
  if (/식사|가사|이동|목욕|생활|돌봄/.test(text)) return "일상생활돌봄";
  if (/방문진료|재택의료|의료|간호|재활|퇴원/.test(text)) return "보건의료";
  if (/건강|예방|복약|치매/.test(text)) return "건강관리예방";
  if (/요양/.test(text)) return "요양";
  return "기타";
}

function typeFor(value: string): string {
  const normalized = compact(value);
  if (normalized.includes("지역특화")) return "지역특화";
  if (normalized.includes("전국")) return "전국";
  if (normalized.includes("광역") || normalized === "경기도") return "광역";
  return normalized || "미분류";
}

function cleanService(service: OfficialService, previous: OfficialService | undefined): OfficialService {
  return {
    ...service,
    name: cleanName(service.name),
    category: categoryFor(service),
    subcategory: compact(service.subcategory) || previous?.subcategory || "기타",
    type: typeFor(service.type),
  };
}

export function officialDocumentFingerprint(document: OfficialDocument): string {
  return [
    document.documentId,
    document.publishedAt,
    document.dataAsOf,
    document.fileName,
    document.downloadUrl,
  ].join("|");
}

export async function collectMohwDocumentServices(
  document: OfficialDocument,
): Promise<readonly OfficialService[]> {
  const preview = await fetchOfficialHtml(previewUrl(document));
  const location = parseSynapPreviewLocation(preview.finalUrl);
  const index = await fetchOfficialHtml(location.indexUrl);
  const pageCount = synapPageCount(index.text);
  const pageNumbers = Array.from({ length: pageCount }, (_, indexValue) => indexValue + 1);
  const pages = await mapConcurrent(pageNumbers, PAGE_CONCURRENCY, async (pageNumber) => {
    const response = await fetchOfficialHtml(location.pageUrl(pageNumber));
    try {
      return parseSynapTablePage(response.text, {
        documentId: document.documentId,
        sido: document.province,
        sigungu: document.municipality,
        detailUrl: document.detailUrl,
        updatedDate: document.dataAsOf || document.publishedAt,
        pageNumber,
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("보건복지부 문서의")) return [];
      throw error;
    }
  });
  const services: OfficialService[] = [];
  for (const service of pages.flat()) services.push(cleanService(service, services.at(-1)));
  if (services.length === 0) throw new Error(`보건복지부 문서에서 사업을 찾지 못했습니다(${document.title}).`);
  return services;
}
