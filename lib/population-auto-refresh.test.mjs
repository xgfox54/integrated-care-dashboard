import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { runStatisticsRefresh } from "./statistics/background.ts";
import { POPULATION_DATASETS, POPULATION_PAGE_URLS } from "./statistics/population.ts";
import { claimStatisticsWorker, releaseStatisticsWorker, readCurrentStatistics, readCurrentStatisticsSnapshots,
  POPULATION_SCOPE, STATISTICS_DAY, STATISTICS_HOUR } from "./statistics/store.ts";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const KINDS = ["age", "older", "children"];
const IDS = ["population:middle-aged", "population:older", "population:children"];
const FILES = { age: "mois-age-202609.web.txt", older: "mois-elderly-202609.web.txt", children: "mois-child-202609.web.txt" };
const SOURCE = Object.fromEntries(KINDS.map(kind => {
  const text = readFileSync(new URL("../docs/statistics/population-2026-09/" + FILES[kind], import.meta.url), "utf8");
  const lines = text.split("\n").filter(line => /^L\d+:/.test(line)).map(line => line.replace(/^L\d+:\s*/, ""));
  const start = lines.findIndex(line => /^행정기관코드\s*\|/.test(line));
  const end = lines.findIndex(line => /^\d+\s*\|/.test(line));
  const headers = lines.slice(start, end).filter(line => line.includes("|") && !line.startsWith("---")).map(line => line.split("|").map(cell => cell.trim()));
  const rows = lines.filter(line => /^\d+\s*\|/.test(line)).map(line => {
    const [code, name, ...values] = line.split("|").map(cell => cell.trim());
    return { code, name, values };
  });
  assert.equal(headers.length, 3);
  assert.equal(rows.length, 17);
  return [kind, { title: lines.find(line => /^행정동별 .*인구현황$/.test(line)), headers, rows }];
}));
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const th = (text, attributes = "") => `<th${attributes}>${escapeHtml(text)}</th>`;
const tr = cells => "<tr>" + cells.join("") + "</tr>";
const numbers = row => row.values.map(value => Number(String(value).replaceAll(",", "")));

// Test-only reconstructed HTML: numeric cells and header labels come from the
// preserved official web-extracted text, which is not original source HTML.
// Future months and value corrections below are synthetic transmission scenarios.
function populationHtml(kind, period, rows) {
  const { headers, title } = SOURCE[kind];
  const [year, month] = period.split("-");
  const top = [th(headers[0][0], ' rowspan="3"'), th(headers[0][1], ' rowspan="3"'), th(`${year}년 ${month}월`, ` colspan="${SOURCE[kind].rows[0].values.length}"`)];
  const groups = kind === "age"
    ? headers[1].map(label => th(label, ' colspan="13"'))
    : headers[1].map((label, index) => th(label, index < 3 ? ' rowspan="2"' : ' colspan="3"'));
  const body = rows.map(row => tr([`<td>${escapeHtml(row.code)}</td>`, `<th scope="row">${escapeHtml(row.name)}</th>`, ...row.values.map(value => `<td>${escapeHtml(value)}</td>`)])).join("");
  return `<h2>${title}</h2><table><thead>${tr(top)}${tr(groups)}${tr(headers[2].map(label => th(label)))}</thead><tbody>${body}</tbody></table>`;
}

const scope = db => db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get(POPULATION_SCOPE);
const worker = db => db.sqlite.prepare("SELECT * FROM statistics_refresh_worker WHERE id = 1").get();
const publication = db => {
  const row = scope(db);
  return { result_json: row.result_json, previous_json: row.previous_json, revision: row.revision,
    latest_period: row.latest_period, last_success_at: row.last_success_at };
};
const visible = results => results.map(({ dataset, revision, checked_at, available_periods }) => ({ dataset, revision, checked_at, available_periods }));
async function readPopulation(db, now) {
  const results = (await readCurrentStatisticsSnapshots(db, now)).filter(result => IDS.includes(result.dataset.id));
  assert.deepEqual(results.map(result => result.dataset.id), IDS);
  for (const result of results) assert.deepEqual(await readCurrentStatistics(db, result.dataset.id, {}, now), result, "개별 읽기와 전체 읽기가 같은 게시본을 사용한다");
  return results;
}

