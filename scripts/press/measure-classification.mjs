// 보도자료 제목 분류의 precision/recall 측정. 사용: node scripts/press/measure-classification.mjs docs/press/eval/labels-2026-10-04.json
// 판정표(작업자 판정)는 정답이 아니라 기준점이다. 표본과 판정 방법은 판정표 파일의 sample·labeler·rule에 적혀 있다.
import { readFileSync, writeFileSync } from "node:fs";
import { classifyTitle } from "../../lib/press/classify.ts";
import { DICTIONARY_VERSION } from "../../lib/press/dictionary.ts";

const labelsPath = process.argv[2] ?? "docs/press/eval/labels-2026-10-04.json";
const { items } = JSON.parse(readFileSync(labelsPath, "utf8"));

const rows = items.map((item) => ({ ...item, predicted: classifyTitle(item.title).status }));
const gold = (row) => row.gold === "WELFARE";
const count = (filter) => rows.filter(filter).length;
const ratio = (num, den) => (den === 0 ? null : Math.round((num / den) * 1000) / 1000);

function score(isPositive) {
  const tp = count((row) => isPositive(row) && gold(row));
  const fp = count((row) => isPositive(row) && !gold(row));
  const fn = count((row) => !isPositive(row) && gold(row));
  const tn = count((row) => !isPositive(row) && !gold(row));
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision && recall ? Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000 : null;
  return { tp, fp, fn, tn, precision, recall, f1 };
}

const bySource = {};
for (const row of rows) {
  const entry = (bySource[row.source_id] ??= { total: 0, gold_welfare: 0, predicted_welfare: 0, errors: 0 });
  entry.total += 1;
  if (gold(row)) entry.gold_welfare += 1;
  if (row.predicted === "WELFARE") entry.predicted_welfare += 1;
  if ((row.predicted === "WELFARE") !== gold(row)) entry.errors += 1;
}

const result = {
  labels: labelsPath,
  dictionary_version: DICTIONARY_VERSION,
  total: rows.length,
  gold_welfare: count(gold),
  needs_review: count((row) => row.predicted === "NEEDS_REVIEW"),
  welfare_only: score((row) => row.predicted === "WELFARE"),
  welfare_or_review: score((row) => row.predicted !== "NON_WELFARE"),
  excluding_borderline: (() => {
    const kept = rows.filter((row) => !row.borderline);
    const tp = kept.filter((row) => row.predicted === "WELFARE" && gold(row)).length;
    const fp = kept.filter((row) => row.predicted === "WELFARE" && !gold(row)).length;
    const fn = kept.filter((row) => row.predicted !== "WELFARE" && gold(row)).length;
    return { total: kept.length, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
  })(),
  by_source: bySource,
  false_positives: rows.filter((row) => row.predicted === "WELFARE" && !gold(row)).map((row) => ({ source_id: row.source_id, title: row.title, borderline: row.borderline ?? "" })),
  false_negatives: rows.filter((row) => row.predicted !== "WELFARE" && gold(row)).map((row) => ({ source_id: row.source_id, title: row.title, predicted: row.predicted, borderline: row.borderline ?? "" })),
};

const out = process.argv[3];
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ total: result.total, gold_welfare: result.gold_welfare, welfare_only: result.welfare_only, welfare_or_review: result.welfare_or_review, excluding_borderline: result.excluding_borderline }, null, 2));
console.log("FP:", result.false_positives.map((row) => row.title).join(" / "));
console.log("FN:", result.false_negatives.map((row) => row.title).join(" / "));
