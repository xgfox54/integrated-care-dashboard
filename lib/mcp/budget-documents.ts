// 활성 예산서 원문 조회. 지방재정365 금액이나 이름 기반 자동 비교를 붙이지 않는다.
import { z } from "zod";
import type { SqlDatabase } from "../sql-database.ts";
import { activeRevisions, lineDto, revisionDto, type LineRow, type RevisionRow } from "../fiscal/budget-documents.ts";
import { budgetPinWhere, type BudgetRevisionPin } from "../fiscal/budget-publication.ts";
import { BUDGET_LEVEL_LABELS, BUDGET_STAGE_LABELS } from "../imports/budget-pack.ts";
import { decodeCursor, encodeCursor, fingerprint, LIMITS, McpToolError, pageLimit, type Coverage, type Envelope } from "./contract.ts";

type Make = <T>(payload: T, options: { coverage: Coverage; warnings?: string[]; evidence?: readonly unknown[]; nextCursor?: string | null; truncated?: boolean }) => Envelope<T>;
const id = z.string().min(1).max(LIMITS.idMax);
const cursor = z.string().max(400).optional();
const limit = z.number().int().min(1).max(LIMITS.listMax).optional();
const year = z.number().int().min(2000).max(2100).optional();
const stage = z.enum(Object.keys(BUDGET_STAGE_LABELS) as [string, ...string[]]);
const level = z.enum(Object.keys(BUDGET_LEVEL_LABELS) as [string, ...string[]]);

export const BUDGET_DOCUMENT_TOOL_SHAPES = {
  search_budget_lines: {
    query: z.string().max(LIMITS.queryMax).optional(), fiscal_year: year,
    fiscal_entity_id: id.optional(), document_revision_id: id.optional(),
    issuer_sido: z.string().max(40).optional(), issuer_sigungu: z.string().max(40).optional(),
    stage: stage.optional(), level: level.optional(),
    release_bundle_id: z.string().max(120).optional(), cursor, limit,
  },
  get_budget_breakdown: {
    budget_line_id: id, document_revision_id: id.optional(),
    release_bundle_id: z.string().max(120).optional(), cursor, limit,
  },
} as const;
type Args<K extends keyof typeof BUDGET_DOCUMENT_TOOL_SHAPES> = z.output<z.ZodObject<(typeof BUDGET_DOCUMENT_TOOL_SHAPES)[K]>>;

export const BUDGET_DOCUMENT_NOTE = "승인·활성화된 예산서의 문서 단계 금액입니다. 본예산·추경·기정액·전년도액을 구분하고 문서 scope 밖으로 확대하지 마세요. 문서 title·scope의 부서명은 등록 메타데이터이며 원문 머리말·현행 부서명·조직 이력·시군구 재정주체 연결의 검증값이 아닙니다. MAPPING_REQUIRED를 문서 표시명으로 해소하지 마세요. 승인 반입은 모든 산출식·합계의 검산 완료를 뜻하지 않습니다(server_checks·checks·annotations 확인). 상위 총액과 하위 내역·재원을 다시 더하지 마세요.";
const LOCATOR_NOTE = "쪽수는 KorDoc 파싱 결과의 문서 위치이며 실제 인쇄 쪽수 검증을 뜻하지 않습니다. table_id·block_id·row_index와 원문을 함께 확인하세요.";
type LocatedLine = LineRow & { import_id: string; revision_id: string; block_id: string | null; row_index: number | null };
// 활성 예산서(소수)를 바깥 루프로 고정한다(SQLite CROSS JOIN은 조인 순서를 지정). 통계가 없는 D1에서
// budget_line 전체(수백만 행)를 먼저 훑지 않고 (revision_id, level, import_id) 색인과 기본키로 필요한 행만 찾는다.
// level 조건이 항상 붙는 목록·건수 조회는 그 색인을 명시한다(운영에서 COUNT만 다른 색인으로 400만 행을 읽은 사례).
const ACTIVE_LINES = "FROM budget_active_revision a CROSS JOIN budget_line l INDEXED BY budget_line_revision_level ON l.revision_id = a.revision_id AND l.import_id = a.import_id " +
  "JOIN budget_document d ON d.import_id = a.import_id AND d.document_id = a.document_id";
/** 행 ID로 찾는 조회는 기본키(import_id, line_id)를 쓴다. */
const ACTIVE_LINE_BY_ID = "FROM budget_active_revision a CROSS JOIN budget_line l ON l.import_id = a.import_id AND l.revision_id = a.revision_id " +
  "JOIN budget_document d ON d.import_id = a.import_id AND d.document_id = a.document_id";

