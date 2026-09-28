import { after } from "next/server";

import { errorResponse } from "@/lib/errors";
import { SHARED_CACHE_HEADER, withSharedCache } from "@/lib/edge-cache";
import {
  beginOfficialSync,
  executeOfficialSyncLazily,
  readOfficialDataset,
  readPublicOfficialSyncStatus,
} from "@/lib/official-sync-status";
import { MOHW_INTEGRATED_CARE_URL } from "@/lib/official-source";

export const dynamic = "force-dynamic";

function isRefreshRequest(request: Request): boolean {
  return new URL(request.url).searchParams.has("refresh");
}

async function buildDatasetResponse(request: Request): Promise<Response> {
  try {
    const refresh = isRefreshRequest(request);
    const [dataset, status] = await Promise.all([
      readOfficialDataset(),
      readPublicOfficialSyncStatus(),
    ]);

    let syncStarted = false;
    if (status.stale && !status.running) {
      const start = await beginOfficialSync("automatic");
      syncStarted = start.started;
      if (start.started) {
        after(async () => {
          await executeOfficialSyncLazily(start.runId);
        });
      }
    }

    const lastFailure = status.latestAttempt?.status === "failed";
    const message = status.running || syncStarted
      ? "보건복지부 통합돌봄 사업안내 원문을 수집하고 있습니다. 공공 API는 보완 자료로 확인합니다."
      : lastFailure
        ? "최근 공식자료 현행화에 실패했습니다. 마지막 성공 자료를 표시합니다."
        : status.stale
          ? "최신 공식자료 현행화를 시작했습니다. 현재 화면에는 마지막 성공 자료가 표시됩니다."
          : "";

    return Response.json(
      {
        state: dataset.rows.length > 0 ? "official" : "syncing",
        sourceLabel: "보건복지부 통합돌봄 사업안내",
        sourceUrl: MOHW_INTEGRATED_CARE_URL,
        fetchedAt: dataset.completedAt,
        dataAsOf: dataset.dataAsOf,
        message,
        rows: dataset.rows,
      },
      {
        headers: {
          "cache-control": refresh
            ? "no-store"
            : SHARED_CACHE_HEADER,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, {
      code: "DATASET_READ_FAILED",
      message: "공식자료 저장소를 읽지 못했습니다.",
      status: 500,
      path: "/api/dataset",
    });
  }
}

export function GET(request: Request): Promise<Response> {
  if (isRefreshRequest(request)) return buildDatasetResponse(request);
  return withSharedCache(request, () => buildDatasetResponse(request));
}
