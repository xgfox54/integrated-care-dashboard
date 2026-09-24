import { z } from "zod";

import snapshotJson from "../data/welfare-talk-wiki.json" with { type: "json" };

export type WikiSourceTier = "local";

export interface WikiKnowledgeSource {
  readonly tier: WikiSourceTier;
  readonly label: string;
  readonly title: string;
  readonly summary: string;
  readonly publisher: string;
  readonly url: string;
  readonly matchedTerm: string;
  readonly sectionId?: string;
  readonly heading?: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly sourceSha256?: string;
  readonly sourceDatabaseSha256?: string;
}

interface KnowledgeEntry extends Omit<WikiKnowledgeSource, "matchedTerm"> {
  readonly terms: readonly string[];
}

const SnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  sourceDatabase: z.string().min(1),
  sourceDatabaseSha256: z.string().regex(/^[0-9a-f]{64}$/),
  generatedAt: z.string().datetime({ offset: true }),
  entries: z.array(z.object({
    id: z.string().min(1),
    terms: z.array(z.string().min(1)).min(1),
    sourceName: z.string().min(1),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    sectionId: z.string().regex(/^[0-9a-f]{20}$/),
    heading: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    quote: z.string().min(20),
  })).min(1),
});

const LOCAL_SNAPSHOT = SnapshotSchema.parse(snapshotJson);
const LOCAL_ENTRIES: readonly KnowledgeEntry[] = LOCAL_SNAPSHOT.entries.map((entry) => ({
  tier: "local",
  label: "2차 · 복지톡 DB 인용",
  title: entry.sourceName,
  summary: entry.quote,
  publisher: "복지톡 로컬 지식DB",
  url: "",
  terms: [...new Set([entry.heading, ...entry.terms])],
  sectionId: entry.sectionId,
  heading: entry.heading,
  startLine: entry.startLine,
  endLine: entry.endLine,
  sourceSha256: entry.sourceSha256,
  sourceDatabaseSha256: LOCAL_SNAPSHOT.sourceDatabaseSha256,
}));

export function normalizeWikiText(value: string): string {
  return value.replace(/[^0-9a-zA-Z가-힣]/g, "").toLowerCase();
}

function toSource(entry: KnowledgeEntry, matchedTerm: string): WikiKnowledgeSource {
  return {
    tier: entry.tier,
    label: entry.label,
    title: entry.title,
    summary: entry.summary,
    publisher: entry.publisher,
    url: entry.url,
    matchedTerm,
    sectionId: entry.sectionId,
    heading: entry.heading,
    startLine: entry.startLine,
    endLine: entry.endLine,
    sourceSha256: entry.sourceSha256,
    sourceDatabaseSha256: entry.sourceDatabaseSha256,
  };
}

function findExactEntry(entries: readonly KnowledgeEntry[], name: string): WikiKnowledgeSource | null {
  const normalized = normalizeWikiText(name);
  for (const entry of entries) {
    for (const term of entry.terms) {
      const normalizedTerm = normalizeWikiText(term);
      if (normalized === normalizedTerm) return toSource(entry, term);
    }
  }
  return null;
}

export function resolveFallbackKnowledge(name: string): WikiKnowledgeSource | null {
  return findExactEntry(LOCAL_ENTRIES, name);
}
