import assert from "node:assert/strict";
import test from "node:test";

import { judgeLink } from "./platform/link-rules.ts";

test("연결 자동 판정은 위에서부터 처음 맞는 규칙을 쓴다(제외 규칙이 같은 이름의 확인 규칙보다 먼저)", () => {
  assert.equal(judgeLink("방문건강관리사업", "ICT 융합 방문건강관리사업(AI-IoT)")?.decision, "reject");
  assert.equal(judgeLink("방문건강관리사업", "ICT 융합 방문건강관리사업(방문건강관리사업)")?.decision, "verify");
  assert.equal(judgeLink("중증장애인 활동지원", "중증장애인 상해보험 가입")?.decision, "reject");
  assert.equal(judgeLink("중증장애인 활동지원", "장애인 활동지원 서비스")?.decision, "verify");
  assert.equal(judgeLink("제주형건강주치의 시범사업", "장애인 건강주치의 시범사업")?.decision, "reject");
  assert.equal(judgeLink("여성장애인 돌봄 지원", "여성장애인 가사도우미 지원")?.decision, "verify");
  assert.equal(judgeLink("처음 보는 사업", "장애인 활동지원 서비스"), null);
});
