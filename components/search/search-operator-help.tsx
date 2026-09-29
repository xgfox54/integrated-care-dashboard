"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { HelpIcon } from "@/components/ui/jeju-icons";
import { cn } from "@/lib/utils";

const OPERATORS = [
  { syntax: ["A B", "A&B"], meaning: "모두 포함", example: "방문 진료" },
  { syntax: ["A or B", "A|B"], meaning: "하나라도 포함", example: "노인 or 장애인" },
  { syntax: ["A*B"], meaning: "A 뒤에 B(사이 글자 무관)", example: "노인*돌봄" },
  { syntax: ["-A", "!A"], meaning: "A가 든 사업 제외", example: "돌봄 -요양" },
] as const;

const VIEWPORT_MARGIN_PX = 16;

/**
 * 검색창 옆 (?) 단추: 마우스를 올리거나 키보드로 초점을 옮기면 검색 연산자 설명이 열린다.
 * 터치 화면에서는 눌러서 열고, 바깥을 누르거나 Esc로 닫는다.
 */
export function SearchOperatorHelp({ align = "start", className }: { readonly align?: "start" | "end"; readonly className?: string }) {
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || focused || pinned;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    panel.style.transform = "";
    const box = panel.getBoundingClientRect();
    const overflowRight = Math.max(0, box.right - (document.documentElement.clientWidth - VIEWPORT_MARGIN_PX));
    const shift = Math.max(VIEWPORT_MARGIN_PX - box.left, -overflowRight);
    panel.style.transform = shift ? `translateX(${shift}px)` : "";
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPinned(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setHovered(false);
      setFocused(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={cn("relative inline-flex", className)}
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
    >
      <button
        type="button"
        aria-label="검색 연산자 도움말"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={open ? panelId : undefined}
        onClick={() => setPinned((value) => !value)}
        onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        className="inline-grid size-6 cursor-help place-items-center rounded-full text-(--jeju-text-muted) hover:bg-(--jeju-primary-tint) hover:text-(--jeju-primary) focus-visible:shadow-(--jeju-focus-ring) focus-visible:outline-none"
      >
        <HelpIcon className="size-(--jeju-icon)" aria-hidden="true" />
      </button>
      <span
        id={panelId}
        ref={panelRef}
        role="tooltip"
        hidden={!open}
        className={cn(
          "absolute top-full z-(--jeju-z-tooltip) pt-2 text-left font-normal",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        <span className="block w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-(--jeju-border) bg-(--jeju-surface) p-3 text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body) shadow-(--jeju-shadow-pop)">
          <strong className="block font-bold text-(--jeju-text-strong)">검색 연산자</strong>
          <span className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            {OPERATORS.map((operator) => (
              <span key={operator.meaning} className="contents">
                <span className="whitespace-nowrap">
                  {operator.syntax.map((syntax, index) => (
                    <span key={syntax}>
                      {index > 0 ? <span className="text-(length:--jeju-text-xs) text-(--jeju-text-muted)"> 또는 </span> : null}
                      <code className="rounded bg-(--jeju-primary-tint) px-1 font-mono font-bold whitespace-pre text-(--jeju-primary)">{syntax}</code>
                    </span>
                  ))}
                </span>
                <span>
                  {operator.meaning}
                  <span className="block text-(length:--jeju-text-xs) text-(--jeju-text-muted)">예: {operator.example}</span>
                </span>
              </span>
            ))}
          </span>
          <span className="mt-2 block border-t border-(--jeju-border) pt-2 text-(length:--jeju-text-xs) text-(--jeju-text-muted)">
            or 는 & 보다 먼저 묶입니다. 부산 or 울산 방문진료 = (부산 또는 울산) 그리고 방문진료. 괄호로 묶어도 됩니다: (부산 방문진료) or (울산 방문진료)
          </span>
        </span>
      </span>
    </span>
  );
}
