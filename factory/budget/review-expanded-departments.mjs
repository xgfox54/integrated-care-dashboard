import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { documentRows, matchCorpus } from "./department-corpus.mjs";

const [rootArg, entityId] = process.argv.slice(2);
if (!rootArg || !/^[a-z0-9-]+$/u.test(entityId ?? "")) throw Error("USAGE_root_entity");
const root = path.resolve(rootArg), dir = path.join(root, entityId);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const jsonl = (file) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const state = read(path.join(dir, "state.json")), report = read(path.join(dir, "matches.json")), documents = read(path.join(dir, "documents.json"));
assert.equal(state.status, "REVIEW_REQUIRED");
for (const artifact of [state.index, state.download_resolver, state.department_toc, ...Object.values(state.downloads), ...Object.values(state.parses).flat(), ...Object.values(state.api_pages)].filter(Boolean)) assert.equal(hash(readFileSync(path.join(root, artifact.path))), artifact.sha256);
const items = Object.keys(state.api_pages).sort((a, b) => Number(a) - Number(b)).flatMap((key) => read(path.join(root, state.api_pages[key].path)).items);
assert.equal(items.length, report.api_projects);
const rows = [];
for (const document of documents) {
  const blocks = [], tables = [];
  for (const chunk of document.chunks) {
    blocks.push(...read(path.join(dir, "parsed", chunk, "document.json")).blocks);
    tables.push(...jsonl(path.join(dir, "parsed", chunk, "tables.jsonl")));
  }
  rows.push(...documentRows(document, { blocks, tables }, report.entity, items[0].fiscal_year).rows);
}
const checked = matchCorpus(items, rows);
assert.deepEqual(checked.mappings, report.mappings, "Entire corpus uniqueness and account/year/name/amount proof must reproduce");
const output = path.join(dir, "review-" + randomUUID());
mkdirSync(output);
const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
const { PDFiumLibrary } = require("@hyzyla/pdfium"), sharp = require("sharp");
const library = await PDFiumLibrary.init();
const images = [], targets = [];
try {
  for (const mapping of checked.mappings) {
    const evidence = mapping.evidence[0].document;
    const document = documents.find((candidate) => candidate.id === evidence.document_id);
    assert.equal(document.sha256, evidence.raw_sha256);
    const pdf = await library.loadDocument(readFileSync(path.join(root, state.downloads[document.id].path)));
    const rendered = await pdf.getPage(evidence.page - 1).render({ scale: 1.5, render: async ({ data, width, height }) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer() });
    const name = mapping.department_code + "-p" + evidence.page + ".png";
    writeFileSync(path.join(output, name), Buffer.from(rendered.data));
    const full = await sharp(rendered.data).metadata();
    images.push(await sharp(rendered.data).extract({ left: 0, top: 0, width: full.width, height: Math.min(380, full.height) }).resize({ width: 650 }).png().toBuffer());
    targets.push({ code: mapping.department_code, department: mapping.department_name, page: evidence.page, file: name, evidence: mapping.evidence.length });
    pdf.destroy();
  }
  // Header contact sheets supplement full pages; they do not certify every source cell visually.
  for (let start = 0; start < images.length; start += 8) {
    const group = images.slice(start, start + 8), overlays = []; let y = 0;
    for (let i = 0; i < group.length; i += 2) {
      overlays.push({ input: group[i], left: 0, top: y });
      if (group[i + 1]) overlays.push({ input: group[i + 1], left: 650, top: y });
      y += Math.max((await sharp(group[i]).metadata()).height, group[i + 1] ? (await sharp(group[i + 1]).metadata()).height : 0);
    }
    await sharp({ create: { width: 1300, height: y, channels: 4, background: "white" } }).composite(overlays).png().toFile(path.join(output, "headers-" + (start / 8 + 1) + ".png"));
  }
} finally { library.destroy(); }
const verification = { status: "VISUAL_REVIEW_REQUIRED", source_files: documents.length, source_pages: report.pages, api_projects: items.length, checked_candidates: checked.mappings.length, checked_evidence: checked.mappings.reduce((sum, mapping) => sum + mapping.evidence.length, 0), held: checked.held.length, targets, source_hashes_verified: true, entire_corpus_recomputed: true, publication: "NONE; this script never edits display mappings or production data" };
writeFileSync(path.join(output, "verification.json"), JSON.stringify(verification, null, 2));
writeFileSync(path.join(output, "mapping-candidates.json"), JSON.stringify({ mappings: checked.mappings }, null, 2));
console.log(JSON.stringify({ output, ...verification, targets: targets.length }));
