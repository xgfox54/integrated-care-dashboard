import assert from "node:assert/strict";
import test from "node:test";

import {
  dashboardCsvUrl,
  dashboardPagePath,
  dashboardShareUrl,
  readDashboardFilters,
} from "./dashboard-url.ts";

test("legacy query hydrates filters while page and share omit free text", () => {
  // Given: a legacy dashboard query with allowed filters, free text, and unrelated input.
  const search = "?sido=서울특별시&category=요양&q=민감한검색어&unrelated=discard";

  // When: the dashboard reads and serializes the filters for page and sharing URLs.
  const filters = readDashboardFilters(search);
  const pagePath = dashboardPagePath("/", filters);
  const shareUrl = dashboardShareUrl("https://dashboard.example.test", "/", filters);

  // Then: hydration retains the legacy keyword, but page and share URLs contain only their allowlist.
  assert.deepEqual(filters, {
    sido: "서울특별시",
    sigungu: "",
    category: "요양",
    subcategory: "",
    type: "",
    keyword: "민감한검색어",
  });
  assert.equal(pagePath, "/?sido=%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C&category=%EC%9A%94%EC%96%91");
  assert.equal(shareUrl, "https://dashboard.example.test/?sido=%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C&category=%EC%9A%94%EC%96%91");
  assert.equal(pagePath.includes("q="), false);
  assert.equal(shareUrl.includes("민감한검색어"), false);
  assert.equal(shareUrl.includes("unrelated"), false);
});

test("CSV export retains the keyword while omitting empty filters", () => {
  // Given: filters with Korean text and empty optional values.
  const filters = {
    ...readDashboardFilters("?sido=서울특별시&category=요양&q=민감한검색어"),
    sigungu: "",
  };

  // When: the CSV export URL is created.
  const csvUrl = dashboardCsvUrl(filters);

  // Then: the export retains the keyword and excludes empty values.
  assert.equal(csvUrl, "/api/dataset/export?sido=%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C&category=%EC%9A%94%EC%96%91&q=%EB%AF%BC%EA%B0%90%ED%95%9C%EA%B2%80%EC%83%89%EC%96%B4");
});

test("empty filters leave the page pathname canonical", () => {
  // Given: the legacy query has no dashboard filters.
  const filters = readDashboardFilters("?unrelated=discard");

  // When: the page path and CSV URL are generated.
  const pagePath = dashboardPagePath("/dashboard", filters);
  const csvUrl = dashboardCsvUrl(filters);

  // Then: the page path has no dangling query and the export target remains canonical.
  assert.equal(pagePath, "/dashboard");
  assert.equal(csvUrl, "/api/dataset/export?");
});

test("valid sort is preserved across page, share, and CSV URLs", () => {
  const filters = readDashboardFilters("?sort=name");

  assert.equal(dashboardPagePath("/", filters), "/?sort=name");
  assert.equal(dashboardShareUrl("https://dashboard.example.test", "/", filters), "https://dashboard.example.test/?sort=name");
  assert.equal(dashboardCsvUrl(filters), "/api/dataset/export?sort=name");
  assert.equal(readDashboardFilters("?sort=not-allowed").sort, undefined);
});
