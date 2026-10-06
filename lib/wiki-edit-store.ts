import { getD1 } from "./d1";
import { logServerError } from "./errors";
import { normalizeRows, type ServiceRow } from "./dataset";
import { memoizeForTtl } from "./memo";
import { PUBLIC_KNOWLEDGE_RUN_SQL } from "./platform/public-pin";
import { repairKnownExtractionFragments } from "./official-correction";
import { findOfficialServiceByWikiKey } from "./official-service-query";
import type { OfficialService } from "./official-source";
import { repairExtractionSpacing } from "./official-spacing";
import {
  applyWikiEdit,
  type WikiEdit,
  type WikiEditInput,
} from "./wiki-edits";

const CANONICAL_SIDO_SQL =
  "CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END";
const PUBLIC_EDIT_TTL_MS = 30_000;

interface WikiEditRecord {
  readonly service_id: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly name: string;
  readonly description: string | null;
  readonly target: string | null;
  readonly detail_target: string | null;
  readonly provider: string | null;
  readonly application_method: string | null;
  readonly content: string | null;
  readonly source_title: string | null;
  readonly source_url: string | null;
  readonly note: string;
  readonly updated_at: number;
}

const EDIT_COLUMNS =
  "service_id, sido, sigungu, name, description, target, detail_target, provider, application_method, content, source_title, source_url, note, updated_at";

function toWikiEdit(record: WikiEditRecord): WikiEdit {
  return {
    serviceId: record.service_id,
    sido: record.sido,
    sigungu: record.sigungu,
    name: record.name,
    description: record.description,
    target: record.target,
    detailTarget: record.detail_target,
    provider: record.provider,
    applicationMethod: record.application_method,
    content: record.content,
    sourceTitle: record.source_title,
    sourceUrl: record.source_url,
    note: record.note,
    updatedAt: record.updated_at,
  };
}

export async function listWikiEdits(): Promise<WikiEdit[]> {
  const result = await getD1()
    .prepare("SELECT " + EDIT_COLUMNS + " FROM wiki_edit ORDER BY updated_at DESC")
    .all<WikiEditRecord>();
  return (result.results ?? []).map(toWikiEdit);
}

export async function readWikiEdit(serviceId: string): Promise<WikiEdit | null> {
  const record = await getD1()
    .prepare("SELECT " + EDIT_COLUMNS + " FROM wiki_edit WHERE service_id = ?")
    .bind(serviceId)
    .first<WikiEditRecord>();
  return record ? toWikiEdit(record) : null;
}

export async function saveWikiEdit(
  service: Pick<OfficialService, "serviceId" | "sido" | "sigungu" | "name">,
  input: WikiEditInput,
): Promise<WikiEdit> {
  const values = input.values;
  const updatedAt = Math.floor(Date.now() / 1000);
  await getD1()
    .prepare(
      "INSERT INTO wiki_edit (" + EDIT_COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(service_id) DO UPDATE SET sido = excluded.sido, sigungu = excluded.sigungu, name = excluded.name, " +
        "description = excluded.description, target = excluded.target, detail_target = excluded.detail_target, " +
        "provider = excluded.provider, application_method = excluded.application_method, content = excluded.content, " +
        "source_title = excluded.source_title, source_url = excluded.source_url, note = excluded.note, updated_at = excluded.updated_at",
    )
    .bind(
      service.serviceId,
      service.sido,
      service.sigungu,
      service.name,
      values.description,
      values.target,
      values.detailTarget,
      values.provider,
      values.applicationMethod,
      values.content,
      values.sourceTitle,
      values.sourceUrl,
      input.note,
      updatedAt,
    )
    .run();
  return {
    serviceId: service.serviceId,
    sido: service.sido,
    sigungu: service.sigungu,
    name: service.name,
    ...values,
    note: input.note,
    updatedAt,
  };
}

export async function deleteWikiEdit(serviceId: string): Promise<void> {
  await getD1().prepare("DELETE FROM wiki_edit WHERE service_id = ?").bind(serviceId).run();
}

async function loadWikiEditMap(): Promise<ReadonlyMap<string, WikiEdit>> {
  try {
    const edits = await listWikiEdits();
    return new Map(edits.map((edit) => [edit.serviceId, edit]));
  } catch (error) {
    logServerError(error, { path: "wiki-edit/overlay", status: 500 });
    return new Map();
  }
}

export const cachedWikiEdits = memoizeForTtl(loadWikiEditMap, PUBLIC_EDIT_TTL_MS);

export async function readOriginalService(serviceId: string): Promise<ServiceRow | null> {
  const db = getD1();
  const run = await db
    .prepare("SELECT id FROM official_sync_run WHERE id = " + PUBLIC_KNOWLEDGE_RUN_SQL)
    .first<{ id: string }>();
  if (!run) return null;
  const record = await db
    .prepare(
      "SELECT service_id AS serviceId, " + CANONICAL_SIDO_SQL + " AS sido, sigungu, category, subcategory, name, description, target, " +
        "detail_target AS detailTarget, application_method AS applicationMethod, provider, type, serial, detail_url AS detailUrl, " +
        "updated_date AS updatedDate FROM official_service_snapshot WHERE sync_run_id = ? AND service_id = ? LIMIT 1",
    )
    .bind(run.id, serviceId)
    .first<OfficialService>();
  if (!record) return null;
  const repaired = repairExtractionSpacing(repairKnownExtractionFragments([record]));
  return normalizeRows(repaired)[0] ?? null;
}

export async function findEditedServiceByWikiKey(key: string): Promise<ServiceRow | null> {
  const [row, edits] = await Promise.all([findOfficialServiceByWikiKey(key), cachedWikiEdits()]);
  return row ? applyWikiEdit(row, edits.get(row.serviceId)) : null;
}
