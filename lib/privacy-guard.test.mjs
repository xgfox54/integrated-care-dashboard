import assert from "node:assert/strict";
import test from "node:test";
import { scanSensitiveText } from "./privacy-guard.ts";

const emailCount = (text) => scanSensitiveText(text).find((finding) => finding.kind === "이메일")?.count ?? 0;

test("이메일 검사는 앞뒤 글자와 여러 주소를 구분해 그대로 찾는다", () => {
  assert.equal(emailCount("문의: kim.ab+1@example.go.kr, lee_2@test.co.kr"), 2);
  assert.equal(emailCount("xxxxxxxxuser@example.com 뒤"), 1);
  assert.equal(emailCount("a@b.c a@b"), 0);
});

test("@ 없이 길게 이어진 글자도 입력 길이에 비례한 시간 안에 검사한다", () => {
  const started = Date.now();
  assert.equal(emailCount("{\"padding\":\"" + "x".repeat(1_200_000) + "\"}"), 0);
  assert.equal(emailCount("x".repeat(600_000) + "@" + "y".repeat(600_000)), 0);
  assert.ok(Date.now() - started < 3000, "120만 자 검사가 3초 안에 끝나야 한다");
});
