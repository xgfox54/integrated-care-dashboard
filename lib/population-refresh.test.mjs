import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergePopulationPages, parsePopulationPage, PopulationParseError, POPULATION_PAGE_URLS } from "./statistics/population-refresh.ts";
import { buildPopulationDatasets, POPULATION_DATASETS } from "./statistics/population.ts";
import { POPULATION_SNAPSHOT } from "./statistics/population-verified.ts";

const kinds = ["age", "older", "children"];
const options = { now: "2026-10-10T08:00:00Z", minimumPeriod: "2026-09" };
const files = { age: "mois-age-202609.web.txt", older: "mois-elderly-202609.web.txt", children: "mois-child-202609.web.txt" };
const source = Object.fromEntries(kinds.map(kind => {
  const text = readFileSync(new URL("../docs/statistics/population-2026-09/" + files[kind], import.meta.url), "utf8");
  const lines = text.split("\n").filter(line => /^L\d+:/.test(line)).map(line => line.replace(/^L\d+:\s*/, ""));
  const dataStart = lines.findIndex(line => /^\d+\s*\|/.test(line));
  const headStart = lines.findIndex(line => /^행정기관코드\s*\|/.test(line));
  const headers = lines.slice(headStart, dataStart).filter(line => line.includes("|") && !line.startsWith("---")).map(line => line.split("|").map(cell => cell.trim()));
  const rows = lines.filter(line => /^\d+\s*\|/.test(line)).map(line => {
    const [code, name, ...values] = line.split("|").map(cell => cell.trim());
    return { code, name, values };
  });
  assert.equal(headers.length, 3);
  assert.equal(rows.length, 17);
  return [kind, { title: lines.find(line => /^행정동별 .*인구현황$/.test(line)), headers, rows }];
}));
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const th = (text, attrs = "") => `<th${attrs}>${escapeHtml(text)}</th>`;
const tr = cells => "<tr>" + cells.join("") + "</tr>";

/** Reconstructed HTML for testing only: actual preserved evidence is web-extracted
 * text. Spans reproduce that text's header hierarchy; this is not original HTML.
 * Numeric cells and labels are independently read from the three preserved sources.
 */
function htmlFixture(kind, { period = "2026-09", rows = source[kind].rows } = {}) {
  const { headers, title } = source[kind];
  const [year, month] = period.split("-");
  const width = source[kind].rows[0].values.length;
  const top = [th(headers[0][0], ' rowspan="3"'), th(headers[0][1], ' rowspan="3"'), th(`${year}년 ${month}월`, ` colspan="${width}"`)];
  const groups = kind === "age"
    ? headers[1].map(label => th(label, ' colspan="13"'))
    : headers[1].map((label, i) => th(label, i < 3 ? ' rowspan="2"' : ' colspan="3"'));
  const body = rows.map(row => tr([`<td>${escapeHtml(row.code)}</td>`, `<th scope="row">${escapeHtml(row.name)}</th>`, ...row.values.map(value => `<td>${escapeHtml(value)}</td>`)])).join("");
  return `<!doctype html><html lang="ko"><head><title>주민등록 인구통계</title></head><body><h2>${title}</h2><table><thead>${tr(top)}${tr(groups)}${tr(headers[2].map(label => th(label)))}</thead><tbody>${body}</tbody></table></body></html>`;
}
const stages = () => kinds.map(kind => parsePopulationPage(kind, htmlFixture(kind)));
const sourceNumbers = row => row.values.map(value => Number(value.replaceAll(",", "")));
function expectError(code, action) { assert.throws(action, error => error instanceof PopulationParseError && error.code === code); }
function changedRows(kind, change) { const rows = structuredClone(source[kind].rows); change(rows); return htmlFixture(kind, { rows }); }

