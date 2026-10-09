import type { FilterState } from "./dataset";
import type { BundleRequest } from "./dataset-bundle-request";
import {
  cachedDatasetJson,
  type DatasetJson,
  listFreshKeys,
  pruneStaleEntries,
  wikiEditsVersion,
  writeStoredEntries,
} from "./dataset-cache";
import { DEFAULT_SEARCH_PAGE_SIZE, normalizeSearchPageSize } from "./dataset-summary";
import { memoizeForTtl } from "./memo";
import {
  readLatestRun,
  readOfficialDatasetSummary,
  searchOfficialServices,
  searchRegionTargets,
} from "./official-query";
import {
  bundlePerPart,
  bundleQueryString,
  districtTargets,
  planRegionBundles,
  provinceTargets,
  sigunguBundleTargets,
} from "./region-load-order";
import { searchQueryString } from "./search-query";
import { searchResponseBody } from "./search-response";
import { cachedWikiEdits } from "./wiki-edit-store";
import { logServerError } from "./errors";
import { getD1 } from "./d1";
import { failureCode, recordOptionalIndex } from "./optional-index";

export type SummaryDataset = Awaited<ReturnType<typeof readOfficialDatasetSummary>>;

/** 대시보드 요약(수록 사업·지역·분야 집계). */
export async function readSummaryDataset(): Promise<SummaryDataset> {
  const { body } = await cachedDatasetJson("summary", async () => JSON.stringify(await readOfficialDatasetSummary()));
  return JSON.parse(body) as SummaryDataset;
}

// 보관 여부 판단·묶음 지역 목록용. 지역·분야 목록은 수집 때만 바뀌므로 1분 동안 기억한다.
const recentSummary = memoizeForTtl(readSummaryDataset, 60_000);

/** 요약에 실제로 있는 지역·분야 값인지. 없는 값으로 보관본이 무한히 늘지 않게 막는다. */
function isKnownSelection(summary: SummaryDataset, sido: string, sigungu: string, category: string): boolean {
  const { sigunguBySido, categories } = summary.summary;
  if (category && !categories.includes(category)) return false;
  if (!sido) return !sigungu;
  const districts = sigunguBySido[sido];
  if (!districts) return false;
  return !sigungu || districts.includes(sigungu);
}

/** 검색어 없는 첫 쪽 가운데 실제 지역·분야 조합만 보관한다(지역·분야를 고를 때 보는 화면). */
async function isStorableSearch(filters: FilterState, page: number): Promise<boolean> {
  if (page !== 1 || filters.keyword || filters.subcategory || filters.type || filters.targetGroup) return false;
  return isKnownSelection(await recentSummary(), filters.sido, filters.sigungu, filters.category);
}

/** 검색 API 응답 본문(JSON 문자열). */
export async function searchBodyJson(filters: FilterState, page: number, requestedSize: number): Promise<DatasetJson> {
  const pageSize = normalizeSearchPageSize(requestedSize);
  const compute = async () => JSON.stringify(searchResponseBody(await searchOfficialServices(filters, page, pageSize)));
  if (!(await isStorableSearch(filters, page))) return { body: await compute(), stored: false };
  return cachedDatasetJson("search?" + searchQueryString(filters, 1, pageSize), compute);
}

interface BundleBody {
  readonly entries: readonly { readonly query: string; readonly body: ReturnType<typeof searchResponseBody> }[];
}

async function computeBundle(
  request: BundleRequest,
  sigunguBySido: Readonly<Record<string, readonly string[]>>,
): Promise<BundleBody> {
  const targets = request.scope === "sido"
    ? provinceTargets(sigunguBySido)
    : sigunguBundleTargets(sigunguBySido, request.part, request.per);
  const results = await searchRegionTargets(request.scope, targets, request.category, request.pageSize);
  return {
    entries: targets.map((target, index) => ({
      query: searchQueryString({ ...target, category: request.category, keyword: "" }, 1, request.pageSize),
      body: searchResponseBody(results[index]),
    })),
  };
}

function bundleKey(request: BundleRequest): string {
  return "bundle?" + bundleQueryString(request, request.pageSize, request.category);
}

/** 화면이 실제로 요청하는 묶음(정해진 크기·범위·분야)만 보관한다. */
function isStorableBundle(request: BundleRequest, summary: SummaryDataset): boolean {
  if (!isKnownSelection(summary, "", "", request.category)) return false;
  if (request.scope === "sido") return true;
  const districts = districtTargets(summary.summary.sigunguBySido).length;
  return request.per === bundlePerPart(request.pageSize) && request.part * request.per < districts;
}

/** 지역 묶음 API 응답 본문(JSON 문자열). 각 항목은 같은 지역의 검색 API 응답과 같다. */
export async function bundleBodyJson(request: BundleRequest): Promise<DatasetJson> {
  const summary = await recentSummary();
  const compute = async () => JSON.stringify(await computeBundle(request, summary.summary.sigunguBySido));
  if (!isStorableBundle(request, summary)) return { body: await compute(), stored: false };
  return cachedDatasetJson(bundleKey(request), compute);
}

/**
 * 새 자료 수집 직후와 매시 정각에 부른다. 요약, 기본 쪽 크기의 광역·시·군·구 묶음,
 * 지역별 첫 쪽 검색 결과를 미리 계산해 D1에 보관하고 지난 보관본을 지운다.
 * 이미 최신 보관본이 있으면 건너뛰므로 여러 번 불러도 된다.
 */
export async function warmDatasetCache(): Promise<void> {
  // 선택 인덱스: 실패해도 다음 작업(보도자료·재정·공개본)을 멈추지 않고 상태에 실패를 남긴다(T33).
  const now = () => Math.floor(Date.now() / 1000);
  try {
    const runId = await warmDatasetCacheOnce();
    if (runId) await recordOptionalIndex(getD1(), "dataset_response_cache", { ok: true, runId }, now());
  } catch (error) {
    logServerError(error, { path: "dataset-cache/warm", status: 500 });
    await recordOptionalIndex(getD1(), "dataset_response_cache", { ok: false, code: failureCode(error) }, now()).catch(() => undefined);
  }
}

async function warmDatasetCacheOnce(): Promise<string | null> {
  const run = await readLatestRun(true);
  if (!run) return null;
  const version = wikiEditsVersion(await cachedWikiEdits());
  const fresh = await listFreshKeys(run.id, version);
  const summary = await readOfficialDatasetSummary();
  if (!fresh.has("summary")) {
    await writeStoredEntries([{ key: "summary", body: JSON.stringify(summary) }], run.id, version);
  }
  const pageSize = DEFAULT_SEARCH_PAGE_SIZE;
  const { bundles } = planRegionBundles(summary.summary.sigunguBySido, null, pageSize);
  for (const bundle of bundles) {
    const request: BundleRequest = { scope: bundle.scope, part: bundle.part, per: bundle.per, pageSize, category: "" };
    const key = bundleKey(request);
    if (fresh.has(key)) continue;
    const body = await computeBundle(request, summary.summary.sigunguBySido);
    await writeStoredEntries(
      [
        { key, body: JSON.stringify(body) },
        ...body.entries.map((entry) => ({ key: "search?" + entry.query, body: JSON.stringify(entry.body) })),
      ],
      run.id,
      version,
    );
  }
  await pruneStaleEntries(run.id, version);
  return run.id;
}
