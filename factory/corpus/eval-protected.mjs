// 공개 표본(rhwp, MIT)으로 형식 판별·보호 문서 처리를 실제 워커에서 확인한다(T52·T69). 결과 docs/corpus/protected-format-eval.json
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { runJob } from "../hwp-parser/src/run-job.mjs";
const PARSER_VERSION = JSON.parse(readFileSync("factory/hwp-parser/parser-pin.json", "utf8")).package_version;
// 파서 버전마다 결과 폴더를 따로 둔다(이전 버전 결과를 덮어쓰지 않음).
const OUT_DIR = "docs/corpus/kordoc-" + PARSER_VERSION;

const root = path.resolve("var/welfare-factory");
const manifest = JSON.parse(readFileSync(path.join(root, "raw/public-samples/rhwp/manifest.json"), "utf8"));
mkdirSync(path.join(root, "jobs"), { recursive: true });
const results = [];
for (const item of manifest.items) {
  const bytes = readFileSync(path.join(root, "raw/public-samples/rhwp", item.file));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== item.sha256) throw new Error("해시 불일치 " + item.file);
  const job = { job_id: "rhwp-" + item.file.replace(/[^A-Za-z0-9]/g, ""), source_version_id: "sv-" + sha.slice(0, 12), input_ref: "raw/public-samples/rhwp/" + item.file, expected_sha256: sha, profile_id: "hwp-ingest", output_root: "parsed" };
  const jobPath = path.join(root, "jobs", job.job_id + ".json");
  writeFileSync(jobPath, JSON.stringify(job));
  const outcome = await runJob({ jobPath, root });
  let detail = null;
  if (outcome.ok) {
    const out = path.dirname(outcome.manifest_path);
    const m = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
    const q = JSON.parse(readFileSync(path.join(out, "quality.json"), "utf8"));
    detail = { detected_format: m.detected_format, file_type: m.file_type ?? null, adapter_version: m.adapter_version, upstream_error_code: q.upstream_error_code ?? null, reasons: q.reasons, blocks: m.files.find((f) => f.name === "document.json")?.records ?? null, tables: m.files.find((f) => f.name === "tables.jsonl")?.records ?? null };
  }
  results.push({ file: item.file, note: item.note, extension: path.extname(item.file).slice(1), head_hex: item.head_hex, ok: outcome.ok, status: outcome.status ?? null, error_code: outcome.error_code ?? null, ...detail });
}
const report = { generated_at: new Date().toISOString(), source: manifest.source, commit: manifest.commit, license: manifest.license, password_used: false, results };
report.parser_version = PARSER_VERSION;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "protected-format-eval.json"), JSON.stringify(report, null, 1) + "\n");
for (const r of results) console.log([r.file, r.ok ? r.status : r.error_code, r.detected_format ?? "", r.file_type ?? "", r.upstream_error_code ?? "", r.blocks ?? ""].join(" | "));

