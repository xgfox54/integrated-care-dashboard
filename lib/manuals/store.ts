import { databaseIdentity, type SqlDatabase, type SqlStatement } from "../sql-database.ts";
import {
  MANUAL_ASSET_PREFIX, MANUAL_CORPUS_SCHEMA,
  type ManualAdvanceOptions, type ManualAdvanceResult, type ManualAssetLoader, type ManualComponent,
  type ManualCorpusBatch, type ManualCorpusManifest, type ManualCorpusProgress, type ManualCorpusState,
  type ManualCorpusSummary, type ManualDocumentInput, type ManualOriginalNameBasis, type ManualSectionInput,
} from "./types.ts";

const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_BATCH_ROWS = 200;
const REVISION = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const HASH = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
// Only the loader's fixed diagnostics may reach status storage. Never preserve
// a raw exception, arbitrary code, response body, key value, or matching prefix.
const ASSET_ERROR_CODES = new Set([
  "MANUAL_ENCRYPTED_MANIFEST_INVALID", "MANUAL_ENCRYPTED_DESCRIPTOR_INVALID",
  "MANUAL_ASSET_KEY_MISSING", "MANUAL_ASSET_KEY_INVALID", "MANUAL_ASSET_KEY_ID_MISMATCH", "MANUAL_ASSET_KEY_IMPORT_FAILED",
  "MANUAL_ASSET_ABORTED", "MANUAL_ENCRYPTED_ASSET_NOT_LISTED", "MANUAL_ENCRYPTED_ASSET_HTTP_ERROR",
  "MANUAL_ENCRYPTED_ASSET_SIZE_MISMATCH", "MANUAL_ENCRYPTED_ASSET_READ_FAILED", "MANUAL_ENCRYPTED_ASSET_HASH_MISMATCH",
  "MANUAL_ENCRYPTED_ASSET_HEADER_INVALID", "MANUAL_ENCRYPTED_ASSET_AUTH_FAILED",
  "MANUAL_ASSET_PLAINTEXT_SIZE_MISMATCH", "MANUAL_ASSET_GZIP_INVALID", "MANUAL_ASSET_PLAINTEXT_HASH_MISMATCH",
  "MANUAL_ENCRYPTED_ASSET_REQUEST_FAILED", "MANUAL_ENCRYPTED_ASSET_FETCH_FAILED",
  "MANUAL_ENCRYPTED_ASSET_READ_INIT_FAILED", "MANUAL_ENCRYPTED_ASSET_DIGEST_FAILED", "MANUAL_ASSET_GZIP_INIT_FAILED",
]);

interface CorpusRow extends ManualCorpusSummary, ManualCorpusProgress {
  readonly manifest_created_at: number;
  readonly lease_token: string | null;
  readonly lease_expires_at: number | null;
  readonly failure_count: number;
}

class ManualImportError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "ManualImportError"; this.code = code; }
}

function failureCode(error: unknown): string {
  if (error instanceof ManualImportError) return error.code;
  if (error instanceof Error && error.name === "ManualAssetError" && ASSET_ERROR_CODES.has(error.message)) return error.message;
  return "MANUAL_STORAGE_OR_ASSET_ERROR";
}

function requireValue(value: unknown, code: string): asserts value {
  if (!value) throw new ManualImportError(code);
}

function string(value: unknown, max: number, empty = true): value is string {
  return typeof value === "string" && value.length <= max && (empty || value.length > 0) && !value.includes("\0");
}

