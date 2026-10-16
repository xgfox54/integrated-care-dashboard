import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { auditManualItem, reviewHash } from "./manual-faq-review.mjs";

const { values } = parseArgs({ options: {
  input: { type: "string", default: "quality/manual_faq_20261013.json" },
  plan: { type: "string", default: "quality/manual_faq_20261013.review-plan.json" },
  output: { type: "string", default: "quality/manual_faq_20261013.review.json" },
  "source-root": { type: "string" },
} });
if (!values["source-root"]) throw new Error("--source-root에 매뉴얼 변환본 폴더를 지정하세요.");
const inputBytes = await readFile(values.input);
const input = JSON.parse(inputBytes.toString("utf8"));
const planBytes = await readFile(values.plan);
const plan = JSON.parse(planBytes.toString("utf8"));
const ids = new Set(input.items.map((item) => item.id));
if (plan.source_sha256 !== reviewHash(inputBytes) || Object.keys(plan.corrections).some((id) => !ids.has(id))) throw new Error("검수 계획의 원본 해시·문항이 다릅니다.");
const sources = new Map();
const items = [];
for (const item of input.items) {
  const name = item.reference.source_name;
  if (path.basename(name) !== name) throw new Error("원문 파일명에 경로가 포함되어 있습니다.");
  if (!sources.has(name)) {
    const bytes = await readFile(path.join(values["source-root"], name));
    sources.set(name, { sha: reviewHash(bytes), lines: bytes.toString("utf8").replace(/\r\n/g, "\n").split("\n") });
  }
  const source = sources.get(name);
  const ref = item.reference;
  const excerpt = source.lines.slice(ref.start_line - 1, ref.end_line).join("\n");
  const verified = source.sha === ref.sha256 && excerpt === ref.excerpt && reviewHash(excerpt) === ref.excerpt_sha256;
  items.push(auditManualItem(item, plan.corrections[item.id] ?? null, verified));
}
const byRisk = {};
for (const item of items) for (const risk of item.risks) byRisk[risk] = (byRisk[risk] ?? 0) + 1;
const summary = { total: items.length, documents: sources.size,
  source_lines_verified: items.filter((item) => item.source_lines_verified).length,
  boundary_repairs: items.filter((item) => item.correction).length,
  quarantined: items.filter((item) => !item.retrieval_probe_eligible).length,
  retrieval_probe_eligible: items.filter((item) => item.retrieval_probe_eligible).length,
  confirmed_answer_keys: 0, by_risk: byRisk };
const report = { schema_version: "manual-faq-review-1", source_sha256: reviewHash(inputBytes), plan_sha256: reviewHash(planBytes),
  scope: "원문 행·해시 및 구조 위험 검수; 의미·현행 정책 검증과 GPT 답변 평가는 별도", summary, items };
await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(summary));
