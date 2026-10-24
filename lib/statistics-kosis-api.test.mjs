import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { verifiedStatistics } from "./statistics/catalog.ts";
import { kosisApiUrl, kosisFrequency, kosisSelection, parseKosisApi, mergeKosisParts } from "./statistics/kosis-api.ts";
import { runStatisticsRefresh } from "./statistics/background.ts";
import { readCurrentStatistics, readCurrentStatisticsSnapshots } from "./statistics/store.ts";
import { fetchSource } from "./statistics/refresh-source.ts";
import { statisticsRefreshLabel, statisticsRefreshReason } from "./statistics/refresh-status.ts";

const NOW = Date.parse("2026-10-17T01:00:00Z");
const base = verifiedStatistics("kosis:basic-livelihood").dataset;
const table = base.kosis.tables[0];

test("자동 확인 상태는 이어받기·재시도·실행 중을 구별하고 실패 이유를 설명한다", () => {
  // Given a saved checkpoint after a source timeout.
  const refresh = { enabled: true, interval_hours: 24, last_attempt_at: null, last_success_at: null, next_check_at: null, continuation_pending: true, error_code: "SOURCE_TIMEOUT" };
  // When the shared status formatter receives waiting and running states.
  const labels = ["idle", "retry_wait", "checking", "unavailable", "current"].map(status => statisticsRefreshLabel({ ...refresh, status }));
  // Then stale checkpoint state cannot claim an active check, and the reason never renders upstream text.
  assert.deepEqual(labels, ["이어받기 대기", "재시도 대기", "확인 중", "확인 불가", "정상"]);
  assert.match(statisticsRefreshReason(refresh.error_code), /응답이 늦어/);
  assert.equal(statisticsRefreshReason(null), null);
  assert.doesNotMatch(statisticsRefreshReason("unknown-private-url"), /unknown-private-url/);
});

test("KOSIS 시간 초과는 실패한 조회 단계만 기록하고 다음 실행에서 메타데이터를 이어받는다", async t => {
  // Given a table whose item metadata fails after frequency metadata succeeds.
  const db = database(); t.after(() => db.sqlite.close());
  let clock = NOW;
  const requests = [];
  let failItems = true;
  const run = () => runStatisticsRefresh(db, { scopeId: base.id, force: true, maxSteps: 1, timeoutMs: 20,
    now: () => clock, sleep: async ms => { clock += ms; }, readKosisKey: async () => "fixture-private-key",
    fetcher: async url => {
      const type = new URL(url).searchParams.get("type"); requests.push(type ?? "DATA");
      if (type === "ITM" && failItems) return new Promise(() => {});
      return new Response(type === "PRD" ? '[{"PRD_SE":"년"}]' : type === "ITM" ? JSON.stringify(metadata()) : JSON.stringify(rows()));
    } });
  // When the first check fails, then a later check succeeds.
  const failed = await run();
  const waiting = await readCurrentStatistics(db, base.id, {}, clock);
  const saved = db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get(base.id);
  failItems = false;
  clock += 5000;
  const resumed = await run();
  // Then the checkpoint is reused without partial publication or credentials in failure details.
  assert.equal(failed.failed, 1);
  assert.equal(waiting.auto_refresh.status, "retry_wait");
  assert.equal(waiting.auto_refresh.continuation_pending, true);
  assert.match(saved.error_detail, /항목·분류 조회/);
  assert.doesNotMatch(saved.error_detail, /fixture-private-key|apiKey|https:/);
  assert.equal(saved.result_json, null);
  assert.equal(resumed.completed, 1);
  assert.deepEqual(requests, ["PRD", "ITM", "ITM", "DATA"]);
});
function rows(dataset = base, source = table, year = "2025") {
  return dataset.series.filter(series => series.source_url === source.url).map((series, i) => {
    const label = dataset.kosis.tables.length > 1 ? series.label.slice((source.title + " · ").length) : series.label;
    const parts = label.split(" / ");
    const point = series.points.at(-1);
    return { ORG_ID: source.org_id, TBL_ID: source.tbl_id, TBL_NM: source.title,
      ITM_ID: "fixture-item-" + i, ITM_NM: parts.at(-1), C1: "fixture-region-" + i, C1_NM: parts.length > 1 ? parts[0] : "소계",
      C1_OBJ_NM: "행정구역별", UNIT_NM: series.unit, PRD_SE: "Y", PRD_DE: year, DT: point.raw, LST_CHN_DE: "2026-09-15" };
  });
}
function metadata(dataset = base, source = table) {
  const data = rows(dataset, source);
  return data.flatMap(row => [
    { ORG_ID: source.org_id, TBL_ID: source.tbl_id, OBJ_ID: "ITEM", ITM_ID: row.ITM_ID, ITM_NM: row.ITM_NM, UNIT_NM: row.UNIT_NM },
    { ORG_ID: source.org_id, TBL_ID: source.tbl_id, OBJ_ID: "CLASS1", OBJ_ID_SN: "1", ITM_ID: row.C1, ITM_NM: row.C1_NM },
  ]);
}
test("KOSIS 원단위·항목·갱신일을 보존하고 API 코드가 응답 순서와 무관하게 같은 항목을 가리킨다", () => {
  const body = JSON.stringify(rows().reverse().map(row => ({ ...row, TBL_NM: row.TBL_NM.replaceAll(",", ""), PRD_SE: "A" })));
  const parsed = parseKosisApi(body, base, table, "Y", NOW);
  assert.equal(parsed.series[0].points.at(-1).value, 2836706);
  assert.equal(parsed.series[0].unit, "명");
  assert.equal(parsed.updated, "2026-09-15");
  assert.equal(parsed.series.length, 54);
  const merged = mergeKosisParts(base, [{ table: table.tbl_id, frequency: "Y", body: parsed.body }], NOW);
  assert.match(merged.note, /API/);
  assert.equal(merged.kosis.tables[0].updated_at, "2026-09-15");
  assert.ok(parsed.series.every(series => series.kosis_key));
});

