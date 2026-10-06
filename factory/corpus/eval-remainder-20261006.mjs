// Repeatable worker-level verification; preserves raw files and previous parser outputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runJob } from "../hwp-parser/src/run-job.mjs";
import { verifyOcrModels } from "../hwp-parser/src/models.mjs";
import { verifyParserPin } from "../hwp-parser/src/worker.mjs";

const root = path.resolve("var/welfare-factory");
const destination = path.resolve(process.argv[2] ?? ".omo/evidence/parser-remainder-20261006");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonl = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
const JSZip = require("jszip");
const decode = (value) => value.replace(/&#x([0-9a-f]+);/giu, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/gu, (_, n) => String.fromCodePoint(Number(n))).replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
const text = (value) => String(value ?? "").normalize("NFC").replace(/\s+/gu, "");
mkdirSync(destination, { recursive: true });
mkdirSync(path.join(root, "jobs/remainder-20261006"), { recursive: true });
mkdirSync(path.join(root, "raw/remainder-20261006"), { recursive: true });
const docxSource = path.resolve("var/law-mcp-probe/ltc-guide.docx"), docxTarget = path.join(root, "raw/remainder-20261006/ltc-guide.docx");
if (existsSync(docxTarget)) assert.equal(hash(readFileSync(docxTarget)), hash(readFileSync(docxSource)));
else copyFileSync(docxSource, docxTarget);
const manifest = read(path.join(root, "raw/korea-kr/manifest.json"));
const pdf = manifest.items.flatMap((item) => item.files).find((file) => file.local === "kr-156784143-198564530.pdf");
assert.ok(pdf);
assert.equal(hash(readFileSync(path.join(root, "raw/korea-kr", pdf.local))), pdf.sha256);
// Acquisition is separate from the offline parsing processes; never send source bytes externally.
const docxUrl = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003612293&fileDetailSn=1";
const official = await fetch(docxUrl, { signal: AbortSignal.timeout(45000), redirect: "error" });
assert.equal(official.status, 200);
const officialBytes = Buffer.from(await official.arrayBuffer());
assert.ok(officialBytes.length <= 2 * 1024 * 1024);
assert.equal(hash(officialBytes), hash(readFileSync(docxSource)), "Official public attachment must match the existing raw DOCX");

const samples = [
  { name: "xlsx", input: "raw/samples/lofin-LF3120202-2026-10-03.xlsx", provenance: "Existing local public-data sample; source download hash linkage not newly established" },
  { name: "docx", input: "raw/remainder-20261006/ltc-guide.docx", provenance: { public_page: "https://www.data.go.kr/data/15058856/fileData.do", url: docxUrl, bytes: officialBytes.length, sha256: hash(officialBytes), official_bytes_match: true } },
  { name: "pdf-page3", input: "raw/korea-kr/" + pdf.local, range: { first: 3, last: 3 }, provenance: { url: pdf.url, expected_sha256: pdf.sha256 } },
];
const results = [];
for (const sample of samples) {
  const bytes = readFileSync(path.join(root, sample.input));
  const job = { job_id: "remainder20261006-" + sample.name, source_version_id: "sv-" + hash(bytes).slice(0, 12), input_ref: sample.input, expected_sha256: hash(bytes), profile_id: "hwp-ingest", output_root: "parsed-remainder-20261006", ...(sample.range ? { page_range: sample.range } : {}) };
  const jobPath = path.join(root, "jobs/remainder-20261006", sample.name + ".json");
  writeFileSync(jobPath, JSON.stringify(job, null, 2));
  const outcome = await runJob({ jobPath, root });
  const result = { name: sample.name, raw_sha256: job.expected_sha256, bytes: bytes.length, provenance: sample.provenance, ok: outcome.ok, status: outcome.status ?? null, error_code: outcome.error_code ?? null };
  if (outcome.ok) {
    const directory = path.dirname(outcome.manifest_path), tables = jsonl(path.join(directory, "tables.jsonl")), document = read(path.join(directory, "document.json")), quality = read(path.join(directory, "quality.json"));
    Object.assign(result, { parse_id: outcome.parse_id, reused: outcome.reused, manifest: path.relative(root, outcome.manifest_path).replaceAll("\\", "/"), manifest_hashes_verified_by_parent: true, blocks: document.blocks.length, tables: tables.length, cells: tables.reduce((sum, table) => sum + table.cells.length, 0), network_attempts: quality.network_attempts, performance: outcome.manifest.performance, extraction: outcome.manifest.extraction ?? outcome.manifest.extraction_plan ?? null, quality_reasons: quality.reasons });
    assert.equal(quality.network_attempts, 0);
    assert.ok(document.blocks.length || tables.some((table) => table.cells.length), "Empty results cannot pass");
    const zip = sample.name === "pdf-page3" ? null : await JSZip.loadAsync(bytes);
    if (sample.name === "xlsx") {
      const shared = [], sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
      for (const match of (sharedXml ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)) shared.push([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((part) => decode(part[1])).join(""));
      const sheets = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name));
      assert.equal(sheets.length, 1, "This actual sample check is scoped to one worksheet");
      assert.equal(tables.length, 1);
      const source = await zip.file(sheets[0]).async("string"), checked = [], missing = [];
      for (const match of source.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
        const reference = match[1].match(/\br="([A-Z]+)(\d+)"/u), kind = match[1].match(/\bt="([^"]+)"/u)?.[1], value = match[2]?.match(/<v\b[^>]*>([\s\S]*?)<\/v>/u)?.[1];
        const valueText = kind === "s" ? shared[Number(value)] : kind === "inlineStr" ? [...(match[2] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((part) => decode(part[1])).join("") : value === undefined ? "" : decode(value);
        if (!reference || !valueText) continue;
        let column = 0; for (const char of reference[1]) column = column * 26 + char.charCodeAt(0) - 64;
        const cell = tables[0].cells.find((cell) => cell.anchor_row === Number(reference[2]) - 1 && cell.anchor_col === column - 1);
        (cell && text(cell.parsed_text_verbatim) === text(valueText) ? checked : missing).push(reference[1] + reference[2]);
      }
      result.coordinate_comparison = { source_nonempty_cells: checked.length + missing.length, matched: checked.length, mismatched_refs: missing, basis: "Independent XLSX XML row/column and exact NFC whitespace-normalized values; no corpus tuning" };
      assert.equal(missing.length, 0);
      assert.equal(checked.length, 28);
    }
    if (sample.name === "docx") {
      const xml = await zip.file("word/document.xml").async("string"), raw = read(path.join(directory, "raw-ir.json"));
      const visible = (value) => value.replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1");
      const extracted = text(visible(raw.blocks.map((block) => block.text ?? "").join(" ") + " " + tables.flatMap((table) => table.cells.map((cell) => cell.parsed_text_verbatim)).join(" ")));
      // Choose one OOXML alternative representation; Choice+Fallback are not two source paragraphs.
      const selectedXml = xml.replace(/<mc:AlternateContent\b[^>]*>([\s\S]*?)<\/mc:AlternateContent>/gu, (_, alternatives) => alternatives.match(/<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>/u)?.[1] ?? alternatives.match(/<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/u)?.[1] ?? "");
      const paragraphs = [...selectedXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gu)].map((match) => [...match[1].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu)].map((part) => decode(part[1])).join("")).filter((value) => text(value));
      const missing = paragraphs.map((value, index) => ({ index, length: text(value).length, found: extracted.includes(text(value)) })).filter((entry) => !entry.found).map(({ index, length }) => ({ index, length }));
      result.source_xml_comparison = { original_tables: [...xml.matchAll(/<w:tbl\b/gu)].length, parsed_tables: tables.length, nonempty_paragraphs: paragraphs.length, missing_content: missing, basis: "Content containment only; order, multiplicity and layout NOT verified" };
      assert.equal(result.source_xml_comparison.original_tables, tables.length);
      assert.equal(missing.length, 0, "Source visible paragraph content must be present; this does not verify order or layout");
    }
    if (sample.name === "pdf-page3") result.page_scope = { declared: sample.range, output_pages: [...new Set(document.blocks.map((block) => block.page).filter((page) => page != null))], ocr_pages: [...new Set(document.blocks.filter((block) => block.ocr?.applied_to_page).map((block) => block.page))], exact_accuracy: "NOT_VERIFIED; warnings and NEEDS_REVIEW are retained" };
  }
  results.push(result);
}
const summary = { generated_at: new Date().toISOString(), parser: verifyParserPin(), models: verifyOcrModels(root), results, unfinished_temporary_directories: readdirSync(path.join(root, ".tmp-work")), os_network_sandbox: "NOT_RUN; Node-level offline guard is a separate property", ontology_import: "NONE", production_data_changes: "NONE" };
writeFileSync(path.join(destination, "worker-verification.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ report: path.relative(process.cwd(), destination), results: results.map((result) => Object.fromEntries(Object.entries(result).filter(([key]) => !["provenance", "quality_reasons", "extraction"].includes(key)))), temp_directories: summary.unfinished_temporary_directories.length }));
if (results.some((result) => !result.ok)) process.exitCode = 1;
