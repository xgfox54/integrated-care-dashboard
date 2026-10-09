// 문서 사실 반입 상태 관리(작업지시서 v5 §10.4·10.6·10.8·10.9).
// received → (finalize: 조립·해시·검사) → staged | rejected → approved(해시·정책 epoch에 묶임) → active(CAS) → superseded.
// 활성화 직전에 정책 epoch·차단·주체 존재·원본 버전 순서를 다시 확인한다. 실패해도 마지막 활성 자료는 그대로 둔다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { sha256OfBytes, validatePack, type ImportProblem, type ValidatedPack } from "./pack.ts";
import { BUDGET_IMPORT_FORMAT, validateBudgetArchive } from "./budget-pack.ts";
import { budgetReport, readActiveBudgetRevisions, stageBudgetStatements, staleBudgetDocuments, switchActiveBudget, unknownFiscalEntities } from "./budget-store.ts";

export const CHUNK_MAX_BYTES = 512 * 1024;
export const ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;

export class ImportError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ImportRow {
  readonly import_id: string;
  readonly artifact_id: string;
  readonly archive_sha256: string;
  readonly size_bytes: number;
  readonly total_chunks: number;
  readonly received_chunks: number;
  readonly status: string;
  readonly format: string;
  readonly manifest_json: string;
  readonly report_json: string;
  readonly scope_json: string;
  readonly received_at: number;
  readonly staged_at: number | null;
  readonly approved_at: number | null;
  readonly approved_hash: string | null;
  readonly approved_epoch: number | null;
  readonly activated_at: number | null;
  readonly updated_at: number;
}

/** 서버가 확인할 공개 주체 존재 여부(service: ID). docprog: 주체는 문서가 정의하므로 확인 대상이 아니다. */
export type SubjectChecker = (serviceIds: readonly string[]) => Promise<ReadonlySet<string>>;

const HEX64 = /^[a-f0-9]{64}$/;

async function importIdOf(artifactId: string, archiveSha256: string): Promise<string> {
  return "imp_" + (await sha256OfBytes(new TextEncoder().encode(artifactId + "|" + archiveSha256))).slice(0, 20);
}

export async function readImport(db: SqlDatabase, importId: string): Promise<ImportRow | null> {
  return db.prepare("SELECT * FROM import_artifact WHERE import_id = ?").bind(importId).first<ImportRow>();
}

/** 반입 시작. 같은 artifact·같은 해시는 기존 상태를 돌려주고(재시도), 같은 artifact·다른 해시는 거절한다. */
export async function beginImport(
  db: SqlDatabase,
  input: { readonly artifactId: string; readonly archiveSha256: string; readonly sizeBytes: number; readonly totalChunks: number },
  now: number,
): Promise<{ readonly row: ImportRow; readonly resumed: boolean; readonly chunks: readonly { index: number; sha256: string }[] }> {
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(input.artifactId)) throw new ImportError("ARTIFACT_ID_INVALID", "artifact_id 형식이 올바르지 않습니다.", 400);
  if (!HEX64.test(input.archiveSha256)) throw new ImportError("ARCHIVE_SHA256_INVALID", "archive_sha256은 소문자 16진수 64자여야 합니다.", 400);
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > ARCHIVE_MAX_BYTES) throw new ImportError("ARCHIVE_TOO_LARGE", "묶음 크기가 허용 범위(25MiB)를 벗어납니다.", 400);
  const expectedChunks = Math.ceil(input.sizeBytes / CHUNK_MAX_BYTES);
  if (input.totalChunks !== expectedChunks) throw new ImportError("CHUNK_COUNT_INVALID", "청크 수는 크기 ÷ 512KiB(올림)와 같아야 합니다.", 400);
  const existing = await db.prepare("SELECT * FROM import_artifact WHERE artifact_id = ?").bind(input.artifactId).first<ImportRow>();
  if (existing) {
    if (existing.archive_sha256 !== input.archiveSha256) throw new ImportError("ARTIFACT_ID_CONFLICT", "같은 artifact_id로 다른 내용이 이미 반입되었습니다. 새 artifact_id로 만들어 주세요.");
    if (existing.size_bytes !== input.sizeBytes || existing.total_chunks !== input.totalChunks) throw new ImportError("ARCHIVE_METADATA_CONFLICT", "기존 반입의 파일 크기·청크 수와 선언이 다릅니다.");
    const chunks = existing.status === "received" ? (await db.prepare("SELECT chunk_index AS 'index', sha256 FROM import_chunk WHERE import_id = ? ORDER BY chunk_index").bind(existing.import_id).all<{ index: number; sha256: string }>()).results : [];
    return { row: existing, resumed: true, chunks };
  }
  const importId = await importIdOf(input.artifactId, input.archiveSha256);
  await db.prepare(
    "INSERT INTO import_artifact (import_id, artifact_id, archive_sha256, size_bytes, total_chunks, status, received_at, updated_at) VALUES (?, ?, ?, ?, ?, 'received', ?, ?)",
  ).bind(importId, input.artifactId, input.archiveSha256, input.sizeBytes, input.totalChunks, now, now).run();
  return { row: (await readImport(db, importId))!, resumed: false, chunks: [] };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** 청크 하나 저장. 같은 번호·같은 내용 재전송은 무시하고, 다른 내용이면 거절한다. */
