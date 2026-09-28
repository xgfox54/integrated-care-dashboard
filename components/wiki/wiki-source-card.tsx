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
    ? "border-(--jeju-green-light-strong) bg-(--jeju-success-tint)"
    : "border-(--jeju-blue-light-strong) bg-(--jeju-info-tint)";
  return (
    <section className={`rounded-xl border p-4 text-(--jeju-text) ${tone}`} aria-labelledby="wiki-source-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="wiki-source-heading" className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">사업명 일치 보완 설명</h2>
        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-(length:--jeju-text-xs) font-extrabold text-(--jeju-text-body)">{source.label}</span>
      </div>
      <blockquote className="mt-3 border-l-4 border-(--jeju-border-strong) pl-3 text-(length:--jeju-text-sm) leading-relaxed">
        {source.summary}
      </blockquote>
      <div className="mt-3 text-(length:--jeju-text-sm)">
        <p className="font-bold text-(--jeju-text-strong)">{source.title}</p>
        <p className="text-muted-foreground">{source.publisher}</p>
        {source.tier === "local" && source.sectionId ? (
          <dl className="mt-2 grid gap-1 text-(length:--jeju-text-xs) text-muted-foreground">
            <div>
              <dt className="inline font-semibold">인용 위치 </dt>
              <dd className="inline">
                {source.heading} · {source.startLine}~{source.endLine}행
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">추적 정보 </dt>
              <dd className="inline font-mono">
                절 {source.sectionId} · 문서 {source.sourceSha256?.slice(0, 12)} · DB {source.sourceDatabaseSha256?.slice(0, 12)}
              </dd>
            </div>
          </dl>
        ) : null}
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-bold text-primary underline underline-offset-4"
          >
            원문 확인 <ExternalLinkIcon />
            <span className="sr-only">(새 창)</span>
          </a>
        ) : (
          <p className="mt-2 text-muted-foreground">로컬 복지톡 DB의 2026년 사업안내 원문에서 직접 인용</p>
        )}
      </div>
    </section>
  );
}
