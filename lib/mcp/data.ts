// 원격 MCP가 읽는 저장 자료. 화면과 같은 보정(추출 오류 수정·관리자 WIKI 편집)을 적용하고,
// 보도자료는 공개 승인된 Source의 메타데이터만 읽는다. 쓰기·외부 호출이 없다.
import { serviceWikiKey, type ServiceRow } from "../dataset.ts";
import { repairKnownExtractionFragments } from "../official-correction.ts";
import type { OfficialService } from "../official-source.ts";
import { repairExtractionSpacing } from "../official-spacing.ts";
import { duplicateRepresentativeSql, PRESS_FROM_JOINS, PUBLIC_PRESS_CLAUSES, RELATED_COLUMNS, escapeLike, type PressItemRow } from "../press/query.ts";
import type { LedgerRow } from "../official-ledger.ts";
import type { SqlDatabase } from "../sql-database.ts";
import { applyWikiEdit, type PublicWikiEdit } from "../wiki-edits.ts";

export const INTEGRATED_SIDO = "전남광주통합특별시";
const CANONICAL_SIDO_SQL = "CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END";
const SERVICE_COLUMNS =
  `service_id AS serviceId, ${CANONICAL_SIDO_SQL} AS sido, sigungu, category, subcategory, name, description, target, ` +
  "detail_target AS detailTarget, application_method AS applicationMethod, provider, type, serial, detail_url AS detailUrl, updated_date AS updatedDate";
const PRESS_ITEM_COLUMNS =
  "i.item_id, i.title, i.canonical_url, i.published_date, i.published_at, i.publication_precision, i.discovered_at, i.categories, i.classification_basis, " +
  "o.organization_id AS org_id, o.name AS org_name, o.org_type, o.sido AS org_sido, o.sigungu AS org_sigungu, s.registry_version, " + RELATED_COLUMNS;

