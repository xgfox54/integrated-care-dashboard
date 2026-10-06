import assert from "node:assert/strict";
import test from "node:test";

import { createWikiArticle } from "./wiki-article.ts";
import { applyWikiEdits, parseWikiEditInput } from "./wiki-edits.ts";

function row(overrides = {}) {
  return {
    id: 1,
    serviceId: "0078:1489566:1:2:3",
    sido: "강원특별자치도",
    sigungu: "강릉시",
    category: "일상생활돌봄",
    subcategory: "안부확인",
    name: "1촌돌봄단",
    description: "강릉愛밥상 서비스 가구방문 전달체계",
    target: "돌봄필요 재가노인",
    detailTarget: "",
    applicationMethod: "",
    provider: "종합사회복지관",
    type: "지역특화",
    serial: "12",
    detailUrl: "https://www.mohw.go.kr/board.es?list_no=1",
    updatedDate: "2026-04",
    searchIndex: "",
    ...overrides,
  };
}

function values(overrides = {}) {
  return {
    description: null,
    target: null,
    detailTarget: null,
    provider: null,
    applicationMethod: null,
    content: null,
    sourceTitle: null,
    sourceUrl: null,
    ...overrides,
  };
}

test("edit input keeps typed text and turns blank fields into original-value fallbacks", () => {
  const input = parseWikiEditInput({
    serviceId: " 0078:1489566:1:2:3 ",
    description: "  이웃이 1촌을 맺어 홀몸 어르신의 안부를 살핍니다. ",
    target: "",
    sourceUrl: "https://www.gn.go.kr/news/1",
    note: " 보도자료 확인 ",
  });

  assert.equal(input.serviceId, "0078:1489566:1:2:3");
  assert.equal(input.values.description, "이웃이 1촌을 맺어 홀몸 어르신의 안부를 살핍니다.");
  assert.equal(input.values.target, null);
  assert.equal(input.values.content, null);
  assert.equal(input.note, "보도자료 확인");
});

test("edit input rejects a supplementary source that is not a web address", () => {
  assert.throws(
    () => parseWikiEditInput({ serviceId: "service-1", sourceUrl: "javascript:alert(1)" }),
    /http:\/\/ 또는 https:\/\//,
  );
});

test("admin edits replace only the edited fields of the matching service", () => {
  const edits = new Map([["0078:1489566:1:2:3", values({ description: "안부 확인 사업", provider: "강릉시 복지정책과" })]]);
  const [edited, untouched] = applyWikiEdits([row(), row({ serviceId: "other", name: "강릉愛밥상" })], edits);

  assert.equal(edited.description, "안부 확인 사업");
  assert.equal(edited.provider, "강릉시 복지정책과");
  assert.equal(edited.target, "돌봄필요 재가노인");
  assert.equal(untouched.description, "강릉愛밥상 서비스 가구방문 전달체계");
});

test("wiki article shows the admin-reviewed description, detail text and source", () => {
  const article = createWikiArticle(row(), {
    adminEdit: {
      ...values({
        description: "이웃이 1촌을 맺어 홀몸 어르신의 안부를 살핍니다.",
        target: "홀몸 어르신",
        content: "주 1회 이상 방문과 전화로 안부를 확인합니다.",
        sourceTitle: "강릉시 보도자료",
        sourceUrl: "https://www.gn.go.kr/news/1",
      }),
      updatedAt: 1790300000,
    },
  });

  assert.equal(article.contentStatus, "admin-edited");
  assert.equal(article.overview, "이웃이 1촌을 맺어 홀몸 어르신의 안부를 살핍니다.");
  assert.equal(article.content, "강원특별자치도 강릉시에서 제공하는 1촌돌봄단 사업입니다. 제공기관은 종합사회복지관입니다.\n\n주 1회 이상 방문과 전화로 안부를 확인합니다.");
  assert.equal(article.applicationConditions, "홀몸 어르신");
  assert.equal(article.conditionsBasis, "관리자가 확인한 지원대상 기준");
  assert.deepEqual(article.adminSource, { title: "강릉시 보도자료", url: "https://www.gn.go.kr/news/1" });
});
