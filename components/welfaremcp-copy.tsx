"use client";

import { useState } from "react";

import { CheckIcon } from "@/components/ui/jeju-icons";

/** 복사 대상은 옆에 항상 표시한다. 권한이 없으면 직접 선택해 복사할 수 있다. */
export function WelfareMcpCopy({ value, label }: { readonly value: string; readonly label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-(--jeju-control-h) items-center justify-center gap-2 rounded-(--jeju-radius) border border-input bg-card px-4 py-2 text-(length:--jeju-text-sm) font-bold text-primary outline-none transition-colors hover:bg-(--jeju-primary-tint) focus-visible:shadow-(--jeju-focus-ring)"
        aria-label={label}
      >
        {state === "copied" ? <CheckIcon /> : null}
        {state === "copied" ? "복사 완료" : label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{state === "copied" ? `${label} 완료` : ""}</span>
      {state === "error" ? (
        <p role="status" className="mt-2 text-(length:--jeju-text-sm) text-(--jeju-danger)">
          자동 복사를 사용할 수 없습니다. 표시된 문장을 직접 선택해 복사해 주세요.
        </p>
      ) : null}
    </div>
  );
}
