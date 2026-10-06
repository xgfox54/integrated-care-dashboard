// welfare-budget-document-v1 예산서 묶음 검사(작업지시서 v5 §22.7·22.9, T90·T91·T104). 순수 함수: DB·네트워크를 쓰지 않는다.
// 로컬에서 kordoc으로 파싱한 예산서(편성 단계 문서)의 계층 행을 받는다. 서버는 계층·금액 형식·부기명 규칙과
// 부모=자식합·재원합·「금액 - 앞 칸 = 비교증감」 검산을 다시 계산하고, 묶음이 「일치」라고 적은 검산이 서버 계산과 다르면 거절한다.
// 문서 금액은 그 문서·편성 단계의 값이다. 지방재정365 예산현액(기준일 현액)과 섞거나 서로 덮어쓰지 않는다.
import { readZip, ZipSafetyError, type ZipEntry } from "./zip.ts";
import { canonicalJson, sha256OfBytes, type ImportProblem } from "./pack.ts";

export const BUDGET_IMPORT_FORMAT = "welfare-budget-document-v1";
export const BUDGET_SCHEMA_VERSION = "budget-document-1";
export const BUDGET_STAGES = ["proposal", "adopted_initial", "adopted_supplementary", "settlement", "other", "unknown"] as const;
export type BudgetStage = (typeof BUDGET_STAGES)[number];
export const BUDGET_STAGE_LABELS: Record<BudgetStage, string> = {
  proposal: "예산안(요구·제출)", adopted_initial: "본예산(의결)", adopted_supplementary: "추가경정예산(의결)", settlement: "결산", other: "기타 문서", unknown: "단계 미확인",
};
/** 금액 오른쪽 칸의 뜻: 본예산 「전년도예산액」, 추경 「기정예산액」(이번 추경 직전까지 확정된 금액). */
export const PREVIOUS_COLUMNS = ["previous_year_budget", "pre_revision_budget", "none"] as const;
export type PreviousColumn = (typeof PREVIOUS_COLUMNS)[number];
export const BUDGET_LEVELS = ["department", "policy", "unit", "detail_project", "object_group", "object", "item", "sub_item"] as const;
export type BudgetLevel = (typeof BUDGET_LEVELS)[number];
export const BUDGET_LEVEL_LABELS: Record<BudgetLevel, string> = {
  department: "부서", policy: "정책사업", unit: "단위사업", detail_project: "세부사업", object_group: "편성목", object: "통계목", item: "부기", sub_item: "하위 산출항목",
};
const DEPTH: Record<BudgetLevel, number> = { department: 0, policy: 1, unit: 2, detail_project: 3, object_group: 4, object: 5, item: 6, sub_item: 7 };
const FUNDING_SOURCES: ReadonlySet<string> = new Set(["national", "balanced_development", "province", "municipal", "other"]);
const DOCUMENT_FORMATS: ReadonlySet<string> = new Set(["PDF", "HWP5", "HWPX", "HWP3", "HWPML", "DOCX", "XLS", "XLSX"]);
const MAX_LINES = 20_000;
const MAX_LINE_BYTES = 64 * 1024;
const LOCAL_PATH = /(^|[\s"'(])([A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|file:)/;
/** 천원 표시 금액: 쉼표 세 자리, 음수는 △ 또는 -. */
const AMOUNT = /^(△|-)?(0|[1-9]\d{0,2}(,\d{3})*)$/;

const PAYLOAD = {
  "data/budget/documents.jsonl": "documents",
  "data/budget/revisions.jsonl": "revisions",
  "data/budget/lines.jsonl": "lines",
} as const;
const OPTIONAL = new Set(["README.md", "quality/report.json"]);
const MANIFEST_KEYS = ["format", "artifact_id", "created_at", "producer_run_id", "modules_present", "module_schema_versions", "document_ids", "files", "content_digest", "validation"] as const;
const DOCUMENT_KEYS = [
  "document_id", "source_version_id", "title", "issuer", "issuer_sido", "issuer_sigungu", "fiscal_entity_id", "fiscal_year", "page_url", "file_url",
  "retrieved_at", "raw_sha256", "format", "parse_id", "parser", "extractor_version", "rights_basis",
] as const;
const REVISION_KEYS = [
  "revision_id", "document_id", "stage", "supplementary_round", "stage_basis", "unit", "account_code", "account_name", "scope_text", "amount_columns", "previous_column",
] as const;
const LINE_KEYS = [
  "line_id", "revision_id", "line_no", "parent_line_no", "level", "code", "name", "formula_text", "amount_thousand_krw", "previous_amount_thousand_krw",
  "change_amount_thousand_krw", "amount_basis", "funding", "page", "table_id", "block_id", "row_index", "checks", "annotations",
] as const;

export interface BudgetDocumentRecord {
  readonly document_id: string; readonly source_version_id: string; readonly title: string; readonly issuer: string; readonly issuer_sido: string; readonly issuer_sigungu: string;
  readonly fiscal_entity_id: string | null; readonly fiscal_year: string; readonly page_url: string | null; readonly file_url: string | null; readonly retrieved_at: string;
  readonly raw_sha256: string; readonly format: string; readonly parse_id: string; readonly parser: string; readonly extractor_version: string; readonly rights_basis: string;
}
export interface BudgetRevisionRecord {
  readonly revision_id: string; readonly document_id: string; readonly stage: BudgetStage; readonly supplementary_round: number | null; readonly stage_basis: string;
  readonly unit: "thousand_krw"; readonly account_code: string; readonly account_name: string; readonly scope_text: string; readonly amount_columns: readonly string[]; readonly previous_column: PreviousColumn;
}
export interface BudgetFunding { readonly source: string; readonly label: string; readonly amount_thousand_krw: string }
export interface BudgetLineRecord {
  readonly line_id: string; readonly revision_id: string; readonly line_no: number; readonly parent_line_no: number | null; readonly level: BudgetLevel; readonly code: string | null;
  readonly name: string; readonly formula_text: string | null; readonly amount_thousand_krw: string | null; readonly previous_amount_thousand_krw: string | null;
  readonly change_amount_thousand_krw: string | null; readonly amount_basis: string | null; readonly funding: readonly BudgetFunding[]; readonly page: number | null;
  readonly table_id: string | null; readonly block_id: string | null; readonly row_index: number | null; readonly checks: Readonly<Record<string, string>>; readonly annotations: readonly string[];
}
export interface ServerChecks {
  /** partial_listing: 추경처럼 바뀐 하위 항목만 실은 문서에서 상위 금액 ≠ 하위 합이지만 「상위 비교증감 = 하위 비교증감 합」인 행. */
  readonly children_sum: { match: number; mismatch: number; incomplete: number; partial_listing: number };
  readonly funding_sum: { match: number; partial: number };
  readonly side_columns: { match: number; mismatch: number; not_checkable: number };
  readonly bugi_lines: number;
  /** 원문 Ο 부기 이름이 상위 세부·단위·정책사업 이름과 같은 행(원문 그대로인 경우가 많아 거절하지 않고 센다). */
  readonly bugi_same_name_as_parent: number;
}
export interface ValidatedBudgetPack {
  readonly manifest: Record<string, unknown>;
  readonly artifactId: string;
  readonly documentIds: readonly string[];
  readonly documents: readonly BudgetDocumentRecord[];
  readonly revisions: readonly BudgetRevisionRecord[];
  readonly lines: readonly BudgetLineRecord[];
  readonly checks: Readonly<Record<string, ServerChecks>>;
  readonly contentDigest: string;
}
export type BudgetPackResult =
  | { readonly ok: true; readonly pack: ValidatedBudgetPack; readonly problems: readonly [] }
  | { readonly ok: false; readonly problems: readonly ImportProblem[] };

const encoder = new TextEncoder();
const sha256OfText = (value: string) => sha256OfBytes(encoder.encode(value));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown, max: number, min = 1): value is string => typeof value === "string" && value.length >= min && value.length <= max;
const isInstant = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
const optionalAmount = (value: unknown) => value === null || (typeof value === "string" && AMOUNT.test(value));
const optionalInt = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 0);

