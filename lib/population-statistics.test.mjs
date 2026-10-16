import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POPULATION_SNAPSHOT } from "./statistics/population-verified.ts";
import { POPULATION_DATASETS, POPULATION_REGION_COUNT, POPULATION_REVISION, POPULATION_VERIFIED_AT } from "./statistics/population.ts";
import { verifiedStatistics } from "./statistics/catalog.ts";
import { filterStatistics, getStatisticsData, resetStatisticsMemoryForTest } from "./statistics/read.ts";

const evidenceUrl = new URL("../docs/statistics/population-2026-09/", import.meta.url);
const evidence = JSON.parse(readFileSync(new URL("verified.json", evidenceUrl), "utf8"));
const sourceFiles = {
  age: "mois-age-202609.web.txt",
  elderly: "mois-elderly-202609.web.txt",
  children: "mois-child-202609.web.txt",
};
const sourceUrls = {
  age: "https://jumin.mois.go.kr/ageStatMonth.do",
  elderly: "https://jumin.mois.go.kr/etcStatOldAge.do",
  children: "https://jumin.mois.go.kr/etcStatChYouth.do",
};
const sourceText = Object.fromEntries(Object.entries(sourceFiles).map(([key, file]) => [key, readFileSync(new URL(file, evidenceUrl), "utf8")]));
const groupContracts = [
  { id: "population:middle-aged", key: "middleAged", min: 40, max: 64, sources: [sourceUrls.age, sourceUrls.elderly] },
  { id: "population:older", key: "elderly", min: 65, max: null, sources: [sourceUrls.elderly] },
  { id: "population:children", key: "children", min: 0, max: 17, sources: [sourceUrls.children] },
];

/** Parse the preserved official rows directly; never use the generated snapshot as an oracle. */
function parseSourceRows(text, expectedColumns, codePattern) {
  const rows = [];
  for (const line of text.split("\n")) {
    const match = /^L\d+: (\d+)\s*\|\s*([^|]+)\|(.+)$/.exec(line);
    if (!match) continue;
    assert.match(match[1], codePattern, "원문 지역 식별값 형식");
    const cells = match[3].split("|").map(cell => cell.trim());
    assert.equal(cells.length, expectedColumns, match[2]);
    const values = cells.map(cell => {
      assert.match(cell, /^\d{1,3}(?:,\d{3})*$|^\d+$/, "결측·문자·잘못된 숫자 형식은 숫자로 대체하지 않는다");
      const value = Number(cell.replaceAll(",", ""));
      assert.ok(Number.isSafeInteger(value) && value >= 0);
      return value;
    });
    rows.push({ code: match[1], name: match[2].trim(), values });
  }
  assert.equal(rows.length, 17, "전국과 16개 시도 전부 있어야 한다");
  assert.equal(new Set(rows.map(row => row.name)).size, 17);
  assert.equal(new Set(rows.map(row => row.code)).size, 17);
  return rows;
}

const ageRows = parseSourceRows(sourceText.age, 39, /^\d{10}$/);
const elderlyRows = parseSourceRows(sourceText.elderly, 6, /^\d{1,2}$/);
const childRows = parseSourceRows(sourceText.children, 12, /^\d{1,2}$/);
const sum = values => values.reduce((total, value) => total + value, 0);
const sexObject = ([total, male, female]) => ({ total, male, female });

test("인구 원문 추출물3종은 보존 해시·2026년9월·실제 연령 구간을 유지한다", () => {
  assert.equal(evidence.period, "2026-09");
  assert.equal(evidence.referenceDate, "2026-09-30");
  assert.equal(evidence.ageBasis, "만 나이");
  assert.equal(evidence.ageDefinitionSource, "https://kosis.kr/civilComplaint/qnaDetail.do?boardIdx=22124");
  for (const [key, file] of Object.entries(sourceFiles)) {
    const descriptor = evidence.sources.find(source => source.url === sourceUrls[key]);
    assert.ok(descriptor, key);
    assert.equal(descriptor.preservedPath, "docs/statistics/population-2026-09/" + file);
    assert.match(descriptor.representation, /extracted text.*not original HTML/);
    assert.equal(createHash("sha256").update(sourceText[key], "utf8").digest("hex"), descriptor.sha256, file);
    assert.match(sourceText[key], /행정기관코드\s*\|\s*행정기관\s*\|\s*2026년 09월/);
    assert.doesNotMatch(sourceText[key], /행정기관코드\s*\|\s*행정기관\s*\|\s*2026년 10월/);
  }
  assert.match(sourceText.age, /0-9세\s*\|\s*10-19세\s*\|\s*20-29세\s*\|\s*30-39세/);
  assert.match(sourceText.elderly, /65세이상/);
  assert.match(sourceText.children, /아동\(0 ~ 17세\)/);
  assert.match(sourceText.children, /18세 미만인 사람/);
  assert.match(sourceText.age, /거주불명자.*재외국민.*외국인은 제외/);
});

