import { ExternalLink } from "lucide-react";

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
    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
    : "border-blue-200 bg-blue-50 text-blue-950";
  return (
    <section className={`rounded-lg border p-4 ${tone}`} aria-labelledby="wiki-source-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="wiki-source-heading" className="font-semibold">사업명 일치 보완 설명</h2>
        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold">{source.label}</span>
      </div>
      <blockquote className="mt-3 border-l-4 border-current/25 pl-3 text-sm leading-relaxed">
        {source.summary}
      </blockquote>
      <div className="mt-3 text-sm">
        <p className="font-medium">{source.title}</p>
        <p className="text-current/75">{source.publisher}</p>
        {source.tier === "local" && source.sectionId ? (
          <dl className="mt-2 grid gap-1 text-xs text-current/75">
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
            className="mt-2 inline-flex items-center gap-1 font-semibold underline underline-offset-4"
          >
            원문 확인 <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        ) : (
          <p className="mt-2 text-current/75">로컬 복지톡 DB의 2026년 사업안내 원문에서 직접 인용</p>
        )}
      </div>
    </section>
  );
}
