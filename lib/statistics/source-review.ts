import type { StatisticsDataset, StatisticsResult, StatisticsSourceReview } from "./types.ts";

const REVIEW_REVISION = "statistics-source-review-20261014-v1";
const BIRTH_REFERENCE = {
  title: "2025년 출생 통계(확정)", publisher: "국가데이터처",
  url: "https://mods.go.kr/boardDownload.es?bid=204&list_no=446625&seq=1",
  reference_year: 2025, published_at: "2026-08-26", checked_at: "2026-10-14",
  content_sha256: "338497ce3794ce740a54645a1e740519581713a0f7cc45d90e1b16cd93d39f6c",
  location: "표지 보도시점 및 일러두기 확정치; 본문4쪽 표1 및 통계표32쪽 전국 출생아수254,341명·합계출산율0.80명",
} as const;
const CORRECTED_BIRTH_SOURCE = "국가데이터처, 『2025년 출생 통계(확정), 국가승인통계 제101003호 출생통계』";

function latestObservedYear(dataset: StatisticsDataset): number | null {
  if (dataset.index_api?.projection) return null;
  const years = dataset.series.flatMap(series => series.points.filter(point =>
    point.value !== null && (point.status === "VALUE" || point.status === "PROVISIONAL")
    && /^\d{4}$/.test(point.period)).map(point => Number(point.period)));
  return years.length ? Math.max(...years) : null;
}
function matchesBirthReference(dataset: StatisticsDataset, year: number): boolean {
  if (dataset.id !== "stat:1428" || dataset.table_code !== "142801" || year !== 2025) return false;
  const births = dataset.series.find(series => series.source_label === "출생아 수");
  const fertility = dataset.series.find(series => series.source_label === "합계 출산율");
  const birthPoint = births?.points.find(point => point.period === "2025");
  const fertilityPoint = fertility?.points.find(point => point.period === "2025");
  return births?.unit === "천명" && fertility?.unit === "가임여성 1명당 명"
    && birthPoint?.value === 254.341 && birthPoint.status === "VALUE"
    && fertilityPoint?.value === 0.8 && fertilityPoint.status === "VALUE";
}

/** Retain upstream metadata; apply a reviewed publication only to its verified values and year. */
export function reviewStatisticsSource(result: StatisticsResult): StatisticsResult {
  const dataset = result.dataset;
  const original = dataset.source_review?.display_source_name === dataset.source_name
    ? dataset.source_review.original_source_name : dataset.source_name;
  const { source_review: previous, ...raw } = dataset;
  const restored = { ...raw, source_name: original };
  const year = latestObservedYear(restored);
  const years = [...new Set([...original.matchAll(/((?:19|20)\d{2})년/g)].map(match => Number(match[1])))];
  const mismatch = year !== null && years.length > 0 && Math.max(...years) < year;
  const verified = year !== null && matchesBirthReference(restored, year);
  const warnings = result.warnings.filter(warning => warning !== previous?.warning);
  if (year === null || (!mismatch && !verified)) return { ...result, dataset: restored, warnings };
  const warning = mismatch ? (verified
    ? "지표누리 원문 출처명의2024년과 최신 관측연도2025년이 다릅니다. 같은 수치·단위를 확인한 국가데이터처2025년 확정통계로 표시명을 보완했으며 original_source_name에 원래 출처명을 보존합니다. 공표일2026-08-26과 지표누리 갱신일은 별개입니다."
    : "원문 출처명의 기준연도와 최신 관측연도가 다릅니다. 해당 연도의 원천자료·공표일·확정 여부를 추가 확인하세요. 확인되지 않은 출처명이나 공표일을 추정하여 바꾸지 않았습니다.") : null;
  const sourceReview: StatisticsSourceReview = {
    revision: REVIEW_REVISION, status: mismatch ? verified ? "SOURCE_YEAR_CORRECTED" : "SOURCE_YEAR_MISMATCH" : "VERIFIED_ADDITIONAL_SOURCE",
    original_source_name: original, display_source_name: mismatch && verified ? CORRECTED_BIRTH_SOURCE : original,
    source_years: years, latest_observed_year: year, warning,
    ...(verified ? { reference: BIRTH_REFERENCE } : {}),
  };
  return { ...result, dataset: { ...restored, source_name: sourceReview.display_source_name, source_review: sourceReview },
    warnings: [...new Set([...warnings, ...(warning ? [warning] : [])])] };
}
