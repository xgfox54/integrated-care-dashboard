import assert from "node:assert/strict";
import test from "node:test";
import { splitStageName } from "./welfare100/stage-name.mjs";

test("한글 단계 이름은 코드 없이 이름 전체를 쓴다", () => {
  assert.deepEqual(splitStageName("신청·접수"), { full: "신청·접수", code: "", label: "신청·접수" });
  assert.deepEqual(splitStageName("바우처 지원"), { full: "바우처 지원", code: "", label: "바우처 지원" });
});

test("영문+숫자 코드가 앞에 있으면 코드와 이름을 나눈다", () => {
  assert.deepEqual(splitStageName("G1 접수·이송"), { full: "G1 접수·이송", code: "G1", label: "접수·이송" });
});
