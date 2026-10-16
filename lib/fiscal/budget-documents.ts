// 예산서(편성 단계 문서) 공개 조회(작업지시서 v5 §22.7·22.8·22.10, T90·T91·T104). 공개(활성)된 단계만 읽는다.
// 문서 금액은 그 문서·편성 단계의 의결(또는 제출) 금액이고, 지방재정365 예산현액은 기준일 현액이다. 두 값은 대조만 하고 서로 덮어쓰지 않는다.
import type { SqlDatabase } from "../sql-database.ts";
import { BUDGET_LEVEL_LABELS, BUDGET_STAGE_LABELS, type BudgetLevel, type BudgetStage, thousandOf } from "../imports/budget-pack.ts";
import { apiRowsFor, compareDocumentRows, type ApiRow } from "./budget-document-comparison.ts";
import { budgetDocumentMatcher, squashName, type BudgetMatchBasis } from "./budget-document-matching.ts";
import { budgetPinWhere, type BudgetRevisionPin } from "./budget-publication.ts";
export { API_RELATION_LABELS } from "./budget-document-comparison.ts";
export { squashName } from "./budget-document-matching.ts";

export interface RevisionRow {
  readonly revision_id: string; readonly import_id: string; readonly document_id: string; readonly fiscal_entity_id: string | null; readonly fiscal_year: string;
  readonly stage: BudgetStage; readonly supplementary_round: number | null; readonly activated_at: number; readonly title: string; readonly issuer: string; readonly issuer_sido: string;
  readonly issuer_sigungu: string; readonly page_url: string | null; readonly file_url: string | null; readonly retrieved_at: string; readonly raw_sha256: string; readonly format: string;
  readonly parse_id: string; readonly parser: string; readonly extractor_version: string; readonly rights_basis: string; readonly stage_basis: string; readonly unit: string;
  readonly account_code: string; readonly account_name: string; readonly scope_text: string; readonly amount_columns: string; readonly line_count: number; readonly checks_json: string;
  readonly entity_name: string | null;
}
export interface LineRow {
  readonly line_id: string; readonly line_no: number; readonly parent_line_no: number | null; readonly level: BudgetLevel; readonly code: string | null; readonly name: string;
  readonly bugi_name: string | null; readonly formula_text: string | null; readonly amount_thousand_krw: string | null; readonly amount_krw: string | null;
  readonly previous_amount_thousand_krw: string | null; readonly change_amount_thousand_krw: string | null; readonly amount_basis: string | null; readonly funding_complete: number | null;
  readonly page: number | null; readonly table_id: string | null; readonly checks_json: string; readonly annotations_json: string;
}

const REVISION_SQL =
  "SELECT a.revision_id, a.import_id, a.document_id, a.fiscal_entity_id, a.fiscal_year, a.stage, a.supplementary_round, a.activated_at, d.title, d.issuer, d.issuer_sido, d.issuer_sigungu, " +
  "d.page_url, d.file_url, d.retrieved_at, d.raw_sha256, d.format, d.parse_id, d.parser, d.extractor_version, d.rights_basis, r.stage_basis, r.unit, r.account_code, r.account_name, r.scope_text, " +
  "r.amount_columns, r.line_count, r.checks_json, e.name AS entity_name FROM budget_active_revision a " +
  "JOIN budget_document d ON d.import_id = a.import_id AND d.document_id = a.document_id JOIN budget_revision r ON r.import_id = a.import_id AND r.revision_id = a.revision_id " +
  "LEFT JOIN fiscal_entity e ON e.fiscal_entity_id = a.fiscal_entity_id";
const LINE_COLUMNS =
  "line_id, line_no, parent_line_no, level, code, name, bugi_name, formula_text, amount_thousand_krw, amount_krw, previous_amount_thousand_krw, change_amount_thousand_krw, amount_basis, funding_complete, page, table_id, checks_json, annotations_json";

export function stageLabel(stage: BudgetStage, round: number | null): string {
  return stage === "adopted_supplementary" && round ? "제" + round + "회 추가경정예산(의결)" : BUDGET_STAGE_LABELS[stage];
}

const parseJson = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
};