export async function putChunk(db: SqlDatabase, importId: string, index: number, bytes: Uint8Array, now: number): Promise<ImportRow> {
  const row = await readImport(db, importId);
  if (!row) throw new ImportError("IMPORT_NOT_FOUND", "반입 작업을 찾지 못했습니다.", 404);
  if (row.status !== "received") throw new ImportError("IMPORT_NOT_RECEIVING", "이미 조립을 마친 반입입니다(상태 " + row.status + ").");
  if (!Number.isInteger(index) || index < 0 || index >= row.total_chunks) throw new ImportError("CHUNK_INDEX_INVALID", "청크 번호가 범위를 벗어납니다.", 400);
  const last = index === row.total_chunks - 1;
  const expected = last ? row.size_bytes - CHUNK_MAX_BYTES * (row.total_chunks - 1) : CHUNK_MAX_BYTES;
  if (bytes.length !== expected) throw new ImportError("CHUNK_SIZE_INVALID", "청크 크기가 선언한 묶음 크기와 맞지 않습니다.", 400);
  const sha = await sha256OfBytes(bytes);
  const known = await db.prepare("SELECT sha256 FROM import_chunk WHERE import_id = ? AND chunk_index = ?").bind(importId, index).first<{ sha256: string }>();
  if (known) {
    if (known.sha256 !== sha) throw new ImportError("CHUNK_CONFLICT", "이미 받은 청크와 내용이 다릅니다.");
    return row;
  }
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO import_chunk (import_id, chunk_index, sha256, data_b64) VALUES (?, ?, ?, ?)").bind(importId, index, sha, toBase64(bytes)),
    db.prepare("UPDATE import_artifact SET received_chunks = (SELECT COUNT(*) FROM import_chunk WHERE import_id = ?), updated_at = ? WHERE import_id = ?").bind(importId, now, importId),
  ]);
  return (await readImport(db, importId))!;
}

function report(problems: readonly ImportProblem[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ problems: problems.slice(0, 50), problem_count: problems.length, ...extra });
}

