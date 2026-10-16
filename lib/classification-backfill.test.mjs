import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { businessDatabase } from './business-data-test-support.mjs';

const hooks = registerHooks({ resolve(specifier, context, next) {
 if (specifier.endsWith('.sql?raw')) {
  const content = readFileSync(new URL(specifier.slice(0, -4), context.parentURL), 'utf8');
  return {url: 'data:text/javascript,' + encodeURIComponent('export default ' + JSON.stringify(content)), shortCircuit: true};
 }
 if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
  const url = new URL(specifier + '.ts', context.parentURL);
  if (existsSync(url)) return {url: url.href, shortCircuit: true};
 }
 return next(specifier, context);
}});
const { applyReviewedClassifications } = await import('./classification-backfill.ts');
hooks.deregister();

function fixture(t) {
 const db = businessDatabase(); t.after(() => db.sqlite.close());
 let batches = 0;
 db.batch = async statements => {
  batches++; db.sqlite.exec('BEGIN');
  try { const result = []; for (const statement of statements) result.push(await statement.run()); db.sqlite.exec('COMMIT'); return result; }
  catch (error) { db.sqlite.exec('ROLLBACK'); throw error; }
 };
 return {db, batches: () => batches};
}

test('Given no completed snapshot When the reviewed backfill is checked Then no write is attempted', async t => {
 const {db, batches} = fixture(t); db.sqlite.exec('DELETE FROM official_sync_run');
 assert.equal(await applyReviewedClassifications(db), false); assert.equal(batches(), 0);
});

const evidenceRows = readFileSync(new URL('../data/source-classification-backfill.sql', import.meta.url), 'utf8').match(/\('source-classifications-\d{8}-v\d+','/g).length;

test('Given an active snapshot When the reviewed backfill succeeds Then all evidence is committed once and repeated visits skip writes', async t => {
 const {db, batches} = fixture(t);
 assert.equal(await applyReviewedClassifications(db), true);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM official_classification_restoration').get().n, evidenceRows);
 assert.equal(await applyReviewedClassifications(db), false); assert.equal(batches(), 1);
 db.sqlite.exec("INSERT INTO official_sync_run(id,trigger,status,started_at,completed_at) VALUES('next','manual','succeeded',1792000000,1792000000)");
 assert.equal(await applyReviewedClassifications(db), true); assert.equal(batches(), 2);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM official_classification_restoration').get().n, evidenceRows);
});

test('Given a failed write When the batch rolls back Then no partial evidence or applied marker survives and retry remains possible', async t => {
 const {db, batches} = fixture(t);
 db.sqlite.exec("CREATE TRIGGER reject_review BEFORE INSERT ON official_classification_restoration WHEN NEW.field = 'subcategory' BEGIN SELECT RAISE(ABORT,'forced failure'); END");
 await assert.rejects(applyReviewedClassifications(db), /forced failure/);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM official_classification_restoration').get().n, 0);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM app_setting WHERE key LIKE 'source-classification-applied:%'").get().n, 0);
 db.sqlite.exec('DROP TRIGGER reject_review');
 assert.equal(await applyReviewedClassifications(db), false);
 db.sqlite.exec("UPDATE app_setting SET updated_at=0 WHERE key LIKE 'source-classification-lease:%'");
 assert.equal(await applyReviewedClassifications(db), true); assert.equal(batches(), 2);
});

test('Given simultaneous visitors When the first correction is running Then another database wrapper cannot start a duplicate batch', async t => {
 const {db, batches}=fixture(t);const runBatch=db.batch;
 let release;const blocked=new Promise(resolve=>{release=resolve;});
 let started;const ready=new Promise(resolve=>{started=resolve;});
 db.batch=async statements=>{started();await blocked;return runBatch(statements);};
 const first=applyReviewedClassifications(db);await ready;
 const duplicate=applyReviewedClassifications({...db});release();
 const result=await Promise.allSettled([first,duplicate]);
 assert.equal(result[0].status,"fulfilled");assert.equal(result[0].value,true);
 assert.equal(result[1].status,"fulfilled");assert.equal(result[1].value,false);assert.equal(batches(),1);
});
