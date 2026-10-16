import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { database } from './press-test-support.mjs';

test('original department correction requires the exact source document hash and is repeatable', () => {
  const db = database();
  try {
    const insertDocument = db.sqlite.prepare("INSERT INTO budget_document (import_id,document_id,source_version_id,title,issuer,issuer_sido,issuer_sigungu,fiscal_year,retrieved_at,raw_sha256,format,parse_id,parser,extractor_version,rights_basis) VALUES (?, 'doc:budget-jeju-2026-4005301-initial-welfare','v','2026년 서귀포시통합돌봄과 예산서','제주','제주특별자치도','서귀포시','2026','2026-10-12',?,'pdf','p','kordoc','v','official')");
    const insertRevision = db.sqlite.prepare("INSERT INTO budget_revision (import_id,revision_id,document_id,stage,stage_basis,unit,account_code,account_name,scope_text,amount_columns,line_count) VALUES (?,?,'doc:budget-jeju-2026-4005301-initial-welfare','adopted_initial','official','thousand_krw','100','일반회계','서귀포시통합돌봄과 수록분','{}',1)");
    insertDocument.run('verified', 'd7b2a7e82c2b569deeaf918f339b0e3cd6a71847b654adb15845177a2326d690');
    insertDocument.run('different', 'different-original-hash');
    insertRevision.run('verified', 'verified-revision');
    insertRevision.run('different', 'different-revision');
    const migration = readFileSync(new URL('../drizzle/0119_budget_original_department_label.sql', import.meta.url), 'utf8');
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const sql of migration.split('--> statement-breakpoint')) db.sqlite.exec(sql);
      assert.equal(db.sqlite.prepare("SELECT title FROM budget_document WHERE import_id='verified'").get().title, '2026년 서귀포시주민복지과 예산서');
      assert.match(db.sqlite.prepare("SELECT scope_text FROM budget_revision WHERE import_id='verified'").get().scope_text, /서귀포시주민복지과\(원문 표기/);
      assert.equal(db.sqlite.prepare("SELECT title FROM budget_document WHERE import_id='different'").get().title, '2026년 서귀포시통합돌봄과 예산서');
      assert.equal(db.sqlite.prepare("SELECT scope_text FROM budget_revision WHERE import_id='different'").get().scope_text, '서귀포시통합돌봄과 수록분');
    }
  } finally { db.sqlite.close(); }
});
