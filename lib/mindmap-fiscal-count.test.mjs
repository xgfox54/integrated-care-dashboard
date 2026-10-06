// 마인드맵 지자체 수: 지방재정365 재정주체 245행(통합 전 광주·전남 본청 포함)을 현행 243곳·광역 16개로 센다.
import assert from "node:assert/strict";
import test from "node:test";

import { FISCAL_ENTITY_REGIONS_SQL } from "./mindmap.ts";
import { database } from "./press-test-support.mjs";

test("통합 전 광주·전남 본청은 세지 않고, 광주·전남 시·군·구는 전남광주로 묶는다", async () => {
  const db = database();
  const insert = db.sqlite.prepare("INSERT INTO fiscal_entity (fiscal_entity_id, code_system, code, name, wa_code, wa_name, padm_code, first_seen_at, last_seen_at) VALUES (?, 'LOFIN_LAF_CD', ?, ?, ?, ?, '', 1, 1)");
  const rows = [
    ["1100000", "서울본청", "1100000", "서울"], ["3110000", "서울종로구", "1100000", "서울"],
    ["2900000", "광주본청", "2900000", "광주"], ["3290000", "광주동구", "2900000", "광주"],
    ["4600000", "전남본청", "4600000", "전남"], ["4810000", "전남여수시", "4600000", "전남"],
    ["6100000", "전남광주본청", "1300000", "전남광주"], ["4800000", "전남광주목포시", "1300000", "전남광주"],
  ];
  for (const [code, name, wa, waName] of rows) insert.run("lofin:laf:" + code, code, name, wa, waName);
  const result = (await db.prepare(FISCAL_ENTITY_REGIONS_SQL).all()).results.sort((a, b) => a.code.localeCompare(b.code));
  assert.deepEqual(result.map((row) => [row.code, row.name, row.count]), [["1100000", "서울", 2], ["1300000", "전남광주", 4]]);
  assert.equal(result.reduce((sum, row) => sum + row.count, 0), 6, "8행 중 폐지 본청 2곳 제외");
});
