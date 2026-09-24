"use client";

import { Button } from "@/components/ui/button";
import { ResultCards } from "@/components/dashboard/result-cards";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { serviceWikiHref, type ServiceRow } from "@/lib/dataset";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
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
    <nav aria-label="검색결과 페이지" className="mt-4 flex flex-wrap items-center justify-center gap-1">
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
          aria-current={value === page ? "page" : undefined}
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
      <span className="ml-2 text-sm text-muted-foreground">
        {page} / {pageCount} 쪽
      </span>
    </nav>
  );
}

export function EmptyResults({
  hasKeyword,
  hasRegion,
  onClearKeyword,
  onClearRegion,
  onReset,
}: {
  hasKeyword: boolean;
  hasRegion: boolean;
  onClearKeyword: () => void;
  onClearRegion: () => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center">
      <p className="text-base font-semibold">검색조건에 해당하는 사업이 없습니다.</p>
      <p className="mt-1 text-sm text-muted-foreground">
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
            전국으로 검색
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ResultTable({
  rows,
  page,
  pageCount,
  totalCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onSelect,
}: {
  rows: ServiceRow[];
  page: number;
  pageCount: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (next: number) => void;
  onPageSizeChange: (next: number) => void;
  onSelect: (row: ServiceRow) => void;
}) {
  const safePage = Math.min(page, pageCount);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          페이지당
          <NativeSelect
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
      <ResultCards rows={rows} onSelect={onSelect} />
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">지역</TableHead>
              <TableHead className="w-40">분야</TableHead>
              <TableHead className="min-w-56">사업명</TableHead>
              <TableHead className="min-w-72">주요 내용</TableHead>
              <TableHead className="w-28">사업구분</TableHead>
              <TableHead className="w-24 text-right">상세</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="align-top whitespace-normal">
                  <span className="font-medium">{row.sigungu || "-"}</span>
                  <span className="block text-sm text-muted-foreground">{row.sido}</span>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <span>{row.category || "미분류"}</span>
                  {row.subcategory ? (
                    <span className="block text-sm text-muted-foreground">{row.subcategory}</span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <a
                    href={serviceWikiHref(row)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
                    aria-label={`${row.name || "사업"} 통합돌봄 WIKI 설명 새 창에서 보기`}
                  >
                    {row.name || "사업명 없음"}
                  </a>
                  {row.provider ? (
                    <span className="block text-sm text-muted-foreground">{row.provider}</span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top whitespace-normal text-sm">
                  {row.target ? (
                    <span className="block">
                      <span className="text-muted-foreground">지원대상</span> {row.target}
                    </span>
                  ) : null}
                  {row.description ? <span className="block">{row.description}</span> : null}
                  {!row.target && !row.description ? (
                    <span className="text-muted-foreground">공식 응답에 내용 없음</span>
                  ) : null}
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-sm text-secondary-foreground">
                    {row.type || "미분류"}
                  </span>
                </TableCell>
                <TableCell className="text-right align-top">
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
