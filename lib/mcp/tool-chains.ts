// Korean Law MCP(v4.15.x)의 자동 툴콜링·툴체이닝·메타 도구 탐색 구조를 복지 도메인에 적용한다.
// 법령 도구는 비활성(LAW_MCP_PUBLIC=false) 상태를 유지하며 외부 법제처 API를 호출하지 않는다.
import { requestContext } from "korean-law-mcp/lib/session-state";
import {
  CARE_MCP_WITHHELD_MESSAGE,
  CARE_RESOURCES_MCP,
  CARE_TOOL_NAMES,
  EXECUTABLE_MCP_TOOL_NAMES,
  EXPOSED_WELFARE_TOOL_NAMES,
  LAW_MCP_PUBLIC,
  LAW_MCP_TOOL_NAMES,
  LAW_MCP_WITHHELD_MESSAGE,
  McpToolError,
  type McpToolName,
  PUBLIC_MCP_TOOL_NAMES,
} from "./contract.ts";
import type { RefinedWelfareQuery } from "./query-refiner.ts";

export const DEFAULT_WELFARE_CHAIN_DEADLINE_MS = 12_000;
export const MAX_AUTO_DETAIL_ITEMS = 3;
export const DEFAULT_AUTO_DETAIL_ITEMS = 2;

export const WELFARE_RESEARCH_TASKS = [
  "auto",
  "full_research",
  "eligibility_check",
  "manual_verify",
  "regional_compare",
  "budget_track",
  "statistics_trend",
] as const;

export type WelfareResearchTask = (typeof WELFARE_RESEARCH_TASKS)[number];
export type ResolvedWelfareResearchTask = Exclude<WelfareResearchTask, "auto">;

export interface WelfareChainDeadline {
  readonly signal: AbortSignal;
  expired(): boolean;
  remainingMs(): number;
  dispose(): void;
}

export function startWelfareChainDeadline(ms: number = DEFAULT_WELFARE_CHAIN_DEADLINE_MS): WelfareChainDeadline {
  const started = Date.now();
  const controller = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    controller.abort(new Error("복지 체인 시간 한도(" + ms + "ms) 초과"));
  }, Math.max(100, ms));
  (timer as { unref?: () => void }).unref?.();
  return {
    signal: controller.signal,
    expired: () => fired || Date.now() - started >= ms,
    remainingMs: () => Math.max(0, ms - (Date.now() - started)),
    dispose: () => clearTimeout(timer),
  };
}

export type ChainLegOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly timedOut: boolean; readonly error?: string };

/**
 * 한 갈래를 체인 데드라인과 경주시킨다(korean-law-mcp chain-deadline.ts와 같은 원칙).
 * 요청 컨텍스트의 실행 예산(RequestExecutionBudget)도 함께 점검한다.
 */
export async function raceWelfareDeadline<T>(
  deadline: WelfareChainDeadline,
  work: () => Promise<T>,
): Promise<ChainLegOutcome<T>> {
  if (deadline.expired()) return { ok: false, timedOut: true };
  try {
    requestContext.getStore()?.budget?.consumeUpstreamRequest();
  } catch (error) {
    return { ok: false, timedOut: false, error: error instanceof Error ? error.message : "실행 한도 초과" };
  }
  let onAbort: () => void = () => {};
  const timedOutPromise = new Promise<ChainLegOutcome<T>>((resolve) => {
    if (deadline.signal.aborted) return resolve({ ok: false, timedOut: true });
    onAbort = () => resolve({ ok: false, timedOut: true });
    deadline.signal.addEventListener("abort", onAbort, { once: true });
  });
  const settledPromise = Promise.resolve().then(work).then(
    (value): ChainLegOutcome<T> => ({ ok: true, value }),
    (error): ChainLegOutcome<T> => {
      if (deadline.expired()) return { ok: false, timedOut: true };
      const message = error instanceof McpToolError ? error.code + ": " + error.message : error instanceof Error ? error.message : String(error);
      return { ok: false, timedOut: false, error: message };
    },
  );
  try {
    return await Promise.race([settledPromise, timedOutPromise]);
  } finally {
    deadline.signal.removeEventListener("abort", onAbort);
  }
}

