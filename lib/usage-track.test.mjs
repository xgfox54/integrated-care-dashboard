// 브라우저 진입 모듈(track.ts) 시험: 동의 창 없이 수집 대상, 개발 모드 이중 실행, 통계에서 빼기·추적 거부 신호 뒤 미수집.
import assert from "node:assert/strict";
import { test } from "node:test";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

globalThis.window = {
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  innerWidth: 1400,
  dispatchEvent() {},
  addEventListener() {},
};

const track = await import("./usage/track.ts");
const preference = await import("./usage/preference.ts");

function fakeSink() {
  const sent = [];
  const opened = [];
  return {
    sent,
    opened,
    send: (event) => sent.push(event),
    setTab: (tab) => opened.push("tab:" + tab),
    openEntity: (viewId) => opened.push("entity:" + viewId),
    closeEntity: (viewId) => opened.push("close:" + viewId),
    isComposing: () => false,
  };
}

test("제외 신호가 없는 브라우저: 동의 창 없이 모으고, 개발 모드처럼 두 번 불려도 화면 조회·상세 열람은 한 번만 보낸다", () => {
  assert.equal(preference.isUsageExcluded(), false);
  track.usagePage("wiki", "wiki");
  track.usagePage("wiki", "wiki");
  const viewId = track.newUsageId();
  const key = "service:1|a|b|c|d|e";
  track.usageEntityOpen(viewId, "care_program", key, "direct");
  track.usageEntityClose(viewId);
  track.usageEntityOpen(viewId, "care_program", key, "direct");
  const sink = fakeSink();
  const { backlog, context } = track.attachUsageSink(sink);
  assert.deepEqual(backlog.map((event) => event.type), ["page_view", "tab_view", "entity_view"]);
  assert.equal(context.tab, "wiki");
  assert.equal(context.entities.size, 1);
  assert.notEqual(context.measuredSince, null);
  // 붙은 뒤에도 같은 viewId로 다시 열면 열람을 다시 세지 않는다.
  track.usageEntityOpen(viewId, "care_program", key, "direct");
  assert.equal(sink.sent.filter((event) => event.type === "entity_view").length, 0);
  // 활성 탭을 다시 고르면 세지 않는다.
  track.usageTab("wiki");
  assert.equal(sink.sent.length, 0);
});

test("통계에서 빼면 어떤 이벤트도 보내지 않고 임시 연결값을 지운다", () => {
  track.setUsageHandoff("welfare_policy", "livelihood-benefit", "list");
  assert.ok(window.localStorage.getItem("icd-usage-handoff"));
  track.detachUsageSink("off");
  assert.equal(window.localStorage.getItem("icd-usage-handoff"), null);
  assert.equal(track.usageSearch({ scope: "care_wiki", failed: false, count: 3, match: null }), undefined);
  track.usageFilter("care_region", "부산광역시");
  const handle = track.startUsageAction("care_csv");
  handle.success(10);
  assert.equal(track.isUsageActive(), false);
});

test("「통계에서 빼기」를 고른 브라우저는 화면을 열어도 아무것도 쌓지 않는다", async () => {
  preference.writeOptOut(true);
  assert.equal(window.localStorage.getItem("icd-usage-optout"), "1");
  const fresh = await import("./usage/track.ts?optout");
  fresh.usagePage("welfare_list", "welfare100");
  assert.equal(fresh.isUsageActive(), false);
  assert.equal(fresh.usageSearch({ scope: "welfare_catalog", failed: false, count: 1, match: null }), undefined);
  preference.writeOptOut(false);
  assert.equal(window.localStorage.getItem("icd-usage-optout"), null);
  assert.equal(preference.isUsageExcluded(), false);
});

test("추적 거부 신호(GPC·DNT)를 보내는 브라우저는 따로 고르지 않아도 모으지 않는다", async () => {
  for (const [name, value] of [["globalPrivacyControl", true], ["doNotTrack", "1"]]) {
    Object.defineProperty(globalThis.navigator, name, { value, configurable: true });
    try {
      assert.equal(preference.isUsageExcluded(), true, name);
      const fresh = await import("./usage/track.ts?" + name);
      fresh.usagePage("dashboard", "dashboard_search");
      assert.equal(fresh.isUsageActive(), false, name);
    } finally {
      delete globalThis.navigator[name];
    }
  }
  assert.equal(preference.isUsageExcluded(), false);
});

test("같은 탭에서 수집이 꺼져 있다고 확인했으면 화면 이벤트를 쌓지 않는다", async () => {
  window.sessionStorage.setItem("icd-usage-config", JSON.stringify({ enabled: false, policy: (await import("./usage/codes.ts")).USAGE_POLICY_VERSION, at: Date.now() }));
  try {
    const fresh = await import("./usage/track.ts?disabled");
    fresh.usagePage("sources", "sources");
    assert.equal(fresh.isUsageActive(), false);
  } finally {
    window.sessionStorage.removeItem("icd-usage-config");
  }
});

test("검색 이벤트에는 검색어가 없고, 명칭 일치일 때만 대상 키가 붙는다", () => {
  const sink = fakeSink();
  track.attachUsageSink(sink);
  track.usageSearch({ scope: "care_wiki", failed: false, count: 12, match: { status: "ambiguous" } });
  track.usageSearch({ scope: "welfare_catalog", failed: false, count: 1, match: { status: "matched", key: "livelihood-benefit" } });
  track.usageSearch({ scope: "care_dashboard", failed: true, count: 0, match: { status: "matched", key: "x" } });
  assert.deepEqual(
    sink.sent.map((event) => [event.results, event.match, event.key ?? null, event.status]),
    [
      ["11-50", "ambiguous", null, "ok"],
      ["1", "matched", "livelihood-benefit", "ok"],
      ["0", "unmatched", null, "error"],
    ],
  );
  assert.deepEqual(Object.keys(sink.sent[0]).sort(), ["id", "match", "results", "scope", "search", "status", "type"]);
  track.detachUsageSink("off");
});
