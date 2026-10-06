// welfare-public-release-v2 문서 사실 묶음 검사(작업지시서 v5 §10.2·10.3·10.7). 순수 함수: DB·네트워크를 쓰지 않는다.
// 서버가 반입을 허락하는 모듈은 knowledge(문서 사실)뿐이다. 재정·보도자료·연결은 서버가 직접 수집하므로 반입으로 덮어쓸 수 없다.
// 모르는 필드는 무시하지 않고 거절한다. URL은 형식만 보고 요청하지 않는다. 데이터 안의 SQL·스크립트는 실행하지 않는다.
import { readZip, ZipSafetyError, type ZipEntry } from "./zip.ts";

export const IMPORT_FORMAT = "welfare-public-release-v2";
export const DOCUMENT_SCHEMA_VERSION = "document-facts-1";
export const IMPORTABLE_MODULES: ReadonlySet<string> = new Set(["knowledge"]);
const SERVER_COLLECTED_MODULES: ReadonlySet<string> = new Set(["fiscal", "news", "links"]);
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_DEPTH = 6;
const MAX_SCOPE = 50;

export const DOCUMENT_PREDICATES = {
  target_group: "지원대상",
  eligibility: "신청자격",
  exclusion: "제외대상",
  benefit_item: "지원내용",
  benefit_amount: "지원금액",
  operating_period: "지원기간",
  application_period: "접수기간",
  application_method: "신청방법",
  application_place: "신청장소",
  required_documents: "제출서류",
  procedure: "지원절차",
  provider: "담당기관",
} as const;
export type DocumentPredicate = keyof typeof DOCUMENT_PREDICATES;

const PAYLOAD_FILES = {
  "data/knowledge/sources.jsonl": "sources",
  "data/knowledge/statements.jsonl": "statements",
  "data/knowledge/evidence.jsonl": "evidence",
} as const;
const OPTIONAL_FILES: ReadonlySet<string> = new Set(["README.md", "quality/report.json"]);
const SOURCE_KINDS: ReadonlySet<string> = new Set(["PUBLIC_NOTICE", "PROGRAM_GUIDE", "ORDINANCE", "FORM"]);
const NEWS_KINDS: ReadonlySet<string> = new Set(["OFFICIAL_PRESS_RELEASE", "PRESS_RELEASE", "NEWS", "NEWS_ARTICLE"]);
const MANIFEST_KEYS = [
  "format", "artifact_id", "created_at", "producer_run_id", "modules_present", "module_schema_versions", "module_modes", "publication_scope",
  "ontology_version", "mapping_version", "base_release_bundle_id", "base_source_run_id", "base_component_ids", "source_set_digest", "content_digest",
  "source_policy_versions", "files", "coverage", "validation",
] as const;
const SOURCE_KEYS = [
  "source_id", "source_version_id", "source_kind", "title", "issuer", "issuer_sido", "issuer_sigungu", "document_number", "url", "published_date",
  "retrieved_at", "raw_sha256", "format", "parse_id", "parser", "adapter_version", "locator_precision", "page_mode", "rights_basis",
] as const;
const STATEMENT_KEYS = [
  "statement_id", "subject_id", "subject_label", "subject_sido", "subject_sigungu", "predicate_id", "value_text", "unit", "scope_text",
  "source_version_id", "assertion_type", "review_status", "reviewed_at",
] as const;
const EVIDENCE_KEYS = [
  "evidence_id", "statement_id", "source_version_id", "parse_id", "block_id", "ir_pointer", "table_id", "cell", "locator_precision", "page_mode",
  "layout_page_start", "physical_page_verified", "quote",
] as const;

export interface ImportProblem {
  readonly code: string;
  readonly path: string;
  readonly line?: number;
  readonly field?: string;
}

