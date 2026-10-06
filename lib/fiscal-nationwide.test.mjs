// 243개 자치단체 전체 세출(광역별 범위 합산)·행정시(제주시·서귀포시)·주 1회 기준일·오래된 snapshot 정리.
import assert from "node:assert/strict";
import test from "node:test";

import { cadenceTarget, scopeCadenceDays } from "./fiscal/cadence.ts";
import { advanceRun, readScope, setScopeApproval, startRun } from "./fiscal/collect.ts";
import { parseBudgetRequest, readBudget } from "./fiscal/public.ts";
import { advanceIntegratedCareClassification } from "./fiscal/classify.ts";
import { purgeOldPeriodicSnapshots } from "./fiscal/retention.ts";
import { NOW, database } from "./press-test-support.mjs";

function row(index, overrides) {
  return {
    fyr: "2026", acnt_dv_cd: "100", acnt_dv_nm: "일반회계", dbiz_cd: "D" + String(index).padStart(6, "0"), dbiz_nm: "복지사업 " + index,
    exe_ymd: "20261002", bdg_cash_amt: 1000, bdg_ntep: 0, capep: 1000, sggep: 0, etc_amt: 0, ep_amt: 500, cpl_amt: 1000,
    fld_cd: "080", fld_nm: "사회복지", ane_part_cd: "082", part_nm: "노인", padm_laf_cd: "6500000", lup_ord: 1, zon_cd: "49", ...overrides,
  };
}

test("예산 기본 조회는 사회복지이며 500쪽 이후도 요청한 쪽을 유지한다", () => {
  const normal = parseBudgetRequest(new URLSearchParams("page=501"));
  assert.ok(normal.ok);
  assert.equal(normal.request.mode, "social_welfare");
  assert.equal(normal.request.page, 501);
  const last = parseBudgetRequest(new URLSearchParams("page=4686"));
  assert.ok(last.ok);
  assert.equal(last.request.page, 4686);
});
const JEJU = { wa_laf_cd: "4900000", wa_laf_hg_nm: "제주", laf_cd: "4900000", laf_hg_nm: "제주본청" };
const SEOUL = { wa_laf_cd: "1100000", wa_laf_hg_nm: "서울", laf_cd: "1100000", laf_hg_nm: "서울본청" };
const JONGNO = { wa_laf_cd: "1100000", wa_laf_hg_nm: "서울", laf_cd: "1111000", laf_hg_nm: "서울종로구" };

function body(rows) {
  return JSON.stringify({ QWGJK: [{ head: [{ list_total_count: rows.length }, { RESULT: { CODE: "INFO-000", MESSAGE: "정상" } }] }, { row: rows }] });
}

async function collect(db, scopeId, rows, date = "2026-10-02") {
  const scope = await readScope(db, scopeId);
  let id = 0;
  const deps = { fetcher: async () => ({ status: 200, headers: { get: () => "application/json" }, text: async () => body(rows) }), now: () => NOW, newId: () => scopeId + date + "-" + ++id, apiKey: "issued", stepBudgetMs: 60_000 };
  let run = await startRun(db, scope, date, "scheduled", deps);
  for (let step = 0; step < 10 && run.status === "RUNNING"; step += 1) run = await advanceRun(db, run, deps);
  assert.equal(run.status, "SUCCEEDED", scopeId);
  return run;
}

async function seeded() {
  const db = database();
  await setScopeApproval(db, "qwgjk:jeju-full", true, NOW);
  await collect(db, "qwgjk:jeju-full", [
    row(1, { ...JEJU, dept_cd: "3005060" }), row(2, { ...JEJU, dept_cd: "4005010" }), row(3, { ...JEJU, dept_cd: "4005301" }), row(4, { ...JEJU, dept_cd: "1003001", acnt_dv_cd: "300", acnt_dv_nm: "기금" }),
    row(5, { ...JEJU, dept_cd: "1003002", fld_cd: "140", fld_nm: "보건", ane_part_cd: "141", part_nm: "보건의료", acnt_dv_cd: "200", acnt_dv_nm: "특별회계" }),
  ]);
  await collect(db, "qwgjk:full-1100000", [row(11, { ...SEOUL, dept_cd: "1037030" }), row(12, { ...JONGNO, dept_cd: "3000100" })]);
  return db;
}

