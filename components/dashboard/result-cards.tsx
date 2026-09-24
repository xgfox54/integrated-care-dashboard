"use client";

import { Button } from "@/components/ui/button";
import { serviceWikiHref, type ServiceRow } from "@/lib/dataset";

export function ResultCards({
  rows,
  onSelect,
}: {
  rows: readonly ServiceRow[];
  onSelect: (row: ServiceRow) => void;
}) {
  return (
    <div className="space-y-2 lg:hidden">
      {rows.map((row) => (
        <article key={row.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                {[row.sido, row.sigungu].filter(Boolean).join(" · ")}
              </p>
              <h3 className="mt-1 text-balance break-keep font-semibold leading-snug">
                <a
                  href={serviceWikiHref(row)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
                  aria-label={`${row.name || "사업"} 통합돌봄 WIKI 설명 새 창에서 보기`}
                >
                  {row.name || "사업명 없음"}
                </a>
              </h3>
            </div>
            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-sm text-secondary-foreground">
              {row.type || "미분류"}
            </span>
          </div>
          <p className="mt-2 text-sm">
            <span className="font-medium">{row.category || "미분류"}</span>
            {row.subcategory ? (
              <span className="text-muted-foreground"> · {row.subcategory}</span>
            ) : null}
          </p>
          {row.provider ? <p className="mt-1 text-sm text-muted-foreground">{row.provider}</p> : null}
          {row.description ? (
            <p className="mt-2 line-clamp-3 break-keep text-sm leading-relaxed">{row.description}</p>
          ) : null}
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSelect(row)}
              aria-label={`${row.name || "사업"} 상세보기`}
            >
              상세보기
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
