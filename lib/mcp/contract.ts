// 공개 원격 MCP의 공통 계약: 도구 허용목록, 응답 봉투(schema 2.0), 커서, 안전한 오류.
// 복지 도구는 저장된 공개 자료를 읽고, 법령 도구는 공식 OPEN API만 읽는다. 쓰기·임의 URL/SQL은 실행하지 않는다.

import { CARE_MCP_WITHHELD_MESSAGE, CARE_RESOURCES_MCP, CARE_TOOL_NAMES } from "../integrations/care-hold.ts";
export { CARE_MCP_WITHHELD_MESSAGE, CARE_RESOURCES_MCP, CARE_TOOL_NAMES };

export const MCP_SCHEMA_VERSION = "2.0";
// 공식 명칭(운영자 지정 2026-10-04). serverInfo.name과 표시용 title에 같은 이름을 쓴다.
export const MCP_SERVER_NAME = "Korean Welfare MCP";
export const MCP_SERVER_VERSION = "1.14.0";
export const LAW_MCP_PUBLIC: boolean = false;
export const LAW_MCP_WITHHELD_MESSAGE = "법령정보 기능은 현재 MCP에서 제공하지 않습니다. 법령 데이터는 관리자 저장소에 보존되어 있습니다.";
export const LAW_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(["legal_research", "legal_analysis", "search_law", "get_law_text", "get_annexes", "search_decisions", "get_decision_text", "ordinance_radar"]);
export const META_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(["discover_tools", "execute_tool"]);

