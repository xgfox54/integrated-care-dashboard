// 외부 데이터 연계(법정동코드·장기요양기관·정부24·KOSIS·법령 반입) 시험. 실제 마이그레이션을 적용한 SQLite와
// 공식 명세 형식의 가짜 응답, 2026-10-05 실제 무인증 응답 원문, 행정표준코드관리시스템 공식 조회 표본을 쓴다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyDataGoKr, classifyKosis, classifyOdcloud, backoffSeconds, parseRetryAfter, redactQuery, sha256Hex } from "./integrations/http.ts";
import { kosisValue, parseLegalDong, parseLtcSearch, parseLtcGeneral, parseLtcPartners } from "./integrations/adapters.ts";
import { contentLinkForLegal, isoDate, kosisRegionLink, legalLevel, resolveByNameAsOf, validOn } from "./integrations/region-codes.ts";
import { advanceRun, readRun, startRun } from "./integrations/runner.ts";
import { advanceGov24Matching, normalizeProgramName, regionFit, STALE_CANDIDATE_NOTE, supplementMarker } from "./integrations/matching.ts";
import { institutionsPerThousandElderly, legalCodesForRegion, mapKosisRegions, regionSeries } from "./integrations/kosis.ts";
import { importLawBundle, LawBundleError, referenceId } from "./integrations/law-bundle.ts";
import { careDemand, careInstitution, careInstitutions, integrationStatus, programPublicInfo } from "./integrations/public.ts";
import { CARE_RESOURCES_MCP, CARE_RESOURCES_PUBLIC, CARE_TOOL_NAMES } from "./integrations/care-hold.ts";
import { database, NOW, response } from "./press-test-support.mjs";

const NO_KEY = JSON.parse(readFileSync(new URL("../docs/integrations/samples/no-key-responses-2026-10-05.json", import.meta.url), "utf8"));
const OFFICIAL = JSON.parse(readFileSync(new URL("../docs/integrations/samples/legal-dong-official-sample-2026-10-05.json", import.meta.url), "utf8"));
const sample = (id) => NO_KEY.responses.find((entry) => entry.id === id);

let runCounter = 0;
function deps(fetcher, { key = "TESTKEY%2B1", clock = { now: NOW } } = {}) {
  return { fetcher, now: () => clock.now, newId: () => "run-" + ++runCounter, keyFor: async () => key, owner: "test", stepBudgetMs: 60_000, queueCap: 50 };
}

function ltcItem(sym, pttn, name, sido = "48", sgg = "123") {
  return "<item><longTermAdminSym>" + sym + "</longTermAdminSym><adminPttnCd>" + pttn + "</adminPttnCd><adminNm>" + name + "</adminNm><siDoCd>" + sido + "</siDoCd><siGunGuCd>" + sgg + "</siGunGuCd><longTermPeribRgtDt>20200101</longTermPeribRgtDt><stpRptDt>20191201</stpRptDt></item>";
}

function ltcXml(items, total, code = "00") {
  return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><response><header><resultCode>" + code + "</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>" + items.join("") + "</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>" + total + "</totalCount></body></response>";
}

/** 기관 120곳(행 125개: 5곳은 서비스 유형 2개)을 100행씩 쪽으로 나눈 경남 응답. */
function ltcRows(count = 120, rename = {}) {
  const rows = [];
  for (let index = 1; index <= count; index += 1) {
    const sym = "4812300" + String(index).padStart(4, "0");
    rows.push(ltcItem(sym, index % 3 === 0 ? "A03" : "C01", rename[sym] ?? "요양기관" + index));
    if (index <= 5) rows.push(ltcItem(sym, "C03", rename[sym] ?? "요양기관" + index));
  }
  return rows;
}

function ltcFetcher(rows, { calls = [], override } = {}) {
  return {
    calls,
    fetcher: async (url) => {
      calls.push(url);
      if (override) {
        const special = override(url, calls.length);
        if (special) return special;
      }
      const page = Number(new URL(url).searchParams.get("pageNo"));
      return response(200, ltcXml(rows.slice((page - 1) * 100, page * 100), rows.length), { "content-type": "application/xml" });
    },
  };
}

async function runToEnd(db, d, dataset, scope) {
  const { runId } = await startRun(db, d, dataset, scope, "test");
  let status = "RUNNING";
  for (let step = 0; step < 20 && status === "RUNNING"; step += 1) status = await advanceRun(db, d, runId);
  return { runId, status };
}

test("실제 무인증 응답: 키 누락은 AUTH_MISSING, 등록되지 않은 키는 AUTH_FAILED로 나누고 0건으로 보지 않는다", () => {
  for (const id of ["datagokr-json-null", "datagokr-xml-null"]) {
    const s = sample(id);
    assert.equal(classifyDataGoKr(s.status, s.contentType, s.body, null).kind, "AUTH_MISSING", id);
  }
  for (const id of ["datagokr-json-unregistered", "datagokr-xml-unregistered"]) {
    const s = sample(id);
    const outcome = classifyDataGoKr(s.status, s.contentType, s.body, null);
    assert.equal(outcome.kind, "AUTH_FAILED", id);
    assert.equal(outcome.code, "30");
  }
  assert.equal(classifyOdcloud(401, sample("odcloud-null").body, null).kind, "AUTH_MISSING");
  assert.equal(classifyOdcloud(401, sample("odcloud-unregistered").body, null).kind, "AUTH_FAILED");
  assert.equal(classifyKosis(200, sample("kosis-null").body, null).kind, "AUTH_MISSING");
  assert.equal(classifyKosis(200, sample("kosis-invalid").body, null).kind, "AUTH_FAILED");
  assert.equal(classifyKosis(200, "{\"err\":\"30\",\"errMsg\":\"데이터가 존재하지 않습니다.\"}", null).kind, "EMPTY");
  assert.equal(classifyKosis(200, "{\"err\":\"31\",\"errMsg\":\"조회결과가 40,000셀을 초과\"}", null).kind, "UNSUPPORTED");
  assert.equal(classifyDataGoKr(200, "application/xml", ltcXml([], 0, "03"), null).kind, "EMPTY");
  assert.equal(classifyDataGoKr(200, "application/xml", ltcXml([], 0, "77"), null).kind, "PARSE_ERROR", "명세에 없는 결과코드는 성공으로 보지 않는다");
  assert.equal(classifyDataGoKr(429, "text/plain", "", 120).kind, "RATE_LIMITED");
  assert.equal(classifyDataGoKr(502, "text/html", "<html>bad gateway</html>", null).kind, "TRANSIENT");
});

