// 반입된 문서 사실의 공개 조회. 활성(doc_active_source)인 원문 버전의 사실만 보이고, 전역 차단(doc_block)은 언제나 먼저 적용한다.
// MCP는 요청 시작 때 고른 통합 공개본의 (반입 ID|원문 버전) 목록으로 고정해 읽는다. 웹은 현재 활성 목록을 읽는다.
import { sha256Hex } from "../press/normalize.ts";
import type { SqlDatabase } from "../sql-database.ts";
import { DOCUMENT_PREDICATES, type DocumentPredicate } from "./pack.ts";

export interface DocFactRow {
  readonly import_id: string;
  readonly statement_id: string;
  readonly subject_id: string;
  readonly subject_label: string;
  readonly subject_sido: string;
  readonly subject_sigungu: string;
  readonly predicate_id: DocumentPredicate;
  readonly value_text: string;
  readonly unit: string | null;
  readonly scope_text: string | null;
  readonly source_version_id: string;
  readonly reviewed_at: string;
  readonly source_id: string;
  readonly title: string;
  readonly issuer: string;
  readonly document_number: string;
  readonly url: string | null;
  readonly published_date: string | null;
  readonly retrieved_at: string;
  readonly format: string;
  readonly parse_id: string;
  readonly parser: string;
  readonly rights_basis: string;
  /** 원문 안 순서(근거 블록 번호). 같은 항목 여러 줄을 문서 순서대로 보이게 한다. */
  readonly document_order: number | null;
}

export interface DocEvidenceRow {
  readonly import_id: string;
  readonly evidence_id: string;
  readonly statement_id: string;
  readonly source_version_id: string;
  readonly parse_id: string;
  readonly block_id: string;
  readonly ir_pointer: string;
  readonly table_id: string | null;
  readonly cell: string | null;
  readonly locator_precision: string;
  readonly page_mode: string;
  readonly layout_page_start: number | null;
  readonly physical_page_verified: number;
  readonly quote: string;
}

/** null이면 현재 활성 목록, 배열이면 그 (반입 ID|원문 버전) 목록으로 고정. */
export type DocPin = readonly string[] | null;

const FACT_COLUMNS =
  "s.import_id, s.statement_id, s.subject_id, s.subject_label, s.subject_sido, s.subject_sigungu, s.predicate_id, s.value_text, s.unit, s.scope_text, s.source_version_id, s.reviewed_at, " +
  "d.source_id, d.title, d.issuer, d.document_number, d.url, d.published_date, d.retrieved_at, d.format, d.parse_id, d.parser, d.rights_basis, " +
  "(SELECT MIN(CAST(substr(e.ir_pointer, 9) AS INTEGER)) FROM doc_evidence e WHERE e.import_id = s.import_id AND e.statement_id = s.statement_id) AS document_order";
/** 항목 순서: 지원대상 → 신청자격 → … → 담당기관(DOCUMENT_PREDICATES 선언 순서), 같은 항목은 원문 순서. */
const FACT_ORDER = "CASE s.predicate_id " + Object.keys(DOCUMENT_PREDICATES).map((key, index) => "WHEN '" + key + "' THEN " + index).join(" ") + " ELSE 99 END, document_order, s.statement_id";
const FACT_FROM = "FROM doc_statement s JOIN doc_source d ON d.import_id = s.import_id AND d.source_version_id = s.source_version_id";
const NOT_BLOCKED = "d.source_id NOT IN (SELECT source_id FROM doc_block)";

/**
 * 보이는 사실: 고정 목록(또는 현재 활성)의 원문 버전이고, 대시보드 사업(service:)에 붙은 사실은 그 지식 수집 run에 사업이 있다고
 * 확인된 것만. 원본이 바뀌어 확인 전이거나 사라졌으면 보류한다(이전 사실을 최신으로 표시하지 않음).
 */
function visible(pin: DocPin, runId: string | null): { readonly clause: string; readonly binds: unknown[] } {
  const subject = "(s.subject_id NOT LIKE 'service:%' OR EXISTS (SELECT 1 FROM doc_subject_check c WHERE c.subject_id = s.subject_id AND c.knowledge_run_id = ? AND c.exists_in_run = 1))";
  if (pin) return { clause: "(s.import_id || '|' || s.source_version_id) IN (SELECT value FROM json_each(?)) AND " + subject, binds: [JSON.stringify(pin), runId ?? ""] };
  return { clause: "EXISTS (SELECT 1 FROM doc_active_source a WHERE a.import_id = s.import_id AND a.source_version_id = s.source_version_id) AND " + subject, binds: [runId ?? ""] };
}

