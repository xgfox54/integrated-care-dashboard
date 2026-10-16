// 복지정보 관계성 지도 View Model(lib/mindmap-view.ts) 시험: 첫 단계 가지 구성·안정적인 ID·관련 자료 수 전달·검색(부분 일치·초성·동의어).
import assert from "node:assert/strict";
import test from "node:test";

import { ADVANCED_ID, buildExploreTree, chosungOf, countExplore, findExplorePath, ROOT_LABEL, searchExplore, TOP_IDS } from "./mindmap-view.ts";
import { readDashboardFilters } from "./dashboard-url.ts";
import { EMPTY_FILTERS, filterRows } from "./dataset.ts";
import { buildServerBranches } from "./mindmap.ts";

const SOURCE = {
  generatedAt: "2026-10-06T00:00:00.000Z",
  knowledge: { dataAsOf: "2026-07", completedAt: "" },
  services: {
    total: 0,
    documents: 2,
    categories: [
      { category: "일상생활돌봄", subcategory: "안부확인", count: 30 },
      { category: "보건의료", subcategory: "방문의료", count: 7 },
    ],
    categoryRegions: [{ category: "일상생활돌봄", regions: 3 }],
    regions: [
      { sido: "제주특별자치도", sigungu: "서귀포시", count: 10 },
      { sido: "제주특별자치도", sigungu: "제주시", count: 6 },
      { sido: "강원특별자치도", sigungu: "강릉시", count: 21 },
    ],
    targetGroups: [
      { id: "target:elderly", label: "노인", keywords: ["노인", "어르신"], count: 40, byCategory: [{ category: "일상생활돌봄", count: 25 }, { category: "보건의료", count: 5 }, { category: "주거", count: 0 }], regionCount: 12, newsCount: 7, budgetCount: 30 },
      { id: "target:dementia", label: "치매", keywords: ["치매"], count: 9 },
      { id: "target:discharged_patient", label: "퇴원환자", keywords: ["퇴원"], count: 4 },
    ],
  },
  news: { total: 12, categories: [{ code: "senior", label: "노인", count: 8 }], bySido: { 제주특별자치도: 5 } },
  fiscal: { entityTotal: 3, regions: [{ code: "4900000", name: "제주", count: 1 }, { code: "4200000", name: "강원", count: 2 }], integratedCare: [{ basis: "wiki_name_match", count: 5 }] },
  ontology: { entities: [{ id: "Region", status: "IMPLEMENTED" }], relations: [{ id: "located_in", domain: "ProgramImplementation", range: "Region", status: "IMPLEMENTED" }] },
};
const WELFARE = [{ name: "노인맞춤돌봄서비스" }, { name: "치매검사 지원" }, { name: "기초연금" }];

const tree = () => buildExploreTree({ source: SOURCE, welfareBranch: null, welfareEntries: WELFARE });

test("뿌리 아래에 탐색 기준 6개와 고급 탐색이 정해진 순서로 놓인다", () => {
  const root = tree();
  assert.equal(root.id, "root");
  assert.equal(root.label, ROOT_LABEL);
  assert.deepEqual(root.children.map((node) => node.id), [...TOP_IDS, ADVANCED_ID]);
});

test("ID는 나무 전체에서 겹치지 않고, 같은 원천이면 다시 만들어도 같다", () => {
  const collect = (node, out = []) => { out.push(node.id); for (const child of node.children ?? []) collect(child, out); return out; };
  const ids = collect(tree());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, countExplore(tree()));
  assert.deepEqual(collect(tree()), ids);
  assert.ok(ids.includes("target/elderly"));
  assert.ok(ids.includes("target/discharged-patient"));
});

