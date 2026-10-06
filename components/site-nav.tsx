"use client";

import { usePathname } from "next/navigation";

import { CARE_RESOURCES_PUBLIC } from "@/lib/integrations/care-hold";
import { markUsageNavigation } from "@/lib/usage/track";
import { cn } from "@/lib/utils";

// 점 색은 탭 순서(자리)에 붙는다: 주황·초록·파랑을 두 번 되풀이하고 마지막 자리는 빨강. 현재 화면 탭은 초록 채움 위에 흰 점으로 바뀐다.
const NAV_ITEMS: readonly { href: string; label: string; dot?: string }[] = [
  { href: "/", label: "대시보드", dot: "bg-(--jeju-orange)" },
  { href: "/wiki", label: "통합돌봄 WIKI", dot: "bg-(--jeju-green)" },
  { href: "/welfare100", label: "복지제도100", dot: "bg-(--jeju-blue)" },
  { href: "/mindmap", label: "복지정보 관계성 지도", dot: "bg-(--jeju-orange)" },
  { href: "/news", label: "복지뉴스", dot: "bg-(--jeju-green)" },
  { href: "/budget", label: "복지예산", dot: "bg-(--jeju-blue)" },
  { href: "/sources", label: "데이터 출처", dot: "bg-(--jeju-danger)" },
  // 돌봄자원은 보류 중이라 메뉴에 내지 않는다(lib/integrations/care-hold.ts).
  ...(CARE_RESOURCES_PUBLIC ? [{ href: "/care", label: "돌봄자원", dot: "bg-(--jeju-green)" }] : []),
];

/** 지금 보고 있는 화면의 메뉴인지. 복지제도 상세(/welfare100/…)도 복지제도100으로 본다. */
function isCurrentPage(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

export function SiteNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="주요 메뉴" className="print:hidden">
      <ul className="flex flex-wrap items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const current = isCurrentPage(pathname, item.href);
          return (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={current ? "page" : undefined}
                onClick={() => markUsageNavigation(item.href, current)}
                className={cn(
                  "inline-flex min-h-(--jeju-control-h) items-center rounded-(--jeju-radius) px-3 text-(length:--jeju-text-base) font-bold no-underline outline-none transition-colors focus-visible:shadow-(--jeju-focus-ring)",
                  // 현재 화면은 초록으로 채워 한눈에 구분한다. 흰 글자와 대비 4.5:1을 넘는 제주 접근성 초록(--jeju-secondary-strong)을 쓴다.
                  current
                    ? "bg-(--jeju-secondary-strong) text-(--jeju-on-fill) forced-colors:border forced-colors:border-[CanvasText]"
                    : "text-(--jeju-text-body) hover:bg-(--jeju-primary-tint) hover:text-primary",
                )}
              >
                {item.dot ? (
                  <span
                    className={cn("mr-1.5 size-1.5 shrink-0 rounded-full", current ? "bg-(--jeju-on-fill)" : item.dot)}
                    aria-hidden="true"
                  />
                ) : null}
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
