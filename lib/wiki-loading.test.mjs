// 통합돌봄 WIKI 목록 불러오기: 100개까지 차례로 받고 멈춘 뒤, 목록을 80% 이상 내리면 다시 받는다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { extendTarget, nextCatalogPage, scrolledPast, WIKI_LOAD_PLAN, WIKI_SAVER_PLAN } from "./wiki-loading.ts";

/** 목표 수에 닿을 때까지 받는 쪽 번호들 */
function pagesUntilPause(loadedPages, plan, total, target) {
  const pages = [];
  let loaded = loadedPages;
  for (let next = nextCatalogPage(loaded, plan.pageSize, total, target); next !== null; next = nextCatalogPage(loaded, plan.pageSize, total, target)) {
    pages.push(next);
    loaded = next;
  }
  return { pages, loaded };
}

test("보통: 첫 쪽 뒤 100개까지 차례로 받고 멈추며, 80% 스크롤마다 50개씩 더 받는다", () => {
  const plan = WIKI_LOAD_PLAN;
  const first = pagesUntilPause(1, plan, 760, plan.firstTarget);
  assert.deepEqual(first, { pages: [2], loaded: 2 });
  assert.equal(first.loaded * plan.pageSize, 100);
  const target = extendTarget(plan.firstTarget, first.loaded * plan.pageSize, plan.step);
  assert.equal(target, 150);
  assert.deepEqual(pagesUntilPause(first.loaded, plan, 760, target).pages, [3]);
  // 받는 중에 다시 스크롤해도 목표가 더 늘지 않는다.
  assert.equal(extendTarget(150, 100, plan.step), 150);
});

test("전체가 목표보다 적으면 있는 만큼만 받고, 데이터 절약 모드는 미리 채우지 않는다", () => {
  assert.equal(nextCatalogPage(1, WIKI_LOAD_PLAN.pageSize, 42, WIKI_LOAD_PLAN.firstTarget), null);
  assert.deepEqual(pagesUntilPause(1, WIKI_LOAD_PLAN, 70, WIKI_LOAD_PLAN.firstTarget).pages, [2]);
  assert.equal(nextCatalogPage(1, WIKI_SAVER_PLAN.pageSize, 760, WIKI_SAVER_PLAN.firstTarget), null);
  assert.equal(extendTarget(WIKI_SAVER_PLAN.firstTarget, 20, WIKI_SAVER_PLAN.step), 40);
});

test("목록 상자를 80% 이상 내렸을 때만 다음 묶음을 부른다", () => {
  assert.equal(scrolledPast({ scrollTop: 0, clientHeight: 500, scrollHeight: 5000 }), false);
  assert.equal(scrolledPast({ scrollTop: 3400, clientHeight: 500, scrollHeight: 5000 }), false);
  assert.equal(scrolledPast({ scrollTop: 3500, clientHeight: 500, scrollHeight: 5000 }), true);
  assert.equal(scrolledPast({ scrollTop: 0, clientHeight: 500, scrollHeight: 400 }), true);
});