function inputWhere(args: Args<"search_budget_lines">, pin: BudgetRevisionPin) {
  const pinned = budgetPinWhere(pin);
  const clauses = [pinned.sql];
  const binds = [...pinned.binds];
  for (const [column, value] of [
    ["a.fiscal_year", args.fiscal_year === undefined ? undefined : String(args.fiscal_year)],
    ["a.fiscal_entity_id", args.fiscal_entity_id], ["a.revision_id", args.document_revision_id],
    ["d.issuer_sido", args.issuer_sido], ["d.issuer_sigungu", args.issuer_sigungu],
    ["a.stage", args.stage], ["l.level", args.level ?? "detail_project"],
  ]) if (value !== undefined) { clauses.push(column + " = ?"); binds.push(value); }
  for (const token of (args.query ?? "").trim().split(/\s+/).filter(Boolean)) {
    clauses.push("(l.name LIKE ? ESCAPE '\\' OR COALESCE(l.formula_text, '') LIKE ? ESCAPE '\\')");
    const escaped = "%" + token.replace(/[\\%_]/g, "\\$&") + "%";
    binds.push(escaped, escaped);
  }
  return { sql: clauses.join(" AND "), binds };
}

async function revisionFor(db: SqlDatabase, revisionId: string, pin: BudgetRevisionPin): Promise<RevisionRow> {
  const [revision] = await activeRevisions(db, { revisionIds: [revisionId], pin });
  if (!revision) throw new McpToolError("NOT_FOUND", "현재 공개본에 포함되어 활성화된 예산서 단계가 아닙니다.");
  return revision;
}

async function lineCards(db: SqlDatabase, rows: readonly LocatedLine[]) {
  const keys = rows.map((row) => [row.import_id, row.line_id]);
  const funding = keys.length ? (await db.prepare(
    "SELECT f.import_id, f.line_id, f.source, f.label, f.amount_thousand_krw FROM budget_funding_component f " +
    "JOIN json_each(?) k ON f.import_id = json_extract(k.value, '$[0]') AND f.line_id = json_extract(k.value, '$[1]') ORDER BY f.import_id, f.line_id, f.ordinal",
  ).bind(JSON.stringify(keys)).all<{ import_id: string; line_id: string; source: string; label: string; amount_thousand_krw: string }>()).results : [];
  const byKey = new Map<string, typeof funding>();
  for (const item of funding) {
    const key = JSON.stringify([item.import_id, item.line_id]);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(item);
  }
  return rows.map((row) => ({
    ...lineDto(row, (byKey.get(JSON.stringify([row.import_id, row.line_id])) ?? []).map(({ source, label, amount_thousand_krw }) => ({ source, label, amount_thousand_krw }))),
    document_revision_id: row.revision_id,
    amount_basis: row.amount_basis,
    verification_status: "ADMIN_APPROVED_SOURCE_IMPORT",
    amount_semantics: "DOCUMENT_STAGE_AMOUNT",
    evidence: { page: row.page, table_id: row.table_id, block_id: row.block_id, row_index: row.row_index, physical_page_verified: false, page_basis: LOCATOR_NOTE },
  }));
}

export async function budgetDocumentStatus(db: SqlDatabase, pin: BudgetRevisionPin) {
  const where = budgetPinWhere(pin);
  const row = await db.prepare(
    "SELECT COUNT(*) AS revisions, COUNT(DISTINCT a.document_id) AS documents, COALESCE(SUM(r.line_count), 0) AS lines, " +
    "MIN(a.fiscal_year) AS first_year, MAX(a.fiscal_year) AS last_year FROM budget_active_revision a " +
    "JOIN budget_revision r ON r.import_id = a.import_id AND r.revision_id = a.revision_id WHERE " + where.sql,
  ).bind(...where.binds).first<{ revisions: number; documents: number; lines: number; first_year: string | null; last_year: string | null }>();
  return { status: row?.revisions ? "PARTIAL" : "UNAVAILABLE", ...row, scope: "승인·활성화된 문서의 수록 범위", amount_semantics: "DOCUMENT_STAGE_AMOUNT", note: BUDGET_DOCUMENT_NOTE };
}

