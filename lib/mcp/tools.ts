// 공개 원격 MCP 도구 17개. 저장된 공개 자료만 읽고(읽기 전용·멱등·외부 미접속), 각 결과에 공개본·기준일·범위·근거를 붙인다.
// 보도자료는 제목·기관·날짜·원문 주소·분류 같은 메타데이터만 돌려주며 본문·요약을 만들지 않는다.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SERVICE_CATEGORY_ORDER, serviceWikiKey, type ServiceRow } from "../dataset.ts";
import { readPressCoverage } from "../press/coverage.ts";
import { CATEGORY_LABELS } from "../press/dictionary.ts";
import { toPressDto, type PressItemRow } from "../press/query.ts";
import { REGION_DEFINITIONS } from "../region-statistics.ts";
import { createWikiArticle } from "../wiki-article.ts";
import { getVerifiedWikiSupplement } from "../wiki-verified-supplements.ts";
import {
  type Basis,
  type BundleComponents,
  type Coverage,
  decodeCursor,
  EMPTY_BASIS,
  encodeCursor,
  type Envelope,
  fingerprint,
  LIMITS,
  MCP_SCHEMA_VERSION,
  McpToolError,
  type McpToolName,
  pageLimit,
  PUBLIC_MCP_TOOL_NAMES,
} from "./contract.ts";
import { registerIntegrationTools } from "./integration-tools.ts";
import { type KnowledgeRun, type McpData, type NewsFilter, type OrganizationRow, type SourceDocument } from "./data.ts";
import { compareBudgetPeriods, findBudgetProjects, fiscalComponent, FISCAL_TOOL_SHAPES, getBudgetExecution, getFiscalCatalog } from "./fiscal.ts";
import { publishedSnapshots } from "../fiscal/query.ts";
import { type BundleRow, readActiveBundle, readBundle } from "../platform/bundle.ts";
import { verifiedLinksFor } from "../platform/links.ts";
import { DOCUMENT_PREDICATES } from "../imports/pack.ts";
import { ledgerTotals } from "../official-ledger.ts";
import { readOptionalIndexes } from "../optional-index.ts";
import { unitVerificationSql } from "../fiscal/unit-check.ts";
import { presenceBaseline, presenceByServiceId, presenceRun, presenceSummaryDto, temporalDto } from "../service-presence.ts";
import { allDocumentFacts, documentComponent, documentEvidence as documentEvidenceRows, documentFactDto, documentFactsFor, documentSourceRows, searchDocumentPrograms, type DocFactRow } from "../imports/public.ts";

export interface McpToolContext {
  readonly data: McpData;
  /** 사이트 주소(WIKI 링크용). 요청 주소에서 정하며 도구 입력으로 받지 않는다. */
  readonly baseUrl: string;
  readonly nowSeconds?: () => number;
  readonly onUnexpectedError?: (error: unknown, tool: string) => void;
}

interface PublicState {
  readonly run: KnowledgeRun | null;
  readonly bundleId: string;
  readonly components: BundleComponents;
  readonly newsRegistryVersion: string;
  readonly newsPublicItems: number;
  /** 공개본에 고정된 재정 snapshot(없으면 null: 고정 안 함). */
  readonly fiscalPin: readonly string[] | null;
  /** 공개본에 고정된 문서 사실 (반입 ID|원문 버전) 목록(null이면 현재 활성 목록). */
  readonly documentPin: readonly string[] | null;
  readonly bundle: BundleRow | null;
}

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const ELIGIBILITY_PREDICATES: ReadonlySet<string> = new Set(["target_group", "eligibility", "exclusion", "application_period", "application_method", "application_place", "required_documents"]);
const KNOWLEDGE_SCOPE = "보건복지부 통합돌봄 사업안내(시·군·구별 서비스 메뉴판)에 수록된 시행사업";
const KNOWLEDGE_GAP = "보건복지부 사업안내에 수록되지 않은 지역 자체사업은 포함하지 않습니다. 결과가 없다고 해당 사업이 없다는 뜻은 아닙니다.";
const NEWS_GAPS = [
  "공식 보도자료(OFFICIAL_PRESS_RELEASE)만 수록합니다. 민간 언론 기사(NEWS_ARTICLE)는 수집하지 않습니다.",
  "정책 승인되고 활성화된 기관 게시판만 수집합니다. 미승인·robots 차단·검토 중 기관은 포함되지 않습니다(get_news_archive_status 참조).",
  "검색 결과가 없다고 해당 기관이 보도자료를 내지 않았다는 뜻은 아닙니다.",
];
const METADATA_ONLY = "본문·요약 미제공(메타데이터 전용). 내용은 원문 주소에서 확인하세요.";

const SIDO_NAMES: ReadonlySet<string> = new Set(REGION_DEFINITIONS.map((region) => region.fullName));
const ORG_TYPES = ["CENTRAL", "METROPOLITAN", "BASIC_CITY", "BASIC_COUNTY", "AUTONOMOUS_DISTRICT", "ADMINISTRATIVE_CITY", "GENERAL_DISTRICT"] as const;
const NEWS_CATEGORY_IDS = Object.keys(CATEGORY_LABELS) as [string, ...string[]];

/** 대상자 묶음. 공개 원문(대상·세부대상·사업명)에 이 낱말이 들어 있는지만 본다. 개인 자격 판정이 아니다. */
export const TARGET_GROUPS: Readonly<Record<string, { readonly label: string; readonly keywords: readonly string[] }>> = {
  "target:elderly": { label: "노인", keywords: ["노인", "어르신", "65세"] },
  "target:dementia": { label: "치매", keywords: ["치매"] },
  "target:disabled": { label: "장애인", keywords: ["장애"] },
  "target:child": { label: "아동", keywords: ["아동", "영유아", "어린이"] },
  "target:youth": { label: "청소년·청년", keywords: ["청소년", "청년"] },
  "target:low_income": { label: "저소득", keywords: ["기초생활", "수급자", "차상위", "저소득", "중위소득"] },
  "target:single_household": { label: "1인 가구·독거", keywords: ["독거", "1인 가구", "1인가구", "홀로"] },
  "target:caregiver": { label: "가족돌봄자·보호자", keywords: ["보호자", "가족돌봄", "돌봄가족"] },
  "target:discharged_patient": { label: "퇴원환자", keywords: ["퇴원"] },
};
const TARGET_GROUP_IDS = Object.keys(TARGET_GROUPS) as [string, ...string[]];

