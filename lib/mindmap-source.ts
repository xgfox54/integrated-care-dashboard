// 복지 마인드맵 서버 집계: 온톨로지 DB(통합돌봄 시행사업·지역·대상자 묶음·공식 보도자료·재정주체·스키마)에서 실제 수를 센다.
// 화면 목록과 같은 기준을 쓴다: 사업은 최신 수집본(대시보드와 같음), 보도자료는 공개 조건(PUBLIC_PRESS_CLAUSES, 광역 재게시 제외).
import { after } from "next/server";

import schema from "../ontology/welfare-v2/schema.json";
import { DATASET_CACHE_PREFIX, wikiEditsVersion, writeStoredEntries } from "./dataset-cache.ts";
import { getD1 } from "./d1.ts";
import { TARGET_GROUPS } from "./mcp/tools.ts";
import { memoizeForTtl } from "./memo.ts";
import { FISCAL_ENTITY_REGIONS_SQL, type MindmapSource } from "./mindmap.ts";
import { CANONICAL_SIDO_SQL, readLatestRun } from "./official-query.ts";
import { CATEGORY_LABELS } from "./press/dictionary.ts";
import { publicNewsClause } from "./platform/public-pin.ts";
import { PRESS_FROM_JOINS, PUBLIC_PRESS_CLAUSES, readPressRegions } from "./press/query.ts";
import { cachedWikiEdits } from "./wiki-edit-store.ts";

/** 대상자 낱말 조건(지원대상·세부대상·사업명). */
function targetClause(keywords: readonly string[]): { readonly sql: string; readonly binds: string[] } {
  return {
    sql: keywords.map(() => "(target LIKE ? OR detail_target LIKE ? OR name LIKE ?)").join(" OR "),
    binds: keywords.flatMap((keyword) => Array(3).fill("%" + keyword + "%")),
  };
}

/** 관계성 지도 정보칸용 대상자 묶음별 관련 수(대분류별 사업, 시·군·구, 보도자료, 예산 세부사업). 읽기만 한다. */
async function readTargetRelations(db: ReturnType<typeof getD1>, runId: string, groups: readonly (readonly [string, { readonly keywords: readonly string[] }])[]) {
  const pressWhere = [...PUBLIC_PRESS_CLAUSES, publicNewsClause("i")].join(" AND ");
  const titleSums = groups.map(([, group]) => "SUM(CASE WHEN " + group.keywords.map(() => "i.title LIKE ?").join(" OR ") + " THEN 1 ELSE 0 END)");
  const nameSums = groups.map(([, group]) => "SUM(CASE WHEN " + group.keywords.map(() => "name LIKE ?").join(" OR ") + " THEN 1 ELSE 0 END)");
  const likes = groups.flatMap(([, group]) => group.keywords.map((keyword) => "%" + keyword + "%"));
  const [perGroup, news, budget] = await Promise.all([
    Promise.all(groups.map(async ([, group]) => {
      const { sql, binds } = targetClause(group.keywords);
      const [categories, regions] = await Promise.all([
        db.prepare("SELECT category, COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ? AND (" + sql + ") GROUP BY category").bind(runId, ...binds).all<{ category: string; count: number }>().then((result) => result.results),
        db.prepare("SELECT COUNT(DISTINCT " + CANONICAL_SIDO_SQL + " || '|' || sigungu) AS count FROM official_service_snapshot WHERE sync_run_id = ? AND (" + sql + ")").bind(runId, ...binds).first<{ count: number }>(),
      ]);
      return { categories, regions: Number(regions?.count ?? 0) };
    })),
    db.prepare("SELECT " + titleSums.map((expression, index) => expression + " AS g" + index).join(", ") + " " + PRESS_FROM_JOINS + " WHERE " + pressWhere).bind(...likes).first<Record<string, number | null>>(),
    db.prepare("SELECT " + nameSums.map((expression, index) => expression + " AS g" + index).join(", ") + " FROM fiscal_project WHERE field_code = '080' AND fiscal_year = (SELECT MAX(fiscal_year) FROM fiscal_project)").bind(...likes).first<Record<string, number | null>>(),
  ]);
  return groups.map((_, index) => ({
    byCategory: perGroup[index].categories,
    regionCount: perGroup[index].regions,
    newsCount: Number(news?.["g" + index] ?? 0),
    budgetCount: Number(budget?.["g" + index] ?? 0),
  }));
}

