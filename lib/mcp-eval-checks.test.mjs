import assert from 'node:assert/strict';
import test from 'node:test';
import { explicitEmptyScope, manualQuoteMatches } from '../scripts/mcp/eval-checks.mjs';

test('표 태그를 제거해 전체 발췌문을 검증하고 금액·조건 변조를 거절한다', () => {
  const original = '<table><tr><td rowspan="2">지원 대상</td><td>소득 100만원 이하</td></tr></table> 다만 신규 신청자는 제외합니다.';
  assert.equal(manualQuoteMatches('…지원 대상 소득 100만원 이하 다만 신규 신청자는 제외합니다.…', original), true);
  assert.equal(manualQuoteMatches('지원 대상 소득 200만원 이하 다만 신규 신청자는 제외합니다.', original), false);
  assert.equal(manualQuoteMatches('지원 대상 소득 1.00만원 이하 다만 신규 신청자는 제외합니다.', original), false);
  assert.equal(manualQuoteMatches('지원 대상 소득 100만원 이하 신규 신청자도 포함합니다.', original), false);
});

test('공개본과 조회 범위가 입증된 0건만 허용하고 누락·오류를 성공으로 바꾸지 않는다', () => {
  const entry = { tool: 'find_budget_projects', gold: { explicit_unavailable_ok: true }, args: { fiscal_year: 2025, mode: 'integrated_care', region_id: 'region:제주특별자치도' } };
  const response = { error: null, body: { data: { status: 'NO_MATCHES', reason_code: 'NO_MATCHING_PROJECTS_IN_PUBLISHED_SCOPE', requested_fiscal_year: 2025, mode: 'integrated_care', requested_region_id: entry.args.region_id, items: [] }, coverage: { total_count: 0, snapshot_set: [{ snapshot_id: 'fixture' }] } } };
  assert.equal(explicitEmptyScope(entry, response), true);
  assert.equal(explicitEmptyScope(entry, { ...response, body: { ...response.body, coverage: { total_count: 0, snapshot_id: 'single-fixture' } } }), true);
  assert.equal(explicitEmptyScope(entry, { ...response, body: { ...response.body, coverage: { total_count: 0, snapshot_set: [] } } }), false);
  assert.equal(explicitEmptyScope(entry, { ...response, body: { ...response.body, data: { ...response.body.data, requested_fiscal_year: 2026 } } }), false);
  assert.equal(explicitEmptyScope({ ...entry, gold: {} }, response), false);
  assert.equal(explicitEmptyScope(entry, { ...response, error: 'INTERNAL_ERROR' }), false);
});