export function revisionDto(row: RevisionRow) {
  const columns = parseJson<{ columns?: string[]; previous_column?: string }>(row.amount_columns, {});
  return {
    document_revision_id: row.revision_id,
    document_id: row.document_id,
    title: row.title,
    label_verification: { status: 'CATALOG_METADATA', original_department_header_verified: false, note: 'title·scope는 등록 메타데이터입니다. 원문에 인쇄된 부서명과 현행 부서코드·조직 이력·시군구 재정주체 연결을 증명하지 않습니다. 원문 머리말과 검증된 매핑을 별도 확인하세요.' },
    issuer: row.issuer,
    region: { sido: row.issuer_sido, sigungu: row.issuer_sigungu },
    fiscal_entity: row.fiscal_entity_id ? { fiscal_entity_id: row.fiscal_entity_id, name: row.entity_name } : null,
    fiscal_year: row.fiscal_year,
    stage: row.stage,
    supplementary_round: row.supplementary_round,
    stage_label: stageLabel(row.stage, row.supplementary_round),
    stage_basis: row.stage_basis,
    unit: "천원(문서 표시 단위)",
    account: { code: row.account_code, name: row.account_name },
    scope: row.scope_text,
    amount_columns: columns.columns ?? [],
    previous_column: columns.previous_column ?? "none",
    previous_column_label: columns.previous_column === "pre_revision_budget" ? "기정예산액(이번 추경 직전 확정액)" : columns.previous_column === "previous_year_budget" ? "전년도 예산액" : null,
    line_count: row.line_count,
    server_checks: parseJson<Record<string, unknown>>(row.checks_json, {}),
    source: {
      page_url: row.page_url, file_url: row.file_url, retrieved_at: row.retrieved_at, raw_sha256: row.raw_sha256, format: row.format, parse_id: row.parse_id,
      parser: row.parser, extractor_version: row.extractor_version, rights_basis: row.rights_basis,
    },
    activated_at: new Date(row.activated_at * 1000).toISOString(),
  };
}

export function lineDto(row: LineRow, funding: readonly { source: string; label: string; amount_thousand_krw: string }[] = []) {
  return {
    budget_line_id: row.line_id,
    line_no: row.line_no,
    parent_line_no: row.parent_line_no,
    level: row.level,
    level_label: BUDGET_LEVEL_LABELS[row.level],
    code: row.code,
    name: row.name,
    bugi_name: row.bugi_name,
    formula_text: row.formula_text,
    amount_thousand_krw: row.amount_thousand_krw,
    amount_krw: row.amount_krw,
    previous_amount_thousand_krw: row.previous_amount_thousand_krw,
    change_amount_thousand_krw: row.change_amount_thousand_krw,
    funding,
    funding_breakdown_complete: row.funding_complete === null ? null : row.funding_complete === 1,
    evidence: { page: row.page, table_id: row.table_id, page_basis: "kordoc 문서 쪽 번호(파싱 결과 기준)" },
    checks: parseJson<Record<string, string>>(row.checks_json, {}),
    annotations: parseJson<string[]>(row.annotations_json, []),
  };
}

// 전국 목록(기관 지정 없음)은 앞 200건만 준다. 기관(들)을 지정하면 그 기관 문서를 모두 준다(부서별 문서가 많아도 잘리지 않게).
export const REVISION_LIST_LIMIT = 200;
export const REVISION_ENTITY_LIMIT = 3000;
export async function activeRevisions(db: SqlDatabase, filter: { readonly entityId?: string; readonly entityIds?: readonly string[]; readonly year?: string; readonly revisionIds?: readonly string[]; readonly pin?: BudgetRevisionPin } = {}): Promise<RevisionRow[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filter.pin !== undefined) {
    const pinned = budgetPinWhere(filter.pin);
    clauses.push(pinned.sql);
    binds.push(...pinned.binds);
  }
  if (filter.entityId) {
    clauses.push("a.fiscal_entity_id = ?");
    binds.push(filter.entityId);
  }
  if (filter.entityIds) {
    if (!filter.entityIds.length) return [];
    clauses.push("a.fiscal_entity_id IN (SELECT value FROM json_each(?))");
    binds.push(JSON.stringify(filter.entityIds));
  }
  if (filter.year) {
    clauses.push("a.fiscal_year = ?");
    binds.push(filter.year);
  }
  if (filter.revisionIds) {
    if (!filter.revisionIds.length) return [];
    clauses.push("a.revision_id IN (SELECT value FROM json_each(?))");
    binds.push(JSON.stringify(filter.revisionIds));
  }
  const limit = filter.entityId || filter.entityIds || filter.revisionIds ? REVISION_ENTITY_LIMIT : REVISION_LIST_LIMIT;
  return (await db.prepare(REVISION_SQL + (clauses.length ? " WHERE " + clauses.join(" AND ") : "") + " ORDER BY a.fiscal_year DESC, a.fiscal_entity_id, a.stage, a.supplementary_round LIMIT " + limit).bind(...binds).all<RevisionRow>()).results;
}

