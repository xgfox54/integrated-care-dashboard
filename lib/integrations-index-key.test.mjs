import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIndexKey } from "./integrations/index-key.ts";

test("지표누리 발급 키와 공식 URL의 idntfcId를 보존한다", () => {
  assert.equal(normalizeIndexKey("  TEST-ApprovedKey_1234\n"), "TEST-ApprovedKey_1234");
  assert.equal(normalizeIndexKey("https://www.index.go.kr/unity/openApi/stblUserShow.do?idntfcId=TEST%2BKey&ixCode=1248"), "TEST+Key");
});

test("잘못 붙여넣은 주소·빈 값·제어 문자는 키로 저장하지 않는다", () => {
  for (const value of ["", " ", "TEST KEY", "TEST\u0000KEY", "TEST\u200bKEY", "https://example.com/?idntfcId=TEST", "https://www.index.go.kr.evil.test/unity/openApi/stblUserShow.do?idntfcId=TEST", "https://www.index.go.kr/unity/openApi/stblUserShow.do", "http://www.index.go.kr/unity/openApi/stblUserShow.do?idntfcId=TEST", "a".repeat(513)]) {
    assert.equal(normalizeIndexKey(value), null);
  }
});