/** 모든 청크를 조립해 해시를 확인하고 내용을 검사한다. 통과하면 staged, 아니면 rejected. 청크는 지운다. */
export async function finalizeImport(db: SqlDatabase, importId: string, subjects: SubjectChecker, now: number): Promise<ImportRow> {
  const row = await readImport(db, importId);
  if (!row) throw new ImportError("IMPORT_NOT_FOUND", "반입 작업을 찾지 못했습니다.", 404);
  if (row.status !== "received") return row;
  const chunks = (await db.prepare("SELECT chunk_index, data_b64 FROM import_chunk WHERE import_id = ? ORDER BY chunk_index").bind(importId).all<{ chunk_index: number; data_b64: string }>()).results;
  if (chunks.length !== row.total_chunks) throw new ImportError("CHUNKS_INCOMPLETE", "아직 받지 못한 청크가 있습니다(" + chunks.length + "/" + row.total_chunks + ").");
  const claimed = await db.prepare("UPDATE import_artifact SET status = 'validating', updated_at = ? WHERE import_id = ? AND status = 'received' RETURNING import_id").bind(now, importId).first<{ import_id: string }>();
  if (!claimed) return (await readImport(db, importId))!;
  const validate = async () => {
    const archive = new Uint8Array(row.size_bytes);
    let offset = 0;
    for (const chunk of chunks) {
      const bytes = fromBase64(chunk.data_b64);
      archive.set(bytes, offset);
      offset += bytes.length;
    }
    const finish = async (status: string, reportJson: string, extra: SqlStatement[] = []) => {
      await db.batch([
        ...extra,
        db.prepare("UPDATE import_artifact SET status = ?, report_json = ?, staged_at = CASE WHEN ? = 'staged' THEN ? ELSE staged_at END, updated_at = ? WHERE import_id = ?").bind(status, reportJson, status, now, now, importId),
        db.prepare("DELETE FROM import_chunk WHERE import_id = ?").bind(importId),
      ]);
      return (await readImport(db, importId))!;
    };
    if ((await sha256OfBytes(archive)) !== row.archive_sha256) return finish("rejected", report([{ code: "ARCHIVE_HASH_MISMATCH", path: "" }]));
    // 예산서 묶음(welfare-budget-document-v1)은 따로 검사·저장한다. 공개 절차(승인·활성화·되돌리기·차단)는 같다.
    const budget = await validateBudgetArchive(archive);
    if (budget) {
      if (!budget.ok) return finish("rejected", report(budget.problems));
      const { pack } = budget;
      if (pack.artifactId !== row.artifact_id) return finish("rejected", report([{ code: "ARTIFACT_ID_MISMATCH", path: "manifest.json", field: "artifact_id" }]));
      const unknown = await unknownFiscalEntities(db, pack);
      if (unknown.length) return finish("rejected", report(unknown.map((id) => ({ code: "FISCAL_ENTITY_UNKNOWN", path: "data/budget/documents.jsonl", field: id }))));
      const blockedDocs = await blockedSources(db, pack.documentIds);
      if (blockedDocs.length) return finish("rejected", report(blockedDocs.map((id) => ({ code: "SOURCE_BLOCKED", path: "manifest.json", field: id }))));
      return finish("staged", report([], budgetReport(pack, unknown)), [
        db.prepare("UPDATE import_artifact SET format = ?, manifest_json = ?, scope_json = ? WHERE import_id = ?").bind(BUDGET_IMPORT_FORMAT, JSON.stringify({ ...pack.manifest, validation: undefined }), JSON.stringify({ source_ids: pack.documentIds, empty_replace_source_ids: [] }), importId),
        ...stageBudgetStatements(db, importId, pack),
      ]);
    }
    const result = await validatePack(archive);
    if (!result.ok) return finish("rejected", report(result.problems));
    const { pack } = result;
    if (pack.artifactId !== row.artifact_id) return finish("rejected", report([{ code: "ARTIFACT_ID_MISMATCH", path: "manifest.json", field: "artifact_id" }]));
    const missing = await missingSubjects(pack, subjects);
    if (missing.length) return finish("rejected", report(missing.map((id) => ({ code: "SUBJECT_NOT_FOUND", path: "data/knowledge/statements.jsonl", field: id }))));
    const blocked = await blockedSources(db, pack.scopeSourceIds);
    if (blocked.length) return finish("rejected", report(blocked.map((id) => ({ code: "SOURCE_BLOCKED", path: "manifest.json", field: id }))));
    // 원문 동등성(T74): 같은 Source에 바이트가 다른 원문(형식이 바뀐 HWP→HWPX 등)이 오면 같은 문서로 합치지 않고 새 원문 버전으로 알린다.
    const activeVersions = (await db.prepare(
      "SELECT a.source_id, a.source_version_id, s.format, s.raw_sha256 FROM doc_active_source a JOIN doc_source s ON s.import_id = a.import_id AND s.source_version_id = a.source_version_id WHERE a.source_id IN (SELECT value FROM json_each(?))",
    ).bind(JSON.stringify(pack.scopeSourceIds)).all<{ source_id: string; source_version_id: string; format: string; raw_sha256: string }>()).results;
    const versionChanges = pack.sources.flatMap((source) => {
      const active = activeVersions.find((row) => row.source_id === source.source_id);
      if (!active || active.raw_sha256 === source.raw_sha256) return [];
      return [{ source_id: source.source_id, previous_version: active.source_version_id, previous_format: active.format, new_version: source.source_version_id, new_format: source.format, format_changed: active.format !== source.format }];
    });
    return finish("staged", report([], { counts: { sources: pack.sources.length, statements: pack.statements.length, evidence: pack.evidence.length }, content_digest: pack.contentDigest, version_changes: versionChanges }), [
      db.prepare("UPDATE import_artifact SET format = ?, manifest_json = ?, scope_json = ? WHERE import_id = ?").bind(String(pack.manifest.format), JSON.stringify(pack.manifest), JSON.stringify({ source_ids: pack.scopeSourceIds, empty_replace_source_ids: pack.emptyReplaceSourceIds }), importId),
      ...stageStatements(db, importId, pack),
    ]);
  };
  try { return await validate(); }
  catch (error) {
    // 통신·DB 오류는 내용 불합격과 구분한다. 받은 청크를 보존하고 같은 파일로 다시 검사할 수 있게 한다.
    await db.prepare("UPDATE import_artifact SET status = 'received', updated_at = ? WHERE import_id = ? AND status = 'validating' AND updated_at = ?").bind(now, importId, now).run();
    throw error;
  }
}