export interface DocSourceRecord {
  readonly source_id: string; readonly source_version_id: string; readonly source_kind: string; readonly title: string; readonly issuer: string;
  readonly issuer_sido: string; readonly issuer_sigungu: string; readonly document_number: string; readonly url: string | null; readonly published_date: string | null;
  readonly retrieved_at: string; readonly raw_sha256: string; readonly format: string; readonly parse_id: string; readonly parser: string;
  readonly adapter_version: string; readonly locator_precision: string; readonly page_mode: string; readonly rights_basis: string;
}
export interface DocStatementRecord {
  readonly statement_id: string; readonly subject_id: string; readonly subject_label: string; readonly subject_sido: string; readonly subject_sigungu: string;
  readonly predicate_id: DocumentPredicate; readonly value_text: string; readonly unit: string | null; readonly scope_text: string | null;
  readonly source_version_id: string; readonly assertion_type: "document_field"; readonly review_status: "approved"; readonly reviewed_at: string;
}
export interface DocEvidenceRecord {
  readonly evidence_id: string; readonly statement_id: string; readonly source_version_id: string; readonly parse_id: string; readonly block_id: string;
  readonly ir_pointer: string; readonly table_id: string | null; readonly cell: string | null; readonly locator_precision: string; readonly page_mode: string;
  readonly layout_page_start: number | null; readonly physical_page_verified: boolean; readonly quote: string;
}

export interface ValidatedPack {
  readonly manifest: Record<string, unknown>;
  readonly artifactId: string;
  readonly scopeSourceIds: readonly string[];
  readonly emptyReplaceSourceIds: readonly string[];
  readonly baseSourceRunId: string | null;
  readonly sources: readonly DocSourceRecord[];
  readonly statements: readonly DocStatementRecord[];
  readonly evidence: readonly DocEvidenceRecord[];
  readonly contentDigest: string;
}

export type PackResult =
  | { readonly ok: true; readonly pack: ValidatedPack; readonly problems: readonly [] }
  | { readonly ok: false; readonly problems: readonly ImportProblem[]; readonly manifest: Record<string, unknown> | null };

const textEncoder = new TextEncoder();

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const sha256OfText = (value: string) => sha256OfBytes(textEncoder.encode(value));

/** 키를 정렬한 정규 JSON. 같은 사실은 언제 만들어도 같은 문자열이 된다. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/** 사실 ID: 주체·술어·값·단위·범위·원문 버전으로 정한다. 같은 ID에 다른 내용이 오면 거절된다. */
export async function statementIdOf(statement: Pick<DocStatementRecord, "subject_id" | "predicate_id" | "value_text" | "unit" | "scope_text" | "source_version_id">): Promise<string> {
  const key = [statement.subject_id, statement.predicate_id, statement.value_text, statement.unit ?? "", statement.scope_text ?? "", statement.source_version_id].join("\u001f");
  return "stmt_" + (await sha256OfText(key)).slice(0, 24);
}

export async function contentDigestOf(statements: readonly DocStatementRecord[], evidence: readonly DocEvidenceRecord[]): Promise<string> {
  const sorted = [...statements].sort((a, b) => a.statement_id.localeCompare(b.statement_id)).map(canonicalJson);
  const proofs = [...evidence].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)).map(canonicalJson);
  return sha256OfText(sorted.join("\n") + "\n--\n" + proofs.join("\n"));
}

export async function sourceSetDigestOf(sources: readonly DocSourceRecord[]): Promise<string> {
  return sha256OfText([...sources].map((source) => source.source_id + "@" + source.source_version_id + "#" + source.raw_sha256).sort().join("\n"));
}

function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_DEPTH) return depth;
  if (Array.isArray(value)) return Math.max(depth, ...value.map((item) => depthOf(item, depth + 1)));
  if (value && typeof value === "object") return Math.max(depth, ...Object.values(value).map((item) => depthOf(item, depth + 1)));
  return depth;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown, max: number, min = 1): value is string => typeof value === "string" && value.length >= min && value.length <= max;
const optionalString = (value: unknown, max: number) => value === null || isString(value, max, 0);
const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
const isInstant = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
const LOCAL_PATH = /(^|[\s"'(])([A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|file:)/;

function strictKeys(row: Record<string, unknown>, keys: readonly string[], path: string, line: number, problems: ImportProblem[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(row)) if (!allowed.has(key)) problems.push({ code: "FIELD_NOT_ALLOWED", path, line, field: key });
  for (const key of keys) if (!(key in row)) problems.push({ code: "FIELD_MISSING", path, line, field: key });
}

function scanStrings(row: Record<string, unknown>, path: string, line: number, problems: ImportProblem[]): void {
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && LOCAL_PATH.test(value)) problems.push({ code: "LOCAL_PATH_IN_PUBLIC_DATA", path, line, field: key });
  }
}

