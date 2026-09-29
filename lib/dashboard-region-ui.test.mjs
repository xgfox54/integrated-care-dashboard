import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardSource = await readFile(
  new URL("../components/dashboard/dashboard.tsx", import.meta.url),
  "utf8",
);
const summarySource = await readFile(
  new URL("../components/dashboard/region-summary-panel.tsx", import.meta.url),
  "utf8",
);
const chartSource = await readFile(
  new URL("../components/dashboard/category-chart.tsx", import.meta.url),
  "utf8",
);

const kpiSource = await readFile(new URL("../components/dashboard/kpi-cards.tsx", import.meta.url), "utf8");
const mapSource = await readFile(new URL("../components/dashboard/national-map.tsx", import.meta.url), "utf8");

test("selected region drives summary, chart title, and scrolls the result tabs to the top", () => {
  assert.match(summarySource, /\$\{regionName\} 요약/);
  assert.doesNotMatch(summarySource, /서귀포 언급 사업/);
  assert.doesNotMatch(summarySource, /현재 보건복지부 메뉴판에서 서귀포시 단위가 분리되지 않아/);

  assert.match(chartSource, /\$\{regionName\} 분야별 사업 분포/);
  assert.match(
    dashboardSource,
    /const regionName = filters\.sigungu \|\| getRegionDisplayName\(filters\.sido\)/,
  );
  assert.match(dashboardSource, /resultsRef\.current\?\.scrollIntoView/);
  assert.match(dashboardSource, /<div ref=\{resultsRef\} className="scroll-mt-3">\s*<Tabs /);
  assert.match(dashboardSource, /prefers-reduced-motion: reduce/);
});

test("KPI cards sit under the map heading and no longer show the current result count", () => {
  assert.doesNotMatch(kpiSource, /현재 검색 결과/);
  assert.doesNotMatch(dashboardSource, /<KpiCards /);
  const heading = mapSource.indexOf("광역단위를 가리키거나 선택하면");
  const cards = mapSource.indexOf("<KpiCards summary={kpis} />");
  const map = mapSource.indexOf("<KoreaVectorMap");
  assert.ok(heading > 0 && heading < cards && cards < map);
});