function integer(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function safePath(value: string): boolean {
  return !value.startsWith("/") && !value.includes("\\") && !/[\r\n\0]/.test(value) && value.split("/").every((part) => part !== "." && part !== ".." && part !== "");
}

export async function manualSha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Spaces and punctuation do not split a Korean substring; original content is stored separately without changes. */
export function manualSearchText(text: string): string {
  return text.normalize("NFKC").replace(/<[^>]*>/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function manualSourceYear(originalName: string, documentYear: string | null, basis: ManualOriginalNameBasis = "upstream_metadata"): { year: string | null; origin: "original_name" | "document_name" | "unknown" } {
  if (basis === "mixed_original_files") return { year: null, origin: "unknown" };
  const originals = [...new Set([...originalName.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((match) => match[1]))];
  if (originals.length === 1) return { year: originals[0], origin: "original_name" };
  if (originals.length > 1) return { year: null, origin: "unknown" };
  return documentYear ? { year: documentYear, origin: "document_name" } : { year: null, origin: "unknown" };
}

function validateManifest(manifest: ManualCorpusManifest): void {
  requireValue(manifest?.schema_version === MANUAL_CORPUS_SCHEMA && REVISION.test(manifest.revision), "MANUAL_MANIFEST_INVALID");
  requireValue(/^[a-f0-9]{40}$/.test(manifest.source_commit), "MANUAL_COMMIT_INVALID");
  let repository: URL;
  try { repository = new URL(manifest.source_repository); } catch { throw new ManualImportError("MANUAL_REPOSITORY_INVALID"); }
  requireValue(repository.protocol === "https:" && !repository.username && !repository.password && !repository.search && !repository.hash, "MANUAL_REPOSITORY_INVALID");
  requireValue(string(manifest.created_at, 40, false) && Number.isFinite(Date.parse(manifest.created_at)), "MANUAL_MANIFEST_TIME_INVALID");
  requireValue(integer(manifest.document_count, 1, 10_000) && integer(manifest.section_count, 1, 1_000_000), "MANUAL_MANIFEST_COUNTS_INVALID");
  requireValue(Array.isArray(manifest.batches) && manifest.batches.length > 0 && manifest.batches.length <= 10_000, "MANUAL_BATCHES_INVALID");
  const paths = new Set<string>();
  for (const batch of manifest.batches) {
    requireValue(string(batch.path, 500, false) && batch.path.startsWith(MANUAL_ASSET_PREFIX) && safePath(batch.path.slice(1)) && !/[?#%]/.test(batch.path) && batch.path.endsWith(".json"), "MANUAL_ASSET_PATH_INVALID");
    requireValue(!paths.has(batch.path) && HASH.test(batch.sha256) && integer(batch.bytes, 1, MAX_ASSET_BYTES), "MANUAL_ASSET_DESCRIPTOR_INVALID");
    requireValue(integer(batch.documents, 0, MAX_BATCH_ROWS) && integer(batch.sections, 0, MAX_BATCH_ROWS) && batch.documents + batch.sections > 0 && batch.documents + batch.sections <= MAX_BATCH_ROWS, "MANUAL_BATCH_COUNTS_INVALID");
    paths.add(batch.path);
  }
  requireValue(manifest.batches.reduce((sum, batch) => sum + batch.documents, 0) === manifest.document_count && manifest.batches.reduce((sum, batch) => sum + batch.sections, 0) === manifest.section_count, "MANUAL_MANIFEST_COUNTS_INVALID");
}

function validateDocument(document: ManualDocumentInput): void {
  requireValue(document && IDENTIFIER.test(document.document_id) && string(document.source_name, 500, false), "MANUAL_DOCUMENT_INVALID");
  requireValue(string(document.source_path, 1000, false) && safePath(document.source_path) && HASH.test(document.sha256), "MANUAL_DOCUMENT_SOURCE_INVALID");
  requireValue(integer(document.byte_size, 1, 100_000_000) && integer(document.section_count, 1, 1_000_000), "MANUAL_DOCUMENT_COUNTS_INVALID");
  requireValue(document.document_year === null || /^20\d{2}$/.test(document.document_year), "MANUAL_DOCUMENT_YEAR_INVALID");
  for (const key of ["category", "document_type", "publisher", "edition", "effective_from", "effective_to", "topic", "authority", "source_role", "jurisdiction"] as const) {
    requireValue(string(document[key], 1000), "MANUAL_DOCUMENT_METADATA_INVALID");
  }
}

async function validateSection(section: ManualSectionInput): Promise<void> {
  requireValue(section && IDENTIFIER.test(section.section_id) && IDENTIFIER.test(section.document_id), "MANUAL_SECTION_INVALID");
  requireValue(integer(section.ordinal, 0, 1_000_000) && integer(section.start_line, 1, 100_000_000) && integer(section.end_line, section.start_line, 100_000_000), "MANUAL_SECTION_LOCATION_INVALID");
  requireValue(string(section.node_id, 120) && string(section.title, 10_000) && string(section.heading_path, 30_000) && string(section.service_names, 30_000) && string(section.original_name, 2000), "MANUAL_SECTION_METADATA_INVALID");
  requireValue(string(section.upstream_original_name, 2000) && ["explicit_original_file_marker", "upstream_metadata", "mixed_original_files"].includes(section.original_name_basis), "MANUAL_ORIGINAL_NAME_INVALID");
  requireValue(section.original_name_basis === "explicit_original_file_marker" ? integer(section.original_name_line, 1, section.end_line) : section.original_name_line === null, "MANUAL_ORIGINAL_NAME_LOCATION_INVALID");
  requireValue(string(section.content, MAX_ASSET_BYTES, false) && HASH.test(section.content_hash), "MANUAL_SECTION_CONTENT_INVALID");
  requireValue(await manualSha256(encoder.encode(section.content)) === section.content_hash, "MANUAL_SECTION_HASH_MISMATCH");
}

async function validateBatch(bytes: Uint8Array, manifest: ManualCorpusManifest, index: number): Promise<ManualCorpusBatch> {
  const descriptor = manifest.batches[index];
  requireValue(bytes instanceof Uint8Array && bytes.byteLength === descriptor.bytes && bytes.byteLength <= MAX_ASSET_BYTES, "MANUAL_ASSET_SIZE_MISMATCH");
  requireValue(await manualSha256(bytes) === descriptor.sha256, "MANUAL_ASSET_HASH_MISMATCH");
  let batch: ManualCorpusBatch;
  try { batch = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as ManualCorpusBatch; }
  catch { throw new ManualImportError("MANUAL_ASSET_JSON_INVALID"); }
  requireValue(batch?.schema_version === MANUAL_CORPUS_SCHEMA && batch.revision === manifest.revision && batch.batch_index === index, "MANUAL_ASSET_ID_MISMATCH");
  requireValue(Array.isArray(batch.documents) && Array.isArray(batch.sections) && batch.documents.length === descriptor.documents && batch.sections.length === descriptor.sections, "MANUAL_ASSET_COUNTS_MISMATCH");
  batch.documents.forEach(validateDocument);
  await Promise.all(batch.sections.map(validateSection));
  requireValue(new Set(batch.documents.map((document) => document.document_id)).size === batch.documents.length && new Set(batch.sections.map((section) => section.section_id)).size === batch.sections.length, "MANUAL_ASSET_DUPLICATE_ID");
  return batch;
}

async function corpus(db: SqlDatabase, revision: string): Promise<CorpusRow | null> {
  return db.prepare("SELECT * FROM manual_corpus WHERE revision = ?").bind(revision).first<CorpusRow>();
}

// 활성화된 고정 revision의 요약은 바뀌지 않는다. 찾은 경우에만 실행 환경 안에서 10분 재사용한다(미활성은 매번 확인).
const readableRevisionCache = new WeakMap<object, Map<string, { at: number; value: ManualCorpusSummary }>>();
const READABLE_REVISION_TTL_MS = 10 * 60 * 1000;

export async function readableManualRevision(db: SqlDatabase, revision?: string): Promise<ManualCorpusSummary | null> {
  if (revision === undefined || revision === "") return readManualRevision(db, revision);
  const identity = databaseIdentity(db);
  const cache = readableRevisionCache.get(identity) ?? new Map<string, { at: number; value: ManualCorpusSummary }>();
  readableRevisionCache.set(identity, cache);
  const hit = cache.get(revision);
  if (hit && Date.now() - hit.at < READABLE_REVISION_TTL_MS) return hit.value;
  const value = await readManualRevision(db, revision);
  if (value) cache.set(revision, { at: Date.now(), value });
  return value;
}

async function readManualRevision(db: SqlDatabase, revision?: string): Promise<ManualCorpusSummary | null> {
  if (revision === "") return null;
  const row = revision === undefined
    ? await db.prepare("SELECT c.* FROM manual_active a JOIN manual_corpus c ON c.revision = a.revision WHERE a.id = 1 AND c.status = 'ACTIVE'").first<CorpusRow>()
    : REVISION.test(revision) ? await db.prepare("SELECT * FROM manual_corpus WHERE revision = ? AND status IN ('ACTIVE','SUPERSEDED') AND activated_at IS NOT NULL").bind(revision).first<CorpusRow>() : null;
  if (!row) return null;
  return { revision: row.revision, source_repository: row.source_repository, source_commit: row.source_commit, manifest_sha256: row.manifest_sha256, document_count: row.document_count, section_count: row.section_count, activated_at: row.activated_at };
}

export async function readManualCorpusState(db: SqlDatabase, revision?: string): Promise<ManualCorpusState> {
  const [active, ingestion] = await Promise.all([
    readableManualRevision(db, revision),
    db.prepare("SELECT revision, status, next_batch, batch_count, document_count, section_count, expected_documents, expected_sections, last_error, retry_after FROM manual_corpus ORDER BY manifest_created_at DESC, revision DESC LIMIT 1").first<ManualCorpusProgress>(),
  ]);
  return { active_revision: active?.revision ?? null, active, ingestion };
}

export async function manualCorpusComponent(db: SqlDatabase): Promise<ManualComponent> {
  const state = await readManualCorpusState(db);
  if (!state.active) return { id: null, status: "UNAVAILABLE", detail: { revision: null, reason: "완료·활성화된 매뉴얼 코퍼스가 없음", ingestion: state.ingestion } };
  return { id: "manuals:" + state.active.revision, status: "PARTIAL", detail: { ...state.active, ingestion: state.ingestion, locator_basis: "parsed_markdown_lines", physical_pages_verified: false, image_content_available: false, applicable_year_verified: false } };
}

const CLAIM = "EXISTS (SELECT 1 FROM manual_corpus WHERE revision = ? AND lease_token = ? AND next_batch = ? AND lease_expires_at > ?)";
const DOCUMENT_COLUMNS = ["corpus_revision", "document_id", "source_name", "source_path", "sha256", "byte_size", "document_year", "category", "document_type", "publisher", "edition", "effective_from", "effective_to", "topic", "authority", "source_role", "jurisdiction", "section_count"];
const SECTION_COLUMNS = ["corpus_revision", "section_id", "document_id", "ordinal", "node_id", "title", "heading_path", "service_names", "original_name", "upstream_original_name", "original_name_basis", "original_name_line", "start_line", "end_line", "content", "content_hash", "source_year", "source_year_origin", "original_search", "title_search", "heading_search", "search_text"];

/** Include the lease predicate in D1's 100-bind limit when grouping original rows. */
function insertRows(db: SqlDatabase, table: string, columns: readonly string[], rows: readonly (readonly unknown[])[], claim: readonly unknown[]): SqlStatement[] {
  const statements: SqlStatement[] = [];
  const groupSize = Math.floor((100 - claim.length) / columns.length);
  for (let offset = 0; offset < rows.length; offset += groupSize) {
    const group = rows.slice(offset, offset + groupSize);
    statements.push(db.prepare("INSERT INTO " + table + " (" + columns.join(",") + ") SELECT * FROM (VALUES " + group.map(() => "(" + columns.map(() => "?").join(",") + ")").join(",") + ") WHERE " + CLAIM).bind(...group.flat(), ...claim));
  }
  return statements;
}

async function stageBatch(db: SqlDatabase, manifest: ManualCorpusManifest, batch: ManualCorpusBatch, token: string, now: number): Promise<void> {
  const ids = [...new Set(batch.sections.map((section) => section.document_id))];
  const known = ids.length ? (await db.prepare("SELECT document_id, source_name, document_year FROM manual_document WHERE corpus_revision = ? AND document_id IN (SELECT value FROM json_each(?))").bind(manifest.revision, JSON.stringify(ids)).all<Pick<ManualDocumentInput, "document_id" | "source_name" | "document_year">>()).results : [];
  const documents = new Map([...known, ...batch.documents].map((document) => [document.document_id, document]));
  requireValue(ids.every((id) => documents.has(id)), "MANUAL_SECTION_DOCUMENT_MISSING");
  const documentRows = batch.documents.map((document) => [manifest.revision, document.document_id, document.source_name, document.source_path, document.sha256, document.byte_size, document.document_year, document.category, document.document_type, document.publisher, document.edition, document.effective_from, document.effective_to, document.topic, document.authority, document.source_role, document.jurisdiction, document.section_count]);
  const sectionRows = batch.sections.map((section) => {
    const document = documents.get(section.document_id)!;
    const year = manualSourceYear(section.original_name, document.document_year, section.original_name_basis);
    return [manifest.revision, section.section_id, section.document_id, section.ordinal, section.node_id, section.title, section.heading_path, section.service_names, section.original_name, section.upstream_original_name, section.original_name_basis, section.original_name_line, section.start_line, section.end_line, section.content, section.content_hash, year.year, year.origin, manualSearchText(section.original_name), manualSearchText(section.title), manualSearchText([document.source_name, section.heading_path, section.service_names, section.original_name].join(" ")), manualSearchText(section.content)];
  });
  const claim = [manifest.revision, token, batch.batch_index, now];
  await db.batch([
    ...insertRows(db, "manual_document", DOCUMENT_COLUMNS, documentRows, claim),
    ...insertRows(db, "manual_section", SECTION_COLUMNS, sectionRows, claim),
    db.prepare("UPDATE manual_corpus SET next_batch = next_batch + 1, document_count = document_count + ?, section_count = section_count + ?, lease_token = NULL, lease_expires_at = NULL, failure_count = 0, last_error = NULL, retry_after = NULL, updated_at = ? WHERE revision = ? AND " + CLAIM)
      .bind(batch.documents.length, batch.sections.length, now, manifest.revision, ...claim),
  ]);
}

async function activate(db: SqlDatabase, row: CorpusRow, token: string, now: number): Promise<void> {
  const counts = await db.prepare("SELECT (SELECT COUNT(*) FROM manual_document WHERE corpus_revision = ?) AS documents, (SELECT COUNT(*) FROM manual_section WHERE corpus_revision = ?) AS sections, (SELECT COUNT(*) FROM manual_document d WHERE d.corpus_revision = ? AND d.section_count <> (SELECT COUNT(*) FROM manual_section s WHERE s.corpus_revision = d.corpus_revision AND s.document_id = d.document_id)) AS mismatches")
    .bind(row.revision, row.revision, row.revision).first<{ documents: number; sections: number; mismatches: number }>();
  requireValue(counts && counts.documents === row.expected_documents && counts.sections === row.expected_sections && counts.mismatches === 0 && row.document_count === counts.documents && row.section_count === counts.sections, "MANUAL_FINAL_COUNTS_MISMATCH");
  const pointer = await db.prepare("SELECT a.generation, a.revision, c.manifest_created_at FROM manual_active a LEFT JOIN manual_corpus c ON c.revision = a.revision WHERE a.id = 1").first<{ generation: number; revision: string | null; manifest_created_at: number | null }>();
  requireValue(pointer, "MANUAL_POINTER_MISSING");
  requireValue(!pointer.revision || pointer.revision === row.revision || (pointer.manifest_created_at ?? 0) < row.manifest_created_at, "MANUAL_NEWER_CORPUS_ACTIVE");
  const claim = [row.revision, token, row.next_batch, now];
  const switched = "EXISTS (SELECT 1 FROM manual_active WHERE id = 1 AND revision = ? AND generation = ?)";
  await db.batch([
    db.prepare("UPDATE manual_active SET revision = ?, generation = generation + 1, updated_at = ? WHERE id = 1 AND generation = ? AND " + CLAIM).bind(row.revision, now, pointer.generation, ...claim),
    db.prepare("UPDATE manual_corpus SET status = 'SUPERSEDED' WHERE status = 'ACTIVE' AND revision <> ? AND " + switched).bind(row.revision, row.revision, pointer.generation + 1),
    db.prepare("UPDATE manual_corpus SET status = 'ACTIVE', activated_at = COALESCE(activated_at, ?), updated_at = ?, lease_token = NULL, lease_expires_at = NULL, last_error = NULL, retry_after = NULL, failure_count = 0 WHERE revision = ? AND " + switched + " AND " + CLAIM).bind(now, now, row.revision, row.revision, pointer.generation + 1, ...claim),
  ]);
}

/** Only deployment code may call this writer with the pinned compiled manifest and an internal asset loader. */
export async function advanceManualCorpus(db: SqlDatabase, loadAsset: ManualAssetLoader, manifest: ManualCorpusManifest, options: ManualAdvanceOptions = {}): Promise<ManualAdvanceResult> {
  validateManifest(manifest);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const maxMillis = Math.max(250, Math.min(15_000, options.maxMillis ?? 5_000));
  const leaseSeconds = Math.max(10, Math.min(120, options.leaseSeconds ?? 30));
  const deadline = Date.now() + maxMillis;
  const checkTime = () => requireValue(Date.now() < deadline, "MANUAL_TIME_BUDGET_EXCEEDED");
  const manifestHash = await manualSha256(encoder.encode(JSON.stringify(manifest)));
  let row = await corpus(db, manifest.revision);
  if (!row) {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO manual_corpus (revision, source_repository, source_commit, manifest_sha256, manifest_created_at, expected_documents, expected_sections, batch_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(manifest.revision, manifest.source_repository, manifest.source_commit, manifestHash, Math.floor(Date.parse(manifest.created_at) / 1000), manifest.document_count, manifest.section_count, manifest.batches.length, now(), now()),
      db.prepare("INSERT OR IGNORE INTO manual_active (id, revision, generation, updated_at) VALUES (1, NULL, 0, ?)").bind(now()),
    ]);
    row = await corpus(db, manifest.revision);
  }
  requireValue(row && row.manifest_sha256 === manifestHash, "MANUAL_MANIFEST_CONFLICT");
  const result = (status: ManualAdvanceResult["status"], next = row!.next_batch, code?: string): ManualAdvanceResult => ({ revision: manifest.revision, status, next_batch: next, batch_count: manifest.batches.length, ...(code ? { error_code: code } : {}) });
  if (row.status === "ACTIVE" || row.status === "SUPERSEDED") return result(row.status);
  if ((row.retry_after ?? 0) > now()) return result("RETRY_LATER");
  const newer = await db.prepare("SELECT c.manifest_created_at FROM manual_active a JOIN manual_corpus c ON c.revision = a.revision WHERE a.id = 1 AND c.revision <> ?").bind(row.revision).first<{ manifest_created_at: number }>();
  if (newer && newer.manifest_created_at >= row.manifest_created_at) return result("SUPERSEDED");
  checkTime();
  const token = crypto.randomUUID();
  const claimed = await db.prepare("UPDATE manual_corpus SET lease_token = ?, lease_expires_at = ?, updated_at = ? WHERE revision = ? AND status = 'STAGING' AND (lease_token IS NULL OR lease_expires_at <= ?) AND (retry_after IS NULL OR retry_after <= ?) RETURNING *")
    .bind(token, now() + leaseSeconds, now(), row.revision, now(), now()).first<CorpusRow>();
  if (!claimed) return result("BUSY");
  row = claimed;
  try {
    checkTime();
    if (row.next_batch === row.batch_count) {
      await activate(db, row, token, now());
    } else {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ManualImportError("MANUAL_ASSET_TIMEOUT")); }, Math.max(1, deadline - Date.now())); });
      let bytes: Uint8Array;
      try { bytes = await Promise.race([loadAsset(manifest.batches[row.next_batch].path, controller.signal), timeout]); }
      finally { if (timer) clearTimeout(timer); }
      checkTime();
      const batch = await validateBatch(bytes, manifest, row.next_batch);
      checkTime();
      await stageBatch(db, manifest, batch, token, now());
    }
    const after = await corpus(db, manifest.revision);
    requireValue(after, "MANUAL_CORPUS_MISSING");
    if (after.status === "ACTIVE") return result("ACTIVE", after.next_batch);
    if (after.next_batch > row.next_batch) return result("ADVANCED", after.next_batch);
    await db.prepare("UPDATE manual_corpus SET lease_token = NULL, lease_expires_at = NULL WHERE revision = ? AND lease_token = ?").bind(row.revision, token).run();
    return result("BUSY", after.next_batch);
  } catch (error) {
    const code = failureCode(error);
    await db.prepare("UPDATE manual_corpus SET lease_token = NULL, lease_expires_at = NULL, failure_count = failure_count + 1, last_error = ?, retry_after = ?, updated_at = ? WHERE revision = ? AND lease_token = ?")
      .bind(code, now() + Math.min(300, 5 * 2 ** Math.min(row.failure_count, 6)), now(), row.revision, token).run();
    return result(code === "MANUAL_NEWER_CORPUS_ACTIVE" ? "SUPERSEDED" : "FAILED", row.next_batch, code);
  }
}
