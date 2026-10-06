// 예산서(편성 단계 문서) 공개 조회(작업지시서 v5 §22.7·22.8·22.10, T90·T91·T104). 공개(활성)된 단계만 읽는다.
// 문서 금액은 그 문서·편성 단계의 의결(또는 제출) 금액이고, 지방재정365 예산현액은 기준일 현액이다. 두 값은 대조만 하고 서로 덮어쓰지 않는다.
import type { SqlDatabase } from "../sql-database.ts";
import { readWebPin } from "../platform/public-pin.ts";
import { BUDGET_LEVEL_LABELS, BUDGET_STAGE_LABELS, type BudgetLevel, type BudgetStage, thousandOf } from "../imports/budget-pack.ts";
import { pickSnapshotSet, publishedSnapshots } from "./query.ts";

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

/** 이름 대조용: 공백·가운뎃점·괄호류를 뺀다(compare-api.mjs와 같은 규칙). */
export const squashName = (text: string) => text.replace(/[\s·ㆍ()（）\[\]「」『』<>]/g, "");

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

export async function activeRevisions(db: SqlDatabase, filter: { readonly entityId?: string; readonly year?: string; readonly revisionIds?: readonly string[] } = {}): Promise<RevisionRow[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filter.entityId) {
    clauses.push("a.fiscal_entity_id = ?");
    binds.push(filter.entityId);
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
  return (await db.prepare(REVISION_SQL + (clauses.length ? " WHERE " + clauses.join(" AND ") : "") + " ORDER BY a.fiscal_year DESC, a.fiscal_entity_id, a.stage, a.supplementary_round LIMIT 200").bind(...binds).all<RevisionRow>()).results;
}

async function fundingFor(db: SqlDatabase, importId: string, lineIds: readonly string[]) {
  const map = new Map<string, { source: string; label: string; amount_thousand_krw: string }[]>();
  if (!lineIds.length) return map;
  const rows = (await db.prepare("SELECT line_id, source, label, amount_thousand_krw FROM budget_funding_component WHERE import_id = ? AND line_id IN (SELECT value FROM json_each(?)) ORDER BY line_id, ordinal")
    .bind(importId, JSON.stringify(lineIds)).all<{ line_id: string; source: string; label: string; amount_thousand_krw: string }>()).results;
  for (const row of rows) (map.get(row.line_id) ?? map.set(row.line_id, []).get(row.line_id)!).push({ source: row.source, label: row.label, amount_thousand_krw: row.amount_thousand_krw });
  return map;
}

interface ApiRow { readonly fiscal_project_id: string; readonly name: string; readonly department_code: string; readonly reference_date: string; readonly current_budget_krw: string | null; readonly public_expenditure_krw: string | null }

/** 같은 재정주체·회계연도·회계의 지방재정365 공개 행(활성 통합 공개본의 범위별 최신 공개본). 여러 범위에 같은 사업이 있으면 기준일이 늦은 행 하나만 쓴다. */
async function apiRowsFor(db: SqlDatabase, entityId: string, year: string, accountCode: string): Promise<{ rows: ApiRow[]; snapshotIds: string[] }> {
  const pin = await readWebPin(db);
  const choice = pickSnapshotSet(await publishedSnapshots(db, { fiscalYear: year, snapshotIds: pin.fiscalSnapshotIds, limit: 800 }), year, undefined);
  const snapshotIds = choice.snapshots.map((snapshot) => snapshot.snapshot_id);
  if (!snapshotIds.length) return { rows: [], snapshotIds };
  const rows = (await db.prepare(
    "SELECT p.fiscal_project_id, p.name, p.department_code, o.reference_date, o.current_budget_krw, o.public_expenditure_krw FROM fiscal_snapshot_member m " +
      "JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id JOIN fiscal_observation o ON o.observation_id = m.observation_id " +
      "WHERE m.snapshot_id IN (SELECT value FROM json_each(?)) AND p.fiscal_entity_id = ? AND p.account_code = ?",
  ).bind(JSON.stringify(snapshotIds), entityId, accountCode).all<ApiRow>()).results;
  const latest = new Map<string, ApiRow>();
  for (const row of rows) {
    const known = latest.get(row.fiscal_project_id);
    if (!known || row.reference_date > known.reference_date) latest.set(row.fiscal_project_id, row);
  }
  return { rows: [...latest.values()], snapshotIds };
}

export const API_RELATION_LABELS: Record<string, string> = {
  same_within_display_rounding: "같음(천원 표시 반올림 범위)",
  api_current_higher: "지방재정365 예산현액이 더 큼",
  api_current_lower: "지방재정365 예산현액이 더 작음",
  not_found_in_api: "지방재정365에 같은 이름 없음",
  ambiguous_name_in_api: "같은 이름 사업이 여러 개(자동 선택 안 함)",
  api_amount_missing: "지방재정365 금액 없음",
};

function relationTo(documentKrw: string | null, apiKrw: string | null): string {
  if (documentKrw === null || apiKrw === null) return "api_amount_missing";
  const diff = BigInt(apiKrw) - BigInt(documentKrw);
  const abs = diff < BigInt(0) ? -diff : diff;
  return abs < BigInt(1000) ? "same_within_display_rounding" : diff > BigInt(0) ? "api_current_higher" : "api_current_lower";
}

