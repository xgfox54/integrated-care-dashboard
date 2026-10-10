// korean-law-mcp v4.15.6의 공개 10개 도구를 대시보드 MCP에 직접 등록한다.
// 원본의 Express/stdio 전송부는 사용하지 않고, Cloudflare Worker용 MCP 전송부를 그대로 쓴다.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { LawApiClient } from "korean-law-mcp/lib/api-client";
import { ErrorCodes, LawApiError, formatToolError } from "korean-law-mcp/lib/errors";
import { truncateResponse } from "korean-law-mcp/lib/schemas";
import { maskToolText } from "korean-law-mcp/lib/tool-output";
import type { McpTool } from "korean-law-mcp/lib/types";
import { SearchLawSchema as UpstreamSearchLawSchema, searchLaw } from "korean-law-mcp/tools/search";
import { GetLawTextSchema as UpstreamGetLawTextSchema, getLawText } from "korean-law-mcp/tools/law-text";
import { GetAnnexesSchema as UpstreamGetAnnexesSchema, getAnnexes } from "korean-law-mcp/tools/annex";
import {
  GetDecisionTextSchema as UpstreamGetDecisionTextSchema,
  SearchDecisionsSchema as UpstreamSearchDecisionsSchema,
  getDecisionText,
  searchDecisions,
} from "korean-law-mcp/tools/unified-decisions";
import { OrdinanceRadarSchema as UpstreamOrdinanceRadarSchema, ordinanceRadar } from "korean-law-mcp/tools/ordinance-radar";
import { LegalResearchSchema as UpstreamLegalResearchSchema, legalResearch } from "korean-law-mcp/tools/legal-research";
import { LegalAnalysisSchema as UpstreamLegalAnalysisSchema, legalAnalysis } from "korean-law-mcp/tools/legal-analysis";
import {
  DiscoverToolsSchema as UpstreamDiscoverToolsSchema,
  ExecuteToolSchema as UpstreamExecuteToolSchema,
  discoverTools,
  executeTool,
  setAllToolsRef,
} from "korean-law-mcp/tools/meta-tools";

export const KOREAN_LAW_PACKAGE_VERSION = "4.15.6" as const;

export const LAW_TOOL_NAMES = [
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

export type LawToolName = (typeof LAW_TOOL_NAMES)[number];

/** 웹 화면에서 직접 호출할 수 있는 읽기 전용 도구. 메타 도구는 공개하지 않는다. */
export const LAW_WEB_TOOL_NAMES = [
  "legal_research",
  "legal_analysis",
  "search_law",
  "get_law_text",
  "get_annexes",
  "search_decisions",
  "get_decision_text",
  "ordinance_radar",
] as const;
export type LawWebToolName = (typeof LAW_WEB_TOOL_NAMES)[number];
const LAW_WEB_TOOL_SET: ReadonlySet<string> = new Set(LAW_WEB_TOOL_NAMES);

export function isLawWebToolName(value: unknown): value is LawWebToolName {
  return typeof value === "string" && LAW_WEB_TOOL_SET.has(value);
}

const DECISION_DOMAINS = [
  "precedent", "interpretation", "tax_tribunal", "customs", "nts", "constitutional",
  "admin_appeal", "ftc", "pipc", "nlrc", "acr", "appeal_review", "acr_special",
  "school", "public_corp", "public_inst", "treaty", "english_law",
] as const;

const RESEARCH_TASKS = [
  "full_research", "law_system", "action_basis", "dispute_prep", "amendment_track",
  "ordinance_compare", "procedure_detail", "document_review",
] as const;

const RESEARCH_SCENARIOS = [
  "delegation", "impact", "penalty", "timeline", "time_travel", "compliance",
  "customs", "action_plan", "manual",
] as const;

const ANALYSIS_MODES = ["verify_citations", "cite_check", "applicable_law", "impact_map"] as const;
const RESEARCH_DOMAINS = ["tax", "labor", "privacy", "competition", "general"] as const;
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const SECRET_KEYS = new Set(["apikey", "api_key", "authkey", "auth_key", "oc", "law_oc", "korean_law_api_key"]);
const MAX_META_PARAMS_CHARS = 50_000;

type LooseToolResponse = { readonly content: readonly { readonly type: string; readonly text: string }[]; readonly isError?: boolean };
type UpstreamSchema = { parse(input: unknown): unknown };
type UpstreamHandler = (client: LawApiClient, input: never) => Promise<LooseToolResponse>;

interface LawToolDefinition {
  readonly name: LawToolName;
  readonly title: string;
  readonly description: string;
  readonly publicShape: z.ZodRawShape;
  readonly upstreamSchema: UpstreamSchema;
  readonly handler: UpstreamHandler;
}

function serializableSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** 클라이언트가 전달한 키·OC는 무시한다. 서버의 LAW_OC 비밀값만 법제처에 보낸다. */
function stripSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1));
  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    clean[key] = stripSecrets(child, depth + 1);
  }
  return clean;
}

