import assert from "node:assert/strict";
import test from "node:test";

import { createManualPageLocator, nameVariants } from "../scripts/welfare100/manual-pages.mjs";

const FILE = "5.[매뉴얼-시험] 2026년 시험 사업 안내.pdf";
const BODY = [
  "이 사업은 홀로 사는 어르신의 안부를 매주 확인하고 위기 상황에서 응급 지원을 연결하는 것을 목적으로 한다.",
  "영구임대주택 입주 순위는 소득과 자산 요건을 함께 보아 정하며 시군구가 대상자를 추천한다.",
  "바우처는 국민행복카드로 지급하고 사용 기한이 지나면 남은 금액은 소멸된다는 점을 안내한다.",
];
const ROW = "| 국민기초생활보장(생계급여, 의료급여 수급자) | 해당 세대의 월평균 소득이 기준 이하인 사람 |";

test('a matched section heading is not displaced by an agency name in a later contact line', () => {
  const heading = '장애인기업 창업보육실 운영';
  const body = '장애인 예비창업자에게 창업보육실 공간과 사무기기를 제공합니다.';
  const contact = '문의 장애인기업종합지원센터';
  const raw = '# ' + heading + '\n' + body + '\n' + contact + '\n# 다른 사업\n다른 사업의 지원 조건';
  const finder = createManualPageLocator({ manualLines: new Map([['22', ['# ' + heading, body, contact, '# 다른 사업', '다른 사업의 지원 조건']]]), pages: [{ documentId: 'original', file: FILE, format: 'PDF', page: 1, raw, ocr: false }] });
  const result = finder.locate('22', 1, ['장애인기업종합지원센터운영']);
  assert.ok(result.original.quote.startsWith(heading));
  assert.ok(!result.original.quote.includes('다른 사업'));
});

function locator() {
  const raws = [
    "## PDF 물리 쪽 1\n\n# 2026년 시험 사업 안내\n\n보건복지부",
    "## PDF 물리 쪽 2\n\n# 1. 사업 개요\n\n" + BODY[0],
    "## PDF 물리 쪽 3\n\n| 1순위 | 2순위 |\n| --- | --- |\n" + ROW + "\n\n" + BODY[1],
    "## PDF 물리 쪽 4\n\n# 3. 행복나눔 바우처\n\n" + BODY[2],
  ];
  const pages = raws.map((raw, index) => ({ documentId: "orig-a", file: FILE, format: "PDF", page: index + 1, raw, ocr: false }));
  const lines = ["# 합본", "", "## 원본 파일: 22.[매뉴얼-시험] 2026년 시험 사업 안내.md", "", "# 1. 사업 개요", "", BODY[0], "", "| 1순위 | 2순위 |", "| --- | --- |", ROW, "", BODY[1], "", "# 3. 행복 나눔 바우처 (지원)", "", BODY[2]];
  return createManualPageLocator({ manualLines: new Map([["22", lines]]), pages });
}

test("합본 줄을 원본 PDF 쪽에서 찾아 그 쪽 문장을 그대로 발췌한다", () => {
  const result = locator().locate("22", 11, ["국민기초생활보장 생계급여"]);
  assert.equal(result.status, "LINE");
  assert.deepEqual({ file: result.original.file, page: result.original.page, basis: result.original.basis }, { file: FILE, page: 3, basis: "line" });
  assert.ok(result.original.quote.startsWith("국민기초생활보장(생계급여, 의료급여 수급자) | 해당 세대의 월평균 소득이 기준 이하인 사람"));
});

test("원본 파일 표지 줄은 그 원본 파일 전체를 가리키고 발췌하지 않는다", () => {
  const result = locator().locate("22", 3, ["시험 사업"]);
  assert.equal(result.status, "DOCUMENT");
  assert.deepEqual({ page: result.original.page, pageEnd: result.original.pageEnd, pages: result.original.pages, quote: result.original.quote }, { page: 1, pageEnd: 4, pages: 4, quote: null });
});

test("띄어쓰기가 달라 줄을 그대로 찾지 못하면 같은 쪽의 제도명 줄부터 발췌한다", () => {
  const result = locator().locate("22", 15, ["행복나눔 바우처"]);
  assert.equal(result.original.basis, "name");
  assert.equal(result.original.page, 4);
  assert.ok(result.original.quote.startsWith("3. 행복나눔 바우처"));
});

test("편집 근거 매뉴얼에서는 제도 전용 원본이면 원본 전체를, 아니면 제도명만 있는 제목 줄의 쪽을 찾는다", () => {
  const finder = locator();
  const whole = finder.locateProgram("22", ["시험 사업 안내"]);
  assert.deepEqual({ basis: whole.original.basis, page: whole.original.page, pageEnd: whole.original.pageEnd }, { basis: "document", page: 1, pageEnd: 4 });
  const titled = finder.locateProgram("22", ["행복나눔 바우처"]);
  assert.deepEqual({ basis: titled.original.basis, page: titled.original.page }, { basis: "name", page: 4 });
  assert.ok(titled.original.quote.startsWith("3. 행복나눔 바우처\n" + BODY[2].slice(0, 10)));
  assert.equal(finder.locateProgram("22", ["국민기초생활보장"]).status, "NOT_FOUND");
});

test("제도명 후보는 지역 머리말과 '사업·서비스' 꼬리를 뗀 이름을 긴 것부터 담는다", () => {
  const variants = nameVariants(["서귀포시 어르신 병원동행 서비스 사업"]);
  assert.ok(variants.includes("어르신병원동행서비스"));
  assert.ok(variants.includes("어르신병원동행"));
  assert.deepEqual(variants, [...variants].sort((a, b) => b.length - a.length));
});
