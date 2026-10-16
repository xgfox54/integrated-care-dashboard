import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { statisticsCatalog, statisticsStatus, searchStatistics, verifiedStatistics, STATISTICS_DATASETS } from "./statistics/catalog.ts";
import { parseStatisticValue, parseStatisticsHtml, filterStatistics, getStatisticsData, resetStatisticsMemoryForTest } from "./statistics/read.ts";

const basic = `<h1>기초생활보장 수급 현황</h1><p>[단위 : 천명, %]</p><table><thead><tr><th></th><th>2024</th><th>2025</th></tr></thead><tbody><tr><th>수급자 수</th><td>2,673</td><td>2,837</td></tr><tr><th>수급률</th><td>5.2</td><td>5.5</td></tr></tbody></table><p>출처: 보건복지부 (내부행정자료)</p><p>주석: 전국민 대비 기초생활보장수급자 수와 비율</p>`;

test("삭제된 정신장애 유병률을 제외하고 기존 항목 ID와 연결 범위를 유지한다", () => {
  const catalog = statisticsCatalog(), status = statisticsStatus();
  assert.deepEqual(["approved", "indicator", "portal"].map(kind => catalog.filter(row => row.kind === kind).length), [37,33,11]);
  assert.equal(new Set(catalog.map(row => row.id)).size, 85);
  assert.equal(status.indicators, 33);
  assert.ok(!catalog.some(row => row.id === "indicator:12" || row.dataset_id === "stat:1441"));
  assert.equal(catalog.find(row => row.id === "indicator:13").title, "항생제 및 주사제 처방률");
  assert.equal(catalog.filter(row => row.kind === "population").length, 4);
  assert.equal(status.connected_tables, 71); assert.equal(status.connected_series, 1112); assert.equal(status.verified_observations, 6255);
  assert.equal(searchStatistics({ kind: "indicator", data_only: true }).total, 33);
  assert.equal(searchStatistics({ query: "복지통계", kind: "indicator", data_only: true }).total, 33);
  assert.ok(searchStatistics({ query: "노인 복지시설", kind: "indicator" }).items.some(row => row.dataset_id === "stat:2766"));
  const fertility = catalog.find(row => row.title === "합계출산율"); assert.equal(fertility.data_available, true); assert.equal(verifiedStatistics(fertility.id).dataset.indicator_code, "1428");
  assert.ok(catalog.filter(row => row.kind !== "portal").every(row => row.data_available));
  assert.match(catalog.find(row => row.id === "approved:37").publication_schedule, /2030/);
  assert.equal(verifiedStatistics("https://evil.example/table"), null);
});

test("검증본의 모든 수치는 가져온 공식 Markdown 표의 원문 값과 일치하고 단위를 유지한다", () => {
  const evidence = JSON.parse(readFileSync(new URL("../docs/statistics/retrieved-2026-10-10.json", import.meta.url)));
  for (const dataset of STATISTICS_DATASETS.filter(dataset => !dataset.population && !dataset.kosis && !dataset.index_api && !dataset.official_report)) {
    const source = evidence.sources.find(row => row.url === dataset.source_url).text;
    const rows = source.split("\n").filter(row => row.startsWith("|")).map(row => row.split("|").slice(1,-1).map(cell => cell.trim()));
    const rawValues = rows.filter(row => row.length > dataset.periods.length && row.slice(0,-dataset.periods.length).some(Boolean) && !row.includes("---")).slice(0);
    for (const series of dataset.series) assert.ok(rawValues.some(row => JSON.stringify(row.slice(-dataset.periods.length)) === JSON.stringify(series.points.map(point => point.raw))), dataset.id + ":" + series.label);
    for (const series of dataset.series) for (const point of series.points) { assert.equal(parseStatisticValue(point.raw).value, point.value); assert.ok(dataset.periods.includes(point.period)); }
  }
  const basic = verifiedStatistics("stat:2760").dataset.series[0]; assert.equal(basic.unit, "천명"); assert.equal(basic.points.at(-1).value, 2837);
  const facilities = verifiedStatistics("stat:2766").dataset; assert.equal(facilities.series.find(s => s.id === facilities.highlight_series_id).points.at(-1).value, 97232);
  const health = verifiedStatistics("stat:1431").dataset; assert.equal(health.series[0].unit, "조원"); assert.equal(health.series[1].unit, "%"); assert.equal(health.series[0].points.at(-1).status, "PROVISIONAL");
  assert.equal(verifiedStatistics("stat:2767").dataset.series.find(s => s.label === "기업연계형").points.at(-1).value, null);
});

