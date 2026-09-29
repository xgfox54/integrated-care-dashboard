// 공통 검색어 해석기 시험: 대시보드·WIKI(서버)와 복지제도100(브라우저)이 같은 규칙으로 찾는지.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  containsTerm,
  correctionFrom,
  effectiveSort,
  matchesSearch,
  namesForSuggestion,
  parseSearch,
  rebuildQuery,
  relevanceScore,
  searchableText,
  spacedVariants,
} from "./search-terms.ts";

const text = (value) => searchableText([value]);

test("& 와 띄어쓰기는 모두 포함(그리고)으로 읽는다", () => {
  const parsed = parseSearch("치매&방문 요양");
  assert.deepEqual(parsed.terms.map((term) => term.key), ["치매", "방문", "요양"]);
  assert.equal(matchesSearch(text("치매 환자 방문 요양"), parsed), true);
  assert.equal(matchesSearch(text("치매 환자 방문 간호"), parsed), false);
});

test("| 는 하나라도 포함(또는)이고, 그리고보다 먼저 묶인다", () => {
  const parsed = parseSearch("부산|울산 방문진료");
  assert.equal(parsed.terms.length, 2);
  assert.equal(matchesSearch(text("울산광역시 중구 방문진료"), parsed), true);
  assert.equal(matchesSearch(text("부산광역시 해운대구 방문진료"), parsed), true);
  assert.equal(matchesSearch(text("서울특별시 방문진료"), parsed), false);
  assert.equal(matchesSearch(text("울산광역시 식사 지원"), parsed), false);
  assert.equal(parsed.hasRegion, true);
  assert.equal(matchesSearch(text("식사 배달"), parseSearch("식사|목욕")), true);
});

test("글자 or(대소문자 무관)는 | 와 같고, 괄호로 묶은 검색어도 또는으로 찾는다", () => {
  const keys = (query) => parseSearch(query).terms.map((term) => (term.negated ? "-" : "") + term.key);
  assert.deepEqual(keys("노인 or 장애인"), ["노인|장애인"]);
  assert.deepEqual(keys("(노인) OR (장애인)"), ["노인|장애인"]);
  assert.deepEqual(keys("(노인)or(장애인) 방문"), ["노인|장애인", "방문"]);
  assert.deepEqual(keys("부산 or 울산 방문진료"), keys("부산|울산 방문진료"));
  assert.deepEqual(keys("(부산 방문진료) or (울산 방문진료)"), ["부산|울산", "방문진료"]);
  assert.deepEqual(keys("-(요양 or 간호) 돌봄"), ["-요양|간호", "돌봄"]);
  assert.deepEqual(keys("노인 or"), ["노인"]);
  assert.deepEqual(keys("시범사업(의과·한의)"), ["시범사업", "의과", "한의"]);
  const parsed = parseSearch("(노인) or (장애인)");
  assert.equal(matchesSearch(text("장애인 활동 지원"), parsed), true);
  assert.equal(matchesSearch(text("아동 돌봄"), parsed), false);
  assert.equal(rebuildQuery(parseSearch("노인 or 장애인 방문"), 1), "노인|장애인");
});

test("* 는 사이에 아무 글자나 와도 순서대로 들어 있으면 맞는다", () => {
  const parsed = parseSearch("노인*돌봄");
  assert.equal(matchesSearch(text("노인맞춤돌봄서비스"), parsed), true);
  assert.equal(matchesSearch(text("노인 맞춤 돌봄"), parsed), true);
  assert.equal(matchesSearch(text("돌봄 노인"), parsed), false);
  assert.deepEqual(parseSearch("돌봄*").terms.map((term) => term.alternatives), [["돌봄"]]);
});

test("-·! 로 시작하는 단어는 제외한다", () => {
  const parsed = parseSearch("돌봄 -요양");
  assert.equal(matchesSearch(text("일상 돌봄 지원"), parsed), true);
  assert.equal(matchesSearch(text("재가 요양 돌봄"), parsed), false);
  assert.equal(matchesSearch(text("재가 요양 돌봄"), parseSearch("돌봄 !요양")), false);
  assert.equal(matchesSearch(text("건강-돌봄통합지원"), parseSearch("건강-돌봄통합지원")), true);
  assert.equal(relevanceScore({ name: "요양 돌봄" }, parsed), relevanceScore({ name: "요양 돌봄" }, parseSearch("돌봄")));
});

