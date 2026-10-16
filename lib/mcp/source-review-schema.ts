import { z } from 'zod';
export const SourceReviewSchema = z.object({
  source_url: z.string().url(), baseline_sha256: z.string(), observed_sha256: z.string(),
  checked_at: z.string(), status: z.enum(['BASELINE_RECORDED', 'UNCHANGED', 'CHANGED', 'CHECK_FAILED']), error_code: z.string().nullable(),
  baseline_content_sha256: z.string().nullable().default(null), observed_content_sha256: z.string().nullable().default(null), comparison_algorithm: z.string().nullable().default(null),
});
export type SourceReview = z.infer<typeof SourceReviewSchema>;
