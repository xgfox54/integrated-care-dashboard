import { csvFileName, toCsv } from "@/lib/dataset-csv";
import { parseDatasetFilterRequest } from "@/lib/dataset-request";
import { withSharedCache } from "@/lib/edge-cache";
import { errorResponse } from "@/lib/errors";
import { exportOfficialServices } from "@/lib/official-query";

export const dynamic = "force-dynamic";

const EXPORT_CACHE_HEADER = "public, max-age=0, s-maxage=300, must-revalidate";

async function buildExportResponse(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = parseDatasetFilterRequest(params);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_REQUEST", message: parsed.message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const filters = parsed.data;
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
    return errorResponse(error, {
      code: "DATA_EXPORT_FAILED",
      message: "파일을 생성하지 못했습니다.",
      status: 500,
      path: "/api/dataset/export",
    });
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildExportResponse(request));
}
