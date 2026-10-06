// 정책브리핑 보건복지부 첨부 코퍼스 평가(작업지시서 v5 §18.5·T30·T52·T57·T76).
// 1) 모든 첨부를 실제 파싱 워커(run-job)로 돌려 형식별 결과·시간·크기·최대 메모리·OCR 여부를 기록(PDF는 kordoc 경로, 첨부 묶음 ZIP은 미지원).
// 2) HWPX는 원본 XML을 kordoc 없이 직접 읽은 표 구조(정답)와 파서 tables.jsonl을 표 ID로 맞춰 행·열 수, 셀 위치·병합, 셀 글자를 따로 대조.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runJob } from "../hwp-parser/src/run-job.mjs";
import { hwpxTables, normalizeText } from "./hwpx-xml.mjs";

const PARSER_VERSION = JSON.parse(readFileSync("factory/hwp-parser/parser-pin.json", "utf8")).package_version;
// 파서 버전마다 결과 폴더를 따로 둔다(이전 버전 결과를 덮어쓰지 않음).
const OUT_DIR = "docs/corpus/kordoc-" + PARSER_VERSION;
const root = path.resolve("var/welfare-factory");
const corpus = JSON.parse(readFileSync(path.join(root, "raw/korea-kr/manifest.json"), "utf8"));
mkdirSync(path.join(root, "jobs"), { recursive: true });
// 파서가 덧붙이는 표시(<sup> 등 HTML 태그)와 문단 자동 번호(원본 XML hp:t에는 없는 「- 」「1.」)를 뺀 글자. 글자 자체가 같은지 따로 센다.
const markupFree = (s) => normalizeText(s.replace(/<\/?[a-z]+>/gi, "").replace(/\bimage[_\w-]*\.(?:bmp|png|jpe?g|gif|wmf|emf)\b/gi, "").split("\n").map((line) => line.replace(/^\s*(?:[-–]\s|\d+\.\s)/, "")).join("\n")).replace(/^-|-$/g, "").replace(/-(?=-)/g, "");
const readJsonl = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const docs = [];
const totals = { files: 0, by_format: {}, structure: { tables_golden: 0, tables_matched: 0, dims_ok: 0, cells_golden: 0, cells_found: 0, position_span_ok: 0, text_ok: 0, text_markup_only: 0, text_other: 0, nested_tables: 0, nested_matched: 0 } };
for (const item of corpus.items) {
  for (const file of item.files) {
    const bytes = readFileSync(path.join(root, "raw/korea-kr", file.local));
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== file.sha256) throw new Error("해시 불일치 " + file.local);
    const ext = path.extname(file.local).slice(1);
    const job = { job_id: "kr-" + file.local.replace(/[^A-Za-z0-9]/g, ""), source_version_id: "sv-" + sha.slice(0, 12), input_ref: "raw/korea-kr/" + file.local, expected_sha256: sha, profile_id: "hwp-ingest", output_root: "parsed" };
    const jobPath = path.join(root, "jobs", job.job_id + ".json");
    writeFileSync(jobPath, JSON.stringify(job));
    const started = process.hrtime.bigint();
    const outcome = await runJob({ jobPath, root });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const doc = { news_id: item.news_id, file: file.local, format_by_extension: ext, bytes: bytes.length, ok: outcome.ok, status: outcome.status ?? null, error_code: outcome.error_code ?? null, ms: Math.round(ms), reused: outcome.reused ?? false };
    totals.files += 1;
    const key = ext + ":" + (outcome.ok ? outcome.status : outcome.error_code);
    totals.by_format[key] = (totals.by_format[key] ?? 0) + 1;
    if (outcome.ok) {
      const out = path.dirname(outcome.manifest_path);
      const quality = JSON.parse(readFileSync(path.join(out, "quality.json"), "utf8"));
      const parsedTables = readJsonl(path.join(out, "tables.jsonl"));
      doc.tables = parsedTables.length;
      doc.cells = parsedTables.reduce((sum, table) => sum + table.cells.length, 0);
      doc.nested_tables = parsedTables.filter((table) => table.parent_cell_id).length;
      doc.network_attempts = quality.network_attempts;
      doc.source_table_coverage = quality.source_table_coverage ? { source_tables: quality.source_table_coverage.source_tables, missing: quality.source_table_coverage.missing_ids?.length ?? null, in_caption: quality.source_table_coverage.in_caption_ids?.length ?? null } : null;
      if (doc.source_table_coverage?.missing) totals.missing_flagged = (totals.missing_flagged ?? 0) + doc.source_table_coverage.missing;
      doc.warnings = (quality.warnings ?? quality.mapped_warnings ?? []).length ?? null;
      doc.parse_id = outcome.parse_id;
      doc.performance = outcome.manifest?.performance ?? null;
      doc.ocr = outcome.manifest?.ocr ? { requested: outcome.manifest.ocr.requested, reason: outcome.manifest.ocr.reason, candidate_pages: outcome.manifest.ocr.candidate_pages?.length ?? 0, applied_pages: outcome.manifest.ocr.applied_pages?.length ?? 0 } : null;
      doc.page_mode = outcome.manifest?.page_mode ?? null;
      doc.reasons = quality.reasons ?? [];
      if (ext === "pdf") {
        const raw = JSON.parse(readFileSync(path.join(out, "raw-ir.json"), "utf8"));
        const documentJson = JSON.parse(readFileSync(path.join(out, "document.json"), "utf8"));
        doc.pdf = { pages: raw.pageCount, image_based: raw.isImageBased, blocks: documentJson.blocks.length, text_chars: documentJson.blocks.reduce((sum, block) => sum + (block.parsed_text_verbatim ?? "").length, 0) };
      }
      if (ext === "hwpx") {
        const golden = hwpxTables(bytes);
        const byId = new Map(parsedTables.map((table) => [table.source_table_id, table]));
        const s = { tables_golden: golden.length, tables_matched: 0, dims_ok: 0, cells_golden: 0, cells_found: 0, position_span_ok: 0, text_ok: 0, text_markup_only: 0, text_other: 0, nested_tables: golden.filter((t) => t.parent).length, nested_matched: 0, text_mismatches: [] };
        for (const table of golden) {
          const parsed = byId.get(table.id);
          s.cells_golden += table.cells.length;
          if (!parsed) continue;
          s.tables_matched += 1;
          if (table.parent && parsed.parent_cell_id) s.nested_matched += 1;
          if (parsed.logical_rows === table.rows && parsed.logical_columns === table.cols) s.dims_ok += 1;
          const cells = new Map(parsed.cells.map((cell) => [cell.anchor_row + ":" + cell.anchor_col, cell]));
          for (const cell of table.cells) {
            const found = cells.get(cell.row + ":" + cell.col);
            if (!found) continue;
            s.cells_found += 1;
            if (found.row_span === cell.row_span && found.col_span === cell.col_span) s.position_span_ok += 1;
            if (normalizeText(found.parsed_text_verbatim ?? "") === normalizeText(cell.text)) s.text_ok += 1;
            else if (markupFree(found.parsed_text_verbatim ?? "") === markupFree(cell.text)) s.text_markup_only += 1;
            else if ((s.text_other += 1) && s.text_mismatches.length < 5) s.text_mismatches.push({ table: table.id, at: [cell.row, cell.col], golden: cell.text.trim().slice(0, 60), parsed: (found.parsed_text_verbatim ?? "").slice(0, 60) });
          }
        }
        doc.structure = s;
        for (const k of Object.keys(totals.structure)) totals.structure[k] += s[k];
      }
    }
    docs.push(doc);
    console.error(doc.file, doc.ok ? doc.status : doc.error_code, doc.ms + "ms", doc.structure ? doc.structure.text_ok + "/" + doc.structure.cells_golden : "");
  }
}
const report = { generated_at: new Date().toISOString(), corpus: { source: corpus.source, robots: corpus.robots, releases: corpus.items.length, files: totals.files }, golden_method: "HWPX 원본 XML(Contents/section*.xml)의 hp:tbl·hp:tc·cellAddr·cellSpan·hp:t를 kordoc 없이 직접 읽어 표 구조 정답으로 사용. 의미 필드 정답은 별도.", totals, docs };
report.parser_version = PARSER_VERSION;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "korea-kr-eval.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(totals));
