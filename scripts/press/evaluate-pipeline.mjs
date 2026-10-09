// 보도자료 자동분류 전체 흐름 평가(작업지시서 2026-10-09 D-05).
// 운영 구현을 그대로 부른다: 1단계 제목 규칙(lib/press/classify.ts) → 2단계 학습 판정(lib/press/auto-classify.ts) → 공개·비공개·검토.
// 시험용으로 분류기를 다시 만들지 않는다. 개선 전 비교는 git에 남은 이전 판 파일(--before 경로)을 그대로 불러 같은 평가자료로 잰다.
//
// 사용:
//   node scripts/press/evaluate-pipeline.mjs --corpus <운영 내보내기.json> --labels <정답표.json> [--labels <정답표2.json>] [--before <이전 auto-classify.ts>] --out <결과.json>
// 정답표 형식: { sample, labeler, rule, split, items: [{ item_id?, title, gold: "WELFARE"|"NOT_WELFARE", borderline?, source_id?, published_date? }] }
// 학습 자료는 운영 내보내기의 학습 대상 행(판정 WELFARE·NON_WELFARE, 근거 reviewer·title_rule)이며, 평가 항목과 같은 묶음·같은 제목은 학습에서 뺀다.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { classifyTitle } from "../../lib/press/classify.ts";
import { DICTIONARY_VERSION } from "../../lib/press/dictionary.ts";
import { assessTitle, configId, groupTraining, PRESS_MODEL_CONFIG, trainTitleModel } from "../../lib/press/auto-classify.ts";

const args = process.argv.slice(2);
const opt = (name) => args.flatMap((value, index) => (value === name ? [args[index + 1]] : []));
const corpusPath = opt("--corpus")[0];
const labelPaths = opt("--labels");
const beforePath = opt("--before")[0];
const outPath = opt("--out")[0];
if (!corpusPath || !labelPaths.length || !outPath) throw new Error("--corpus, --labels, --out가 필요합니다.");

const sha = (text) => createHash("sha256").update(text).digest("hex");
const corpusText = readFileSync(corpusPath, "utf8");
const corpus = JSON.parse(corpusText);
const rows = corpus.items ?? corpus;
const normalize = (title) => title.normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
const groupKey = (row) => row.duplicate_group_id || row.title_key || "h:" + row.title_hash;
const byId = new Map(rows.map((row) => [row.item_id, row]));

// 평가 항목: 정답표마다 따로 재고, 같은 묶음·같은 제목은 한 번만 센다(평가 중복 제거).
const sets = labelPaths.map((file) => {
  const text = readFileSync(file, "utf8");
  const labels = JSON.parse(text);
  const seen = new Set();
  const items = [];
  let duplicates = 0;
  for (const item of labels.items) {
    const stored = item.item_id ? byId.get(item.item_id) : undefined;
    const key = stored ? groupKey(stored) : "t:" + normalize(item.title);
    const titleKey = "t:" + normalize(item.title);
    if (seen.has(key) || seen.has(titleKey)) { duplicates += 1; continue; }
    seen.add(key);
    seen.add(titleKey);
    items.push({ ...item, group: key, titleKey, source_id: item.source_id ?? stored?.source_id ?? "", org: stored?.org_name ?? item.org ?? "", published_date: item.published_date ?? stored?.published_date ?? "" });
  }
  return { file, sha256: sha(text), meta: { sample: labels.sample, labeler: labels.labeler, rule: labels.rule, split: labels.split ?? "" }, items, duplicates };
});

// 학습 자료: 운영 학습 대상 행에서 평가 항목과 같은 묶음·같은 제목을 뺀다(평가 자료를 학습에 섞지 않음).
const evalKeys = new Set(sets.flatMap((set) => set.items.flatMap((item) => [item.group, item.titleKey])));
const trainingRows = rows.filter((row) => ["WELFARE", "NON_WELFARE"].includes(row.classification_status) && ["reviewer", "title_rule"].includes(row.classification_basis));
const kept = trainingRows.filter((row) => !evalKeys.has(groupKey(row)) && !evalKeys.has("t:" + normalize(row.title)));
const training = groupTraining(kept.map((row) => ({ item_id: row.item_id, title: row.title, status: row.classification_status, basis: row.classification_basis, group_key: groupKey(row) })));
const trainingFingerprint = sha(JSON.stringify(training.rows.map((row) => [row.group, row.welfare, row.weight, row.title]).sort())).slice(0, 16);
const afterModel = trainTitleModel(training.rows, "eval:" + configId() + ":" + trainingFingerprint);

let beforeModule = null;
if (beforePath) beforeModule = await import(pathToFileURL(path.resolve(beforePath)).href);
const beforeModel = beforeModule ? beforeModule.trainTitleModel(kept.map((row) => ({ title: row.title, welfare: row.classification_status === "WELFARE", weight: row.classification_basis === "reviewer" ? 5 : 1 })), "before") : null;
const beforeMinTraining = 50;

function outcome(item, variant) {
  const rule = classifyTitle(item.title);
  if (rule.status === "WELFARE") return { stage: 1, final: "PUBLIC", decided: "WELFARE", reason: "1단계 규칙" };
  if (rule.status === "NON_WELFARE") return { stage: 1, final: "HIDDEN", decided: "NON_WELFARE", reason: "1단계 규칙" };
  if (variant === "after") {
    const judged = assessTitle(afterModel, item.title);
    if (!judged.decision) return { stage: 2, final: "REVIEW", decided: null, reason: judged.reason, score: judged.score };
    return { stage: 2, final: judged.decision === "WELFARE" ? "PUBLIC" : "HIDDEN", decided: judged.decision, reason: judged.reason, score: judged.score };
  }
  // 개선 전 운영 판(2단계): 학습 행 50건 이상이면 로그 승산 절댓값 4 이상에서 확정.
  const rowsCount = kept.length;
  const score = beforeModule.welfareLogOdds(beforeModel, item.title);
  if (rowsCount < beforeMinTraining || Math.abs(score) < beforeModule.AUTO_DECIDE_LOG_ODDS) return { stage: 2, final: "REVIEW", decided: null, reason: "확신 부족", score };
  return { stage: 2, final: score > 0 ? "PUBLIC" : "HIDDEN", decided: score > 0 ? "WELFARE" : "NON_WELFARE", reason: "점수 " + score.toFixed(2), score };
}

