import { collectMohwDocuments } from "./mohw-board.ts";
import { readMohwDocumentCache, storeMohwDocumentCache } from "./mohw-cache.ts";
import { collectMohwDocumentServices, officialDocumentFingerprint } from "./mohw-preview.ts";
import { readMohwSeed, type MohwSeedEntry } from "./mohw-seed.ts";
import { collectPublicApiServices } from "./official-collect.ts";
import {
  alignToRepositoryTaxonomy,
  correctFromRepositoryBaseline,
  removeExtractedContinuationFragments,
  repairKnownExtractionFragments,
} from "./official-correction.ts";
import { enrichWithPublicApi } from "./official-enrichment.ts";
import { assessOfficialDataset, type OfficialQualityReport } from "./official-quality.ts";
import { repairExtractionSpacing } from "./official-spacing.ts";
import type { OfficialDocument, OfficialService } from "./official-source.ts";
import { readRepositoryBaseline } from "./repository-baseline.ts";

const MAX_REFRESH_DOCUMENTS = 12;

export interface CollectedOfficialDataset {
  readonly services: readonly OfficialService[];
  readonly documents: readonly OfficialDocument[];
  readonly publicApiMatches: number;
  readonly quality: OfficialQualityReport;
}

function matchingSeed(
  document: OfficialDocument,
  seeds: ReadonlyMap<string, MohwSeedEntry>,
): MohwSeedEntry | null {
  const seed = seeds.get(document.documentId);
  return seed?.fingerprint === officialDocumentFingerprint(document) ? seed : null;
}

export async function collectOfficialDataset(): Promise<CollectedOfficialDataset> {
  const seed = readMohwSeed();
  const [documents, cache] = await Promise.all([collectMohwDocuments(), readMohwDocumentCache()]);
  const seeds = new Map(seed.documents.map((entry) => [entry.document.documentId, entry]));
  const resolved = new Map<string, readonly OfficialService[]>();
  const pending: OfficialDocument[] = [];
  for (const document of documents) {
    const bundled = matchingSeed(document, seeds);
    if (bundled) {
      resolved.set(document.documentId, bundled.services);
      continue;
    }
    const cached = cache.get(document.documentId);
    if (cached?.fingerprint === officialDocumentFingerprint(document)) {
      resolved.set(document.documentId, cached.services);
      continue;
    }
    pending.push(document);
  }

  for (const document of pending.slice(0, MAX_REFRESH_DOCUMENTS)) {
    const services = await collectMohwDocumentServices(document);
    const entry = {
      documentId: document.documentId,
      fingerprint: officialDocumentFingerprint(document),
      services,
    };
    await storeMohwDocumentCache(entry);
    resolved.set(document.documentId, services);
  }
  if (pending.length > MAX_REFRESH_DOCUMENTS) {
    throw new Error(`[계속 수집] 변경 문서 ${pending.length - MAX_REFRESH_DOCUMENTS}개가 남았습니다.`);
  }

  const services = documents.flatMap((document) => resolved.get(document.documentId) ?? []);
  if (services.length === 0 || documents.some((document) => !resolved.has(document.documentId))) {
    throw new Error("보건복지부 문서별 사업 데이터가 모두 준비되지 않았습니다.");
  }
  let apiServices: readonly OfficialService[] = [];
  try {
    apiServices = await collectPublicApiServices();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    apiServices = [];
  }
  const baseline = readRepositoryBaseline();
  const corrected = correctFromRepositoryBaseline(
    repairExtractionSpacing(
      removeExtractedContinuationFragments(repairKnownExtractionFragments(services)),
    ),
    baseline,
  );
  const aligned = alignToRepositoryTaxonomy(corrected, baseline);
  const enriched = enrichWithPublicApi(aligned, apiServices);
  const quality = assessOfficialDataset(enriched.services, seed.benchmark, baseline);
  if (!quality.passed) throw new Error(`데이터 품질 기준 미달: ${quality.reasons.join(" ")}`);
  return {
    services: enriched.services,
    documents,
    publicApiMatches: enriched.matches,
    quality,
  };
}