export async function latestKnowledgeRunId(db: SqlDatabase): Promise<string | null> {
  return (await db.prepare("SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1").first<{ id: string }>())?.id ?? null;
}

/** 활성 문서 사실이 가리키는 대시보드 사업이 이 run에 있는지 확인해 기록한다. 한 번에 limit건까지. */
export async function refreshDocumentSubjects(db: SqlDatabase, runId: string, exists: (ids: readonly string[]) => Promise<ReadonlySet<string>>, now: number, limit = 50): Promise<number> {
  const pending = (await db.prepare(
    "SELECT DISTINCT s.subject_id FROM doc_statement s JOIN doc_active_source a ON a.import_id = s.import_id AND a.source_version_id = s.source_version_id " +
      "WHERE s.subject_id LIKE 'service:%' AND NOT EXISTS (SELECT 1 FROM doc_subject_check c WHERE c.subject_id = s.subject_id AND c.knowledge_run_id = ?) LIMIT ?",
  ).bind(runId, limit).all<{ subject_id: string }>()).results.map((row) => row.subject_id);
  if (!pending.length) return 0;
  const found = await exists(pending);
  await db.batch(pending.map((id) => db.prepare("INSERT OR REPLACE INTO doc_subject_check (subject_id, knowledge_run_id, exists_in_run, checked_at) VALUES (?, ?, ?, ?)").bind(id, runId, found.has(id) ? 1 : 0, now)));
  return pending.length;
}

/** 통합 공개본의 documents 구성요소. 활성 원문 버전 목록이 바뀌면 ID가 바뀐다. */
export async function documentComponent(db: SqlDatabase): Promise<{ readonly id: string | null; readonly status: "PARTIAL" | "UNAVAILABLE"; readonly detail: Record<string, unknown> }> {
  const runId = await latestKnowledgeRunId(db);
  const held = (await db.prepare(
    "SELECT DISTINCT s.subject_id FROM doc_statement s JOIN doc_active_source a ON a.import_id = s.import_id AND a.source_version_id = s.source_version_id " +
      "WHERE s.subject_id LIKE 'service:%' AND NOT EXISTS (SELECT 1 FROM doc_subject_check c WHERE c.subject_id = s.subject_id AND c.knowledge_run_id = ? AND c.exists_in_run = 1) ORDER BY s.subject_id",
  ).bind(runId ?? "").all<{ subject_id: string }>()).results.map((row) => row.subject_id);
  const rows = (await db.prepare(
    "SELECT a.import_id, a.source_version_id, (SELECT COUNT(*) FROM doc_statement s WHERE s.import_id = a.import_id AND s.source_version_id = a.source_version_id) AS statements " +
      "FROM doc_active_source a WHERE a.source_id NOT IN (SELECT source_id FROM doc_block) ORDER BY a.import_id, a.source_version_id",
  ).all<{ import_id: string; source_version_id: string; statements: number }>()).results;
  if (!rows.length) return { id: null, status: "UNAVAILABLE", detail: { reason: "승인·활성화된 문서 사실이 없음" } };
  const pairs = rows.map((row) => row.import_id + "|" + row.source_version_id);
  return {
    id: "docs:" + (await sha256Hex(pairs.join(",") + "#" + (runId ?? "") + "#" + held.join(","))).slice(0, 16),
    status: "PARTIAL",
    detail: { pairs, sources: rows.length, statements: rows.reduce((sum, row) => sum + row.statements, 0), knowledge_run_id: runId, held_subjects: held },
  };
}

export async function documentFactsFor(db: SqlDatabase, subjectIds: readonly string[], pin: DocPin, runId: string | null): Promise<DocFactRow[]> {
  if (!subjectIds.length) return [];
  const { clause, binds } = visible(pin, runId);
  return (await db.prepare(
    "SELECT " + FACT_COLUMNS + " " + FACT_FROM + " WHERE s.subject_id IN (SELECT value FROM json_each(?)) AND " + clause + " AND " + NOT_BLOCKED + " ORDER BY s.subject_id, " + FACT_ORDER,
  ).bind(JSON.stringify(subjectIds), ...binds).all<DocFactRow>()).results;
}

