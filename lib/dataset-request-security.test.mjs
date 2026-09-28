import assert from "node:assert/strict";
import test from "node:test";

import { parseDatasetSearchRequest } from "./dataset-request.ts";

test("dataset search accepts normalized allowlisted filters", () => {
  const result = parseDatasetSearchRequest(new URLSearchParams({
    sido: " 서울특별시 ",
    category: "보건의료",
    q: " 방문진료 ",
    page: "2",
    size: "50",
  }));

  assert.equal(result.success, true);
  assert.equal(result.success && result.data.filters.sido, "서울특별시");
  assert.equal(result.success && result.data.filters.keyword, "방문진료");
  assert.equal(result.success && result.data.page, 2);
  assert.equal(result.success && result.data.pageSize, 50);
});

for (const query of [
  "sido=허용되지않는지역",
  `q=${"가".repeat(101)}`,
  "page=0",
  "size=999",
  "sido=서울특별시&sido=부산광역시",
  "unknown=value",
  "sigungu=종로구",
]) {
  test(`dataset search rejects invalid query ${query.slice(0, 40)}`, () => {
    assert.equal(parseDatasetSearchRequest(new URLSearchParams(query)).success, false);
  });
}
