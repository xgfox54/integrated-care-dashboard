import { parseOfficialService, readMohwSeed, type MohwSeedEntry } from "./mohw-seed.ts";
import { officialDocumentFingerprint } from "./mohw-preview.ts";
import {
  alignToRepositoryTaxonomy,
  correctFromRepositoryBaseline,
  removeExtractedContinuationFragments,
  repairKnownExtractionFragments,
} from "./official-correction.ts";
import { enrichWithPublicApi } from "./official-enrichment.ts";
import { assessOfficialDataset } from "./official-quality.ts";
import { MOHW_PROVINCES, PUBLIC_API_SEARCH_TERMS, boundedPageCount, type OfficialDocument, type OfficialService } from "./official-source.ts";
import { repairExtractionSpacing } from "./official-spacing.ts";
import { readSyncProgress, runUnitStatements, type SyncProgress, type SyncStage } from "./official-sync-progress.ts";
import { insertDocumentsStatement, insertServicesStatement } from "./official-sync-writes.ts";
import { readRepositoryBaseline } from "./repository-baseline.ts";
import type { SqlDatabase } from "./sql-database.ts";

// 수집 한 단계: 작업 단위(광역 목록 1곳, 바뀐 문서 1개, 공공 API 1쪽, 저장 묶음 1개)를 기한까지 이어서 한다.
// 단위마다 결과와 진행 위치를 한 batch로 저장하므로, 요청이 중간에 끊겨도 다음 요청이 그 뒤부터 이어받는다.

export const API_PAGE_SIZE = 100;
const API_MAX_PAGES = 100;
const STORE_ROWS_PER_UNIT = 1_000;
const MAX_UNIT_ATTEMPTS = 3;

export type ApiPageResult =
  | { readonly kind: "page"; readonly totalCount: number; readonly services: readonly OfficialService[] }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface SyncSources {
  listProvinceDocuments(province: string, mid: string): Promise<readonly OfficialDocument[]>;
  readDocumentServices(document: OfficialDocument): Promise<readonly OfficialService[]>;
  readApiPage(term: string, page: number): Promise<ApiPageResult>;
}

export type StepOutcome = "continuing" | "succeeded" | "failed" | "idle";

interface BuiltDataset {
  readonly services: readonly OfficialService[];
  readonly documentCount: number;
}

/** 한 단계 안에서만 쓰는 계산 결과(저장 묶음마다 다시 계산하지 않도록 담아 둔다). */
interface StepMemo {
  dataset?: Promise<BuiltDataset>;
}

interface UnitResult {
  readonly stage: SyncStage | "succeeded";
}

