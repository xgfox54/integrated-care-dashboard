// 복지 마인드맵 서버 집계: 온톨로지 DB(통합돌봄 시행사업·지역·대상자 묶음·공식 보도자료·재정주체·스키마)에서 실제 수를 센다.
// 화면 목록과 같은 기준을 쓴다: 사업은 최신 수집본(대시보드와 같음), 보도자료는 공개 조건(PUBLIC_PRESS_CLAUSES, 광역 재게시 제외).
// 대상자 묶음(D-04, 2026-10-09)은 클릭 목록과 같은 정의·조회 함수로 센다: 사업은 lib/target-groups.ts 조건, 보도자료는 /api/press와 같은
// countPress(동일 자료 묶음 대표 1건), 예산은 /api/budget과 같은 readBudget(사회복지, 대상자 묶음) 합계, 복지제도는 제도명 판정.
import { after } from "next/server";

import schema from "../ontology/welfare-v2/schema.json";
import { DATASET_CACHE_PREFIX, wikiEditsVersion, writeStoredEntries } from "./dataset-cache.ts";
import { getD1 } from "./d1.ts";
import { parseBudgetRequest, readBudget } from "./fiscal/public.ts";
import { memoizeForTtl } from "./memo.ts";
import { FISCAL_ENTITY_REGIONS_SQL, type MindmapSource } from "./mindmap.ts";
import { CANONICAL_SIDO_SQL, readLatestRun } from "./official-query.ts";
import { CATEGORY_LABELS } from "./press/dictionary.ts";
import { countPress, parsePressSearch, readPressRegions } from "./press/query.ts";
import { SERVICE_TARGET_COLUMNS, TARGET_GROUP_DEFINITION_VERSION, TARGET_GROUPS, targetGroupSlug, targetGroupSql } from "./target-groups.ts";
import { cachedWikiEdits } from "./wiki-edit-store.ts";

/** 대상자 묶음 조건(지원대상·세부대상·사업명). 검색 API의 target_group과 같은 함수. */
function targetClause(id: string): { readonly sql: string; readonly binds: readonly string[] } {
  const { sql, values } = targetGroupSql(targetGroupSlug(id), SERVICE_TARGET_COLUMNS);
  return { sql, binds: values };
}

async function newsCountFor(db: ReturnType<typeof getD1>, id: string): Promise<number> {
  const parsed = parsePressSearch(new URLSearchParams({ target_group: targetGroupSlug(id), group_mode: "verified_groups" }));
  if (!parsed.ok) throw new Error(parsed.message);
  return countPress(db, parsed.search);
}

async function budgetCountFor(db: ReturnType<typeof getD1>, id: string): Promise<number | undefined> {
  const parsed = parseBudgetRequest(new URLSearchParams({ mode: "social_welfare", target_group: targetGroupSlug(id), view: "main" }));
  if (!parsed.ok) throw new Error(parsed.message);
  const body = await readBudget(db, parsed.request);
  return "total" in body && typeof body.total === "number" && !("unavailable" in body && body.unavailable) ? body.total : undefined;
}

/** 관계성 지도 정보칸용 대상자 묶음별 관련 수(대분류별 사업, 시·군·구, 보도자료, 예산 세부사업). 읽기만 한다. */
async function readTargetRelations(db: ReturnType<typeof getD1>, runId: string, groups: readonly (readonly [string, { readonly keywords: readonly string[] }])[]) {
  const [perGroup, news, budget] = await Promise.all([
    Promise.all(groups.map(async ([id]) => {
      const { sql, binds } = targetClause(id);
      const [categories, regions] = await Promise.all([
        db.prepare("SELECT category, COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ? AND (" + sql + ") GROUP BY category").bind(runId, ...binds).all<{ category: string; count: number }>().then((result) => result.results),
        db.prepare("SELECT COUNT(DISTINCT " + CANONICAL_SIDO_SQL + " || '|' || sigungu) AS count FROM official_service_snapshot WHERE sync_run_id = ? AND (" + sql + ")").bind(runId, ...binds).first<{ count: number }>(),
      ]);
      return { categories, regions: Number(regions?.count ?? 0) };
    })),
    Promise.all(groups.map(([id]) => newsCountFor(db, id))),
    // 예산 화면(/api/budget)과 같은 경로·공개본·조건으로 센다. 확인할 수 없으면 표시하지 않는다(undefined).
    Promise.all(groups.map(([id]) => budgetCountFor(db, id).catch(() => undefined))),
  ]);
  return groups.map((_, index) => ({
    byCategory: perGroup[index].categories,
    regionCount: perGroup[index].regions,
    newsCount: news[index],
    budgetCount: budget[index],
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
    Promise.all(targetEntries.map(([id]) => {
      const { sql, binds } = targetClause(id);
      return db.prepare("SELECT COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ? AND " + sql).bind(runId, ...binds).first<{ count: number }>().then((row) => row?.count ?? 0);
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
// 대상자 묶음 정의 판본을 열쇠에 넣어, 정의가 바뀌면 예전 집계를 쓰지 않는다.
const STORED_NAME = "mindmap:source:" + TARGET_GROUP_DEFINITION_VERSION;
const STORED_KEY = DATASET_CACHE_PREFIX + STORED_NAME;
const STORED_FRESH_SECONDS = 15 * 60;
// 새 수집본이 들어오면 dataset_response_cache 보관본은 정리된다. 그때 첫 방문자가 전체 집계(약 18초)를 기다리지 않도록
// 마지막으로 계산한 결과를 app_setting에 따로 두고 먼저 보낸 뒤 응답 뒤에 새로 계산한다.
const LAST_GOOD_KEY = "mindmap_last_good:" + TARGET_GROUP_DEFINITION_VERSION;

function refreshLater(): void {
  const refresh = () => computeAndStore().then(() => undefined, () => undefined);
  try {
    after(refresh);
  } catch {
    void refresh();
  }
}

async function computeAndStore(): Promise<MindmapSource> {
  const source = await readSource();
  // 대시보드 보관본과 같은 수집 번호·위키 수정 상태로 저장해야 보관본 정리(pruneStaleEntries)에서 지워지지 않는다.
  const [run, edits] = await Promise.all([readLatestRun(), cachedWikiEdits()]);
  const body = JSON.stringify(source);
  if (run) await writeStoredEntries([{ key: STORED_NAME, body }], run.id, wikiEditsVersion(edits)).catch(() => undefined);
  await getD1().prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(LAST_GOOD_KEY, body, Math.floor(Date.now() / 1000)).run().catch(() => undefined);
  return source;
}

async function readStoredSource(): Promise<MindmapSource> {
  const row = await getD1().prepare("SELECT body, created_at FROM dataset_response_cache WHERE cache_key = ?").bind(STORED_KEY)
    .first<{ body: string; created_at: number }>().catch(() => null);
  if (!row) {
    const last = await getD1().prepare("SELECT value FROM app_setting WHERE key = ?").bind(LAST_GOOD_KEY).first<{ value: string }>().catch(() => null);
    if (!last) return computeAndStore();
    refreshLater();
    return JSON.parse(last.value) as MindmapSource;
  }
  if (Math.floor(Date.now() / 1000) - row.created_at > STORED_FRESH_SECONDS) refreshLater();
  return JSON.parse(row.body) as MindmapSource;
}

/** 서버 인스턴스마다 5분 동안 기억하고, 그 밖에는 D1 보관본을 쓴다. */
export const readMindmapSource = memoizeForTtl(readStoredSource, 5 * 60_000);
