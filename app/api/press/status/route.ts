import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { memoizeForTtl } from "@/lib/memo";
import { readPressCoverage } from "@/lib/press/coverage";

export const dynamic = "force-dynamic";

type Coverage = Awaited<ReturnType<typeof readPressCoverage>>;

// 복지뉴스 화면은 누적 건수·최근 게시·기관 수와 기관별 승인 상태만 쓴다. 수집처별 보유창·스케줄러 세부는 빼고
// 서버 인스턴스마다 1분 동안 기억해, 화면을 열 때마다 전체 수집 현황(약 130KB, 1~2초)을 다시 계산하지 않는다.
function publicView(coverage: Coverage) {
  return {
    targets: coverage.targets,
    coverage: { approved_active_sources: coverage.coverage.approved_active_sources, normal_organizations_24h: coverage.coverage.normal_organizations_24h },
    items: coverage.items,
    survey: coverage.survey,
    schedule: { note: coverage.schedule.note },
    sources: coverage.sources.map((source) => ({ organization_id: source.organization_id, organization_name: source.organization_name, approval_status: source.approval_status })),
  };
}

// 서버 인스턴스가 여럿이라 메모리 기억만으로는 새 방문자가 대부분 다시 계산한다. 계산한 공개용 현황을 app_setting에 2분 동안 둔다.
const STORED_KEY = "press_status_public";
const STORED_FRESH_SECONDS = 120;

async function readStoredPublicCoverage() {
  const db = getD1();
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare("SELECT value, updated_at FROM app_setting WHERE key = ?").bind(STORED_KEY).first<{ value: string; updated_at: number }>().catch(() => null);
  if (row && now - row.updated_at <= STORED_FRESH_SECONDS) return JSON.parse(row.value) as ReturnType<typeof publicView>;
  const value = publicView(await readPressCoverage(db, now));
  await db.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(STORED_KEY, JSON.stringify(value), now).run().catch(() => undefined);
  return value;
}

const readPublicCoverage = memoizeForTtl(readStoredPublicCoverage, 60_000);

export async function GET(request: Request): Promise<Response> {
  try {
    if (new URL(request.url).searchParams.get("view") === "public") {
      return Response.json(await readPublicCoverage(), { headers: { "cache-control": "public, max-age=60" } });
    }
    return Response.json(await readPressCoverage(getD1(), Math.floor(Date.now() / 1000)), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_STATUS_FAILED", message: "수집 현황을 읽지 못했습니다.", status: 500, path: "/api/press/status" });
  }
}