/** 전체 도구 목록은 보존하고 공개 허용목록에서 법령 제공 중지를 적용한다. */
export const MCP_TOOL_NAMES = [
  "welfare_research",
  "search",
  "search_welfare_services",
  "fetch",
  "find_programs",
  "get_entity",
  "get_relationships",
  "get_eligibility",
  "get_sources",
  "get_dataset_status",
  "get_ontology_schema",
  "search_manuals",
  "get_manual_section",
  "search_faq",
  "get_faq",
  "search_statistics",
  "get_statistics_data",
  "get_statistics_sources",
  "get_fiscal_catalog",
  "find_budget_projects",
  "get_budget_execution",
  "compare_budget_periods",
  "search_budget_lines",
  "get_budget_breakdown",
  "search_news",
  "get_news_metadata",
  "get_news_archive_status",
  "get_welfare_context",
  // 외부 데이터 연계(2026-10-05): lib/mcp/integration-tools.ts
  "get_integration_status",
  "get_care_demand",
  "find_care_institutions",
  "get_care_institution",
  "get_program_public_info",
  // 동일 Worker에 내장한 korean-law-mcp 4.15.6 공개 도구. 외부 MCP 서버는 호출하지 않는다.
  "legal_research",
  "legal_analysis",
  "search_law",
  "get_law_text",
  "get_annexes",
  "search_decisions",
  "get_decision_text",
  "ordinance_radar",
  "discover_tools",
  "execute_tool",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

// 운영자 재활성화 지시(2026-10-09). API 금액은 공식 화면 단위 대조를 통과한 범위만 제공하고,
// 승인된 예산서는 독립 원천으로 제공한다. MCP 입력으로 검증·활성 revision 조건을 해제할 수 없다.
export const FISCAL_MCP_PUBLIC: boolean = true;
export const FISCAL_TOOL_NAMES: ReadonlySet<string> = new Set(["get_fiscal_catalog", "find_budget_projects", "get_budget_execution", "compare_budget_periods", "search_budget_lines", "get_budget_breakdown"]);
export const FISCAL_WITHHELD_MESSAGE = "예산·재정 정보는 정확도 검증이 끝날 때까지 이 MCP에서 제공하지 않습니다. 다른 자료로 예산을 추정하지 마세요.";

/**
 * ListTools로 1-hop 직접 노출하는 핵심 도구(Korean Law MCP의 V3_EXPOSED 패턴).
 * 나머지 전문 도구는 discover_tools로 탐색하고 execute_tool(또는 이름을 알면 직접 tools/call)로 실행한다.
 */
export const EXPOSED_WELFARE_TOOL_NAMES = [
  "welfare_research",
  "search",
  "fetch",
  "get_welfare_context",
  "search_welfare_services",
  "find_programs",
  "search_manuals",
  "search_faq",
  "search_statistics",
  "get_statistics_data",
  "find_budget_projects",
  "get_budget_execution",
  "search_budget_lines",
  "get_dataset_status",
  "discover_tools",
  "execute_tool",
] as const satisfies readonly McpToolName[];

const EXPOSED_WELFARE_TOOL_SET: ReadonlySet<string> = new Set(EXPOSED_WELFARE_TOOL_NAMES);

/** 현재 게이트 상태에서 실행 가능한 전체 복지·메타 도구(35개). */
export const EXECUTABLE_MCP_TOOL_NAMES: readonly McpToolName[] = MCP_TOOL_NAMES.filter((name) => (LAW_MCP_PUBLIC || !LAW_MCP_TOOL_NAMES.has(name)) && (CARE_RESOURCES_MCP || !CARE_TOOL_NAMES.has(name)) && (FISCAL_MCP_PUBLIC || !FISCAL_TOOL_NAMES.has(name)));

/** 지금 공개 MCP의 tools/list에 노출하는 1-hop 핵심 도구(17개). */
export const PUBLIC_MCP_TOOL_NAMES: readonly McpToolName[] = EXECUTABLE_MCP_TOOL_NAMES.filter((name) => EXPOSED_WELFARE_TOOL_SET.has(name) || (LAW_MCP_PUBLIC && LAW_MCP_TOOL_NAMES.has(name)));

/** tools/list에는 숨기되 discover_tools와 execute_tool(및 직접 tools/call)로 실행 가능한 전문 도구(18개). */
export const SPECIALIZED_MCP_TOOL_NAMES: readonly McpToolName[] = EXECUTABLE_MCP_TOOL_NAMES.filter((name) => !PUBLIC_MCP_TOOL_NAMES.includes(name));

export const LIMITS = {
  listDefault: 20,
  listMax: 50,
  searchResults: 10,
  newsContextDefault: 5,
  newsContextMax: 20,
  fiscalIdsMax: 50,
  queryMax: 100,
  questionMax: 2000,
  idMax: 500,
  arrayMax: 10,
} as const;

export interface BundleComponents {
  readonly knowledge: string | null;
  readonly fiscal: string | null;
  readonly news: string | null;
  readonly links: string | null;
  /** 승인 반입된 문서 사실(HWP/HWPX). 없으면 null. */
  readonly documents: string | null;
  /** 재정 API와 독립된 승인·활성 예산서 구성요소. */
  readonly budget_documents: string | null;
  /** 고정 커밋에서 반입 완료한 매뉴얼 전문 검색 구성요소. */
  readonly manuals: string | null;
}

export interface Basis {
  readonly requested_reference_date: string | null;
  readonly effective_reference_date: string | null;
  readonly news_date_basis: string | null;
}

export interface Coverage {
  readonly scope: string;
  readonly complete: boolean;
  readonly gaps: readonly string[];
  readonly [key: string]: unknown;
}

export interface Envelope<T = unknown> {
  readonly schema_version: string;
  readonly release_bundle_id: string;
  readonly components: BundleComponents;
  readonly generated_at: string;
  readonly data: T;
  readonly evidence: readonly unknown[];
  readonly basis: Basis;
  readonly coverage: Coverage;
  readonly warnings: readonly string[];
  readonly next_cursor: string | null;
  readonly truncated: boolean;
}

/** 도구가 사용자에게 돌려줄 수 있는 업무 오류. 메시지는 내부 정보 없이 이용자에게 보여 줄 문장이다. */
export class McpToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

export const EMPTY_BASIS: Basis = { requested_reference_date: null, effective_reference_date: null, news_date_basis: null };

/** 짧은 FNV-1a 해시. 커서가 다른 조회 조건이나 다른 공개본에 재사용되지 않게 묶는 데만 쓴다. */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

export function encodeCursor(offset: number, bound: string): string {
  return toBase64Url(JSON.stringify({ o: offset, f: bound }));
}

/** 커서를 풀어 offset을 돌려준다. 조건·공개본이 바뀐 커서는 오래된 커서로 거절한다. */
export function decodeCursor(cursor: string | undefined, bound: string): number {
  if (!cursor) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw new McpToolError("CURSOR_INVALID", "커서 형식이 올바르지 않습니다. 첫 페이지부터 다시 조회해 주세요.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new McpToolError("CURSOR_INVALID", "커서 형식이 올바르지 않습니다. 첫 페이지부터 다시 조회해 주세요.");
  }
  const { o, f } = parsed as { o?: unknown; f?: unknown };
  if (typeof o !== "number" || !Number.isInteger(o) || o < 0 || o > 100_000 || typeof f !== "string") {
    throw new McpToolError("CURSOR_INVALID", "커서 형식이 올바르지 않습니다. 첫 페이지부터 다시 조회해 주세요.");
  }
  if (f !== bound) {
    throw new McpToolError("CURSOR_STALE", "조회 조건이나 공개 자료가 바뀌어 이 커서를 쓸 수 없습니다. 첫 페이지부터 다시 조회해 주세요.");
  }
  return o;
}

export function pageLimit(limit: number | undefined, fallback: number = LIMITS.listDefault, maximum: number = LIMITS.listMax): number {
  if (limit === undefined) return fallback;
  return Math.min(Math.max(1, Math.trunc(limit)), maximum);
}
