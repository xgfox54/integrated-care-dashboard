import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ActivityClock } from "./usage/activity.ts";
import { normalizeName, resultBucket, kstDay, msSinceKstMidnight } from "./usage/codes.ts";
import { csvCell } from "./usage/report-csv.ts";
import { parseUsageEvent } from "./usage/schema.ts";

test("활동시간: 전경 20초 + 숨김 120초 + 상호작용 뒤 전경 10초는 30초", () => {
  const clock = new ActivityClock(0, true);
  let total = 0;
  total += clock.setVisible(20_000, false);
  total += clock.setVisible(140_000, true);
  total += clock.interact(140_000);
  total += clock.accrue(150_000);
  assert.equal(total, 30_000);
});

test("활동시간: 마지막 상호작용 뒤 60초가 지나면 더하지 않고, 복귀만으로는 다시 세지 않는다", () => {
  const clock = new ActivityClock(0, true);
  let total = clock.accrue(15_000) + clock.accrue(30_000) + clock.accrue(600_000);
  assert.equal(total, 60_000);
  total += clock.setVisible(700_000, false) + clock.setVisible(800_000, true) + clock.accrue(820_000);
  assert.equal(total, 60_000);
  total += clock.interact(820_000) + clock.accrue(830_000);
  assert.equal(total, 70_000);
});

test("활동시간: 절전으로 시각이 크게 건너뛰어도 마지막 상호작용 뒤 60초까지만 더한다", () => {
  const clock = new ActivityClock(0, true);
  const total = clock.interact(10_000) + clock.accrue(10_000 + 8 * 3600_000);
  assert.equal(total, 70_000);
});

test("명칭 정규화·결과 구간·한국시간", () => {
  assert.equal(normalizeName(" 방문 건강관리 사업 "), "방문건강관리사업");
  assert.equal(normalizeName("ＡＢＣ 돌봄"), "abc돌봄");
  assert.deepEqual([0, 1, 7, 50, 51, 999].map(resultBucket), ["0", "1", "2-10", "11-50", "51-200", "201+"]);
  assert.equal(kstDay(Date.parse("2026-09-24T14:59:59Z")), "2026-09-24");
  assert.equal(kstDay(Date.parse("2026-09-24T15:00:00Z")), "2026-09-25");
  assert.equal(msSinceKstMidnight(Date.parse("2026-09-24T15:00:10Z")), 10_000);
});

test("관리자 CSV 셀은 수식으로 실행되지 않는다", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("@x"), "'@x");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell(-5), "-5");
});

test("이벤트 형식: 좌표·검색어·주소 같은 필드는 어느 이벤트에도 들어갈 수 없다", () => {
  const id = "a".repeat(22);
  const base = { type: "filter", id, filter: "care_region", code: "부산광역시" };
  assert.ok(parseUsageEvent(base));
  for (const extra of [{ lat: 35.1 }, { query: "홍길동" }, { url: "/?q=x" }, { referrer: "x" }, { userAgent: "x" }, { visitor: "x" }]) {
    assert.equal(parseUsageEvent({ ...base, ...extra }), null);
  }
  assert.equal(parseUsageEvent({ type: "search", id, search: id, scope: "care_wiki", status: "ok", results: "1", match: "matched" }), null);
  assert.equal(parseUsageEvent({ type: "action", id, action: "source_link", outcome: "click", dest: "bokjiro", op: id }), null);
});

test("수집 모듈은 위치 API(Geolocation, /api/geo)를 쓰지 않고 이벤트에 원문 문자열을 넣지 않는다", () => {
  const files = ["track.ts", "collector.ts", "preference.ts", "use-search-usage.ts", "activity.ts"].map((name) =>
    readFileSync(new URL("./usage/" + name, import.meta.url), "utf8"),
  );
  for (const source of files) {
    assert.ok(!source.includes("geolocation"), "geolocation");
    assert.ok(!source.includes("/api/geo"), "/api/geo");
    assert.ok(!source.includes("document.referrer"), "referrer");
    assert.ok(!source.includes("location.href\""), "href");
  }
});

test("복지제도 이용통계 등록부가 목록 색인과 같은 제도를 담는다", () => {
  const lite = JSON.parse(readFileSync(new URL("../public/data/welfare100/index-lite.json", import.meta.url), "utf8"));
  const registry = JSON.parse(readFileSync(new URL("../data/welfare100/usage-registry.json", import.meta.url), "utf8"));
  const slug = (index) => index.items.map((row) => row[index.fields.indexOf("s")]);
  assert.deepEqual(slug(registry), slug(lite));
});
