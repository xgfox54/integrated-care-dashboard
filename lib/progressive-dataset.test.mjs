import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDatasetSummary,
  normalizeSearchPageSize,
  orderServiceCategories,
  paginateRows,
} from "./dataset-summary.ts";
import {
  buildRegionLoadOrder,
  bundleQueryString,
  planRegionBundles,
  sigunguBundleTargets,
} from "./region-load-order.ts";

test("dashboard entry does not preload or fetch the 10,716-row snapshot", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("./use-dataset.ts", import.meta.url), "utf8");
  const loader = readFileSync(new URL("./search-loader.ts", import.meta.url), "utf8");

  assert.doesNotMatch(layout, /dashboard-snapshot-20260920\.json/);
  assert.doesNotMatch(hook, /dashboard-snapshot-20260920\.json/);
  assert.match(hook, /\/api\/dataset\/summary/);
  assert.match(loader, /\/api\/dataset\/search/);
});

test("regions load visitor 광역시·도 first, then 광역시·도 and 시·군·구 in 가나다 order", () => {
  const order = buildRegionLoadOrder(
    {
      서울특별시: ["중구", "강남구"],
      경기도: ["수원시", "가평군"],
      제주특별자치도: ["제주특별자치도"],
      부산광역시: ["중구"],
    },
    "서울특별시",
  );

  assert.deepEqual(order.map(({ sido, sigungu }) => sigungu || sido), [
    "서울특별시",
    "경기도",
    "부산광역시",
    "제주특별자치도",
    "가평군",
    "강남구",
    "수원시",
    "중구",
    "중구",
  ]);
  assert.deepEqual(order.slice(-2).map(({ sido }) => sido), ["부산광역시", "서울특별시"]);
  assert.equal(buildRegionLoadOrder({ 경기도: [] }, "해외")[0].sido, "경기도");
});

test("region bundles keep the load order: visitor 광역시·도, all 광역시·도, then 시·군·구 가나다 in slices", () => {
  const sigunguBySido = {
    서울특별시: ["중구", "강남구", "종로구"],
    경기도: ["수원시", "가평군", "고양시"],
    제주특별자치도: ["제주특별자치도"],
    부산광역시: ["중구", "해운대구"],
  };
  const plan = planRegionBundles(sigunguBySido, "부산광역시", 100);
  assert.deepEqual(plan.preferred, { sido: "부산광역시", sigungu: "" });
  assert.equal(plan.bundles[0].scope, "sido");
  const flattened = [plan.preferred, ...plan.bundles.flatMap((bundle) => bundle.targets)]
    .filter((target, index, all) => all.findIndex((other) => other.sido === target.sido && other.sigungu === target.sigungu) === index);
  assert.deepEqual(flattened, buildRegionLoadOrder(sigunguBySido, "부산광역시"));
  // 쪽 크기 100이면 묶음마다 시·군·구 6곳씩
  assert.deepEqual(plan.bundles.slice(1).map((bundle) => bundle.targets.length), [6, 2]);
  for (const bundle of plan.bundles.slice(1)) {
    assert.deepEqual(sigunguBundleTargets(sigunguBySido, bundle.part, bundle.per), bundle.targets);
  }
  assert.equal(planRegionBundles(sigunguBySido, "해외", 30).preferred, null);
  assert.equal(bundleQueryString(plan.bundles[1], 100, "보건의료"), "scope=sigungu&part=0&per=6&size=100&category=%EB%B3%B4%EA%B1%B4%EC%9D%98%EB%A3%8C");
});

test("dashboard background prefetch uses region bundles and stops in data-saver mode", () => {
  const hook = readFileSync(new URL("./use-dataset.ts", import.meta.url), "utf8");
  const loader = readFileSync(new URL("./search-loader.ts", import.meta.url), "utf8");
  assert.match(hook, /planRegionBundles/);
  assert.match(hook, /if \(prefersDataSaving\(\)\) return null;/);
  assert.match(loader, /\/api\/dataset\/bundle\?/);
});

test("page and API code never loads the 12MB sync module at startup", () => {
  const staticImport = /^import[^;]*from\s+["'][^"']*official-sync["'];?$/m;
  for (const file of [
    "../worker/index.ts",
    "../app/api/dataset/route.ts",
    "../app/api/dataset/summary/route.ts",
    "../app/sources/page.tsx",
    "./official-sync-status.ts",
    "./dataset-responses.ts",
  ]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), staticImport, file);
  }
});

test("long exact search terms avoid the D1 LIKE pattern limit", () => {
  const query = readFileSync(new URL("./official-query.ts", import.meta.url), "utf8");
  const searchText = readFileSync(new URL("./official-search-text.ts", import.meta.url), "utf8");

  assert.match(query, /INSTR\(\$\{SEARCH_TEXT_LOOKUP\}, \?\) > 0/);
  assert.doesNotMatch(query, /SEARCH_TEXT_LOOKUP\} LIKE \?/);
  assert.doesNotMatch(searchText, /LIKE/);
});

test("summary payload contains counts and choices without service rows", () => {
  const summary = buildDatasetSummary([
    {
      sido: "서울특별시",
      sigungu: "종로구",
      category: "보건의료",
      name: "방문진료",
    },
    {
      sido: "서울특별시",
      sigungu: "중구",
      category: "일상생활돌봄",
      name: "식사지원",
    },
    {
      sido: "제주특별자치도",
      sigungu: "제주특별자치도",
      category: "보건의료",
      name: "재택의료",
    },
  ]);

  assert.equal(summary.totalCount, 3);
  assert.deepEqual(summary.regionCounts, {
    서울특별시: 2,
    제주특별자치도: 1,
  });
  assert.deepEqual(summary.categoryCounts, {
    보건의료: 2,
    일상생활돌봄: 1,
  });
  assert.deepEqual(summary.sigunguBySido, {
    서울특별시: ["종로구", "중구"],
    제주특별자치도: ["제주특별자치도"],
  });
  // 제주·세종은 기초자치단체가 없어 「수록 시·군·구」 수에서 빼고, 필터 선택지에는 남긴다.
  assert.equal(summary.sigunguCount, 2);
  assert.equal("rows" in summary, false);
  assert.deepEqual(orderServiceCategories(["기타", "보건의료", "일상생활돌봄"]), [
    "일상생활돌봄",
    "보건의료",
    "기타",
  ]);
});

test("search pagination defaults to 30 and preserves total count", () => {
  const rows = Array.from({ length: 67 }, (_, index) => ({ id: index }));
  const result = paginateRows(rows, 2, normalizeSearchPageSize(undefined));

  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 30);
  assert.equal(result.totalCount, 67);
  assert.equal(result.pageCount, 3);
  assert.deepEqual(result.rows.map((row) => row.id), Array.from({ length: 30 }, (_, i) => i + 30));
  assert.equal(normalizeSearchPageSize(20), 20);
  assert.equal(normalizeSearchPageSize(100), 100);
  assert.equal(normalizeSearchPageSize(999), 30);
});

test("build emits summary and region artifacts instead of the monolithic public snapshot", () => {
  const summaryPath = new URL("../public/data/summary.json", import.meta.url);
  const regionsPath = new URL("../public/data/regions", import.meta.url);
  const monolithPath = new URL("../public/dashboard-snapshot-20260920.json", import.meta.url);

  assert.equal(existsSync(summaryPath), true);
  assert.equal(existsSync(regionsPath), true);
  assert.equal(existsSync(monolithPath), false);
});
