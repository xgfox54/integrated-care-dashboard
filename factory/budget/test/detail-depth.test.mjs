import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractBudgetLines, splitDetailLines } from '../extract-budget-lines.mjs';

const DETAIL = '01 사무관리비\n○일반수용비\n－걷기운동실천사업\nㆍ워크온플랫폼 사용료\n900,000원*12월\nㆍ인증상품 6,000원*12월*500명\nㆍ현수막 구입 1,000,000원';
const CHILDREN = [
  ['워크온플랫폼 사용료', '900,000원*12월', '10,800'],
  ['인증상품', '6,000원*12월*500명', '36,000'],
  ['현수막 구입', '1,000,000원', '1,000'],
];

test('third-level source costs remain separate below the walking-program subtotal', () => {
  // Given: official Gapyeong 2026 general-account PDF p416, unchanged source text.
  // When
  const rows = splitDetailLines(DETAIL);
  // Then
  assert.deepEqual(rows.filter(row => row.level === 'sub_item_detail').map(row => [row.name, row.formula]), CHILDREN.map(([name, formula]) => [name, formula]));
  assert.equal(rows.find(row => row.name === '걷기운동실천사업').formula, null);
});

test('source amounts and parents survive complete third-level table extraction', () => {
  // Given: each printed number remains in its source column, including three subtotals.
  const dir = mkdtempSync(path.join(tmpdir(), 'budget-depth-'));
  try {
    const tableId = 't:df17f7936366636b';
    const rows = [['건강증진과', '47,800'], ['건강증진사업', '47,800'], ['건강생활실천', '47,800'], ['걷기운동', '47,800'], ['201 일반운영비', '47,800'], [DETAIL, '47,800\n47,800\n47,800\n10,800\n36,000\n1,000']];
    const cells = rows.flatMap(([label, amount], index) => [
      { anchor_row: index, anchor_col: 1, parsed_text_verbatim: label },
      { anchor_row: index, anchor_col: 3, parsed_text_verbatim: amount, cell_id: `c:df17f7936366636b:${index}:3` },
    ]);
    writeFileSync(path.join(dir, 'document.json'), JSON.stringify({ blocks: [
      { type: 'paragraph', page: 416, block_id: 'b:aaaaaaaa', parsed_text_verbatim: '정책: 건강증진사업 단위: 건강생활실천' },
      { type: 'table', page: 416, table_id: tableId, block_id: 'b:df17f7936366636b' },
    ] }));
    writeFileSync(path.join(dir, 'tables.jsonl'), JSON.stringify({ table_id: tableId, logical_columns: 6, cells }));
    // When
    const extracted = extractBudgetLines(dir);
    // Then: independent printed values, formula calculations, and direct parent relationship.
    assert.deepEqual(extracted.problems, []);
    const parent = extracted.lines.find(line => line.name === '걷기운동실천사업');
    const leaves = extracted.lines.filter(line => line.level === 'sub_item_detail');
    assert.deepEqual(leaves.map(line => [line.name, line.formula_text, line.amount_thousand_krw]), CHILDREN);
    assert.ok(leaves.every(line => line.parent_line_no === parent.line_no && line.checks.formula === 'match'));
    assert.equal(parent.checks.children_sum, 'match');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