async function fixture(t, { now = NOW, period = "2026-09" } = {}) {
  const db = database();
  t.after(() => db.sqlite.close());
  const clock = { now };
  assert.ok(await claimStatisticsWorker(db, clock.now, "population-fixture-setup"));
  await releaseStatisticsWorker(db, "population-fixture-setup");
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = ?").run(clock.now + 100 * STATISTICS_DAY);
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = 0 WHERE scope_id = ?").run(POPULATION_SCOPE);
  const context = {
    db, clock, calls: [], periods: Object.fromEntries(KINDS.map(kind => [kind, period])),
    rows: Object.fromEntries(KINDS.map(kind => [kind, structuredClone(SOURCE[kind].rows)])),
    run() {
      return runStatisticsRefresh(db, {
        now: () => clock.now, sleep: async milliseconds => { clock.now += milliseconds; }, timeoutMs: 100, maxSteps: 1,
        fetcher: async (url, init) => {
          context.calls.push({ url, at: clock.now, init });
          if (url === "https://jumin.mois.go.kr/robots.txt") return new Response("", { status: 404 });
          const kind = KINDS.find(kind => POPULATION_PAGE_URLS[kind] === url);
          assert.ok(kind, "인구 원문 고정 주소만 직접 요청한다");
          return new Response(populationHtml(kind, context.periods[kind], context.rows[kind]), { headers: { "content-type": "text/html; charset=utf-8" } });
        },
      });
    },
    dataCalls() { return context.calls.filter(call => new URL(call.url).pathname !== "/robots.txt"); },
    due() { clock.now = Math.max(clock.now, scope(db).next_check_at); },
  };
  return context;
}
async function complete(context) {
  assert.deepEqual(await context.run(), { status: "advanced", completed: 0, failed: 0, staged: 1 });
  assert.deepEqual(await context.run(), { status: "advanced", completed: 0, failed: 0, staged: 1 });
  assert.deepEqual(await context.run(), { status: "advanced", completed: 1, failed: 0, staged: 0 });
}
function checkAllSourceValues(results, rows, period) {
  for (const [index, rawAge] of rows.age.entries()) {
    const a = numbers(rawAge), older = numbers(rows.older[index]), children = numbers(rows.children[index]);
    const expected = [a[0] - a.slice(2, 6).reduce((total, count) => total + count, 0) - older[3], older[3], children[3]];
    for (const [group, result] of results.entries()) {
      const series = result.dataset.series.find(series => series.region?.code === rawAge.code);
      assert.equal(series.label, rawAge.name);
      assert.deepEqual(series.points, [{ period, value: expected[group], raw: String(expected[group]), status: "VALUE", total_population: a[0] }]);
    }
  }
}

test("인구 원문2개까지는 기존3종을 보존하고 세번째 완료 때 공통revision으로 한번에 게시한다", async t => {
  const context = await fixture(t, { now: Date.parse("2026-11-02T12:00:00Z"), period: "2026-10" });
  const before = visible(await readPopulation(context.db, context.clock.now));
  assert.deepEqual(before.map(result => result.dataset), POPULATION_DATASETS);
  const initialPublication = publication(context.db);
  for (let step = 0; step < 2; step++) {
    assert.deepEqual(await context.run(), { status: "advanced", completed: 0, failed: 0, staged: 1 });
    const stage = JSON.parse(scope(context.db).stage_json);
    assert.equal(stage.pages.length, step + 1);
    assert.deepEqual(stage.pages.map(page => page.kind), KINDS.slice(0, step + 1));
    assert.ok(stage.pages.every(page => page.rows.length === 17 && page.period === "2026-10"));
    assert.deepEqual(Object.keys(stage.source_hashes), KINDS.slice(0, step + 1));
    for (const kind of KINDS.slice(0, step + 1)) assert.equal(stage.source_hashes[kind], createHash("sha256").update(populationHtml(kind, context.periods[kind], context.rows[kind])).digest("hex"));
    assert.doesNotMatch(scope(context.db).stage_json, /<table|<tbody|<td/);
    assert.deepEqual(publication(context.db), initialPublication);
    const current = await readPopulation(context.db, context.clock.now);
    assert.deepEqual(visible(current), before);
    assert.ok(current.every(result => result.auto_refresh.status === "checking" && result.state === "VERIFIED_SNAPSHOT"));
    assert.equal(worker(context.db).lease_token, null);
  }
  assert.deepEqual(await context.run(), { status: "advanced", completed: 1, failed: 0, staged: 0 });
  const current = await readPopulation(context.db, context.clock.now);
  const row = scope(context.db);
  assert.equal(row.stage_json, null);
  assert.equal(row.latest_period, "2026-10");
  assert.equal(row.next_check_at, row.last_success_at + STATISTICS_DAY);
  assert.deepEqual(JSON.parse(row.result_json).map(result => result.dataset.id), IDS);
  assert.match(row.revision, /^mois-population:[a-f0-9]{24}$/);
  assert.ok(current.every(result => result.revision === row.revision && result.checked_at === new Date(row.last_success_at).toISOString()));
  assert.ok(current.every(result => result.auto_refresh.status === "current" && result.state === "CACHED"));
  assert.ok(current.every(result => result.dataset.population.reference_date === "2026-10-31"));
  checkAllSourceValues(current, context.rows, "2026-10");
  assert.deepEqual(context.dataCalls().map(call => call.url), Object.values(POPULATION_PAGE_URLS));
});

