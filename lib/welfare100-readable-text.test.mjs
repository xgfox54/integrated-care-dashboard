import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readableWelfareText, readableWelfareSummary } from "./welfare100/readable-text.ts";

test("support sentences break without changing amounts, dates, URLs or bracketed conditions", () => {
  const source = "소득인정액 32% 이하(1인 82만 556원. 예외 확인). 부양의무자 예외가 적용된다.\n지원액은 1.5배이며 2026. 10. 16. 기준이다. 8인 가구도 확인한다. https://example.go.kr/a.b 문의는 129.";
  const expected = "소득인정액 32% 이하(1인 82만 556원. 예외 확인).\n부양의무자 예외가 적용된다.\n지원액은 1.5배이며 2026. 10. 16. 기준이다.\n8인 가구도 확인한다. https://example.go.kr/a.b 문의는 129.";
  assert.equal(readableWelfareText(source), expected);
});

test("livelihood summary uses the requested semantic break", () => {
  const record = JSON.parse(readFileSync(new URL("../data/welfare100/records-01.json", import.meta.url))).find(row => row.s === "livelihood-benefit");
  assert.equal(readableWelfareSummary(record.one), "소득인정액이 기준 중위소득 32% 이하인 가구에 부족한 생계비를 매월 현금으로 채워 최저생활을 보장하는\n기초생활보장의 핵심 급여");
});

test("all hundred curated records retain text and stable breaks", () => {
  const normalize = text => text.replace(/\s/g, "");
  let count = 0;
  for (let index = 1; index <= 10; index++) {
    const records = JSON.parse(readFileSync(new URL(`../data/welfare100/records-${String(index).padStart(2, "0")}.json`, import.meta.url)));
    for (const record of records) {
      count++;
      for (const field of ["one", "purpose", "target", "benefit", "apply", "contact", "money", "docs"]) {
        const input = record[field];
        const output = field === "one" ? readableWelfareSummary(input) : readableWelfareText(input);
        assert.equal(normalize(output), normalize(input), `${record.s}.${field}`);
        assert.equal(readableWelfareText(output), output, `${record.s}.${field} stable`);
      }
    }
  }
  assert.equal(count, 100);
});