const request = (query) => {
  const parsed = parseBudgetRequest(new URLSearchParams(query));
  assert.ok(parsed.ok);
  return parsed.request;
};

test("사회복지 조회는 광역별 전체 세출 범위를 합쳐 광역·기초 자치단체를 모두 보여 준다", async () => {
  const db = await seeded();
  const data = await readBudget(db, request("mode=social_welfare"));
  assert.equal(data.unavailable, null);
  assert.equal(data.snapshot_set.length, 2);
  assert.equal(data.total, 6, "제주 사회복지 4건 + 서울본청·종로구 2건(보건 1건 제외)");
  assert.deepEqual(data.modes.map((mode) => mode.label), ["사회복지", "통합돌봄", "보건", "기관별"]);
  assert.equal(data.filters.known_local_governments, 3);
  assert.equal(data.filters.published_local_governments, 3);
  assert.deepEqual(data.filters.accounts.map((account) => account.code).sort(), ["100", "300"], "보건 분야만 있는 회계는 사회복지 선택 목록에서 제외한다");
  const seoul = await readBudget(db, request("mode=social_welfare&region=1100000"));
  assert.deepEqual(seoul.filters.entities.map((entity) => [entity.name, entity.project_count]), [["서울본청", 1], ["서울종로구", 1]]);
  const jongno = await readBudget(db, request("mode=social_welfare&region=1100000&entity=lofin:laf:1111000"));
  assert.deepEqual(jongno.items.map((item) => item.fiscal_entity.name), ["서울종로구"]);
});

test("행정시는 제주본청 세출 가운데 부서코드 앞자리로 고른다", async () => {
  const db = await seeded();
  const jeju = await readBudget(db, request("mode=social_welfare&region=4900000"));
  assert.deepEqual(jeju.filters.entities.map((entity) => entity.name), ["제주본청", "제주시(행정시)", "서귀포시(행정시)"]);
  assert.equal(jeju.filters.entities[0].project_count, 4, "기관 목록의 사업 수도 조회 모드의 분야만 센다(보건 1건 제외)");
  const seogwipo = await readBudget(db, request("mode=social_welfare&entity=admin:4900000:4"));
  assert.deepEqual(seogwipo.items.map((item) => item.department_code).sort(), ["4005010", "4005301"]);
  assert.equal(seogwipo.summary.current_budget_krw, "2000");
  assert.deepEqual(seogwipo.filters.accounts.map((account) => account.code), ["100"], "행정시 부서 범위 안에 있는 회계만 표시한다");
  const jejuSi = await readBudget(db, request("mode=social_welfare&entity=admin:4900000:3"));
  assert.deepEqual(jejuSi.items.map((item) => item.department_code), ["3005060"]);
  assert.equal((await readBudget(db, request("mode=social_welfare&entity=admin:4900000:9"))).unavailable.code, "UNKNOWN_ADMIN_UNIT");
});