async function missingSubjects(pack: ValidatedPack, subjects: SubjectChecker): Promise<string[]> {
  const serviceIds = [...new Set(pack.statements.map((statement) => statement.subject_id).filter((id) => id.startsWith("service:")))];
  if (!serviceIds.length) return [];
  const found = await subjects(serviceIds);
  return serviceIds.filter((id) => !found.has(id));
}

async function blockedSources(db: SqlDatabase, sourceIds: readonly string[]): Promise<string[]> {
  if (!sourceIds.length) return [];
  const rows = (await db.prepare("SELECT source_id FROM doc_block WHERE source_id IN (" + sourceIds.map(() => "?").join(",") + ")").bind(...sourceIds).all<{ source_id: string }>()).results;
  return rows.map((row) => row.source_id);
}

function stageStatements(db: SqlDatabase, importId: string, pack: ValidatedPack): SqlStatement[] {
  return [
    db.prepare("DELETE FROM doc_source WHERE import_id = ?").bind(importId),
    db.prepare("DELETE FROM doc_statement WHERE import_id = ?").bind(importId),
    db.prepare("DELETE FROM doc_evidence WHERE import_id = ?").bind(importId),
    ...pack.sources.map((source) => db.prepare(
      "INSERT INTO doc_source (import_id, source_version_id, source_id, source_kind, title, issuer, issuer_sido, issuer_sigungu, document_number, url, published_date, retrieved_at, raw_sha256, format, parse_id, parser, adapter_version, locator_precision, page_mode, rights_basis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(importId, source.source_version_id, source.source_id, source.source_kind, source.title, source.issuer, source.issuer_sido, source.issuer_sigungu, source.document_number, source.url, source.published_date, source.retrieved_at, source.raw_sha256, source.format, source.parse_id, source.parser, source.adapter_version, source.locator_precision, source.page_mode, source.rights_basis)),
    ...pack.statements.map((statement) => db.prepare(
      "INSERT INTO doc_statement (import_id, statement_id, subject_id, subject_label, subject_sido, subject_sigungu, predicate_id, value_text, unit, scope_text, source_version_id, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(importId, statement.statement_id, statement.subject_id, statement.subject_label, statement.subject_sido, statement.subject_sigungu, statement.predicate_id, statement.value_text, statement.unit, statement.scope_text, statement.source_version_id, statement.reviewed_at)),
    ...pack.evidence.map((evidence) => db.prepare(
      "INSERT INTO doc_evidence (import_id, evidence_id, statement_id, source_version_id, parse_id, block_id, ir_pointer, table_id, cell, locator_precision, page_mode, layout_page_start, physical_page_verified, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(importId, evidence.evidence_id, evidence.statement_id, evidence.source_version_id, evidence.parse_id, evidence.block_id, evidence.ir_pointer, evidence.table_id, evidence.cell, evidence.locator_precision, evidence.page_mode, evidence.layout_page_start, evidence.physical_page_verified ? 1 : 0, evidence.quote)),
  ];
}

async function policyEpoch(db: SqlDatabase): Promise<{ revision: number; policy_epoch: number }> {
  return (await db.prepare("SELECT revision, policy_epoch FROM doc_active WHERE id = 1").first<{ revision: number; policy_epoch: number }>()) ?? { revision: 0, policy_epoch: 0 };
}

/** 관리자 승인. 관리자가 본 해시와 지금 staged 묶음의 해시가 같아야 하고, 승인 당시 정책 epoch를 함께 기록한다. */
export async function approveImport(db: SqlDatabase, importId: string, archiveSha256: string, now: number): Promise<ImportRow> {
  const row = await readImport(db, importId);
  if (!row) throw new ImportError("IMPORT_NOT_FOUND", "반입 작업을 찾지 못했습니다.", 404);
  if (row.status !== "staged") throw new ImportError("IMPORT_NOT_STAGED", "검사를 통과한(staged) 반입만 승인할 수 있습니다(상태 " + row.status + ").");
  if (row.archive_sha256 !== archiveSha256) throw new ImportError("APPROVED_HASH_MISMATCH", "승인하려는 해시가 반입된 묶음의 해시와 다릅니다.");
  const { policy_epoch } = await policyEpoch(db);
  await db.prepare("UPDATE import_artifact SET status = 'approved', approved_at = ?, approved_hash = ?, approved_epoch = ?, updated_at = ? WHERE import_id = ? AND status = 'staged'")
    .bind(now, archiveSha256, policy_epoch, now, importId).run();
  return (await readImport(db, importId))!;
}

/** 검토한 해시 한 개를 승인·공개한다. 대기열은 이 함수를 순차 호출하며 기존 검사 조건을 그대로 거친다. */
export async function publishImport(db: SqlDatabase, importId: string, archiveSha256: string, subjects: SubjectChecker, now: number): Promise<ImportRow> {
  let row = await readImport(db, importId);
  if (!row) throw new ImportError("IMPORT_NOT_FOUND", "반입 작업을 찾지 못했습니다.", 404);
  if (row.archive_sha256 !== archiveSha256) throw new ImportError("APPROVED_HASH_MISMATCH", "검토한 해시가 반입된 묶음의 해시와 다릅니다.");
  if (row.status === "active") return row;
  try {
    if (row.status === "staged") row = await approveImport(db, importId, archiveSha256, now);
    if (row.status !== "approved") throw new ImportError("IMPORT_NOT_PUBLISHABLE", "검사를 통과한 반입만 승인·공개할 수 있습니다(상태 " + row.status + ").");
    return await activateImport(db, importId, subjects, now);
  }
  catch (error) {
    // 응답을 받기 전에 다른 동일 요청이 끝났다면 이미 완료된 결과를 돌려준다.
    const latest = await readImport(db, importId);
    if (latest?.status === "active" && latest.archive_sha256 === archiveSha256) return latest;
    throw error;
  }
}

export async function rejectImport(db: SqlDatabase, importId: string, now: number): Promise<ImportRow> {
  const row = await readImport(db, importId);
  if (!row) throw new ImportError("IMPORT_NOT_FOUND", "반입 작업을 찾지 못했습니다.", 404);
  if (!["received", "staged", "approved"].includes(row.status)) throw new ImportError("IMPORT_NOT_REJECTABLE", "이 상태에서는 거절할 수 없습니다(상태 " + row.status + ").");
  await db.batch([
    db.prepare("UPDATE import_artifact SET status = 'rejected', report_json = json_set(report_json, '$.rejected_by_admin', 1), updated_at = ? WHERE import_id = ?").bind(now, importId),
    db.prepare("DELETE FROM import_chunk WHERE import_id = ?").bind(importId),
  ]);
  return (await readImport(db, importId))!;
}

/**
 * 활성화. 승인 뒤 정책이 바뀌었으면 다시 검토(staged)로 돌린다. 차단된 Source·사라진 주체·더 새 원본이 이미 활성인 Source가 있으면
 * 활성화하지 않는다. 활성 포인터는 revision CAS로 바꾸고, 같은 batch 안의 모든 쓰기가 그 CAS 성공에 묶인다.
 */
export async function activateImport(db: SqlDatabase, importId: string, subjects: SubjectChecker, now: number): Promise<ImportRow> {
  const row = await readImport(db, importId);
  if (!row) throw new ImportError("IMPORT_NOT_FOUND", "반입 작업을 찾지 못했습니다.", 404);
  if (row.status !== "approved") throw new ImportError("IMPORT_NOT_APPROVED", "승인된 반입만 활성화할 수 있습니다(상태 " + row.status + ").");
  if (row.approved_hash !== row.archive_sha256) throw new ImportError("APPROVED_HASH_MISMATCH", "승인한 해시와 반입 해시가 다릅니다.");
  const pointer = await policyEpoch(db);
  const back = async (code: string, field = "") => {
    await db.prepare("UPDATE import_artifact SET status = 'staged', approved_at = NULL, approved_hash = NULL, approved_epoch = NULL, report_json = json_set(report_json, '$.reapproval_required', ?), updated_at = ? WHERE import_id = ? AND status = 'approved'")
      .bind(code + (field ? ":" + field : ""), now, importId).run();
    throw new ImportError(code, code === "POLICY_CHANGED_SINCE_APPROVAL" ? "승인 뒤 공개 정책(차단 목록)이 바뀌어 다시 검토해야 합니다." : "활성화 조건이 바뀌어 다시 검토해야 합니다: " + code + (field ? " " + field : ""));
  };
  if (row.approved_epoch !== pointer.policy_epoch) return back("POLICY_CHANGED_SINCE_APPROVAL");
  const scope = JSON.parse(row.scope_json) as { source_ids: string[]; empty_replace_source_ids: string[] };
  const blocked = await blockedSources(db, scope.source_ids);
  if (blocked.length) return back("SOURCE_BLOCKED", blocked.join(","));
  if (row.format === BUDGET_IMPORT_FORMAT) {
    const stale = await staleBudgetDocuments(db, importId);
    if (stale.length) {
      await db.prepare("UPDATE import_artifact SET status = 'rejected', report_json = json_set(report_json, '$.stale', ?), updated_at = ? WHERE import_id = ?").bind(stale.join(","), now, importId).run();
      throw new ImportError("STALE_SOURCE_VERSION", stale.join(",") + "에는 더 새로 받은 원문으로 만든 예산서가 이미 공개 중입니다. 오래된 묶음은 덮어쓰지 않습니다.");
    }
    await switchActiveBudget(db, importId, "approved", now);
    const after = await readImport(db, importId);
    if (after?.status !== "active") throw new ImportError("ACTIVATION_RACE", "다른 활성화가 먼저 끝났습니다. 상태를 새로 읽고 다시 시도해 주세요.");
    return after;
  }
  const serviceIds = (await db.prepare("SELECT DISTINCT subject_id FROM doc_statement WHERE import_id = ? AND subject_id LIKE 'service:%'").bind(importId).all<{ subject_id: string }>()).results.map((item) => item.subject_id);
  if (serviceIds.length) {
    const found = await subjects(serviceIds);
    const gone = serviceIds.filter((id) => !found.has(id));
    if (gone.length) return back("SUBJECT_NOT_FOUND", gone.slice(0, 5).join(","));
  }
  const incoming = (await db.prepare("SELECT source_id, source_version_id, retrieved_at FROM doc_source WHERE import_id = ?").bind(importId).all<{ source_id: string; source_version_id: string; retrieved_at: string }>()).results;
  const active = scope.source_ids.length
    ? (await db.prepare("SELECT source_id, source_version_id, retrieved_at FROM doc_active_source WHERE source_id IN (" + scope.source_ids.map(() => "?").join(",") + ")").bind(...scope.source_ids).all<{ source_id: string; source_version_id: string; retrieved_at: string }>()).results
    : [];
  const activeBy = new Map(active.map((item) => [item.source_id, item]));
  for (const source of incoming) {
    const current = activeBy.get(source.source_id);
    if (current && Date.parse(current.retrieved_at) > Date.parse(source.retrieved_at)) {
      await db.prepare("UPDATE import_artifact SET status = 'rejected', report_json = json_set(report_json, '$.stale', ?), updated_at = ? WHERE import_id = ?").bind(source.source_id, now, importId).run();
      throw new ImportError("STALE_SOURCE_VERSION", source.source_id + "에는 더 새로 받은 원본으로 만든 자료가 이미 공개 중입니다. 오래된 묶음은 덮어쓰지 않습니다.");
    }
  }
  return switchActiveImport(db, importId, scope.source_ids, pointer, "approved", now);
}

/** 활성 포인터 교체(revision CAS). 같은 batch 안의 모든 쓰기가 CAS 성공에 묶인다. */
async function switchActiveImport(db: SqlDatabase, importId: string, sourceIds: readonly string[], pointer: { readonly revision: number; readonly policy_epoch: number }, fromStatus: "approved" | "superseded", now: number): Promise<ImportRow> {
  const nextRevision = pointer.revision + 1;
  const guard = "(SELECT last_import_id FROM doc_active WHERE id = 1) = ? AND (SELECT revision FROM doc_active WHERE id = 1) = ?";
  const placeholders = sourceIds.map(() => "?").join(",");
  await db.batch([
    db.prepare("UPDATE doc_active SET revision = revision + 1, last_import_id = ?, updated_at = ? WHERE id = 1 AND revision = ? AND policy_epoch = ?").bind(importId, now, pointer.revision, pointer.policy_epoch),
    db.prepare("DELETE FROM doc_active_source WHERE source_id IN (" + placeholders + ") AND " + guard).bind(...sourceIds, importId, nextRevision),
    db.prepare("INSERT INTO doc_active_source (source_id, import_id, source_version_id, retrieved_at, activated_at) SELECT source_id, import_id, source_version_id, retrieved_at, ? FROM doc_source WHERE import_id = ? AND " + guard).bind(now, importId, importId, nextRevision),
    db.prepare("UPDATE import_artifact SET status = 'active', activated_at = ?, updated_at = ? WHERE import_id = ? AND status = ? AND " + guard).bind(now, now, importId, fromStatus, importId, nextRevision),
    db.prepare("UPDATE import_artifact SET status = 'superseded', updated_at = ? WHERE status = 'active' AND format <> ? AND import_id <> ? AND import_id NOT IN (SELECT import_id FROM doc_active_source) AND " + guard).bind(now, BUDGET_IMPORT_FORMAT, importId, importId, nextRevision),
  ]);
  const after = await readImport(db, importId);
  if (after?.status !== "active") throw new ImportError("ACTIVATION_RACE", "다른 활성화가 먼저 끝났습니다. 상태를 새로 읽고 다시 시도해 주세요.");
  return after;
}

/**
 * 되돌리기(T139): 새 묶음으로 바뀐(superseded) 이전 반입을 그 Source들에 다시 공개한다. 승인 해시·정책 epoch이 그대로이고
 * 차단된 Source·사라진 주체가 없을 때만 한다. 더 새 원본이 공개 중이어도 관리자가 고른 되돌리기라 허용하고 restored_at을 남긴다.
 * 차단 목록·정책 epoch은 되돌리지 않는다(과거 공개 차단을 지우지 않음).
 */
export async function restoreImport(db: SqlDatabase, importId: string, subjects: SubjectChecker, now: number): Promise<ImportRow> {
  const row = await readImport(db, importId);
  if (!row) throw new ImportError("IMPORT_NOT_FOUND", "반입 작업을 찾지 못했습니다.", 404);
  if (row.status !== "superseded" || !row.activated_at) throw new ImportError("IMPORT_NOT_RESTORABLE", "이전에 공개했다가 새 묶음으로 바뀐 반입만 되돌릴 수 있습니다(상태 " + row.status + ").");
  if (row.approved_hash !== row.archive_sha256) throw new ImportError("APPROVED_HASH_MISMATCH", "승인한 해시와 반입 해시가 다릅니다.");
  const pointer = await policyEpoch(db);
  if (row.approved_epoch !== pointer.policy_epoch) throw new ImportError("POLICY_CHANGED_SINCE_APPROVAL", "승인 뒤 공개 차단 목록이 바뀌어 되돌릴 수 없습니다. 같은 묶음을 다시 반입해 검토해 주세요.");
  const scope = JSON.parse(row.scope_json) as { source_ids: string[] };
  const blocked = await blockedSources(db, scope.source_ids);
  if (blocked.length) throw new ImportError("SOURCE_BLOCKED", "차단된 Source가 있어 되돌릴 수 없습니다: " + blocked.join(","));
  if (row.format === BUDGET_IMPORT_FORMAT) {
    await switchActiveBudget(db, importId, "superseded", now);
    const after = await readImport(db, importId);
    if (after?.status !== "active") throw new ImportError("ACTIVATION_RACE", "다른 처리가 먼저 끝났습니다. 상태를 새로 읽고 다시 시도해 주세요.");
    await db.prepare("UPDATE import_artifact SET report_json = json_set(report_json, '$.restored_at', ?) WHERE import_id = ?").bind(now, importId).run();
    return (await readImport(db, importId))!;
  }
  const serviceIds = (await db.prepare("SELECT DISTINCT subject_id FROM doc_statement WHERE import_id = ? AND subject_id LIKE 'service:%'").bind(importId).all<{ subject_id: string }>()).results.map((item) => item.subject_id);
  if (serviceIds.length) {
    const found = await subjects(serviceIds);
    const gone = serviceIds.filter((id) => !found.has(id));
    if (gone.length) throw new ImportError("SUBJECT_NOT_FOUND", "현재 대시보드에 없는 사업을 가리켜 되돌릴 수 없습니다: " + gone.slice(0, 5).join(","));
  }
  const after = await switchActiveImport(db, importId, scope.source_ids, pointer, "superseded", now);
  await db.prepare("UPDATE import_artifact SET report_json = json_set(report_json, '$.restored_at', ?) WHERE import_id = ?").bind(now, importId).run();
  return after;
}

/** 공개 철회·전역 차단. 이후 같은 Source의 어떤 묶음도(과거 파일 재반입 포함) 다시 공개되지 않는다. */
export async function blockSource(db: SqlDatabase, sourceId: string, reason: string, now: number): Promise<void> {
  if (!/^doc:[a-z0-9-]{3,80}$/.test(sourceId)) throw new ImportError("SOURCE_ID_INVALID", "문서 Source ID 형식이 올바르지 않습니다.", 400);
  const text = reason.trim().slice(0, 200);
  if (!text) throw new ImportError("REASON_REQUIRED", "차단 사유를 적어 주세요.", 400);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO doc_block (source_id, reason, blocked_at) VALUES (?, ?, ?)").bind(sourceId, text, now),
    db.prepare("DELETE FROM doc_active_source WHERE source_id = ?").bind(sourceId),
    db.prepare("UPDATE doc_active SET revision = revision + 1, policy_epoch = policy_epoch + 1, updated_at = ? WHERE id = 1").bind(now),
    db.prepare("UPDATE import_artifact SET status = 'superseded', updated_at = ? WHERE status = 'active' AND format <> ? AND import_id NOT IN (SELECT import_id FROM doc_active_source)").bind(now, BUDGET_IMPORT_FORMAT),
    // 예산서 문서도 같은 차단 목록을 쓴다(doc:budget-… ID).
    db.prepare("DELETE FROM budget_active_revision WHERE document_id = ?").bind(sourceId),
    db.prepare("UPDATE import_artifact SET status = 'superseded', updated_at = ? WHERE status = 'active' AND format = ? AND import_id NOT IN (SELECT import_id FROM budget_active_revision)").bind(now, BUDGET_IMPORT_FORMAT),
  ]);
}

export async function readAdminImports(db: SqlDatabase) {
  const [imports, active, blocks, pointer, activeBudget] = await Promise.all([
    // 미완료 반입이 최근 공개 기록에 밀려 사라지지 않도록 먼저 보여 준다.
    db.prepare("SELECT import_id, artifact_id, archive_sha256, size_bytes, total_chunks, received_chunks, status, report_json, scope_json, received_at, staged_at, approved_at, activated_at FROM import_artifact ORDER BY CASE WHEN status IN ('received', 'validating', 'staged', 'approved') THEN 0 ELSE 1 END, received_at DESC LIMIT 200").all<Record<string, unknown>>(),
    db.prepare("SELECT a.source_id, a.import_id, a.source_version_id, a.retrieved_at, a.activated_at, s.title, s.issuer, (SELECT COUNT(*) FROM doc_statement t WHERE t.import_id = a.import_id AND t.source_version_id = a.source_version_id) AS statements FROM doc_active_source a JOIN doc_source s ON s.import_id = a.import_id AND s.source_version_id = a.source_version_id ORDER BY a.source_id").all<Record<string, unknown>>(),
    db.prepare("SELECT source_id, reason, blocked_at FROM doc_block ORDER BY blocked_at DESC").all<Record<string, unknown>>(),
    policyEpoch(db),
    readActiveBudgetRevisions(db),
  ]);
  return { imports: imports.results, active: active.results, blocks: blocks.results, pointer, active_budget: activeBudget };
}