test("Retry-After(초·날짜)와 지수 백오프, 요청 근거의 인증값 제거", () => {
  assert.equal(parseRetryAfter("120", 0), 120);
  assert.equal(parseRetryAfter(new Date(60_000).toUTCString(), 0), 60);
  assert.equal(parseRetryAfter("soon", 0), null);
  assert.equal(backoffSeconds(1), 30);
  assert.equal(backoffSeconds(3), 120);
  assert.equal(backoffSeconds(1, 900), 900);
  assert.equal(backoffSeconds(40), 6 * 3600);
  const basis = redactQuery("https://apis.data.go.kr/x?serviceKey=SECRET%2B&pageNo=1&apiKey=K2");
  assert.equal(basis.includes("SECRET"), false);
  assert.equal(basis.includes("K2"), false);
  assert.match(basis, /pageNo=1/);
});

test("행정코드 회귀: 공식 원문 표본의 용지동·부천 원미구·제주·군위·전남광주를 기준일별로 구분한다", () => {
  const records = Object.values(OFFICIAL.history).flat().map((row) => ({ code: row.code, name: row.name, validFrom: isoDate(row.created), validTo: isoDate(row.abolished) }));
  const yongji2020 = resolveByNameAsOf(records, "용지동", "2020-01-01").map((row) => row.code);
  assert.deepEqual(yongji2020, ["4812110900"], "2021-07-01 이전 용지동은 의창구");
  assert.deepEqual(resolveByNameAsOf(records, "용지동", "2026-10-05").map((row) => row.code), ["4812313400"], "2021-07-01부터 용지동은 성산구");
  assert.equal(validOn({ code: "4811010900", name: "", validFrom: "2010-07-01", validTo: "2010-07-01" }, "2010-07-01"), false, "같은 날 생기고 없어진 코드는 효력 없음");
  assert.deepEqual(resolveByNameAsOf(records, "부천시 원미구", "2015-01-01").map((row) => row.code), ["4119500000"]);
  assert.deepEqual(resolveByNameAsOf(records, "부천시 원미구", "2020-01-01"), [], "2016~2023년에는 부천시 원미구 코드가 없다");
  assert.deepEqual(resolveByNameAsOf(records, "부천시 원미구", "2026-10-05").map((row) => row.code), ["4119200000"]);
  assert.deepEqual(resolveByNameAsOf(records, "서귀포시", "2005-01-01").map((row) => row.code), ["4913000000"]);
  assert.deepEqual(resolveByNameAsOf(records, "서귀포시", "2026-10-05").map((row) => row.code), ["5013000000"]);
  assert.deepEqual(resolveByNameAsOf(records, "군위군", "2026-10-05").map((row) => row.code), ["2772000000"]);
  assert.equal(legalLevel("4812300000", "경상남도 창원시 성산구"), "GENERAL_DISTRICT");
  assert.equal(legalLevel("5013000000", "제주특별자치도 서귀포시"), "ADMIN_CITY");
  assert.equal(legalLevel("1115000000", "서울특별시 중랑구"), "SIGUNGU", "자치구는 기초자치단체");
  assert.deepEqual(contentLinkForLegal("5013000000", "제주특별자치도 서귀포시"), { regionId: "region:제주특별자치도", relation: "PART_OF", status: "VERIFIED", note: "행정시(기초자치단체 아님). 보건복지부 사업안내는 제주특별자치도 단위로만 수록" });
  assert.equal(contentLinkForLegal("4812300000", "경상남도 창원시 성산구").regionId, "region:경상남도|창원시");
  assert.equal(contentLinkForLegal("4812300000", "경상남도 창원시 성산구").relation, "PART_OF");
  assert.equal(contentLinkForLegal("2911000000", "광주광역시 동구").status, "CANDIDATE", "폐지된 광주광역시 코드는 확정하지 않는다");
  assert.equal(contentLinkForLegal("1211000000", "전남광주통합특별시 목포시").relation, "SAME");
  assert.equal(kosisRegionLink("11010", "종로구", [{ code: "1111000000", name: "서울특별시 종로구" }]).status, "CANDIDATE", "코드가 다르면 이름만으로 확정하지 않는다");
  assert.equal(kosisRegionLink("1111000000", "종로구", [{ code: "1111000000", name: "서울특별시 종로구" }]).status, "VERIFIED");
  assert.equal(kosisRegionLink("21010", "동구", [{ code: "2611000000", name: "부산광역시 동구" }, { code: "2711000000", name: "대구광역시 동구" }]).basis, "NAME_AMBIGUOUS");
});

test("초기 지역 대응표(0073): 창원 일반구는 창원시, 제주 행정시는 제주특별자치도에 포함되고 기준일 밖 코드는 빠진다", async () => {
  const db = database();
  const changwon = (await legalCodesForRegion(db, "region:경상남도|창원시", "2026-10-05")).map((row) => row.code).sort();
  assert.ok(changwon.includes("4812100000") && changwon.includes("4812300000") && changwon.includes("4812000000"), changwon.join(","));
  const jeju = (await legalCodesForRegion(db, "region:제주특별자치도", "2026-10-05")).map((row) => row.code).sort();
  assert.deepEqual(jeju, ["5000000000", "5011000000", "5013000000"]);
  const bucheon2015 = (await legalCodesForRegion(db, "region:경기도|부천시", "2015-06-01")).map((row) => row.code);
  assert.ok(bucheon2015.includes("4119500000"), "2015년 부천 원미구(폐지 코드)는 그 시점에 포함");
  const bucheon2026 = (await legalCodesForRegion(db, "region:경기도|부천시", "2026-10-05")).map((row) => row.code);
  assert.equal(bucheon2026.includes("4119500000"), false, "2016년 폐지된 코드는 현재 기준에서 빠진다");
  const gwangju = await legalCodesForRegion(db, "region:전남광주통합특별시|동구", "2026-10-05");
  assert.equal(gwangju.some((row) => row.code === "2911000000"), false, "폐지 코드 후보(CANDIDATE)는 확정 조회에 쓰지 않는다");
});

