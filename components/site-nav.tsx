"use client";

import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "대시보드" },
  { href: "/wiki", label: "통합돌봄 WIKI" },
  { href: "/welfare100", label: "복지제도100" },
  { href: "/sources", label: "데이터 출처" },
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
    <nav aria-label="주요 메뉴">
      <ul className="flex flex-wrap items-center gap-1">
        {NAV_ITEMS.map((item, index) => {
          const current = isCurrentPage(pathname, item.href);
          return (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-full px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0173bc]",
                  // 현재 화면은 포인트 색 초록(--care-green)으로 채워 한눈에 구분한다.
                  current
                    ? "bg-[var(--care-green)] font-bold text-white shadow-sm"
                    : "font-semibold text-foreground hover:bg-[#0173bc]/8 hover:text-[#0173bc]",
                )}
              >
                {index === 1 ? (
                  <span
                    className={cn("mr-1.5 size-1.5 rounded-full", current ? "bg-white" : "bg-[var(--care-green)]")}
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