/** 천원 표시 금액 → 정수(천원). 형식이 다르면 null. */
export function thousandOf(text: string | null): number | null {
  if (text === null || !AMOUNT.test(text)) return null;
  const value = Number(text.replace(/[△,-]/g, ""));
  return /^[△-]/.test(text) ? -value : value;
}
/** 천원 표시 금액 → 원 단위 10진 문자열. */
export function wonOfThousand(text: string | null): string | null {
  const value = thousandOf(text);
  return value === null ? null : (BigInt(value) * BigInt(1000)).toString();
}

/** 문서 ID에서 결정되는 편성 단계 ID. 같은 원문·같은 단계면 언제 만들어도 같다. */
export async function revisionIdOf(documentId: string, stage: string, round: number | null, rawSha256: string): Promise<string> {
  return "brev-" + (await sha256OfText([documentId, stage, String(round ?? ""), rawSha256].join("\u001f"))).slice(0, 20);
}
export async function lineIdOf(revisionId: string, lineNo: number): Promise<string> {
  return "bl-" + (await sha256OfText(revisionId + "\u001f" + lineNo)).slice(0, 24);
}
export async function budgetContentDigestOf(documents: readonly unknown[], revisions: readonly unknown[], lines: readonly unknown[]): Promise<string> {
  return sha256OfText([documents, revisions, lines].map((rows) => rows.map(canonicalJson).join("\n")).join("\n--\n"));
}