test("원문17행을 독립 재계산하면 보존JSON과 운영 인구 확인본의 모든 수치·코드가 일치한다", () => {
  assert.deepEqual(POPULATION_SNAPSHOT, evidence);
  assert.equal(evidence.records.length, 17);
  const actualCodes = evidence.records.map(row => row.regionCode);
  assert.deepEqual(actualCodes, ageRows.map(row => row.code));
  for (const row of ageRows) {
    const a = row.values;
    const e = elderlyRows.find(item => item.name === row.name)?.values;
    const c = childRows.find(item => item.name === row.name)?.values;
    const saved = evidence.records.find(item => item.regionCode === row.code);
    assert.ok(e && c && saved, row.name);
    assert.equal(saved.region, row.name);
    assert.equal(saved.level, row.code === "0000000000" ? "national" : "sido");

    const total = [a[0], a[13], a[26]];
    assert.deepEqual(total, e.slice(0, 3), row.name + " 고령 원문 분모");
    assert.deepEqual(total, c.slice(0, 3), row.name + " 아동 원문 분모");
    assert.deepEqual(total, [saved.totalPopulation, saved.malePopulation, saved.femalePopulation]);
    assert.equal(total[0], total[1] + total[2]);
    for (let column = 0; column < 13; column++) assert.equal(a[column], a[column + 13] + a[column + 26], row.name + " 연령별 남녀 합");
    for (const offset of [0, 13, 26]) {
      assert.equal(a[offset], a[offset + 1], row.name + " 전체 연령구간");
      assert.equal(sum(a.slice(offset + 2, offset + 13)), a[offset], row.name + " 11개 연령구간 합");
    }

    const under40 = [0, 13, 26].map(offset => sum(a.slice(offset + 2, offset + 6)));
    const elderly = e.slice(3, 6);
    const children = c.slice(3, 6);
    const middle = total.map((value, sex) => value - under40[sex] - elderly[sex]);
    assert.deepEqual(saved.sourceAgeUnder40, sexObject(under40), row.name);
    assert.deepEqual(saved.middleAged, sexObject(middle), row.name + " 정확한40~64세 여집합");
    assert.deepEqual(saved.elderly, sexObject(elderly), row.name + "65세이상 원문");
    assert.deepEqual(saved.children, sexObject(children), row.name + "0~17세 원문");
    for (const values of [under40, elderly, children, middle]) {
      assert.ok(values.every(value => Number.isSafeInteger(value) && value >= 0));
      assert.equal(values[0], values[1] + values[2]);
    }
    for (const [sex, offset] of [0, 13, 26].entries()) {
      const ages60to64 = middle[sex] - a[offset + 6] - a[offset + 7];
      assert.ok(ages60to64 >= 0 && ages60to64 <= a[offset + 8], row.name + "60~64세는60~69세 이내");
      assert.ok(children[sex] <= a[offset + 2] + a[offset + 3], row.name + "아동은0~19세 이내");
    }
  }
});

test("16개 시도 합계가 전국과 일치하며 전국을 지역 합계에 중복하지 않는다", () => {
  assert.equal(POPULATION_REGION_COUNT, 16);
  for (const rows of [ageRows, elderlyRows, childRows]) {
    const national = rows.find(row => row.name === "전국");
    const provinces = rows.filter(row => row.name !== "전국");
    assert.equal(provinces.length, 16);
    for (const [column, value] of national.values.entries()) assert.equal(sum(provinces.map(row => row.values[column])), value, "원문 모든 수치열의 전국 합");
  }
  const national = evidence.records.find(row => row.level === "national");
  const provinces = evidence.records.filter(row => row.level === "sido");
  assert.equal(national.regionCode, "0000000000");
  assert.ok(provinces.every(row => /^\d{2}00000000$/.test(row.regionCode)));
  assert.equal(provinces.find(row => row.region === "전남광주통합특별시")?.regionCode, "1200000000");
  for (const key of ["totalPopulation", "malePopulation", "femalePopulation"]) assert.equal(sum(provinces.map(row => row[key])), national[key]);
  for (const group of ["middleAged", "elderly", "children", "sourceAgeUnder40"]) {
    for (const sex of ["total", "male", "female"]) assert.equal(sum(provinces.map(row => row[group][sex])), national[group][sex]);
  }
});

