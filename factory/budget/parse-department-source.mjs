import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { optionsFor } from "../hwp-parser/src/profile.mjs";
import { buildDocument, extractionPlan } from "../hwp-parser/src/normalize.mjs";
import { LIMITS } from "../hwp-parser/src/limits.mjs";

// 공식 공개 PDF 전용. 기존 워커의 전역 한도는 바꾸지 않고 64 MiB/300쪽 이내만 처리한다.
// 네트워크 차단 모듈과 함께 실행하며 본문은 로그에 쓰지 않는다.
const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
const [input, digest, firstArg, lastArg, output] = process.argv.slice(2);
const first = Number(firstArg), last = Number(lastArg);
if (!output || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last - first >= 300) throw Error("INVALID_RANGE");
const pin = JSON.parse(readFileSync(new URL("../hwp-parser/parser-pin.json", import.meta.url)));
const lock = JSON.parse(readFileSync(new URL("../hwp-parser/package-lock.json", import.meta.url)));
const installed = lock.packages["node_modules/kordoc"];
if (installed.version !== pin.package_version || installed.integrity !== pin.package_integrity) throw Error("PARSER_PIN_MISMATCH");
const bytes = readFileSync(input);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== digest || bytes.length > 64 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("INPUT_REJECTED");
const { parsePdf } = require("kordoc");
const result = await parsePdf(bytes, { ...optionsFor("pdf", { pageRange: { first, last }, ocr: false }), removeHeaderFooter: false });
if (!result.success) throw Error("KORDOC_PARSE_FAILED:" + (result.code ?? "UNKNOWN"));
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "imageData").map(([key, entry]) => [key, clean(entry)]));
  return value;
};
const raw = clean({ blocks: result.blocks, pageCount: result.pageCount, pageQuality: result.pageQuality, warnings: result.warnings, outline: result.outline, fileType: "pdf" });
const id = "dept-" + sha256.slice(0, 16) + "-" + first + "-" + last;
const normalized = buildDocument(raw, id, LIMITS, extractionPlan("pdf", raw, false));
mkdirSync(output, { recursive: true });
for (const [name, value] of Object.entries({ "raw-ir.json": raw, "document.json": normalized.document })) writeFileSync(output + "/" + name, JSON.stringify(value));
writeFileSync(output + "/tables.jsonl", normalized.tables.map((row) => JSON.stringify(row)).join("\n") + "\n");
const summary = { parser: pin.name, version: pin.package_version, raw_sha256: sha256, bytes: bytes.length, first, last, pageCount: result.pageCount, blocks: raw.blocks.length, tables: normalized.tables.length, warnings: (raw.warnings ?? []).map(({ code, page }) => ({ code, page })) };
writeFileSync(output + "/parse-summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, warnings: summary.warnings.length }));