export interface LawApiEnvelopeFailure {
  readonly message: string;
  readonly suggestions: readonly string[];
}

function decodeXmlValue(value: string): string {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** 법제처가 HTTP 200으로 돌려주는 오류 봉투를 정상적인 0건 응답과 구분한다. */
export function detectLawApiEnvelopeFailure(text: string): LawApiEnvelopeFailure | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let result = "";
  let message = "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      result = typeof record.result === "string" ? record.result.trim() : "";
      message = typeof record.msg === "string" ? record.msg.trim() : "";
    }
  } catch {
    const readTag = (tag: "result" | "msg") => {
      const match = trimmed.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return match ? decodeXmlValue(match[1]) : "";
    };
    result = readTag("result");
    message = readTag("msg");
  }

  if (!result && !message) return null;
  const combined = `${result} ${message}`;
  if (/사용자\s*정보\s*검증.*실패|정확한\s*서버장비|IP주소.*도메인주소.*등록/u.test(combined)) {
    return {
      message: "법제처 OPEN API 사용자 검증에 실패했습니다. 법제처 활용 신청 정보에 실제 운영 서버의 IP 주소 또는 도메인을 등록해야 합니다.",
      suggestions: [
        "법제처 OPEN API 활용 신청 정보에 운영 도메인과 서버 출발 IP의 등록 상태를 확인하세요.",
        "등록 정보가 반영된 뒤 실제 운영 서버에서 다시 호출하세요.",
      ],
    };
  }
  if (/실패|오류|유효하지|인증|검증|등록/u.test(combined)) {
    return {
      message: "법제처 OPEN API가 정상 데이터 대신 오류 응답을 반환했습니다.",
      suggestions: ["법제처 OPEN API 활용 신청, 인증 정보와 호출 제한 상태를 확인하세요."],
    };
  }
  return null;
}

/**
 * v4.15.6의 private readBody는 런타임에서는 일반 프로토타입 메서드다.
 * 버전을 고정한 상태에서 응답 판독 직후 오류 봉투 검사를 삽입해 NOT_FOUND 오인을 막는다.
 */
function createLawApiClient(apiKey: string): LawApiClient {
  const client = new LawApiClient({ apiKey });
  const originalReadBody = Reflect.get(client, "readBody");
  if (typeof originalReadBody !== "function") {
    throw new Error("korean-law-mcp 응답 판독기를 찾지 못했습니다. 고정 버전 호환성을 확인하세요.");
  }
  Reflect.set(client, "readBody", async (...args: unknown[]) => {
    const text = await (Reflect.apply(originalReadBody, client, args) as Promise<string>);
    const failure = detectLawApiEnvelopeFailure(text);
    if (failure) {
      throw new LawApiError(failure.message, ErrorCodes.API_ERROR, [...failure.suggestions]);
    }
    return text;
  });
  return client;
}

function publicText(value: LooseToolResponse, args: unknown): { content: { type: "text"; text: string }[]; isError?: boolean } {
  const joined = value.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  const text = truncateResponse(maskToolText(joined, args as Record<string, unknown>));
  return { content: [{ type: "text", text }], ...(value.isError ? { isError: true } : {}) };
}

const query = z.string().trim().min(1).max(2_000);
const short = z.string().trim().min(1).max(100);
const identifier = z.string().trim().min(1).max(300);
const optionsRecord = z.record(z.unknown()).optional();