test("장기요양기관: 쪽 이어받기·기관/서비스 중복 집계 방지·재수집 중복 없음·변경 이력·안 보인 기관 보존", async () => {
  const db = database();
  const clock = { now: NOW };
  const first = ltcFetcher(ltcRows());
  const one = await runToEnd(db, deps(first.fetcher, { clock }), "nhis.ltc_search", "sido:48");
  assert.equal(one.status, "SUCCEEDED");
  assert.equal(first.calls.length, 2, "125행을 100행씩 2쪽");
  assert.equal(first.calls.every((url) => !url.includes("SECRET")), true);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM ltc_institution").get().n, 120, "기관은 기관기호로 한 번만");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM ltc_institution_service").get().n, 125);
  const run = await readRun(db, one.runId);
  assert.equal(run.rows_received, 125);
  assert.equal(db.sqlite.prepare("SELECT query_basis FROM ext_run WHERE run_id = ?").get(one.runId).query_basis.includes("TESTKEY"), false, "조회 근거에 인증값이 없다");
  clock.now += 7 * 86400 + 1;
  const again = await runToEnd(db, deps(ltcFetcher(ltcRows()).fetcher, { clock }), "nhis.ltc_search", "sido:48");
  assert.equal(again.status, "SUCCEEDED");
  const second = db.sqlite.prepare("SELECT records_new, records_changed FROM ext_run WHERE run_id = ?").get(again.runId);
  assert.deepEqual({ ...second }, { records_new: 0, records_changed: 0 }, "같은 자료 재수집은 새 레코드·변경 0");
  clock.now += 7 * 86400 + 1;
  const renamed = ltcRows(119, { "48123000001": "새이름요양원" });
  const third = await runToEnd(db, deps(ltcFetcher(renamed).fetcher, { clock }), "nhis.ltc_search", "sido:48");
  assert.equal(third.status, "SUCCEEDED");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM ltc_institution").get().n, 120, "목록에서 빠진 기관도 행은 남는다");
  assert.equal(db.sqlite.prepare("SELECT presence FROM ltc_institution WHERE admin_sym = '48123000120'").get().presence, "NOT_SEEN");
  assert.equal(db.sqlite.prepare("SELECT admin_nm FROM ltc_institution WHERE admin_sym = '48123000001'").get().admin_nm, "새이름요양원");
  const changes = db.sqlite.prepare("SELECT kind, changed_fields FROM ext_record_change WHERE dataset_key = 'nhis.ltc_search' AND record_id = '48123000001:C01' ORDER BY change_id").all();
  assert.deepEqual(changes.map((row) => row.kind), ["NEW", "CHANGED"]);
  assert.equal(changes[1].changed_fields, "adminNm");
  const demand = await careDemand(db, "region:경상남도|창원시", "2026-10-05");
  assert.equal(demand.institutions.count, 119, "현재 보이는 기관만 센다");
  const groupTotal = demand.institutions.by_group.reduce((sum, group) => sum + group.count, 0);
  assert.ok(groupTotal > demand.institutions.count, "유형별 수의 합은 기관 수와 다르다(여러 유형 기관)");
  const page = await careInstitutions(db, "region:경상남도|창원시", "2026-10-05", { offset: 0, limit: 10 });
  assert.equal(page.total, 119);
  assert.equal(page.items.length, 10);
  const withTwo = (await careInstitutions(db, "region:경상남도|창원시", "2026-10-05", { query: "요양기관2", offset: 0, limit: 50 })).items.find((item) => item.admin_sym === "48123000002");
  assert.equal(withTwo.service_types.length, 2);
  const mcpTotal = (await careInstitutions(db, "region:경상남도|창원시", "2026-10-05", { offset: 0, limit: 1 })).total;
  assert.equal(mcpTotal, demand.institutions.count, "목록 총수와 현황 기관 수가 같다");
});

test("부분 응답·쪽 누락은 재시도 뒤 PARTIAL/TRANSIENT로 끝나고 기존 자료를 '안 보임'으로 표시하지 않는다", async () => {
  const db = database();
  const clock = { now: NOW };
  await runToEnd(db, deps(ltcFetcher(ltcRows()).fetcher, { clock }), "nhis.ltc_search", "sido:48");
  clock.now += 8 * 86400;
  const short = ltcRows();
  const broken = ltcFetcher(short, { override: (url) => (new URL(url).searchParams.get("pageNo") === "2" ? response(200, ltcXml(short.slice(100, 110), short.length), { "content-type": "application/xml" }) : null) });
  const d = deps(broken.fetcher, { clock });
  const { runId } = await startRun(db, d, "nhis.ltc_search", "sido:48", "test");
  let status = await advanceRun(db, d, runId);
  assert.equal(status, "RUNNING", "1쪽은 저장, 2쪽 행 수 불일치로 다시 시도 대기");
  const waiting = await readRun(db, runId);
  assert.ok(waiting.retry_at > clock.now);
  assert.match(db.sqlite.prepare("SELECT message FROM ext_run WHERE run_id = ?").get(runId).message, /행 수가 원천 총건수와 맞지 않습니다/);
  assert.equal(await advanceRun(db, d, runId), "WAITING", "다시 시도 시각 전에는 요청하지 않는다");
  for (let attempt = 0; attempt < 5 && status === "RUNNING"; attempt += 1) {
    clock.now = (await readRun(db, runId)).retry_at;
    status = await advanceRun(db, d, runId);
  }
  assert.equal(status, "TRANSIENT_ERROR");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM ltc_institution WHERE presence = 'NOT_SEEN'").get().n, 0, "실패한 수집으로 기존 기관을 안 보임 처리하지 않는다");
  const state = db.sqlite.prepare("SELECT last_status, last_success_at, consecutive_failures FROM ext_scope_state WHERE dataset_key = 'nhis.ltc_search' AND scope_key = 'sido:48'").get();
  assert.equal(state.last_status, "TRANSIENT_ERROR");
  assert.equal(state.last_success_at, NOW, "마지막 성공 시각은 그대로");
});

test("인증키 없음은 요청 없이 AUTH_MISSING, 429는 Retry-After를 지키고 한도 뒤 RATE_LIMITED, 시간 초과는 일시 장애", async () => {
  const db = database();
  const calls = [];
  const noKey = await runToEnd(db, deps(async (url) => { calls.push(url); return response(200, ""); }, { key: null }), "nhis.ltc_search", "sido:11");
  assert.equal(noKey.status, "AUTH_MISSING");
  assert.equal(calls.length, 0);
  const clock = { now: NOW };
  const limited = ltcFetcher([], { override: () => response(429, "", { "retry-after": "120" }) });
  const d = deps(limited.fetcher, { clock });
  const { runId } = await startRun(db, d, "nhis.ltc_search", "sido:26", "test");
  assert.equal(await advanceRun(db, d, runId), "RUNNING");
  assert.equal((await readRun(db, runId)).retry_at, clock.now + 120);
  let status = "RUNNING";
  for (let attempt = 0; attempt < 6 && status === "RUNNING"; attempt += 1) {
    clock.now = (await readRun(db, runId)).retry_at;
    status = await advanceRun(db, d, runId);
  }
  assert.equal(status, "RATE_LIMITED");
  assert.equal(limited.calls.length, 4);
  const timeout = await startRun(db, deps(async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }), "nhis.ltc_search", "sido:27", "test");
  assert.equal(await advanceRun(db, deps(async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }), timeout.runId), "RUNNING");
  assert.match(db.sqlite.prepare("SELECT message FROM ext_run WHERE run_id = ?").get(timeout.runId).message, /응답 시간 초과/);
});

