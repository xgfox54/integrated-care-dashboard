import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLofinKey } from "./fiscal/key.ts";

test("지방재정365 인증키: 줄바꿈·보이지 않는 문자를 지우고, 호출 주소를 붙여넣으면 Key 값만 쓴다", () => {
  assert.equal(normalizeLofinKey(" abcdef1234\n5678 "), "abcdef12345678");
  assert.equal(normalizeLofinKey("abcdef\u200b1234\u00a05678"), "abcdef12345678");
  assert.equal(normalizeLofinKey("https://www.lofin365.go.kr/lf/hub/QWGJK?Type=json&Key=ABCDEF123456&pIndex=1"), "ABCDEF123456");
  assert.equal(normalizeLofinKey("짧음"), null);
  assert.equal(normalizeLofinKey("인증키: ABCDEF123456"), null);
});

