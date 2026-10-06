"use client";

import { Badge } from "@/components/ui/badge";
import type { DataState } from "@/lib/dataset";
import type { DatasetMeta, LoadPhase } from "@/lib/use-dataset";

// 상태는 배지 색과 문구를 함께 보여 준다(제주 디자인: 색 단독 상태 표현 금지).
const STATE_STYLES: Record<DataState, { label: string; variant: "success" | "info" | "warning" | "danger" }> = {
  official: { label: "공식자료 현행화", variant: "success" },
  syncing: { label: "공식자료 수집 중", variant: "info" },
  empty: { label: "데이터 없음", variant: "warning" },
  failed: { label: "공식자료 로드 실패", variant: "danger" },
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
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-(length:--jeju-text-sm)"
    >
      <Badge variant={loading ? "info" : style.variant}>{loading ? "데이터 불러오는 중" : style.label}</Badge>
      <p>
        <span className="text-muted-foreground">자료 기준일</span>{" "}
        <strong className="font-bold text-(--jeju-text-strong)">{meta.dataAsOf || (loading ? "확인 중" : "원문에 기준일 없음")}</strong>
      </p>
      <p>
        <span className="text-muted-foreground">데이터 확인</span>{" "}
        <strong className="font-bold text-(--jeju-text-strong)">{loading && !meta.fetchedAt ? "확인 중" : formatMoment(meta.fetchedAt)}</strong>
      </p>
      <p>
        <span className="text-muted-foreground">수록 사업</span>{" "}
        <strong className="font-bold tabular-nums text-(--jeju-text-strong)">{loading && !rowCount ? "확인 중" : `${rowCount.toLocaleString("ko-KR")}건`}</strong>
      </p>
      {meta.sourceLabel ? (
        <p className="text-muted-foreground">불러온 위치 {meta.sourceLabel}</p>
      ) : null}
      {prefetching ? (
        <p className="text-muted-foreground print:hidden" role="status">
          지역별 자료 준비 {prefetch.done.toLocaleString("ko-KR")}/{prefetch.total.toLocaleString("ko-KR")}
        </p>
      ) : null}
      {regionNote ? <p className="w-full text-muted-foreground">{regionNote}</p> : null}
      {meta.message ? <p className="w-full font-bold text-(--jeju-warning)">{meta.message}</p> : null}
      {loading || meta.dataAsOf ? null : (
        <p className="w-full text-muted-foreground">
          공식 메뉴판 제목에서 자료 기준일을 확인할 수 없었습니다.
        </p>
      )}
    </section>
  );
}
