import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SEARCH_TEXT_FROM_COLUMNS } from '../../lib/official-search-text.ts';
import { compactCell } from './source-row-cells.mjs';
const [cellsPath, beforePath, cachePath] = process.argv.slice(2);
if (!cellsPath || !beforePath || !cachePath) throw new Error('Expected source cells, production snapshot and page cache paths');
const cells = JSON.parse(readFileSync(cellsPath, 'utf8'));
const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const live = new Map(before.rows.map(row => [row.serviceId, row]));
const typeReview = JSON.parse(readFileSync('docs/data-quality/business-type-review-20261014.json', 'utf8'));
const midReview = JSON.parse(readFileSync('docs/data-quality/unresolved-rows-review-20261014.json', 'utf8'));
const labels = { 국가: '전국', 전국: '전국', 전국사업: '전국', 광역: '광역', 경기도: '광역', 지자체: '지역특화', 자체: '지역특화', 지역특화: '지역특화', 지역특화자체: '지역특화', 연계서비스: '공통_연계', 공통연계: '공통_연계', 연계: '공통_연계' };
const rows = [];
function add(review, field, value, label) {
 const row = live.get(review.service_id); const cell = cells[review.service_id];
 if (!row || !cell || !cell.verified_bounds || row[field] === value) return;
 if (field === 'type' && row.type !== '미분류' || field === 'subcategory' && row.subcategory !== '') return;
 const source = cache[cell.page_key];
 rows.push({ service_id: review.service_id, name: row.name, updated_date: row.updatedDate, field, before: row[field], value, source_label: label, source_name: cell.name, source_url: review.document_url, page: Number(cell.page_key.split(':')[3]), row_top: cell.top, row_bottom: cell.bottom, verified_bounds: cell.verified_bounds, glyph_sha256: createHash('sha256').update(JSON.stringify(source)).digest('hex') });
}
for (const review of typeReview.rows) { const cell = cells[review.service_id]; const label = cell?.fields.type || cell?.fields.sourceType || ''; if (labels[label]) add(review, 'type', labels[label], label); }
for (const review of midReview.rows.filter(row => row.status === 'UNRESOLVED_KEPT')) {
 const label = cells[review.service_id]?.fields.subcategory;
 if (!label || !/^[가-힣]+$/.test(label)) continue;
 if (review.cause === 'NOT_IN_TAXONOMY' && compactCell(review.source_subcategory) === label || review.service_id === '0077:1489747:1:5:18' && label === '식사지원') add(review, 'subcategory', label, label);
}
const approved = {};
for (const row of rows) { const entry = approved[row.service_id] ??= { name: row.name, updated_date: row.updated_date, fields: {} }; entry.fields[row.field] = { before: row.before, value: row.value }; }
const revision = 'source-classifications-20261015-v1';
writeFileSync('data/source-classification-restorations.json', JSON.stringify({ revision, rows: approved }, null, 1) + '\n');
const typeCount=rows.filter(row=>row.field==='type').length; const midCount=rows.filter(row=>row.field==='subcategory').length;
const summary={ revision, before_rows:before.rows.length, type_restored:typeCount, subcategory_restored:midCount, unclassified_type_before:before.rows.filter(row=>row.type==='미분류').length, unclassified_type_after:before.rows.filter(row=>row.type==='미분류').length-typeCount, blank_subcategory_before:before.rows.filter(row=>!row.subcategory).length, blank_subcategory_after:before.rows.filter(row=>!row.subcategory).length-midCount, source_pages:Object.keys(cache).length };
writeFileSync('docs/data-quality/classification-restorations-20261015.json', JSON.stringify({ summary, mapping_policy:labels, rows }, null, 1) + '\n');
const q = value => "'"+String(value).replace(/'/g,"''")+"'";
const schema = "CREATE TABLE official_classification_restoration (revision TEXT NOT NULL, service_id TEXT NOT NULL, field TEXT NOT NULL CHECK(field IN ('type','subcategory')), expected_name TEXT NOT NULL, expected_updated_date TEXT NOT NULL, before_value TEXT NOT NULL, after_value TEXT NOT NULL, source_label TEXT NOT NULL, source_url TEXT NOT NULL, physical_page INTEGER NOT NULL, glyph_sha256 TEXT NOT NULL, PRIMARY KEY(revision,service_id,field));";
const sql = []; 
for (let i=0;i<rows.length;i+=40) sql.push('INSERT OR IGNORE INTO official_classification_restoration VALUES '+rows.slice(i,i+40).map(row=>'('+[revision,row.service_id,row.field,row.name,row.updated_date,row.before,row.value,row.source_label,row.source_url,row.page,row.glyph_sha256].map(q).join(',')+')').join(',')+';');
for (const field of ['type','subcategory']) {const match='r.revision = '+q(revision)+' AND r.service_id = official_service_snapshot.service_id AND r.expected_name = official_service_snapshot.name AND r.expected_updated_date = official_service_snapshot.updated_date AND r.field = '+q(field)+' AND r.before_value = official_service_snapshot.'+field;sql.push('UPDATE official_service_snapshot SET '+field+' = (SELECT r.after_value FROM official_classification_restoration r WHERE '+match+') WHERE sync_run_id IN (SELECT id FROM official_sync_run WHERE status = '+q('succeeded')+' ORDER BY completed_at DESC LIMIT 1) AND EXISTS (SELECT 1 FROM official_classification_restoration r WHERE '+match+');');}
sql.push("UPDATE official_service_snapshot SET search_text = " + SEARCH_TEXT_FROM_COLUMNS + " WHERE sync_run_id IN (SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1) AND EXISTS (SELECT 1 FROM official_classification_restoration r WHERE r.revision = " + q(revision) + " AND r.service_id = official_service_snapshot.service_id AND r.expected_name = official_service_snapshot.name AND r.expected_updated_date = official_service_snapshot.updated_date AND ((r.field = 'type' AND r.after_value = official_service_snapshot.type) OR (r.field = 'subcategory' AND r.after_value = official_service_snapshot.subcategory)));");
sql.push("UPDATE official_source_row_ledger SET mapped = (SELECT COUNT(*) FROM official_service_snapshot s WHERE s.sync_run_id = official_source_row_ledger.run_id AND s.service_id LIKE official_source_row_ledger.document_id || ':%' AND TRIM(s.subcategory) <> '' AND TRIM(s.type) <> ''), preserved_unresolved = (SELECT COUNT(*) FROM official_service_snapshot s WHERE s.sync_run_id = official_source_row_ledger.run_id AND s.service_id LIKE official_source_row_ledger.document_id || ':%' AND (TRIM(s.subcategory) = '' OR TRIM(s.type) = '')) WHERE run_id IN (SELECT id FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1);");
sql.push('DELETE FROM dataset_response_cache;');sql.push('DELETE FROM mcp_search_cache;');
sql.push("INSERT OR REPLACE INTO app_setting(key,value,updated_at) SELECT " + q('source-classification-applied:' + revision) + ", id, CAST(strftime('%s','now') AS INTEGER) FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1;");
writeFileSync('drizzle/0130_source_classification_restoration.sql', schema + '\n');
writeFileSync('data/source-classification-backfill.sql',sql.join('\n--> statement-breakpoint\n')+'\n');
console.log(JSON.stringify(summary,null,1));