function strictKeys(row: Record<string, unknown>, keys: readonly string[], path: string, line: number, problems: ImportProblem[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(row)) if (!allowed.has(key)) problems.push({ code: "FIELD_NOT_ALLOWED", path, line, field: key });
  for (const key of keys) if (!(key in row)) problems.push({ code: "FIELD_MISSING", path, line, field: key });
}

function scanStrings(value: unknown, path: string, line: number, problems: ImportProblem[], field = ""): void {
  if (typeof value === "string") {
    if (LOCAL_PATH.test(value)) problems.push({ code: "LOCAL_PATH_IN_PUBLIC_DATA", path, line, field });
  } else if (Array.isArray(value)) value.forEach((item) => scanStrings(item, path, line, problems, field));
  else if (isRecord(value)) for (const [key, item] of Object.entries(value)) scanStrings(item, path, line, problems, field ? field + "." + key : key);
}

function parseJsonl(bytes: Uint8Array, path: string, problems: ImportProblem[], maxRows: number): Record<string, unknown>[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) {
      problems.push({ code: "NOT_UTF8", path });
      return [];
    }
    throw error;
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > maxRows) {
    problems.push({ code: "TOO_MANY_RECORDS", path });
    return [];
  }
  const rows: Record<string, unknown>[] = [];
  lines.forEach((line, index) => {
    if (encoder.encode(line).length > MAX_LINE_BYTES) return problems.push({ code: "LINE_TOO_LARGE", path, line: index + 1 });
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) return problems.push({ code: "JSON_INVALID", path, line: index + 1 });
      throw error;
    }
    if (!isRecord(value)) problems.push({ code: "RECORD_NOT_OBJECT", path, line: index + 1 });
    else rows.push(value);
  });
  return rows;
}

/**
 * 압축 묶음이 예산서 형식이면 검사 결과를, 아니면 null을 돌려준다(문서 사실 묶음 검사로 넘김).
 * ZIP·manifest를 읽지 못하는 경우도 null: 문서 사실 검사기가 같은 오류 코드로 거절한다.
 */
export async function validateBudgetArchive(archive: Uint8Array): Promise<BudgetPackResult | null> {
  let entries: ZipEntry[];
  try {
    entries = await readZip(archive);
  } catch (error) {
    if (error instanceof ZipSafetyError) return null;
    throw error;
  }
  const manifestEntry = entries.find((entry) => entry.path === "manifest.json");
  if (!manifestEntry) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestEntry.bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
  if (!isRecord(manifest) || manifest.format !== BUDGET_IMPORT_FORMAT) return null;
  return validateBudgetPack(entries, manifest);
}

