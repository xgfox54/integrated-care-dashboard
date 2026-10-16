import { z } from "zod";
import { indexApiTables, parseIndexApi } from "./index-api.ts";
import { INDEX_API_SERIES } from "./index-verified-data.ts";
import { STATISTICS_DAY } from "./store.ts";
import { StatisticsError } from "./read.ts";
import type { StatisticsDataset } from "./types.ts";

const MAX_STAGE = 500_000;
const SOURCE_FIELDS = ["지표코드", "통계표코드", "통계표명", "단위", "출처", "주기코드", "갱신일", "입력예정일", "주석",
  "항목그룹코드", "항목코드", "분류1코드", "분류2코드", "분류3코드", "항목그룹이름", "항목이름", "분류1이름", "분류2이름", "분류3이름", "시점", "값"] as const;
const sourceRows = z.array(z.record(z.unknown()));
const stageSchema = z.object({
  version: z.literal(1), started_at: z.number().finite(), source_revision: z.string(),
  published_revision: z.string().nullable(), long_timeout: z.boolean(),
  parts: z.array(z.object({ table_code: z.string(), body: z.string() }).strict()).max(8),
}).strict();
type IndexStage = z.infer<typeof stageSchema>;

/** Re-parse cached source rows through the same identity/unit checks as a fresh response. */
export function indexStageParts(stage: IndexStage, expected: StatisticsDataset, now: number): StatisticsDataset[] {
  return stage.parts.map(part => {
    const table = indexApiTables(expected).find(table => table.table_code === part.table_code);
    if (!table) throw new StatisticsError("SOURCE_FORMAT_CHANGED", "저장된 통계표 구성이 변경되었습니다.", 502);
    return parseIndexApi(part.body, table, now);
  });
}

export async function readIndexStage(raw: string | null, expected: StatisticsDataset, revision: string | null, now: number, key: string): Promise<IndexStage> {
  const contract = JSON.stringify({ tables: indexApiTables(expected), selectors: INDEX_API_SERIES[expected.id] });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contract));
  const sourceRevision = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const fresh: IndexStage = { version: 1, started_at: now, source_revision: sourceRevision, published_revision: revision, long_timeout: false, parts: [] };
  if (!raw || raw.length > MAX_STAGE || raw.includes(key)) return fresh;
  try {
    const decoded = stageSchema.safeParse(JSON.parse(raw));
    if (!decoded.success) return fresh;
    const stage = decoded.data;
    if (now < stage.started_at || now - stage.started_at >= STATISTICS_DAY || stage.source_revision !== sourceRevision
      || stage.published_revision !== revision || new Set(stage.parts.map(part => part.table_code)).size !== stage.parts.length) return fresh;
    indexStageParts(stage, expected, now);
    return stage;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof StatisticsError) return fresh;
    throw error;
  }
}

export function appendIndexStage(stage: IndexStage, tableCode: string, body: string, longTimeout: boolean): IndexStage {
  const rows = sourceRows.parse(JSON.parse(body));
  const publicBody = JSON.stringify(rows.map(row => Object.fromEntries(SOURCE_FIELDS.filter(field => typeof row[field] === "string" || row[field] === null).map(field => [field, row[field]]))));
  const next = { ...stage, long_timeout: stage.long_timeout || longTimeout, parts: [...stage.parts, { table_code: tableCode, body: publicBody }] };
  if (JSON.stringify(next).length > MAX_STAGE) throw new StatisticsError("SOURCE_TOO_LARGE", "통계표 임시 저장 크기를 초과했습니다.", 502);
  return next;
}
