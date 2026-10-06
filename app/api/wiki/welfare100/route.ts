import { withSharedCache } from "@/lib/edge-cache";
import { errorResponse } from "@/lib/errors";
import { hasOnlyUniqueQueryKeys } from "@/lib/query-boundary";
import { readWelfareRegistry } from "@/lib/usage/registry";
import { indexWelfareByName, pickWelfareLink, type WelfareLinkCandidate } from "@/lib/welfare100/wiki-link";

export const dynamic = "force-dynamic";

const KEYS = ["name", "sido", "sigungu", "type"] as const;
let indexPromise: Promise<Map<string, WelfareLinkCandidate[]>> | null = null;

function readIndex() {
  indexPromise ??= readWelfareRegistry()
    .then((registry) => indexWelfareByName(registry.entries.values()))
    .catch((error: unknown) => {
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}

/** 통합돌봄 WIKI 사업과 이름·지역이 같은 복지제도100 제도(없으면 null). */
export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, async () => {
    const params = new URL(request.url).searchParams;
    const value = (key: string) => (params.get(key) ?? "").trim();
    const program = { name: value("name"), sido: value("sido"), sigungu: value("sigungu"), type: value("type") };
    if (!hasOnlyUniqueQueryKeys(params, KEYS) || !program.name || program.name.length > 120 || program.sido.length > 40 || program.sigungu.length > 40 || program.type.length > 20) {
      return Response.json({ message: "조회 조건이 올바르지 않습니다." }, { status: 400, headers: { "cache-control": "no-store" } });
    }
    try {
      const match = pickWelfareLink(await readIndex(), program);
      return Response.json(
        { match: match ? { slug: match.slug, name: match.name } : null },
        { headers: { "cache-control": "public, max-age=900, s-maxage=3600" } },
      );
    } catch (error) {
      return errorResponse(error, { code: "WIKI_WELFARE100_FAILED", message: "복지제도100 연결을 확인하지 못했습니다.", status: 500, path: "/api/wiki/welfare100" });
    }
  });
}