function parseJsonl(bytes: Uint8Array, path: string, problems: ImportProblem[]): Record<string, unknown>[] {
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
  const rows: Record<string, unknown>[] = [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, index) => {
    if (textEncoder.encode(line).length > MAX_LINE_BYTES) {
      problems.push({ code: "LINE_TOO_LARGE", path, line: index + 1 });
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      if (error instanceof SyntaxError) {
        problems.push({ code: "JSON_INVALID", path, line: index + 1 });
        return;
      }
      throw error;
    }
    if (!isRecord(value)) problems.push({ code: "RECORD_NOT_OBJECT", path, line: index + 1 });
    else if (depthOf(value) > MAX_DEPTH) problems.push({ code: "JSON_TOO_DEEP", path, line: index + 1 });
    else rows.push(value);
  });
  return rows;
}

function checkManifest(manifest: Record<string, unknown>, problems: ImportProblem[]): void {
  const path = "manifest.json";
  if (manifest.format === "welfare-public-release-v1") {
    problems.push({ code: "FORMAT_V1_NOT_SUPPORTED", path, field: "format" });
    return;
  }
  if (manifest.format !== IMPORT_FORMAT) {
    problems.push({ code: "FORMAT_UNKNOWN", path, field: "format" });
    return;
  }
  strictKeys(manifest, MANIFEST_KEYS, path, 0, problems);
  if (!isString(manifest.artifact_id, 120, 8) || !/^[A-Za-z0-9._:-]+$/.test(manifest.artifact_id)) problems.push({ code: "ARTIFACT_ID_INVALID", path, field: "artifact_id" });
  if (!isInstant(manifest.created_at)) problems.push({ code: "VALUE_INVALID", path, field: "created_at" });
  if (!isString(manifest.producer_run_id, 120)) problems.push({ code: "VALUE_INVALID", path, field: "producer_run_id" });
  if (manifest.ontology_version !== "welfare-v2") problems.push({ code: "ONTOLOGY_VERSION_UNSUPPORTED", path, field: "ontology_version" });
  if (!isString(manifest.mapping_version, 80)) problems.push({ code: "VALUE_INVALID", path, field: "mapping_version" });
  if (!optionalString(manifest.base_source_run_id, 120)) problems.push({ code: "VALUE_INVALID", path, field: "base_source_run_id" });
  if (!optionalString(manifest.base_release_bundle_id, 120)) problems.push({ code: "VALUE_INVALID", path, field: "base_release_bundle_id" });
  const modules = Array.isArray(manifest.modules_present) ? manifest.modules_present : null;
  if (!modules || modules.length === 0) problems.push({ code: "MODULES_MISSING", path, field: "modules_present" });
  for (const name of modules ?? []) {
    if (SERVER_COLLECTED_MODULES.has(String(name))) problems.push({ code: "MODULE_NOT_PERMITTED", path, field: "modules_present:" + String(name) });
    else if (!IMPORTABLE_MODULES.has(String(name))) problems.push({ code: "MODULE_UNKNOWN", path, field: "modules_present:" + String(name) });
  }
  const versions = isRecord(manifest.module_schema_versions) ? manifest.module_schema_versions : {};
  if (versions.knowledge !== DOCUMENT_SCHEMA_VERSION) problems.push({ code: "SCHEMA_VERSION_UNSUPPORTED", path, field: "module_schema_versions.knowledge" });
  const modes = isRecord(manifest.module_modes) ? manifest.module_modes : {};
  if (modes.knowledge !== "source_scoped_replace") problems.push({ code: "MODULE_MODE_UNSUPPORTED", path, field: "module_modes.knowledge" });
  const scope = isRecord(manifest.publication_scope) && isRecord(manifest.publication_scope.knowledge) ? manifest.publication_scope.knowledge : null;
  const ids = scope && Array.isArray(scope.source_ids) ? scope.source_ids : null;
  if (!ids || ids.length === 0 || ids.length > MAX_SCOPE || !ids.every((id) => typeof id === "string" && /^doc:[a-z0-9-]{3,80}$/.test(id)) || new Set(ids).size !== ids.length) {
    problems.push({ code: "PUBLICATION_SCOPE_INVALID", path, field: "publication_scope.knowledge.source_ids" });
  }
  const empty = scope?.empty_replace_source_ids;
  if (empty !== undefined && (!Array.isArray(empty) || !empty.every((id) => typeof id === "string" && ids?.includes(id)))) {
    problems.push({ code: "PUBLICATION_SCOPE_INVALID", path, field: "publication_scope.knowledge.empty_replace_source_ids" });
  }
  if (scope) for (const key of Object.keys(scope)) if (key !== "source_ids" && key !== "empty_replace_source_ids") problems.push({ code: "FIELD_NOT_ALLOWED", path, field: "publication_scope.knowledge." + key });
  if (!Array.isArray(manifest.files)) problems.push({ code: "FILES_MISSING", path, field: "files" });
}