export interface SuggestedToolCall {
  readonly step: number;
  readonly tool: McpToolName;
  readonly call_path: "direct" | "execute_tool";
  readonly params: Record<string, unknown>;
  readonly execute_tool_args?: { readonly tool_name: McpToolName; readonly params: Record<string, unknown> };
  readonly reason: string;
}

const EXPOSED_SET: ReadonlySet<string> = new Set(EXPOSED_WELFARE_TOOL_NAMES);

export function toSuggestedToolCall(step: number, tool: McpToolName, params: Record<string, unknown>, reason: string): SuggestedToolCall {
  const direct = EXPOSED_SET.has(tool);
  return {
    step,
    tool,
    call_path: direct ? "direct" : "execute_tool",
    params,
    ...(direct ? {} : { execute_tool_args: { tool_name: tool, params } }),
    reason,
  };
}

export function formatSuggestedToolCalls(calls: readonly SuggestedToolCall[]): string {
  if (!calls.length) return "";
  const lines = calls.map((item) => {
    return item.step + ". " + item.tool + " (" + item.call_path + ")";
  });
  return "━━━ 이어서 할 수 있는 조회 ━━━\n" + lines.join("\n");
}

export interface DetailRoute {
  readonly id: string;
  readonly entity_type: string;
  readonly detail_tool: McpToolName;
  readonly detail_params: Record<string, unknown>;
  readonly fallback_tool: McpToolName;
  readonly fallback_params: Record<string, unknown>;
  readonly reason: string;
}

/**
 * 검색 후보 ID와 질문 의도를 보고 가장 적합한 상세 조회 도구와 파라미터를 결정한다.
 * (korean-law-mcp의 SEARCH_DETAIL_CHAINS 매핑을 복지 다중 엔티티 ID 체계로 확장)
 */