async function readSource(): Promise<MindmapSource> {
  const db = getD1();
  const run = await readLatestRun();
  const runId = run?.id ?? "";
  const targetEntries = Object.entries(TARGET_GROUPS);
  const [categories, regions, targetCounts, press, entityRegions, care, relations, categoryRegions] = await Promise.all([
    db.prepare("SELECT category, subcategory, COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY category, subcategory")
      .bind(runId).all<{ category: string; subcategory: string; count: number }>().then((result) => result.results),
    db.prepare("SELECT " + CANONICAL_SIDO_SQL + " AS sido, sigungu, COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY 1, sigungu")
      .bind(runId).all<{ sido: string; sigungu: string; count: number }>().then((result) => result.results),
    // 대상자 묶음: MCP find_programs와 같은 낱말 규칙(지원대상·세부대상·사업명에 낱말 포함). 개인 자격 판정이 아니다.
    Promise.all(targetEntries.map(([, group]) => {
      const clause = group.keywords.map(() => "(target LIKE ? OR detail_target LIKE ? OR name LIKE ?)").join(" OR ");
      const binds = group.keywords.flatMap((keyword) => Array(3).fill("%" + keyword + "%"));
      return db.prepare("SELECT COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ? AND (" + clause + ")").bind(runId, ...binds).first<{ count: number }>().then((row) => row?.count ?? 0);
    })),
    readPressRegions(db),
    db.prepare(FISCAL_ENTITY_REGIONS_SQL).all<{ code: string; name: string; count: number }>().then((result) => result.results),
    db.prepare("SELECT basis, COUNT(*) AS count FROM fiscal_project_class GROUP BY basis").all<{ basis: string; count: number }>().then((result) => result.results),
    readTargetRelations(db, runId, targetEntries),
    db.prepare("SELECT category, COUNT(DISTINCT " + CANONICAL_SIDO_SQL + " || '|' || sigungu) AS regions FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY category")
      .bind(runId).all<{ category: string; regions: number }>().then((result) => result.results),
  ]);
  const documents = runId ? (await db.prepare("SELECT COUNT(*) AS count FROM official_source_document WHERE sync_run_id = ?").bind(runId).first<{ count: number }>())?.count ?? 0 : 0;
  return {
    generatedAt: new Date().toISOString(),
    knowledge: { dataAsOf: run?.dataAsOf ?? "", completedAt: run?.completedAt ? new Date(run.completedAt * 1000).toISOString() : "" },
    services: {
      total: categories.reduce((sum, row) => sum + row.count, 0),
      documents,
      categories,
      regions,
      targetGroups: targetEntries.map(([id, group], index) => ({ id, label: group.label, keywords: group.keywords, count: targetCounts[index] ?? 0, ...relations[index] })),
      categoryRegions,
    },
    news: {
      total: press.by_organization.reduce((sum, row) => sum + row.count, 0),
      categories: Object.entries(press.by_category).map(([code, count]) => ({ code, label: CATEGORY_LABELS[code] ?? code, count })),
      bySido: press.by_sido,
    },
    fiscal: { entityTotal: entityRegions.reduce((sum, row) => sum + row.count, 0), regions: entityRegions, integratedCare: care },
    ontology: {
      entities: schema.entity_types.map((entity) => ({ id: entity.id, status: entity.status, ...("note" in entity && typeof entity.note === "string" ? { note: entity.note } : {}) })),
      relations: schema.relations.map((relation) => ({ id: relation.id, domain: relation.domain ?? "(여러 개체)", range: relation.range ?? "(여러 개체)", status: relation.status })),
    },
  };
}

// 관계 수 집계는 캐시 없이 약 2초 걸린다. 이 배포 환경은 공유 캐시(caches.default)를 쓸 수 없어,
// 계산 결과를 D1 dataset_response_cache에 보관한다. 15분이 지난 보관본은 그대로 먼저 보내고 응답 뒤에 새로 계산한다
// (보도자료는 하루 4번 수집되므로 화면의 「집계」 시각으로 기준을 밝힌다).
const STORED_KEY = DATASET_CACHE_PREFIX + "mindmap:source";
const STORED_FRESH_SECONDS = 15 * 60;

async function computeAndStore(): Promise<MindmapSource> {
  const source = await readSource();
  // 대시보드 보관본과 같은 수집 번호·위키 수정 상태로 저장해야 보관본 정리(pruneStaleEntries)에서 지워지지 않는다.
  const [run, edits] = await Promise.all([readLatestRun(), cachedWikiEdits()]);
  if (run) await writeStoredEntries([{ key: "mindmap:source", body: JSON.stringify(source) }], run.id, wikiEditsVersion(edits)).catch(() => undefined);
  return source;
}

async function readStoredSource(): Promise<MindmapSource> {
  const row = await getD1().prepare("SELECT body, created_at FROM dataset_response_cache WHERE cache_key = ?").bind(STORED_KEY)
    .first<{ body: string; created_at: number }>().catch(() => null);
  if (!row) return computeAndStore();
  if (Math.floor(Date.now() / 1000) - row.created_at > STORED_FRESH_SECONDS) {
    const refresh = () => computeAndStore().then(() => undefined, () => undefined);
    try {
      after(refresh);
    } catch {
      void refresh();
    }
  }
  return JSON.parse(row.body) as MindmapSource;
}

/** 서버 인스턴스마다 5분 동안 기억하고, 그 밖에는 D1 보관본을 쓴다. */
export const readMindmapSource = memoizeForTtl(readStoredSource, 5 * 60_000);
