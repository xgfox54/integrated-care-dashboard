import { z } from 'zod';

export const ClassificationField = z.enum(['type', 'subcategory']);
export const CLASSIFICATION_REASONS = {
  SOURCE_LABEL_REQUIRES_SCOPE_REVIEW: '사업 범위 확인 필요',
  CLASSIFICATION_COLUMN_NOT_CONFIRMED: '분류 열 확인 필요',
  ROW_OR_LAYOUT_UNCONFIRMED: '원문 행·셀 대조 필요',
  PARSER_OR_LAYOUT_DISAGREEMENT: '파싱·표 구조 불일치',
  SOURCE_CELL_EMPTY: '원문 분류 미제공',
  SOURCE_COLUMN_ABSENT: '원문 표에 해당 칸 없음',
  SOURCE_IDENTITY_CHANGED: '원본 변경 · 재검수 필요',
} as const;
export const ClassificationReason = z.enum(['SOURCE_LABEL_REQUIRES_SCOPE_REVIEW', 'CLASSIFICATION_COLUMN_NOT_CONFIRMED', 'ROW_OR_LAYOUT_UNCONFIRMED', 'PARSER_OR_LAYOUT_DISAGREEMENT', 'SOURCE_CELL_EMPTY', 'SOURCE_COLUMN_ABSENT', 'SOURCE_IDENTITY_CHANGED']);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ClassificationReviewInput = z.object({
  service_id: z.string().min(1).max(160), field: ClassificationField,
  expected_name: z.string().min(1).max(500), expected_updated_date: z.string().max(50),
  original_sha256: Hash,
  result: z.enum(['ADDITIONAL_SOURCE_REQUIRED', 'EVIDENCE_SUBMITTED']),
  evidence_url: z.string().url().max(1000).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && /(?:^|\.)(?:go\.kr|or\.kr)$/.test(url.hostname);
  }, '공식기관 HTTPS 출처를 입력하세요.'),
  evidence_location: z.string().trim().min(2).max(500),
  evidence_quote: z.string().trim().min(10).max(3000),
  reason: z.string().trim().min(10).max(2000),
}).strict();
export const ClassificationReviewNote = ClassificationReviewInput.extend({
  review_id: z.string().uuid(), reviewed_at: z.string().datetime(), reviewer_role: z.literal('authenticated_admin'),
});
export const ClassificationQueueItem = z.object({
  service_id: z.string(), name: z.string(), updated_date: z.string(), field: ClassificationField,
  before: z.string(), reason: ClassificationReason, page: z.number().int().positive().nullable(),
  source_label: z.string(), original_sha256: z.string(), source_url: z.string(),
  region: z.string(), notes: z.array(ClassificationReviewNote),
});
export const ClassificationChange = z.object({
  revision: z.string(), service_id: z.string(), field: ClassificationField,
  expected_name: z.string(), expected_updated_date: z.string(), before_value: z.string(), after_value: z.string(),
  source_label: z.string(), source_url: z.string(), physical_page: z.number(),
  original_pdf_sha256: z.string().nullable(), verification_method: z.string(),
});
export const ClassificationReviewPage = z.object({
  view: z.enum(['pending', 'history']), total: z.number(), offset: z.number(), limit: z.number(),
  summary: z.object({ type: z.number(), subcategory: z.number() }),
  pending: z.array(ClassificationQueueItem), changes: z.array(ClassificationChange),
});
export type ClassificationQueueItemType = z.infer<typeof ClassificationQueueItem>;
export type ClassificationReviewPageType = z.infer<typeof ClassificationReviewPage>;