// ---------- 입력 스키마 조각 ----------
function validDate(value: string): boolean {
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식이어야 합니다.").refine(validDate, "존재하지 않는 날짜입니다.");
const cursorInput = z.string().max(400).optional().describe("이전 응답의 next_cursor. 조건이나 공개본이 바뀌면 거절됩니다.");
const limitInput = (max: number = LIMITS.listMax, fallback: number = LIMITS.listDefault) =>
  z.number().int().min(1).max(max).optional().describe("한 번에 받을 개수. 기본 " + fallback + ", 최대 " + max + ".");
const bundleInput = z.string().max(120).optional().describe("get_dataset_status가 알려 준 release_bundle_id. 현재 공개본과 다르면 거절됩니다.");
const snapshotInput = z.string().max(120).optional().describe("knowledge 구성요소 ID(components.knowledge). 현재 공개본과 다르면 거절됩니다.");
const asOfInput = dateInput.optional().describe("조회 기준일. 생략하면 마지막 공개본 수집일. 보관하지 않는 이전 시점은 거절됩니다.");
const regionInput = z.string().max(80).describe("지역 ID. region:<시·도 정식명칭> 또는 region:<시·도>|<시·군·구>. 예: region:강원특별자치도|강릉시");
const queryInput = z.string().max(LIMITS.queryMax);
const implementationInput = z.string().min(9).max(LIMITS.idMax).describe("시행사업 ID(service:로 시작) 또는 문서 정의 사업 ID(docprog:로 시작). find_programs·search 결과의 implementation_id/id.");

// ---------- 공통 도우미 ----------
function kstDate(seconds: number): string {
  return new Date((seconds + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

function tokens(query: string | undefined): string[] {
  return (query ?? "").split(/\s+/).map((token) => token.trim()).filter(Boolean).slice(0, 5);
}

export function regionIdOf(sido: string, sigungu: string): string {
  return sigungu ? "region:" + sido + "|" + sigungu : "region:" + sido;
}

export function parseRegionId(regionId: string): { sido: string; sigungu: string } {
  const match = /^region:([^|]{2,20})(?:\|([^|]{1,30}))?$/.exec(regionId.trim());
  if (!match || !SIDO_NAMES.has(match[1])) {
    throw new McpToolError("REGION_ID_INVALID", "지역 ID가 올바르지 않습니다. get_ontology_schema(section=\"code_systems\")의 region 목록을 확인해 주세요.");
  }
  return { sido: match[1], sigungu: match[2] ?? "" };
}

function parseCategoryId(categoryId: string): { category: string; subcategory: string } {
  const match = /^category:([^|]{1,30})(?:\|([^|]{1,60}))?$/.exec(categoryId.trim());
  if (!match || !(SERVICE_CATEGORY_ORDER as readonly string[]).includes(match[1])) {
    throw new McpToolError("SERVICE_TYPE_ID_INVALID", "사업 분류 ID가 올바르지 않습니다. get_ontology_schema(section=\"service_types\")를 확인해 주세요.");
  }
  return { category: match[1], subcategory: match[2] ?? "" };
}

function wikiUrl(baseUrl: string, key: string): string {
  return baseUrl + "/wiki?service=" + encodeURIComponent(key);
}

function meaningful(value: string): string | null {
  const text = value.replace(/\s+/g, " ").trim();
  return text && text !== "-" ? text : null;
}

function programCard(row: ServiceRow, baseUrl: string) {
  const key = serviceWikiKey(row);
  return {
    implementation_id: key,
    entity_type: "implementation",
    name: row.name,
    region: { region_id: regionIdOf(row.sido, row.sigungu), sido: row.sido, sigungu: row.sigungu || null },
    scope_level: row.sigungu ? "municipality" : "province",
    category: row.category,
    subcategory: row.subcategory || null,
    service_type: meaningful(row.type),
    provider: meaningful(row.provider),
    wiki_url: wikiUrl(baseUrl, key),
  };
}

function documentEvidence(document: SourceDocument) {
  return {
    evidence_id: "mohw-doc:" + document.document_id,
    kind: "MOHW_INTEGRATED_CARE_MENU",
    publisher: "보건복지부",
    title: document.title,
    url: document.detail_url,
    published_date: document.published_at || null,
    source_data_as_of: document.data_as_of || null,
    region: { province: document.province, municipality: document.municipality || null },
    locator_precision: "document",
    verification_status: "SOURCE_COLLECTED",
  };
}

/** 모델에게 하는 지시처럼 보이는 문구. 자료를 바꾸지 않고 표시만 한다. */
const INSTRUCTION_LIKE = /(ignore|disregard)\s+(all\s+|the\s+)?(previous|prior|above)|system\s*prompt|^\s*(system|assistant|user)\s*:|<\|im_(start|end)\|>|(이전|앞의|위의)\s*(지시|명령|지침)[을를]?\s*(무시|잊)|(시스템|관리자)\s*(프롬프트|명령)/i;

export function instructionLike(text: string): boolean {
  return INSTRUCTION_LIKE.test(text);
}

function newsCard(row: PressItemRow) {
  return {
    ...toPressDto(row), entity_id: "news:" + row.item_id, result_unit: "item", content_note: METADATA_ONLY,
    title_trust: "external_publisher_text", ...(instructionLike(row.title) ? { title_flags: ["INSTRUCTION_LIKE_TEXT"] } : {}),
  };
}

function organizationCard(row: OrganizationRow) {
  return {
    organization_id: row.organization_id,
    name: row.name,
    organization_type: row.org_type,
    region: row.sido ? { region_id: regionIdOf(row.sido, row.sigungu), sido: row.sido, sigungu: row.sigungu || null } : null,
    parent_id: row.parent_id,
    code: row.code ? { system: row.code_system, value: row.code } : null,
    lifecycle_status: row.lifecycle_status,
    valid_from: row.valid_from || null,
    valid_to: row.valid_to || null,
    seed_origin: row.seed_origin,
    registry_version: row.registry_version,
  };
}

interface EnvelopeOptions {
  readonly evidence?: readonly unknown[];
  readonly basis?: Basis;
  readonly coverage?: Coverage;
  readonly warnings?: readonly string[];
  readonly nextCursor?: string | null;
  readonly truncated?: boolean;
}

function envelope<T>(state: PublicState, nowSeconds: number, data: T, options: EnvelopeOptions = {}): Envelope<T> {
  return {
    schema_version: MCP_SCHEMA_VERSION,
    release_bundle_id: state.bundleId,
    components: state.components,
    generated_at: new Date(nowSeconds * 1000).toISOString(),
    data,
    evidence: options.evidence ?? [],
    basis: options.basis ?? EMPTY_BASIS,
    coverage: options.coverage ?? { scope: "stored_approved_dataset", complete: false, gaps: [] },
    warnings: options.warnings ?? [],
    next_cursor: options.nextCursor ?? null,
    truncated: options.truncated ?? Boolean(options.nextCursor),
  };
}

function toolResult(value: object) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function errorResult(code: string, message: string) {
  const value = { error: { code, message } };
  return { ...toolResult(value), isError: true };
}

// ---------- 서버에 17개 도구 등록 ----------
export function registerWelfareTools(server: McpServer, context: McpToolContext): McpToolName[] {
  const { data, baseUrl } = context;
  const now = context.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const registered: McpToolName[] = [];
  let statePromise: Promise<PublicState> | null = null;

  async function loadState(): Promise<PublicState> {
    // 요청 시작 때 활성 통합 공개본 하나를 골라 모든 조회를 그 구성요소로 고정한다(공개본 생성은 배경 작업만 한다).
    const active = await readActiveBundle(data.db);
    if (active) {
      const parsed = JSON.parse(active.components_json) as Record<string, { id?: string | null; detail?: Record<string, unknown> } | undefined>;
      const documentPairs = parsed.documents?.detail?.pairs;
      const watermark = parsed.news?.detail?.discovered_watermark;
      const snapshotIds = parsed.fiscal?.detail?.snapshot_ids;
      const linksWatermark = parsed.links?.detail?.reviewed_watermark;
      data.pin = { runId: active.knowledge_snapshot_id ? active.knowledge_snapshot_id.slice(3) : null, newsWatermark: typeof watermark === "number" ? watermark : 0, linksWatermark: typeof linksWatermark === "number" ? linksWatermark : 0 };
      const [run, news] = await Promise.all([data.latestRun(), data.newsComponent()]);
      return {
        run, bundleId: active.bundle_id,
        components: { knowledge: active.knowledge_snapshot_id, fiscal: active.fiscal_snapshot_id, news: active.news_snapshot_id, links: active.link_snapshot_id, documents: parsed.documents?.id ?? null },
        newsRegistryVersion: news.registryVersion, newsPublicItems: news.publicItems,
        fiscalPin: Array.isArray(snapshotIds) ? snapshotIds.filter((id): id is string => typeof id === "string") : [],
        documentPin: Array.isArray(documentPairs) ? documentPairs.filter((pair): pair is string => typeof pair === "string") : [],
        bundle: active,
      };
    }
    const [run, news, fiscal, documents] = await Promise.all([data.latestRun(), data.newsComponent(), fiscalComponent(data.db), documentComponent(data.db)]);
    const knowledge = run ? "kg:" + run.id : null;
    const newsId = news.registryVersion ? "news:" + news.registryVersion + "@" + (news.dictionaryVersions.join("+") || "none") : null;
    const components: BundleComponents = { knowledge, fiscal, news: newsId, links: null, documents: documents.id };
    return {
      run,
      bundleId: "rb:" + fingerprint(components),
      components,
      newsRegistryVersion: news.registryVersion,
      newsPublicItems: news.publicItems,
      fiscalPin: null,
      documentPin: null,
      bundle: null,
    };
  }

  function state(): Promise<PublicState> {
    statePromise ??= loadState();
    return statePromise;
  }

  async function pinned(input: { release_bundle_id?: string; snapshot_id?: string }): Promise<PublicState> {
    const current = await state();
    if (input.release_bundle_id && input.release_bundle_id !== current.bundleId) {
      if (await readBundle(data.db, input.release_bundle_id)) {
        throw new McpToolError("BUNDLE_SUPERSEDED", "요청한 공개본은 새 공개본으로 바뀌었고 이전 공개본의 자료는 보관하지 않습니다. 현재 공개본은 " + current.bundleId + "입니다.");
      }
      throw new McpToolError("RELEASE_BUNDLE_NOT_AVAILABLE", "요청한 공개본은 현재 제공되지 않습니다. 현재 공개본은 " + current.bundleId + "입니다. get_dataset_status로 확인해 주세요.");
    }
    if (input.snapshot_id && input.snapshot_id !== current.components.knowledge) {
      throw new McpToolError("SNAPSHOT_NOT_AVAILABLE", "요청한 snapshot_id는 현재 제공되지 않습니다. 현재 knowledge 구성요소는 " + (current.components.knowledge ?? "없음") + "입니다.");
    }
    return current;
  }

  function requireRun(current: PublicState): KnowledgeRun {
    if (!current.run) throw new McpToolError("KNOWLEDGE_NOT_AVAILABLE", "공개된 사업 자료가 아직 없습니다.");
    return current.run;
  }

  function knowledgeBasis(run: KnowledgeRun, asOf: string | undefined): Basis {
    const collected = kstDate(run.completedAt);
    if (asOf && asOf < collected) {
      throw new McpToolError("AS_OF_NOT_AVAILABLE", asOf + " 시점의 공개본은 보관하지 않습니다. 현재 공개본은 " + collected + "에 수집한 자료이며 그 이후 날짜만 조회할 수 있습니다.");
    }
    return { requested_reference_date: asOf ?? null, effective_reference_date: collected, news_date_basis: null };
  }

  function knowledgeCoverage(total: number): Coverage {
    return { scope: KNOWLEDGE_SCOPE, complete: false, gaps: [KNOWLEDGE_GAP], total_count: total };
  }

  async function programOrThrow(run: KnowledgeRun, implementationId: string): Promise<ServiceRow> {
    if (!implementationId.startsWith("service:")) {
      throw new McpToolError("IMPLEMENTATION_ID_INVALID", "시행사업 ID는 service:로 시작해야 합니다. find_programs나 search 결과의 ID를 사용하세요.");
    }
    const row = await data.programByKey(run.id, implementationId);
    if (!row) {
      // 최근 원본에서 빠진 사업이면 폐지로 단정하지 않고 그 상태를 알린다(T09).
      const missing = (await presenceByServiceId(data.db, implementationId.slice("service:".length).split("|")[0] ?? "")).find((item) => item.status === "MISSING_FROM_LATEST_SOURCE");
      if (missing) throw new McpToolError("MISSING_FROM_LATEST_SOURCE", "「" + missing.name + "」(" + [missing.sido, missing.sigungu].filter(Boolean).join(" ") + ")은 최근 수집한 보건복지부 원본에서 빠졌습니다(마지막 확인 " + new Date(missing.last_seen_at * 1000).toISOString().slice(0, 10) + "). 폐지·종료로 확인된 것은 아닙니다.");
    }
    if (!row) throw new McpToolError("NOT_FOUND", "현재 공개본에서 이 시행사업을 찾지 못했습니다. ID가 바뀌었을 수 있으니 find_programs로 다시 찾아 주세요.");
    return row;
  }

  async function articleOf(row: ServiceRow) {
    const adminEdit = await data.editFor(row.serviceId);
    const supplement = getVerifiedWikiSupplement(row.serviceId);
    return { article: createWikiArticle(row, { verifiedSupplement: supplement, adminEdit }), supplement, adminEdit };
  }

  /**
   * 위키 글이 검증된 보완자료나 관리자 확인 편집을 썼을 때의 근거. get_entity·get_eligibility·get_sources·get_welfare_context가
   * 같은 근거를 돌려주도록 한곳에서 만든다. overviewRef는 사업개요 사실이 가리킬 근거 ID다.
   */
  function articleEvidence(row: ServiceRow, parts: Awaited<ReturnType<typeof articleOf>>, baseRef: string | null) {
    const { article, supplement, adminEdit } = parts;
    const items = [
      ...(supplement && article.supplement ? [{ evidence_id: "supplement:" + row.serviceId, kind: "VERIFIED_SUPPLEMENT", publisher: supplement.publisher, title: supplement.sourceTitle, url: supplement.url, verified_on: supplement.verifiedOn, verification_status: "VERIFIED", used_for: ["사업개요", "사업내용", "신청조건"] }] : []),
      ...(adminEdit ? [{ evidence_id: "admin-edit:" + row.serviceId, kind: "ADMIN_VERIFIED_EDIT", title: adminEdit.sourceTitle || "관리자 확인 편집", url: adminEdit.sourceUrl || null, updated_at: new Date(adminEdit.updatedAt * 1000).toISOString(), used_for: ["관리자가 확인해 고친 항목"] }] : []),
    ];
    const overviewRef = article.contentStatus === "verified-supplement" && supplement && article.supplement
      ? "supplement:" + row.serviceId
      : article.contentStatus === "admin-edited" && adminEdit ? "admin-edit:" + row.serviceId : baseRef;
    return { items, overviewRef };
  }

  /** 이 행을 뽑은 바로 그 문서를 근거로 준다. 찾지 못할 때만(이전 수집본 등) 지역 문서를 근거 후보로 주고 그렇게 표시한다. */
  async function programEvidence(run: KnowledgeRun, row: ServiceRow) {
    const exact = await data.sourceDocumentFor(run.id, row.serviceId);
    if (exact) return [{ ...documentEvidence(exact), locator_basis: "row_source_document" }];
    const documents = await data.sourceDocuments(run.id, row.sido, row.sigungu);
    const own = documents.filter((document) => document.municipality === row.sigungu);
    return (own.length ? own : documents).slice(0, 3).map((document) => ({ ...documentEvidence(document), locator_basis: "region_candidate" }));
  }

  /** 승인 반입된 문서 사실과 근거 위치. 요청이 고른 공개본의 원문 버전 목록으로 고정해 읽는다. */
  async function documentFactsOf(current: PublicState, subjectIds: readonly string[]): Promise<{ readonly rows: DocFactRow[]; readonly facts: ReturnType<typeof documentFactDto>[]; readonly evidence: object[] }> {
    const rows = await documentFactsFor(data.db, subjectIds, current.documentPin, current.run?.id ?? null);
    const proofs = await documentEvidenceRows(data.db, rows);
    const facts = rows.map((row) => documentFactDto(row, proofs.get(row.import_id + "|" + row.statement_id) ?? []));
    const sources = new Map(rows.map((row) => [row.source_version_id, row]));
    const evidence = [...sources.values()].map((row) => ({
      evidence_id: "doc:" + row.source_version_id, kind: "DOCUMENT_SOURCE", source_id: row.source_id, title: row.title, issuer: row.issuer,
      document_number: row.document_number || null, url: row.url, retrieved_at: row.retrieved_at, parser: row.parser, verification_status: "ADMIN_APPROVED_IMPORT",
    }));
    return { rows, facts, evidence };
  }

  async function newsOrThrow(articleId: string): Promise<PressItemRow & { title_version: number; timestamp_semantics: string; classification_status: string; dictionary_version: string }> {
    const id = articleId.startsWith("news:") ? articleId.slice(5) : articleId;
    if (/^https?:/i.test(id) || id.includes("/") || id.includes("\\")) {
      throw new McpToolError("ARTICLE_ID_INVALID", "기사 ID 자리에 주소나 파일 경로를 넣을 수 없습니다. search_news 결과의 article_id를 사용하세요.");
    }
    const row = await data.newsItem(id);
    if (!row) throw new McpToolError("NOT_FOUND", "공개 중인 보도자료에서 이 ID를 찾지 못했습니다. 철회·비공개되었거나 ID가 잘못되었을 수 있습니다.");
    return row;
  }

  function register<Shape extends z.ZodRawShape>(
    name: McpToolName,
    title: string,
    description: string,
    shape: Shape,
    handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<object>,
  ): void {
    // 보류된 도구(돌봄자원)는 등록하지 않는다(lib/integrations/care-hold.ts).
    if (!PUBLIC_MCP_TOOL_NAMES.includes(name)) return;
    server.registerTool(name, { title, description, inputSchema: shape, annotations: { title, ...ANNOTATIONS } }, (async (args: z.objectOutputType<Shape, z.ZodTypeAny>) => {
      try {
        return toolResult(await handler(args));
      } catch (error) {
        if (error instanceof McpToolError) return errorResult(error.code, error.message);
        context.onUnexpectedError?.(error, name);
        return errorResult("INTERNAL_ERROR", "조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    }) as never);
    registered.push(name);
  }

  // 1. search
  register("search", "통합 검색", "사업(시행사업 카드)과 공식 보도자료 메타데이터를 함께 검색합니다. 결과 id를 fetch에 넘기면 상세를 받습니다. 보도자료는 제목·기관·날짜·원문 주소만 다룹니다.", {
    query: queryInput.min(1).describe("검색어. 낱말은 모두 포함(AND)."),
  }, async ({ query }) => {
    const current = await state();
    const words = tokens(query);
    if (!words.length) throw new McpToolError("QUERY_EMPTY", "검색어를 입력해 주세요.");
    const [programs, news, documentPrograms] = await Promise.all([
      current.run ? data.programs(current.run.id, { sido: "", sigungu: "", includeAncestorScope: false, categories: [], targetKeywords: [], queryTokens: words }, 0, 8) : { rows: [], total: 0 },
      data.news(newsFilter({ queryTokens: words }), 0, 4),
      searchDocumentPrograms(data.db, words, current.documentPin, 3),
    ]);
    const results = [
      ...programs.rows.map((row) => ({
        id: serviceWikiKey(row),
        title: "[사업] " + row.name + " (" + [row.sido, row.sigungu].filter(Boolean).join(" ") + ")",
        url: wikiUrl(baseUrl, serviceWikiKey(row)),
      })),
      ...documentPrograms.map((row) => ({
        id: row.subject_id,
        title: "[문서 사업] " + row.subject_label + " (" + [row.subject_sido, row.subject_sigungu].filter(Boolean).join(" ") + ")",
        url: baseUrl + "/documents#" + encodeURIComponent(row.subject_id),
      })),
      ...news.rows.map((row) => ({
        id: "news:" + row.item_id,
        title: "[보도자료 메타데이터] " + row.title + " - " + row.org_name,
        url: row.canonical_url,
      })),
    ];
    return { results };
  });

  // 2. fetch
  register("fetch", "ID로 상세 받기", "search 결과의 id로 공개 카드를 받습니다. 시행사업은 사업명·개요·내용·신청조건·출처를, 보도자료는 메타데이터만 돌려줍니다. 임의 URL이나 파일 경로는 받지 않습니다.", {
    id: z.string().min(1).max(LIMITS.idMax).describe("search 결과의 id"),
  }, async ({ id }) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(id)) throw new McpToolError("ID_IS_URL", "URL은 받을 수 없습니다. search 결과의 id를 사용하세요.");
    const current = await state();
    if (id.startsWith("service:")) {
      const run = requireRun(current);
      const row = await programOrThrow(run, id);
      const [{ article, supplement, adminEdit }, evidence] = await Promise.all([articleOf(row), programEvidence(run, row)]);
      const lines = [
        "사업명: " + article.name,
        "지역: " + ([row.sido, row.sigungu].filter(Boolean).join(" ") || "전국"),
        "사업개요: " + article.overview,
        "사업내용: " + article.content,
        ...(article.applicationConditions ? ["신청조건: " + article.applicationConditions + " (근거: " + article.conditionsBasis + ")"] : []),
        ...(article.category ? ["사업분야: " + article.category] : []),
        ...(article.type ? ["사업구분: " + article.type] : []),
        ...(meaningful(row.applicationMethod) ? ["신청방법: " + meaningful(row.applicationMethod)] : []),
        "출처: " + evidence.map((item) => item.title + " " + item.url).join(" / "),
        "범위: 공개 원자료와 검증된 보완자료로 만든 사업 카드이며 원문 전체가 아닙니다.",
      ];
      return {
        id,
        title: article.name,
        text: lines.join("\n"),
        url: wikiUrl(baseUrl, id),
        metadata: {
          entity_type: "implementation",
          region_id: regionIdOf(row.sido, row.sigungu),
          content_status: article.contentStatus,
          content_scope: "public_card",
          release_bundle_id: current.bundleId,
          effective_reference_date: kstDate(run.completedAt),
          sources: [
            ...evidence.map((item) => ({ title: item.title, url: item.url, source_data_as_of: item.source_data_as_of })),
            ...(supplement && article.supplement ? [{ title: supplement.sourceTitle, url: supplement.url, publisher: supplement.publisher, verified_on: supplement.verifiedOn }] : []),
            ...(adminEdit?.sourceUrl ? [{ title: adminEdit.sourceTitle || "관리자 보완 출처", url: adminEdit.sourceUrl }] : []),
          ],
        },
      };
    }
    if (id.startsWith("docprog:")) {
      const { rows, facts } = await documentFactsOf(current, [id]);
      if (!rows.length) throw new McpToolError("NOT_FOUND", "공개 중인 문서 사업에서 이 ID를 찾지 못했습니다. 공개가 철회되었거나 ID가 잘못되었을 수 있습니다.");
      const first = rows[0];
      const lines = [
        "사업명: " + first.subject_label,
        "지역: " + [first.subject_sido, first.subject_sigungu].filter(Boolean).join(" "),
        ...facts.map((fact) => fact.predicate_label + ": " + fact.value + " (근거: " + fact.source.title + ", 블록 " + (fact.evidence[0]?.block_id ?? "-") + ")"),
        "출처: " + [...new Set(rows.map((row) => row.issuer + " 「" + row.title + "」" + (row.document_number ? " " + row.document_number : "") + (row.url ? " " + row.url : "")))].join(" / "),
        "범위: 관리자가 승인해 반입한 공고·안내 문서의 항목만 옮겼습니다. 원문 전체가 아니며 개인별 자격을 판정하지 않습니다.",
      ];
      return { id, title: first.subject_label, text: lines.join("\n"), url: baseUrl + "/documents#" + encodeURIComponent(id), metadata: { entity_type: "document_program", content_scope: "approved_document_facts", release_bundle_id: current.bundleId, document_component: current.components.documents, statement_ids: facts.map((fact) => fact.statement_id) } };
    }
    if (id.startsWith("news:")) {
      const row = await newsOrThrow(id);
      const labels = newsCard(row).category_ids.map((code) => CATEGORY_LABELS[code] ?? code);
      return {
        id,
        title: row.title,
        text: [
          "제목: " + row.title,
          "발행기관: " + row.org_name,
          "게시일: " + (row.published_date || "확인되지 않음"),
          "원문: " + row.canonical_url,
          "분류: " + (labels.join(", ") || "없음") + " (제목 키워드 분류)",
          METADATA_ONLY,
        ].join("\n"),
        url: row.canonical_url,
        metadata: { ...newsCard(row), content_scope: "metadata_only", timestamp_semantics: row.timestamp_semantics, release_bundle_id: current.bundleId },
      };
    }
    throw new McpToolError("ID_NOT_SUPPORTED", "지원하지 않는 ID입니다. search 결과의 id(service: 또는 news:)를 사용하세요.");
  });

  // 3. find_programs
  register("find_programs", "시행사업 찾기", "지역·사업분류·대상자 묶음·검색어로 시행사업을 찾고, 일치 이유와 포괄 범위를 함께 돌려줍니다. 서로 다른 조건은 AND, 같은 배열 안의 값은 OR입니다. 대상자 묶음은 공개 원문 문구 일치이며 개인 자격 판정이 아닙니다.", {
    region_id: regionInput.optional(),
    service_type_ids: z.array(z.string().max(100)).max(LIMITS.arrayMax).optional().describe("category:<대분류> 또는 category:<대분류>|<중분류>. get_ontology_schema(section=\"service_types\") 참조."),
    target_group_ids: z.array(z.enum(TARGET_GROUP_IDS)).max(LIMITS.arrayMax).optional().describe("대상자 묶음 ID. get_ontology_schema(section=\"target_groups\") 참조."),
    query: queryInput.optional().describe("사업명·설명·대상·제공기관 검색어(낱말 AND)."),
    include_ancestor_scope: z.boolean().optional().describe("시·군·구를 지정했을 때 같은 시·도의 광역 단위 사업(시·군·구 미지정 행)도 포함. 기본 false."),
    as_of: asOfInput,
    snapshot_id: snapshotInput,
    cursor: cursorInput,
    limit: limitInput(),
  }, async (args) => {
    const current = await pinned(args);
    const run = requireRun(current);
    const basis = knowledgeBasis(run, args.as_of);
    const region = args.region_id ? parseRegionId(args.region_id) : { sido: "", sigungu: "" };
    if (args.include_ancestor_scope && !region.sigungu) {
      throw new McpToolError("INPUT_CONFLICT", "include_ancestor_scope는 시·군·구 단위 region_id와 함께만 쓸 수 있습니다.");
    }
    const categories = (args.service_type_ids ?? []).map(parseCategoryId);
    const groupIds = args.target_group_ids ?? [];
    const keywords = [...new Set(groupIds.flatMap((id) => TARGET_GROUPS[id].keywords))];
    const words = tokens(args.query);
    const limit = pageLimit(args.limit);
    const bound = fingerprint([current.bundleId, region, categories, groupIds, words, Boolean(args.include_ancestor_scope)]);
    const offset = decodeCursor(args.cursor, bound);
    const { rows, total } = await data.programs(run.id, { ...region, includeAncestorScope: Boolean(args.include_ancestor_scope), categories, targetKeywords: keywords, queryTokens: words }, offset, limit);
    const warnings: string[] = [];
    if (total === 0 && region.sido && (await data.regionProgramCount(run.id, region.sido, region.sigungu)) === 0) {
      warnings.push("요청한 지역은 현재 공개본에 수록된 사업이 없습니다. 지역명이 정확한지, 보건복지부 사업안내에 그 지역 자료가 있는지 확인해 주세요.");
    }
    const items = rows.map((row) => {
      const reasons: string[] = [];
      if (region.sido) reasons.push(row.sigungu === region.sigungu || !region.sigungu ? "지역 일치: " + regionIdOf(row.sido, row.sigungu) : "상위 광역 범위 포함: " + regionIdOf(row.sido, row.sigungu));
      for (const { category, subcategory } of categories) {
        if (row.category === category && (!subcategory || row.subcategory === subcategory)) reasons.push("분류 일치: " + category + (subcategory ? " · " + subcategory : ""));
      }
      for (const id of groupIds) {
        const fields = (["target", "detailTarget", "name"] as const).filter((field) => TARGET_GROUPS[id].keywords.some((keyword) => row[field].includes(keyword)));
        if (fields.length) reasons.push("대상자 묶음 " + TARGET_GROUPS[id].label + ": 공개 문구(" + fields.map((field) => ({ target: "지원대상", detailTarget: "세부대상", name: "사업명" })[field]).join("·") + ")에 키워드 포함");
      }
      if (words.length) reasons.push("검색어 포함: " + words.join(" "));
      return { ...programCard(row, baseUrl), match_reasons: reasons, match_basis: "public_text_and_classification" };
    });
    const next = offset + rows.length < total ? encodeCursor(offset + rows.length, bound) : null;
    return envelope(current, now(), items, { basis, coverage: knowledgeCoverage(total), warnings, nextCursor: next });
  });

  // 4. get_entity
  register("get_entity", "개체 조회", "시행사업(service:), 문서 정의 사업(docprog:), 지역(region:), 사업분류(category:), 기관(org:), 보도자료(news:) 개체의 공개 사실과 핵심 근거를 돌려줍니다. 승인 반입된 문서 사실은 document_facts에 근거 위치와 함께 붙습니다.", {
    entity_id: z.string().min(4).max(LIMITS.idMax),
    as_of: asOfInput,
    snapshot_id: snapshotInput,
    release_bundle_id: bundleInput,
  }, async (args) => {
    const current = await pinned(args);
    const id = args.entity_id.trim();
    if (id.startsWith("service:")) {
      const run = requireRun(current);
      const basis = knowledgeBasis(run, args.as_of);
      const row = await programOrThrow(run, id);
      const normalizedId = row.serviceId.toLowerCase().replace(/[:-]/g, "");
      const [parts, evidence, documents, presence, baseline] = await Promise.all([articleOf(row), programEvidence(run, row), documentFactsOf(current, [id]), presenceByServiceId(data.db, normalizedId), presenceBaseline(data.db)]);
      const { article } = parts;
      const baseRef = evidence[0]?.evidence_id ?? null;
      const supplementary = articleEvidence(row, parts, baseRef);
      const ledger = presence.find((item) => item.sigungu === row.sigungu && item.name === row.name) ?? presence.find((item) => item.sigungu === row.sigungu && item.last_seen_run === run.id) ?? (presence.length === 1 ? presence[0] : null);
      const facts = [
        { predicate_id: "name", value: article.name },
        { predicate_id: "located_in", value: regionIdOf(row.sido, row.sigungu) },
        { predicate_id: "classified_as", value: "category:" + row.category + (row.subcategory ? "|" + row.subcategory : "") },
        { predicate_id: "has_service_type", value: meaningful(row.type) },
        { predicate_id: "provided_by_text", value: meaningful(row.provider) },
        { predicate_id: "overview", value: article.overview },
        { predicate_id: "application_method", value: meaningful(row.applicationMethod) },
      ].filter((fact) => fact.value).map((fact) => ({ ...fact, assertion_type: "source_field", content_status: article.contentStatus, evidence_ref: fact.predicate_id === "overview" ? supplementary.overviewRef : baseRef }));
      return envelope(current, now(), { entity_id: id, entity_type: "implementation", label: article.name, facts, temporal: temporalDto(ledger, baseline, run.id), document_facts: documents.facts, card: programCard(row, baseUrl) }, {
        evidence: [...evidence, ...supplementary.items, ...documents.evidence], basis, coverage: knowledgeCoverage(1),
        warnings: ["사실은 보건복지부 사업안내 원자료(필요 시 검증된 보완자료·관리자 확인 편집) 기준입니다."],
      });
    }
    if (id.startsWith("docprog:")) {
      const documents = await documentFactsOf(current, [id]);
      if (!documents.rows.length) throw new McpToolError("NOT_FOUND", "공개 중인 문서 사업에서 이 ID를 찾지 못했습니다.");
      const first = documents.rows[0];
      return envelope(current, now(), {
        entity_id: id, entity_type: "document_program", label: first.subject_label, region_id: regionIdOf(first.subject_sido, first.subject_sigungu), document_facts: documents.facts,
      }, {
        evidence: documents.evidence,
        coverage: { scope: "approved_document_facts", complete: false, gaps: ["관리자가 승인해 반입한 문서의 항목만 담습니다. 문서에 없는 조건은 알 수 없습니다."] },
        warnings: ["대시보드의 보건복지부 사업안내에 없는, 문서가 정의한 사업입니다."],
      });
    }
    if (id.startsWith("region:")) {
      const run = requireRun(current);
      const basis = knowledgeBasis(run, args.as_of);
      const region = parseRegionId(id);
      const [count, municipalities, organizations, documents] = await Promise.all([
        data.regionProgramCount(run.id, region.sido, region.sigungu),
        region.sigungu ? Promise.resolve([] as string[]) : data.regionMunicipalities(run.id, region.sido),
        data.organizationsForRegion(region.sido, region.sigungu),
        data.sourceDocuments(run.id, region.sido, region.sigungu),
      ]);
      return envelope(current, now(), {
        entity_id: id, entity_type: "region", label: [region.sido, region.sigungu].filter(Boolean).join(" "),
        level: region.sigungu ? "municipality" : "province",
        facts: [
          { predicate_id: "program_count", value: count, assertion_type: "aggregate_of_stored_rows" },
          ...(region.sigungu ? [{ predicate_id: "part_of", value: regionIdOf(region.sido, ""), assertion_type: "region_hierarchy" }] : []),
          ...(municipalities.length ? [{ predicate_id: "municipality_count", value: municipalities.length, assertion_type: "aggregate_of_stored_rows" }] : []),
        ],
        organizations: organizations.map((row) => row.organization_id),
      }, { evidence: documents.slice(0, 5).map(documentEvidence), basis, coverage: knowledgeCoverage(count) });
    }
    if (id.startsWith("category:")) {
      const run = requireRun(current);
      const basis = knowledgeBasis(run, args.as_of);
      const { category, subcategory } = parseCategoryId(id);
      const counts = (await data.categoryCounts(run.id)).filter((row) => row.category === category && (!subcategory || row.subcategory === subcategory));
      if (!counts.length) throw new McpToolError("NOT_FOUND", "현재 공개본에 이 사업분류가 없습니다.");
      return envelope(current, now(), {
        entity_id: id, entity_type: "service_type", label: category + (subcategory ? " · " + subcategory : ""),
        facts: [{ predicate_id: "program_count", value: counts.reduce((sum, row) => sum + row.total, 0), assertion_type: "aggregate_of_stored_rows" }],
        subcategories: subcategory ? [] : counts.map((row) => ({ id: "category:" + category + "|" + row.subcategory, label: row.subcategory, program_count: row.total })).slice(0, 50),
      }, { basis, coverage: knowledgeCoverage(counts.length) });
    }
    if (id.startsWith("org:")) {
      const row = await data.organization(id);
      if (!row) throw new McpToolError("NOT_FOUND", "기관 레지스트리에서 이 ID를 찾지 못했습니다.");
      const successions = await data.successionsOf(id);
      const relation = (item: (typeof successions)[number]) => ({
        succession_id: item.succession_id, kind: item.kind, effective_date: item.effective_date, territory_note: item.territory_note,
        basis: { title: item.basis_title, url: item.basis_url, secondary_url: item.secondary_url, verification_status: item.verification_status },
      });
      return envelope(current, now(), {
        entity_id: id, entity_type: "organization", label: row.name, facts: organizationCard(row),
        predecessors: successions.filter((item) => item.successor_id === id).map((item) => ({ organization_id: item.predecessor_id, name: item.predecessor_name, ...relation(item) })),
        successors: successions.filter((item) => item.predecessor_id === id).map((item) => ({ organization_id: item.successor_id, name: item.successor_name, ...relation(item) })),
        history_note: "과거 보도자료의 발행기관은 게시 당시 기관 그대로 두며 승계 기관으로 바꾸지 않습니다. search_news의 jurisdiction=include_predecessors로 이전 기관 자료를 함께 볼 수 있습니다.",
      }, {
        coverage: { scope: "press_organization_registry", complete: false, gaps: ["기관 목록은 대시보드 자료로 만든 시드이며 공식 행정기관 코드 목록으로 모두 검증되지는 않았습니다."] },
      });
    }
    if (id.startsWith("news:")) {
      const row = await newsOrThrow(id);
      return envelope(current, now(), { entity_id: id, entity_type: "press_release", label: row.title, facts: { ...newsCard(row), title_version: row.title_version, timestamp_semantics: row.timestamp_semantics } }, {
        basis: { ...EMPTY_BASIS, news_date_basis: "published" },
        coverage: { scope: "official_press_release_metadata", complete: false, gaps: NEWS_GAPS },
      });
    }
    throw new McpToolError("ENTITY_ID_INVALID", "지원하지 않는 개체 ID입니다. service:, docprog:, region:, category:, org:, news: 중 하나로 시작해야 합니다.");
  });

  // 5. get_relationships
  register("get_relationships", "1홉 관계 조회", "개체의 1홉 관계를 방향·근거 유형과 함께 돌려줍니다. assertion_type이 keyword_classification인 관계(보도자료 분야 분류)는 확정 사실이 아니라 제목 키워드 분류입니다.", {
    entity_id: z.string().min(4).max(LIMITS.idMax),
    predicate_ids: z.array(z.enum(["located_in", "classified_as", "part_of", "has_jurisdiction", "issued_by", "classified_as_topic"])).max(6).optional(),
    direction: z.enum(["out", "in", "both"]).optional().describe("기본 out"),
    as_of: asOfInput,
    snapshot_id: snapshotInput,
    release_bundle_id: bundleInput,
    cursor: cursorInput,
    limit: limitInput(),
  }, async (args) => {
    const current = await pinned(args);
    const id = args.entity_id.trim();
    const direction = args.direction ?? "out";
    const wanted = new Set(args.predicate_ids ?? []);
    const allow = (predicate: string) => wanted.size === 0 || wanted.has(predicate as never);
    const limit = pageLimit(args.limit);
    const bound = fingerprint([current.bundleId, id, direction, [...wanted].sort()]);
    const offset = decodeCursor(args.cursor, bound);
    const outgoing: object[] = [];
    let incoming: object[] = [];
    let incomingTotal = 0;
    const relation = (predicate: string, objectId: string, label: string, assertion: string, dir: "out" | "in", subject = id) =>
      ({ subject_id: subject, predicate_id: predicate, object_id: objectId, object_label: label, direction: dir, assertion_type: assertion, verification_status: assertion === "keyword_classification" ? "UNVERIFIED_CLASSIFICATION" : "SOURCE_FIELD" });
    let basis: Basis = EMPTY_BASIS;
    if (id.startsWith("service:")) {
      const run = requireRun(current);
      basis = knowledgeBasis(run, args.as_of);
      const row = await programOrThrow(run, id);
      if (allow("located_in")) outgoing.push(relation("located_in", regionIdOf(row.sido, row.sigungu), [row.sido, row.sigungu].filter(Boolean).join(" "), "source_field", "out"));
      if (allow("classified_as")) outgoing.push(relation("classified_as", "category:" + row.category + (row.subcategory ? "|" + row.subcategory : ""), row.category + (row.subcategory ? " · " + row.subcategory : ""), "source_field", "out"));
    } else if (id.startsWith("region:") || id.startsWith("category:")) {
      const run = requireRun(current);
      basis = knowledgeBasis(run, args.as_of);
      const isRegion = id.startsWith("region:");
      const region = isRegion ? parseRegionId(id) : { sido: "", sigungu: "" };
      const categories = isRegion ? [] : [parseCategoryId(id)];
      if (isRegion && region.sigungu && allow("part_of")) outgoing.push(relation("part_of", regionIdOf(region.sido, ""), region.sido, "region_hierarchy", "out"));
      const predicate = isRegion ? "located_in" : "classified_as";
      if (direction !== "out" && allow(predicate)) {
        const { rows, total } = await data.programs(run.id, { ...region, includeAncestorScope: false, categories, targetKeywords: [], queryTokens: [] }, offset, limit);
        incomingTotal = total;
        incoming = rows.map((row) => relation(predicate, id, isRegion ? [region.sido, region.sigungu].filter(Boolean).join(" ") : id.slice(9), "source_field", "in", serviceWikiKey(row)));
      }
    } else if (id.startsWith("org:")) {
      const row = await data.organization(id);
      if (!row) throw new McpToolError("NOT_FOUND", "기관 레지스트리에서 이 ID를 찾지 못했습니다.");
      if (row.parent_id && allow("part_of")) outgoing.push(relation("part_of", row.parent_id, row.parent_id, "registry_seed", "out"));
      if (row.sido && allow("has_jurisdiction")) outgoing.push(relation("has_jurisdiction", regionIdOf(row.sido, row.sigungu), [row.sido, row.sigungu].filter(Boolean).join(" "), "registry_seed", "out"));
      if (direction !== "out" && allow("issued_by")) {
        const { rows, total } = await data.news(newsFilter({ organizationIds: [id] }), offset, limit);
        incomingTotal = total;
        incoming = rows.map((item) => relation("issued_by", id, row.name, "source_registry", "in", "news:" + item.item_id));
      } else if (direction !== "out" && allow("part_of")) {
        const { rows, total } = await data.childOrganizations(id, offset, limit);
        incomingTotal = total;
        incoming = rows.map((child) => relation("part_of", id, row.name, "registry_seed", "in", child.organization_id));
      }
    } else if (id.startsWith("news:")) {
      const row = await newsOrThrow(id);
      if (allow("issued_by")) outgoing.push(relation("issued_by", row.org_id, row.org_name, "source_registry", "out"));
      if (allow("classified_as_topic")) {
        for (const code of toPressDto(row).category_ids) outgoing.push(relation("classified_as_topic", "news_category:" + code, CATEGORY_LABELS[code] ?? code, "keyword_classification", "out"));
      }
    } else {
      throw new McpToolError("ENTITY_ID_INVALID", "지원하지 않는 개체 ID입니다. service:, docprog:, region:, category:, org:, news: 중 하나로 시작해야 합니다.");
    }
    const relations = [...(direction === "in" || offset > 0 ? [] : outgoing), ...incoming];
    const next = offset + incoming.length < incomingTotal ? encodeCursor(offset + incoming.length, bound) : null;
    return envelope(current, now(), relations, {
      basis,
      coverage: { scope: "one_hop_relationships", complete: next === null, gaps: [], incoming_total: incomingTotal },
      warnings: ["관계는 원자료 칸·기관 레지스트리·제목 키워드 분류에서 나온 것이며 제도적 연계·인과·자격을 뜻하지 않습니다."],
      nextCursor: next,
    });
  });

  // 6. get_eligibility
  register("get_eligibility", "공개 신청조건", "시행사업(service:) 또는 문서 정의 사업(docprog:)의 공개된 지원대상·신청조건·신청방법과 확인되지 않은 사항을 돌려줍니다. 승인 반입된 문서 조건은 document_conditions에 근거 위치와 함께 붙습니다. 개인별 자격 판정을 하지 않습니다.", {
    implementation_id: implementationInput,
    as_of: asOfInput,
    snapshot_id: snapshotInput,
  }, async (args) => {
    const current = await pinned(args);
    if (args.implementation_id.startsWith("docprog:")) {
      const documents = await documentFactsOf(current, [args.implementation_id]);
      if (!documents.rows.length) throw new McpToolError("NOT_FOUND", "공개 중인 문서 사업에서 이 ID를 찾지 못했습니다.");
      const first = documents.rows[0];
      return envelope(current, now(), {
        implementation_id: args.implementation_id, name: first.subject_label, region_id: regionIdOf(first.subject_sido, first.subject_sigungu),
        application_conditions: null, document_conditions: documents.facts.filter((fact) => ELIGIBILITY_PREDICATES.has(fact.predicate_id)),
        exceptions: [], unknowns: ["문서에 적힌 항목만 옮겼습니다. 소득·재산 기준 등 문서에 없는 조건은 알 수 없습니다."],
        personal_determination: false, notice: "공개 조건 안내이며 개인의 수급 자격을 판정하지 않습니다.",
      }, { evidence: documents.evidence, coverage: { scope: "approved_document_facts", complete: false, gaps: [] } });
    }
    const run = requireRun(current);
    const basis = knowledgeBasis(run, args.as_of);
    const row = await programOrThrow(run, args.implementation_id);
    const [parts, evidence, documents] = await Promise.all([articleOf(row), programEvidence(run, row), documentFactsOf(current, [args.implementation_id])]);
    const { article } = parts;
    const supplementary = articleEvidence(row, parts, evidence[0]?.evidence_id ?? null);
    const unknowns: string[] = [];
    if (!article.applicationConditions) unknowns.push("공개 자료에서 신청조건(지원대상)을 확인할 수 없습니다.");
    if (!meaningful(row.applicationMethod)) unknowns.push("공개 자료에서 신청방법을 확인할 수 없습니다.");
    unknowns.push("소득·재산 기준의 세부 산정, 예외, 우선순위는 구조화되어 있지 않습니다. 담당 기관에 확인하세요.");
    return envelope(current, now(), {
      implementation_id: args.implementation_id,
      name: article.name,
      region_id: regionIdOf(row.sido, row.sigungu),
      application_conditions: article.applicationConditions ?? null,
      conditions_basis: article.conditionsBasis ?? null,
      source_target_text: meaningful(row.target),
      source_detail_target_text: meaningful(row.detailTarget),
      application_method: meaningful(row.applicationMethod),
      provider: meaningful(row.provider),
      document_conditions: documents.facts.filter((fact) => ELIGIBILITY_PREDICATES.has(fact.predicate_id)),
      exceptions: [],
      unknowns,
      personal_determination: false,
      notice: "공개 조건 안내이며 개인의 수급 자격을 판정하지 않습니다.",
    }, {
      evidence: [
        ...evidence,
        ...supplementary.items,
        ...documents.evidence,
      ],
      basis, coverage: knowledgeCoverage(1),
    });
  });

  // 7. get_sources
  register("get_sources", "출처 조회", "시행사업·지역·기관·보도자료·공개 재정 관측(fiscal_observation)·승인 반입 문서(document, doc:…)의 출처와 근거 범위를 돌려줍니다. 예산서 행(budget_line)은 원문 미수집으로 미가용입니다.", {
    subject_type: z.enum(["implementation", "region", "organization", "press_release", "fiscal_observation", "budget_line", "document"]),
    subject_id: z.string().min(1).max(LIMITS.idMax),
    snapshot_id: snapshotInput,
    release_bundle_id: bundleInput,
    cursor: cursorInput,
    limit: limitInput(),
  }, async (args) => {
    const current = await pinned(args);
    if (args.subject_type === "budget_line") throw new McpToolError("BUDGET_LINE_NOT_AVAILABLE", "예산서 원문(부기·산출근거) 행은 아직 수집하지 않았습니다.");
    if (args.subject_type === "document") {
      const rows = await documentSourceRows(data.db, args.subject_id, current.documentPin, current.run?.id ?? null);
      if (!rows.length) throw new McpToolError("NOT_FOUND", "공개 중인 문서 출처에서 이 ID(doc:…)를 찾지 못했습니다.");
      const row = rows[0];
      return envelope(current, now(), [{
        kind: "DOCUMENT_SOURCE", source_id: row.source_id, source_version_id: row.source_version_id, title: row.title, issuer: row.issuer, document_number: row.document_number || null,
        url: row.url, published_date: row.published_date, retrieved_at: row.retrieved_at, format: row.format, parser: row.parser, rights_basis: row.rights_basis,
        statements: rows.length, subjects: [...new Set(rows.map((item) => item.subject_id))], verification_status: "ADMIN_APPROVED_IMPORT",
        locator_note: "근거 위치는 파싱 구조(블록·표) 기준이며 실제 인쇄 쪽수를 확인한 값이 아닙니다.",
      }], { coverage: { scope: "sources_of_subject", complete: true, gaps: [] } });
    }
    if (args.subject_type === "fiscal_observation") {
      const row = await data.db.prepare(
        "SELECT o.observation_id, o.fiscal_project_id, o.reference_date, o.source_exe_ymd, o.current_budget_raw, o.public_expenditure_raw, o.source_amount_unit, " + unitVerificationSql("o") + " AS unit_verification, o.normalization_rule_id, o.contract_version, r.access_tier, r.requested_reference_date " +
          "FROM fiscal_observation o JOIN fiscal_collection_run r ON r.run_id = o.run_id WHERE o.observation_id = ? AND EXISTS (SELECT 1 FROM fiscal_snapshot_member m JOIN fiscal_snapshot s ON s.snapshot_id = m.snapshot_id WHERE m.observation_id = o.observation_id AND s.status = 'PUBLISHED')",
      ).bind(args.subject_id).first<Record<string, unknown>>();
      if (!row) throw new McpToolError("NOT_FOUND", "공개된 재정 관측에서 이 ID를 찾지 못했습니다.");
      return envelope(current, now(), [{
        kind: "LOFIN_QWGJK_RECORD", source: "지방재정365 세부사업별 세출현황(QWGJK)", source_url: "https://www.lofin365.go.kr/lf/hub/QWGJK",
        license: "출처표시, 상업적·비상업적 이용 가능, 2차적 저작물 작성 가능(원천 명세)", ...row,
        source_fields: { current_budget_krw: "bdg_cash_amt", public_expenditure_krw: "ep_amt" },
      }], { coverage: { scope: "sources_of_subject", complete: true, gaps: [] } });
    }
    if (args.subject_type === "implementation") {
      const run = requireRun(current);
      const row = await programOrThrow(run, args.subject_id);
      const [parts, evidence, documents] = await Promise.all([articleOf(row), programEvidence(run, row), documentFactsOf(current, [args.subject_id])]);
      const sources = [
        ...documents.evidence.map((item) => ({ ...item, used_for: ["승인 반입된 문서 사실(document_facts)"] })),
        ...evidence.map((item) => ({ ...item, rights_scope: "공공기관 공개 게시물(출처 표시)", used_for: ["사업명", "분류", "설명", "지원대상", "제공기관"] })),
        ...articleEvidence(row, parts, null).items,
      ];
      return envelope(current, now(), sources, { basis: knowledgeBasis(run, undefined), coverage: { scope: "sources_of_subject", complete: true, gaps: [] } });
    }
    if (args.subject_type === "region") {
      const run = requireRun(current);
      const region = parseRegionId(args.subject_id);
      const documents = await data.sourceDocuments(run.id, region.sido, region.sigungu);
      return envelope(current, now(), documents.map(documentEvidence), { basis: knowledgeBasis(run, undefined), coverage: { scope: "sources_of_subject", complete: documents.length < 10, gaps: documents.length >= 10 ? ["상위 10건만 반환했습니다."] : [] }, truncated: documents.length >= 10 });
    }
    if (args.subject_type === "organization") {
      const row = await data.organization(args.subject_id);
      if (!row) throw new McpToolError("NOT_FOUND", "기관 레지스트리에서 이 ID를 찾지 못했습니다.");
      return envelope(current, now(), [{ kind: "ORGANIZATION_REGISTRY_SEED", seed_origin: row.seed_origin, registry_version: row.registry_version, code: row.code ? { system: row.code_system, value: row.code } : null, verification_status: row.code ? "CODE_RECORDED" : "SEED_ONLY" }], {
        coverage: { scope: "sources_of_subject", complete: true, gaps: [] },
      });
    }
    const row = await newsOrThrow(args.subject_id);
    return envelope(current, now(), [{
      kind: "OFFICIAL_PRESS_RELEASE", source_kind: "OFFICIAL_PRESS_RELEASE", original_url: row.canonical_url,
      issued_by: { organization_id: row.org_id, name: row.org_name }, metadata_version: row.title_version,
      timestamp_semantics: row.timestamp_semantics, classification_basis: row.classification_basis, dictionary_version: row.dictionary_version,
      source_registry_version: row.registry_version, content_scope: "metadata_only",
    }], { coverage: { scope: "sources_of_subject", complete: true, gaps: [] } });
  });

  function envelopeFor(current: PublicState) {
    return <T>(payload: T, options: EnvelopeOptions & { evidence?: readonly unknown[] }) => envelope(current, now(), payload, options);
  }

  // 8. get_dataset_status
  register("get_dataset_status", "공개 자료 상태", "현재 공개본(release_bundle_id)과 도메인별 기준일·마지막 성공·수록 범위·미가용 상태를 돌려줍니다. 다른 도구 호출 전에 기준을 확인할 때 쓰세요.", {}, async () => {
    const current = await state();
    const [totals, coverage, fiscalSnapshots, documentRows, ledgerRows] = await Promise.all([
      current.run ? data.knowledgeTotals(current.run.id) : Promise.resolve(null),
      readPressCoverage(data.db, now()),
      publishedSnapshots(data.db, { limit: 10, snapshotIds: current.fiscalPin }),
      allDocumentFacts(data.db, current.documentPin, current.run?.id ?? null),
      current.run ? data.sourceRowLedger(current.run.id) : Promise.resolve([]),
    ]);
    return envelope(current, now(), {
      knowledge: current.run && totals ? {
        component: current.components.knowledge, status: "AVAILABLE",
        collected_at: new Date(current.run.completedAt * 1000).toISOString(),
        effective_reference_date: kstDate(current.run.completedAt),
        latest_source_data_as_of: current.run.dataAsOf || null,
        implementations: totals.rows, source_documents: totals.documents, provinces: totals.sido, municipalities: totals.sigungu,
        presence: presenceSummaryDto(await presenceRun(data.db, current.run.id), await presenceBaseline(data.db)),
        source_row_ledger: ledgerRows.length ? ledgerTotals(ledgerRows) : { status: "NOT_RECORDED_FOR_THIS_RUN", note: "원본 행 원장은 2026-10-04 이후 수집 run부터 기록됩니다." },
        scope: KNOWLEDGE_SCOPE,
      } : { component: null, status: "UNAVAILABLE", reason: "공개된 사업 자료가 아직 없습니다." },
      news: {
        component: current.components.news, status: coverage.items.public_total ? "PARTIAL" : "EMPTY",
        registry_version: coverage.registry_version, target_organizations: coverage.targets.organizations,
        endpoint_verified_organizations: coverage.coverage.endpoint_verified_organizations,
        approved_active_sources: coverage.coverage.approved_active_sources,
        normal_organizations_24h: coverage.coverage.normal_organizations_24h,
        public_items: coverage.items.public_total, latest_published_date: coverage.items.latest_published_date || null,
        official_press_release: "PARTIAL", private_news_article: "NOT_COLLECTED",
        schedule: coverage.schedule.label, schedule_note: coverage.schedule.note,
      },
      fiscal: fiscalSnapshots.length ? {
        component: current.components.fiscal, status: "PARTIAL",
        snapshots: fiscalSnapshots.map((snapshot) => ({ snapshot_id: snapshot.snapshot_id, scope: snapshot.scope_label, mode: snapshot.mode, effective_reference_date: snapshot.effective_reference_date, complete: snapshot.complete === 1, access_tier: snapshot.access_tier, rows: snapshot.unique_count })),
        unavailable_modes: fiscalSnapshots.some((snapshot) => snapshot.mode === "all_fields") ? [] : ["social_welfare", "health", "department"],
        unavailable_reason: "자치단체 전체 세출은 지방재정365 발급 인증키가 필요합니다.",
      } : { component: null, status: "UNAVAILABLE", reason: "공개 승인된 재정 snapshot이 아직 없습니다(수집 범위 승인 대기 또는 미수집)." },
      links: { component: current.components.links, status: current.components.links ? "PARTIAL" : "UNAVAILABLE", reason: current.components.links ? null : "검토된 사업–재정–보도자료 연결이 아직 없습니다(후보는 비공개)." },
      documents: documentRows.length ? {
        component: current.components.documents, status: "PARTIAL",
        sources: new Set(documentRows.map((row) => row.source_version_id)).size, statements: documentRows.length,
        subjects: new Set(documentRows.map((row) => row.subject_id)).size,
        scope: "관리자가 해시를 확인해 승인·활성화한 HWP/HWPX 문서 사실(로컬 파싱·검토 후 반입)",
      } : { component: current.components.documents, status: "UNAVAILABLE", reason: "승인·활성화된 문서 사실이 아직 없습니다." },
      optional_indexes: await readOptionalIndexes(data.db, current.run?.id ?? null),
      release_bundle: current.bundle
        ? { release_bundle_id: current.bundle.bundle_id, bundle_schema_version: current.bundle.bundle_schema_version, status: current.bundle.status, created_at: new Date(current.bundle.created_at * 1000).toISOString(), activated_at: current.bundle.activated_at ? new Date(current.bundle.activated_at * 1000).toISOString() : null, compatibility: JSON.parse(current.bundle.compatibility_report) as unknown }
        : { release_bundle_id: current.bundleId, status: "PENDING", note: "통합 공개본이 아직 활성화되지 않아 각 모듈의 현재 상태로 응답합니다." },
    }, {
      coverage: { scope: "dataset_status", complete: false, gaps: [KNOWLEDGE_GAP, ...NEWS_GAPS.slice(0, 2)] },
      warnings: ["도메인마다 기준일이 다릅니다. 하나의 최신 일자로 합치지 마세요."],
    });
  });

  // 9. get_ontology_schema
  register("get_ontology_schema", "온톨로지·코드 안내", "구현된 개체 유형, 관계(predicate), 코드체계(지역·사업분류·대상자 묶음·보도자료 분야·기관 유형)를 섹션별로 안내합니다. section을 생략하면 목차만 돌려줍니다.", {
    section: z.enum(["entity_types", "predicates", "code_systems", "service_types", "target_groups", "news_categories"]).optional(),
    cursor: cursorInput,
    limit: limitInput(LIMITS.listMax, LIMITS.listMax),
  }, async (args) => {
    const current = await state();
    const sections: Record<string, () => Promise<object[]>> = {
      entity_types: async () => [
        { id: "implementation", prefix: "service:", label: "시행사업", description: "한 지역에서 시행되는 사업 한 건(보건복지부 사업안내의 한 행)." },
        { id: "region", prefix: "region:", label: "지역", description: "시·도 또는 시·도|시·군·구." },
        { id: "service_type", prefix: "category:", label: "사업분류", description: "대분류 또는 대분류|중분류." },
        { id: "organization", prefix: "org:", label: "행정기관", description: "보도자료 발행기관 레지스트리(시드)." },
        { id: "press_release", prefix: "news:", label: "공식 보도자료", description: "메타데이터만 보관(본문·요약 없음)." },
        { id: "source_document", prefix: "mohw-doc:", label: "원자료 문서", description: "근거(evidence)로만 제공." },
        { id: "fiscal_project", prefix: "fp:", label: "재정사업", description: "지방재정365 세부사업(연도:자치단체:회계:부서:사업코드). find_budget_projects로 조회." },
        { id: "fiscal_entity", prefix: "lofin:laf:", label: "재정주체", description: "지방재정365 자치단체 코드. 콘텐츠 지역(region:)과 별개이며 검증 매핑으로만 연결." },
        { id: "document_program", prefix: "docprog:", label: "문서 정의 사업", description: "승인 반입된 공고·안내 문서가 정의한 사업. 보건복지부 사업안내에 없는 사업일 수 있음." },
        { id: "document_source", prefix: "doc:", label: "반입 문서", description: "HWP/HWPX 원문 한 건(원문 버전 source_version_id 단위). get_sources(subject_type=document)로 조회." },
        { id: "fiscal_observation", prefix: "fo:", label: "재정 관측", description: "기준일별 예산현액·공개 지출액 한 건. get_sources로 원천 필드 확인." },
      ],
      predicates: async () => [
        { id: "succeeded_by", domain: "organization", range: "organization", assertion_type: "official_succession", kinds: ["MERGE", "SPLIT", "RENAME", "TRANSFER"], note: "효력일·근거와 함께 기록. 과거 게시물의 발행기관은 바꾸지 않음" },
        ...Object.entries(DOCUMENT_PREDICATES).map(([id, label]) => ({ id, label, domain: "implementation|document_program", range: "text", assertion_type: "document_field" })),
        { id: "located_in", domain: "implementation", range: "region", assertion_type: "source_field" },
        { id: "classified_as", domain: "implementation", range: "service_type", assertion_type: "source_field" },
        { id: "has_service_type", domain: "implementation", range: "literal(사업구분)", assertion_type: "source_field" },
        { id: "provided_by_text", domain: "implementation", range: "literal(제공기관 문구)", assertion_type: "source_field" },
        { id: "part_of", domain: "region|organization", range: "region|organization", assertion_type: "region_hierarchy|registry_seed" },
        { id: "has_jurisdiction", domain: "organization", range: "region", assertion_type: "registry_seed" },
        { id: "issued_by", domain: "press_release", range: "organization", assertion_type: "source_registry" },
        { id: "classified_as_topic", domain: "press_release", range: "news_category", assertion_type: "keyword_classification", note: "제목 키워드 분류이며 확정 사실이 아닙니다." },
      ],
      code_systems: async () => [
        ...REGION_DEFINITIONS.map((region) => ({ system: "region", id: regionIdOf(region.fullName, ""), label: region.fullName })),
        ...ORG_TYPES.map((type) => ({ system: "organization_type", id: type })),
        { system: "source_kind", id: "OFFICIAL_PRESS_RELEASE", status: "PARTIAL" },
        { system: "source_kind", id: "NEWS_ARTICLE", status: "NOT_COLLECTED" },
      ],
      service_types: async () => {
        const run = requireRun(current);
        const counts = await data.categoryCounts(run.id);
        return counts.map((row) => ({ id: "category:" + row.category + (row.subcategory ? "|" + row.subcategory : ""), category: row.category, subcategory: row.subcategory || null, program_count: row.total }));
      },
      target_groups: async () => Object.entries(TARGET_GROUPS).map(([id, group]) => ({ id, label: group.label, keywords: group.keywords, basis: "공개 원문 문구 일치" })),
      news_categories: async () => Object.entries(CATEGORY_LABELS).map(([code, label]) => ({ id: code, label })),
    };
    if (!args.section) {
      return envelope(current, now(), Object.keys(sections).map((section) => ({ section })), { coverage: { scope: "ontology_index", complete: true, gaps: [] } });
    }
    const items = await sections[args.section]();
    const limit = pageLimit(args.limit, LIMITS.listMax);
    const bound = fingerprint([current.bundleId, args.section]);
    const offset = decodeCursor(args.cursor, bound);
    const page = items.slice(offset, offset + limit);
    const next = offset + page.length < items.length ? encodeCursor(offset + page.length, bound) : null;
    return envelope(current, now(), page, { coverage: { scope: "ontology_section", complete: next === null, gaps: [], total_count: items.length }, nextCursor: next });
  });

  // 10–13. 재정 도구: 원천 미연결 상태와 사유를 돌려준다(입력은 명세대로 검증).
  register("get_fiscal_catalog", "재정 카탈로그", "공개 snapshot에 실제로 있는 재정주체·부서코드·회계·분야/부문·가용 기준일, 관리자가 승인한 예산서 편성 단계(catalog_type=budget_document: document_revision_id·단계·수록 범위), 재정주체 하나의 부서코드 연도별 관측 이력과 연도 사이 사업 이관(catalog_type=department_history, fiscal_entity_id 필요)을 돌려줍니다. 코드·날짜를 추정하지 말고 이 목록에서 고르세요. region_id는 검증된 재정주체 매핑이 있을 때만 쓸 수 있습니다.", FISCAL_TOOL_SHAPES.get_fiscal_catalog, async (args) => { const current = await pinned(args); return getFiscalCatalog(data.db, args, envelopeFor(current), current.fiscalPin); });
  register("find_budget_projects", "재정사업 찾기", "회계연도·모드별 세부사업과 예산현액·공개 지출액(원, 10진 문자열)을 돌려줍니다. 같은 재정주체·연도·회계·세부사업명의 공개 예산서 행이 있으면 budget_documents에 document_revision_id·budget_line_id·문서 단계 금액을 함께 줍니다. include_summary=true면 조건에 맞는 전체 범위 합계(aggregation_scope 명시)를 따로 줍니다. 통합돌봄 모드는 세부사업명 규칙이며 공식 분류가 아닙니다. 사회복지·보건·부서별은 전체 세출 수집 전이면 KEY_REQUIRED입니다.", FISCAL_TOOL_SHAPES.find_budget_projects, async (args) => { const current = await pinned(args); return findBudgetProjects(data.db, args, envelopeFor(current), current.fiscalPin); });
  register("get_budget_execution", "예산 집행 조회", "재정사업 ID(최대 50개)별 예산현액·공개 지출액·차액·집행률과 실제 기준일을 돌려줍니다. fallback_policy=latest_before(기본)는 요청일 이전 7일 안의 가장 가까운 공개본을 씁니다.", FISCAL_TOOL_SHAPES.get_budget_execution, async (args) => { const current = await pinned(args); return getBudgetExecution(data.db, args, envelopeFor(current), current.fiscalPin); });
  register("compare_budget_periods", "예산 기간 비교", "같은 재정사업의 두 기준일(같은 연도) 또는 두 연도 값을 비교해 예산현액 변화와 공개 지출액 순변동을 돌려줍니다. 연도가 다르면 같은 재정주체·회계·세부사업코드로 짝을 찾고(mapping), 부서·분류가 바뀌었거나 짝이 없거나 여럿이면 비교불가 사유를 돌려줍니다. 예산서 단계 비교는 comparison_basis=document_stage와 양쪽 document_revision_id(get_fiscal_catalog budget_document)로 하며, project_selection은 fiscal_project_ids·budget_line_ids·detail_project_query 가운데 하나입니다. 문서 단계 금액(천원)과 지방재정365 기준일 예산현액은 한 비교로 섞지 않습니다.", FISCAL_TOOL_SHAPES.compare_budget_periods, async (args) => { const current = await pinned(args); return compareBudgetPeriods(data.db, args, envelopeFor(current), current.fiscalPin); });

  // 14. search_news
  register("search_news", "보도자료 검색", "공식 보도자료 메타데이터(제목·발행기관·날짜·원문 주소·분류)를 검색합니다. 본문·요약·snippet은 없습니다. 지역은 발행기관 관할(publisher_jurisdiction) 기준이며, 서로 다른 필터는 AND, 같은 배열 안의 값은 OR입니다. 날짜는 일 단위이고 게시일 미확인 항목은 기간 필터에서 빠집니다.", {
    query: queryInput.optional().describe("제목 검색어(낱말 AND)."),
    region_ids: z.array(z.string().max(80)).max(1).optional().describe("발행기관 관할 지역 1개(region:...)."),
    category_ids: z.array(z.enum(NEWS_CATEGORY_IDS)).max(LIMITS.arrayMax).optional(),
    publisher_ids: z.array(z.string().max(100)).max(LIMITS.arrayMax).optional().describe("민간 매체 식별자. 민간 기사는 수집하지 않아 지정하면 거절됩니다. 기관은 organization_ids를 쓰세요."),
    organization_ids: z.array(z.string().max(100)).max(LIMITS.arrayMax).optional().describe("기관 레지스트리 ID(org:...)."),
    organization_types: z.array(z.enum(ORG_TYPES)).max(ORG_TYPES.length).optional(),
    region_basis: z.enum(["publisher_jurisdiction", "mentioned", "either"]).optional().describe("현재 publisher_jurisdiction만 구현. 생략 시 publisher_jurisdiction."),
    include_descendant_publishers: z.boolean().optional().describe("지역의 하위 기관(시·도→시·군·구, 시→일반구) 발행 자료 포함. 기본 false."),
    date_from: dateInput.optional(),
    date_to: dateInput.optional(),
    date_basis: z.enum(["published", "discovered"]).optional().describe("기본 published(게시일). discovered는 수집기가 처음 발견한 날(KST)."),
    source_kind: z.enum(["OFFICIAL_PRESS_RELEASE"]).optional(),
    group_mode: z.enum(["items", "verified_groups"]).optional().describe("기본 items(게시물별). verified_groups는 관리자가 같은 자료로 확인한 묶음을 대표 1건(duplicate_group.other_sources_count 포함)으로 묶는다. 제목이 비슷하기만 한 related_group은 묶지 않는다."),
    jurisdiction: z.enum(["as_published", "include_predecessors"]).optional().describe("기본 as_published(게시 당시 발행기관 그대로). include_predecessors는 organization_ids의 통합·분구·관할변경 이전 기관 자료도 함께 찾되, 각 자료의 발행기관은 바꾸지 않습니다."),
    duplicate_group_id: z.string().max(100).optional().describe("duplicate_group.duplicate_group_id. group_mode=items와 함께 쓰면 그 묶음의 공개 구성원 전체를 돌려준다."),
    release_bundle_id: bundleInput,
    cursor: cursorInput,
    limit: limitInput(),
  }, async (args) => {
    const current = await pinned(args);
    if (args.publisher_ids?.length) throw new McpToolError("PUBLISHER_IDS_NOT_SUPPORTED", "민간 매체 기사는 수집하지 않습니다. 행정기관은 organization_ids로 지정하세요.");
    if (args.region_basis && args.region_basis !== "publisher_jurisdiction") throw new McpToolError("REGION_BASIS_NOT_AVAILABLE", "본문을 보관하지 않아 언급 지역(mentioned) 기준은 제공하지 않습니다. publisher_jurisdiction을 쓰세요.");
    if (args.group_mode === "verified_groups" && args.duplicate_group_id) throw new McpToolError("INPUT_CONFLICT", "묶음 구성원은 group_mode=items와 duplicate_group_id로 조회합니다.");
    if (args.include_descendant_publishers && !args.region_ids?.length) throw new McpToolError("INPUT_CONFLICT", "include_descendant_publishers는 region_ids와 함께만 쓸 수 있습니다.");
    if (args.date_from && args.date_to && args.date_from > args.date_to) throw new McpToolError("INPUT_CONFLICT", "date_from이 date_to보다 늦습니다.");
    const requestedOrganizationIds = args.organization_ids ?? [];
    if (requestedOrganizationIds.some((id) => !id.startsWith("org:"))) throw new McpToolError("ORGANIZATION_ID_INVALID", "기관 ID는 org:로 시작해야 합니다.");
    if (args.jurisdiction === "include_predecessors" && !requestedOrganizationIds.length) throw new McpToolError("INPUT_CONFLICT", "jurisdiction=include_predecessors는 organization_ids와 함께만 쓸 수 있습니다.");
    const addedPredecessors = args.jurisdiction === "include_predecessors" ? await data.predecessorsOf(requestedOrganizationIds) : [];
    const organizationIds = [...requestedOrganizationIds, ...addedPredecessors];
    const region = args.region_ids?.length ? parseRegionId(args.region_ids[0]) : { sido: "", sigungu: "" };
    const filter = newsFilter({
      queryTokens: tokens(args.query), categoryIds: args.category_ids ?? [], organizationIds, organizationTypes: args.organization_types ?? [],
      ...region, includeDescendants: Boolean(args.include_descendant_publishers),
      dateFrom: args.date_from ?? "", dateTo: args.date_to ?? "", dateBasis: args.date_basis ?? "published",
      groupMode: args.group_mode ?? "items", duplicateGroupId: args.duplicate_group_id ?? "",
    });
    const limit = pageLimit(args.limit);
    const bound = fingerprint([current.bundleId, filter]);
    const offset = decodeCursor(args.cursor, bound);
    const { rows, total } = await data.news(filter, offset, limit);
    // 묶음 모드에서는 결과 단위(대표 1건)와 게시물 수를 나눠 보여 준다.
    const postCount = filter.groupMode === "verified_groups" ? (await data.news({ ...filter, groupMode: "items" }, 0, 1)).total : total;
    const next = offset + rows.length < total ? encodeCursor(offset + rows.length, bound) : null;
    return envelope(current, now(), rows.map(newsCard), {
      basis: { ...EMPTY_BASIS, news_date_basis: filter.dateBasis },
      coverage: { scope: "official_press_release_metadata", complete: false, gaps: NEWS_GAPS, total_count: total, post_count: postCount, group_mode: filter.groupMode, result_unit: filter.groupMode === "verified_groups" ? "verified_release_group_or_item" : "item", region_basis: "publisher_jurisdiction", source_registry_version: current.newsRegistryVersion, jurisdiction: args.jurisdiction ?? "as_published", added_predecessor_ids: addedPredecessors },
      nextCursor: next,
    });
  });

  // 15. get_news_metadata
  register("get_news_metadata", "보도자료 메타데이터", "보도자료 한 건의 허용된 메타데이터(제목 버전·발행기관·날짜 의미·원문 주소·분류 근거)를 돌려줍니다. 본문·요약은 없습니다.", {
    article_id: z.string().min(1).max(200).describe("search_news의 article_id(또는 news: 접두 ID)"),
    release_bundle_id: bundleInput,
  }, async (args) => {
    const current = await pinned(args);
    const row = await newsOrThrow(args.article_id);
    return envelope(current, now(), {
      ...newsCard(row), title_version: row.title_version, timestamp_semantics: row.timestamp_semantics,
      classification_status: row.classification_status, dictionary_version: row.dictionary_version,
      duplicate_group: newsCard(row).duplicate_group ? { ...newsCard(row).duplicate_group, members_returned: 0, members_query: { tool: "search_news", arguments: { duplicate_group_id: row.duplicate_group_id, group_mode: "items" } } } : null,
      republication_of: null,
    }, { basis: { ...EMPTY_BASIS, news_date_basis: "published" }, coverage: { scope: "official_press_release_metadata", complete: true, gaps: [] } });
  });

  // 16. get_news_archive_status
  register("get_news_archive_status", "보도자료 수집 현황", "대상 기관 레지스트리와 Source별 검증·승인·수집 상태를 분모와 함께 요약합니다. 내부 오류 원문·비공개 수집 설정은 포함하지 않습니다.", {
    source_kind: z.enum(["OFFICIAL_PRESS_RELEASE", "NEWS_ARTICLE"]).optional(),
    region_id: regionInput.optional(),
    organization_type: z.enum(ORG_TYPES).optional(),
    cursor: cursorInput,
    limit: limitInput(),
  }, async (args) => {
    const current = await state();
    const coverage = await readPressCoverage(data.db, now());
    if (args.source_kind === "NEWS_ARTICLE") {
      return envelope(current, now(), { source_kind: "NEWS_ARTICLE", status: "NOT_COLLECTED", sources: [] }, { coverage: { scope: "news_archive_status", complete: true, gaps: ["민간 언론 기사는 수집하지 않습니다."] } });
    }
    const region = args.region_id ? parseRegionId(args.region_id) : null;
    const prefixes = region ? (region.sido === "전남광주통합특별시" ? ["전남광주통합특별시", "광주광역시", "전라남도"] : [region.sido]).map((sido) => "org:" + sido + (region.sigungu ? ":" + region.sigungu : "")) : [];
    const sources = coverage.sources.filter((source) =>
      (!args.organization_type || source.organization_type === args.organization_type) &&
      (!prefixes.length || prefixes.some((prefix) => source.organization_id === prefix || source.organization_id.startsWith(prefix + ":"))));
    const limit = pageLimit(args.limit);
    const bound = fingerprint([current.bundleId, args.region_id ?? "", args.organization_type ?? ""]);
    const offset = decodeCursor(args.cursor, bound);
    const page = sources.slice(offset, offset + limit);
    const next = offset + page.length < sources.length ? encodeCursor(offset + page.length, bound) : null;
    return envelope(current, now(), {
      registry_version: coverage.registry_version, targets: coverage.targets, coverage: coverage.coverage,
      runs_24h: coverage.runs_24h, items: coverage.items, schedule: coverage.schedule,
      sources: page, source_total: sources.length,
    }, { coverage: { scope: "news_archive_status", complete: false, gaps: NEWS_GAPS.slice(0, 2) }, nextCursor: next });
  });

  // 17. get_welfare_context
  register("get_welfare_context", "사업 종합 맥락", "시행사업 하나의 공개 조건, 재정 연결 상태, 관련 보도자료 제목 링크를 각각의 출처·기준일·미확인 상태와 함께 묶어 돌려줍니다. 도메인별 기준일을 하나로 합치지 않습니다.", {
    implementation_id: implementationInput,
    as_of: asOfInput,
    fiscal_year: z.number().int().min(2000).max(2100).optional(),
    budget_reference_date: dateInput.optional(),
    news_date_from: dateInput.optional(),
    news_date_to: dateInput.optional(),
    news_date_basis: z.enum(["published", "discovered"]).optional(),
    news_source_kind: z.enum(["OFFICIAL_PRESS_RELEASE"]).optional(),
    news_region_basis: z.enum(["publisher_jurisdiction", "mentioned", "either"]).optional(),
    release_bundle_id: bundleInput,
    news_limit: z.number().int().min(1).max(LIMITS.newsContextMax).optional(),
  }, async (args) => {
    const current = await pinned(args);
    const run = requireRun(current);
    const basis = knowledgeBasis(run, args.as_of);
    if (args.news_region_basis && args.news_region_basis !== "publisher_jurisdiction") throw new McpToolError("REGION_BASIS_NOT_AVAILABLE", "본문을 보관하지 않아 언급 지역(mentioned) 기준은 제공하지 않습니다.");
    if (args.news_date_from && args.news_date_to && args.news_date_from > args.news_date_to) throw new McpToolError("INPUT_CONFLICT", "news_date_from이 news_date_to보다 늦습니다.");
    const row = await programOrThrow(run, args.implementation_id);
    const [parts, evidence, regionOrgs, provinceOrgs] = await Promise.all([
      articleOf(row), programEvidence(run, row),
      row.sigungu ? data.organizationsForRegion(row.sido, row.sigungu) : Promise.resolve([] as OrganizationRow[]),
      data.organizationsForRegion(row.sido, ""),
    ]);
    const { article } = parts;
    const supplementary = articleEvidence(row, parts, evidence[0]?.evidence_id ?? null);
    const organizationIds = [...regionOrgs, ...provinceOrgs].map((org) => org.organization_id);
    // 검토된 사업–재정사업 연결만 쓴다(공개본 이후 검토된 연결은 다음 공개본부터). 금액은 나누거나 합치지 않는다.
    const links = await verifiedLinksFor(data.db, args.implementation_id, data.pin.linksWatermark);
    const nameTokens = tokens(row.name.replace(/[()[\]·,]/g, " ")).filter((token) => token.length >= 2);
    const newsLimit = pageLimit(args.news_limit, LIMITS.newsContextDefault, LIMITS.newsContextMax);
    const news = organizationIds.length && nameTokens.length
      ? await data.news(newsFilter({ queryTokens: nameTokens, organizationIds, dateFrom: args.news_date_from ?? "", dateTo: args.news_date_to ?? "", dateBasis: args.news_date_basis ?? "published" }), 0, newsLimit)
      : { rows: [], total: 0 };
    return envelope(current, now(), {
      program: { ...programCard(row, baseUrl), overview: article.overview, content_status: article.contentStatus, overview_evidence_ref: supplementary.overviewRef, effective_reference_date: basis.effective_reference_date },
      eligibility: { application_conditions: article.applicationConditions ?? null, conditions_basis: article.conditionsBasis ?? null, application_method: meaningful(row.applicationMethod), personal_determination: false },
      fiscal: links.length
        ? {
          status: "LINKED_VERIFIED",
          linked_fiscal_projects: links.map((link) => ({ fiscal_project_id: link.source_id, link_id: link.link_id, relation: link.relation, basis: link.candidate_basis, reviewed_at: link.reviewed_at ? new Date(link.reviewed_at * 1000).toISOString() : null })),
          message: "관리자가 검토한 관련 재정사업입니다. 재정사업 금액은 이 사업만의 예산이 아닐 수 있어 사업별로 나누거나 합치지 않았습니다. 금액은 get_budget_execution(fiscal_project_ids)로 조회하세요.",
          requested_fiscal_year: args.fiscal_year ?? null, requested_reference_date: args.budget_reference_date ?? null,
        }
        : { status: "UNLINKED", reason_code: "NO_VERIFIED_FISCAL_LINK", message: "검토된 시행사업–재정사업 연결이 없어 예산·집행 정보를 붙이지 않습니다. 다른 지역 예산으로 대체하지 않습니다. find_budget_projects로 따로 찾을 수 있으나 같은 사업이라는 확인은 아닙니다.", requested_fiscal_year: args.fiscal_year ?? null, requested_reference_date: args.budget_reference_date ?? null },
      news: {
        status: news.rows.length ? "TITLE_MATCH_UNVERIFIED" : "NONE_FOUND",
        link_basis: "사업 지역의 시·군·구와 시·도가 발행한 공식 보도자료 중 제목에 사업명 낱말이 모두 들어간 항목(검증된 연결 아님)",
        date_basis: args.news_date_basis ?? "published",
        items: news.rows.map((item) => ({ article_id: item.item_id, title: item.title, issued_by: item.org_name, published_date: item.published_date || null, original_url: item.canonical_url, content_scope: "metadata_only" })),
        total_matches: news.total,
        note: news.rows.length ? "제목 일치일 뿐 같은 사업이라는 확인은 아닙니다." : "찾지 못했다고 관련 보도가 없다는 뜻은 아닙니다(수집 기관·기간이 제한적).",
      },
    }, {
      evidence: [...evidence, ...supplementary.items], basis: { ...basis, news_date_basis: args.news_date_basis ?? "published" },
      coverage: { scope: "welfare_context", complete: false, gaps: [KNOWLEDGE_GAP, "재정 연결 미가용", NEWS_GAPS[1]] },
      warnings: ["사업·재정·보도자료의 기준일은 서로 다르며 하나로 합치지 않았습니다."],
      truncated: news.total > news.rows.length,
    });
  });


  // 18~22. 외부 데이터 연계 조회(지역 돌봄 수요·장기요양기관·정부24·법령 근거·연계 현황)
  registerIntegrationTools({
    register,
    db: data.db,
    wrap: async (value, options = {}) => envelope(await state(), now(), value, options),
    today: () => new Date((now() + 9 * 3600) * 1000).toISOString().slice(0, 10),
  });

  return registered;
}

function newsFilter(partial: Partial<NewsFilter>): NewsFilter {
  return {
    queryTokens: [], categoryIds: [], organizationIds: [], organizationTypes: [], sido: "", sigungu: "",
    includeDescendants: false, dateFrom: "", dateTo: "", dateBasis: "published", ...partial,
  };
}
