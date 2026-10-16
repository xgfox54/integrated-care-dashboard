"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";

interface Lifecycle {
  readonly sourceBasis: { readonly label: string };
  readonly appliedYear: { readonly value: number | null; readonly basis: string };
  readonly sourceCheckedAt: string | null;
  readonly lastCollectedAt: string | null;
  readonly status: { readonly value: string; readonly asOf: string | null; readonly basis: string; readonly evidence: { readonly title: string; readonly url: string; readonly kind: string } | null };
  readonly verification: { readonly value: string; readonly reasons: readonly string[] };
  readonly source: { readonly title: string; readonly url: string } | null;
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { "운영 중": "success", "시행 예정": "warning", 종료: "danger", "확인 불가": "neutral" };
const VERIFY_TONE: Record<string, "success" | "warning" | "neutral"> = { "확인 완료": "success", "추가 확인 필요": "warning", "확인 불가": "neutral" };

function dotDate(value: string | null): string {
  if (!value) return "미확인";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return pick("year") + "." + pick("month") + "." + pick("day") + ".";
}

export function LifecyclePanel({ serviceId, fallbackBasis }: { readonly serviceId: string; readonly fallbackBasis: string }) {
  const [state, setState] = useState<{ readonly id: string; readonly data: Lifecycle | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dataset/lifecycle?id=" + encodeURIComponent(serviceId), { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as Lifecycle) : null))
      .then((data) => setState({ id: serviceId, data }))
      .catch(() => { if (!controller.signal.aborted) setState({ id: serviceId, data: null }); });
    return () => controller.abort();
  }, [serviceId]);
  const data = state?.id === serviceId ? state.data : null;
  const label = "font-bold text-muted-foreground";
  const body = "mt-1.5 leading-relaxed text-(--jeju-text-body)";
  if (!data) {
    return (
      <div className="min-w-0">
        <dt className={label}>자료 기준</dt>
        <dd className={body}>{fallbackBasis || "보건복지부 최신 수집본"}</dd>
      </div>
    );
  }
  return (
    <>
      <div className="min-w-0">
        <dt className={label}>자료 적용 기준</dt>
        <dd className={body}>{data.appliedYear.value ? data.sourceBasis.label + " 원문" : "미확인"}</dd>
        <dd className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">{data.appliedYear.basis}</dd>
      </div>
      <div className="min-w-0">
        <dt className={label}>원문 확인</dt>
        <dd className={body}>{dotDate(data.sourceCheckedAt)}</dd>
        <dd className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">마지막 정상 수집 {dotDate(data.lastCollectedAt)}</dd>
      </div>
      <div className="min-w-0">
        <dt className={label}>운영상태</dt>
        <dd className={body}><Badge variant={STATUS_TONE[data.status.value] ?? "neutral"}>{data.status.value}</Badge>{data.status.asOf ? <span className="ml-2 text-(length:--jeju-text-xs) text-muted-foreground">{data.status.asOf} 기준</span> : null}</dd>
        <dd className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">{data.status.basis}</dd>
      </div>
      <div className="min-w-0">
        <dt className={label}>검증상태</dt>
        <dd className={body}><Badge variant={VERIFY_TONE[data.verification.value] ?? "neutral"}>{data.verification.value}</Badge></dd>
        {data.verification.reasons.length ? <dd className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">{data.verification.reasons.join(" ")}</dd> : null}
      </div>
    </>
  );
}