export function sidoAliases(sido: string): readonly string[] {
  return sido === INTEGRATED_SIDO ? [INTEGRATED_SIDO, "광주광역시", "전라남도"] : [sido];
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export interface KnowledgeRun {
  readonly id: string;
  readonly completedAt: number;
  readonly dataAsOf: string;
}

export interface ProgramFilter {
  readonly sido: string;
  readonly sigungu: string;
  readonly includeAncestorScope: boolean;
  /** 대분류·중분류 조건(서로 OR). 중분류가 비면 대분류 전체. */
  readonly categories: readonly { readonly category: string; readonly subcategory: string }[];
  /** 대상 키워드(서로 OR). 공개 원문 문구에 들어 있는지만 본다. */
  readonly targetKeywords: readonly string[];
  /** 검색 낱말(서로 AND). */
  readonly queryTokens: readonly string[];
}

export interface SourceDocument {
  readonly document_id: string;
  readonly title: string;
  readonly province: string;
  readonly municipality: string;
  readonly published_at: string;
  readonly data_as_of: string;
  readonly detail_url: string;
}

export interface NewsFilter {
  readonly queryTokens: readonly string[];
  readonly categoryIds: readonly string[];
  readonly organizationIds: readonly string[];
  readonly organizationTypes: readonly string[];
  readonly sido: string;
  readonly sigungu: string;
  readonly includeDescendants: boolean;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly dateBasis: "published" | "discovered";
  /** verified_groups면 검증된 동일 자료 묶음은 대표 1건만, 묶음 밖 게시물은 그대로. */
  readonly groupMode?: "items" | "verified_groups";
  readonly duplicateGroupId?: string;
}

export interface NewsItemDetail extends PressItemRow {
  readonly title_version: number;
  readonly timestamp_semantics: string;
  readonly classification_status: string;
  readonly dictionary_version: string;
}

export interface OrganizationRow {
  readonly organization_id: string;
  readonly name: string;
  readonly org_type: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly parent_id: string | null;
  readonly code_system: string;
  readonly code: string;
  readonly lifecycle_status: string;
  readonly seed_origin: string;
  readonly registry_version: string;
  /** 효력 시작·종료일(YYYY-MM-DD, 모르면 빈 문자열). */
  readonly valid_from: string;
  readonly valid_to: string;
}

export interface SuccessionRow {
  readonly succession_id: string;
  readonly predecessor_id: string;
  readonly predecessor_name: string | null;
  readonly successor_id: string;
  readonly successor_name: string | null;
  readonly kind: string;
  readonly effective_date: string;
  readonly territory_note: string;
  readonly basis_title: string;
  readonly basis_url: string;
  readonly secondary_url: string | null;
  readonly verification_status: string;
}

export type EditLoader = () => Promise<ReadonlyMap<string, PublicWikiEdit>>;

export class McpData {
  readonly db: SqlDatabase;
  private readonly loadEdits: EditLoader;

  /** 요청이 고른 통합 공개본의 고정값. runId=지식 수집 run, newsWatermark=보도자료 발견 시각 상한(null이면 고정 안 함). */
  pin: { runId: string | null; newsWatermark: number | null; linksWatermark: number | null } = { runId: null, newsWatermark: null, linksWatermark: null };

  constructor(db: SqlDatabase, loadEdits: EditLoader) {
    this.db = db;
    this.loadEdits = loadEdits;
  }

  async latestRun(): Promise<KnowledgeRun | null> {
    if (this.pin.runId) {
      return this.db.prepare(
        "SELECT id, completed_at AS completedAt, COALESCE((SELECT MAX(data_as_of) FROM official_source_document WHERE sync_run_id = official_sync_run.id), '') AS dataAsOf " +
          "FROM official_sync_run WHERE status = 'succeeded' AND id = ?",
      ).bind(this.pin.runId).first<KnowledgeRun>();
    }
    return this.db.prepare(
      "SELECT id, completed_at AS completedAt, COALESCE((SELECT MAX(data_as_of) FROM official_source_document WHERE sync_run_id = official_sync_run.id), '') AS dataAsOf " +
        "FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1",
    ).first<KnowledgeRun>();
  }

  async editFor(serviceId: string): Promise<PublicWikiEdit | null> {
    return (await this.loadEdits()).get(serviceId) ?? null;
  }

  private async normalize(records: readonly OfficialService[]): Promise<ServiceRow[]> {
    const edits = await this.loadEdits();
    const repaired = repairExtractionSpacing(repairKnownExtractionFragments(records.map((record) => ({
      ...record,
      applicationMethod: String(record.applicationMethod ?? ""),
    }))));
    return repaired.map((record, index) => applyWikiEdit({
      ...record,
      applicationMethod: record.applicationMethod ?? "",
      id: index,
      searchIndex: "",
    }, edits.get(record.serviceId)));
  }

  async programs(runId: string, filter: ProgramFilter, offset: number, limit: number): Promise<{ rows: ServiceRow[]; total: number }> {
    const clauses = ["sync_run_id = ?"];
    const binds: unknown[] = [runId];
    if (filter.sido) {
      clauses.push(`sido IN (${marks(sidoAliases(filter.sido).length)})`);
      binds.push(...sidoAliases(filter.sido));
    }
    if (filter.sigungu) {
      clauses.push(filter.includeAncestorScope ? "(sigungu = ? OR sigungu = '')" : "sigungu = ?");
      binds.push(filter.sigungu);
    }
    if (filter.categories.length) {
      clauses.push(`(${filter.categories.map(() => "(category = ? AND (? = '' OR subcategory = ?))").join(" OR ")})`);
      for (const { category, subcategory } of filter.categories) binds.push(category, subcategory, subcategory);
    }
    if (filter.targetKeywords.length) {
      clauses.push(`(${filter.targetKeywords.map(() => "(target LIKE ? ESCAPE '\\' OR detail_target LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')").join(" OR ")})`);
      for (const keyword of filter.targetKeywords) {
        const pattern = `%${escapeLike(keyword)}%`;
        binds.push(pattern, pattern, pattern);
      }
    }
    for (const token of filter.queryTokens) {
      clauses.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR subcategory LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(token)}%`;
      binds.push(pattern, pattern, pattern, pattern, pattern);
    }
    const where = clauses.join(" AND ");
    const [total, records] = await Promise.all([
      this.db.prepare(`SELECT COUNT(*) AS total FROM official_service_snapshot WHERE ${where}`).bind(...binds).first<{ total: number }>(),
      this.db.prepare(`SELECT ${SERVICE_COLUMNS} FROM official_service_snapshot WHERE ${where} ORDER BY sido, sigungu, name, service_id LIMIT ? OFFSET ?`)
        .bind(...binds, limit, offset).all<OfficialService>(),
    ]);
    return { rows: await this.normalize(records.results), total: total?.total ?? 0 };
  }

  /**
   * WIKI 키(service:원자료ID|시도|시군구|대분류|중분류|이름)로 시행사업 한 건을 찾는다. 키의 원자료 ID는 문장부호를 뺀 값이라
   * WIKI 화면과 같은 규칙(':'·'-' 제거, 소문자)으로 후보를 읽는다. 대분류만 바뀐 예전 키는 후보가 하나일 때만 연다.
   */
  async programByKey(runId: string, key: string): Promise<ServiceRow | null> {
    const parts = key.slice("service:".length).split("|");
    const serviceId = parts[0] ?? "";
    if (parts.length !== 6 || !/^[0-9a-z]{1,60}$/.test(serviceId)) return null;
    const records = await this.db.prepare(
      `SELECT ${SERVICE_COLUMNS} FROM official_service_snapshot WHERE sync_run_id = ? AND LOWER(REPLACE(REPLACE(service_id, ':', ''), '-', '')) = ? LIMIT 32`,
    ).bind(runId, serviceId).all<OfficialService>();
    const rows = await this.normalize(records.results);
    // 관리자 편집이 이름·분류를 바꿔도 같은 원자료 행을 찾도록, 원래 행과 편집된 행의 키를 모두 비교한다.
    const originals = records.results;
    const keysOf = (position: number) => [serviceWikiKey(rows[position]), serviceWikiKey({ ...originals[position], sido: rows[position].sido })];
    const index = rows.findIndex((_, position) => keysOf(position).includes(key));
    if (index >= 0) return rows[index];
    const withoutCategory = (value: string) => value.split("|").filter((_, part) => part !== 3).join("|");
    const recategorized = rows.filter((_, position) => keysOf(position).some((candidate) => withoutCategory(candidate) === withoutCategory(key)));
    return recategorized.length === 1 ? recategorized[0] : null;
  }

  async sourceDocuments(runId: string, sido: string, sigungu: string): Promise<SourceDocument[]> {
    const aliases = sidoAliases(sido);
    const result = await this.db.prepare(
      "SELECT document_id, title, province, municipality, published_at, data_as_of, detail_url FROM official_source_document " +
        `WHERE sync_run_id = ? AND province IN (${marks(aliases.length)}) AND (? = '' OR municipality = ? OR municipality = '') ORDER BY municipality DESC, document_id LIMIT 10`,
    ).bind(runId, ...aliases, sigungu, sigungu).all<SourceDocument>();
    return result.results;
  }

  /** 이 시행사업 행을 뽑은 바로 그 보건복지부 문서(service_id가 문서 번호로 시작). */
  async sourceDocumentFor(runId: string, serviceId: string): Promise<SourceDocument | null> {
    return this.db.prepare(
      "SELECT document_id, title, province, municipality, published_at, data_as_of, detail_url FROM official_source_document WHERE sync_run_id = ? AND ? LIKE document_id || ':%' ORDER BY length(document_id) DESC LIMIT 1",
    ).bind(runId, serviceId).first<SourceDocument>();
  }

  async sourceRowLedger(runId: string): Promise<LedgerRow[]> {
    return (await this.db.prepare("SELECT document_id, extracted, mapped, preserved_unresolved, excluded_unparseable, excluded_fragment, traced FROM official_source_row_ledger WHERE run_id = ? ORDER BY document_id").bind(runId).all<LedgerRow>()).results;
  }

  async regionProgramCount(runId: string, sido: string, sigungu: string): Promise<number> {
    const aliases = sidoAliases(sido);
    const row = await this.db.prepare(
      `SELECT COUNT(*) AS total FROM official_service_snapshot WHERE sync_run_id = ? AND sido IN (${marks(aliases.length)}) AND (? = '' OR sigungu = ?)`,
    ).bind(runId, ...aliases, sigungu, sigungu).first<{ total: number }>();
    return row?.total ?? 0;
  }

  async regionMunicipalities(runId: string, sido: string): Promise<string[]> {
    const aliases = sidoAliases(sido);
    const result = await this.db.prepare(
      `SELECT DISTINCT sigungu FROM official_service_snapshot WHERE sync_run_id = ? AND sido IN (${marks(aliases.length)}) AND sigungu <> '' ORDER BY sigungu`,
    ).bind(runId, ...aliases).all<{ sigungu: string }>();
    return result.results.map((row) => row.sigungu);
  }

  async categoryCounts(runId: string): Promise<{ category: string; subcategory: string; total: number }[]> {
    const result = await this.db.prepare(
      "SELECT category, subcategory, COUNT(*) AS total FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY category, subcategory ORDER BY category, total DESC, subcategory",
    ).bind(runId).all<{ category: string; subcategory: string; total: number }>();
    return result.results;
  }

  async knowledgeTotals(runId: string): Promise<{ rows: number; documents: number; sido: number; sigungu: number }> {
    const row = await this.db.prepare(
      `SELECT COUNT(*) AS rows, COUNT(DISTINCT ${CANONICAL_SIDO_SQL}) AS sido, COUNT(DISTINCT CASE WHEN sigungu <> '' THEN ${CANONICAL_SIDO_SQL} || '|' || sigungu END) AS sigungu, ` +
        "(SELECT COUNT(*) FROM official_source_document WHERE sync_run_id = ?) AS documents FROM official_service_snapshot WHERE sync_run_id = ?",
    ).bind(runId, runId).first<{ rows: number; documents: number; sido: number; sigungu: number }>();
    return row ?? { rows: 0, documents: 0, sido: 0, sigungu: 0 };
  }

  async newsComponent(): Promise<{ registryVersion: string; dictionaryVersions: string[]; publicItems: number; latestDiscoveredAt: number }> {
    const [registry, items] = await Promise.all([
      this.db.prepare("SELECT MAX(registry_version) AS version FROM press_source").first<{ version: string | null }>(),
      this.db.prepare(
        `SELECT COUNT(*) AS total, MAX(i.discovered_at) AS latest, GROUP_CONCAT(DISTINCT i.dictionary_version) AS versions ${PRESS_FROM_JOINS} WHERE ${PUBLIC_PRESS_CLAUSES.join(" AND ")}`,
      ).first<{ total: number; latest: number | null; versions: string | null }>(),
    ]);
    return {
      registryVersion: registry?.version ?? "",
      dictionaryVersions: (items?.versions ?? "").split(",").filter(Boolean).sort(),
      publicItems: items?.total ?? 0,
      latestDiscoveredAt: items?.latest ?? 0,
    };
  }

  async news(filter: NewsFilter, offset: number, limit: number): Promise<{ rows: PressItemRow[]; total: number }> {
    const clauses = [...PUBLIC_PRESS_CLAUSES];
    const binds: unknown[] = [];
    if (this.pin.newsWatermark !== null) {
      clauses.push("i.discovered_at <= ?");
      binds.push(this.pin.newsWatermark);
    }
    if (filter.duplicateGroupId) {
      clauses.push("i.duplicate_group_id = ?");
      binds.push(filter.duplicateGroupId);
    }
    if (filter.groupMode === "verified_groups") clauses.push("(i.duplicate_group_id IS NULL OR i.item_id = (" + duplicateRepresentativeSql("i") + "))");
    for (const token of filter.queryTokens) {
      clauses.push("i.title LIKE ? ESCAPE '\\'");
      binds.push(`%${escapeLike(token)}%`);
    }
    if (filter.categoryIds.length) {
      clauses.push(`EXISTS (SELECT 1 FROM json_each(i.categories) WHERE value IN (${marks(filter.categoryIds.length)}))`);
      binds.push(...filter.categoryIds);
    }
    if (filter.organizationIds.length) {
      clauses.push(`i.issued_by_org_id IN (${marks(filter.organizationIds.length)})`);
      binds.push(...filter.organizationIds);
    }
    if (filter.organizationTypes.length) {
      clauses.push(`o.org_type IN (${marks(filter.organizationTypes.length)})`);
      binds.push(...filter.organizationTypes);
    }
    if (filter.sido) {
      const aliases = sidoAliases(filter.sido);
      const inSido = `o.sido IN (${marks(aliases.length)})`;
      if (!filter.sigungu) {
        clauses.push(filter.includeDescendants ? inSido : `(${inSido} AND o.sigungu = '')`);
        binds.push(...aliases);
      } else if (!filter.includeDescendants) {
        clauses.push(`(${inSido} AND o.sigungu = ?)`);
        binds.push(...aliases, filter.sigungu);
      } else {
        clauses.push(`((${inSido} AND o.sigungu = ?) OR o.parent_id IN (SELECT organization_id FROM press_organization WHERE sido IN (${marks(aliases.length)}) AND sigungu = ?))`);
        binds.push(...aliases, filter.sigungu, ...aliases, filter.sigungu);
      }
    }
    const dateColumn = filter.dateBasis === "discovered" ? "date(i.discovered_at, 'unixepoch', '+9 hours')" : "i.published_date";
    if (filter.dateFrom) {
      clauses.push(`${dateColumn} >= ?`);
      binds.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      clauses.push(`${dateColumn} <> '' AND ${dateColumn} <= ?`);
      binds.push(filter.dateTo);
    }
    const where = clauses.join(" AND ");
    const order = filter.dateBasis === "discovered"
      ? "i.discovered_at DESC, i.item_id"
      : "i.published_date DESC, i.published_at DESC, i.item_id";
    const [total, rows] = await Promise.all([
      this.db.prepare(`SELECT COUNT(*) AS total ${PRESS_FROM_JOINS} WHERE ${where}`).bind(...binds).first<{ total: number }>(),
      this.db.prepare(`SELECT ${PRESS_ITEM_COLUMNS} ${PRESS_FROM_JOINS} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .bind(...binds, limit, offset).all<PressItemRow>(),
    ]);
    return { rows: rows.results, total: total?.total ?? 0 };
  }

  async newsItem(itemId: string): Promise<NewsItemDetail | null> {
    return this.db.prepare(
      `SELECT ${PRESS_ITEM_COLUMNS}, i.title_version, i.timestamp_semantics, i.classification_status, i.dictionary_version ${PRESS_FROM_JOINS} ` +
        `WHERE ${PUBLIC_PRESS_CLAUSES.join(" AND ")} AND i.item_id = ? AND (? IS NULL OR i.discovered_at <= ?)`,
    ).bind(itemId, this.pin.newsWatermark, this.pin.newsWatermark).first<NewsItemDetail>();
  }

  async organization(organizationId: string): Promise<OrganizationRow | null> {
    return this.db.prepare(
      "SELECT organization_id, name, org_type, sido, sigungu, parent_id, code_system, code, lifecycle_status, seed_origin, registry_version, valid_from, valid_to FROM press_organization WHERE organization_id = ?",
    ).bind(organizationId).first<OrganizationRow>();
  }

  async organizationsForRegion(sido: string, sigungu: string): Promise<OrganizationRow[]> {
    const aliases = sidoAliases(sido);
    const result = await this.db.prepare(
      "SELECT organization_id, name, org_type, sido, sigungu, parent_id, code_system, code, lifecycle_status, seed_origin, registry_version, valid_from, valid_to FROM press_organization " +
        `WHERE sido IN (${marks(aliases.length)}) AND sigungu = ? AND lifecycle_status <> 'ABOLISHED' ORDER BY organization_id LIMIT 10`,
    ).bind(...aliases, sigungu).all<OrganizationRow>();
    return result.results;
  }

  /** 이 기관이 앞뒤로 이어진 통합·분구·개칭·관할변경 관계. */
  async successionsOf(organizationId: string): Promise<SuccessionRow[]> {
    return (await this.db.prepare(
      "SELECT s.succession_id, s.predecessor_id, p.name AS predecessor_name, s.successor_id, n.name AS successor_name, s.kind, s.effective_date, s.territory_note, s.basis_title, s.basis_url, s.secondary_url, s.verification_status " +
        "FROM organization_succession s LEFT JOIN press_organization p ON p.organization_id = s.predecessor_id LEFT JOIN press_organization n ON n.organization_id = s.successor_id " +
        "WHERE s.predecessor_id = ? OR s.successor_id = ? ORDER BY s.effective_date, s.succession_id",
    ).bind(organizationId, organizationId).all<SuccessionRow>()).results;
  }

  /** 기관들의 모든 이전 기관(여러 단계 승계 포함). 요청한 기관 자신은 빼고 돌려준다. */
  async predecessorsOf(organizationIds: readonly string[]): Promise<string[]> {
    if (!organizationIds.length) return [];
    const rows = (await this.db.prepare(
      "WITH RECURSIVE chain(id, depth) AS (SELECT value, 0 FROM json_each(?) UNION SELECT s.predecessor_id, chain.depth + 1 FROM organization_succession s JOIN chain ON s.successor_id = chain.id WHERE chain.depth < 5) " +
        "SELECT DISTINCT id FROM chain WHERE depth > 0 ORDER BY id",
    ).bind(JSON.stringify(organizationIds)).all<{ id: string }>()).results;
    return rows.map((row) => row.id).filter((id) => !organizationIds.includes(id));
  }

  async childOrganizations(organizationId: string, offset: number, limit: number): Promise<{ rows: OrganizationRow[]; total: number }> {
    const [total, rows] = await Promise.all([
      this.db.prepare("SELECT COUNT(*) AS total FROM press_organization WHERE parent_id = ?").bind(organizationId).first<{ total: number }>(),
      this.db.prepare(
        "SELECT organization_id, name, org_type, sido, sigungu, parent_id, code_system, code, lifecycle_status, seed_origin, registry_version, valid_from, valid_to FROM press_organization WHERE parent_id = ? ORDER BY organization_id LIMIT ? OFFSET ?",
      ).bind(organizationId, limit, offset).all<OrganizationRow>(),
    ]);
    return { rows: rows.results, total: total?.total ?? 0 };
  }
}

