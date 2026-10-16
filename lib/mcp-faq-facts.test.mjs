import assert from 'node:assert/strict';
import test from 'node:test';
import { faq129Facts } from './mcp/faq129-facts.ts';

test('duration extraction preserves whole comma-separated and long numbers', () => {
  assert.deepEqual(faq129Facts('연간 1,200시간 이내, 1200시간 초과, 10,000일 동안, 1.5개월').durations,
    ['1,200시간 이내', '1200시간', '10,000일 동안', '1.5개월']);
});

test('calendar years remain excluded while other duration units and years are retained', () => {
  assert.deepEqual(faq129Facts('2026년부터 6개월 이내, 2025년 1월, 1999년, 3년 이상, 2026시간, 14일').durations,
    ['6개월 이내', '3년 이상', '2026시간', '14일']);
});