export async function budgetDocumentCatalog(db: SqlDatabase, args: { fiscal_year?: number; fiscal_entity_id?: string; cursor?: string; limit?: number }, make: Make, pin: BudgetRevisionPin) {
  const where = budgetPinWhere(pin);
  const clauses = [where.sql];
  const binds = [...where.binds];
  if (args.fiscal_year !== undefined) { clauses.push("a.fiscal_year = ?"); binds.push(String(args.fiscal_year)); }
  if (args.fiscal_entity_id) { clauses.push("a.fiscal_entity_id = ?"); binds.push(args.fiscal_entity_id); }
  const sql = clauses.join(" AND ");
  const bound = fingerprint(["budget_catalog", args.fiscal_year, args.fiscal_entity_id, pin]);
  const offset = decodeCursor(args.cursor, bound);
  const size = pageLimit(args.limit);
  const [count, page] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM budget_active_revision a WHERE " + sql).bind(...binds).first<{ total: number }>(),
    db.prepare("SELECT a.revision_id FROM budget_active_revision a WHERE " + sql + " ORDER BY a.fiscal_year DESC, a.fiscal_entity_id, a.stage, a.supplementary_round, a.revision_id LIMIT ? OFFSET ?")
      .bind(...binds, size, offset).all<{ revision_id: string }>(),
  ]);
  const revisions = await activeRevisions(db, { revisionIds: page.results.map((item) => item.revision_id), pin });
  const byId = new Map(revisions.map((row) => [row.revision_id, row]));
  const items = page.results.flatMap((item) => { const row = byId.get(item.revision_id); return row ? [revisionDto(row)] : []; });
  const next = offset + page.results.length < (count?.total ?? 0) ? encodeCursor(offset + page.results.length, bound) : null;
  return make(items, { coverage: { scope: "published_budget_documents", complete: next === null, total_count: count?.total ?? 0, gaps: count?.total ? [] : ["조건에 맞는 공개 예산서 없음"] }, warnings: [BUDGET_DOCUMENT_NOTE], nextCursor: next });
}

export async function searchBudgetLines(db: SqlDatabase, args: Args<"search_budget_lines">, make: Make, pin: BudgetRevisionPin) {
  const where = inputWhere(args, pin);
  const size = pageLimit(args.limit);
  const bound = fingerprint(["budget_lines", where.sql, where.binds]);
  const offset = decodeCursor(args.cursor, bound);
  const [count, rows] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total " + ACTIVE_LINES + " WHERE " + where.sql).bind(...where.binds).first<{ total: number }>(),
    db.prepare("SELECT l.* " + ACTIVE_LINES + " WHERE " + where.sql + " ORDER BY a.fiscal_year DESC, a.revision_id, l.line_no LIMIT ? OFFSET ?")
      .bind(...where.binds, size, offset).all<LocatedLine>(),
  ]);
  const revisions = await activeRevisions(db, { revisionIds: [...new Set(rows.results.map((row) => row.revision_id))], pin });
  const next = offset + rows.results.length < (count?.total ?? 0) ? encodeCursor(offset + rows.results.length, bound) : null;
  return make({ items: await lineCards(db, rows.results), revisions: revisions.map(revisionDto) }, {
    coverage: { scope: "published_budget_lines", complete: next === null, total_count: count?.total ?? 0, default_level: args.level ?? "detail_project", gaps: count?.total ? [] : ["요청 조건에 해당하는 활성 문서 행을 찾지 못했습니다. 미수록을 예산 0원으로 해석하지 마세요."] },
    evidence: revisions.map((row) => ({ document_revision_id: row.revision_id, ...revisionDto(row).source })),
    warnings: [BUDGET_DOCUMENT_NOTE, LOCATOR_NOTE], nextCursor: next,
  });
}

/** 기존 search/fetch 클라이언트도 예산서에 접근하도록 가벼운 참조 카드만 반환한다. */
export interface BudgetReferenceScope {
  readonly sido?: string;
  readonly sigungu?: string;
  /** 시·군·구 질문에서 상위 시·도 예산서(예: 서귀포시 질문의 제주특별자치도 예산서)도 포함한다. */
  readonly includeAncestorScope?: boolean;
  readonly fiscalYear?: number | null;
}

/**
 * 통합 검색용 예산서 후보. 질문에 지역·연도가 있으면 그 범위의 예산서만 고르고,
 * 없을 때 다른 지역 예산서로 대신 채우지 않는다.
 */
