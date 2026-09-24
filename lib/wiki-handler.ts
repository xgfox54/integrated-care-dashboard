import {
  findBokjiroExplanation,
  findBundledBokjiroExplanation,
  type BokjiroWikiSource,
} from "./bokjiro.ts";
import { resolveFallbackKnowledge } from "./wiki-knowledge.ts";

type PrimaryLookup = (name: string, region: string) => Promise<BokjiroWikiSource | null>;

interface WikiHandlerDependencies {
  readonly findPrimary: PrimaryLookup;
  readonly logPrimaryFailure: (message: string) => void;
}

const DEFAULT_DEPENDENCIES: WikiHandlerDependencies = {
  findPrimary: findBokjiroExplanation,
  logPrimaryFailure: (message) => console.warn(message),
};

const CACHE_HEADERS = {
  "cache-control": "public, max-age=900, s-maxage=3600",
} as const;

function parameter(url: URL, name: string, maxLength: number): string {
  return (url.searchParams.get(name) ?? "").trim().slice(0, maxLength);
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
    const name = parameter(url, "name", 120);
    const sido = parameter(url, "sido", 40);
    const sigungu = parameter(url, "sigungu", 40);
    if (!name) {
      return Response.json({ message: "사업명이 필요합니다." }, { status: 400 });
    }

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
