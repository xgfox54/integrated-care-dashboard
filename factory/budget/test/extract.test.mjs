// 예산서 계층 추출 시험. 표본은 공개된 용인시 2026 본예산 사회복지국 사업명세서(공개 자료)의 행 모양을 줄여 옮긴 것이다.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { amountTokens, evaluateFormula, extractBudgetLines, segmentGlued, splitDetailLines, thousandCandidates } from "../extract-budget-lines.mjs";

test("산출식은 쉼표·%·괄호를 계산하고, 천원 표시는 내림·반올림·올림 후보로 비교한다", () => {
  assert.equal(evaluateFormula("95,440원*2명*230일"), 43_902_400);
  assert.equal(evaluateFormula("(100,000원*2,300명*12월)+(50,000원*1,500명*12월)"), 3_660_000_000);
  assert.ok(Math.abs(evaluateFormula("21,951,200원*2명*3.595%*112.95%") - 43_902_400 * 0.03595 * 1.1295) < 1e-6);
  assert.equal(evaluateFormula("단가 미정"), null);
  assert.deepEqual(thousandCandidates(43_902_400), [43_902, 43_903]);
});

test("붙어 나온 금액은 산출식 값의 이어 붙임과 정확히 같을 때만 나눈다", () => {
  assert.deepEqual(segmentGlued("2002005,028", [[200], [200], "free"], (pieces) => pieces.length === 3), ["200", "200", "5,028"]);
  assert.equal(segmentGlued("2002005,028", [[200], [300], "free"]), null);
});

test("재원 표시와 금액이 붙으면 형식이 맞는 분할이 하나일 때 나누고, 여럿이면 후보로 넘긴다", () => {
  assert.deepEqual(amountTokens("137,725도 13,773\n시 123,952").map((t) => [t.kind, t.label ?? null, t.text]), [["amount", null, "137,725"], ["funding", "도", "13,773"], ["funding", "시", "123,952"]]);
  const glued = amountTokens("시 7501,188");
  assert.equal(glued[0].kind, "funding_glued");
  assert.deepEqual(glued[0].splits, [1, 3]);
});

test("가평군 원문의 지 재원을 일반 예산 행으로 소비하지 않고 원문 재원 합계를 보존한다", () => {
  // Given: official 2026 Gapyeong general-account PDF, page 82.
  const cell = "30,883,770\n국 19,922,605\n지 415,539\n도 2,248,952\n군 8,296,674";
  // When
  const tokens = amountTokens(cell);
  // Then: only the first number is a budget-row value; all four funds remain attached.
  assert.deepEqual(tokens.filter(t => t.kind === "amount"), [{ kind: "amount", text: "30,883,770" }]);
  const funds = tokens.filter(t => t.kind === "funding");
  assert.deepEqual(funds.map(t => [t.label, t.text]), [["국", "19,922,605"], ["지", "415,539"], ["도", "2,248,952"], ["군", "8,296,674"]]);
  assert.equal(funds.find(t => t.label === "지").source, "other");
  assert.equal(funds.reduce((sum, t) => sum + Number(t.text.replace(/,/g, "")), 0), 30_883_770);
});

test("통계목·부기(Ο)·하위 산출항목(o·ο)·줄바꿈 산출식을 나눈다", () => {
  const items = splitDetailLines(["04 기간제근로자등보수", "Ο현충탑 관리원 인건비", "95,440원*2명*230일", "Ο현충탑 관리원 4대 보험", "o건강보험", "21,951,200원*2명*3.595%*112.95%", "Ο참전명예수당", "(100,000원*2,300명*12월)+(50,000원", "*1,500명*12월)"].join("\n"));
  assert.deepEqual(items.map((i) => [i.level, i.code, i.name]), [["object", "04", "기간제근로자등보수"], ["item", null, "현충탑 관리원 인건비"], ["item", null, "현충탑 관리원 4대 보험"], ["sub_item", null, "건강보험"], ["item", null, "참전명예수당"]]);
  assert.equal(items[4].formula, "(100,000원*2,300명*12월)+(50,000원*1,500명*12월)");
  assert.equal(splitDetailLines("ο가족수당 140,000원*1명*12월")[0].level, "item", "앞선 Ο가 없으면 ο도 부기");
});

