// 공통 검색어 해석기 시험: 대시보드·WIKI(서버)와 복지제도100(브라우저)이 같은 규칙으로 찾는지.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  correctionFrom,
  effectiveSort,
  matchesSearch,
  namesForSuggestion,
  parseSearch,
  rebuildQuery,
  relevanceScore,
} from "./search-terms.ts";

const text = (value) => value.replace(/\s+/g, "").toLowerCase();

test("지역과 주제를 함께 치면 두 단어가 모두 든 사업을 찾는다(순서·띄어쓰기 무관)", () => {
  const busan = text("부산광역시 해운대구 보건의료 방문진료 재택의료센터");
  assert.equal(matchesSearch(busan, parseSearch("부산 방문진료")), true);
  assert.equal(matchesSearch(busan, parseSearch("방문 진료 부산")), true);
  assert.equal(matchesSearch(busan, parseSearch("해운대 방문진료")), true);
  assert.equal(matchesSearch(text("서울특별시 방문진료"), parseSearch("부산 방문진료")), false);
});

test("시도 약칭은 정식 이름까지 함께 찾고, 전국 공통 항목은 지역어를 따지지 않을 수 있다", () => {
  const parsed = parseSearch("경북 치매");
  assert.deepEqual(parsed.terms.map((term) => [term.key, term.region]), [["경북", true], ["치매", false]]);
  assert.equal(matchesSearch(text("경상북도 안동시 치매안심센터"), parsed), true);
  assert.equal(matchesSearch(text("충청북도 치매안심센터"), parseSearch("충북 치매")), true);
  assert.equal(matchesSearch(text("중앙부처 치매검사비 지원"), parsed), false);
  assert.equal(matchesSearch(text("중앙부처 치매검사비 지원"), parsed, { ignoreRegion: true }), true);
  assert.equal(parseSearch("부산 방문진료").hasRegion, true);
  assert.equal(parseSearch("노인 돌봄").hasRegion, false);
});

test("지역 이름과 같은 일반어(영양·장수·고령 등)는 보통 단어로 찾고, 이름을 다 치면 지역어로 본다", () => {
  const nutrition = parseSearch("영양 지원");
  assert.equal(nutrition.hasRegion, false);
  assert.equal(matchesSearch(text("중앙부처 저소득층 영양 지원"), nutrition, { ignoreRegion: true }), true);
  assert.equal(matchesSearch(text("중앙부처 기초연금 지원"), nutrition, { ignoreRegion: true }), false);
  assert.equal(matchesSearch(text("경상북도 영양군 영양 지원"), nutrition), true);
  assert.equal(parseSearch("장수 수당").hasRegion, false);
  assert.equal(parseSearch("고령 어르신").hasRegion, false);
  assert.equal(parseSearch("영양군 돌봄").hasRegion, true);
  assert.equal(parseSearch("해운대 돌봄").hasRegion, true);
  assert.equal(parseSearch("수원 돌봄").hasRegion, true);
});

test("군더더기 말은 빼고 찾고, 모두 군더더기 말이면 그대로 찾는다", () => {
  assert.deepEqual(parseSearch("퇴원 후 돌봄").terms.map((term) => term.key), ["퇴원", "돌봄"]);
  assert.deepEqual(parseSearch("동행 서비스").terms.map((term) => term.key), ["동행"]);
  assert.deepEqual(parseSearch("서비스").terms.map((term) => term.key), ["서비스"]);
  assert.deepEqual(parseSearch("  ").terms, []);
  assert.deepEqual(parseSearch("「치매」 검사,").terms.map((term) => term.key), ["치매", "검사"]);
});

test("관련도: 사업명 일치가 분류·설명 일치보다 앞선다", () => {
  const parsed = parseSearch("방문 진료");
  const exact = relevanceScore({ name: "방문진료" }, parseSearch("방문진료"));
  const inName = relevanceScore({ name: "재택 방문진료 사업" }, parsed);
  const inCategory = relevanceScore({ name: "건강백세 운동교실", category: "방문 진료" }, parsed);
  const elsewhere = relevanceScore({ name: "건강백세 운동교실", category: "건강관리" }, parsed);
  assert.ok(exact > inName && inName > inCategory && inCategory > elsewhere, [exact, inName, inCategory, elsewhere].join(","));
  assert.equal(effectiveSort("", "치매"), "relevance");
  assert.equal(effectiveSort("", ""), "region");
  assert.equal(effectiveSort("relevance", ""), "region");
  assert.equal(effectiveSort("name", "치매"), "name");
});

test("0건 도움말: 오타는 자료에 여러 번 나온 한 글자 차이 말로 고치고, 단어를 하나씩 뺀 검색어를 만든다", () => {
  const names = namesForSuggestion(["치매안심센터", "치매 검사비 지원", "치매관리", "치과 진료", "방문진료", "방문진료 사업"]);
  assert.equal(correctionFrom("치메", names), "치매");
  assert.equal(correctionFrom("방뭉진료", names), "방문진료");
  assert.equal(correctionFrom("ab", names), null);
  assert.equal(correctionFrom("쿼카", names), null);
  // 치료가 더 많이 나와도 자모가 가까운 치매를 고른다.
  const welfareNames = namesForSuggestion(["치료비 지원", "의료급여 치료", "치료재료", "재활 치료", "치매검사비", "치매공공후견"]);
  assert.equal(correctionFrom("치메", welfareNames), "치매");
  const parsed = parseSearch("서울 해운대 방문진료");
  assert.equal(rebuildQuery(parsed, 0), "해운대 방문진료");
  assert.equal(rebuildQuery(parseSearch("치메 검사"), 0, "치매"), "치매 검사");
});