test("등록 기관 수와 현재 공개본 수록 기관 수를 구분한다", async () => {
  const db = await seeded();
  await db.prepare("INSERT INTO fiscal_entity (fiscal_entity_id, code_system, code, name, wa_code, wa_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind("lofin:laf:9999000", "lofin", "9999000", "과거 수집 기관", "4900000", "제주", NOW, NOW).run();
  const data = await readBudget(db, request("mode=social_welfare"));
  assert.equal(data.filters.known_local_governments, 4);
  assert.equal(data.filters.published_local_governments, 3);
});

test("기관별은 기관(자치단체·행정시)을 고르면 그 기관의 전체 세출을 보여 준다", async () => {
  const db = await seeded();
  assert.equal((await readBudget(db, request("mode=department"))).unavailable.code, "ENTITY_REQUIRED");
  const data = await readBudget(db, request("mode=department&entity=admin:4900000:4"));
  assert.equal(data.total, 2);
  const jejuAll = await readBudget(db, request("mode=department&entity=lofin:laf:4900000"));
  assert.equal(jejuAll.total, 5, "보건 분야까지 전체 세출");
});

test("행정구(창원시 의창구 등)는 시 세출 가운데 부서코드 앞자리로 고르고 (행정구)로 표시한다", async () => {
  const db = database();
  const CHANGWON = { wa_laf_cd: "4800000", wa_laf_hg_nm: "경남", laf_cd: "4811000", laf_hg_nm: "경남창원시" };
  await collect(db, "qwgjk:full-4800000", [
    row(21, { ...CHANGWON, dept_cd: "1003002" }), row(22, { ...CHANGWON, dept_cd: "3005005" }),
    row(23, { ...CHANGWON, dept_cd: "4005020" }), row(24, { ...CHANGWON, dept_cd: "7005020" }),
  ]);
  const city = await readBudget(db, request("mode=department&region=4800000&entity=lofin:laf:4811000"));
  assert.equal(city.total, 4);
  const names = city.filters.entities.map((entity) => entity.name);
  for (const gu of ["의창구", "성산구", "마산합포구", "마산회원구", "진해구"]) assert.ok(names.includes("창원시 " + gu + "(행정구)"), gu);
  const uichang = await readBudget(db, request("mode=department&region=4800000&entity=admin:4811000:3"));
  assert.deepEqual(uichang.items.map((item) => item.department_code), ["3005005"]);
  const jinhae = await readBudget(db, request("mode=social_welfare&region=4800000&entity=admin:4811000:7"));
  assert.equal(jinhae.total, 1);
  // 화성시 병점구처럼 부서코드 묶음이 둘(2005·2120)인 행정구는 둘 다 고른다.
  const HWASEONG = { wa_laf_cd: "4100000", wa_laf_hg_nm: "경기", laf_cd: "4134000", laf_hg_nm: "경기화성시" };
  await collect(db, "qwgjk:full-4100000", [
    row(31, { ...HWASEONG, dept_cd: "2005001" }), row(32, { ...HWASEONG, dept_cd: "2120010" }), row(33, { ...HWASEONG, dept_cd: "2006001" }), row(34, { ...HWASEONG, dept_cd: "2103001" }),
  ]);
  const byeongjeom = await readBudget(db, request("mode=department&region=4100000&entity=admin:4134000:2005"));
  assert.deepEqual(byeongjeom.items.map((item) => item.department_code).sort(), ["2005001", "2120010"]);
});

test("시간 초과로 줄인 쪽 크기는 응답이 빨라지면 경계에서 되돌리고 행을 빠뜨리지 않는다", async () => {
  const db = database();
  // 운영 D1과 같이 쿼리 하나의 바인딩 변수를 100개로 제한한다(로컬 SQLite는 더 많이 받아 이 결함을 놓쳤다).
  const prepare = db.prepare;
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      assert.ok(values.length <= 100, "D1 변수 100개 초과(" + values.length + "): " + sql.slice(0, 80));
      return bind(...values);
    };
    return statement;
  };
  const all = Array.from({ length: 1200 }, (_, index) => row(100 + index, { ...SEOUL, dept_cd: "1037030" }));
  let timeouts = 1;
  const sizes = [];
  const fetcher = async (url) => {
    const params = new URL(url).searchParams;
    const size = Number(params.get("pSize"));
    const pageIndex = Number(params.get("pIndex"));
    sizes.push(size);
    if (size === 500 && timeouts > 0) { timeouts -= 1; throw new Error("timeout"); }
    const rows = all.slice((pageIndex - 1) * size, pageIndex * size);
    return { status: 200, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ QWGJK: [{ head: [{ list_total_count: all.length }, { RESULT: { CODE: "INFO-000", MESSAGE: "정상" } }] }, { row: rows }] }) };
  };
  let id = 0;
  const deps = { fetcher, now: () => NOW, newId: () => "grow-" + ++id, apiKey: "issued", stepBudgetMs: 60_000 };
  let run = await startRun(db, await readScope(db, "qwgjk:full-1100000"), "2026-10-02", "scheduled", deps);
  for (let step = 0; step < 20 && run.status === "RUNNING"; step += 1) run = await advanceRun(db, run, deps);
  assert.equal(run.status, "SUCCEEDED");
  assert.equal(run.received_rows, 1200);
  assert.ok(sizes.includes(250) && sizes.lastIndexOf(500) > sizes.indexOf(250), "줄였다가 다시 500건으로 받는다: " + sizes.join(","));
  assert.equal(db.sqlite.prepare("SELECT unique_count FROM fiscal_snapshot WHERE run_id = ?").get(run.run_id).unique_count, 1200);
});

