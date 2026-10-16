// 합본 매뉴얼 코퍼스(data/manual-corpus)에서 카탈로그 매칭용 Markdown(01.md~39.md)을 줄 번호 그대로 되살린다.
// 실행: node scripts/welfare100/export-manual-markdown.mjs <출력 폴더>
import fs from "node:fs";
import path from "node:path";

import { COMBINED_REVISION, combinedManualLines, readCorpus } from "./manual-pages.mjs";

const [target] = process.argv.slice(2);
if (!target) throw new Error("출력 폴더를 지정하세요.");
const out = path.resolve(target);
const manuals = combinedManualLines(readCorpus(path.join(process.cwd(), "data/manual-corpus/assets/__manual_corpus"), COMBINED_REVISION));
fs.mkdirSync(out, { recursive: true });
const summary = {};
for (const [key, lines] of [...manuals].sort(([a], [b]) => a.localeCompare(b))) {
  const text = Array.from({ length: lines.length }, (_, index) => lines[index] ?? "").join("\n");
  fs.writeFileSync(path.join(out, key + ".md"), text);
  summary[key] = lines.length;
}
console.log(JSON.stringify({ corpus_revision: COMBINED_REVISION, out, manuals: Object.keys(summary).length, lines: summary }));

