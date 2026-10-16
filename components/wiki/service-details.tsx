"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ExternalLinkIcon } from "@/components/ui/jeju-icons";
import { Spinner } from "@/components/ui/spinner";
import { PublicInfoPanel } from "@/components/wiki/public-info-panel";
import { LifecyclePanel } from "@/components/wiki/lifecycle-panel";
import { WikiContext } from "@/components/wiki/wiki-context";
import { WikiSourceCard, type WikiSource } from "@/components/wiki/wiki-source-card";
import { serviceWikiKey, type ServiceRow } from "@/lib/dataset";
import { createWikiArticle } from "@/lib/wiki-article";
import { usageClick } from "@/lib/usage/track";
import { applyWikiEdit, EDIT_FIELDS, type PublicWikiEdit, type WikiEditValues } from "@/lib/wiki-edits";
import { getVerifiedWikiSupplement } from "@/lib/wiki-verified-supplements";

interface Welfare100Link {
  readonly serviceId: string;
  readonly slug: string;
}

interface LoadedEdit {
  readonly serviceId: string;
  readonly edit: PublicWikiEdit | null;
}

function publicEdit(payload: unknown): PublicWikiEdit | null {
  if (typeof payload !== "object" || payload === null || !("edit" in payload)) return null;
  const edit = payload.edit;
  if (typeof edit !== "object" || edit === null) return null;
  const record = edit as Record<string, unknown>;
  const values = Object.fromEntries(
    EDIT_FIELDS.map((field) => {
      const value = record[field];
      return [field, typeof value === "string" && value.trim() ? value : null];
    }),
  ) as WikiEditValues;
  return { ...values, updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0 };
}

function welfare100Slug(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("match" in payload)) return null;
  const match = payload.match;
  if (typeof match !== "object" || match === null || !("slug" in match) || typeof match.slug !== "string") return null;
  return /^[A-Za-z0-9_-]+$/.test(match.slug) ? match.slug : null;
}

function wikiSource(payload: unknown): WikiSource | null {
  if (typeof payload !== "object" || payload === null || !("source" in payload)) {
    return null;
  }
  const source = payload.source;
  if (
    typeof source !== "object" ||
    source === null ||
    !("tier" in source) ||
    (source.tier !== "bokjiro" && source.tier !== "local") ||
    !("label" in source) || typeof source.label !== "string" ||
    !("title" in source) || typeof source.title !== "string" ||
    !("summary" in source) || typeof source.summary !== "string" ||
    !("publisher" in source) || typeof source.publisher !== "string" ||
    !("url" in source) || typeof source.url !== "string" ||
    !("matchedTerm" in source) || typeof source.matchedTerm !== "string"
  ) {
    return null;
  }
  return {
    tier: source.tier,
    label: source.label,
    title: source.title,
    summary: source.summary,
    publisher: source.publisher,
    url: source.url,
    matchedTerm: source.matchedTerm,
    sectionId: "sectionId" in source && typeof source.sectionId === "string"
      ? source.sectionId
      : undefined,
    heading: "heading" in source && typeof source.heading === "string"
      ? source.heading
      : undefined,
    startLine: "startLine" in source && typeof source.startLine === "number"
      ? source.startLine
      : undefined,
    endLine: "endLine" in source && typeof source.endLine === "number"
      ? source.endLine
      : undefined,
    sourceSha256: "sourceSha256" in source && typeof source.sourceSha256 === "string"
      ? source.sourceSha256
      : undefined,
    sourceDatabaseSha256:
      "sourceDatabaseSha256" in source && typeof source.sourceDatabaseSha256 === "string"
        ? source.sourceDatabaseSha256
        : undefined,
  };
}

