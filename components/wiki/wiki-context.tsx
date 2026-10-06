"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ExternalLinkIcon } from "@/components/ui/jeju-icons";
import { Spinner } from "@/components/ui/spinner";

interface DocumentFact {
  readonly statement_id: string;
  readonly predicate_label: string;
  readonly value: string;
  readonly unit: string | null;
  readonly source: { readonly title: string; readonly issuer: string; readonly url: string | null; readonly published_date: string | null };
  readonly evidence: readonly { readonly quote: string; readonly layout_page_start: number | null }[];
}
interface FiscalLink { readonly fiscal_project_id: string; readonly relation?: string; readonly reviewed_at: string | null }
interface NewsItem { readonly article_id: string; readonly title: string; readonly issued_by: string; readonly published_date: string | null; readonly original_url: string }
interface Context {
  readonly ok: true;
  readonly release_bundle_id: string | null;
  readonly basis: { readonly effective_reference_date?: string };
  readonly fiscal: { readonly status: string; readonly linked_fiscal_projects?: readonly FiscalLink[]; readonly message: string };
  readonly news: { readonly status: string; readonly items: readonly NewsItem[]; readonly note: string; readonly link_basis: string };
  readonly document_facts: readonly DocumentFact[];
}

const LINK = "inline-flex items-center gap-1 font-bold text-primary underline-offset-4 hover:underline";

/** 작업지시서 §17.6: 지원기준·근거(문서), 연결된 공개 예산, 관련 보도 링크를 각각의 확인 상태와 함께 따로 보여 준다. */
export function WikiContext({ implementationId }: { readonly implementationId: string }) {
  const [state, setState] = useState<{ readonly id: string; readonly context: Context | null; readonly failed: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wiki/context?service=" + encodeURIComponent(implementationId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as Context | { ok: false };
        setState({ id: implementationId, context: body.ok ? (body as Context) : null, failed: !body.ok });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ id: implementationId, context: null, failed: true }); });
    return () => controller.abort();
  }, [implementationId]);

  const current = state?.id === implementationId ? state : null;
  const context = current?.context ?? null;
  // 이용자에게는 실제로 연결된 근거·예산·보도가 있을 때만 보인다(없음·미확인 안내, 내부 공개본 번호는 숨김, 2026-10-06 전수점검).
  if (current && (!context || (!context.document_facts.length && !(context.fiscal.linked_fiscal_projects ?? []).length && !context.news.items.length))) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="wiki-context-heading">
      <h3 id="wiki-context-heading" className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">관련 근거·예산·보도</h3>
      <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">문서 근거·공개 예산·관련 보도는 출처와 기준일이 서로 달라 따로 보여 줍니다.</p>
      {!current ? <p className="mt-3 flex items-center gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><Spinner label="불러오는 중" />불러오는 중입니다.</p> : null}
      {context ? <ContextBody context={context} /> : null}
    </section>
  );
}

function ContextBody({ context }: { readonly context: Context }) {
  const links = context.fiscal.linked_fiscal_projects ?? [];
  return (
    <div className="mt-4 grid gap-4 text-(length:--jeju-text-sm)">
      {context.document_facts.length ? <div>
        <p className="flex items-center gap-2 font-extrabold text-(--jeju-text-strong)">지원기준·근거(승인된 문서) <Badge variant="success">검토·승인</Badge></p>
        {context.document_facts.length ? (
          <ul className="mt-2 grid gap-2">
            {context.document_facts.map((fact) => (
              <li key={fact.statement_id} className="rounded-lg border border-(--jeju-hairline) p-3">
                <p><strong>{fact.predicate_label}</strong> · {fact.value}{fact.unit ? " " + fact.unit : ""}</p>
                {fact.evidence[0]?.quote ? <p className="mt-1 text-muted-foreground">근거: “{fact.evidence[0].quote}”{fact.evidence[0].layout_page_start ? " (" + fact.evidence[0].layout_page_start + "쪽 부근)" : ""}</p> : null}
                <p className="mt-1 text-muted-foreground">{fact.source.issuer} · {fact.source.title}{fact.source.published_date ? " · " + fact.source.published_date : ""}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div> : null}
      {links.length ? <div>
        <p className="flex items-center gap-2 font-extrabold text-(--jeju-text-strong)">연결된 공개 예산 <Badge variant="success">검토된 연결</Badge></p>
        <ul className="mt-2 grid gap-1">
          {links.map((link) => <li key={link.fiscal_project_id}><span className="font-bold">사업코드 {link.fiscal_project_id}</span> <a className={LINK} href="/budget">복지예산에서 보기</a>{link.reviewed_at ? <span className="text-muted-foreground"> · 검토 {link.reviewed_at.slice(0, 10)}</span> : null}</li>)}
        </ul>
      </div> : null}
      {context.news.items.length ? <div>
        <p className="flex items-center gap-2 font-extrabold text-(--jeju-text-strong)">관련 보도 링크 <Badge variant="warning">제목 일치·미확인</Badge></p>
        {context.news.items.length ? (
          <ul className="mt-2 grid gap-1">
            {context.news.items.map((item) => (
              <li key={item.article_id}>
                <a className={LINK} href={item.original_url} target="_blank" rel="noopener noreferrer">{item.title}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>
                <span className="text-muted-foreground"> · {item.issued_by} · {item.published_date ?? "게시일 미확인"}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-muted-foreground">{context.news.note} 기준: {context.news.link_basis}</p>
      </div> : null}
      <p className="text-(length:--jeju-text-xs) text-muted-foreground">사업 자료 기준일 {context.basis.effective_reference_date ?? "-"}</p>
    </div>
  );
}