export function resolveDetailRouteForId(id: string, options: { readonly question?: string; readonly releaseBundleId?: string } = {}): DetailRoute | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.startsWith("law:")) return null;
  const questionArg = options.question?.trim() ? { question: options.question.trim() } : {};
  const bundleArg = options.releaseBundleId ? { release_bundle_id: options.releaseBundleId } : {};

  if (trimmed.startsWith("manual:")) {
    return {
      id: trimmed,
      entity_type: "manual_section",
      detail_tool: "get_manual_section",
      detail_params: { section_id: trimmed, ...bundleArg },
      fallback_tool: "fetch",
      fallback_params: { id: trimmed },
      reason: "복지 매뉴얼 구간의 원문·표·각주와 인접 신청절차 구간 확인",
    };
  }
  if (trimmed.startsWith("faq129:")) {
    return {
      id: trimmed,
      entity_type: "official_faq",
      detail_tool: "get_faq",
      detail_params: { id: trimmed },
      fallback_tool: "fetch",
      fallback_params: { id: trimmed },
      reason: "보건복지상담센터(129) 공식 질문·답변 원문과 조건 체크리스트·보강 근거 확인",
    };
  }
  if (trimmed.startsWith("service:") || trimmed.startsWith("gov24_service:") || trimmed.startsWith("docprog:") || trimmed.startsWith("welfare100_service:")) {
    const entityType = trimmed.startsWith("gov24_service:") ? "gov24_service"
      : trimmed.startsWith("docprog:") ? "document_program"
      : trimmed.startsWith("welfare100_service:") ? "welfare100_service"
      : "implementation";
    return {
      id: trimmed,
      entity_type: entityType,
      detail_tool: "get_welfare_context",
      detail_params: { implementation_id: trimmed, ...questionArg, ...bundleArg },
      fallback_tool: "fetch",
      fallback_params: { id: trimmed },
      reason: "지원대상·선정기준·지원내용·신청방법·구비서류와 적용연도·출처 충돌 종합 확인",
    };
  }
  if (/^(stat|population|kosis):/.test(trimmed)) {
    return {
      id: trimmed,
      entity_type: "welfare_statistic",
      detail_tool: "get_statistics_data",
      detail_params: { statistics_id: trimmed },
      fallback_tool: "fetch",
      fallback_params: { id: trimmed },
      reason: "공식 통계표의 연도·지역별 수치, 단위, 결측·잠정치 및 원자료 출처 확인",
    };
  }
  if (trimmed.startsWith("bl-")) {
    return {
      id: trimmed,
      entity_type: "budget_line",
      detail_tool: "get_budget_breakdown",
      detail_params: { budget_line_id: trimmed, ...bundleArg },
      fallback_tool: "fetch",
      fallback_params: { id: trimmed },
      reason: "예산서 세부사업 아래 편성목·통계목·부기·산출식과 문서 단계 금액 확인",
    };
  }
  if (trimmed.startsWith("fp:")) {
    return {
      id: trimmed,
      entity_type: "fiscal_project",
      detail_tool: "get_budget_execution",
      detail_params: { fiscal_project_ids: [trimmed], ...bundleArg },
      fallback_tool: "find_budget_projects",
      fallback_params: { fiscal_year: 2026, mode: "integrated_care" },
      reason: "재정사업의 공식 화면 검증 예산현액·공개 지출액·집행률 확인",
    };
  }
  if (trimmed.startsWith("ltc:")) {
    if (!CARE_RESOURCES_MCP) return null;
    return {
      id: trimmed,
      entity_type: "care_institution",
      detail_tool: "get_care_institution",
      detail_params: { institution_id: trimmed },
      fallback_tool: "find_care_institutions",
      fallback_params: { region_id: "region:제주특별자치도|서귀포시" },
      reason: "장기요양기관 일반현황·서비스 유형·협약 의료기관과 수집일 확인",
    };
  }
  if (trimmed.startsWith("news:")) {
    return {
      id: trimmed,
      entity_type: "press_release",
      detail_tool: "get_news_metadata",
      detail_params: { article_id: trimmed, ...bundleArg },
      fallback_tool: "fetch",
      fallback_params: { id: trimmed },
      reason: "공식 보도자료 발행기관·게시일·원문 주소와 분류 근거 확인",
    };
  }
  return null;
}

/**
 * 후보 목록에서 상세 경로를 추출하되, 한 가지 도구(예: 매뉴얼 4건)만 독점하지 않도록
 * 최상위 후보를 먼저 고른 뒤 서로 다른 상세 도구 유형(get_welfare_context·get_manual_section·get_faq 등)을 우선 배분한다.
 */
function selectDiverseDetailRoutes(
  candidates: readonly { readonly id?: string; readonly implementation_id?: string; readonly dataset_id?: string; readonly budget_line_id?: string; readonly institution_id?: string }[],
  options: { readonly question?: string; readonly releaseBundleId?: string; readonly limit: number },
): DetailRoute[] {
  const allRoutes: DetailRoute[] = [];
  const seenIds = new Set<string>();
  for (const row of candidates) {
    const rawId = row.dataset_id ?? row.id ?? row.implementation_id ?? row.budget_line_id ?? row.institution_id;
    if (typeof rawId !== "string" || !rawId || seenIds.has(rawId)) continue;
    const route = resolveDetailRouteForId(rawId, { question: options.question, releaseBundleId: options.releaseBundleId });
    if (!route) continue;
    seenIds.add(rawId);
    allRoutes.push(route);
  }
  const selected: DetailRoute[] = [];
  const usedIds = new Set<string>();
  const usedTools = new Set<string>();
  // 1차: 서로 다른 detail_tool 대표 후보를 원래 순위대로 우선 선택
  for (const route of allRoutes) {
    if (selected.length >= options.limit) break;
    if (usedTools.has(route.detail_tool)) continue;
    usedTools.add(route.detail_tool);
    usedIds.add(route.id);
    selected.push(route);
  }
  // 2차: 남은 자리는 원래 순위 순서대로 채움
  for (const route of allRoutes) {
    if (selected.length >= options.limit) break;
    if (usedIds.has(route.id)) continue;
    usedIds.add(route.id);
    selected.push(route);
  }
  return selected;
}

