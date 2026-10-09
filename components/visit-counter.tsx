"use client";

import { useEffect, useState } from "react";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

type Visits = { readonly visits: number; readonly since: string | null } | null | "error";

export function VisitCounter() {
  const [state, setState] = useState<Visits>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/usage/visits", { signal: controller.signal })
      .then((response): Promise<{ visits: number; since: string | null }> => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => setState({ visits: body.visits, since: body.since }))
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, []);
  if (state === "error") return null;
  return (
    <p className="shrink-0 self-end border-border text-right text-(length:--jeju-text-sm) leading-snug text-muted-foreground md:self-auto md:border-l md:pl-3 md:text-left print:hidden" aria-live="polite" aria-busy={state === null}
      title="개인을 구분하지 않아 같은 분이 다시 방문하면 한 번 더 셉니다.">
      <span className="block whitespace-nowrap">
        사이트 누적 방문자 수: <strong className="font-extrabold tabular-nums text-(--jeju-text-strong)">{state === null ? "…" : NUMBER_FORMAT.format(state.visits)}</strong>명
      </span>
      <span className="block whitespace-nowrap text-(length:--jeju-text-xs)">{state?.since ? state.since.replaceAll("-", ".") + ". 이후 방문 횟수" : "방문 횟수 기준"}</span>
    </p>
  );
}
