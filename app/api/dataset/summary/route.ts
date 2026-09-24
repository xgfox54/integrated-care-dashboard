import { after } from "next/server";

import { describeError } from "@/lib/errors";
import { readSummaryDataset } from "@/lib/dataset-responses";
import { SHARED_CACHE_HEADER, withSharedCache } from "@/lib/edge-cache";
import {
  beginOfficialSync,
  executeOfficialSyncLazily,
  readPublicOfficialSyncStatus,
} from "@/lib/official-sync-status";
import { MOHW_INTEGRATED_CARE_URL } from "@/lib/official-source";

export const dynamic = "force-dynamic";

async function buildSummaryResponse(): Promise<Response> {
  try {
    const [dataset, status] = await Promise.all([
      readSummaryDataset(),
      readPublicOfficialSyncStatus(),
    ]);
    let syncStarted = false;
    if (status.stale && !status.running) {
      const start = await beginOfficialSync("automatic");
      syncStarted = start.started;
      if (start.started) {
        after(async () => executeOfficialSyncLazily(start.runId));
      }
    }
    const message = status.running || syncStarted
      ? "보건복지부 통합돌봄 사업안내 원문을 백그라운드에서 현행화하고 있습니다."
      : status.latestAttempt?.status === "failed"
        ? `최근 현행화 실패: ${status.latestAttempt.error}`
        : "";
    return Response.json(
      {
        state: dataset.summary.totalCount > 0 ? "official" : "syncing",
        sourceLabel: "보건복지부 통합돌봄 사업안내",
        sourceUrl: MOHW_INTEGRATED_CARE_URL,
        fetchedAt: dataset.completedAt,
        dataAsOf: dataset.dataAsOf,
        message,
        summary: dataset.summary,
      },
      { headers: { "cache-control": SHARED_CACHE_HEADER } },
    );
  } catch (error) {
    return Response.json(
      {
        state: "failed",
        sourceLabel: "보건복지부 통합돌봄 사업안내",
        sourceUrl: MOHW_INTEGRATED_CARE_URL,
        fetchedAt: "",
        dataAsOf: "",
        message: `요약 자료를 읽지 못했습니다: ${describeError(error)}`,
        summary: null,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, buildSummaryResponse);
}