async function runDocuments(db: SqlDatabase, sources: SyncSources, runId: string, progress: SyncProgress, now: number): Promise<UnitResult> {
  const province = MOHW_PROVINCES[progress.province];
  if (province) {
    const documents = await sources.listProvinceDocuments(province[0], province[1]);
    await db.batch([
      ...insertDocumentsStatement(db, runId, documents, now),
      ...runUnitStatements(db, runId, "documents", { ...progress, province: progress.province + 1, failures: 0 }, now),
    ]);
    return { stage: "documents" };
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM official_source_document WHERE sync_run_id = ?").bind(runId).first<{ count: number }>();
  if ((count?.count ?? 0) < MOHW_PROVINCES.length) throw new Error(`보건복지부 원문 목록이 불완전합니다(${count?.count ?? 0}건).`);
  await db.batch(runUnitStatements(db, runId, "previews", { ...progress, failures: 0 }, now));
  return { stage: "previews" };
}

async function runDocumentsOf(db: SqlDatabase, runId: string): Promise<readonly OfficialDocument[]> {
  const rows = await db.prepare(
    "SELECT document_id AS documentId, province, municipality, title, published_at AS publishedAt, data_as_of AS dataAsOf, detail_url AS detailUrl, download_url AS downloadUrl, file_name AS fileName FROM official_source_document WHERE sync_run_id = ? ORDER BY rowid",
  ).bind(runId).all<OfficialDocument>();
  return rows.results;
}

function seedByDocument(): ReadonlyMap<string, MohwSeedEntry> {
  return new Map(readMohwSeed().documents.map((entry) => [entry.document.documentId, entry]));
}

async function runPreviews(db: SqlDatabase, sources: SyncSources, runId: string, progress: SyncProgress, now: number): Promise<UnitResult> {
  const seeds = seedByDocument();
  const cached = await db.prepare("SELECT document_id, fingerprint FROM official_document_service_cache").all<{ document_id: string; fingerprint: string }>();
  const cacheFingerprints = new Map(cached.results.map((row) => [row.document_id, row.fingerprint]));
  const pending = (await runDocumentsOf(db, runId)).find((document) => {
    const fingerprint = officialDocumentFingerprint(document);
    return seeds.get(document.documentId)?.fingerprint !== fingerprint && cacheFingerprints.get(document.documentId) !== fingerprint;
  });
  if (!pending) {
    await db.batch(runUnitStatements(db, runId, "api", { ...progress, failures: 0 }, now));
    return { stage: "api" };
  }
  const services = await sources.readDocumentServices(pending);
  await db.batch([
    db.prepare(
      "INSERT INTO official_document_service_cache (document_id, fingerprint, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET fingerprint = excluded.fingerprint, payload = excluded.payload, updated_at = excluded.updated_at",
    ).bind(pending.documentId, officialDocumentFingerprint(pending), JSON.stringify(services), now),
    ...runUnitStatements(db, runId, "previews", { ...progress, failures: 0 }, now),
  ]);
  return { stage: "previews" };
}

async function runApi(db: SqlDatabase, sources: SyncSources, runId: string, progress: SyncProgress, now: number): Promise<UnitResult> {
  const term = PUBLIC_API_SEARCH_TERMS[progress.apiTerm];
  if (progress.apiSkipped || !term) {
    await db.batch(runUnitStatements(db, runId, "store", { ...progress, failures: 0 }, now));
    return { stage: "store" };
  }
  const page = progress.apiPage + 1;
  const result = await sources.readApiPage(term, page);
  const pages = result.kind === "page" && page === 1 ? boundedPageCount(result.totalCount, API_PAGE_SIZE) : progress.apiPages;
  // 공공 API는 보조 자료다. 한 번이라도 받지 못하면(인증키·한도 포함) 예전처럼 이번 수집에서는 쓰지 않는다.
  if (result.kind === "unavailable" || pages > API_MAX_PAGES) {
    await db.batch(runUnitStatements(db, runId, "store", { ...progress, apiSkipped: true, failures: 0 }, now));
    return { stage: "store" };
  }
  const done = page >= pages;
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO official_sync_api_page (run_id, term, page, payload) VALUES (?, ?, ?, ?)").bind(runId, term, page, JSON.stringify(result.services)),
    ...runUnitStatements(db, runId, "api", {
      ...progress,
      apiTerm: done ? progress.apiTerm + 1 : progress.apiTerm,
      apiPage: done ? 0 : page,
      apiPages: done ? 0 : pages,
      failures: 0,
    }, now),
  ]);
  return { stage: "api" };
}

async function buildDataset(db: SqlDatabase, runId: string, progress: SyncProgress): Promise<BuiltDataset> {
  const documents = await runDocumentsOf(db, runId);
  const seeds = seedByDocument();
  const cached = await db.prepare(
    "SELECT document_id, fingerprint, payload FROM official_document_service_cache WHERE document_id IN (SELECT document_id FROM official_source_document WHERE sync_run_id = ?)",
  ).bind(runId).all<{ document_id: string; fingerprint: string; payload: string }>();
  const cache = new Map(cached.results.map((row) => [row.document_id, row]));
  const services = documents.flatMap((document) => {
    const fingerprint = officialDocumentFingerprint(document);
    const seed = seeds.get(document.documentId);
    if (seed?.fingerprint === fingerprint) return seed.services;
    const entry = cache.get(document.documentId);
    if (entry?.fingerprint !== fingerprint) throw new Error("보건복지부 문서별 사업 데이터가 모두 준비되지 않았습니다.");
    const payload: unknown = JSON.parse(entry.payload);
    return Array.isArray(payload) ? payload.map(parseOfficialService).filter((service) => service !== null) : [];
  });
  if (services.length === 0) throw new Error("보건복지부 문서별 사업 데이터가 모두 준비되지 않았습니다.");

  const apiServices = new Map<string, OfficialService>();
  if (!progress.apiSkipped) {
    const pages = await db.prepare("SELECT payload FROM official_sync_api_page WHERE run_id = ? ORDER BY term, page").bind(runId).all<{ payload: string }>();
    for (const row of pages.results) {
      const payload: unknown = JSON.parse(row.payload);
      for (const service of Array.isArray(payload) ? payload.map(parseOfficialService) : []) {
        if (service?.name && service.serviceId) apiServices.set(service.serviceId, service);
      }
    }
  }
  const baseline = readRepositoryBaseline();
  const corrected = correctFromRepositoryBaseline(
    repairExtractionSpacing(removeExtractedContinuationFragments(repairKnownExtractionFragments(services))),
    baseline,
  );
  const enriched = enrichWithPublicApi(alignToRepositoryTaxonomy(corrected, baseline), [...apiServices.values()]);
  const quality = assessOfficialDataset(enriched.services, readMohwSeed().benchmark, baseline);
  if (!quality.passed) throw new Error(`데이터 품질 기준 미달: ${quality.reasons.join(" ")}`);
  return { services: enriched.services, documentCount: documents.length };
}

