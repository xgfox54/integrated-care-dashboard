import { createHash } from 'node:crypto';
import { z } from 'zod';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const ArtifactSchema = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const RunSchema = z.object({
  run_id: z.string().min(1), started_at: z.string().datetime(), completed_at: z.string().datetime(),
  code_commit: z.string().regex(/^[a-f0-9]{40}$/), endpoint_label: z.string().min(1).refine(value => !/[?@#]/.test(value)),
  server_versions: z.array(z.string().min(1)).min(1), server_version_basis: z.enum(['initialize', 'get_dataset_status']),
}).strict();
export const SuiteSchema = z.object({
  run: RunSchema, benchmark: ArtifactSchema, observations: ArtifactSchema,
  before: ArtifactSchema, after: ArtifactSchema, registered_tools: ArtifactSchema,
  revision_pointers: z.array(z.string().startsWith('/')).min(1),
}).strict();
export const ObservationSchema = z.object({
  id: z.string().min(1), tool: z.string().min(1), args: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()), latency_ms: z.unknown(),
  source_pins: z.array(z.object({ response_pointer: z.string().startsWith('/'), status_pointer: z.string().startsWith('/') }).strict()).optional(),
}).passthrough();
export const ManifestSchema = z.object({
  schema_version: z.literal('quality-manifest-1'), required_suites: z.array(z.enum(['balanced', 'golden'])).min(1),
  suites: z.object({ balanced: SuiteSchema.optional(), golden: SuiteSchema.optional() }).strict(),
  actual_answers: z.object({ benchmark: ArtifactSchema, observations: ArtifactSchema, evidence_root: z.string().min(1) }).strict().optional(),
}).strict();

export function payload(input) {
  const raw = input?.result ?? input;
  let value = raw?.structuredContent;
  if (value === undefined && Array.isArray(raw?.content)) {
    try { value = JSON.parse(raw.content.find(item => item.type === 'text')?.text ?? 'null'); } catch { return null; }
  }
  return (value ?? raw)?.data ?? value ?? raw;
}

export function pointer(value, path) {
  return path.slice(1).split('/').reduce((current, key) => current?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], value);
}

export function decodeArtifact(artifact) {
  if (!artifact || typeof artifact.bytes !== 'string' || !artifact.bytes.length) throw new Error('MISSING_PROVENANCE');
  if (sha256(artifact.bytes) !== artifact.sha256) throw new Error('HASH_MISMATCH');
  try { return JSON.parse(artifact.bytes); } catch { throw new Error('MISSING_PROVENANCE'); }
}
