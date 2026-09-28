"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { hasPrivacySignal, loadUsageConfig, readOptOut, writeOptOut } from "@/lib/usage/preference";

interface OptOutState {
  readonly enabled: boolean;
  readonly signal: boolean;
  readonly optOut: boolean;
}

function statusText(state: OptOutState): string {
  if (state.signal) return "이 브라우저는 추적 거부 신호(GPC 또는 Do Not Track)를 보내고 있어 이용통계에서 자동으로 빠집니다.";
  if (state.optOut) return "이 브라우저의 이용은 이용통계에서 빠져 있습니다.";
  if (!state.enabled) return "지금은 이용통계를 모으지 않습니다. 수집이 다시 켜지면 이 브라우저의 이용도 합계에 더해집니다.";
  return "이 브라우저의 이용도 이용통계 합계에 더해지고 있습니다.";
}

/** 안내 화면 안의 「이 브라우저 이용을 통계에서 빼기」. 팝업 없이 이 자리에서 바로 바꾼다. */
export function UsageOptOut() {
  const [state, setState] = useState<OptOutState | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    void loadUsageConfig().then((config) => {
      if (alive) setState({ enabled: config.enabled, signal: hasPrivacySignal(), optOut: readOptOut() });
    });
    return () => {
      alive = false;
    };
  }, []);

  const change = (optOut: boolean) => {
    writeOptOut(optOut);
    setState((current) => (current ? { ...current, optOut } : current));
    setMessage(
      optOut
        ? "이 브라우저의 이용을 통계에서 뺐습니다. 아직 보내지 않은 기록도 지웠습니다."
        : "이 브라우저의 이용을 다시 통계에 포함합니다.",
    );
  };

  return (
    <div className="space-y-2 rounded-(--jeju-radius) border border-border bg-(--jeju-surface-inset) px-4 py-3 text-(length:--jeju-text-sm)">
      <p className="font-bold text-(--jeju-text-strong)">{state ? statusText(state) : "이 브라우저의 상태를 확인하고 있습니다."}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {state && !state.signal ? (
          <Button type="button" variant="outline" onClick={() => change(!state.optOut)}>
            {state.optOut ? "이 브라우저 이용을 다시 포함하기" : "이 브라우저 이용을 통계에서 빼기"}
          </Button>
        ) : null}
        <p role="status" className="font-bold text-(--jeju-success)">
          {message}
        </p>
      </div>
    </div>
  );
}