/** 한 편성 단계의 개요(부서·정책·단위·세부사업)와, 재정주체가 확인된 문서면 세부사업별 지방재정365 예산현액 대조. */
export async function revisionOutline(db: SqlDatabase, revisionId: string) {
  const [revision] = await activeRevisions(db, { revisionIds: [revisionId] });
  if (!revision) return null;
  const lines = (await db.prepare("SELECT " + LINE_COLUMNS + " FROM budget_line WHERE import_id = ? AND revision_id = ? AND level IN ('department', 'policy', 'unit', 'detail_project') ORDER BY line_no")
    .bind(revision.import_id, revisionId).all<LineRow>()).results;
  const funding = await fundingFor(db, revision.import_id, lines.map((line) => line.line_id));
  let comparison: { basis: Record<string, unknown>; counts: Record<string, number>; by_line: Map<string, Record<string, unknown>> } | null = null;
  if (revision.fiscal_entity_id) {
    const { rows, snapshotIds } = await apiRowsFor(db, revision.fiscal_entity_id, revision.fiscal_year, revision.account_code);
    if (rows.length) {
      const byName = new Map<string, ApiRow[]>();
      for (const row of rows) (byName.get(squashName(row.name)) ?? byName.set(squashName(row.name), []).get(squashName(row.name))!).push(row);
      const counts: Record<string, number> = {};
      const byLine = new Map<string, Record<string, unknown>>();
      for (const line of lines.filter((item) => item.level === "detail_project")) {
        const matches = byName.get(squashName(line.name)) ?? [];
        const relation = !matches.length ? "not_found_in_api" : matches.length > 1 ? "ambiguous_name_in_api" : relationTo(line.amount_krw, matches[0].current_budget_krw);
        counts[relation] = (counts[relation] ?? 0) + 1;
        byLine.set(line.line_id, {
          relation, relation_label: API_RELATION_LABELS[relation],
          api: matches.length === 1 ? { fiscal_project_id: matches[0].fiscal_project_id, department_code: matches[0].department_code, reference_date: matches[0].reference_date, current_budget_krw: matches[0].current_budget_krw, public_expenditure_krw: matches[0].public_expenditure_krw } : null,
          api_candidates: matches.length > 1 ? matches.map((match) => ({ fiscal_project_id: match.fiscal_project_id, department_code: match.department_code })) : [],
          difference_krw: matches.length === 1 && line.amount_krw !== null && matches[0].current_budget_krw !== null ? (BigInt(matches[0].current_budget_krw) - BigInt(line.amount_krw)).toString() : null,
        });
      }
      comparison = {
        basis: {
          document: stageLabel(revision.stage, revision.supplementary_round) + " 금액(문서 표시 천원 → 원 환산)",
          api: "지방재정365 세부사업별 세출현황 예산현액(기준일 현액, 추경·이월·전용 반영 가능)",
          reference_dates: [...new Set(rows.map((row) => row.reference_date))].sort(),
          snapshot_ids: snapshotIds,
          rule: "두 값은 뜻이 달라 서로 덮어쓰지 않습니다. 1,000원 미만 차이는 문서의 천원 표시 반올림으로 봅니다. 차이의 원인(추경·이월·전용 등)은 이 대조만으로 정하지 않습니다. 세부사업명으로 맞추며 같은 이름이 여러 부서에 있으면 고르지 않습니다.",
        },
        counts, by_line: byLine,
      };
    }
  }
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
}

/**
 * 재정사업(지방재정365) → 같은 재정주체·회계연도·회계의 공개 예산서 세부사업 행. 세부사업명으로만 맞추고, 문서 안에 같은 이름이 여럿이면
 * 모두 돌려주되 ambiguous로 표시한다. 금액은 문서 단계 값이며 지방재정365 예산현액을 대신하지 않는다.
 */
export async function documentLinksForProjects(db: SqlDatabase, projects: readonly { readonly fiscal_project_id: string; readonly fiscal_entity_id: string; readonly fiscal_year: string; readonly account_code: string; readonly name: string }[]): Promise<Map<string, DocumentLink[]>> {
  const out = new Map<string, DocumentLink[]>();
  const keys = [...new Set(projects.map((project) => project.fiscal_entity_id + "|" + project.fiscal_year))];
  for (const key of keys) {
    const [entityId, year] = key.split("|");
    const revisions = await activeRevisions(db, { entityId, year });
    for (const revision of revisions) {
      const wanted = projects.filter((project) => project.fiscal_entity_id === entityId && project.fiscal_year === year && project.account_code === revision.account_code);
      if (!wanted.length) continue;
      const lines = (await db.prepare("SELECT line_id, line_no, name, amount_thousand_krw, amount_krw, page FROM budget_line WHERE import_id = ? AND revision_id = ? AND level = 'detail_project'")
        .bind(revision.import_id, revision.revision_id).all<{ line_id: string; line_no: number; name: string; amount_thousand_krw: string | null; amount_krw: string | null; page: number | null }>()).results;
      const byName = new Map<string, typeof lines>();
      for (const line of lines) (byName.get(squashName(line.name)) ?? byName.set(squashName(line.name), []).get(squashName(line.name))!).push(line);
      for (const project of wanted) {
        const hits = byName.get(squashName(project.name)) ?? [];
        for (const hit of hits) {
          (out.get(project.fiscal_project_id) ?? out.set(project.fiscal_project_id, []).get(project.fiscal_project_id)!).push({
            document_revision_id: revision.revision_id, budget_line_id: hit.line_id, stage: revision.stage, stage_label: stageLabel(revision.stage, revision.supplementary_round),
            document_title: revision.title, amount_thousand_krw: hit.amount_thousand_krw, amount_krw: hit.amount_krw,
            match: hits.length > 1 ? "detail_project_name_ambiguous" : "detail_project_name", page: hit.page,
          });
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
