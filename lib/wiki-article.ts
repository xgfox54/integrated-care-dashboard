import type { ServiceRow } from "./dataset.ts";
import { applyWikiEdit, hasWikiEditValues, type PublicWikiEdit } from "./wiki-edits.ts";
import type { VerifiedWikiSupplement } from "./wiki-verified-supplements.ts";

export interface WikiArticle {
  readonly name: string;
  readonly overview: string;
  readonly content: string;
  readonly category: string;
  readonly type: string;
  readonly contentStatus: "official-row" | "verified-supplement" | "admin-edited" | "unavailable";
  readonly applicationConditions?: string;
  readonly conditionsBasis?: string;
  readonly supplement?: VerifiedWikiSupplement;
  readonly adminSource?: { readonly title: string; readonly url: string };
}

export interface WikiArticleOptions {
  readonly exactMatchSummary?: string;
  readonly verifiedSupplement?: VerifiedWikiSupplement | null;
  readonly adminEdit?: PublicWikiEdit | null;
}

const EMPTY_VALUES = new Set([
  "-",
  "없음",
  "해당 없음",
  "해당없음",
  "미상",
  "미정",
  "원문 참조",
  "별도 확인",
]);

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function meaningful(value: string): string {
  const normalized = oneLine(value);
  return EMPTY_VALUES.has(normalized) ? "" : normalized;
}

function location(row: Pick<ServiceRow, "sido" | "sigungu">): string {
  return [row.sido, row.sigungu].map(oneLine).filter(Boolean).join(" ") || "전국";
}

function unavailableOverview(row: ServiceRow): string {
  return `${location(row)}의 ${oneLine(row.name)} 사업입니다. 공개 원자료에서 요약 설명을 확인할 수 없습니다.`;
}

function unavailableContent(): string {
  return "공개된 보건복지부 원자료와 검증된 보완자료에서 상세 사업내용을 확인할 수 없습니다. 연결된 보건복지부 원문에서 최신 내용을 확인해 주세요.";
}

function detailedContent(row: ServiceRow, description: string): string {
  const name = oneLine(row.name);
  const shortDescription = oneLine(description).replace(/[.!?]+$/, "");
  const compactName = name.replace(/\s+/g, "");
  const descriptionNamesBusiness = [compactName, `${compactName}지원`, `${compactName}사업`, `${compactName}지원사업`]
    .includes(shortDescription.replace(/\s+/g, ""));
  const title = descriptionNamesBusiness ? shortDescription : name;
  const businessName = title.endsWith("사업") ? title : `${title} 사업`;
  const parts = [`${location(row)}에서 제공하는 ${businessName}입니다.`];
  const provider = meaningful(row.provider);
  if (provider) parts.push(`제공기관은 ${provider}입니다.`);
  const introduction = parts.join(" ");
  if (descriptionNamesBusiness) {
    return introduction;
  }
  return `${introduction}\n\n${description}`;
}

export function createWikiArticle(
  sourceRow: ServiceRow,
  options: WikiArticleOptions = {},
): WikiArticle {
  const adminEdit = options.adminEdit ?? null;
  const row = applyWikiEdit(sourceRow, adminEdit ?? undefined);
  const description = meaningful(row.description);
  const exactMatchSummary = meaningful(options.exactMatchSummary ?? "");
  const verified = options.verifiedSupplement ?? null;
  const editedDescription = adminEdit?.description != null;
  const editedConditions = adminEdit?.target != null || adminEdit?.detailTarget != null;
  const verifiedText = editedDescription ? null : verified;
  const verifiedEligibility = editedConditions ? "" : verified?.eligibility ?? "";
  const rowConditions = [...new Set(
    [meaningful(row.target), meaningful(row.detailTarget)].filter(Boolean),
  )].join("\n");
  const applicationConditions = verifiedEligibility || rowConditions || "";
  const adminContent = adminEdit?.content?.trim() ?? "";
  const usesVerified = Boolean(verifiedText || verifiedEligibility);
  const contentStatus = adminEdit && hasWikiEditValues(adminEdit)
    ? "admin-edited"
    : verified
      ? "verified-supplement"
      : description
        ? "official-row"
        : exactMatchSummary
          ? "verified-supplement"
          : "unavailable";

  return {
    name: oneLine(row.name),
    overview: oneLine(
      verifiedText?.overview || description || exactMatchSummary || unavailableOverview(row),
    ),
    content: detailedContent(
      row,
      adminContent || verifiedText?.content || description || exactMatchSummary || unavailableContent(),
    ),
    category: [meaningful(row.category), meaningful(row.subcategory)].filter(Boolean).join(" · "),
    type: meaningful(row.type),
    contentStatus,
    ...(applicationConditions
      ? {
          applicationConditions,
          conditionsBasis: verifiedEligibility
            ? "검증된 공식 보완자료의 지원대상 기준"
            : editedConditions
              ? "관리자가 확인한 지원대상 기준"
              : "보건복지부 원자료의 지원대상 기준",
        }
      : {}),
    ...(verified && usesVerified ? { supplement: verified } : {}),
    ...(adminEdit?.sourceUrl
      ? { adminSource: { title: adminEdit.sourceTitle || "관리자 보완 출처", url: adminEdit.sourceUrl } }
      : {}),
  };
}
