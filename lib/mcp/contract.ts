// 공개 원격 MCP의 공통 계약: 도구 허용목록, 응답 봉투(schema 2.0), 커서, 안전한 오류.
// 모든 도구는 저장된 공개 자료만 읽고, 외부 수집·쓰기·임의 URL/SQL을 실행하지 않는다.

import { CARE_RESOURCES_PUBLIC, CARE_TOOL_NAMES } from "../integrations/care-hold.ts";

export const MCP_SCHEMA_VERSION = "2.0";
// 공식 명칭(운영자 지정 2026-10-04). serverInfo.name과 표시용 title에 같은 이름을 쓴다.
export const MCP_SERVER_NAME = "Korean Welfare MCP";
export const MCP_SERVER_VERSION = "1.1.0";

/** 공개 도구 32개(복지 22개 + 내장 법령 10개)의 명시적 허용목록. 여기 없는 이름은 등록하지 않는다. */
export const MCP_TOOL_NAMES = [
  "search",
  "fetch",
  "find_programs",
  "get_entity",
  "get_relationships",
  "get_eligibility",
  "get_sources",
  "get_dataset_status",
  "get_ontology_schema",
  "get_fiscal_catalog",
  "find_budget_projects",
  "get_budget_execution",
  "compare_budget_periods",
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
  // 내장 법령 조회(korean-law-mcp 4.15.6, 외부 MCP 서버에 연결하지 않음)
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

// 예산·재정 자료 MCP 제외(2026-10-06 운영자 지시): 부서 분리·신설이 예산에 반영되지 않는 등 아직 정확하지 않은 부분이 많다.
// 공개 /mcp에는 재정 도구 4개와 다른 도구 응답 속 예산 항목을 내보내지 않는다. 다시 열 때는 FISCAL_MCP_PUBLIC을 true로 바꾼다.
// 사이트 안의 위키 화면은 같은 도구를 내부 호출(includeFiscal)로 써서 검토된 예산사업 연결을 계속 보여 준다.
export const FISCAL_MCP_PUBLIC: boolean = false;
export const FISCAL_TOOL_NAMES: ReadonlySet<string> = new Set(["get_fiscal_catalog", "find_budget_projects", "get_budget_execution", "compare_budget_periods"]);
export const FISCAL_WITHHELD_MESSAGE = "예산·재정 정보는 정확도 검증이 끝날 때까지 이 MCP에서 제공하지 않습니다. 다른 자료로 예산을 추정하지 마세요.";

/** 지금 공개 MCP에 실제로 등록하는 도구. 돌봄자원 보류(lib/integrations/care-hold.ts)와 예산 제외 동안 해당 도구는 빠진다. */
export const PUBLIC_MCP_TOOL_NAMES: readonly McpToolName[] = MCP_TOOL_NAMES.filter((name) => (CARE_RESOURCES_PUBLIC || !CARE_TOOL_NAMES.has(name)) && (FISCAL_MCP_PUBLIC || !FISCAL_TOOL_NAMES.has(name)));

export const LIMITS = {
  listDefault: 20,
  listMax: 50,
  searchResults: 10,
  newsContextDefault: 5,
  newsContextMax: 20,
  fiscalIdsMax: 50,
  queryMax: 100,
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
