import { SEARCH_TEXT_FROM_JSON } from "./official-search-text.ts";
import type { OfficialDocument, OfficialService } from "./official-source.ts";
import type { SqlDatabase, SqlStatement } from "./sql-database.ts";

const JSON_ROWS = 100;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

/** 수집 회차의 원문 목록. 같은 문서가 두 번 나와도 한 번만 남는다. */
export function insertDocumentsStatement(
  db: SqlDatabase,
  runId: string,
  documents: readonly OfficialDocument[],
  collectedAt: number,
): SqlStatement[] {
  return chunks(documents, JSON_ROWS).map((group) =>
    db.prepare(
      `INSERT OR IGNORE INTO official_source_document
        (id, document_id, sync_run_id, province, municipality, title, published_at, data_as_of, detail_url, download_url, file_name, collected_at)
       SELECT
        json_extract(value, '$.id'), json_extract(value, '$.documentId'), json_extract(value, '$.runId'),
        json_extract(value, '$.province'), json_extract(value, '$.municipality'), json_extract(value, '$.title'),
        json_extract(value, '$.publishedAt'), json_extract(value, '$.dataAsOf'), json_extract(value, '$.detailUrl'),
        json_extract(value, '$.downloadUrl'), json_extract(value, '$.fileName'), json_extract(value, '$.collectedAt')
       FROM json_each(?)`,
    ).bind(JSON.stringify(group.map((document) => ({ ...document, id: `${runId}:${document.documentId}`, runId, collectedAt })))),
  );
}

/** 수집 회차의 사업 행. 번호(offset부터)로 id를 정하므로 같은 묶음을 다시 넣어도 결과가 같다. */
export function insertServicesStatement(
  db: SqlDatabase,
  runId: string,
  services: readonly OfficialService[],
  offset: number,
  collectedAt: number,
): SqlStatement[] {
  return chunks(services, JSON_ROWS).map((group, groupIndex) =>
    db.prepare(
      `INSERT OR REPLACE INTO official_service_snapshot
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
    ).bind(JSON.stringify(group.map((service, index) => ({
      ...service,
      id: `${runId}:${offset + groupIndex * JSON_ROWS + index}:${service.serviceId}`,
      runId,
      collectedAt,
    })))),
  );
}
