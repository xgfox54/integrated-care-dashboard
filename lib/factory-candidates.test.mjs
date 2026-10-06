// 사실 후보 뽑기(§5.11, T63): 누름틀·취소선·예시·빈 양식·개정 전후 대조는 현행 사실 후보로 올리지 않고 제외 사유를 남긴다.
import assert from "node:assert/strict";
import test from "node:test";

import { extractCandidates } from "../factory/release/candidates.mjs";

let index = 0;
const block = (text, extra = {}) => ({ block_id: "b:" + String(++index).padStart(16, "0"), ir_pointer: "/blocks/" + index, type: "paragraph", page: 1, parsed_text_verbatim: text, ...extra });

test("누름틀·취소선·예시·빈 양식·개정 대조 절은 후보에서 빼고, 일반 항목은 후보로 남긴다", () => {
  const excluded = [];
  const document = { blocks: [
    block("❍ 지원대상: 만 65세 이상 홀로 사는 어르신"),
    block("❍ 지원금액: 월 300,000원", { contains_strike: true }),
    block("❍ 신청방법: 클릭하여 입력하세요", { contains_placeholder: true }),
    block("❍ 지원금액: (예) 월 100,000원"),
    block("❍ 접수기간: 0000년 00월 00일까지"),
    block("❍ 담당: ○○○ 주무관"),
    block("3. 신구조문 대비표", { type: "heading" }),
    block("❍ 지원금액: 월 200,000원(개정 전)"),
    block("4. 제출서류"),
    block("❍ 신분증 사본 1부"),
  ] };
  const candidates = extractCandidates(document, excluded);
  assert.deepEqual(candidates.map((item) => [item.predicate_id, item.value_text]), [["target_group", "만 65세 이상 홀로 사는 어르신"], ["required_documents", "신분증 사본 1부"]]);
  assert.deepEqual(excluded.map((item) => item.reason), ["STRIKETHROUGH_TEXT", "PLACEHOLDER_FIELD", "EXAMPLE_OR_BLANK_FORM", "EXAMPLE_OR_BLANK_FORM", "EXAMPLE_OR_BLANK_FORM", "AMENDMENT_COMPARISON"]);
  assert.ok(excluded.every((item) => item.block_id && item.ir_pointer), "제외한 블록 위치를 남긴다");
});
