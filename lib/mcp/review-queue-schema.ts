import { z } from 'zod';
import { SourceReviewSchema } from './source-review-schema.ts';
import { ReviewCompletionSchema } from './review-completion-schema.ts';
const SourceSchema = z.object({ title: z.string(), url: z.string().url(), location: z.string() });
export const ReviewQueueSchema = z.object({
  generated_at: z.string(),
  items: z.array(z.object({ id: z.string(), title: z.string(), kind: z.enum(['FAQ', 'MANUAL', 'FISCAL']), status: z.string(), revision: z.string(), content_sha256: z.string().optional(), reviewed_at: z.string().nullable(), due_at: z.string().nullable(), gaps: z.array(z.string()), sources: z.array(SourceSchema) })),
  source_checks: z.array(SourceReviewSchema),
  review_history: z.array(ReviewCompletionSchema).default([]),
});
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;
