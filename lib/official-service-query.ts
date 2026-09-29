import { normalizeRows, serviceWikiKey, type ServiceRow } from "./dataset.ts";
import { repairKnownExtractionFragments } from "./official-correction.ts";
import { repairExtractionSpacing } from "./official-spacing.ts";
import type { OfficialService } from "./official-source.ts";

type CandidateReader = (
  normalizedServiceId: string,
) => Promise<readonly Record<string, unknown>[]>;

const CANONICAL_SIDO_SQL =
  "CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END";

export function serviceIdFromWikiKey(key: string): string {
  if (!key.startsWith("service:")) return "";
  const parts = key.slice("service:".length).split("|");
  if (parts.length !== 6) return "";
  return parts[0] ?? "";
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return value === undefined || value === null ? "" : String(value);
}

function officialServices(
  records: readonly Record<string, unknown>[],
): readonly OfficialService[] {
  return records.map((record) => ({
    serviceId: text(record, "serviceId"),
    sido: text(record, "sido"),
    sigungu: text(record, "sigungu"),
    category: text(record, "category"),
    subcategory: text(record, "subcategory"),
    name: text(record, "name"),
    description: text(record, "description"),
    target: text(record, "target"),
    detailTarget: text(record, "detailTarget"),
    applicationMethod: text(record, "applicationMethod"),
    provider: text(record, "provider"),
    type: text(record, "type"),
    serial: text(record, "serial"),
    detailUrl: text(record, "detailUrl"),
    updatedDate: text(record, "updatedDate"),
  }));
}

async function readCandidates(
  normalizedServiceId: string,
): Promise<readonly Record<string, unknown>[]> {
  const { getD1 } = await import("./d1.ts");
  const db = getD1();
  const run = await db.prepare(
    `SELECT id FROM official_sync_run
     WHERE status = 'succeeded'
     ORDER BY completed_at DESC
     LIMIT 1`,
  ).first<{ id: string }>();
  if (!run) return [];

  const result = await db.prepare(
    `SELECT
       service_id AS serviceId,
       ${CANONICAL_SIDO_SQL} AS sido,
       sigungu,
       category,
       subcategory,
       name,
       description,
       target,
       detail_target AS detailTarget,
       application_method AS applicationMethod,
       provider,
       type,
       serial,
       detail_url AS detailUrl,
       updated_date AS updatedDate
     FROM official_service_snapshot
     WHERE sync_run_id = ?
       AND LOWER(REPLACE(REPLACE(service_id, ':', ''), '-', '')) = ?
     LIMIT 32`,
  ).bind(run.id, normalizedServiceId).all<Record<string, unknown>>();
  return result.results ?? [];
}

export async function findOfficialServiceByWikiKey(
  key: string,
  candidateReader: CandidateReader = readCandidates,
): Promise<ServiceRow | null> {
  const serviceId = serviceIdFromWikiKey(key);
  if (!serviceId) return null;

  const candidates = await candidateReader(serviceId);
  const corrected = repairExtractionSpacing(
    repairKnownExtractionFragments(officialServices(candidates)),
  );
  const rows = normalizeRows(corrected);
  const exact = rows.find((row) => serviceWikiKey(row) === key);
  if (exact) return exact;
  // 대분류가 바뀐 사업의 예전 주소도 연다(대분류만 다르고 나머지가 같은 사업이 하나일 때).
  const withoutCategory = (value: string) => value.split("|").filter((_, index) => index !== 3).join("|");
  const recategorized = rows.filter((row) => withoutCategory(serviceWikiKey(row)) === withoutCategory(key));
  return recategorized.length === 1 ? recategorized[0] ?? null : null;
}
