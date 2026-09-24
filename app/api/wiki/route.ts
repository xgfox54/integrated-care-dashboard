import { withSharedCache } from "@/lib/edge-cache";
import { createWikiHandler } from "@/lib/wiki-handler";

export const dynamic = "force-dynamic";

const handler = createWikiHandler();

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => handler(request));
}