/** 압축 묶음 바이트를 검사한다. 성공하면 반입할 행을, 실패하면 안전한 오류 코드 목록을 돌려준다(원문 내용은 되돌리지 않음). */
export async function validatePack(archive: Uint8Array): Promise<PackResult> {
  let entries: ZipEntry[];
  try {
    entries = await readZip(archive);
  } catch (error) {
    if (error instanceof ZipSafetyError) return { ok: false, problems: [{ code: error.code, path: error.path }], manifest: null };
    throw error;
  }
  const problems: ImportProblem[] = [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntry = byPath.get("manifest.json");
  if (!manifestEntry) return { ok: false, problems: [{ code: "MANIFEST_MISSING", path: "manifest.json" }], manifest: null };
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestEntry.bytes));
    if (!isRecord(parsed)) return { ok: false, problems: [{ code: "MANIFEST_INVALID", path: "manifest.json" }], manifest: null };
    manifest = parsed;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return { ok: false, problems: [{ code: "MANIFEST_INVALID", path: "manifest.json" }], manifest: null };
    throw error;
  }
  checkManifest(manifest, problems);
  if (problems.length) return { ok: false, problems, manifest };

  // 허용목록 밖 파일(SQL·스크립트·실행파일 등)은 내용과 상관없이 거절한다.
  for (const entry of entries) {
    if (entry.path !== "manifest.json" && !(entry.path in PAYLOAD_FILES) && !OPTIONAL_FILES.has(entry.path)) problems.push({ code: "FILE_NOT_ALLOWED", path: entry.path });
  }
  const declared = manifest.files as unknown[];
  const declaredPaths = new Set<string>();
  for (const item of declared) {
    if (!isRecord(item) || !isString(item.path, 200) || typeof item.size !== "number" || !isString(item.sha256, 64, 64) || !(item.records === null || typeof item.records === "number")) {
      problems.push({ code: "FILES_ENTRY_INVALID", path: "manifest.json" });
      continue;
    }
    declaredPaths.add(item.path);
    const entry = byPath.get(item.path);
    if (!entry) {
      problems.push({ code: "FILE_MISSING", path: item.path });
      continue;
    }
    if (entry.bytes.length !== item.size) problems.push({ code: "FILE_SIZE_MISMATCH", path: item.path });
    if ((await sha256OfBytes(entry.bytes)) !== item.sha256) problems.push({ code: "FILE_HASH_MISMATCH", path: item.path });
  }
  for (const entry of entries) if (entry.path !== "manifest.json" && !declaredPaths.has(entry.path)) problems.push({ code: "FILE_NOT_DECLARED", path: entry.path });
  for (const path of Object.keys(PAYLOAD_FILES)) if (!byPath.has(path)) problems.push({ code: "FILE_MISSING", path });
  if (problems.length) return { ok: false, problems, manifest };

  const raw = {
    sources: parseJsonl(byPath.get("data/knowledge/sources.jsonl")!.bytes, "data/knowledge/sources.jsonl", problems),
    statements: parseJsonl(byPath.get("data/knowledge/statements.jsonl")!.bytes, "data/knowledge/statements.jsonl", problems),
    evidence: parseJsonl(byPath.get("data/knowledge/evidence.jsonl")!.bytes, "data/knowledge/evidence.jsonl", problems),
  };
  for (const item of declared as Record<string, unknown>[]) {
    const kind = PAYLOAD_FILES[item.path as keyof typeof PAYLOAD_FILES];
    if (kind && item.records !== raw[kind].length) problems.push({ code: "RECORD_COUNT_MISMATCH", path: String(item.path) });
  }
  if (problems.length) return { ok: false, problems, manifest };

  const scope = (manifest.publication_scope as { knowledge: { source_ids: string[]; empty_replace_source_ids?: string[] } }).knowledge;
  const emptyReplace = scope.empty_replace_source_ids ?? [];
  const sources = validateSources(raw.sources, scope.source_ids, problems);
  const statements = await validateStatements(raw.statements, sources, problems);
  const evidence = validateEvidence(raw.evidence, statements, sources, problems);
  const covered = new Set(sources.map((source) => source.source_id));
  for (const id of scope.source_ids) {
    const declaredEmpty = emptyReplace.includes(id);
    if (!covered.has(id) && !declaredEmpty) problems.push({ code: "EMPTY_SCOPE_NOT_DECLARED", path: "manifest.json", field: id });
    if (covered.has(id) && declaredEmpty) problems.push({ code: "EMPTY_SCOPE_HAS_RECORDS", path: "manifest.json", field: id });
  }
  const versionsWithFacts = new Set(statements.map((statement) => statement.source_version_id));
  for (const source of sources) if (!versionsWithFacts.has(source.source_version_id)) problems.push({ code: "SOURCE_WITHOUT_FACTS", path: "data/knowledge/sources.jsonl", field: source.source_id });
  if (problems.length) return { ok: false, problems, manifest };

  const contentDigest = await contentDigestOf(statements, evidence);
  if (manifest.content_digest !== contentDigest) problems.push({ code: "CONTENT_DIGEST_MISMATCH", path: "manifest.json", field: "content_digest" });
  if (manifest.source_set_digest !== (await sourceSetDigestOf(sources))) problems.push({ code: "SOURCE_SET_DIGEST_MISMATCH", path: "manifest.json", field: "source_set_digest" });
  if (problems.length) return { ok: false, problems, manifest };

  return {
    ok: true, problems: [],
    pack: {
      manifest, artifactId: manifest.artifact_id as string, scopeSourceIds: scope.source_ids, emptyReplaceSourceIds: emptyReplace,
      baseSourceRunId: (manifest.base_source_run_id as string | null) ?? null, sources, statements, evidence, contentDigest,
    },
  };
}