test("정상 0건은 SUCCEEDED_EMPTY, 같은 범위 중복 시작은 기존 실행을 돌려주고 실행권이 있으면 BUSY", async () => {
  const db = database();
  const empty = await runToEnd(db, deps(async () => response(200, ltcXml([], 0, "00"), { "content-type": "application/xml" })), "nhis.ltc_search", "sido:36");
  assert.equal(empty.status, "SUCCEEDED_EMPTY");
  const d = deps(ltcFetcher(ltcRows()).fetcher);
  const a = await startRun(db, d, "nhis.ltc_search", "sido:48", "test");
  const b = await startRun(db, d, "nhis.ltc_search", "sido:48", "test");
  assert.equal(b.reused, true);
  assert.equal(a.runId, b.runId);
  db.sqlite.prepare("UPDATE ext_run SET lease_owner = 'other', lease_until = ? WHERE run_id = ?").run(NOW + 60, a.runId);
  assert.equal(await advanceRun(db, d, a.runId), "BUSY");
  db.sqlite.prepare("UPDATE ext_run SET lease_until = ? WHERE run_id = ?").run(NOW - 1, a.runId);
  assert.equal(await advanceRun(db, d, a.runId), "SUCCEEDED", "실행권이 끝난 실행은 이어 받는다");
});

test("중단 뒤 재개: 시간 예산이 끝나면 체크포인트(다음 쪽)에서 이어 받는다", async () => {
  const db = database();
  const rows = ltcRows();
  const source = ltcFetcher(rows);
  const d = { ...deps(source.fetcher), stepBudgetMs: 0 };
  const { runId } = await startRun(db, d, "nhis.ltc_search", "sido:48", "test");
  assert.equal(await advanceRun(db, d, runId), "RUNNING");
  assert.equal(source.calls.length, 0, "예산 0이면 요청하지 않고 실행권만 돌려준다");
  const one = { ...d, stepBudgetMs: 1 };
  const origin = Date.now;
  const started = origin();
  let tick = 0;
  Date.now = () => started + (tick++ < 2 ? 0 : 10);
  try {
    assert.equal(await advanceRun(db, one, runId), "RUNNING");
  } finally {
    Date.now = origin;
  }
  assert.equal(JSON.parse((await readRun(db, runId)).cursor_json).page, 2);
  assert.equal(await advanceRun(db, deps(source.fetcher), runId), "SUCCEEDED");
  assert.deepEqual(source.calls.map((url) => new URL(url).searchParams.get("pageNo")), ["1", "2"], "같은 쪽을 두 번 받지 않는다");
});

test("장기요양 상세: 일반현황·협약기관, 협약기간 종료와 현행 구분, 협약 목록에서 빠진 관계 보존", async () => {
  const db = database();
  const clock = { now: NOW };
  await runToEnd(db, deps(ltcFetcher(ltcRows(2)).fetcher, { clock }), "nhis.ltc_search", "sido:48");
  const partnersFor = (sym, list) => "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>" + list.map(([name, from, to]) => "<item><adptFrDt>" + from + "</adptFrDt><adptToDt>" + to + "</adptToDt><longTermAdminSym>" + sym + "</longTermAdminSym><yoyangNm>" + name + "</yoyangNm></item>").join("") + "</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>" + list.length + "</totalCount></body></response>";
  const general = (sym) => "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><item><adminNm>요양기관</adminNm><adminPttnCd>C01</adminPttnCd><BDongCd>134</BDongCd><HDongCd>590</HDongCd><hmPostNo>51400</hmPostNo><locTelNo_1>055</locTelNo_1><locTelNo_2>123</locTelNo_2><locTelNo_3>4567</locTelNo_3><longTermAdminSym>" + sym + "</longTermAdminSym><riCd>00</riCd><siDoCd>48</siDoCd><siGunGuCd>123</siGunGuCd><detailAddr>용지로 1</detailAddr></item></body></response>";
  let partnerList = [["현행내과의원", "20240101", "99991231"], ["옛병원", "20180101", "20201231"]];
  const fetcher = async (url) => {
    const parsed = new URL(url);
    const sym = parsed.searchParams.get("longTermAdminSym");
    return response(200, parsed.pathname.endsWith("getConvInsttDetailInfoList02") ? partnersFor(sym, partnerList) : general(sym), { "content-type": "application/xml" });
  };
  const detail = await runToEnd(db, deps(fetcher, { clock }), "nhis.ltc_detail", "queue");
  assert.equal(detail.status, "SUCCEEDED");
  const inst = await careInstitution(db, "ltc:48123000001", "2026-10-05");
  assert.equal(inst.tel, "055-123-4567");
  assert.equal(inst.address.legal_dong, "경상남도 창원시 성산구 용지동", "법정동 이름은 공식 코드표에서 찾는다(4812313400)");
  assert.deepEqual(inst.partners.map((partner) => [partner.name, partner.state]), [["현행내과의원", "CURRENT"], ["옛병원", "EXPIRED"]]);
  assert.equal(inst.partners[0].to, null, "99991231은 기한 없음");
  assert.match(inst.id_system, /같다고 보지 않습니다/);
  clock.now += 31 * 86400;
  partnerList = [["옛병원", "20180101", "20201231"]];
  await runToEnd(db, deps(fetcher, { clock }), "nhis.ltc_detail", "queue");
  const later = await careInstitution(db, "ltc:48123000001", "2026-11-05");
  assert.equal(later.partners.find((partner) => partner.name === "현행내과의원").state, "NOT_SEEN", "원천 목록에서 빠진 협약은 지우지 않고 표시한다");
});