test("PC가3시간 간격으로 깨워도24시간 이내 D1 인구stage를 이어서 총3회 원문조회로 완료한다", async t => {
  const context = await fixture(t);
  await context.run();
  const firstStage = JSON.parse(scope(context.db).stage_json);
  const firstPage = firstStage.pages[0];
  const before = visible(await readPopulation(context.db, context.clock.now));
  context.clock.now += 3 * STATISTICS_HOUR;
  assert.equal((await context.run()).staged, 1);
  const secondStage = JSON.parse(scope(context.db).stage_json);
  assert.equal(secondStage.started_at, firstStage.started_at);
  assert.deepEqual(secondStage.pages[0], firstPage, "이전 Worker가 확인한 연령표를 다시 요청하지 않는다");
  assert.deepEqual(secondStage.pages.map(page => page.kind), ["age", "older"]);
  assert.deepEqual(visible(await readPopulation(context.db, context.clock.now)), before);
  assert.equal(scope(context.db).last_success_at, null);
  context.clock.now += 3 * STATISTICS_HOUR;
  assert.ok(context.clock.now - firstStage.started_at > 6 * STATISTICS_HOUR);
  assert.ok(context.clock.now - firstStage.started_at < STATISTICS_DAY);
  assert.equal((await context.run()).completed, 1);
  assert.equal(scope(context.db).stage_json, null);
  assert.deepEqual(context.dataCalls().map(call => call.url), Object.values(POPULATION_PAGE_URLS));
  assert.equal(context.calls.filter(call => new URL(call.url).pathname === "/robots.txt").length, 1, "동일 호스트의 robots 확인도24시간 동안 재사용한다");
  const current = await readPopulation(context.db, context.clock.now);
  checkAllSourceValues(current, context.rows, "2026-09");
  assert.ok(current.every(result => result.revision === scope(context.db).revision));
});

test("다음월 연령·고령표와 전월 아동표가 섞이면3종 모두 기존게시값·확인시각을 유지한다", async t => {
  const context = await fixture(t);
  await complete(context);
  const before = visible(await readPopulation(context.db, context.clock.now));
  const saved = publication(context.db);
  context.clock.now = Date.parse("2026-11-02T12:00:00Z");
  context.periods.age = "2026-10";
  context.periods.older = "2026-10";
  for (let step = 0; step < 2; step++) {
    assert.equal((await context.run()).staged, 1);
    assert.deepEqual(publication(context.db), saved);
    assert.deepEqual(visible(await readPopulation(context.db, context.clock.now)), before);
  }
  assert.deepEqual(await context.run(), { status: "advanced", completed: 0, failed: 1, staged: 0 });
  const row = scope(context.db);
  assert.equal(row.error_code, "SOURCE_PERIOD_MISMATCH");
  assert.equal(row.stage_json, null);
  assert.equal(row.failure_count, 1);
  assert.equal(row.next_check_at, context.clock.now + STATISTICS_HOUR);
  assert.deepEqual(publication(context.db), saved);
  const current = await readPopulation(context.db, context.clock.now);
  assert.deepEqual(visible(current), before);
  assert.ok(current.every(result => result.refresh_error === "SOURCE_PERIOD_MISMATCH" && result.auto_refresh.status === "retry_wait"));
  assert.ok(current.every(result => result.auto_refresh.last_success_at === new Date(saved.last_success_at).toISOString()));
  const calls = context.calls.length;
  await context.run();
  assert.equal(context.calls.length, calls, "재시도 예정 전에는 실패한 묶음을 다시 수집하지 않는다");
});

test("같은월 원문 정정도 최종원문 검증 뒤3종 revision을 함께 교체하고 이전게시본을 보관한다", async t => {
  const context = await fixture(t, { now: Date.parse("2026-11-02T12:00:00Z"), period: "2026-10" });
  await complete(context);
  const saved = publication(context.db);
  const before = visible(await readPopulation(context.db, context.clock.now));
  // A synthetic official correction: Jeju and national 65+ increase by3
  // (male1/female2), children by1 (male1); source age totals stay fixed.
  for (const index of [0, 16]) {
    for (const [column, amount] of [[3, 3], [4, 1], [5, 2]]) context.rows.older[index].values[column] = String(numbers(context.rows.older[index])[column] + amount);
    for (const column of [3, 4]) context.rows.children[index].values[column] = String(numbers(context.rows.children[index])[column] + 1);
  }
  context.due();
  for (let step = 0; step < 2; step++) {
    assert.equal((await context.run()).staged, 1);
    assert.deepEqual(publication(context.db), saved);
    assert.deepEqual(visible(await readPopulation(context.db, context.clock.now)), before);
  }
  assert.equal((await context.run()).completed, 1);
  const row = scope(context.db);
  assert.equal(row.latest_period, saved.latest_period);
  assert.notEqual(row.revision, saved.revision);
  assert.equal(row.previous_json, saved.result_json);
  assert.ok(row.last_success_at > saved.last_success_at);
  const corrected = await readPopulation(context.db, context.clock.now);
  checkAllSourceValues(corrected, context.rows, "2026-10");
  assert.ok(corrected.every(result => result.revision === row.revision && result.checked_at === new Date(row.last_success_at).toISOString()));
  const nationalValues = corrected.map(result => result.dataset.series.find(series => series.region.code === "0000000000").points[0].value);
  assert.deepEqual(nationalValues, [20_073_396, 11_313_619, 6_514_410]);
  const pinned = await readCurrentStatistics(context.db, IDS[0], { mode: "verified" }, context.clock.now);
  assert.deepEqual(pinned.dataset, POPULATION_DATASETS[0], "자동 갱신 이후에도 원래 검증본 조회는 고정된다");
});