export async function validateBudgetPack(entries: readonly ZipEntry[], manifest: Record<string, unknown>): Promise<BudgetPackResult> {
  const problems: ImportProblem[] = [];
  const path = "manifest.json";
  strictKeys(manifest, MANIFEST_KEYS, path, 0, problems);
  if (!isString(manifest.artifact_id, 120, 8) || !/^[A-Za-z0-9._:-]+$/.test(manifest.artifact_id)) problems.push({ code: "ARTIFACT_ID_INVALID", path, field: "artifact_id" });
  if (!isInstant(manifest.created_at)) problems.push({ code: "VALUE_INVALID", path, field: "created_at" });
  if (!isString(manifest.producer_run_id, 120)) problems.push({ code: "VALUE_INVALID", path, field: "producer_run_id" });
  if (!Array.isArray(manifest.modules_present) || manifest.modules_present.length !== 1 || manifest.modules_present[0] !== "budget_documents") problems.push({ code: "MODULE_UNKNOWN", path, field: "modules_present" });
  if (!isRecord(manifest.module_schema_versions) || manifest.module_schema_versions.budget_documents !== BUDGET_SCHEMA_VERSION) problems.push({ code: "SCHEMA_VERSION_UNSUPPORTED", path, field: "module_schema_versions.budget_documents" });
  const documentIds = Array.isArray(manifest.document_ids) ? manifest.document_ids : null;
  if (!documentIds || !documentIds.length || documentIds.length > 20 || !documentIds.every((id) => typeof id === "string" && /^doc:budget-[a-z0-9-]{3,73}$/.test(id)) || new Set(documentIds).size !== documentIds.length) {
    problems.push({ code: "DOCUMENT_IDS_INVALID", path, field: "document_ids" });
  }
  if (!Array.isArray(manifest.files)) problems.push({ code: "FILES_MISSING", path, field: "files" });
  if (problems.length) return { ok: false, problems };

  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) if (entry.path !== "manifest.json" && !(entry.path in PAYLOAD) && !OPTIONAL.has(entry.path)) problems.push({ code: "FILE_NOT_ALLOWED", path: entry.path });
  const declared = new Set<string>();
  for (const item of manifest.files as unknown[]) {
    if (!isRecord(item) || !isString(item.path, 200) || typeof item.size !== "number" || !isString(item.sha256, 64, 64) || !(item.records === null || typeof item.records === "number")) {
      problems.push({ code: "FILES_ENTRY_INVALID", path });
      continue;
    }
    declared.add(item.path);
    const entry = byPath.get(item.path);
    if (!entry) {
      problems.push({ code: "FILE_MISSING", path: item.path });
      continue;
    }
    if (entry.bytes.length !== item.size) problems.push({ code: "FILE_SIZE_MISMATCH", path: item.path });
    if ((await sha256OfBytes(entry.bytes)) !== item.sha256) problems.push({ code: "FILE_HASH_MISMATCH", path: item.path });
  }
  for (const entry of entries) if (entry.path !== "manifest.json" && !declared.has(entry.path)) problems.push({ code: "FILE_NOT_DECLARED", path: entry.path });
  for (const file of Object.keys(PAYLOAD)) if (!byPath.has(file)) problems.push({ code: "FILE_MISSING", path: file });
  if (problems.length) return { ok: false, problems };

  const raw = {
    documents: parseJsonl(byPath.get("data/budget/documents.jsonl")!.bytes, "data/budget/documents.jsonl", problems, 20),
    revisions: parseJsonl(byPath.get("data/budget/revisions.jsonl")!.bytes, "data/budget/revisions.jsonl", problems, 40),
    lines: parseJsonl(byPath.get("data/budget/lines.jsonl")!.bytes, "data/budget/lines.jsonl", problems, MAX_LINES),
  };
  for (const item of manifest.files as Record<string, unknown>[]) {
    const kind = PAYLOAD[item.path as keyof typeof PAYLOAD];
    if (kind && item.records !== raw[kind].length) problems.push({ code: "RECORD_COUNT_MISMATCH", path: String(item.path) });
  }
  if (problems.length) return { ok: false, problems };

  const documents = validateDocuments(raw.documents, documentIds as string[], problems);
  const revisions = await validateRevisions(raw.revisions, documents, problems);
  const { lines, checks } = await validateLines(raw.lines, revisions, problems);
  for (const id of documentIds as string[]) if (!documents.some((document) => document.document_id === id)) problems.push({ code: "DOCUMENT_MISSING", path: "data/budget/documents.jsonl", field: id });
  for (const document of documents) if (!revisions.some((revision) => revision.document_id === document.document_id)) problems.push({ code: "DOCUMENT_WITHOUT_REVISION", path: "data/budget/revisions.jsonl", field: document.document_id });
  for (const revision of revisions) if (!lines.some((line) => line.revision_id === revision.revision_id)) problems.push({ code: "REVISION_WITHOUT_LINES", path: "data/budget/lines.jsonl", field: revision.revision_id });
  if (problems.length) return { ok: false, problems };
  const contentDigest = await budgetContentDigestOf(raw.documents, raw.revisions, raw.lines);
  if (manifest.content_digest !== contentDigest) return { ok: false, problems: [{ code: "CONTENT_DIGEST_MISMATCH", path, field: "content_digest" }] };
  return { ok: true, problems: [], pack: { manifest, artifactId: manifest.artifact_id as string, documentIds: documentIds as string[], documents, revisions, lines, checks, contentDigest } };
}