test("통합돌봄 WIKI 사업명과 세부사업명이 같은 지자체에서 일치하면 통합돌봄 예산이고, 사회복지 합계에 포함한다", async () => {
  const db = await seeded();
  const wiki = [["w1", "서울특별시", "종로구", "어르신 안부 확인 서비스"], ["w2", "서울특별시", "종로구", "방문 건강관리"], ["w3", "제주특별자치도", "서귀포시", "희망 돌봄"]];
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('run-1', 'manual', 'succeeded', ?, ?)").run(NOW - 60, NOW);
  for (const [id, sido, sigungu, name] of wiki) {
    db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at) VALUES (?, ?, 'run-1', ?, ?, '일상생활돌봄', '안부확인', ?, '', '', '', '', '지역특화', '1', 'https://www.mohw.go.kr/', '2026-04', ?)")
      .run(id, "svc-" + id, sido, sigungu, name, NOW);
  }
  // 서울(본청·종로구)과 제주 전체 세출을 다시 받는다. 보건 분야(140)의 「방문건강관리」도 통합돌봄 WIKI 사업이다.
  await collect(db, "qwgjk:full-1100000", [
    row(41, { ...JONGNO, dept_cd: "3000100", dbiz_nm: "어르신 안부확인 서비스" }),
    row(42, { ...JONGNO, dept_cd: "3000200", dbiz_nm: "방문건강관리", fld_cd: "140", fld_nm: "보건", ane_part_cd: "141", part_nm: "보건의료" }),
    row(43, { ...JONGNO, dept_cd: "3000100", dbiz_nm: "어르신 안부확인 서비스 확대" }),
    row(44, { ...SEOUL, dept_cd: "1037030", dbiz_nm: "통합돌봄 지원사업" }),
  ], "2026-10-09");
  await collect(db, "qwgjk:jeju-full", [
    row(45, { ...JEJU, dept_cd: "4005010", dbiz_nm: "희망돌봄" }),
    row(46, { ...JEJU, dept_cd: "3005010", dbiz_nm: "희망돌봄" }),
    row(47, { ...JEJU, dept_cd: "4005020", dbiz_nm: "경로당 운영" }),
  ], "2026-10-09");
  for (let step = 0; step < 20 && await advanceIntegratedCareClassification(db, NOW, 60_000); step += 1);
  const care = await readBudget(db, request("mode=integrated_care"));
  assert.equal(care.unavailable, null);
  const byName = Object.fromEntries(care.items.map((item) => [item.name + "@" + item.department_code, item.integrated_care?.basis]));
  assert.deepEqual(byName, {
    "어르신 안부확인 서비스@3000100": "wiki_name_match", "방문건강관리@3000200": "wiki_name_match", "통합돌봄 지원사업@1037030": "name_keyword", "희망돌봄@4005010": "wiki_name_match",
  }, "띄어쓰기만 다른 이름은 일치, 「확대」가 붙은 이름은 불일치, 서귀포시 사업은 서귀포시 부서코드(4)에서만");
  assert.ok(care.notes.some((note) => note.includes("통합돌봄 WIKI")));
  const welfare = await readBudget(db, request("mode=social_welfare"));
  const fieldOnly = welfare.items.filter((item) => item.classification.field_name === "사회복지").length;
  assert.equal(welfare.total, fieldOnly + 1, "보건 분야인 통합돌봄 사업(방문건강관리)도 사회복지에 포함");
  assert.ok(welfare.items.some((item) => item.name === "방문건강관리"));
  assert.equal(BigInt(welfare.summary.current_budget_krw) >= BigInt(care.summary.current_budget_krw), true, "통합돌봄 ⊂ 사회복지");
});


