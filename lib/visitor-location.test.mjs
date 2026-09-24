import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

const boundaries = readFileSync(new URL("../public/data/geo/sido-boundaries.json", import.meta.url), "utf8");
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36";
const SEOGWIPO = { latitude: 33.2541, longitude: 126.5601 };
let caseNumber = 0;

/** 브라우저의 위치 권한·GPS·IP 응답을 흉내 내고 새 모듈 인스턴스를 불러온다. */
async function setup({ userAgent, permission, gps, cached }) {
  const storage = new Map(cached ? [["visitor-gps-sido", JSON.stringify({ sido: cached, at: Date.now() })]] : []);
  const calls = { geolocation: 0, ip: 0 };
  let answerLater = null;
  globalThis.window = {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent,
      maxTouchPoints: 5,
      permissions: { query: async () => ({ state: permission }) },
      geolocation: {
        getCurrentPosition(success, failure) {
          calls.geolocation++;
          if (gps === "grant") success({ coords: SEOGWIPO });
          else if (gps === "deny") failure({ code: 1 });
          else answerLater = () => success({ coords: SEOGWIPO });
        },
      },
    },
  });
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/geo")) {
      calls.ip++;
      return new Response(JSON.stringify({ sido: "서울특별시" }), { status: 200 });
    }
    return new Response(boundaries, { status: 200 });
  };
  const locationModule = await import("./visitor-location.ts?case=" + ++caseNumber);
  return { locationModule, calls, storage, answer: () => answerLater?.() };
}

function collect(locationModule) {
  const updates = [];
  let notify = () => {};
  locationModule.watchVisitorRegion((update) => {
    updates.push(update);
    notify();
  });
  const waitFor = (count) =>
    new Promise((resolve) => {
      if (updates.length >= count) resolve(updates);
      else notify = () => updates.length >= count && resolve(updates);
    });
  return { updates, waitFor };
}

test("데스크톱은 위치 동의를 묻지 않고 접속 IP로 지역을 정한다", async () => {
  const { locationModule, calls } = await setup({ userAgent: DESKTOP_UA, permission: "prompt", gps: "grant" });
  const { waitFor } = collect(locationModule);
  const [update] = await waitFor(1);
  assert.deepEqual(update, { status: "resolved", region: { sido: "서울특별시", source: "ip" }, final: true });
  assert.equal(calls.geolocation, 0);
});

test("모바일에서 위치 권한이 있으면 GPS 좌표로 시도를 정하고 방문 동안 기억한다", async () => {
  const { locationModule, storage } = await setup({ userAgent: MOBILE_UA, permission: "granted", gps: "grant" });
  const { waitFor } = collect(locationModule);
  const [update] = await waitFor(1);
  assert.deepEqual(update, { status: "resolved", region: { sido: "제주특별자치도", source: "gps" }, final: true });
  assert.equal(JSON.parse(storage.get("visitor-gps-sido")).sido, "제주특별자치도");
});

test("모바일에서 위치 동의를 거절하면 접속 IP로 지역을 정한다", async () => {
  const { locationModule } = await setup({ userAgent: MOBILE_UA, permission: "prompt", gps: "deny" });
  const { waitFor } = collect(locationModule);
  const updates = await waitFor(2);
  assert.deepEqual(updates[0], { status: "asking" });
  assert.deepEqual(updates[1], { status: "resolved", region: { sido: "서울특별시", source: "ip" }, final: true });
});

test("동의 창에 답하지 않으면 IP로 먼저 보여 주고, 나중에 동의하면 GPS 지역으로 바꾼다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { locationModule, answer } = await setup({ userAgent: MOBILE_UA, permission: "prompt", gps: "later" });
    const { updates, waitFor } = collect(locationModule);
    await waitFor(1);
    assert.deepEqual(updates[0], { status: "asking" });
    for (let step = 0; step < 20 && updates.length < 2; step++) {
      mock.timers.tick(1000);
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.deepEqual(updates[1], { status: "resolved", region: { sido: "서울특별시", source: "ip" }, final: false });
    answer();
    const all = await waitFor(3);
    assert.deepEqual(all[2], { status: "resolved", region: { sido: "제주특별자치도", source: "gps" }, final: true });
  } finally {
    mock.timers.reset();
  }
});

test("같은 방문에서 이미 GPS로 찾은 지역이 있으면 다시 묻지 않는다", async () => {
  const { locationModule, calls } = await setup({ userAgent: MOBILE_UA, permission: "prompt", gps: "later", cached: "부산광역시" });
  const { waitFor } = collect(locationModule);
  const [update] = await waitFor(1);
  assert.deepEqual(update, { status: "resolved", region: { sido: "부산광역시", source: "gps" }, final: true });
  assert.equal(calls.geolocation, 0);
});