/**
 * 검색 결과 목록에서 후속 상세 조회 추천 목록(suggested_tool_calls)을 생성한다.
 */
export function suggestFollowUpCallsForSearch(
  results: readonly { readonly id?: string; readonly implementation_id?: string; readonly dataset_id?: string; readonly budget_line_id?: string; readonly institution_id?: string; readonly entity_type?: string }[],
  options: { readonly question?: string; readonly releaseBundleId?: string; readonly regionId?: string | null; readonly maxSuggestions?: number } = {},
): SuggestedToolCall[] {
  const max = options.maxSuggestions ?? 4;
  const routes = selectDiverseDetailRoutes(results, {
    question: options.question,
    releaseBundleId: options.releaseBundleId,
    limit: max,
  });
  const calls: SuggestedToolCall[] = routes.map((route, idx) =>
    toSuggestedToolCall(idx + 1, route.detail_tool, route.detail_params, route.reason),
  );

  if (calls.length < max && options.regionId && options.regionId !== "region:전국") {
    calls.push(
      toSuggestedToolCall(
        calls.length + 1,
        "search_welfare_services",
        { region_id: options.regionId, include_ancestor_scope: true, limit: 20 },
        "해당 지역의 복지제도100 대장 사업과 전국·광역 공통사업 목록 확인",
      ),
    );
  }
  return calls;
}

export interface ChainedDetailItem {
  readonly id: string;
  readonly entity_type: string;
  readonly tool: McpToolName;
  readonly params: Record<string, unknown>;
  readonly status: "SUCCEEDED" | "TIMED_OUT" | "ERROR";
  readonly detail?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly error?: string;
  readonly recovery_hint?: string;
}

export function isChainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function omitCompletedCalls(calls: readonly SuggestedToolCall[], items: readonly ChainedDetailItem[]): SuggestedToolCall[] {
  return calls.filter(call => !items.some(item => item.status === "SUCCEEDED" && item.tool === call.tool && JSON.stringify(item.params) === JSON.stringify(call.params)))
    .map((call, index) => ({ ...call, step: index + 1 }));
}

export function compactChainedCandidates(results: readonly unknown[], items: readonly ChainedDetailItem[]): unknown[] {
  const completed = new Set(items.filter(item => item.status === "SUCCEEDED").map(item => item.id));
  return results.map(row => {
    if (!isChainRecord(row) || typeof row.id !== "string" || !completed.has(row.id)) return row;
    return { ...Object.fromEntries(Object.entries(row).filter(([key]) => ["id", "title", "name", "entity_type", "source_identity", "url", "score", "rank", "warnings", "scope_flags", "reason_codes", "applicability"].includes(key))), detail_location: "chained_details" };
  });
}

export function detailCoverageGaps(items: readonly ChainedDetailItem[]): string[] {
  return items.flatMap(item => {
    if (item.status !== "SUCCEEDED") return [item.id + ": " + (item.error ?? item.recovery_hint ?? item.status)];
    const coverage = item.context?.coverage;
    if (!isChainRecord(coverage) || coverage.complete !== true || coverage.context_complete === false) {
      const gaps = isChainRecord(coverage) && Array.isArray(coverage.gaps) ? coverage.gaps.filter((gap): gap is string => typeof gap === "string") : [];
      return gaps.length ? gaps.map(gap => item.id + ": " + gap) : [item.id + ": 상세 자료의 전체 범위가 확인되지 않았습니다."];
    }
    return [];
  });
}

export interface AutoDetailChainOutput {
  readonly header: string;
  readonly requested_limit: number;
  readonly succeeded_count: number;
  readonly timed_out_count: number;
  readonly error_count: number;
  readonly items: readonly ChainedDetailItem[];
}

