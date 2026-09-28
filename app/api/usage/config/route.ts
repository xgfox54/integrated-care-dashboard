import { USAGE_POLICY_VERSION, USAGE_SCHEMA_VERSION } from "@/lib/usage/codes";
import { readUsageEnabled } from "@/lib/usage/settings";

export const dynamic = "force-dynamic";

/** 공개 화면이 수집기를 불러올지 정하는 값. 수집이 꺼져 있으면 공개 화면은 아무것도 보내지 않는다. */
export async function GET(): Promise<Response> {
  const enabled = await readUsageEnabled();
  return Response.json(
    { enabled, policy: USAGE_POLICY_VERSION, schema: USAGE_SCHEMA_VERSION },
    { headers: { "cache-control": "private, max-age=60" } },
  );
}