function validateDocuments(rows: Record<string, unknown>[], ids: readonly string[], problems: ImportProblem[]): BudgetDocumentRecord[] {
  const path = "data/budget/documents.jsonl";
  const out: BudgetDocumentRecord[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 1;
    const before = problems.length;
    strictKeys(row, DOCUMENT_KEYS, path, line, problems);
    scanStrings(row, path, line, problems);
    if (!isString(row.document_id, 84) || !ids.includes(row.document_id)) problems.push({ code: "OUT_OF_DOCUMENT_SCOPE", path, line, field: "document_id" });
    else if (seen.has(row.document_id)) problems.push({ code: "DUPLICATE_DOCUMENT", path, line, field: "document_id" });
    if (!isString(row.source_version_id, 70) || !/^sv-[a-f0-9]{8,64}$/.test(row.source_version_id)) problems.push({ code: "VALUE_INVALID", path, line, field: "source_version_id" });
    for (const [field, max] of [["title", 300], ["issuer", 100], ["issuer_sido", 30], ["parser", 60], ["extractor_version", 60], ["rights_basis", 400]] as const) {
      if (!isString(row[field], max)) problems.push({ code: "VALUE_INVALID", path, line, field });
    }
    if (!isString(row.issuer_sigungu, 30, 0)) problems.push({ code: "VALUE_INVALID", path, line, field: "issuer_sigungu" });
    if (!(row.fiscal_entity_id === null || (isString(row.fiscal_entity_id, 40) && /^lofin:laf:\d{1,12}$/.test(row.fiscal_entity_id)))) problems.push({ code: "VALUE_INVALID", path, line, field: "fiscal_entity_id" });
    if (!isString(row.fiscal_year, 4, 4) || !/^20\d{2}$/.test(row.fiscal_year)) problems.push({ code: "VALUE_INVALID", path, line, field: "fiscal_year" });
    for (const field of ["page_url", "file_url"] as const) if (!(row[field] === null || (isString(row[field], 500) && /^https:\/\/[^\s]+$/.test(row[field] as string)))) problems.push({ code: "URL_NOT_ALLOWED", path, line, field });
    if (!isInstant(row.retrieved_at)) problems.push({ code: "VALUE_INVALID", path, line, field: "retrieved_at" });
    if (!isString(row.raw_sha256, 64, 64) || !/^[a-f0-9]{64}$/.test(row.raw_sha256)) problems.push({ code: "VALUE_INVALID", path, line, field: "raw_sha256" });
    if (!DOCUMENT_FORMATS.has(String(row.format))) problems.push({ code: "VALUE_INVALID", path, line, field: "format" });
    if (!isString(row.parse_id, 40) || !/^p_[a-f0-9]{32}$/.test(row.parse_id)) problems.push({ code: "VALUE_INVALID", path, line, field: "parse_id" });
    if (problems.length === before) {
      seen.add(row.document_id as string);
      out.push(row as unknown as BudgetDocumentRecord);
    }
  });
  return out;
}