test("정부24: 목록·상세 수집, 수정일시가 바뀐 서비스만 상세 재조회, 동일 사업은 후보로만 연결", async () => {
  const db = database();
  db.sqlite.exec("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at, document_count) VALUES ('kg-run', 'test', 'succeeded', 1, 2, 1)");
  db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at) VALUES (?, ?, 'kg-run', ?, ?, '일상생활돌봄', '식사지원', ?, '', ?, '', ?, '', '', '', '', 1)")
    .run("p1", "S1", "서울특별시", "중랑구", "어르신 식사배달 사업", "65세 이상 독거노인", "중랑구청");
  db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at) VALUES (?, ?, 'kg-run', ?, ?, '일상생활돌봄', '식사지원', ?, '', ?, '', ?, '', '', '', '', 1)")
    .run("p2", "S2", "부산광역시", "동구", "어르신 식사배달", "노인", "동구청");
  const list = (modified) => JSON.stringify({ page: 1, perPage: 500, totalCount: 2, currentCount: 2, matchCount: 2, data: [
    { 서비스ID: "WLF0001", 서비스명: "어르신 식사배달", 소관기관명: "서울특별시 중랑구", 소관기관유형: "지방자치단체", 지원대상: "65세 이상 저소득 어르신", 신청방법: "주민센터 방문", 수정일시: modified, 상세조회URL: "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/WLF0001" },
    { 서비스ID: "WLF0002", 서비스명: "청년 월세 지원", 소관기관명: "국토교통부", 소관기관유형: "중앙행정기관", 수정일시: "20260901" },
  ] });
  const detailCalls = [];
  const fetcherFor = (modified) => async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("serviceList")) return response(200, list(modified), { "content-type": "application/json" });
    const id = parsed.searchParams.get("cond[서비스ID::EQ]");
    detailCalls.push(id);
    return response(200, JSON.stringify({ page: 1, perPage: 1, totalCount: 1, currentCount: 1, matchCount: 1, data: [{ 서비스ID: id, 서비스명: "x", 법령: "노인복지법 제27조의2", 구비서류: "신분증", 문의처: "02-000-0000", 수정일시: modified }] }), { "content-type": "application/json" });
  };
  const clock = { now: NOW };
  assert.equal((await runToEnd(db, deps(fetcherFor("20261001"), { clock }), "mois.gov24_list", "all")).status, "SUCCEEDED");
  assert.equal((await runToEnd(db, deps(fetcherFor("20261001"), { clock }), "mois.gov24_detail", "queue")).status, "SUCCEEDED");
  assert.deepEqual(detailCalls.sort(), ["WLF0001", "WLF0002"]);
  assert.equal((await runToEnd(db, deps(fetcherFor("20261001"), { clock }), "mois.gov24_detail", "queue")).status, "SUCCEEDED_EMPTY", "바뀐 것이 없으면 상세를 다시 부르지 않는다");
  const match = await advanceGov24Matching(db, NOW);
  assert.equal(match.checked, 2);
  const links = db.sqlite.prepare("SELECT source_id, target_id, status, score, conflict_json FROM program_ext_link WHERE source_kind = 'GOV24'").all();
  assert.equal(links.length, 1, "부산 동구의 같은 이름 사업은 소관기관 지역이 달라 후보가 아니다");
  assert.equal(links[0].status, "CANDIDATE", "자동 판정은 확정하지 않는다");
  assert.equal(links[0].score, 0.9);
  assert.match(links[0].conflict_json, /지원대상/, "지원대상이 다르면 덮어쓰지 않고 충돌로 남긴다");
  const target = links[0].target_id;
  let info = await programPublicInfo(db, target);
  assert.equal(info.gov24.state, "LINK_UNVERIFIED");
  assert.equal(info.gov24.services.length, 0, "확정 전에는 정부24 내용을 사업 정보로 내보내지 않는다");
  assert.equal(info.gov24.pending_candidates, 1);
  db.sqlite.prepare("UPDATE program_ext_link SET status = 'VERIFIED', reviewed_at = ? WHERE source_kind = 'GOV24'").run(NOW);
  info = await programPublicInfo(db, target);
  assert.equal(info.gov24.state, "COLLECTED");
  assert.equal(info.gov24.services[0].required_documents, "신분증");
  assert.equal(info.gov24.services[0].target, "65세 이상 저소득 어르신");
  clock.now += 86400 + 1;
  assert.equal((await runToEnd(db, deps(fetcherFor("20261003"), { clock }), "mois.gov24_list", "all")).status, "SUCCEEDED");
  detailCalls.length = 0;
  await runToEnd(db, deps(fetcherFor("20261003"), { clock }), "mois.gov24_detail", "queue");
  assert.deepEqual(detailCalls, ["WLF0001"], "수정일시가 바뀐 서비스만 상세 재조회");
  clock.now += 86400 + 1;
  const ended = async () => response(200, JSON.stringify({ page: 1, perPage: 500, totalCount: 1, currentCount: 1, matchCount: 1, data: [JSON.parse(list("20261003")).data[1]] }), { "content-type": "application/json" });
  await runToEnd(db, deps(ended, { clock }), "mois.gov24_list", "all");
  assert.equal(db.sqlite.prepare("SELECT presence FROM gov24_service WHERE service_id = 'WLF0001'").get().presence, "NOT_SEEN", "목록에서 한 번 빠졌다고 종료로 처리하지 않는다");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM program_ext_link WHERE source_id = 'WLF0001'").get().n, 1, "연결 이력 보존");
  assert.equal(normalizeProgramName("「어르신 식사배달」 사업(2026)"), "어르신식사배달");
  assert.equal(regionFit("보건복지부", "중앙행정기관", "서울특별시", "중랑구"), "CENTRAL");
});

