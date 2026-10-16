import { toXlsx, xlsxFileName } from "@/lib/dataset-xlsx";
import { parseDatasetFilterRequest } from "@/lib/dataset-request";
import { withSharedCache } from "@/lib/edge-cache";
import { errorResponse } from "@/lib/errors";
import { exportOfficialServices } from "@/lib/official-query";

export const dynamic = "force-dynamic";

async function buildExportResponse(request: Request): Promise<Response> {
  const parsed = parseDatasetFilterRequest(new URL(request.url).searchParams);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_REQUEST", message: parsed.message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const rows = await exportOfficialServices(parsed.data);
    const filename = encodeURIComponent(xlsxFileName(parsed.data, new Date()));
    return new Response(await toXlsx(rows), {
      headers: {
        "cache-control": "public, max-age=0, s-maxage=300, must-revalidate",
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="integrated-care-results.xlsx"; filename*=UTF-8''${filename}`,
      },
    });
  } catch (error) {
    return errorResponse(error, {
      code: "DATA_EXPORT_FAILED",
      message: "파일을 생성하지 못했습니다.",
      status: 500,
      path: "/api/dataset/export/xlsx",
    });
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildExportResponse(request));
}