async function validateRevisions(rows: Record<string, unknown>[], documents: readonly BudgetDocumentRecord[], problems: ImportProblem[]): Promise<BudgetRevisionRecord[]> {
  const path = "data/budget/revisions.jsonl";
  const byId = new Map(documents.map((document) => [document.document_id, document]));
  const out: BudgetRevisionRecord[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const before = problems.length;
    strictKeys(row, REVISION_KEYS, path, line, problems);
    scanStrings(row, path, line, problems);
    const document = typeof row.document_id === "string" ? byId.get(row.document_id) : undefined;
    if (!document) problems.push({ code: "DOCUMENT_UNKNOWN", path, line, field: "document_id" });
    if (!BUDGET_STAGES.includes(row.stage as BudgetStage)) problems.push({ code: "STAGE_INVALID", path, line, field: "stage" });
    // 추경은 차수가 있어야 하고, 추경이 아니면 차수를 적지 않는다(일별 현액·본예산을 추경 차수로 표시하지 않음).
    if (row.stage === "adopted_supplementary" ? !(Number.isInteger(row.supplementary_round) && (row.supplementary_round as number) >= 1 && (row.supplementary_round as number) <= 20) : row.supplementary_round !== null) {
      problems.push({ code: "SUPPLEMENTARY_ROUND_INVALID", path, line, field: "supplementary_round" });
    }
    if (!isString(row.stage_basis, 300)) problems.push({ code: "STAGE_BASIS_REQUIRED", path, line, field: "stage_basis" });
    if (row.unit !== "thousand_krw") problems.push({ code: "UNIT_UNSUPPORTED", path, line, field: "unit" });
    if (!isString(row.account_code, 10) || !/^\d{1,10}$/.test(row.account_code)) problems.push({ code: "VALUE_INVALID", path, line, field: "account_code" });
    for (const [field, max] of [["account_name", 60], ["scope_text", 300]] as const) if (!isString(row[field], max)) problems.push({ code: "VALUE_INVALID", path, line, field });
    if (!Array.isArray(row.amount_columns) || row.amount_columns.length < 1 || row.amount_columns.length > 6 || !row.amount_columns.every((item) => isString(item, 30))) problems.push({ code: "VALUE_INVALID", path, line, field: "amount_columns" });
    if (!PREVIOUS_COLUMNS.includes(row.previous_column as PreviousColumn)) problems.push({ code: "VALUE_INVALID", path, line, field: "previous_column" });
    if (row.stage === "adopted_supplementary" && row.previous_column === "previous_year_budget") problems.push({ code: "PREVIOUS_COLUMN_STAGE_CONFLICT", path, line, field: "previous_column" });
    if (problems.length === before && document) {
      const expected = await revisionIdOf(document.document_id, row.stage as string, row.supplementary_round as number | null, document.raw_sha256);
      if (row.revision_id !== expected) problems.push({ code: "REVISION_ID_MISMATCH", path, line, field: "revision_id" });
      else if (seen.has(expected)) problems.push({ code: "DUPLICATE_REVISION", path, line, field: "revision_id" });
      else {
        seen.add(expected);
        out.push(row as unknown as BudgetRevisionRecord);
      }
    }
  }
  return out;
}

