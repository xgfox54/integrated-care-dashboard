import assert from "node:assert/strict";
import test from "node:test";

import { buildRegionStatistics, getRegionDisplayName } from "./region-statistics.ts";

test("buildRegionStatistics uses the current 16 regions and merges legacy Gwangju/Jeonnam names", () => {
  const statistics = buildRegionStatistics([
    { sido: "강원도" },
    { sido: "강원도" },
    { sido: "전라북도" },
    { sido: "서울특별시" },
    { sido: "전남광주통합특별시" },
    { sido: "전남광주통합특별시" },
    { sido: "광주광역시" },
    { sido: "전라남도" },
    { sido: "알 수 없는 지역" },
  ]);

  assert.equal(statistics.length, 16);
  assert.deepEqual(
    statistics.find((region) => region.id === "gangwon"),
    {
      id: "gangwon",
      shortLabel: "강원",
      fullName: "강원특별자치도",
      dataValue: "강원도",
      count: 2,
    },
  );
  assert.deepEqual(
    statistics.find((region) => region.id === "jeonbuk"),
    {
      id: "jeonbuk",
      shortLabel: "전북",
      fullName: "전북특별자치도",
      dataValue: "전라북도",
      count: 1,
    },
  );
  assert.equal(
    statistics.find((region) => region.id === "seoul")?.count,
    1,
  );
  assert.deepEqual(
    statistics.find((region) => region.id === "jeonnam_gwangju"),
    {
      id: "jeonnam_gwangju",
      shortLabel: "전남·광주",
      fullName: "전남광주통합특별시",
      dataValue: "전남광주통합특별시",
      count: 4,
    },
  );
  assert.equal(
    statistics.reduce((sum, region) => sum + region.count, 0),
    8,
  );
});

test("getRegionDisplayName returns official display names and a nationwide fallback", () => {
  assert.equal(getRegionDisplayName(""), "전국");
  assert.equal(getRegionDisplayName("강원도"), "강원특별자치도");
  assert.equal(getRegionDisplayName("세종특별자치시"), "세종특별자치시");
});
