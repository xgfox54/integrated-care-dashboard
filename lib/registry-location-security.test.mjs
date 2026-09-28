import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/welfare100/RegistryCatalog.tsx", import.meta.url), "utf8");

test("복지 catalog watcher is Edge-only and remains a manual shortcut", () => {
  assert.doesNotMatch(source, /requestGpsSido|navigator\.geolocation|내 위치\(GPS\)/);
  assert.match(source, /if \(searchParams\.get\("sido"\)\) return;[\s\S]*?return watchVisitorRegion\(/);
  assert.match(source, /onClick=\{\(\) => choose\(\{ sido: visitorSido, sigungu: ALL_SIGUNGU \}\)\}/);
  assert.match(source, /접속 지역 \{visitorSido\} 서비스 보기/);
});
