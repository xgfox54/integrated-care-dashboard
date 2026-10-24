import assert from "node:assert/strict";
import test from "node:test";
import { statisticsComparisonCsv } from "./statistics/csv.ts";
import { statisticsComparisonGroups } from "./statistics/comparison.ts";
import { verifiedStatistics } from "./statistics/catalog.ts";

function parseCsv(csv) {
  const rows = []; let row = [], text = "", quoted = false;
  const body = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '"') {
      if (quoted && body[i + 1] === '"') { text += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(text); text = ""; }
    else if (char === "\r" && body[i + 1] === "\n" && !quoted) { row.push(text); rows.push(row); row = []; text = ""; i++; }
    else text += char;
  }
  row.push(text); rows.push(row);
  return rows;
}

test("비교 CSV는 선택한 지역·항목·기간만 화면 순서대로 내보내고 출처와 확인시각을 보존한다", () => {
  const result = verifiedStatistics("kosis:basic-livelihood");
  const group = statisticsComparisonGroups(result.dataset)[0];
  const csv = statisticsComparisonCsv(result, group.id, ["row-52", "row-4"], "2025", "2025");
  const [header, ...rows] = parseCsv(csv);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(header.length, 14);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row[2], row[3], row[6]]), [["서울특별시", "2025", "명"], ["제주특별자치도", "2025", "명"]]);
  for (const row of rows) {
    const series = group.regions.find(region => region.name === row[2]).series;
    assert.equal(row[4], String(series.points.find(point => point.period === "2025").value));
    assert.equal(row[8], series.label);
    assert.equal(row[10], series.source_url);
    assert.equal(row[11], result.checked_at);
    assert.equal(row[13], result.dataset.note);
  }
  for (const [id, ids, from, to] of [[group.id, [], "", ""], ["unknown", ["row-1"], "", ""], [group.id, ["unknown"], "", ""], [group.id, ["row-1"], "2025", "2024"], [group.id, ["row-1"], "2027", "2028"]]) assert.equal(statisticsComparisonCsv(result, id, ids, from, to), null);
});

test("비교 CSV의 결측·비공개는 빈 숫자와 상태를 유지하고 0으로 바꾸지 않는다", () => {
  const result = structuredClone(verifiedStatistics("kosis:basic-livelihood"));
  const series = result.dataset.series.find(row => row.id === "row-52");
  series.points = [
    { period: "2021", value: 123, raw: "123p", status: "PROVISIONAL" },
    { period: "2022", value: null, raw: "-", status: "MISSING" },
    { period: "2024", value: 999, raw: "X", status: "CONFIDENTIAL" },
    { period: "2025", value: 125, raw: "125e", status: "ESTIMATE" },
  ];
  const group = statisticsComparisonGroups(result.dataset)[0];
  const [, ...rows] = parseCsv(statisticsComparisonCsv(result, group.id, [series.id], "2021", "2025"));
  assert.deepEqual(rows.map(row => [row[3], row[4], row[7]]), [["2025", "125", "추정치"], ["2024", "", "비공개"], ["2023", "", "자료 없음"], ["2022", "", "자료 없음"], ["2021", "123", "잠정치"]]);
});

test("비교 CSV는 수식 시작 문자를 보호하고 따옴표·줄바꿈을 보존한다", () => {
  const result = structuredClone(verifiedStatistics("kosis:basic-livelihood"));
  result.dataset.title = "  =1+1";
  result.dataset.source_name = "@SUM(1,2)";
  result.dataset.note = '주석 "인용"\n다음 줄';
  const group = statisticsComparisonGroups(result.dataset)[0];
  const [, row] = parseCsv(statisticsComparisonCsv(result, group.id, ["row-1"]));
  assert.equal(row[0], "'  =1+1");
  assert.equal(row[9], "'@SUM(1,2)");
  assert.equal(row[13], result.dataset.note);
  assert.equal(row.length, 14);
});

test("인구 CSV는 연령·기준일·집계 범위를 보존하고 과거 시점을 생성하지 않는다", () => {
  const result = verifiedStatistics("population:children");
  const group = statisticsComparisonGroups(result.dataset)[0];
  const [, ...rows] = parseCsv(statisticsComparisonCsv(result, group.id, group.regions.slice(0, 2).map(row => row.series.id)));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row[3] === result.dataset.periods[0] && row[12] === result.dataset.population.reference_date && row[13] === result.dataset.population.population_scope));
});