async function validateLines(rows: Record<string, unknown>[], revisions: readonly BudgetRevisionRecord[], problems: ImportProblem[]) {
  const path = "data/budget/lines.jsonl";
  const revisionIds = new Set(revisions.map((revision) => revision.revision_id));
  const out: BudgetLineRecord[] = [];
  const byRevision = new Map<string, Map<number, BudgetLineRecord>>();
  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const before = problems.length;
    strictKeys(row, LINE_KEYS, path, line, problems);
    scanStrings(row, path, line, problems);
    const revisionId = typeof row.revision_id === "string" && revisionIds.has(row.revision_id) ? row.revision_id : null;
    if (!revisionId) problems.push({ code: "REVISION_UNKNOWN", path, line, field: "revision_id" });
    if (!Number.isInteger(row.line_no) || (row.line_no as number) < 1) problems.push({ code: "VALUE_INVALID", path, line, field: "line_no" });
    if (!BUDGET_LEVELS.includes(row.level as BudgetLevel)) problems.push({ code: "LEVEL_INVALID", path, line, field: "level" });
    if (!(row.code === null || (isString(row.code, 3) && /^\d{2,3}$/.test(row.code)))) problems.push({ code: "VALUE_INVALID", path, line, field: "code" });
    if (!isString(row.name, 300, 0)) problems.push({ code: "VALUE_INVALID", path, line, field: "name" });
    if (!(row.formula_text === null || isString(row.formula_text, 1000, 0))) problems.push({ code: "VALUE_INVALID", path, line, field: "formula_text" });
    for (const field of ["amount_thousand_krw", "previous_amount_thousand_krw", "change_amount_thousand_krw"] as const) if (!optionalAmount(row[field])) problems.push({ code: "AMOUNT_INVALID", path, line, field });
    if (!(row.amount_basis === null || isString(row.amount_basis, 40))) problems.push({ code: "VALUE_INVALID", path, line, field: "amount_basis" });
    if (!Array.isArray(row.funding) || row.funding.length > 8 || !row.funding.every((item) => isRecord(item) && Object.keys(item).length === 3 && FUNDING_SOURCES.has(String(item.source)) && isString(item.label, 4) && typeof item.amount_thousand_krw === "string" && AMOUNT.test(item.amount_thousand_krw))) {
      problems.push({ code: "FUNDING_INVALID", path, line, field: "funding" });
    }
    for (const field of ["page", "row_index"] as const) if (!optionalInt(row[field])) problems.push({ code: "VALUE_INVALID", path, line, field });
    if (!(row.table_id === null || (isString(row.table_id, 40) && /^t:[a-f0-9]{8,32}$/.test(row.table_id)))) problems.push({ code: "VALUE_INVALID", path, line, field: "table_id" });
    if (!(row.block_id === null || (isString(row.block_id, 40) && /^b:[a-f0-9]{8,32}$/.test(row.block_id)))) problems.push({ code: "VALUE_INVALID", path, line, field: "block_id" });
    if (!isRecord(row.checks) || Object.keys(row.checks).length > 12 || !Object.values(row.checks).every((value) => isString(value, 40))) problems.push({ code: "VALUE_INVALID", path, line, field: "checks" });
    if (!Array.isArray(row.annotations) || row.annotations.length > 10 || !row.annotations.every((item) => isString(item, 200))) problems.push({ code: "VALUE_INVALID", path, line, field: "annotations" });
    if (problems.length !== before || !revisionId) continue;
    const record = row as unknown as BudgetLineRecord;
    if (record.line_id !== (await lineIdOf(revisionId, record.line_no))) {
      problems.push({ code: "LINE_ID_MISMATCH", path, line, field: "line_id" });
      continue;
    }
    const lines = byRevision.get(revisionId) ?? byRevision.set(revisionId, new Map()).get(revisionId)!;
    if (lines.has(record.line_no)) {
      problems.push({ code: "DUPLICATE_LINE", path, line, field: "line_no" });
      continue;
    }
    // 부모는 같은 단계 문서 안의 앞 행이고 계층이 더 위여야 한다.
    if (record.parent_line_no !== null) {
      const parent = lines.get(record.parent_line_no);
      if (!parent || DEPTH[parent.level] >= DEPTH[record.level]) {
        problems.push({ code: "PARENT_INVALID", path, line, field: "parent_line_no" });
        continue;
      }
    } else if (record.level !== "department") {
      problems.push({ code: "PARENT_REQUIRED", path, line, field: "parent_line_no" });
      continue;
    }
    lines.set(record.line_no, record);
    out.push(record);
  }
  const checks: Record<string, ServerChecks> = {};
  for (const [revisionId, lines] of byRevision) checks[revisionId] = recheck(lines, path, problems);
  return { lines: out, checks };
}

