"use client";

import { useId, useState } from "react";
import { DownloadIcon, ExternalLinkIcon, SearchIcon, SortIcon } from "@/components/ui/jeju-icons";
import type { PopulationMetadata, PopulationRegion, StatisticsPoint, StatisticsResult } from "@/lib/statistics/types";

const FOCUS = "outline-none focus-visible:shadow-(--jeju-focus-ring)";
const CONTROL = "min-h-(--jeju-control-h) rounded-(--jeju-radius) border border-border bg-card px-3 py-2 text-(length:--jeju-text-sm) " + FOCUS;
const LINK = "inline-flex items-center gap-1 font-bold text-primary underline underline-offset-4 " + FOCUS;
const COUNT_FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const SHARE_FORMAT = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" });
const TIME_FORMAT = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
const LEVEL_LABELS = { national: "전국", sido: "광역시도", sigungu: "시군구" };
const STATUS_LABELS = { VALUE: "수록값", PROVISIONAL: "잠정치", ESTIMATE: "추정치", MISSING: "자료 없음", CONFIDENTIAL: "비공개" };

type RegionalLevel = "sido" | "sigungu";
type Metric = "population" | "share";
type SortKey = "region" | "population" | "total" | "share";
type SortChoice = { key: SortKey; direction: "asc" | "desc" };
type PopulationRow = {
  id: string;
  region: PopulationRegion;
  parentName: string;
  point: StatisticsPoint | undefined;
  population: number | null;
  total: number | null;
  share: number | null;
};

function normalized(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s/g, ""); }
function numeric(value: number | null | undefined): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function count(value: number | null): string { return value === null ? "자료 없음" : COUNT_FORMAT.format(value); }
function share(value: number | null): string { return value === null ? "산출 불가" : `${SHARE_FORMAT.format(value)}%`; }
function month(value: string): string { const parts = /^(\d{4})-(\d{2})$/.exec(value); return parts ? `${parts[1]}년 ${Number(parts[2])}월` : value || "기준월 미확인"; }
function date(value: string, withTime = false): string { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "확인일 미제공" : (withTime ? TIME_FORMAT : DATE_FORMAT).format(parsed); }
function safeHref(value: string): string | null { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; } catch { return null; } }

function missingLabel(row: PopulationRow): string { return row.point?.status === "CONFIDENTIAL" ? "비공개" : "자료 없음"; }
function metricLabel(row: PopulationRow, metric: Metric): string {
  if (row.population === null) return missingLabel(row);
  return metric === "population" ? `${count(row.population)}명` : share(row.share);
}

