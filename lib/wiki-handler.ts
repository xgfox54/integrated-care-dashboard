import {
  findBokjiroExplanation,
  findBundledBokjiroExplanation,
  type BokjiroWikiSource,
} from "./bokjiro.ts";
import { logServerError } from "./errors.ts";
import { hasOnlyUniqueQueryKeys } from "./query-boundary.ts";
import { REGION_DEFINITIONS } from "./region-statistics.ts";
import { resolveFallbackKnowledge } from "./wiki-knowledge.ts";

type PrimaryLookup = (name: string, region: string) => Promise<BokjiroWikiSource | null>;

interface WikiHandlerDependencies {
  readonly findPrimary: PrimaryLookup;
  readonly logPrimaryFailure: (message: string) => void;
}

const DEFAULT_DEPENDENCIES: WikiHandlerDependencies = {
  findPrimary: findBokjiroExplanation,
  logPrimaryFailure: (message) => {
    logServerError(message, { path: "/api/wiki", status: 502, code: "WIKI_PRIMARY_FAILED" });
  },
};

const CACHE_HEADERS = {
  "cache-control": "public, max-age=900, s-maxage=3600",
} as const;
const WIKI_KEYS = ["name", "sido", "sigungu"] as const;
const ALLOWED_SIDO = new Set<string>(REGION_DEFINITIONS.flatMap((region) => [...region.aliases]));

function wikiRequest(url: URL): { readonly name: string; readonly sido: string; readonly sigungu: string } | null {
  if (!hasOnlyUniqueQueryKeys(url.searchParams, WIKI_KEYS)) return null;
  const name = (url.searchParams.get("name") ?? "").trim();
  const sido = (url.searchParams.get("sido") ?? "").trim();
  const sigungu = (url.searchParams.get("sigungu") ?? "").trim();
  if (!name || name.length > 120 || sido.length > 40 || sigungu.length > 40) return null;
  if ((sido && !ALLOWED_SIDO.has(sido)) || (sigungu && !sido)) return null;
  return { name, sido, sigungu };
}

function sourceResponse(source: BokjiroWikiSource | ReturnType<typeof resolveFallbackKnowledge>): Response {
  return Response.json(
    { source, checkedAt: new Date().toISOString() },
    { headers: CACHE_HEADERS },
  );
}

export function createWikiHandler(dependencies: WikiHandlerDependencies = DEFAULT_DEPENDENCIES) {
  return async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parsed = wikiRequest(url);
    if (!parsed) {
      return Response.json(
        { message: "설명 조회 조건이 올바르지 않습니다." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const { name, sido, sigungu } = parsed;

    try {
      const primary = await dependencies.findPrimary(name, `${sido} ${sigungu}`.trim());
      if (primary) return sourceResponse(primary);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      dependencies.logPrimaryFailure(`복지로 WIKI 조회 실패: ${error.name}: ${error.message}`);
    }

    const bundledPrimary = findBundledBokjiroExplanation(name);
    if (bundledPrimary) return sourceResponse(bundledPrimary);
    return sourceResponse(resolveFallbackKnowledge(name));
  };
}