function validateSources(rows: Record<string, unknown>[], scope: readonly string[], problems: ImportProblem[]): DocSourceRecord[] {
  const path = "data/knowledge/sources.jsonl";
  const out: DocSourceRecord[] = [];
  const versions = new Set<string>();
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 1;
    const before = problems.length;
    strictKeys(row, SOURCE_KEYS, path, line, problems);
    scanStrings(row, path, line, problems);
    if (NEWS_KINDS.has(String(row.source_kind))) problems.push({ code: "NEWS_NOT_ALLOWED_AS_KNOWLEDGE", path, line, field: "source_kind" });
    else if (!SOURCE_KINDS.has(String(row.source_kind))) problems.push({ code: "VALUE_INVALID", path, line, field: "source_kind" });
    if (!isString(row.source_id, 84) || !/^doc:[a-z0-9-]{3,80}$/.test(row.source_id)) problems.push({ code: "VALUE_INVALID", path, line, field: "source_id" });
    else if (!scope.includes(row.source_id)) problems.push({ code: "OUT_OF_PUBLICATION_SCOPE", path, line, field: "source_id" });
    else if (ids.has(row.source_id)) problems.push({ code: "DUPLICATE_SOURCE", path, line, field: "source_id" });
    if (!isString(row.source_version_id, 70) || !/^sv-[a-f0-9]{8,64}$/.test(row.source_version_id)) problems.push({ code: "VALUE_INVALID", path, line, field: "source_version_id" });
    else if (versions.has(row.source_version_id)) problems.push({ code: "DUPLICATE_SOURCE_VERSION", path, line, field: "source_version_id" });
    for (const [field, max] of [["title", 300], ["issuer", 100], ["issuer_sido", 30], ["parser", 60], ["adapter_version", 80], ["rights_basis", 300]] as const) {
      if (!isString(row[field], max)) problems.push({ code: "VALUE_INVALID", path, line, field });
    }
    for (const [field, max] of [["issuer_sigungu", 30], ["document_number", 80]] as const) if (!isString(row[field], max, 0)) problems.push({ code: "VALUE_INVALID", path, line, field });
    if (!(row.url === null || (isString(row.url, 500) && /^https:\/\/[^\s]+$/.test(row.url)))) problems.push({ code: "URL_NOT_ALLOWED", path, line, field: "url" });
    if (!(row.published_date === null || isDate(row.published_date))) problems.push({ code: "VALUE_INVALID", path, line, field: "published_date" });
    if (!isInstant(row.retrieved_at)) problems.push({ code: "VALUE_INVALID", path, line, field: "retrieved_at" });
    if (!isString(row.raw_sha256, 64, 64) || !/^[a-f0-9]{64}$/.test(row.raw_sha256)) problems.push({ code: "VALUE_INVALID", path, line, field: "raw_sha256" });
    if (row.format !== "HWP5" && row.format !== "HWPX") problems.push({ code: "VALUE_INVALID", path, line, field: "format" });
    if (!isString(row.parse_id, 40) || !/^p_[a-f0-9]{32}$/.test(row.parse_id)) problems.push({ code: "VALUE_INVALID", path, line, field: "parse_id" });
    if (row.locator_precision !== "parsed_structural" && row.locator_precision !== "document") problems.push({ code: "VALUE_INVALID", path, line, field: "locator_precision" });
    if (row.page_mode !== "layout" && row.page_mode !== "none") problems.push({ code: "VALUE_INVALID", path, line, field: "page_mode" });
    if (problems.length === before) {
      ids.add(row.source_id as string);
      versions.add(row.source_version_id as string);
      out.push(row as unknown as DocSourceRecord);
    }
  });
  return out;
}