test("* 검색어는 D1 LIKE 패턴 한도(50바이트)를 넘으면 * 없이 이어 붙인 말로 찾는다", () => {
  assert.deepEqual(parseSearch("가나다라마바사아자차카타파하거너*더러").terms[0].alternatives, ["가나다라마바사아자차카타파하거너더러"]);
  assert.deepEqual(parseSearch("가나다라마바사아자차카타*파하").terms[0].alternatives, ["가나다라마바사아자차카타*파하"]);
  assert.deepEqual(parseSearch("노인*맞춤*돌봄").terms[0].alternatives, ["노인*맞춤*돌봄"]);
});

test("연산자가 든 단어는 오타 고치기 대상이 아니고, 단어 빼기 검색어는 연산자를 지킨다", () => {
  const parsed = parseSearch("부산|울산 -요양 노인*돌봄 치매");
  assert.deepEqual(parsed.terms.map((term) => term.plain), [false, false, false, true]);
  assert.equal(rebuildQuery(parsed, 3), "부산|울산 -요양 노인*돌봄");
});

test("띄어쓰기로 갈린 한 글자씩은 이어 붙여 찾지 않는다(기동 ≠ 집보기 동행)", () => {
  const giDong = parseSearch("기동");
  assert.equal(matchesSearch(text("전월세 계약상담, 집보기 동행 등 지원"), giDong), false);
  assert.equal(matchesSearch(text("퇴원 후 회복기 동안 1개월 이내 요양원"), giDong), false);
  assert.equal(matchesSearch(text("우리동네 복지기동대"), giDong), true);
  assert.equal(matchesSearch(text("희망복지 기동대"), giDong), true);
  assert.equal(matchesSearch(text("생활민원 기동 처리반"), giDong), true);
});

test("두 글자 이상 조각이나 독립된 한 글자 단어는 띄어쓰기를 넘어 찾는다", () => {
  assert.equal(matchesSearch(text("보건의료 방문 진료 지원"), parseSearch("방문진료")), true);
  assert.equal(matchesSearch(text("퇴원 후 돌봄 지원"), parseSearch("퇴원후돌봄")), true);
  assert.equal(matchesSearch(text("1인 가구 안심 계약"), parseSearch("1인가구")), true);
  assert.equal(matchesSearch(text("치매 안심 센터 운영"), parseSearch("치매안심센터")), true);
  assert.equal(matchesSearch(text("집보기 동행 지원"), parseSearch("보기동행")), true);
  assert.equal(matchesSearch(text("운영방 문진료"), parseSearch("방문진료")), false);
});

test("검색어는 사업명·설명 같은 항목의 경계를 넘어 맞지 않는다", () => {
  assert.equal(matchesSearch(searchableText(["집보기", "동행 지원"]), parseSearch("기동")), false);
  assert.equal(matchesSearch(searchableText(["방문", "진료"]), parseSearch("방문진료")), false);
  assert.equal(matchesSearch(searchableText(["서울특별시", "강동구", "방문 진료"]), parseSearch("강동 방문진료")), true);
});

test("서버 SQL용 허용 모양 목록은 브라우저 판정과 같은 결과를 낸다", () => {
  const samples = [
    "전월세 계약상담, 집보기 동행 등 지원",
    "퇴원 후 회복기 동안 1개월 이내 요양원",
    "우리동네 복지 기동대 운영",
    "보건의료 방문 진료 재택 의료 센터",
    "퇴원 후 돌봄 및 사회 활동 지원",
    "a b cd e fg 노인 일자리 및 사회활동",
  ].map((value) => searchableText(["서울특별시", value, "주거 지원"]));
  const keys = ["기동", "방문진료", "퇴원후돌봄", "회복기동안", "후돌봄", "및사회", "bcd", "cde", "일자리및사회활동", "지원주거", "특별시서울"];
  for (const sample of samples) {
    for (const key of keys) {
      assert.equal(spacedVariants(key).some((form) => sample.includes(form)), containsTerm(sample, key), key + " @ " + sample);
    }
  }
});

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
