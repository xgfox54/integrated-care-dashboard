import { ExternalLinkIcon } from "@/components/ui/jeju-icons";

export interface WikiSource {
  readonly tier: "bokjiro" | "local";
  readonly label: string;
  readonly title: string;
  readonly summary: string;
  readonly publisher: string;
  readonly url: string;
  readonly matchedTerm: string;
  readonly sectionId?: string;
  readonly heading?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly sourceSha256?: string;
  readonly sourceDatabaseSha256?: string;
}

export function WikiSourceCard({ source }: { readonly source: WikiSource }) {
  const tone = source.tier === "bokjiro"
    ? "border-l-(--jeju-secondary-strong)"
    : "border-l-primary";
  return (
    <section className={`min-w-0 rounded-(--jeju-radius-lg) border border-l-[3px] border-border bg-card px-5 py-5 text-(--jeju-text) [overflow-wrap:anywhere] sm:px-6 sm:py-6 ${tone}`} aria-labelledby="wiki-source-heading">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h3 id="wiki-source-heading" className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">사업명 일치 보완 설명</h3>
        <span className="max-w-full rounded-full bg-(--jeju-control-bg) px-2.5 py-1 text-(length:--jeju-text-xs) font-bold leading-normal text-(--jeju-text-body)">{source.label}</span>
      </div>
      <blockquote className="mt-4 max-w-[82ch] whitespace-pre-line text-(length:--jeju-text-base) leading-[1.85] text-(--jeju-text-body)">
        {source.summary}
      </blockquote>
      <div className="mt-5 border-t border-(--jeju-hairline) pt-4 text-(length:--jeju-text-sm) leading-relaxed">
        <p className="font-bold text-(--jeju-text-strong)">{source.title}</p>
        <p className="mt-1 text-muted-foreground">{source.publisher}</p>
        {source.tier === "local" && source.sectionId ? (
          <dl className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">
            <div>
              <dt className="inline font-semibold">인용 위치 </dt>
              <dd className="inline">
                {source.heading} · {source.startLine}~{source.endLine}행
              </dd>
            </div>
          </dl>
        ) : null}
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex max-w-full items-center gap-1.5 font-bold text-primary underline decoration-(--jeju-blue-light-strong) underline-offset-4 hover:decoration-current"
          >
            원문 확인 <ExternalLinkIcon />
            <span className="sr-only">(새 창)</span>
          </a>
        ) : (
          <p className="mt-3 text-muted-foreground">복지톡 사업안내 원문에서 직접 인용</p>
        )}
      </div>
    </section>
  );
}
