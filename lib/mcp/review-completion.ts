import { z } from 'zod';
import type { SqlDatabase } from '../sql-database.ts';
import { faq129ClarificationCatalog } from './faq129-clarifications.ts';
import { ReviewCompletionInput, ReviewCompletionSchema, type ReviewCompletion } from './review-completion-schema.ts';
import { SOURCE_CONTENT_ALGORITHM } from './source-content.ts';
import type { SourceReview } from './source-review-schema.ts';

export class ReviewCompletionError extends Error {
  readonly code: 'SOURCE_OR_FAQ_CHANGED' | 'GUIDANCE_NOT_REGISTERED';
  constructor(code: 'SOURCE_OR_FAQ_CHANGED' | 'GUIDANCE_NOT_REGISTERED') { super(code); this.code = code; }
}

export async function reviewCompletions(db: SqlDatabase): Promise<readonly ReviewCompletion[]> {
  return z.array(ReviewCompletionSchema).parse((await db.prepare('SELECT * FROM official_review_completion ORDER BY reviewed_at DESC, review_id DESC').all()).results);
}

export function applicableCompletion(history: readonly ReviewCompletion[], faqId: string, faqHash: string, guidanceRevision: string, check: SourceReview): ReviewCompletion | undefined {
  if (check.status === 'CHECK_FAILED' || !check.observed_content_sha256) return undefined;
  return history.find(item => item.faq_id === faqId && item.faq_content_sha256 === faqHash && item.guidance_revision === guidanceRevision
    && item.source_url === check.source_url && item.observed_content_sha256 === check.observed_content_sha256 && item.comparison_algorithm === check.comparison_algorithm);
}

export async function completeOfficialReview(db: SqlDatabase, input: unknown, now = new Date()): Promise<ReviewCompletion> {
  const value = ReviewCompletionInput.parse(input);
  const entry = faq129ClarificationCatalog().find(item => item.faq_id === value.faq_id && item.clarification.sources.some(source => source.url === value.source_url));
  if (!entry) throw new ReviewCompletionError('GUIDANCE_NOT_REGISTERED');
  const due = new Date(now); due.setUTCDate(due.getUTCDate() + 30);
  const record = ReviewCompletionSchema.parse({ ...value, review_id: crypto.randomUUID(), guidance_revision: entry.clarification.revision,
    comparison_algorithm: SOURCE_CONTENT_ALGORITHM, reviewed_at: now.toISOString(), review_due_at: due.toISOString().slice(0, 10), reviewer_role: 'authenticated_admin' });
  const inserted = await db.prepare(`INSERT INTO official_review_completion
    (review_id, faq_id, source_url, faq_content_sha256, guidance_revision, observed_sha256, observed_content_sha256, comparison_algorithm, source_checked_at, result, evidence_quote, evidence_location, reason, reviewed_at, review_due_at, reviewer_role)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM official_source_review s JOIN faq_129 f ON f.faq_id=?
    WHERE s.source_url=? AND s.status != 'CHECK_FAILED' AND s.observed_sha256=? AND s.observed_content_sha256=? AND s.comparison_algorithm=? AND s.checked_at=? AND f.content_sha256=? AND f.content_sha256=? RETURNING *`)
    .bind(record.review_id, record.faq_id, record.source_url, record.faq_content_sha256, record.guidance_revision, record.observed_sha256, record.observed_content_sha256, record.comparison_algorithm, record.source_checked_at, record.result, record.evidence_quote, record.evidence_location, record.reason, record.reviewed_at, record.review_due_at, record.reviewer_role,
      record.faq_id, record.source_url, record.observed_sha256, record.observed_content_sha256, record.comparison_algorithm, record.source_checked_at, record.faq_content_sha256, entry.clarification.original_content_sha256).first();
  if (!inserted) throw new ReviewCompletionError('SOURCE_OR_FAQ_CHANGED');
  return ReviewCompletionSchema.parse(inserted);
}
