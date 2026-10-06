import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFormula, splitDetailLines, uniqueRowAmounts } from "../extract-budget-lines.mjs";

test("horizontal-bar sub-items retain separate formulas and amounts", () => {
  const rows = splitDetailLines("○공동방제 지원\n―벼 항공방제\n218,000원*2,500ha*2회*35%\n―논콩 방제\n150,000원*300ha*2회*30%");
  assert.deepEqual(rows.map(row => row.level), ["item", "sub_item", "sub_item"]);
  assert.equal(rows[0].formula, null);
  assert.equal(evaluateFormula(rows[1].formula), 381500000);
  assert.equal(evaluateFormula(rows[2].formula), 27000000);
});

test("joined amounts require one complete row alignment and preserve real disagreements", () => {
  assert.deepEqual(uniqueRowAmounts(["8001,000", "2,000"], [null, null, [2000]]), [["800", "1,000"], ["2,000"]]);
  assert.equal(uniqueRowAmounts(["12345"], [null, null]), null, "12+345 and 123+45 are ambiguous");
  assert.equal(uniqueRowAmounts(["704,500"], [null, null]), null, "a valid displayed amount needs formula evidence before splitting");
  assert.deepEqual(uniqueRowAmounts(["704,500"], [[70], [4500]]), [["70", "4,500"]]);
  assert.equal(uniqueRowAmounts(["704,500"], [[80], [4500]]), null, "never force a formula mismatch");
  assert.equal(uniqueRowAmounts(["8001,000"], [null, null, null, null]), null, "never invent missing slots");
});

test("quantity-first formulas preserve their full expression", () => {
  const rows = splitDetailLines("○휘발유 72,000L*61원\n○경유 8,476L*65원\n○일반 1,000원*2명");
  assert.deepEqual(rows.map(row => row.name), ["휘발유", "경유", "일반"]);
  assert.deepEqual(rows.map(row => evaluateFormula(row.formula)), [4392000, 550940, 2000]);
  assert.equal(rows[0].formula, "72,000L*61원");
});
