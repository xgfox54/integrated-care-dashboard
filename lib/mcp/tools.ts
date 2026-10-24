import { manualSourceClarifications } from "../manuals/source-clarifications.ts";
// 공개 원격 MCP 도구(허용목록 기준). 저장된 공개 자료만 읽고(읽기 전용·멱등·외부 미접속), 각 결과에 공개본·기준일·범위·근거를 붙인다.
// 보도자료는 제목·기관·날짜·원문 주소·분류 같은 메타데이터만 돌려주며 본문·요약을 만들지 않는다.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SERVICE_CATEGORY_ORDER, serviceWikiKey, type ServiceRow } from "../dataset.ts";
import { readPressCoverage } from "../press/coverage.ts";
import { CATEGORY_LABELS } from "../press/dictionary.ts";
import { toPressDto, type PressItemRow } from "../press/query.ts";
import { REGION_DEFINITIONS } from "../region-statistics.ts";
import { TARGET_GROUPS } from "../target-groups.ts";
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
  EXECUTABLE_MCP_TOOL_NAMES,
  FISCAL_TOOL_NAMES,
  FISCAL_WITHHELD_MESSAGE,
  fingerprint,
  LIMITS,
  MCP_SCHEMA_VERSION,
  MCP_SERVER_VERSION,
  McpToolError,
  type McpToolName,
  META_MCP_TOOL_NAMES,
  pageLimit,
  PUBLIC_MCP_TOOL_NAMES,
} from "./contract.ts";
import { type LawRuntimeStatus, registerIntegrationTools } from "./integration-tools.ts";
import { registerStatisticsTools } from "./statistics-tools.ts";
import { decorateSourceIdentities } from "./source-identity.ts";
import { searchStatistics, statisticsCatalog } from "../statistics/catalog.ts";
import { currentStatisticsCatalog, currentStatisticsStatus, readCurrentStatistics } from "../statistics/store.ts";
import { type KnowledgeRun, type McpData, type NewsFilter, type OrganizationRow, type SourceDocument } from "./data.ts";
import { compareBudgetPeriods, findBudgetProjects, fiscalComponent, FISCAL_TOOL_SHAPES, getBudgetExecution, getFiscalCatalog } from "./fiscal.ts";
import { publishedSnapshots } from "../fiscal/query.ts";
import { type BundleRow, readActiveBundle, readBundle } from "../platform/bundle.ts";
import { verifiedLinksFor } from "../platform/links.ts";
import { ONTOLOGY_VERSION, ontologyEntities, ontologyPredicates } from '../ontology.ts';
import { CARE_MCP_WITHHELD_MESSAGE, CARE_RESOURCES_MCP } from '../integrations/care-hold.ts';
import { ledgerTotals } from "../official-ledger.ts";
import { readOptionalIndexes } from "../optional-index.ts";
import { unitVerificationSql } from "../fiscal/unit-check.ts";
import { budgetDocumentComponent, parseBudgetPin, type BudgetRevisionPin } from "../fiscal/budget-publication.ts";
import { BUDGET_DOCUMENT_NOTE, BUDGET_DOCUMENT_TOOL_SHAPES, budgetDocumentStatus, budgetLineSource, getBudgetBreakdown, searchBudgetLines, searchBudgetReferences } from "./budget-documents.ts";
import { FISCAL_AMOUNT_NOTE, fiscalVerificationStatus } from "./fiscal-amounts.ts";
import { presenceBaseline, presenceByServiceId, presenceRun, presenceSummaryDto, temporalDto } from "../service-presence.ts";
import { allDocumentFacts, documentComponent, documentEvidence as documentEvidenceRows, documentFactDto, documentFactsFor, documentSourceRows, searchDocumentPrograms, type DocFactRow } from "../imports/public.ts";
import { programPublicInfo } from "../integrations/public.ts";
import { canonicalProgramRegion, regionLabel } from "./regions.ts";
import { budgetReferenceQuery, fuseSearchCandidates } from "./search-fusion.ts";
import { refineWelfareQuery } from "./query-refiner.ts";
import { getGov24Service, GOV24_PREFIX, gov24DatasetState, gov24SearchRelevance, gov24Text, searchGov24Services, welfareCandidateNotes, welfareRelevance } from "./gov24.ts";
import { resolveProgramEvidence } from "./evidence-resolution.ts";
import { FAQ129_NOTICE, FAQ129_PREFIX, FAQ129_PUBLISHER, faq129Text, getFaq129, searchFaq129 } from "./faq129.ts";
import { faqReviewMetadata } from './source-review.ts';
import { assessAnswerability, EVIDENCE_TYPES, lawNameForQuery, type LawSearchHit, parseLawSearchHits, parseLawToc, pickLawArticles, relaxationStages, suggestedSources, webSearchFallback } from "./search-support.ts";
import { runLawTool } from "../law/mcp-tools.ts";
import { LAW_MCP_PUBLIC, LAW_MCP_WITHHELD_MESSAGE } from "./contract.ts";
import type { McpCacheDetail, McpToolObservation } from "./usage.ts";
import { scanSensitiveText } from "../privacy-guard.ts";
import { databaseIdentity } from "../sql-database.ts";
import { isTransientStoreError } from "../store-errors.ts";
import type { ManualSearchHit } from "../manuals/types.ts";
import { manualCorpusComponent, readManualCorpusState } from "../manuals/store.ts";
import { getManualSection, relatedManualApplicationSections, searchManualSections } from "../manuals/search.ts";
import { manualOriginalProvenance } from '../manuals/provenance.ts';
import { manualAnswerContext, manualAnswerContextEvidence } from '../manuals/answer-context.ts';
import { normalizeSearchCacheQuery, searchCacheKey, searchCacheWriteOf, trackSearchCacheWrite, type SearchResultCache } from "./search-cache.ts";
import { regionalCatalogBrowse, welfareCatalogFor, welfareCatalogText, WELFARE_CATALOG_PREFIX, type WelfareCatalogAssets } from './welfare-catalog.ts';
import {
  DEFAULT_AUTO_DETAIL_ITEMS,
  DEFAULT_WELFARE_CHAIN_DEADLINE_MS,
  detectWelfareResearchTask,
  discoverWelfareTools,
  executeAutoDetailChain,
  formatSuggestedToolCalls,
  isBlockedCareTool,
  isBlockedLawTool,
  MAX_AUTO_DETAIL_ITEMS,
  raceWelfareDeadline,
  startWelfareChainDeadline,
  suggestFollowUpCallsForSearch,
  toSuggestedToolCall,
  WELFARE_RESEARCH_TASKS,
  type WelfareToolDescriptor,
} from "./tool-chains.ts";

export interface McpToolContext {
  readonly welfareAssets?: WelfareCatalogAssets;
  readonly data: McpData;
  /** 사이트 주소(WIKI 링크용). 요청 주소에서 정하며 도구 입력으로 받지 않는다. */
  readonly baseUrl: string;
  readonly nowSeconds?: () => number;
  readonly onUnexpectedError?: (error: unknown, tool: string) => void;
  readonly includeFiscal?: boolean;
  /** 내장 법령 런타임 상태(키 값은 담지 않음). get_integration_status가 실시간 조회 가능 여부를 알리는 데 쓴다. */
  readonly lawRuntime?: LawRuntimeStatus;
  /** Worker LAW_OC 값. 법률 질문의 통합 검색과 law: 상세 조회에만 쓰며 응답에 넣지 않는다. */
  readonly lawApiKey?: string;
  /** 요청 한도 구분(검증된 사용자 단위 또는 IP 단위). 값 자체(사용자 ID)는 담지 않는다. */
  readonly requestIdentity?: "verified_subject" | "client_key" | "anonymous";
  readonly requestId?: string;
  /** 활성 공개본 상태를 실행 환경 안에서 재사용할 시간(ms). 운영 Worker만 켜고 시험·기본값은 0(매 요청 조회). */
  readonly stateCacheMs?: number;
  /** 통합 검색 출처별 시간 한도(ms). 넘긴 출처는 SOURCE_TIMEOUT으로 표시하고 받은 결과로 응답한다. */
  readonly searchSourceDeadlineMs?: number;
  /** 통합 검색 결과 공유 캐시(운영 Worker만 지정). 없으면 매번 조회한다. */
  readonly searchCache?: SearchResultCache;
  readonly observeTool?: (observation: McpToolObservation) => void;
}

const LAW_LOOKUP_TIMEOUT_MS = 5000;
const SEARCH_SOURCE_DEADLINE_MS = 8000;
const MCP_CACHE_BUILD = typeof __MCP_CACHE_VERSION__ === "string" ? __MCP_CACHE_VERSION__ : "dev";
const publicStateCache = new WeakMap<object, { at: number; state: PublicState; pin: McpData["pin"] }>();

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
  readonly budgetPin: BudgetRevisionPin;
  /** 빈 문자열은 이 공개본에 반입 완료한 매뉴얼이 없음을 뜻한다. 현재 staging으로 되돌아가지 않는다. */
  readonly manualPin: string;
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

/** 대상자 묶음. 공개 원문(대상·세부대상·사업명)에 이 낱말이 들어 있는지만 본다. 개인 자격 판정이 아니다. 웹 필터(target_group)와 같은 정의(lib/target-groups.ts). */
export { TARGET_GROUPS };
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
const questionInput = z.string().max(LIMITS.questionMax);
const implementationInput = z.string().min(9).max(LIMITS.idMax).describe("시행사업(service:), 정부24 서비스(gov24_service:), 문서 정의 사업(docprog:) ID. find_programs·search 결과의 implementation_id/id.");

