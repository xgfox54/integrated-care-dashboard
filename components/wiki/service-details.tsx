"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ExternalLinkIcon } from "@/components/ui/jeju-icons";
import { Spinner } from "@/components/ui/spinner";
import { PublicInfoPanel } from "@/components/wiki/public-info-panel";
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
  const linkClass = "inline-flex items-center gap-1 font-bold text-primary underline underline-offset-4";

  return (
    <article className="space-y-4" aria-labelledby="wiki-service-name">
      <header className="rounded-xl border border-border bg-card p-5">
        <p className="text-(length:--jeju-text-sm) font-bold text-primary">
          {[row.sido, row.sigungu].filter(Boolean).join(" · ") || "전국"}
        </p>
        <h2 id="wiki-service-name" className="mt-1 text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">{row.name}</h2>
        <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">
          {[row.category, row.subcategory, row.type].filter(Boolean).join(" · ")}
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="official-description-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="official-description-heading" className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">사업 설명</h3>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <dl className="mt-4 grid gap-5 text-(length:--jeju-text-base)">
          <div>
            <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">사업명</dt>
            <dd className="mt-1 text-(length:--jeju-text-md) font-extrabold text-(--jeju-text-strong)">{article.name}</dd>
          </div>
          <div>
            <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">사업개요</dt>
            <dd className="mt-1 leading-relaxed">{article.overview}</dd>
          </div>
          <div>
            <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">사업내용</dt>
            <dd className="mt-1 whitespace-pre-line leading-relaxed">{article.content}</dd>
          </div>
          <div>
            <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">사업분야</dt>
            <dd className="mt-1 leading-relaxed">{article.category || "원자료에 별도 기재 없음"}</dd>
          </div>
          <div>
            <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">사업구분</dt>
            <dd className="mt-1 leading-relaxed">{article.type || "원자료에 별도 기재 없음"}</dd>
          </div>
          {article.applicationConditions ? (
            <div>
              <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">신청조건</dt>
              <dd className="mt-1 whitespace-pre-line leading-relaxed">{article.applicationConditions}</dd>
              <p className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">{article.conditionsBasis}</p>
            </div>
          ) : null}
          {displayRow.applicationMethod ? (
            <div>
              <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">신청방법</dt>
              <dd className="mt-1 whitespace-pre-line leading-relaxed">{displayRow.applicationMethod}</dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-5 grid gap-3 border-t border-(--jeju-hairline) pt-4 text-(length:--jeju-text-sm) sm:grid-cols-2">
          <div>
            <p className="font-bold text-muted-foreground">제공기관</p>
            <p className="mt-1 whitespace-pre-line">{displayRow.provider || "원자료에 별도 기재 없음"}</p>
          </div>
          <div>
            <p className="font-bold text-muted-foreground">자료 기준</p>
            <p className="mt-1">{row.updatedDate || "보건복지부 최신 수집본"}</p>
          </div>
        </div>
        {row.detailUrl ? (
          <a
            href={row.detailUrl}
            target="_blank"
            rel="noreferrer"
            className={`mt-4 text-(length:--jeju-text-sm) ${linkClass}`}
          >
            이 사업이 수록된 보건복지부 원문 확인
            <ExternalLinkIcon />
            <span className="sr-only">(새 창)</span>
          </a>
        ) : null}
        {welfareSlug ? (
          <p className="mt-3 text-(length:--jeju-text-sm)">
            <a
              href={"/welfare100/" + encodeURIComponent(welfareSlug)}
              target="_blank"
              rel="noopener"
              onClick={() => usageClick("wiki_welfare100")}
              className={linkClass}
            >
              복지제도100에서 세부 내용 확인하기
              <ExternalLinkIcon />
              <span className="sr-only">(새 창)</span>
            </a>
          </p>
        ) : null}
        {article.supplement ? (
          <div className="mt-4 rounded-lg border border-border bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm)">
            <p className="font-extrabold text-(--jeju-text-strong)">상세내용 보완 출처</p>
            <p className="mt-1 text-muted-foreground">
              {article.supplement.publisher} · {article.supplement.sourceTitle}
            </p>
            <a
              href={article.supplement.url}
              target="_blank"
              rel="noreferrer"
              className={`mt-2 ${linkClass}`}
            >
              공식 보완자료 원문 확인
              <ExternalLinkIcon />
              <span className="sr-only">(새 창)</span>
            </a>
          </div>
        ) : null}
        {article.adminSource ? (
          <div className="mt-4 rounded-lg border border-border bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm)">
            <p className="font-extrabold text-(--jeju-text-strong)">관리자 보완 출처</p>
            <p className="mt-1 text-muted-foreground">{article.adminSource.title}</p>
            <a
              href={article.adminSource.url}
              target="_blank"
              rel="noreferrer"
              className={`mt-2 ${linkClass}`}
            >
              보완 출처 원문 확인
              <ExternalLinkIcon />
              <span className="sr-only">(새 창)</span>
            </a>
          </div>
        ) : null}
      </section>

      <WikiContext implementationId={serviceWikiKey(row)} />
      <PublicInfoPanel implementationId={serviceWikiKey(row)} />

      {loading ? (
        <p className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-(length:--jeju-text-sm) text-muted-foreground">
          <Spinner label="보완 설명을 확인하는 중" />
          사업명이 정확히 일치하는 보완 설명을 확인하고 있습니다.
        </p>
      ) : source ? (
        <WikiSourceCard source={source} />
      ) : null}
    </article>
  );
}
