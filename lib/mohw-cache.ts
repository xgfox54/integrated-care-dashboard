import { getD1 } from "./d1";
import { parseOfficialService } from "./mohw-seed.ts";
import type { OfficialService } from "./official-source.ts";

export interface MohwCacheEntry {
  readonly documentId: string;
  readonly fingerprint: string;
  readonly services: readonly OfficialService[];
}

interface CacheRow {
  document_id: string;
  fingerprint: string;
  payload: string;
}

function parsePayload(payload: string): readonly OfficialService[] {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  return Array.isArray(value)
    ? value.map(parseOfficialService).filter((service) => service !== null)
    : [];
}

export async function readMohwDocumentCache(): Promise<ReadonlyMap<string, MohwCacheEntry>> {
  const rows = await getD1().prepare(
    "SELECT document_id, fingerprint, payload FROM official_document_service_cache",
  ).all<CacheRow>();
  const entries = (rows.results ?? []).flatMap((row) => {
    const services = parsePayload(row.payload);
    return services.length ? [{ documentId: row.document_id, fingerprint: row.fingerprint, services }] : [];
  });
  return new Map(entries.map((entry) => [entry.documentId, entry]));
}

export async function storeMohwDocumentCache(entry: MohwCacheEntry): Promise<void> {
  await getD1().prepare(
    "INSERT INTO official_document_service_cache (document_id, fingerprint, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET fingerprint = excluded.fingerprint, payload = excluded.payload, updated_at = excluded.updated_at",
  ).bind(
    entry.documentId,
    entry.fingerprint,
    JSON.stringify(entry.services),
    Math.floor(Date.now() / 1000),
  ).run();
}
