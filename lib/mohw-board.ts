import { fetchOfficialHtml } from "./official-http.ts";
import {
  MOHW_BASE_URL,
  MOHW_PROVINCES,
  boundedPageCount,
  parseMohwBoardPage,
  type OfficialDocument,
} from "./official-source.ts";

const FETCH_CONCURRENCY = 2;

export async function collectProvinceDocuments(province: string, mid: string): Promise<readonly OfficialDocument[]> {
  const menuUrl = `${MOHW_BASE_URL}/menu.es?mid=${mid}`;
  const first = await fetchOfficialHtml(menuUrl);
  const firstPage = parseMohwBoardPage(first.text, province, first.finalUrl);
  const pageCount = boundedPageCount(firstPage.totalCount, 10);
  const documents = [...firstPage.documents];
  for (let page = 2; page <= pageCount; page += 1) {
    const pageUrl = new URL(first.finalUrl);
    pageUrl.searchParams.set("nPage", String(page));
    const response = await fetchOfficialHtml(pageUrl.toString());
    documents.push(...parseMohwBoardPage(response.text, province, response.finalUrl).documents);
  }
  return documents;
}

export async function collectMohwDocuments(): Promise<readonly OfficialDocument[]> {
  const groups = new Array<readonly OfficialDocument[]>(MOHW_PROVINCES.length);
  let cursor = 0;
  const workers = Array.from({ length: FETCH_CONCURRENCY }, async () => {
    while (cursor < MOHW_PROVINCES.length) {
      const index = cursor;
      cursor += 1;
      const entry = MOHW_PROVINCES[index];
      if (entry) groups[index] = await collectProvinceDocuments(entry[0], entry[1]);
    }
  });
  await Promise.all(workers);
  const unique = new Map(groups.flat().map((document) => [document.documentId, document]));
  if (unique.size < MOHW_PROVINCES.length) {
    throw new Error(`보건복지부 원문 목록이 불완전합니다(${unique.size}건).`);
  }
  return [...unique.values()];
}
