import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const boundaries = readFileSync(new URL("../public/data/geo/sido-boundaries.json", import.meta.url), "utf8");
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 Mobile Safari/537.36";
const SEOUL = { sido: "서울특별시", source: "edge" };
const SEOGWIPO = { latitude: 33.2541, longitude: 126.5601 };
let caseNumber = 0;

/** Sets up browser APIs with spies before importing an isolated location module. */
async function setup({ edgePayload = SEOUL, edgeStatus = 200, gps = "grant", gpsAvailable = true, coordinate = SEOGWIPO, cached, boundariesStatus = 200 }) {
  const storage = new Map(cached ? [["visitor-gps-sido", JSON.stringify({ sido: cached, at: Date.now() })]] : []);
  const calls = { boundaries: 0, edge: 0, geolocation: 0, permission: 0 };
  globalThis.window = {
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: MOBILE_UA,
      maxTouchPoints: 5,
      permissions: {
        query: async () => {
          calls.permission++;
          return { state: "prompt" };
        },
      },
      ...(gpsAvailable
        ? {
            geolocation: {
              getCurrentPosition(success, failure) {
                calls.geolocation++;
                if (gps === "grant") success({ coords: coordinate });
                else failure({ code: 1 });
              },
            },
          }
        : {}),
    },
  });
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/geo")) {
      calls.edge++;
      return new Response(JSON.stringify(edgePayload), { status: edgeStatus });
    }
    calls.boundaries++;
    return new Response(boundaries, { status: boundariesStatus });
  };
  const locationModule = await import("./visitor-location.ts?case=" + ++caseNumber);
  return { calls, locationModule, storage };
}

function watchOnce(locationModule) {
  return new Promise((resolve) => {
    locationModule.watchVisitorRegion(resolve);
  });
}

test("Given a mobile visitor, when automatic Edge resolution runs, then it never requests browser location", async () => {
  const { calls, locationModule } = await setup({});

  const update = await watchOnce(locationModule);

  assert.deepEqual(update, { status: "resolved", region: { sido: "서울특별시", source: "edge" }, final: true });
  assert.deepEqual(calls, { boundaries: 0, edge: 1, geolocation: 0, permission: 0 });
});

test("Given malformed, failed, or non-Edge geo responses, when automatic resolution runs, then it resolves null without GPS", async (t) => {
  for (const scenario of [
    { edgePayload: { sido: "서울특별시" }, edgeStatus: 200, name: "missing source" },
    { edgePayload: { sido: "서울특별시", source: "none" }, edgeStatus: 200, name: "none source" },
    { edgePayload: SEOUL, edgeStatus: 503, name: "non-OK response" },
  ]) {
    await t.test(scenario.name, async () => {
      const { calls, locationModule } = await setup(scenario);

      const update = await watchOnce(locationModule);

      assert.deepEqual(update, { status: "resolved", region: null, final: true });
      assert.deepEqual(calls, { boundaries: 0, edge: 1, geolocation: 0, permission: 0 });
    });
  }
});

test("Given explicit GPS is granted, when requested, then it resolves locally and caches only a province", async () => {
  const { calls, locationModule, storage } = await setup({});

  assert.equal(calls.geolocation, 0);
  const sido = await locationModule.requestGpsSido();

  assert.equal(sido, "제주특별자치도");
  assert.deepEqual(calls, { boundaries: 1, edge: 0, geolocation: 1, permission: 0 });
  const cached = JSON.parse(storage.get("visitor-gps-sido"));
  assert.deepEqual(Object.keys(cached).sort(), ["at", "sido"]);
  assert.equal(cached.sido, "제주특별자치도");
  assert.equal(Object.hasOwn(cached, "latitude"), false);
  assert.equal(Object.hasOwn(cached, "longitude"), false);
});

test("Given explicit GPS is denied, when requested, then it resolves locally without Edge fallback", async () => {
  const { calls, locationModule, storage } = await setup({ gps: "deny" });

  const sido = await locationModule.requestGpsSido();

  assert.equal(sido, null);
  assert.deepEqual(calls, { boundaries: 0, edge: 0, geolocation: 1, permission: 0 });
  assert.equal(storage.size, 0);
});

test("Given explicit GPS is unavailable, when requested, then it resolves null without Edge fallback", async () => {
  const { calls, locationModule, storage } = await setup({ gpsAvailable: false });

  const sido = await locationModule.requestGpsSido();

  assert.equal(sido, null);
  assert.deepEqual(calls, { boundaries: 0, edge: 0, geolocation: 0, permission: 0 });
  assert.equal(storage.size, 0);
});

test("Given explicit GPS coordinates are foreign, when requested, then it returns null without Edge fallback", async () => {
  const { calls, locationModule, storage } = await setup({ coordinate: { latitude: 0, longitude: 0 } });

  const sido = await locationModule.requestGpsSido();

  assert.equal(sido, null);
  assert.deepEqual(calls, { boundaries: 1, edge: 0, geolocation: 1, permission: 0 });
  assert.equal(storage.size, 0);
});

test("Given local boundary loading fails, when explicit GPS is requested, then it returns null without Edge fallback", async () => {
  const { calls, locationModule, storage } = await setup({ boundariesStatus: 503 });

  const sido = await locationModule.requestGpsSido();

  assert.equal(sido, null);
  assert.deepEqual(calls, { boundaries: 1, edge: 0, geolocation: 1, permission: 0 });
  assert.equal(storage.size, 0);
});

test("Given a fresh explicit GPS cache, when GPS is requested, then it reuses the cached province", async () => {
  const { calls, locationModule } = await setup({ cached: "부산광역시" });

  const sido = await locationModule.requestGpsSido();

  assert.equal(sido, "부산광역시");
  assert.deepEqual(calls, { boundaries: 0, edge: 0, geolocation: 0, permission: 0 });
});
