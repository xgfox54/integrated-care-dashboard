// 통합 공개본 갱신(요청 뒤 남는 시간). 인스턴스마다 1분에 한 번만 확인한다. 공개 MCP 요청은 이 작업을 일으키지 않는다.
import { getD1 } from "../d1";
import { latestKnowledgeRunId, refreshDocumentSubjects } from "../imports/public";
import { McpData } from "../mcp/data";
import { cachedWikiEdits } from "../wiki-edit-store";
import { ensureActiveBundle } from "./bundle";

const CHECK_INTERVAL_MS = 60_000;
let lastCheckAt = 0;

export async function advanceBundleInBackground(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) return;
  lastCheckAt = now;
  const db = getD1();
  // 원본(지식 수집 run)이 바뀌면 문서 사실이 가리키는 사업이 아직 있는지 다시 확인하고, 없으면 보류한다.
  const runId = await latestKnowledgeRunId(db);
  if (runId) {
    const data = new McpData(db, cachedWikiEdits);
    await refreshDocumentSubjects(db, runId, async (ids) => {
      const found = new Set<string>();
      for (const id of ids) if (await data.programByKey(runId, id)) found.add(id);
      return found;
    }, Math.floor(now / 1000));
  }
  await ensureActiveBundle(db, Math.floor(now / 1000));
}

