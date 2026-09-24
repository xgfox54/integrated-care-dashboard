import { getD1 } from "./d1";
import { warmDatasetCache } from "./dataset-responses";
import type { OfficialDocument, OfficialService } from "./official-source";
import { SEARCH_TEXT_FROM_JSON } from "./official-search-text";
import { collectOfficialDataset } from "./official-dataset";
import {
  beginOfficialSync,
  needsAutomaticSync,
  nowSeconds,
  readOfficialSyncStatus,
  type OfficialSyncStatus,
  type SyncTrigger,
} from "./official-sync-status";

// 수집 실행 전용 모듈. 보건복지부 기준 자료(data/*.json, 약 12MB)를 품고 있으므로
// 화면·API 요청 경로에서는 정적으로 불러오지 말고 official-sync-status.ts의
// executeOfficialSyncLazily나 동적 import로만 연다.

const D1_JSON_ROWS = 100;
const D1_BATCH_SIZE = 50;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function storeSnapshot(
  runId: string,
  services: readonly OfficialService[],
  documents: readonly OfficialDocument[],
): Promise<void> {
  const db = getD1();
  const collectedAt = nowSeconds();
  const serviceStatements = chunks(services, D1_JSON_ROWS).map((group, groupIndex) =>
    db.prepare(
      `INSERT INTO official_service_snapshot
        (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, application_method, provider, type, serial, detail_url, updated_date, collected_at, search_text)
       SELECT
        json_extract(value, '$.id'), json_extract(value, '$.serviceId'), json_extract(value, '$.runId'),
        json_extract(value, '$.sido'), json_extract(value, '$.sigungu'), json_extract(value, '$.category'),
        json_extract(value, '$.subcategory'), json_extract(value, '$.name'), json_extract(value, '$.description'),
        json_extract(value, '$.target'), json_extract(value, '$.detailTarget'), COALESCE(json_extract(value, '$.applicationMethod'), ''),
        json_extract(value, '$.provider'), json_extract(value, '$.type'), json_extract(value, '$.serial'), json_extract(value, '$.detailUrl'),
        json_extract(value, '$.updatedDate'), json_extract(value, '$.collectedAt'),
        ${SEARCH_TEXT_FROM_JSON}
       FROM json_each(?)`,
    ).bind(
      JSON.stringify(group.map((service, index) => ({
        ...service,
        id: `${runId}:${groupIndex * D1_JSON_ROWS + index}:${service.serviceId}`,
        runId,
        collectedAt,
      }))),
    ),
  );
  const documentStatements = chunks(documents, D1_JSON_ROWS).map((group) =>
    db.prepare(
      `INSERT INTO official_source_document
        (id, document_id, sync_run_id, province, municipality, title, published_at, data_as_of, detail_url, download_url, file_name, collected_at)
       SELECT
        json_extract(value, '$.id'), json_extract(value, '$.documentId'), json_extract(value, '$.runId'),
        json_extract(value, '$.province'), json_extract(value, '$.municipality'), json_extract(value, '$.title'),
        json_extract(value, '$.publishedAt'), json_extract(value, '$.dataAsOf'), json_extract(value, '$.detailUrl'),
        json_extract(value, '$.downloadUrl'), json_extract(value, '$.fileName'), json_extract(value, '$.collectedAt')
       FROM json_each(?)`,
    ).bind(
      JSON.stringify(group.map((document) => ({
        ...document,
        id: `${runId}:${document.documentId}`,
        runId,
        collectedAt,
      }))),
    ),
  );
  for (const group of chunks([...serviceStatements, ...documentStatements], D1_BATCH_SIZE)) {
    await db.batch(group);
  }
}

export async function executeOfficialSync(runId: string): Promise<OfficialSyncStatus> {
  const db = getD1();
  let succeeded = false;
  try {
    const { services, documents } = await collectOfficialDataset();
    await storeSnapshot(runId, services, documents);
    const [promotion] = await db.batch([
      db.prepare(
        "UPDATE official_sync_run SET status = 'succeeded', completed_at = ?, service_count = ?, document_count = ?, error = '' WHERE id = ? AND EXISTS (SELECT 1 FROM official_sync_lock WHERE id = 1 AND run_id = ?)",
      ).bind(nowSeconds(), services.length, documents.length, runId, runId),
      db.prepare(
        "DELETE FROM official_service_snapshot WHERE sync_run_id <> ? AND EXISTS (SELECT 1 FROM official_sync_run WHERE id = ? AND status = 'succeeded')",
      ).bind(runId, runId),
      db.prepare(
        "DELETE FROM official_source_document WHERE sync_run_id <> ? AND EXISTS (SELECT 1 FROM official_sync_run WHERE id = ? AND status = 'succeeded')",
      ).bind(runId, runId),
    ]);
    if ((promotion.meta.changes ?? 0) !== 1) {
      throw new Error("수집 잠금이 만료되어 새 자료로 교체하지 않았습니다.");
    }
    succeeded = true;
  } catch (error) {
    const message = (error instanceof Error ? error.message : "알 수 없는 수집 오류").slice(0, 1000);
    await db.batch([
      db.prepare(
        "UPDATE official_sync_run SET status = 'failed', completed_at = ?, error = ? WHERE id = ?",
      ).bind(nowSeconds(), message, runId),
      db.prepare("DELETE FROM official_service_snapshot WHERE sync_run_id = ?").bind(runId),
      db.prepare("DELETE FROM official_source_document WHERE sync_run_id = ?").bind(runId),
    ]);
  } finally {
    await db.prepare("DELETE FROM official_sync_lock WHERE id = 1 AND run_id = ?").bind(runId).run();
  }
  // 새 자료로 바뀌었으면 첫 방문자가 기다리지 않도록 요약·지역 묶음을 미리 계산해 둔다.
  if (succeeded) await warmDatasetCache().catch(() => undefined);
  return readOfficialSyncStatus();
}

export async function runOfficialSync(trigger: SyncTrigger): Promise<OfficialSyncStatus> {
  if (trigger === "automatic") {
    const status = await readOfficialSyncStatus();
    if (!needsAutomaticSync(status)) return status;
  }
  const start = await beginOfficialSync(trigger);
  if (!start.started) return readOfficialSyncStatus();
  return executeOfficialSync(start.runId);
}
