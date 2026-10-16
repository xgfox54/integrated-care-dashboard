import { z } from 'zod';
import type { SqlDatabase } from '../sql-database.ts';
import { faq129ClarificationCatalog } from './faq129-clarifications.ts';
import { sourceContentHash, SOURCE_CONTENT_ALGORITHM } from './source-content.ts';
import { applicableCompletion, reviewCompletions } from './review-completion.ts';

import { SourceReviewSchema, type SourceReview } from './source-review-schema.ts';
export { SourceReviewSchema } from './source-review-schema.ts';
export type ReviewStatus = 'ORIGINAL_CHANGED' | 'SOURCE_CHANGED' | 'RECHECK_FAILED' | 'RECHECK_DUE' | 'PARTIAL' | 'REVIEWED_GUIDANCE';

export function reviewStatus(originalMatches: boolean, due: string, partial: boolean, checks: readonly SourceReview[], today: string): ReviewStatus {
  if (!originalMatches) return 'ORIGINAL_CHANGED';
  if (checks.some((check) => check.status === 'CHANGED')) return 'SOURCE_CHANGED';
  if (checks.some((check) => check.status === 'CHECK_FAILED')) return 'RECHECK_FAILED';
  if (due <= today) return 'RECHECK_DUE';
  return partial ? 'PARTIAL' : 'REVIEWED_GUIDANCE';
}

export async function sourceReviewRecords(db: SqlDatabase): Promise<readonly SourceReview[]> {
  return z.array(SourceReviewSchema).parse((await db.prepare('SELECT * FROM official_source_review ORDER BY checked_at DESC').all()).results);
}

export async function faqReviewMetadata(db: SqlDatabase, faqId: string, originalHash: string, today: string) {
  const entry = faq129ClarificationCatalog().find((item) => item.faq_id === faqId.replace(/^faq129:/, ''));
  if (!entry) return null;
  const [records, history] = await Promise.all([sourceReviewRecords(db), reviewCompletions(db)]);
  const checks = records.filter((check) => entry.clarification.sources.some((source) => source.url === check.source_url));
  const effectiveChecks = checks.map(check => {
    const completion = applicableCompletion(history, entry.faq_id, originalHash, entry.clarification.revision, check);
    return completion?.result === 'GUIDANCE_UNCHANGED' ? { ...check, status: 'UNCHANGED' as const } : check;
  });
  const affectedHistory = history.filter(item => item.faq_id === entry.faq_id);
  const accepted = entry.clarification.sources.map(source => {
    const check = checks.find(item => item.source_url === source.url);
    return check ? applicableCompletion(history, entry.faq_id, originalHash, entry.clarification.revision, check) : undefined;
  });
  const allAccepted = accepted.every(item => item?.result === 'GUIDANCE_UNCHANGED');
  const effectiveDue = allAccepted ? accepted.flatMap(item => item ? [item.review_due_at] : []).sort()[0] ?? entry.clarification.review_due_at : entry.clarification.review_due_at;
  const followUp = checks.some(check => applicableCompletion(history, entry.faq_id, originalHash, entry.clarification.revision, check)?.result === 'FOLLOW_UP_REQUIRED');
  return { status: reviewStatus(originalHash === entry.clarification.original_content_sha256, effectiveDue, entry.clarification.status === 'PARTIALLY_RESOLVED' || followUp, effectiveChecks, today),
    reviewed_at: entry.clarification.reviewed_at, review_due_at: effectiveDue, verification_scope: 'listed_guidance_only', source_checks: checks, review_history: affectedHistory, current_policy_verified: false };
}

const MAX_BYTES = 32 * 1024 * 1024;
export async function checkOfficialSource(db: SqlDatabase, sourceUrl: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<SourceReview> {
  if (!faq129ClarificationCatalog().some((entry) => entry.clarification.sources.some((source) => source.url === sourceUrl))) throw new Error('SOURCE_NOT_REGISTERED');
  const previous = await db.prepare('SELECT * FROM official_source_review WHERE source_url = ?').bind(sourceUrl).first<SourceReview>();
  let observed = previous?.observed_sha256 ?? '';
  let observedContent = previous?.observed_content_sha256 ?? null;
  let status: SourceReview['status'] = 'CHECK_FAILED';
  let errorCode: string | null = null;
  try {
    const response = await fetcher(sourceUrl, { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { accept: 'text/html,application/pdf' } });
    if (!response.ok) throw new Error('SOURCE_HTTP_' + response.status);
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/pdf|application\/octet-stream/i.test(type)) throw new Error('SOURCE_CONTENT_TYPE');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('SOURCE_EMPTY');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('SOURCE_TOO_LARGE'); }
      chunks.push(result.value);
    }
    if (!size) throw new Error('SOURCE_EMPTY');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    observed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((value) => value.toString(16).padStart(2, '0')).join('');
    observedContent = await sourceContentHash(bytes, type);
    status = previous?.baseline_content_sha256 ? (previous.baseline_content_sha256 === observedContent ? 'UNCHANGED' : 'CHANGED')
      : previous?.baseline_sha256 && previous.baseline_sha256 !== observed ? 'CHANGED' : 'BASELINE_RECORDED';
  } catch (error: unknown) {
    errorCode = error instanceof Error && /^SOURCE_[A-Z0-9_]+$/.test(error.message) ? error.message
      : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'SOURCE_TIMEOUT' : 'SOURCE_FETCH_FAILED';
  }
  const record: SourceReview = { source_url: sourceUrl, baseline_sha256: previous?.baseline_sha256 || observed, observed_sha256: observed, checked_at: now.toISOString(), status, error_code: errorCode,
    baseline_content_sha256: previous?.baseline_content_sha256 ?? (status === 'CHECK_FAILED' || status === 'CHANGED' ? null : observedContent), observed_content_sha256: observedContent, comparison_algorithm: SOURCE_CONTENT_ALGORITHM };
  await db.prepare('INSERT INTO official_source_review (source_url, baseline_sha256, observed_sha256, checked_at, status, error_code, baseline_content_sha256, observed_content_sha256, comparison_algorithm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_url) DO UPDATE SET baseline_sha256=excluded.baseline_sha256, observed_sha256=excluded.observed_sha256, checked_at=excluded.checked_at, status=excluded.status, error_code=excluded.error_code, baseline_content_sha256=excluded.baseline_content_sha256, observed_content_sha256=excluded.observed_content_sha256, comparison_algorithm=excluded.comparison_algorithm')
    .bind(record.source_url, record.baseline_sha256, record.observed_sha256, record.checked_at, record.status, record.error_code, record.baseline_content_sha256, record.observed_content_sha256, record.comparison_algorithm).run();
  return record;
}
