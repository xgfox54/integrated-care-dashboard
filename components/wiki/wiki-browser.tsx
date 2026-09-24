"use client";

import { useMemo, useState } from "react";
import { BookOpen, LoaderCircle, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { ServiceDetails } from "@/components/wiki/service-details";
import { collapse, serviceWikiHref, serviceWikiKey, type ServiceRow } from "@/lib/dataset";
import { useWikiDataset } from "@/lib/use-wiki-dataset";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

function uniqueServices(rows: readonly ServiceRow[]): ServiceRow[] {
  const unique = new Map<string, ServiceRow>();
  for (const row of rows) {
    const key = serviceWikiKey(row);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

export function WikiBrowser() {
  const [query, setQuery] = useState("");
  const selectedKey = useSearchParams().get("service") ?? "";
  const {
    selected,
    selectedPhase,
    selectionResolved,
    catalogRows,
    catalogTotalCount,
    catalogPhase,
    catalogScope,
  } = useWikiDataset(selectedKey, query);

  const services = useMemo(
    () => uniqueServices(selected ? [selected, ...catalogRows] : catalogRows),
    [catalogRows, selected],
  );
  const matches = useMemo(() => {
    const keyword = collapse(query);
    const source = keyword
      ? services.filter((row) => row.searchIndex.includes(keyword))
      : services;
    return source.slice(0, selected ? 12 : 24);
  }, [query, selected, services]);
  const hasSelection = Boolean(selectedKey);

  return (
    <main className="mx-auto grid max-w-[1400px] gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className={`${hasSelection ? "order-2" : ""} space-y-4 lg:order-none lg:sticky lg:top-4 lg:self-start`}>
        <div>
          <div className="flex items-center gap-2 text-primary">
            <BookOpen className="size-5" aria-hidden="true" />
            <h1 className="text-xl font-bold">통합돌봄 WIKI</h1>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            보건복지부 원자료를 기준으로 작성하고, 사업명이 정확히 일치할 때만 보완 설명을 연결합니다.
          </p>
        </div>

        <label className="relative block">
          <span className="sr-only">WIKI 사업 검색</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="사업명, 지역, 분야 검색"
            className="pl-9"
          />
        </label>

        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {selected && catalogPhase === "loading"
            ? "선택한 사업을 먼저 표시했습니다. 사업 목록을 불러오는 중입니다."
            : catalogPhase === "loading"
              ? query ? "검색 결과를 불러오는 중입니다." : "사업 목록을 불러오는 중입니다."
              : catalogPhase === "error"
                ? "사업 목록을 불러오지 못했습니다. 선택한 사업 내용은 계속 확인할 수 있습니다."
                : `${catalogScope ? `${catalogScope} ` : ""}${NUMBER_FORMAT.format(catalogTotalCount)}개 WIKI 항목 중 ${NUMBER_FORMAT.format(matches.length)}개 표시`}
        </p>

        <nav aria-label="통합돌봄 WIKI 사업 목록" className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
          {matches.map((row) => {
            const active = serviceWikiKey(row) === selectedKey;
            return (
              <a
                key={serviceWikiKey(row)}
                href={serviceWikiHref(row)}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md border px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/50 hover:bg-accent"
                }`}
              >
                <span className="block font-semibold leading-snug">{row.name}</span>
                <span className={`mt-1 block text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                  {[row.sido, row.sigungu].filter(Boolean).join(" · ") || "전국"}
                </span>
              </a>
            );
          })}
        </nav>
      </aside>

      <div className={hasSelection ? "order-1 lg:order-none" : ""}>
        {selected ? (
          <ServiceDetails key={serviceWikiKey(selected)} row={selected} />
        ) : hasSelection && !selectionResolved ? (
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
            선택한 사업 내용을 불러오는 중입니다.
          </div>
        ) : hasSelection && selectedPhase === "error" ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <h2 className="font-semibold">선택한 사업을 불러오지 못했습니다.</h2>
            <p className="mt-1 text-sm text-muted-foreground">잠시 후 다시 시도하거나 왼쪽 검색에서 사업을 찾아보세요.</p>
          </div>
        ) : hasSelection ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <h2 className="font-semibold">해당 사업을 현재 데이터에서 찾지 못했습니다.</h2>
            <p className="mt-1 text-sm text-muted-foreground">왼쪽 검색에서 같은 사업명을 다시 찾아보세요.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-8">
            <h2 className="text-lg font-semibold">사업 설명을 선택해 주세요.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              왼쪽 목록에서 사업을 고르면 보건복지부 통합돌봄 사업안내에 수록된 해당 행으로
              사업명, 사업개요, 사업내용을 작성합니다. 원자료에서 대상이 확인될 때만 신청조건을 표시하며,
              복지로와 복지톡 DB는 사업명이 정확히 일치하는 경우에만 보완 설명으로 연결합니다.
            </p>
            <ol className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["기준", "보건복지부", "해당 지자체 사업안내의 사업별 원문"],
                ["보완 1", "복지로", "정확히 같은 사업명의 공식 서비스 설명"],
                ["보완 2", "복지톡 DB", "정확히 같은 사업명의 2026년 사업안내 설명"],
              ].map(([step, title, body]) => (
                <li key={step} className="rounded-md bg-secondary p-3 text-sm">
                  <span className="font-bold text-primary">{step}</span>
                  <strong className="ml-2">{title}</strong>
                  <p className="mt-1 text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </main>
  );
}
