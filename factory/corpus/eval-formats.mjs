// 추가 형식 실표본 검증: 지방재정365 엑셀(XLSX, 공개 자료) 셀 값을 kordoc 없이 원본 XML로 읽어 대조하고,
// 실제 공개 HWPX·HWP5 문서를 같은 워커로 돌린다. 결과 docs/corpus/kordoc-<버전>/formats-eval.json
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runJob } from "../hwp-parser/src/run-job.mjs";

const PARSER_VERSION = JSON.parse(readFileSync("factory/hwp-parser/parser-pin.json", "utf8")).package_version;
const OUT_DIR = "docs/corpus/kordoc-" + PARSER_VERSION;
const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
const JSZip = require("jszip");
const root = path.resolve("var/welfare-factory");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const norm = (text) => String(text ?? "").replace(/[\s\u00a0]+/g, "").replace(/,/g, "");
const readJsonl = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** XLSX 정답: 공유 문자열과 시트 XML의 셀 값을 직접 읽는다(kordoc 미사용). */
async function xlsxCells(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const shared = [];
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  for (const si of sharedXml?.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(decode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  const cells = [];
  for (const name of Object.keys(zip.files).filter((file) => /^xl\/worksheets\/sheet\d+\.xml$/.test(file)).sort()) {
    const xml = await zip.file(name).async("string");
    for (const cell of xml.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = /r="([A-Z]+\d+)"/.exec(cell)?.[1];
      const type = /t="(\w+)"/.exec(cell)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
      const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(cell)?.[1];
      const text = type === "s" ? shared[Number(value)] : type === "inlineStr" ? decode(inline ?? "") : value !== undefined ? decode(value) : "";
      if (text !== "") cells.push({ sheet: name, ref, text, numeric: type !== "s" && type !== "inlineStr" && type !== "str" && /^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(text) });
    }
  }
  return cells;
}

async function run(name, relative, bytes) {
  const digest = sha256(bytes);
  const job = { job_id: "fmt-" + name.replace(/[^A-Za-z0-9]/g, ""), source_version_id: "sv-" + digest.slice(0, 12), input_ref: relative, expected_sha256: digest, profile_id: "hwp-ingest", output_root: "parsed" };
  const jobPath = path.join(root, "jobs", job.job_id + ".json");
  writeFileSync(jobPath, JSON.stringify(job));
  return runJob({ jobPath, root });
}

mkdirSync(path.join(root, "jobs"), { recursive: true });
const samples = [
  { file: "samples/lofin-LF3120202-2026-10-03.xlsx", origin: "행정안전부 지방재정365 세출 공개자료 내려받기(2026-10-03)" },
  { file: "real/mohw-1492120.hwpx", origin: "보건복지부 보도참고자료 첨부" },
  { file: "real/mohw-1492126.hwpx", origin: "보건복지부 보도자료 첨부" },
  { file: "real/mohw-1492142.hwpx", origin: "보건복지부 보도자료 첨부" },
  { file: "real/seogwipo-recycling-notice.hwp", origin: "서귀포시 공고문 첨부(HWP 5.x)" },
];
const results = [];
for (const sample of samples) {
  const bytes = readFileSync(path.join(root, "raw", sample.file));
  const outcome = await run(path.basename(sample.file), "raw/" + sample.file, bytes);
  const entry = { file: sample.file, origin: sample.origin, bytes: bytes.length, ok: outcome.ok, status: outcome.status ?? null, error_code: outcome.error_code ?? null };
  if (outcome.ok) {
    const out = path.dirname(outcome.manifest_path);
    const tables = readJsonl(path.join(out, "tables.jsonl"));
    const quality = JSON.parse(readFileSync(path.join(out, "quality.json"), "utf8"));
    Object.assign(entry, { detected_format: outcome.manifest.detected_format, kordoc_detected_format: outcome.manifest.kordoc_detected_format, tables: tables.length, cells: tables.reduce((sum, table) => sum + table.cells.length, 0), performance: outcome.manifest.performance, network_attempts: quality.network_attempts, reasons: quality.reasons ?? [] });
    if (sample.file.endsWith(".xlsx")) {
      const truth = await xlsxCells(bytes);
      const parsed = new Map();
      for (const table of tables) for (const cell of table.cells) { const key = norm(cell.parsed_text_verbatim); parsed.set(key, (parsed.get(key) ?? 0) + 1); }
      let found = 0, numericFound = 0, numericTotal = 0;
      const missingNumeric = [];
      for (const cell of truth) {
        const key = norm(cell.text);
        const hit = (parsed.get(key) ?? 0) > 0;
        if (hit) { found += 1; parsed.set(key, parsed.get(key) - 1); }
        if (cell.numeric) { numericTotal += 1; if (hit) numericFound += 1; else if (missingNumeric.length < 5) missingNumeric.push(cell.ref); }
      }
      entry.xlsx_vs_source_xml = { truth_cells: truth.length, matched: found, match_pct: Math.round((found / truth.length) * 1000) / 10, numeric_cells: numericTotal, numeric_matched: numericFound, numeric_match_pct: numericTotal ? Math.round((numericFound / numericTotal) * 1000) / 10 : null, missing_numeric_refs: missingNumeric, method: "셀 글자(공백·쉼표 제거)를 개수까지 맞춰 대조. 위치는 대조하지 않음" };
    }
  }
  results.push(entry);
  console.error(sample.file, entry.ok ? entry.status : entry.error_code, entry.xlsx_vs_source_xml ? JSON.stringify(entry.xlsx_vs_source_xml) : "");
}
const report = { generated_at: new Date().toISOString(), parser_version: PARSER_VERSION, results };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "formats-eval.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(results.map((entry) => [entry.file, entry.status ?? entry.error_code, entry.tables, entry.cells, entry.performance?.elapsed_ms, entry.performance?.peak_rss_mb, entry.xlsx_vs_source_xml?.match_pct, entry.xlsx_vs_source_xml?.numeric_match_pct])));
