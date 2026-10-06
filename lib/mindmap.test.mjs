// 복지 마인드맵 나무 구성(lib/mindmap.ts) 시험: 묶음 뒤 합계 유지, 지역·대상자·뉴스·재정·온톨로지 가지, 복지제도100 분류 수.
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { buildServerBranches, buildWelfare100Branch, countNodes, ENTITY_LABELS, RELATION_LABELS } from "./mindmap.ts";

const SOURCE = {
  generatedAt: "2026-10-05T00:00:00.000Z",
  knowledge: { dataAsOf: "2026-07", completedAt: "" },
  services: {
    total: 0,
    documents: 2,
    categories: [
      { category: "일상생활돌봄", subcategory: "안부확인", count: 30 },
      { category: "일상생활돌봄", subcategory: "식사지원", count: 20 },
      { category: "일상생활돌봄", subcategory: "가사지원", count: 5 },
      { category: "보건의료", subcategory: "방문의료", count: 7 },
      { category: "건강관리예방", subcategory: "", count: 3 },
    ],
    regions: [
      { sido: "제주특별자치도", sigungu: "제주특별자치도", count: 4 },
      { sido: "제주특별자치도", sigungu: "서귀포시", count: 10 },
      { sido: "제주특별자치도", sigungu: "제주시", count: 6 },
      { sido: "강원특별자치도", sigungu: "강릉시", count: 45 },
    ],
    targetGroups: [{ id: "target:elderly", label: "노인", keywords: ["노인", "어르신"], count: 40 }, { id: "target:dementia", label: "치매", keywords: ["치매"], count: 9 }],
  },
  news: { total: 12, categories: [{ code: "senior", label: "노인", count: 8 }, { code: "youth", label: "청소년", count: 4 }] },
  fiscal: { entityTotal: 3, regions: [{ code: "4900000", name: "제주", count: 1 }, { code: "1100000", name: "서울", count: 2 }], integratedCare: [{ basis: "wiki_name_match", count: 5 }] },
  ontology: { entities: [{ id: "Region", status: "IMPLEMENTED" }, { id: "NewsArticle", status: "NOT_COLLECTED", note: "민간 기사 미수집" }], relations: [{ id: "located_in", domain: "ProgramImplementation", range: "Region", status: "IMPLEMENTED" }] },
};

test("축약 없이 모든 중분류·시·군·구를 많은 순으로 보인다", () => {
  const many = { ...SOURCE, services: { ...SOURCE.services, regions: Array.from({ length: 31 }, (_, index) => ({ sido: "경기도", sigungu: "시군" + index, count: index + 1 })) } };
  const gyeonggi = buildServerBranches(many)[2].children.find((node) => node.label === "경기도");
  assert.equal(gyeonggi.children.length, 31);
  assert.equal(gyeonggi.children.some((node) => node.label.startsWith("그 밖의")), false);
  assert.equal(gyeonggi.children[0].label, "시군30");
});

test("서버 가지: 대분류는 사업안내 순서, 중분류 합계가 대분류 수, 지역은 광역 단위 사업을 따로 센다", () => {
  const branches = buildServerBranches(SOURCE);
  assert.deepEqual(branches.map((node) => node.id), ["svc", "target", "region", "news", "fiscal", "onto"]);
  const svc = branches[0];
  assert.deepEqual(svc.children.map((node) => node.label), ["건강관리예방", "일상생활돌봄", "보건의료"]);
  const daily = svc.children[1];
  assert.equal(daily.count, 55);
  assert.deepEqual(daily.children.map((node) => [node.label, node.count]), [["안부확인", 30], ["식사지원", 20], ["가사지원", 5]]);
  assert.equal(daily.href, "/?category=%EC%9D%BC%EC%83%81%EC%83%9D%ED%99%9C%EB%8F%8C%EB%B4%84");
  assert.equal(svc.children[0].children[0].label, "중분류 없음");
  const region = branches[2];
  assert.equal(region.children[0].label, "강원특별자치도", "사업이 많은 시·도가 먼저");
  const jeju = region.children.find((node) => node.label === "제주특별자치도");
  assert.equal(jeju.count, 20);
  assert.deepEqual(jeju.children.map((node) => node.label), ["서귀포시", "제주시"], "시·도 이름과 같은 시·군·구(광역 단위 사업)는 하위 마디로 넣지 않는다");
  assert.match(jeju.note, /광역 단위 사업 4건/);
  assert.equal(jeju.children[0].href, "/?sido=" + encodeURIComponent("제주특별자치도") + "&sigungu=" + encodeURIComponent("서귀포시"));
  assert.equal(branches[1].children[0].href, "/?q=" + encodeURIComponent("노인"));
  assert.equal(branches[3].children[0].href, "/news?category=senior");
  assert.equal(branches[4].children[0].children[0].label, "서울");
  assert.equal(branches[5].children[0].children[1].note, "미수집 · 민간 기사 미수집");
});