/**
 * 검색 결과 상위 후보의 상세 도구를 서버 내부에서 연속 호출해 묶어 준다(korean-law-mcp fetchSearchDetailChain 대응).
 */
export async function executeAutoDetailChain(
  candidates: readonly { readonly id?: string; readonly implementation_id?: string; readonly dataset_id?: string; readonly budget_line_id?: string; readonly institution_id?: string }[],
  invoker: (tool: McpToolName, params: Record<string, unknown>) => Promise<unknown>,
  options: { readonly question?: string; readonly releaseBundleId?: string; readonly limit?: number; readonly deadline?: WelfareChainDeadline } = {},
): Promise<AutoDetailChainOutput> {
  const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_AUTO_DETAIL_ITEMS), MAX_AUTO_DETAIL_ITEMS);
  const routes = selectDiverseDetailRoutes(candidates, {
    question: options.question,
    releaseBundleId: options.releaseBundleId,
    limit,
  });

  if (!routes.length) {
    return {
      header: "자동 상세조회: 상세 연결 대상 후보가 없습니다.",
      requested_limit: limit,
      succeeded_count: 0,
      timed_out_count: 0,
      error_count: 0,
      items: [],
    };
  }

  const ownDeadline = !options.deadline;
  const deadline = options.deadline ?? startWelfareChainDeadline(DEFAULT_WELFARE_CHAIN_DEADLINE_MS);
  try {
    const items = await Promise.all(
      routes.map(async (route): Promise<ChainedDetailItem> => {
        const outcome = await raceWelfareDeadline(deadline, () => invoker(route.detail_tool, route.detail_params));
        if (outcome.ok) {
          const wrapped = isChainRecord(outcome.value) && "data" in outcome.value;
          const unwrapped = wrapped ? outcome.value.data : outcome.value;
          const context = wrapped ? Object.fromEntries(Object.entries(outcome.value).filter(([key]) => key !== "data")) : undefined;
          return {
            id: route.id,
            entity_type: route.entity_type,
            tool: route.detail_tool,
            params: route.detail_params,
            status: "SUCCEEDED",
            detail: unwrapped,
            ...(context ? { context } : {}),
          };
        }
        if (outcome.timedOut) {
          return {
            id: route.id,
            entity_type: route.entity_type,
            tool: route.detail_tool,
            params: route.detail_params,
            status: "TIMED_OUT",
            recovery_hint: "시간 한도로 이 항목의 상세 응답이 지연되었습니다. " + route.detail_tool + "(" + JSON.stringify(route.detail_params) + ") 또는 fetch(id=" + JSON.stringify(route.id) + ")로 개별 조회해 주세요.",
          };
        }
        return {
          id: route.id,
          entity_type: route.entity_type,
          tool: route.detail_tool,
          params: route.detail_params,
          status: "ERROR",
          error: outcome.error ?? "상세 조회 실패",
          recovery_hint: "개별 도구 " + route.fallback_tool + "(" + JSON.stringify(route.fallback_params) + ")로 다시 확인하세요.",
        };
      }),
    );

    const succeededCount = items.filter((item) => item.status === "SUCCEEDED").length;
    const timedOutCount = items.filter((item) => item.status === "TIMED_OUT").length;
    const errorCount = items.filter((item) => item.status === "ERROR").length;
    const toolNames = [...new Set(routes.map((route) => route.detail_tool))].join("·");

    return {
      header: "자동 상세조회: search -> " + toolNames + " (상위 " + routes.length + "건 중 성공 " + succeededCount + "건)",
      requested_limit: limit,
      succeeded_count: succeededCount,
      timed_out_count: timedOutCount,
      error_count: errorCount,
      items,
    };
  } finally {
    if (ownDeadline) deadline.dispose();
  }
}

/**
 * 질문과 정제된 계획에서 가장 적합한 복합 리서치 작업(task)을 자동 판정한다(korean-law-mcp scenario-rules.ts 대응).
 */
