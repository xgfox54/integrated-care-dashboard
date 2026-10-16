// 검수 판정(data/welfare100/manual-link-reviews.json)에 검수한 원문 줄의 내용 지문을 붙인다.
// 판정을 내린 직후, 그 판정을 읽은 코퍼스(COMBINED_REVISION)에서만 실행한다. 이미 붙은 지문은 바꾸지 않는다.
// 실행: node scripts/welfare100/stamp-manual-link-reviews.mjs [--check]
import fs from "node:fs";
import path from "node:path";

import { COMBINED_REVISION, combinedManualLines, readCorpus } from "./manual-pages.mjs";
import { lineFingerprint } from "./manual-link-scope.mjs";

const check = process.argv.includes("--check");
const SITE = process.cwd();
const FILE = path.join(SITE, "data/welfare100/manual-link-reviews.json");
const manualLines = combinedManualLines(readCorpus(path.join(SITE, "data/manual-corpus/assets/__manual_corpus"), COMBINED_REVISION));
const reviews = JSON.parse(fs.readFileSync(FILE, "utf8"));
const lineAt = (key, line) => manualLines.get(key)?.[line - 1];
const missing = [];
let stamped = 0;
for (const decision of reviews.decisions) {
  for (const [keyField, lineField, hashField] of [["key", "line", "line_sha256"], ["to_key", "to_line", "to_line_sha256"]]) {
    if (!decision[lineField] || decision[hashField]) continue;
    const text = lineAt(decision[keyField], decision[lineField]);
    if (text === undefined || !text.trim()) {
      missing.push(decision.item + " " + decision[keyField] + ":" + decision[lineField]);
      continue;
    }
    decision[hashField] = lineFingerprint(text);
    stamped += 1;
  }
}
if (missing.length) {
  console.error("원문 줄을 찾지 못한 판정 " + missing.length + "건: " + missing.slice(0, 10).join(", "));
  process.exit(2);
}
if (!check && stamped) fs.writeFileSync(FILE, JSON.stringify({ ...reviews, corpus_revision: COMBINED_REVISION }, null, 1) + "\n");
console.log(JSON.stringify({ mode: check ? "check" : "write", corpus_revision: COMBINED_REVISION, decisions: reviews.decisions.length, stamped }));

