import assert from "node:assert/strict";
import test from "node:test";
import { readDashboardFilters } from "./dashboard-url.ts";
import { parseDatasetSearchRequest } from "./dataset-request.ts";
import { searchQueryString } from "./search-query.ts";

test("자료 화면 URL의 중분류·사업구분이 실제 API 요청과 캐시 키에 유지된다", () => {
  const filters = readDashboardFilters("?category=보건의료&subcategory=생애말기&type=전국");
  const query = searchQueryString(filters, 1, 30);
  const request = parseDatasetSearchRequest(new URLSearchParams(query));
  assert.equal(request.success, true);
  assert.equal(request.data.filters.subcategory, "생애말기");
  assert.equal(request.data.filters.type, "전국");
  assert.equal(request.data.filters.category, "보건의료");
  assert.notEqual(query, searchQueryString({ ...filters, subcategory: "" }, 1, 30));
  assert.notEqual(query, searchQueryString({ ...filters, type: "" }, 1, 30));
  assert.notEqual(query, searchQueryString(filters, 2, 30));
});

test("지역 묶음 요청은 중분류가 없으면 기존 주소를 유지한다", () => {
  assert.equal(searchQueryString({ sido: "제주", sigungu: "", category: "보건의료", keyword: "" }, 1, 30),
    "page=1&size=30&sido=%EC%A0%9C%EC%A3%BC&category=%EB%B3%B4%EA%B1%B4%EC%9D%98%EB%A3%8C");
});
