import { z } from "zod";
import { KosisApiError, KosisFormatError, kosisApiUrl, kosisFrequency, kosisLatestPerItem, kosisSelection, mergeKosisParts, parseKosisApi } from "./kosis-api.ts";
import { KOSIS_DATASETS } from "./kosis.ts";
import { SourceError } from "./refresh-source.ts";
import type { StatisticsDataset } from "./types.ts";

const selectionSchema = z.object({ items: z.array(z.string()), classes: z.record(z.array(z.string())), omit_item_name: z.boolean(), ancestors: z.record(z.array(z.string())), virtual_classes: z.array(z.string()) }).strict();
const stageSchema = z.object({
  kind: z.literal("kosis-api-v1"), started: z.number(), revision: z.string().nullable(), contract: z.string(),
  frequencies: z.record(z.enum(["Y", "F", "IR"])),
  selections: z.record(selectionSchema),
  history_required: z.record(z.boolean()),
  parts: z.array(z.object({ table: z.string(), frequency: z.string(), body: z.string(), selection: selectionSchema }).strict()).max(4),
}).strict();
export async function refreshKosis(expected: StatisticsDataset, rawStage: string | null, revision: string | null, key: string | null,
  now: () => number, request: (url: string) => Promise<string>, saveStage: (value: string) => Promise<void>): Promise<StatisticsDataset> {
  if (!key) throw new SourceError("SOURCE_KEY_REQUIRED");
  const contract = JSON.stringify({ version: 2, tables: expected.kosis!.tables.map(table => [table.org_id, table.tbl_id]), series: expected.series.map(series => [series.id, series.label, series.unit]) });
  let stage: z.infer<typeof stageSchema> = { kind: "kosis-api-v1", started: now(), revision, contract, frequencies: {}, selections: {}, history_required: {}, parts: [] };
  if (rawStage && rawStage.length <= 450_000 && !rawStage.includes(key)) {
    try {
      const parsed = stageSchema.parse(JSON.parse(rawStage));
      if (parsed.revision === revision && parsed.contract === contract && parsed.started <= now() && now() - parsed.started < 86_400_000
        && new Set(parsed.parts.map(part => part.table)).size === parsed.parts.length) {
        for (const part of parsed.parts) {
          const table = expected.kosis!.tables.find(table => table.tbl_id === part.table);
          if (!table) throw new Error("invalid table");
          parseKosisApi(part.body, expected, table, part.frequency, now(), part.selection);
        }
        stage = parsed;
      }
    } catch { stage.parts = []; stage.frequencies = {}; stage.selections = {}; stage.history_required = {}; }
  }
  async function checkpoint() {
    const value = JSON.stringify(stage);
    if (value.length > 450_000) throw new SourceError("SOURCE_TOO_LARGE");
    await saveStage(value);
  }
  for (const table of expected.kosis!.tables) {
    if (stage.parts.some(part => part.table === table.tbl_id)) continue;
    let frequency = stage.frequencies[table.tbl_id];
    if (!frequency) {
      frequency = kosisFrequency(await request(kosisApiUrl(table, key)) ) as "Y" | "F" | "IR";
      stage.frequencies[table.tbl_id] = frequency;
      await checkpoint();
    }
    let selection = stage.selections[table.tbl_id];
    if (!selection) {
      selection = selectionSchema.parse(kosisSelection(await request(kosisApiUrl(table, key, undefined, undefined, "ITM")), expected, table));
      stage.selections[table.tbl_id] = selection;
      await checkpoint();
    }
    const historyStart = KOSIS_DATASETS.find(dataset => dataset.id === expected.id)?.periods[0];
    if (!historyStart) throw new SourceError("SOURCE_NOT_ALLOWED");
    const range = { from: historyStart, to: String(new Date(now()).getUTCFullYear()) };
    async function readPart(history: boolean) {
      const response = await request(kosisApiUrl(table, key!, frequency, selection, "PRD", history ? range : undefined));
      const clean = response.split(key!).join("[KEY]").split(decodeURIComponent(key!)).join("[KEY]");
      return parseKosisApi(history ? kosisLatestPerItem(clean) : clean, expected, table, frequency, now(), selection);
    }
    let parsed: ReturnType<typeof parseKosisApi>;
    try { parsed = await readPart(stage.history_required[table.tbl_id] === true); }
    catch (error) {
      const absent = error instanceof KosisFormatError && (error.detail.startsWith("missing ") || error.detail === "empty or invalid rows") || error instanceof KosisApiError && error.detail === "KOSIS error 30";
      if (!absent || stage.history_required[table.tbl_id]) throw error;
      stage.history_required[table.tbl_id] = true;
      await checkpoint();
      parsed = await readPart(true);
    }
    stage.parts.push({ table: table.tbl_id, frequency, body: parsed.body, selection });
    await checkpoint();
  }
  return mergeKosisParts(expected, stage.parts, now());
}