test("공식 추출문에서 재구성한 표3종의 월·17개 지역·성별 수치를 정확히 보존한다", () => {
  for (const stage of stages()) {
    assert.equal(stage.period, "2026-09");
    assert.equal(stage.schema_version, 1);
    assert.equal(stage.source_url, POPULATION_PAGE_URLS[stage.kind]);
    assert.equal(stage.evidence.table_title, source[stage.kind].title);
    assert.equal(stage.evidence.period_label, "2026년 09월");
    assert.equal(stage.evidence.row_count, 17);
    assert.equal(stage.rows.length, 17);
    assert.equal(stage.evidence.numeric_headers.length, source[stage.kind].rows[0].values.length);
    for (const [index, row] of stage.rows.entries()) {
      assert.equal(row.name, source[stage.kind].rows[index].name);
      assert.equal(row.code, stage.kind === "age" ? source.age.rows[index].code : null, "고령·아동 원문의 0~16 행 번호를 행정기관코드로 오인하지 않는다");
      assert.deepEqual(row.values, sourceNumbers(source[stage.kind].rows[index]));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(stage)), stage, "D1 stage에는 원문 HTML 없이 JSON 직렬화가 가능하다");
    assert.ok(!JSON.stringify(stage).includes("<table"));
  }
});

test("검증3종을 함께 병합하면 51개 지역 관측값·분모·연령·출처가 기존 확인본과 일치한다", () => {
  const inputs = stages();
  const before = JSON.stringify(inputs);
  const result = mergePopulationPages(JSON.parse(before), options);
  assert.deepEqual(result, POPULATION_DATASETS);
  assert.deepEqual(buildPopulationDatasets(POPULATION_SNAPSHOT), POPULATION_DATASETS);
  assert.equal(JSON.stringify(inputs), before, "입력 stage는 변경하지 않는다");
  for (const [index, rawAge] of source.age.rows.entries()) {
    const a = sourceNumbers(rawAge);
    const older = sourceNumbers(source.older.rows[index]);
    const child = sourceNumbers(source.children.rows[index]);
    const under40 = a.slice(2, 6).reduce((total, value) => total + value, 0);
    const expected = [a[0] - under40 - older[3], older[3], child[3]];
    result.forEach((dataset, group) => {
      const series = dataset.series.find(series => series.region.code === rawAge.code);
      assert.equal(series.label, rawAge.name);
      assert.equal(series.points[0].value, expected[group]);
      assert.equal(series.points[0].total_population, a[0]);
    });
  }
  assert.equal(result[0].series.find(row => row.label === "전국").points[0].value, 20_073_399);
  assert.equal(result[1].series.find(row => row.label === "전국").points[0].value, 11_313_616);
  assert.equal(result[2].series.find(row => row.label === "전국").points[0].value, 6_514_409);
});

test("합성 월 변경은 모든 dataset의 기준월·말일·설명을 함께 갱신하며 윤년을 처리한다", () => {
  for (const [period, reference, now] of [["2026-10", "2026-10-31", "2026-11-02T08:00:00Z"], ["2028-02", "2028-02-29", "2028-03-02T08:00:00Z"]]) {
    const result = mergePopulationPages(kinds.map(kind => parsePopulationPage(kind, htmlFixture(kind, { period }))), { ...options, now });
    for (const dataset of result) {
      assert.deepEqual(dataset.periods, [period]);
      assert.equal(dataset.population.reference_date, reference);
      assert.ok(dataset.series.every(series => series.points[0].period === period));
      assert.ok(dataset.source_notes.includes(reference));
      assert.doesNotMatch(dataset.description + dataset.note + dataset.source_notes, /2026년 9월|2026-09-30|자동 갱신하지/);
    }
  }
});

