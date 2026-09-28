"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SearchHelp } from "@/lib/search-terms";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

export interface CrossLink {
  readonly label: string;
  readonly href: string;
  /** 모르면 null(건수 없이 링크만 보인다). 0이면 보이지 않는다. */
  readonly count: number | null;
}

/**
 * 검색 결과 0건일 때의 도움말: 오타 제안, 단어를 하나씩 빼고 다시 찾기, 다른 탭 결과.
 * 대시보드·통합돌봄 WIKI·복지제도100이 같은 모양으로 쓴다.
 */
export function ZeroResultHelp({
  help,
  crossLinks,
  onSearch,
  className,
}: {
  readonly help?: SearchHelp;
  readonly crossLinks?: readonly CrossLink[];
  readonly onSearch: (query: string) => void;
  readonly className?: string;
}) {
  const relaxed = (help?.withoutTerm ?? []).filter((item) => item.count > 0 && item.query);
  const links = (crossLinks ?? []).filter((link) => link.count !== 0);
  if (!help?.suggestion && relaxed.length === 0 && links.length === 0) return null;
  return (
    <div className={cn("mt-4 grid justify-items-center gap-3 text-(length:--jeju-text-sm) text-(--jeju-text-body)", className)}>
      {help?.suggestion ? (
        <p className="flex flex-wrap items-center justify-center gap-1.5">
          <span>혹시</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onSearch(help.suggestion!.query)}>
            「{help.suggestion.query}」
          </Button>
          <span>(으)로 찾으셨나요? {NUMBER_FORMAT.format(help.suggestion.count)}건이 있습니다.</span>
        </p>
      ) : null}
      {relaxed.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="font-bold text-muted-foreground">단어를 빼고 찾기</span>
          {relaxed.map((item) => (
            <Button key={item.term} type="button" variant="outline" size="sm" onClick={() => onSearch(item.query)}>
              「{item.term}」 빼기 · {NUMBER_FORMAT.format(item.count)}건
            </Button>
          ))}
        </div>
      ) : null}
      {links.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="font-bold text-muted-foreground">다른 곳에서 찾기</span>
          {links.map((link) => (
            <a key={link.href} href={link.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {link.label}
              {link.count === null ? "" : " " + NUMBER_FORMAT.format(link.count) + "건"}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
