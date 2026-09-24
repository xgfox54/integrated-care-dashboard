import assert from "node:assert/strict";
import test from "node:test";

import { serviceWikiKey } from "./dataset.ts";
import {
  findOfficialServiceByWikiKey,
  serviceIdFromWikiKey,
} from "./official-service-query.ts";

const BASE_ROW = {
  serviceId: "0084:1489830:1:3:3-1-2",
  sido: "제주특별자치도",
  sigungu: "제주특별자치도",
  category: "요양",
  subcategory: "방문요양",
  name: "장기요양통합재가 서비스(가정방문형)",
  description: "사례관리로 다양한 재가급여를 복합적으로 제공",
  target: "노인 장기요양등급 수급자",
  detailTarget: "",
  applicationMethod: "",
  provider: "국민건강보험공단",
  type: "전국",
  serial: "22",
  detailUrl: "https://www.mohw.go.kr/example",
  updatedDate: "2026-07",
};

test("wiki service key exposes a bounded normalized service id", () => {
  const key = serviceWikiKey({ ...BASE_ROW, id: 0, searchIndex: "" });

  assert.equal(serviceIdFromWikiKey(key), "0084148983013312");
  assert.equal(serviceIdFromWikiKey("invalid"), "");
  assert.equal(serviceIdFromWikiKey("service:one|two"), "");
});

test("focused service lookup returns only the exact composite wiki identity", async () => {
  const expected = { ...BASE_ROW, id: 0, searchIndex: "" };
  const key = serviceWikiKey(expected);
  let requestedServiceId = "";

  const selected = await findOfficialServiceByWikiKey(key, async (serviceId) => {
    requestedServiceId = serviceId;
    return [
      { ...BASE_ROW, subcategory: "방문간호" },
      BASE_ROW,
    ];
  });

  assert.equal(requestedServiceId, "0084148983013312");
  assert.equal(selected?.name, BASE_ROW.name);
  assert.equal(selected?.subcategory, "방문요양");
  assert.equal(serviceWikiKey(selected), key);
});

test("focused service lookup returns null without an exact composite match", async () => {
  const key = serviceWikiKey({ ...BASE_ROW, id: 0, searchIndex: "" });
  const selected = await findOfficialServiceByWikiKey(key, async () => [
    { ...BASE_ROW, name: "다른 사업" },
  ]);

  assert.equal(selected, null);
});
