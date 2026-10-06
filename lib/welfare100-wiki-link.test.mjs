import assert from "node:assert/strict";
import test from "node:test";

import { indexWelfareByName, pickWelfareLink } from "./welfare100/wiki-link.ts";

const index = indexWelfareByName([
  { slug: "disability-activity-support", name: "장애인활동지원", org: "중앙부처", sido: "", sigungu: "" },
  { slug: "WLF00000718", name: "장애인활동지원", org: "지자체", sido: "경기도", sigungu: "" },
  { slug: "WLF00005706", name: "취약계층 세탁 및 짐보관 서비스", org: "지자체", sido: "서울특별시", sigungu: "강남구" },
]);

test("공백·문장부호만 다른 사업명은 같은 제도로 잇는다", () => {
  const match = pickWelfareLink(index, { name: "장애인 활동·지원", sido: "제주특별자치도", sigungu: "서귀포시", type: "전국" });
  assert.equal(match?.slug, "disability-activity-support");
});

test("전국 사업은 중앙부처 제도, 지역 사업은 가장 좁은 지역 제도를 고른다", () => {
  assert.equal(pickWelfareLink(index, { name: "장애인활동지원", sido: "경기도", sigungu: "포천시", type: "전국" })?.slug, "disability-activity-support");
  assert.equal(pickWelfareLink(index, { name: "장애인활동지원", sido: "경기도", sigungu: "포천시", type: "지역특화" })?.slug, "WLF00000718");
});

test("다른 지역의 지자체 제도와는 잇지 않는다", () => {
  assert.equal(pickWelfareLink(index, { name: "취약계층 세탁 및 짐보관 서비스", sido: "서울특별시", sigungu: "서초구", type: "지역특화" }), null);
  assert.equal(pickWelfareLink(index, { name: "취약계층 세탁 및 짐보관 서비스", sido: "서울특별시", sigungu: "강남구", type: "지역특화" })?.slug, "WLF00005706");
});
