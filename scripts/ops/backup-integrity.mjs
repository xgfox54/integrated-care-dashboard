import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { REGION_DEFINITIONS } from '../../lib/region-statistics.ts';
const regionAliases = new Map(REGION_DEFINITIONS.flatMap(region => region.aliases.map(alias => [alias, region.fullName])));

const File = z.object({ name: z.string().min(1).refine(name => basename(name) === name && !name.includes('..')), status: z.number(), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), bytes: z.number().int().nonnegative() });
const Manifest = z.object({ files: z.array(File), service_total: z.number().int().nonnegative(), release_bundle_id: z.string().nullable(), kind: z.literal('public-data') });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const required = ['services.json', 'services.csv', 'dataset-summary.json', 'mcp-dataset-status.json', 'statistics-status.json', 'statistics.json'];
export function inspectPublicBackup(directory) {
 const manifest = Manifest.parse(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')));
 const errors = [];
 if (new Set(manifest.files.map(file => file.name)).size !== manifest.files.length) errors.push('중복 파일명');
 for (const name of required) if (!manifest.files.some(file => file.name === name)) errors.push('필수 파일 누락: ' + name);
 for (const file of manifest.files) {
  if (file.status !== 200 || !file.sha256) { errors.push('백업 실패: ' + file.name); continue; }
  try { const bytes = readFileSync(join(directory, file.name)); if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) errors.push('무결성 불일치: ' + file.name); }
  catch (caught) { if (caught instanceof Error) errors.push('파일 읽기 실패: ' + file.name); else throw caught; }
 }
 for (const name of readdirSync(directory)) if (name !== 'manifest.json' && !manifest.files.some(file => file.name === name)) errors.push('목록 외 파일: ' + name);
 return { manifest, errors, integrity: errors.length ? 'FAILED' : 'OK' };
}
export function rehearsePublicBackup(directory) {
 const integrity = inspectPublicBackup(directory);
 if (integrity.errors.length) throw new Error(integrity.errors.join(' / '));
 const rows = z.object({ rows: z.array(z.object({ serviceId: z.string().min(1), name: z.string().min(1), sido: z.string(), category: z.string(), type: z.string(), subcategory: z.string() }).passthrough()) }).parse(JSON.parse(readFileSync(join(directory, 'services.json'), 'utf8'))).rows;
 const summary = z.object({ summary: z.object({ totalCount: z.number().int(), regionCounts: z.record(z.number()), categoryCounts: z.record(z.number()) }) }).parse(JSON.parse(readFileSync(join(directory, 'dataset-summary.json'), 'utf8'))).summary;
 const statistics = z.array(z.object({ ok: z.literal(true), dataset: z.object({ id: z.string(), periods: z.array(z.string()).min(1), series: z.array(z.object({ id: z.string(), points: z.array(z.unknown()) })).min(1) }) }).passthrough()).parse(JSON.parse(readFileSync(join(directory, 'statistics.json'), 'utf8')));
 const status = JSON.parse(readFileSync(join(directory, 'statistics-status.json'), 'utf8')).status;
 const expectedStats = status.datasets.map(row => row.id).sort();
 if (JSON.stringify(statistics.map(row => row.dataset.id).sort()) !== JSON.stringify(expectedStats)) throw new Error('통계 자료 누락·중복');
 const db = new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE services(service_id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO services VALUES(?,?)');
  for (const row of rows) insert.run(row.serviceId, JSON.stringify(row));
  const restored = db.prepare('SELECT payload FROM services ORDER BY service_id').all().map(row => JSON.parse(row.payload));
  const tally = key => restored.reduce((counts,row) => { const name = key === 'sido' ? regionAliases.get(row[key]) ?? row[key] : row[key]; counts[name]=(counts[name]??0)+1; return counts; },{});
  const sameCounts = (expected,actual) => Object.keys(expected).length === Object.keys(actual).length && Object.entries(expected).every(([key,value]) => actual[key] === value);
  if (restored.length !== summary.totalCount || restored.length !== integrity.manifest.service_total || !sameCounts(summary.regionCounts,tally('sido')) || !sameCounts(summary.categoryCounts,tally('category'))) throw new Error('복원 집계 불일치');
  const originals = new Map(rows.map(row => [row.serviceId,JSON.stringify(row)]));
  if (restored.some(row => originals.get(row.serviceId)!==JSON.stringify(row))) throw new Error('복원 필드 불일치');
  return { result:'REPRODUCED', restored_rows:restored.length, statistics:statistics.length, fields:'ALL_JSON_FIELDS', release_bundle_id:integrity.manifest.release_bundle_id, scope:'공개 사업 JSON·통계 스냅샷 복원 시험. 관리자 비밀값·비공개 문서·DB 전체 복원은 포함하지 않음.' };
 } finally { db.close(); }
}