test("가평군 원문의 전각 하이픈은 부모 부기의 하위 산출항목을 보존한다", () => {
  const items = splitDetailLines([
    "○가평형 통합돌봄 신규서비스 발굴 및 기획", "사업",
    "－지역특화 방문건강, 의약품 지원 등", "30,000,000원",
    "－가평형 주거,안전 특화사업 등", "30,000,000원",
    "－돌봄사각지대 맞춤형 서비스 발굴 등", "23,000,000원",
  ].join("\n"));
  assert.deepEqual(items.map(item => [item.level, item.name, item.formula]), [
    ["item", "가평형 통합돌봄 신규서비스 발굴 및 기획 사업", null],
    ["sub_item", "지역특화 방문건강, 의약품 지원 등", "30,000,000원"],
    ["sub_item", "가평형 주거,안전 특화사업 등", "30,000,000원"],
    ["sub_item", "돌봄사각지대 맞춤형 서비스 발굴 등", "23,000,000원"],
  ]);
  assert.equal(items.slice(1).reduce((sum, item) => sum + evaluateFormula(item.formula), 0), 83_000_000);
});

function parseDir(pages) {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-"));
  const blocks = [];
  const tables = [];
  pages.forEach((page, p) => {
    for (const text of page.header) blocks.push({ type: "paragraph", page: p + 1, parsed_text_verbatim: text, block_id: "b:h" + p + text.length });
    const id = "t:" + p;
    blocks.push({ type: "table", page: p + 1, table_id: id, block_id: "b:t" + p });
    const cells = [{ anchor_row: 0, anchor_col: 0, parsed_text_verbatim: "부서ㆍ정책ㆍ단위(회계)ㆍ세부사업ㆍ편성목" }, { anchor_row: 0, anchor_col: 3, parsed_text_verbatim: "예산액" }, { anchor_row: 0, anchor_col: 4, parsed_text_verbatim: page.previousHeader ?? "전년도" }, { anchor_row: 0, anchor_col: 5, parsed_text_verbatim: "비교증감" }];
    page.rows.forEach(([label, amount, previous, change], r) => {
      cells.push({ anchor_row: r + 1, anchor_col: 1, parsed_text_verbatim: label });
      cells.push({ anchor_row: r + 1, anchor_col: 3, parsed_text_verbatim: amount, cell_id: id + ":" + r });
      if (previous !== undefined) cells.push({ anchor_row: r + 1, anchor_col: 4, parsed_text_verbatim: previous });
      if (change !== undefined) cells.push({ anchor_row: r + 1, anchor_col: 5, parsed_text_verbatim: change });
    });
    tables.push({ table_id: id, logical_columns: 6, cells });
  });
  writeFileSync(path.join(dir, "document.json"), JSON.stringify({ blocks }));
  writeFileSync(path.join(dir, "tables.jsonl"), tables.map((t) => JSON.stringify(t)).join("\n"));
  return dir;
}

test("이름 행은 편성목 앞에서 끝에서부터 세부사업·단위·정책·부서로 정하고, 쪽을 넘는 산출·재원·「신규」 표시·옮겨진 이름 조각을 바르게 붙인다", () => {
  const dir = parseDir([
    { header: ["정책: 노인복지 증진", "단위: 노인여가활동 지원"], rows: [
      ["노인복지과", "1,479,211"], ["사회복지증진", "1,479,211"], ["복지시설 운영지원", "1,479,211"], ["모현 다목적 복지회관 운영", "1,110,689"],
      ["구갈\n308 자치단체등이전", "1,110,689"],
      ["13 공기관등에대한경상적위탁사업비\nΟ모현 다목적 복지회관 운영\n1,057,799,000원\nΟ위탁수수료 52,889,950원", "1,110,689\n1,057,799\n52,890"],
      ["다목적 복지회관 운영", "368,522"], ["308 자치단체등이전", "368,522"],
      ["13 공기관등에대한경상적위탁사업비\nΟ구갈 다목적 복지회관 운영", "368,522\n350,973국 100,000"],
    ] },
    { header: ["정책: 노인복지 증진"], rows: [
      ["350,973,000원", ""], ["신규", "시 250,973"],
      ["Ο위탁수수료 17,548,650원", "17,549"],
    ] },
  ]);
  const result = extractBudgetLines(dir);
  const byName = (name) => result.lines.find((line) => line.name === name);
  assert.deepEqual(["노인복지과", "사회복지증진", "복지시설 운영지원", "모현 다목적 복지회관 운영", "구갈 다목적 복지회관 운영"].map((n) => byName(n)?.level), ["department", "policy", "unit", "detail_project", "detail_project"]);
  assert.equal(byName("구갈 다목적 복지회관 운영").checks.name_fragment_rejoined, "supported_by_item_name", "옮겨진 이름 조각은 그 세부사업의 부기(Ο) 이름이 뒷받침할 때만 붙인다");
  const item = result.lines.find((line) => line.level === "item" && line.name === "구갈 다목적 복지회관 운영");
  assert.equal(item.formula_text, "350,973,000원");
  assert.equal(item.checks.formula, "match");
  assert.deepEqual(item.annotations, ["신규"]);
  assert.deepEqual(item.funding.map((f) => [f.label, f.amount_thousand_krw]), [["국", "100,000"], ["시", "250,973"]]);
  assert.equal(item.checks.funding_sum, "match");
  assert.equal(result.lines.filter((line) => line.name === "신규").length, 0, "「신규」는 예산 행이 아니다");
  assert.equal(byName("사회복지증진").checks.children_sum, "match");
  assert.deepEqual(result.problems, []);
  assert.equal(result.lines.filter((line) => line.level === "item").every((line) => !["노인복지과", "사회복지증진", "복지시설 운영지원"].includes(line.name)), true, "부기명에 상위 사업명을 넣지 않는다");
});