test("정부24: 지방비 추가지원 사업은 국비 사업 후보가 아니고, 시군구 이름 일부 일치는 같은 지역이 아니다", async () => {
  assert.equal(supplementMarker("장애인 활동지원(추가)"), "추가");
  assert.equal(supplementMarker("장애인 활동지원(구비)"), "구비");
  assert.equal(supplementMarker("장애인활동지원(구 추가지원)"), "구추가지원");
  assert.equal(supplementMarker("장애인 활동지원(바우처)"), "");
  assert.equal(supplementMarker("장애인 활동지원"), "");
  assert.equal(regionFit("서울특별시 성동구", "지방자치단체", "대전광역시", "동구"), "MISMATCH", "성동구 안의 「동구」는 대전 동구가 아니다");
  assert.equal(regionFit("서울특별시 용산구", "지방자치단체", "서울특별시", "용산구"), "SIGUNGU");
  assert.equal(regionFit("구리도시공사", "공공기관", "경기도", "구리시"), "SIGUNGU", "지방공기업은 이름 앞 지역에서 운영한다");
  assert.equal(regionFit("구리도시공사", "공공기관", "충청북도", "단양군"), "MISMATCH", "다른 지역 사업의 후보가 아니다");
  assert.equal(regionFit("인천교통공사", "공공기관", "인천광역시", "부평구"), "SIDO");
  assert.equal(regionFit("인천교통공사", "공공기관", "경기도", "안성시"), "MISMATCH");
  assert.equal(regionFit("인천광역시서해구시설관리공단", "공공기관", "인천광역시", "서해구"), "SIGUNGU");
  assert.equal(regionFit("안성시시설관리공단", "공공기관", "경기도", "안성시"), "SIGUNGU");
  assert.equal(regionFit("한국보훈복지의료공단", "공공기관", "서울특별시", "송파구"), "CENTRAL", "전국 공공기관은 그대로 둔다");

  const db = database();
  db.sqlite.exec("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at, document_count) VALUES ('kg-run', 'test', 'succeeded', 1, 2, 1)");
  const program = db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at) VALUES (?, ?, 'kg-run', ?, ?, '장애인', '활동지원', '장애인활동지원', '', '', '', '', '', '', '', '', 1)");
  program.run("p1", "S1", "서울특별시", "용산구");
  program.run("p2", "S2", "대전광역시", "동구");
  const gov = db.sqlite.prepare("INSERT INTO gov24_service (service_id, name, org_name, org_type, modified_at, first_seen_at, last_seen_at, list_run_id) VALUES (?, ?, ?, '지방자치단체', '20261001', 1, 1, 'r')");
  gov.run("WLF-NAT", "장애인 활동지원", "서울특별시 용산구");
  gov.run("WLF-ADD", "장애인 활동지원(추가)", "서울특별시 용산구");
  gov.run("WLF-SD", "장애인 활동지원(추가1)", "서울특별시 성동구");
  // 예전 규칙이 만든 후보: 추가지원 사업을 국비 사업 후보로 올린 것.
  db.sqlite.prepare("INSERT INTO program_ext_link (link_id, source_kind, source_id, target_kind, target_id, target_label, score, evidence_json, status, created_at, updated_at) VALUES ('old', 'GOV24', 'WLF-ADD', 'service', 'service:old', 'x', 0.9, '{}', 'CANDIDATE', 1, 1)").run();

  await advanceGov24Matching(db, NOW);
  const links = db.sqlite.prepare("SELECT source_id, status, review_note FROM program_ext_link WHERE source_kind = 'GOV24' ORDER BY source_id").all();
  assert.deepEqual(links.map((row) => [row.source_id, row.status]), [["WLF-ADD", "REJECTED"], ["WLF-NAT", "CANDIDATE"]], "추가지원·다른 지역은 후보가 아니고, 국비 사업만 후보로 남는다");
  assert.equal(links[0].review_note, STALE_CANDIDATE_NOTE, "예전 후보는 지우지 않고 사유와 함께 제외한다");

  // 확인한 연결은 규칙 버전만 바뀌었을 때 재검토로 돌아가지 않는다.
  db.sqlite.exec("UPDATE program_ext_link SET status = 'VERIFIED', evidence_json = json_set(evidence_json, '$.rule', 'gov24-match-1') WHERE source_id = 'WLF-NAT'; UPDATE gov24_service SET match_checked_hash = NULL");
  await advanceGov24Matching(db, NOW + 10);
  assert.equal(db.sqlite.prepare("SELECT status FROM program_ext_link WHERE source_id = 'WLF-NAT'").get().status, "VERIFIED");
  assert.equal(db.sqlite.prepare("SELECT status FROM program_ext_link WHERE link_id = 'old'").get().status, "REJECTED", "사람·이전 판정은 다시 후보로 돌아가지 않는다");
});

test("KOSIS: 결측·비공개 기호를 0으로 바꾸지 않고, 합산 항목이 하나라도 없으면 지표를 만들지 않으며 시점 차이를 알린다", async () => {
  assert.deepEqual(kosisValue("-"), { value: null, status: "NOT_AVAILABLE" });
  assert.deepEqual(kosisValue("x"), { value: null, status: "SUPPRESSED" });
  assert.deepEqual(kosisValue(""), { value: null, status: "MISSING" });
  assert.deepEqual(kosisValue("1,234"), { value: "1234", status: "OK" });
  const obs = (period, class2, value, status = "OK", relation = "SAME", region = "4812000000") => ({ org_id: "101", tbl_id: "T", itm_id: "T2", region_code: region, region_name: "창원시", class2, class2_name: null, period, value, value_status: status, unit: "명", relation });
  const aggregate = { class2_codes: ["65", "70"], label: "65세 이상" };
  const series = regionSeries([obs("202608", "65", "100"), obs("202608", "70", "50"), obs("202609", "65", "110"), obs("202609", "70", null, "SUPPRESSED")], aggregate);
  assert.deepEqual(series.map((point) => [point.period, point.value, point.status]), [["202608", "150", "OK"], ["202609", null, "SUPPRESSED"]]);
  const parts = regionSeries([obs("202608", "65", "10", "OK", "PART_OF", "4812100000"), obs("202608", "70", "5", "OK", "PART_OF", "4812100000"), obs("202608", "65", "20", "OK", "PART_OF", "4812300000"), obs("202608", "70", "1", "OK", "PART_OF", "4812300000")], aggregate);
  assert.equal(parts[0].value, "36");
  assert.match(parts[0].basis, /구 단위 2곳 합산/);
  const ok = institutionsPerThousandElderly(30, "2026-10-05", { period: "202609", value: "15000", status: "OK", unit: "명", basis: "단일 지역 값" }, "KOSIS 101/DT");
  assert.equal(ok.value, "2.00");
  assert.equal(ok.denominator.period, "202609");
  const late = institutionsPerThousandElderly(30, "2026-10-05", { period: "2024", value: "15000", status: "OK", unit: "명", basis: "" }, "KOSIS");
  assert.ok(late.limitations.some((text) => text.includes("개월")));
  const missing = institutionsPerThousandElderly(30, "2026-10-05", { period: "202609", value: null, status: "SUPPRESSED", unit: "명", basis: "" }, "KOSIS");
  assert.equal(missing.value, null);
  assert.match(missing.reason, /SUPPRESSED/);
  assert.ok(ok.limitations.some((text) => text.includes("신청자·대상자 수가 아닙니다")));
  const db = database();
  db.sqlite.exec("INSERT INTO kosis_observation (org_id, tbl_id, itm_id, region_code, region_name, class2, period, value, value_status, run_id, collected_at) VALUES ('101','T','T2','4812000000','창원시','','202609','1','OK','r',1), ('101','T','T2','48120','창원시','','202609','1','OK','r',1)");
  await mapKosisRegions(db, "101", "T", NOW);
  const maps = db.sqlite.prepare("SELECT from_code, status, basis FROM region_code_map WHERE from_type = 'KOSIS_REGION' ORDER BY from_code").all();
  assert.deepEqual(maps.map((row) => [row.from_code, row.status]), [["48120", "VERIFIED"], ["4812000000", "VERIFIED"]]);
});

async function bundleFor(items, overrides = {}) {
  const body = { schema: "welfare-law-bundle-1", created_at: "2026-10-05T08:00:00Z", query_date: "2026-10-05", package: "korean-law-mcp@4.15.6", server: { name: "korean-law", version: "4.15.6" }, collector_version: "1.0.0", protocol_sha256: "a".repeat(64), blocked_count: 0, items, ...overrides };
  body.items_sha256 = overrides.items_sha256 ?? await sha256Hex(JSON.stringify(body.items));
  return JSON.stringify(body);
}