function compareRows(left: PopulationRow, right: PopulationRow, choice: SortChoice): number {
  if (choice.key === "region") return (left.region.name.localeCompare(right.region.name, "ko") || left.region.code.localeCompare(right.region.code)) * (choice.direction === "asc" ? 1 : -1);
  const a = left[choice.key], b = right[choice.key];
  if (a === null) return b === null ? left.region.code.localeCompare(right.region.code) : 1;
  if (b === null) return -1;
  return (a - b) * (choice.direction === "asc" ? 1 : -1) || left.region.name.localeCompare(right.region.name, "ko");
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function downloadCsv(result: StatisticsResult, metadata: PopulationMetadata, rows: readonly PopulationRow[], period: string, level: RegionalLevel) {
  const sourceUrls = [...new Set([result.dataset.source_url, ...metadata.source_urls.map(source => source.url)])].join(" | ");
  const columns = ["통계명", "기준월", "자료 기준일", "연령 구분", "최소 연령(세)", "최대 연령(세, 공란은 상한 없음)", "지역 단위", "지역 코드", "지역명", "상위 지역", "해당 연령 인구(명)", "전체 인구(명)", "지역 내 비중(%)", "수치 상태", "인구 범위", "산정 방식", "출처", "원문", "원문 검증 시각"];
  const values = rows.map(row => [
    result.dataset.title, period, metadata.reference_date, metadata.age_label, metadata.age_min, metadata.age_max ?? "",
    LEVEL_LABELS[row.region.level], row.region.code, row.region.name, row.parentName,
    row.population ?? "", row.total ?? "", row.share === null ? "" : row.share.toFixed(6),
    row.point ? STATUS_LABELS[row.point.status] : "자료 없음", metadata.population_scope, metadata.calculation,
    result.dataset.source_name, sourceUrls, result.verified_at,
  ]);
  const csv = "\uFEFF" + [columns, ...values].map(row => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${result.dataset.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${period.replace(/[^a-zA-Z0-9_-]/g, "-")}-${level}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PopulationStatistics({ result }: { result: StatisticsResult }) {
  if (!result.dataset.population) return null;
  return <PopulationStatisticsPanel key={result.dataset.id} result={result} metadata={result.dataset.population} />;
}

function PopulationStatisticsPanel({ result, metadata }: { result: StatisticsResult; metadata: PopulationMetadata }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [levelChoice, setLevelChoice] = useState<RegionalLevel>("sido");
  const [parentCode, setParentCode] = useState("");
  const [metric, setMetric] = useState<Metric>("population");
  const [sort, setSort] = useState<SortChoice>({ key: "population", direction: "desc" });
  const [periodChoice, setPeriodChoice] = useState("");
  const periods = [...new Set(result.dataset.series.flatMap(series => series.points.map(point => point.period)))].sort();
  const period = periods.includes(periodChoice) ? periodChoice : periods.at(-1) ?? "";
  const ageRange = metadata.age_max === null ? `${metadata.age_min}세 이상` : `${metadata.age_min}–${metadata.age_max}세`;
  const regionNames = new Map(result.dataset.series.filter(series => series.region).map(series => [series.region!.code, series.region!.name]));
  const rows = result.dataset.series.flatMap<PopulationRow>(series => {
    if (!series.region) return [];
    const point = series.points.find(point => point.period === period);
    const population = point?.status === "MISSING" || point?.status === "CONFIDENTIAL" ? null : numeric(point?.value);
    const total = numeric(point?.total_population);
    return [{
      id: series.id, region: series.region,
      parentName: series.region.parent_code ? regionNames.get(series.region.parent_code) ?? series.region.parent_code : "",
      point, population, total,
      share: population !== null && total !== null && total > 0 ? population / total * 100 : null,
    }];
  });
  const availableLevels = (["sido", "sigungu"] as const).filter(level => rows.some(row => row.region.level === level));
  const level = availableLevels.includes(levelChoice) ? levelChoice : availableLevels[0] ?? "sido";
  const parents = [...new Map(rows.filter(row => row.region.level === "sigungu" && row.region.parent_code).map(row => [row.region.parent_code!, row.parentName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
  const activeParent = parents.some(([code]) => code === parentCode) ? parentCode : "";
  const regionalRows = rows.filter(row => row.region.level === level);
  const filtered = regionalRows.filter(row => (!activeParent || level !== "sigungu" || row.region.parent_code === activeParent) && normalized(`${row.parentName} ${row.region.name}`).includes(normalized(query)));
  const tableRows = [...filtered].sort((a, b) => compareRows(a, b, sort));
  const compared = [...filtered].sort((a, b) => compareRows(a, b, { key: metric, direction: "desc" }));
  const chartRows = level === "sigungu" ? compared.slice(0, 20) : compared;
  const maxValue = Math.max(0, ...compared.map(row => row[metric] ?? 0));
  const national = rows.find(row => row.region.level === "national");
  const barClass = result.dataset.id === "population:middle-aged" ? "bg-(--jeju-orange)" : result.dataset.id === "population:older" ? "bg-(--jeju-green)" : "bg-(--jeju-blue)";
  const sourceLinks = [...new Map(metadata.source_urls.map(source => [source.url, source])).values()].filter(source => safeHref(source.url));
  const isFiltered = query.trim() !== "" || (level === "sigungu" && activeParent !== "");

  function selectSort(key: SortKey) {
    setSort(previous => ({ key, direction: previous.key === key ? previous.direction === "asc" ? "desc" : "asc" : key === "region" ? "asc" : "desc" }));
  }

  function sortableHeader(key: SortKey, label: string) {
    const active = sort.key === key;
    const nextDirection = active && sort.direction === "asc" ? "내림차순" : active && sort.direction === "desc" ? "오름차순" : key === "region" ? "오름차순" : "내림차순";
    return <th scope="col" aria-sort={active ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className={`px-3 py-3 font-bold ${key === "region" ? "text-left" : "text-right"}`}>
      <button type="button" onClick={() => selectSort(key)} aria-label={`${label}, ${nextDirection}으로 정렬`} className={`inline-flex min-h-(--jeju-control-h-sm) items-center gap-1 rounded-sm ${active ? "text-primary" : "text-(--jeju-text-body)"} ${FOCUS}`}>
        <span>{label}</span><SortIcon className="size-3.5" />
        {active ? <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>;
  }

  return <div className="mt-5 min-w-0 space-y-6">
    <section aria-label="전국 인구 요약" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-(length:--jeju-text-sm)">
          <span className="rounded-full bg-(--jeju-primary-tint) px-3 py-1 font-bold text-primary">{month(period)} 기준</span>
          <span className="font-bold text-(--jeju-text-body)">연령 범위 {ageRange}</span>
        </div>
        {periods.length > 1 ? <div className="flex items-center gap-2"><label htmlFor={`${id}-month`} className="text-(length:--jeju-text-sm) font-bold">기준월</label><select id={`${id}-month`} value={period} onChange={event => setPeriodChoice(event.target.value)} className={CONTROL}>{periods.map(value => <option key={value} value={value}>{month(value)}</option>)}</select></div> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-(--jeju-radius-lg) border border-border bg-(--jeju-surface-inset) p-4 sm:p-5">
          <p className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">해당 연령의 전국 인구</p>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2"><strong className="break-words text-[clamp(1.5rem,2.8vw,2.1rem)] font-extrabold tabular-nums leading-tight tracking-tight text-(--jeju-text-strong)">{national ? national.population === null ? missingLabel(national) : count(national.population) : "자료 없음"}</strong>{national?.population !== null && national?.population !== undefined ? <span className="text-(length:--jeju-text-sm) text-muted-foreground">명</span> : null}</p>
          <p className="mt-3 break-keep text-(length:--jeju-text-sm) text-muted-foreground">{metadata.age_label}{national?.point?.status === "PROVISIONAL" ? " · 잠정치" : ""}</p>
        </div>
        <div className="min-w-0 rounded-(--jeju-radius-lg) border border-border bg-(--jeju-surface-inset) p-4 sm:p-5">
          <p className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">전국 전체 인구에서 차지하는 비중</p>
          <p className="mt-3 text-[clamp(1.5rem,2.8vw,2.1rem)] font-extrabold tabular-nums leading-tight tracking-tight text-(--jeju-text-strong)">{national ? national.population === null ? missingLabel(national) : share(national.share) : "자료 없음"}</p>
          <p className="mt-3 text-(length:--jeju-text-sm) text-muted-foreground">전국 전체 인구 {national?.total === null || national?.total === undefined ? "자료 없음" : `${count(national.total)}명`}</p>
        </div>
      </div>
      <p className="text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">전국 요약은 원문의 전국 집계값입니다. 광역시도와 시군구 수치를 더해 중복 집계하지 않습니다.</p>
    </section>

    <section aria-labelledby={`${id}-comparison`} className="min-w-0 space-y-4 border-t border-border pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h4 id={`${id}-comparison`} className="font-extrabold text-(--jeju-text-strong)">지역별 인구 비교</h4><p className="mt-1 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">같은 기준월·연령의 인구수와 각 지역 전체 인구 대비 비중을 비교합니다.</p></div>
        <fieldset className="min-w-0"><legend className="sr-only">지역 비교 기준</legend><div className="flex flex-wrap gap-1 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-1">{([ ["population", "인구수"], ["share", "지역 내 비중"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={metric === value} onClick={() => setMetric(value)} className={`min-h-(--jeju-control-h-sm) rounded-(--jeju-radius-sm) border px-3 py-1.5 text-(length:--jeju-text-sm) font-bold ${metric === value ? "border-primary bg-card text-primary" : "border-transparent text-muted-foreground hover:bg-card"} ${FOCUS}`}>{label}</button>)}</div></fieldset>
      </div>

      <div className="flex flex-col gap-3 rounded-(--jeju-radius-lg) border border-border bg-(--jeju-surface-inset) p-3 sm:flex-row sm:flex-wrap sm:items-end">
        {availableLevels.length > 1 ? <div className="min-w-0"><label htmlFor={`${id}-level`} className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">지역 단위</label><select id={`${id}-level`} value={level} onChange={event => { setLevelChoice(event.target.value as RegionalLevel); setParentCode(""); }} className={`${CONTROL} w-full`}>{availableLevels.map(value => <option key={value} value={value}>{LEVEL_LABELS[value]}</option>)}</select></div> : null}
        {level === "sigungu" && parents.length ? <div className="min-w-0 sm:max-w-56"><label htmlFor={`${id}-parent`} className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">광역시도</label><select id={`${id}-parent`} value={activeParent} onChange={event => setParentCode(event.target.value)} className={`${CONTROL} w-full`}><option value="">전체 광역시도</option>{parents.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div> : null}
        <div className="min-w-0 flex-1"><label htmlFor={`${id}-search`} className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">지역명 검색</label><div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input id={`${id}-search`} type="search" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder={level === "sido" ? "예: 제주, 서울" : "예: 제주, 서귀포"} className={`${CONTROL} w-full pl-10`} /></div></div>
        {isFiltered ? <button type="button" onClick={() => { setQuery(""); setParentCode(""); }} className={`${CONTROL} font-bold text-muted-foreground hover:border-primary`}>지역 조건 초기화</button> : null}
      </div>

      <p role="status" aria-live="polite" className="text-(length:--jeju-text-sm) text-muted-foreground">{LEVEL_LABELS[level]} {filtered.length}개 표시{isFiltered ? ` / 전체 ${regionalRows.length}개` : " · 전체 지역"}</p>

      {chartRows.length ? <figure className="min-w-0" aria-labelledby={`${id}-comparison`} aria-describedby={`${id}-chart-note`}>
        <div className="mb-3 flex flex-wrap justify-between gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><span>{metric === "population" ? "인구수가 많은 순" : "비중이 높은 순"}</span><span>단위: {metric === "population" ? "명" : "%"}</span></div>
        <ol className="space-y-3.5" aria-label={`${LEVEL_LABELS[level]}별 ${metric === "population" ? "인구수" : "인구 비중"} 비교`}>
          {chartRows.map(row => {
            const value = row[metric];
            const width = value !== null && maxValue > 0 ? Math.max(0, Math.min(100, value / maxValue * 100)) : 0;
            return <li key={row.id} className="min-w-0">
              <div className="mb-1.5 flex min-w-0 items-start justify-between gap-3 text-(length:--jeju-text-sm)"><span className="min-w-0 break-keep font-bold text-(--jeju-text-body) [overflow-wrap:anywhere]">{row.region.name}{level === "sigungu" && row.parentName ? <span className="ml-1.5 font-normal text-muted-foreground">{row.parentName}</span> : null}</span><span className={`shrink-0 text-right tabular-nums ${value === null ? "text-muted-foreground" : "font-bold text-(--jeju-text-strong)"}`}>{metricLabel(row, metric)}{row.point?.status === "PROVISIONAL" ? <span className="ml-1 font-normal text-muted-foreground">잠정</span> : null}</span></div>
              <div aria-hidden="true" className="h-2.5 overflow-hidden rounded-full border border-border bg-(--jeju-surface-inset)"><div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} /></div>
            </li>;
          })}
        </ol>
        <figcaption id={`${id}-chart-note`} className="mt-4 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
          {chartRows.length < compared.length ? `막대는 검색된 ${compared.length}개 시군구 중 상위 ${chartRows.length}개를 표시합니다. 아래 표와 CSV에는 검색 결과 전체가 포함됩니다. ` : `${filtered.length}개 지역을 모두 표시합니다. `}
          막대 길이는 비교 지역의 최대값을 기준으로 합니다. 비중은 해당 연령 인구 ÷ 해당 지역 전체 인구 × 100입니다.
        </figcaption>
      </figure> : <div className="rounded-(--jeju-radius-lg) border border-dashed border-border p-6 text-center"><p className="font-bold text-(--jeju-text-body)">{regionalRows.length ? "검색 조건에 맞는 지역이 없습니다." : "이 기준월에 연결된 지역 자료가 없습니다."}</p>{isFiltered ? <button type="button" onClick={() => { setQuery(""); setParentCode(""); }} className={`${LINK} mt-3`}>전체 지역 보기</button> : null}</div>}
    </section>

    <section aria-labelledby={`${id}-table-heading`} className="min-w-0 space-y-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 id={`${id}-table-heading`} className="font-extrabold text-(--jeju-text-strong)">지역별 상세 수치</h4><button type="button" disabled={!tableRows.length} onClick={() => downloadCsv(result, metadata, tableRows, period, level)} className={`${CONTROL} inline-flex items-center justify-center gap-2 font-bold text-primary disabled:cursor-not-allowed disabled:opacity-50`}><DownloadIcon />현재 결과 {tableRows.length}개 CSV</button></div>
      <p className="text-(length:--jeju-text-sm) text-muted-foreground">열 제목을 누르면 정렬 순서를 바꿀 수 있습니다. 인구수는 명 단위 전체 수치를 표시합니다.</p>
      <div role="region" aria-label="지역별 인구 상세표, 좁은 화면에서는 가로로 이동" tabIndex={0} className={`min-w-0 overflow-x-auto rounded-(--jeju-radius) border border-border ${FOCUS}`}>
        <table className="w-full min-w-[38rem] border-collapse text-(length:--jeju-text-sm)">
          <caption className="sr-only">{month(period)} {metadata.age_label} {ageRange}, {LEVEL_LABELS[level]} {tableRows.length}개 지역 전체 검색 결과</caption>
          <thead className="border-b border-border bg-(--jeju-surface-inset)"><tr>{sortableHeader("region", "지역")}{sortableHeader("population", "해당 연령 인구(명)")}{sortableHeader("total", "전체 인구(명)")}{sortableHeader("share", "지역 내 비중")}</tr></thead>
          <tbody>{tableRows.length ? tableRows.map(row => <tr key={row.id} className="border-b border-border last:border-b-0 hover:bg-(--jeju-row-hover)">
            <th scope="row" className="max-w-64 px-3 py-3 text-left font-bold text-(--jeju-text-body)"><span className="block break-keep [overflow-wrap:anywhere]">{row.region.name}</span>{level === "sigungu" && row.parentName ? <span className="mt-1 block font-normal text-muted-foreground">{row.parentName}</span> : null}</th>
            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{row.population === null ? missingLabel(row) : count(row.population)}{row.point?.status === "PROVISIONAL" ? <span className="mt-1 block text-(length:--jeju-text-xs) text-muted-foreground">잠정치</span> : null}</td>
            <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{count(row.total)}</td>
            <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums">{row.population === null ? missingLabel(row) : share(row.share)}</td>
          </tr>) : <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">표시할 지역이 없습니다.</td></tr>}</tbody>
        </table>
      </div>
      <p className="text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">자료 없음·비공개 수치는 0으로 표시하지 않습니다. 전체 인구가 없거나 0이면 비중을 산출하지 않습니다. 비중은 소수 둘째 자리까지 표시하며, CSV에는 여섯째 자리까지 저장합니다.</p>
    </section>

    <section aria-labelledby={`${id}-method-heading`} className="space-y-4 border-t border-border pt-5">
      <h4 id={`${id}-method-heading`} className="font-extrabold text-(--jeju-text-strong)">자료 기준과 산정 방식</h4>
      <dl className="grid gap-4 text-(length:--jeju-text-sm) leading-relaxed sm:grid-cols-2">
        <div><dt className="font-bold text-muted-foreground">자료 기준일</dt><dd className="mt-1 text-(--jeju-text-body)">{date(metadata.reference_date)}</dd></div>
        <div><dt className="font-bold text-muted-foreground">연령 범위</dt><dd className="mt-1 text-(--jeju-text-body)">{ageRange} · {metadata.age_label}</dd></div>
        <div className="sm:col-span-2"><dt className="font-bold text-muted-foreground">인구 범위</dt><dd className="mt-1 break-keep text-(--jeju-text-body) [overflow-wrap:anywhere]">{metadata.population_scope}</dd></div>
        <div className="sm:col-span-2"><dt className="font-bold text-muted-foreground">산정 방식</dt><dd className="mt-1 break-keep text-(--jeju-text-body) [overflow-wrap:anywhere]">{metadata.calculation}</dd></div>
        <div className="sm:col-span-2"><dt className="font-bold text-muted-foreground">원문 검증 시각</dt><dd className="mt-1 text-(--jeju-text-body)">{date(result.verified_at, true)} (한국시간)<p className="mt-1 text-muted-foreground">원문을 확인한 시각이며, 인구의 자료 기준일과는 다릅니다.</p></dd></div>
      </dl>
      {result.dataset.source_notes ? <div className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm) leading-relaxed"><p className="font-bold text-(--jeju-text-body)">제공 범위와 갱신</p><p className="mt-1 break-keep text-muted-foreground [overflow-wrap:anywhere]">{result.dataset.source_notes}</p></div> : null}
      {sourceLinks.length ? <div><p className="mb-2 text-(length:--jeju-text-sm) font-bold text-muted-foreground">공식 원문</p><ul className="space-y-2 text-(length:--jeju-text-sm)">{sourceLinks.map(source => <li key={source.url}><a href={safeHref(source.url)!} target="_blank" rel="noopener noreferrer" className={`${LINK} max-w-full break-keep [overflow-wrap:anywhere]`}>{source.title}<ExternalLinkIcon /><span className="sr-only"> (새 창)</span></a></li>)}</ul></div> : null}
    </section>
  </div>;
}
