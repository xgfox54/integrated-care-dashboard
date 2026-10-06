// 예산서 묶음 반입 저장·공개(작업지시서 v5 §22.7·22.9). 상태 흐름은 문서 사실 반입(store.ts)과 같다:
// received → staged(검사·임시 저장) → approved(해시·정책 epoch) → active(공개) → superseded. 공개 포인터는 budget_active_revision이다.
// 같은 문서(document_id)의 새 원문 버전이 공개되면 이전 버전 단계는 공개 목록에서 빠지지만 행은 지우지 않아 되돌릴 수 있다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { BUDGET_IMPORT_FORMAT, type ValidatedBudgetPack, wonOfThousand, thousandOf } from "./budget-pack.ts";

/** 한 SQL 문에 JSON 배열로 묶어 넣는 행 수(D1 문 수 제한을 넘지 않도록). */
const ROWS_PER_STATEMENT = 200;

function chunks<T>(rows: readonly T[], size = ROWS_PER_STATEMENT): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size));
  return out;
}

/** 재정주체 ID가 지방재정365 자료에 있는지. 없는 ID로 문서를 재정주체에 붙이지 않는다. */
export async function unknownFiscalEntities(db: SqlDatabase, pack: ValidatedBudgetPack): Promise<string[]> {
  const ids = [...new Set(pack.documents.flatMap((document) => (document.fiscal_entity_id ? [document.fiscal_entity_id] : [])))];
  if (!ids.length) return [];
  const found = new Set((await db.prepare("SELECT fiscal_entity_id FROM fiscal_entity WHERE fiscal_entity_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<{ fiscal_entity_id: string }>()).results.map((row) => row.fiscal_entity_id));
  return ids.filter((id) => !found.has(id));
}

/** 검사를 통과한 묶음을 이 반입 ID 아래 임시 행으로 저장한다(공개는 활성화 때). */
export function stageBudgetStatements(db: SqlDatabase, importId: string, pack: ValidatedBudgetPack): SqlStatement[] {
  const statements: SqlStatement[] = ["budget_document", "budget_revision", "budget_line", "budget_funding_component"].map((table) => db.prepare("DELETE FROM " + table + " WHERE import_id = ?").bind(importId));
  for (const document of pack.documents) {
    statements.push(db.prepare(
      "INSERT INTO budget_document (import_id, document_id, source_version_id, title, issuer, issuer_sido, issuer_sigungu, fiscal_entity_id, fiscal_year, page_url, file_url, retrieved_at, raw_sha256, format, parse_id, parser, extractor_version, rights_basis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(importId, document.document_id, document.source_version_id, document.title, document.issuer, document.issuer_sido, document.issuer_sigungu, document.fiscal_entity_id, document.fiscal_year, document.page_url, document.file_url, document.retrieved_at, document.raw_sha256, document.format, document.parse_id, document.parser, document.extractor_version, document.rights_basis));
  }
  const lineCount = new Map<string, number>();
  for (const line of pack.lines) lineCount.set(line.revision_id, (lineCount.get(line.revision_id) ?? 0) + 1);
  for (const revision of pack.revisions) {
    statements.push(db.prepare(
      "INSERT INTO budget_revision (import_id, revision_id, document_id, stage, supplementary_round, stage_basis, unit, account_code, account_name, scope_text, amount_columns, line_count, checks_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(importId, revision.revision_id, revision.document_id, revision.stage, revision.supplementary_round, revision.stage_basis, revision.unit, revision.account_code, revision.account_name, revision.scope_text,
      JSON.stringify({ columns: revision.amount_columns, previous_column: revision.previous_column }), lineCount.get(revision.revision_id) ?? 0, JSON.stringify(pack.checks[revision.revision_id] ?? {})));
  }
  // 행은 JSON 배열 하나로 묶어 json_each로 넣는다. 금액은 문서 표시(천원) 문자열과 원 단위 10진 문자열을 함께 둔다.
  const lineRows = pack.lines.map((line) => {
    const fundingTotal = line.funding.reduce((sum, item) => sum + (thousandOf(item.amount_thousand_krw) ?? 0), 0);
    const amount = thousandOf(line.amount_thousand_krw);
    return [
      line.line_id, line.revision_id, line.line_no, line.parent_line_no, line.level, line.code, line.name, line.level === "item" ? line.name : null, line.formula_text,
      line.amount_thousand_krw, wonOfThousand(line.amount_thousand_krw), line.previous_amount_thousand_krw, line.change_amount_thousand_krw, line.amount_basis,
      line.funding.length ? (amount !== null && fundingTotal === amount ? 1 : 0) : null, line.page, line.table_id, line.block_id, line.row_index, JSON.stringify(line.checks), JSON.stringify(line.annotations),
    ];
  });
  const columns = ["line_id", "revision_id", "line_no", "parent_line_no", "level", "code", "name", "bugi_name", "formula_text", "amount_thousand_krw", "amount_krw", "previous_amount_thousand_krw", "change_amount_thousand_krw", "amount_basis", "funding_complete", "page", "table_id", "block_id", "row_index", "checks_json", "annotations_json"];
  for (const part of chunks(lineRows)) {
    statements.push(db.prepare(
      "INSERT INTO budget_line (import_id, " + columns.join(", ") + ") SELECT ?, " + columns.map((_, index) => "json_extract(value, '$[" + index + "]')").join(", ") + " FROM json_each(?)",
    ).bind(importId, JSON.stringify(part)));
  }
  const fundingRows = pack.lines.flatMap((line) => line.funding.map((item, ordinal) => [line.line_id, ordinal, item.source, item.label, item.amount_thousand_krw]));
  for (const part of chunks(fundingRows, 400)) {
    statements.push(db.prepare(
      "INSERT INTO budget_funding_component (import_id, line_id, ordinal, source, label, amount_thousand_krw) SELECT ?, json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), json_extract(value, '$[4]') FROM json_each(?)",
    ).bind(importId, JSON.stringify(part)));
  }
  return statements;
}

export function budgetReport(pack: ValidatedBudgetPack, unknownEntities: readonly string[]): Record<string, unknown> {
  return {
    kind: "budget_documents",
    counts: { documents: pack.documents.length, revisions: pack.revisions.length, lines: pack.lines.length },
    revisions: pack.revisions.map((revision) => ({ revision_id: revision.revision_id, document_id: revision.document_id, stage: revision.stage, supplementary_round: revision.supplementary_round, scope_text: revision.scope_text })),
    server_checks: pack.checks,
    content_digest: pack.contentDigest,
    unknown_fiscal_entities: unknownEntities,
  };
}

/**
 * 공개 포인터 교체. 같은 문서의 다른 원문 버전 단계는 공개 목록에서 빼고 이 반입의 단계를 넣는다.
 * 모든 쓰기가 「이 반입이 아직 fromStatus」 조건에 묶여, 동시에 두 번 눌러도 한 번만 바뀐다(D1 batch는 한 트랜잭션).
 */
export async function switchActiveBudget(db: SqlDatabase, importId: string, fromStatus: "approved" | "superseded", now: number): Promise<void> {
  const guard = "(SELECT status FROM import_artifact WHERE import_id = ?) = ?";
  await db.batch([
    db.prepare("DELETE FROM budget_active_revision WHERE document_id IN (SELECT document_id FROM budget_document WHERE import_id = ?) AND " + guard).bind(importId, importId, fromStatus),
    db.prepare(
      "INSERT INTO budget_active_revision (revision_id, import_id, document_id, fiscal_entity_id, fiscal_year, stage, supplementary_round, retrieved_at, activated_at) " +
        "SELECT r.revision_id, r.import_id, r.document_id, d.fiscal_entity_id, d.fiscal_year, r.stage, r.supplementary_round, d.retrieved_at, ? FROM budget_revision r " +
        "JOIN budget_document d ON d.import_id = r.import_id AND d.document_id = r.document_id WHERE r.import_id = ? AND " + guard,
    ).bind(now, importId, importId, fromStatus),
    db.prepare("UPDATE import_artifact SET status = 'active', activated_at = ?, updated_at = ? WHERE import_id = ? AND status = ?").bind(now, now, importId, fromStatus),
    db.prepare("UPDATE import_artifact SET status = 'superseded', updated_at = ? WHERE status = 'active' AND format = ? AND import_id <> ? AND import_id NOT IN (SELECT import_id FROM budget_active_revision)").bind(now, BUDGET_IMPORT_FORMAT, importId),
  ]);
}

/** 같은 문서에 더 새로 받은 원문으로 만든 단계가 이미 공개 중이면 그 문서 ID(오래된 묶음으로 덮어쓰지 않음). */
export async function staleBudgetDocuments(db: SqlDatabase, importId: string): Promise<string[]> {
  return (await db.prepare(
    "SELECT DISTINCT a.document_id FROM budget_active_revision a JOIN budget_document d ON d.import_id = ? AND d.document_id = a.document_id WHERE a.import_id <> ? AND a.retrieved_at > d.retrieved_at",
  ).bind(importId, importId).all<{ document_id: string }>()).results.map((row) => row.document_id);
}


export async function readActiveBudgetRevisions(db: SqlDatabase) {
  return (await db.prepare(
    "SELECT a.revision_id, a.import_id, a.document_id, a.fiscal_entity_id, a.fiscal_year, a.stage, a.supplementary_round, a.activated_at, d.title, d.issuer, r.line_count, r.scope_text " +
      "FROM budget_active_revision a JOIN budget_document d ON d.import_id = a.import_id AND d.document_id = a.document_id JOIN budget_revision r ON r.import_id = a.import_id AND r.revision_id = a.revision_id ORDER BY a.fiscal_entity_id, a.fiscal_year, a.stage",
  ).all<Record<string, unknown>>()).results;
}
