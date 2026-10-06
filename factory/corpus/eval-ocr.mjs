// OCR 경로 검증(kordoc 내장 PP-OCRv5, 로컬). 실제 스캔 표본이 없어, 권한이 확인된 실제 공개 PDF(정책브리핑, robots Allow: /)의 한 쪽을
// 그림으로 렌더링해 파생 표본을 만든다: 그림만 있는 PDF(스캔 모사), 그림 쪽 + 텍스트층 쪽(혼합 모사), PNG(이미지 입력).
// 정답은 같은 쪽의 텍스트층 파싱 결과다(kordoc 텍스트 추출). 파생 표본은 실제 스캔 문서 검증을 대신하지 않는다.
// 실행: node factory/corpus/eval-ocr.mjs [정책브리핑 PDF 파일명] [쪽 번호]  → docs/corpus/kordoc-<버전>/ocr-eval-<파일>-p<쪽>.json
// 보고서에는 개인정보·원문이 남지 않게 낱말·숫자 놓친 예를 적지 않고 날짜·금액 형식 예만 적는다.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runJob } from "../hwp-parser/src/run-job.mjs";

const PARSER_VERSION = JSON.parse(readFileSync("factory/hwp-parser/parser-pin.json", "utf8")).package_version;
const OUT_DIR = "docs/corpus/kordoc-" + PARSER_VERSION;
const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
const { PDFiumLibrary } = require("@hyzyla/pdfium");
const sharp = require("sharp");

const root = path.resolve("var/welfare-factory");
const SOURCE = process.argv[2] ?? "kr-156784228-198565085.pdf";
const PAGE = Number(process.argv[3] ?? 1);
const SCALE = 2;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const squash = (text) => (text ?? "").replace(/<\/?[a-z]+>/gi, "").replace(/[\s\u00a0\u3000]+/g, "");
const readJsonl = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
mkdirSync(path.join(root, "jobs"), { recursive: true });
mkdirSync(path.join(root, "raw/derived-ocr"), { recursive: true });

async function run(name, relative, bytes) {
  const digest = sha256(bytes);
  const job = { job_id: "ocr-" + name.replace(/[^A-Za-z0-9]/g, ""), source_version_id: "sv-" + digest.slice(0, 12), input_ref: relative, expected_sha256: digest, profile_id: "hwp-ingest", output_root: "parsed" };
  const jobPath = path.join(root, "jobs", job.job_id + ".json");
  writeFileSync(jobPath, JSON.stringify(job));
  const started = Date.now();
  const outcome = await runJob({ jobPath, root });
  return { outcome, wall_ms: Date.now() - started };
}

/** 쪽별 글자: 문단 블록 글자 + 그 쪽 표의 셀 글자(파싱 결과 순서). */
function pageTexts(outDir) {
  const document = JSON.parse(readFileSync(path.join(outDir, "document.json"), "utf8"));
  const tables = new Map(readJsonl(path.join(outDir, "tables.jsonl")).map((table) => [table.table_id, table]));
  const byPage = new Map();
  for (const block of document.blocks) {
    const page = block.page ?? 0;
    const parts = byPage.get(page) ?? [];
    if (block.type === "table" && tables.has(block.table_id)) for (const cell of tables.get(block.table_id).cells) parts.push(cell.parsed_text_verbatim ?? "");
    else parts.push(block.parsed_text_verbatim ?? "");
    byPage.set(page, parts);
  }
  return { document, byPage: new Map([...byPage].map(([page, parts]) => [page, parts.join("\n")])) };
}

