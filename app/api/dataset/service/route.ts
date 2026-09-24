import { createDatasetServiceHandler } from "@/lib/dataset-service-handler";
import { withSharedCache } from "@/lib/edge-cache";

export const dynamic = "force-dynamic";

const handler = createDatasetServiceHandler();

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => handler(request));
}