async function fundingFor(db: SqlDatabase, importId: string, lineIds: readonly string[]) {
  const map = new Map<string, { source: string; label: string; amount_thousand_krw: string }[]>();
  if (!lineIds.length) return map;
  const rows = (await db.prepare("SELECT line_id, source, label, amount_thousand_krw FROM budget_funding_component WHERE import_id = ? AND line_id IN (SELECT value FROM json_each(?)) ORDER BY line_id, ordinal")
    .bind(importId, JSON.stringify(lineIds)).all<{ line_id: string; source: string; label: string; amount_thousand_krw: string }>()).results;
  for (const row of rows) (map.get(row.line_id) ?? map.set(row.line_id, []).get(row.line_id)!).push({ source: row.source, label: row.label, amount_thousand_krw: row.amount_thousand_krw });
  return map;
}

/** 한 편성 단계의 개요(부서·정책·단위·세부사업)와, 재정주체가 확인된 문서면 세부사업별 지방재정365 예산현액 대조. */
export async function revisionOutline(db: SqlDatabase, revisionId: string) {
  const [revision] = await activeRevisions(db, { revisionIds: [revisionId] });
  if (!revision) return null;
  const lines = (await db.prepare("SELECT " + LINE_COLUMNS + " FROM budget_line WHERE import_id = ? AND revision_id = ? AND level IN ('department', 'policy', 'unit', 'detail_project') ORDER BY line_no")
    .bind(revision.import_id, revisionId).all<LineRow>()).results;
  const funding = await fundingFor(db, revision.import_id, lines.map((line) => line.line_id));
  const comparison = await compareDocumentRows(db, { ...revision, stage_label: stageLabel(revision.stage, revision.supplementary_round) },
    lines.map((line) => ({ ...line, annotations: lineDto(line).annotations })));
  return {
    revision: revisionDto(revision),
    lines: lines.map((line) => ({ ...lineDto(line, funding.get(line.line_id) ?? []), api_comparison: comparison?.by_line.get(line.line_id) ?? null })),
    api_comparison: comparison ? { basis: comparison.basis, counts: comparison.counts } : null,
  };
}

/** 세부사업 한 줄 아래 편성목·통계목·부기·하위 산출항목 전체(재원 포함). */
export async function lineSubtree(db: SqlDatabase, revisionId: string, lineNo: number) {
  const [revision] = await activeRevisions(db, { revisionIds: [revisionId] });
  if (!revision) return null;
  const all = (await db.prepare("SELECT " + LINE_COLUMNS + " FROM budget_line WHERE import_id = ? AND revision_id = ? AND line_no >= ? ORDER BY line_no LIMIT 1500")
    .bind(revision.import_id, revisionId, lineNo).all<LineRow>()).results;
  const root = all[0];
  if (!root || root.line_no !== lineNo) return null;
  const inside = new Set([root.line_no]);
  const lines = [root];
  for (const line of all.slice(1)) {
    if (line.parent_line_no === null || !inside.has(line.parent_line_no)) break;
    inside.add(line.line_no);
    lines.push(line);
  }
  const funding = await fundingFor(db, revision.import_id, lines.map((line) => line.line_id));
  return { revision: revisionDto(revision), lines: lines.map((line) => lineDto(line, funding.get(line.line_id) ?? [])) };
}

export interface DocumentLink {
  readonly document_revision_id: string; readonly budget_line_id: string; readonly stage: BudgetStage; readonly stage_label: string; readonly document_title: string;
  readonly amount_thousand_krw: string | null; readonly amount_krw: string | null; readonly match: "detail_project_name" | "detail_project_name_ambiguous"; readonly page: number | null;
  readonly match_basis?: BudgetMatchBasis;
}

/**
 * 재정사업 → 공개 예산서. 개요 대조와 같은 부서·사업코드 조건을 적용한다. 후보가 여럿이면 ambiguous로 표시한다.
 * 금액은 문서 단계 값이며 지방재정365 예산현액을 대신하지 않는다.
 */