test("결측·비공개·0과 소수·천단위 구분 및 형식 오류", () => {
  for (const raw of ["-", "…", "", "—"]) assert.deepEqual(parseStatisticValue(raw), { raw, value: null, status: "MISSING" });
  assert.equal(parseStatisticValue("x").status, "CONFIDENTIAL");
  assert.equal(parseStatisticValue("0").value, 0); assert.equal(parseStatisticValue("2,837").value, 2837); assert.equal(parseStatisticValue("5.5").value, 5.5);
  for (const raw of ["2,83", "12억원", "NaN", "=1+2"]) assert.throws(() => parseStatisticValue(raw), /수치 형식/);
});

test("공식 HTML 표에서 연도·행별 단위를 읽고 단위나 항목 변경은 거절한다", () => {
  const expected = verifiedStatistics("stat:2760").dataset;
  const result = parseStatisticsHtml(basic, expected);
  assert.deepEqual(result.periods, ["2024", "2025"]); assert.deepEqual(result.series[0].points.map(p=>p.value), [2673,2837]); assert.equal(result.series[1].unit, "%");
  assert.throws(() => parseStatisticsHtml(basic.replace("천명", "명"), expected), /제목·단위/);
  assert.throws(() => parseStatisticsHtml(basic.replace("수급자 수", "다른 항목"), expected), /표 구조/);
  assert.throws(() => parseStatisticsHtml("<html>접근 차단</html>", expected));
});

test("병합된 시설 분류 셀을 펼쳐 소계와 하위 항목을 구분한다", () => {
  const expected = { ...verifiedStatistics("stat:2766").dataset, series: verifiedStatistics("stat:2766").dataset.series.slice(0,2) };
  const html = `<h1>노인복지시설 현황</h1><p>[단위 : 개소, 명]</p><table><tr><th colspan="2"></th><th>2024</th><th>2025</th></tr><tr><th rowspan="2">노인주거복지시설</th><th>소계</th><td>281</td><td>283</td></tr><tr><th>양로시설</th><td>166</td><td>171</td></tr></table><p>출처: 보건복지부</p><p>주석: 시설 종류별 현황</p>`;
  const result = parseStatisticsHtml(html, expected); assert.equal(result.series[1].label, "노인주거복지시설 / 양로시설"); assert.equal(result.series[1].points.at(-1).value, 171);
});

test("기간·항목 필터는 수록되지 않은 연도를 0으로 만들지 않는다", () => {
  const result = verifiedStatistics("stat:2760");
  const filtered = filterStatistics(result, { from_year: 2021, to_year: 2025, series_id: "row-1" }); assert.equal(filtered.dataset.series.length, 1); assert.equal(filtered.dataset.series[0].points.length, 5);
  const empty = filterStatistics(result, { from_year: 2030 }); assert.equal(empty.dataset.periods.length, 0); assert.ok(empty.warnings.some(w => w.includes("0을 뜻하지"))); assert.equal(empty.available_periods.at(-1), "2025");
  assert.throws(() => filterStatistics(result, { from_year: 2025, to_year: 2020 }), /시작연도/);
  assert.throws(() => filterStatistics(result, { series_id: "missing" }), /항목이 없습니다/);
});

test("공개 원문 조회 성공은 캐시되고 원문 응답에 비밀값을 포함하지 않는다", async () => {
  resetStatisticsMemoryForTest(); const calls = [];
  const fetcher = async url => { calls.push(url); return new Response(url.endsWith("robots.txt") ? "" : basic, { status: url.endsWith("robots.txt") ? 404 : 200 }); };
  const first = await getStatisticsData("stat:2760", {}, { fetcher, pace:false });
  assert.equal(first.state, "LIVE"); assert.equal(first.dataset.series[0].points.at(-1).value,2837); assert.match(first.revision,/^public-table:276001:/);
  const second = await getStatisticsData("stat:2760", { from_year:2025 }, { fetcher, pace:false }); assert.equal(second.state,"CACHED"); assert.equal(second.dataset.periods.length,1); assert.equal(calls.length,2);
  assert.ok(calls.every(url => url.startsWith("https://www.index.go.kr/") && !/apiKey|idntfcId|LAW_OC/.test(url)));
});