test("미완결 원문·중복종류·월 불일치·월 회귀·미래 월은 통계3종 전체 갱신을 거절한다", () => {
  const input = stages();
  expectError("SOURCE_INCOMPLETE", () => mergePopulationPages(input.slice(0, 2), options));
  expectError("SOURCE_INCOMPLETE", () => mergePopulationPages([input[0], input[0], input[2]], options));
  expectError("SOURCE_PERIOD_MISMATCH", () => mergePopulationPages([input[0], input[1], parsePopulationPage("children", htmlFixture("children", { period: "2026-08" }))], options));
  expectError("SOURCE_PERIOD_REGRESSION", () => mergePopulationPages(input, { ...options, minimumPeriod: "2026-10" }));
  expectError("SOURCE_FUTURE_PERIOD", () => mergePopulationPages(input, { ...options, now: "2026-09-30T14:59:59Z" }));
  assert.equal(mergePopulationPages(input, { ...options, now: "2026-09-30T15:00:00Z" }).length, 3, "KST에서 종료된 9월");
  expectError("SOURCE_FUTURE_PERIOD", () => mergePopulationPages(kinds.map(kind => parsePopulationPage(kind, htmlFixture(kind, { period: "2026-11" }))), options));
  expectError("INVALID_CHECK_TIME", () => mergePopulationPages(input, { ...options, now: "invalid" }));
  expectError("SOURCE_FORMAT_CHANGED", () => mergePopulationPages(input, { ...options, minimumPeriod: "2026-13" }));
});

test("숫자 수가 맞아도 성별·연령 헤더·월 헤더·표 제목이 달라지면 승인하지 않는다", () => {
  for (const [kind, from, to] of [
    ["age", '<th colspan="13">남</th>', '<th colspan="13">여</th>'],
    ["age", "0-9세", "0-8세"],
    ["older", "65세이상", "60세이상"],
    ["children", "아동(0 ~ 17세)", "아동(0 ~ 18세)"],
    ["children", '<th rowspan="2">남자</th>', '<th rowspan="2">여자</th>'],
    ["age", "2026년 09월", "2026년 13월"],
    ["age", "2026년 09월", "2026년 08월 ~ 09월"],
    ["older", source.older.title, "다른 인구 표"],
  ]) expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage(kind, htmlFixture(kind).replace(from, to)));
});

test("표 구조 변경·중복 표·없는 표·너무 큰 원문과 실행코드 속 표는 거절한다", () => {
  const valid = htmlFixture("age");
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", valid.replace('colspan="39"', 'colspan="38"')));
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", valid.replace('rowspan="3"', 'rowspan="4"')));
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", valid.replace('rowspan="3"', 'rowspan="unknown"')));
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", valid + valid));
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", "<h2>인구 현황 확인 중</h2>"));
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", "<script>" + valid + "</script>"));
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", "<!--" + valid + "-->"));
  expectError("SOURCE_TOO_LARGE", () => parsePopulationPage("age", " ".repeat(2_000_001)));
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("age", valid.replace("</table>", "")));
});

test("17개 지역 누락·중복·알 수 없는 지역·잘못 매핑된 공식 코드와 표시 행 번호를 거절한다", () => {
  for (const kind of kinds) {
    expectError("SOURCE_REGION_MISMATCH", () => parsePopulationPage(kind, changedRows(kind, rows => { rows.pop(); })));
    expectError("SOURCE_REGION_MISMATCH", () => parsePopulationPage(kind, changedRows(kind, rows => { rows[16].name = rows[15].name; })));
    expectError("SOURCE_REGION_MISMATCH", () => parsePopulationPage(kind, changedRows(kind, rows => { rows[16].name = "알수없는지역"; })));
  }
  expectError("SOURCE_REGION_MISMATCH", () => parsePopulationPage("age", changedRows("age", rows => { rows[16].code = "4900000000"; })));
  expectError("SOURCE_REGION_MISMATCH", () => parsePopulationPage("age", changedRows("age", rows => { rows[16].code = "16"; })));
  expectError("SOURCE_REGION_MISMATCH", () => parsePopulationPage("older", changedRows("older", rows => { rows[16].code = "15"; })));
  const officialOlder = changedRows("older", rows => rows.forEach((row, index) => { row.code = source.age.rows[index].code; }));
  assert.equal(parsePopulationPage("older", officialOlder).rows[16].code, "5000000000");
});

test("결측·음수·소수·잘못된 쉼표·열 누락은 0으로 대체하지 않고 거절한다", () => {
  for (const invalid of ["-", "", "-1", "1.5", "1,23", "1e5", "NaN", "Infinity", "9,007,199,254,740,992", "1 234"]) {
    expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("older", changedRows("older", rows => { rows[1].values[3] = invalid; })));
  }
  expectError("SOURCE_FORMAT_CHANGED", () => parsePopulationPage("children", changedRows("children", rows => { rows[4].values.pop(); })));
});

