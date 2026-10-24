"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { PATH_DOMAINS, type DataStatusReport, type DomainId } from "@/lib/data-status-paths";

const STATE_CLASS: Record<string, string> = {
  정상: "bg-(--jeju-surface-inset) text-(--jeju-text-body)",
  "일부 제공": "bg-(--jeju-surface-inset) text-(--jeju-text-body)",
  "갱신 지연": "bg-(--jeju-orange-light) text-(--jeju-warning)",
  미제공: "bg-(--jeju-surface-inset) text-muted-foreground",
  "확인 실패": "bg-(--jeju-surface-inset) text-(--jeju-danger)",
};

function shortDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function DataStatusStrip() {
  const pathname = usePathname() ?? "/";
  const domains: readonly DomainId[] = PATH_DOMAINS.find(([prefix]) => prefix === "/" ? pathname === "/" : pathname.startsWith(prefix))?.[1] ?? [];
  const [report, setReport] = useState<DataStatusReport | null>(null);
  useEffect(() => {
    if (domains.length === 0) return;
    const controller = new AbortController();
    fetch("/api/data-status", { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as DataStatusReport) : null))
      .then(setReport)
      .catch(() => undefined);
    return () => controller.abort();
  }, [domains.length]);
  if (!report || domains.length === 0) return null;
  const shown = report.domains.filter((entry) => domains.includes(entry.domain));
  return (
    <section aria-label="자료 상태" className="mx-auto mt-3 w-full max-w-7xl px-4 sm:px-6">
      <details className="rounded-lg border border-border bg-card px-3 py-1.5 text-(length:--jeju-text-xs)">
        <summary className="flex min-h-9 cursor-pointer select-none items-center gap-1 rounded font-bold text-(--jeju-text-body) outline-none focus-visible:shadow-(--jeju-focus-ring)">
          자료 조회 상태 · {shown.map((entry) => entry.label + " " + entry.state).join(" · ")} <span className="font-normal text-muted-foreground">(상태 조회 {shortDate(report.checkedAt)})</span>
        </summary>
        {shown.some((entry) => entry.domain === "welfare100") && (
          <p className="mt-2 text-muted-foreground">복지제도 대장 수집일 {shown.find((entry) => entry.domain === "welfare100")?.sourceAsOf ?? "미확인"}. 조회 정상은 지원금액·조건의 최신성 검증을 뜻하지 않습니다.</p>
        )}
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {shown.map((entry) => (
            <li key={entry.domain} className={"rounded-md px-3 py-2 " + (STATE_CLASS[entry.state] ?? "")}>
              <p className="font-bold">{entry.label} · {entry.state}</p>
              <p>원자료 기준일 {entry.sourceAsOf ?? "자료별 표기"} · 마지막 정상 수집 {shortDate(entry.lastSuccessAt)}</p>
              <p>{entry.verification}</p>
              {entry.available.length ? <p>이용 가능: {entry.available.join(", ")}</p> : null}
              {entry.limitations.map((limit) => <p key={limit} className="text-muted-foreground">제한: {limit}</p>)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