test("복지제도100 가지: 관심주제(대표 분류)·생애주기·가구상황·구분을 세고 주요 제도를 우선순위대로 단다", () => {
  const entries = [
    { slug: "a", name: "기초연금", org: "중앙부처", curated: true, priority: 7, category: "생활지원", lifecycle: ["노년"], household: ["저소득"] },
    { slug: "b", name: "생계급여", org: "중앙부처", curated: true, priority: 1, category: "생활지원", lifecycle: ["노년", "중장년"], household: ["저소득"] },
    { slug: "c", name: "제주 돌봄", org: "지자체", curated: false, priority: 999, category: "보호·돌봄", lifecycle: [], household: ["장애인"] },
  ];
  const branch = buildWelfare100Branch(entries, { topics: ["생활지원", "주거", "보호·돌봄"], lifecycle: ["중장년", "노년"], household: ["저소득", "장애인", "다자녀"] });
  assert.equal(branch.count, 3);
  const [topics, life, household, scope] = branch.children;
  assert.deepEqual(topics.children.map((node) => [node.label, node.count]), [["생활지원", 2], ["보호·돌봄", 1]], "제도가 없는 주제는 빼고");
  assert.deepEqual(topics.children[0].children.map((node) => node.label), ["생계급여", "기초연금"]);
  assert.equal(topics.children[0].children[0].href, "/welfare100/b");
  assert.deepEqual(life.children.map((node) => [node.label, node.count]), [["중장년", 1], ["노년", 2]]);
  assert.deepEqual(household.children.map((node) => node.label), ["저소득", "장애인"]);
  assert.deepEqual(scope.children.map((node) => node.count), [2, 2, 1]);
  assert.ok(countNodes(branch) > 10);
});

test("구조 가지: 스키마의 모든 개체 유형·관계·상태를 한글 이름으로 보여 준다", () => {
  const schema = JSON.parse(readFileSync(new URL("../ontology/welfare-v2/schema.json", import.meta.url), "utf8"));
  const ids = [...schema.entity_types.map((entity) => entity.id), ...schema.relations.flatMap((relation) => [relation.domain, relation.range].filter(Boolean).flatMap((value) => value.split("|")))];
  assert.deepEqual([...new Set(ids)].filter((id) => !ENTITY_LABELS[id]), [], "한글 이름이 없는 개체 유형");
  assert.deepEqual(schema.relations.map((relation) => relation.id).filter((id) => !RELATION_LABELS[id]), [], "한글 이름이 없는 관계");
  const onto = buildServerBranches(SOURCE).find((node) => node.id === "onto");
  const [entities, relations] = onto.children;
  assert.deepEqual(entities.children.map((node) => [node.label, node.note]), [["지역", "구현"], ["언론 기사", "미수집 · 민간 기사 미수집"]]);
  assert.deepEqual(relations.children.map((node) => [node.label, node.note]), [["소재 지역", "통합돌봄 시행사업 → 지역 · 구현"]]);
  const shown = (node) => [node.label, node.note ?? "", ...(node.children ?? []).flatMap(shown)];
  assert.doesNotMatch(shown(onto).join(" "), /[A-Za-z]{4,}/, "구조 가지 화면 글자에 영어 이름이 남지 않는다");
});
