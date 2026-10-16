import { z } from 'zod';
import pendingData from '../data/classification-pending-review.json' with { type: 'json' };
import type { SqlDatabase } from './sql-database.ts';
import { ClassificationQueueItem, ClassificationChange, ClassificationReviewInput, ClassificationReviewNote, ClassificationReviewPage } from './classification-review-schema.ts';

const pending = z.array(ClassificationQueueItem.omit({ region: true, notes: true })).parse(pendingData.rows);
const SourceRow = z.object({ service_id: z.string(), name: z.string(), updated_date: z.string(), type: z.string(), subcategory: z.string(), sido: z.string(), sigungu: z.string() });
const latest = "(SELECT id FROM official_sync_run WHERE status='succeeded' ORDER BY completed_at DESC LIMIT 1)";
export const ClassificationQuery = z.object({
  view: z.enum(['pending', 'history']).default('pending'), field: z.enum(['all', 'type', 'subcategory']).default('all'),
  q: z.string().trim().max(100).default(''), offset: z.coerce.number().int().min(0).max(10000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export class ClassificationReviewConflict extends Error {}

export async function classificationPending(db: SqlDatabase) {
  const result = await db.prepare(`SELECT service_id,name,updated_date,type,subcategory,sido,sigungu FROM official_service_snapshot WHERE sync_run_id=${latest} AND (type='미분류' OR TRIM(type)='' OR TRIM(subcategory)='')`).all();
  return z.array(SourceRow).parse(result.results).flatMap(row => (['type', 'subcategory'] as const).flatMap(field => {
    if (field === 'type' ? row.type !== '미분류' && row.type.trim() !== '' : row.subcategory.trim() !== '') return [];
    const source = pending.find(item => item.service_id === row.service_id && item.field === field && item.name === row.name && item.updated_date === row.updated_date && item.before === row[field]);
    return [{ ...(source ?? { service_id: row.service_id, name: row.name, updated_date: row.updated_date, field, before: row[field], reason: 'SOURCE_IDENTITY_CHANGED' as const, page: null, source_label: '', original_sha256: '', source_url: '' }), region: [row.sido, row.sigungu].filter(Boolean).join(' '), notes: [] }];
  }));
}

export async function readClassificationReviews(db: SqlDatabase, query: z.infer<typeof ClassificationQuery>) {
  const current = await classificationPending(db);
  const summary = { type: current.filter(item => item.field === 'type').length, subcategory: current.filter(item => item.field === 'subcategory').length };
  if (query.view === 'history') {
    const where = " WHERE (?='all' OR field=?) AND (instr(expected_name,?)>0 OR instr(service_id,?)>0)";
    const values = [query.field, query.field, query.q, query.q];
    const count = await db.prepare('SELECT COUNT(*) AS total FROM official_classification_restoration' + where).bind(...values).first<{ total: number }>();
    const rows = await db.prepare('SELECT * FROM official_classification_restoration' + where + ' ORDER BY revision DESC, service_id, field LIMIT ? OFFSET ?').bind(...values, query.limit, query.offset).all();
    return ClassificationReviewPage.parse({ ...query, total: count?.total ?? 0, summary, pending: [], changes: z.array(ClassificationChange).parse(rows.results) });
  }
  const matches = current.filter(item => (query.field === 'all' || item.field === query.field) && [item.name, item.region, item.service_id].some(text => text.includes(query.q)));
  const selected = matches.slice(query.offset, query.offset + query.limit);
  const notes = selected.length ? await db.prepare('SELECT * FROM classification_review_note WHERE service_id IN (' + selected.map(() => '?').join(',') + ') ORDER BY reviewed_at DESC, review_id DESC').bind(...selected.map(item => item.service_id)).all() : { results: [] };
  const history = z.array(ClassificationReviewNote).parse(notes.results);
  return ClassificationReviewPage.parse({ ...query, total: matches.length, summary, changes: [], pending: selected.map(item => ({ ...item, notes: history.filter(note => note.service_id === item.service_id && note.field === item.field && note.expected_name === item.name && note.expected_updated_date === item.updated_date && note.original_sha256 === item.original_sha256) })) });
}

export async function submitClassificationReview(db: SqlDatabase, input: unknown, now = new Date()) {
  const value = ClassificationReviewInput.parse(input);
  const source = (await classificationPending(db)).find(item => item.service_id === value.service_id && item.field === value.field && item.name === value.expected_name && item.updated_date === value.expected_updated_date && item.original_sha256 === value.original_sha256);
  if (!source) throw new ClassificationReviewConflict('분류 원문이 바뀌었습니다. 목록을 다시 확인하세요.');
  const record = ClassificationReviewNote.parse({ ...value, review_id: crypto.randomUUID(), reviewed_at: now.toISOString(), reviewer_role: 'authenticated_admin' });
  const inserted = await db.prepare(`INSERT INTO classification_review_note(review_id,service_id,field,expected_name,expected_updated_date,original_sha256,result,evidence_url,evidence_location,evidence_quote,reason,reviewed_at,reviewer_role)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? FROM official_service_snapshot WHERE sync_run_id=${latest} AND service_id=? AND name=? AND updated_date=? AND ${value.field}=? RETURNING *`)
    .bind(record.review_id, record.service_id, record.field, record.expected_name, record.expected_updated_date, record.original_sha256, record.result, record.evidence_url, record.evidence_location, record.evidence_quote, record.reason, record.reviewed_at, record.reviewer_role, source.service_id, source.name, source.updated_date, source.before).first();
  if (!inserted) throw new ClassificationReviewConflict('분류 원문이 바뀌었습니다. 목록을 다시 확인하세요.');
  return ClassificationReviewNote.parse(inserted);
}