/** 서버 검산. 묶음이 「match」라고 적었는데 다시 계산해 다르면 거절한다. 부기는 원문 Ο 표시 행만 item으로 오며(추출기 시험으로 확인), 상위 사업명과 같은 부기 이름은 개수만 남긴다. */
function recheck(lines: ReadonlyMap<number, BudgetLineRecord>, path: string, problems: ImportProblem[]): ServerChecks {
  const result: { -readonly [K in keyof ServerChecks]: ServerChecks[K] } = { children_sum: { match: 0, mismatch: 0, incomplete: 0, partial_listing: 0 }, funding_sum: { match: 0, partial: 0 }, side_columns: { match: 0, mismatch: 0, not_checkable: 0 }, bugi_lines: 0, bugi_same_name_as_parent: 0 };
  const children = new Map<number, BudgetLineRecord[]>();
  for (const line of lines.values()) if (line.parent_line_no !== null) (children.get(line.parent_line_no) ?? children.set(line.parent_line_no, []).get(line.parent_line_no)!).push(line);
  const ancestors = (line: BudgetLineRecord) => {
    const names = new Set<string>();
    for (let parent = line.parent_line_no === null ? undefined : lines.get(line.parent_line_no); parent; parent = parent.parent_line_no === null ? undefined : lines.get(parent.parent_line_no)) {
      if (parent.level === "detail_project" || parent.level === "unit" || parent.level === "policy") names.add(parent.name.replace(/\s+/g, ""));
    }
    return names;
  };
  const declared = (line: BudgetLineRecord, key: string, server: string) => {
    if (line.checks[key] === "match" && server !== "match") problems.push({ code: "DECLARED_CHECK_DISAGREES", path, field: line.line_id + ":" + key });
  };
  for (const line of lines.values()) {
    const value = thousandOf(line.amount_thousand_krw);
    if (line.level === "item") {
      result.bugi_lines += 1;
      if (ancestors(line).has(line.name.replace(/\s+/g, ""))) result.bugi_same_name_as_parent += 1;
    }
    const kids = (children.get(line.line_no) ?? []).filter((kid) => kid.level !== "sub_item" || line.level === "item");
    if (kids.length && value !== null) {
      const values = kids.map((kid) => thousandOf(kid.amount_thousand_krw));
      const sum = values.every((item) => item !== null) ? values.reduce<number>((total, item) => total + (item as number), 0) : null;
      const ownChange = thousandOf(line.change_amount_thousand_krw);
      const kidChanges = kids.map((kid) => thousandOf(kid.change_amount_thousand_krw));
      const changeMatches = ownChange !== null && kidChanges.every((item) => item !== null) && kidChanges.reduce<number>((total, item) => total + (item as number), 0) === ownChange;
      const state = sum === null ? "incomplete" : sum === value ? "match" : changeMatches ? "partial_listing" : "mismatch";
      result.children_sum[state] += 1;
      declared(line, "children_sum", state);
      if (line.checks.children_sum === "partial_listing_change_match" && state !== "partial_listing") problems.push({ code: "DECLARED_CHECK_DISAGREES", path, field: line.line_id + ":children_sum" });
    }
    if (line.funding.length && value !== null) {
      const sum = line.funding.reduce((total, item) => total + (thousandOf(item.amount_thousand_krw) ?? 0), 0);
      const state = sum === value ? "match" : "partial";
      result.funding_sum[state] += 1;
      declared(line, "funding_sum", state);
    }
    if (line.previous_amount_thousand_krw !== null || line.change_amount_thousand_krw !== null) {
      const previous = thousandOf(line.previous_amount_thousand_krw);
      const change = thousandOf(line.change_amount_thousand_krw);
      const state = value === null || previous === null || change === null ? "not_checkable" : value - previous === change ? "match" : "mismatch";
      result.side_columns[state] += 1;
      declared(line, "side_columns", state);
    }
  }
  return result;
}