test("추경 문서의 기정액·비교증감은 행 금액·재원 순서로 「금액 − 기정액 = 비교증감」이 되는 짝으로만 붙이고, 붙어 나온 숫자도 그 식으로 나눈다", () => {
  const dir = parseDir([{ header: ["정책: 보훈", "단위: 보훈지원"], previousHeader: "기정액", rows: [
    ["복지정책과", "10,000\n국 6,000\n시 4,000", "9,989\n6,011\n3,978", "11\n△1122"],
    ["보훈", "10,000", "9,989", "11"], ["보훈지원", "10,000", "9,989", "11"], ["보훈단체 지원", "10,000", "9,989", "11"],
    ["201 일반운영비", "4,000", "0", "4,000"],
    ["01 사무관리비\nΟ보훈업무 지원 20,000원*200명", "4,000\n4,000", "00", "4,000\n4,000"],
    ["307 민간이전", "6,000", "9,989", "△3,989"],
    ["02 민간경상사업보조\nΟ현충일 참배 6,000,000원", "6,000\n6,000", "9,989\n9,989", "△3,989\n△3,989"],
  ] }]);
  const result = extractBudgetLines(dir);
  const byName = (name) => result.lines.find((line) => line.name === name);
  assert.deepEqual(result.amount_columns, ["예산액|기정액|비교증감"]);
  const department = byName("복지정책과");
  assert.equal(department.previous_amount_thousand_krw, "9,989");
  assert.deepEqual(department.funding.map((item) => [item.label, item.previous_amount_thousand_krw, item.change_amount_thousand_krw]), [["국", "6,011", "△11"], ["시", "3,978", "22"]], "붙어 나온 「△1122」는 재원별 식으로만 나눈다");
  assert.equal(byName("사무관리비").previous_amount_thousand_krw, "0");
  assert.equal(byName("보훈업무 지원").previous_amount_thousand_krw, "0", "「00」은 통계목·부기 두 행의 0으로 나눈다");
  assert.equal(byName("보훈단체 지원").checks.previous_children_sum, "match");
  assert.equal(byName("현충일 참배").change_amount_thousand_krw, "△3,989");
  assert.deepEqual(result.problems, []);
});

test("병합 칸에 들어간 이름 조각은 부기 이름이 뒷받침하지 않으면 이름에 붙이지 않고 검토 표시로 남긴다", () => {
  const dir = parseDir([{ header: ["정책: 시험", "단위: 시험 단위"], rows: [
    ["복지과", "300"], ["정책", "300"], ["단위", "300"], ["A 사업", "100"], ["전국\n201 일반운영비", "100"], ["01 사무관리비\nΟA 사업 100,000원", "100\n100"],
    ["B 사업", "200"], ["201 일반운영비", "200"], ["01 사무관리비\nΟB 사업 200,000원", "200\n200"],
  ] }]);
  const result = extractBudgetLines(dir);
  const line = result.lines.find((item) => item.level === "detail_project" && item.name === "B 사업");
  assert.ok(line, "조각을 붙이지 않은 원래 이름 그대로");
  assert.equal(line.checks.name_fragment_rejoined, "unplaced_no_evidence");
  assert.deepEqual(line.annotations, ["배치 근거 없는 이름 조각: 전국"]);
});

test("논산시 원문의 추·대 재원을 일반 금액 행으로 소비하지 않고 합계를 보존한다", () => {
  const cell = ["14,847,900", "국 297,860", "균 210,255", "기 379,610도 1,657,386시 12,238,257", "추 14,532대 50,000"].join(String.fromCharCode(10));
  const tokens = amountTokens(cell);
  assert.deepEqual(tokens.filter(t => t.kind === "amount"), [{ kind: "amount", text: "14,847,900" }]);
  const funds = tokens.filter(t => t.kind === "funding");
  assert.deepEqual(funds.filter(t => ["추", "대"].includes(t.label)).map(t => [t.label, t.source, t.text]), [["추", "other", "14,532"], ["대", "other", "50,000"]]);
  assert.equal(funds.reduce((sum, t) => sum + Number(t.text.replaceAll(",", "")), 0), 14_847_900);
});