export function ServiceDetails({ row }: { readonly row: ServiceRow }) {
  const [source, setSource] = useState<WikiSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedEdit, setLoadedEdit] = useState<LoadedEdit | null>(null);
  const [welfareLink, setWelfareLink] = useState<Welfare100Link | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const serviceId = row.serviceId;
    void fetch("/api/wiki/edit?serviceId=" + encodeURIComponent(serviceId), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? publicEdit(await response.json()) : null))
      .then((edit) => {
        if (!controller.signal.aborted) setLoadedEdit({ serviceId, edit });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadedEdit({ serviceId, edit: null });
      });
    return () => controller.abort();
  }, [row.serviceId]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      name: row.name,
      sido: row.sido,
      sigungu: row.sigungu,
    });
    void fetch(`/api/wiki?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("설명 출처를 불러오지 못했습니다.");
        const payload: unknown = await response.json();
        return wikiSource(payload);
      })
      .then((nextSource) => {
        if (!controller.signal.aborted) setSource(nextSource);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSource(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [row]);

  useEffect(() => {
    const controller = new AbortController();
    const serviceId = row.serviceId;
    const params = new URLSearchParams({ name: row.name, sido: row.sido, sigungu: row.sigungu, type: row.type });
    void fetch("/api/wiki/welfare100?" + params.toString(), { signal: controller.signal })
      .then(async (response) => (response.ok ? welfare100Slug(await response.json()) : null))
      .then((slug) => {
        if (!controller.signal.aborted) setWelfareLink(slug ? { serviceId, slug } : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setWelfareLink(null);
      });
    return () => controller.abort();
  }, [row.serviceId, row.name, row.sido, row.sigungu, row.type]);

  const welfareSlug = welfareLink?.serviceId === row.serviceId ? welfareLink.slug : null;
  const verifiedSupplement = getVerifiedWikiSupplement(row.serviceId);
  const adminEdit = loadedEdit?.serviceId === row.serviceId ? loadedEdit.edit : null;
  const displayRow = applyWikiEdit(row, adminEdit ?? undefined);
  const article = createWikiArticle(row, {
    exactMatchSummary: source?.summary,
    verifiedSupplement,
    adminEdit,
  });
  const status = article.contentStatus === "admin-edited"
    ? { label: "관리자 보완", variant: "neutral" as const }
    : article.contentStatus === "verified-supplement"
      ? { label: "공식 보완자료 포함", variant: "info" as const }
      : { label: "보건복지부 원자료 기준", variant: "success" as const };
  const linkClass = "inline-flex max-w-full items-center gap-1.5 font-bold text-primary underline decoration-(--jeju-blue-light-strong) underline-offset-4 hover:decoration-current";
  const fieldLabelClass = "text-(length:--jeju-text-sm) font-bold text-muted-foreground";
  const fieldBodyClass = "mt-2 whitespace-pre-line leading-[1.85] text-(--jeju-text-body)";

  return (
    <article className="min-w-0 space-y-5 [overflow-wrap:anywhere]" aria-labelledby="wiki-service-name">
      <div className="min-w-0 rounded-(--jeju-radius-lg) border border-border bg-card">
        <header className="border-b border-border px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="flex min-w-0 items-center gap-2 text-(length:--jeju-text-sm) font-bold text-(--jeju-secondary-strong)">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--jeju-green)" />
              <span>{[row.sido, row.sigungu].filter(Boolean).join(" · ") || "전국"}</span>
            </p>
            <Badge variant={status.variant} className="max-w-full whitespace-normal leading-normal">{status.label}</Badge>
          </div>
          <h2 id="wiki-service-name" className="mt-4 max-w-[32em] text-(length:--jeju-text-2xl) leading-[1.4] font-extrabold tracking-tight text-(--jeju-text-strong)">{row.name}</h2>
          {[row.category, row.subcategory, row.type].some(Boolean) ? (
            <p className="mt-3 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
              {[row.category, row.subcategory, row.type].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </header>

        <section className="px-5 py-6 sm:px-8 sm:py-8" aria-labelledby="official-description-heading">
          <div className="mx-auto max-w-[82ch]">
            <h3 id="official-description-heading" className="flex items-center gap-2.5 text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">
              <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full bg-(--jeju-orange)" />
              사업 설명
            </h3>
            <dl className="mt-6 grid min-w-0 grid-cols-1 gap-x-8 gap-y-6 text-(length:--jeju-text-base) sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <dt className={fieldLabelClass}>사업명</dt>
                <dd className="mt-2 font-bold leading-relaxed text-(--jeju-text-strong)">{article.name}</dd>
              </div>
              <div className="min-w-0 border-t border-(--jeju-hairline) pt-6 sm:col-span-2">
                <dt className={fieldLabelClass}>사업개요</dt>
                <dd className="mt-2 text-(length:--jeju-text-md) leading-[1.85] text-(--jeju-text-strong)">{article.overview}</dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className={fieldLabelClass}>사업내용</dt>
                <dd className={fieldBodyClass}>{article.content}</dd>
              </div>
              <div className="min-w-0 border-t border-(--jeju-hairline) pt-5">
                <dt className={fieldLabelClass}>사업분야</dt>
                <dd className={fieldBodyClass}>{article.category || "원자료에 별도 기재 없음"}</dd>
              </div>
              <div className="min-w-0 border-t border-(--jeju-hairline) pt-5">
                <dt className={fieldLabelClass}>사업구분</dt>
                <dd className={fieldBodyClass}>{article.type || "원자료에 별도 기재 없음"}</dd>
              </div>
              {article.applicationConditions ? (
                <div className="min-w-0 border-t border-(--jeju-hairline) pt-6 sm:col-span-2">
                  <dt className={fieldLabelClass}>신청조건</dt>
                  <dd className={fieldBodyClass}>{article.applicationConditions}</dd>
                  <dd className="mt-2 text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground">{article.conditionsBasis}</dd>
                </div>
              ) : null}
              {displayRow.applicationMethod ? (
                <div className="min-w-0 sm:col-span-2">
                  <dt className={fieldLabelClass}>신청방법</dt>
                  <dd className={fieldBodyClass}>{displayRow.applicationMethod}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </section>

        <footer className="rounded-b-(--jeju-radius-lg) border-t border-border bg-(--jeju-surface-inset) px-5 py-5 sm:px-8 sm:py-6">
          <div className="mx-auto max-w-[82ch]">
            <dl className="grid min-w-0 gap-5 text-(length:--jeju-text-sm) sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="font-bold text-muted-foreground">제공기관</dt>
                <dd className="mt-1.5 whitespace-pre-line leading-relaxed text-(--jeju-text-body)">{displayRow.provider || "원자료에 별도 기재 없음"}</dd>
              </div>
              <LifecyclePanel serviceId={row.serviceId} fallbackBasis={row.updatedDate} />
            </dl>
            {row.detailUrl ? (
              <p className="mt-4 text-(length:--jeju-text-sm) leading-relaxed">
                <a
                  href={row.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={linkClass}
                >
                  <span className="min-w-0">이 사업이 수록된 보건복지부 원문 확인</span>
                  <ExternalLinkIcon />
                  <span className="sr-only">(새 창)</span>
                </a>
              </p>
            ) : null}
            {welfareSlug ? (
              <p className="mt-3 text-(length:--jeju-text-sm) leading-relaxed">
                <a
                  href={"/welfare100/" + encodeURIComponent(welfareSlug)}
                  target="_blank"
                  rel="noopener"
                  onClick={() => usageClick("wiki_welfare100")}
                  className={linkClass}
                >
                  <span className="min-w-0">복지제도100에서 세부 내용 확인하기</span>
                  <ExternalLinkIcon />
                  <span className="sr-only">(새 창)</span>
                </a>
              </p>
            ) : null}
            {article.supplement ? (
              <div className="mt-5 border-t border-border pt-4 text-(length:--jeju-text-sm) leading-relaxed">
                <p className="font-bold text-(--jeju-text-strong)">상세내용 보완 출처</p>
                <p className="mt-1 text-muted-foreground">
                  {article.supplement.publisher} · {article.supplement.sourceTitle}
                </p>
                <a
                  href={article.supplement.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-2 ${linkClass}`}
                >
                  <span className="min-w-0">공식 보완자료 원문 확인</span>
                  <ExternalLinkIcon />
                  <span className="sr-only">(새 창)</span>
                </a>
              </div>
            ) : null}
            {article.adminSource ? (
              <div className="mt-5 border-t border-border pt-4 text-(length:--jeju-text-sm) leading-relaxed">
                <p className="font-bold text-(--jeju-text-strong)">관리자 보완 출처</p>
                <p className="mt-1 text-muted-foreground">{article.adminSource.title}</p>
                <a
                  href={article.adminSource.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-2 ${linkClass}`}
                >
                  <span className="min-w-0">보완 출처 원문 확인</span>
                  <ExternalLinkIcon />
                  <span className="sr-only">(새 창)</span>
                </a>
              </div>
            ) : null}
          </div>
        </footer>
      </div>

      <WikiContext implementationId={serviceWikiKey(row)} />
      <PublicInfoPanel implementationId={serviceWikiKey(row)} />

      {loading ? (
        <p className="flex min-w-0 items-start gap-2 rounded-(--jeju-radius-lg) border border-border bg-card px-5 py-4 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
          <Spinner label="보완 설명을 확인하는 중" />
          <span className="min-w-0">사업명이 정확히 일치하는 보완 설명을 확인하고 있습니다.</span>
        </p>
      ) : source ? (
        <WikiSourceCard source={source} />
      ) : null}
    </article>
  );
}