export async function documentLinksForProjects(db: SqlDatabase, projects: readonly { readonly fiscal_project_id: string; readonly fiscal_entity_id: string; readonly fiscal_year: string; readonly account_code: string; readonly name: string }[], pin: BudgetRevisionPin = null): Promise<Map<string, DocumentLink[]>> {
  const out = new Map<string, DocumentLink[]>();
  const apiCache = new Map<string, readonly ApiRow[]>();
  const keys = [...new Set(projects.map((project) => project.fiscal_entity_id + "|" + project.fiscal_year))];
  for (const key of keys) {
    const [entityId, year] = key.split("|");
    const revisions = await activeRevisions(db, { entityId, year, pin });
    // 대조 후보는 이름이 같은 행뿐이다. 세부사업 이름을 한 번의 조회로 읽어, 요청한 사업과 같은 이름이 없는 예산서는 건너뛴다.
    const relevant = revisions.filter((revision) => projects.some((project) => project.fiscal_entity_id === entityId && project.fiscal_year === year && project.account_code === revision.account_code));
    const imports = new Map(relevant.map((revision) => [revision.revision_id, revision.import_id]));
    const nameRows = relevant.length ? (await db.prepare("SELECT revision_id, import_id, name FROM budget_line WHERE revision_id IN (SELECT value FROM json_each(?)) AND level = 'detail_project'")
      .bind(JSON.stringify([...imports.keys()])).all<{ revision_id: string; import_id: string; name: string }>()).results : [];
    const detailNames = new Map<string, Set<string>>();
    for (const row of nameRows) {
      if (imports.get(row.revision_id) !== row.import_id) continue;
      detailNames.set(row.revision_id, (detailNames.get(row.revision_id) ?? new Set()).add(squashName(row.name)));
    }
    for (const revision of revisions) {
      const wanted = projects.filter((project) => project.fiscal_entity_id === entityId && project.fiscal_year === year && project.account_code === revision.account_code);
      if (!wanted.length) continue;
      const wantedNames = new Set(wanted.map((project) => squashName(project.name)));
      if (![...wantedNames].some((name) => detailNames.get(revision.revision_id)?.has(name))) continue;
      const lines = (await db.prepare("SELECT " + LINE_COLUMNS + " FROM budget_line WHERE import_id = ? AND revision_id = ? AND level IN ('department', 'policy', 'unit', 'detail_project') ORDER BY line_no")
        .bind(revision.import_id, revision.revision_id).all<LineRow>()).results;
      const scopeKey = key + "|" + revision.account_code;
      const apiRows = apiCache.get(scopeKey) ?? (await apiRowsFor(db, revision)).rows;
      apiCache.set(scopeKey, apiRows);
      const matchProject = budgetDocumentMatcher(revision.entity_name, lines.map((line) => ({ ...line, annotations: lineDto(line).annotations })));
      // 요청한 사업과 이름이 같은 줄만, 같은 이름의 지방재정 행 전체와 대조한다.
      const byName = new Map<string, ApiRow[]>();
      for (const row of apiRows) {
        const name = squashName(row.name);
        if (wantedNames.has(name)) byName.set(name, [...(byName.get(name) ?? []), row]);
      }
      const eligible = lines.filter((line) => line.level === "detail_project" && byName.has(squashName(line.name))).map((line) => ({
        line, matched: matchProject({ ...line, annotations: lineDto(line).annotations }, byName.get(squashName(line.name)) ?? []),
      }));
      for (const project of wanted) {
        const hits = eligible.filter(({ matched }) => matched.candidates.some((candidate) => candidate.fiscal_project_id === project.fiscal_project_id));
        for (const { line: hit, matched } of hits) {
          const links = out.get(project.fiscal_project_id) ?? [];
          links.push({
            document_revision_id: revision.revision_id, budget_line_id: hit.line_id, stage: revision.stage, stage_label: stageLabel(revision.stage, revision.supplementary_round),
            document_title: revision.title, amount_thousand_krw: hit.amount_thousand_krw, amount_krw: hit.amount_krw,
            match: hits.length > 1 || matched.candidates.length > 1 ? "detail_project_name_ambiguous" : "detail_project_name", match_basis: matched.basis, page: hit.page,
          });
          out.set(project.fiscal_project_id, links);
        }
      }
    }
  }
  return out;
}

/** 문서 금액(천원 문자열) 차이. 하나라도 없으면 null. */
export function thousandDifference(right: string | null, left: string | null): number | null {
  const a = thousandOf(left);
  const b = thousandOf(right);
  return a === null || b === null ? null : b - a;
}
