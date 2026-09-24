import {
  PUBLIC_API_SEARCH_TERMS,
  type OfficialService,
  boundedPageCount,
  isIntegratedCareRecord,
  toOfficialService,
} from "./official-source";
export { collectMohwDocuments } from "./mohw-board.ts";
import { callWelfareList } from "./welfare-api";

const API_PAGE_SIZE = 100;
const API_MAX_PAGES_PER_TERM = 100;
const PUBLIC_API_CONCURRENCY = 3;

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await task(values[index]);
    }
  });
  await Promise.all(workers);
  return result;
}

async function collectTerm(term: string): Promise<OfficialService[]> {
  const first = await callWelfareList({ keyword: term, pageNo: 1, numOfRows: API_PAGE_SIZE });
  if (!first.ok) {
    throw new Error(`공공 API '${term}' 수집 실패: ${first.resultCode || first.httpStatus} ${first.resultMsg}`);
  }
  let pageCount = 1;
  try {
    pageCount = boundedPageCount(first.totalCount, API_PAGE_SIZE, API_MAX_PAGES_PER_TERM);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new Error(`공공 API '${term}' 결과가 안전 수집 한도(${API_MAX_PAGES_PER_TERM}쪽)를 넘었습니다.`);
  }
  const records = [...first.items];
  for (let page = 2; page <= pageCount; page += 1) {
    const result = await callWelfareList({ keyword: term, pageNo: page, numOfRows: API_PAGE_SIZE });
    if (!result.ok) {
      throw new Error(`공공 API '${term}' ${page}쪽 수집 실패: ${result.resultCode || result.httpStatus} ${result.resultMsg}`);
    }
    records.push(...result.items);
  }
  return records.filter(isIntegratedCareRecord).map(toOfficialService);
}

export async function collectPublicApiServices(): Promise<OfficialService[]> {
  const groups = await mapConcurrent(PUBLIC_API_SEARCH_TERMS, PUBLIC_API_CONCURRENCY, collectTerm);
  const unique = new Map<string, OfficialService>();
  for (const service of groups.flat()) {
    if (!service.name || !service.serviceId) continue;
    unique.set(service.serviceId, service);
  }
  if (unique.size === 0) throw new Error("공공 API에서 통합돌봄 사업을 찾지 못했습니다.");
  return [...unique.values()];
}
