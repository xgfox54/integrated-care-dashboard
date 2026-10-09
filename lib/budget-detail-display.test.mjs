import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetDocumentIndent } from '../components/budget/budget-document-display.ts';

test('nested source costs are indented below their printed subtotal', () => {
  // Given
  const subtotal = budgetDocumentIndent('sub_item');
  // When
  const cost = budgetDocumentIndent('sub_item_detail');
  // Then
  assert.ok(Math.abs(parseFloat(cost.paddingLeft) - parseFloat(subtotal.paddingLeft) - 0.85) < 1e-12);
});

test('previous source hierarchy keeps its existing indentation', () => {
  // Given
  const levels = ['department', 'policy', 'unit', 'detail_project', 'object_group', 'object', 'item', 'sub_item'];
  const expected = levels.map((_, depth) => 0.75 + depth * 0.85 + 'rem');
  // When
  const actual = levels.map(level => budgetDocumentIndent(level).paddingLeft);
  // Then
  assert.deepEqual(actual, expected);
});