const DEFINITIONS: readonly LawToolDefinition[] = [
  {
    name: "legal_research",
    title: "법령 종합 리서치",
    description: "자연어 법률 질문을 법체계·처분근거·불복준비·개정추적·조례비교·처리절차·문서검토 유형으로 분석합니다. 법적 판단은 국가법령정보센터 원문으로 최종 확인해야 합니다.",
    publicShape: {
      query: query.optional().describe("자연어 질문·법령명·키워드. document_review 외 유형에서 필수"),
      task: z.enum(RESEARCH_TASKS).optional().default("full_research"),
      scenario: z.enum(RESEARCH_SCENARIOS).optional(),
      domain: z.enum(RESEARCH_DOMAINS).optional(),
      articles: z.array(short).max(20).optional(),
      parentLaw: query.optional(),
      mst: identifier.optional(),
      lawId: identifier.optional(),
      fromDate: z.string().regex(/^\d{8}$/).optional(),
      toDate: z.string().regex(/^\d{8}$/).optional(),
      includeHistory: z.boolean().optional(),
      text: z.string().max(50_000).optional(),
      maxClauses: z.number().int().min(1).max(30).optional(),
    },
    upstreamSchema: UpstreamLegalResearchSchema,
    handler: legalResearch as UpstreamHandler,
  },
  {
    name: "legal_analysis",
    title: "법령 정밀 분석",
    description: "법령·판례 인용의 실존 여부, 판례의 후속 인용, 사건 시점 적용법, 특정 조문의 영향 관계를 검증합니다.",
    publicShape: {
      mode: z.enum(ANALYSIS_MODES),
      text: z.string().max(50_000).optional(),
      caseNumber: query.optional(),
      lawName: query.optional(),
      jo: short.optional(),
      date: z.string().trim().min(8).max(10).optional(),
      maxCitations: z.number().int().min(1).max(30).optional(),
      display: z.number().int().min(1).max(50).optional(),
      deepScan: z.boolean().optional(),
      includeOrdinances: z.boolean().optional(),
      includeMermaid: z.boolean().optional(),
    },
    upstreamSchema: UpstreamLegalAnalysisSchema,
    handler: legalAnalysis as UpstreamHandler,
  },
  {
    name: "search_law",
    title: "법령·자치법규·행정규칙 검색",
    description: "법령명 키워드로 현행 법령을 찾고 lawId·MST·시행일을 반환합니다. 결과가 없으면 자치법규와 행정규칙도 확인합니다.",
    publicShape: {
      query: query.describe("검색할 법령명"),
      display: z.number().int().min(1).max(100).optional().default(50),
    },
    upstreamSchema: UpstreamSearchLawSchema,
    handler: searchLaw as UpstreamHandler,
  },
  {
    name: "get_law_text",
    title: "법령 조문 본문 조회",
    description: "search_law에서 받은 MST 또는 lawId로 법령 전문이나 특정 조문을 조회합니다. efYd를 주면 해당 시점에 시행 중이던 버전을 찾습니다.",
    publicShape: {
      mst: identifier.optional(),
      lawId: identifier.optional(),
      jo: short.optional(),
      efYd: z.string().regex(/^\d{8}$/).optional(),
    },
    upstreamSchema: UpstreamGetLawTextSchema,
    handler: getLawText as UpstreamHandler,
  },
  {
    name: "get_annexes",
    title: "법령 별표·서식 조회",
    description: "법령의 별표·서식 목록을 찾고 번호나 명칭으로 좁혀 본문을 추출합니다. 기준일을 주면 당시 시행본을 조회합니다.",
    publicShape: {
      lawName: query,
      knd: z.enum(["1", "2", "3", "4", "5"] as const).optional(),
      bylSeq: short.optional(),
      annexNo: short.optional(),
      query: query.optional(),
      jo: short.optional(),
      date: z.string().trim().min(8).max(10).optional(),
    },
    upstreamSchema: UpstreamGetAnnexesSchema,
    handler: getAnnexes as UpstreamHandler,
  },
  {
    name: "search_decisions",
    title: "판례·해석례·결정례 통합 검색",
    description: "판례, 법령해석례, 행정심판, 헌재, 조세·관세, 위원회 결정례 등 18개 도메인을 검색합니다. 판례는 options.search='both'로 판례명과 본문을 함께 검색할 수 있습니다.",
    publicShape: {
      domain: z.enum(DECISION_DOMAINS),
      query: query.optional(),
      display: z.number().int().min(1).max(100).optional().default(20),
      page: z.number().int().min(1).max(1_000).optional().default(1),
      sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"] as const).optional(),
      options: optionsRecord,
    },
    upstreamSchema: UpstreamSearchDecisionsSchema,
    handler: searchDecisions as UpstreamHandler,
  },
  {
    name: "get_decision_text",
    title: "판례·해석례·결정례 본문 조회",
    description: "search_decisions 결과의 도메인과 ID로 결정례 본문을 조회합니다. full=true일 때 전문을 반환합니다.",
    publicShape: {
      domain: z.enum(DECISION_DOMAINS),
      id: identifier,
      full: z.boolean().optional(),
      options: optionsRecord,
    },
    upstreamSchema: UpstreamGetDecisionTextSchema,
    handler: getDecisionText as UpstreamHandler,
  },
  {
    name: "ordinance_radar",
    title: "조례 정비 레이더",
    description: "조례가 인용한 상위법을 추출하고 상위법 개정일과 조례 시행일을 대조해 정비 검토 대상을 표시합니다.",
    publicShape: {
      ordinSeq: identifier.optional(),
      id: identifier.optional(),
      ordinanceName: query.optional(),
      query: query.optional(),
    },
    upstreamSchema: UpstreamOrdinanceRadarSchema,
    handler: ordinanceRadar as UpstreamHandler,
  },
  {
    name: "discover_tools",
    title: "법령 도구 찾기",
    description: "질문 의도나 법률 분야에 맞는 대시보드 내 법령 도구를 안내합니다.",
    publicShape: { intent: query },
    upstreamSchema: UpstreamDiscoverToolsSchema,
    handler: discoverTools as UpstreamHandler,
  },
  {
    name: "execute_tool",
    title: "법령 도구 실행",
    description: "discover_tools에서 확인한 법령 도구를 이름과 파라미터로 실행합니다. 메타 도구 자체는 재귀 실행할 수 없습니다.",
    publicShape: {
      tool_name: z.string().trim().min(1).max(100),
      params: z.record(z.unknown()).refine((value) => serializableSize(value) <= MAX_META_PARAMS_CHARS, "params가 너무 큽니다."),
    },
    upstreamSchema: UpstreamExecuteToolSchema,
    handler: executeTool as UpstreamHandler,
  },
] as const;

