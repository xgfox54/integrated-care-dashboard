import { z } from 'zod';

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ReviewCompletionInput = z.object({
  action: z.literal('complete_review'), faq_id: z.string().regex(/^\d+$/), source_url: z.string().url().max(1000),
  faq_content_sha256: Hash, observed_sha256: Hash, observed_content_sha256: Hash,
  source_checked_at: z.string().datetime(), result: z.enum(['GUIDANCE_UNCHANGED', 'FOLLOW_UP_REQUIRED']),
  evidence_quote: z.string().trim().min(10).max(3000), evidence_location: z.string().trim().min(2).max(500), reason: z.string().trim().min(10).max(2000),
}).strict();
export const ReviewCompletionSchema = ReviewCompletionInput.omit({ action: true }).extend({
  review_id: z.string(), guidance_revision: z.string(), comparison_algorithm: z.string(), reviewed_at: z.string(), review_due_at: z.string(), reviewer_role: z.literal('authenticated_admin'),
}).strip();
export type ReviewCompletion = z.infer<typeof ReviewCompletionSchema>;