test("robots 거부·오류 때 원문을 호출하지 않고 확인본과 안전한 상태만 반환한다", async () => {
  for (const [status, body, expected] of [[200,"User-agent: *\nDisallow: /","ROBOTS_DISALLOWED"],[503,"sensitive upstream detail","ROBOTS_UNAVAILABLE"]]) {
    resetStatisticsMemoryForTest(); let calls=0;
    const result = await getStatisticsData("stat:2760", {}, { pace:false, fetcher:async () => { calls++; return new Response(body,{status}); } });
    assert.equal(calls,1); assert.equal(result.state,"SNAPSHOT_FALLBACK"); assert.equal(result.refresh_error,expected); assert.equal(result.dataset.series[0].points.at(-1).value,2837); assert.ok(!JSON.stringify(result).includes("sensitive"));
  }
});

test("알 수 없는 ID·잘못된 기간은 외부 요청 전에 거절하며 고정 확인본은 네트워크를 쓰지 않는다", async () => {
  resetStatisticsMemoryForTest(); let calls=0; const dependencies={pace:false,fetcher:async()=>{calls++;throw Error("must not call");}};
  await assert.rejects(getStatisticsData("https://evil.example",{},dependencies),/원문 안내/);
  await assert.rejects(getStatisticsData("stat:2760",{from_year:2027,to_year:2025},dependencies),/시작연도/);
  const result=await getStatisticsData("stat:2760",{mode:"verified"},dependencies);assert.equal(result.state,"VERIFIED_SNAPSHOT");assert.equal(calls,0);
});

test("robots 자리에 HTTP 200 HTML 오류가 와도 하루 동안 고정하지 않고 1시간 후 다시 확인한다", async t => {
  resetStatisticsMemoryForTest(); let clock=Date.now(); t.mock.method(Date,"now",()=>clock); let calls=0;
  const fetcher=async url=>{calls++;return url.endsWith("robots.txt") ? new Response(calls===1?"<html>temporary error</html>":"",{status:calls===1?200:404}) : new Response(basic);};
  const first=await getStatisticsData("stat:2760",{}, {fetcher,pace:false});assert.equal(first.refresh_error,"ROBOTS_UNAVAILABLE");
  clock+=2*60*60*1000;
  const second=await getStatisticsData("stat:2760",{}, {fetcher,pace:false});assert.equal(second.state,"LIVE");assert.equal(calls,3);
});


test("KOSIS 공개 통계표 값은 화면에서 확인한 원문 셀과 같고 결측을 0으로 바꾸지 않으며 원문을 다시 조회하지 않는다", async () => {
  const series = (id, label) => verifiedStatistics(id).dataset.series.find(row => row.label === label);
  const adoption = series("kosis:foster-adoption", "국내외 입양현황 · 계");
  assert.equal(adoption.unit, "명"); assert.equal(adoption.points.at(-1).period, "2025"); assert.equal(adoption.points.at(-1).value, 140);
  assert.equal(series("kosis:foster-adoption", "국내외 입양현황 · 국내").points[0].value, 546);
  const foster = series("kosis:foster-adoption", "가정위탁보호아동 현황 · 세대수 / 전년도말 위탁가정 유형 / 계");
  assert.equal(foster.unit, "세대"); assert.equal(foster.points.find(point => point.period === "2025").value, 7623);
  assert.equal(series("kosis:registered-disabled", "합계 / 계").points.at(-1).value, 2627761);
  for (const dataset of STATISTICS_DATASETS.filter(row => row.kosis)) for (const row of dataset.series) for (const point of row.points) {
    assert.equal(point.value === null, point.status === "MISSING" || point.status === "CONFIDENTIAL", dataset.id + " " + row.label + " " + point.period);
    if (point.raw === "-") assert.equal(point.value, null);
  }
  const catalog = statisticsCatalog();
  assert.equal(catalog.find(row => row.title === "가정위탁국내입양현황").dataset_id, "kosis:foster-adoption");
  assert.equal(catalog.find(row => row.kind === "indicator" && row.title === "장애인 현황").dataset_id, "stat:2768");
  assert.equal(catalog.filter(row => row.kind === "approved" && row.data_available).length, 37);
  resetStatisticsMemoryForTest(); let calls = 0;
  const result = await getStatisticsData("kosis:registered-disabled", { from_year: 2025 }, { pace: false, fetcher: async () => { calls++; throw Error("must not call"); } });
  assert.equal(calls, 0); assert.equal(result.state, "VERIFIED_SNAPSHOT"); assert.deepEqual(result.dataset.periods, ["2025"]);
});