test("대상자 마디는 원본 집계 수를 그대로 관련 자료로 넘기고, 0건 분류는 만들지 않는다", () => {
  const elderly = findExplorePath(tree(), "target/elderly").at(-1);
  const related = Object.fromEntries(elderly.related.map((item) => [item.key, item.count]));
  assert.deepEqual(related, { services: 40, welfare: 1, regions: 12, news: 7, budget: 30 });
  assert.deepEqual(elderly.children.map((node) => node.label), ["일상생활돌봄", "보건의료", "관련 복지제도"]);
  // D-04: 클릭 목록은 첫 낱말(q=노인)이 아니라 집계와 같은 대상자 묶음 조건으로 연다.
  assert.equal(elderly.related.find((item) => item.key === "news").href, "/news?target_group=elderly");
  assert.equal(elderly.related.find((item) => item.key === "services").href, "/?target_group=elderly#search-results");
  assert.equal(elderly.related.find((item) => item.key === "budget").href, "/budget?mode=social_welfare&target_group=elderly");
  const dementia = findExplorePath(tree(), "target/dementia").at(-1);
  assert.equal(dementia.related.some((item) => item.key === "news"), false);
});

test("지역 마디는 보도자료 수와 복지예산 지역 코드 바로가기를 붙인다", () => {
  const jeju = tree().children.find((node) => node.id === "region").children.find((node) => node.label === "제주특별자치도");
  assert.equal(jeju.related.find((item) => item.key === "news").count, 5);
  assert.equal(jeju.related.find((item) => item.key === "budget").href, "/budget?mode=social_welfare&region=4900000");
});

test("복지예산별은 지역 가지를 보존하고 통합돌봄 예산 분류를 지도·검색에서 제외한다", () => {
  const before = structuredClone(SOURCE.fiscal);
  const root = tree();
  const budget = findExplorePath(root, "budget").at(-1);
  assert.equal(budget.label, "복지예산별");
  assert.equal(budget.links[0].href, "/budget");
  assert.ok(findExplorePath(root, "fiscal/regions"));
  assert.equal(findExplorePath(root, "fiscal/care"), null);
  assert.deepEqual(searchExplore(root, "통합돌봄 예산 분류"), []);
  assert.deepEqual(SOURCE.fiscal, before);
  const sourceBudget = buildServerBranches(SOURCE).find(node => node.id === "fiscal");
  assert.equal(sourceBudget.children.find(node => node.id === "fiscal/care").count, 5);
});

test("검색은 부분 일치·초성·동의어를 모두 찾는다", () => {
  const root = tree();
  assert.equal(chosungOf("치매"), "ㅊㅁ");
  assert.equal(searchExplore(root, "ㅊㅁ")[0].node.id, "target/dementia");
  assert.equal(searchExplore(root, "어르신")[0].node.id, "target/elderly");
  assert.ok(searchExplore(root, "돌봄").some((hit) => hit.node.label === "일상생활돌봄"));
  assert.deepEqual(searchExplore(root, "   "), []);
  const hit = searchExplore(root, "퇴원")[0];
  assert.deepEqual(hit.path.map((node) => node.id), ["root", "target", "target/discharged-patient"]);
});

test("자료 화면 보기 링크는 중분류를 실제 검색에 적용하고 결과 목록을 가리킨다", () => {
  const source = { ...SOURCE, services: { ...SOURCE.services, categories: [{ category: "보건의료", subcategory: "생애말기", count: 3 }] } };
  const root = buildExploreTree({ source, welfareBranch: null, welfareEntries: WELFARE });
  const leaf = root.children.find(node => node.id === "service").children[0].children[0];
  const url = new URL(leaf.href, "https://dashboard.example.test");
  assert.equal(url.hash, "#search-results");
  assert.equal(leaf.links[0].href, leaf.href);
  assert.equal(leaf.related[0].href, leaf.href);
  const filters = readDashboardFilters(url.search);
  assert.equal(filters.category, "보건의료");
  assert.equal(filters.subcategory, "생애말기");
  const rows = [{ category: "보건의료", subcategory: "방문의료", name: "제외" }, ...Array.from({length:3},(_,i)=>({category:"보건의료",subcategory:"생애말기",name:"사업"+i})), {category:"일상생활돌봄",subcategory:"생애말기",name:"다른 분야"}];
  assert.equal(filterRows(rows, { ...EMPTY_FILTERS, ...filters }).length, 3);
  const elderly = findExplorePath(root, "target/elderly").at(-1);
  assert.equal(new URL(elderly.links[0].href, url).hash, "#search-results");
  const jeju = root.children.find(node=>node.id === "region").children.find(node=>node.label === "제주특별자치도");
  assert.equal(new URL(jeju.links[0].href,url).hash,"#search-results");
});
