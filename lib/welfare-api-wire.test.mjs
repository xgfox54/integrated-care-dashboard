import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpenApiListResultSuccessful,
  parseOpenApiXml,
  readOpenApiResult,
  serviceKeyQueryValue,
} from "./welfare-api-wire.ts";

test("Given an URL-encoded key, when it was saved as decoded, then it is encoded exactly once", () => {
  const encodedKey = "sample%2Fkey%3D%3D";

  const queryValue = serviceKeyQueryValue(encodedKey, "decoded");

  assert.equal(queryValue, encodedKey);
});

test("Given a public API error envelope, when it is parsed, then its code and message are returned", () => {
  const payload = {
    OpenAPI_ServiceResponse: {
      cmmMsgHeader: {
        errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
        returnAuthMsg: "등록되지 않은 서비스키",
        returnReasonCode: "30",
      },
    },
  };

  const result = readOpenApiResult(payload);

  assert.deepEqual(result, {
    resultCode: "30",
    resultMsg: "등록되지 않은 서비스키",
  });
});

test("Given a no-data response, when list success is classified, then the empty result is accepted", () => {
  assert.equal(isOpenApiListResultSuccessful("40", "NO DATA FOUND"), true);
});

test("Given a successful XML response, when it is parsed, then its summary and records are returned", () => {
  const payload = `<?xml version="1.0" encoding="UTF-8"?>
    <wantedList>
      <totalCount>247</totalCount>
      <pageNo>1</pageNo>
      <numOfRows>3</numOfRows>
      <resultCode>0</resultCode>
      <resultMessage>SUCCESS</resultMessage>
      <servList>
        <bizChrDeptNm>경상남도 사천시 노인장애인과</bizChrDeptNm>
        <ctpvNm>경상남도</ctpvNm>
        <servNm>노인 돌봄 &amp; 생활 지원</servNm>
      </servList>
    </wantedList>`;

  const result = parseOpenApiXml(payload);

  assert.deepEqual(result, {
    resultCode: "0",
    resultMsg: "SUCCESS",
    totalCount: 247,
    records: [
      {
        bizChrDeptNm: "경상남도 사천시 노인장애인과",
        ctpvNm: "경상남도",
        servNm: "노인 돌봄 & 생활 지원",
      },
    ],
    fieldsSeen: ["bizChrDeptNm", "ctpvNm", "servNm"],
  });
});
