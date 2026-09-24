import assert from "node:assert/strict";
import test from "node:test";

import { createDatasetServiceHandler } from "./dataset-service-handler.ts";

const ROW = {
  id: 0,
  serviceId: "service-1",
  sido: "서울특별시",
  sigungu: "종로구",
  category: "보건의료",
  subcategory: "방문진료",
  name: "재택의료 서비스",
  description: "가정에서 의료서비스를 제공합니다.",
  target: "돌봄이 필요한 주민",
  detailTarget: "",
  applicationMethod: "",
  provider: "종로구",
  type: "지역특화",
  serial: "1",
  detailUrl: "https://www.mohw.go.kr/example",
  updatedDate: "2026-07",
  searchIndex: "재택의료서비스",
};

test("single service endpoint rejects a missing service key before lookup", async () => {
  let lookupCount = 0;
  const handler = createDatasetServiceHandler({
    findService: async () => {
      lookupCount += 1;
      return ROW;
    },
  });

  const response = await handler(new Request("https://example.test/api/dataset/service"));

  assert.equal(response.status, 400);
  assert.equal(lookupCount, 0);
});

test("single service endpoint returns the exact selected row with public cache headers", async () => {
  const handler = createDatasetServiceHandler({ findService: async () => ROW });

  const response = await handler(new Request("https://example.test/api/dataset/service?service=service%3Akey"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.row, ROW);
  assert.match(response.headers.get("cache-control") ?? "", /public/);
});

test("single service endpoint distinguishes missing records from query failures", async () => {
  const missing = createDatasetServiceHandler({ findService: async () => null });
  const failed = createDatasetServiceHandler({
    findService: async () => {
      throw new Error("database unavailable");
    },
  });

  const missingResponse = await missing(new Request("https://example.test/api/dataset/service?service=service%3Amissing"));
  const failedResponse = await failed(new Request("https://example.test/api/dataset/service?service=service%3Afailure"));

  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { row: null });
  assert.equal(failedResponse.status, 500);
  assert.equal(failedResponse.headers.get("cache-control"), "no-store");
});
