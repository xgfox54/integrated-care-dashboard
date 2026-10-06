import { readFileSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(process.argv[2]);
const sources = JSON.parse(readFileSync(path.join(root, "downloads.json")));
const old = path.join(root, "superseded-v1");
mkdirSync(old, { recursive: true });
for (const file of ["matches.json", "matching-summary.json", "evidence-check.json", "coverage.json", "artifact-hashes.json", "ui-result.json"]) {
  const dest = path.join(old, file);
  if (!existsSync(dest)) copyFileSync(path.join(root, file), dest);
}
writeFileSync(path.join(old, "INVALIDATED.json"), JSON.stringify({ valid: false, reason: "P1: incomplete department TOC regex and stripped page headers allowed a previous department to leak across department boundaries; prior evidence totals do not certify department names." }, null, 2));
for (const source of sources) {
  const count = JSON.parse(readFileSync(path.join(root, `parsed/v${source.volume}-toc/parse-summary.json`))).pageCount;
  for (let first = 1; first <= count; first += 250) {
    const last = Math.min(first + 249, count);
    const output = path.join(root, "parsed-v2", `v${source.volume}-${first}-${last}`);
    const result = spawnSync(process.execPath, ["--import", "./factory/hwp-parser/src/net-guard.mjs", "factory/budget/parse-department-source.mjs", source.file, source.sha256, String(first), String(last), output], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw Error("REPARSE_FAILED:" + source.volume + ":" + first);
    console.log(result.stdout.trim());
  }
}