async function validateStatements(rows: Record<string, unknown>[], sources: readonly DocSourceRecord[], problems: ImportProblem[]): Promise<DocStatementRecord[]> {
  const path = "data/knowledge/statements.jsonl";
  const versions = new Set(sources.map((source) => source.source_version_id));
  const out: DocStatementRecord[] = [];
  const ids = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const line = index + 1;
    const before = problems.length;
    strictKeys(row, STATEMENT_KEYS, path, line, problems);
    scanStrings(row, path, line, problems);
    if (row.review_status !== "approved") problems.push({ code: "UNREVIEWED_FACT", path, line, field: "review_status" });
    if (row.assertion_type !== "document_field") problems.push({ code: "VALUE_INVALID", path, line, field: "assertion_type" });
    if (!isString(row.subject_id, 500) || !(/^service:/.test(row.subject_id) || /^docprog:[a-z0-9-]{3,80}$/.test(row.subject_id))) problems.push({ code: "SUBJECT_ID_INVALID", path, line, field: "subject_id" });
    if (!isString(row.subject_label, 200)) problems.push({ code: "VALUE_INVALID", path, line, field: "subject_label" });
    if (!isString(row.subject_sido, 30)) problems.push({ code: "VALUE_INVALID", path, line, field: "subject_sido" });
    if (!isString(row.subject_sigungu, 30, 0)) problems.push({ code: "VALUE_INVALID", path, line, field: "subject_sigungu" });
    if (!(typeof row.predicate_id === "string" && row.predicate_id in DOCUMENT_PREDICATES)) problems.push({ code: "PREDICATE_NOT_ALLOWED", path, line, field: "predicate_id" });
    if (!isString(row.value_text, 1000)) problems.push({ code: "VALUE_INVALID", path, line, field: "value_text" });
    if (!optionalString(row.unit, 30)) problems.push({ code: "VALUE_INVALID", path, line, field: "unit" });
    if (!optionalString(row.scope_text, 300)) problems.push({ code: "VALUE_INVALID", path, line, field: "scope_text" });
    if (!isInstant(row.reviewed_at)) problems.push({ code: "VALUE_INVALID", path, line, field: "reviewed_at" });
    if (typeof row.source_version_id !== "string" || !versions.has(row.source_version_id)) problems.push({ code: "SOURCE_VERSION_UNKNOWN", path, line, field: "source_version_id" });
    if (problems.length === before) {
      const statement = row as unknown as DocStatementRecord;
      if ((await statementIdOf(statement)) !== statement.statement_id) problems.push({ code: "STATEMENT_ID_MISMATCH", path, line, field: "statement_id" });
      else if (ids.has(statement.statement_id)) problems.push({ code: "DUPLICATE_STATEMENT", path, line, field: "statement_id" });
      else {
        ids.add(statement.statement_id);
        out.push(statement);
      }
    }
  }
  return out;
}

