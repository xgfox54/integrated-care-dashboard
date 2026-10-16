import assert from 'node:assert/strict';
import test from 'node:test';
import { database } from './press-test-support.mjs';
import { manualOriginalProvenance } from './manuals/provenance.ts';
import pageInventory from '../data/manual-original-page-inventory.json' with { type: 'json' };

test('retained112 original identities link only matching parsed files, two official PDFs match exact original hashes', async () => {
  const db = database();
  try {
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM manual_original_identity').get().n, 112);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM manual_original_identity WHERE official_url IS NOT NULL').get().n, 2);
    const original = db.sqlite.prepare("SELECT * FROM manual_original_identity WHERE original_sha256='e62befad549ca88c0a78e69d8b15d2eb70f2618b53ae1a6adb0db6a10f322e54'").get();
    db.sqlite.prepare('INSERT INTO manual_corpus (revision,source_repository,source_commit,manifest_sha256,manifest_created_at,expected_documents,expected_sections,batch_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('test','fixture','fixture','fixture',1,1,1,1,1,1);
    db.sqlite.prepare('INSERT INTO manual_document (corpus_revision,document_id,source_name,source_path,sha256,byte_size,category,document_type,publisher,edition,effective_from,effective_to,topic,authority,source_role,jurisdiction,section_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('test','doc-1','test.md','test.md',original.parsed_sha256,1,'','pdf','','','','','','','','',1);
    const result = await manualOriginalProvenance(db,'test','doc-1');
    assert.equal(result.status,'OFFICIAL_FILE_HASH_MATCHED');
    assert.equal(result.original.page_count,560);
    assert.match(result.original.official_url,/easylaw/);
    assert.equal(result.physical_section_page_verified,false);
    assert.equal(result.image_body_verified,false);
    assert.equal((await manualOriginalProvenance(db,'other-revision','doc-1')).original,null);
    const hwpx = db.sqlite.prepare("SELECT parsed_sha256 FROM manual_original_identity WHERE format='hwpx'").all();
    assert.equal(hwpx.length, 3);
    for (const row of hwpx) {
      db.sqlite.prepare("UPDATE manual_document SET sha256=? WHERE document_id='doc-1'").run(row.parsed_sha256);
      const provenance = await manualOriginalProvenance(db,'test','doc-1');
      assert.equal(provenance.status,'RETAINED_ORIGINAL_IDENTIFIED');
      assert.equal(provenance.original.page_count,null);
    }
    db.sqlite.prepare("UPDATE manual_document SET sha256='unmatched' WHERE document_id='doc-1'").run();
    assert.equal((await manualOriginalProvenance(db,'test','doc-1')).status,'ORIGINAL_IDENTITY_UNAVAILABLE');
  } finally { db.sqlite.close(); }
});

test('official candidate is linked by the exact 2026 original hash, never the older question booklet', () => {
  const candidates = pageInventory.filter(row => row.official_candidate);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].original_sha256, '13c8c580647454780cf5b0b0a477721bb9575a88f44325595f80e97bd4241908');
  assert.equal(candidates[0].official_candidate.matches_retained_original, false);
  for (const item of pageInventory) for (const page of item.ocr_candidate_pages) assert.ok(item.page_count && page >= 1 && page <= item.page_count);
});
