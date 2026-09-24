import rawSeed from "../data/mohw-seed.json" with { type: "json" };
import type { OfficialBenchmark, OfficialCoverage } from "./official-quality.ts";
import type { OfficialDocument, OfficialService } from "./official-source.ts";

export interface MohwSeedEntry {
  readonly document: OfficialDocument;
  readonly fingerprint: string;
  readonly services: readonly OfficialService[];
}

export interface MohwSeed {
  readonly generatedAt: string;
  readonly benchmark: OfficialBenchmark;
  readonly documents: readonly MohwSeedEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function count(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cleanName(value: string): string {
  return value.replace(/(\d)\s+(?=\d)/g, "$1").replace(/\s+/g, " ").trim();
}

function parseDocument(value: unknown): OfficialDocument | null {
  if (!isRecord(value)) return null;
  const document = {
    documentId: text(value, "documentId"),
    province: text(value, "province"),
    municipality: text(value, "municipality"),
    title: text(value, "title"),
    publishedAt: text(value, "publishedAt"),
    dataAsOf: text(value, "dataAsOf"),
    detailUrl: text(value, "detailUrl"),
    downloadUrl: text(value, "downloadUrl"),
    fileName: text(value, "fileName"),
  };
  return document.documentId && document.province ? document : null;
}

export function parseOfficialService(value: unknown): OfficialService | null {
  if (!isRecord(value)) return null;
  const service = {
    serviceId: text(value, "serviceId"),
    sido: text(value, "sido"),
    sigungu: text(value, "sigungu"),
    category: text(value, "category"),
    subcategory: text(value, "subcategory"),
    name: cleanName(text(value, "name")),
    description: text(value, "description"),
    target: text(value, "target"),
    detailTarget: text(value, "detailTarget"),
    provider: text(value, "provider"),
    type: text(value, "type"),
    serial: text(value, "serial"),
    detailUrl: text(value, "detailUrl"),
    updatedDate: text(value, "updatedDate"),
  };
  return service.serviceId && service.name ? service : null;
}

function parseCoverage(value: unknown): OfficialCoverage {
  const record = isRecord(value) ? value : {};
  return {
    category: count(record, "category"),
    subcategory: count(record, "subcategory"),
    name: count(record, "name"),
    description: count(record, "description"),
    target: count(record, "target"),
    provider: count(record, "provider"),
    type: count(record, "type"),
  };
}

function parseEntry(value: unknown): MohwSeedEntry | null {
  if (!isRecord(value)) return null;
  const document = parseDocument(value.document);
  const services = Array.isArray(value.services)
    ? value.services.map(parseOfficialService).filter((service) => service !== null)
    : [];
  if (!document || services.length === 0) return null;
  return { document, fingerprint: text(value, "fingerprint"), services };
}

let memo: MohwSeed | null = null;

export function readMohwSeed(): MohwSeed {
  if (memo) return memo;
  const root: unknown = rawSeed;
  const record = isRecord(root) ? root : {};
  const benchmarkRecord = isRecord(record.benchmark) ? record.benchmark : {};
  const entries = Array.isArray(record.documents)
    ? record.documents.map(parseEntry).filter((entry) => entry !== null)
    : [];
  const benchmark = {
    sourceCount: count(benchmarkRecord, "sourceCount"),
    sourceCoverage: parseCoverage(benchmarkRecord.sourceCoverage),
    sourceIdentityHashes: Array.isArray(benchmarkRecord.sourceIdentityHashes)
      ? benchmarkRecord.sourceIdentityHashes.filter((value): value is string => typeof value === "string")
      : [],
  };
  if (entries.length === 0 || benchmark.sourceCount === 0) {
    throw new Error("보건복지부 기준 데이터 묶음이 올바르지 않습니다.");
  }
  memo = { generatedAt: text(record, "generatedAt"), benchmark, documents: entries };
  return memo;
}
