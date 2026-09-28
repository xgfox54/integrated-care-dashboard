import type { ServiceRow } from "./dataset.ts";
import { errorResponse } from "./errors.ts";

interface DatasetServiceDependencies {
  readonly findService: (key: string) => Promise<ServiceRow | null>;
}

async function findEditedService(key: string): Promise<ServiceRow | null> {
  const { findEditedServiceByWikiKey } = await import("./wiki-edit-store.ts");
  return findEditedServiceByWikiKey(key);
}

const DEFAULT_DEPENDENCIES: DatasetServiceDependencies = {
  findService: findEditedService,
};

export function createDatasetServiceHandler(
  dependencies: DatasetServiceDependencies = DEFAULT_DEPENDENCIES,
) {
  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    const key = params.get("service")?.trim() ?? "";
    if (keys.length !== 1 || keys[0] !== "service") {
      return Response.json(
        { message: "조회할 사업 식별자가 필요합니다." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    if (!key || key.length > 500) {
      return Response.json(
        { message: "조회할 사업 식별자가 필요합니다." },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    try {
      const row = await dependencies.findService(key);
      if (!row) {
        return Response.json(
          { row: null },
          {
            status: 404,
            headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
          },
        );
      }
      return Response.json(
        { row },
        { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } },
      );
    } catch (error) {
      return errorResponse(error, {
        code: "DATASET_SERVICE_FAILED",
        message: "선택한 사업을 읽지 못했습니다.",
        status: 500,
        path: "/api/dataset/service",
      });
    }
  };
}