test("인구 데이터셋3종은 지역17개·동일월 전체인구 분모·연령정의·필요 원문을 모두 제공한다", () => {
  assert.equal(POPULATION_DATASETS.length, 3);
  assert.equal(POPULATION_VERIFIED_AT, evidence.checkedAt);
  for (const contract of groupContracts) {
    const dataset = POPULATION_DATASETS.find(item => item.id === contract.id);
    assert.ok(dataset, contract.id);
    assert.deepEqual(dataset.periods, [evidence.period]);
    assert.equal(dataset.original_unit, "명");
    assert.equal(dataset.series.length, 17);
    assert.equal(new Set(dataset.series.map(series => series.id)).size, 17);
    assert.equal(dataset.highlight_series_id, "region:0000000000");
    assert.deepEqual([dataset.population.age_min, dataset.population.age_max], [contract.min, contract.max]);
    assert.equal(dataset.population.reference_date, evidence.referenceDate);
    assert.equal(dataset.population.population_scope, evidence.coverage);
    assert.deepEqual(dataset.population.source_urls.map(source => source.url), contract.sources);
    assert.equal(dataset.source_url, contract.sources[0]);
    assert.match(dataset.note, /외국인은 제외/);
    assert.match(dataset.note, /분모.*같은 지역·월.*전체 연령/);
    assert.match(dataset.source_notes, /시·군·구.*다른 기준월.*포함하지/);

    for (const series of dataset.series) {
      const row = evidence.records.find(record => "region:" + record.regionCode === series.id);
      assert.ok(row, series.id);
      assert.equal(series.label, row.region);
      assert.deepEqual(series.region, { code: row.regionCode, name: row.region, level: row.level, parent_code: row.level === "national" ? null : "0000000000" });
      assert.equal(series.unit, "명");
      assert.deepEqual(series.points, [{ period: evidence.period, value: row[contract.key].total, raw: String(row[contract.key].total), status: "VALUE", total_population: row.totalPopulation }]);
      assert.ok(series.points[0].value <= series.points[0].total_population);
    }
  }
  assert.match(POPULATION_DATASETS.find(item => item.id === "population:middle-aged").population.calculation, /총인구.*0~39세.*65세 이상.*뺀/);
});

test("인구 데이터 auto·verified 조회는 인증키·외부요청 없이 동일 확인본을 반환한다", async () => {
  resetStatisticsMemoryForTest();
  let networkCalls = 0;
  const dependencies = { pace: false, fetcher: async () => { networkCalls++; throw new Error("인구 확인본은 외부요청을 해서는 안 됩니다"); } };
  for (const { id } of groupContracts) {
    for (const mode of ["auto", "verified"]) {
      const result = await getStatisticsData(id, { mode }, dependencies);
      assert.equal(result.state, "VERIFIED_SNAPSHOT");
      assert.equal(result.refresh_error, null);
      assert.equal(result.revision, POPULATION_REVISION);
      assert.equal(result.verified_at, evidence.checkedAt);
      assert.equal(result.checked_at, evidence.checkedAt);
      assert.deepEqual(result.available_periods, ["2026-09"]);
      assert.equal(result.dataset.series.length, 17);
      assert.deepEqual(result.dataset, POPULATION_DATASETS.find(dataset => dataset.id === id));
    }
  }
  assert.equal(networkCalls, 0);
});

test("연도필터는 월별2026-09를2026년에 포함하고 없는 연도는 빈 자료로 표시한다", () => {
  const full = verifiedStatistics("population:older");
  assert.ok(full);
  const original = JSON.stringify(full);
  for (const options of [{ from_year: 2026 }, { to_year: 2026 }, { from_year: 2026, to_year: 2026 }]) {
    const selected = filterStatistics(full, options);
    assert.deepEqual(selected.dataset.periods, ["2026-09"]);
    assert.ok(selected.dataset.series.every(series => series.points.length === 1 && series.points[0].period === "2026-09"));
  }
  for (const options of [{ to_year: 2025 }, { from_year: 2027 }, { from_year: 2025, to_year: 2025 }]) {
    const missing = filterStatistics(full, options);
    assert.deepEqual(missing.dataset.periods, []);
    assert.ok(missing.dataset.series.every(series => series.points.length === 0));
    assert.deepEqual(missing.available_periods, ["2026-09"]);
    assert.ok(missing.warnings.some(warning => /0을 뜻하지/.test(warning)));
  }
  assert.throws(() => filterStatistics(full, { from_year: 2026, to_year: 2025 }), /시작연도/);
  assert.throws(() => filterStatistics(full, { from_year: 2026.5 }), /정수/);
  assert.equal(JSON.stringify(full), original, "필터가 전체 확인본을 수정하면 안 된다");
});

test("지역series 필터는 제주 원문 값·지역분모를 유지하고 미수록 시군구를 전국으로 대체하지 않는다", async () => {
  resetStatisticsMemoryForTest();
  let networkCalls = 0;
  const dependencies = { pace: false, fetcher: async () => { networkCalls++; throw new Error("unexpected network"); } };
  const jeju = evidence.records.find(row => row.region === "제주특별자치도");
  for (const contract of groupContracts) {
    const result = await getStatisticsData(contract.id, { from_year: 2026, to_year: 2026, series_id: "region:5000000000" }, dependencies);
    assert.equal(result.dataset.series.length, 1);
    assert.equal(result.dataset.series[0].label, "제주특별자치도");
    assert.equal(result.dataset.series[0].points[0].value, jeju[contract.key].total);
    assert.equal(result.dataset.series[0].points[0].total_population, jeju.totalPopulation);
    assert.deepEqual(result.available_periods, ["2026-09"]);
    assert.equal(verifiedStatistics(contract.id).dataset.series.length, 17);
    await assert.rejects(getStatisticsData(contract.id, { series_id: "region:5013000000" }, dependencies), /해당 항목이 없습니다/);
  }
  assert.equal(networkCalls, 0);
});