/** execute_tool이 직접 실행할 수 있는 도구. 메타 도구는 재귀 방지를 위해 제외한다. */
const EXECUTABLE_TOOL_INDEX: McpTool[] = DEFINITIONS
  .filter((definition) => definition.name !== "discover_tools" && definition.name !== "execute_tool")
  .map((definition) => ({
    name: definition.name,
    description: definition.description,
    schema: definition.upstreamSchema as McpTool["schema"],
    handler: definition.handler as McpTool["handler"],
  }));

const DEFINITION_BY_NAME: ReadonlyMap<LawToolName, LawToolDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.name, definition]),
);

export interface RegisterLawToolsOptions {
  readonly apiKey?: string;
  readonly onUnexpectedError?: (error: unknown, tool: string) => void;
}

/** MCP와 웹 API가 공유하는 단일 실행 경로. 입력 비밀값 제거 → 원본 스키마 재검증 → 결과 마스킹 순서를 고정한다. */
export async function runLawTool(
  name: LawToolName,
  rawArgs: unknown,
  options: RegisterLawToolsOptions = {},
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const definition = DEFINITION_BY_NAME.get(name);
  if (!definition) {
    return { content: [{ type: "text", text: `지원하지 않는 법령 도구입니다: ${name}` }], isError: true };
  }
  const args = stripSecrets(rawArgs);
  const client = createLawApiClient(options.apiKey?.trim() ?? "");
  // execute_tool·discover_tools가 같은 런타임에 이식된 공개 핵심 도구만 다루게 한다.
  setAllToolsRef(EXECUTABLE_TOOL_INDEX);
  try {
    const parsed = definition.upstreamSchema.parse(args);
    const result = await definition.handler(client, parsed as never);
    return publicText(result, args);
  } catch (error) {
    // 일반적인 입력 오류·법제처 장애는 도구 결과로 반환한다. 예상 밖 비-Error 값만 안전한 일반 오류로 기록한다.
    if (!(error instanceof Error)) options.onUnexpectedError?.(new Error("법령 도구에서 알 수 없는 오류가 발생했습니다."), name);
    return publicText(formatToolError(error, name) as LooseToolResponse, args);
  }
}

export function registerLawTools(server: McpServer, options: RegisterLawToolsOptions = {}): LawToolName[] {
  const registered: LawToolName[] = [];
  for (const definition of DEFINITIONS) {
    server.registerTool(definition.name, {
      title: definition.title,
      description: `Korean-law-mcp v${KOREAN_LAW_PACKAGE_VERSION} 내장형 — ${definition.description}`,
      inputSchema: definition.publicShape,
      annotations: { title: definition.title, ...READ_ONLY_ANNOTATIONS },
    }, ((rawArgs: Record<string, unknown>) => runLawTool(definition.name, rawArgs, options)) as never);
    registered.push(definition.name);
  }
  return registered;
}