test("주 1회 범위는 기준일 이하의 가장 가까운 금요일에 받는다", async () => {
  const db = database();
  assert.equal(scopeCadenceDays(await readScope(db, "qwgjk:full-4100000")), 7);
  assert.equal(scopeCadenceDays(await readScope(db, "qwgjk:jeju-full")), 1);
  assert.equal(cadenceTarget("2026-10-04", 7), "2026-10-02");
  assert.equal(cadenceTarget("2026-10-02", 7), "2026-10-02");
  assert.equal(cadenceTarget("2026-10-08", 7), "2026-10-02");
  assert.equal(cadenceTarget("2026-10-04", 1), "2026-10-04");
});

test("주기 범위는 최근 공개본 2개만 행 자료를 남기고 오래된 것은 지운 뒤 PURGED로 표시한다", async () => {
  const db = database();
  const rows = [row(11, { ...SEOUL, dept_cd: "1037030" })];
  for (const date of ["2026-09-18", "2026-09-25", "2026-10-02"]) await collect(db, "qwgjk:full-1100000", rows.map((item) => ({ ...item, exe_ymd: date.replaceAll("-", "") })), date);
  const oldest = db.sqlite.prepare("SELECT snapshot_id, run_id FROM fiscal_snapshot WHERE scope_id = 'qwgjk:full-1100000' AND requested_reference_date = '2026-09-18'").get();
  assert.equal(await purgeOldPeriodicSnapshots(db, ["qwgjk:full-1100000"], [oldest.snapshot_id]), false, "활성 공개본에 고정된 snapshot은 지우지 않는다");
  while (await purgeOldPeriodicSnapshots(db, ["qwgjk:full-1100000"], null)) { /* 조금씩 지운다 */ }
  assert.equal(db.sqlite.prepare("SELECT status FROM fiscal_snapshot WHERE snapshot_id = ?").get(oldest.snapshot_id).status, "PURGED");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_snapshot_member WHERE snapshot_id = ?").get(oldest.snapshot_id).n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_observation WHERE run_id = ?").get(oldest.run_id).n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_snapshot WHERE scope_id = 'qwgjk:full-1100000' AND status = 'PUBLISHED'").get().n, 2);
});

test("화면용 나눠 받기: view=main은 조건 목록 없이 같은 결과, view=filters는 같은 조건 목록만 돌려준다", async () => {
  const db = await seeded();
  for (const query of ["mode=social_welfare", "mode=social_welfare&region=4900000", "mode=department", "mode=health&page=2"]) {
    const full = await readBudget(db, request(query));
    const main = await readBudget(db, request(query + "&view=main"));
    const filters = await readBudget(db, request(query + "&view=filters"));
    const { filters: fullFilters, ...rest } = full;
    assert.equal("filters" in main, false, query);
    assert.deepEqual(main, rest, query);
    assert.deepEqual(filters, { mode: full.mode, filters: fullFilters }, query);
  }
  assert.equal(parseBudgetRequest(new URLSearchParams("view=all")).ok, false);
});