test("전국 전용 표의 전체 행은 API의 같은 전체 분류와 대조하며 지역 상세값을 허용하지 않는다", () => {
  // Given the verified national production-facility series and a single API item descriptor.
  const expected = verifiedStatistics("kosis:sheltered-workshops").dataset;
  const source = expected.kosis.tables[0];
  const item = { ...rows(expected, source, "2024")[0], ITM_ID: "T", ITM_NM: source.title, C1: "00", C1_NM: "전체" };
  const selection = kosisSelection(JSON.stringify([
    { ORG_ID: source.org_id, TBL_ID: source.tbl_id, OBJ_ID: "ITEM", ITM_ID: "T", ITM_NM: source.title, UNIT_NM: "개" },
    { ORG_ID: source.org_id, TBL_ID: source.tbl_id, OBJ_ID: "REGION", OBJ_ID_SN: "1", ITM_ID: "00", ITM_NM: "전체" },
  ]), expected, source);
  // When the national response is parsed with its confirmed classification.
  const parsed = parseKosisApi(JSON.stringify([item]), expected, source, "Y", NOW, selection);
  // Then the original count and unit survive, and a regional response cannot stand in for the national total.
  assert.equal(parsed.series[0].points[0].value, 723);
  assert.equal(parsed.series[0].unit, "개");
  assert.throws(() => parseKosisApi(JSON.stringify([{ ...item, C1_NM: "서울특별시" }]), expected, source, "Y", NOW, selection));
});
test("KOSIS 단위·표·주기·코드 충돌·미지의 분류·부분 응답을 거절한다", () => {
  for (const mutate of [
    row => { row.UNIT_NM = "천명"; }, row => { row.TBL_ID = "other"; }, row => { row.PRD_SE = "M"; },
    row => { row.PRD_DE = "2027"; }, row => { row.C2 = "new"; row.C2_NM = "확인되지 않은 분류"; },
  ]) {
    const response = rows(); mutate(response[0]);
    assert.throws(() => parseKosisApi(JSON.stringify(response), base, table, "Y", NOW));
  }
  assert.throws(() => parseKosisApi(JSON.stringify(rows().slice(1)), base, table, "Y", NOW));
  assert.throws(() => parseKosisApi(JSON.stringify([...rows(), rows()[0]]), base, table, "Y", NOW));
});
test("KOSIS 통계부호는 결측·비밀·잠정·추정으로 유지한다", () => {
  const response = rows();
  ["-", "x", "123p)", "124e)"].forEach((value, i) => { response[i].DT = value; });
  const parsed = parseKosisApi(JSON.stringify(response), base, table, "Y", NOW);
  assert.deepEqual(parsed.series.slice(0, 4).map(series => [series.points[0].value, series.points[0].status]), [[null, "MISSING"], [null, "CONFIDENTIAL"], [123, "PROVISIONAL"], [124, "ESTIMATE"]]);
  assert.equal(kosisFrequency('[{"PRD_SE":"F","PRD_DE":"2023"}]'), "F");
  assert.equal(kosisFrequency('[{"PRD_SE":"년","STRT_PRD_DE":"2001","END_PRD_DE":"2025"}]'), "Y");
  assert.equal(kosisFrequency('[{"PRD_SE":"3년","STRT_PRD_DE":"2010","END_PRD_DE":"2025"}]'), "F");
  const selection = kosisSelection(JSON.stringify(metadata()), base, table);
  assert.equal(selection.omit_item_name, false);
  assert.equal(selection.items.length, 54);
});
test("통계표 안에서 항목별 수록연도가 다르면 빠진 연도는 0이나 이전 값으로 채우지 않는다", () => {
  const response = [...rows(base, table, "2024"), ...rows().slice(1)];
  const current = parseKosisApi(JSON.stringify(response), base, table, "Y", NOW);
  assert.deepEqual(current.series[0].points.map(point => [point.period, point.value, point.status]), [["2024", 2836706, "VALUE"], ["2025", null, "MISSING"]]);
  assert.equal(current.series[1].points.at(-1).period, "2025");
  assert.equal(current.series[1].points.at(-1).value, 2732235);
});
test("항목별 최근 두 시점만 검증해도 다른 항목의 오래된 정상 값을 결측으로 덮지 않는다", () => {
  const response = [...rows(base, table, "2024"), ...rows()];
  response[1].PRD_DE = "2018"; response[55].PRD_DE = "2019";
  const current = parseKosisApi(JSON.stringify(response), base, table, "Y", NOW);
  assert.deepEqual(current.series[0].points.map(point => point.period), ["2024", "2025"]);
  assert.deepEqual(current.series[1].points.map(point => [point.period, point.status]), [["2018", "VALUE"], ["2019", "VALUE"], ["2024", "MISSING"], ["2025", "MISSING"]]);
});
test("KOSIS 단일 항목의 설명명과 분류 코드를 확인해 웹 표의 행·열만 요청한다", () => {
  const expected = { ...base, series: base.series.slice(0, 1) };
  const descriptor = "국민기초생활 수급자 수";
  const body = JSON.stringify([
    { ORG_ID: "117", TBL_ID: table.tbl_id, OBJ_ID: "ITEM", ITM_ID: "T", ITM_NM: descriptor, UNIT_NM: "명" },
    { ORG_ID: "117", TBL_ID: table.tbl_id, OBJ_ID: "HJG", OBJ_ID_SN: "1", ITM_ID: "00", ITM_NM: "전국" },
    { ORG_ID: "117", TBL_ID: table.tbl_id, OBJ_ID: "TYPE", OBJ_ID_SN: "2", ITM_ID: "TT", ITM_NM: "계" },
  ]);
  const selection = kosisSelection(body, expected, table);
  assert.equal(selection.omit_item_name, true);
  const query = new URL(kosisApiUrl(table, "fixture", "Y", selection)).searchParams;
  assert.equal(query.get("itmId"), "T"); assert.equal(query.get("objL1"), "00"); assert.equal(query.get("objL2"), "TT");
  const row = { ...rows()[0], ITM_ID: "T", ITM_NM: descriptor, C1: "00", C2: "TT", C2_NM: "계" };
  assert.equal(parseKosisApi(JSON.stringify([row]), expected, table, "Y", NOW, selection).series[0].points[0].value, 2836706);
});
test("KOSIS 서버 키를 한 번 인코딩하고 등록하지 않은 원천 주소는 호출하지 않는다", async () => {
  const key = encodeURIComponent("fixture+key/only=");
  const url = kosisApiUrl(table, key, "Y");
  assert.equal(new URL(url).searchParams.get("apiKey"), "fixture+key/only=");
  let calls = 0;
  await assert.rejects(fetchSource(url.replace("DT_11714_N001", "UNKNOWN"), async () => { calls++; return new Response("[]"); }, 100, () => NOW));
  assert.equal(calls, 0);
});
test("KOSIS 복합 단위는 검증한 원표의 항목별 단위를 유지하며 다른 단위는 거절한다", () => {
  const expected = { ...base, original_unit: "%,점", series: [{ ...base.series[0], unit: "%" }] };
  const row = { ...rows()[0], DT: "38.2", UNIT_NM: "%점" };
  const current = parseKosisApi(JSON.stringify([row]), expected, table, "Y", NOW);
  assert.equal(current.series[0].unit, "%"); assert.equal(current.series[0].points[0].value, 38.2);
  assert.throws(() => parseKosisApi(JSON.stringify([{ ...row, UNIT_NM: "%천명" }]), expected, table, "Y", NOW));
});
test("API가 단위를 생략하면 공식표 원단위를 유지하고 단위 출처를 명시한다", () => {
  const expected = { ...base, series: base.series.slice(0, 1) };
  const current = parseKosisApi(JSON.stringify([{ ...rows()[0], UNIT_NM: "" }]), expected, table, "Y", NOW);
  assert.equal(current.series[0].unit, "명"); assert.equal(current.series[0].unit_source, "verified_table");
  assert.equal(current.series[0].points[0].value, 2836706);
});
test("단일 항목과 가상분류의 표는 코드·원단위를 확인하고 제목이 가리키는 한 계열을 갱신한다", () => {
  const expected = verifiedStatistics("kosis:retirement-panel").dataset, source = expected.kosis.tables[0];
  const meta = [
    { OBJ_ID: "ITEM", OBJ_NM: "항목", ITM_ID: "T001", ITM_NM: "비율" },
    { OBJ_ID: "CLASS1", OBJ_NM: "가상분류", OBJ_ID_SN: "1", ITM_ID: "DATA", ITM_NM: "데이터" },
  ].map(row => ({ ORG_ID: "322", TBL_ID: source.tbl_id, ...row }));
  const selection = kosisSelection(JSON.stringify(meta), expected, source);
  assert.deepEqual(selection.virtual_classes, ["1"]);
  const response = [{ ORG_ID: "322", TBL_ID: source.tbl_id, TBL_NM: source.title, ITM_ID: "T001", ITM_NM: "비율", C1: "DATA", C1_NM: "데이터", UNIT_NM: "%", PRD_SE: "A", PRD_DE: "2023", DT: "45" }];
  assert.equal(parseKosisApi(JSON.stringify(response), expected, source, "F", NOW, selection).series[0].points[0].value, 45);
});
test("소계 확인본은 이름이 같은 상세 분류 대신 상위 합계 코드를 선택한다", () => {
  const expected = verifiedStatistics("kosis:accessibility").dataset, source = expected.kosis.tables[0];
  const metadata = [
    { OBJ_ID: "ITEM", ITM_ID: "H004", ITM_NM: "설치율" },
    { OBJ_ID: "ITEM", ITM_ID: "H006", ITM_NM: "적정설치율" },
    ...expected.series.filter(series => series.id !== "row-25").map((series, i) => ({ OBJ_ID: "FACILITY", OBJ_ID_SN: "1", ITM_ID: "other" + i, ITM_NM: series.label.split(" / ")[0] })),
    { OBJ_ID: "FACILITY", OBJ_ID_SN: "1", ITM_ID: "A075", ITM_NM: "공장" },
    { OBJ_ID: "FACILITY", OBJ_ID_SN: "1", ITM_ID: "A076", ITM_NM: "공장", UP_ITM_ID: "A075" },
    { OBJ_ID: "TYPE", OBJ_ID_SN: "2", ITM_ID: "B001", ITM_NM: "계" },
  ].map(row => ({ ORG_ID: "117", TBL_ID: source.tbl_id, ...row }));
  const selection = kosisSelection(JSON.stringify(metadata), expected, source);
  assert.ok(selection.classes["1"].includes("A075")); assert.ok(!selection.classes["1"].includes("A076"));
});
test("KOSIS API 발행·과거기간 유지·최신자료 공유와 실패 시 마지막 정상 수치 보존", async t => {
  const db = database(); t.after(() => db.sqlite.close());
  let clock = NOW;
  const secret = encodeURIComponent("fixture+key/only=");
  const run = options => runStatisticsRefresh(db, { scopeId: base.id, force: true, maxSteps: 1, timeoutMs: 100,
    now: () => clock, sleep: async ms => { clock += ms; }, readKosisKey: async () => secret,
    fetcher: async url => { const target = new URL(url); return new Response(target.searchParams.get("type") === "PRD" ? '[{"PRD_SE":"년","STRT_PRD_DE":"2001","END_PRD_DE":"2026"}]' : target.searchParams.get("type") === "ITM" ? JSON.stringify(metadata()) : JSON.stringify(rows(base, table, "2026"))); }, ...options });
  assert.equal((await run()).completed, 1);
  const published = await readCurrentStatistics(db, base.id, {}, clock);
  assert.match(published.revision, /^kosis-api:/);
  assert.equal(published.auto_refresh.status, "current");
  assert.deepEqual(published.dataset.periods, ["2025", "2026"]);
  assert.equal((await readCurrentStatisticsSnapshots(db, clock)).find(row => row.dataset.id === base.id).revision, published.revision);
  assert.equal((await run({ fetcher: async () => new Response(JSON.stringify({ err: "11", errMsg: secret })) })).failed, 1);
  const fallback = await readCurrentStatistics(db, base.id, {}, clock);
  assert.equal(fallback.revision, published.revision);
  assert.equal(fallback.refresh_error, "SOURCE_KEY_REJECTED");
  assert.ok(!JSON.stringify(db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get(base.id)).includes(secret));
  assert.equal((await readCurrentStatistics(db, base.id, { mode: "verified" }, clock)).dataset.periods.at(-1), "2025");
});
test("KOSIS 복수 표는 시간 예산을 넘겨도 이어 받고 모두 검증한 후에만 발행한다", async t => {
  const db = database(); t.after(() => db.sqlite.close());
  const expected = verifiedStatistics("kosis:childcare-users").dataset;
  let clock = NOW;
  const run = () => runStatisticsRefresh(db, { scopeId: expected.id, force: true, maxSteps: 1, timeoutMs: 100, budgetMs: 600,
    now: () => clock, sleep: async ms => { clock += ms; }, readKosisKey: async () => "fixture-key",
    fetcher: async url => { clock += 30; const target = new URL(url); const source = expected.kosis.tables.find(table => table.tbl_id === target.searchParams.get("tblId"));
      return new Response(target.searchParams.get("type") === "PRD" ? '[{"PRD_SE":"년","END_PRD_DE":"2025"}]' : target.searchParams.get("type") === "ITM" ? JSON.stringify(metadata(expected, source)) : JSON.stringify(rows(expected, source))); } });
  const first = await run();
  assert.equal(first.completed, 0);
  assert.equal((await readCurrentStatistics(db, expected.id, {}, clock)).revision, verifiedStatistics(expected.id).revision);
  let completed = 0;
  for (let i = 0; i < 6 && !completed; i++) { clock += 5000; completed += (await run()).completed; }
  assert.equal(completed, 1);
  const current = await readCurrentStatistics(db, expected.id, {}, clock);
  assert.match(current.revision, /^kosis-api:/);
  assert.equal(current.dataset.series.find(row => row.label.includes("보육아동") && row.label.endsWith("합계")).unit, "명");
});
test("KOSIS가 인증값을 메타데이터 필드에 되돌려도 임시 저장소와 오류에는 남기지 않는다", async t => {
  const db = database(); t.after(() => db.sqlite.close());
  const rawKey = "fixture+private/key=", key = encodeURIComponent(rawKey); // gitleaks:allow synthetic test value
  let clock = NOW;
  const result = await runStatisticsRefresh(db, { scopeId: base.id, force: true, maxSteps: 1, timeoutMs: 100,
    now: () => clock, sleep: async ms => { clock += ms; }, readKosisKey: async () => key,
    fetcher: async url => { const type = new URL(url).searchParams.get("type");
      if (type === "PRD") return new Response('[{"PRD_SE":"년","END_PRD_DE":"2025"}]');
      const response = metadata(); response[0].ITM_ID = rawKey;
      return new Response(JSON.stringify(response));
    } });
  assert.equal(result.failed, 1);
  const saved = JSON.stringify(db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get(base.id));
  assert.ok(!saved.includes(rawKey)); assert.ok(!saved.includes(key));
});
test("최근 범위에서 빠진 항목은 검증본의 원래 조회 시작연도부터 API로 재확인한다", async t => {
  const db = database(); t.after(() => db.sqlite.close());
  let clock = NOW;
  const requests = [];
  const result = await runStatisticsRefresh(db, { scopeId: base.id, force: true, maxSteps: 1, timeoutMs: 100,
    now: () => clock, sleep: async ms => { clock += ms; }, readKosisKey: async () => "fixture-key",
    fetcher: async url => { const params = new URL(url).searchParams; requests.push(params);
      return new Response(params.get("type") === "PRD" ? '[{"PRD_SE":"년","END_PRD_DE":"2025"}]' : params.get("type") === "ITM" ? JSON.stringify(metadata()) : JSON.stringify(params.has("startPrdDe") ? rows() : rows().slice(1)));
    } });
  assert.equal(result.completed, 1);
  assert.ok(requests.some(params => params.get("newEstPrdCnt") === "2"));
  assert.ok(requests.some(params => params.get("startPrdDe") === "2025" && params.get("endPrdDe") === "2026" && !params.has("newEstPrdCnt")));
  assert.equal((await readCurrentStatistics(db, base.id, {}, clock)).dataset.series[0].points.at(-1).value, 2836706);
});