export function detectWelfareResearchTask(query: string, plan: RefinedWelfareQuery): ResolvedWelfareResearchTask {
  if (plan.intents.includes("budget") || /예산|집행액|집행률|추경|본예산|재정|편성목|산출내역/.test(query)) {
    return "budget_track";
  }
  if (/통계|수급자\s*수|수급률|인구\s*현황|추이|시계열|노년부양비|기대수명|경상의료비/.test(query)) {
    return "statistics_trend";
  }
  if (/매뉴얼|사업안내|지침|원문\s*구간|몇\s*줄|쪽수/.test(query)) {
    return "manual_verify";
  }
  if (
    plan.region_id && plan.region_id !== "region:전국" &&
    (!plan.programs.length || /어떤\s*사업|목록|전부|비교/.test(query))
  ) {
    return "regional_compare";
  }
  if (
    plan.intents.includes("eligibility") ||
    plan.intents.includes("procedure") ||
    plan.intents.includes("benefit") ||
    /신청\s*(?:자격|조건|방법|서류|기간)|지원\s*(?:대상|금액|기준)|선정\s*기준|누가\s*받|어떻게\s*신청|얼마\s*받/.test(query)
  ) {
    return "eligibility_check";
  }
  return "full_research";
}

// ============================================================================
// 메타 도구 탐색(discover_tools) 및 실행(execute_tool): Korean Law MCP 패턴
// ============================================================================

export const WELFARE_TOOL_CATEGORIES: Readonly<Record<string, readonly McpToolName[]>> = {
  "복합리서치": ["welfare_research", "search", "get_welfare_context"],
  "통합검색": ["search", "fetch", "search_welfare_services", "find_programs"],
  "자격·신청조건": ["get_welfare_context", "get_eligibility", "get_program_public_info", "fetch"],
  "복지매뉴얼": ["search_manuals", "get_manual_section", "fetch"],
  "129상담FAQ": ["search_faq", "get_faq", "fetch"],
  "복지통계": ["search_statistics", "get_statistics_data", "get_statistics_sources"],
  "예산·재정": ["find_budget_projects", "get_budget_execution", "search_budget_lines", "get_budget_breakdown", "compare_budget_periods", "get_fiscal_catalog"],
  "돌봄기관·수요": ["find_care_institutions", "get_care_institution", "get_care_demand"],
  "보도자료": ["search_news", "get_news_metadata", "get_news_archive_status"],
  "개체·온톨로지·출처": ["get_entity", "get_relationships", "get_sources", "get_ontology_schema"],
  "시스템·연계상태": ["get_dataset_status", "get_integration_status"],
} as const;

export const WELFARE_TOOL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "복합리서치": ["종합조사", "원스톱", "자동체이닝", "툴체이닝", "한번에", "복합분석", "welfare_research"],
  "통합검색": ["제도검색", "복지검색", "복지제도100", "복지로", "시행사업", "메뉴판"],
  "자격·신청조건": ["지원대상", "선정기준", "신청방법", "구비서류", "제출서류", "지원금액", "수급자격", "정부24", "혜택"],
  "복지매뉴얼": ["사업안내", "업무매뉴얼", "지침서", "매뉴얼본문", "원문구간", "이어읽기"],
  "129상담FAQ": ["129", "보건복지상담센터", "자주하는질문", "질의응답", "상담사례"],
  "복지통계": ["통계표", "지표누리", "KOSIS", "인구통계", "고령인구", "수급자수", "시계열", "추이"],
  "예산·재정": ["지방재정365", "예산현액", "지출액", "집행률", "예산서", "산출근거", "부기", "편성목", "추경", "연도비교"],
  "돌봄기관·수요": ["장기요양기관", "방문요양", "주야간보호", "요양원", "돌봄수요", "협약의료기관"],
  "보도자료": ["뉴스", "프레스", "보도", "발행기관", "브리핑"],
  "개체·온톨로지·출처": ["온톨로지", "지식그래프", "1홉", "관계", "원문출처", "문서근거", "코드체계"],
  "시스템·연계상태": ["공개본", "기준일", "수집상태", "연계현황", "API상태"],
} as const;

