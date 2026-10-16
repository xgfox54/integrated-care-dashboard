import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { searchStatistics } from "./statistics/catalog.ts";
import { readCurrentStatistics } from "./statistics/store.ts";
import { registerStatisticsTools } from "./mcp/statistics-tools.ts";
import { database } from "./press-test-support.mjs";

test("city population MCP retrieval matches the captured official monthly resident cells", async t => {
  // Given: the province's official HTML, with resident and foreign rows separated.
  const html = readFileSync(new URL("./statistics/fixtures/jeju-resident-20261012.html", import.meta.url), "utf8");
  const row = /<th rowspan="2">서귀포시<\/th>\s*<th>내국인<\/th>([\s\S]*?)<\/tr>/.exec(html);
  assert.ok(row);
  assert.match(html, /<option value="2026"\s+selected/);
  const sourceValues = [...row[1].matchAll(/<td class="value">([\d,]+)<\/td>/g)].map(match => Number(match[1].replaceAll(",", "")));
  const db = database();
  t.after(() => db.sqlite.close());
  const handlers = new Map();
  registerStatisticsTools({ db, register: (name, _title, _description, _shape, handler) => handlers.set(name, handler), wrap: async data => data });
  const item = searchStatistics({ query: "서귀포 인구", kind: "population", data_only: true }).items.find(item => item.id === "city:seogwipo-population");
  assert.ok(item);
  // When: the discovered city table is requested through the MCP handler.
  const result = await handlers.get("get_statistics_data")({ statistics_id: item.id });
  // Then: all nine monthly values retain the official resident-only figures.
  assert.equal(sourceValues.length, 9);
  assert.deepEqual(result.dataset.series[0].points.map(point => point.value), sourceValues);
  assert.equal(result.dataset.series[0].region.level, "sigungu");
  assert.equal(result.state, "VERIFIED_SNAPSHOT");
  assert.equal(result.auto_refresh, undefined);
  assert.equal(result.coverage.complete, false);
  assert.deepEqual(await readCurrentStatistics(db, item.id), result);
});
