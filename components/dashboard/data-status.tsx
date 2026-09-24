"use client";

import type { DataState } from "@/lib/dataset";
import type { DatasetMeta, LoadPhase } from "@/lib/use-dataset";

const STATE_STYLES: Record<DataState, { label: string; className: string }> = {
  official: {
    label: "공식자료 현행화",
    className: "bg-[var(--care-green)]/10 text-[var(--accent-foreground)] ring-[var(--care-green)]/30",
  },
  syncing: {
    label: "공식자료 수집 중",
    className: "bg-[var(--care-blue)]/10 text-[var(--secondary-foreground)] ring-[var(--care-blue)]/30",
  },
  empty: {
    label: "데이터 없음",
    className: "bg-[var(--care-orange)]/10 text-[var(--attention-foreground)] ring-[var(--care-orange)]/30",
  },
  failed: { label: "공식자료 로드 실패", className: "bg-red-50 text-red-800 ring-red-200" },
};
const MOMENT_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

function formatMoment(value: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return MOMENT_FORMAT.format(parsed);
}

export function DataStatus({
  meta,
  phase,
  rowCount,
  prefetch = null,
  regionNote = "",
}: {
  meta: DatasetMeta;
  phase: LoadPhase;
  rowCount: number;
  prefetch?: { readonly done: number; readonly total: number } | null;
  regionNote?: string;
}) {
  const loading = phase === "loading";
  const style = STATE_STYLES[meta.state] ?? STATE_STYLES.failed;
  const prefetching = prefetch !== null && prefetch.total > 0 && prefetch.done < prefetch.total;

  return (
    <section
      aria-label="데이터 상태"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
    >
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ring-inset ${style.className}`}
      >
        {loading ? "데이터 불러오는 중" : style.label}
      </span>
      <p className="text-sm">
        <span className="text-muted-foreground">자료 기준일</span>{" "}
        <strong className="font-semibold">{meta.dataAsOf || "미설정"}</strong>
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">데이터 확인</span>{" "}
        <strong className="font-semibold">{formatMoment(meta.fetchedAt)}</strong>
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">수록 사업</span>{" "}
        <strong className="font-semibold">{rowCount.toLocaleString("ko-KR")}건</strong>
      </p>
      {meta.sourceLabel ? (
        <p className="text-sm text-muted-foreground">불러온 위치 {meta.sourceLabel}</p>
      ) : null}
      {prefetching ? (
        <p className="text-sm text-muted-foreground" role="status">
          지역별 자료 준비 {prefetch.done.toLocaleString("ko-KR")}/{prefetch.total.toLocaleString("ko-KR")}
        </p>
      ) : null}
      {regionNote ? <p className="w-full text-sm text-muted-foreground">{regionNote}</p> : null}
      {meta.message ? (
        <p className="w-full text-sm text-amber-800">{meta.message}</p>
      ) : null}
      {meta.dataAsOf ? null : (
        <p className="w-full text-sm text-muted-foreground">
          공식 메뉴판 제목에서 자료 기준일을 확인할 수 없었습니다.
        </p>
      )}
    </section>
  );
}
