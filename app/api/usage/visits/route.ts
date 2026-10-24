import { getD1 } from "@/lib/d1";
import { readVisitSummary } from "@/lib/usage/visits";

export const dynamic = "force-dynamic";

// 방문자를 구분하는 ID를 만들지 않으므로(이용통계 수집 안내) 「누적 방문자 수」는 사이트를 새로 연 횟수의 합계다.
// 같은 사람이 다시 와도 한 번 더 센다. 사이트 안에서 메뉴를 옮겨 다닌 것은 세지 않는다.
export async function GET(): Promise<Response> {
  const summary = await readVisitSummary(getD1());
  return Response.json(
    summary,
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
