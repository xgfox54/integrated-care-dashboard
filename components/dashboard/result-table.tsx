"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResultCards } from "@/components/dashboard/result-cards";
import { ZeroResultHelp } from "@/components/search/zero-result-help";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWelfareMatchCount, welfareSearchHref } from "@/lib/cross-search";
import { serviceWikiHref, type ServiceRow } from "@/lib/dataset";
import type { SearchHelp, SearchSort } from "@/lib/search-terms";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
const SORT_LABELS: Record<SearchSort, string> = { relevance: "관련도순", region: "지역순", name: "사업명순" };
const LINK_CLASS =
  "font-bold text-primary underline decoration-(--jeju-blue-light-strong) underline-offset-4 hover:decoration-primary focus-visible:rounded-(--jeju-radius-xs) focus-visible:shadow-(--jeju-focus-ring) focus-visible:outline-none";

function PageControls({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (next: number) => void;
}) {
  if (pageCount <= 1) return null;

  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  const pages: number[] = [];
  for (let value = Math.max(1, start); value <= end; value += 1) pages.push(value);

  return (
    <nav aria-label="검색결과 페이지" className="mt-4 flex flex-wrap items-center justify-center gap-1 print:hidden">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        이전
      </Button>
      {pages.map((value) => (
        <Button
          key={value}
          type="button"
          variant={value === page ? "default" : "outline"}
          size="sm"
          className="min-w-(--jeju-control-h-sm) tabular-nums"
          aria-current={value === page ? "page" : undefined}
          aria-label={`${value}페이지`}
          onClick={() => onPageChange(value)}
        >
          {value}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={page === pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        다음
      </Button>
      <span className="ml-2 text-(length:--jeju-text-sm) text-muted-foreground">
        {page} / {pageCount} 쪽
      </span>
    </nav>
  );
}

export function EmptyResults({
  keyword,
  hasKeyword,
  hasRegion,
  help,
  nationwideCount,
  onSearch,
  onClearKeyword,
  onClearRegion,
  onReset,
}: {
  keyword: string;
  hasKeyword: boolean;
  hasRegion: boolean;
  /** 서버가 알려 준 오타 제안·단어 빼기 결과 수 */
  help?: SearchHelp;
  /** 지역 조건을 뺀 전국 결과 수(모르면 null) */
  nationwideCount: number | null;
  onSearch: (query: string) => void;
  onClearKeyword: () => void;
  onClearRegion: () => void;
  onReset: () => void;
}) {
  const welfareCount = useWelfareMatchCount(keyword, hasKeyword);
  return (
    <div className="rounded-xl border border-dashed border-(--jeju-border-strong) bg-card px-4 py-10 text-center">
      <p className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">검색조건에 해당하는 사업이 없습니다.</p>
      <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">
        조건을 완화하면 다른 지자체의 유사 사업을 찾을 수 있습니다.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          필터 초기화
        </Button>
        {hasKeyword ? (
          <Button type="button" variant="outline" size="sm" onClick={onClearKeyword}>
            키워드 제거
          </Button>
        ) : null}
        {hasRegion ? (
          <Button type="button" variant="outline" size="sm" onClick={onClearRegion}>
            전국으로 검색{nationwideCount ? " · " + NUMBER_FORMAT.format(nationwideCount) + "건" : ""}
          </Button>
        ) : null}
      </div>
      {hasKeyword ? (
        <ZeroResultHelp
          help={help}
          onSearch={onSearch}
          crossLinks={[{ label: "복지제도100에서", href: welfareSearchHref(keyword), count: welfareCount }]}
        />
      ) : null}
    </div>
  );
}

export function ResultTable({
  rows,
  page,
  pageCount,
  totalCount,
  pageSize,
  sort,
  hasKeyword,
  onPageChange,
  onPageSizeChange,
  onSortChange,
  onSelect,
  onWikiOpen,
}: {
  rows: ServiceRow[];
  page: number;
  pageCount: number;
  totalCount: number;
  pageSize: number;
  /** 지금 적용된 정렬 */
  sort: SearchSort;
  hasKeyword: boolean;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number) => void;
  onSortChange: (next: SearchSort) => void;
  onSelect: (row: ServiceRow) => void;
  /** WIKI 설명을 새 창으로 열 때(이용통계 진입 경로 전달용). */
  onWikiOpen?: (row: ServiceRow) => void;
}) {
  const safePage = Math.min(page, pageCount);
  const sortOptions: SearchSort[] = hasKeyword ? ["relevance", "region", "name"] : ["region", "name"];

  return (
    <div>
      <div className="mb-3 flex flex-wrap justify-end gap-x-4 gap-y-2 print:hidden">
        <label className="flex items-center gap-2 text-(length:--jeju-text-sm) text-muted-foreground">
          정렬
          <NativeSelect
            size="sm"
            aria-label="검색 결과 정렬"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as SearchSort)}
          >
            {sortOptions.map((value) => (
              <NativeSelectOption key={value} value={value}>{SORT_LABELS[value]}</NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2 text-(length:--jeju-text-sm) text-muted-foreground">
          페이지당
          <NativeSelect
            size="sm"
            aria-label="페이지당 검색 결과 수"
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {[20, 30, 50, 100].map((size) => (
              <NativeSelectOption key={size} value={String(size)}>{size}건</NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <ResultCards rows={rows} onSelect={onSelect} onWikiOpen={onWikiOpen} />
      <div className="hidden lg:block print:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">지역</TableHead>
              <TableHead className="w-40">분야</TableHead>
              <TableHead className="min-w-56">사업명</TableHead>
              <TableHead className="min-w-72">주요 내용</TableHead>
              <TableHead className="w-28">사업구분</TableHead>
              <TableHead className="w-24 text-right print:hidden">상세</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="align-top whitespace-normal">
                  <span className="font-bold text-(--jeju-text-strong)">{row.sigungu || "-"}</span>
                  <span className="block text-(length:--jeju-text-sm) text-muted-foreground">{row.sido}</span>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <span>{row.category || "미분류"}</span>
                  {row.subcategory ? (
                    <span className="block text-(length:--jeju-text-sm) text-muted-foreground">{row.subcategory}</span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <a
                    href={serviceWikiHref(row)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={LINK_CLASS}
                    onClick={() => onWikiOpen?.(row)}
                    onAuxClick={(event) => {
                      if (event.button === 1) onWikiOpen?.(row);
                    }}
                    aria-label={`${row.name || "사업"} 통합돌봄 WIKI 설명 새 창에서 보기`}
                  >
                    {row.name || "사업명 없음"}
                  </a>
                  {row.provider ? (
                    <span className="block text-(length:--jeju-text-sm) text-muted-foreground">{row.provider}</span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top whitespace-normal text-(length:--jeju-text-sm)">
                  {row.target ? (
                    <span className="block">
                      <span className="font-bold text-muted-foreground">지원대상</span> {row.target}
                    </span>
                  ) : null}
                  {row.description ? <span className="block">{row.description}</span> : null}
                  {!row.target && !row.description ? (
                    <span className="text-muted-foreground">공식 응답에 내용 없음</span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <Badge variant="neutral" className="whitespace-normal">{row.type || "미분류"}</Badge>
                </TableCell>
                <TableCell className="text-right align-top print:hidden">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onSelect(row)}
                    aria-label={`${row.name || "사업"} 상세보기`}
                  >
                    보기
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="sr-only" aria-live="polite">
        검색 결과 {NUMBER_FORMAT.format(totalCount)}건 중 현재 {NUMBER_FORMAT.format(rows.length)}건
      </p>
      <PageControls page={safePage} pageCount={pageCount} onPageChange={onPageChange} />
    </div>
  );
}