const ratio = (num, den) => ({ value: den === 0 ? "N/A" : Math.round((num / den) * 1000) / 1000, numerator: num, denominator: den });

function metrics(results) {
  const scored = results.filter((row) => !row.borderline);
  const gold = (row) => row.gold === "WELFARE";
  const autoPublic = scored.filter((row) => row.outcome.final === "PUBLIC");
  const autoHidden = scored.filter((row) => row.outcome.final === "HIDDEN");
  const review = scored.filter((row) => row.outcome.final === "REVIEW");
  const welfare = scored.filter(gold);
  return {
    evaluated: scored.length,
    excluded_borderline: results.length - scored.length,
    auto_public_precision: ratio(autoPublic.filter(gold).length, autoPublic.length),
    mispost_rate: ratio(autoPublic.filter((row) => !gold(row)).length, autoPublic.length),
    welfare_public_recall: ratio(welfare.filter((row) => row.outcome.final === "PUBLIC").length, welfare.length),
    welfare_false_reject_rate: ratio(welfare.filter((row) => row.outcome.final === "HIDDEN").length, welfare.length),
    review_rate: ratio(review.length, scored.length),
    auto_rate: ratio(autoPublic.length + autoHidden.length, scored.length),
    by_stage: {
      stage1_public: scored.filter((row) => row.outcome.stage === 1 && row.outcome.final === "PUBLIC").length,
      stage1_hidden: scored.filter((row) => row.outcome.stage === 1 && row.outcome.final === "HIDDEN").length,
      stage2_public: scored.filter((row) => row.outcome.stage === 2 && row.outcome.final === "PUBLIC").length,
      stage2_hidden: scored.filter((row) => row.outcome.stage === 2 && row.outcome.final === "HIDDEN").length,
      review: review.length,
    },
    false_positives: autoPublic.filter((row) => !gold(row)).map((row) => ({ title: row.title, stage: row.outcome.stage, reason: row.outcome.reason })),
    false_negatives: welfare.filter((row) => row.outcome.final === "HIDDEN").map((row) => ({ title: row.title, stage: row.outcome.stage, reason: row.outcome.reason })),
    held: review.map((row) => ({ title: row.title, gold: row.gold, reason: row.outcome.reason })),
  };
}

function breakdown(results, keyOf) {
  const groups = new Map();
  for (const row of results) groups.set(keyOf(row) || "(미상)", [...(groups.get(keyOf(row) || "(미상)") ?? []), row]);
  return Object.fromEntries([...groups.entries()].sort().map(([key, list]) => {
    const m = metrics(list);
    return [key, { evaluated: m.evaluated, auto_public_precision: m.auto_public_precision, welfare_public_recall: m.welfare_public_recall, review_rate: m.review_rate }];
  }));
}

const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
const report = {
  schema: "press-pipeline-evaluation-v1",
  generated_at: new Date().toISOString(),
  code_commit: commit,
  dictionary_version: DICTIONARY_VERSION,
  model: { config: PRESS_MODEL_CONFIG, config_id: configId(), training_fingerprint: trainingFingerprint, training_groups: afterModel.groups, training_rows_after_exclusion: kept.length, training_rows_in_corpus: trainingRows.length, training_conflict_groups: training.conflicts.length },
  thresholds_note: "임계값·최소 표본은 평가자료를 보기 전에 설계값으로 정했다(lib/press/auto-classify.ts PRESS_MODEL_CONFIG). 이 평가 결과를 보고 다시 조정하지 않았다.",
  corpus: { file: path.basename(corpusPath), sha256: sha(corpusText), exported_at: corpus.exported_at ?? "", rows: rows.length },
  split: "평가 항목과 같은 중복 묶음(duplicate_group_id)·제목 열쇠(title_key)·제목 해시·정규화 제목을 가진 학습 행은 학습에서 뺐다. 평가 자료 안에서도 같은 묶음·제목은 한 번만 셌다.",
  before_module: beforePath ? { file: beforePath, sha256: sha(readFileSync(beforePath, "utf8")) } : null,
  sets: sets.map((set) => {
    const evaluate = (variant) => set.items.map((item) => ({ ...item, outcome: outcome(item, variant) }));
    const after = evaluate("after");
    return {
      file: set.file, sha256: set.sha256, ...set.meta, items: set.items.length, duplicates_removed: set.duplicates,
      after: { ...metrics(after), by_source: breakdown(after, (row) => row.source_id || row.org), by_month: breakdown(after, (row) => (row.published_date || "").slice(0, 7)) },
      before: beforeModule ? metrics(evaluate("before")) : null,
    };
  }),
};
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
for (const set of report.sets) {
  const show = (m) => m && ({ n: m.evaluated, precision: m.auto_public_precision, mispost: m.mispost_rate, recall: m.welfare_public_recall, false_reject: m.welfare_false_reject_rate, review: m.review_rate, auto: m.auto_rate, stage: m.by_stage });
  console.log(path.basename(set.file), JSON.stringify({ after: show(set.after), before: show(set.before) }));
}
