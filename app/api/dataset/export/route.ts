import { describeError } from "@/lib/errors";
import { csvFileName, toCsv } from "@/lib/dataset";
import { filtersFromSearchParams } from "@/lib/dataset-request";
import { withSharedCache } from "@/lib/edge-cache";
import { exportOfficialServices } from "@/lib/official-query";

export const dynamic = "force-dynamic";

const EXPORT_CACHE_HEADER = "public, max-age=0, s-maxage=300, must-revalidate";

async function buildExportResponse(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const filters = filtersFromSearchParams(params);
  try {
    const rows = await exportOfficialServices(filters);
    const filename = encodeURIComponent(csvFileName(filters, new Date()));
    return new Response(toCsv(rows), {
      headers: {
        "cache-control": EXPORT_CACHE_HEADER,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (error) {
    return Response.json(
      { error: `CSV를 만들지 못했습니다: ${describeError(error)}` },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildExportResponse(request));
}