export interface WelfareToolDescriptor {
  readonly name: McpToolName;
  readonly title: string;
  readonly description: string;
  readonly parameters: readonly string[];
  readonly inputSchema: () => Record<string, unknown>;
}

export function describeWelfareCallPath(listed: ReadonlySet<string>): string {
  const exposed = [...listed].filter((name) => PUBLIC_MCP_TOOL_NAMES.includes(name as McpToolName));
  if (exposed.length === 0) return "목록의 전문 도구는 execute_tool(tool_name, params)로 실행하세요.";
  const direct = exposed.join(", ") + "는 1-hop 노출 도구이므로 직접 호출하세요.";
  return exposed.length === listed.size
    ? direct
    : direct + " 나머지 전문 도구는 execute_tool(tool_name, params)로 실행하세요.";
}

const MAX_DISCOVERY_SECTIONS = 2;
const MAX_DISCOVERY_TOOLS = 4;

export function discoverWelfareTools(
  intent: string,
  catalog: ReadonlyMap<McpToolName, WelfareToolDescriptor>,
): {
  readonly intent: string;
  readonly law_status: "DISABLED" | "ENABLED";
  readonly care_status: "DISABLED" | "ENABLED";
  readonly exposed_tool_count: number;
  readonly executable_tool_count: number;
  readonly matched_categories: readonly {
    readonly category: string;
    readonly tier: number;
    readonly tools: readonly {
      readonly name: McpToolName;
      readonly title: string;
      readonly call_path: "direct" | "execute_tool";
      readonly parameters: readonly string[];
      readonly description: string;
      readonly inputSchema: Record<string, unknown>;
    }[];
  }[];
  readonly call_guidance: string;
  readonly text: string;
} {
  const raw = intent.trim();
  const lower = raw.toLowerCase();
  const tokens = lower.split(/[\s,;/|()]+/).filter((token) => token.length >= 2).slice(0, 30);
  const legalMentioned = /법령|법률|조문|시행령|시행규칙|조례|판례|헌재|행정심판|해석례|과태료\s*조항|legal_|search_law|get_law_text/.test(lower);
  const careMentioned = /돌봄\s*자원|돌봄\s*수요|장기요양기관|방문요양|주야간보호|find_care_institutions|get_care_institution|get_care_demand/.test(lower);

  const scored: { category: string; tier: number; score: number; tools: McpToolName[] }[] = [];
  for (const [category, toolNames] of Object.entries(WELFARE_TOOL_CATEGORIES)) {
    const available = toolNames.filter((name) => EXECUTABLE_MCP_TOOL_NAMES.includes(name) && catalog.has(name));
    if (!available.length) continue;

    let tier = 4;
    let score = 0;

    // Tier 0: 정확한 도구명 매칭
    if (available.some((name) => lower.includes(name))) {
      tier = Math.min(tier, 0);
      score += 100;
    }
    // Tier 1: 카테고리 별칭 매칭
    const aliases = WELFARE_TOOL_ALIASES[category] ?? [];
    for (const alias of aliases) {
      if (lower.includes(alias.toLowerCase()) || tokens.some((token) => alias.toLowerCase().includes(token))) {
        tier = Math.min(tier, 1);
        score += 35;
      }
    }
    // Tier 2: 카테고리 이름 매칭
    if (lower.includes(category.toLowerCase()) || tokens.some((token) => category.toLowerCase().includes(token))) {
      tier = Math.min(tier, 2);
      score += 25;
    }
    // Tier 3: 도구 제목·설명·파라미터 매칭
    for (const name of available) {
      const desc = catalog.get(name);
      if (!desc) continue;
      const hay = (desc.name + " " + desc.title + " " + desc.description + " " + desc.parameters.join(" ")).toLowerCase();
      for (const token of tokens) {
        if (hay.includes(token)) {
          tier = Math.min(tier, 3);
          score += 5;
        }
      }
    }

    if (score > 0 || !tokens.length) {
      scored.push({ category, tier: score > 0 ? tier : 3, score, tools: available });
    }
  }

  scored.sort((a, b) => a.tier - b.tier || b.score - a.score || a.category.localeCompare(b.category));
  const fallbackSections = Object.entries(WELFARE_TOOL_CATEGORIES)
    .map(([category, tools]) => ({
      category,
      tier: 3,
      score: 1,
      tools: tools.filter((name) => EXECUTABLE_MCP_TOOL_NAMES.includes(name) && catalog.has(name)),
    }))
    .filter((section) => section.tools.length > 0);
  const exactNames = new Set([...catalog.keys()].filter(name => lower.includes(name)));
  const bestTier = scored[0]?.tier;
  const selected = (scored.length ? scored.filter(section => section.tier === bestTier) : fallbackSections).slice(0, MAX_DISCOVERY_SECTIONS);

  const listedTools = new Set<string>();
  const matchedCategories = selected.map((section) => ({
    category: section.category,
    tier: section.tier,
    tools: section.tools.filter(name => exactNames.size === 0 || exactNames.has(name)).map(name => {
      const info = catalog.get(name);
      if (!info) return null;
      const score = tokens.reduce((total, token) => total + (info.title.toLowerCase().includes(token) ? 6 : 0) + (info.description.toLowerCase().includes(token) ? 2 : 0), 0);
      return { info, score };
    }).filter(item => item !== null).sort((a, b) => b.score - a.score).flatMap(({ info }) => {
      const name = info.name;
      if (listedTools.has(name) || listedTools.size >= MAX_DISCOVERY_TOOLS) return [];
      listedTools.add(name);
      const isDirect = PUBLIC_MCP_TOOL_NAMES.includes(name);
      return [{
        name,
        title: info.title,
        call_path: isDirect ? ("direct" as const) : ("execute_tool" as const),
        parameters: info.parameters,
        description: info.description,
        inputSchema: info.inputSchema(),
      }];
    }),
  })).filter(section => section.tools.length > 0);

  const guidance = describeWelfareCallPath(listedTools);
  const lines: string[] = [];
  if (legalMentioned && !LAW_MCP_PUBLIC) {
    lines.push("안내: " + LAW_MCP_WITHHELD_MESSAGE + " (법령 도구는 비활성 상태이며, 복지사업·매뉴얼·129 FAQ·통계·예산·보도자료 도구를 안내합니다.)");
  }
  if (careMentioned && !CARE_RESOURCES_MCP) {
    lines.push("안내: " + CARE_MCP_WITHHELD_MESSAGE + " (돌봄자원 도구는 비활성 상태이며, 복지사업·매뉴얼·129 FAQ·통계·예산·보도자료 도구를 안내합니다.)");
  }
  for (const section of matchedCategories) {
    lines.push("[" + section.category + "]");
    for (const tool of section.tools) {
      lines.push(tool.name);
    }
  }
  lines.push(guidance);

  return {
    intent: raw,
    law_status: LAW_MCP_PUBLIC ? "ENABLED" : "DISABLED",
    care_status: CARE_RESOURCES_MCP ? "ENABLED" : "DISABLED",
    exposed_tool_count: PUBLIC_MCP_TOOL_NAMES.length,
    executable_tool_count: EXECUTABLE_MCP_TOOL_NAMES.length,
    matched_categories: matchedCategories,
    call_guidance: guidance,
    text: lines.join("\n"),
  };
}

export function isBlockedLawTool(name: string): boolean {
  return !LAW_MCP_PUBLIC && LAW_MCP_TOOL_NAMES.has(name);
}

export function isBlockedCareTool(name: string): boolean {
  return !CARE_RESOURCES_MCP && CARE_TOOL_NAMES.has(name);
}

