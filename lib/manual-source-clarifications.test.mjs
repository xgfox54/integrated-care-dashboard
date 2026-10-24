import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../data/manual-source-clarifications.json' with { type: 'json' };
import { manualSourceClarifications } from './manuals/source-clarifications.ts';

test('source conflict metadata is returned only for the reviewed document and section versions', () => {
  // Given: the original conflicting form and the checked body sections.
  for (const record of catalog) for (const section of record.sections) {
    const args = [record.document_id, record.parsed_sha256, section.section_id, section.section_content_sha256];
    // When: reading the exact source, then each independent identity mismatch.
    assert.deepEqual(manualSourceClarifications(...args).map(item => item.id), [record.id]);
    // Then: no old clarification may be attached to a changed source.
    for (let i = 0; i < args.length; i++) {
      const changed = [...args]; changed[i] = 'changed';
      assert.deepEqual(manualSourceClarifications(...changed), []);
    }
  }
});
