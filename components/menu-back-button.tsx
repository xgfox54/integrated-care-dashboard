"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@/components/ui/jeju-icons";

// 화면(메뉴 목록, 또는 그 메뉴의 상세)마다 마지막으로 본 주소와 스크롤 위치를 이 탭의 세션에 기억한다.
// 화면들은 검색 조건을 주소에 남기므로 그 주소를 다시 열면 검색결과가 그대로 복원된다.
// 상세끼리 넘겨 본 것은 한 화면으로 묶어, 상세에서 누르면 검색 목록으로 돌아간다.
const TRAIL_KEY = "menu-trail-v1";
const RESTORE_KEY = "menu-restore-v1";

interface Visit { readonly section: string; readonly href: string; readonly y: number }
interface Trail { current: Visit | null; previous: Visit | null }

const MENU_LABELS: Readonly<Record<string, string>> = {
  "": "대시보드",
  wiki: "통합돌봄 WIKI",
  "wiki/*": "WIKI 문서",
  welfare100: "복지제도100",
  "welfare100/*": "복지제도 상세",
  news: "복지뉴스",
  budget: "복지예산",
  statistics: "복지통계",
  welfaremcp: "복지정보MCP",
  info: "시스템 소개",
  sources: "데이터 출처",
  care: "돌봄자원",
  mindmap: "관계성 지도",
};

function sectionOf(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return (parts[0] ?? "") + (parts.length > 1 ? "/*" : "");
}

function readTrail(): Trail {
  try {
    const value = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "null") as Trail | null;
    return value && typeof value === "object" ? { current: value.current ?? null, previous: value.previous ?? null } : { current: null, previous: null };
  } catch {
    return { current: null, previous: null };
  }
}

function writeTrail(trail: Trail) {
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
  } catch {
    // 저장소를 쓸 수 없으면(사생활 보호 모드 등) 기록 없이 동작한다.
  }
}

/** 이전 메뉴로 돌아왔을 때 결과가 다 그려질 때까지 기다렸다가 보던 위치로 내려 준다. 사용자가 먼저 움직이면 멈춘다. */
function restoreScroll(y: number) {
  const started = Date.now();
  let stopped = false;
  const stop = () => { stopped = true; };
  const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
  for (const name of events) window.addEventListener(name, stop, { once: true, passive: true });
  const tick = () => {
    if (stopped) return;
    const page = document.scrollingElement;
    const ready = page && page.scrollHeight - window.innerHeight >= y;
    if (ready || Date.now() - started > 6000) {
      window.scrollTo({ top: y, behavior: "instant" });
      for (const name of events) window.removeEventListener(name, stop);
      return;
    }
    window.setTimeout(tick, 150);
  };
  tick();
}

export function MenuBackButton() {
  const [previous, setPrevious] = useState<Visit | null>(null);
  const [section, setSection] = useState<string | null>(null);

  useEffect(() => {
    const here = sectionOf(window.location.pathname);
    const trail = readTrail();
    if (!trail.current || trail.current.section !== here) {
      if (trail.current) trail.previous = trail.current;
      trail.current = { section: here, href: window.location.href, y: 0 };
    }
    writeTrail(trail);
    setSection(here);
    setPrevious(trail.previous && trail.previous.section !== here ? trail.previous : null);

    try {
      const restore = JSON.parse(sessionStorage.getItem(RESTORE_KEY) ?? "null") as { path: string; y: number } | null;
      sessionStorage.removeItem(RESTORE_KEY);
      if (restore && restore.path === window.location.pathname && restore.y > 0) restoreScroll(restore.y);
    } catch {
      // 복원 정보가 없으면 맨 위에서 시작한다.
    }

    // 다른 메뉴로 떠날 때 이 메뉴의 마지막 주소(검색 조건 포함)와 스크롤 위치를 남긴다.
    // 떠나는 순간에는 브라우저가 스크롤을 0으로 읽기도 해서, 스크롤할 때마다 마지막 위치를 따로 기억해 둔다.
    let lastY = Math.round(window.scrollY);
    const onScroll = () => { lastY = Math.round(window.scrollY); };
    const remember = () => {
      const latest = readTrail();
      if (latest.current?.section !== here) return;
      latest.current = { section: here, href: window.location.href, y: lastY };
      writeTrail(latest);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") remember(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", remember);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", remember);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (section === null || (!previous && section === "")) return null;
  const target = previous?.href ?? "/";
  const label = previous ? MENU_LABELS[previous.section] ?? "이전 화면" : "대시보드";
  const title = previous ? "이전 메뉴(" + label + ")로 검색결과를 유지한 채 돌아갑니다" : "이전 메뉴 기록이 없어 대시보드로 이동합니다";

  return (
    <Button
      asChild
      variant="outline"
      className="size-11 rounded-full bg-card/95 px-0 text-(length:--jeju-text-sm) font-bold text-primary shadow-(--jeju-shadow) backdrop-blur-xs active:translate-y-0! min-[1520px]:w-auto min-[1520px]:px-3.5"
    >
      <a
        href={target}
        title={title}
        aria-label={"이전 메뉴로: " + label}
        onClick={() => {
          if (!previous) return;
          try {
            sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ path: new URL(previous.href).pathname, y: previous.y }));
          } catch {
            // 스크롤 복원 없이 이동한다.
          }
        }}
      >
        <ArrowLeftIcon />
        <span className="hidden min-[1520px]:inline">이전 메뉴로</span>
      </a>
    </Button>
  );
}