const ref = (mst, upcoming = null) => ({ law_name: "노인복지법", law_kind: "법률", law_id: "001773", mst, article: "제27조의2", promulgated_on: "2025-01-21", effective_on: "2025-07-22", version_status: "CURRENT", article_status: "EXISTS", upcoming_note: upcoming, official_url: "https://www.law.go.kr/법령/노인복지법", text_sha256: "b".repeat(64) });
const item = (refs, status = "OK") => ({ candidate_id: "WLF0001:법령:service:x", target_kind: "service", target_id: "service:s1|서울특별시|중랑구|일상생활돌봄|식사지원|어르신식사배달사업", target_label: "어르신 식사배달 사업", citation_text: "노인복지법 제27조의2", source: { kind: "GOV24_FIELD", id: "WLF0001", field: "법령" }, status, message: null, verify_summary: null, references: refs });

test("법령 반입 묶음: 형식·허용 버전·해시 검사, 후보로만 반입, 같은 묶음 재반입 없음, 확정 연결의 개정 탐지", async () => {
  const db = database();
  await assert.rejects(importLawBundle(db, await bundleFor([item([ref("270001")])], { package: "korean-law-mcp@4.15.7", server: { name: "korean-law", version: "4.15.7" } }), NOW), LawBundleError);
  await assert.rejects(importLawBundle(db, await bundleFor([item([ref("270001")])], { package: "korean-law-mcp@4.15.5" }), NOW), /서버 버전/);
  await assert.rejects(importLawBundle(db, await bundleFor([item([ref("270001")])], { items_sha256: "c".repeat(64) }), NOW), /items_sha256/);
  await assert.rejects(importLawBundle(db, await bundleFor([item([{ ...ref("270001"), official_url: "https://evil.example/law" }])]), NOW), LawBundleError);
  const raw = await bundleFor([item([ref("270001")]), item([], "AUTH_MISSING")]);
  const report = await importLawBundle(db, raw, NOW);
  assert.equal(report.references, 1);
  assert.equal(report.candidate_links, 1);
  assert.deepEqual(report.skipped, { AUTH_MISSING: 1 });
  assert.equal((await importLawBundle(db, raw, NOW)).duplicate, true);
  const target = item([]).target_id;
  let info = await programPublicInfo(db, target);
  assert.equal(info.legal_basis.references.length, 0, "후보는 근거로 공개하지 않는다");
  assert.equal(info.legal_basis.pending_candidates, 1);
  db.sqlite.prepare("UPDATE program_ext_link SET status = 'VERIFIED', reviewed_at = ? WHERE source_kind = 'LAW'").run(NOW);
  info = await programPublicInfo(db, target);
  assert.equal(info.legal_basis.references[0].version_id, "270001");
  assert.equal(info.legal_basis.references[0].article_status, "EXISTS");
  const hidden = await programPublicInfo(db, target, { includeLaw: false });
  assert.equal(hidden.legal_basis.state, "DISABLED");
  assert.equal(hidden.legal_basis.references.length, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM law_reference").get().n, 1);
  assert.equal((await programPublicInfo(db, target)).legal_basis.references.length, 1);
  const newer = await bundleFor([item([{ ...ref("280002"), effective_on: "2026-12-01", version_status: "FUTURE" }])], { created_at: "2026-11-01T00:00:00Z", query_date: "2026-11-01" });
  const second = await importLawBundle(db, newer, NOW + 100);
  assert.equal(second.review_required, 1, "확정한 근거 법령의 버전이 바뀌면 다시 검토");
  assert.equal(db.sqlite.prepare("SELECT status FROM program_ext_link WHERE source_id = ?").get(referenceId(ref("270001"), "2026-10-05")).status, "REVIEW_REQUIRED");
  assert.equal((await programPublicInfo(db, target)).legal_basis.references.length, 0, "다시 검토가 필요한 연결은 확정 근거로 보이지 않는다");
});

test("법령 반입 묶음: 기존 4.15.5 반입·확정 연결과 출처를 보존하면서 4.15.6 묶음을 추가한다", async () => {
  const db = database();
  const oldRaw = await bundleFor([item([ref("270001")])], { package: "korean-law-mcp@4.15.5", server: { name: "korean-law", version: "4.15.5" } });
  const first = await importLawBundle(db, oldRaw, NOW);
  assert.equal(first.candidate_links, 1);
  assert.equal((await importLawBundle(db, oldRaw, NOW)).duplicate, true);
  const oldRefId = referenceId(ref("270001"), "2026-10-05");
  db.sqlite.prepare("UPDATE program_ext_link SET status = 'VERIFIED', reviewed_at = ? WHERE source_kind = 'LAW'").run(NOW);

  const newRaw = await bundleFor([item([ref("270001")])], { created_at: "2026-10-06T08:00:00Z", query_date: "2026-10-06" });
  const second = await importLawBundle(db, newRaw, NOW + 1);
  assert.equal(second.review_required, 0, "같은 법령 버전의 새 조회가 기존 확정을 취소하지 않는다");
  assert.equal(db.sqlite.prepare("SELECT status FROM program_ext_link WHERE source_id = ?").get(oldRefId).status, "VERIFIED");
  const records = db.sqlite.prepare("SELECT query_date, retrieved_via FROM law_reference ORDER BY query_date").all();
  assert.equal(records.length, 2);
  assert.match(records[0].retrieved_via, /korean-law-mcp 4\.15\.5/);
  assert.match(records[1].retrieved_via, /korean-law-mcp 4\.15\.6/);
  const oldLink = db.sqlite.prepare("SELECT evidence_json FROM program_ext_link WHERE source_id = ?").get(oldRefId);
  assert.match(JSON.parse(oldLink.evidence_json).retrieved_via, /korean-law-mcp 4\.15\.5/);
  assert.deepEqual(db.sqlite.prepare("SELECT package_version FROM law_import ORDER BY query_date").all().map((row) => row.package_version), ["korean-law-mcp@4.15.5", "korean-law-mcp@4.15.6"]);
  assert.equal((await programPublicInfo(db, item([]).target_id)).legal_basis.references.length, 1, "기존 확정 근거만 공개한다");
});

test("연계 현황: 수집 전에는 미수집, 키 없음은 인증키 필요로 표시하고 실패를 성공으로 바꾸지 않는다", async () => {
  const db = database();
  let status = await integrationStatus(db);
  assert.equal(status.length, 7);
  assert.ok(status.every((row) => row.state === "NOT_COLLECTED"));
  await runToEnd(db, deps(async () => response(200, ""), { key: null }), "mois.legal_dong", "all");
  status = await integrationStatus(db);
  assert.equal(status.find((row) => row.dataset_key === "mois.legal_dong").state, "AUTH_REQUIRED");
  const demand = await careDemand(db, "region:서울특별시|중랑구", "2026-10-05");
  assert.equal(demand.institutions.count, null, "미수집은 0이 아니라 null");
  assert.equal(demand.indicators[0].value, null);
  assert.equal(demand.indicators[0].reason, "장기요양기관 미수집");
  assert.ok(demand.stats.every((stat) => stat.table_status === "CANDIDATE" && stat.series.length === 0));
  const list = await careInstitutions(db, "region:서울특별시|중랑구", "2026-10-05", { offset: 0, limit: 10 });
  assert.deepEqual({ total: list.total, state: list.state }, { total: null, state: "NOT_COLLECTED" }, "수집 전 기관 목록은 0곳이 아니다");
});

test("법정동코드 API 응답 해석: 리 단위 제외·총건수 유지, 명세에 없는 형식은 해석 오류", () => {
  const body = JSON.stringify({ StanReginCd: [{ head: [{ totalCount: 3 }, { numOfRows: "1000", pageNo: "1", type: "JSON" }, { RESULT: { resultCode: "INFO-0", resultMsg: "NOMAL SERVICE" } }] }, { row: [
    { region_cd: "4812313400", sido_cd: "48", sgg_cd: "123", umd_cd: "134", ri_cd: "00", locatadd_nm: "경상남도 창원시 성산구 용지동", adpt_de: "20210701" },
    { region_cd: "4812331021", sido_cd: "48", sgg_cd: "123", umd_cd: "310", ri_cd: "21", locatadd_nm: "경상남도 창원시 성산구 대산면 어떤리", adpt_de: "20100701" },
    { region_cd: "4812300000", sido_cd: "48", sgg_cd: "123", umd_cd: "000", ri_cd: "00", locatadd_nm: "경상남도 창원시 성산구", adpt_de: "20100701" },
  ] }] });
  assert.equal(classifyDataGoKr(200, "application/json", body, null).kind, "OK");
  const parsed = parseLegalDong(body);
  assert.equal(parsed.total, 3);
  assert.equal(parsed.rowsReceived, 3);
  assert.deepEqual(parsed.records.map((record) => record.recordId), ["4812313400", "4812300000"]);
  assert.equal(parseLegalDong("{\"other\":1}").kind, "PARSE_ERROR");
  assert.equal(parseLtcSearch("not xml").kind, "PARSE_ERROR");
  assert.equal(parseLtcGeneral("<response><body></body></response>", "1").records.length, 0);
  assert.equal(parseLtcPartners("<response><body><items></items><totalCount>0</totalCount></body></response>", "1").total, 0);
});


test("돌봄자원은 웹과 MCP 모두 비공개(CARE_RESOURCES_PUBLIC=false, CARE_RESOURCES_MCP=false)이고 내부 조회 함수와 정부24·법정동 연계는 유지된다", async () => {
  const { handleMcpRequest } = await import("./mcp/server.ts");
  const { McpData } = await import("./mcp/data.ts");
  const db = database();
  await runToEnd(db, deps(ltcFetcher(ltcRows()).fetcher), "nhis.ltc_search", "sido:48");
  const rpc = async (name, args) => {
    const responseBody = await (await handleMcpRequest(new Request("https://dashboard.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }), new McpData(db, async () => new Map()), (error) => { throw error; })).json();
    return responseBody;
  };
  const call = async (name, args) => (await rpc(name, args)).result.structuredContent;
  const web = await careDemand(db, "region:경상남도|창원시", "2026-10-05");
  assert.equal(CARE_RESOURCES_PUBLIC, false);
  assert.equal(CARE_RESOURCES_MCP, false);
  assert.ok(web.institutions.count > 0);
  for (const toolName of CARE_TOOL_NAMES) {
    const blocked = await rpc(toolName, { region_id: "region:경상남도|창원시" });
    assert.ok(blocked.error || blocked.result?.isError, toolName + "은 MCP에서 차단되어야 한다");
  }
  const found = await careInstitutions(db, "region:경상남도|창원시", "2026-10-05", { offset: 0, limit: 5 });
  assert.ok(found.items.length > 0);
  const institutionId = found.items[0].institution_id;
  assert.match(institutionId, /^ltc:\d{11}$/);
  const detail = await careInstitution(db, institutionId, "2026-10-05");
  assert.ok(detail, "내부 careInstitution 함수는 수집된 기관 상세를 보존한다");
  const status = await call("get_integration_status", {});
  assert.equal(status.data.datasets.find((row) => row.dataset_key === "nhis.ltc_search"), undefined, "돌봄자원 원천은 MCP 연계 현황에서 제외");
  assert.equal(status.data.datasets.find((row) => row.dataset_key === "moleg.law"), undefined, "법령 원천은 MCP 연계 현황에서 제외");
  assert.equal(status.data.datasets.find((row) => row.dataset_key === "mois.gov24_list").state, "NOT_COLLECTED");
  const program = await call("get_program_public_info", { implementation_id: "service:none|서울특별시|중랑구|a|b|c" });
  assert.equal(program.data.gov24.state, "NOT_COLLECTED", "수집 전이면 미수집(0건 아님)");
  const seoul = ltcFetcher([
    ltcItem("31168000154", "C01", "강남세곡 행복케어", "11", "680"),
    ltcItem("31168000155", "C03", "강남세곡 행복케어 목욕", "11", "680"),
    ltcItem("31115000154", "C01", "강남세곡 행복케어", "11", "150"),
    ltcItem("31168000156", "C01", "강남세곡 100%_케어", "11", "680"),
  ]);
  assert.equal((await runToEnd(db, deps(seoul.fetcher), "nhis.ltc_search", "sido:11")).status, "SUCCEEDED");
  for (const query of ["강남세곡 행복케어", "강남세곡행복케어", "행복케어 강남세곡", "강남세곡·행복케어"]) {
    const result = await careInstitutions(db, "region:서울특별시|강남구", "2026-10-05", { group: "HOME_VISIT_CARE", query, offset: 0, limit: 5 });
    assert.deepEqual(result.items.map((item) => item.institution_id), ["ltc:31168000154"], query);
  }
  for (const query of ["강남세곡행복케어 우주여행", "행복케어%", "행복케어_", "행복케어\\"]) {
    const result = await careInstitutions(db, "region:서울특별시|강남구", "2026-10-05", { group: "HOME_VISIT_CARE", query, offset: 0, limit: 5 });
    assert.deepEqual(result.items, [], query);
  }
  const literal = await careInstitutions(db, "region:서울특별시|강남구", "2026-10-05", { group: "HOME_VISIT_CARE", query: "100%_케어", offset: 0, limit: 5 });
  assert.deepEqual(literal.items.map((item) => item.institution_id), ["ltc:31168000156"]);
});
