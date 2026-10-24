import assert from 'node:assert/strict';
import test from 'node:test';
import { businessDatabase } from './business-data-test-support.mjs';
import { applyReviewedWikiEdits, REVIEWED_WIKI_EDITS } from './reviewed-wiki-edits.ts';

const GANGNEUNG = REVIEWED_WIKI_EDITS.find(edit => edit.serviceId === '0083:1489622:1:1:2');

function fixture(t) {
 const db = businessDatabase(); t.after(() => db.sqlite.close());
 db.batch = async statements => {
  db.sqlite.exec('BEGIN');
  try { const result = []; for (const statement of statements) result.push(await statement.run()); db.sqlite.exec('COMMIT'); return result; }
  catch (error) { db.sqlite.exec('ROLLBACK'); throw error; }
 };
 return db;
}

const editOf = (db, id) => db.sqlite.prepare('SELECT * FROM wiki_edit WHERE service_id = ?').get(id);

test('Given the Gangneung report When reviewed edits are applied Then the provider becomes 강릉의료원 with its official source', async t => {
 const db = fixture(t);
 assert.equal(await applyReviewedWikiEdits(db, 100), 1);
 const row = editOf(db, GANGNEUNG.serviceId);
 assert.equal(row.provider, '강릉의료원');
 assert.equal(row.sigungu, '강릉시');
 assert.match(row.source_url, /mohw\.go\.kr/);
 assert.equal(row.description, null);
 assert.equal(await applyReviewedWikiEdits(db, 200), 0);
 assert.equal(editOf(db, GANGNEUNG.serviceId).updated_at, 100);
});

test('Given an administrator removed the reviewed edit When applied again Then it is not restored', async t => {
 const db = fixture(t);
 await applyReviewedWikiEdits(db, 100);
 db.sqlite.prepare('DELETE FROM wiki_edit WHERE service_id = ?').run(GANGNEUNG.serviceId);
 assert.equal(await applyReviewedWikiEdits(db, 200), 0);
 assert.equal(editOf(db, GANGNEUNG.serviceId), undefined);
});

test('Given an existing administrator edit When reviewed edits are applied Then the administrator value is kept', async t => {
 const db = fixture(t);
 db.sqlite.prepare("INSERT INTO wiki_edit (service_id, sido, sigungu, name, provider, note, updated_at) VALUES (?, '강원특별자치도', '강릉시', '재택의료센터', '관리자 입력', '', 50)").run(GANGNEUNG.serviceId);
 await applyReviewedWikiEdits(db, 100);
 assert.equal(editOf(db, GANGNEUNG.serviceId).provider, '관리자 입력');
});
