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

test("selected region drives summary, chart title, and DataStatus scrolling", () => {
  assert.match(summarySource, /\$\{regionName\} 요약/);
  assert.doesNotMatch(summarySource, /서귀포 언급 사업/);
  assert.doesNotMatch(summarySource, /현재 보건복지부 메뉴판에서 서귀포시 단위가 분리되지 않아/);

  assert.match(chartSource, /\$\{regionName\} 분야별 사업 분포/);
  assert.match(
    dashboardSource,
    /const regionName = filters\.sigungu \|\| getRegionDisplayName\(filters\.sido\)/,
  );
  assert.match(dashboardSource, /dataStatusRef\.current\?\.scrollIntoView/);
  assert.match(dashboardSource, /prefers-reduced-motion: reduce/);
});