async function runStore(db: SqlDatabase, runId: string, progress: SyncProgress, now: number, memo: StepMemo): Promise<UnitResult> {
  memo.dataset ??= buildDataset(db, runId, progress);
  const { services } = await memo.dataset;
  const slice = services.slice(progress.stored, progress.stored + STORE_ROWS_PER_UNIT);
  const stored = progress.stored + slice.length;
  const next: SyncStage = stored >= services.length ? "promote" : "store";
  await db.batch([
    ...insertServicesStatement(db, runId, slice, progress.stored, now),
    ...runUnitStatements(db, runId, next, { ...progress, stored, total: services.length, failures: 0 }, now),
  ]);
  return { stage: next };
}

async function runPromote(db: SqlDatabase, runId: string, progress: SyncProgress, now: number): Promise<UnitResult> {
  const documents = await db.prepare("SELECT COUNT(*) AS count FROM official_source_document WHERE sync_run_id = ?").bind(runId).first<{ count: number }>();
  await db.batch([
    db.prepare(
      "UPDATE official_sync_run SET status = 'succeeded', completed_at = ?, service_count = ?, document_count = ?, error = '', stage = 'done', advanced_at = ? WHERE id = ? AND status = 'running'",
    ).bind(now, progress.total, documents?.count ?? 0, now, runId),
    db.prepare("DELETE FROM official_service_snapshot WHERE sync_run_id <> ? AND EXISTS (SELECT 1 FROM official_sync_run WHERE id = ? AND status = 'succeeded')").bind(runId, runId),
    db.prepare("DELETE FROM official_source_document WHERE sync_run_id <> ? AND EXISTS (SELECT 1 FROM official_sync_run WHERE id = ? AND status = 'succeeded')").bind(runId, runId),
    db.prepare("DELETE FROM official_sync_api_page WHERE run_id = ?").bind(runId),
  ]);
  return { stage: "succeeded" };
}

async function failRun(db: SqlDatabase, runId: string, message: string, now: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE official_sync_run SET status = 'failed', completed_at = ?, error = ?, advanced_at = ? WHERE id = ?").bind(now, message.slice(0, 1000), now, runId),
    db.prepare("DELETE FROM official_service_snapshot WHERE sync_run_id = ?").bind(runId),
    db.prepare("DELETE FROM official_source_document WHERE sync_run_id = ?").bind(runId),
    db.prepare("DELETE FROM official_sync_api_page WHERE run_id = ?").bind(runId),
  ]);
}

function runUnit(db: SqlDatabase, sources: SyncSources, runId: string, stage: SyncStage, progress: SyncProgress, now: number, memo: StepMemo): Promise<UnitResult> {
  switch (stage) {
    case "documents": return runDocuments(db, sources, runId, progress, now);
    case "previews": return runPreviews(db, sources, runId, progress, now);
    case "api": return runApi(db, sources, runId, progress, now);
    case "store": return runStore(db, runId, progress, now, memo);
    case "promote": return runPromote(db, runId, progress, now);
    default: {
      const unreachable: never = stage;
      throw new Error(`알 수 없는 수집 단계: ${String(unreachable)}`);
    }
  }
}

/**
 * 수집 한 단계를 실행한다. 작업 단위를 최소 하나 하고, 기한(deadline, 밀리초)이 지나면 멈춘다.
 * 같은 단위가 연속으로 MAX_UNIT_ATTEMPTS번 실패하면 수집을 실패로 정리한다.
 */
export async function advanceSyncRun(
  db: SqlDatabase,
  sources: SyncSources,
  runId: string,
  clock: { readonly deadline: number; readonly nowMs: () => number },
): Promise<StepOutcome> {
  const memo: StepMemo = {};
  do {
    const state = await readSyncProgress(db, runId);
    if (!state) return "idle";
    const now = Math.floor(clock.nowMs() / 1000);
    try {
      const result = await runUnit(db, sources, runId, state.stage, state.progress, now, memo);
      if (result.stage === "succeeded") return "succeeded";
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 수집 오류";
      const failures = state.progress.failures + 1;
      if (failures >= MAX_UNIT_ATTEMPTS) {
        await failRun(db, runId, message, now);
        return "failed";
      }
      await db.batch(runUnitStatements(db, runId, state.stage, { ...state.progress, failures }, now));
      return "continuing";
    }
  } while (clock.nowMs() < clock.deadline);
  return "continuing";
}