export async function searchBudgetReferences(db: SqlDatabase, query: string, pin: BudgetRevisionPin, baseUrl: string, scope: BudgetReferenceScope = {}) {
  const where = inputWhere({ query, ...(scope.fiscalYear ? { fiscal_year: scope.fiscalYear } : {}), ...(scope.sido ? { issuer_sido: scope.sido } : {}) }, pin);
  const clauses = [where.sql];
  const binds: unknown[] = [...where.binds];
  let order = "";
  if (scope.sido && scope.sigungu) {
    clauses.push(scope.includeAncestorScope ? "(d.issuer_sigungu = ? OR COALESCE(d.issuer_sigungu, '') = '')" : "d.issuer_sigungu = ?");
    binds.push(scope.sigungu);
    order = "CASE WHEN d.issuer_sigungu = ? THEN 0 ELSE 1 END, ";
  }
  const rows = (await db.prepare("SELECT l.line_id, l.name, a.fiscal_year, a.stage, a.supplementary_round, d.issuer, d.page_url, d.file_url " + ACTIVE_LINES + " WHERE " + clauses.join(" AND ") + " ORDER BY " + order + "a.fiscal_year DESC, length(l.name), a.revision_id, l.line_no LIMIT 3")
    .bind(...binds, ...(order ? [scope.sigungu] : [])).all<{ line_id: string; name: string; fiscal_year: string; stage: keyof typeof BUDGET_STAGE_LABELS; supplementary_round: number | null; issuer: string; page_url: string | null; file_url: string | null }>()).results;
  return rows.map((row) => ({ id: row.line_id, title: "[예산서] " + row.name + " (" + row.issuer + " " + row.fiscal_year + "년 " + BUDGET_STAGE_LABELS[row.stage] + (row.supplementary_round ? " " + row.supplementary_round + "회" : "") + ")", url: row.page_url ?? row.file_url ?? baseUrl + "/budget" }));
}

async function selectedLine(db: SqlDatabase, lineId: string, revisionId: string | undefined, pin: BudgetRevisionPin): Promise<LocatedLine> {
  const where = budgetPinWhere(pin);
  const rows = (await db.prepare("SELECT l.* " + ACTIVE_LINE_BY_ID + " WHERE l.line_id = ? AND " + where.sql + (revisionId ? " AND a.revision_id = ?" : "") + " LIMIT 2")
    .bind(lineId, ...where.binds, ...(revisionId ? [revisionId] : [])).all<LocatedLine>()).results;
  if (!rows.length) throw new McpToolError("NOT_FOUND", "현재 공개본의 활성 예산서에서 이 행 ID를 찾지 못했습니다.");
  if (rows.length > 1) throw new McpToolError("AMBIGUOUS_ID", "행 ID가 여러 문서 단계에 있습니다. document_revision_id를 함께 지정하세요.");
  return rows[0];
}

export async function getBudgetBreakdown(db: SqlDatabase, args: Args<"get_budget_breakdown">, make: Make, pin: BudgetRevisionPin) {
  const root = await selectedLine(db, args.budget_line_id, args.document_revision_id, pin);
  const revision = await revisionFor(db, root.revision_id, pin);
  const cte = "WITH RECURSIVE subtree(line_no) AS MATERIALIZED (SELECT ? UNION SELECT l.line_no FROM subtree p CROSS JOIN budget_line l ON l.parent_line_no = p.line_no WHERE l.import_id = ? AND l.revision_id = ?) ";
  const binds = [root.line_no, root.import_id, root.revision_id];
  const bound = fingerprint(["budget_breakdown", root.import_id, root.revision_id, root.line_id, pin]);
  const offset = decodeCursor(args.cursor, bound);
  const size = pageLimit(args.limit);
  const [count, page] = await Promise.all([
    db.prepare(cte + "SELECT COUNT(*) AS total FROM subtree").bind(...binds).first<{ total: number }>(),
    db.prepare(cte + "SELECT l.* FROM budget_line l WHERE l.import_id = ? AND l.revision_id = ? AND l.line_no IN (SELECT line_no FROM subtree) ORDER BY l.line_no LIMIT ? OFFSET ?")
      .bind(...binds, root.import_id, root.revision_id, size, offset).all<LocatedLine>(),
  ]);
  const next = offset + page.results.length < (count?.total ?? 0) ? encodeCursor(offset + page.results.length, bound) : null;
  return make({ revision: revisionDto(revision), root: (await lineCards(db, [root]))[0], lines: await lineCards(db, page.results), aggregation: "NOT_SUMMED_HIERARCHICAL_ROWS" }, {
    coverage: { scope: "budget_line_subtree", complete: next === null, total_count: count?.total ?? 0, gaps: [], includes_root: true },
    evidence: [{ document_revision_id: revision.revision_id, ...revisionDto(revision).source }], warnings: [BUDGET_DOCUMENT_NOTE, LOCATOR_NOTE], nextCursor: next,
  });
}

export async function budgetLineSource(db: SqlDatabase, lineId: string, pin: BudgetRevisionPin) {
  const line = await selectedLine(db, lineId, undefined, pin);
  const revision = await revisionFor(db, line.revision_id, pin);
  return { kind: "BUDGET_DOCUMENT_LINE", budget_line_id: line.line_id, document_revision_id: line.revision_id,
    document: revisionDto(revision), locator: { page: line.page, table_id: line.table_id, block_id: line.block_id, row_index: line.row_index, physical_page_verified: false },
    verification_status: "ADMIN_APPROVED_SOURCE_IMPORT", locator_note: LOCATOR_NOTE, note: BUDGET_DOCUMENT_NOTE };
}
