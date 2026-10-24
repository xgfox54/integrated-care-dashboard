import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../data/manual-table-verifications.json' with { type: 'json' };
import { manualTableVerifications } from './manuals/table-verifications.ts';

test('table verification follows the reviewed document and section hashes, not the corpus revision name', () => {
  for (const item of catalog) {
    const args = [item.document_id, item.parsed_sha256, item.original_sha256, item.section_id, item.section_content_sha256];
    assert.ok(manualTableVerifications(...args).some(record => record.verification_id === item.verification_id));
    for (let i = 0; i < args.length; i++) {
      const changed = [...args]; changed[i] = 'changed';
      assert.deepEqual(manualTableVerifications(...changed), []);
    }
    assert.equal(item.whole_section_verified, false);
    assert.equal(item.current_policy_verified, false);
  }
  const emergency = catalog.find(item => item.physical_page === 61);
  assert.ok(emergency.verified_facts.some(fact => fact.includes('각주32') && fact.includes('생계지원 가능')));
  assert.ok(catalog.find(item => item.physical_page === 19).verified_facts.some(fact => fact.includes('제주도 본섬 제외')));
});
