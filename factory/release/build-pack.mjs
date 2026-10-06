// 검토 파일로 공개 묶음 ZIP과 .sha256 파일을 만든다. 로컬 전용. approved 후보만 넣는다.
// 사용: node factory/release/build-pack.mjs --review <검토.json> --parsed-root <parsed 상위 디렉터리> --out <묶음.zip> [--dry-run]
// --dry-run: 묶음을 메모리에서만 만들어 서버와 같은 검사기로 검사하고 결과만 보여 준다. 파일을 쓰지 않고, 파싱·모델·외부 호출도 하지 않는다.
// 검토 파일 형식은 factory/release/README.md를 보라.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { validatePack } from "../../lib/imports/pack.ts";
import { buildDocumentPack } from "./pack-builder.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const reviewPath = argument("--review");
const parsedRoot = argument("--parsed-root");
const out = argument("--out");
const dryRun = process.argv.includes("--dry-run");
if (!reviewPath || !parsedRoot || (!out && !dryRun)) {
  console.error("사용: node factory/release/build-pack.mjs --review <검토.json> --parsed-root <parsed 상위> --out <묶음.zip>");
  process.exit(2);
}
const review = JSON.parse(readFileSync(reviewPath, "utf8"));
const sources = review.sources.map((source) => {
  const manifest = JSON.parse(readFileSync(join(parsedRoot, source.parse_id, "manifest.json"), "utf8"));
  if (manifest.source_version_id !== source.source_version_id || manifest.raw_sha256 !== source.raw_sha256) throw new Error("검토 파일의 원문 버전과 파싱 결과가 다릅니다: " + source.source_id);
  return {
    source_id: source.source_id, source_version_id: manifest.source_version_id, source_kind: source.source_kind, title: source.title, issuer: source.issuer,
    issuer_sido: source.issuer_sido, issuer_sigungu: source.issuer_sigungu ?? "", document_number: source.document_number ?? "", url: source.url ?? null,
    published_date: source.published_date ?? null, retrieved_at: source.retrieved_at, raw_sha256: manifest.raw_sha256,
    format: manifest.detected_format === "hwpx" ? "HWPX" : "HWP5", parse_id: manifest.parse_id, parser: manifest.parser.name + "@" + manifest.parser.package_version,
    adapter_version: manifest.adapter_version, locator_precision: "parsed_structural", page_mode: manifest.page_mode === "layout" ? "layout" : "none", rights_basis: source.rights_basis,
  };
});
const facts = review.facts.filter((fact) => fact.review_status === "approved").map((fact) => ({ ...fact, evidence: fact.evidence }));
const skipped = review.facts.length - facts.length;
const pack = await buildDocumentPack({
  artifactId: review.artifact_id, createdAt: new Date().toISOString(), producerRunId: review.producer_run_id ?? basename(reviewPath),
  mappingVersion: review.mapping_version ?? "document-facts-mapping-1", baseSourceRunId: review.base_source_run_id ?? null,
  sources, facts, emptyReplaceSourceIds: review.empty_replace_source_ids ?? [],
});
const check = await validatePack(pack.zip);
const summary = { sha256: pack.sha256, bytes: pack.zip.length, statements: pack.statements.length, evidence: pack.evidence.length, skipped_not_approved: skipped, server_validator: check.ok ? "PASS" : check.problems };
if (dryRun) {
  console.log(JSON.stringify({ dry_run: true, wrote_files: false, ...summary }, null, 2));
  process.exit(check.ok ? 0 : 1);
}
if (!check.ok) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}
writeFileSync(out, pack.zip);
writeFileSync(out + ".sha256", pack.sha256 + "  " + basename(out) + "\n");
console.log(JSON.stringify({ out, ...summary }, null, 2));