test("남녀·연령 합계·전국과 시도 합계를 각각 다시 계산하여 잘못된 원문을 거절한다", () => {
  expectError("SOURCE_TOTAL_MISMATCH", () => parsePopulationPage("older", changedRows("older", rows => { rows[1].values[3] = "1"; })));
  expectError("SOURCE_TOTAL_MISMATCH", () => parsePopulationPage("age", changedRows("age", rows => {
    rows[1].values[2] = String(sourceNumbers(rows[1])[2] + 1);
    rows[1].values[15] = String(sourceNumbers(rows[1])[15] + 1);
  })));
  expectError("SOURCE_TOTAL_MISMATCH", () => parsePopulationPage("older", changedRows("older", rows => {
    const values = sourceNumbers(rows[0]);
    for (const [column, increment] of [[3, 2], [4, 1], [5, 1]]) rows[0].values[column] = String(values[column] + increment);
  })));
});

test("개별 표 합계가 맞아도 세 원문의 분모·연령 포함 관계가 다르면 병합하지 않는다", () => {
  const input = stages();
  const denominator = structuredClone(input);
  for (const row of [denominator[1].rows[0], denominator[1].rows[1]]) {
    row.values[0] += 2; row.values[1] += 1; row.values[2] += 1;
  }
  expectError("SOURCE_TOTAL_MISMATCH", () => mergePopulationPages(denominator, options));
  const impossibleMiddle = structuredClone(input);
  for (const row of impossibleMiddle[1].rows) row.values.splice(3, 3, 0, 0, 0);
  expectError("SOURCE_TOTAL_MISMATCH", () => mergePopulationPages(impossibleMiddle, options));
  const impossibleChildren = structuredClone(input);
  for (const row of impossibleChildren[2].rows) row.values.splice(3, 3, ...row.values.slice(0, 3));
  expectError("SOURCE_TOTAL_MISMATCH", () => mergePopulationPages(impossibleChildren, options));
});

test("D1에서 복원한 stage의 스키마·출처·헤더 근거·수치도 재검증한다", () => {
  for (const [code, change] of [
    ["SOURCE_FORMAT_CHANGED", input => { input[0].schema_version = 2; }],
    ["SOURCE_FORMAT_CHANGED", input => { input[0].source_url = "https://example.com/ageStatMonth.do"; }],
    ["SOURCE_FORMAT_CHANGED", input => { input[0].evidence.numeric_headers[2] = "계/0-17세"; }],
    ["SOURCE_FORMAT_CHANGED", input => { input[0].evidence.period_label = "2026년 08월"; }],
    ["SOURCE_FORMAT_CHANGED", input => { input[0].rows[1].values[0] = null; }],
    ["SOURCE_REGION_MISMATCH", input => { input[1].rows[1].code = "1"; }],
    ["SOURCE_REGION_MISMATCH", input => { input[2].evidence.row_count = 16; }],
    ["SOURCE_TOTAL_MISMATCH", input => { input[2].rows[0].values[3] += 1; }],
  ]) {
    const input = structuredClone(stages());
    change(input);
    expectError(code, () => mergePopulationPages(input, options));
  }
});

test("인라인 태그·HTML 숫자 엔티티와 바깥 레이아웃 표를 처리하고 네트워크를 호출하지 않는다", () => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("순수 인구 파서는 네트워크를 호출하면 안 됩니다."); };
  try {
    const html = htmlFixture("age").replace("총 인구수", "총<br>인구수").replace("51,082,431", "51&#44;082&#44;431");
    const wrapped = "<table><tr><td>" + html + "</td></tr></table>";
    assert.deepEqual(parsePopulationPage("age", wrapped), parsePopulationPage("age", htmlFixture("age")));
    assert.equal(mergePopulationPages(stages(), options).length, 3);
  } finally { globalThis.fetch = priorFetch; }
});