export async function allDocumentFacts(db: SqlDatabase, pin: DocPin, runId: string | null, limit = 500): Promise<DocFactRow[]> {
  const { clause, binds } = visible(pin, runId);
  return (await db.prepare(
    "SELECT " + FACT_COLUMNS + " " + FACT_FROM + " WHERE " + clause + " AND " + NOT_BLOCKED + " ORDER BY s.subject_sido, s.subject_sigungu, s.subject_label, s.subject_id, " + FACT_ORDER + " LIMIT ?",
  ).bind(...binds, limit).all<DocFactRow>()).results;
}

export async function documentEvidence(db: SqlDatabase, facts: readonly DocFactRow[]): Promise<Map<string, DocEvidenceRow[]>> {
  const keys = [...new Set(facts.map((fact) => fact.import_id + "|" + fact.statement_id))];
  const out = new Map<string, DocEvidenceRow[]>();
  if (!keys.length) return out;
  const rows = (await db.prepare(
    "SELECT * FROM doc_evidence e WHERE (e.import_id || '|' || e.statement_id) IN (SELECT value FROM json_each(?)) ORDER BY e.evidence_id",
  ).bind(JSON.stringify(keys)).all<DocEvidenceRow>()).results;
  for (const row of rows) {
    const key = row.import_id + "|" + row.statement_id;
    out.set(key, [...(out.get(key) ?? []), row]);
  }
  return out;
}

/** 문서가 정의한 사업(docprog:) 검색. 낱말은 모두 포함(AND). */
export async function searchDocumentPrograms(db: SqlDatabase, words: readonly string[], pin: DocPin, limit = 5): Promise<{ subject_id: string; subject_label: string; subject_sido: string; subject_sigungu: string }[]> {
  const { clause, binds } = visible(pin, null);
  const like = words.map(() => "(s.subject_label || ' ' || s.subject_sido || ' ' || s.subject_sigungu || ' ' || s.value_text) LIKE ? ESCAPE '\\'");
  const escaped = words.map((word) => "%" + word.replace(/[\\%_]/g, (char) => "\\" + char) + "%");
  return (await db.prepare(
    "SELECT s.subject_id, MIN(s.subject_label) AS subject_label, MIN(s.subject_sido) AS subject_sido, MIN(s.subject_sigungu) AS subject_sigungu " + FACT_FROM +
      " WHERE s.subject_id LIKE 'docprog:%' AND " + clause + " AND " + NOT_BLOCKED + (like.length ? " AND " + like.join(" AND ") : "") + " GROUP BY s.subject_id ORDER BY subject_label LIMIT ?",
  ).bind(...binds, ...escaped, limit).all<{ subject_id: string; subject_label: string; subject_sido: string; subject_sigungu: string }>()).results;
}

export async function documentSourceRows(db: SqlDatabase, sourceId: string, pin: DocPin, runId: string | null): Promise<DocFactRow[]> {
  const { clause, binds } = visible(pin, runId);
  return (await db.prepare("SELECT " + FACT_COLUMNS + " " + FACT_FROM + " WHERE d.source_id = ? AND " + clause + " AND " + NOT_BLOCKED + " ORDER BY s.subject_id, " + FACT_ORDER)
    .bind(sourceId, ...binds).all<DocFactRow>()).results;
}

/** 공개 사실 한 건의 표현. 근거 위치는 파싱 구조 기준이며 실제 인쇄 쪽수를 확인한 값이 아니다. */
export function documentFactDto(fact: DocFactRow, evidence: readonly DocEvidenceRow[]) {
  return {
    statement_id: fact.statement_id,
    predicate_id: fact.predicate_id,
    predicate_label: DOCUMENT_PREDICATES[fact.predicate_id] ?? fact.predicate_id,
    value: fact.value_text,
    unit: fact.unit,
    scope: fact.scope_text,
    assertion_type: "document_field",
    review_status: "approved",
    reviewed_at: fact.reviewed_at,
    source: {
      source_id: fact.source_id, source_version_id: fact.source_version_id, title: fact.title, issuer: fact.issuer,
      document_number: fact.document_number || null, url: fact.url, published_date: fact.published_date, retrieved_at: fact.retrieved_at,
      format: fact.format, parser: fact.parser, rights_basis: fact.rights_basis,
    },
    evidence: evidence.map((item) => ({
      evidence_id: item.evidence_id, kind: "DOCUMENT_LOCATOR", parse_id: item.parse_id, block_id: item.block_id, ir_pointer: item.ir_pointer,
      table_id: item.table_id, cell: item.cell, locator_precision: item.locator_precision, page_mode: item.page_mode,
      layout_page_start: item.layout_page_start, physical_page_verified: item.physical_page_verified === 1, quote: item.quote,
    })),
  };
}