function validateEvidence(rows: Record<string, unknown>[], statements: readonly DocStatementRecord[], sources: readonly DocSourceRecord[], problems: ImportProblem[]): DocEvidenceRecord[] {
  const path = "data/knowledge/evidence.jsonl";
  const statementVersion = new Map(statements.map((statement) => [statement.statement_id, statement.source_version_id]));
  const parseOf = new Map(sources.map((source) => [source.source_version_id, source.parse_id]));
  const out: DocEvidenceRecord[] = [];
  const ids = new Set<string>();
  const proven = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 1;
    const before = problems.length;
    strictKeys(row, EVIDENCE_KEYS, path, line, problems);
    scanStrings(row, path, line, problems);
    if (!isString(row.evidence_id, 80) || !/^ev_[a-z0-9_]{6,72}$/.test(row.evidence_id)) problems.push({ code: "VALUE_INVALID", path, line, field: "evidence_id" });
    else if (ids.has(row.evidence_id)) problems.push({ code: "DUPLICATE_EVIDENCE", path, line, field: "evidence_id" });
    const version = typeof row.statement_id === "string" ? statementVersion.get(row.statement_id) : undefined;
    if (!version) problems.push({ code: "STATEMENT_UNKNOWN", path, line, field: "statement_id" });
    else if (row.source_version_id !== version) problems.push({ code: "EVIDENCE_SOURCE_MISMATCH", path, line, field: "source_version_id" });
    if (typeof row.source_version_id === "string" && row.parse_id !== parseOf.get(row.source_version_id)) problems.push({ code: "PARSE_ID_MISMATCH", path, line, field: "parse_id" });
    if (!isString(row.block_id, 40) || !/^b:[a-f0-9]{8,32}$/.test(row.block_id)) problems.push({ code: "VALUE_INVALID", path, line, field: "block_id" });
    if (!isString(row.ir_pointer, 200) || !/^\/blocks\/\d+(\/[A-Za-z0-9_]+)*$/.test(row.ir_pointer)) problems.push({ code: "VALUE_INVALID", path, line, field: "ir_pointer" });
    if (!(row.table_id === null || (isString(row.table_id, 40) && /^t:[a-f0-9]{8,32}$/.test(row.table_id)))) problems.push({ code: "VALUE_INVALID", path, line, field: "table_id" });
    if (!optionalString(row.cell, 40)) problems.push({ code: "VALUE_INVALID", path, line, field: "cell" });
    if (row.locator_precision !== "parsed_structural" && row.locator_precision !== "document") problems.push({ code: "VALUE_INVALID", path, line, field: "locator_precision" });
    if (row.page_mode !== "layout" && row.page_mode !== "none") problems.push({ code: "VALUE_INVALID", path, line, field: "page_mode" });
    if (!(row.layout_page_start === null || (Number.isInteger(row.layout_page_start) && (row.layout_page_start as number) > 0))) problems.push({ code: "VALUE_INVALID", path, line, field: "layout_page_start" });
    if (row.physical_page_verified !== false) problems.push({ code: "PHYSICAL_PAGE_NOT_VERIFIED", path, line, field: "physical_page_verified" });
    if (!isString(row.quote, 300)) problems.push({ code: "QUOTE_INVALID", path, line, field: "quote" });
    if (problems.length === before) {
      ids.add(row.evidence_id as string);
      proven.add(row.statement_id as string);
      out.push(row as unknown as DocEvidenceRecord);
    }
  });
  statements.forEach((statement) => {
    if (!proven.has(statement.statement_id)) problems.push({ code: "STATEMENT_WITHOUT_EVIDENCE", path: "data/knowledge/statements.jsonl", field: statement.statement_id });
  });
  return out;
}