// ---------- 공통 도우미 ----------
function kstDate(seconds: number): string {
  return new Date((seconds + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

function tokens(query: string | undefined): string[] {
  return (query ?? "").split(/\s+/).map((token) => token.trim()).filter(Boolean).slice(0, 5);
}

export function regionIdOf(sido: string, sigungu: string): string {
  const region = canonicalProgramRegion(sido, sigungu);
  return region.sigungu ? "region:" + region.sido + "|" + region.sigungu : "region:" + region.sido;
}

export function parseRegionId(regionId: string): { sido: string; sigungu: string } {
  const match = /^region:([^|]{2,20})(?:\|([^|]{1,30}))?$/.exec(regionId.trim());
  if (!match || !SIDO_NAMES.has(match[1])) {
    throw new McpToolError("REGION_ID_INVALID", "지역 ID가 올바르지 않습니다. get_ontology_schema(section=\"code_systems\")의 region 목록을 확인해 주세요.");
  }
  return canonicalProgramRegion(match[1], match[2] ?? "");
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
  const region = canonicalProgramRegion(row.sido, row.sigungu);
  return {
    implementation_id: key,
    entity_type: "implementation",
    name: row.name,
    region: { region_id: regionIdOf(region.sido, region.sigungu), sido: region.sido, sigungu: region.sigungu || null },
    scope_level: region.sigungu ? "municipality" : "province",
    ...(region.sigungu !== row.sigungu ? { source_region: { sido: row.sido, sigungu: row.sigungu }, region_normalization: "DUPLICATED_PROVINCE_AS_PROVINCE" } : {}),
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

function errorResult(code: string, message: string, requestId?: string) {
  const value = { error: { code, message, ...(requestId ? { request_id: requestId } : {}) } };
  return { ...toolResult(value), isError: true };
}

/** D1 과부하·연결 끊김처럼 다시 시도하면 풀리는 저장소 오류인지 본다(메시지 원문은 응답에 넣지 않는다). */
// 통합 검색 결과에서는 매뉴얼 출처의 확인용 핵심만 남긴다. 전체 출처는 fetch·get_manual_section이 돌려준다.
type ManualCitation = Awaited<ReturnType<typeof searchManualSections>>[number]["sources"][number];
function compactManualSource(source: ManualCitation) {
  return {
    document_title: source.document_title, original_name: source.original_name, url: source.url, url_kind: source.url_kind,
    source_year: source.source_year, source_year_basis: source.source_year_basis,
    applicable_year: source.applicable_year, jurisdiction: source.jurisdiction, jurisdiction_verified: source.jurisdiction_verified,
    location: { start_line: source.location.start_line, end_line: source.location.end_line, heading_path: source.location.heading_path },
  };
}
/** 모든 매뉴얼 구간에 붙는 공통 경고(검색 응답 최상위에 한 번 표시). */
const MANUAL_COMMON_WARNINGS = [
  "파싱본 근거 후보입니다. 파일명 연도·기관·관할 메타데이터는 적용연도나 개인 자격의 확인값이 아닙니다.",
  "위치는 Markdown 줄 번호입니다. PDF 물리 쪽수와 이미지 본문은 확인되지 않았습니다.",
];
function sectionSpecificWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((warning) => !MANUAL_COMMON_WARNINGS.includes(warning));
}

// ---------- 서버에 17개 도구 등록 ----------
export function registerWelfareTools(server: McpServer, context: McpToolContext): McpToolName[] {
  const { data, baseUrl } = context;
  const welfareCatalog = context.welfareAssets ? welfareCatalogFor(context.welfareAssets) : null;
  function requireWelfareCatalog() {
    if (!welfareCatalog) throw new McpToolError('WELFARE_CATALOG_UNAVAILABLE', '복지제도100 자료 연결을 사용할 수 없습니다.');
    return welfareCatalog;
  }
  const catalogCandidate = (item: Awaited<ReturnType<NonNullable<typeof welfareCatalog>['search']>>['items'][number]) => ({ ...item, title: '[복지제도100] ' + item.name + ' (' + regionLabel(item.sido, item.sigungu) + ')' });
  async function catalogDetailEnvelope(current: PublicState, id: string, question?: string, asOf?: string) {
    const plan = detailQuestionPlan(question);
    const detail = await requireWelfareCatalog().detail(id, baseUrl, plan?.year ?? null);
    const basis = storedEvidenceBasis([detail.as_of], asOf, '복지제도100');
    const eligibility = { application_conditions: detail.target, selection_criteria: detail.selection, application_method: detail.apply_method, personal_determination: false };
    return envelope(current, now(), { ...detail, ...eligibility, implementation_id: detail.id, entity_id: detail.id, program: { implementation_id: detail.id, name: detail.name, entity_type: detail.entity_type, region_id: detail.region_id }, eligibility, fiscal: { status: 'UNLINKED' }, news: { status: 'NOT_REQUESTED', items: [] }, ...(plan ? { query_plan: plan } : {}) }, { basis, evidence: [detail.source, ...detail.additional_sources], warnings: detail.warnings, coverage: { scope: detail.content_scope, complete: false, gaps: ['현재 저장된 대장 상세입니다. 적용연도·개인 자격은 별도 확인이 필요합니다.'] } });
  }
  const fiscalOn = context.includeFiscal === true;
  const now = context.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const registered: McpToolName[] = [];
  const toolCatalog = new Map<McpToolName, WelfareToolDescriptor>();
  const internalHandlers = new Map<McpToolName, (rawArgs: unknown) => Promise<object>>();
  let statePromise: Promise<PublicState> | null = null;

  const autoDetailFields = {
    auto_detail: z.boolean().optional().describe("true이면 상위 결과의 상세 도구(get_welfare_context·get_manual_section·get_faq·get_statistics_data 등)를 연속 호출해 chained_details에 함께 담습니다."),
    detail_limit: z.number().int().min(1).max(MAX_AUTO_DETAIL_ITEMS).optional().describe("auto_detail=true일 때 자동 조회할 상위 후보 수(기본 2, 최대 3)"),
  } as const;

  async function invokeInternal(name: McpToolName, rawArgs: Record<string, unknown>): Promise<object> {
    const fn = internalHandlers.get(name);
    if (!fn) throw new McpToolError("TOOL_NOT_AVAILABLE", "현재 실행할 수 없는 도구입니다: " + name);
    return fn(rawArgs);
  }

  async function attachOptionalChain<T extends object>(
    basePayload: T,
    candidates: readonly { readonly id?: string; readonly implementation_id?: string; readonly dataset_id?: string; readonly budget_line_id?: string; readonly institution_id?: string; readonly entity_type?: string }[],
    options: { readonly autoDetail?: boolean; readonly detailLimit?: number; readonly question?: string; readonly releaseBundleId?: string; readonly regionId?: string | null },
  ): Promise<T & { suggested_tool_calls: ReturnType<typeof suggestFollowUpCallsForSearch>; next_actions_text: string; chained_details?: Awaited<ReturnType<typeof executeAutoDetailChain>>["items"]; chain_summary?: Omit<Awaited<ReturnType<typeof executeAutoDetailChain>>, "items"> }> {
    const suggested = suggestFollowUpCallsForSearch(candidates, {
      question: options.question,
      releaseBundleId: options.releaseBundleId,
      regionId: options.regionId,
    });
    const nextActionsText = formatSuggestedToolCalls(suggested);
    if (!options.autoDetail) {
      return { ...basePayload, suggested_tool_calls: suggested, next_actions_text: nextActionsText };
    }
    const chained = await executeAutoDetailChain(candidates, invokeInternal, {
      question: options.question,
      releaseBundleId: options.releaseBundleId,
      limit: options.detailLimit,
    });
    const { items, ...summary } = chained;
    return {
      ...basePayload,
      suggested_tool_calls: suggested,
      next_actions_text: nextActionsText,
      chained_details: items,
      chain_summary: summary,
    };
  }

  register('search_welfare_services', '복지제도100 사업 목록·검색', '복지제도100 저장 대장을 지역·검색어로 조회합니다. include_ancestor_scope=true면 전국·광역 사업도 포함합니다. 반환된 welfare100_service: ID는 get_welfare_context·fetch로 읽거나 auto_detail=true로 즉시 연결하세요.', {
    query: questionInput.optional(), region_id: regionInput.optional(), include_ancestor_scope: z.boolean().optional(),
    offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(LIMITS.listMax).optional(),
    ...autoDetailFields,
  }, async args => {
    if (args.region_id && args.region_id !== 'region:전국') parseRegionId(args.region_id);
    const plan = refineWelfareQuery(args.query ?? '', { currentYear: Number(kstDate(now()).slice(0, 4)) });
    if (args.region_id && plan.region_id && args.region_id !== plan.region_id) throw new McpToolError('INPUT_CONFLICT', '질문 지역과 region_id가 다릅니다.');
    const page = await requireWelfareCatalog().search({ ...plan, region_id: args.region_id ?? plan.region_id, include_ancestor_scope: args.include_ancestor_scope ?? false }, baseUrl, args.offset ?? 0, pageLimit(args.limit));
    const items = page.items.map(({ rank: _rank, ...item }) => item);
    return attachOptionalChain(
      { ...page, items, server_version: MCP_SERVER_VERSION, scope: 'welfare100_web_catalog', personal_determination: false },
      items,
      { autoDetail: args.auto_detail, detailLimit: args.detail_limit, question: args.query, regionId: args.region_id ?? plan.region_id },
    );
  });

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
      const pinnedNews = typeof parsed.news?.detail?.registry_version === "string" && typeof parsed.news?.detail?.public_items === "number"
        ? { registryVersion: parsed.news.detail.registry_version, publicItems: parsed.news.detail.public_items }
        : null;
      const [run, news] = await Promise.all([data.latestRun(), pinnedNews ? Promise.resolve(pinnedNews) : data.newsComponent()]);
      return {
        run, bundleId: active.bundle_id,
        components: { knowledge: active.knowledge_snapshot_id, fiscal: active.fiscal_snapshot_id, news: active.news_snapshot_id, links: active.link_snapshot_id, documents: parsed.documents?.id ?? null, budget_documents: parsed.budget_documents?.id ?? null, manuals: parsed.manuals?.id ?? null },
        newsRegistryVersion: news.registryVersion, newsPublicItems: news.publicItems,
        fiscalPin: Array.isArray(snapshotIds) ? snapshotIds.filter((id): id is string => typeof id === "string") : [],
        documentPin: Array.isArray(documentPairs) ? documentPairs.filter((pair): pair is string => typeof pair === "string") : [],
        budgetPin: parseBudgetPin(parsed.budget_documents?.detail?.revision_pairs),
        manualPin: typeof parsed.manuals?.detail?.revision === "string" ? parsed.manuals.detail.revision : "",
        bundle: active,
      };
    }
    const [run, news, fiscal, documents, budgetDocuments, manuals] = await Promise.all([data.latestRun(), data.newsComponent(), fiscalComponent(data.db), documentComponent(data.db), budgetDocumentComponent(data.db), manualCorpusComponent(data.db)]);
    const knowledge = run ? "kg:" + run.id : null;
    const newsId = news.registryVersion ? "news:" + news.registryVersion + "@" + (news.dictionaryVersions.join("+") || "none") : null;
    const components: BundleComponents = { knowledge, fiscal, news: newsId, links: null, documents: documents.id, budget_documents: budgetDocuments.id, manuals: manuals.id };
    return {
      run,
      bundleId: "rb:" + fingerprint(components),
      components,
      newsRegistryVersion: news.registryVersion,
      newsPublicItems: news.publicItems,
      fiscalPin: null,
      documentPin: null,
      budgetPin: parseBudgetPin(budgetDocuments.detail.revision_pairs),
      manualPin: typeof manuals.detail.revision === "string" ? manuals.detail.revision : "",
      bundle: null,
    };
  }

  function state(): Promise<PublicState> {
    statePromise ??= cachedState().then((loaded) => fiscalOn ? loaded : { ...loaded, components: { ...loaded.components, fiscal: null, budget_documents: null } });
    return statePromise;
  }

  // 공개본은 배경 작업이 가끔 바꾼다. 짧게 재사용해 요청마다 D1 왕복 두 번(공개본·실행 정보)을 줄인다.
  async function cachedState(): Promise<PublicState> {
    const ttl = context.stateCacheMs ?? 0;
    if (ttl <= 0) return loadState();
    const key = databaseIdentity(data.db);
    const hit = publicStateCache.get(key);
    if (hit && Date.now() - hit.at < ttl) { data.pin = { ...hit.pin }; return hit.state; }
    const loaded = await loadState();
    publicStateCache.set(key, { at: Date.now(), state: loaded, pin: { ...data.pin } });
    return loaded;
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

  function storedEvidenceBasis(collectedAt: readonly (string | null)[], asOf: string | undefined, sourceName: string): Basis {
    const dates = collectedAt.filter((value): value is string => Boolean(value)).map((value) => Date.parse(value)).filter(Number.isFinite).map((value) => kstDate(value / 1000));
    const collected = dates.sort().at(-1) ?? null;
    if (asOf && (!collected || asOf < collected)) throw new McpToolError("AS_OF_NOT_AVAILABLE", sourceName + "는 현재 저장된 자료만 제공하며 요청한 " + asOf + " 시점의 조회본은 보관하지 않습니다." + (collected ? " 현재 자료의 수집 기준일은 " + collected + "입니다." : " 수집 기준일도 확인되지 않습니다."));
    return { requested_reference_date: asOf ?? null, effective_reference_date: collected, news_date_basis: null };
  }

  function detailQuestionPlan(question: string | undefined) {
    if (!question) return null;
    const plan = refineWelfareQuery(question, { currentYear: Number(kstDate(now()).slice(0, 4)) });
    if (plan.year_source === "comparison" || plan.year_source === "ambiguous" || plan.year !== null && plan.excluded_years.includes(plan.year)) {
      throw new McpToolError("YEAR_SCOPE_REVIEW_REQUIRED", "질문에 비교할 연도가 여러 개이거나 포함·제외 연도가 충돌합니다. 적용연도를 하나씩 지정하여 조회해 주세요. 현재 연도로 임의 대체하지 않습니다.");
    }
    return plan;
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
      if (missing) throw new McpToolError("MISSING_FROM_LATEST_SOURCE", "「" + missing.name + "」(" + regionLabel(missing.sido, missing.sigungu) + ")은 최근 수집한 보건복지부 원본에서 빠졌습니다(마지막 확인 " + new Date(missing.last_seen_at * 1000).toISOString().slice(0, 10) + "). 폐지·종료로 확인된 것은 아닙니다.");
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
    const own = documents.filter((document) => canonicalProgramRegion(document.province, document.municipality).sigungu === canonicalProgramRegion(row.sido, row.sigungu).sigungu);
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

  async function manualSectionOf(current: PublicState, id: string, offset = 0, limit = 8_000) {
    const section = await getManualSection(data.db, id, { revision: current.manualPin, offset, limit });
    if (!section) throw new McpToolError("NOT_FOUND", "이 공개본에서 매뉴얼 구간을 찾지 못했습니다. search 또는 search_manuals 결과의 manual: ID를 사용하세요.");
    const related = await relatedManualApplicationSections(data.db, section);
    return { ...section, source_clarifications: manualSourceClarifications(section.document_id, section.sources[0].document_sha256, section.section_id, section.sources[0].content_sha256), answer_context: manualAnswerContext(section, related), related_application_sections: related, answer_composition_instructions: '표는 적용 연도·행·열·단위를 구분하고 각주와 예외를 함께 읽으세요. source_clarifications는 원문 충돌을 공식 자료와 대조한 결과이므로 경고·우선 확인 구간·출처를 함께 반영하세요. selected_table_verifications는 기재된 사실만 원본 이미지로 확인한 결과이며 전체 절·현행 정책 검증이 아닙니다. 신청 절차의 대상·필수서류·신청 창구·방법을 관련 원문에서 함께 확인하세요. related_application_sections는 같은 원문에서 찾은 인접 서류·온라인 제한 근거이며 반드시 함께 읽으세요. 대리신청은 신청자와 대리인의 서류를 각각 구분하고, 온라인·대리신청 제한과 예외도 확인하세요. 이 구간에 없는 사항은 관련 FAQ 또는 매뉴얼을 추가 조회하고 미확인 사항을 단정하지 마세요.', original_provenance: await manualOriginalProvenance(data.db, section.revision, section.document_id, section.section_id) };
  }

  function manualFetchCard(current: PublicState, section: Awaited<ReturnType<typeof manualSectionOf>>) {
    const source = section.sources[0];
    return {
      id: section.id, title: section.title, url: source.url,
      text: [
        "문서: " + source.document_title,
        "내부 원문명: " + source.original_name,
        "위치: 파싱 Markdown " + source.location.start_line + "–" + source.location.end_line + "행 / " + source.location.heading_path,
        "연도 표기: " + (source.source_year ?? "미확인") + " (" + source.source_year_basis + ", 적용연도 확인값 아님)",
        "출처: " + source.url,
        "원본 파일: " + (section.original_provenance.original?.original_name ?? '미확인'),
        "답변 작성 시 확인사항: " + section.answer_composition_instructions,
        "MANUAL_CONDITION_EVIDENCE " + JSON.stringify(manualAnswerContextEvidence(section.answer_context)),
        ...(section.source_clarifications.length ? ["MANUAL_SOURCE_CLARIFICATIONS " + JSON.stringify(section.source_clarifications)] : []),
        ...(section.original_provenance.selected_table_verifications?.length ? ["MANUAL_VERIFIED_TABLE_FACTS " + JSON.stringify(section.original_provenance.selected_table_verifications)] : []),
        ...(section.original_provenance.original?.official_url ? ["공식 원본(파일 해시 대조): " + section.original_provenance.original.official_url] : []),
        "", section.text,
        ...section.related_application_sections.flatMap((related) => [
          "", "함께 확인할 신청 근거: " + related.title,
          "구간 ID: " + related.id, "출처: " + related.sources[0].url, related.text,
          ...(related.truncated ? ["이 보충 구간은 일부입니다. get_manual_section의 next_offset=" + related.next_offset + "으로 이어 읽으세요."] : []),
        ]),
        ...(section.truncated ? ["", "이 구간의 본문이 더 있습니다. get_manual_section에 같은 section_id와 next_offset=" + section.next_offset + "을 전달해 이어 읽으세요."] : []),
        "", ...section.warnings,
      ].join("\n"),
      metadata: {
        entity_type: "manual_section", content_scope: section.content_scope,
        manual_revision: section.revision, section_id: section.section_id, document_id: section.document_id,
        release_bundle_id: current.bundleId, manual_component: current.components.manuals,
        sources: section.sources, warnings: section.warnings,
        original_provenance: section.original_provenance,
        source_clarifications: section.source_clarifications,
        answer_composition_instructions: section.answer_composition_instructions,
        answer_context: section.answer_context,
        related_application_sections: section.related_application_sections,
        excerpt: { offset: section.offset, returned_chars: section.returned_chars, total_chars: section.total_chars, next_offset: section.next_offset, truncated: section.truncated },
        image_content_available: section.image_content_available, personal_determination: false,
      },
    };
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

  async function faqStatus(): Promise<Record<string, unknown>> {
    try {
      const row = await data.db.prepare("SELECT MAX(revision) AS revision, COUNT(*) AS items, MIN(written_date) AS oldest, MAX(written_date) AS newest FROM faq_129")
        .first<{ revision: string | null; items: number; oldest: string | null; newest: string | null }>();
      if (!row?.items) return { status: "UNAVAILABLE", reason: "129 자주하는 질문 자료가 적재되지 않았습니다." };
      return {
        status: "AVAILABLE", revision: row.revision, items: row.items, written_date_range: [row.oldest, row.newest], publisher: FAQ129_PUBLISHER,
        scope: "보건복지상담센터 누리집 자주하는 질문 전체 목록의 수집 시점 사본(질문·답변·작성일)",
        gaps: ["작성일 이후 바뀐 금액·기준은 반영되지 않습니다.", "129 상담 기록이나 개별 민원 답변은 포함하지 않습니다."],
      };
    } catch (error) {
      if (error instanceof Error && /no such table/i.test(error.message)) return { status: "UNAVAILABLE", reason: "129 자주하는 질문 표가 아직 없습니다." };
      throw error;
    }
  }

  function register<Shape extends z.ZodRawShape>(
    name: McpToolName,
    title: string,
    description: string,
    shape: Shape,
    handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<object>,
  ): void {
    // 보류된 도구(돌봄자원·예산)는 등록하지 않는다(lib/integrations/care-hold.ts, contract.ts FISCAL_MCP_PUBLIC).
    if (!EXECUTABLE_MCP_TOOL_NAMES.includes(name) && !(fiscalOn && FISCAL_TOOL_NAMES.has(name))) return;
    const schemaObj = z.object(shape).strict();
    toolCatalog.set(name, { name, title, description, parameters: Object.keys(shape) });
    internalHandlers.set(name, async (rawArgs: unknown) => {
      const parsed = schemaObj.parse(rawArgs ?? {});
      const payload = await handler(parsed);
      const metadata = "metadata" in payload && typeof payload.metadata === "object" && payload.metadata !== null ? payload.metadata : {};
      const versioned = name === "fetch" ? { ...payload, metadata: { ...metadata, server_version: MCP_SERVER_VERSION } } : payload;
      return decorateSourceIdentities(name, versioned, { gates: { fiscal: fiscalOn, care: CARE_RESOURCES_MCP, law: LAW_MCP_PUBLIC } });
    });
    server.registerTool(name, { title, description, inputSchema: shape, annotations: { title, ...ANNOTATIONS, ...(name === "get_statistics_data" ? { openWorldHint: true } : {}) } }, (async (args: z.objectOutputType<Shape, z.ZodTypeAny>, extra: { requestId?: string | number }) => {
      const started = Date.now();
      let failed = false;
      let cache: "HIT" | "MISS" | undefined;
      let cacheDetail: McpCacheDetail | undefined;
      let cacheWrite: Promise<string> | undefined;
      let responsePayload: object | undefined;
      try {
        const payload = await handler(args);
        if ("cache" in payload && (payload.cache === "HIT" || payload.cache === "MISS")) cache = payload.cache;
        if ("cache_detail" in payload) cacheDetail = payload.cache_detail as McpCacheDetail;
        cacheWrite = searchCacheWriteOf(payload);
        const metadata = "metadata" in payload && typeof payload.metadata === "object" && payload.metadata !== null ? payload.metadata : {};
        const versioned = name === "fetch" ? { ...payload, metadata: { ...metadata, server_version: MCP_SERVER_VERSION } } : payload;
        responsePayload = decorateSourceIdentities(name, versioned, { gates: { fiscal: fiscalOn, care: CARE_RESOURCES_MCP, law: LAW_MCP_PUBLIC } });
        return toolResult(responsePayload);
      } catch (error) {
        failed = true;
        if (error instanceof McpToolError) {
          responsePayload = { error: { code: error.code } };
          return errorResult(error.code, error.message);
        }
        // 공개 응답에는 스택·내부 메시지 대신 서버 로그와 대조할 요청 ID만 준다.
        const requestId = context.requestId ?? crypto.randomUUID();
        responsePayload = { error: { code: isTransientStoreError(error) ? "DATA_SOURCE_BUSY" : "INTERNAL_ERROR" } };
        context.onUnexpectedError?.(error, name + "#" + requestId);
        if (isTransientStoreError(error)) return errorResult("DATA_SOURCE_BUSY", "자료 저장소가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.", requestId);
        return errorResult("INTERNAL_ERROR", "조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", requestId);
      } finally {
        context.observeTool?.({ tool: name, durationMs: Date.now() - started, failed, cache, cacheDetail, cacheWrite, arguments: args, response: responsePayload, callId: extra?.requestId === undefined ? undefined : String(extra.requestId), requestId: context.requestId });
      }
    }) as never);
    if (PUBLIC_MCP_TOOL_NAMES.includes(name) || (fiscalOn && FISCAL_TOOL_NAMES.has(name) && PUBLIC_MCP_TOOL_NAMES.includes(name))) {
      registered.push(name);
    }
  }

  // 1. search
  register("search", "통합 검색", "자연어 질문에서 사업명·지역·연도·의도를 분리해 시행사업·정부24·복지제도100·매뉴얼·129 FAQ·예산서·보도자료·통계를 찾습니다. auto_detail=true면 상위 후보의 상세를 자동 연속 조회합니다.", {
    query: questionInput.min(1).describe("사업명 또는 자연어 질문. 지역·포함/제외 연도·사업명·질문 의도를 자동 분리합니다."),
    ...autoDetailFields,
  }, async ({ query, auto_detail, detail_limit }) => {
    const current = await state();
    const plan = refineWelfareQuery(query, { currentYear: Number(kstDate(now()).slice(0, 4)) });
    const words = plan.search_tokens;
    const browse = regionalCatalogBrowse(plan) && Boolean(welfareCatalog);
    const cacheBypass = (reason: string) => context.searchCache ? { cache_detail: { status: "BYPASS" as const, reason } } : {};
    if (!words.length && !browse) {
      if (!query.trim()) throw new McpToolError("QUERY_EMPTY", "검색어를 입력해 주세요.");
      return { results: [], query_plan: plan, release_bundle_id: current.bundleId, server_version: MCP_SERVER_VERSION, retrieval_status: "NO_USABLE_SEARCH_TERMS", answerability: "INSUFFICIENT", reason_codes: ["NO_USABLE_SEARCH_TERMS"], suggested_sources: suggestedSources(plan), suggested_tool_calls: [], next_actions_text: "", web_search_fallback: webSearchFallback(plan, { answerability: "INSUFFICIENT", reason_codes: ["NO_USABLE_SEARCH_TERMS"] }), warnings: plan.warnings, ...cacheBypass("no_search_terms") };
    }
    const region = plan.region_id && plan.region_id !== "region:전국" ? parseRegionId(plan.region_id) : { sido: "", sigungu: "" };
    const cacheStarted = Date.now();
    const sensitiveQuery = scanSensitiveText(query).length > 0;
    const rehydrateCachedSearch = async (cachedValue: object) => {
      const cached = cachedValue as { query_plan?: typeof plan; answerability?: "SUPPORTED" | "PARTIAL" | "INSUFFICIENT" | "CONFLICT"; reason_codes?: string[]; results?: { id?: string; entity_type?: string }[]; release_bundle_id?: string };
      const base = cached.query_plan && cached.query_plan.raw_query !== query && cached.answerability && Array.isArray(cached.reason_codes)
        ? { ...cachedValue, query_plan: plan, web_search_fallback: webSearchFallback(plan, { answerability: cached.answerability, reason_codes: cached.reason_codes }) }
        : cachedValue;
      if (!auto_detail) return base;
      return attachOptionalChain(base, cached.results ?? [], { autoDetail: true, detailLimit: detail_limit, question: query, releaseBundleId: cached.release_bundle_id ?? current.bundleId, regionId: plan.region_id });
    };
    if (browse) {
      const browseKey = context.searchCache && !sensitiveQuery ? await searchCacheKey(["search-browse-v2", MCP_SERVER_VERSION, MCP_CACHE_BUILD, current.bundleId, plan.region_id, plan.include_ancestor_scope]) : null;
      const browseLookup = browseKey ? await context.searchCache!.get(browseKey) : null;
      if (browseLookup?.value) return { ...(await rehydrateCachedSearch(browseLookup.value)), cache: "HIT", cache_detail: { status: "HIT", layer: browseLookup.layer }, timings_ms: { cache_hit: Date.now() - cacheStarted } };
      const page = await requireWelfareCatalog().search(plan, baseUrl);
      const assessment = { answerability: page.items.length ? 'SUPPORTED' as const : 'INSUFFICIENT' as const, reason_codes: page.items.length ? [] : ['COVERAGE_GAP'] };
      const fusedBrowse = fuseSearchCandidates(page.items.map(catalogCandidate), plan);
      const browseSuggestions = suggestFollowUpCallsForSearch(fusedBrowse, { question: query, releaseBundleId: current.bundleId, regionId: plan.region_id });
      const browsePayload = { results: fusedBrowse, query_plan: plan, release_bundle_id: current.bundleId, server_version: MCP_SERVER_VERSION, retrieval_status: page.items.length ? 'CANDIDATES_FOUND' : 'COVERAGE_GAP', ...assessment, suggested_sources: suggestedSources(plan), suggested_tool_calls: browseSuggestions, next_actions_text: formatSuggestedToolCalls(browseSuggestions), web_search_fallback: webSearchFallback(plan, assessment), welfare_catalog: { ...page, items: undefined, list_tool: 'search_welfare_services' }, warnings: ['지역 사업 목록입니다. 전국·광역 공통사업과 시 전용사업을 region_id로 구분하세요. 전체 목록은 search_welfare_services로 나누어 조회하세요.'] };
      const finalBrowse = auto_detail ? await attachOptionalChain(browsePayload, fusedBrowse, { autoDetail: true, detailLimit: detail_limit, question: query, releaseBundleId: current.bundleId, regionId: plan.region_id }) : browsePayload;
      if (!browseKey || !browseLookup) return { ...finalBrowse, ...(sensitiveQuery ? cacheBypass("sensitive_query") : {}) };
      const storedBrowse = context.searchCache!.put(browseKey, browsePayload);
      const browseLookupFailed = browseLookup.miss === "lookup_error" || browseLookup.miss === "backend_cooldown";
      const browseCacheDetail: McpCacheDetail = { status: browseLookupFailed ? "ERROR" : storedBrowse.reason ? "NOT_STORED" : "MISS", lookup: browseLookup.miss, ...(storedBrowse.reason ? { reason: storedBrowse.reason } : {}) };
      return trackSearchCacheWrite({ ...finalBrowse, cache: "MISS", cache_detail: browseCacheDetail }, storedBrowse.write);
    }
    const preGov24State = context.searchCache && !sensitiveQuery ? await gov24DatasetState(data.db).catch(() => null) : null;
    const cacheKey = context.searchCache && !sensitiveQuery ? await searchCacheKey(["search-v2", MCP_SERVER_VERSION, MCP_CACHE_BUILD, current.bundleId, current.manualPin, fiscalOn, Boolean(context.lawApiKey?.trim()), kstDate(now()), preGov24State?.revision ?? null, normalizeSearchCacheQuery(query)]) : null;
    const cacheLookup = cacheKey ? await context.searchCache!.get(cacheKey) : null;
    if (cacheLookup?.value) return { ...(await rehydrateCachedSearch(cacheLookup.value)), cache: "HIT", cache_detail: { status: "HIT", layer: cacheLookup.layer }, timings_ms: { cache_hit: Date.now() - cacheStarted } };
    const variants = [...new Set([plan.search_query, ...plan.search_queries])].slice(0, 3);
    const budgetQuery = budgetReferenceQuery(plan, region);
    const sourceErrors: { source: string; code: string }[] = [];
    const timings: Record<string, number> = {};
    const retriedSources: string[] = [];
    const searchStarted = Date.now();
    const sourceDeadline = searchStarted + (context.searchSourceDeadlineMs ?? SEARCH_SOURCE_DEADLINE_MS);
    // 출처 하나의 조회 실패를 빈 결과로 숨기지 않는다. source_errors에 남기고 나머지 출처로 계속 찾는다.
    // 느린 출처 하나가 전체 응답을 붙잡지 않도록 공통 시간 한도와 경주시킨다(korean-law-mcp 체인 데드라인과 같은 방식).
    const safe = async <T,>(source: string, task: () => Promise<T>, fallback: T): Promise<T> => {
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timedOut = Symbol("timeout");
        const attempt = () => task().catch(async (error: unknown) => {
          if (!isTransientStoreError(error) || sourceDeadline - Date.now() < 1000) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200));
          retriedSources.push(source);
          return task();
        });
        const outcome = await Promise.race([attempt(), new Promise<typeof timedOut>((resolve) => { timer = setTimeout(() => resolve(timedOut), Math.max(0, sourceDeadline - Date.now())); })]);
        if (outcome === timedOut) {
          sourceErrors.push({ source, code: "SOURCE_TIMEOUT" });
          return fallback;
        }
        return outcome as T;
      } catch (error) {
        if (!(error instanceof McpToolError)) context.onUnexpectedError?.(error, "search:" + source);
        sourceErrors.push({ source, code: error instanceof McpToolError ? error.code : "SOURCE_QUERY_FAILED" });
        return fallback;
      } finally {
        if (timer) clearTimeout(timer);
        timings[source] = (timings[source] ?? 0) + Date.now() - started;
      }
    };
    const lawName = plan.legal_intent ? lawNameForQuery(plan) : null;
    const article = /제\s*(\d{1,4})\s*조(?:\s*의\s*(\d{1,3}))?/.exec(plan.normalized_query);
    const jo = article ? "제" + article[1] + "조" + (article[2] ? "의" + article[2] : "") : null;
    const lawLookup = async (): Promise<{ status: string; query: string | null; hits: LawSearchHit[]; articles: string[] }> => {
      if (!LAW_MCP_PUBLIC) return { status: "DISABLED", query: null, hits: [], articles: [] };
      if (!plan.legal_intent) return { status: "NOT_REQUIRED", query: null, hits: [], articles: [] };
      if (!lawName) return { status: "UNMAPPED", query: null, hits: [], articles: [] };
      if (!context.lawApiKey?.trim()) return { status: "NOT_CONFIGURED", query: lawName, hits: [], articles: [] };
      const deadline = Date.now() + LAW_LOOKUP_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const withDeadline = <T,>(task: Promise<T>) => Promise.race([task, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())); })]);
      try {
        const result = await withDeadline(runLawTool("search_law", { query: lawName, display: 5 }, { apiKey: context.lawApiKey }));
        if (timer) clearTimeout(timer);
        if (!result) return { status: "TIMEOUT", query: lawName, hits: [], articles: [] };
        if (result.isError) return { status: "ERROR", query: lawName, hits: [], articles: [] };
        const hits = parseLawSearchHits(result.content.map((item) => item.text).join("\n"));
        const wanted = lawName.replace(/\s+/g, "");
        const exact = hits.filter((hit) => hit.name.replace(/\s+/g, "") === wanted);
        const chosen = (exact.length ? exact : hits.filter((hit) => hit.current)).slice(0, 2);
        if (!chosen.length) return { status: "NO_HIT", query: lawName, hits: [], articles: [] };
        // 조문을 지정하지 않은 법령 원문은 목차만 돌아온다. 남은 시간 안에서 목차를 읽어 질문에 맞는 조문을 고른다.
        let articles: string[] = jo ? [jo] : [];
        if (!jo && deadline - Date.now() > 800) {
          const toc = await withDeadline(runLawTool("get_law_text", { mst: chosen[0].mst }, { apiKey: context.lawApiKey }));
          if (toc && !toc.isError) articles = pickLawArticles(parseLawToc(toc.content.map((item) => item.text).join("\n")), plan);
        }
        return { status: "FOUND", query: lawName, hits: chosen, articles };
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const [programPages, news, documentPrograms, budgetReferences, gov24, gov24State, manuals, faq, law, welfarePage] = await Promise.all([
      safe("programs", async () => current.run ? Promise.all(variants.map((variant) => data.programs(current.run!.id, { ...region, includeAncestorScope: Boolean(region.sigungu) && plan.include_ancestor_scope, categories: [], targetKeywords: [], queryTokens: tokens(variant) }, 0, 30, { withTotal: false }))) : [], []),
      safe("news", () => data.news(newsFilter({ queryTokens: words, ...region, includeDescendants: !region.sigungu }), 0, 4), { rows: [] } as unknown as Awaited<ReturnType<typeof data.news>>),
      safe("documents", () => searchDocumentPrograms(data.db, words, current.documentPin, 12, { ...region, includeAncestorScope: plan.include_ancestor_scope }), []),
      safe("budget_documents", async () => fiscalOn && budgetQuery ? searchBudgetReferences(data.db, budgetQuery, current.budgetPin, baseUrl, { sido: region.sido, sigungu: region.sigungu, includeAncestorScope: plan.include_ancestor_scope, fiscalYear: plan.requested_year }) : [], []),
      safe("gov24", () => searchGov24Services(data.db, plan, 8), []),
      safe("gov24_state", async () => preGov24State ?? gov24DatasetState(data.db), { revision: null } as unknown as Awaited<ReturnType<typeof gov24DatasetState>>),
      safe("manuals", () => searchManualSections(data.db, plan, { revision: current.manualPin, limit: 8 }), []),
      safe("faq129", () => searchFaq129(data.db, plan, { limit: 4, nowMs: now() * 1000 }), { hits: [], program_mismatch_excluded: 0, available: false }),
      safe("law", lawLookup, { status: "ERROR", query: lawName, hits: [] as LawSearchHit[], articles: [] as string[] }),
      safe('welfare_catalog', async () => welfareCatalog ? welfareCatalog.search(plan, baseUrl, 0, 12) : null, null),
    ]);
    const programRank = (row: { name: string; sido: string; sigungu: string }) => welfareRelevance(row.name, plan) + (plan.region_id && plan.region_id === regionIdOf(row.sido, row.sigungu) ? 12 : 0);
    const programs = [...new Map(programPages.flatMap((page) => page.rows).map((row) => [serviceWikiKey(row), row])).values()]
      .filter((row) => welfareRelevance(row.name, plan) >= 0)
      .sort((a, b) => programRank(b) - programRank(a)).slice(0, 8);
    const manualCandidate = ({ score, title, sources, warnings: sectionWarnings, ...item }: ManualSearchHit) => ({ ...item, title: "[매뉴얼] " + title, sources: sources.map(compactManualSource), url: sources[0].url, rank: score, context: [sources[0].document_title, sources[0].original_name, sources[0].location.heading_path].filter(Boolean).join(" "), ...(sectionSpecificWarnings(sectionWarnings).length ? { warnings: sectionSpecificWarnings(sectionWarnings) } : {}) });
    const gov24Candidate = (service: Awaited<ReturnType<typeof searchGov24Services>>[number], rankPlan: typeof plan) => ({ id: service.id, title: "[정부24] " + service.name + " (" + (service.org_name ?? "기관 미확인") + ")", url: service.source.url, rank: gov24SearchRelevance(service, rankPlan), entity_type: "gov24_service", content_scope: service.content_scope, detail_status: service.detail_status, region_id: service.publisher_scope.region_id, publisher_scope: service.publisher_scope, year_evidence: service.year_evidence, ...(service.purpose ? { summary: service.purpose } : {}), ...(service.target ? { target_preview: service.target } : {}), ...(service.benefit ? { benefit_preview: service.benefit } : {}), ...(service.apply_method ? { apply_method_preview: service.apply_method } : {}), relevance_notes: welfareCandidateNotes(service.name, rankPlan) });
    const candidates = [
      ...(welfarePage?.items.map(catalogCandidate) ?? []),
      ...(/통계|수급자\s*수|수급률|인구|시설\s*현황|추이|경상의료비/.test(query) ? searchStatistics({ query, limit: 100 }, await currentStatisticsCatalog(data.db)).items.filter(item => item.kind === "indicator" || item.kind === "population").slice(0, 4).map(item => ({ id: item.id, title: "[복지통계] " + item.title, url: baseUrl + "/statistics?id=" + encodeURIComponent(item.id), rank: /통계|추이|수급률|인구/.test(query) ? 155 : 15, entity_type: "welfare_statistic", content_scope: item.kind === "population" ? "national_and_sido_resident_population" : item.data_available ? "national_statistical_table" : "official_directory_only" })) : []),
      ...manuals.map(manualCandidate),
      ...programs.map((row) => ({
        id: serviceWikiKey(row),
        title: "[사업] " + row.name + " (" + regionLabel(row.sido, row.sigungu) + ")",
        url: wikiUrl(baseUrl, serviceWikiKey(row)),
        rank: programRank(row),
        entity_type: "implementation", content_scope: "summary_card", region_id: regionIdOf(row.sido, row.sigungu), ...(row.description ? { summary: row.description } : {}), ...(row.target ? { target_preview: row.target } : {}), ...(row.applicationMethod ? { apply_method_preview: row.applicationMethod } : {}), relevance_notes: welfareCandidateNotes(row.name, plan),
      })),
      ...gov24.map((service) => gov24Candidate(service, plan)),
      ...documentPrograms.filter((row) => welfareRelevance(row.subject_label, plan) >= 0 && (!region.sido || plan.include_ancestor_scope && (!row.subject_sido || row.subject_sido === "전국") || row.subject_sido === region.sido && (!region.sigungu || plan.include_ancestor_scope && !canonicalProgramRegion(row.subject_sido, row.subject_sigungu).sigungu || row.subject_sigungu === region.sigungu))).map((row) => ({
        id: row.subject_id,
        title: "[문서 사업] " + row.subject_label + " (" + regionLabel(row.subject_sido, row.subject_sigungu) + ")",
        url: baseUrl + "/documents#" + encodeURIComponent(row.subject_id),
        rank: welfareRelevance(row.subject_label, plan) + 8,
        entity_type: "document_program", content_scope: "approved_document_facts",
      })),
      ...faq.hits.map((hit) => ({
        id: hit.id, title: "[129 FAQ] " + hit.question + " (작성일 " + hit.written_date + ")", url: hit.url, rank: hit.score,
        entity_type: "official_faq", content_scope: hit.content_scope, excerpt: hit.excerpt, written_date: hit.written_date, freshness: hit.freshness,
        question_similarity: hit.question_similarity, question_exact: hit.question_exact, scope_flags: hit.scope_flags, warnings: hit.warnings,
        category: hit.category, context: [hit.category, ...hit.programs].filter(Boolean).join(" "),
        condition_checklist: hit.condition_checklist, structured_conditions: hit.structured_conditions, answer_composition_instructions: hit.answer_composition_instructions, answer_criteria: hit.answer_criteria,
        authoritative_clarification: hit.authoritative_clarification,
      })),
      // 첫 법령은 질문에 맞는 조문별 후보로, 나머지는 법령 단위 후보로 둔다.
      ...law.hits.flatMap((hit, index) => (index === 0 && law.articles.length ? law.articles : [null]).map((article) => ({
        id: "law:" + hit.mst + (article ? ":" + article : ""), title: "[법령] " + hit.name + (article ? " " + article : ""), url: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=" + hit.mst, rank: article ? 100 : 90,
        entity_type: "law", content_scope: "national_law_text_via_open_api", law_id: hit.law_id, mst: hit.mst, ...(article ? { article } : {}),
      }))),
      ...budgetReferences.map((item) => ({ ...item, rank: plan.intents.includes("budget") ? 150 : 5, entity_type: "budget_line", content_scope: "document_stage_amount_not_benefit_amount" })),
      ...news.rows.map((row) => ({
        id: "news:" + row.item_id,
        title: "[보도자료 메타데이터] " + row.title + " - " + row.org_name,
        url: row.canonical_url,
        rank: plan.intents.includes("news") ? 150 : 0,
        entity_type: "press_release", content_scope: "metadata_only",
      })),
    ];
    // 저장소가 일시적으로 과부하되면 출처 대부분이 함께 실패한다. 빈 결과로 바꾸지 않고 재시도 가능한 오류로 알린다.
    if (sourceErrors.length >= 5) throw new McpToolError("DATA_SOURCE_BUSY", "검색 저장소가 일시적으로 응답하지 않아 결과를 만들지 못했습니다. 잠시 후 같은 질문으로 다시 시도해 주세요.");
    const usable = (item: { entity_type: string; scope_flags?: readonly string[] }) => EVIDENCE_TYPES.has(item.entity_type) && !(item.scope_flags ?? []).some((flag) => flag === "PROGRAM_MISMATCH" || flag === "EMPTY_SOURCE_BODY" || flag === "RELATED_CANDIDATE");
    let pool = candidates;
    let results = fuseSearchCandidates(pool, plan);
    const queryRelaxation: { stage: string; query: string; candidates: number; skipped?: string }[] = [];
    if (!results.some(usable)) {
      // 근거 후보가 없으면 제도명만, 다음에 핵심어 두 개로 다시 찾는다. 순위는 원래 질문 기준으로 다시 매긴다.
      for (const stage of relaxationStages(plan)) {
        // 완화 검색은 시간 한도 안에서만 한다.
        if (Date.now() >= sourceDeadline) { queryRelaxation.push({ stage: stage.stage, query: stage.plan.search_query, candidates: 0, skipped: "SEARCH_DEADLINE" }); break; }
        const [relaxedManuals, relaxedGov24] = await Promise.all([
          safe("manuals", () => searchManualSections(data.db, stage.plan, { revision: current.manualPin, limit: 8 }), []),
          safe("gov24", () => searchGov24Services(data.db, stage.plan, 8), []),
        ]);
        const extra = [...relaxedManuals.map(manualCandidate), ...relaxedGov24.map((service) => gov24Candidate(service, stage.plan))];
        queryRelaxation.push({ stage: stage.stage, query: stage.plan.search_query, candidates: extra.length });
        if (!extra.length) continue;
        pool = [...pool, ...extra];
        results = fuseSearchCandidates(pool, plan);
        if (results.some(usable)) break;
      }
    }
    const relaxed = queryRelaxation.length > 0 && results.some(usable);
    const assessment = assessAnswerability({ plan, results, relaxed, legalStatus: law.status, sourceErrors: sourceErrors.length > 0 });
    const retrievalStatus = results.some(usable) ? "CANDIDATES_FOUND" : results.some((item) => EVIDENCE_TYPES.has(item.entity_type)) || !results.length ? "COVERAGE_GAP" : "REFERENCE_ONLY";
    const budgetRegionWarning = plan.intents.includes("budget") && fiscalOn && region.sido && !budgetReferences.length ? ["요청 지역의 승인 예산서 항목을 찾지 못했습니다. 다른 지역 예산서로 대신하지 않았습니다."] : [];
    const scopedCandidateWarning = results.some((item) => "relevance_notes" in item && Array.isArray(item.relevance_notes) && item.relevance_notes.length) ? ["일부 후보는 증명서 발급·시설 운영비·동명 사업입니다. 본사업이나 정보시스템 매뉴얼의 근거와 구분해 상세를 확인하세요."] : [];
    const mismatchWarning = assessment.reason_codes.includes("PROGRAM_MISMATCH") ? ["PROGRAM_MISMATCH: 질문 제도(" + plan.program_scope.join(", ") + ")와 다른 제도의 근거는 순위를 낮추고 scope_flags로 표시했습니다. 다른 제도 근거로 답하지 마세요."] : [];
    const emptyBodyWarning = assessment.reason_codes.includes("EMPTY_SOURCE_BODY") ? ["EMPTY_SOURCE_BODY: 표·이미지만 있거나 제목만 있는 매뉴얼 구간은 근거로 쓰지 말고 인접 구간·원문을 확인하세요."] : [];
    const faqWarning = results.some((item) => item.entity_type === "official_faq") ? [FAQ129_NOTICE] : [];
    const lawWarning = plan.legal_intent && law.status !== "FOUND" ? [LAW_MCP_PUBLIC ? "법령 조회 상태: " + law.status + ". 국가법령정보센터 원문을 확인하세요." : LAW_MCP_WITHHELD_MESSAGE] : [];
    const followUpCalls = suggestFollowUpCallsForSearch(results, { question: query, releaseBundleId: current.bundleId, regionId: plan.region_id });
    const payload = {
      results, query_plan: plan, release_bundle_id: current.bundleId, server_version: MCP_SERVER_VERSION, gov24_revision: gov24State.revision, manual_revision: current.manualPin || null,
      welfare_catalog: welfarePage ? { as_of: welfarePage.as_of, revision: welfarePage.revision, total_count: welfarePage.total_count, local_count: welfarePage.local_count, list_tool: 'search_welfare_services' } : { status: welfareCatalog ? 'UNAVAILABLE' : 'NOT_CONFIGURED' },
      retrieval_status: retrievalStatus,
      answerability: assessment.answerability, coverage: assessment.coverage, reason_codes: assessment.reason_codes,
      query_relaxation: queryRelaxation,
      legal_lookup: { status: law.status, law_query: law.query, article: jo, articles: law.articles },
      timings_ms: timings,
      faq_layer: { available: faq.available, candidates: faq.hits.length, program_mismatch_excluded: faq.program_mismatch_excluded },
      ...(sourceErrors.length ? { source_errors: sourceErrors } : {}),
      ...(retriedSources.length ? { retried_sources: retriedSources } : {}),
      web_search_fallback: webSearchFallback(plan, assessment),
      ...(assessment.answerability === "SUPPORTED" ? {} : { suggested_sources: suggestedSources(plan) }),
      suggested_tool_calls: followUpCalls,
      next_actions_text: formatSuggestedToolCalls(followUpCalls),
      warnings: [...plan.warnings, ...mismatchWarning, ...emptyBodyWarning, ...scopedCandidateWarning, ...budgetRegionWarning, ...lawWarning, ...faqWarning, "검색 결과는 근거 후보입니다. 금액·적격성·법령은 상세의 연도·지역·출처를 확인해야 합니다.", ...(manuals.length ? ["매뉴얼 출처는 저장소의 파싱본입니다. 내부 원문명·연도·줄 위치를 확인하고 파일명 연도를 적용연도로 단정하지 마세요.", ...MANUAL_COMMON_WARNINGS, "매뉴얼 출처 전체(커밋·파일 경로·해시)는 fetch 또는 get_manual_section에서 제공합니다."] : []), ...(retrievalStatus !== "CANDIDATES_FOUND" ? ["COVERAGE_GAP: 저장 자료에서 직접 근거를 찾지 못했습니다. 미수집·미수록·검색 미일치 가능성이 있으며 해당 제도가 없다는 뜻이 아닙니다. suggested_sources를 확인하세요."] : [])],
    };
    const finalPayload = auto_detail ? await attachOptionalChain(payload, results, { autoDetail: true, detailLimit: detail_limit, question: query, releaseBundleId: current.bundleId, regionId: plan.region_id }) : payload;
    if (!cacheKey || !cacheLookup) return { ...finalPayload, ...cacheBypass("sensitive_query") };
    // 일부 출처가 실패·시간 초과했거나 법령 조회가 실패한 결과는 다시 조회하면 달라질 수 있어 저장하지 않는다.
    const skipped = sourceErrors.length ? "source_error" : law.status === "ERROR" || law.status === "TIMEOUT" ? "law_unavailable" : null;
    const stored = skipped ? null : context.searchCache!.put(cacheKey, payload);
    const notStored = skipped ?? stored?.reason ?? null;
    const lookupFailed = cacheLookup.miss === "lookup_error" || cacheLookup.miss === "backend_cooldown";
    const cacheDetail: McpCacheDetail = { status: lookupFailed ? "ERROR" : notStored ? "NOT_STORED" : "MISS", lookup: cacheLookup.miss, ...(notStored ? { reason: notStored } : {}) };
    return trackSearchCacheWrite({ ...finalPayload, cache: "MISS", cache_detail: cacheDetail }, stored?.write ?? null);
  });


  // 2. fetch
  register("fetch", "ID로 상세 받기", "search 결과의 id로 공개 카드를 받습니다. manual: ID는 매뉴얼 본문 구간(최대 8000자)과 고정 커밋·파일·내부 원문명·Markdown 줄 위치를 제공합니다. 긴 구간은 get_manual_section의 next_offset으로 이어 읽으세요. 시행사업은 사업명·개요·신청조건·출처를, 예산서 행(bl-)은 문서 단계 금액·산출내역·출처를, 보도자료는 메타데이터만 돌려줍니다. 임의 URL이나 파일 경로는 받지 않습니다.", {
    id: z.string().min(1).max(LIMITS.idMax).describe("search 결과의 id"),
  }, async ({ id }) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(id)) throw new McpToolError("ID_IS_URL", "URL은 받을 수 없습니다. search 결과의 id를 사용하세요.");
    const current = await state();
    if (/^(stat|indicator|approved|portal|population|kosis-directory):/.test(id)) {
      const item = statisticsCatalog().find(item => item.id === id);
      if (!item) throw new McpToolError("NOT_FOUND", "등록된 통계 항목을 찾지 못했습니다.");
      const result = item.data_available ? await readCurrentStatistics(data.db, id) : null;
      return { id, title: item.title, url: item.source_url, text: [result?.dataset.description ?? item.description, result ? result.dataset.note : "수치 미연결: 공식 원문에서 확인하세요.", result ? "수치·기간 조회: get_statistics_data(statistics_id=" + result.dataset.id + ")" : "", "목록 확인일: " + item.checked_at].filter(Boolean).join("\n"), metadata: { entity_type: "welfare_statistic", ...item, description: result?.dataset.description ?? item.description, statistics: result, release_bundle_id: current.bundleId } };
    }
    if (id.startsWith(WELFARE_CATALOG_PREFIX)) {
      const detail = await requireWelfareCatalog().detail(id, baseUrl);
      return { id: detail.id, title: detail.name, url: detail.url, text: welfareCatalogText(detail), metadata: { ...detail, release_bundle_id: current.bundleId } };
    }
    if (id.startsWith("manual:")) return manualFetchCard(current, await manualSectionOf(current, id));
    if (id.startsWith(FAQ129_PREFIX)) {
      const detail = await getFaq129(data.db, id, now() * 1000);
      if (!detail) throw new McpToolError("NOT_FOUND", "129 자주하는 질문에서 이 ID를 찾지 못했습니다. search 또는 search_faq 결과의 id를 사용하세요.");
      const review = await faqReviewMetadata(data.db, detail.faq_id, detail.content_sha256, kstDate(now()));
      return {
        id, title: detail.question, text: faq129Text(detail) + (review ? '\n보강자료 재확인 상태: ' + review.status + '. 출처 변경·재확인 실패·기한 도래 시 해당 공식 자료를 추가 확인하세요.' : ''), url: detail.url,
        metadata: {
          entity_type: "official_faq", content_scope: "official_qa_as_of_written_date", faq_id: detail.faq_id, group: detail.group, category: detail.category,
          written_date: detail.written_date, freshness: detail.freshness, aliases: detail.aliases, faq_revision: detail.revision, content_sha256: detail.content_sha256,
          condition_checklist: detail.condition_checklist, structured_conditions: detail.structured_conditions, answer_composition_instructions: detail.answer_composition_instructions, answer_criteria: detail.answer_criteria,
          authoritative_clarification: detail.authoritative_clarification,
          clarification_review: review,
          release_bundle_id: current.bundleId, sources: [{ title: "보건복지상담센터 자주하는 질문", url: detail.url, publisher: FAQ129_PUBLISHER, written_date: detail.written_date }],
          warnings: [FAQ129_NOTICE, ...(detail.freshness.status === "CURRENT" ? [] : ["OUTDATED_OR_CONFLICTING_SOURCE: " + detail.freshness.reasons.join(", ")])],
        },
      };
    }
    if (id.startsWith("law:")) {
      if (!LAW_MCP_PUBLIC) throw new McpToolError("LAW_MCP_DISABLED", LAW_MCP_WITHHELD_MESSAGE);
      const match = /^law:(\d{1,12})(?::(제\d{1,4}조(?:의\d{1,3})?))?$/.exec(id);
      if (!match) throw new McpToolError("ID_NOT_SUPPORTED", "법령 ID는 law:<MST> 또는 law:<MST>:제N조 형식입니다.");
      if (!context.lawApiKey?.trim()) throw new McpToolError("LAW_API_NOT_CONFIGURED", "운영 서버의 법제처 OPEN API 인증값 설정이 필요합니다.");
      const result = await runLawTool("get_law_text", { mst: match[1], ...(match[2] ? { jo: match[2] } : {}) }, { apiKey: context.lawApiKey });
      const body = result.content.map((item) => item.text).join("\n");
      if (result.isError) throw new McpToolError("LAW_LOOKUP_FAILED", "법령 원문을 불러오지 못했습니다. search_law·get_law_text로 다시 확인해 주세요.");
      const url = "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=" + match[1];
      return {
        id, title: (body.split("\n").find((line) => line.trim()) ?? "법령 원문").trim().slice(0, 120), text: Array.from(body).slice(0, 8000).join(""), url,
        metadata: { entity_type: "law", content_scope: "national_law_text_via_open_api", mst: match[1], article: match[2] ?? null, truncated: Array.from(body).length > 8000, release_bundle_id: current.bundleId, sources: [{ title: "국가법령정보센터", url }], warnings: ["법적 효력이 필요한 판단은 국가법령정보센터 원문과 시행일을 최종 확인하세요."] },
      };
    }
    if (id.startsWith("ltc:")) {
      if (!CARE_RESOURCES_MCP) throw new McpToolError("CARE_MCP_DISABLED", CARE_MCP_WITHHELD_MESSAGE);
    }
    if (id.startsWith(GOV24_PREFIX)) {
      const service = await getGov24Service(data.db, id);
      return { id, title: service.name, text: gov24Text(service), url: service.source.url, metadata: { ...service, release_bundle_id: current.bundleId, gov24_revision: (await gov24DatasetState(data.db)).revision, sources: [service.source] } };
    }
    if (fiscalOn && id.startsWith("bl-")) {
      const result = await getBudgetBreakdown(data.db, { budget_line_id: id, limit: 20 }, envelopeFor(current), current.budgetPin);
      const { revision, root, lines } = result.data;
      return {
        id, title: root.name,
        text: ["예산서: " + revision.title, "발행기관: " + revision.issuer, "회계연도: " + revision.fiscal_year, "편성단계: " + revision.stage_label, "수록 범위: " + revision.scope,
          "선택 행: " + root.name + " / " + (root.amount_thousand_krw ?? "금액 미기재") + " 천원", ...lines.map((line) => line.level_label + ": " + line.name + " / " + (line.amount_thousand_krw ?? "금액 미기재") + " 천원" + (line.formula_text ? " / 산출식: " + line.formula_text : "")),
          ...(result.next_cursor ? ["일부 하위 내역만 표시했습니다. get_budget_breakdown으로 이어서 조회하세요."] : []), BUDGET_DOCUMENT_NOTE].join("\n"),
        url: revision.source.page_url ?? revision.source.file_url ?? baseUrl + "/budget",
        metadata: { entity_type: "budget_line", content_scope: "approved_budget_document_lines", release_bundle_id: current.bundleId, budget_component: current.components.budget_documents,
          ...result.data, sources: result.evidence, coverage: result.coverage, warnings: result.warnings, next_cursor: result.next_cursor },
      };
    }
    if (id.startsWith("service:")) {
      const run = requireRun(current);
      const row = await programOrThrow(run, id);
      const [{ article, supplement, adminEdit }, evidence, documents, publicInfo] = await Promise.all([articleOf(row), programEvidence(run, row), documentFactsOf(current, [id]), programPublicInfo(data.db, id, { includeLaw: LAW_MCP_PUBLIC })]);
      const resolved = resolveProgramEvidence({ base: { application_conditions: article.applicationConditions ?? null, application_method: meaningful(row.applicationMethod), conditions_basis: article.conditionsBasis ?? null }, documents: documents.rows, services: publicInfo.gov24.services, subjectId: id, programName: row.name, regionId: regionIdOf(row.sido, row.sigungu), baseRegionId: regionIdOf(row.sido, row.sigungu), verifiedServiceIds: publicInfo.gov24.services.map((service) => service.id) });
      const lines = [
        "사업명: " + article.name,
        "지역: " + (regionLabel(row.sido, row.sigungu) || "전국"),
        "사업개요: " + article.overview,
        "사업내용: " + article.content,
        ...(resolved.eligibility.application_conditions ? ["신청조건: " + resolved.eligibility.application_conditions + " (근거: " + resolved.eligibility.conditions_basis + ")"] : []),
        ...(resolved.eligibility.selection_criteria ? ["선정기준: " + resolved.eligibility.selection_criteria] : []),
        ...(resolved.benefit ? ["공식 지원내용: " + resolved.benefit] : []),
        ...(article.category ? ["사업분야: " + article.category] : []),
        ...(article.type ? ["사업구분: " + article.type] : []),
        ...(resolved.eligibility.application_method ? ["신청방법: " + resolved.eligibility.application_method] : []),
        ...(resolved.eligibility.required_documents ? ["구비서류: " + resolved.eligibility.required_documents] : []),
        "출처: " + [...evidence, ...publicInfo.gov24.services.map((service) => service.source)].map((item) => item.title + " " + item.url).join(" / "),
        ...resolved.warnings,
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
          eligibility: resolved.eligibility,
          benefit: resolved.benefit,
          official_public_info: publicInfo,
          evidence_resolution: resolved.evidence_resolution,
          document_facts: documents.facts,
          structured_tables: publicInfo.gov24.services.flatMap((service) => service.structured_tables),
          release_bundle_id: current.bundleId,
          effective_reference_date: kstDate(run.completedAt),
          sources: [
            ...publicInfo.gov24.services.map((service) => service.source),
            ...documents.evidence,
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
        "지역: " + regionLabel(first.subject_sido, first.subject_sigungu),
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
    throw new McpToolError("ID_NOT_SUPPORTED", "지원하지 않는 ID입니다. search 결과의 id(service:, gov24_service:, manual:, faq129:, law:, docprog:, bl- 또는 news:)를 사용하세요.");
  });

  register("search_faq", "129 자주하는 질문 검색", "보건복지상담센터(129) 자주하는 질문 수록본을 검색합니다. 결과는 작성일(written_date) 기준 공식 안내이며 freshness를 확인하세요. id는 fetch·get_faq로 읽거나 auto_detail=true로 원문을 함께 받으세요.", {
    query: questionInput.min(1).describe("자연어 질문 또는 제도명"),
    limit: z.number().int().min(1).max(10).optional(),
    ...autoDetailFields,
  }, async ({ query, limit, auto_detail, detail_limit }) => {
    const plan = refineWelfareQuery(query, { currentYear: Number(kstDate(now()).slice(0, 4)) });
    const result = await searchFaq129(data.db, plan, { limit: limit ?? 5, nowMs: now() * 1000 });
    if (!result.available) throw new McpToolError("FAQ_NOT_AVAILABLE", "129 자주하는 질문 자료가 아직 적재되지 않았습니다.");
    const hits = await Promise.all(result.hits.map(async (hit) => ({ ...hit, clarification_review: await faqReviewMetadata(data.db, hit.id, hit.content_sha256, kstDate(now())) })));
    const basePayload = {
      results: hits, server_version: MCP_SERVER_VERSION, retrieval_status: hits.length ? "CANDIDATES_FOUND" : "COVERAGE_GAP",
      query_plan: { search_query: plan.search_query, programs: plan.programs, program_scope: plan.program_scope, detail_terms: plan.detail_terms, requested_year: plan.requested_year, requested_years: plan.requested_years, excluded_years: plan.excluded_years },
      program_mismatch_excluded: result.program_mismatch_excluded,
      warnings: [FAQ129_NOTICE, ...new Set(result.hits.flatMap((hit) => hit.warnings)), ...(result.program_mismatch_excluded ? ["PROGRAM_MISMATCH: 질문 제도와 다른 제도의 FAQ " + result.program_mismatch_excluded + "건을 제외했습니다."] : [])],
    };
    return attachOptionalChain(basePayload, hits, { autoDetail: auto_detail, detailLimit: detail_limit, question: query });
  });

  register("get_faq", "129 자주하는 질문 읽기", "faq129: ID의 질문·답변 원문, 분야, 작성일, 신선도와 조건 확인 목록을 돌려줍니다. 조건·예외를 빠짐없이 반영하세요. authoritative_clarification이 있으면 공식 추가 확인의 기준·출처·자료 날짜와 남은 불확실성을 함께 읽고 원문 작성일과 구분하여 답변하세요. 원문과 모순된 날짜 예시나 불명확한 표는 임의로 확정하지 마세요.", {
    id: z.string().min(1).max(40).describe("search 또는 search_faq 결과의 faq129: ID"),
  }, async ({ id }) => {
    const detail = await getFaq129(data.db, id, now() * 1000);
    if (!detail) throw new McpToolError("NOT_FOUND", "129 자주하는 질문에서 이 ID를 찾지 못했습니다.");
    const review = await faqReviewMetadata(data.db, detail.faq_id, detail.content_sha256, kstDate(now()));
    return { ...detail, clarification_review: review, text: faq129Text(detail) + (review ? '\n보강자료 재확인 상태: ' + review.status + '. 출처 변경·재확인 실패·기한 도래 시 해당 공식 자료를 추가 확인하세요.' : ''), server_version: MCP_SERVER_VERSION, publisher: FAQ129_PUBLISHER, warnings: [FAQ129_NOTICE] };
  });

  register("search_manuals", "복지 매뉴얼 본문 검색", "반입된 복지 매뉴얼의 본문·절 제목을 검색합니다. URL은 고정 커밋 파싱본이며 PDF 쪽수가 아닙니다. manual: ID는 fetch·get_manual_section으로 읽거나 auto_detail=true로 즉시 연결하세요.", {
    query: questionInput.min(1),
    limit: z.number().int().min(1).max(20).optional(),
    release_bundle_id: bundleInput,
    ...autoDetailFields,
  }, async (args) => {
    const current = await pinned(args);
    const plan = refineWelfareQuery(args.query, { currentYear: Number(kstDate(now()).slice(0, 4)) });
    const results = await searchManualSections(data.db, plan, { revision: current.manualPin, limit: args.limit ?? 10 });
    const assessment = assessAnswerability({ plan, results: results.map((hit) => ({ ...hit, relevance_score: hit.score, scope_flags: hit.body_available === false ? ["EMPTY_SOURCE_BODY"] : [] })), relaxed: false, legalStatus: "NOT_QUERIED" });
    const detailWarning = assessment.reason_codes.includes("INSUFFICIENT_DETAIL_EVIDENCE") && assessment.coverage.unmatched_detail_terms.length
      ? ["INSUFFICIENT_DETAIL_EVIDENCE: 질문의 세부 조건(" + assessment.coverage.unmatched_detail_terms.join(", ") + ")이 반환된 매뉴얼 발췌문에서 확인되지 않았습니다. 원문 전체를 확인하거나 미확인 조건으로 안내하세요."]
      : [];
    const chainedData = await attachOptionalChain(
      { results, query_plan: plan, manual_revision: current.manualPin || null, ...assessment, web_search_fallback: webSearchFallback(plan, assessment) },
      results,
      { autoDetail: args.auto_detail, detailLimit: args.detail_limit, question: args.query, releaseBundleId: current.bundleId },
    );
    return envelope(current, now(), chainedData, {
      evidence: results.flatMap((hit) => hit.sources),
      coverage: { scope: "parsed_manual_sections", complete: false, gaps: ["검색 후보이며 본문 적용연도·지역과 누락된 이미지 내용을 별도 확인해야 합니다."], returned_count: results.length },
      warnings: [...plan.warnings, ...detailWarning, "검색 미일치는 제도 부재를 뜻하지 않습니다."],
    });
  });

  register("get_manual_section", "복지 매뉴얼 구간 읽기", "manual: ID의 원문 구간을 고정된 공개본에서 읽습니다. 최대 8000자이며 next_offset이 있으면 같은 ID로 이어 읽으세요. offset은 Unicode 문자 위치로 PDF 쪽수가 아닙니다. 반환한 표·각주·내부 원문명을 함께 확인하세요.", {
    section_id: z.string().min(1).max(LIMITS.idMax),
    offset: z.number().int().min(0).max(2_000_000).optional(),
    limit: z.number().int().min(1).max(8_000).optional(),
    release_bundle_id: bundleInput,
  }, async (args) => {
    const current = await pinned(args);
    const section = await manualSectionOf(current, args.section_id, args.offset ?? 0, args.limit ?? 8_000);
    return envelope(current, now(), section, {
      evidence: [...section.sources, ...section.related_application_sections.flatMap((related) => related.sources)],
      coverage: { scope: "one_parsed_manual_section", complete: section.answer_context.section_complete, context_complete: section.answer_context.context_complete, gaps: ["PDF 물리 쪽수·이미지 본문은 미확인입니다."], physical_page_verified: false, image_content_available: false },
      warnings: section.warnings, truncated: section.truncated,
    });
  });

  // 3. find_programs
  register("find_programs", "시행사업 찾기", "지역·사업분류·대상자 묶음·검색어로 지자체 시행사업을 찾습니다. 반환된 implementation_id(service:)는 get_welfare_context·fetch로 상세를 확인하세요.", {
    region_id: regionInput.optional(),
    service_type_ids: z.array(z.string().max(100)).max(LIMITS.arrayMax).optional().describe("category:<대분류> 또는 category:<대분류>|<중분류>. get_ontology_schema(section=\"service_types\") 참조."),
    target_group_ids: z.array(z.enum(TARGET_GROUP_IDS)).max(LIMITS.arrayMax).optional().describe("대상자 묶음 ID. get_ontology_schema(section=\"target_groups\") 참조."),
    query: questionInput.optional().describe("사업명 또는 자연어 질문. 질문의 지역·사업명을 분리하며 명시 입력 지역을 우선합니다."),
    include_ancestor_scope: z.boolean().optional().describe("시·군·구를 지정했을 때 같은 시·도의 광역 단위 사업(시·군·구 미지정 행)도 포함. 기본 false."),
    as_of: asOfInput,
    snapshot_id: snapshotInput,
    cursor: cursorInput,
    limit: limitInput(),
  }, async (args) => {
    const current = await pinned(args);
    const run = requireRun(current);
    const basis = knowledgeBasis(run, args.as_of);
    const plan = args.query ? refineWelfareQuery(args.query, { currentYear: Number(kstDate(now()).slice(0, 4)) }) : null;
    const queryRegion = plan?.region_id && plan.region_id !== "region:전국" ? plan.region_id : null;
    const region = args.region_id ? parseRegionId(args.region_id) : queryRegion ? parseRegionId(queryRegion) : { sido: "", sigungu: "" };
    const includeAncestor = args.include_ancestor_scope ?? (!args.region_id && Boolean(region.sigungu) && Boolean(plan?.include_ancestor_scope));
    if (args.include_ancestor_scope && !region.sigungu) {
      throw new McpToolError("INPUT_CONFLICT", "include_ancestor_scope는 시·군·구 단위 region_id와 함께만 쓸 수 있습니다.");
    }
    const categories = (args.service_type_ids ?? []).map(parseCategoryId);
    const groupIds = args.target_group_ids ?? [];
    const keywords = [...new Set(groupIds.flatMap((id) => TARGET_GROUPS[id].keywords))];
    const words = plan?.search_tokens ?? [];
    const limit = pageLimit(args.limit);
    const bound = fingerprint([current.bundleId, region, categories, groupIds, words, includeAncestor]);
    const offset = decodeCursor(args.cursor, bound);
    const { rows, total } = await data.programs(run.id, { ...region, includeAncestorScope: includeAncestor, categories, targetKeywords: keywords, queryTokens: words }, offset, limit);
    const warnings: string[] = [];
    if (total === 0 && region.sido && (await data.regionProgramCount(run.id, region.sido, region.sigungu)) === 0) {
      warnings.push("요청한 지역은 현재 공개본에 수록된 사업이 없습니다. 지역명이 정확한지, 보건복지부 사업안내에 그 지역 자료가 있는지 확인해 주세요.");
    }
    const items = rows.map((row) => {
      const reasons: string[] = [];
      if (region.sido) reasons.push(canonicalProgramRegion(row.sido, row.sigungu).sigungu === region.sigungu || !region.sigungu ? "지역 일치: " + regionIdOf(row.sido, row.sigungu) : "상위 광역 범위 포함: " + regionIdOf(row.sido, row.sigungu));
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
    return envelope(current, now(), items, { basis, coverage: { ...knowledgeCoverage(total), ...(plan ? { query_plan: plan } : {}) }, warnings, nextCursor: next });
  });

  // 4. get_entity
  register("get_entity", "개체 조회", "시행사업(service:), 매뉴얼 구간(manual:), 문서 정의 사업(docprog:), 지역(region:), 사업분류(category:), 기관(org:), 보도자료(news:) 개체의 공개 사실과 핵심 근거를 돌려줍니다. 매뉴얼은 원문 근거이며 자격 판정이 아닙니다. 승인 반입된 문서 사실은 document_facts에 근거 위치와 함께 붙습니다.", {
    entity_id: z.string().min(4).max(LIMITS.idMax),
    as_of: asOfInput,
    snapshot_id: snapshotInput,
    release_bundle_id: bundleInput,
  }, async (args) => {
    const current = await pinned(args);
    const id = args.entity_id.trim();
    if (id.startsWith(WELFARE_CATALOG_PREFIX)) return catalogDetailEnvelope(current, id, undefined, args.as_of);
    if (id.startsWith("manual:")) {
      const section = await manualSectionOf(current, id);
      return envelope(current, now(), { entity_id: id, ...section }, {
        evidence: [...section.sources, ...section.related_application_sections.flatMap((related) => related.sources)],
        coverage: { scope: "one_parsed_manual_section", complete: section.answer_context.section_complete, context_complete: section.answer_context.context_complete, gaps: ["원문 적용연도·PDF 물리 쪽수·이미지 내용은 별도 확인이 필요합니다."] },
        warnings: section.warnings, truncated: section.truncated,
      });
    }
    if (id.startsWith(GOV24_PREFIX)) {
      const service = await getGov24Service(data.db, id);
      const basis = storedEvidenceBasis([service.source.collected_at, service.source.detail_collected_at], args.as_of, "정부24");
      return envelope(current, now(), { entity_id: id, ...service }, { evidence: [service.source], basis, warnings: service.warnings, coverage: { scope: service.content_scope, complete: false, gaps: service.detail_status === "COLLECTED" ? [] : ["최신 상세 미수집"] } });
    }
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
        entity_id: id, entity_type: "region", label: regionLabel(region.sido, region.sigungu),
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
      if (allow("located_in")) outgoing.push(relation("located_in", regionIdOf(row.sido, row.sigungu), regionLabel(row.sido, row.sigungu), "source_field", "out"));
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
        incoming = rows.map((row) => relation(predicate, id, isRegion ? regionLabel(region.sido, region.sigungu) : id.slice(9), "source_field", "in", serviceWikiKey(row)));
      }
    } else if (id.startsWith("org:")) {
      const row = await data.organization(id);
      if (!row) throw new McpToolError("NOT_FOUND", "기관 레지스트리에서 이 ID를 찾지 못했습니다.");
      if (row.parent_id && allow("part_of")) outgoing.push(relation("part_of", row.parent_id, row.parent_id, "registry_seed", "out"));
      if (row.sido && allow("has_jurisdiction")) outgoing.push(relation("has_jurisdiction", regionIdOf(row.sido, row.sigungu), regionLabel(row.sido, row.sigungu), "registry_seed", "out"));
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
    question: questionInput.optional().describe("원질문. 포함/제외 연도를 확인해 상세근거의 적용성을 점검합니다."),
    as_of: asOfInput,
    snapshot_id: snapshotInput,
  }, async (args) => {
    const current = await pinned(args);
    const plan = detailQuestionPlan(args.question);
    if (args.implementation_id.startsWith(WELFARE_CATALOG_PREFIX)) return catalogDetailEnvelope(current, args.implementation_id, args.question, args.as_of);
    if (args.implementation_id.startsWith(GOV24_PREFIX)) {
      const service = await getGov24Service(data.db, args.implementation_id, plan?.year ?? null);
      const basis = storedEvidenceBasis([service.source.collected_at, service.source.detail_collected_at], args.as_of, "정부24");
      const resolved = resolveProgramEvidence({ base: { application_conditions: null, application_method: null, conditions_basis: null }, documents: [], services: [service], requestedYear: plan?.requested_year ?? null, subjectId: service.id, programName: service.name, regionId: plan?.region_id ?? service.publisher_scope.region_id, includeAncestorScope: plan?.include_ancestor_scope ?? true });
      resolved.warnings.unshift(...(plan?.warnings ?? []));
      return envelope(current, now(), { implementation_id: service.id, name: service.name, ...resolved.eligibility, benefit: resolved.benefit, document_conditions: [], official_public_info: { gov24: { services: [service] } }, structured_tables: service.structured_tables, evidence_resolution: resolved.evidence_resolution, ...(plan ? { query_plan: plan } : {}) }, { evidence: [service.source], basis, warnings: [...service.warnings, ...resolved.warnings], coverage: { scope: service.content_scope, complete: false, gaps: resolved.eligibility.unknowns } });
    }
    if (args.implementation_id.startsWith("docprog:")) {
      const documents = await documentFactsOf(current, [args.implementation_id]);
      if (!documents.rows.length) throw new McpToolError("NOT_FOUND", "공개 중인 문서 사업에서 이 ID를 찾지 못했습니다.");
      const first = documents.rows[0];
      const basis = storedEvidenceBasis(documents.rows.map((row) => row.retrieved_at), args.as_of, "승인 문서");
      const resolved = resolveProgramEvidence({ base: { application_conditions: null, application_method: null, conditions_basis: null }, documents: documents.rows, services: [], requestedYear: plan?.requested_year ?? null, subjectId: args.implementation_id, programName: first.subject_label, regionId: plan?.region_id ?? regionIdOf(first.subject_sido, first.subject_sigungu), includeAncestorScope: plan?.include_ancestor_scope ?? true });
      resolved.warnings.unshift(...(plan?.warnings ?? []));
      return envelope(current, now(), {
        implementation_id: args.implementation_id, name: first.subject_label, region_id: regionIdOf(first.subject_sido, first.subject_sigungu),
        ...resolved.eligibility, benefit: resolved.benefit, evidence_resolution: resolved.evidence_resolution,
        document_conditions: documents.facts.filter((fact) => ELIGIBILITY_PREDICATES.has(fact.predicate_id)),
        ...(plan ? { query_plan: plan } : {}), notice: "공개 조건 안내이며 개인의 수급 자격을 판정하지 않습니다.",
      }, { evidence: documents.evidence, basis, warnings: resolved.warnings, coverage: { scope: "approved_document_facts", complete: false, gaps: resolved.eligibility.unknowns } });
    }
    const run = requireRun(current);
    const basis = knowledgeBasis(run, args.as_of);
    const row = await programOrThrow(run, args.implementation_id);
    const [parts, evidence, documents, publicInfo] = await Promise.all([articleOf(row), programEvidence(run, row), documentFactsOf(current, [args.implementation_id]), programPublicInfo(data.db, args.implementation_id, { includeLaw: LAW_MCP_PUBLIC })]);
    if (args.as_of && publicInfo.gov24.services.length) storedEvidenceBasis(publicInfo.gov24.services.flatMap((service) => [service.source.collected_at, service.source.detail_collected_at]), args.as_of, "연결된 정부24");
    const { article } = parts;
    const supplementary = articleEvidence(row, parts, evidence[0]?.evidence_id ?? null);
    const resolved = resolveProgramEvidence({ base: { application_conditions: article.applicationConditions ?? null, application_method: meaningful(row.applicationMethod), conditions_basis: article.conditionsBasis ?? null }, documents: documents.rows, services: publicInfo.gov24.services, requestedYear: plan?.requested_year ?? null, subjectId: args.implementation_id, programName: row.name, regionId: plan?.region_id ?? regionIdOf(row.sido, row.sigungu), baseRegionId: regionIdOf(row.sido, row.sigungu), includeAncestorScope: plan?.include_ancestor_scope ?? true, verifiedServiceIds: publicInfo.gov24.services.map((service) => service.id) });
    resolved.warnings.unshift(...(plan?.warnings ?? []));
    return envelope(current, now(), {
      implementation_id: args.implementation_id,
      name: article.name,
      region_id: regionIdOf(row.sido, row.sigungu),
      ...resolved.eligibility,
      source_target_text: meaningful(row.target),
      source_detail_target_text: meaningful(row.detailTarget),
      provider: meaningful(row.provider),
      document_conditions: documents.facts.filter((fact) => ELIGIBILITY_PREDICATES.has(fact.predicate_id)),
      official_public_info: publicInfo,
      benefit: resolved.benefit,
      structured_tables: publicInfo.gov24.services.flatMap((service) => service.structured_tables),
      evidence_resolution: resolved.evidence_resolution,
      ...(plan ? { query_plan: plan } : {}),
      notice: "공개 조건 안내이며 개인의 수급 자격을 판정하지 않습니다.",
    }, {
      evidence: [
        ...evidence,
        ...supplementary.items,
        ...documents.evidence,
        ...publicInfo.gov24.services.map((service) => service.source),
      ],
      basis, coverage: knowledgeCoverage(1), warnings: resolved.warnings,
    });
  });

  // 7. get_sources
  register("get_sources", "출처 조회", fiscalOn
    ? "시행사업·매뉴얼 구간(manual_section)·지역·기관·보도자료·공개 재정 관측(fiscal_observation)·승인 반입 문서(document, doc:…)·활성 예산서 행(budget_line)의 원문 출처와 근거 위치를 돌려줍니다. 미검증 재정 원값은 null로 제공합니다."
    : "시행사업·매뉴얼 구간(manual_section)·지역·기관·보도자료·승인 반입 문서(document, doc:…)의 출처와 근거 범위를 돌려줍니다.", {
    subject_type: fiscalOn
      ? z.enum(["implementation", "gov24_service", "welfare100_service", "manual_section", "region", "organization", "press_release", "fiscal_observation", "budget_line", "document"])
      : z.enum(["implementation", "gov24_service", "welfare100_service", "manual_section", "region", "organization", "press_release", "document"]),
    subject_id: z.string().min(1).max(LIMITS.idMax),
    snapshot_id: snapshotInput,
    release_bundle_id: bundleInput,
    cursor: cursorInput,
    limit: limitInput(),
  }, async (args) => {
    const current = await pinned(args);
    if (args.subject_type === "manual_section") {
      const section = await manualSectionOf(current, args.subject_id, 0, 1);
      return envelope(current, now(), section.sources, {
        coverage: { scope: "sources_of_manual_section", complete: true, gaps: ["위치는 파싱 Markdown 줄 기준이며 PDF 물리 쪽수는 미확인입니다."] },
        warnings: section.warnings,
      });
    }
    if (args.subject_type === "gov24_service" || args.subject_type === "implementation" && args.subject_id.startsWith(GOV24_PREFIX)) {
      const service = await getGov24Service(data.db, args.subject_id);
      return envelope(current, now(), [service.source], { coverage: { scope: "gov24_source", complete: true, gaps: [] } });
    }
    if (args.subject_type === 'welfare100_service' || args.subject_type === 'implementation' && args.subject_id.startsWith(WELFARE_CATALOG_PREFIX)) {
      const detail = await requireWelfareCatalog().detail(args.subject_id, baseUrl);
      return envelope(current, now(), [detail.source, ...detail.additional_sources], { warnings: detail.warnings, coverage: { scope: detail.content_scope, complete: false, gaps: ['저장된 대장 출처입니다.'] } });
    }
    if (args.subject_type === "budget_line") return envelope(current, now(), [await budgetLineSource(data.db, args.subject_id, current.budgetPin)], { coverage: { scope: "sources_of_subject", complete: true, gaps: [] } });
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
          "FROM fiscal_observation o JOIN fiscal_collection_run r ON r.run_id = o.run_id WHERE o.observation_id = ? AND EXISTS (SELECT 1 FROM fiscal_snapshot_member m JOIN fiscal_snapshot s ON s.snapshot_id = m.snapshot_id WHERE m.observation_id = o.observation_id AND s.status = 'PUBLISHED'" + (current.fiscalPin === null ? "" : " AND s.snapshot_id IN (SELECT value FROM json_each(?))") + ")",
      ).bind(args.subject_id, ...(current.fiscalPin === null ? [] : [JSON.stringify(current.fiscalPin)])).first<Record<string, unknown>>();
      if (!row) throw new McpToolError("NOT_FOUND", "공개된 재정 관측에서 이 ID를 찾지 못했습니다.");
      const verified = row.unit_verification === "VERIFIED_OFFICIAL_SCREEN" && row.source_amount_unit === "KRW";
      return envelope(current, now(), [{
        kind: "LOFIN_QWGJK_RECORD", source: "지방재정365 세부사업별 세출현황(QWGJK)", source_url: "https://www.lofin365.go.kr/lf/hub/QWGJK",
        license: "출처표시, 상업적·비상업적 이용 가능, 2차적 저작물 작성 가능(원천 명세)", ...row,
        ...(!verified ? { current_budget_raw: null, public_expenditure_raw: null, amount_unavailable_reason: "UNIT_VERIFICATION_REQUIRED" } : {}),
        source_fields: { current_budget_krw: "bdg_cash_amt", public_expenditure_krw: "ep_amt" },
      }], { coverage: { scope: "sources_of_subject", complete: true, gaps: verified ? [] : ["단위 미검증 원값은 제공하지 않습니다."] }, warnings: [FISCAL_AMOUNT_NOTE] });
    }
    if (args.subject_type === "implementation") {
      const run = requireRun(current);
      const row = await programOrThrow(run, args.subject_id);
      const [parts, evidence, documents, publicInfo] = await Promise.all([articleOf(row), programEvidence(run, row), documentFactsOf(current, [args.subject_id]), programPublicInfo(data.db, args.subject_id, { includeLaw: LAW_MCP_PUBLIC })]);
      const sources = [
        ...publicInfo.gov24.services.map((service) => ({ ...service.source, used_for: ["검증된 정부24 연결의 상세·목록 필드"] })),
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
    const [totals, coverage, fiscalSnapshots, documentRows, ledgerRows, fiscalVerification, budgetStatus, gov24State, manualState] = await Promise.all([
      current.run ? data.knowledgeTotals(current.run.id) : Promise.resolve(null),
      readPressCoverage(data.db, now()),
      publishedSnapshots(data.db, { limit: 10, snapshotIds: current.fiscalPin }),
      allDocumentFacts(data.db, current.documentPin, current.run?.id ?? null),
      current.run ? data.sourceRowLedger(current.run.id) : Promise.resolve([]),
      fiscalVerificationStatus(data.db, current.fiscalPin),
      budgetDocumentStatus(data.db, current.budgetPin),
      gov24DatasetState(data.db),
      readManualCorpusState(data.db, current.manualPin),
    ]);
    return envelope(current, now(), {
      server_version: MCP_SERVER_VERSION,
      identity_policy: { schema_version: "source-identity-1", locators: "PRESERVED", unknown_revision: null, aliases: "VERIFIED_SAME_SOURCE_ONLY" },
      search_policy: { production_ranking: "baseline", faq_paraphrase: "STEM_AND_TERM_EXPANSION_PLUS_BM25_RELATED_CANDIDATES", faq_related_max_score: 50, experiment: "FAQ_ONLY_INTERNAL", experiment_features: "BM25_AND_SPARSE_CHARACTER_COSINE", public_override: false },
      quality_policy: { retrieval: "CAPTURED_EVIDENCE_REQUIRED", domain_weighting: "EQUAL", generated_answer_accuracy: "NOT_EVALUATED", model_calls: false },
      request_identity: context.requestIdentity ?? "anonymous",
      faq_129: await faqStatus(),
      statistics: await currentStatisticsStatus(data.db),
      gov24: gov24State,
      welfare100: welfareCatalog ? await welfareCatalog.search(refineWelfareQuery(''), baseUrl, 0, 0).then(({ items: _items, ...status }) => ({ ...status, status: 'AVAILABLE' })) : { status: 'UNAVAILABLE' },
      manuals: {
        component: current.components.manuals, revision: current.manualPin || null,
        status: manualState.active ? "PARTIAL" : "UNAVAILABLE",
        document_count: manualState.active?.document_count ?? 0,
        section_count: manualState.active?.section_count ?? 0,
        source_repository: manualState.active?.source_repository ?? null,
        source_commit: manualState.active?.source_commit ?? null,
        manifest_sha256: manualState.active?.manifest_sha256 ?? null,
        activated_at: manualState.active?.activated_at ?? null,
        ingestion: manualState.ingestion,
        scope: "고정 저장소 커밋의 파싱 매뉴얼·시설현황 본문 구간",
        gaps: ["공식 원본 URL과 PDF 물리 쪽수는 검증되지 않았습니다.", "이미지 참조는 있으나 이미지 본문이 없습니다.", "파일명·내부 원문명에서 추론한 연도는 적용연도 확정값이 아닙니다.", "발행기관·권위·관할의 원천 기본값은 검증된 사실로 승격하지 않습니다."],
      },
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
      fiscal: !fiscalOn ? { component: null, status: "NOT_PROVIDED", reason: FISCAL_WITHHELD_MESSAGE } : fiscalSnapshots.length ? {
        component: current.components.fiscal, status: "PARTIAL",
        snapshots: fiscalSnapshots.map((snapshot) => ({ snapshot_id: snapshot.snapshot_id, scope: snapshot.scope_label, mode: snapshot.mode, effective_reference_date: snapshot.effective_reference_date, complete: snapshot.complete === 1, access_tier: snapshot.access_tier, rows: snapshot.unique_count })),
        snapshot_list_truncated: fiscalVerification.published_snapshots > fiscalSnapshots.length,
        amount_verification: fiscalVerification,
        unavailable_modes: fiscalVerification.available_snapshot_modes.includes("all_fields") ? [] : ["social_welfare", "health", "department"],
        unavailable_reason: fiscalVerification.available_snapshot_modes.includes("all_fields") ? null : "이 공개본에는 전체 세출 snapshot이 없습니다. 연도·범위별 가용 상태를 확인하세요.",
      } : { component: null, status: "UNAVAILABLE", reason: "공개 승인된 재정 snapshot이 아직 없습니다(수집 범위 승인 대기 또는 미수집)." },
      ...(fiscalOn ? { budget_documents: { component: current.components.budget_documents, ...budgetStatus } } : {}),
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
      entity_types: async () => ontologyEntities({ fiscal: fiscalOn, care: CARE_RESOURCES_MCP, law: LAW_MCP_PUBLIC }),
      predicates: async () => ontologyPredicates({ fiscal: fiscalOn, care: CARE_RESOURCES_MCP, law: LAW_MCP_PUBLIC }),
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
    const bound = fingerprint([current.bundleId, ONTOLOGY_VERSION, fiscalOn, CARE_RESOURCES_MCP, LAW_MCP_PUBLIC, args.section]);
    const offset = decodeCursor(args.cursor, bound);
    const page = items.slice(offset, offset + limit);
    const next = offset + page.length < items.length ? encodeCursor(offset + page.length, bound) : null;
    return envelope(current, now(), page, { coverage: { scope: "ontology_section", complete: next === null, gaps: [], total_count: items.length }, nextCursor: next });
  });

  // 재정 도구: 공개 원천·검증 범위·문서 편성단계를 구분한다.
  register("get_fiscal_catalog", "재정 카탈로그", "공개 snapshot에 실제로 있는 재정주체·부서코드·회계·분야/부문·가용 기준일, 관리자가 승인한 예산서 편성 단계(catalog_type=budget_document: document_revision_id·단계·수록 범위), 재정주체 하나의 부서코드 연도별 관측 이력과 연도 사이 사업 이관(catalog_type=department_history, fiscal_entity_id 필요)을 돌려줍니다. 코드·날짜를 추정하지 말고 이 목록에서 고르세요. region_id는 검증된 재정주체 매핑이 있을 때만 쓸 수 있습니다.", FISCAL_TOOL_SHAPES.get_fiscal_catalog, async (args) => { const current = await pinned(args); return getFiscalCatalog(data.db, args, envelopeFor(current), current.fiscalPin, current.budgetPin); });
  register("find_budget_projects", "재정사업 찾기", "회계연도·모드별 세부사업과 검증된 예산현액·공개 지출액을 조회합니다. 연결 가능한 공개 예산서 행이 있으면 budget_documents에 함께 표시합니다. 미검증 금액은 null입니다.", FISCAL_TOOL_SHAPES.find_budget_projects, async (args) => { const current = await pinned(args); return findBudgetProjects(data.db, args, envelopeFor(current), current.fiscalPin, current.budgetPin); });
  register("get_budget_execution", "예산 집행 조회", "재정사업 ID(최대 50개)의 공식 화면 검증 예산현액·공개 지출액·차액·집행률과 기준일을 조회합니다. 미검증 금액은 null입니다.", FISCAL_TOOL_SHAPES.get_budget_execution, async (args) => { const current = await pinned(args); return getBudgetExecution(data.db, args, envelopeFor(current), current.fiscalPin); });
  register("compare_budget_periods", "예산 기간 비교", "같은 재정사업의 두 기준일(같은 연도) 또는 두 연도 값을 비교해 예산현액 변화와 공개 지출액 순변동을 돌려줍니다. 연도가 다르면 같은 재정주체·회계·세부사업코드로 짝을 찾고(mapping), 부서·분류가 바뀌었거나 짝이 없거나 여럿이면 비교불가 사유를 돌려줍니다. 예산서 단계 비교는 comparison_basis=document_stage와 양쪽 document_revision_id(get_fiscal_catalog budget_document)로 하며, project_selection은 fiscal_project_ids·budget_line_ids·detail_project_query 가운데 하나입니다. 문서 단계 금액(천원)과 지방재정365 기준일 예산현액은 한 비교로 섞지 않습니다.", FISCAL_TOOL_SHAPES.compare_budget_periods, async (args) => { const current = await pinned(args); return compareBudgetPeriods(data.db, args, envelopeFor(current), current.fiscalPin, current.budgetPin); });

  register("search_budget_lines", "예산서 세부사업·부기 검색", "승인된 예산서의 세부사업·편성목·부기를 검색합니다. 반환한 budget_line_id를 get_budget_breakdown이나 fetch에 전달해 하위 산출내역을 확인하세요.", BUDGET_DOCUMENT_TOOL_SHAPES.search_budget_lines, async (args) => { const current = await pinned(args); return searchBudgetLines(data.db, args, envelopeFor(current), current.budgetPin); });
  register("get_budget_breakdown", "예산서 부기·산출내역", "검색 결과의 budget_line_id 아래 계층을 페이지별로 읽습니다. 세부사업·편성목·통계목·부기·산출식·문서 표시 금액(천원)·원 환산 문자열·재원·검산 상태·근거 위치를 제공합니다. root는 기준 행이고 lines에는 그 행과 하위 행이 포함됩니다. 합계는 자동 계산하지 않습니다. next_cursor가 있으면 같은 조건으로 이어서 조회하세요.", BUDGET_DOCUMENT_TOOL_SHAPES.get_budget_breakdown, async (args) => { const current = await pinned(args); return getBudgetBreakdown(data.db, args, envelopeFor(current), current.budgetPin); });

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
      coverage: { scope: "official_press_release_metadata", complete: false, gaps: NEWS_GAPS, search_status: total === 0 ? "NO_STORED_MATCHES" : "MATCHES_FOUND", total_count: total, post_count: postCount, group_mode: filter.groupMode, result_unit: filter.groupMode === "verified_groups" ? "verified_release_group_or_item" : "item", region_basis: "publisher_jurisdiction", source_registry_version: current.newsRegistryVersion, jurisdiction: args.jurisdiction ?? "as_published", added_predecessor_ids: addedPredecessors },
      warnings: total === 0 ? ["NO_STORED_MATCHES: 저장된 보도자료 제목에서 요청 조건에 맞는 항목을 찾지 못했습니다. 자료가 발표되지 않았다는 뜻은 아닙니다. 원래 검색어·기관·지역·기간 조건을 유지하여 해당 기관의 공식 보도자료 게시판을 웹검색하고 원문을 확인하세요. 다른 수당·제도의 자료로 대체하지 마세요."] : [],
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
  register("get_welfare_context", "사업 종합 맥락", fiscalOn
    ? "시행사업·정부24·문서사업 하나의 상세 조건과 승인 근거, 정부24 상세 우선 선택, 출처 충돌, 재정·보도자료를 묶어 줍니다. question에 원질문을 넣으면 적용연도를 점검합니다. 도메인별 기준일은 구별합니다."
    : "시행사업 하나의 공개 조건과 관련 보도자료 제목 링크를 각각의 출처·기준일·미확인 상태와 함께 묶어 돌려줍니다. 예산·재정 정보는 제공하지 않습니다.", {
    implementation_id: implementationInput,
    question: questionInput.optional().describe("원질문. 수치·연도·지역·사업 혼입 확인에 사용하며 질문의 숫자는 근거가 아닙니다."),
    as_of: asOfInput,
    ...(fiscalOn ? { fiscal_year: z.number().int().min(2000).max(2100).optional(), budget_reference_date: dateInput.optional() } : {}),
    news_date_from: dateInput.optional(),
    news_date_to: dateInput.optional(),
    news_date_basis: z.enum(["published", "discovered"]).optional(),
    news_source_kind: z.enum(["OFFICIAL_PRESS_RELEASE"]).optional(),
    news_region_basis: z.enum(["publisher_jurisdiction", "mentioned", "either"]).optional(),
    release_bundle_id: bundleInput,
    news_limit: z.number().int().min(1).max(LIMITS.newsContextMax).optional(),
  }, async (args) => {
    const current = await pinned(args);
    const plan = detailQuestionPlan(args.question);
    if (args.implementation_id.startsWith(WELFARE_CATALOG_PREFIX)) return catalogDetailEnvelope(current, args.implementation_id, args.question, args.as_of);
    if (args.implementation_id.startsWith(GOV24_PREFIX)) {
      const service = await getGov24Service(data.db, args.implementation_id, plan?.year ?? null);
      const basis = storedEvidenceBasis([service.source.collected_at, service.source.detail_collected_at], args.as_of, "정부24");
      const resolved = resolveProgramEvidence({ base: { application_conditions: null, application_method: null, conditions_basis: null }, documents: [], services: [service], requestedYear: plan?.requested_year ?? null, subjectId: service.id, programName: service.name, regionId: plan?.region_id ?? service.publisher_scope.region_id, includeAncestorScope: plan?.include_ancestor_scope ?? true });
      resolved.warnings.unshift(...(plan?.warnings ?? []));
      return envelope(current, now(), { program: { implementation_id: service.id, name: service.name, entity_type: service.entity_type, publisher_scope: service.publisher_scope }, eligibility: resolved.eligibility, benefit: resolved.benefit, official_public_info: { gov24: { state: "COLLECTED", services: [service] } }, structured_tables: service.structured_tables, evidence_resolution: resolved.evidence_resolution, ...(plan ? { query_plan: plan } : {}), fiscal: { status: "UNLINKED", reason_code: "INDEPENDENT_GOV24_ENTITY" }, news: { status: "NOT_REQUESTED", items: [] } }, { evidence: [service.source], basis, warnings: [...service.warnings, ...resolved.warnings], coverage: { scope: service.content_scope, complete: false, gaps: resolved.eligibility.unknowns } });
    }
    if (args.implementation_id.startsWith("docprog:")) {
      const documents = await documentFactsOf(current, [args.implementation_id]);
      if (!documents.rows.length) throw new McpToolError("NOT_FOUND", "현재 공개본에 승인된 문서 사업이 없습니다.");
      const first = documents.rows[0];
      const basis = storedEvidenceBasis(documents.rows.map((row) => row.retrieved_at), args.as_of, "승인 문서");
      const resolved = resolveProgramEvidence({ base: { application_conditions: null, application_method: null, conditions_basis: null }, documents: documents.rows, services: [], requestedYear: plan?.requested_year ?? null, subjectId: args.implementation_id, programName: first.subject_label, regionId: plan?.region_id ?? regionIdOf(first.subject_sido, first.subject_sigungu), includeAncestorScope: plan?.include_ancestor_scope ?? true });
      resolved.warnings.unshift(...(plan?.warnings ?? []));
      return envelope(current, now(), { program: { implementation_id: first.subject_id, name: first.subject_label, entity_type: "document_program", region_id: regionIdOf(first.subject_sido, first.subject_sigungu) }, eligibility: resolved.eligibility, benefit: resolved.benefit, document_facts: documents.facts, evidence_resolution: resolved.evidence_resolution, ...(plan ? { query_plan: plan } : {}), fiscal: { status: "UNLINKED" }, news: { status: "NOT_REQUESTED", items: [] } }, { evidence: documents.evidence, basis, warnings: resolved.warnings, coverage: { scope: "approved_document_facts", complete: false, gaps: resolved.eligibility.unknowns } });
    }
    const run = requireRun(current);
    const basis = knowledgeBasis(run, args.as_of);
    if (args.news_region_basis && args.news_region_basis !== "publisher_jurisdiction") throw new McpToolError("REGION_BASIS_NOT_AVAILABLE", "본문을 보관하지 않아 언급 지역(mentioned) 기준은 제공하지 않습니다.");
    if (args.news_date_from && args.news_date_to && args.news_date_from > args.news_date_to) throw new McpToolError("INPUT_CONFLICT", "news_date_from이 news_date_to보다 늦습니다.");
    const row = await programOrThrow(run, args.implementation_id);
    const [parts, evidence, regionOrgs, provinceOrgs, documents, publicInfo] = await Promise.all([
      articleOf(row), programEvidence(run, row),
      row.sigungu ? data.organizationsForRegion(row.sido, row.sigungu) : Promise.resolve([] as OrganizationRow[]),
      data.organizationsForRegion(row.sido, ""),
      documentFactsOf(current, [args.implementation_id]),
      programPublicInfo(data.db, args.implementation_id, { includeLaw: LAW_MCP_PUBLIC }),
    ]);
    if (args.as_of && publicInfo.gov24.services.length) storedEvidenceBasis(publicInfo.gov24.services.flatMap((service) => [service.source.collected_at, service.source.detail_collected_at]), args.as_of, "연결된 정부24");
    const { article } = parts;
    const supplementary = articleEvidence(row, parts, evidence[0]?.evidence_id ?? null);
    const resolved = resolveProgramEvidence({ base: { application_conditions: article.applicationConditions ?? null, application_method: meaningful(row.applicationMethod), conditions_basis: article.conditionsBasis ?? null }, documents: documents.rows, services: publicInfo.gov24.services, requestedYear: plan?.requested_year ?? null, subjectId: args.implementation_id, programName: row.name, regionId: plan?.region_id ?? regionIdOf(row.sido, row.sigungu), baseRegionId: regionIdOf(row.sido, row.sigungu), includeAncestorScope: plan?.include_ancestor_scope ?? true, verifiedServiceIds: publicInfo.gov24.services.map((service) => service.id) });
    resolved.warnings.unshift(...(plan?.warnings ?? []));
    const organizationIds = [...regionOrgs, ...provinceOrgs].map((org) => org.organization_id);
    // 검토된 사업–재정사업 연결만 쓴다(공개본 이후 검토된 연결은 다음 공개본부터). 금액은 나누거나 합치지 않는다.
    const links = fiscalOn ? await verifiedLinksFor(data.db, args.implementation_id, data.pin.linksWatermark) : [];
    const fiscalYear = "fiscal_year" in args && typeof args.fiscal_year === "number" ? args.fiscal_year : null;
    const budgetDate = "budget_reference_date" in args && typeof args.budget_reference_date === "string" ? args.budget_reference_date : null;
    const nameTokens = tokens(row.name.replace(/[()[\]·,]/g, " ")).filter((token) => token.length >= 2);
    const newsLimit = pageLimit(args.news_limit, LIMITS.newsContextDefault, LIMITS.newsContextMax);
    const news = organizationIds.length && nameTokens.length
      ? await data.news(newsFilter({ queryTokens: nameTokens, organizationIds, dateFrom: args.news_date_from ?? "", dateTo: args.news_date_to ?? "", dateBasis: args.news_date_basis ?? "published" }), 0, newsLimit)
      : { rows: [], total: 0 };
    return envelope(current, now(), {
      program: { ...programCard(row, baseUrl), overview: article.overview, content_status: article.contentStatus, overview_evidence_ref: supplementary.overviewRef, effective_reference_date: basis.effective_reference_date },
      eligibility: resolved.eligibility,
      benefit: resolved.benefit,
      official_public_info: publicInfo,
      legal_basis: publicInfo.legal_basis,
      document_facts: documents.facts,
      structured_tables: publicInfo.gov24.services.flatMap((service) => service.structured_tables),
      evidence_resolution: resolved.evidence_resolution,
      ...(plan ? { query_plan: plan } : {}),
      ...(fiscalOn ? { fiscal: links.length
        ? {
          status: "LINKED_VERIFIED",
          linked_fiscal_projects: links.map((link) => ({ fiscal_project_id: link.source_id, link_id: link.link_id, relation: link.relation, basis: link.candidate_basis, reviewed_at: link.reviewed_at ? new Date(link.reviewed_at * 1000).toISOString() : null })),
          message: "관리자가 검토한 관련 재정사업입니다. 재정사업 금액은 이 사업만의 예산이 아닐 수 있어 사업별로 나누거나 합치지 않았습니다. 금액은 get_budget_execution(fiscal_project_ids)로 조회하세요.",
          requested_fiscal_year: fiscalYear, requested_reference_date: budgetDate,
        }
        : { status: "UNLINKED", reason_code: "NO_VERIFIED_FISCAL_LINK", message: "검토된 시행사업–재정사업 연결이 없어 예산·집행 정보를 붙이지 않습니다. 다른 지역 예산으로 대체하지 않습니다. find_budget_projects로 따로 찾을 수 있으나 같은 사업이라는 확인은 아닙니다.", requested_fiscal_year: fiscalYear, requested_reference_date: budgetDate } } : {}),
      news: {
        status: news.rows.length ? "TITLE_MATCH_UNVERIFIED" : "NONE_FOUND",
        link_basis: "사업 지역의 시·군·구와 시·도가 발행한 공식 보도자료 중 제목에 사업명 낱말이 모두 들어간 항목(검증된 연결 아님)",
        date_basis: args.news_date_basis ?? "published",
        items: news.rows.map((item) => ({ article_id: item.item_id, title: item.title, issued_by: item.org_name, published_date: item.published_date || null, original_url: item.canonical_url, content_scope: "metadata_only" })),
        total_matches: news.total,
        note: news.rows.length ? "제목 일치일 뿐 같은 사업이라는 확인은 아닙니다." : "찾지 못했다고 관련 보도가 없다는 뜻은 아닙니다(수집 기관·기간이 제한적).",
      },
    }, {
      evidence: [...evidence, ...supplementary.items, ...documents.evidence, ...publicInfo.gov24.services.map((service) => service.source)], basis: { ...basis, news_date_basis: args.news_date_basis ?? "published" },
      coverage: { scope: "welfare_context", complete: false, gaps: [KNOWLEDGE_GAP, ...(fiscalOn && !links.length ? ["검토된 재정 연결이 없습니다."] : []), NEWS_GAPS[1]] },
      warnings: [...resolved.warnings, ...(fiscalOn ? ["사업·재정·보도자료의 기준일은 서로 다르며 하나로 합치지 않았습니다."] : ["사업·보도자료의 기준일은 서로 다르며 하나로 합치지 않았습니다.", FISCAL_WITHHELD_MESSAGE])],
      truncated: news.total > news.rows.length,
    });
  });


  // 18~22. 외부 데이터 연계 조회(지역 돌봄 수요·장기요양기관·정부24·법령 근거·연계 현황)
  registerIntegrationTools({
    register,
    db: data.db,
    wrap: async (value, options = {}) => envelope(await state(), now(), value, options),
    today: () => new Date((now() + 9 * 3600) * 1000).toISOString().slice(0, 10),
    lawRuntime: context.lawRuntime,
  });

  registerStatisticsTools({ db: data.db, register, wrap: async (value, options = {}) => envelope(await state(), now(), value, options) });

  // 0. welfare_research (Korean Law MCP의 legal_research 대응: 다단계 자동 툴체이닝 원스톱 리서치)
  register("welfare_research", "복지 복합 리서치(자동 체이닝)", "자연어 질문을 분석해 통합검색(search) 후 상위 근거의 상세 조회(get_welfare_context·get_manual_section·get_faq·get_statistics_data·get_budget_breakdown 등)와 작업별 보조 자료를 한 번에 연속 조회합니다.", {
    query: questionInput.min(1).describe("자연어 복지 질문 또는 조사할 제도·지역·예산·통계 주제"),
    task: z.enum(WELFARE_RESEARCH_TASKS).optional().describe("auto(기본: 질문 의도로 자동 선택), full_research(종합), eligibility_check(신청자격·절차), manual_verify(매뉴얼 원문), regional_compare(지역 사업·돌봄자원), budget_track(예산·집행), statistics_trend(통계 시계열)"),
    region_id: regionInput.optional(),
    fiscal_year: z.number().int().min(2000).max(2100).optional(),
    detail_limit: z.number().int().min(1).max(MAX_AUTO_DETAIL_ITEMS).optional().describe("자동 상세 조회할 상위 후보 수(기본 2, 최대 3)"),
    release_bundle_id: bundleInput,
  }, async (args) => {
    const current = await pinned(args);
    const deadline = startWelfareChainDeadline(context.searchSourceDeadlineMs ? Math.max(8_000, context.searchSourceDeadlineMs + 4_000) : DEFAULT_WELFARE_CHAIN_DEADLINE_MS);
    try {
      const basePlan = refineWelfareQuery(args.query, { currentYear: Number(kstDate(now()).slice(0, 4)) });
      const effectiveRegion = args.region_id ?? basePlan.region_id;
      if (effectiveRegion && effectiveRegion !== "region:전국") parseRegionId(effectiveRegion);
      const resolvedTask = (!args.task || args.task === "auto") ? detectWelfareResearchTask(args.query, basePlan) : args.task;
      const detailLimit = args.detail_limit ?? DEFAULT_AUTO_DETAIL_ITEMS;
      const stepsExecuted: { step: string; tool: McpToolName; status: "SUCCEEDED" | "TIMED_OUT" | "ERROR"; note?: string }[] = [];
      const timedOutSections: { section: string; recovery_tool: McpToolName; recovery_params: Record<string, unknown>; message: string }[] = [];

      // 1단계: 통합 검색 실행
      const searchOutcome = await raceWelfareDeadline(deadline, () => invokeInternal("search", { query: args.query }));
      if (!searchOutcome.ok) {
        throw new McpToolError("CHAIN_SEARCH_FAILED", searchOutcome.error ?? "통합 검색 단계가 시간 한도를 넘겼습니다. search 도구로 다시 조회해 주세요.");
      }
      stepsExecuted.push({ step: "primary_search", tool: "search", status: "SUCCEEDED" });
      const searchData = searchOutcome.value as {
        results: { id: string; entity_type: string; title?: string }[];
        query_plan: typeof basePlan;
        retrieval_status: string;
        answerability: string;
        coverage: unknown;
        reason_codes: string[];
        warnings?: string[];
      };

      // task별 후보 우선순위 정렬
      const candidates = [...(searchData.results ?? [])].sort((a, b) => {
        const priority = (entityType: string): number => {
          if (resolvedTask === "manual_verify") return entityType === "manual_section" ? 0 : 1;
          if (resolvedTask === "eligibility_check") return ["implementation", "gov24_service", "welfare100_service", "official_faq", "manual_section"].indexOf(entityType) >= 0 ? 0 : 1;
          if (resolvedTask === "statistics_trend") return entityType === "welfare_statistic" ? 0 : 1;
          if (resolvedTask === "budget_track") return entityType === "budget_line" ? 0 : 1;
          return 0;
        };
        return priority(a.entity_type) - priority(b.entity_type);
      });

      // 2단계: 상위 후보 자동 상세 체이닝
      const chainedDetails = await executeAutoDetailChain(candidates, invokeInternal, {
        question: args.query,
        releaseBundleId: current.bundleId,
        limit: detailLimit,
        deadline,
      });
      for (const item of chainedDetails.items) {
        stepsExecuted.push({ step: "auto_detail:" + item.id, tool: item.tool, status: item.status, ...(item.recovery_hint ? { note: item.recovery_hint } : {}) });
        if (item.status === "TIMED_OUT") {
          timedOutSections.push({ section: "상세 조회(" + item.id + ")", recovery_tool: item.tool, recovery_params: item.params, message: item.recovery_hint ?? "개별 도구로 조회하세요." });
        }
      }

      // 3단계: task별 도메인 확장 체이닝
      let regionalServices: unknown = null;
      let careDemand: unknown = null;
      let budgetProjects: unknown = null;
      let budgetExecution: unknown = null;
      let statisticsData: unknown = null;

      if ((resolvedTask === "regional_compare" || (effectiveRegion && effectiveRegion !== "region:전국")) && !deadline.expired()) {
        const regionId = effectiveRegion && effectiveRegion !== "region:전국" ? effectiveRegion : "region:제주특별자치도|서귀포시";
        const [catalogLeg, careLeg] = await Promise.all([
          raceWelfareDeadline(deadline, () => invokeInternal("search_welfare_services", { query: basePlan.search_query || undefined, region_id: regionId, include_ancestor_scope: true, limit: 10 })),
          CARE_RESOURCES_MCP && resolvedTask === "regional_compare"
            ? raceWelfareDeadline(deadline, () => invokeInternal("get_care_demand", { region_id: regionId }))
            : Promise.resolve(null),
        ]);
        if (catalogLeg.ok) {
          regionalServices = catalogLeg.value;
          stepsExecuted.push({ step: "regional_catalog", tool: "search_welfare_services", status: "SUCCEEDED" });
        } else if (catalogLeg.timedOut) {
          timedOutSections.push({ section: "지역 복지제도100 목록", recovery_tool: "search_welfare_services", recovery_params: { region_id: regionId, include_ancestor_scope: true }, message: "시간 한도로 지역 대장 목록 응답이 지연되었습니다." });
        }
        if (careLeg) {
          if (careLeg.ok) {
            careDemand = (careLeg.value as { data?: unknown }).data ?? careLeg.value;
            stepsExecuted.push({ step: "regional_care_demand", tool: "get_care_demand", status: "SUCCEEDED" });
          } else if (careLeg.timedOut) {
            timedOutSections.push({ section: "지역 돌봄 수요 통계", recovery_tool: "get_care_demand", recovery_params: { region_id: regionId }, message: "시간 한도로 지역 돌봄 수요 응답이 지연되었습니다." });
          }
        }
      }

      if (resolvedTask === "budget_track" && fiscalOn && !deadline.expired()) {
        const fiscalYear = args.fiscal_year ?? basePlan.requested_year ?? 2026;
        const projectsLeg = await raceWelfareDeadline(deadline, () =>
          invokeInternal("find_budget_projects", {
            fiscal_year: fiscalYear,
            mode: "integrated_care",
            ...(effectiveRegion && effectiveRegion !== "region:전국" ? { region_id: effectiveRegion } : {}),
            ...(basePlan.search_query ? { query: basePlan.search_query.slice(0, LIMITS.queryMax) } : {}),
            limit: 5,
          }),
        );
        if (projectsLeg.ok) {
          const projectData = (projectsLeg.value as { data?: { items?: { fiscal_project_id?: string }[] } }).data;
          budgetProjects = projectData ?? projectsLeg.value;
          stepsExecuted.push({ step: "budget_projects", tool: "find_budget_projects", status: "SUCCEEDED" });
          const projectIds = (projectData?.items ?? []).map((row) => row.fiscal_project_id).filter((id): id is string => typeof id === "string").slice(0, 5);
          if (projectIds.length && !deadline.expired()) {
            const execLeg = await raceWelfareDeadline(deadline, () =>
              invokeInternal("get_budget_execution", { fiscal_project_ids: projectIds, fiscal_year: fiscalYear }),
            );
            if (execLeg.ok) {
              budgetExecution = (execLeg.value as { data?: unknown }).data ?? execLeg.value;
              stepsExecuted.push({ step: "budget_execution", tool: "get_budget_execution", status: "SUCCEEDED" });
            }
          }
        } else if (projectsLeg.timedOut) {
          timedOutSections.push({ section: "재정사업 조회", recovery_tool: "find_budget_projects", recovery_params: { fiscal_year: fiscalYear, mode: "integrated_care" }, message: "시간 한도로 재정사업 목록 응답이 지연되었습니다." });
        }
      }

      if (resolvedTask === "statistics_trend" && !deadline.expired()) {
        const alreadyFetchedStat = chainedDetails.items.some((item) => item.entity_type === "welfare_statistic" && item.status === "SUCCEEDED");
        if (!alreadyFetchedStat) {
          const statSearchLeg = await raceWelfareDeadline(deadline, () =>
            invokeInternal("search_statistics", { query: basePlan.search_query || args.query.slice(0, 100), data_only: true, limit: 3 }),
          );
          if (statSearchLeg.ok) {
            stepsExecuted.push({ step: "statistics_search", tool: "search_statistics", status: "SUCCEEDED" });
            const statItems = ((statSearchLeg.value as { data?: { items?: { dataset_id?: string; id?: string; data_available?: boolean }[] } }).data?.items ?? [])
              .filter((row) => row.data_available && (row.dataset_id || row.id));
            const firstStatId = statItems[0]?.dataset_id ?? statItems[0]?.id;
            if (firstStatId && !deadline.expired()) {
              const statDataLeg = await raceWelfareDeadline(deadline, () =>
                invokeInternal("get_statistics_data", { statistics_id: firstStatId }),
              );
              if (statDataLeg.ok) {
                statisticsData = (statDataLeg.value as { data?: unknown }).data ?? statDataLeg.value;
                stepsExecuted.push({ step: "statistics_data", tool: "get_statistics_data", status: "SUCCEEDED" });
              }
            }
          }
        }
      }

      const followUpCalls = suggestFollowUpCallsForSearch(candidates, {
        question: args.query,
        releaseBundleId: current.bundleId,
        regionId: effectiveRegion,
      });
      if (resolvedTask === "budget_track" && followUpCalls.length < 4) {
        followUpCalls.push(toSuggestedToolCall(followUpCalls.length + 1, "get_fiscal_catalog", { catalog_type: "available_reference_date", fiscal_year: args.fiscal_year ?? 2026 }, "재정 데이터 가용 기준일·예산서 단계 확인"));
      }

      return envelope(current, now(), {
        task_requested: args.task ?? "auto",
        task_resolved: resolvedTask,
        query_plan: searchData.query_plan,
        chain_execution: {
          header: chainedDetails.header,
          steps_executed: stepsExecuted,
          succeeded_details: chainedDetails.succeeded_count,
          timed_out_sections: timedOutSections,
          partial_result: timedOutSections.length > 0,
        },
        search: {
          retrieval_status: searchData.retrieval_status,
          answerability: searchData.answerability,
          coverage: searchData.coverage,
          reason_codes: searchData.reason_codes,
          results: (searchData.results ?? []).slice(0, 10),
        },
        chained_details: chainedDetails.items,
        ...(regionalServices ? { regional_welfare_catalog: regionalServices } : {}),
        ...(careDemand ? { care_demand: careDemand } : {}),
        ...(budgetProjects ? { budget_projects: budgetProjects } : {}),
        ...(budgetExecution ? { budget_execution: budgetExecution } : {}),
        ...(statisticsData ? { statistics_data: statisticsData } : {}),
        suggested_tool_calls: followUpCalls,
        next_actions_text: formatSuggestedToolCalls(followUpCalls),
      }, {
        coverage: {
          scope: "welfare_research_chain",
          complete: timedOutSections.length === 0 && searchData.answerability === "SUPPORTED",
          gaps: [
            ...(timedOutSections.map((item) => item.section + ": " + item.message)),
            ...(searchData.retrieval_status !== "CANDIDATES_FOUND" ? ["검색 결과에서 직접 근거 후보를 찾지 못했습니다."] : []),
          ],
        },
        warnings: [
          ...(searchData.warnings ?? []),
          ...(timedOutSections.length ? ["⏱ 체인 시간 한도로 일부 단계만 수집했습니다. 누락된 섹션은 안내된 개별 도구로 이어서 조회하세요."] : []),
        ],
      });
    } finally {
      deadline.dispose();
    }
  });

  // 메타 도구 1: discover_tools (Korean Law MCP 패턴: 전문 복지 도구 탐색)
  register("discover_tools", "복지 도구 찾기", "질문 의도·키워드(매뉴얼·129 FAQ·통계·예산·보도자료·온톨로지·출처 등)에 맞는 대시보드 복지 도구를 찾습니다. 1-hop 노출 도구는 직접 호출하고, 전문 도구는 execute_tool로 실행하세요.", {
    intent: z.string().trim().min(1).max(200).describe("찾고자 하는 기능·도메인·도구명 (예: '예산 기간 비교', '매뉴얼 구간', '129 FAQ', '온톨로지 관계', '보도자료')"),
  }, async ({ intent }) => {
    const current = await state();
    const discovered = discoverWelfareTools(intent, toolCatalog);
    const withheld = [
      ...(LAW_MCP_PUBLIC ? [] : [LAW_MCP_WITHHELD_MESSAGE]),
      ...(CARE_RESOURCES_MCP ? [] : [CARE_MCP_WITHHELD_MESSAGE]),
    ];
    return envelope(current, now(), discovered, {
      coverage: { scope: "welfare_tool_discovery", complete: true, gaps: withheld },
      warnings: withheld,
    });
  });

  // 메타 도구 2: execute_tool (Korean Law MCP 패턴: 전문 복지 도구 2-hop 실행)
  register("execute_tool", "복지 도구 실행", "discover_tools로 확인한 복지 도구를 이름(tool_name)과 파라미터(params)로 실행합니다. 메타 도구 재귀 호출과 비활성 도구(돌봄자원·법령)는 차단됩니다.", {
    tool_name: z.string().trim().min(1).max(100).describe("실행할 복지 도구 이름 (예: get_manual_section, get_faq, compare_budget_periods, get_budget_breakdown)"),
    params: z.record(z.unknown()).optional().describe("도구에 전달할 파라미터 객체"),
  }, async ({ tool_name, params }) => {
    const target = tool_name.trim();
    if (META_MCP_TOOL_NAMES.has(target)) {
      throw new McpToolError("META_TOOL_RECURSION", "메타 도구(" + target + ")는 execute_tool로 재귀 실행할 수 없습니다.");
    }
    if (isBlockedLawTool(target)) {
      throw new McpToolError("LAW_MCP_DISABLED", LAW_MCP_WITHHELD_MESSAGE);
    }
    if (isBlockedCareTool(target)) {
      throw new McpToolError("CARE_MCP_DISABLED", CARE_MCP_WITHHELD_MESSAGE);
    }
    const rawParams = params ?? {};
    if (JSON.stringify(rawParams).length > 50_000) {
      throw new McpToolError("PARAMS_TOO_LARGE", "params 크기가 허용 상한(50,000자)을 넘었습니다.");
    }
    const fn = internalHandlers.get(target as McpToolName);
    if (!fn) {
      throw new McpToolError("TOOL_NOT_FOUND", "실행 가능한 복지 도구를 찾을 수 없습니다: " + target + ". discover_tools로 사용 가능한 도구와 입력 필드를 먼저 확인하세요.");
    }
    try {
      return await fn(rawParams);
    } catch (error) {
      if (error instanceof McpToolError) throw error;
      if (error instanceof z.ZodError) {
        const detail = error.issues.map((issue) => (issue.path.join(".") || "params") + ": " + issue.message).join("; ");
        throw new McpToolError("INVALID_TOOL_PARAMS", target + " 입력 형식 오류: " + detail);
      }
      throw error;
    }
  });

  return registered;
}

function newsFilter(partial: Partial<NewsFilter>): NewsFilter {
  return {
    queryTokens: [], categoryIds: [], organizationIds: [], organizationTypes: [], sido: "", sigungu: "",
    includeDescendants: false, dateFrom: "", dateTo: "", dateBasis: "published", ...partial,
  };
}