function levenshtein(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

const TOKEN_KINDS = {
  number: /\d[\d,.]*\d|\d/g,
  date: /\d{4}\s*[.\-년]\s*\d{1,2}\s*[.\-월]?\s*(?:\d{1,2}\s*[.일]?)?/g,
  amount: /[\d,.]+\s*(?:천원|만원|억원|조원|원)/g,
  hangul_word: /[가-힣]{2,}/g,
};

/** OCR 글자를 정답(텍스트층)과 비교: 글자 일치율, 숫자·날짜·금액·한글 낱말 재현율, 놓친 예. */
function compare(truth, ocr) {
  const t = squash(truth);
  const o = squash(ocr);
  const distance = levenshtein(t, o);
  const tokens = {};
  for (const [kind, pattern] of Object.entries(TOKEN_KINDS)) {
    const wanted = [...new Set((truth.match(pattern) ?? []).map((token) => squash(token)).filter((token) => token.length >= (kind === "number" ? 2 : 1)))];
    const missing = wanted.filter((token) => !o.includes(token));
    tokens[kind] = { truth: wanted.length, found: wanted.length - missing.length, recall_pct: wanted.length ? Math.round(((wanted.length - missing.length) / wanted.length) * 1000) / 10 : null, ...(kind === "date" || kind === "amount" ? { missing_examples: missing.slice(0, 8) } : {}) };
  }
  return { truth_chars: t.length, ocr_chars: o.length, edit_distance: distance, char_accuracy_pct: t.length ? Math.round((1 - distance / Math.max(t.length, o.length)) * 1000) / 10 : null, tokens };
}

/** 그림 쪽(JPEG)과 텍스트 쪽(Helvetica, ASCII)으로 PDF를 만든다. 외부 라이브러리 없이 객체·xref를 직접 쓴다. */
function buildPdf(pages) {
  const objects = [null, null];
  const add = (body) => { objects.push(body); return objects.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (const page of pages) {
    if (page.jpeg) {
      const image = add(Buffer.concat([Buffer.from("<< /Type /XObject /Subtype /Image /Width " + page.width + " /Height " + page.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + page.jpeg.length + " >>\nstream\n", "latin1"), page.jpeg, Buffer.from("\nendstream", "latin1")]));
      const w = (page.width / SCALE).toFixed(2);
      const h = (page.height / SCALE).toFixed(2);
      const content = "q " + w + " 0 0 " + h + " 0 0 cm /Im" + image + " Do Q";
      const stream = add("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
      kids.push(add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + w + " " + h + "] /Resources << /XObject << /Im" + image + " " + image + " 0 R >> >> /Contents " + stream + " 0 R >>"));
    } else {
      const content = "BT /F1 14 Tf 72 760 Td 22 TL " + page.lines.map((line) => "(" + line.replace(/[()\\]/g, "") + ") '").join(" ") + " ET";
      const stream = add("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
      kids.push(add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 " + font + " 0 R >> >> /Contents " + stream + " 0 R >>"));
    }
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = "<< /Type /Pages /Kids [" + kids.map((kid) => kid + " 0 R").join(" ") + "] /Count " + kids.length + " >>";
  const chunks = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let size = chunks[0].length;
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(size);
    const bytes = Buffer.concat([Buffer.from((index + 1) + " 0 obj\n", "latin1"), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(bytes);
    size += bytes.length;
  });
  const xref = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n" + offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + size + "\n%%EOF\n";
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

const corpus = JSON.parse(readFileSync(path.join(root, "raw/korea-kr/manifest.json"), "utf8"));
const sourceItem = corpus.items.find((item) => item.files.some((file) => file.local === SOURCE));
const sourceFile = sourceItem?.files.find((file) => file.local === SOURCE);
if (!sourceFile) throw new Error("코퍼스에 없는 파일 " + SOURCE);
const sourceBytes = readFileSync(path.join(root, "raw/korea-kr", SOURCE));
if (sha256(sourceBytes) !== sourceFile.sha256) throw new Error("원문 해시 불일치");

// 1) 정답: 원래 PDF의 텍스트층 파싱(1쪽)
const textRun = await run("src-" + SOURCE, "raw/korea-kr/" + SOURCE, sourceBytes);
if (!textRun.outcome.ok) throw new Error("원문 PDF 파싱 실패 " + textRun.outcome.error_code);
const truth = pageTexts(path.dirname(textRun.outcome.manifest_path)).byPage.get(PAGE) ?? "";

// 2) 1쪽을 그림으로(144dpi)
const library = await PDFiumLibrary.init();
const pdf = await library.loadDocument(sourceBytes);
let raster;
await pdf.getPage(PAGE - 1).render({ scale: SCALE, render: async (options) => { raster = { data: Buffer.from(options.data), width: options.width, height: options.height }; return Buffer.alloc(0); } });
pdf.destroy();
library.destroy();
const rgb = sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 4 } }).flatten({ background: "#ffffff" });
const jpeg = await rgb.clone().jpeg({ quality: 90 }).toBuffer();
const png = await rgb.clone().png().toBuffer();
const textLines = ["Mixed PDF test page with a text layer", "Amount 1,234,567 KRW", "Reference date 2026-10-05", "Code A-0042"];
const samples = {
  "scan-like.pdf": buildPdf([{ jpeg, width: raster.width, height: raster.height }]),
  "mixed.pdf": buildPdf([{ jpeg, width: raster.width, height: raster.height }, { lines: textLines }]),
  "page1.png": png,
};
const derived = { source: { file: SOURCE, sha256: sourceFile.sha256, news_id: sourceItem.news_id, origin: corpus.source, robots: corpus.robots, page: PAGE, render_scale: SCALE, dpi: 72 * SCALE }, files: [] };
const results = [];
for (const [name, bytes] of Object.entries(samples)) {
  const local = "derived-" + sourceFile.sha256.slice(0, 8) + "-p" + PAGE + "-" + name;
  writeFileSync(path.join(root, "raw/derived-ocr", local), bytes);
  derived.files.push({ local, sha256: sha256(bytes), bytes: bytes.length });
  const { outcome, wall_ms } = await run(local, "raw/derived-ocr/" + local, bytes);
  const entry = { sample: name, ok: outcome.ok, status: outcome.status ?? null, error_code: outcome.error_code ?? null, wall_ms };
  if (outcome.ok) {
    const outDir = path.dirname(outcome.manifest_path);
    const { document, byPage } = pageTexts(outDir);
    const quality = JSON.parse(readFileSync(path.join(outDir, "quality.json"), "utf8"));
    const sourceMap = readJsonl(path.join(outDir, "source-map.jsonl"));
    const tables = readJsonl(path.join(outDir, "tables.jsonl"));
    entry.detected_format = outcome.manifest.detected_format;
    entry.ocr = outcome.manifest.ocr ? { requested: outcome.manifest.ocr.requested, reason: outcome.manifest.ocr.reason, applied_pages: outcome.manifest.ocr.applied_pages ?? [], models: outcome.manifest.ocr.models ? { engine: outcome.manifest.ocr.models.engine, digest: outcome.manifest.ocr.models.digest } : null } : null;
    entry.performance = outcome.manifest.performance;
    entry.network_attempts = quality.network_attempts;
    entry.page_methods = Object.fromEntries([...new Set(document.blocks.map((block) => block.page))].map((page) => [page, [...new Set(document.blocks.filter((block) => block.page === page).map((block) => block.extraction_method))]]));
    entry.ocr_marking = {
      blocks: document.blocks.length,
      blocks_with_ocr_flag: document.blocks.filter((block) => block.ocr?.review_required).length,
      source_map_ocr_method: sourceMap.filter((item) => ["ocr_page", "ocr_image", "text_layer_with_ocr_regions"].includes(item.extraction_method)).length,
      source_map_entries: sourceMap.length,
      line_confidence: [...new Set(document.blocks.map((block) => block.ocr?.line_confidence).filter(Boolean))],
      low_confidence_lines_dropped: (quality.warnings ?? []).filter((warning) => warning.project_code === "WF_OCR_LOW_CONF").length,
      amount_cells_marked_review: tables.flatMap((table) => table.cells).filter((cell) => cell.normalized_value?.status === "ocr_needs_review").length,
      quality_status: quality.status,
      review_reasons: (quality.reasons ?? []).filter((reason) => reason.includes("OCR")),
    };
    entry.vs_text_layer = compare(truth, byPage.get(1) ?? "");
    entry.vs_text_layer.note = "파생 표본의 1쪽 = 원문 " + PAGE + "쪽";
    if (name === "mixed.pdf") {
      const page2 = squash(byPage.get(2) ?? "");
      const all = squash([...byPage.values()].join("\n"));
      entry.mixed_check = {
        text_page_lines_found: textLines.filter((line) => page2.includes(squash(line))).length,
        text_page_lines: textLines.length,
        text_page_duplicated: textLines.filter((line) => all.split(squash(line)).length - 1 > 1).length,
        ocr_pages: document.ocr_pages,
      };
    }
  }
  results.push(entry);
  console.error(name, entry.ok ? entry.status : entry.error_code, entry.vs_text_layer ? entry.vs_text_layer.char_accuracy_pct + "%" : "");
}
writeFileSync(path.join(root, "raw/derived-ocr/manifest-" + sourceFile.sha256.slice(0, 8) + "-p" + PAGE + ".json"), JSON.stringify(derived, null, 1));
const report = {
  generated_at: new Date().toISOString(), parser_version: PARSER_VERSION,
  method: "실제 공개 PDF 1쪽을 144dpi 그림으로 만든 파생 표본. 정답은 같은 쪽 텍스트층 파싱 결과(kordoc). 글자 일치율 = 1 - 편집거리/긴 쪽 길이(공백 제거). 실제 스캔 문서(기울기·잡음·도장) 검증을 대신하지 않는다.",
  source: derived.source, truth_chars: squash(truth).length, text_layer_run: { status: textRun.outcome.status, performance: textRun.outcome.manifest?.performance ?? null },
  results,
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "ocr-eval-" + SOURCE.replace(/\.pdf$/, "") + "-p" + PAGE + ".json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(results.map((entry) => ({ sample: entry.sample, status: entry.status ?? entry.error_code, ocr: entry.ocr?.applied_pages, acc: entry.vs_text_layer?.char_accuracy_pct, numbers: entry.vs_text_layer?.tokens.number.recall_pct, dates: entry.vs_text_layer?.tokens.date.recall_pct, amounts: entry.vs_text_layer?.tokens.amount.recall_pct, mixed: entry.mixed_check, ms: entry.performance?.elapsed_ms, rss: entry.performance?.peak_rss_mb }))));
